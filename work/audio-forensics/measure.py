"""Measure the narration fault (b): the noise floor and the chunk seams.

ROUND 313. Every number in the round entry that is a level comes from here, so the
measurement can be repeated rather than believed.

    .tools/tts-venv/bin/python work/audio-forensics/measure.py

It needs the repository's own Python environment for the self-hosted engine, because
there is no ffmpeg, ffprobe, sox or PyAV on this machine and /usr/bin/afinfo cannot
see a noise floor. `.tools/tts-venv` has numpy, scipy and soundfile, and libsndfile
decodes MPEG Layer III directly, so nothing is resampled.

Method, stated because a level with no method is not a measurement:
  * decode to mono float32 at the file's own 44.1 kHz
  * frames: 50 ms window, 25 ms hop; frame level = RMS in dBFS
  * noise floor  = 10th percentile of frame levels over the whole file
  * speech level = 90th percentile of the same
  * the bed's shape = each band's share of 20 Hz-16 kHz energy
    across the 200 quietest frames
  * seams are located by the internal ID3v2 tag offsets, not guessed
"""
import io
import os
import re
import sys

import numpy as np
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
SR = 44100
WIN, HOP = int(0.050 * SR), int(0.025 * SR)
BANDS = [(20, 80), (80, 200), (200, 500), (500, 1000), (1000, 2000),
         (2000, 4000), (4000, 8000), (8000, 11000), (11000, 16000)]

FILES = {
    # The owner's own recording is HIS media and is deliberately not committed. It is read from the
    # attachment it was supplied as, or from a copy beside this script if one has been put there.
    "owner-ref": next(p for p in (
        os.path.join(HERE, "owner-reference.mp3"),
        "/Users/nzeora/.dsh/attachments/v1/files/78/78cefb7fe022b2d36d35c1fa8e3663ef7f84550d876228d1f1eff8208da08f9a/Ute Okpu 2.mp3",
    ) if os.path.exists(p)),
    "gen-ute-okpu": os.path.join(ROOT, ".data/media/ozikoro/episodes/ute-okpu-an-ika-igbo-clan-and-its-nri-roots.mp3"),
    "gen-tortoise": os.path.join(ROOT, ".data/media/ozikoro/episodes/how-tortoise-got-his-bumpy-shell.mp3"),
    "gen-folklore": os.path.join(ROOT, ".data/media/ozikoro/episodes/igbo-folklore-twelve-timeless-tales-of-wisdom-wonder-and-moral-heritage.mp3"),
}


def levels(y):
    n = 1 + (len(y) - WIN) // HOP
    idx = np.arange(WIN)[None, :] + HOP * np.arange(n)[:, None]
    return 10 * np.log10(np.maximum((y[idx] ** 2).mean(axis=1), 1e-12))


def id3_offsets(b):
    """Every ID3v2 tag in the file. A tag after byte 0 is a chunk boundary."""
    out, pos = [], 0
    while True:
        i = b.find(b"ID3", pos)
        if i < 0:
            return out
        if i + 10 <= len(b) and b[i + 3] in (2, 3, 4) and b[i + 4] == 0:
            size = (b[i + 6] << 21) | (b[i + 7] << 14) | (b[i + 8] << 7) | b[i + 9]
            out.append(i)
            pos = i + 10 + size
        else:
            pos = i + 3


def main():
    for name, path in FILES.items():
        b = open(path, "rb").read()
        y, sr = sf.read(io.BytesIO(b), dtype="float32", always_2d=False)
        if y.ndim > 1:
            y = y.mean(axis=1)
        L = levels(y)
        floor, speech = np.percentile(L, 10), np.percentile(L, 90)
        print("=" * 92)
        print(f"{name}  {path}")
        print(f"  decoded {len(y)/sr:.3f} s at {sr} Hz   frames={len(L)}")
        print(f"  noise floor (10th pct) = {floor:7.2f} dBFS")
        print(f"  speech      (90th pct) = {speech:7.2f} dBFS")
        print(f"  SNR                    = {speech-floor:7.2f} dB")
        print(f"  peak = {np.abs(y).max():.4f}   rms = {np.sqrt((y**2).mean()):.5f}")

        # the floor in every 60 s window, which is what rules out a seam artefact
        win = []
        for s in range(0, int(len(y) / sr), 60):
            seg = L[int(s * sr / HOP):int((s + 60) * sr / HOP)]
            if len(seg):
                win.append(np.percentile(seg, 10))
        print(f"  floor per 60 s window: min {min(win):.2f}  max {max(win):.2f} dBFS over {len(win)} windows")

        # the bed's shape over the quietest 200 frames
        quiet = np.sort(np.argsort(L)[:200])
        segs = np.stack([y[i * HOP:i * HOP + 8192] for i in quiet if i * HOP + 8192 <= len(y)])
        f = np.fft.rfftfreq(8192, 1 / SR)
        psd = (np.abs(np.fft.rfft(segs * np.hanning(8192), axis=1)) ** 2).mean(axis=0)
        tot = psd[(f >= 20) & (f < 16000)].sum()
        print("  bed's band shares (dB), quietest 200 frames: " + "  ".join(
            f"{lo}-{hi}:{10*np.log10(psd[(f >= lo) & (f < hi)].sum()/tot + 1e-20):.1f}" for lo, hi in BANDS))

        # seams, and whether anything clicks across them
        d = np.abs(np.diff(y))
        print(f"  click count (|diff| > 8x the 99.999th pct) = {int((d > np.percentile(d, 99.999) * 8).sum())}")
        for off in id3_offsets(b)[1:]:
            t = off / 16000.0
            i = int(t * SR)
            F = int(0.020 * SR)
            # A seam can sit past the point a decoder stops, and for folklore it does: its second tag begins
            # at 407.80 s while the decoded audio ends at 407.742 s, because the leading Info frame declares
            # only the first chunk. Say that rather than measuring an empty slice and printing a NaN.
            if i + 5 * F > len(y):
                print(f"  seam ID3 at byte {off} (~{t:.3f} s) — BEYOND the decoded audio "
                      f"({len(y)/sr:.3f} s), so this chunk is never played")
                continue
            pre = [10 * np.log10((y[i - k * F - F:i - k * F] ** 2).mean() + 1e-20) for k in range(5)]
            post = [10 * np.log10((y[i + k * F:i + (k + 1) * F] ** 2).mean() + 1e-20) for k in range(5)]
            jump = d[max(0, i - 2):i + 2].max() if i < len(d) else float("nan")
            print(f"  seam ID3 at byte {off} (~{t:.3f} s)")
            print(f"     last 100 ms of chunk 1: {' '.join(f'{v:7.2f}' for v in pre[::-1])}")
            print(f"     first 100 ms of chunk 2: {' '.join(f'{v:7.2f}' for v in post)}")
            print(f"     |sample diff| at seam = {jump:.4f}  (file 99.999th pct = {np.percentile(d, 99.999):.4f})")


if __name__ == "__main__":
    main()
