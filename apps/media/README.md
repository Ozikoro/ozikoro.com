# Ozikoro Media — `media.ozikoro.com`

A self-hosted text-to-speech service for the Ozikoro archive, with **two engines behind one API**:

| engine | what it is | cost | publishable |
|---|---|---|---|
| `local` | F5-TTS on this machine. Drafts and bulk work. | **0 credits** — CPU time only | **NO — see the licence below** |
| `elevenlabs` | The hosted model already used for the archive. Public narration. | 1 credit per character | yes, per ElevenLabs' terms |

The choice between them is a **parameter** (`engine: "local" | "elevenlabs"`), never a fallback. There is no
default engine, because the engine that ran is written to `ozikoro_episode.generator` and a default would
make the archive's most important provenance field optional in practice.

---

## THE LICENCE, PLAINLY — READ THIS BEFORE PUBLISHING ANYTHING

**The local model is F5-TTS. Its code is MIT. Its WEIGHTS are `CC-BY-NC-4.0`, which is NON-COMMERCIAL.**
The weights are what do the speaking, so the weights govern. Verified directly from the Hugging Face API:

```
$ curl -s https://huggingface.co/api/models/SWivid/F5-TTS | jq -r '.cardData.license'
cc-by-nc-4.0
```

**This means: do not publish a render made with the `local` engine on a commercial site.** A public archive
that carries advertising, sponsorship, or paid subscriptions is a commercial use; a non-commercial
cultural archive may be fine. **That is the owner's call to make and this file will not make it for him.**
`GET /engines` returns `licence.nonCommercial: true` and a `publishable` sentence so any review screen can
refuse to publish a local render rather than relying on somebody remembering this paragraph.

### The commercially-usable alternative, named

**[Chatterbox](https://huggingface.co/ResembleAI/chatterbox) (Resemble AI) is MIT for both the code and the
weights**, supports zero-shot voice cloning from a reference clip, and covers 23 languages. Verified:

```
$ curl -s https://huggingface.co/api/models/ResembleAI/chatterbox | jq -r '.cardData.license'
mit
```

It is the drop-in replacement if the answer to "is this commercial?" is yes. Swapping engines means a new
`python/<engine>.py` worker and one more entry in `apps/media/lib/engines/`; the API, the pronunciation
layer, the commands and the cost planner are all engine-agnostic by construction.

**XTTS-v2 (Coqui) is NOT a solution here either** — the Coqui Public Model Licence is also non-commercial.

**ElevenLabs is the only engine in this service that is unambiguously publishable today.**

---

## INSTALL

Three steps. Nothing needs the database except step 3.

### 1. The interpreter and the model runtime

```bash
cd /Users/nzeora/Documents/Ozikoro/staging
python3 -m venv .tools/tts-venv
.tools/tts-venv/bin/python -m pip install torch==2.2.2 torchaudio==2.2.2
.tools/tts-venv/bin/python -m pip install f5-tts
```

This is already done in this checkout. Two notes for a fresh machine:

* **`pip install librosa` fails on Intel macOS** — `librosa` → `numba` → `llvmlite`, and llvmlite publishes
  no wheel for Intel macOS, so pip tries to compile it against LLVM and fails. `apps/media/python/librosa_shim.py`
  is an exact transcription of the one function F5-TTS actually imports, and `f5_compat.py` removes the two
  training-only imports (`wandb`, `datasets`) that inference never executes. Neither mocks the model.
* **`torch==2.2.2` is the last release with an Intel-macOS wheel.** Do not "upgrade" it.

### 2. The model weights (1.35 GB, once)

```bash
mkdir -p .tools/models/F5TTS_Base
curl -L -C - --retry 5 -o .tools/models/F5TTS_Base/model_1200000.safetensors \
  "https://huggingface.co/SWivid/F5-TTS/resolve/main/F5TTS_Base/model_1200000.safetensors"
curl -L -o .tools/models/F5TTS_Base/vocab.txt \
  "https://huggingface.co/SWivid/F5-TTS/resolve/main/F5TTS_Base/vocab.txt"
```

The file must be **exactly 1,348,645,281 bytes**. `npm run probe` checks this, because a truncated download
is the one failure that produces no error at all: `hf_hub_download`'s `hf_xet` path truncated a 268 MB blob
to zero bytes and restarted it silently, twice, while the download this replaced was running.

### 3. The Igbo lexicon (needs the dictionary)

```bash
OZITUMA_DB_PATH=.data/pg-lexicon-read npm -w @ozikoro/media run lexicon
```

**This is the one step that needs the PGlite cluster**, and it takes the cluster guard seriously: if
`npm run dev` or the standalone server holds `.data/pg`, this refuses. Do not delete the lock. Either stop
that server with SIGTERM and wait, or — as was done here — work from a **copy**, which needs no lock change
at all and cannot corrupt the live cluster:

```bash
cp -R .data/pg .data/pg-lexicon-read                     # 161 MB, a read-only snapshot
OZITUMA_DB_PATH=.data/pg-lexicon-read npm -w @ozikoro/media run lexicon
```

The lexicon is **derived data and is not committed** — the owner's rule is that the dictionary lookup must
query ozituma rather than read a list, and *"a list would be stale within a week"*. Regenerate it.

The build **proves itself before writing**: it rebuilds the index from the bytes it is about to write and
compares it against the live one over every published search form and every archive word, refusing to write
on any disagreement. `WordIndex.segment` is a closure that cannot be serialised, so it is transcribed in
`lib/lexicon.ts` — and that transcription is verified at build time rather than trusted.

### 4. The voices

```bash
npm -w @ozikoro/media run voices -- list
npm -w @ozikoro/media run voices -- register --name own --audio <clip.wav> --text "<what is said in it>"
```

**A voice needs the words spoken in its reference clip.** F5-TTS conditions on the audio *and* its
transcript; without one the service refuses rather than guessing, because a guessed transcript does not
fail — it quietly conditions the voice on words nobody said. `-- import-samples` stages the owner's 13
recordings from `data/voice-samples/` (converted to 24 kHz mono, which is one conversion rather than two),
and marks every one `needs_transcript`. **Adding one line of text per clip is the single step between this
service and the owner's own cloned voice.**

---

## RUN

```bash
npm -w @ozikoro/media start                    # http://127.0.0.1:8787
OZIKORO_MEDIA_PRELOAD=1 npm -w @ozikoro/media start   # read the checkpoint before opening the port
```

Without `OZIKORO_MEDIA_PRELOAD`, `/health` answers in milliseconds and the model loads on the first
`/speak` — about 24 s. With it, the port opens only once the model is ready. Both are useful; neither is
"ready" until the model is actually loaded, and `/health` reports `ready: false` until then.

### Endpoints

| endpoint | what it does |
|---|---|
| `GET /` | the route list |
| `GET /health` | model, device, whether a GPU is present, worker pid, lexicon state, both engines' licences |
| `GET /engines` | both engines, their ceilings, and whether their licence permits publishing |
| `GET /voices` | the registered voice profiles and whether each can speak yet |
| `POST /voices` | register a voice — `multipart/form-data` (`name`, `audio`, `referenceText`) or JSON with base64 |
| `DELETE /voices/:name` | remove a voice |
| `POST /speak` | `{ text, voice, engine }` → **audio bytes**, or a JSON error naming the engine |
| `POST /preview/pronunciation` | what the pronunciation layer would do, without rendering |

`POST /speak` returns the bytes with the provenance in headers (`x-ozikoro-engine`, `-model`, `-voice`,
`-characters`, `-silent`, `-credits`, `-unsayable-words`, `-marks-lost`), or JSON with the audio base64 when
`Accept: application/json` or `?meta=1`.

### The commands

```bash
npm -w @ozikoro/media run probe                      # what this machine has; --self-test loads the model
npm -w @ozikoro/media run speak   -- --engine local --voice own --file article.txt
npm -w @ozikoro/media run compare -- --voice own --file article.txt          # local only — spends nothing
npm -w @ozikoro/media run compare -- --voice own --file article.txt --paid   # asks, having printed the cost
npm -w @ozikoro/media run compare -- --voice own --file article.txt --paid --dry-run   # price, no spend
npm -w @ozikoro/media run lexicon                    # rebuild the Igbo lexicon from the dictionary
npm -w @ozikoro/media run voices -- list
```

`compare` is the command the decision turns on: the **same passage through both engines**, two files named
`compare.local.wav` and `compare.elevenlabs.mp3` so they can be played one after the other. **It renders
locally by default.** The paid side needs `--paid`, prints the credit cost, the remaining allowance and the
headroom before anything is sent, and then still requires `OZIKORO_MEDIA_ALLOW_ELEVENLABS=1` — the same
switch the engine itself enforces, so the two cannot disagree. `afplay <file>` to listen.

### The bounds

A request body over 256 kB is refused before it is read. Each engine enforces its own character ceiling
(20,000 local; 9,000 per chunk for ElevenLabs, from `@ozikoro/platform/chunking`) and a request past it
fails with the count and the limit rather than being truncated. A render past
`OZIKORO_MEDIA_REQUEST_TIMEOUT_MS` (30 min) is abandoned and says so. The local engine **refuses a second
concurrent render** rather than queueing, because a CPU-bound model finishes two requests in the time of
two. Long text is chunked by `planScript` at paragraph boundaries and never mid-sentence, and any seam that
had to cut mid-sentence is counted and reported.

---

## THE PRONUNCIATION LAYER

The owner's first narration mispronounced Igbo words: *"check ozituma.com automatically on how igbo words
are pronounced to avoid it being pronounced wrongly."* **This is one problem, not two** — a model not
knowing Igbo is not an ElevenLabs fault or a local one — so it sits below both engines and both call it.

It is built from the work that already measured it. `scripts/build-lexicon.ts` runs
`buildDictionaryIndex` from `packages/ozikoro/src/pronunciation.ts` once against the dictionary, snapshots
the result, and the service rebuilds the same finder index from that file **with no database at all**.

### What the dictionary actually holds — measured on this checkout

| | |
|---|---|
| published Igbo words | **8,728** |
| with a written pronunciation (`word.pronunciation`) | **0** |
| with a syllable breakdown | **0** |
| pronunciation **recordings** (`audio` rows) | **0** |
| dialect spellings | **0** |
| clean single-token folded forms | 1,953 |
| clean multi-word headwords | 1,882 |
| Igbo headwords that are also ordinary English words | 165 |

**The dictionary holds the SPELLING of 8,728 Igbo words and not one sound.** So the lexicon is spellings and
respellings, exactly as the earlier round recorded, and no code can do better: a pronunciation is either
recorded by a person or fabricated, and a fabricated one would be spoken in the owner's own cloned voice and
sound authoritative.

### Coverage of the archive — and a discrepancy stated rather than smoothed over

Measured over all **1,051** published records, from a spoken script of **5,514,389 characters**:

| | this run | previously recorded |
|---|---|---|
| distinct Igbo words | **1,751** | 2,368 |
| named by the dictionary | **663** | 1,289 |
| rescued by dissection | **618** | 617 |
| **genuinely unsayable** | **470** | 462 |

**The first two rows do not reproduce the earlier figures and this file will not pretend they do.** The
distinct-word count is 1,842 if Igbo headwords that are also English words are included, so the counting
policy does not explain the gap either. The likely cause is a different source corpus or a different
counting rule in the earlier run, and it is unresolved. **What is reproducible is reproducible**: the 8,728
dictionary words, the zero recordings, the 1,953 forms, the 1,882 phrases and the 165 collisions all match
the earlier measurement exactly, and the 5,514,389 spoken characters match it exactly too.

The last two rows are close and the direction is the one to be careful about: **470 words cannot be said at
all** — no dictionary entry and no segmentation into known pieces. They need a person to record them. See
`packages/ozikoro/src/missing-words.ts` for the queue.

### Diacritics are the content, and a bug in this service was destroying them

`ị ọ ụ ṅ` are different **letters** from `i o u n`. The model's vocabulary holds the precomposed Igbo
letters (measured: `ụ` U+1EE5, `ị` U+1ECB, `ọ` U+1ECD, `ṅ` U+1E45 all present) and not the combining marks.
The first version of `prepare_text` decomposed the whole string with NFD before testing it, which turned

```
ụ  ->  u + U+0323   ->   "u" is a known token, kept;  U+0323 is not, stripped   ->   "u"
```

**So `bụ` was sent to the model as `bu`, `ị` as `i`, `ọ` as `o` — the dot-below letters were deleted by
this service's own text preparation, one instruction after its docstring promised not to.** Measured on the
first synthesis this service ever ran: `"Ndeewo, aha m bụ Ozikoro."` → `"Ndeewo, aha m bu Ozikoro."`. That
is precisely the mispronunciation the owner reported, and **no lexicon can repair it**, because the damage
happened after the lexicon had done its job and before the model saw the word.

Fixed by testing each character against the vocabulary **in its composed form first**, and only decomposing
a character that is not already a known token. Two related findings came out of the same test:

* the vocabulary holds `ị`/`ọ` but **not** `Ị`/`Ọ`, so a sentence opening "Ọ dị mma" lost the dot on its
  first letter. Capital marked letters are now folded to their lowercase form — the letter is kept, the case
  is not, and case carries no phonetic weight in a reading. Reported as `case_folded`.
* F5-TTS's tokenizer is `vocab_char_map.get(c, 0)`, so **an unknown character silently becomes token 0, a
  blank**. Passing an unrepresentable character through would therefore look like it was sent while actually
  being deleted by the model, so unrepresentable characters are removed and named in `out_of_vocab`.

`POST /preview/pronunciation` reports all of this **before** a render, per engine, because the two engines
answer differently: the local one can lose a mark, and ElevenLabs receives the text as written — which is
not the same as pronouncing it correctly, and this service says so rather than implying otherwise.

---

## THE COST PLANNER

| | |
|---|---|
| archive | 1,051 records |
| **spoken script** | **5,514,389 characters** — *not* the 9,794,392 of `body_html`, because markup is never sent or billed |
| ElevenLabs allowance | 65,000 credits/month (1 credit per character) |
| **buying power** | **≈ 12.4 records a month** |
| **the whole archive** | **≈ 84.8 months ≈ 7.1 years** |
| local engine | 0 credits, always |
| **ElevenLabs remaining (recorded)** | **21,552 characters** — not read from the API, see below |

### The local engine is free and it is SLOW, and the old figure was wrong by two orders of magnitude

The cost model used to claim the local model renders "roughly one minute of audio per minute of compute"
and that a fourteen-minute article is "about fourteen minutes". **That was an assumption.** The measured
figures from this checkout:

| render | audio | compute | factor |
|---|---|---|---|
| `"Ndeewo, aha m bụ Ozikoro."` | 1.291 s | 135.6 s | **105×** |
| `"Ndeewo, aha m bụ Ozikoro. Ọ dị mma."` | 2.123 s | 305.8 s | **144×** |

An Intel Core i7-7820HQ with no usable GPU. **A fourteen-minute article is therefore about 24 hours, not
fourteen minutes, and the whole archive is roughly a year and a half of continuous compute** rather than
the "long batch job" the old note implied. The local engine is still the only free option and still right
for drafts and short passages — but it is a different decision from the one the old number invited, and the
owner is entitled to the real one. `LOCAL_RENDER_SPEED_FACTOR` carries it, so every estimate moves together
when a second measurement replaces it.

### Narration is paused and no credit may be spent

The account has **21,552 of 65,000 characters** remaining. **This service does not call the ElevenLabs API
at all** — not even the free `GET /user/subscription`. The remaining figure is carried in configuration
(`ELEVENLABS_CREDITS_REMAINING`) from the owner's own measurement, and the paid engine is refused at three
levels: it needs `OZIKORO_MEDIA_ALLOW_ELEVENLABS=1` (unset everywhere in this repository), any render
exceeding what remains is refused with the numbers, and `compare` will not touch it without `--paid`.

Read `packages/ozikoro/src/credit-planner.ts` for the live reconciliation when narration resumes; it is the
authority and this file's figures are the recorded floor, not a fresh reading.

---

## `media.ozikoro.com` — CHECKED FIRST, AND NOT CHANGED

**`media.ozikoro.com` does not exist.** Checked against the Cloudflare API before anything else:

```
$ dig +short media.ozikoro.com A                      # (empty)
$ curl -s -o /dev/null -w '%{http_code}' https://media.ozikoro.com/    # 000
$ curl -s -H "Authorization: Bearer $TOK" \
    "https://api.cloudflare.com/client/v4/zones/1ebe8c1f9ce3dcec95448b6d93d63e00/dns_records?per_page=100"
  ... 35 records, NONE named media, NO wildcard
```

**The `CNAME → public.r2.dev` is `media.ozituma.com`, in a different zone**, and it serves the dictionary's
2,000+ audio recordings. It was **not touched**:

```
CNAME  media.ozituma.com -> public.r2.dev   proxied=true   id=614f661f5a911ee947c3023383bd015a
```

The recorded warning that *"`media.ozikoro.com` may already exist and point at ozituma's recordings"* was
worth checking and turned out to be a zone confusion: **`media.ozikoro.com` is free, and nothing needed
overwriting.** Breaking the dictionary to save one DNS entry would indeed have been the worst trade
available, and it was not made.

### Why no record was created

**The correct record cannot be verified, because this machine has no public ingress.** It sits behind a
dynamic NAT address (`102.90.126.152` at the time of writing, an MTN Nigeria mobile range), there is no
`cloudflared` installed, and no tunnel configuration exists anywhere in the checkout. Any record creatable
today would be one of:

* a grey-clouded record pointing at a private address — resolves to something unreachable;
* an orange-clouded record with no origin — serves **522** on a hostname the owner believes is live;
* a record pointed at the archive's cPanel host `162.213.253.73` — which serves the archive, not this
  service, and would be a public promise that is not kept.

**So the exact calls are handed over and were not run.** They are in `apps/media/DNS.md`.

### Why a subdomain is right, on the record

Audio is **bytes rather than documents**. It wants its own cache (an MP3 is immutable once rendered and can
be cached for a year; an article's HTML changes whenever an editor touches it) and its own scaling (a
render is minutes of CPU and cannot share a request budget with the pages that serve readers). And the
decisive one: **if audio ever moves hosts, Spotify feed enclosures break for every subscriber.** An
enclosure URL is a promise made to a listener's podcast app, so **the hostname should be chosen once and be
permanent** — which is exactly what a subdomain makes possible and a path like `/api/audio` does not.

### The local surface, which does work

```bash
npm -w @ozikoro/media start
curl -s http://127.0.0.1:8787/health
curl -s -X POST http://127.0.0.1:8787/speak -H 'content-type: application/json' \
  -d '{"text":"Ndeewo.","voice":"proof-say","engine":"local"}' -o out.wav
```

---

## WHAT IS NOT DONE

* **`media.ozikoro.com` does not resolve.** No DNS record was created — see above and `apps/media/DNS.md`.
* **The owner's own voice is not cloned yet.** His 13 recordings are staged as voices marked
  `needs_transcript`, because F5-TTS needs the words spoken in the reference clip and this service will not
  guess them. One line of text per clip is the whole remaining step.
* **The local model's audio was verified as a FILE, not as good Igbo.** The proof render used a
  macOS `say` reference clip with a known transcript, which exercises the whole pipeline; it does not
  demonstrate that F5-TTS speaks Igbo well, and **that has not been judged by ear.**
* **CPU only.** MPS reports available and cannot run the model's STFT, so it is refused deliberately; there
  is no CUDA. See `choose_device` in `apps/media/python/worker.py`.
* **No chunk-level resume.** A render that fails on piece 7 of 20 discards pieces 1–6.
* **The lexicon is not committed** and must be rebuilt from the dictionary on a fresh checkout.
