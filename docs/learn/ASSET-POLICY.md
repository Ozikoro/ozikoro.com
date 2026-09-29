# Asset and character policy

**Spec:** §11.4 (sources, licensing and originality), §11.5 (quality gates), §7 (design),
§17.2 #12 (brand assets), §13 (privacy), §2.1 (agent rules)
**Status:** governs every image, illustration, icon, font, logo and character that reaches a learner.

---

## 1. The rule

§11.4:

> Content must be original, commissioned, owned, or licensed with written permission. Every entry
> records its source and licence.

> Published dictionaries, textbooks, apps and websites are copyrighted by default. They may be used
> as reference by linguists to check facts, but their text, examples, structure and audio MUST NOT
> be copied into the platform without a licence.

> Do not name the product, its features or its curriculum after third-party products, and do not
> reuse their designs.

Four admissible routes, and nothing else:

| Route | What must be recorded |
|---|---|
| **Original** | Who made it, on what date, under what terms of engagement |
| **Commissioned** | The contract, the IP assignment, and the deliverable |
| **Owned** | Which entity owns it, and where the ownership came from |
| **Licensed** | The licence name, version, URL, and any attribution or share-alike obligation |

An asset with no recorded provenance cannot ship. This is not bureaucracy: §16 lists
"licensing or copying dispute" as a reputational and legal risk, and the mitigation it names is
exactly "source and licence recorded per entry".

---

## 2. Register of submitted resources

Recorded on 28 September 2026, with the verdict for each. "Blocked" means the asset cannot be
assessed, not that it is rejected.

### 2.1 `ozikoro/Black_People_Face_Recognition-bucket`

| | |
|---|---|
| Kind | Hugging Face bucket, private |
| Account | `ozikoro` — the owner's own account (Idenze Ezeme), 1 bucket, 0 public models, 0 public datasets |
| Access | **Blocked.** HTTP 401 unauthenticated; no Hugging Face token exists in this project or its environment |
| Verdict | **Not admissible for this platform, independently of access.** See §3 |

### 2.2 `TrixxyT/AfricanCharacter`

| | |
|---|---|
| Kind | Hugging Face **Space** — a static app, not a model and not a dataset. `TrixxyT` holds 0 models, 0 datasets, 1 Space |
| Licence | Not stated in the repo |
| Contents | `.gitattributes`, `README.md`, `index.html` — **1,664 bytes of HTML in total** |
| Verdict | **Empty.** It is the unmodified Gradio-Lite starter template. See §4 |

### 2.3 `electricsheepafrica/africa-ghana-selected-population-characteristics-by-region-2010-6702d851`

| | |
|---|---|
| Kind | Hugging Face dataset, public, not gated |
| Licence | **ODbL** (Open Database License) — verified from the repository metadata |
| Source | Ghana Open Data / Ghana Statistical Service, 2010 census characteristics by region |
| Format | Parquet, tabular; under 1K rows |
| Verdict | **Openly licensed and genuinely usable** — but not for this product. See §5 |

---

## 3. Face recognition is out of scope, and should stay out

This is a scope and risk finding, not a licensing one, so it holds even if the bucket turns out to
be impeccably licensed.

**No feature in the specification involves faces, photographs of people, or recognition of any
kind.** The v1.0 surface is text, icons, illustrations and audio. A face-recognition dataset has
nothing to attach to.

**It collides with three separate constraints:**

- **§13 Privacy and law.** Face images of identifiable people are biometric data. Under the Nigeria
  Data Protection Act 2023 and, for EU/UK learners, GDPR, biometric data used to identify a person
  is a special category requiring an explicit lawful basis and, in most readings, explicit consent.
  §13 already requires a "lawful basis recorded for analytics and AI processing" and nothing in
  this product supplies one for faces.
- **§18 #5 / minors.** The default child policy is 13+ with parental notice for under-18s. Biometric
  data of minors is the highest-risk category in the whole document.
- **§11.4 + §2.1.** A dataset described as "Black people face recognition" is, in the overwhelming
  majority of cases, assembled by scraping. §2.1 forbids scraping outright, and §11.4 admits only
  original, commissioned, owned or licensed material.

**The specific danger for this product.** The tempting use is not recognition at runtime — it is
training a character generator on faces so the illustrations "look African". That would mean
generating and shipping likenesses derived from people who did not consent, in a product whose
entire premise is verified provenance and trust. If any of those faces belong to minors, it is
worse still. The reputational cost lands on a project that has spent its credibility on being
careful about exactly this kind of thing.

**Recommendation: do not use it, and record that decision here so it is not revisited.**

---

## 4. `AfricanCharacter` does not create characters

The Space's metadata card says "Create African Characters". The application behind it is the
Gradio-Lite starter template, unmodified, and its entire behaviour is this:

```python
from filters import as_gray

def process(input_image):
    output_image = as_gray(input_image)
    return output_image
```

It converts an image to greyscale with `scikit-image`. Its two example images are a lion
photograph and the Gradio logo, both fetched from Gradio's own GitHub repository. The page title is
still Gradio's: *"Gradio-Lite: Serverless Gradio Running Entirely in Your Browser"*.

There is no model, no API, no character generation, and no African character content of any kind.
Only the card's title and short description mention characters. It was created on 26 September 2026
and holds no weights and no data.

**Nothing can be taken from it**, which is the fortunate outcome — if it had shipped Gradio's demo
assets under an African-character name, that would have been a third-party asset with no licence
record of its own.

---

## 5. The Ghana dataset is fine data for a different question

It is real, public, ODbL-licensed official statistics, and it was verified as such. Two reasons it
does not belong here:

1. **It is Ghana.** Igbo is spoken in south-eastern **Nigeria**. Ghana is not an Igbo-speaking
   country, and the platform's Igbo course has no reason to carry Ghanaian regional demographics.
   The language registry in `packages/core/src/languages.ts` records Igbo's countries; Ghana is not
   among them.
2. **It is population statistics.** Region, sex and age distributions for 2010 census
   characteristics do not inform a language curriculum, a lesson, an exercise or an illustration.

**One thing worth carrying forward:** ODbL is share-alike for *derived databases*. If any Ozituma
project ever imports this data and publishes a derived database, the ODbL obligations attach to
that derived database. That is a real constraint, and it is the reason licence names are recorded
per asset rather than glanced at once.

---

## 6. What the product actually needs, asset-wise

So that any future submission can be assessed against a known list rather than in the abstract.

| Slot | Where the spec requires it | Notes |
|---|---|---|
| Brand mark and wordmark | §17.2 #12, §7 | The dictionary's existing `ọ` mark and Libre Baskerville / IBM Plex pairing are already in use; reusing them for Learn keeps one identity |
| Colour and type tokens | §7 | Already defined as CSS custom properties (`--ink`, `--ochre`, `--clay`, `--paper`); §7 requires fonts be tested for Igbo diacritics |
| Lesson illustrations | §F2, §F9 | Scene-setting for lessons and culture notes |
| Badge artwork | §F7 | The badge set is defined in `packages/core/src/gamification.ts`; each needs an icon |
| Dialogue speakers | §F2 | Lessons contain dialogues with named speakers |
| Audio speaker attribution | §F4, §11.3 | Governance rather than artwork, but the same register applies: every recording carries speaker ID and signed consent |

### 6.1 Characters are content, and content needs review

The one thing worth stating plainly: **in an Igbo course, a character is not neutral decoration.**

§F9 requires every lesson to carry a structured cultural note — *who says it, to whom, in what
setting, elder or peer register, regional differences*. A visible character carries all of that
whether or not it was intended to: their name, their age relative to the learner, their clothing,
and the setting they are drawn in are cultural claims about Igbo life.

The project already treats this as a first-class problem — the name dictionary exists precisely
because Igbo names are meaningful statements rather than labels. A character called *Chidi* or
*Ngozi* is using a name that means something, and §11.5 already lists a **cultural sensitivity
check for notes, names and titles** as a publication gate.

So character design goes through the same review as written content:

- **Names** are a linguist and native-speaker decision, not a designer's. §2.1 forbids an agent
  inventing them, and the existing lesson dialogues use names that came from that unverified draft
  — they are quarantined with it.
- **Register and setting** are recorded per character, in the same way §11.1 requires for lexical
  items.
- **No single character represents "the Igbo"**. §16 names dialect disputes as a risk and the
  mitigation is "never present one form as universal". The same applies visually.
- **Illustrations are labelled like everything else** — a drawing is either original, commissioned,
  owned or licensed, and the register says which.

---

## 7. Decisions recorded

| # | Decision | Status |
|---|---|---|
| A1 | The face-recognition bucket is not used, on scope and privacy grounds independent of its licence | **Recommended; awaiting owner confirmation** |
| A2 | `TrixxyT/AfricanCharacter` is rejected as empty — nothing to use | **Determined** |
| A3 | The Ghana dataset is not used in this product; ODbL obligations noted for any project that does | **Determined** |
| A4 | Reuse the existing Ozikoro/Ozituma visual identity rather than commissioning a new one (§7, §17.2 #12) | Open |
| A5 | Who authors the character art, and under what IP terms (§17.4 requires written assignment) | Open — **blocking any illustrated character** |
