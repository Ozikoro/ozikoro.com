# Design brief: ozikoro.com

You are designing **ozikoro.com** — the parent site of a platform about Igbo and African history,
language and scholarship, owned by **Ozi Ikoro Limited**.

This brief is written for a designer. It describes what the site must carry and what it must feel
like, and it is deliberately open about layout: the arrangement is yours to invent.

> **Source.** This brief is drawn from `docs/reference/ozikoro-technical-scope.md` in the project
> repository, the technical scoping document that defines the platform's twelve buildable projects
> across six layers. If there is an earlier vision document that says more than that one does, send
> it and the brief will be corrected — nothing here has been invented to fill a gap.

---

## 1. What Ozikoro is

Ozituma — the Igbo dictionary — is **one layer** of a much larger thing. Ozikoro is the whole of it,
and **ozikoro.com is its front door.**

| | | state |
|---|---|---|
| **ozikoro.com** | The parent: history, archives, research, the foundation | **This brief** — currently a WordPress site |
| **ozituma.com** | The dictionary: words, names, clans, proverbs, recordings | Built |
| **learn.ozituma.com** | The Academy: courses in language and culture | Built |

These are one platform with one owner, not three websites. A reader should never be able to tell
where one ends and the next begins — and an academic citing the platform should be able to cite it
as **one institution**.

## 2. Who it is for

This is the part that decides the design, because these five audiences want incompatible things and
the site has to serve all of them without becoming a committee's compromise.

1. **Diaspora descendants** — often on a phone, often on poor bandwidth, looking for a family name,
   a town, a meaning, a connection. They need warmth and a way in.
2. **Academics** — researchers, lecturers, PhD candidates, students. They need **credibility**:
   citations, sources, permanence, an address they can reference. They are judging the site the way
   they judge a journal.
3. **Traditional institutions** — town unions, clan leaders, elders, who hold the histories and are
   deciding whether to entrust them here. They need to feel the platform honours the material.
4. **General readers** — anyone curious about Igbo and African history, arriving from a search
   engine with no context.
5. **Contributors and partners** — people with documents, photographs, recordings, oral histories
   and papers to give, who need to know what happens to them.

## 3. What the site must carry

These are the working parts, drawn from the scoping document. They are the **work that must be
possible** — not a sitemap, and not a page structure to preserve.

### 3.1 The History Archive

Town histories, kingdom histories, colonial records, oral histories, migration records. Today this
is a blog with flat categories; it is to become a **structured archive**.

Every article carries required structure: **ethnic group, sub-group or clan, town or place, time
period, and source type** — oral history, colonial record, or academic source. Search must work
across the whole archive and filter by those tags. **Citations and attached references** are
first-class: academic and archive partners expect proper sourcing, and an entry without a source
should look incomplete.

Design implications worth your attention: an article page is a **scholarly object**, not a blog
post. It should present its tags, its period and its sources as clearly as its title — and a reader
should be able to move from an article to the clan, the town and the period it belongs to.

### 3.2 The Researchers Network

A publishing and discovery platform for African and Nigerian students, lecturers and researchers to
publish their work and be found.

**Scoped deliberately smaller than ResearchGate.** The full feature set — 25 million users, citation
scoring, job boards, group messaging — is neither realistic nor needed. What is needed is a focused
publication repository:

- a **researcher profile**: credentials, institution, research interests, list of work
- **publication upload**: PDF or document, with title, abstract, authors, topic tags, institution
- **search and discovery by topic, author or institution** — findability is the entire value, and
  the social features around it are secondary
- **following and visibility** controls
- an **institutional access tier** to the wider Ozikoro archive, since some material is culturally
  sensitive and not everything should be fully open

Design implications: a profile page is this site's equivalent of a **business card and a CV in one**,
and it has to look like something a researcher is willing to put on a grant application. An empty
profile must look like an invitation, not a failure.

### 3.3 The Academy

Courses in Igbo language and culture, delivered at `learn.ozituma.com` and reached from here. Online
course delivery is a well-worn pattern; the design question is not how to build it, but how it
belongs to the same institution as the archive and the dictionary.

### 3.4 The Archive itself

Documents, photographs, scans, recordings, historical maps — the raw material, held and attributable.
**Design the reader's experience of an archive**: browsing it, understanding what it holds, and
knowing how to cite or request it.

### 3.5 The layers still to come

Design should not build these, but the structure must not forbid them:

- **Geography and mapping** — clan territories, migration routes, historical settlement boundaries,
  digitised historical maps. This is the platform's most visually ambitious work: custom-drawn
  regions and animated routes, not pins on a map.
- **Genealogy and family trees** — interactive, explorable lineage diagrams, with **privacy controls
  for living relatives**, which the historical material does not need.
- **Diaspora reconnection** — matching to communities and to historical trade routes, a diaspora
  association directory, and introductions to traditional contacts.

### 3.6 The institution

**Ozi Ikoro Limited** — who it is, what it is for, its partners, its terms and its privacy. Not a
footer paragraph: this is the page a partner or a funder reads before deciding to work with you, and
a researcher reads before trusting you with a paper.

## 4. What it must feel like

1. **An institution, not a blog.** Nothing about the current site should suggest a personal weblog.
   The register is a library, a museum or a university press.
2. **African, and Igbo specifically — not "African-themed".** No kente-pattern decoration, no
   generic pan-African clip art, no colonial photography of "natives". Restraint reads as respect;
   motifs read as costume.
3. **Warm but authoritative.** Ozituma's public site already uses warm paper tones and a serif for
   headings. Ozikoro can share that family and be the more formal sibling.
4. **Long-form readability above everything.** Some of these documents are thousands of words.
   Measure, rhythm, contrast and hierarchy matter more here than any decorative idea.
5. **Credibility is a visual property.** Citations, dates, authors, institutions and sources must be
   designed to be seen, not tucked away. An academic decides in seconds whether a site is serious.
6. **Fast and light.** Many readers are on a phone on poor bandwidth. Nothing may depend on large
   media or client-side rendering.
7. **The five audiences must each find their door.** A diaspora visitor looking for a name, an
   academic looking to publish, and an elder deciding whether to entrust a history should all reach
   their own way in without reading the whole page.

## 5. Hard constraints

1. **The typeface must carry Igbo properly.** `ị ọ ụ ṅ` and the tone marks — `à á è é ì í ò ó ù ú ụ̀ ị̀`
   — must render correctly, at every size, in every weight you use, in both roman and italic. Test
   them explicitly. A typeface that falls back to another font for a dotted vowel is disqualified;
   so is one where a tone mark collides with the letter above it in a line of tight leading. **This
   is the single most common way a design for this material fails silently.**
2. **No colonial framing, anywhere.** Not in the navigation, not in the headings, not in the
   illustrations, not in the way a period or a people is named. The platform's standing rule is that
   no people, clan or town is described as having a non-Igbo origin, and that histories are told as
   the record supports them rather than from the coloniser's vantage point. If you are unsure
   whether a phrase or an image crosses this line, leave it out and ask.
3. **Never invent content.** No lorem ipsum in a place where real text would be. No fabricated
   statistics. No stock photographs presented as a real town, a real person or a real document.
   Where you need to show a full state, use clearly plausible example material and label it.
4. **Empty and partial states are real screens.** The archive is being built; most of it is thin. A
   page for a clan with one town and no history yet must still feel intentional, not broken.
5. **Provenance is part of the design, not metadata.** Sources, licences and attributions must have
   a designed home on every entry that carries one.
6. **Plain HTML and CSS, no build step, no framework in what you publish** — see §7. This is the same
   constraint as the dashboards brief, for the same reason: markup and CSS get copied, pictures get
   approximated.
7. **Accessibility.** Keyboard-operable, visible focus, sufficient contrast, correct semantics. Long
   documents need real heading structure — this is a site blind and low-vision readers will use.

## 6. Relationship to the dashboard design

A separate brief covers the authenticated dashboards. If you are doing both, they are **two designs
for one institution** and should share a foundation — the same type scale, the same spacing rhythm,
the same colour semantics — while being clearly different tools: ozikoro.com is the public face, the
dashboards are the working back.

Every one of the sections in §3 needs a back office where it is edited. You are not being asked to
design those; they are covered by the other brief. But the two should not look like two companies.

## 7. What to publish, and how it will be used

**Publish your design to your own GitHub repository when it is done.** You are not editing the
application. Your work will be read and implemented by another agent, so the form you publish in
decides how faithfully it survives.

**Static HTML and CSS — one file per screen — that opens in a browser with no build step.**

Markup and CSS translate directly. A picture does not: it has to be measured by eye, and every
judgement you made is lost. **No build step, no preprocessor, no framework** in what you publish —
no Tailwind, no Sass, no CSS-in-JS — because the application has none, and a deliverable that needs
compiling cannot be copied.

```
index.html          links every screen, so it can be walked through
screens/*.html      one per screen
styles/*.css        plain CSS, tokens at the top
tokens.css          the custom properties alone
NOTES.md            the rationale, the inventory, and every departure
```

Screenshots and a Figma file are welcome **as an overview on top**, and are not a substitute for the
markup. Static mock content is expected — use plausible Igbo names, towns and titles, with the
diacritics correct.

### Screens to design

Home · an article (full long-form) · the archive index with its filters · a researcher profile · a
publication page · the upload and publish flow · the Academy landing · the archive of documents and
photographs · About / the institution · and a 404.

At desktop width and at 375px.

## 8. What NOT to do

- Do not design a generic blog or magazine. This is an archive and an institution.
- Do not use colonial-era imagery, or any imagery of named real people or places you cannot source.
- Do not propose a framework, a page builder, or a dependency.
- Do not require JavaScript for reading, browsing or searching.
- Do not merge ozikoro.com, ozituma.com and learn.ozituma.com into one visual mass — they are one
  institution with three clear roles, and each should be recognisable as itself.
- Do not invent history, names, places or numbers to fill a design.
