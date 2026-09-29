# Phase 0 voice benchmark plan

**Spec:** §12.1 — a time-boxed spike of about one week, gating all voice work (v2)
**Status:** plan only. **Not started** — it cannot start until §18 #4 is answered, because it
requires the native speakers who record the utterances and rate the output.
**Decision rule (§12.1):** proceed with a provider only if word error rate and tone correctness
meet a threshold agreed with the linguists. Otherwise voice stays out of the product.

---

## Why this is gated rather than scheduled

§12 gives the reason plainly: speech technology for Igbo is less mature than for major
languages, and tone scoring is unreliable. A pronunciation score that is wrong teaches learners
wrongly and damages the trust the whole platform is built on. The cost of a failed spike is one
week; the cost of shipping bad pronunciation feedback is the product's credibility.

The spike exists to turn "we think it might work" into a measured number.

---

## 1. Corpora

**Recording set — about 100 short utterances.**

| Property | Target |
|---|---|
| Utterances | ~100 short phrases (2–8 words), drawn from approved curriculum vocabulary |
| Speakers | ≥ 3, different regions, mixed genders |
| Per utterance | At least one clean recording per speaker where feasible, so speaker variance is visible |
| Transcripts | Verbatim, tone-marked, NFC, verified by a second speaker |
| Format | WAV 48 kHz 24-bit mono master (matches §11.3), plus the transcoded web file |
| Coverage that must be represented | Dot-below vowels (ị ọ ụ), dotted ṅ, minimal tone pairs (e.g. ákwá / àkwà), loanword adaptation, and at least a few multi-clause sentences |

The tone pairs matter most. If a system cannot distinguish `ákwá` from `àkwà` it will be useless
for the thing Igbo learners most need help with, and that failure is invisible in a corpus of
easy words.

**Pre-existing material to check first.** Ozituma already holds ~46,400 published recordings and
48 mapped dialects. Some of this may be usable as benchmark input, which would remove most of
the recording cost. It must be checked for (a) licence permitting this use, (b) speaker consent
covering it, and (c) transcript accuracy before it is used. Per §11.4, nothing is assumed
reusable until its licence is read.

## 2. Systems under test

§12.1 requires **at least three speech-to-text** options and **two text-to-speech** options,
explicitly including open models built for African languages alongside major cloud providers.

| Candidate class | Why it is in the set |
|---|---|
| Major cloud STT (2 providers) | Best-resourced baseline; if these fail, the ceiling is low |
| Open STT models trained on African languages | The most likely to handle dot-below vowels and tone; must be tested rather than assumed |
| Major cloud TTS | Baseline for naturalness |
| Open TTS for African languages | The realistic path to tone-correct synthesis |

Open models must be tested on the actual Igbo data, not accepted on their training-data claims.

## 3. What is measured

| Measure | How |
|---|---|
| **Word error rate** | Standard WER, and **separately** a diacritic-aware WER — because a system that transcribes `akwa` for `àkwà` scores well on naive WER while being wrong for this purpose |
| **Dot-below handling** | Per-character accuracy on ị ọ ụ ṅ specifically, reported separately from the overall figure |
| **Tone handling** | Accuracy on the minimal-pair set, which is the number that decides the outcome |
| **Latency** | p50 and p95, per request and per minute of audio |
| **Cost** | Per hour of audio (STT) and per 1,000 characters (TTS), in USD and NGN |
| **TTS naturalness** | Native speakers rate 1–5 |
| **TTS tone correctness** | Native speakers judge whether the tone is right, blind to the provider |

The naive-WER/diacritic-aware-WER split is the most important methodological choice here. A
single WER number would let a system that ignores tone marks look like a success.

## 4. Evaluation protocol

1. Audio is held out entirely from any tuning. Nothing in the test set is used to pick prompts
   or adjust a model.
2. Every system is run on the identical set, in the same session, with the same transcripts.
3. Native-speaker ratings are collected blind — raters do not know which system produced which
   sample, and samples are presented in a shuffled order.
4. At least two raters score each TTS sample; disagreements above one point on the 5-point
   scale are adjudicated by the lead linguist.
5. Cost is measured from real usage, not from published price lists.

## 5. Deliverable

A one-page results table plus a recommendation, recording: the corpora and their licences, every
system and version tested, all measurements above, the speaker-rating distributions, the agreed
threshold and whether it was met, and the explicit go/no-go.

Stored in `docs/learn/` and referenced from the release notes, so the claim "we benchmarked
voice" can be checked later rather than taken on trust.

## 6. Product rules that hold regardless of the result

From §12.2, and these constrain v1.1 and v2 even if the spike succeeds:

- **No numeric pronunciation scores** unless validated against native-speaker ratings.
- **No claim to grade tone** unless tone accuracy has been demonstrated.
- **Synthetic voices are always labelled**, and never replace native audio in the core
  curriculum.
- **Explicit consent before microphone use**, with an explanation of how recordings are
  processed.
- **Text mode stays fully usable** if voice services fail.

v1.1's safe middle ground is **"Record and compare"**: the learner records themselves and hears
it beside the native audio, with self-rating and an optional pitch-contour view. It teaches
without asserting a score, so it needs no benchmark to ship.

## 7. Time box and exit

One week, and the spike ends when the week ends. If the measurement is inconclusive, the
outcome is "not yet" and voice stays out — the platform loses nothing it had, because v1.0
ships on native recordings either way.
