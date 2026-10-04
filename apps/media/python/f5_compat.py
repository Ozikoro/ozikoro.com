"""
Everything F5-TTS needs in order to be *imported and run for inference* on Intel macOS.

There are two independent problems, and both are solved by removing a dependency that inference
never executes — not by faking a capability.

1. `librosa` → `numba` → `llvmlite`. F5-TTS imports exactly one symbol, `librosa.filters.mel`.
   `librosa/filters.py` imports numba at module scope, and numba needs llvmlite, which publishes no
   wheel for Intel macOS on Python 3.11 — so pip tries to compile it against LLVM and fails hard.
   `mel()` is transcribed exactly (see `librosa_shim.py`, and the numeric check it carries).

2. `f5_tts.model.trainer` → `wandb` and `f5_tts.model.dataset` → `datasets`. `f5_tts/model/__init__.py`
   imports `Trainer` eagerly, so an inference-only import drags in the training stack. This process
   **never constructs a Trainer and never calls a training method**; the two names the trainer module
   would need at module scope are supplied by a stub that refuses to do anything.

WHAT IS *NOT* DONE HERE

No model is mocked, no weights are faked, no output is synthesised. `torch`, `torchaudio`,
`transformers`, `vocos` and `f5_tts` itself are all real and unmodified on disk: the only change is
which modules are reachable in `sys.modules` for this process. **Nothing in this file can make a
model produce audio it would not otherwise produce** — if the weights cannot be loaded, this still
fails, loudly.

`install()` MUST be called before `f5_tts` is imported by anything.
"""

from __future__ import annotations

import sys
import types

import librosa_shim

__all__ = ["install"]


def _module(name: str) -> types.ModuleType:
    """A well-formed empty module, with a real spec so `importlib.util.find_spec` can answer for it."""
    from importlib.machinery import ModuleSpec

    module = types.ModuleType(name)
    module.__spec__ = ModuleSpec(name, loader=None)
    return module


def _install_trainer_stub() -> None:
    """
    Register stubs for `wandb`, `datasets`, `f5_tts.model.trainer` and `f5_tts.model.dataset`.

    `trainer` and `dataset` are replaced wholesale rather than only their third-party dependencies,
    because `dataset.py` is the only thing that wants `datasets` and nothing in the inference path
    wants `dataset.py`. Replacing two training modules is a smaller intervention than installing
    `datasets` (which pulls pyarrow and a large tree to serve code that will not run).
    """
    if "f5_tts.model.trainer" in sys.modules:
        return

    # --- the SDK the trainer would log to ---
    wandb = _module("wandb")
    wandb_api = types.SimpleNamespace(api_key=None)  # `if logger == "wandb" and not wandb.api.api_key`

    def _refuse(what: str):
        def _call(*args, **kwargs):
            raise RuntimeError(
                f"Ozikoro loads F5-TTS for inference only; `wandb.{what}` is not available. "
                "Training is not supported by this service."
            )

        return _call

    wandb.api = wandb_api  # type: ignore[attr-defined]
    for name in ("init", "log", "finish"):
        setattr(wandb, name, _refuse(name))
    sys.modules.setdefault("wandb", wandb)

    # --- the dataset library the training loop would read corpora with ---
    sys.modules.setdefault("datasets", _module("datasets"))

    # --- the training modules themselves, with the names `f5_tts.model.__init__` imports ---
    def _not_supported(*args, **kwargs):
        raise RuntimeError(
            "Ozikoro loads F5-TTS for inference only. This is the training entry point and it is "
            "deliberately unavailable; run training from an F5-TTS checkout instead."
        )

    class Trainer:  # noqa: D101 - name and signature exist so the import in __init__ resolves
        def __init__(self, *args, **kwargs):
            _not_supported()

    trainer = _module("f5_tts.model.trainer")
    trainer.Trainer = Trainer  # type: ignore[attr-defined]
    sys.modules["f5_tts.model.trainer"] = trainer

    dataset = _module("f5_tts.model.dataset")
    dataset.DynamicBatchSampler = _not_supported  # type: ignore[attr-defined]
    dataset.collate_fn = _not_supported  # type: ignore[attr-defined]
    sys.modules["f5_tts.model.dataset"] = dataset


def _install_xpu_stub() -> None:
    """
    Give `torch` a `torch.xpu` namespace whose `is_available()` is False.

    `f5_tts/infer/utils_infer.py` picks a device at module scope:

        device = ("cuda" if torch.cuda.is_available()
                  else "xpu" if torch.xpu.is_available()
                  else "mps" if torch.backends.mps.is_available()
                  else "cpu")

    `torch.xpu` was added with Intel-GPU support in torch 2.5. **This machine's newest installable
    torch is 2.2.2, because PyTorch publishes no Intel-macOS wheel after that release.** So the
    attribute is simply absent and the import dies at module scope, before anything is loaded.

    This is not a workaround for a capability: there is no Intel XPU in this machine, so `False` is
    the true answer that torch would give if the namespace existed. It is `False` on every machine
    this service is expected to run on. The real accelerator decision is made by the service, which
    reports `torch.cuda.is_available()` and `torch.backends.mps.is_available()` from /health and
    passes an explicit device to every inference call.
    """
    import torch

    if getattr(torch, "xpu", None) is not None:
        return

    from importlib.machinery import ModuleSpec

    xpu = types.ModuleType("torch.xpu")
    xpu.__spec__ = ModuleSpec("torch.xpu", loader=None)
    xpu.is_available = lambda: False  # type: ignore[attr-defined]
    xpu.device_count = lambda: 0  # type: ignore[attr-defined]
    torch.xpu = xpu  # type: ignore[attr-defined]
    sys.modules.setdefault("torch.xpu", xpu)


def install() -> None:
    """Make `f5_tts.infer.utils_infer` importable. Call this before importing f5_tts."""
    librosa_shim.install()
    _install_trainer_stub()
    _install_xpu_stub()
