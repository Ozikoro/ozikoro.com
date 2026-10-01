# ozikoro.com — design notes

Deliverable for the brief *Design brief: ozikoro.com* (Ozi Ikoro Limited). Static HTML and CSS,
no build step, no preprocessor, no framework. Every file opens directly in a browser.

## Inventory

| File | What it is |
| --- | --- |
| `index.html` | Walkthrough linking every screen |
| `screens/home.html` | Home |
| `screens/folklore.html` | Folklores & myths — tales, customs and oral traditions |
| `screens/article.html` | A full long-form article |
| `screens/archive-index.html` | The archive index with its filters |
| `screens/researcher-profile.html` | A researcher profile (plus the empty-profile state) |
| `screens/publication.html` | A publication page |
| `screens/upload.html` | The upload and publish flow |
| `screens/documents.html` | The archive of documents and photographs |
| `screens/academy.html` | The Academy landing |
| `screens/watch.html` | Watch library for films, talks and series |
| `screens/watch-video.html` | Video player, source record and transcript-first view |
| `screens/collections.html` | Media-based collections hub |
| `screens/journeys.html` | Map and timeline-ready place discovery |
| `screens/topics.html` | Topics A–Z index |
| `screens/about.html` | About / the institution |
| `screens/404.html` | 404 |
| `screens/type-test.html` | Igbo typeface proof (extra; see "Departures") |
| `styles/main.css` | All CSS; `@import`s the tokens |
| `tokens.css` | Custom properties alone |

All screens are built at desktop width and verified at 375px. Breakpoints are at 60rem and 40rem;
below 40rem the type scale steps down, every grid collapses to one column, the filter rail and the
contents aside become static blocks in document order.

## The decisions, and why

**Register.** Library and university press, not blog. The devices doing that work are: a serif at
long measure with generous leading; hairline rules instead of cards wherever a card would be
decoration; a small-caps-styled label system; and metadata set as a *record table* with uppercase
field names, which is how a catalogue looks and not how a blog looks.

**Colour.** Warm paper (`--paper` #faf6ef) shared with Ozituma's family, so the two read as
siblings, with Ozikoro the more formal one: less chroma, more rule, tighter labels. One earth
accent (`--accent` #7a2e1d, iron-oxide) for links and marks. Then three semantic second voices that
carry meaning rather than decoration — indigo for sources and citation, ochre for periods and
dates, moss for sourced/verified. No motif, no pattern, no "African-themed" ornament anywhere:
restraint reads as respect. The only texture in the whole design is the diagonal hatch on empty
image plates, which exists to say *no picture here*, not to decorate.

**Credibility as a visual property.** Sources are not metadata. `.provenance` is a bordered,
tinted, numbered block with the same visual weight as a pull quote, and it appears on the article,
the publication, the profile and the About page. Every entry that can be cited carries a
`.cite-block` in monospace with the full citation ready to copy. Period, place, clan and source
type appear as chips directly under the title, before the body — an academic sees in two seconds
what the entry is and what it rests on.

**A missing source is designed.** `.unsourced` marks an entry or section with no attached source,
in ochre, on the entry itself. The brief asks that an entry without a source look incomplete; this
makes incompleteness a deliberate, legible state rather than an absence nobody notices.

**Empty and partial states.** Three are drawn in full rather than described: a town filed with
nothing yet (archive index), an accessioned-but-undescribed object (documents), and a new
researcher with no publications (profile). Each says what is missing and what would fill it. The
empty profile is an invitation with a specific, achievable next step — "a working paper or a
conference paper counts".

**Five doors.** The home page's second block is five explicit entry points, one per audience,
labelled by what the visitor is trying to do rather than by site section. A diaspora visitor, an
academic and an elder each reach their own way in without reading the page.

**One institution, three roles.** A persistent dark platform bar across the top of every screen
names ozikoro.com, ozituma.com and learn.ozituma.com with the current one marked, and carries
"Ozi Ikoro Limited" on the right. It is the same bar on all three sites; each site keeps its own
masthead and colour emphasis beneath it, so they are one institution and three recognisable tools.

**Typeface.** Noto Serif (headings and long-form) and Noto Sans (interface), with Noto Sans Mono
for references. Chosen for hard constraint 1: both carry `ị ọ ụ ñ Ị Ọ Ụ`, the precomposed accented
vowels and the combining tone marks, in every weight used and in italic, so no dotted vowel falls
back to a second face. `screens/type-test.html` proves it explicitly — dotted vowels at every size
and weight, roman and italic; marked dotted vowels (`ị̀ ị́ ọ̀ ọ́ ụ̀ ụ́`), which is the combination that
usually breaks; 12px, the smallest size in the system; and a tight-leading heading block of real
town names to check for collision. Body leading is 1.72 specifically so a tone mark never meets a
descender. Fallbacks are Charis SIL and Gentium Plus, both of which also carry the full set.

**No colonial framing.** Carried through the writing, not just the pictures. The example article
uses colonial district records for what they counted and explicitly sets aside their
characterisations, and says so in the body. Source type is a neutral field — "oral history",
"colonial record", "academic source" — with oral history given the same visual standing as the
other two, not a lesser one. No imagery of people, named places or documents appears anywhere.

**Fast and light.** No JavaScript at all in the deliverable, and none required by the design.
Search and filtering are plain `GET` forms that submit and reload, so results have bookmarkable,
citable addresses. The showcase home page uses real editorial images from the live Ozikoro site;
archive records without approved imagery retain deliberate CSS image plates. Webfonts degrade to
Georgia/system-ui.

**Recent archive hierarchy.** The home page gives the archive one large photographic field, while
all five recent histories use the same type size, spacing and action treatment beneath it. The image
sets the cultural register; it does not promote one article above the others.

**Accessibility.** One `h1` per screen and a real heading hierarchy through long documents; skip
link on every screen; `:focus-visible` ring in a blue that is never used decoratively, so a focus
ring is never mistaken for a link; filters are a real `fieldset`/`legend` form with labelled
controls; `aria-current` on navigation and on the step indicator; breadcrumbs in `nav`; tables use
`th scope="row"`. Body text is #1d1a16 on #faf6ef — about 15.5:1. The lightest text used,
`--ink-muted`, is about 5.1:1 and is never used below 13px.

## Mock content

Every screen carries a labelled banner saying the content is example material. Names, towns and
clans are plausible and diacritically correct (Ǹrì, Ọ̀nị̀cha, Ǹkwèrè, Agụ̀lụ̀, Ènugwu-Ukwu, Ụ̀mụ̀nrì,
Ọ̀hụ̀hụ̀); the researchers are invented and labelled as such. No statistic is presented as real: the
counts in filters and headers are labelled example figures. No photograph of a town, a person or a
document appears — plates are blank and say so. The About page states plainly where real
particulars must be supplied by Ozi Ikoro Limited and invents nothing in their place.

## Departures and additions

1. **`screens/type-test.html` is an extra file**, beyond the screens originally asked for. The brief calls
   the typeface the single most common silent failure and asks that it be tested explicitly; a page
   that can be reopened in any substitute face is the only durable form of that test.
2. **The 404 is treated as a citation-recovery screen** rather than a generic not-found. For a site
   whose value is permanence, the realistic 404 is a reader arriving from a citation, so the screen
   leads with the reference-number route and a search.
3. **Counts are shown in filters** (e.g. "Ụ̀mụ̀nrì 23"). They are labelled example figures. They are
   included because an archive that is openly thin should show how thin — hiding counts would read
   as concealment.
4. **The upload flow is one page showing all four steps in sequence**, with the step indicator at
   the top. In implementation each step should be its own page and its own `POST`, so the flow
   survives a dropped connection and needs no JavaScript; it is shown as one page here so the
   whole flow can be read in a single file.
5. **No dark mode.** Not asked for, and a warm-paper reading surface is the point.

## Shared foundation with the dashboards brief

`tokens.css` is intended to be the shared layer: the same type scale, the same 4px spacing rhythm,
the same colour semantics (indigo = source and citation, ochre = period and incompleteness, moss =
verified, the accent for action). The dashboards should take this file unchanged and differ in
density and surface, not in vocabulary.

## What an implementer should not copy literally

The inline `style` attributes used for one-off spacing in these files. They exist so each screen is
a single readable file; in the application they should become the spacing utilities or component
styles the app already has. Everything that carries a design decision — the tokens, the type scale,
the chips, the provenance block, the record table, the empty states, the rail, the steps — is in
`styles/main.css` and should be copied from there.


## Complete-experience expansion

The master blueprint is now represented by dedicated public support journeys and nine role-specific dashboard homes. Added screens cover donation, sponsorship and investor enquiries; Reader, Student, Teacher, Researcher, Independent Researcher, Community Knowledge Holder, Editor, Expert Reviewer and Admin workspaces; publishing, review, moderation, account and universal interface states. All values and activity are labelled demonstrations.

The About page uses only four people verifiably published by Ozikoro: Idenze Ezeme, Kosisochukwu Nzeribe, Chukwunwike Ossai and Chuka Odike. No approved portraits were publicly verifiable, so the design shows explicit portrait vacancies rather than substituting stock imagery. The live site has no established donation, sponsorship or investment programme; those pages therefore describe possible flows without claiming existing partners, amounts, returns or relationships.

Folklores is deliberately a separate reading register: a cover, contents and full story spread create the rhythm of an illustrated storybook. The article template uses a modern reading rail, visible evidence status, progress and compact mobile controls. Both retain permanent-source language and mobile readability.

## Calm reading, listening and market days
- Article and folklore readers share one warm-paper book page: central measure, contents drawer, page-turn navigation.
- Listen panel uses optional browser narration (reader.js); published audio needs narrator, rights and transcript. Text always stays readable without JavaScript.
- Igbo Market Days shows the modern date and the four days, but only converts after a verified community calendar is chosen — no universal anchor is claimed.
- Folklore library gives every story equal weight.

## Watch and archive discovery
- Watch uses a charcoal-and-gold screening-room treatment, but keeps the Ozikoro source-first language and emerald as a supporting archive colour.
- Public YouTube videos retain their real publisher names and direct source links. Ozikoro ownership is never implied; duration is omitted where it could not be verified.
- Video pages never autoplay, use privacy-enhanced embeds, keep a transcript-first low-bandwidth path visible, and reserve missing transcript text rather than inventing it.
- Collections, Journeys & Places and Topics A–Z add media-, location- and alphabet-based discovery without copying the reference site's colonial framing or blog structure.
- Corrections extend the existing contribution route and preserve a visible review trail instead of silently replacing a published record.

---

## Departure from the delivered design: the folklore reader

Recorded because this file is the reference and the change is deliberate.

The delivered folklore reader opened on a full-bleed hero image behind a scrim
(`.sx-folk-reader-hero` + `.sx-folk-reader-scrim`). The owner, having seen both, asked for the
history article's opening to be used instead — "especially the title and first image" — and for
the same treatment to carry folklores as well as histories:

> I prefer the design of inside page of history contents there, so use it to replace the one they
> did for folklores. It fits it better. Especially the title and first image, but use same design
> on history articles for folklore.

So `screens/folklore-reader.html` now opens with `.sx-article-opening` — the same title block and
first-image figure the article uses — and `.sx-folk-reader-hero` is no longer used anywhere.

The reading that supports the choice, beyond preference: the design notes justify `.provenance` as
carrying "the same visual weight as a pull quote" because an academic judges a site in seconds, and
the brief requires oral history to have "the same visual standing as the other two, not a lesser
one". A hero with a scrim reads as a storybook; an opening with a title, a first image and a source
note reads as a record. One design for both says a folktale is evidence.
