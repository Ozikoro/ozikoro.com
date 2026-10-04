#!/usr/bin/env python3
"""
The self-hosted F5-TTS worker.

PROTOCOL

One JSON object per line on stdin, one JSON object per line on stdout, in order. There is no request
id because the callers are strictly sequential — the TypeScript side runs **one** synthesis at a time
(see `apps/media/lib/queue.ts`), because a CPU-bound flow-matching model is the whole machine and two
at once finish in the time of three.

    {"cmd": "load"}
    {"cmd": "synth", "text": "...", "ref_audio": "/abs/path.wav", "ref_text": "...",
     "out": "/abs/out.wav", "nfe_step": 16, "speed": 1.0}

Every response is `{"ok": true, ...}` or `{"ok": false, "error": "...", "type": "..."}`. **A failure
never becomes a silent success**: if the checkpoint is missing, the reference audio is unreadable or
the model produces no samples, the response says which, and no file is written.

WHY THIS IS A LONG-LIVED PROCESS AND NOT A SCRIPT PER REQUEST

Loading F5-TTS reads a 1.35 GB checkpoint, builds a 335 M-parameter DiT and moves it onto the device.
That is tens of seconds of pure overhead. Doing it per request would dwarf the synthesis itself, and
**a service that takes two minutes before it starts speaking is a service nobody uses.** So the model
is loaded once, on `load`, and kept.

STDOUT IS THE PROTOCOL

All library chatter — `transformers` warnings, F5-TTS's own `print` calls, progress bars — is
redirected to stderr in `main()`. **A stray `print` from a dependency would otherwise be read as a
protocol frame**, and the service would fail with a JSON decode error that named nothing real.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import traceback
import unicodedata
from pathlib import Path

# ---------------------------------------------------------------------------
# Take the protocol stream PRIVATE, before any third-party import can print on it.
#
# This has to happen here and not lower down. `f5_tts` prints at import and at call time — measured:
# `vocab :`, `token :`, `model :`, and a blank line, all on stdout — so a swap performed after the imports
# would already have lost the race. `sys.stdout` becomes stderr for the whole process, and frames go out
# through the handle below.
# ---------------------------------------------------------------------------
_PROTOCOL_STDOUT = sys.stdout
sys.stdout = sys.stderr


# --- Make `f5_compat` and the venv importable regardless of the caller's working directory. ---
sys.path.insert(0, str(Path(__file__).resolve().parent))

# Matplotlib writes a font cache on first import and refuses a cache dir it does not own, so it must
# be pointed somewhere writable **before** anything imports it (f5_tts imports it at module scope).
_CACHE = Path(os.environ.get("OZIKORO_MEDIA_CACHE_DIR", Path(__file__).resolve().parents[3] / ".tools/mplcache"))
_CACHE.mkdir(parents=True, exist_ok=True)
os.environ.setdefault("MPLCONFIGDIR", str(_CACHE))

# **The Hugging Face cache must live inside the repository.** Its default, `~/.cache/huggingface`, is
# outside the working tree and this environment refuses the write with
#
#     PermissionError: [Errno 1] Operation not permitted: '/Users/nzeora/.cache/huggingface'
#
# which surfaces as a model-download failure and reads like a network problem rather than a policy one.
# Setting `HF_HOME` before `huggingface_hub` is imported is what makes the difference; afterwards it
# has already captured the default.
_HF_CACHE = Path(os.environ.get("OZIKORO_MEDIA_HF_HOME", Path(__file__).resolve().parents[3] / ".tools/hf-cache"))
_HF_CACHE.mkdir(parents=True, exist_ok=True)
os.environ.setdefault("HF_HOME", str(_HF_CACHE))

import f5_compat  # noqa: E402  (must run before f5_tts)

f5_compat.install()

import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402
import torch  # noqa: E402
from f5_tts.infer.utils_infer import (  # noqa: E402
    infer_process,
    load_model,
    load_vocoder,
    preprocess_ref_audio_text,
)
from f5_tts.model import DiT  # noqa: E402

# The base model. **Not fine-tuned for Igbo** — see docs/ for what that means for this archive.
DEFAULT_MODEL = "F5TTS_Base"
DEFAULT_CKPT_STEP = 1200000
DEFAULT_NFE_STEP = 16

state: dict = {
    "model": None,
    "vocoder": None,
    "device": None,
    "model_name": None,
    "loaded": False,
    "vocab": None,
}


def log(*args) -> None:
    """Progress goes to stderr; stdout is reserved for protocol frames."""
    print(*args, file=sys.stderr, flush=True)


# --- The protocol's own stdout, captured at the top of the file before anything could print. ---


def emit(frame: dict) -> None:
    """
    Write one protocol frame on the REAL stdout, whatever has happened to `sys.stdout` since.

    WHY THIS IS NOT `print(..., file=sys.stdout)`

    The module docstring has always claimed that library chatter is redirected to stderr so a stray print
    cannot be read as a protocol frame. **It was not true, and the measurement is that it was not true by
    eleven lines.** Loading the model emits, on stdout:

        (blank)
        vocab :  .tools/models/F5TTS_Base/vocab.txt
        token :  custom
        model :  .tools/models/F5TTS_Base/model_1200000.safetensors
        ...

    Those come from inside `f5_tts.infer.utils_infer` itself, which prints at module and function scope —
    so no amount of care at the *call site* can stop them. The fix is to swap `sys.stdout` for stderr for
    the whole process, so anything that prints anywhere lands in stderr, and to keep a private handle to
    the original descriptor for the frames that are genuinely protocol.

    The TypeScript side already tolerates this — `#onLine` skips a line that does not parse as JSON rather
    than mistaking it for a reply — **and that tolerance is why this was invisible rather than fatal.**
    Tolerating corruption and preventing it are different things, and only the second one keeps working
    when a library prints something that happens to be valid JSON.
    """
    _PROTOCOL_STDOUT.write(json.dumps(frame) + "\n")
    _PROTOCOL_STDOUT.flush()


# ---------------------------------------------------------------------------
# Text preparation
# ---------------------------------------------------------------------------


def load_vocab() -> set[str]:
    """The character set the checkpoint can actually emit tokens for."""
    from importlib.resources import files

    if state["vocab"] is None:
        text = files("f5_tts").joinpath("infer/examples/vocab.txt").read_text(encoding="utf-8")
        state["vocab"] = set(text)
    return state["vocab"]


# The letters of the Igbo alphabet that carry a mark changing WHICH LETTER it is — as opposed to a tone
# mark, which changes the word but not the segment. Named once so `prepare_text` can report how many
# survived instead of asserting that they did.
IGBO_LETTERS = frozenset("ịọụṅẹṣ" "ỊỌỤṄẸṢ")


def prepare_text(text: str) -> dict:
    """
    Normalise Igbo orthography to the form the model's vocabulary actually contains, and report exactly
    what was changed.

    WHAT WAS MEASURED, AND WHY THIS IS NOT SPECULATION

    F5-TTS's bundled vocabulary holds 2,546 tokens / 1,220 distinct characters. Checking the Igbo
    letters against it:

        ị U+1ECB  PRESENT       ọ U+1ECD  PRESENT       ụ U+1EE5  PRESENT       ṅ U+1E45  PRESENT
        à á è é ì í ò ó ù ú     PRESENT
        U+0323 (combining dot below)    ABSENT
        U+0300 (combining grave)        ABSENT

    So **the model knows the precomposed Igbo letters but not the combining marks.** The same word
    written two legitimate Unicode ways therefore behaves completely differently:

        'i' + U+0323   → the combining mark is out of vocabulary
        'ị' U+1ECB     → a known token

    `unicodedata.normalize("NFC", ...)` composes the first into the second wherever a precomposed form
    exists. It does not exist for everything: **`ụ̀` (u-dot-below + grave) has no single code point**,
    so NFC cannot help and the combining grave remains out of vocabulary.

    That case is not silently dropped. The mark is removed — a tone mark, whose absence changes a word's
    meaning but not its segmental shape — and **every removal is listed in `stripped_marks` in the
    response**, so the record can say the tone was not spoken.

    ═══════════════════════════════════════════════════════════════════════════════════════════════════
    THE BUG THIS REPLACED, AND IT WAS THE OWNER'S OWN COMPLAINT MADE IN CODE
    ═══════════════════════════════════════════════════════════════════════════════════════════════════

    The first version of this function decomposed the WHOLE string with NFD and then tested each resulting
    character against the vocabulary. That looks equivalent to composing first. **It is not, and the
    difference is the entire Igbo alphabet:**

        unicodedata.normalize("NFD", "ụ")  ->  ['u' (U+0075), U+0323]

    `u` IS in the vocabulary, so it was kept; `U+0323` (the dot below) is NOT, and it is in `REMOVABLE`, so
    it was **stripped**. The result is that `ụ` became `u`, `ị` became `i`, and `ọ` became `o` — **the
    precomposed letters were decomposed by this function and then had their distinguishing mark deleted by
    it**, one instruction after the docstring promised "no stripping of the dot-below letters".

    Measured, before the fix, on the first real synthesis this service ever ran:

        in    "Ndeewo, aha m bụ Ozikoro."
        out   "Ndeewo, aha m bu Ozikoro."      stripped_marks: ['U+0323']

    `bụ` is not `bu`. The dot below is a different LETTER, and this is exactly the class of fault the owner
    heard and asked to have fixed: *"check ozituma.com automatically on how igbo words are pronounced to
    avoid it being pronounced wrongly."* **No lexicon can repair it**, because the damage happened after the
    lexicon had done its job correctly and before the model ever saw the word.

    THE FIX, AND WHY IT IS AT THIS LEVEL

    A character is tested against the vocabulary **in its composed (NFC) form, first**. Only if the composed
    character is unknown is that single character decomposed, and only then can a combining mark be removed.
    So `ụ` (U+1EE5, a known token) is kept whole, and `ụ̀` — which has NO single code point — still yields
    `ụ` + a removable grave. That is the behaviour the docstring always described.
    """
    original = text
    nfc = unicodedata.normalize("NFC", text)

    vocab = load_vocab()
    stripped: list[str] = []
    unknown: list[str] = []
    case_folded: list[str] = []

    # The combining marks whose only job is tone or letter-identity, and which have no precomposed form in
    # the cases that reach step 3. U+0323 is here for `ụ̀`-style stacks; it is never reached for a plain
    # `ụ`, because step 1 keeps that whole.
    REMOVABLE = "\u0300\u0301\u0323"

    out_chars: list[str] = []
    for ch in nfc:
        # 1. The composed character IS a token the model knows. Keep it whole — this is the branch `ụ`, `ị`,
        #    `ọ`, `ṅ` and the precomposed tone vowels take. **This branch is the fix.**
        if ch in vocab:
            out_chars.append(ch)
            continue

        # 2. Not a known token — but its LOWERCASE might be. Measured: the vocabulary holds `ị` U+1ECB and
        #    `ọ` U+1ECD but NOT `Ị` U+1ECA or `Ọ` U+1ECC, so a sentence beginning "Ọ dị mma" lost the dot on
        #    the first letter of a record's opening line. Falling back to the lowercase form **keeps the
        #    letter** where the alternative keeps only its base, and case carries no phonetic weight in a
        #    reading. Reported, because it is a change to the text the model was given.
        lower = ch.lower()
        if lower != ch and lower in vocab:
            out_chars.append(lower)
            case_folded.append(ch)
            continue

        # 3. Decompose THIS character only, so a mark that has no precomposed home can be handled without
        #    disturbing any character that did.
        parts = unicodedata.normalize("NFD", ch)
        if len(parts) == 1:
            # A lone combining mark (`ù` arriving already-composed as `ụ` plus U+0300, which is how a
            # tone stack normally reaches here). It belongs in `stripped_marks`, not `out_of_vocab` — "a tone
            # was not spoken" and "a character was unknown" are different reports, and only the first is
            # expected for Igbo text.
            if ch in REMOVABLE:
                stripped.append(ch)
            else:
                unknown.append(ch)
            continue
        for sub in parts:
            if sub in vocab:
                out_chars.append(sub)
            elif sub in REMOVABLE:
                stripped.append(sub)
            else:
                unknown.append(sub)

    result = unicodedata.normalize("NFC", "".join(out_chars))

    return {
        "text": result,
        "changed": result != original,
        "stripped_marks": sorted(set(stripped)),
        # Characters in neither the vocabulary nor the removable set — reported, never silently dropped.
        "out_of_vocab": sorted(set(unknown)),
        "vocab_size": len(vocab),
        # The letters this function exists to protect, echoed back so the response is itself the evidence
        # that they survived. A render that reports `igbo_letters_kept: []` for Igbo text has a bug.
        "igbo_letters_kept": sorted({c for c in result if c in IGBO_LETTERS}),
        # Capital marked letters that were folded to their lowercase form because the capital is not a token
        # the checkpoint knows. Empty is the normal case for a text that does not open on `Ọ` or `Ị`.
        "case_folded": sorted(set(case_folded)),
    }


# ---------------------------------------------------------------------------
# Model
# ---------------------------------------------------------------------------


def resolve_checkpoint(model_name: str, step: int) -> tuple[str, str]:
    """
    Return `(ckpt_path, vocab_path)`, preferring a checkpoint already on this disk.

    **Local first, and that is a correction rather than an optimisation.** The base F5-TTS weights are
    **CC-BY-NC-4.0**, so they are fetched from the official repository and never vendored into this
    repository — that part is unchanged. But the first version made `hf_hub_download` the *only* path, and
    the download is the fragile part:

      * `hf_hub_download` on this machine went through the `hf_xet` fast-transfer path and **truncated a
        partially-fetched 268 MB blob to zero bytes and restarted it**, with no error and no progress on
        stdout — the cache went from 256 MB to 120 KB between two consecutive reads of it;
      * a 1.35 GB fetch that cannot be resumed by hand and prints nothing is not something a service should
        depend on to start;
      * and once the weights are on disk there is no reason to touch the network at all.

    So a checkpoint under `.tools/models/<model>/` is used directly and the Hub is the fallback for a fresh
    machine. `OZIKORO_MEDIA_MODEL_DIR` moves it. `.tools/` is ignored by git, so the weights are still never
    committed.
    """
    local_dir = Path(
        os.environ.get(
            "OZIKORO_MEDIA_MODEL_DIR",
            str(Path(__file__).resolve().parents[3] / ".tools" / "models" / model_name),
        )
    )
    local_ckpt = local_dir / f"model_{step}.safetensors"
    local_vocab = local_dir / "vocab.txt"
    if local_ckpt.exists() and local_vocab.exists():
        log(f"using the checkpoint on disk: {local_ckpt}")
        return str(local_ckpt), str(local_vocab)
    if local_ckpt.exists() and not local_vocab.exists():
        log(f"{local_ckpt} is present but its vocab.txt is not; falling back to the Hub")

    from huggingface_hub import hf_hub_download

    repo = "SWivid/F5-TTS"
    ckpt = hf_hub_download(repo_id=repo, filename=f"{model_name}/model_{step}.safetensors")
    vocab = hf_hub_download(repo_id=repo, filename=f"{model_name}/vocab.txt")
    return ckpt, vocab


def mps_usable() -> tuple[bool, str]:
    """
    Whether the MPS backend can actually run this model — **asked by running the operation, not by asking
    the flag.**

    THE BUG THIS EXISTS TO FIX, MEASURED ON THIS MACHINE

    `torch.backends.mps.is_available()` returns **True** on this Intel Mac (an i7-7820HQ, `uname -m`
    `x86_64`, `torch 2.2.2`, `is_built() True`), and the first version of `load()` therefore selected
    `mps`. The model loaded — thirty seconds of it, on the wrong device — and then synthesis died:

        NotImplementedError: The operator 'aten::_fft_r2c' is not currently implemented for the MPS
        device.

    `torch.stft` is the first thing the vocoder does. **So the flag was true, the device was unusable, and
    the failure arrived a minute later, at synthesis, looking like a model bug.** That is the worst shape a
    fault can have: correct-looking code, a plausible device, and an error that names an operator instead
    of the wrong choice that selected it.

    `PYTORCH_ENABLE_MPS_FALLBACK=1` is the documented workaround and it is **not** used here: it silently
    moves individual operators to the CPU, so a "GPU" render becomes an unpredictable mix of devices with
    per-tensor copies between them, and a mismatch surfaces as a confusing dtype error rather than a slow
    render. Choosing the CPU once and saying so is honest and predictable.

    The probe is the real operation on a tiny tensor, so it stays correct if a future torch implements
    `_fft_r2c` for MPS.
    """
    if not torch.backends.mps.is_available():
        return False, "mps is not available"
    try:
        # **The tensor has to be ON the mps device.** The first version of this probe built a CPU tensor
        # and called `torch.stft` on it, so it ran on the CPU, succeeded, and returned "mps is available and
        # can run stft" — and synthesis then failed with the very error the probe existed to catch. A probe
        # that does not run the operation on the device it is testing tests nothing, and its success is
        # worse than no probe at all because it is quoted as evidence.
        n_fft, hop = 1024, 256
        probe = torch.zeros(n_fft * 2, device="mps")
        window = torch.hann_window(n_fft, device="mps")
        torch.stft(probe, n_fft=n_fft, hop_length=hop, window=window, return_complex=True)
        return True, "mps is available and can run stft"
    except NotImplementedError as exc:
        return False, f"mps is present but cannot run the model's stft: {str(exc).splitlines()[0]}"
    except Exception as exc:  # noqa: BLE001 - any failure here means "do not use mps"
        return False, f"mps probe failed: {type(exc).__name__}: {exc}"


def choose_device(requested: str | None) -> tuple[str, str]:
    """The device to load on, and the sentence explaining why — so `/health` never has to guess."""
    if requested:
        return requested, f"'{requested}' was requested explicitly"
    if torch.cuda.is_available():
        return "cuda", "cuda is available"
    usable, why = mps_usable()
    if usable:
        return "mps", why
    if torch.backends.mps.is_available():
        # Worth naming loudly: the flag said yes and the answer is no, which is the confusing case.
        log(f"NOT using mps — {why}")
    return "cpu", f"cpu: {why}"


def load(model_name: str = DEFAULT_MODEL, ckpt_step: int = DEFAULT_CKPT_STEP, device: str | None = None) -> dict:
    from importlib.resources import files

    import yaml

    device, why = choose_device(device)

    arch = yaml.safe_load(
        files("f5_tts").joinpath(f"configs/{model_name}.yaml").read_text(encoding="utf-8")
    )["model"]["arch"]
    model_cfg = {k: arch[k] for k in ("dim", "depth", "heads", "ff_mult", "text_dim", "conv_layers")}

    log(f"loading {model_name} (ckpt step {ckpt_step}) on {device} — {why}")
    ckpt_path, vocab_path = resolve_checkpoint(model_name, ckpt_step)
    log(f"checkpoint: {ckpt_path}")

    # attn_backend "torch" is required: the default flash-attention path has no Intel-macOS wheel.
    model = load_model(
        DiT,
        model_cfg,
        ckpt_path,
        mel_spec_type="vocos",
        vocab_file=vocab_path,
        device=device,
    )
    vocoder = load_vocoder(vocoder_name="vocos", device=device)

    state.update(
        model=model, vocoder=vocoder, device=device, model_name=model_name, loaded=True, vocab=None
    )
    return {
        "model": model_name,
        "device": device,
        "device_reason": why,
        "checkpoint": ckpt_path,
        "vocab_file": vocab_path,
    }


# ---------------------------------------------------------------------------
# Synthesis
# ---------------------------------------------------------------------------


def synth(req: dict) -> dict:
    if not state["loaded"]:
        return {"ok": False, "type": "not_loaded", "error": "model not loaded; send {'cmd':'load'} first"}

    text = req.get("text") or ""
    if not text.strip():
        return {"ok": False, "type": "empty_text", "error": "no text to speak"}

    ref_audio = req.get("ref_audio")
    if not ref_audio or not Path(ref_audio).exists():
        return {"ok": False, "type": "missing_reference_audio", "error": f"reference audio not found: {ref_audio}"}

    ref_text = req.get("ref_text")
    if ref_text is None:
        return {
            "ok": False,
            "type": "missing_reference_transcript",
            "error": (
                "no reference transcript supplied. F5-TTS conditions on the words in the reference clip, "
                "so the service must know what the speaker is saying; it cannot be guessed without an ASR "
                "model, and guessing would mis-tune the voice."
            ),
        }

    out = req.get("out")
    if not out:
        return {"ok": False, "type": "missing_output", "error": "no output path supplied"}

    prepared = prepare_text(text)
    if not prepared["text"].strip():
        return {
            "ok": False,
            "type": "text_empty_after_preparation",
            "error": "every character was out of vocabulary; nothing to speak",
            "out_of_vocab": prepared["out_of_vocab"],
        }

    nfe_step = int(req.get("nfe_step") or DEFAULT_NFE_STEP)
    speed = float(req.get("speed") or 1.0)

    # `preprocess_ref_audio_text` calls pydub, which needs ffmpeg for compressed formats. WAV needs no
    # external binary, which is why the service converts to 24 kHz mono WAV on registration.
    ref_audio_processed, ref_text_processed = preprocess_ref_audio_text(
        ref_audio, ref_text, show_info=lambda *a, **k: log("[ref]", *a)
    )

    with torch.inference_mode():
        wav, sr, _ = infer_process(
            ref_audio_processed,
            ref_text_processed,
            prepared["text"],
            state["model"],
            state["vocoder"],
            mel_spec_type="vocos",
            show_info=lambda *a, **k: log("[infer]", *a),
            nfe_step=nfe_step,
            speed=speed,
            device=state["device"],
        )

    if wav is None:
        return {
            "ok": False,
            "type": "no_audio_produced",
            "error": "the model returned no samples for this input; nothing was written",
        }

    audio = np.asarray(wav)
    if audio.size == 0:
        return {"ok": False, "type": "empty_audio", "error": "the model returned zero samples"}

    out_path = Path(out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(out_path), audio, sr, subtype="PCM_16")

    peak = float(np.max(np.abs(audio)))
    rms = float(np.sqrt(np.mean(audio**2)))
    return {
        "ok": True,
        "out": str(out_path),
        "sample_rate": int(sr),
        "samples": int(audio.size),
        "duration_seconds": round(float(audio.size) / float(sr), 3),
        "byte_size": out_path.stat().st_size,
        "peak": round(peak, 6),
        "rms": round(rms, 6),
        # **Silence is reported, not treated as success.** A digital-silence file is the classic
        # failure of an over-trained or unhappy flow-matching model, and it plays as a working file.
        "silent": bool(rms < 1e-4),
        "prepared_text": prepared["text"] if prepared["changed"] else None,
        "stripped_marks": prepared["stripped_marks"],
        "out_of_vocab": prepared["out_of_vocab"],
        "nfe_step": nfe_step,
        "speed": speed,
    }


# ---------------------------------------------------------------------------
# Loop
# ---------------------------------------------------------------------------


def handle(req: dict) -> dict:
    cmd = req.get("cmd")
    try:
        if cmd == "load":
            info = load(
                req.get("model") or DEFAULT_MODEL,
                int(req.get("ckpt_step") or DEFAULT_CKPT_STEP),
                req.get("device"),
            )
            return {"ok": True, **info, "accelerators": accelerators()}
        if cmd == "synth":
            return synth(req)
        if cmd == "ping":
            return {"ok": True, "loaded": state["loaded"], "model": state["model_name"]}
        return {"ok": False, "type": "unknown_command", "error": f"unknown cmd: {cmd!r}"}
    except Exception as exc:  # noqa: BLE001 - the protocol must answer for every failure
        log(traceback.format_exc())
        return {
            "ok": False,
            "type": type(exc).__name__,
            "error": str(exc),
            "traceback": traceback.format_exc().splitlines()[-6:],
        }


def accelerators() -> dict:
    return {
        "cuda": bool(torch.cuda.is_available()),
        "mps": bool(torch.backends.mps.is_available()),
        "device_count": int(torch.cuda.device_count()),
        "torch": torch.__version__,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Ozikoro Media — F5-TTS worker")
    parser.add_argument("--preload", action="store_true", help="load the model before answering anything")
    args = parser.parse_args()

    if args.preload:
        emit(handle({"cmd": "load"}))

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError as exc:
            emit({"ok": False, "type": "bad_frame", "error": str(exc)})
            continue
        emit(handle(req))
    return 0


if __name__ == "__main__":
    sys.exit(main())
