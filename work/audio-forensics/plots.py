"""The two figures for round 313: the noise bed, and the join.

    .tools/tts-venv/bin/python work/audio-forensics/plots.py

The owner's own recording is NOT committed — it is his media. This reads it from the
attachment it was supplied as, and falls back to a copy beside this script if one is
there, so the figure can be regenerated without the repository carrying his audio.
"""
import io
import os

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import soundfile as sf
from scipy import signal as sps

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
SR = 44100
OWNER = next((p for p in (
    os.path.join(HERE, "owner-reference.mp3"),
    "/Users/nzeora/.dsh/attachments/v1/files/78/78cefb7fe022b2d36d35c1fa8e3663ef7f84550d876228d1f1eff8208da08f9a/Ute Okpu 2.mp3",
) if os.path.exists(p)), None)
EP = os.path.join(ROOT, ".data/media/ozikoro/episodes")


def load(path):
    y, _ = sf.read(io.BytesIO(open(path, "rb").read()), dtype="float32", always_2d=False)
    return y.mean(axis=1) if y.ndim > 1 else y


def spec(ax, y, t0, t1, title):
    seg = y[int(t0 * SR):int(t1 * SR)]
    if len(seg) < 2048:
        return
    ax.specgram(seg, NFFT=2048, Fs=SR, noverlap=1024, cmap="magma", vmin=-120, vmax=-20, scale="dB")
    ax.set_title(title, fontsize=8)
    ax.set_ylabel("Hz", fontsize=7)
    ax.tick_params(labelsize=6)


def main():
    g = load(os.path.join(EP, "ute-okpu-an-ika-igbo-clan-and-its-nri-roots.mp3"))
    fig, axes = plt.subplots(4, 2, figsize=(15, 11))
    if OWNER:
        o = load(OWNER)
        spec(axes[0, 0], o, 0, 30, "OWNER 0-30s (the recording that is clean)")
        spec(axes[1, 0], o, 250, 290, "OWNER 250-290s")
        spec(axes[2, 0], o, 600, 630, "OWNER 600-630s")
        for i, (t0, t1, lab) in enumerate([(600, 660, "OWNER 600-660s")]):
            f, P = sps.welch(o[int(t0 * SR):int(t1 * SR)], SR, nperseg=16384)
            axes[3, 0].semilogx(f, 10 * np.log10(P + 1e-20), lw=0.6)
            axes[3, 0].set_xlim(20, 20000); axes[3, 0].set_ylim(-140, -20)
            axes[3, 0].set_title(lab + " (Welch PSD)", fontsize=8); axes[3, 0].grid(alpha=.3)
    else:
        for r in range(4):
            axes[r, 0].text(.5, .5, "owner-reference.mp3 not found", ha="center", fontsize=8)

    spec(axes[0, 1], g, 0, 30, "GENERATED ute-okpu 0-30s")
    spec(axes[1, 1], g, 180, 210, "GENERATED 180-210s")
    spec(axes[2, 1], g, 460, 490, "GENERATED 460-490s (the bed alone)")
    f, P = sps.welch(g[460 * SR:500 * SR], SR, nperseg=16384)
    axes[3, 1].semilogx(f, 10 * np.log10(P + 1e-20), lw=0.6)
    axes[3, 1].set_xlim(20, 20000); axes[3, 1].set_ylim(-140, -20)
    axes[3, 1].set_title("GENERATED 460-500s (Welch PSD)", fontsize=8); axes[3, 1].grid(alpha=.3)

    plt.tight_layout()
    plt.savefig(os.path.join(HERE, "spectrograms.png"), dpi=80)
    print("wrote spectrograms.png")

    # The folklore join, which is the only real one, and which sits past where decoders stop.
    fol = load(os.path.join(EP, "igbo-folklore-twelve-timeless-tales-of-wisdom-wonder-and-moral-heritage.mp3"))
    fig2, ax2 = plt.subplots(2, 1, figsize=(14, 6))
    tail = 2 * SR
    ax2[0].plot(np.arange(-tail, 0) / SR, fol[len(fol) - tail:len(fol)], lw=.3)
    ax2[0].set_title("folklore: the last two seconds of DECODED audio — the join is past here, never reached",
                     fontsize=8)
    ax2[0].set_xlabel("seconds before the end", fontsize=7)
    ax2[0].grid(alpha=.3)
    if OWNER:
        o = load(OWNER)
        ax2[1].plot(np.arange(-tail, 0) / SR, o[len(o) - tail:len(o)], lw=.3, color="g")
        ax2[1].set_title("OWNER: the same last two seconds", fontsize=8)
        ax2[1].set_xlabel("seconds before the end", fontsize=7)
        ax2[1].grid(alpha=.3)
    plt.tight_layout()
    plt.savefig(os.path.join(HERE, "seam-zoom.png"), dpi=80)
    print("wrote seam-zoom.png")


if __name__ == "__main__":
    main()
