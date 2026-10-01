# What remains

> **RESUME HERE — status as of round 97.** This file is a running record, newest at the BOTTOM.
> Read this block and the round-26 status table; the rest is history, and some of it is superseded.
>
> **What is live.** **23 reader-facing routes and 7 under `/admin`** — 30 page routes in total (counted in round 97; the previous claim of "16 public routes" was wrong, and had been copied forward for many rounds without being checked); migrated records answer at their original WordPress addresses from
> this platform's own database and media origin; 3,437 of 3,488 media served from our own storage with
> **zero hotlinks**; typecheck clean; **20 verification steps green** via `./scripts/verify-all.sh`, plus
> **3 live checks** via `./scripts/verify-live.sh`.
>
> **Verified by exhaustive request, not by sampling.** All **14,667** sitemap URLs were requested and every
> page that answered returned 200 (round 70). The 120-page link walk is clean; 62 referenced assets load.
>
> **Done:** media into storage (1) · auth, ten roles and the byline claim path (2) · the editorial queue's
> machinery (3) · the research slice's public and review loop (4) · rights, consent and archaeology schema
> (5) · search with Knowledge/Research modes (6) · Ozituma entity linking (8) · sitemap, headings, alt text,
> contrast, JSON-LD, security headers, health endpoint, backup and a restore drill (10) · four real
> security fixes with regression tests · CI on the code-only half · a deploy artefact that builds and
> serves · the Ozituma web app rescued into version control (round 92).
>
> **Not done:** the AI research assistant (9 — needs a provider credential) · notifications · deployment ·
> manuscript upload · public screens for archaeology and oral history.
>
> **Blocked on the owner — nothing here will be invented:** the map and timeline screens (none exist among
> the 37 delivered designs) and the PostGIS decision (unavailable in PGlite) · `S3_BUCKET` and a server
> Postgres · nonce-based CSP · backup scheduling and off-machine storage · media rights — **0 of 3,488
> items has an actual licence** · **what the `/` → `/home/` row in `ozikoro_redirect` is for** (round 75:
> building the handler as specified would send the homepage to a migrated page of the same name).
>
> **The largest gap is human:** **0 of 1,051 records linked to an entity.** The machinery is built and
> verified; the retagging is editorial work. Three dead in-body links and one dead image are waived, with
> reasons, and they need a person who knows what the article meant to reference.
>
> **Six hazards that cost real time here:**
> 1. A dev server holds the PGlite lock. `kill -9` corrupted the cluster once and forced a full rebuild.
>    Kill **by port**, never `pkill -f node` — that killed the media download as collateral.
> 2. `timeout` does not exist on macOS; `timeout 120 node …` exits 127 and mimics a database failure.
> 3. BSD `sed` does not support `\?` and BSD `awk`/`sed` differ from GNU in ways that fail silently.
> 4. Some importers default to dry-run, and a root script whose body is another `npm run` cannot forward
>    flags.
> 5. **Never read a checker's exit code after a pipe** — it is the pipe's last command's status. Cost three
>    rounds (31, 70, 86) before it became a habit.
> 6. **A route that fails to compile takes the WHOLE server down**, not one page. Rounds 81 and 82 each
>    did this.
>
> **The verification habit, which is the most valuable thing in this file.** Fifteen times a check, a test
> or a measurement produced a confidently wrong answer. Every one was caught by insisting on a measurement
> that distinguishes the answer from a nearby one. They come in three shapes, all of them the method being
> wrong about **where the answer lives**:
>
> * a pattern matching the wrong **spelling** (round 73 — reported zero dead links)
> * a tool reading the wrong **set** — `git grep` reads the index, not the tree (round 92)
> * a comparison against the wrong **file or app** (round 95 — invented 58 missing variables)
>
> **Verify the verification. And print the input before theorising about it** — four rounds of theories
> about an unreachable article were answered in one line by logging the value the route actually receives
> (round 63).


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

---

## ROUND 54 — MY TEST RESIDUE WAS THE ONLY CONTENT IN THE RESEARCHERS DIRECTORY

Looking for invented content in live routes — donor figures, sponsors, investor numbers — turned up
nothing: the four design screens about money (`donate`, `investors`, `sponsors`, `academy`) have **no
routes at all**, and no live route mentions donations, pledges or sponsorship.

What the same sweep found instead was worse, and it was mine.

### What was there

Two accounts left behind by the **exploratory authorization test in round 44** —
`zztest-idor-a@example.com` and `zztest-idor-b@example.com` — still existed, still had
`ozikoro_member` rows, and still had **`is_public = true`**.

At that moment they were:

    the ONLY TWO ENTRIES in the /researchers directory
    https://ozikoro.com/researchers/298/   in the sitemap
    https://ozikoro.com/researchers/299/   in the sitemap

**Two made-up people, named after a test prefix, published as researchers and offered to search
engines.** That is the precise thing the objective forbids — *never label demonstration content as
real* — and nothing would have caught it. Every suite passed.

### Why nothing caught it

Tests clean up after themselves **when they finish**. The round-44 test was an exploratory one whose
later runs cleaned `zztest-idor2-%` and `zztest-idor3-%` but not the first batch. Cleanup that misses
one table, or a run that is interrupted, leaves rows behind — and a green suite says nothing about it,
because the suites assert their own tables and not the database.

### The lasting fix

`check:residue` — asks the question directly, across **nine tables**, for the `zztest` prefix every
fixture in this repository uses. `verify-all.sh` now runs it **first**.

Verified both ways, because a check that always passes is worthless:

    clean database       -> "No test residue",                  exit 0
    planted probe        -> "TEST RESIDUE FOUND", account 1, ozikoro_member 1,   exit 1
    probe removed        -> "No test residue",                  exit 0

It reports test data as what it is: *"rows marked public are served to readers and listed in the
sitemap as if they were real."*

### Also checked, and clean

The design's invented researcher — `Chinwe Ị̀kẹ̀jìànị̀` — appears in the application source in exactly
one place: a string literal in `test-search.ts` **testing that the diacritic fold works**. It is a
folding example, not a fabricated record, and it appears nowhere in the database.

`listResearchers` now returns **0**, the directory is empty, and the two sitemap entries are gone.

---

## ROUND 55 — THE RESIDUE CHECK NO LONGER HAS A LIST TO REMEMBER

Round 54's check named **nine tables**. That is the same weakness as a sitemap assembled from whichever
lists its author remembered — the thing fixed in round 16, where the remembered list omitted 92% of the
archive. **A table added later would simply not be checked, and nothing would say so.**

It now asks the database what it has: every table with a text column, discovered from
`information_schema.columns`, checked for the fixture prefix. **102 tables** on this database.

### Verified, including in a table the old list never named

    clean database                       -> "No test residue"                         exit 0
    probe planted in account             -> account 1 row(s)                            exit 1
    probe planted in ozikoro_audit       -> account 1, ozikoro_audit 1 row(s)           exit 1
                                            ^ a table the fixed list DID NOT name

That last line is the point. The old check would have reported the database clean while `ozikoro_audit`
held a fixture row. The dynamic scan found it without being told where to look.

    probe removed                        -> "No test residue"                           exit 0

### Why this shape keeps being the right one

    round 16   sitemap built from remembered lists omitted 11,056 labels and 3,488 media pages
    round 33   the applications themselves were not in version control at all
    round 54   a fixed list of nine tables missed ozikoro_audit
    round 55   the list is gone; the database is asked

Three separate failures, one cause: **a thing that has to be remembered will eventually not be.** The
remedy each time was to make the system discover its own inputs rather than be told them.

---

## ROUND 56 — THE ROUND-12 BUG NOW HAS A GUARD THAT WOULD HAVE CAUGHT IT

Round 12 found the byline claim path built, wired to a screen, and **unusable**: `manage_contributors`
was required by the decision endpoint and held by **no role at all** — not an editor, not an
administrator. An author could request a byline and nobody could ever decide it.

It was found by exercising the path with a real account, being refused, and asking the role table why.
**That is luck, not a process.** The capability matrix lives only in SQL migrations and in the
database, so nothing connected "this string is required by code" to "this string is granted to anyone".
`check:residue`'s sibling now makes that connection.

`check:capabilities` reads capability names **out of the source** — the arguments to
`requireCapability` and `hasCapability`, and the destination states in `TRANSITION_CAPABILITY` — and
checks each against the grants. `verify-all.sh` runs it beside the residue check.

### Verified by reproducing the bug

    manage_contributors revoked
      -> UNGRANTED CAPABILITIES — required by code, held by NOBODY.
         manage_contributors
           required by apps/ozikoro/app/api/claims/route.ts
      -> exit 1

    grant restored to editor and admin
      -> Every one is held by at least one role.   exit 0

**It names the bug, the capability, the endpoint that needs it, and exits non-zero** — which is exactly
what round 12 lacked. Eight capabilities are required by the source and all eight are granted.

### Two extraction bugs in my own check, caught by running it

The first run reported two ungranted capabilities and both were mine, not the product's:

* **`x`** — matched from this file's own doc comment, where `requireCapability('x', …)` appears as an
  example. The checker was reading its own documentation as code.
* **`journal_article`** — `'test-publications.ts'.endsWith('publications.ts')` is **true**, so the
  transition-capability heuristic ran over a *test* file and picked up `kind: 'journal_article'`.

Both are fixed: the walk excludes both test naming conventions (`x.test.ts` and `test-x.ts`) and this
file itself, and the publications guard now matches the path exactly.

**That is the tenth time in this project that my verification was the defective part.** Every one was
caught by running the check and reading its output rather than trusting it, which is now the most
reliable habit this work has produced.

---

## ROUND 57 — A LIVE LINK CHECKER, AND THE 404 IT FOUND ON ITS FIRST RUN

### Why it exists

In round 9 search began returning `/entities/<slug>/` links for a route that did not exist. It was
caught by checking, and it was latent rather than live only because the knowledge graph happened to be
empty. Nothing would still catch that class: every suite asserts data and logic, **not reachability.**

`scripts/check-links.sh` walks the site from the pages a reader lands on, follows the internal links it
finds, and reports every one that does not return 200. It needs a running server, so it is not part of
`verify-all.sh`, which runs against a stopped server because the suites hold the PGlite lock.

### The false pass, which is the more useful half of this round

The first version used `declare -A`. **macOS ships bash 3.2, where that is not a thing** — the script
died, checked nothing, and printed:

    pages checked: 0
    Every internal link resolved.

**A green result from a run that did not happen.** That is the exact failure mode recorded in round 31
and it happened again here, in a script written specifically to catch things nobody checks. It now uses
a bash-3.2-compatible membership test **and refuses to report a pass unless it checked at least one
page**, exiting 2 with *"NOTHING WAS CHECKED — the walker did not reach a single page. Not a pass."*

### What it found once it ran

    pages checked: 25
    404    /topics/%e2%81%a0religion-and-spirituality
    BROKEN LINKS: 1

Topic 14 was **unreachable, and published as a broken address in the sitemap** — an instruction to a
search engine to index a 404.

### The cause, which is an import bug

Measured from the database:

    id=14  slug = '%e2%81%a0religion-and-spirituality'      <- PERCENT-ENCODED, and invisible
           name = '⁠Religion and Spirituality'                <- a leading U+2060 WORD JOINER

WordPress stored the slug in its already-encoded form while the name carried the raw character. The
importer took `c.slug` **verbatim**, so the encoded text went into the database. The router then decoded
the URL segment back to the real character and looked that up — which matched nothing.

Two fixes:

* **`normaliseTopicSlug`** decodes any percent-encoding, strips invisible formatting characters
  (U+200B–U+200F, U+2060, U+FEFF), and slugifies. A slug is a URL component; it must contain neither.
* **The row was repaired** — with a collision check first, so two topics collapsing to one address is
  reported rather than silently clobbered.

Verified:

    /topics/religion-and-spirituality/   ->  200    (was 404)
    /topics/%e2%81%a0religion-…/         ->  404    (the old encoded form, correctly gone)
    link checker                         ->  25 pages, every internal link resolved

All 18 verification steps pass.

---

## ROUND 58 — ROUND 57'S FIX WAS ONE TABLE OF FOUR

Round 57 fixed a percent-encoded slug in `ozikoro_topic` and called it done. The link checker had only
sampled **25 pages of 14,667 URLs**, so it saw one instance. Asking the same question of **every slug in
the database** — 19 tables, discovered from `information_schema` rather than listed — found it in three
more:

    ozikoro_article   1 of 1,057     a PUBLISHED article was unreachable
    ozikoro_label     7 of 11,056
    ozikoro_media     4 of 3,488

**12 pages unreachable, all 12 published as broken addresses in the sitemap** — an instruction to search
engines to index a 404. The same cause every time: WordPress stored the slug in percent-encoded form,
the importer took it verbatim, and the router decoded the URL segment back to the real character and
matched nothing.

### Repaired

Eleven rows normalised automatically. **One refused** — label 6483's normalised form
`start-up-funding-igbo-system` was already taken by label 11056 — and the collision check reported it
instead of clobbering. It was then resolved deliberately as `-2`.

    repaired: 11 automatic + 1 by hand   remaining percent-encoded: 0

### Verified

    /entrance-to-an-igbo-compound-gwulu-onitsha-1903-1918-herbert-wimberley/   200
    /labels/imo-miri/  /labels/ori-go/  /documents/cappa/                       200
    /labels/start-up-funding-igbo-system-2/                                     200

    sitemap: 14,667 urls, percent-encoded entries: 0     (was 12+)

### A mistake in my own verification, for the tenth time

I tested the repaired article at `/entrance-to-an-igbo-compound-gwulu-onitsha-1/` — which 404'd — and
very nearly concluded the repair had failed. The slug is longer than the 40 characters my scan printed;
the real address ends `-1903-1918-herbert-wimberley`. **I had truncated my own evidence and then tested
what I had printed rather than what was there.**

### Still outstanding

`normaliseTopicSlug` is applied to **categories only**. Articles, labels and media still take their slug
verbatim on import, so the next import will reintroduce this. The helper should be renamed and applied
at every slug source — that is the durable fix, and the data is now clean so it can be done calmly.

---

## ROUND 58 (CONTINUED) — MY REPAIR WAS WRONG FOR THE ARTICLE, AND THE SUITE SAID SO

After the data repair, `verify-all.sh` reported **1 suite FAILED**. I had been about to write the round up
as a success. The failure was the archive suite, and it was right:

    ✗ every record keeps its exact original path, so no redirect is needed
      — 1 differ, e.g. /entrance-to-an-igbo-compound-%c7%b9gwulu-onitsha-1903-1918-herbert-wimberley/

The objective requires archived addresses to serve 200 **exactly as WordPress published them**, and the
suite enforces it. My normaliser had rewritten the article's slug by stripping every non-alphanumeric
character — **including the `ǹ`**. So the fix had:

* destroyed an Igbo character in a published article's address,
* broken the guarantee that migrated addresses survive, and
* quietly weakened the diacritic search this project spent a round on.

**A repair that loses the character is not a repair.** The article's slug has been restored to the
original and the suite is green again. Its page still 404s — that is the pre-existing bug, not a new one.

### What the real fix is, and why it is not this

The article is unreachable because `getArticleBySlug` looks up the **decoded** request segment, while the
database holds the **encoded** text. So the route should try both forms — the raw segment and its
decoded form — and leave the stored slug exactly as WordPress published it.

I did not attempt that here. It needs the lookup, the route, and the suite's comparison changed together,
and doing it with the context left would have risked a second half-fix on a published record. **Recorded
rather than rushed**, which is the same call made in round 52.

### The labels and media repairs stand

They do not breach the address invariant — the archive suite passes with all 11 of them in place — and
their pages return 200. Only the article was affected.

### The lesson, which is the one this project keeps teaching

The failure was caught by a check that already existed and that I ran **after** making the change.
Four rounds have now been salvaged by running the whole suite rather than the relevant part:
`just the thing I changed` is exactly the scope in which a change looks correct.

---

## ROUND 59 — THE LOOKUP IS FIXED; THE REQUEST STILL DOES NOT REACH IT

### The fix, which is right

`getArticleBySlug` now tries every spelling the same address can arrive as — the raw form,
`encodeURIComponent`d, that lowercased (the import stored lowercase hex, `encodeURIComponent` emits
uppercase, and no comparison would forgive that difference), and the decoded form. The stored slug is
**left exactly as WordPress published it**, which is what round 58 got wrong.

Verified at the domain level, directly:

    lookup('entrance-…-%c7%b9gwulu-…')   ->  FOUND
    lookup('entrance-…-ǹgwulu-…')        ->  FOUND
    stored slug unchanged                ->  entrance-…-%c7%b9gwulu-…

### But the HTTP request still 404s, and I am not going to claim otherwise

    /entrance-…-%c7%b9gwulu-…/     404
    /entrance-…-%C7%B9gwulu-…/     404
    a genuinely missing article    404

The route passes `params.slug` straight to `getArticleBySlug` with no decoding of its own, and the
lookup succeeds for both forms — so **the request is not reaching the lookup**, and the cause is in the
routing layer rather than in the query. That is as far as I got.

### What is known, and what is not

Known: the query is correct and tolerant; the stored data is intact; the archive suite passes, so the
address invariant holds; labels and media repaired in round 58 still return 200.

Not known: **why Next does not match or does not dispatch this path.** Candidates worth testing next —
whether the router rejects a segment containing a `%` escape, whether the decoded segment arrives as
something other than either spelling, whether `generateMetadata` fails first and takes the page with it,
and whether the middleware's `x-pathname` rewrite interferes. Each is a small, separate experiment.

**Recorded rather than guessed at**, and no further change made: the last time I "fixed" this by
rewriting data, round 58, I destroyed an Igbo character in a published address and the suite caught it.
A second guess on the same record is not worth the risk of the same mistake twice.

---

## ROUND 60 — NARROWED: THE REQUEST DIES IN ROUTING, BEFORE THE PAGE

Round 59 left four candidates. Three experiments eliminated most of them.

### Percent-encoding is not the problem

    /ute-okpu-an-ika-igbo-clan-and-its-nri-roots/     200   (the real slug)
    /u%74e-okpu-an-ika-igbo-clan-and-its-nri-roots/   200   (%74 = 't', one letter escaped)
    /ute-okpu-an-ika-igbo-clan-%61nd-its-nri-roots/   200   (%61 = 'a')

**Next matches and decodes percent-encoded segments correctly.** Any theory built on "the router rejects
escapes" is dead.

### It is not which spelling arrives either

    raw UTF-8 (ǹ)     404
    %C7%B9            404
    %c7%b9            404      all three, with --path-as-is

And the lookup itself succeeds for both spellings at the domain level — verified in round 59, and
re-verified here. `slugVariants` contains the decoded form, the encoded form and the lowercased encoded
form, one of which is byte-identical to the stored slug.

### What the server log shows

    GET /entrance-…-%c7%b9gwulu-…/      404 in 87ms
    GET /entrance-…-%C7%B9gwulu-…/      404 in 87ms
    GET /ute-okpu-an-ika-igbo-clan-and-its-nri-roots/   200 in 160ms

The request **arrives**, is answered **404 in under 100 ms with no route error logged**, while a
comparable slug renders in 160 ms. The page is not throwing — it is not running.

### Conclusion

Everything before the page is satisfied: the URL matches the dynamic route pattern, the encoding is
handled, the slug is in the database, and the query returns it. **The request is being refused between
arrival and dispatch.** The remaining candidate from round 59's list is the one I have not tested: the
middleware, which runs before routing and sets `x-pathname`.

### The next experiment, named rather than guessed

Request the same path with the middleware disabled, and see whether the page renders. If it does, the
middleware is the cause; if it does not, the refusal is in Next's own matching. **One experiment, one
answer** — and no change made to data or route until it is run, because the last two attempts to fix
this by changing things are the two mistakes recorded in this file.

---

## ROUND 61 — THE MIDDLEWARE IS EXONERATED, AND THE BUG IS EXACTLY ONE RECORD

### The experiment round 60 named, run

Disabled the middleware, restarted, requested the same path:

    WITHOUT middleware:  the unreachable article (encoded)  ->  404
                         the control article                ->  200

**The middleware is not the cause.** It was restored immediately and byte-for-byte (3,171 bytes, same
timestamp). Its logic also passes slashed paths straight through — but reasoning about it was not the
same as testing it, and round 59's lesson was that reasoning is where this keeps going wrong.

### Where that leaves the diagnosis

Round 60's candidate list is now exhausted except one. Established, each by experiment:

    the URL matches the route pattern          two escaped letters of a working URL both return 200
    Next decodes percent-encoding correctly    same two experiments
    the middleware is not refusing it          disabled, still 404
    the page is not throwing                   no error in the log; answered in 87ms vs 160ms for a page
    the slug is in the database                queried directly
    the query returns it                       getArticleBySlug finds it for BOTH spellings

What remains, and it is now a **hypothesis without a control**: that Next does not dispatch a dynamic
segment which **decodes to a non-ASCII character**, whereas it dispatches one that decodes to ASCII.
That fits every observation — `%74`→`t` works, `%c7%b9`→`ǹ` does not — but **I have no second case to
test it against**, so it stays labelled a hypothesis.

### Why there is no second case

    article slugs containing anything outside [a-z0-9-]:  1  — and it is this one
    label slugs:                                          1  — `omumu_uche`, an underscore, which works

**The bug affects exactly one published record out of 1,057.** That is worth knowing on its own: it
bounds the impact, and it means any future investigation has one specimen rather than a population.

### The experiment that would settle it

Insert a throwaway article whose slug is a plain ASCII string, request it, then change only its slug to
one containing a non-ASCII character and request that. One record, one variable, two requests. **Not run
here** — it writes to the database and this session has limited context left to undo it safely.

---

## ROUND 62 — THE HYPOTHESIS IS REFUTED, AND THAT NARROWS IT TO THE RECORD

Round 61 ended with a hypothesis it could not test: *that Next does not dispatch a dynamic segment
decoding to a non-ASCII character.* Round 61 also named the experiment that would settle it, and
declined to run it for want of context. It has now been run.

### The experiment, one record and one variable

A throwaway article was copied from a real published one so every column was satisfied, given an ASCII
slug, and requested. **Then only its slug changed** — the letters left alone, the character swapped for
`ǹ` — and the same address was requested three ways.

    STEP 1  zztest-probe-ascii-slug                    ->  200
    STEP 2  slug changed to zztest-probe-ǹ-slug        (one variable)
    STEP 3  /zztest-probe-ǹ-slug/      raw UTF-8       ->  200
            /zztest-probe-%C7%B9-slug/ encoded upper   ->  200
            /zztest-probe-%c7%b9-slug/ encoded lower   ->  200

**The hypothesis is refuted.** Next dispatches a dynamic segment containing a non-ASCII character
perfectly well, in raw and both encoded spellings.

### And the tolerant lookup from round 59 works

All three forms returned 200 against a database row holding the raw `ǹ` — which is the first positive
evidence that `slugVariants` does its job end to end, rather than only at the domain level.

### What that leaves

The failure is **not** about encoding, **not** about routing, **not** about the middleware, and **not**
about non-ASCII segments. Every general explanation is now eliminated by experiment, and the difference
must lie **in the one record itself**.

The concrete difference between the probe and the real article: the probe's stored slug contains the
**raw character**, while the real article's stored slug contains the **literal text `%c7%b9`** — a
percent-encoded string sitting in the database as data. A request for that address decodes to `ǹ`,
`slugVariants` then re-encodes to `%c7%b9`, and round 59 verified that this finds the row — yet the page
still 404s.

That is now the specific thing to chase, with one record to chase it in.

### Housekeeping

The probe row was deleted immediately and `check:residue` confirms the table is clean. The probe used
the `zztest` prefix deliberately, so that forgetting to remove it would fail verification rather than
sit in the database.

---

## ROUND 63 — FOUND IT: A DIFFERENCE OF LETTER CASE INSIDE A PERCENT-ESCAPE

Rounds 57 to 62 chased this. Every theory was tested and eliminated — until a temporary log in the route
showed what it actually receives:

    [probe] received slug = "entrance-to-an-igbo-compound-%C7%B9gwulu-onitsha-1903-1918-herbert-wimberley"
            codepoints = … 25 43 37 25 42 39 …        (% C 7 % B 9)
    [probe] lookup returned NULL

**Next hands the segment over still percent-encoded, with UPPERCASE hex**, and the import stored the
same thing in **lowercase** — `%c7%b9`.

`slugVariants` already contained:

    slug as given                        …%C7%B9…      no match
    encodeURIComponent(slug)             …%25C7%25B9…  the literal % escaped to %25 — no match
    that lowercased                      …              no match
    decodeURIComponent(slug)             …ǹ…           the database holds encoded text — no match

**None of them was the lowercased slug itself.** One line was missing.

### The fix

    variants.add(slug.toLowerCase());

`toLowerCase()` on the slug rather than on a re-encoded copy — and that distinction is the whole bug.

### Verified

    /entrance-…-%c7%b9gwulu-…/   lowercase, the address WordPress published  ->  200
    /entrance-…-%C7%B9gwulu-…/   uppercase                                   ->  200
    /entrance-…-ǹgwulu-…/        raw UTF-8                                   ->  200
    /no-such-article-anywhere/   a genuinely missing article                 ->  404

And the stored slug is **byte-for-byte what WordPress published** —
`…compound-%c7%b9gwulu-…` — which is what rounds 58 and 59 were about. The fix is in the lookup, not in
the data. All 18 verification steps pass; the archive suite's address invariant holds.

### What this cost, and what it was worth

    round 57  found it via the link checker; fixed the wrong half
    round 58  "fixed" it by rewriting the slug — stripped an Igbo character; the suite caught it
    round 59  made the lookup tolerant — correct, but insufficient
    round 60  eliminated routing, encoding and the middleware by experiment
    round 61  eliminated the middleware definitively; hypothesis about non-ASCII left untested
    round 62  refuted that hypothesis with a purpose-built probe
    round 63  logged what the route receives — one line, one answer

Six rounds for one character's case. **The rounds were not wasted**: each elimination is now a fact in
this file rather than a suspicion, and the probe technique that settled it is reusable. But the honest
lesson is that I spent four rounds on theories before doing the cheapest thing available — **printing the
value the code actually receives.** That should have been the first experiment, not the seventh.

---

## ROUND 64 — THE SAME TRAP WAS IN FOUR MORE LOOKUPS

Round 63 fixed one article's lookup and one line of code. The lesson was to generalise, because **the
defect was never about that article** — it was about how a slug arrives versus how it was stored, and
that applies to every slug lookup in the platform.

Eight were found; **five are public lookups that can 404 a reader**, and all five now go through
`slugVariants`:

    getArticleBySlug      archive.ts:246
    the label lookup      archive.ts:489
    getEntityBySlug       entities.ts:109
    getMediaBySlug        media.ts:166
    getPublicationBySlug  publications.ts:432

### The three that were deliberately left exact

    editorial.ts:426   select count(*) … ozikoro_entity where slug = $1
    editorial.ts:601   select count(*) … ozikoro_source where slug = $1
    publications.ts:642 select count(*) … ozikoro_publication where slug = $1

All three are `const taken = …` — **uniqueness checks made while generating a slug.** A tolerant
comparison there would report collisions that do not exist and hand out `-2` suffixes for no reason.
The distinction is: *finding a record* must be forgiving, *deciding whether a name is free* must be
exact. That is why `slugVariants` is exported and used deliberately rather than applied everywhere.

Verified by grepping the result rather than trusting the edit — five tolerant lookups and three exact
ones, which is the split intended. All 18 verification steps pass.

---

## ROUND 65 — THE ROUND-63 FIX NOW HAS A TEST, AND THE TEST IS PROVEN TO BITE

Rounds 63 and 64 fixed the missing `slugVariants` line across **five public lookups** and wrote **no
test** — the same gap round 46 identified for the authorization fix, where a security fix without a
regression test is one that reverts quietly the next time somebody tidies the file.

`slug-variants.test.ts`, six cases, including the exact pair from the real archive:

    the lowercased slug is among the variants — the round-63 bug
    an incoming slug is always its own variant
    the decoded form is a variant, so a request written with the character works
    the encodeURIComponent form escapes the literal percent, so it cannot cover this case
    a slug with no escapes still yields a usable set and no duplicates
    a malformed escape does not throw

The unit suite went from 58 tests to 64.

### The test was mutation-checked rather than assumed to work

A test that cannot fail is not a test, and two rounds in this project have already produced tests that
passed for the wrong reason. So the fix was removed and the suite re-run:

    with `variants.add(slug.toLowerCase())` deleted:
      ✖ the lowercased slug is among the variants — the round-63 bug
      ℹ tests 64  ℹ pass 63  ℹ fail 1

    restored:
      ℹ tests 64  ℹ pass 64  ℹ fail 0

**Exactly one test fails, and it is the one named after the bug.** The line is now protected: deleting it
fails the suite rather than silently returning a published article to 404 for eight more rounds.

### The fourth case is the one worth keeping

`encodeURIComponent` escapes the literal `%` to `%25`, so its output **can never equal** a slug that
already contains an escape. That test asserts the two are different — which is the reason the raw
lowercased form had to be added separately instead of being assumed to fall out of the encoding step.
It documents *why the bug existed*, not merely that it was fixed.

---

## ROUND 66 — THE MAIN NAVIGATION LINKED TO A 404 ON EVERY PAGE

Round 57 built a link checker and capped it at 25 pages. Round 66 ran it at **120** — and it immediately
found something the small walk could not:

    404    /watch
    pages checked: 120
    BROKEN LINKS: 1

`/watch` was in `layout.tsx`, which means **every page on the site carried a link to a 404 in its main
navigation.** No suite notices that: they assert data and logic, not whether the site's own menu leads
anywhere.

### The fix was not to remove the link

The design delivers a `watch.html` screen and the archive holds **13 videos**, so the section is real —
the navigation was pointing somewhere that had never been built. And it did not need building: the media
listing already supports a `kind` filter, and `/documents/` already reads it.

    <Link href="/watch">Watch</Link>   ->   <Link href="/documents?kind=video">Watch</Link>

Verified: `/documents?kind=video` returns 200 and lists video records.

### The lesson, which is about sample size rather than about links

Round 57 found a real 404 with a 25-page walk and I treated the tool as having done its job. A walk
capped at 25 pages cannot see a link that appears on *every* page unless it happens to visit one early —
and it did not, because `/watch` sits in the header of pages the walk reached later.

**A checker's cap is a coverage claim.** The first walk said "25 pages, every internal link resolved",
which was true and told me almost nothing. This one said "120 pages, every internal link resolved",
which is four times the evidence.

    after the fix:  120 pages checked, every internal link resolved

---

## ROUND 67 — I CHECKED THE WRONG WEBSITE, AND THE CORRECTION IS A GOOD RESULT

Round 66's lesson was that a cap is a coverage claim. So this round sampled the **depth** rather than
walking the surface: 45 random URLs drawn from the 14,667-URL sitemap.

The first run returned **41 non-200 of 45** — 301s and 404s across label and media pages. That looked
like a catastrophe.

**It was a measurement error, and mine.** The sitemap emits **absolute** URLs —
`https://ozikoro.com/labels/ubulu/` — which is *correct*, because a sitemap must name the origin a
crawler should use. My check fetched them verbatim, so it sampled **the live old WordPress site**, not
the platform. The 404s were WordPress's.

Re-run with the origin rewritten to the local server:

    45 sampled paths — 33 labels, 8 documents, 4 articles
    non-200: 0

**Every deep page the sitemap advertises resolves.** That is the strongest evidence yet that the sitemap
is sound, and it is a better result than a surface walk can produce: the walk covers what is *linked*,
the sample covers what is *listed*.

### The trap, recorded because the tooling invites it

`check-links.sh` takes a `BASE_URL` and is therefore safe — it only ever follows links it finds on the
pages it fetched. But **anything that reads the sitemap's `<loc>` values and requests them directly will
hit production**, because that is what those values are for. The two must not be confused:

    a link found on a page      -> same origin as the page, safe to follow
    a <loc> from the sitemap    -> the PRODUCTION origin by design, never local

The check above is the correct pattern: read the sitemap for the **paths**, then request them from the
server under test.

### A note on how convincing the wrong answer was

41 failures out of 45 is exactly the kind of number that ends an investigation early — it looks like a
finding, it is dramatic, and it would have been written into this file as one. The only reason it was
not is that *the 404s named labels I had just verified worked*. **A result that contradicts a fact you
already established is a measurement error until proven otherwise.**

---

## ROUND 68 — THE SITEMAP SAMPLE IS NOW A TOOL, NOT A ONE-OFF

Round 67's check was a throwaway python script and it produced the most convincing evidence in this file
— 45 deep URLs, 0 failures. A one-off that good should not stay a one-off, and the origin trap that
fooled me would fool the next person.

`scripts/check-sitemap.sh`, wired as `npm run check:sitemap`.

    Samples N pages the sitemap advertises, requested from BASE
    (the sitemap names the production origin; the paths are what is tested here)
    sitemap lists 14667 paths
    checked: 40
    Every sampled page resolved.

It reads the sitemap for **paths** and requests them from the server under test, which is the correction
from round 67 built into the tool so nobody has to rediscover it.

### It complements check-links.sh rather than duplicating it

    check-links.sh     follows links found on pages   ->  what is LINKED, the readable surface
    check-sitemap.sh   samples <loc> values           ->  what is LISTED, the long tail

A 120-page walk cannot see a label page that only a crawler would reach. A 40-page sample of the sitemap
reaches four article pages, eight media pages and thirty-three label pages that no menu points at.

### Two guards, both tested rather than assumed

* **No server:** `exit 2` with *"Could not fetch … Is the server running?"* — not a pass.
* **Nothing checked:** `exit 2` with *"NOTHING WAS CHECKED — not a pass."* The round-57 lesson, applied
  before it was needed rather than after.

### A macOS trap inside the tool, caught by the tool's own guard

The first version parsed the sitemap with `sed 's|https\?://[^/]*||'`. **BSD sed does not support `\?`**,
so the origin was never stripped: every "path" was a full `<loc>` element, and all 40 samples were
reported broken with status `000`.

That is exactly the shape of round 67's error — a dramatic false alarm — and this time it was caught in
the same minute, because the **"nothing was checked" guard** had already been written and the malformed
entries tripped it. Parsing moved to `python3`.

**The guard was written for a different failure and caught this one. That is what guards are for.**

---

## ROUND 69 — THE SITEMAP VERIFIED AT 300 PAGES

Round 68 built the sampler; this round used it at scale rather than at its default.

    sitemap lists 14667 paths
    checked: 300
    Every sampled page resolved.

**Three hundred pages drawn at random from the 14,667 the sitemap advertises, every one returning 200.**
The sample is spread across labels, media and articles because the sitemap is overwhelmingly labels —
10,100 of the 14,667 — which is also where the two real URL bugs were found, in rounds 57 and 58.

### What this is, and what it is not

It is **2% of the sitemap, sampled deterministically**, so the run is reproducible and a failure can be
reproduced exactly. It is not every URL. At roughly 0.1 seconds per request, checking all 14,667 would
take about twenty-five minutes, which is affordable and simply has not been done.

So the honest statement is: **no broken page was found in 300 sampled, and 14,367 have not been
requested.** That is a real improvement on the round-57 position, where the walk had covered 25 pages
and nothing had been sampled at all.

### The three checks now, and what each covers

    check-links.sh     120 pages, following links        ->  what a reader can CLICK
    check-sitemap.sh   300 sampled <loc> paths           ->  what a crawler is TOLD
    check:residue / check:capabilities                   ->  what the DATABASE holds

Each found a real defect the others could not: the walk found the navigation's 404, the sample found
the two percent-encoded slug families, and neither would ever have found test residue published as
researchers.

### Still not covered by anything

* **Deep links inside article bodies.** The walk follows `href` values it finds, but only from pages it
  reaches; an article's own body links are covered only if the walk happens to fetch that article.
* **The remaining 14,367 sitemap URLs.**
* **Assets**: images, stylesheets and scripts are deliberately skipped by both tools.

---

## ROUND 70 — THE FULL SITEMAP: ALL 14,667 URLS REQUESTED

    sitemap lists 14667 paths
    checked: 14667
    BROKEN: 31 of 14667

Then the 31 were re-requested one at a time, and **every one returned 200**:

    /labels/sacred-journey-nigeria/   200      /documents/kolanut/          200
    /documents/img_4058/              200      /labels/aba/                 200
    /documents/adamma/                200      /labels/benin-empire/        200
    /documents/pericoma/              200      /labels/igbo-market-systems/ 200

**They were not broken.** They returned curl's `000` — no response at all — because the dev server
dropped requests during a 14,667-request sequential run. Every one resolved on re-request.

### The tool was wrong to call that broken

`000` means **"we do not know"**, not "defect". Reporting an unknown as a failure is the exact
false-positive this project has produced more than a dozen times — and this time the tool did it, not me.
`check-sitemap.sh` now retries `000` twice, with a pause, and labels anything that still fails as
`NO RESPONSE (retried twice)` rather than as a broken page.

**So the honest result of the full run is: all 14,667 sitemap URLs were requested, and every page that
answered returned 200. Zero broken pages were found.**

### And my invocation masked the exit code

The run was launched as `check-sitemap.sh … | tail -40`, and the job reported **exit 0** while the script
had reported 31 failures. In a pipeline the exit status is `tail`'s, not the script's — the same mistake
recorded in round 31, where `|| echo` after a pipe tested `head` rather than `grep`. **Pipe a checker's
output and you have thrown away its verdict.**

### Coverage now

    check-links.sh     120 pages, following links    ->  what a reader can CLICK
    check-sitemap.sh   14,667 paths, every one       ->  what a crawler is TOLD   (complete)
    check:residue / check:capabilities               ->  what the DATABASE holds

---

## ROUND 71 — THE EDITED CHECKER, VERIFIED WITH ITS EXIT CODE READ DIRECTLY

Round 70 changed `check-sitemap.sh` in flight, adding the `000` retry. New code needs running, so:

    bash scripts/check-sitemap.sh http://127.0.0.1:3100 25 > /tmp/cs71.txt 2>&1
    echo $?    ->  0
    checked: 25
    Every sampled page resolved.

Note the shape of that invocation: **the output went to a file and the exit code was read from the
command itself**, not through a pipe. Round 70's failure was launching the same script as
`… | tail -40`, where the reported status belongs to `tail` and the script's own verdict was discarded.
The lesson was applied in the very next round, which is the only test of whether a lesson took.

All 18 verification steps pass.

### Where this leaves the coverage work

    check-links.sh     120 pages following links     ->  what a reader can CLICK
    check-sitemap.sh   14,667 paths, all requested   ->  what a crawler is TOLD   (complete)
    check:residue      every table with a text column ->  what the DATABASE holds
    check:capabilities names read from the source     ->  what the CODE requires
    verify-all.sh      all 18 steps in one command

Four of those five did not exist thirty rounds ago, and **each found a real defect on or shortly after
its first run**: an unreachable published article, a navigation link to a 404 on every page, test residue
published as researchers, a capability granted to nobody. The fifth, `verify-all.sh`, is what made
running all of it routine rather than remembered.

---

## ROUND 73 — MY BODY-LINK CHECK FOUND NOTHING BECAUSE IT LOOKED FOR THE WRONG THING

Round 71 named the remaining coverage gap: *"deep links inside article bodies — the walk follows href
values, but only from pages it reaches."* So those links were extracted from all 1,057 published bodies
and compared against the 14,667 URLs already verified.

    ARTICLES_SCANNED=1057
    INTERNAL_BODY_LINKS=0
    DISTINCT_UNKNOWN_TARGETS=0

**Zero links, and it looked like a clean bill of health.** It was a false negative. The pattern was
`href="(/[^"#?]*)` — relative URLs only — and the archive's links are **absolute**:

    ARTICLES=1057   WITH_HREF=91   WITH_ANCHOR=91   MENTIONS_SITE=1030

Ninety-one articles contain anchors, and 1,030 mention the site. My check had discovered nothing because
it was looking for a spelling that does not occur.

### This is the mirror of the error this file keeps recording

Thirteen previous corrections were **false positives** — a check reporting a fault that was not there.
This is the opposite, and it is worse in one specific way: **a false positive is visible in the output
and invites scrutiny. A false negative produces an empty result, and an empty result reads as success.**

A pattern that matches nothing and a dataset with nothing to match are indistinguishable from the
outside. The only defence is to check that the pattern can match *something* — which is exactly what the
second query did, and why it took two attempts rather than one.

### Still to do, now precisely scoped

The 91 articles with anchors need their absolute internal links extracted and compared against the
verified URL set. That is a small, well-defined job and it is **not done**: the first attempt at it was
the one that failed.

Also observed, and not a defect: **1 article has an empty body**, which rounds 9 and 43 established is
deliberate — the record is kept, the gap is visible, and the page still renders a heading.

---

## ROUND 74 — FORTY BROKEN LINKS INSIDE ARTICLE BODIES, AND TWO SYSTEMATIC FAMILIES

Round 73 scoped this exactly and wrote the guard against repeating its own mistake; this round ran it.
The pattern was checked to match **before** its result was trusted:

    ARTICLES_WITH_HREF=91
    ANCHORS_SEEN=300        <- non-zero, so the pattern works
    INTERNAL_LINKS=195
    DISTINCT_UNKNOWN=40     <- targets the verified 14,667 do not contain

**Forty distinct broken targets, reached from 195 links inside 91 published articles.** They fall into
two systematic families and a tail:

    WORDPRESS AUTHOR ARCHIVES         /author/nze/                  x16
                                      /author/chizobem-chinedu-opiah/ x3
                                      /author/chuka/  /author/ossai/  /author/aka/   x2 each

    WORDPRESS CATEGORY ARCHIVES       /historical-studies/          x13
                                      /biography/  /cultural-heritage/  x4 each
                                      /ethnohistory/  /discography/  x3 each

    ARTICLE-LIKE PATHS                /womens-title-taking-the-iyom-otu-odu-title…  x2
                                      /nsude-pyramid-spirituality…/a-nsude-pyramid…/  x2
                                      and a tail of single occurrences

The two families are the same defect: **the old site served `/author/<name>/` and `/<category>/` as
archive pages, and this platform serves those records at `/researchers/` and `/topics/<slug>/`.** Every
in-body link to one of them now lands on a 404.

### This is the gap round 71 named and round 73 failed to test

Round 71 wrote: *"deep links inside article bodies — the walk follows href values, but only from pages it
reaches."* Round 73 tried to close it and reported zero because of a pattern error. So the gap was known
for three rounds and open the whole time — and it held **40 broken targets**, not zero.

**A stated gap is not a closed gap, and a failed check of a gap looks exactly like a clean one.**

### The mechanism to fix it already exists, unused

`ozikoro_redirect` was created in migration 0035 for precisely this. What it needs is entries mapping the
old archive paths to the new ones — `/author/<name>/` to that author's filter, and `<category>/` to
`/topics/<category>/` — plus a handler that consults it. **Not done**, and now precisely specified.

### Also worth noting about the tail

Some of the article-like paths may be genuinely dangling references from the original site, and some may
be articles whose slug differs from the link. Each needs looking at individually; they are not a family
and should not be bulk-redirected on a guess.

---

## ROUND 75 — BEFORE BUILDING THE REDIRECT HANDLER, READ THE ONE ROW IT WOULD ACT ON

Round 74 specified the fix for the 40 broken in-body links: populate `ozikoro_redirect` and add a
handler. This round looked at the table before touching it, and found the reason to pause.

    ozikoro_redirect: id, from_path, to_path, status, reason, created_at
    one row: from_path '/', to_path '/home/', status 301,
             reason 'Migrated from WordPress: the slug changed'
    no handler anywhere reads this table

**The single existing row redirects the site root to `/home/`.** Built as specified, the first thing the
handler would do is send every visitor from the new homepage to a migrated WordPress page of the same
name — replacing the front page of the platform with the page it was built to supersede.

### My first reading of it was wrong, and checking corrected it

I called it a landmine on the assumption that `/home/` did not exist. It does:

    ARTICLE_HOME=[{"slug":"home","is_page":true,"status":"published"}]

So the target is real, and the row is not dangling — it is a **deliberate-looking mapping whose intent I
do not know**. `reason` says *"the slug changed"*, which describes a slug correction, but `from_path` is
`/`, which is not a slug.

**Two readings, and the evidence does not choose between them:**

* it is a genuine mapping created by an editorial action, and the root is intended to move; or
* `from_path` was meant to be something narrower and `/` was entered by mistake.

Deleting it would destroy a mapping someone may have created on purpose; keeping it and building the
handler would break the homepage. **Neither is mine to decide**, so nothing was changed.

### What this means for the fix

The 40 broken in-body links still need the redirect mechanism, and the mechanism is one row away from
being safe to build. **The first step is not code — it is establishing what that row is for.** A question
for the owner, and a good example of why the handler should be built deliberately rather than next to a
table nobody has read.

---

## ROUND 76 — THE AUTHOR LINKS MAP EXACTLY ONTO DATA THAT ALREADY EXISTS

Round 74 found two systematic families among the 40 broken in-body links and round 75 found the
redirect table blocked on a question for the owner. This round established that **one of the two
families needs no redirect and no owner question at all.**

The broken author links, against the contributor slugs already in the database:

    /author/nze/                     ->  contributor slug `nze`                     (Idenze Ezeme)
    /author/chizobem-chinedu-opiah/  ->  `chizobem-chinedu-opiah`                    (Chizobem Chinedu Opiah)
    /author/chuka/                   ->  `chuka`                                    (Chuka Odike)
    /author/ossai/                   ->  `ossai`                                    (Chukwunwike Ossai)
    /author/aka/                     ->  `aka`                                      (Akachukwu Vitalis)

**Every one matches exactly.** WordPress served `/author/<slug>/` and the import kept each contributor's
`slug`, so those addresses can be served directly by a route — `/author/[slug]/` rendering that
contributor's articles — with no redirect table involved and nothing to ask the owner about.

That accounts for roughly **25 of the 40** broken targets, and it is the cleaner of the two fixes: a
route that serves the address, rather than a redirect that moves it.

### The category family is genuinely different

`/historical-studies/`, `/biography/`, `/cultural-heritage/`, `/ethnohistory/`, `/discography/` are
**single-segment** paths, which means they collide with `app/[slug]/` — the article route. The router
cannot tell a category from an article by shape, so this family does need the lookup-then-redirect
mechanism, and that mechanism is the one blocked on round 75's question about the `/` → `/home/` row.

### Not done, and precisely why

The `/author/[slug]/` route is scoped and unbuilt. It needs a listing by contributor, and I ran out of
room to confirm whether the existing article listing takes an author filter or whether it needs one
adding. **That check is the first step, and it is one grep.** Not a guess: recorded as the specific
unknown.

I would rather leave it specified than half-built. Round 58 is the standing reminder that a rushed fix
on a published record cost an Igbo character and a broken invariant.

---

## ROUND 77 — THE AUTHOR FAMILY IS FIXED: 25 OF THE 40 BROKEN LINKS NOW SERVE 200

Rounds 74, 75 and 76 specified this; round 77 built it.

    /author/nze/                  200      /author/ossai/   200
    /author/chizobem-chinedu-opiah/ 200    /author/aka/     200
    /author/chuka/                200      /author/nobody-here/  404

### What was added

* **`authorSlug` on `ListOptions`**, filtered through a **subquery** rather than a join —
  `a.author_id = (select id from ozikoro_contributor where slug = $n)`. `listArticles` already joins
  `ozikoro_contributor`, but `countArticles` does **not**, and both call `listWhere`. Referencing
  `c.slug` there would have thrown an unknown-table error that appears **only on pages that paginate** —
  invisible on the first page and on every test that does not turn a page.
* **`app/author/[slug]/page.tsx`**, rendering that contributor's records with `CollectionPage` structured
  data describing a list, not asserting a biography the archive does not hold.

### Why a route and not a redirect

The address can be **served**, so it stays a 200 at the URL WordPress published. That is what the archive
invariant asks for, and it needed no entry in `ozikoro_redirect` — which keeps it clear of round 75's
unresolved question about the `/` → `/home/` row entirely.

### Two mistakes caught by checking rather than assuming

* The first import was `'../../../components/ArticleCard'`, **which does not exist** — the working pages
  use `'../../_components/article-entry'`. The typecheck found it immediately.
* An earlier patch of the same file **silently failed on indentation**: my search string had two leading
  spaces and the real code has none. The `assert` refused the edit instead of writing a mangled file,
  which is the only reason a second pass was needed rather than a broken one.

### Remaining from the 40

The **category family** — `/historical-studies/`, `/biography/`, `/cultural-heritage/`, `/ethnohistory/`,
`/discography/`, about 27 links — plus the article-like tail. Those are single-segment paths colliding
with `app/[slug]/`, so they need the lookup-then-redirect mechanism, and that is still behind round 75's
question. **The two halves of this defect turned out to need entirely different fixes**, which is why
separating them a round at a time was worth doing.

---

## ROUND 78 — THE CATEGORY FAMILY, AND A CORRECTION TO MY OWN COUNTING

The second half of the round-74 defect is fixed.

    /historical-studies/   308 -> /topics/historical-studies/    (target 200)
    /biography/            308 -> /topics/biography/
    /cultural-heritage/    308    /ethnohistory/    308    /discography/    308
    a real article         200    (the article lookup runs FIRST, so no article is shadowed)
    nothing at all         404

The fallback sits in `app/[slug]/page.tsx`, reached only when no article matches, so a topic can never
shadow a record. It resolves the collision described in round 76: `/<category>/` and `/<article>/` are
both one segment and the router cannot tell them apart by shape.

### 307 would have preserved the very loss the file complains about

`redirect()` issues a **307** — *temporary*, which tells a crawler to keep the old address indexed and
expect the move to be undone. The comment at the top of this file already worried about *"the loss of
whatever those addresses have accumulated in search"*, and a 307 is precisely how that loss is
preserved. Changed to `permanentRedirect()`, which is a **308**.

### Correction: I have been sloppy about "40"

Round 74 reported **40 distinct broken targets across 195 links**, and rounds 77 and 78 have each
described their fix as covering "25 of the 40" and "27 of the 40". **Those numbers are links, not
targets, and they are not the same denominator.** The accurate account:

    distinct broken targets   40      (round 74)
      author family            5      /author/nze/, /author/chuka/, /author/ossai/,
                                     /author/aka/, /author/chizobem-chinedu-opiah/
      category family          5      /historical-studies/, /biography/, /cultural-heritage/,
                                     /ethnohistory/, /discography/
      article-like tail       30      single and double occurrences, individually different

    links involved           195
      at the 5 author targets         ~25
      at the 5 category targets       ~27

**Ten of the forty targets are fixed, covering about 52 of the 195 links.** The remaining **30 targets
are the article-like tail** — `/womens-title-taking-the-iyom-otu-odu-title-in-igbo-culture/` and paths
like it — and they are **not a family**: some may be genuinely dangling references from the original
site, some may be articles whose slug differs from the link. **Each needs looking at individually, and
bulk-redirecting them would be guessing.**

Correcting this matters because "25 of 40" reads as most of the work done, when in fact the two families
were the five-target kinds a rule can fix, and **the 30 that remain have no rule at all.**

---

## ROUND 81 — THE 30 "INDIVIDUAL JUDGEMENTS" ARE ONE RULE, AND A NEXT.JS CONSTRAINT

Round 78 recorded the remaining 30 broken targets as *"not a family… each needs looking at individually."*
This round tested that assumption instead of repeating it, and **it was wrong.**

### 26 of the 30 are WordPress attachment permalinks

    /ibini-ukpabi-the-arochukwu-long-juju/aros-spiritual-head-of-kalabari-crosbie-oates-family-journal-1853-1859/
    /nsude-pyramid-spirituality-in-igbo-architecture/a-nsude-pyramid-taken-by-g-i-jones-1935/
    /ndi-igbo-meet-the-igbo-people/igbo-sub-tribes/
    …and 23 more of the same shape

Two segments, the first an **existing article**, and the **last segment a media slug**. Measured, not
inferred — 8 of 9 tested resolved exactly against `ozikoro_media.slug`:

    MEDIA_TOTAL=3488
    SEG EXACT  aros-spiritual-head-of-kalabari-crosbie-oates-family
    SEG EXACT  20241023_034835
    SEG EXACT  mbari-house-owen…  mbari-house-owerri-1904
    SEG EXACT  igbo-sub-tribes
    SEG no     ulusamplesfromawkadistrict          loose: none
    EXACT_HITS=8 of 9

That is WordPress's attachment permalink shape: the old site rendered an attachment page there, and this
platform serves the same media record at `/documents/<slug>/`.

**So the 30 are not 30 judgements. They are one rule covering 26, plus four genuine strays** —
`/how-a-hunter-obtained-money…/`, `/womens-title-taking-the-iyom-otu-odu-title-in-igbo-culture/`,
`/uli-samples-from-awka-district-n-w-thomas-1910-11/`, and an `/nri-nshi-kingdom…/` path whose parent
does not exist.

### The route for it was written, and Next.js refused it

    [Error: You cannot use different slug names for the same dynamic path ('parent' !== 'slug').]

**This app already uses `slug` for every dynamic segment at both depths** — `app/[slug]/`,
`app/topics/[slug]/`, `app/labels/[slug]/`, `app/documents/[slug]/`, `app/author/[slug]/`. Next requires
one name per dynamic path, so `app/[parent]/[child]/` is rejected outright **and takes the whole dev
server down with it** — every route returned `000`, including ones that had worked a minute earlier.

The route was removed, and the server was verified back: `/`, `/topics/historical-studies/`,
`/labels/aba/`, `/documents/kolanut/`, `/author/nze/` and an article all return 200 again.

**The fix therefore cannot be a differently-named pair of segments.** It has to be either
`app/[slug]/[slug]/` — the same name twice, which is worth testing — or a mechanism outside the router
entirely, such as the `ozikoro_redirect` table that round 75 left blocked on a question for the owner.

### Two things worth keeping from this

* **"Needs individual judgement" is a claim like any other, and it was false here.** Twenty-six of thirty
  collapsed into one rule under a single measurement. The same instinct that produced "a stated gap is not
  a closed gap" applies to a stated difficulty.
* **A route that fails to compile does not fail politely.** It removed the entire dev server, so the
  blast radius of a routing mistake is the whole site rather than one page. Worth remembering before
  adding routes that compete with existing ones.

---

## ROUND 82 — THE ROUTER CANNOT EXPRESS THIS FIX, AND THAT IS NOW PROVEN BOTH WAYS

Round 81 tried `app/[parent]/[child]/` and Next refused:

    You cannot use different slug names for the same dynamic path ('parent' !== 'slug').

That left one candidate inside the router: the same name twice. This round tested it.

    [Error: You cannot have the same slug name "slug" repeat within a single dynamic path]
    / (server alive?) -> 000

**Both spellings are rejected, so `/<parent>/<child>/` cannot be a route in this application at all.**
Not "is awkward" — impossible. It has an all-dynamic pair, and the route tree already claims depth one:

    app/[slug]                  dynamic at depth 1
    app/topics/[slug]           static parent, dynamic child
    app/labels/[slug]           static parent, dynamic child
    app/documents/[slug]        static parent, dynamic child
    app/author/[slug]           static parent, dynamic child
    app/researchers/[slug]      app/publications/[slug]      app/entities/[slug]

A nested dynamic under a dynamic needs **the same name** (forbidden) or **a different name** (forbidden).
So the 26 attachment permalinks **must be handled outside the router.**

### The two remaining options, both already in this file

* **Middleware.** It runs before routing, which is exactly why the trailing-slash rewrite was put there
  in the first place. It would need database access, which is not the default runtime.
* **`ozikoro_redirect`.** The table built in migration 0035 for precisely this — and **still blocked on
  round 75's question** about what the `/` → `/home/` row is for, because a handler acting on that row
  would redirect the homepage away from itself.

### The cost of these two attempts, stated plainly

**Each failed route took the entire dev server down** — every URL returning `000`, including pages that
worked seconds earlier. Both were reverted and the server verified back on six key routes each time.

A routing mistake here is not a broken page; it is a broken site. That is worth knowing before the third
attempt, and it is the reason the next attempt should be made against the middleware or the table —
places where a mistake is contained — rather than against the route tree.

---

## ROUND 83 — HALF THE ATTACHMENT FIX, BUILT WHERE IT CANNOT BREAK ANYTHING

Rounds 81 and 82 established that `/<parent>/<child>/` cannot be a route, and that each attempt to make
it one **took the entire site down**. The remaining mechanism is the middleware, which touches every
request and therefore carries the same blast radius.

So this round built the half that cannot break anything: the **destination**.

    app/attachment/[slug]/page.tsx      static parent, dynamic child — expressible

Verified:

    /attachment/igbo-sub-tribes/   308 -> /documents/igbo-sub-tribes/
    /attachment/nothing-here/      404

    /   /topics/historical-studies/   /labels/aba/   /documents/kolanut/   /author/nze/   all 200

**Additive, and every existing route still resolves** — the opposite of rounds 81 and 82, where the
attempt itself was the outage. A new static segment cannot collide with the route tree, which is why this
was the safe half to build first.

### What remains, and why it was not attempted now

One middleware rewrite:

    /<unknown-first-segment>/<media-slug>/   ->   /attachment/<media-slug>/

The middleware would need to know which first segments are real routes — `topics`, `labels`, `documents`,
`author`, `admin`, `api`, `researchers`, `publications`, `entities`, `media`, `_next`, `design` — and
rewrite everything else. Get that list wrong in the permissive direction and a genuine 404 becomes a
redirect loop; wrong in the strict direction and attachments keep 404ing.

**It is a small change to a file every request passes through**, and the two previous attempts at this
same defect each took the whole site down. Building it needs room to verify every route afterwards, which
this round did not have. **The destination is in place and proven; the rewrite is one step, specified.**

---

## ROUND 84 — THE ATTACHMENT PERMALINKS ARE FIXED, AND NOTHING ELSE MOVED

Round 83 built the destination; this round built the rewrite. Together they close the largest remaining
family of broken links found in round 74.

    /ibini-ukpabi-…/aros-spiritual-head-of-kalabari-…/21853-1859/  ->  308  /documents/aros-spiritual-…/
    /nsude-pyramid-…/a-nsude-pyramid-taken-by-g-i-jones-1935/      ->  308  /documents/a-nsude-pyramid-…/
    /ndi-igbo-meet-the-igbo-people/igbo-sub-tribes/                ->  308  /documents/igbo-sub-tribes/

### Why the middleware, and why it is shaped this way

The address cannot be a route — rounds 81 and 82 proved both spellings rejected by Next, each attempt
taking the whole site down. Middleware runs **before** routing, which is why the trailing-slash rewrite
already lived there. It rewrites `/<unknown-first-segment>/<last-segment>/` to `/attachment/<last-segment>/`,
where a **static** parent makes the route expressible.

An allowlist of real first segments is the safe construction:

    topics labels documents author researchers publications entities media
    archive folklore search about claims reviews admin attachment _next design api

Wrong in the permissive direction, a real route is shadowed; wrong in the strict direction, attachments
keep 404ing. Everything not listed is assumed to be a post slug.

### Verified exhaustively, because the blast radius is every request

    /  /archive/  /folklore/  /about/                     200
    /topics/historical-studies/  /labels/aba/             200
    /documents/kolanut/  /author/nze/                     200
    /ute-okpu-an-ika-igbo-clan-and-its-nri-roots/         200
    /api/health                                           200     the API is untouched
    /historical-studies/                                  308     round 78's category redirect still works
    the three attachment permalinks                       308     fixed
    /no-such-parent/no-such-child/                        404     still 404s, no loop

    All 18 verification steps pass.

### One 404 that is correct, and worth stating

`/researchers/298/` returns 404. That is **not** a regression: 298 and 299 were the `zztest` accounts
removed in round 44, and the `/researchers/` listing returned no profile links at all — consistent with
the largest open gap in this file, that **0 of 1,051 records is linked to an entity**. The route family is
sound; there is simply nothing published for it to show.

### Where the round-74 defect now stands

    distinct broken targets                  40
      author family           5 fixed        round 77, served directly
      category family         5 fixed        round 78, permanent redirects
      attachment tail        26 fixed        rounds 83 and 84
      genuine strays          4 open         /how-a-hunter-obtained-money…/,
                                             /womens-title-taking-the-iyom-otu-odu-title…/,
                                             /uli-samples-from-awka-district-n-w-thomas-1910-11/,
                                             and one /nri-nshi-kingdom…/ path whose parent is absent

**Thirty-six of forty targets now resolve.** The four that remain genuinely are individual cases, and
having eliminated the families rather than assumed they were one, that claim is finally earned.

---

## ROUND 85 — RE-MEASURED, AND MY OWN SCRIPT WAS WRONG AGAIN

Rounds 74 to 84 fixed this defect by accounting — two families by rule, one by middleware, and four
declared strays. This round **re-measured instead of trusting the tally**, by re-running the body-link
extraction against what the platform now serves.

    INTERNAL_LINKS=195
    REMAINING_UNKNOWN_TARGETS=8
      STILL x16  /author/nze/                      STILL x3  /author/chizobem-chinedu-opiah/
      STILL x2   /author/chuka/   /author/ossai/   /author/aka/
      STILL x2   /womens-title-taking-the-iyom-otu-odu-title-in-igbo-culture/
      STILL x1   /how-a-hunter-obtained-money-from-his-friends-the-leopard-goat-bush-cat-and-cock-…/
      STILL x1   /uli-samples-from-awka-district-n-w-thomas-1910-11/

**Six of those eight are the author links round 77 fixed and verified at 200.** They appear here because
of a bug **in the measuring script**: `/author/nze/` has two segments, and my allowance for contributors
only tested the single-segment case. The links are served; the script could not see it.

Correcting for the script's own bug, **the genuine remainder is four targets** — the two printed above
plus the two strays recorded in round 84.

### The pattern, which is now beyond coincidence

This is the **fifteenth** time in this project that the verification, rather than the work, was the
defective part — and the third distinct way it has failed:

    false positive     a check reporting a fault that was not there      (13 times)
    false negative     a check reporting nothing because it matched
                       the wrong spelling                                 round 73
    stale allowance    a check whose list of "now fixed" does not cover
                       the fix it is re-measuring                          round 85

**A re-measurement is code, and code has bugs.** The reason to re-measure is that the accounting might be
wrong; the reason not to trust the re-measurement blindly is that it might be too. The only thing that
settled it here was the round-77 evidence — `/author/nze/` returning 200 — which contradicted the script.

**A result that contradicts a fact you already established is a measurement error until proven otherwise.**
Round 67 taught that; round 85 needed it again, in a new disguise.

### The verified position

    distinct broken targets found in round 74     40
    resolved by rounds 77, 78, 83 and 84          36
    genuinely open                                 4
      /womens-title-taking-the-iyom-otu-odu-title-in-igbo-culture/
      /how-a-hunter-obtained-money-from-his-friends-the-leopard-goat-bush-cat-…/
      /uli-samples-from-awka-district-n-w-thomas-1910-11/
      an /nri-nshi-kingdom-…/ path whose parent article is absent

These four have no shape in common with each other or with either fixed family. **They need a human
decision about the original intent — a redirect, a correction, or an acknowledgement that the source
article linked to something that never existed.**

---

## ROUND 86 — THE BODY-LINK CHECK IS A TOOL, AND THE ANSWER IS THREE

The extraction behind rounds 73, 74, 81 and 85 was a **throwaway script written four times**, and three of
those versions had bugs. It is now `scripts/check-body-links.mjs`, wired as `npm run check:body-links`.

    articles with links : 91
    anchors seen        : 300
    internal links      : 195
    DISTINCT DEAD       : 3
      x2  /womens-title-taking-the-iyom-otu-odu-title-in-igbo-culture/
      x1  /how-a-hunter-obtained-money-from-his-friends-the-leopard-goat-bush-cat-…/
      x1  /uli-samples-from-awka-district-n-w-thomas-1910-11/

**Three, not four.** Round 84 listed an `/nri-nshi-kingdom-…/` path as a stray; against the full
accounting it resolves or is not present. My tally has now been wrong twice in this defect — once by
counting links as targets, once by listing a stray that was not one — which is the argument for the tool
existing rather than for me being more careful.

### The families are stored as SHAPES, not as examples

    /<topic-slug>/                1 segment, topic      -> 308 to /topics/<slug>/     (round 78)
    /author/<contributor-slug>/   2 segments            -> served directly            (round 77)
    /<parent>/<media-slug>/       2 segments            -> 308 to /documents/<slug>/  (rounds 83-84)

Round 85's measurement missed the author family because it tested contributors as a **single-segment**
path, and `author/nze` is two. Writing the allowance as shapes rather than as a list of examples is what
should stop that recurring; editing an example list is how it happened.

### The guard round 73 earned

If no anchors match at all, the tool exits **2** with *"NO ANCHORS MATCHED ANYWHERE — the extractor is
wrong, not the archive"*, rather than reporting a clean zero. Round 73 reported exactly that zero from a
pattern matching the wrong spelling, and an empty result reads precisely like success.

### And I piped it to `tail` again

    node scripts/check-body-links.mjs | tail -12 ; echo $?   ->  0

The script was exiting **1**, correctly. `$?` after a pipeline is `tail`'s status. **This is the third time
this project has discarded a checker's verdict this way** — round 31 (`|| echo` after a pipe), round 70
(the full sitemap run), and now. Re-read directly:

    node scripts/check-body-links.mjs > /tmp/bl.txt ; echo $?   ->  1

**The rule has been written down twice and broken three times.** It is worth a habit rather than a note:
never read a checker's status after a pipe.

### Not yet in verify-all.sh, deliberately

It currently exits 1 on the three known targets, and adding a check that is red for a known, deferred
issue is how a suite teaches people to ignore it. **It joins the standard run when those three are
resolved or explicitly waived** — and the reason is recorded here so that decision is visible rather than
forgotten.

---

## ROUND 87 — THE WAIVER IS EXPLICIT, AND THE CHECK JOINS THE STANDARD RUN

Round 86 left the tool out of `verify-all.sh` because it was red on three known targets. Round 87 makes
those three an **explicit, visible waiver** and adds the check as step three of nineteen.

    PASS  no test residue
    PASS  every capability is granted
    PASS  links inside article bodies        <- new
    PASS  typecheck
    …                                       All suites passed.

### Why waive rather than repair

The three dead targets share no shape with each other or with the three families that were fixed, so no
rule applies. And **repairing them would mean inventing a destination** — redirecting a reader to a page
the archive does not hold. That is precisely what this project is not allowed to do:

> *Never invent a record, a source, a rights statement, a citation or a statistic.*

**A redirect here would be a fabrication dressed as a fix.** So they are waived, and the waiver is a
statement that a person who knows what the article meant to link to has not yet looked.

### Why the waiver must print on every run

    DISTINCT DEAD : 0

    WAIVED (3) — known, deliberately not repaired, still reported every run:
      /how-a-hunter-obtained-money-from-his-friends-the-leopard-goat-bush-cat-…
      /womens-title-taking-the-iyom-otu-odu-title-in-igbo-culture/
      /uli-samples-from-awka-district-n-w-thomas-1910-11/

A waiver that silences is indistinguishable from a check that passes. These print under their own heading
every time, so the count is never mistaken for zero, and the reason each is waived lives in the tool
beside the list rather than in someone's memory.

### The check itself

    check-links.sh       follows links on pages       -> what a reader can CLICK
    check-sitemap.sh     samples <loc> values         -> what a crawler is TOLD
    check-body-links     links written in PROSE       -> what the RECORDS reference
    check:residue        every table with text        -> what the DATABASE holds
    check:capabilities   names read from the source   -> what the CODE requires

**Five checks, four of which did not exist thirty rounds ago, and every one found a real defect on or
shortly after its first run.** The body-link check found 40 dead targets across 91 articles; the residue
check found test accounts published as researchers; the capability check found a permission granted to
nobody; the sitemap check found a topic page unreachable since the import; the link walk found the site's
own navigation pointing at a 404 on every page.

---

## ROUND 88 — ONE DEAD ASSET, AND THE MECHANISM THAT MAKES IT THE ONLY ONE

Round 71 listed **assets** as covered by nothing, with the reasoning that a broken stylesheet renders the
site unstyled while every suite still passes. Checked across eight pages:

    distinct asset references : 96
    non-200                   : 1
      404  /wp-content/uploads/2020/01/image-1-copyright.jpg

Everything else resolves, including every stylesheet and script.

### The single failure is a residual WordPress path, and it explains itself

**1,027 of 1,057 articles carry raw `wp-content/uploads` paths in `body_html`** — the archive stores the
original markup verbatim, which is correct and deliberate. Those paths resolve at render time because the
renderer rewrites them onto this platform's own media origin. That is round 1's "zero hotlinks" holding,
and it holds for **1,026 of the 1,027**.

This one does not, for a precise reason:

    media rows matching image-1-copyright : 0
    media rows from uploads/2020/01/       : 0

**The file was never in the archive.** There is no record to rewrite the path onto, so the original
markup survives into the page and 404s. The reference lives in the migrated WordPress page whose slug is
`about`.

So this is **not** a migration failure and **not** a rewriting bug. It is a source article linking to an
image that was not there to migrate — the same class as the three waived body links from round 87, and the
same answer applies: **the only honest repair is one a person makes after deciding what the page should
show.** Inventing an image is not available.

### Why the asset check is worth having anyway

Ninety-six references, one dead — and the check took seconds. The failure mode it guards against is the
quiet one: a moved stylesheet leaves every page unstyled, the HTML still returns 200, and **not one of the
other five checks would notice**, because they all ask whether pages and links are reachable, never
whether the page can render.

Not yet folded into `verify-all.sh`: it needs a running server, like the link walk and the sitemap
sample, so it belongs with those rather than with the offline steps.

---

## ROUND 89 — THE ASSET CHECK IS A TOOL, AND IT CONFIRMS THE FINDING INDEPENDENTLY

Round 88's asset check was a throwaway. It is now `scripts/check-assets.sh`, wired as
`npm run check:assets`.

    distinct asset references: 62
    404    /wp-content/uploads/2020/01/image-1-copyright.jpg
    checked: 62
    BROKEN ASSETS: 1 of 62.
    exit code read DIRECTLY: 1

**62 references over 8 pages, one broken** — the same single dead reference round 88 found over 96
references and 10 pages. Two runs, different page counts, same answer: the finding is stable and not an
artefact of one seed list.

### Four link checks now, each answering a different question

    check-links.sh       <a href> followed from pages   ->  what a reader can CLICK
    check-sitemap.sh     <loc> sampled from the sitemap ->  what a crawler is TOLD
    check-body-links     links written in article prose ->  what the RECORDS reference
    check-assets.sh      css, js and images referenced  ->  whether a page can RENDER

The fourth exists because of the other three's blind spot, and it is worth stating plainly: **they all ask
whether a page is reachable, and never whether it can render.** A stylesheet that moved would leave every
page unstyled with every check still green.

### The guard, carried over deliberately

If the extraction matches nothing, the tool exits **2** with *"NO ASSETS MATCHED … the extractor is wrong,
not the site. Not a pass."* That is the round-57 lesson, and round 68's sed failure is why it matters: a
pattern that matches nothing and a page with nothing to match produce the same empty output.

### Exit codes, read the way round 86 established

`… > /tmp/ca.txt ; echo $?` — **output to a file, status read from the command.** Not through a pipe.
Three rounds have now discarded a checker's verdict that way, and the habit is the fix, not the note.

### Not in verify-all.sh, for the same reason as the other two

It needs a running server, and `verify-all.sh` runs against a stopped one because the suites hold the
PGlite lock. **The three server-dependent checks — links, sitemap, assets — belong in their own run**, and
that grouping is now obvious enough to be worth making explicit next time the runner is touched.

---

## ROUND 90 — TWO RUNNERS, BECAUSE THE TWO KINDS OF CHECK CANNOT SHARE ONE

Round 89 noticed the grouping; this round made it real. `scripts/verify-live.sh`, wired as
`npm run verify:live`.

    verify-all.sh    19 steps, STOPPED server
                     typecheck, suites, residue, capabilities, links inside article bodies
    verify-live.sh    3 checks, RUNNING server
                     links a reader can click · pages a crawler is told of · assets a page must load

    PASS  links a reader can click
    PASS  pages a crawler is told of
    PASS  assets a page must load
    All live checks passed.          exit code read DIRECTLY: 0

### Why they cannot be one script

`verify-all.sh` runs against a **stopped** server on purpose: the suites take the PGlite lock, and the
database is single-process, so a dev server holding it makes every suite fail with a mutex timeout rather
than a real error. The live checks are the opposite — they are about what the running site actually
serves.

**It does not start or stop a server, deliberately.** A checker that owns a process and a database lock is
a checker that can corrupt the cluster when it is killed wrongly, which has already happened here once.
It points at a server you started and says so when there is none:

    http://127.0.0.1:3100 is not responding. Start a server first — this runner deliberately does not.
    (and never 'pkill -9 -f node': kill by port, or you take the media download with it)
    exit 2

### The asset waiver, taking round 87's shape

The one dead asset would have made the live run permanently red, which is how a suite teaches people to
ignore it. So it is waived explicitly, in the tool, beside the reasoning — **and it still prints on every
run**:

    checked: 62
    Every referenced asset loaded.

    WAIVED (1) — known, deliberately not repaired, still reported every run:
      /wp-content/uploads/2020/01/image-1-copyright.jpg

Waived rather than repaired because repairing it means inventing an image the archive does not hold. **Two
waivers now exist in this project, both visible, both with their reason in the code.** That is the pattern
for anything known-and-deferred: *a waiver that silences is indistinguishable from a check that passes.*

### What is now checked, in full

    offline    typecheck · 64 unit tests · 7 app tests · archive · members · editorial · publications
               rights · search · spotify · admin · accounts · contributions · donations
               test residue · every capability granted · links inside article bodies

    live       120 pages of followed links · 300 sampled sitemap paths · 62 referenced assets
               (and, when run at scale, all 14,667 sitemap URLs)

    exit codes are read from the commands themselves, never after a pipe

---

## ROUND 91 — NO COMMITTED CREDENTIALS, MADE STANDING — AND A FINDING I DID NOT GO LOOKING FOR

`scripts/check-secrets.sh`, wired as `check:secrets` and now **step one of twenty** in `verify-all.sh`.

    PASS  no committed credentials
    PASS  no test residue
    …                                    All suites passed.

Four checks: no environment file is tracked; no credential-shaped text (`AKIA…`, private keys, `sk-…`)
appears anywhere in tracked files; no secret is assigned a literal; and `.env.example` exists with its
variable list. The `postgres://` lines that look alarming are placeholders (`ozituma:ozituma@localhost`)
and a `${POSTGRES_PASSWORD}` interpolation.

**Mutation-tested rather than assumed.** Staging a fake `.env.zztest`:

    exit with a tracked env file: 1
      TRACKED ENVIRONMENT FILE(S) — these must never be committed:
        .env.zztest

and after removing it, exit 0, with the file confirmed gone from both disk and the index.

### And then `git status` showed 61 entries I did not create

    total entries: 61
      42 ??     19 M

**Every one is in `apps/web/` — the Ozituma application, not the Ozikoro one this session has been
working on.** An entire admin section is untracked: `ads/`, `analytics/`, `appearance/`, `clans/`,
`learn/`, `names/`, `proverbs/`, `record/`, `recordings/`, `settings/`, `submissions/`, `users/`,
`words/`, `layout.tsx`, `ui.tsx`, `admin.css` — plus API routes and nineteen modified core pages
including `apps/web/app/page.tsx` and `apps/web/app/layout.tsx`.

**This is the round-33 finding again, in the other application.** In round 33 the Ozikoro app had **zero
tracked files** and one `git clean` would have destroyed it. That was fixed for `apps/ozikoro`. **Nobody
checked `apps/web`, and it is in exactly that state now.**

It matters directly to the objective — *"keep the three sites connected through one database and one
account table"* — because this is one of the three sites, and it is uncommitted.

### Deliberately not committed

I did not commit it. It is not this session's work, I have not read it, and committing 61 files blind
would put unreviewed code into the history under a message that could not honestly describe it. **The
right next step is to establish whether it builds and what it is, then commit it deliberately** — which is
what round 33 did for the Ozikoro app, after the same discovery, in the same shape.

**Flagging it is the useful act available now. A silent `git add -A` would not be.**

---

## ROUND 92 — THE OZITUMA APPLICATION IS IN VERSION CONTROL, AND THE CHECK THAT FOUND IT HAD A HOLE

Round 91 flagged 61 uncommitted entries in `apps/web` and deliberately did not commit them, because they
were not this session's work and had not been read. This round established what they were and committed
them properly.

### Verified before committing, not assumed

    @ozituma/web typecheck          ->  0 errors
    untracked files                  ->  214 (git grep cannot see any of them)
    .env-shaped files among them     ->  none
    credential shapes among them     ->  none
    secrets assigned literals        ->  none

    files committed: 61      (55 in apps/web)
      apps/web/app/admin/    ads analytics appearance clans learn names proverbs record
                             recordings settings submissions users words + layout, ui, admin.css
      apps/web/app/api/      admin routes, learn-bridge
      apps/web/app/          page.tsx, layout.tsx and seventeen more modified
      AGENTS.md  .env.example  docker/  data/clans/clans.json  package.json

Committed as `9240743`. **This is round 33's finding in the other application** — `apps/ozikoro` once had
zero tracked files and one `git clean` would have destroyed the platform; that was fixed and nobody
checked `apps/web`.

`data/ozikoro-wp/` remains untracked **deliberately**: 190MB of exported WordPress JSON, regenerable, and
committing it would be wrong rather than safe.

### And committing it exposed a hole in the check that found it

`check:secrets` used `git grep`, which reads the **index**. So it could not see a single one of those 214
new files — **and an untracked `.env` is precisely the thing a later `git add -A` turns into a committed
secret.** The check that surfaced this risk was blind to the riskiest case.

Two checks added, taking it from four to six:

    PASS  no untracked environment file
    PASS  no credential-shaped text in untracked files

Mutation-tested both ways:

    untracked .env.zztest present  ->  exit 1, "one 'git add -A' away from being committed"
    removed                        ->  exit 0

### The lesson, which is about where a tool is looking

**A check reads what it is pointed at, and `git grep` is pointed at the index.** Round 73's false negative
came from a pattern matching the wrong spelling; this one came from a tool scanning the wrong *set*. Both
produced a clean result and both were wrong for the same underlying reason: **the answer was never
available to the method being used.**

---

## ROUND 93 — THE SAME ONE-COMMAND-AWAY RISK, IN THE SAME DIRECTORY TREE

Round 92 established that `check:secrets` had been reading the index rather than the working tree, so a
stray `.env` was invisible to it. The natural next question is the one that found this round's defect:

> **What else would that same `git add -A` sweep up?**

`data/ozikoro-wp/` — the WordPress export, **190MB**, and **not gitignored**:

    28.6 MB  data/ozikoro-wp/media.json
    19.2 MB  data/ozikoro-wp/articles.json
    16.2 MB  data/ozikoro-wp/articles.jsonl
     2.1 MB  data/ozikoro-wp/.cache/posts/page-5.json
     …

`.gitignore` covered `data/sources/*`, `data/derived/*` and `data/media/` — every data directory
**except the largest one.** Committing it would be wrong rather than safe: it is regenerable output of the
importer, not source.

### Fixed

    IGNORED BY: .gitignore:72:data/ozikoro-wp/    data/ozikoro-wp

    untracked entries remaining : 0
    total git status entries    : 1      (this .gitignore edit)

**The working tree is now clean.** Before this, `git status` permanently showed the export as untracked —
noise that trained the eye to ignore it, which is exactly how the 61 `apps/web` files in round 91 went
unnoticed for so long.

### The pattern, now three shapes of the same mistake

    round 73   a pattern that matched the wrong SPELLING      -> reported zero dead links
    round 92   a tool reading the wrong SET (index, not tree)  -> missed 214 files
    round 93   a directory not covered by the IGNORE RULES     -> 190MB one command from the history

All three produced a clean-looking state, and all three were the *method* being wrong about where the
answer lived rather than the answer being absent. **Asking "what would this command actually touch?" is
the cheapest question available, and it has now found something three times.**

---

## ROUND 94 — THE INVERSE QUESTION, AND A NEGATIVE RESULT WORTH KEEPING

Rounds 92 and 93 both asked *what is one command away from being lost*. This round asked the inverse:
**what has already been committed that should not have been?**

The repository carries **30.4 MB across 958 tracked files**, and the largest are not application source:

    10.6 MB   work/            112 files
     4.3 MB   proverbs-work/    22 files
     1.1 MB   ekpeye-work/      52 files
     2.6 MB   work/examples.jsonl          2.5 MB  work/audio-restore/plan.json
     1.7 MB   work/verdicts.jsonl          1.5 MB  proverbs-work/thomas-v6/part5-corrected.jsonl

Sixteen megabytes of what looks like scratch — three directories of `.jsonl` verdicts, renderings and
plans, none of them ignored, all of them tracked.

### The honest answer is that they are not scratch

    referenced by: packages/db/src/import/unsettled-renderings.ts

**An importer reads from `work/`.** So this is deliberate input data for a data pipeline — the material an
editorial or derivation step consumes — and not a `git add -A` accident. They are correctly committed and
correctly not ignored.

**Nothing was deleted**, and nothing should be: round 58's lesson was a repair that destroyed a character
in a published address because it looked like noise. Sixteen megabytes of files whose purpose I have not
read in full is exactly the same temptation, and it is not worth the same mistake twice.

### The false positive, recorded because it nearly counted

The reference search also matched `learn/node_modules/@types/node/process.d.ts` — because the path
contains `/work/`. A substring match on a path is not evidence of a reference, and it is the same family
as the thirteen false positives this file already documents. **The real hit is one file, and reading it is
what turned a suspected mess into a documented input.**

### Why a negative result is worth a round

The question "is 16MB of oddly-placed data a mistake?" now has a written answer with a citation in the
codebase. The next person to notice those directories will find the answer instead of repeating the
investigation — or, worse, deleting them and discovering the importer depended on them.

---

## ROUND 94 (CONTINUED) — CORRECTING MY OWN CLAIM, ONE STEP AFTER MAKING IT

The entry above says *"An importer reads from `work/`."* Reading the match rather than trusting the search
shows it is at **line 53 of a doc comment**:

    * the generator's own output under `proverbs-work/`, unattributed to a proverb only in …

**That is a comment describing where a generator WRITES, not code that reads those files at runtime.** My
statement was one step too strong, and I made it in the same round where I recorded a false positive about
substring matching on paths — having matched a substring in a comment and called it a dependency.

### What is actually established

* The trees are **deliberate**: they are named in the pipeline's own documentation.
* They are **not read at runtime** by that file. Whether anything else consumes them is **not established**
  and was not checked beyond one reference search.
* **The conclusion holds** — do not delete them — but for the weaker reason, which is the reason that
  matters: *documented output of the project's own pipeline* is still not scratch, and it is still not mine
  to remove on a guess.

This is the fourteenth correction in this file, and the second in two rounds where **the search result was
treated as the finding.** A grep hit is a place to look, not an answer.

---

## ROUND 95 — I RAISED A FALSE ALARM, AND THE CORRECT ANSWER IS BETTER THAN THE ALARM

Round 91's reasoning promised a guard it did not build: *"an example file that has drifted is how a
deployment fails at two in the morning."* This round built it, and measured it wrongly first.

### The wrong measurement

    variables the code reads          : 60
    variables .env.example documents  :  2
    MISSING: DATABASE_URL, S3_BUCKET, SPOTIFY_CLIENT_SECRET, HEALTH_TOKEN, … 58 in total

**Fifty-eight undocumented variables, including every credential the platform needs.** A number that would
have justified a round of emergency documentation work.

**It was a scope error.** The comparison used the **root** `.env.example` — which belongs to a *different
application*, and holds `OZITUMA_SITE_URL` and `OZITUMA_VERSION`. The Ozikoro app documents its own
variables in `apps/ozikoro/.env.example`, and always has.

### The right measurement

    app reads (excluding framework and vendor) : 36
    app example documents                      : 36

    READ but NOT documented : (none)
    documented but NEVER read : (none)

**A perfect match, both directions, zero drift.** Not a near miss — an exact one. The `NEXT_*` and
`VERCEL_*` variables in my first count are the framework's, not the application's, and are correctly absent.

### The rule this is the third instance of

    round 92   git grep reads the INDEX, not the working tree   -> missed 214 files
    round 93   .gitignore covered every data dir but one        -> 190MB one command from history
    round 95   the example file checked belonged to another APP -> 58 phantom missing variables

**All three were the method being wrong about WHERE the answer lived**, and all three produced a
confident, specific, wrong number. The first two hid a real problem; this one invented one. **The
correction cost one command** — reading which file was actually being compared.

### Now standing

`check:secrets` is seven checks, and `.env.example` drift is one of them:

    PASS  .env.example is in sync with the code (36 variables)

It fails in **both** directions — a variable read but undocumented, *and* one documented but never read,
because an entry nobody reads is how the next person sets a variable that does nothing.

---

## ROUND 97 — MY OWN DOCUMENTATION WAS WRONG BY MORE THAN A THIRD

The resume block claimed **"16 public routes."** Counted for the first time:

    total page routes in apps/ozikoro : 30
      under /admin                    :  7
      reader-facing                   : 23

**Twenty-three, not sixteen** — and the figure had been copied forward through the resume block for many
rounds without ever being checked, which is exactly the failure this file spends its length warning about.

The full set, now written down so it is not re-guessed:

    /  /[slug]  /about  /archive  /folklore  /search  /topics  /topics/[slug]
    /documents  /documents/[slug]  /labels/[slug]  /entities  /entities/[slug]
    /publications  /publications/[slug]  /researchers  /researchers/[slug]
    /attachment/[slug]  /author/[slug]  /claims  /reviews  /signin  /submit

    /admin  /admin/archive  /admin/archive/[id]  /admin/claims
    /admin/reviews  /admin/rights  /admin/spotify

### Why this one matters more than the number

Every other correction in this file was to **a check or a measurement** — a thing I ran and misread. This
was to **the summary itself**: the paragraph a new reader trusts most, and the one least likely to be
re-derived because it reads like background rather than a claim.

**A resume block is documentation, and documentation drifts exactly like code does, with nothing running
to catch it.** The two routes added in rounds 77 and 83 — `/author/[slug]` and `/attachment/[slug]` — were
both built during this session and neither was ever added to the count.

The habit that would have caught it is the one already in this file: **when a claim can be counted, count
it.** It applies to prose as much as to test output.

---

## ROUND 98 — I NEARLY "CORRECTED" A CLAIM THAT WAS RIGHT

Round 97 found the resume block's route count wrong and established the rule: **when a claim can be
counted, count it.** So this round counted the next ones.

    claimed: 20 verification steps
    grep -c '^run "' scripts/verify-all.sh    ->  15
    grep -cE '^\s*(run|run_suite|step)' …     ->  16

Fifteen. Then sixteen. Either would have justified rewriting the claim to match — and **both were wrong,
for a reason visible in the same output I was reading past:**

    16 run invocations, of which three take variables:
      $name      loops over the section headings
      $ROOT      the root check
      $suite     loops over the shared suites

**The script loops.** A static count of its source lines cannot equal the number of steps it performs —
`$suite` alone expands to five suites. Measured where it counts, by running it and counting what it emits:

    bash scripts/verify-all.sh > /tmp/va.txt ; echo $?   ->  0
    PASS lines actually emitted                          ->  20

**The claim was correct.** My count was not.

### The fourth shape of one mistake

    round 73   counted the wrong SPELLING        -> reported zero dead links
    round 92   counted the wrong SET             -> missed 214 files
    round 93   counted the wrong DIRECTORY RULES -> 190MB one command from history
    round 95   counted against the wrong FILE    -> invented 58 missing variables
    round 98   counted the SOURCE, not the BEHAVIOUR -> nearly "fixed" a correct number

Every one is the same underlying error: **measuring something adjacent to the answer and reporting it as
the answer.** Round 97's route count really was wrong, and the lesson from it really does hold — but the
lesson is "count it **where it is observable**", not "count it wherever it is written down."

The general rule, which this file has now earned five times:

> **Measure the behaviour, not the description of the behaviour.**

`check:secrets` at 7 sub-checks and `verify-live.sh` at 3 were counted the same way and are both correct —
7 and 3 respectively, taken from their own output in rounds 95 and 90.

---

## ROUND 99 — THE HEADLINE NUMBERS, MEASURED RATHER THAN REPEATED

Rounds 97 and 98 corrected the resume block's *counts of things I built*. This round checked its
**claims about the archive**, which are the ones a reader is most likely to act on and which had been
copied forward without re-measurement.

    claim: 3,437 of 3,488 media served from our own storage
      select count(*) from ozikoro_media where storage_key is not null and storage_key <> ''
      ->  3437                                              CORRECT

      select count(*) from ozikoro_media where storage_key is null or storage_key = ''
      ->    51                                              matches the claim that 51 are absent at source

    claim: 0 of 1,051 records linked to an entity
      ozikoro_article (is_page = false)                 ->  1051
      count(distinct article_id) from ozikoro_article_entity  ->  0     CORRECT

    claim: 0 of 3,488 items has a licence
      ozikoro_media total                               ->  3488
      where licence is not null and licence <> ''       ->  0      CORRECT

**Every headline number is right.** The archive is 3,488 media and 1,051 articles; the media migration
covered 3,437 of them; and the two largest gaps in this file — no rights recorded, nothing linked to an
entity — are exactly as stated, not rounded or remembered.

### One correction to the file's own instructions

My first query used a column called `stored_path`, **which does not exist**. The media table's column is
**`storage_key`**. Anyone re-running these checks should use the real name; the full column list is here so
the next query does not have to guess:

    id wp_media_id slug kind title alt_text caption description source_url storage_key mime_type
    width height filesize_bytes duration_seconds creator credit licence rights_note captured_at
    uploaded_at contributor_id created_at updated_at

That is worth writing down because the failure was **silent in the direction that matters**: a query
against a wrong column name *errors*, but a query against a *right-sounding* name in a different table
would have returned zero and looked like a finding. `0 licenced` and `0 entity-linked` are real; `0
self-hosted` would have been an artefact.

### The habit, for the third round running

    round 97   counted the routes            -> documentation was wrong (23, not 16)
    round 98   counted the build steps       -> my count was wrong (20 was right)
    round 99   measured the archive figures  -> both were right

**Counting is not the same as verifying**, and this file has now demonstrated both outcomes from the same
instruction. The instruction stands: *when a claim can be counted, count it* — and then check that the
count is of the thing the claim is about.

---

## ROUND 100 — WHAT A NONCE-BASED CSP WOULD ACTUALLY HAVE TO COVER

Item 10 lists nonce-based CSP as outstanding, and unlike most of what remains it is **blocked on nobody**.
Before treating it as a small job, the scale was measured.

The policy today, from `apps/ozikoro/next.config.ts`:

    script-src 'self' 'unsafe-inline'            (+ 'unsafe-eval' in development only)
    style-src  'self' 'unsafe-inline' https://fonts.googleapis.com

`'unsafe-inline'` is there because **Next.js emits its bootstrap and the RSC payload as inline script**.
The file's own comment already says so, and already names the fix: *"a nonce-based policy is stronger and is
the right next step; it needs middleware to mint a nonce per request."*

### Measured, for one page

    homepage:
      <script> tags total       : 52
        with a src= (external)  :  5
        INLINE                  : 47
        of which JSON-LD        :  0
        executable inline       : 47

**Forty-seven inline scripts, every one of them Next's.** A nonce policy has to tag all of them on every
request, which makes this a real piece of work with a real failure mode — get one wrong and the page stops
hydrating, which looks like a broken site rather than a failed policy.

### Why measuring first was the useful part

The comment says *"Next.js emits an inline bootstrap and the RSC payload inline."* That reads like one or two
scripts. **It is forty-seven**, and that number is what determines whether the job is an afternoon or a
week — and whether it should be attempted without a running deployment to verify hydration against.

Counted rather than estimated, and it changes the judgement: **this is the kind of change that should be
made with the site live and a rollback ready**, not in a session that cannot check whether the result
hydrates.

### The honest state of item 10

    done      security headers, HSTS in production, X-Content-Type-Options, Referrer-Policy,
              X-Frame-Options DENY, COOP, Permissions-Policy, health endpoint, backup and
              restore drill, sitemap, robots, headings, alt text, contrast, JSON-LD
    open      nonce-based CSP (measured: 47 inline scripts per page)
    open      notifications
    open      backup scheduling and off-machine storage
    blocked   deployment (needs S3_BUCKET and a server Postgres)

---

## ROUND 101 — THE POLICY WAS ALREADY HARDENED; MY CHECK SAID OTHERWISE

Round 100 measured the nonce problem. This round looked for cheaper CSP hardening that needs no nonce — and
the check said four directives were missing:

    base-uri         ABSENT
    object-src       ABSENT
    frame-ancestors  ABSENT
    form-action      ABSENT

**All four are present.** The read of the actual policy, rather than the grep for it:

    default-src 'self'
    script-src  'self' 'unsafe-inline'        (+ 'unsafe-eval' in development only)
    style-src   'self' 'unsafe-inline' https://fonts.googleapis.com
    font-src    'self' https://fonts.gstatic.com
    img-src     'self' data:
    media-src   'self'
    connect-src 'self'
    frame-ancestors 'none'
    base-uri        'self'
    form-action     'self'
    object-src      'none'

`default-src`, `frame-ancestors`, `base-uri`, `form-action` and `object-src` are all locked down, `img-src`
and `connect-src` are narrow, and the only permissive entries are the two `'unsafe-inline'` values that
round 100 measured the reason for.

### My check was wrong, and in the same way as four rounds before it

The grep looked for `"'$d"` — a quote immediately before the directive name — while the policy writes
`"frame-ancestors 'none'":` the directive **followed** by a quote, not preceded by one. The pattern could
never have matched, so "ABSENT" was guaranteed regardless of the file's contents.

    round 73   pattern matched the wrong spelling       -> reported zero dead links
    round 92   tool read the index, not the tree        -> missed 214 files
    round 93   ignore rules covered every dir but one   -> 190MB one command from history
    round 95   compared against another app's file      -> invented 58 missing variables
    round 98   counted source, not behaviour            -> nearly "fixed" a correct number
    round 101  pattern could never match                -> four directives falsely reported missing

**Six instances, one error: checking something adjacent to the answer and reporting it as the answer.** In
this case the pattern was not even capable of success, which is the most dangerous version — it fails the
same way on every input, and an "all missing" result looks like a finding rather than a bug.

### What this closes

**Item 10's header work is complete and was already good.** The remaining security item is the nonce, at
the measured cost of **47 inline scripts per page**, and nothing else in the policy needs work. The honest
state is one known, reasoned trade-off rather than an unfinished list.

---

## ROUND 102 — A SECURITY CHECK THAT CANNOT MATCH NOW SAYS SO

Round 101 found a grep that could never match and therefore reported four CSP directives missing on every
input. Everywhere else in this project that class is guarded the same way: **if the extractor matches
nothing, the check refuses to pass.** `check-links.sh`, `check-sitemap.sh`, `check-assets.sh` and
`check-body-links` all do it, and each guard was written after failing without one.

**`check:secrets` cannot be guarded that way.** Everywhere else, "nothing matched" means the extractor is
broken; here, "nothing matched" is the **desired result**. So a pattern that can never match produces a
permanent, silent PASS — on a security check, which is the worst place for it.

### The fix: prove the detector works before trusting its silence

    SELF-TEST — the patterns run against a string that MUST match. If it does not, the check reports itself
    broken rather than the repository clean.

    PASS  the credential detector matches a known-positive sample

Mutation-tested by breaking the pattern the way a typo would —

    AKIA[0-9A-Z]{16}   ->   AKIA[0-9A-Z]{99}

    exit with a broken detector: 2
      DETECTOR IS BROKEN — the credential pattern does not match a known-positive sample.
      A check that cannot match reports every repository clean. Not a pass.

    exit after restore: 0

### And writing it triggered the very bug it documents

The first version planted the sample whole — `SAMPLE='AKIA…'` written whole (the literal is not reproduced here — see below) — and the check **immediately
failed on itself**: the detector's own source is a tracked file, so a credential-shaped string inside it
made the scan fire on the script.

**This is rounds 55 and 56 recurring**, where a capability check matched its own doc-comment example and
needed two fixes for the same reason. The sample is now concatenated from parts so no literal match exists
in the file. **Caught by running it, not by reasoning about it** — which is the only reason it was caught
at all.

### And the first mutation test proved nothing

My first attempt to break the pattern died on a Python quoting error, so **the mutation never applied** —
and the check duly exited 0, which I could easily have read as "the self-test is broken when it is not".
The output said `SyntaxError` and I looked at the exit code. **A mutation that does not apply is
indistinguishable from a fix that does not work, unless you read the error.**

    check:secrets is now 8 sub-checks, all passing.

---

## ROUND 103 — THE DATA-INTEGRITY CHECK COULD HAVE REPORTED A CLEAN DATABASE ON EVERY INPUT

Round 102 gave `check:secrets` a self-test, because it belongs to a class of check where **"nothing found"
is the desired result** — so a broken pattern produces a permanent silent pass. This round asked which
other checks share that property, and `check:residue` does. It is the check that guards against test data
being published as real, and it had two ways to pass while examining nothing:

    for (const [table, cols] of byTable) { … } catch {
      // A view or table this role cannot read. Not residue, and not a reason to stop.
    }

1. **`information_schema` returns no text columns** — the loop runs zero times, `found` is empty, and it
   prints *"Every table checked is clean."*
2. **Every query throws** — a permissions problem, a renamed role, a broken connection — and the `catch`
   swallows all of them. **Total failure looked exactly like a clean database.**

### Fixed

The scan now counts what it read and what it skipped, and the runner says so:

    No test residue. 102 table(s) checked, every one clean.

    SCANNED NO TABLES — 0 skipped, 0 read. Not a pass: a scan that reached nothing reports
    a clean database on every input.                       exit 2

Partial scans still run, but a skipped table is **printed rather than buried**.

### Mutation-tested

Discovery made to return nothing (`table_schema = 'public'` -> `'no_such_schema'`):

    exit with nothing discovered :  2      SCANNED NO TABLES — 0 skipped, 0 read. Not a pass.
    exit after restore           :  0      No test residue. 102 table(s) checked, every one clean.

### And the number is now evidence

**"Every table checked is clean"** said nothing about how many tables were checked. **"102 table(s)
checked, every one clean"** is a claim that can be wrong — and earlier rounds measured 102, so a scan that
suddenly reached 40 would now be visible instead of reassuring.

### Still exposed, and named rather than left implicit

**`check:capabilities` has the same shape.** It reads capability names from the source and reports "every
capability is granted"; if the extraction returned no names, it would pass on every input. That is the same
guard, and it is the next one to write.

---

## ROUND 103 (CONTINUED) — THE CHECK I HARDENED BROKE ON MY OWN WRITE-UP, AND THE ORDER HID IT

The residue guard was committed as `9d5fd03`, and the verification printed **`1 suite(s) FAILED`** — which I
nearly read past, because I was looking at the residue line.

The failing check was **`no committed credentials`**, and the cause was round 102's own entry in this file:

    docs/OZIKORO-REMAINING.md:4276
    The first version planted the sample whole — `SAMPLE='AKIA…'` — …

**In round 102 I fixed the check's self-match by making its sample non-literal, and then wrote the literal
sample into the handover — which is a tracked file.** The check fired on its own documentation, exactly as
it had fired on its own source one round earlier.

### Why the previous round did not catch it

In round 102 the order was:

    1. run verify-all.sh      -> green
    2. append the write-up to this file, quoting the sample
    3. git add + commit

**The verification ran before the change.** So it could not have caught it, and the green result was
evidence about a tree that no longer existed by the time the commit was made. The failure surfaced only
when round 103 ran the suite against the committed state.

**A check run before the edit is a check of a different repository.** That is the same shape as round 70's
piped exit code — a result that was true of something other than the thing being judged — and it is the
twelfth time this file has recorded a measurement that was correct about the wrong object.

### Fixed, and the fix is documented in the entry that caused it

The literal is redacted from this file, and the redaction is deliberate rather than cosmetic: **writing the
sample out in full is what makes the check fire on its own documentation.** The script keeps its
concatenated sample; this file now refers to it without reproducing it. Verified: zero occurrences
anywhere, `check:secrets` exit 0, and all 20 steps green.

### The rule, which is cheap and would have prevented it

**Run the verification last, after every artefact is in place and staged** — or re-run it after writing,
because prose is an artefact. Twice now a green suite has described a tree that was about to change.

---

## ROUND 104 — THE LAST CHECK WHOSE SILENCE WAS TRUSTED, AND A BACKUP THAT ERASED MY OWN FIX

Round 103 guarded `check:residue` and named `check:capabilities` as having the same shape. This round
guarded it, and the guard was correct — but getting there produced a better lesson than the guard.

### The exposure

`check:capabilities` reads capability names out of `requireCapability`, `hasCapability` and the transition
table with three regular expressions, then reports *"Every one is held by at least one role."* With no
names extracted, everything downstream is trivially satisfied:

    0 capabilities required by the source.
    Every one is held by at least one role.        exit 0, on every input, forever

**And this is the check written because a capability held by nobody shipped once already, in round 12** —
so its silence is the last silence in this project that should be trusted. Now:

    EXTRACTED NO CAPABILITY NAMES — the source scan found nothing, which cannot be right: this
    codebase requires capabilities in dozens of places. Not a pass: a scan that found no names
    reports every capability granted on every input.            exit 2

Mutation-tested by forcing the scan to return nothing — **exit 2** — and restoring — **exit 0**, with the
guard confirmed still present in the file.

### And my first two attempts to test it proved nothing

**Attempt one** broke a single regex (`requireCapability`). The other two patterns kept matching, so the
scan returned *fewer* names rather than none, and the guard correctly did not fire. **A mutation too weak
to reach the condition tests nothing, and passes.**

**Attempt two** forced the function to return an empty map — the real condition — and still exited 0.
Because at the end of attempt one I had restored from `/tmp/cc.bak`, a backup taken **before** the guard was
added. **My restore erased the fix I was testing.** The guard was gone from the file, so of course it did
not fire; and `grep -c 'EXTRACTED NO CAPABILITY'` returning **0** is what revealed it.

    backup taken BEFORE the change   ->  restoring the "original" deletes the change
    verified by grepping for the fix ->  0 occurrences, which is not what I had just written

### The rule, which is more general than this round

**A backup is a claim about a point in time, and restoring it is a destructive edit.** Take it *after* the
change you intend to keep, and prove the restored state contains what you meant to keep rather than
assuming the copy was the right one.

That is the same error as the rest of this file, wearing different clothes: I restored "the original" and
never asked *original of what?* — a measurement correct about the wrong object, for the thirteenth time.

### Where the checks now stand

    check:secrets       8 sub-checks, self-test proving its detector matches
    check:residue       reports 102 tables checked; refuses to pass having scanned none
    check:capabilities  refuses to pass having extracted no names
    check-links         refuses to pass having fetched no pages
    check-sitemap       refuses to pass having listed no URLs
    check-assets        refuses to pass having matched no assets
    check-body-links    refuses to pass having matched no anchors

**Seven checks, and every one now distinguishes "found nothing wrong" from "did not look."**

---

## ROUND 105 — ALL SEVEN GUARDS, EACH SHOWN TO FIRE

Rounds 102 to 104 gave the checks that report success on finding nothing a guard against *not having
looked*. Round 104 claimed the set was complete. This round **tested the claim instead of restating it**,
and two of the seven had never been shown to fire.

    check-links        against a port with nothing listening
                       -> exit 2   NOTHING WAS CHECKED — the walker did not reach a single page. Not a pass.

    check-assets       against the same port
                       -> exit 2   NO ASSETS MATCHED across 5 pages — the extractor is wrong, not the site.
                                   Not a pass.

    check-body-links   with the extractor made to match nothing
                       -> exit 2   NO ANCHORS MATCHED ANYWHERE — the extractor is wrong, not the archive.
                       restored
                       -> exit 0   DISTINCT DEAD : 0

### The full set, every one verified rather than assumed

    check:secrets        exit 2 when its pattern cannot match a known-positive sample   (round 102)
    check:residue        exit 2 when it scans no tables                                 (round 103)
    check:capabilities   exit 2 when it extracts no capability names                    (round 104)
    check:links          exit 2 when it reaches no pages                                (round 105)
    check:assets         exit 2 when it matches no assets                               (round 105)
    check:sitemap        exit 2 when the sitemap lists nothing / is unreachable         (round 68)
    check-body-links     exit 2 when it matches no anchors                              (round 105)

**Seven checks, seven tested guards.** Each distinguishes *"found nothing wrong"* from *"did not look"*, and
for each one that distinction has been demonstrated by making it look at nothing and watching it refuse.

### Why testing the guards was worth a round of its own

Rounds 102 to 104 established the guards by writing them and reasoning about them. **A guard that does not
fire is indistinguishable from a guard that is not needed** — and this file has recorded thirteen
occasions where a check was confidently wrong precisely because nobody made it fail on purpose.

Two of the seven had never been exercised. Both fired correctly, which is a good outcome and was not a
foregone one: round 104's own guard failed to fire twice before it was fixed, for two different reasons.

**The distinction the whole set exists to preserve:**

    "nothing matched"  is evidence, when the pattern is known to work
    "nothing matched"  is noise,    when it is not

---

## ROUND 106 — LINK TEXT AND UNLABELLED LINKS, AND A BLIND SPOT IN MY OWN CHECK

Item 10 lists accessibility as partly outstanding, with link text among the unaudited parts. Link text is
the cheapest a11y property to check and one of the most commonly wrong: a link reading *"read more"* is
meaningless when a screen reader lists the links on a page out of context.

    anchors with text across 10 pages : 770
    non-descriptive link texts         :   0

**Nothing vague.** No "read more", no "here", no "click this", across the homepage, archive, folklore,
about, documents, topics, a label, an author page, search results and the entities index.

### Then: my check had excluded the case it most needed to see

The script skipped anchors whose text was empty:

    if not text:
        continue

**An anchor with no accessible text is a worse failure than a vague one**, and my check could not see it.
Re-run counting them, and separating the legitimate case — an icon-only link carrying an accessible name:

    anchors total              : 880
    empty text BUT labelled    : 110   (aria-label, title, or an img with alt — fine)
    empty text AND no label    :   0

**Both dimensions are clean.** One hundred and ten icon links, every one with a name a screen reader can
announce, and not one bare anchor.

### The lesson, which is about what a check leaves out

Round 73's check reported zero because its **pattern** matched the wrong spelling. This one reported zero
because its **logic excluded** the failing case — `continue` before the comparison. Both produced a clean
number from a check that could not have produced any other.

> **Read a check's exclusions as carefully as its matches.** A `continue`, a `filter`, an early `return` or
> a skipped branch removes inputs before the assertion sees them, and the result looks identical to having
> tested them.

This is the fourteenth measurement in this file that was confidently wrong, and the third distinct
mechanism: wrong pattern, wrong set, **wrong exclusion**.

### Worth stating plainly for the archive

**These are the properties that could most easily have been wrong and were not.** 880 links across ten
pages, every one with text that makes sense out of context, and every icon link labelled. The design was
copied in and linked rather than rewritten, so this is largely the original authors' markup surviving
intact — which is the outcome that was intended.

---

## ROUND 107 — LANDMARKS AND HEADING STRUCTURE, ACROSS TEN PAGES

The next unaudited accessibility property after link text. Screen-reader users navigate by landmark and by
heading, so a missing or duplicated `<main>`, or two `<h1>`s on one page, makes that navigation unreliable
in a way that never shows up visually.

    page                       main  nav  hdr  ftr  h1  h2+  flags
    /                             1    1    1    1   1    1  ok
    /archive/                     1    2    2    1   1    1  ok
    /folklore/                    1    1    2    1   1    1  ok
    /about/                       1    1    2    1   1    3  ok
    /documents/                   1    2    2    1   1    1  ok
    /topics/                      1    2    2    1   1   22  ok
    /labels/aba/                  1    1    2    1   1    0  ok
    /author/nze/                  1    1    2    1   1    0  ok
    /entities/                    1    1    2    1   1    0  ok
    /search/?q=igbo               1    1    2    1   1    0  ok

    pages with landmark/heading problems: 0 of 10

**Exactly one `<main>` and exactly one `<h1>` on every page**, a `<footer>` on every page, and at least one
`<nav>` and `<header>`. No duplication, no absence.

### The one thing worth noting, and why it is not a defect

Four pages report **`h2+ = 0`** — `/labels/aba/`, `/author/nze/`, `/entities/` and `/search/`. They have an
`<h1>` and then headings stop. Each of those pages is a **list**: a subject's records, an author's records,
the entity index, search results. A list of links does not need subheadings, and adding decorative ones
would give a screen reader more to skip through rather than less.

`/topics/` at **22** headings is the same principle in the other direction: it is a long index of fourteen
subjects with grouped content, and the headings are what make it navigable. **Neither number is a target**;
both are what the content calls for.

### Where the accessibility work stands

    verified   colour contrast (--ink-faint corrected for AA)
               heading order, and exactly one h1 per page
               landmark structure, and exactly one main per page
               alt text on images
               link text: 0 vague, 0 unlabelled
    open       focus order
               form error messaging

Two properties remain untested, and both need a browser rather than a request — focus order is about
sequential keyboard navigation and form errors are about behaviour after interaction. **Neither can be
checked by fetching HTML**, which is why they are still open rather than overlooked.

---

## ROUND 108 — FOCUS VISIBILITY IS EXEMPLARY, AND FOCUS ORDER FOLLOWS FROM IT

Round 107 left **focus order** and **form error messaging** open, on the grounds that both need a browser.
Half of that is true, and this round separated the halves.

### What can be checked without a browser, and is clean

    outline: none / outline: 0 anywhere in the CSS          ->  NONE
    a :focus-visible rule                                  ->  main.css:25, plus ~10 in showcase.css
    positive tabindex (which breaks natural order)         ->  NONE

And the rule itself, in the design CSS:

    :focus-visible {
      outline: 3px solid var(--focus);
      outline-offset: 2px;
      border-radius: var(--r-sm);
    }

    .skip { position: absolute; left: var(--s-4); top: -4rem; … }
    .skip:focus { top: var(--s-4); }

**A three-pixel outline with a two-pixel offset and a colour token**, plus a skip link that is off-screen
until focused. That is a better focus treatment than most sites manage, and it is the design's, preserved
intact because the design was linked rather than rewritten.

### The half that does not need a browser after all

**Focus ORDER is determined by DOM order** when no positive `tabindex` exists — and there is none. So the
question "does the keyboard reach things in a sensible sequence?" reduces to "is the DOM in a sensible
order?", which rounds 106 and 107 already answered:

* every page has exactly one `<main>`, one `<h1>`, and full landmarks
* every link has text that makes sense out of context
* the skip link lets a keyboard user bypass the navigation entirely

**No positive tabindex means nothing overrides the sequence; correct landmarks and headings mean the
sequence is the reading order.** That is a conclusion, not a deferral — and it is only available because
the two checks before it were done.

### What genuinely remains, and it is one thing

**Form error messaging** — whether an invalid submission announces itself, associates the message with the
field, and moves focus to it. That needs interaction and cannot be inferred from markup, so it stays open
and honestly labelled.

### Where accessibility now stands

    verified   contrast · heading order and one h1 · landmarks and one main
               alt text · link text (0 vague, 0 unlabelled)
               focus visibility (3px outline, offset, skip link)
               focus order (no positive tabindex; DOM order is correct)
    open       form error messaging — needs interaction

---

## ROUND 109 — THE ERROR WAS ANNOUNCED BUT NOT ATTACHED TO THE FIELD

Round 108 left **form error messaging** as the one open accessibility item, needing interaction. Applying
the same split: the *interaction* half needs a browser, but the **markup half is static**, and checking it
found something.

    page        aria-invalid  aria-describedby  role="alert"  <label>
    signin           0              0               1           2
    submit           0              0               1          10
    claims           0              0               2           1
    reviews          0              0               1           3

**Every form announced its error and none of them said which field it belonged to.** `role="alert"` makes a
screen reader read *"Not signed in"*; `aria-invalid` and `aria-describedby` are what connect that message
to the input it concerns. Without them a screen-reader user is told something went wrong and left to
search for where.

### Fixed on the sign-in form

The notice gains `id="signin-error"`, and both fields carry attributes **that exist only when there is an
error**, so they describe the field rather than decorating it permanently:

    aria-invalid={params.error ? true : undefined}
    aria-describedby={params.error ? 'signin-error' : undefined}

Verified by rendering:

    WITH an error      aria-invalid 4   aria-describedby 4   id="signin-error" 3   role="alert" 1
    without an error   aria-invalid 2   aria-describedby 2   id="signin-error" 0   role="alert" 0

The residual counts in the second row are **React's serialised payload**, not markup — the same strings
travel in the hydration data. The difference between the rows, two each way, is the real attributes.

### And my verification was wrong first — twice inside one check

The first attempt searched for `"aria-invalid"` **with quotes around the attribute name**. HTML does not
quote attribute names, so the pattern could never match and it reported 0 of 0 on a page that had four.

This is the **fourth pattern that could not match** in this session:

    round 101   a quote on the wrong SIDE of the directive name   -> four CSP directives "missing"
    round 105   a pattern that never had a chance to run          (guarded, still correct)
    round 106   a `continue` that EXCLUDED the failing case       -> "clean" link text
    round 109   a quoted attribute NAME                           -> reported my own fix missing

Four different mechanisms, one outcome: **a confident number from a check that could not have produced any
other.** The rule that catches all four is the one this file keeps arriving at — *make the check fail on
purpose before trusting it to pass* — and here it was caught only because the result contradicted a fix I
had just verified with `grep` in the source.

### Still open, honestly

`submit`, `claims` and `reviews` have the same gap and are **not** fixed. Named rather than implied.

---

## ROUND 110 — THE FIX THAT DOES NOT TRANSFER, AND WHY APPLYING IT WOULD HAVE BEEN WORSE

Round 109 fixed the sign-in form and named `submit`, `claims` and `reviews` as having "the same gap". This
round went to fix them, and found the gap is **not the same one.**

### What the three forms actually are

    {notices.error ? <div className="notice notice--error" role="alert">…</div> : null}
    const notices = await searchParams;

**The error is a free-form string arriving in the query string**, set by a server action's redirect. The
page has no idea which field it concerns — the title, the authors, the disciplines, the file, or the
request as a whole. It renders one notice at the top and announces it.

### Why `aria-invalid` on every field would be wrong

The sign-in fix works because the error there **is** about the credentials just entered, so marking both
credential fields is accurate. Copying it to `submit` would put `aria-invalid="true"` and
`aria-describedby="…"` on **every** field in a ten-field form, because the page cannot tell which one the
server objected to.

**That is not a fix, it is a false statement**: a screen-reader user would be told all ten fields are
invalid when the server rejected one — or none, if the error was about the submission as a whole.

> **A fix that is right in one context and copied into another becomes a fabrication.** The distinction is
> the same one this file draws about records and rights: do not assert what you do not know.

### The honest state of the three

* `role="alert"` already announces the message, and that is correct behaviour for a form-level error.
* The fields correctly carry `<label htmlFor>` — verified this round, including the dynamic ones
  (`ev-${b.id}`, `rec-${review.id}`, `c-${review.id}`, `p-${review.id}`), which are more often wrong.
* **What is genuinely missing is that the page cannot say which field the error concerns** — and it cannot,
  because the server action does not pass that. The remediation is for the action to redirect with a field
  name (e.g. `?error=…&field=title`) and the page to use it. **A larger change than it looked, and not
  attempted.**

### And a correction to round 109's own wording

Round 109 said the three forms have "the same gap". **They have a different gap with the same symptom** —
a message announced without a field attached. Round 109 described the symptom correctly and the cause
wrongly, and the difference is exactly what stopped a wrong fix from being applied here.

**Naming a gap is not the same as understanding it, and the value of naming it was that it got
investigated.**
