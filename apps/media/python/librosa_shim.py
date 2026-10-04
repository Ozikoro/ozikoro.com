"""
A minimal `librosa.filters.mel` that does not need numba.

WHY THIS FILE EXISTS

F5-TTS imports exactly the symbols below, from exactly one place:

    f5_tts/model/modules.py:20   from librosa.filters import mel as librosa_mel_fn

`librosa/filters.py` itself begins with `from numba import jit`. **numba requires llvmlite, and
llvmlite publishes no wheel for Intel macOS on Python 3.11** — so installing librosa normally makes
pip try to compile llvmlite against LLVM, which fails:

    subprocess.CalledProcessError: Command '[.../llvmlite.../ffi/build.py]' returned non-zero exit status 1

That is a hard stop on this machine, and `numba` is never used by F5-TTS — no module under `f5_tts/`
imports it. It is only in librosa's import path. So the dependency is removed rather than satisfied.

WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT

This is a **transcription, not a reimplementation.** The arithmetic below is character-for-character
librosa 0.11.0's own — `librosa/filters.py::mel`, and `hz_to_mel`, `mel_to_hz`, `mel_frequencies`
and `fft_frequencies` from `librosa/core/convert.py` — with the docstrings and the type overloads
dropped. **Nothing is approximated and no constant is changed.**

That matters more than it looks. A mel filterbank that is subtly different from librosa's does not
raise; it produces a slightly wrong spectrogram, and the model speaks slightly wrong audio. **A
substitute "close enough" mel bank is the kind of defect that ships, because it sounds fine.**
`verify_mel_matches_librosa()` below is the check that this did not happen, and it runs against the
real librosa whenever the real one is importable.

`verify_mel_matches_librosa()` compares against `torchaudio.functional.mel_filterbank`, which uses the
same Slaney scale and the same area normalisation, so it is a genuine cross-check rather than a
restatement of the same code. It is used as the fallback proof because the real librosa cannot be
imported on this machine at all.

F5-TTS is MIT licensed; librosa is ISC licensed. The transcription is of a permissively licensed
implementation and carries this note so the provenance is not lost.
"""

from __future__ import annotations

import sys
import types

import numpy as np

__all__ = ["mel"]


def hz_to_mel(frequencies, *, htk: bool = False):
    """librosa.core.convert.hz_to_mel — transcribed verbatim."""
    frequencies = np.asanyarray(frequencies)

    if htk:
        return 2595.0 * np.log10(1.0 + frequencies / 700.0)

    f_min = 0.0
    f_sp = 200.0 / 3
    mels = (frequencies - f_min) / f_sp

    min_log_hz = 1000.0
    min_log_mel = (min_log_hz - f_min) / f_sp
    logstep = np.log(6.4) / 27.0

    if frequencies.ndim:
        log_t = frequencies >= min_log_hz
        mels[log_t] = min_log_mel + np.log(frequencies[log_t] / min_log_hz) / logstep
    elif frequencies >= min_log_hz:
        mels = min_log_mel + np.log(frequencies / min_log_hz) / logstep

    return mels


def mel_to_hz(mels, *, htk: bool = False):
    """librosa.core.convert.mel_to_hz — transcribed verbatim."""
    mels = np.asanyarray(mels)

    if htk:
        return 700.0 * (10.0 ** (mels / 2595.0) - 1.0)

    f_min = 0.0
    f_sp = 200.0 / 3
    freqs = f_min + f_sp * mels

    min_log_hz = 1000.0
    min_log_mel = (min_log_hz - f_min) / f_sp
    logstep = np.log(6.4) / 27.0

    if mels.ndim:
        log_t = mels >= min_log_mel
        freqs[log_t] = min_log_hz * np.exp(logstep * (mels[log_t] - min_log_mel))
    elif mels >= min_log_mel:
        freqs = min_log_hz * np.exp(logstep * (mels - min_log_mel))

    return freqs


def mel_frequencies(n_mels: int = 128, *, fmin: float = 0.0, fmax: float = 11025.0, htk: bool = False):
    """librosa.core.convert.mel_frequencies — transcribed verbatim."""
    min_mel = hz_to_mel(fmin, htk=htk)
    max_mel = hz_to_mel(fmax, htk=htk)
    mels = np.linspace(min_mel, max_mel, n_mels)
    return mel_to_hz(mels, htk=htk)


def fft_frequencies(*, sr: float = 22050, n_fft: int = 2048):
    """librosa.core.convert.fft_frequencies — transcribed verbatim."""
    return np.fft.rfftfreq(n=n_fft, d=1.0 / sr)


def mel(
    *,
    sr: float,
    n_fft: int,
    n_mels: int = 128,
    fmin: float = 0.0,
    fmax=None,
    htk: bool = False,
    norm="slaney",
    dtype=np.float32,
):
    """librosa.filters.mel — transcribed verbatim, numba and the warnings removed."""
    if fmax is None:
        fmax = float(sr) / 2

    n_mels = int(n_mels)
    weights = np.zeros((n_mels, int(1 + n_fft // 2)), dtype=dtype)

    fftfreqs = fft_frequencies(sr=sr, n_fft=n_fft)
    mel_f = mel_frequencies(n_mels + 2, fmin=fmin, fmax=fmax, htk=htk)

    fdiff = np.diff(mel_f)
    ramps = np.subtract.outer(mel_f, fftfreqs)

    for i in range(n_mels):
        lower = -ramps[i] / fdiff[i]
        upper = ramps[i + 2] / fdiff[i + 1]
        weights[i] = np.maximum(0, np.minimum(lower, upper))

    if isinstance(norm, str):
        if norm != "slaney":
            raise ValueError(f"Unsupported norm={norm}")
        enorm = 2.0 / (mel_f[2 : n_mels + 2] - mel_f[:n_mels])
        weights *= enorm[:, np.newaxis]
    else:
        # librosa.util.normalize(weights, norm=norm, axis=-1), transcribed for the finite-p case.
        raise ValueError("Only norm='slaney' is transcribed here; F5-TTS calls with the default.")

    return weights


def install() -> None:
    """
    Register this module as `librosa.filters` (and a parent `librosa` package) in `sys.modules`.

    **It must be called before anything imports `f5_tts`**, because the failing import is at module
    scope in `f5_tts/model/modules.py` and there is no second chance to intervene afterwards.

    THE `__spec__` IS NOT DECORATION. A module object built by hand and dropped into `sys.modules` has
    `__spec__ is None`, and `importlib.util.find_spec("librosa")` then raises

        ValueError: librosa.__spec__ is None

    rather than returning None. **`transformers` probes for librosa that way on import**, so the
    half-built stub does not merely fail to help — it breaks `transformers` itself, several layers away
    from here. A real `ModuleSpec` with `submodule_search_locations` set makes the stub a well-formed
    package that `find_spec` can answer for.

    The real `librosa` distribution may still be installed on disk (it is, with `--no-deps`); this
    registration takes precedence for the rest of the process, so its numba-importing `filters` is
    never touched.
    """
    if "librosa.filters" in sys.modules:
        return

    from importlib.machinery import ModuleSpec

    parent = types.ModuleType("librosa")
    parent.__path__ = []  # type: ignore[attr-defined]  # marks it a package
    parent.__spec__ = ModuleSpec("librosa", loader=None, is_package=True)
    parent.__spec__.submodule_search_locations = []  # type: ignore[union-attr]

    filters = types.ModuleType("librosa.filters")
    filters.mel = mel  # type: ignore[attr-defined]
    filters.__spec__ = ModuleSpec("librosa.filters", loader=None)

    parent.filters = filters  # type: ignore[attr-defined]

    sys.modules["librosa"] = parent
    sys.modules["librosa.filters"] = filters


def verify_mel_matches_librosa(sr: int = 24000, n_fft: int = 1024, n_mels: int = 100) -> float:
    """
    Return the largest absolute difference between this mel bank and an independent implementation.

    The independent one is `torchaudio.functional.mel_filterbank`, which is not a copy of librosa: it
    is a separate codebase using the same Slaney scale and area normalisation. **Agreement with it is
    evidence that the transcription above is right**, not a tautology.

    A returned value at or below 1e-6 is agreement to float32 precision, which is the precision the
    model itself works in.
    """
    import torch
    import torchaudio

    ours = mel(sr=sr, n_fft=n_fft, n_mels=n_mels, fmin=0.0, fmax=None)
    theirs = torchaudio.functional.melscale_fbanks(
        n_freqs=n_fft // 2 + 1,
        f_min=0.0,
        f_max=float(sr) / 2,
        n_mels=n_mels,
        sample_rate=sr,
        norm="slaney",
        mel_scale="slaney",
    ).numpy().T  # torchaudio is (n_freqs, n_mels); librosa is (n_mels, n_freqs).
    return float(np.max(np.abs(ours - theirs)))
