# What remains

> **RESUME HERE — status as of round 29.** This file is a running record, newest at the BOTTOM.
> Read this block, then the round-26 status table near the end; the middle is history.
>
> **Live and verified:** 16 public routes returning 200; a migrated record answers at its original
> WordPress address from this platform's own database and media origin; 3,437 of 3,488 media files
> served from our own storage with **zero hotlinks** (the 51 missing are 404 at source and the pages
> say so); typecheck 0 errors; 58 unit tests plus every suite green.
>
> **Done:** media into storage (1) · auth, ten roles and the byline claim path (2) · the editorial
> queue's machinery (3) · the research slice's public and review loop (4) · rights, consent and
> archaeology schema (5) · search with Knowledge/Research modes (6) · Ozituma entity linking (8) ·
> sitemap, heading order, alt text, contrast, JSON-LD, security headers, health endpoint, backup and a
> restore drill (10).
>
> **Not done:** the AI research assistant (9, needs a provider credential) · notifications ·
> deployment · manuscript upload · public screens for archaeology and oral history.
>
> **Blocked on the owner — nothing here will be invented:** the map and timeline screens (none exist
> among the 37 delivered designs) and the PostGIS decision (unavailable in PGlite) · `S3_BUCKET` and
> `HEALTH_TOKEN` for production · nonce-based CSP · backup scheduling and off-machine storage · media
> rights — **0 of 3,488 items has an actual licence.**
>
> **The largest gap is human:** **0 of 1,051 records linked to an entity.** The machinery is built and
> verified; the retagging is editorial work.
>
> **Four process lessons, learned the hard way — all cost real time:**
> 1. Assert on the artefact after writing, never on the script's own success message.
> 2. Kill a dev server **by port**; `pkill -9 -f node` killed the media download as collateral, and
>    `kill -9` while it held the PGlite lock corrupted the cluster and forced a full rebuild.
> 3. `timeout` does not exist on macOS — `timeout 120 node …` exits 127 and mimics a database failure.
> 4. Some importers are dry-run by default and say so only in a line a `grep` can hide:
>    `import:clans` and `import:learn` need `--apply`, and a root script whose body is another
>    `npm run` cannot forward flags.
>
> **Audit discipline:** in three separate rounds an audit script produced a *false positive* (the
> form-labelling failures, the uppercase-Igbo hit, one other). A check that reports a problem is as
> likely to be wrong as one that reports success — verify both against the artefact.


The build plan (`Ozikoro_DSH_Main_Agent_Repository_Audit_and_Core_Build_Plan.docx`) defines done in
§25 as "functional, not visual": every designed screen a real route, prototype data replaced by
database data, real content preserved and searchable, researchers publishing, sources and evidence
first-class, search across everything, maps querying real data, admin and review workflows working,
and the whole thing deployed. This file is the honest distance from here to there.

It is ordered the way §26 says to work, and it is the list the goal is measured against.

## Done

| | |
|---|---|
| WordPress extraction | 1,051 articles, 6 pages, 3,488 media records, 11 authors, 14 series, 11,056 labels — via the public REST API, no credentials needed |
| Archive schema | migration 0035 (entity spine, relations, sources, media, articles, claims, evidence, redirects, audit) and 0036 (pages separated from records) |
| Importer | idempotent, keyed on WordPress ids, re-runnable, with a report |
| Approved design | copied to `apps/ozikoro/public/design`, linked rather than rewritten, with the folklore opening changed to the article opening on the owner's instruction |
| Public vertical slice | home, article at its original URL, archive index, search, folklore, topics A–Z, labels, documents, media detail, about, 404, sitemap, robots |
| Content safety | allowlist sanitiser with 21 tests; Elementor styles and plugin shortcodes stripped |
| Archive integrity | data test asserting completeness, address preservation, no reserved-name shadowing, and that no source was invented |
| Spotify | the connection layer, tested, from the earlier round |
| Roles and permissions | migration 0037: `ozikoro_member`, `ozikoro_member_role`, `ozikoro_contributor_claim`, and 51 capabilities across the plan's ten roles; `packages/ozikoro/src/members.ts`; `requireCapability` enforcement; 46 tests |
| Editorial screen | `/admin/archive/` (the queue, ordered worst-documented first, with gap filters) and `/admin/archive/[id]/` (the record editor: facets, dictionary clan pick-list, source form, audit trail), behind `requireCapability('edit_entity')`. Verified end to end: sign in as an editor, save facets, attach a source, both audited |
| Entity pages | `packages/ozikoro/src/entities.ts` with the dictionary join; `/entities/` and `/entities/[slug]/`. The page reads ACROSS to Ozituma for the clan, its grouping, its states and its towns rather than restating them. Chronology rendered from the qualifier, so "circa 1200" is not printed as a year |
| Search | migration 0041: Postgres-generated `folded_*` columns on articles, entities, labels and publications, so `Ọ̀nịchạ` and `Onicha` are the same search. `packages/ozikoro/src/search.ts`: one implementation across seven kinds with Knowledge and Research modes, real facet counts, and canonical URLs on every result. `/search/` rebuilt with the mode switch. Tested |
| Rights | migration 0040: `ozikoro_media_rights` (holder, three separate permissions, basis, date, living-subject consent, restriction and take-down), `ozikoro_site`, `ozikoro_excavation`, `ozikoro_object`, `ozikoro_dating`, `ozikoro_oral_history`, `ozikoro_correction`. `packages/ozikoro/src/rights.ts` with the public statement generated from the record and a queue ordered by published exposure; `/admin/rights/` screen behind `manage_media_rights`. Tested |
| Research domain layer | migrations 0038 and 0039: `ozikoro_publication`, `_version`, `_author`, `_file`, `_review`, `_transition`. `packages/ozikoro/src/publications.ts`: the nine-state workflow as permitted transitions, versioning, review assignment, citations in APA/Chicago/MLA/BibTeX/RIS, and the researcher directory. **82 tests** |
| Editorial domain layer | `packages/ozikoro/src/editorial.ts`: the queue with per-record completeness, facet editing with validation, entity resolution that links the dictionary's 228 clans rather than duplicating them, source creation with evidence kind and citation stance, and an audit trail on every write |
| Media files | download of all 3,488 files (874 MB) under way and resumable; **2,419 of 3,488 media rows now serve from the archive's own origin** through `/media/<key>`, with the WordPress URL only as a fallback for files not yet fetched |
| Media serving | `apps/ozikoro/app/media/[...key]/route.ts` streams an archived file from object storage in production, or from the downloaded archive copy in development. Object keys are validated against the exact shape the importer writes, so path traversal is refused before any filesystem call. Verified: a real WebP served with its own content type, and `..`, an absolute path and a malformed key all 404 |

## Remaining

### 1. Media files into storage — SUBSTANTIALLY DONE
The download is running (2,485 of 3,488 files on disk) and 2,419 media rows are already linked and
served from the archive's own origin. Verified on a real article page: **1 image served from
`/media/ozikoro/...`, 0 hotlinks to `ozikoro.com/wp-content/...`**.

What remains is the last piece: **uploading the downloaded files to object storage** (S3 or R2, via
`getStorage()`), so the production deployment does not depend on a container filesystem. The route
already prefers object storage and refuses to serve from the local copy in production, with a warning
naming the file — so deploying before that upload would fail loudly rather than silently serving
nothing. The link step is re-runnable and picks up files as they arrive.

### 2. Authentication and the ten roles
Only the dictionary's four roles exist (contributor, editor, admin, owner). The plan names ten:
Reader, Student, Teacher, Researcher, Independent Researcher, Community Knowledge Holder, Editor,
Expert Reviewer, Moderator, Admin. Needs a role model that allows several roles per person, enforced
**server-side**, plus a claim path so the 11 real authors can take ownership of their bylines —
WordPress exposed no password hashes, so nobody can be migrated into an account.

### 3. Domain/API layer and the editorial queue — COMPLETE
Domain layer and screen both built and verified. The queue is at `/admin/archive/`, the record
editor at `/admin/archive/[id]/`, and one POST handler at `/api/admin/archive` covers every
editorial action behind `requireCapability('edit_entity')`.

Verified end to end against a real editor account: signed in, saved facets (source type, period,
status), attached a source, attached a dictionary clan, and confirmed both writes landed in
`ozikoro_audit` with the actor named. A refusal path was exercised too — attaching a place with no
clan chosen returns a readable error rather than failing silently.

The scale of the human work is measured rather than estimated: of 1,051 records, **1,051 have a
series** (carried from the WordPress categories), and **0 have a source type, a period, an entity
relation or a source.** That is the queue, and editors can now work it.

**A routing regression was found and fixed during this work, and it mattered.** Enabling
`trailingSlash: true` to serve the archived `/<slug>/` addresses also rewrote every API route to a
slashed form: `/api/auth/signin` became a 308, breaking form posts, and the production callback
became a 308 from `/api/spotify/callback` to `/api/spotify/callback/`. The callback address is fixed
by the Spotify Developer Dashboard. Three approaches were measured — `trailingSlash` alone, a
`rewrites()` entry, and a middleware rewrite — and none of the rewrites pre-empted Next's
normalisation. The working configuration is `trailingSlash: true` with
`skipTrailingSlashRedirect: true`, plus a middleware rewrite that sends the slash-less page form
internally. Result: `/<slug>/` serves 200 at the exact published address, `/<slug>` also serves 200,
and every `/api` route is untouched in both directions.

### 4. Research vertical slice — DOMAIN LAYER DONE, SCREENS REMAIN
Built and tested: the nine-state workflow as permitted transitions rather than a status column,
with every change written to `ozikoro_publication_transition`; immutable versions; author lists with
external co-authors; review assignment and completion; the researcher directory; and citations in all
five styles.

**The rule the plan cares about is enforced in data, not in a badge:** `peer_reviewed` is written in
exactly one place — the transition out of `expert_review` — and only when a completed expert review is
recorded. A work published by an editorial route is published and is *not* peer-reviewed, and its page
says so in different words. Both paths are tested.

**Public screens built and verified:** `/publications/` (the repository, listing only what is
published and public, with a chip stating whether each work completed peer review),
`/publications/[slug]/` (the work, with all five citation styles ready to copy and the review
sentence generated from the record), `/researchers/` (the directory), and `/researchers/[slug]/`
(the profile, with the design's invitation state for a researcher who has published nothing yet).

Verified against real fixture data, and the distinction that matters held in the rendered HTML: the
work that completed expert review says *"was peer-reviewed"* and not the opposite; the work published
by an editorial route says *"has not been peer-reviewed"* and explains that it went through editorial
screening only. Fixtures removed afterwards; 0 residue.

**The full loop is built and verified end to end.** `/submit/` (create and submit, with the author's
own work at every state including private drafts), `/admin/reviews/` (the editor's queue, offering only
the transitions the workflow actually permits), and `/reviews/` (the reviewer's own queue, with the
recommendation required and private comments kept separate).

Exercised with three real accounts in three roles: an independent researcher submitted a work; an
editor screened it, put it under review, sent it for expert review and assigned a reviewer; the
reviewer completed the review with a recommendation; the editor accepted and published it; and the
published page then said **"was peer-reviewed"** and not the opposite. Fixtures removed; 0 residue.

**Not yet built from this item:** manuscript file upload to object storage — `ozikoro_publication_file`
exists and is unused, and the submit page says so plainly rather than showing a control that would
discard the file. Also the research network pieces that are separable from the publication flow:
projects, groups, datasets, fieldwork, and structured research questions.

Also outstanding from this item: file upload to object storage (`ozikoro_publication_file` exists and
is unused), research projects, groups, datasets and fieldwork, and structured research questions —
the plan lists these under the research network but they are separable from the publication flow.

### 5. Archaeology, archive and oral history — SCHEMA AND RIGHTS DONE
Migrated: `ozikoro_site`, `ozikoro_excavation`, `ozikoro_object`, `ozikoro_dating` (result and
uncertainty as separate fields, because one object may have several measurements that disagree),
`ozikoro_oral_history` (narrator, recorder, community, language, transcript and translation kept
apart, consent as a state that can be withdrawn rather than a deletion), and `ozikoro_correction`
(proposed, decided, with the previous value kept so nothing is overwritten silently).

**Media rights are now first-class and the biggest gap is closed in software.** 0 of 3,488 items had
a licence; the archive now has a place to record one, with three separate permissions rather than a
licence string, the basis for the permission, the date, whether the person depicted is living and
whether they consented, restriction, and take-down tracking. The public sentence is generated from
the record and **states both what is permitted and what is not** — silence about a restriction reads
as permission, which is the one thing it must never do.

Verified: `/admin/rights/` renders the exposure figure (article placements resting on unchecked
items), the queue ordered by exposure, and the editor form. Recording rights works; permitting
publication without a stated basis is refused.

**Still to build from this item:** the public screens for archaeological sites, objects and oral
histories; the community correction submission form; transcript-first media access; and the
editorial screens for the archaeology tables. The schema and the rights layer are ready for them.

### 6. Search and discovery — CORE DONE
One search across seven kinds — articles, entities, labels, media, sources, publications and
researchers — with **Knowledge** and **Research** modes as a filter over one implementation rather
than two query paths that would drift.

**Diacritic-insensitive, and that is the part that mattered.** Postgres folds the index
(`regexp_replace(normalize(name, NFD), '[\u0300-\u036f]', '', 'g')`, verified to turn `Ọ̀nịchạ` into
`Onicha`) and the dictionary's own `toSearchForm` folds the query, so `@ozituma/core` decides what
"the same word" means and both sites agree. Verified in the running page: **the plain and decorated
spellings both return 40 results**, and only one was predictable before.

Every result is typed and carries a canonical URL, and the page says how it matched — in the text, on
the author, or on another spelling — so a result is explicable rather than mysterious.

**Entity pages built.** I recorded last round that search emitted `/entities/<slug>/` links to a route
that did not exist. Checked rather than assumed: **the graph is empty, so search emitted zero such
links** — the dead link was latent, not reachable. It is closed now anyway, because the first editor to
link a record would have created it.

`/entities/[slug]/` is where the "one institution, three roles" boundary stops being a slogan. The
dictionary already holds the clan, its grouping, its present-day states and its towns; the archive holds
the histories. `entity.dictionary` is the join, and the page shows both with a link across to Ozituma
rather than a copy of it. Verified against a real dictionary clan: the page renders the clan, the
dictionary's towns, the linked history, and `ozituma.com/clans/11`; a folded query finds it through
search; an unknown slug is a 404.

Chronology is rendered from the qualifier — `circa 1200`, never a bare `1200` — because those are
different claims and printing the number alone makes the stronger one by accident.

**Still to build from this item:** facets beyond kind (region, period, evidence type, language, date),
which need the entity data populated first; fuzzy matching for typos; and the editorial screen that
creates entities, which is item 3.

### 7. Maps and timeline
PostGIS, layers for peoples, languages, communities, polities, sites, settlements, events, museums,
routes and migrations; timelines with exact, circa, range and uncertain dates; historical boundaries
carrying their source.

### 8. Ozituma integration
Link clans, towns, peoples and languages to the dictionary's own records rather than duplicating
them; consume its API; respect its dictionary-first rule so nothing invents a word or a gloss.

### 9. AI research assistant
Only after structured data and search work. Retrieval over approved records with citations attached
to claims, evidence status shown, sourced fact separated from model synthesis, and an ingestion trail
so an answer can be traced. The dictionary already has an AI gateway with guardrails and spend limits
to reuse.

### 10. Notifications, SEO, accessibility, security, deployment
Email notifications with preferences and a delivery queue; the remaining screens (donate, sponsors,
investors, academy, watch, listen, collections, journeys, market-days, upload, publication,
researcher profile, and the eight dashboards); Open Graph images and full structured data;
accessibility audit; rate limits across the API; observability, backups with a tested restore,
staging, and the production deploy behind `ozikoro.com/api/spotify/callback` and every archived URL.

## Known gaps and decisions outstanding

- **Media rights.** 0 of 3,488 items has a recorded licence. WordPress had no field for one. This is
  an editorial and legal task: sourcing attribution, and withdrawing anything that should not be
  published. No code invents a rights statement.
- **The design update.** The owner reported publishing an updated design, but
  `idenze/calm-comfort-construct` is still at `b67a92f`, byte-identical to what is implemented. The
  location is needed before anything can be re-synced.
- **`/topics/` is ~1 MB per request.** Pagination or a lighter payload is needed before production.
- **One untitled record** (WordPress 3774). It renders as "Untitled record" and its stored title stays
  empty so the editorial queue can see it.
- **The 11 WordPress authors** are attribution rows, not accounts, and cannot be otherwise: no
  endpoint exposes a password hash.

## How this stays honest

Three rules from the plan are treated as tests rather than intentions, and each has an assertion
somewhere in the suite: no record, source, rights statement, citation or statistic is invented; no
demonstration content is labelled real; and the archive states its own incompleteness on the page
rather than implying a provenance it does not have.

---

---

## ROUND 12 — RESOLVED. THE DATABASE WAS REBUILT AND THE BUG IS FIXED.

The locked PGlite cluster could not be recovered by clearing the pid file, by writing a stale lock
with a dead PID, or by any other means. It was moved aside intact and the database rebuilt:

    .data/pg.locked-20261001     (130 MB, preserved, safe to delete once confident)

Rebuild order, all run and verified — note the two that need `--apply` or they only report:

    npm run db:migrate
    npm run seed
    npm run import:igbo
    npm run import:clans -- --apply      # WITHOUT --apply this only prints a preview
    npm run import:learn -- --apply      # likewise
    npm run import:ozikoro-archive
    npm run import:media-store           # re-links storage_key; add --apply to write

Verified after rebuild: 1,051 articles · 3,488 media (3,217 linked to our own origin) · 11
contributors · 228 clans · 8,728 words · 0 type errors · every suite green.

### The `manage_contributors` bug — root cause and fix

The capability was held by **NOBODY**. Not a test error: the role table genuinely granted it to no
role, so the claim decision was impossible for anyone including administrators, and a claim would
have sat pending forever.

Root cause found by asking the table rather than assuming the test had granted the wrong role:

    select role from ozikoro_role_capability where capability = 'manage_contributors';
    -> no rows

Fixed in migration `0042_grant_manage_contributors.sql`, granting it to `editor` (who curates the
archive) and `admin` (who must never be locked out), and deliberately not to `moderator`,
`expert_reviewer` or any contributor role — a byline is not a self-service field.

Verified end to end after the fix: an editor holds the capability, an author's claim is granted, the
contributor is linked to the account, the claimed byline leaves the claimable list (11 -> 10), and
**314 records become credited to that author**. Test fixtures removed; 0 residue.

### Lessons, because these cost real time

1. **Never `pkill -9 -f node`.** It killed the media download (3,217 of 3,488 files) as collateral.
2. **Never `kill -9` the dev server while it holds the PGlite lock.** That is what corrupted the
   cluster and cost a full rebuild.
3. **`timeout` does not exist on macOS** — `timeout 120 node ...` exits 127 and mimics a database
   failure. Several diagnostics were wasted on it.
4. **Some importers are dry-run by default and say so only in a line that a `grep` filter can hide.**
   `import:clans` and `import:learn` silently did nothing during the first rebuild for exactly this
   reason. Read the header, or check the row counts afterwards, rather than trusting a filtered line.

### Still outstanding

* Media download resumed (job `bash-2732`); 3,217 of 3,488 on disk. Re-run `npm run import:media-store`
  afterwards to link the new files.
* Manuscript upload to object storage (item 4).
* The 1,051 records still need linking to entities — item 3's machinery is verified and waiting.
* 0 of 3,488 media items has a recorded licence; the software exists, the editorial work does not.

### npm argument forwarding — the flag was silently dropped

`npm run import:ozikoro-wp -- --binaries` does **not** download media. The root script is:

    "import:ozikoro-wp": "npm -w @ozikoro/platform run import:wordpress"

which re-invokes npm without forwarding its arguments, so `--binaries` is consumed by the outer npm
and never reaches the inner one. The run appears to succeed, re-extracts the metadata JSON, and prints
its own advice to "pass --binaries to fetch them" — which is what it was just told to do.

The working invocation targets the workspace script directly:

    npm -w @ozikoro/platform run import:wordpress -- --binaries

Running (job `bash-2736`), 3,259 of 3,488 and climbing. Afterwards run
`npm run import:media-store -- --apply` to link the new files to `/media/<key>`.

**General rule for this repo:** a root script whose body is another `npm run` cannot forward flags.
Check the script body before trusting `-- --flag`.

---

## ROUND 13 — MEDIA VERIFIED AT SCALE, AND TWO FINDINGS ABOUT ITEM 7

### Item 1 is now verified, not just built

Re-linked after the download resumed, then sampled through the running app:

    12 randomly chosen images -> 12 served HTTP 200 with real bytes (1,444 KB total), 0 failures
    article page -> 1 image from /media/ozikoro/…, 0 hotlinks to ozikoro.com/wp-content/…

**3,297 of 3,488 media items (95%) now serve from the archive's own origin**, up from 0 at the start
of this work. The remaining 191 are still downloading.

### Finding 1: PostGIS is not available

    select count(*) from pg_available_extensions where name = 'postgis';   ->  0

PGlite cannot load it, so maps cannot be built on PostGIS locally. This needs a decision rather than a
workaround: either the production database is a full Postgres with PostGIS (in which case maps should
be written against PostGIS and simply cannot be exercised locally), or the archive uses plain
`double precision` latitude/longitude with bounding-box queries, which is enough for the pins this
archive actually holds and needs no extension.

**Do not silently pick one.** The choice affects production and belongs to the owner.

### Finding 2: the approved design has no map or timeline screen

All 37 screens were listed. There is no map and no timeline:

    404, about, academy, archive-index, article, collections, dashboard-account, dashboard-admin,
    dashboard-editor, dashboard-independent-researcher, dashboard-knowledge-holder,
    dashboard-moderation, dashboard-reader, dashboard-researcher, dashboard-review,
    dashboard-reviewer, dashboard-states, dashboard-student, dashboard-teacher, dashboard-workflow,
    documents, donate, folklore-reader, folklore, home, investors, journeys, listen, market-days,
    publication, researcher-profile, sponsors, topics, type-test, upload, watch-video, watch

The build plan lists "maps and timeline on PostGIS" as item 7, but no approved design exists for
either screen. Building them would mean **inventing design**, which the objective forbids: *"keep the
design as the approved reference implementation."*

`market-days.html` and `journeys.html` are the nearest things and are not a map or a timeline.

**Question for the owner:** where are the map and timeline screens, or should item 7 wait for them?

### A related caution about the timeline

All 1,051 articles have a date, but they span **2024-08-26 to 2026-09-29** — those are *publication*
dates from the old site, not historical dates. A timeline drawn from them would be a publishing
schedule, not Igbo history, and presenting it as the latter would mislead. Real historical chronology
needs `ozikoro_entity.date_start`, which is populated for **0 entities** because the retagging (item 3)
has not been done.

---

## ROUND 14 — ITEM 1 COMPLETE: THE MEDIA IS IN OBJECT STORAGE

### What was built

`packages/ozikoro/src/import/media-upload.ts` — uploads the archive's media through
`getStorage().put()`, the same call the serving route reads back through. Using the real driver means
the local run exercises the production code path; only the driver differs. It asks storage whether
each key is already present and skips it, so it is resumable and idempotent across the long run.

Guarded by `assertStorageIsSeparate()`, which refuses to run if the archive directory is inside the
storage root — that would read each file and write it over itself, and a partial failure would damage
the only copy. Checked rather than assumed.

    npm run import:media-upload                    # check only
    npm -w @ozikoro/platform run import:media-upload -- --apply

(The second form is required: the root script is another `npm run` and cannot forward flags — the trap
recorded in round 12.)

### Verified, including the decisive test

    3,407 of 3,488 media items linked and uploaded; 763 MB; 0 failures; 0 missing on disk

The evidence that it is genuinely serving from object storage, not the local copy: the archive
directory was **renamed away**, and the media route still returned the file — HTTP 200, 23,816 bytes,
**byte-identical** to the response with the directory present. It can only have come from storage.

### A mistake I made, and its cost

Renaming the archive directory as a test was unsafe while the download job was still running: the
downloader **recreated** `data/media/ozikoro-wp/` during the test, so restoring the renamed directory
moved the original archive *inside* the new one — 3,396 files nested one level down.

Nothing was lost (3,407 files present throughout), and `mv -n` merged them back cleanly because the
file names are unique (`<wpId>-<name>`). But the lesson is real: **do not move a directory out from
under a running job that writes to it.** Stop the writer first, or test with a copy.

While running the media download in future: kill it with `job_kill`, never `pkill`, and never move its
target directory.

### Remaining

* 81 media files still downloading (job `bash-2769`). After it finishes:
  `npm run import:media-store -- --apply` then
  `npm -w @ozikoro/platform run import:media-upload -- --apply`.
* **Production still needs `S3_BUCKET` set.** The driver is currently `local`, writing to
  `.data/media`, which is ephemeral on a container platform. The upload step exists and works; the
  bucket is a deployment decision for the owner.
* Item 7 (maps, timeline) still waits on the design and PostGIS answers recorded in round 13.

---

## ROUND 15 — ITEM 1 CLOSED: ZERO HOTLINKS REMAIN

### The last 81 files do not exist any more

Sampled and measured: **10 of 11 returned HTTP 404**, and the pattern held across the set. These
files are **gone from the old WordPress site**, not merely not-yet-fetched. The archive holds their
metadata and always will; it does not hold the files, and cannot.

Final position: **3,437 of 3,488 media items held, linked and in object storage. 51 unavailable.**

### The defect that finding exposed

`MediaRecord.url` fell back to the WordPress URL when the archive had no copy. For those 51 items the
documents page therefore rendered an `<img>` pointing at a **404 on the site this archive exists to
replace** — a broken picture *and* a re-established dependency, in the one place item 1 was meant to
remove it.

Fixed: `url` is now **only ever our own address**, and a new `held` flag distinguishes "we have the
file" from "we have only the record". The page states the absence plainly — that the file is no longer
available at its original address, with the address kept as provenance — instead of showing a broken
image.

**Verified on both states through the running app:**

    not-held item -> says the archive does not hold it, explains the 404, keeps the address
                     as provenance, renders NO <img>, no hotlink
    held item     -> renders from /media/ozikoro/…, no hotlink, no not-held notice

**Every hotlink to `ozikoro.com/wp-content/` is now gone from the archive.**

### A process failure worth recording

I wrote an edit to `media.ts`, printed a success message, and moved on — **without checking the file**.
The replacement had not matched and nothing changed; the type checker only caught it several steps
later when the page referenced a field that did not exist. Two subsequent attempts also failed on
indentation, because a `sed 's/^/  /'` I used to indent output for reading had made 2-space
indentation look like 4.

The rule this project has already taught me twice, restated because I broke it again: **print success
only after re-reading the artefact, and use whitespace-agnostic matching when a file's indentation is
not certain.**

---

## ROUND 16 — SEO: THE SITEMAP WAS SHOWING A CRAWLER 8% OF THE ARCHIVE

### What was wrong

The old `sitemap.ts` listed 1,051 articles and 3 topics, and **omitted 11,056 subject pages and 3,488
media pages** — the bulk of what the archive holds. It also emitted `/archive` and `/about` **without a
trailing slash**, while the site serves with `trailingSlash: true`, so the sitemap was naming
non-canonical addresses and asking crawlers to index redirects.

The cause was structural rather than careless: the sitemap was assembled from whichever list functions
its author remembered, so whatever was forgotten was silently absent.

### What it is now

`packages/ozikoro/src/seo.ts` holds one enumeration, `listIndexableUrls`, so the question "what is
indexable?" has exactly one answer. `sitemap.ts` is a thin mapper over it.

    before:  ~1,054 urls, 0 slugs with a trailing slash on the fixed routes
    after:   14,667 urls, 0 without a trailing slash, 0 duplicates

    labels      10,100   (only subjects with at least one record — an empty page is a thin page)
    documents    3,489   (3,488 media + the index)
    articles     1,051   (at their original addresses)
    topics          15
    plus fixed routes, WordPress pages, entities, publications, researchers

### Two real duplicates, found by measuring rather than assuming

`/about/` was listed twice — once as a fixed route and once because it is one of the six migrated
WordPress pages — and two media records share a slug. Both are collisions in the **data**, so the fix
is a dedupe on the way out rather than chasing each case; more will appear as the archive grows. The
first entry wins, so the fixed high-priority routes keep their priority.

Verified after: **0 duplicates**.

### Still outstanding for item 10

* **JSON-LD only on three page types** (articles, publications, entities). The archive index, topics,
  labels and media pages have none.
* **Accessibility has not been audited at all** — no skip-link, focus-order, contrast or heading-level
  check has been run. This is the larger half of item 10 and is untouched.
* Notifications, security hardening, monitoring, backups and deployment: untouched.

---

## ROUND 17 — ACCESSIBILITY AUDIT: WHAT IS FINE, WHAT IS NOT

An audit was run over the rendered HTML of ten public pages, checking heading order, image alt text,
form labelling and single-h1. Results, measured rather than assumed:

    every page has exactly ONE h1 ................. pass on all 10
    every image has alt text ...................... pass on all 10 (0 images without alt)
    heading order ................................. FAILED on /, /about/, /archive/, /documents/, /folklore/
    form controls labelled ........................ FAILED on /, /archive/, /documents/, /publications/,
                                                    /researchers/, /search/, /topics/

Already correct in the layout and untouched: `lang="en"`, a skip link to `#main`, a `<main id="main">`
landmark, `<nav aria-label="Primary">`, `:focus-visible` with a 3px outline, `prefers-reduced-motion`,
and a `.visually-hidden` utility.

### The heading-order problem is the design's, not a coding slip

The approved design's screens use **h1 then h3** — `archive-index.html` and `documents.html` both do.
The markup reproduced that faithfully, which is why the audit found it. But it is an invalid order: a
screen reader user navigating by heading hears the page title and then nothing until a list of items.

The stylesheets style headings **by element** (`h3 { … }`, `h4 { … }`), so re-levelling the entries to
h2 would visibly change the approved design. That is the conflict, and it is a real one:

* the objective says *"keep the design as the approved reference implementation"*, and
* WCAG requires a valid heading order.

**Resolution taken:** supply the missing level as a **visually hidden h2**, which the design implies
but does not draw. The order becomes valid, the design is untouched, and the list gains a landmark to
jump to.

    /archive/   before: h1 h3 h3 h3   ->  after: h1 h2 h3 h3 h3   (0 skips)
    /documents/ before: h1 h3 h3 h3   ->  after: h1 h2 h3 h3 h3   (0 skips)

**Still to do — three pages remain, all measured:**

    /            h1 h3 h3 h3   1 skip
    /folklore/   h1 h3 h3 h3   1 skip
    /about/      h1 h4 h4 h4   1 skip   <- worse; jumps two levels, needs its own look

`/about/` is the one to investigate rather than pattern-match: h1 straight to h4 means a whole level is
missing above the entries, so it needs either an h2 and h3 or a different fix.

### Form labelling still to fix

Seven pages have unlabelled controls. The search inputs on `/`, `/archive/`, `/documents/` and
`/topics/` are the likely set; each needs a `<label>` or an `aria-label`.

### A note on quality

Three attempts at the archive edit failed before the fourth worked: the first did not match and I
printed success anyway, and the next two put the comment inside a ternary's expression slot where a
comment plus an element is two children and a syntax error. The lesson already recorded twice in this
file — **assert on the file, not on the script's own output** — and a new one: read the surrounding
syntax before inserting into JSX.

### Untouched in item 10

Notifications; security hardening; monitoring; backups; deployment. JSON-LD still exists on only
three page types.

---

## ROUND 18 — A CORRECTION: THE FORM-LABELLING FAILURE I REPORTED WAS NOT REAL

**Round 17 claimed "form controls labelled: FAILED on 7 pages". That was wrong, and it was wrong
because my audit script had two bugs, not because the site had two problems.**

1. I excluded `type="search"` from the check — reading it as a button type. It is a real text control,
   so the search box on `/`, `/archive/`, `/documents/`, `/publications/`, `/researchers/`, `/topics/`
   and `/search/` was flagged for being exactly what it is.
2. I only looked for explicit `for`/`id` association and `aria-label`. **Wrapping an input inside a
   `<label>` is also valid labelling**, and that is how this site does it:
   `<label class="small"><input type="radio" name="order" … /> Newest first</label>`.

Re-audited properly, counting implicit labels:

    TOTAL controls across the ten pages: 9
    genuinely unlabelled: 0

**There is no form-labelling defect. Nothing needed fixing and nothing was changed.**

This matters more than the audit did. A wrong claim in this file is worse than no claim, because the
next person — or the next round of me — will act on it. The lesson is not "audit more carefully"; it is
that **a check which reports a failure has to be verified before the failure is believed**, exactly as
a passing check does.

### The heading-order fix is real, and now covers four pages

Round 17 fixed `/archive/` and `/documents/`. This round fixed `/` and `/folklore/`, same cause: the
approved design jumps from h1 to the h3 titles of its entries, and the stylesheets style headings by
element, so re-levelling would change the design. A visually hidden h2 supplies the missing level.

    /            h1 h3 h3 h3  ->  h1 h2 h3 h3 h3   (0 skips)
    /folklore/   h1 h3 h3 h3  ->  h1 h2 h3 h3 h3   (0 skips)

Verified on the rendered pages, not in the source.

### /about/ is a different problem and is NOT fixed

    /about/   h1 "About US"  ->  h4 "Welcome to Ozikoro", h4 "Our Aim", h4 "What We Do"

Those h4s are **authored headings inside the migrated WordPress page content**, not headings this
codebase emits. The page renders what was written on the old site, and the author had used h4.

The fix is not a visually hidden heading — a jump to h4 skips a whole level and one hidden h2 would
still leave 2 -> 4 invalid. It needs the migrated content's headings **normalised into the site's
outline**, which means a heading-offset pass in the sanitiser: shift each content's headings so its
shallowest becomes h2. That applies to every migrated record, not just this page, and it changes the
rendered markup of 1,051 articles — so it is a deliberate decision, not a quick patch.

**Open, with the diagnosis recorded rather than a guessed fix.**

---

## ROUND 19 — HEADING ORDER FIXED ARCHIVE-WIDE (AND /about/ WITH IT)

### The scope was measured before anything was built

`/about/` looked like one page's problem. It is not. Eight article pages were sampled and headings
counted on the rendered output:

    before:  5 of 8 article pages skipped a heading level
             [1, 4, 4, 4, 4, 4, 4, 4]   h1 (the record's title) straight to h4 (its first section)

The cause is the migrated WordPress content, which uses `<h4>` for its authored section headings. That
is roughly 60% of the 1,051 records, so this was never a one-page fix.

### The fix: normalise each record's headings into the site's outline

`normaliseHeadingLevels` in `packages/ozikoro/src/content.ts`, applied inside `prepareArchiveHtml` so
it covers every migrated record and page rather than each screen separately.

**Adaptive, not a fixed offset.** The records do not agree with each other — some already start at
`<h2>` and are correct, others start at `<h4>`. A fixed shift would break the ones already right. So
the offset is computed per record: the shallowest heading it actually uses becomes `h2`, and every
other heading moves by the same amount, preserving the author's relative structure exactly. A record
already at `h2` has an offset of zero and is returned untouched — the majority.

Verified on the rendered pages:

    article sample   before: 5 of 8 skipped   ->   after: 0 of 8
    /about/          [1,4,4,4]                ->   [1,2,2,2]
    /                [1,3,3,3]                ->   [1,2,3,3,3]
    /folklore/       [1,3,3,3]                ->   [1,2,3,3,3]
    /archive/        [1,3,3,3]                ->   [1,2,3,3,3]
    /documents/      [1,3,3,3]                ->   [1,2,3,3,3]

**Accessibility is now clean on heading order and image alt text across every page checked.**

### A wrong rule, caught by a test rather than by a reader

The first version returned early when the shallowest heading was `h2` or deeper, on the reasoning that
only a heading *above* h2 was a problem. That was wrong: a record whose headings are all `h4` still
skips, because the page's `h1` is followed by `h4` with h2 and h3 missing. **Depth in the source is
not the question; the question is whether the content's top level sits directly beneath the page
title.** Nine cases now pass, including the one that failed.

### Still outstanding for item 10

* **JSON-LD on three page types only** (articles, publications, entities). The archive index, topics,
  labels and media pages have none.
* **Not audited:** colour contrast, keyboard focus order through each page, landmark completeness,
  link-text quality, form error messaging.
* **Untouched:** notifications, security hardening, monitoring, backups, deployment.

---

## ROUND 20 — JSON-LD ON ~13,600 MORE PAGES, AND THE HEADING RULE PINNED BY TESTS

### JSON-LD was on three page types; now on five

It existed on articles, publications and entities. Added to:

* **`/documents/[slug]/`** — 3,488 media records, emitted as `ImageObject` (or `MediaObject`), with
  creator, credit, caption, date, dimensions, format and `contentUrl`.
* **`/labels/[slug]/`** — 10,100 subject pages, emitted as `CollectionPage` with `about`.

`CollectionPage` rather than `Thing` for a subject is deliberate: the page is a list of records
*concerning* something, not the thing itself, and marking it up as the thing would claim the archive
IS the subject.

**The licence rule holds in the machine-readable output too.** `license` is emitted only when a licence
has actually been recorded. Verified on a real media page:

    has license field:    False     <- correct: 0 of 3,488 items has a recorded licence
    has creditText field: False     <- correct: no credit recorded either
    contentUrl present:   True

Emitting a licence the archive does not hold would be the same overstatement the rights module exists
to prevent — made to a crawler instead of a reader.

Both were verified by fetching the rendered pages, parsing the JSON, and checking the `@type`:
`CollectionPage` on `/labels/igbo/`, `ImageObject` on `/documents/obi-ikechukwu/`.

### The heading rule is now pinned by tests

Round 19's `normaliseHeadingLevels` was tested ad hoc, which is not tested. Eight cases are now in
`content.test.ts`, including **the case the first implementation got wrong** — a record whose headings
are all `h4` still skips, so it must be normalised rather than exempted.

    test suite: 50 -> 58 tests, all passing

### Still outstanding for item 10

* JSON-LD on the archive index, topic pages and researcher profiles.
* **Not audited:** colour contrast, keyboard focus order, landmark completeness, link-text quality,
  form error messaging.
* **Untouched:** notifications, security hardening, monitoring, backups, deployment.

---

## ROUND 21 — CONTRAST AUDITED: ONE REAL FAILURE, IN THE DESIGN'S OWN TOKEN

### The audit

Every colour pair the design actually uses was measured against WCAG 2.1 AA — 21 pairs across the
paper, raised and sunk grounds, the four chip washes, and the night palette. **Twenty passed. One
failed:**

    --ink-faint #8d8577 on --paper #f7f1e3 = 3.24:1     (AA needs 4.5:1 for normal text)

It is not marginal and it is not only for disabled controls, which WCAG exempts. The design uses it
for **real text** in three places, all in `main.css`:

    .search input::placeholder   placeholder text
    .rail .count                 a count beside a filter
    the empty-state line         the sentence a reader sees when a filter matches nothing

An empty state a reader cannot read is the worst of the three, because it is the only thing on screen.

### Why it could not be fixed from the application's stylesheet

The app's `globals.css` already carries `--ink-faint: #6f685c`, which passes at 4.89:1. **That value
was dead.** Both stylesheets define `:root` with equal specificity, so document order decides, and the
rendered order is:

    1. /_next/static/css/app/layout.css   (ours, contains globals.css)
    2. /design/styles/main.css            (the design, @imports tokens.css)
    3. /design/styles/showcase.css
    4. /a11y.css                          (added this round)

The design loads last and therefore wins every token name the two share. A correction has to come
after it.

### The fix

`public/a11y.css`, linked **last**, changing one token and nothing else:

    --ink-faint: #655d51

Measured on every ground the design puts faint text on:

    paper #f7f1e3        5.76:1
    paper-raised #fffdf8 6.38:1
    paper-sunk #efe6d2   5.23:1
    accent-wash #e2efe8  5.48:1

The design's own `--ink-muted` (#6b6358) would also pass, but using it would make faint and muted
identical and lose a distinction the design draws on purpose. #655d51 keeps that distinction and still
clears 4.5:1 on the darkest ground.

**This is the only change made to the delivered design's appearance, and it is an override rather than
an edit — the design files are untouched.** It should be folded back into the design rather than
carried forever, and that is a decision for the owner.

### Still outstanding for item 10

* **Not audited:** keyboard focus order through each page, landmark completeness, link-text quality,
  form error messaging, and whether the Igbo dotted vowels and tone marks render in every font weight
  and italic (the design's own brief flags this as its hardest constraint and it has not been tested).
* JSON-LD still absent on the archive index, topic pages and researcher profiles.
* **Untouched:** notifications, security hardening, monitoring, backups, deployment.

---

## ROUND 22 — THE DESIGN'S HARDEST CONSTRAINT: IGBO DIACRITICS, TESTED

The design brief calls it "the hardest constraint": the typeface must carry Igbo properly — ị ọ ụ ṅ and
the tone marks, at every size and weight, roman and italic. Round 21 recorded it as untested. It has
now been tested, in three parts, and **it passes on all three.**

### 1. The content actually exercises it

    31 of 1,057 published records have Igbo diacritics in the title
    46 media records likewise

A small proportion, but they exist and they are real — this is not a font question asked in the
abstract.

### 2. The font faces cover every character

The Google Fonts CSS was fetched with a modern user-agent (older ones are served a format with no
`unicode-range`), giving 78 `@font-face` blocks and 1,026 range entries. Every required code point
falls inside a declared range:

    ị U+1ECB   ọ U+1ECD   ụ U+1EE5   ṅ U+1E45   ẹ U+1EB9     all covered
    Ị U+1ECA   Ọ U+1ECC   Ụ U+1EE4   Ṅ U+1E44   Ẹ U+1EB8     all covered
    combining grave U+0300   combining acute U+0301          both covered

Both cases matter independently: the uppercase forms are needed because the design uses
`text-transform: uppercase`, and the combining marks are needed because tone is written as a separate
character and a font can carry the vowel without the mark.

### 3. Nothing uppercases Igbo text

`text-transform: uppercase` appears in eight selectors. Each was checked against the rendered markup:

    .eyebrow  .platform-bar .owner  .wordmark span  .chip .k
    .record th  .rail legend  .stat span  .site-foot h4

**No Igbo text sits inside any of them.** `.chip .k` is the only one that could have carried a label,
and the page renders **zero elements with class `k`** — the rule never applies. The eight chips on the
page tested carry English subjects (Southeastern Nigeria, Igbo philosophy, Ogo title, Igba Nkwu).

### A false positive, caught twice, and why it matters here

The first pass reported "1 diacritic inside an uppercased element". It was wrong: my regex matched
`class="chip"` broadly, and the match it found was the **`<title>` element**, which has no class at
all and is never uppercased.

This is the third audit in three rounds to produce a false positive — after the form-labelling claim in
round 17 and the two-bug audit corrected in round 18. The pattern is consistent: **a check that reports
a problem is as likely to be wrong as a check that reports success, and both have to be verified
against the artefact before either is believed.**

### Still outstanding for item 10

* Not audited: keyboard focus order, landmark completeness, link-text quality, form error messaging.
* **Italic diacritics are covered by range but not visually confirmed.** The ranges include the
  italic faces and the code points, which is strong evidence, but nobody has looked at the rendered
  glyphs. That needs a browser and, ideally, a reader of the language.
* JSON-LD still absent on the archive index, topic pages and researcher profiles.
* Untouched: notifications, security hardening, monitoring, backups, deployment.

---

## ROUND 23 — SECURITY HEADERS: THE APPLICATION SET NONE

### What was measured first

```
$ curl -D - -o /dev/null https://…/
HTTP/1.1 200 OK
Vary: rsc, next-router-state-tree, …
Cache-Control: no-store, must-revalidate
Content-Type: text/html; charset=utf-8
```

**No `Content-Security-Policy`. No `X-Content-Type-Options`. No `Referrer-Policy`. No
`X-Frame-Options`. No `Permissions-Policy`.** The only headers configured were a cache directive and a
robots tag on two route groups, so every page was served without a content policy and without
clickjacking protection.

### What is now sent

    Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline';
      style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
      font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; media-src 'self';
      connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self';
      object-src 'none'
    X-Content-Type-Options: nosniff
    Referrer-Policy: strict-origin-when-cross-origin
    X-Frame-Options: DENY
    Cross-Origin-Opener-Policy: same-origin
    Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()

Three decisions worth recording:

* **`img-src 'self' data:` carries a security gain.** Every image now serves from this origin because
  item 1 removed the hotlinks to the old WordPress site, so this policy **enforces** that property —
  a future hotlink fails closed instead of silently reinstating a dependency on the site being
  replaced. The security work and the migration work reinforce each other here.
* **`'unsafe-eval'` is added in development only**, because hot reload needs it, and is never in a
  production policy.
* **HSTS is conditional on production.** Sending it from a local http server pins a browser to https
  for localhost, which is a well-known way to break a developer's own machine. It belongs on the real
  origin over real TLS.

### Verified: the policy does not block anything the pages need

A CSP that breaks the site is worse than none, so every resource on five page types was checked
against the policy rather than assumed compatible:

    /                                          ok
    /archive/                                  ok
    /ute-okpu-an-ika-igbo-clan-and-its-nri-roots/  ok
    /documents/                                ok
    /search/?q=igbo                            ok
    total resources the policy would block: 0

And the headers reach every route type, not just pages:

    /                    200  CSP present
    /archive/            200  CSP present
    /no-such-page-here/  404  CSP present
    /api/spotify/check   405  CSP present
    /admin/              307  CSP present

### The known weakness, stated rather than hidden

`script-src` includes `'unsafe-inline'`, which is a real weakening: it means an injected inline script
would run. It is there because Next.js emits its bootstrap and RSC payload inline, and removing it
without adding nonces would break the application outright. **The correct next step is a nonce-based
policy**: middleware mints a nonce per request, every inline script carries it, and `'unsafe-inline'`
is dropped. That is a deliberate change deserving its own round and its own verification, not
something to smuggle in with a header batch.

### Still outstanding for item 10

* **Nonce-based CSP**, replacing `'unsafe-inline'` for scripts.
* Rate limiting exists (`lib/rate-limit.ts`) but its coverage has not been audited across endpoints.
* Not audited: keyboard focus order, landmark completeness, link-text quality, form error messaging.
* Untouched: notifications, monitoring, backups, deployment.

---

## ROUND 24 — MONITORING AND BACKUPS: NEITHER EXISTED

### There was no backup at all

`grep` for backup tooling found only two unrelated dictionary restore scripts. **The archive had no
backup mechanism.** On 1 October a `kill -9` left the PGlite cluster unopenable and recovery was a
full rebuild — migrations, seed, four imports, and a re-link of every media row. Nothing was lost
because every input was still on disk, but that was **luck, not design**. The same accident after the
first editorial work would have destroyed work no import could regenerate.

### `packages/ozikoro/src/ops/backup.ts`

    npm run backup                              take one
    node src/ops/backup.ts --verify <dir>       check one

It records the counts of eleven significant tables in a `MANIFEST.json`, so a copy can be checked
without opening it. Three refusals and detections, all verified:

    a server Postgres          refuses: "DATABASE_URL is set … Use pg_dump."
                               A cluster directory is not portable to a server Postgres, so a file
                               copy there would produce a backup that could not restore.
    a truncated copy           detects: "directory is 40522457 bytes but the manifest records
                               115504553 — truncated"
    a directory that is not    detects: "no readable MANIFEST.json — this is not a backup this tool
    a backup                   made"

Taken and verified: **110.2 MB**, holding 1,057 articles · 3,488 media · 11 contributors · 11,056
labels · 228 clans · 995 towns · 8,728 words.

### A real bug in the first version, found by running it

It resolved the data directory from `process.cwd()`. **A workspace script runs with its own package as
the working directory**, so `cwd` was `packages/ozikoro` and `.data/pg` pointed at a directory that has
never existed. Fixed by walking up from the module's own URL, which is the only way to be sure of the
repository root wherever the script is invoked from.

### `GET /api/health`

Runs a real query, so a process that is listening but cannot reach its database reports `503` rather
than `200` — the failure a naive health check misses, where the web server answers while every page
500s.

It deliberately returns no table counts, no version and **no error text**, because a health endpoint is
normally unauthenticated and world-readable. Counts are available only to a caller presenting
`HEALTH_TOKEN`, compared as a whole string so the value cannot be walked a character at a time.

Verified:

    HTTP 200, Cache-Control: no-store, max-age=0
    {"status":"ok","database":"reachable","latencyMs":541}
    exposes counts to anonymous callers: 0
    exposes error detail: 0

### Still outstanding for item 10

* Backups are manual. **A deploy needs a scheduled job**, and retention (how many to keep, for how
  long) is a decision for the owner.
* No restore drill has been performed — the backup has been verified for completeness, but nobody has
  restored one into a working instance.
* Nonce-based CSP; rate-limit coverage unaudited; keyboard focus order, landmark completeness,
  link-text quality and form error messaging not audited.
* Untouched: notifications, deployment.

---

## ROUND 25 — RESTORE DRILL: THE BACKUP ACTUALLY RESTORES

Round 24 said plainly: *"No restore drill has been performed — the backup has been verified for
completeness, but nobody has restored one into a working instance."* That was the honest gap. It is
now closed.

### A backup nobody has restored is a hypothesis

The drill, performed end to end:

    copy .data/backups/pg-2026-10-01T17-07-50 -> /tmp/restore-drill
    OZITUMA_DB_PATH=/tmp/restore-drill node …    # open the RESTORED copy, not the live one

    ozikoro_article      1057
    ozikoro_media        3488
    ozikoro_contributor    11
    ozikoro_label       11056
    clan                  228
    clan_town             995
    word                 8728

**Every count matches the manifest exactly.**

### A mistake I made in the first attempt, and caught

The first run **did not set `OZITUMA_DB_PATH`**, so it read the *live* database and reported the live
counts. Those numbers looked correct — they were identical to the manifest — and nothing about the
output revealed that the restore had not been touched. Had I not noticed the missing variable, the
drill would have "passed" without testing anything.

The lesson is specific and worth keeping: **a test that produces the expected result still has to be
shown to have exercised the thing it claims to test.** Coincidentally-correct output is the most
convincing kind of wrong answer.

### How the drill proves it is really the restored copy

Correct counts are not proof, because the live database has the same counts. So a marker was written
into the restored copy and the live database was asked whether it has it:

    create table zz_restore_probe in the RESTORED copy  ->  1 row written
    does the LIVE database have that table?             ->  0     (they are separate)
    restored copy reopens after the write               ->  1057 articles, still intact

The restored copy is a **working, writable database**, not merely a directory that opens.

### The restore procedure, recorded so it is reproducible

    npm run backup                                  # take one
    node src/ops/backup.ts --verify <dir>           # check it is complete
    # to restore, with the server STOPPED:
    mv .data/pg .data/pg.replaced
    cp -R .data/backups/<dir> .data/pg
    rm -f .data/pg/MANIFEST.json                    # not part of a cluster
    # then open it and check the counts against the manifest

The `mv` rather than `rm` matters: a failed restore must never be the reason the previous database is
gone.

### Still outstanding

* **Backups are manual and unscheduled.** A deploy needs a recurring job; retention is the owner's
  decision.
* **No off-machine copy.** A backup on the same disk does not survive the failure it exists for.
* Nonce-based CSP; rate-limit coverage unaudited; keyboard focus order, landmark completeness,
  link-text quality, form error messaging.
* Untouched: notifications, deployment.

---

## ROUND 26 — HEALTH ENDPOINT: THE TOKEN PATH, ACTUALLY TESTED

Round 24 built `/api/health` with a `HEALTH_TOKEN` path for detail, and **only tested the anonymous
case**. The branch that decides whether to return counts had never been executed. Now it has, all four
ways:

    anonymous                         {"status":"ok","database":"reachable","latencyMs":782}
    correct token                     {"status":"ok","database":"reachable","latencyMs":4,"articles":1057}
    wrong token                       {"status":"ok","database":"reachable","latencyMs":3}
    token with an extra suffix        {"status":"ok","database":"reachable","latencyMs":3}

The last is the one worth having tested: the comparison is a whole-string equality, so a caller who
knows a **prefix** of the token gets nothing. A `startsWith` check would have leaked the counter to
anyone willing to guess one character at a time, and the anonymous and correct cases would both still
have passed.

**A tested branch and an untested branch look identical from the outside.** This is the third time in
this project that the untested path was the one holding a defect — after the `manage_contributors`
capability held by nobody, and the restore drill that read the wrong database.

## Status against the ten items — where the work actually stands

    (1) media into storage ................ DONE. 3,437 of 3,488 served from our own origin,
                                            0 hotlinks, restore-tested. 51 files are 404 at source
                                            and the archive says so rather than showing breaks.
                                            Production still needs S3_BUCKET.
    (2) auth, roles, claims ............... DONE and verified end to end, including a granted claim
                                            crediting 314 records. 0 of 11 bylines claimed so far.
    (3) editorial queue ................... MACHINERY DONE and verified. 0 of 1,051 records linked —
                                            the retagging is human work and is the largest gap left.
    (4) research vertical slice ........... DONE for the public and review loop; manuscript upload
                                            still unbuilt.
    (5) archaeology, rights, oral history . SCHEMA AND RIGHTS DONE. Public screens unbuilt; 0 of
                                            3,488 media items has an actual licence.
    (6) search ............................ DONE. Two modes, diacritic-insensitive, verified that
                                            plain and decorated spellings agree.
    (7) maps and timeline ................. BLOCKED ON THE OWNER. No map or timeline screen exists in
                                            the 37 delivered design screens, and PostGIS is not
                                            available in PGlite.
    (8) Ozituma linking ................... WORKS. Entities point at dictionary rows; the entity page
                                            reads across. Needs the graph populated.
    (9) AI research assistant .............. NOT STARTED. Needs a provider credential.
   (10) SEO, a11y, security, ops .......... SUBSTANTIALLY DONE: sitemap 14,667 canonical URLs;
                                            heading order archive-wide; alt text; contrast fixed;
                                            JSON-LD on five page types; security headers including a
                                            CSP; health endpoint; backup taken and restore drilled.
                                            NOT DONE: notifications, deployment, nonce-based CSP,
                                            scheduled and off-machine backups, and several a11y
                                            checks (focus order, landmarks, link text, form errors).

---

## ROUND 28 — END-TO-END SMOKE TEST

Every public route, the sitemap, robots, the health endpoint and an archived media file were fetched
from the running application. **All 15 returned 200:**

    /  /archive/  /folklore/  /documents/  /topics/  /entities/  /publications/  /researchers/
    /search/?q=igbo  /about/  /sitemap.xml  /robots.txt  /api/health
    /media/ozikoro/11234-ute-king.webp
    /ute-okpu-an-ika-igbo-clan-and-its-nri-roots/     (a migrated record at its original address)

Typecheck 0 errors; 58 unit tests and every suite green.

**This is a smoke test, not a completion claim.** The objective is not achieved — see the status table
above. Half the ten items are done and verified; three are blocked on the owner; item 9 has not been
started.

---

## ROUND 30 — THE DEPLOYMENT VARIABLES ARE NOW DOCUMENTED

There was no `.env.example`. The two variables a deployment genuinely cannot start without —
`S3_BUCKET` and `HEALTH_TOKEN` — were documented **nowhere**, only in round-by-round prose at the
bottom of this file.

`apps/ozikoro/.env.example` now lists every variable the application reads, grouped and with the
consequence of leaving each unset. The entries that matter most:

* **`S3_BUCKET`** — without it the application falls back to the local filesystem, which is ephemeral on
  a container platform. A redeploy leaves every media row pointing at a key that no longer exists and
  all 3,488 images 404 at once. The media route refuses the local copy in production and logs the key
  it could not find, so the failure is loud rather than silent.
* **`DATABASE_URL`** — unset means the local PGlite cluster; set means a server Postgres. The file
  records that `npm run backup` **refuses** when it is set, because copying a cluster directory is not
  a valid backup of a server Postgres.
* **`HEALTH_TOKEN`** — enables the detailed branch of `/api/health`. Without it the endpoint still
  checks the database; it just reports no numbers.
* **`SPOTIFY_TOKEN_KEY`** — changing it invalidates every stored connection.
* **`OZITUMA_IMPORT_DRY_RUN`** — several importers default to a dry run. The notice saying so is one
  line that an output filter can hide, which cost a rebuild in round 12.

Verified rather than assumed: every `process.env.*` the code reads was extracted and checked against
the file. The only one absent is `NODE_ENV`, which the runtime sets and an operator does not.

---

## ROUND 31 — CREDENTIAL EXPOSURE CHECK

The Spotify client id and secret were pasted into a chat session during this work, so whether either
reached version control was worth establishing rather than assuming. Checked with explicit exit codes,
because a silent `grep` and a clean `grep` look identical:

    git check-ignore apps/ozikoro/.env.local   ->  .gitignore:15  (ignored)
    git ls-files apps/ozikoro/.env.local       ->  untracked
    git ls-files | grep '\.env'                ->  .env.example only
    git grep <client secret>                   ->  exit 1, not found in any tracked file
    git grep <client id>                       ->  exit 1, not found in any tracked file

**No credential is in version control.** `.env.example` is the only environment file tracked, and it
contains no values.

**Both credentials should still be rotated.** They were transmitted in plain text through a chat
session, which is exposure regardless of whether they also reached a repository. Rotation is the
owner's action and is recorded here rather than left implicit.

### A note on how this check was run

The first attempt reported nothing at all — no matches, and no confirmation that the search had run.
Two of the three commands ended in a pipe, so `||` tested the exit status of `head`, not of `git grep`,
and the fallback message could never fire. **A check whose null result is indistinguishable from its
failure to run is not a check.** Re-run with explicit exit codes, all three are unambiguous.

---

## ROUND 32 — A CORRECTION TO ROUND 30

Round 30 said of `.env.example`: *"`.env.example` is the only environment file tracked, and it
contains no values"*, and earlier *"it ships"*. **Both were wrong.**

    $ git status --porcelain apps/ozikoro/.env.example
    ?? apps/ozikoro/.env.example

The file exists on disk and **is not in version control at all.** It is untracked, so it would not
reach any other checkout, would not deploy, and would be lost if this working tree were replaced. The
deployment gap round 30 claimed to close is **still open for everyone except this machine.**

The mistake was mine and specific: I verified that `.env.local` is *ignored* and that `.env.example`
is *not ignored*, and treated "not ignored" as "tracked". Those are different properties. A file is
only in version control once it has been added, and a new file is untracked by default — which I knew,
having created it moments earlier.

**A property being permitted is not the same as it being true.** This is the fourth time in this
project that a check answered a nearby question rather than the one being asked — after the
form-labelling false positives, the uppercase-Igbo hit, and the credential scan whose null result was
indistinguishable from its failure to run.

### What is actually needed

    git add apps/ozikoro/.env.example      # then commit

**Not done, deliberately.** Committing is the owner's decision, and this session has made no commits.
Recorded here so the gap is visible rather than assumed closed.

### Any other new file from this work that is untracked

This matters beyond one file: several files were created late in this work — `public/a11y.css`,
`src/ops/backup.ts`, `src/seo.ts`, `src/entities.ts`, `src/rights.ts`, `src/search.ts`,
`sources/*.test.ts` — and **whether each is tracked has not been checked.** A file that exists only on
this machine is not part of the deliverable. That check is the first thing the next round should do:

    git status --porcelain | grep '^??'

---

## ROUND 32 (CONTINUED) — THE OZIKORO APPLICATION IS NOT IN VERSION CONTROL

Chasing round 30's `.env.example` claim turned up something far more serious than a duplicate file.

    repository root                     /Users/nzeora/Documents/Ozikoro/staging
    files on disk under apps/ozikoro     103
    of those, tracked in git               0

**The entire Ozikoro application is untracked.** Not one of its 103 files is in version control:
every route built in this work, the components, the middleware, `next.config.ts` with its security
headers, `globals.css`, `public/a11y.css`, the media route, the health endpoint, the claims, reviews,
submit, researchers, publications and entities screens, and the delivered design assets under
`public/design/`.

Along with them, untracked:

    docs/OZIKORO-REMAINING.md      this handover document
    docs/SPOTIFY.md                docs/PODCAST-PIPELINE.md
    docs/OZIKORO-DESIGN-BRIEF.md   docs/DASHBOARD-DESIGN-BRIEF.md
    data/ozikoro-wp                the extracted WordPress archive
    15 entries under packages/db, 1 under packages/ozikoro

The rest of the monorepo **is** tracked — 146 files under `apps`, 143 under `packages`, 112 under
`work` — so this is specific to the Ozikoro work, not a broken repository.

### Why this matters more than anything else in this file

Every other gap recorded here is a gap in the product. This one is a gap in the **existence** of the
product. A `git clean -fd`, a fresh clone, a disk failure or a mistaken checkout discards all of it,
and unlike the media — which is re-downloadable, and was actually re-downloaded once — the editorial
and application work here is not reproducible from any source.

Three of the four things this file lists as "blocked on the owner" can wait. This one cannot.

**RESOLVED round 33** — committed as `ccd316f`, 156 files, 101 of them under `apps/ozikoro`.
Deliberately excluded: `data/media/` (760 MB of binaries, gitignored — they live in object
storage), `data/ozikoro-wp` (72 MB of extracted JSON, regenerable by re-running the extractor),
`.env.local` (credentials, gitignored) and `*.tsbuildinfo` (a build artefact, now gitignored).
No credential value appears in the commit, verified by searching the staged diff before committing.

### What is needed

    git add apps/ozikoro docs data/ozikoro-wp packages/db packages/ozikoro
    git status                     # review what is about to be committed
    git commit

**Not done here, deliberately.** This session has made no commits, and whether to commit — and what to
exclude, since `data/media/ozikoro-wp` is 760 MB of binaries that belong in object storage rather than
in Git — is the owner's decision. Recorded so that it is a decision rather than an oversight.

### Note on the earlier claim

Round 30 said `.env.example` "ships", and round 31 appeared to confirm it was tracked. Both checked the
wrong file: there is a **root** `.env.example`, tracked and 11 KB, and the file created in round 30 at
`apps/ozikoro/.env.example` is a separate untracked one. The root file already existed; the new one is
redundant as well as untracked, and should probably be removed rather than committed.

---

## ROUND 34 — A CORRECTION TO ROUND 33

Round 33 said: *"`apps/web` is still untracked — 39 entries."* That was imprecise, and the imprecision
matters because it made a normal state look alarming.

Measured:

    apps/web      89 files tracked   39 untracked   12 modified
    apps/ozikoro 101 files tracked    (was 0 before round 33's commit)

`apps/web` is a **tracked application with uncommitted work** — an ordinary state that most working
repositories are in. `apps/ozikoro` had **zero** files in version control; nothing of it existed in
Git at all. Those are not the same condition and should not be described in the same breath.

The mistake was mine and had the same shape as the four before it: I ran `git status --porcelain |
grep '^??'` — which by construction only reports untracked entries — and then spoke about the whole of
`apps/web` from that filtered view. **I asked a narrow question and reported the answer as if it
covered everything.** The correction is that `apps/web`'s uncommitted work belongs to the Ozituma
dictionary application, is outside this objective's scope, and is left to whoever owns it.

### The one that was real

`apps/ozikoro` — 0 tracked files out of 103, now 101 tracked and committed as `ccd316f`. That finding
stands and was worth acting on.

---

## ROUND 36 — DEMONSTRATION CONTENT CANNOT BE MISTAKEN FOR THE SITE

The objective's constraint is explicit: *"never label demonstration content as real."* The delivered
design includes 37 screens of it — fabricated dashboards, researcher profiles, donation and investor
pages, all with invented names and figures. It is served from `/design/screens/` because the approved
design has to remain readable as the reference implementation. Three checks, all passing:

    no app page links to /design/screens/       the only /design/ references in the app are the two
                                                stylesheet <link>s that apply the design
    robots.txt                                  Disallow: /design/   (line 17, with the reason
                                                recorded beside it)
    all 37 screens carry their own noindex      37 of 37

So the demonstration content is isolated three ways over: nothing on the real site leads to it,
crawlers are told not to index it, and each page declares `noindex` for itself should the first two
ever be missed. **A reader cannot arrive at invented content from a real page, and a search engine
cannot surface it.**

Worth noting for the next round: the stylesheet links are the one legitimate `/design/` reference, and
`Disallow: /design/` therefore blocks crawling of the CSS as well. That is harmless — stylesheets are
not indexed — but it is the reason the rule is `/design/` and not `/design/screens/`.

### Nothing further was changed this round

---

## ROUND 37 — THE PRODUCTION BUILD, TESTED FOR THE FIRST TIME

Everything in this file describes a platform exercised through `next dev`. **The production build had
never been run.** That is the gate that decides whether any of it can deploy, and it was the largest
untested assumption in the project.

    npm -w @ozikoro/site run build
    → exit code 0, no errors

Compiled successfully, and every route emitted:

    /documents  /documents/[slug]  /entities  /entities/[slug]  /folklore  /labels/[slug]
    /media/[...key]  /publications  /publications/[slug]  /researchers  /researchers/[slug]
    /reviews  /robots.txt  /search  /signin  /sitemap.xml  /submit  /topics  /topics/[slug]

    First Load JS shared by all   102 kB
    Middleware                     34 kB

`/robots.txt` and `/sitemap.xml` are prerendered static; the rest are server-rendered on demand, which
is correct — they read the database.

### Why this mattered more than another feature

The build is where four separate pieces of this work converge and could have failed together: the
`transpilePackages` configuration for the three workspace packages, `serverExternalPackages` for
PGlite, the `trailingSlash`/`skipTrailingSlashRedirect` pair that took a whole round to get right, and
the middleware rewrite. A production build type-checks and bundles differently from the dev server, and
a failure in any of them would have surfaced only at deploy time — on the day the site was meant to go
live, with the old one already taken down.

**It compiles clean.** The deployment gate passes.

### Still unverified for deployment

* No environment has actually been deployed to. `output: 'standalone'` is configured but the produced
  server has not been started and served a request.
* `S3_BUCKET`, `HEALTH_TOKEN` and the database connection are all unset for production.
* No CI runs this build; it passes here because it was run by hand.

---

## ROUND 38 — THREE REAL DEPLOYMENT BLOCKERS, FOUND BY STARTING THE PRODUCTION SERVER

Round 37 proved the build compiles and noted that the produced standalone server had never been
started. Started, it was broken in three ways — all of them the classic `output: 'standalone'` traps,
and all of them would have appeared on launch day with the old site already down.

    apps/ozikoro/.next/standalone/
      public/            MISSING
      .next/static/      MISSING
      .data/pg           MISSING

### What each one would have done

* **`public/` missing** — every archived image, the whole of `/media/*`, the design's stylesheets and
  `a11y.css` would have 404'd. That is 3,437 media files and the entire visual design.
* **`.next/static/` missing** — every JavaScript and CSS chunk would have 404'd, so the site would
  render unstyled and non-interactive.
* **`.data/pg` missing** — PGlite would have created an **empty cluster** and every page would have
  been empty, silently, with no error. In production this one is expected: `DATABASE_URL` should point
  at server Postgres and PGlite should not be used at all. It is listed because a deploy that forgets
  `DATABASE_URL` fails this way rather than loudly.

`output: 'standalone'` does not copy either static directory. **The deploy step has to**, and nothing
in the repository said so.

### The fix, verified

    cp -r apps/ozikoro/public          apps/ozikoro/.next/standalone/apps/ozikoro/public
    cp -r apps/ozikoro/.next/static    apps/ozikoro/.next/standalone/apps/ozikoro/.next/static

Then the server was started and every route tested against the PRODUCTION build — not the dev server:

    /                              200
    /archive/                      200     and carrying real records
    /media/ozikoro/11234-…webp     200
    /design/styles/main.css        200
    /a11y.css                      200
    /api/health                    200

**The deployment artifact serves.** This is the first time the production build has been run as a
server rather than only compiled.

### What this says about the remaining deployment work

The two static copies are a step in a deploy script that does not exist yet. **Writing that script —
and running it once against a real environment — is the remaining deployment work**, along with
`S3_BUCKET`, `HEALTH_TOKEN` and a server Postgres. Nothing about it is unknown now; it is unbuilt.

---

## ROUND 39 — THE DEPLOY STEP IS NOW BUILT AND ASSERTED

Round 38 found three deployment blockers and called the fix "unbuilt, not uncertain". It is built:
`scripts/build-standalone.sh`, wired as `npm run build:standalone`.

It builds, copies the two directories `output: 'standalone'` omits, and then **asserts on the artefact
rather than on the commands** — because a `cp` that silently did nothing is precisely the failure this
exists to prevent. It also checks that `.next/static` is not merely present but **non-empty**, since an
empty directory passes a naive existence test.

    ==> Building                        ✓ Compiled successfully
    ==> Copying the static assets       (public/, .next/static/)
    ==> Verifying the artefact
        ok    server entrypoint
        ok    public/ directory
        ok    the design stylesheets
        ok    the accessibility CSS
        ok    static chunks
        static files copied: 58
    ==> The artefact is complete.        exit 0

On failure it prints **"Build artefact is INCOMPLETE — do not deploy"** and exits non-zero, so a CI
step or a deploy script cannot proceed past it.

It also states the four variables a real deployment needs (`DATABASE_URL`, `S3_BUCKET`,
`HEALTH_TOKEN`, `OZITUMA_SITE_URL`) with the consequence of each being unset — the first two being
fatal in ways that do not announce themselves.

### What is still not done for deployment

* **No environment has been deployed to.** The artefact has been run locally and serves; it has never
  been run anywhere else.
* **No CI runs this.** It passes because it was run by hand.
* `DATABASE_URL` pointing at server Postgres has never been exercised — every test in this project has
  run against PGlite.

---

## ROUND 41 — AN OPEN REDIRECT, FOUND AND CLOSED

### What it was

`redirectTo` in `lib/access.ts` put its `path` argument straight into a `Location` header with **no
validation at all**:

    export function redirectTo(path, params = {}) {
      return new Response(null, { status: 303, headers: { Location: `${path}?${search}` } });
    }

Several form endpoints pass a **user-controlled `returnTo` field** to it — `/api/research`,
`/api/claims`, `/api/admin/archive`. So an authenticated POST carrying
`returnTo=https://evil.example/phish` answered `303` with that absolute URL, letting a trusted domain
forward a reader to an attacker's page. That is the standard shape of a phishing link that appears to
come from the archive.

The auth route already guarded its own `?next=` through a local `safeNext`, which is why the
unauthenticated probe looked harmless — it routed the hostile value into `next=`, where it was checked
later. **The other endpoints had no such guard.**

### The fix

Validation moved to `safeRedirectPath`, inside `redirectTo`, so **every redirect goes through it**.
Patching each endpoint would have left the next one written to be unprotected, which is the same
reasoning that puts the capability check in one place elsewhere in this codebase.

It refuses three things, and the second is the one a naive check misses:

* `https://evil.example` — not a path.
* `//evil.example` — **protocol-relative, absolute despite beginning with a slash.**
* `/\\evil.example` — some browsers normalise a backslash to a slash and would then read it as
  protocol-relative.

### Verified with a real authenticated session

Signed in as an administrator, then POSTed each case and read the `Location` header:

    returnTo=https://evil.example/phish   ->  Location: /?error=…          refused
    returnTo=//evil.example/phish         ->  Location: /?error=…          refused
    returnTo=/admin/claims/               ->  Location: /admin/claims/?…   still works

All three correct. Test account removed, **0 residue**.

### Still to consider

* The same pattern should be reviewed in the Ozituma application (`apps/web`), which is outside this
  objective and was not examined.
* A nonce-based CSP remains outstanding and is the larger remaining security item.

---

## ROUND 42 — CSRF: CONSISTENCY ADDED, AND A CLAIM I DID NOT MAKE

### What was measured

`sameOrigin` exists and was used by four routes — the auth route and the three Spotify endpoints. It
was **not** used by the four other state-changing POST routes:

    /api/claims          /api/research          /api/admin/archive          /api/admin/rights

The tempting conclusion is "CSRF vulnerability". **That would have been wrong**, and the reason is
worth recording:

    session cookie:  httpOnly: true,  sameSite: 'lax',  secure: (derived from the site URL scheme)

`SameSite=Lax` means a browser **does not send the cookie on a cross-site POST**, which is exactly the
request a CSRF attack needs. So the attack is mitigated before the request is authenticated. What was
missing is **defence in depth**, not a hole — the four routes relied entirely on a cookie attribute
continuing to be set correctly in every environment, while the other four did not.

### What was done

The origin guard added to all four, matching the pattern the protected routes already use. Verified on
the running server, all four routes, three ways each:

    cross-origin (Origin: https://evil.example)   403   refused
    same-origin  (Origin: the site)               303   proceeds
    no Origin    (curl, non-browser clients)      303   proceeds

The third case is deliberate: `sameOrigin` returns true when no `Origin` header is present, because
older browsers and non-browser clients do not send one. That behaviour is pre-existing and was left
alone rather than changed in passing.

### The discipline this round exercised

This is the first security round where the answer was **"not a vulnerability"**, and it would have been
easy to report otherwise. The cookie's `SameSite` attribute was checked *before* writing the finding,
not after. Four rounds ago the opposite happened — an audit script reported failures that did not
exist — and the cost of that was a correction to a file other people read.

---

## ROUND 43 — SIGN-IN HAD NO RATE LIMIT AT ALL

### Measured before changing anything

`rateLimit` was used by exactly four routes — all of them Spotify. **The sign-in endpoint had none.**

    25 rapid failed sign-ins
    attempt  1 -> "Those details did not match an account."
    attempt 25 -> "Those details did not match an account."
    throttle signals in the 25th response: 0

Byte-identical responses, no throttle header, no limit of any kind. Unlimited password guessing is
the difference between a password being a secret and a password being a search space.

### A false alarm, caught by reading the code instead of the number

The first probe compared status codes across the Spotify endpoint and saw `303` for all ten attempts,
which looked like the limiter was not working either. It was: **the throttled path also answers `303`**,
a redirect carrying `Too many connection attempts`. Status codes alone could not distinguish throttled
from allowed. Reading the response's `Location` header — and the route's own code — showed the limiter
was fine. Nothing was changed on the strength of the first reading.

### The fix, and why there are two keys

Sign-in is now limited to **10 attempts per 5 minutes per client AND per account**.

Two keys because they stop different attacks, and one of them is defeatable on its own:

    rotating x-forwarded-for, same target account:
      xff 10.0.0.1 … 10.0.0.10   attempted     (each address gets a fresh client allowance)
      xff 10.0.0.11 … 10.0.0.14  THROTTLED     (the ACCOUNT limit holds)

`x-forwarded-for` is a request header and therefore attacker-controlled unless a trusted proxy
overwrites it, so the per-client limit can be bypassed simply by varying it. The per-account limit
cannot — and that is the one that matters, because the resource being protected is the account.

The limit is **not a lockout**. It clears itself in five minutes, so an attacker cannot permanently
lock a real user out of their own account by guessing at it — permanent lockout is itself a denial of
service on the account holder. The refusal is also the same shape as every other sign-in failure, so it
does not reveal whether an account exists.

### Still outstanding

* The limiter is in-process memory, as its own comment says. Behind more than one instance each gets
  its own allowance. A shared store is the fix and is not built.
* `signup` is not rate limited; account creation is a spam surface, though a less direct one.

---

## ROUND 44 — BROKEN OBJECT-LEVEL AUTHORIZATION: ONE AUTHOR COULD REWRITE ANOTHER'S DRAFT

### The finding, demonstrated rather than reasoned

`revisePublication` accepted a `publicationId` and an `actorId` and **never checked that the two were
related.** The route above it authorized only on `submit_work` — a capability held by every
contributor role, so it restricts nobody.

Demonstrated with two ordinary researcher accounts:

    account A creates a PRIVATE draft (id 37)
    account B holds submit_work                 -> true
    B calls revisePublication on A's draft      -> ALLOWED, version 2 created
    the new version is attributed to            B (299), while the work belongs to A (298)

So any signed-in contributor could rewrite any other contributor's manuscript — **including a private
draft its author had never submitted** — and the rewrite was recorded under the attacker's name.

The same hole existed on the transition path: B could push A's private draft into the editorial queue.

### Why the capability check could not catch it

Authorization for **a role** and authorization for **a record** are different questions. `submit_work`
is universal among contributors, so it answers "may this person write research?" and not "may this
person write *this* research?". That second question has to be asked of the record, and it was not
being asked anywhere.

### The fix

`assertOwnsPublication` — the actor must be a listed author of the work or whoever submitted it.
Applied to `revisePublication` and to transitions whose destination is `submitted` (the author's act).

Editors are deliberately **not** granted content rights by this. An editor moving a work through review
acts on the archive's business; rewriting someone's manuscript would put the editor's words under the
author's name, and the transition path remains the editorial route.

Verified both ways:

    B revises A's draft          -> REFUSED (not_your_work)
    A revises their own draft    -> ALLOWED, version 2
    B submits A's draft          -> REFUSED (not_your_work)
    A submits their own draft    -> ALLOWED

Test accounts and publications removed in each run.

### Checked and found sound

`requestContributorClaim` is properly guarded — it refuses an already-claimed byline, a duplicate
pending claim by the same account, and a re-claim by an account already approved. **Byline takeover is
not possible.** Reported because a negative result is a result, and because "I did not look" and "I
looked and it was fine" are different things.

### A note on my own verification habit

Two edits this round ended with an assertion on how many times a symbol appears in the file. Both
counts were wrong — I miscounted twice — while the edits themselves were correct and proven by the
empirical test that followed. **Counting occurrences is a poor proxy for "the change landed"**; the
behavioural test is the real one. Worth remembering that the passing test, not the failed count, was
what established the fix.

---

## ROUND 45 — THREE SURFACES CHECKED, NO NEW VULNERABILITIES

Continuing the attack-driven work from rounds 41–44, three more surfaces were examined. **All three
were sound**, and this is recorded because "looked and it was fine" and "did not look" are different
things.

### 1. The editorial endpoint fails closed

`/api/admin/archive` resolves its permission from a **single fixed capability**, `edit_entity`, applied
to every action (`attach-place`, `attach-source`, `detach-entity`, `detach-source`, `save-facets`).
There is no ternary and therefore **no permissive default** — an action added later without a mapping
inherits the same check rather than falling through to something weaker. That is the right shape, and
worth contrasting with `/api/research`, where the capability is derived from the destination state and
had to be reasoned about.

### 2. `updateMemberProfile` has no ownership check — but is unreachable

The function takes an `accountId` from its caller and does not verify it belongs to the session. **No
route calls it** — there is no profile-editing UI yet — so there is no vulnerability today. It is a
latent trap: whoever builds that screen must pass the session's account id and never a form field.
Recorded rather than fixed, because adding a check to an uncalled function would be guessing at an
interface that does not exist.

### 3. The capability grants are least-privilege and coherent

    edit_entity          admin, editor
    manage_media_rights  admin                        (rights are a legal matter, not editorial)
    manage_contributors  admin, editor
    review_queue         admin, editor
    publish              admin, editor
    expert_review        expert_reviewer              (only)
    submit_work          independent_researcher, researcher, student, teacher

`community_knowledge_holder` holds `contribute_media`, `contribute_oral_history`, `bookmark`,
`collection`, `read` — and **not** `submit_work`. On first reading that looked like an under-grant, and
it is not: the role is scoped to contributing oral history and media, which is exactly what the plan
asks of it and exactly what the oral-history schema was built for. `moderator` holds `moderate`,
`review_reports`, `read`.

**The grants are deliberate and defensible.** The check that produced them:
`select capability from ozikoro_role_capability where role = ?`.

### A pattern worth naming after five security rounds

    round 41  open redirect                    REAL, fixed
    round 42  CSRF                             mitigated by SameSite; defence in depth added
    round 43  sign-in brute force              REAL, fixed
    round 44  object-level authorization       REAL, fixed
    round 45  three surfaces                   SOUND

Four of five rounds found something; the fifth did not, and saying so is part of the work. The two
rounds that looked like findings but were not — 42 and the first probe in 43 — were both caught by
checking the mechanism (the cookie attribute, the response header) **before** writing the conclusion.

---

## ROUND 46 — THE FIX FROM ROUND 44 NOW HAS REGRESSION TESTS, AND THE FIRST TWO WERE WRONG

Round 44 closed a broken object-level authorization hole and wrote no test for it. **A security fix
without a regression test is a fix that quietly reverts**, so five assertions were added to
`test-publications.ts`. The publication suite went from 82 checks to 87.

    ✓ a stranger cannot revise somebody else's publication          — not_your_work
    ✓ a stranger cannot revise a private draft they were never meant to see — not_your_work
    ✓ a stranger holding submit_work still cannot submit somebody else's draft — not_your_work
    ✓ the author can still revise their own work                    — 2
    ✓ and submit it themselves

### Two bugs in my own tests, both of which would have made them worthless

**1. The test would have passed for the wrong reason.** The accounts in this suite hold no roles, so
resolving the stranger's real capabilities returned a set *without* `submit_work` — and the transition
was refused on the **capability**, before the ownership check was ever reached. The assertion would
have gone green while proving nothing about the fix.

Handing the stranger a capability set that does include `submit_work` makes the refusal attributable to
**ownership alone**, which is the thing actually under test. The test now reads
*"a stranger holding submit_work still cannot submit somebody else's draft"*, and that wording is the
point.

**2. A lookup by slug that could never have matched.** Revising a work does **not** change its slug —
correctly, because a citation that already points at it must keep resolving. Looking the work up by its
new title's slug found nothing, so the assertion failed for a reason unrelated to submission. It now
queries by id.

Both were caught by running the suite and reading the failure, not by reviewing the diff. **A test that
passes for the wrong reason is more dangerous than no test**, because it converts an untested claim
into an apparently verified one.

---

## ROUND 47 — THE OPEN-REDIRECT FIX IS NOW TESTED, BY MOVING IT SOMEWHERE TESTABLE

Round 46 established that a security fix without a regression test reverts quietly. Rounds 41–43 each
made a fix; only round 44's had a test. This round closed the most important of the rest.

### Why it could not simply have a test added

`safeRedirectPath` was a private function inside `apps/ozikoro/lib/access.ts`. That file imports the
database client, and `apps/ozikoro` has **no test harness at all** — no test files, no test script. A
security decision that cannot be tested is one that reverts the next time somebody tidies the file.

So the function moved into `@ozikoro/platform`, where every other piece of logic in this project is
tested, and `access.ts` imports it. There is still exactly one implementation and the call site is
unchanged.

### The tests, and the cases an obvious implementation gets wrong

    19 checks, all passing

    https://evil.example      refused          the obvious case
    //evil.example            refused          protocol-relative — ABSOLUTE despite starting with /
    /\evil.example            refused          some browsers normalise \ to /
    javascript: / data:       refused
    bare host                 refused
    /  /admin/  /search/?q=…  kept             legitimate paths untouched
    empty / whitespace        becomes /        awkward input is not a hole
    '  https://evil…  '       refused          padding does not smuggle it through

The protocol-relative case is the one worth having a test for. It is why the check is not simply "does
it begin with a slash" — the check that looks correct and is not.

### Still untested, and now recorded as such

* **Round 42's origin guard** on four routes — no test. It is exercised only by hand.
* **Round 43's sign-in rate limit** — no test. `rate-limit.ts` has no test file, and the limiter's
  two-key behaviour (the account key surviving `x-forwarded-for` rotation) is exactly the kind of thing
  a refactor would break silently.
* Both live in `apps/ozikoro`, which has no test harness. **Giving that application a test script is
  the prerequisite for both**, and is the next thing to do here.

---

## ROUND 48 — THE APPLICATION HAS A TEST HARNESS

Round 47 established that `apps/ozikoro` had none — no test files, no test script — which is why two
security fixes in it, the origin guard (round 42) and the sign-in rate limit (round 43), were exercised
only by hand. That is now fixed.

    npm -w @ozikoro/site run test      # or: npm run test:ozikoro-app
    ℹ tests 7  ℹ pass 7  ℹ fail 0

`lib/rate-limit.test.ts` covers the limiter and, more importantly, the property the sign-in fix depends
on. `rate-limit.ts` has no imports at all, so it tests in isolation without a database.

### The test that was passing for the wrong reason, caught before it mattered

The rotation test was first written as five calls to the **account key alone**. It passed, and it proved
the account key throttles — but its name claimed it proved that *rotating the client key* does not help,
and it never rotated anything.

That distinction is the entire security property. Written that way, the test would still pass if the
account key were accidentally client-scoped — which is precisely the regression it exists to catch.

It now models what the route actually does — permit only when **both** keys allow — while rotating the
client key every iteration:

    for i in 0..4:
      byClient  = rateLimit(`signin-client:10.0.0.${i}`)   // fresh key each time
      byAccount = rateLimit(`signin-account:victim@…`)      // same key every time
      outcomes.push(byClient && byAccount)

    expected: [true, true, false, false, false]

A fresh client key buys no extra guess at the same account. That matches what was measured against the
running server in round 43, where rotating `x-forwarded-for` across fourteen addresses defeated the
client limit and the account limit still throttled at attempt eleven.

**This is the second round running where my own test was the defective part** — round 46's would have
gone green proving nothing about the fix it was written for. Both were caught by asking what the test
would do if the code were *wrong*, rather than by reading it and agreeing with it.

### Still to do here

* The origin guard (round 42) still has no test. It needs a request-shaped harness rather than a pure
  module, so it is the next one for this file.
* A root script `test:ozikoro-app` exists but is not yet part of whatever runs everything; there is
  still no CI.

---

## ROUND 49 — THE ORIGIN GUARD IS TESTED, AND I NEARLY DELETED THE IMPORTS DOING IT

Round 48 left the origin guard (round 42) as the last untested security fix. It could not be tested
where it lived: `apps/ozikoro/lib/access.ts` imports `next/navigation`, which does not resolve outside
a Next runtime, so `node --test` cannot load the file at all. Verified, not assumed:

    $ node --input-type=module -e "await import('./lib/access.ts')"
    IMPORT_FAILED Cannot find module '…/node_modules/next/navigation'

So `sameOrigin` moved to `@ozikoro/platform/redirects.ts`, beside the redirect check and for the same
reason, and `access.ts` re-exports it so the six route files that import it from there are unchanged.

### Verified after moving security code

    cross-origin (Origin: https://evil.example)   403   still refused, all four routes
    same-origin  (Origin: the site)               303   still allowed

    redirect suite: 19 -> 27 checks, all passing

The new checks pin the behaviour that was previously only described in a comment:

    matching origin and host        allowed
    different host                  refused
    a subdomain of the attacker     refused      ozikoro.com.evil.example
    port mismatch                   refused
    malformed origin                refused
    origin with no host header      refused
    MISSING origin                  allowed      deliberate — see below
    scheme differs, host matches    allowed      documented, not accidental

Two of those are decisions rather than accidents, and are now pinned so nobody "fixes" them:

* **A missing `Origin` is allowed.** Browsers send it on the cross-site requests this guards; they do
  not send it on same-origin navigations, and non-browser clients (curl, a health check, a scheduler)
  send nothing at all. Refusing those would break legitimate use to defend against a request a browser
  would not make.
* **The scheme is not compared.** `http://ozikoro.com` and `https://ozikoro.com` are the same origin to
  this function. Acceptable because the site is https-only behind HSTS and an attacker cannot set the
  header on a victim's request — but recorded, because it is the kind of property somebody later
  assumes the opposite of.

### My edit was wrong and the assertion caught it before the file was written

The script that removed the old definition used a doc-comment pattern that matched far **above** the
function — the whole import block sat inside the match. Had it written, `access.ts` would have lost its
imports. An assertion placed immediately before `write_text` — checking that the text being removed did
not contain `@ozikoro/platform` — stopped it, and the file was untouched.

The retry located the function by name and asserted the same thing again. **The assertion was in the
right place, which is the only reason this round did not end in a broken application.**

---

## ROUND 50 — THERE IS NOW A CI WORKFLOW

Round 48 recorded plainly: *"there is still no CI. The `test:ozikoro-app` script exists but nothing
runs it automatically."* Every suite in this project has passed because it was run by hand, which means
**nothing would have caught a regression between sessions** — including the four security fixes of
rounds 41–44, all of which only stay fixed because a test now guards them.

`.github/workflows/ci.yml` runs on every push and pull request.

### What runs, and what deliberately does not

This repository has two kinds of test, and only one kind can run in CI:

    database-free    the HTML sanitiser, the redirect and same-origin guards, the rate limiter
    data-dependent   archive, members, editorial, publications, rights, search, connection

The integration suites assert against the **real imported archive** and check real numbers: 1,051
published records, 3,488 media items, 11,056 labels, 228 clans. On an empty database they would fail
for the correct reason — they are testing data as much as code.

Running them in CI would need one of: the 72 MB of extracted JSON committed (large, regenerable); live
network access to the old WordPress site (**making the build depend on the site being replaced**); or a
seeded fixture, which does not exist.

So CI runs `npm run test:unit` — typecheck, the 58 unit tests, the 27 redirect and same-origin checks,
and the 7 application checks.

### Verified by removing the database

The claim "this does not need the database" was tested rather than asserted:

    mv .data/pg .data/pg.ci-probe
    npm run test:unit        -> 58 pass, 27 pass, 7 pass, exit 0
    mv .data/pg.ci-probe .data/pg

`npm ci` was also checked to be viable: `package-lock.json` exists (66 KB), so the first CI step will
not fail for want of a lockfile.

### The limit, stated rather than hidden

**A change that passes CI here has not been checked against the archive.** The integration suites still
run only locally. Making them runnable in CI means building the import chain into the workflow — the
extraction, the migrations, the seed and the four imports — which is not built.

This is a genuine gap and the next thing to do for deployment confidence.

---

## ROUND 51 — ALL SIXTEEN SUITES IN ONE COMMAND

    ./scripts/verify-all.sh          # or: npm run verify:all

Every round of this work has ended by running the same ten suites by hand, from memory, in a
particular order. That is slow, it is easy to skip one, and **a suite that is not run is a suite that
does not exist.** Round 50's CI covers the database-free half; this covers all of it, including the
suites that assert against the real imported archive.

    16 suites: typecheck, sanitiser, redirects/same-origin, application, archive, members,
               editorial, publications, rights, search, spotify, and the five shared suites
    All suites passed.

### The guard, tested rather than assumed

A dev server holds the PGlite lock, and every suite would then fail with a mutex timeout that looks
nothing like its cause — a failure mode that has cost real time twice in this project. The script
refuses to start if anything is listening on 3100.

Verified with a trivial socket listener standing in for the server:

    $ bash scripts/verify-all.sh
    FAIL: something is listening on 3100. Stop the dev server first — it holds the database lock,
          and the suites will fail with a mutex timeout rather than a real error.
    exit=1, and no suite was attempted

It refuses **before** running anything, so it cannot produce a half-finished run whose output looks
like a genuine failure.

### What this does not solve

It is not CI. It still runs only on this machine, and it assumes the archive, dictionary and research
data are already imported — it verifies, it does not import. **Making the import chain run in CI is
still the outstanding piece**, and the reason is unchanged: the integration suites assert real numbers
(1,051 records, 3,488 media, 11,056 labels) and CI would need the 72 MB of extracted JSON committed,
live access to the WordPress site being replaced, or a seeded fixture.

This script is what CI would call once one of those exists.

---

## ROUND 52 — A FIXTURE COULD RUN HALF THE ARCHIVE SUITE, AND ROUNDS 50–51 SAID OTHERWISE

Rounds 50 and 51 both recorded that the integration suites cannot run in CI because they assert real
numbers and "a seeded fixture does not exist". **That was too broad, and measuring the suite shows why.**

`test-archive.ts` makes two different kinds of assertion, and only one kind needs the real archive:

    NEEDS THE REAL ARCHIVE            articles >= 1000      contributors == 11
                                      media >= 3400         topics == 14
                                      labels >= 11000       withImages > 1000

    HOLDS ON ANY DATASET              no record lost its slug
                                      no record lost the address it was published at
                                      no record lost its author
                                      no record lost its body
                                      every record is searchable
                                      no two records share an address
                                      no archive record is shadowed by a site route

The first group answers **"did the migration actually happen?"** — a question only the real archive can
answer, and one that is already answered every time it runs here.

The second group answers **"is the data structurally sound?"** — and those are invariants that hold for
*any* dataset, fixture or archive. They are the assertions that would catch a regression in the
migration or the sanitiser, and they are exactly the ones worth having in CI.

**So the split is the work, not a fixture.** Putting the first group behind a condition — run them when
the archive is present, skip with a clear message when it is not — would let CI run the structural half
today, with no 72 MB commitment and no dependency on the WordPress site being replaced.

### Why this was worth re-examining

Rounds 50 and 51 accepted "a fixture does not exist" as a reason and moved on. The reason was true and
the conclusion did not follow from it: the suites needed *splitting*, not *seeding*. **Checking what a
test actually asserts — rather than what its file is called — is the same discipline that turned up the
false positives in rounds 17, 18, 22 and 42.**

### DONE in round 53 — and the conclusion above was still too optimistic

The split was attempted, and **it does not work the way this round assumed.** Guarding the counts was
not enough: five further assertions then failed on an empty database, because they are data-dependent
too — that exactly one source record is untitled, that the six WordPress pages are held separately,
that the institution page is among them, that the sitemap lists the archive.

So "the structural half runs anywhere" is wrong as well. On an empty database the structural
assertions pass **vacuously** — no records, therefore no record lost its slug — and reporting that as a
pass is precisely the overstatement this project keeps trying not to make.

`test-archive.ts` now exits **cleanly with a notice** when the archive is absent, naming every check it
did not perform and saying why a vacuous pass would be a false claim. That makes the suite safe to run
in CI, and states plainly that **a green CI run says nothing about the archive.**

The real fix is a **seeded fixture**: a small known dataset the structural assertions can bite on. It
does not exist, and that is what remains outstanding — not a split, which the round-52 note wrongly
called "the work".

---

## ROUND 53 — THE SPLIT, AND WHY IT DOES NOT DO WHAT ROUND 52 SAID

Round 52 concluded that the archive suite needed *splitting* rather than *seeding*, and that putting
the count assertions behind a condition "would let CI run the structural half today".

**The split was done, and that conclusion was wrong too.** Guarding the counts was not enough — five
more assertions then failed on an empty database, and they are data-dependent in the same way:

    exactly one source record is untitled
    the six WordPress pages are held separately
    the institution page is among them
    the sitemap lists the archive

And the "structural" assertions that *would* run pass **vacuously** on empty data — no records,
therefore no record lost its slug. A green result there means nothing, and reporting it as a pass would
be the exact overstatement this project keeps trying not to make.

### What was done instead

`test-archive.ts` detects whether the archive is present and, when it is not, prints a notice naming
every check it skipped and **exits cleanly**:

    SKIPPED — the archive is not imported, so NOTHING here can be checked meaningfully.
               Not checked: articles >= 1000, contributors == 11, media >= 3400, topics == 14,
                            labels >= 11000, withImages > 1000, the publishing date range, the
                            untitled-record invariant, the WordPress pages, the sitemap contents.
               The structural checks would pass vacuously on an empty database, and reporting
               that as a pass would be a false claim.

Both paths verified:

    empty but migrated database   ->  notice printed, exit 0, no false assertions
    the real archive              ->  All checks passed

That makes the suite safe to run in CI while **stating in the output that a green CI run says nothing
about the archive.**

### The lesson, which is the third version of this idea in three rounds

    round 50/51   "cannot run in CI — a fixture does not exist"
    round 52      "wrong: split the suite, then the structural half runs"
    round 53      "wrong again: it runs vacuously, and five more checks are data-dependent"

Each version was reached by checking rather than assuming, and each was still too optimistic until
measured. **The real answer is a seeded fixture** — a small known dataset the structural assertions can
bite on — and that remains outstanding.
