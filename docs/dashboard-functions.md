# What the dashboards actually do

The owner asked: *"make sure every single function on the dashboard is working, every single role's dashboard
should be working."* This is the honest answer to that question, measured rather than assumed.

**The short version: every dashboard screen renders, and most of what their sidebars promise does not
exist.** Before this work the fourteen dashboard screens carried **156 links written as `href="#"`** — a
placeholder that looks like a link and goes nowhere. **Every one of them has now either been pointed at a
real page or turned into a non-link that says, in the page itself, that the feature is not built.**

Nothing in this document describes a feature that does not exist. Where a feature does not exist, the
destination column says `NOT BUILT` and the last section lists what would have to be written.

## How the links were changed, and why it is not an edit to the design

`apps/ozikoro/public/design/` is the handed-over deliverable and **is never edited**. The dashboards are
served by `apps/ozikoro/app/design-screen/[screen]/route.ts`, which reads the design file as a template and
rewrites it at request time — the same mechanism that already fills the screens with real archive content
and removes the role switch.

The new step is `fillDashboardLinks` in `packages/ozikoro/src/design-fill.ts`, and it does four things:

| the design has | what the served page has |
|---|---|
| `<a href="#">Publications</a>` where a page exists | `<a href="/publications/">Publications</a>` |
| `<a href="#">Saved histories</a>` where nothing exists | `<a aria-disabled="true" title="Not built yet — waiting on …">Saved histories <span>— Not built yet</span></a>` |
| `<a class="sx-state" href="#">…<p>Open workspace</p></a>` where nothing exists | `<div class="sx-state" aria-disabled="true">…<p>Not built yet — nothing to open.</p></div>` |
| `<a href="dashboard-account.html">` | `<a href="/account/">` |

An anchor with no `href` **is not a link**: it cannot be clicked, it cannot be focused, and a screen reader
announces it as text. The design's own classes are kept, so the sidebar still looks like the design's
sidebar, and the design's stylesheet is not touched. The marker is the important part — *a label with no
destination looks identical to one that was forgotten.*

There is **no stub route for any unbuilt feature.** A stub page per promise would be fourteen screens of
invented addresses, each of which a reader would reasonably read as "this exists but is empty". The
statement sits beside the label that made the promise instead.

### A second fault found on the way, and fixed in the same place

The dashboards are served at `/dashboard-reader/` **with a trailing slash**, and the design writes its own
links relatively (`home.html`, `dashboard-account.html`). A browser therefore resolved the sidebar's
"Account settings" to `/dashboard-reader/dashboard-account.html`, which is a 404. Measured: **27 links to
`home.html` and 27 to `dashboard-account.html` across the fourteen screens were dead at the address the site
actually serves.** They are now absolute, and the screens carry a `<base href="/">` so any relative link the
design gains later resolves against the site root rather than against the dashboard.

---

## Surfaces that exist

This is the list of what the owner already has. Every one of these was fetched with a signed-in session
before it was linked to, and the "health" column is what the page actually rendered — not its status code.

| Surface | What it is | Health |
|---|---|---|
| `/admin/` | The administration landing page: one card per thing an administrator can do today, and one sentence naming the areas that are not built. | **Healthy.** Renders "Administration" with working cards and a "Coming to this area" note. |
| `/admin/archive/` | **The editorial queue** — the 1,051 migrated records, worst-documented first, with the counts of what still has no source, no period and no clan. | **Healthy.** 26 rows on the first page (25 per page plus the header), real counts, four filter groups. |
| `/admin/audio/` | The AI-narration review queue: proposals with their cost, rendered takes awaiting a listen, corrections. Only an approved render puts a player on an article. | **Healthy.** "Proposals awaiting a decision (0)" and "Rendered — awaiting a listen (0)" are honest empty states; the page also lists everything the archive holds. |
| `/admin/claims/` | The authorship-claim queue — a person asking to be recognised as an author of a record. | **Healthy, and genuinely empty.** "No claim is waiting. Nobody has asked to be recognised as an author." That is a true statement about the data, not a fault. |
| `/admin/reviews/` | The **publication workflow** queue: every work that is not a draft, not published and not archived, oldest first. | **Healthy, and genuinely empty.** Its queue reads `ozikoro_publication`, not `ozikoro_article`, so "0 waiting" here does **not** contradict the 1,051 archive records — see the note below. |
| `/admin/rights/` | **The media rights register** — 3,488 items nobody has checked, ordered by how many published articles use each one, with the permissions form. | **Healthy.** 34 rows on the first page, real totals, filter set, and a record-detail panel. |
| `/admin/spotify/` | The Spotify connection: whether the account Ozikoro publishes from is still authorised, and the callback address. | **Healthy.** Renders the connection state, the permitted scopes, the history and an explicit "What this is not yet". |
| `/account/` | The member's own record: address, display name, role, and the capabilities the role resolves to. | **Healthy.** Five rows of the real account. Gated: it redirects a signed-out visitor to `/signin`. |
| `/` | The public home screen. | **Healthy.** |
| `/publications/` | The research repository: what has been published and made public, each with its review status. | **Healthy.** |
| `/projects/` | The programmes the archive has embarked on. | **Healthy.** |
| `/towns/` | The register of the 188 published towns, clans, sections and confederations. | **Healthy.** |
| `/archive/` | The archive index: every published history, by ethnic group, topic and period. | **Healthy.** |
| `/photographs/` | The 3,437 photographs the archive holds, with rights state on each record. | **Healthy.** |
| `/documents/` | The four real PDFs the archive holds (eight other `document` rows are saved web pages and are excluded on purpose). | **Healthy.** |
| `/folklore/` | The 17 records filed under Folklores. | **Healthy.** |
| `/listen/` | The listening library. **The archive holds no audio**, so nothing here is presented as a recording. | **Healthy, and says so.** |
| `/watch/` | The 24 published articles that embed a film. | **Healthy.** |
| `/search/` | A search route exists and answers. | **Exists, but it is not the site-wide search the dashboards' "Search" button promises** — it is not linked from the dashboards. |
| `/signin/`, `/join/` | The two ways in. | **Healthy.** |

### The one finding that looked like a fault and is not

> **CORRECTED IN ROUND 292 — READ THE APPENDIX FIRST.** Two claims in this section were wrong, and both were
> measurements taken from the wrong place. `/admin/reviews` **was** a queue that failed to read its data: it
> read `ozikoro_publication` and never read `ozikoro_article`, so the archive's own review status could not
> appear on it at all. And the `Fetching the record` heading was a fault, not correct behaviour: the
> placeholder `<h1>` arrived **before** the page's real heading, so anything reading the first heading of
> `/admin/claims` or `/admin/rights` got the fallback. Both are fixed; the appendix records the measurements.

`/admin/reviews` shows **"Waiting (0)"** while `/admin/archive` reports **1,051 records** and the archive
holds records in a `review` status. That is not a queue failing to read its data. The two pages read
different tables:

* `/admin/reviews` reads `ozikoro_publication` through `listReviewQueue` — **works being published**, and
  nothing is currently in that workflow;
* `/admin/archive` reads `ozikoro_article` — **the migrated archive records**, and that is where the queue
  is.

Both empty states say so in words ("No work is waiting. Everything submitted has been dealt with."), and
neither page shows a spinner or a "Fetching…" that never resolves. **The `Fetching the record` heading on
`/admin/claims` and `/admin/rights` is a `loading.tsx` Suspense fallback that is replaced by streamed
content** — it is present in the raw HTML of every streamed page and is correct Next.js behaviour, not a
page stuck loading.

---

## The map

`href` counts are per design screen, before and after the serve-time transform. **After is zero on every
screen**, which is asserted by `packages/ozikoro/src/design-fill.test.ts` against the real design files.

### `/dashboard-reader/` — Reader

| Where | Label | Destination |
|---|---|---|
| sidebar | Saved histories | `NOT BUILT` |
| sidebar | Followed topics | `NOT BUILT` |
| sidebar | Reading history | `NOT BUILT` |
| sidebar | Collections | `/archive/` |
| sidebar | Account settings | `/account/` |
| sidebar | Return to public site | `/` |
| top bar | Search | `NOT BUILT` |
| top bar | Profile | `/account/` |
| title | Open next task | `NOT BUILT` |
| panel | View all | `NOT BUILT` |
| tile 01–03 | Saved histories · Followed topics · Reading history | `NOT BUILT` |
| tile 04 | Collections | `/archive/` |

Before **11** → after **0**.

### `/dashboard-student/` — Student

| Where | Label | Destination |
|---|---|---|
| sidebar | Projects | `/projects/` |
| sidebar | Publications | `/publications/` |
| sidebar | Supervisor & institution | `NOT BUILT` |
| sidebar | Notes | `NOT BUILT` |
| sidebar | Submissions | `NOT BUILT` |
| sidebar | Learning | `NOT BUILT` |
| sidebar | Account settings / Return to public site | `/account/` · `/` |
| top bar | Search | `NOT BUILT` |
| top bar | Profile | `/account/` |
| title | Open next task | `NOT BUILT` |
| panel | View all | `NOT BUILT` |
| tiles | Projects · Publications | `/projects/` · `/publications/` |
| tiles | Supervisor & institution · Notes · Submissions · Learning | `NOT BUILT` |

Before **15** → after **0**.

> **`Projects` and `Publications` link to the public pages, and that is a judgement worth stating.** Those
> pages list what the archive has published — they are not "my projects" and "my publications". A student
> following one sees real work by other people and no private workspace, which is true; a private list
> would have to be built. The alternative was to mark them `NOT BUILT`, which would have hidden two
> genuinely relevant pages behind a refusal.

### `/dashboard-teacher/` — Teacher

| Where | Label | Destination |
|---|---|---|
| sidebar | Resources | `NOT BUILT` |
| sidebar | Courses | `NOT BUILT` |
| sidebar | Classes & projects | `NOT BUILT` |
| sidebar | Sources | `/admin/rights/` |
| sidebar | Publications | `/publications/` |
| sidebar | Account settings / Return to public site | `/account/` · `/` |
| top bar | Search · Profile · Open next task · View all | `NOT BUILT` · `/account/` · `NOT BUILT` · `NOT BUILT` |
| tiles | Resources · Courses · Classes & projects | `NOT BUILT` |
| tiles | Sources · Publications | `/admin/rights/` · `/publications/` |

Before **13** → after **0**.

### `/dashboard-researcher/` — Researcher

| Where | Label | Destination |
|---|---|---|
| sidebar | Publications | `/publications/` |
| sidebar | Projects | `/projects/` |
| sidebar | Datasets · Fieldwork · Questions · Groups · Collaborators · Citations | `NOT BUILT` |
| sidebar | Account settings / Return to public site | `/account/` · `/` |
| top bar | Search · Profile · View all | `NOT BUILT` · `/account/` · `NOT BUILT` |
| tiles | Publications · Projects | `/publications/` · `/projects/` |
| tiles | Datasets · Fieldwork · Questions · Groups · Collaborators · Citations | `NOT BUILT` |

Before **18** → after **0**.

### `/dashboard-independent-researcher/` — Independent researcher

| Where | Label | Destination |
|---|---|---|
| sidebar | Publications · Projects | `/publications/` · `/projects/` |
| sidebar | Fieldwork · Verification · Collaborations | `NOT BUILT` |
| sidebar | Sources | `/admin/rights/` |
| sidebar | Account settings / Return to public site | `/account/` · `/` |
| top bar | Search · Profile · View all | `NOT BUILT` · `/account/` · `NOT BUILT` |
| tiles | Publications · Projects · Sources | `/publications/` · `/projects/` · `/admin/rights/` |
| tiles | Fieldwork · Verification · Collaborations | `NOT BUILT` |

Before **14** → after **0**.

### `/dashboard-knowledge-holder/` — Community knowledge holder

| Where | Label | Destination |
|---|---|---|
| sidebar | Community profile | `NOT BUILT` |
| sidebar | Oral traditions | `/folklore/` |
| sidebar | Media | `/photographs/` |
| sidebar | Submissions · Review status | `NOT BUILT` |
| sidebar | Account settings / Return to public site | `/account/` · `/` |
| top bar | Search · Profile · View all | `NOT BUILT` · `/account/` · `NOT BUILT` |
| tiles | Community profile · Submissions · Review status | `NOT BUILT` |
| tiles | Oral traditions · Media | `/folklore/` · `/photographs/` |

Before **12** → after **0**.

### `/dashboard-editor/` — Editor

| Where | Label | Destination |
|---|---|---|
| sidebar | Content queue | `/admin/archive/` |
| sidebar | Entity linking · Verification · Revisions · Tasks | `NOT BUILT` |
| sidebar | Account settings / Return to public site | `/account/` · `/` |
| top bar | Search · Profile · View all | `NOT BUILT` · `/account/` · `NOT BUILT` |
| tiles | Content queue | `/admin/archive/` |
| tiles | Entity linking · Verification · Revisions · Tasks | `NOT BUILT` |

Before **12** → after **0**.

### `/dashboard-reviewer/` — Expert reviewer

| Where | Label | Destination |
|---|---|---|
| sidebar | Assigned manuscripts · Decisions · Reviewer profile | `NOT BUILT` |
| sidebar | Evidence review | `/admin/reviews/` |
| sidebar | Account settings / Return to public site | `/account/` · `/` |
| top bar | Search · Profile · Open next task · View all | `NOT BUILT` · `/account/` · `NOT BUILT` · `NOT BUILT` |
| tiles | Evidence review | `/admin/reviews/` |
| tiles | Assigned manuscripts · Decisions · Reviewer profile | `NOT BUILT` |

Before **11** → after **0**.

### `/dashboard-admin/` — Administrator

| Where | Label | Destination | Why that page |
|---|---|---|---|
| sidebar | System overview | `/admin/` | The administration index. |
| sidebar | Users | `/account/` | **The nearest real thing, and it is the viewer's own record.** There is no user-management screen; see below. |
| sidebar | Content | `/admin/archive/` | The editorial queue is the content queue: 1,051 records, worst-documented first. |
| sidebar | Research | `/publications/` | The public research repository. There is no research-management screen. |
| sidebar | Entities | `/towns/` | `/entities/` exists only as `/entities/<slug>`; **there is no entity index above it.** `/towns/` is the register of the 188 published entities. |
| sidebar | Media | `/admin/rights/` | The rights register is the only surface that lists media items. The public `/photographs/` is what every *other* role's `Media` links to. |
| sidebar | Sources | `/admin/rights/` | Rights, permissions and provenance are decided in the same register. |
| sidebar | Moderation | `/admin/claims/` | The claims queue — a person and a decision about them. **Neither `/admin/claims` nor `/admin/reviews` is a corrections desk**, and this is the nearer of the two. |
| sidebar | Analytics | `/admin/archive/` | The queue opens on the counts of what has no source, no period and no clan: the only archive metrics that exist. |
| sidebar | Settings | `NOT BUILT` | The archive stores no configurable platform settings. |
| sidebar | Audit logs | `NOT BUILT` | There is no audit table. |
| sidebar | Account settings / Return to public site | `/account/` · `/` | |
| top bar | Search · Profile · Open next task · View all | `NOT BUILT` · `/account/` · `NOT BUILT` · `NOT BUILT` | No site-wide search route is linked. |
| tiles 01–09 | System overview … Analytics | the same eight destinations as the sidebar | |
| tiles 10–11 | Settings · Audit logs | `NOT BUILT` | |

Before **25** → after **0**.

> **`Users` is the weakest link in this table and it is not hidden.** It goes to `/account/`, which is your
> own account, not a list of users. Nothing else exists that lists accounts. If it is misleading, the fix is
> to build the users screen — not to change the link, because every alternative is worse.

### `/dashboard-account/` — Account & profile

| Where | Label | Destination |
|---|---|---|
| title | Primary action | `NOT BUILT` |
| card 01 | Identity → Open | `/account/` |
| card 02 | Privacy → Open | `/account/` |
| card 03 | Languages → Open | `/account/` |
| card 04 | Security → Open | `/account/#security` |

Before **5** → after **0**.

> The four cards do not have four sub-pages. `/account/` is a **real, gated page** that already renders
> those four sections and says, under each, that it is not editable yet. Sending the reader there is
> honest; inventing `/account/identity` would not be. `Security` links to the section itself.

### `/dashboard-states/` — "Every state has a next step"

This screen is a design reference for states, not a workspace. It is served exactly as the design has it,
with only its links made honest.

| Where | Label | Destination |
|---|---|---|
| state: Error | Try again | `NOT BUILT` |
| state: Permission | Request access | `NOT BUILT` |
| state: Success | View version | `NOT BUILT` |

Before **3** → after **0**.

### `/dashboard-workflow/` — Publishing workflow

| Where | Label | Destination |
|---|---|---|
| title | Primary action | `NOT BUILT` |
| state 01–06 | Draft · Submitted · Review · Revision · Approved · Published → Open | `NOT BUILT` |

Before **7** → after **0**.

> The six states are the publication state machine, which **does exist** — `PUBLICATION_TRANSITIONS` in
> `@ozikoro/platform` drives `/admin/reviews/`. What does not exist is a record to open from this screen,
> because the screen is the design's state reference and carries no records. Linking all six to
> `/admin/reviews/` would have been a link that appears to work and shows an empty queue.

### `/dashboard-moderation/` and `/dashboard-review/`

These two are served exactly as the design has them (**they are not in the route's `FILLED` set**, so they
show the walkthrough's own wording), and their links are made honest by the same transform. They are not
among the twelve screens the owner listed, and they are reported here because leaving them out would have
left two dashboards with dead links.

| Screen | Label | Destination |
|---|---|---|
| `/dashboard-moderation/` | Primary action | `NOT BUILT` |
| | Rights concern · Community correction · Sensitive media · Prior decision | `NOT BUILT` |
| `/dashboard-review/` | Primary action | `NOT BUILT` |
| | Claim · Attached evidence · Alternative interpretation · Decision | `NOT BUILT` |

Before **5** → after **0** each.

---

## What would have to be BUILT

Grouped by dashboard, in the words of the table or route that does not exist. **None of this exists today.**

### Every dashboard

| Feature | What is missing |
|---|---|
| **Site-wide search** | The "Search" button on every workspace. `/search/` exists but is not a site-wide search over histories, towns, documents and people, and linking a button labelled "Search" to it would promise more than it does. A route that queries every index and one page that shows the result groups. |
| **A task queue** | The "Open next task" button and the "Priority work" panel's "View all". A `task` table with an assignee, a due date and a link back to its subject, plus a route to list one account's tasks. |
| **Follow / save / history** | The reader's four metrics and four tiles. A `saved_item` table, a `topic_follow` table and a `read_event` table, each keyed by account, plus routes to list them. `fillDashboard` can already render real counts the moment those tables exist. |

### Reader

| Feature | What is missing |
|---|---|
| Saved histories | A table of saved articles per account, and a route to list it. |
| Followed topics | A follow table joining account to topic, and a route to list it. |
| Reading history | A read-event table per account, and a route to list it. |

### Student

| Feature | What is missing |
|---|---|
| Projects (own) | A project record owned by an account, and a route to list that account's own work. The public `/projects/` lists finished programmes. |
| Supervisor & institution | Fields on the member record, and a route to edit them. |
| Notes | A private notes table per account, and a route to read and write it. |
| Submissions | A submission queue joining an account to what it sent, and a route to list it. |
| Learning | A course catalogue for this site. `learn.ozituma.com` is a **separate application** with its own accounts database; nothing here serves it. |

### Teacher

| Feature | What is missing |
|---|---|
| Resources | A teaching-resources library, and a route to browse it. |
| Courses | A course record owned by a teacher, and a route to list it. |
| Classes & projects | A class group joining a teacher to students, and a route to open one. |

### Researcher

| Feature | What is missing |
|---|---|
| Datasets | A dataset record with its own rights, and a route to list them. |
| Fieldwork | A field-notes record with a place and a date, and a route to list them. |
| Questions | A research-question record and a route to list them. |
| Groups | A working-group record with members, and a route to open one. |
| Collaborators | A collaboration table joining two accounts, and a route to invite one. |
| Citations | A citation-count or export surface, and a route to serve it. |

### Independent researcher

| Feature | What is missing |
|---|---|
| Fieldwork · Verification · Collaborations | The same three records as the researcher's, above. |

### Community knowledge holder

| Feature | What is missing |
|---|---|
| Community profile | A public profile page for a knowledge holder, and a route to edit it. |
| Submissions · Review status | A submission queue, and a view of where this account's own submissions stand. |

### Editor

| Feature | What is missing |
|---|---|
| Entity linking | An entity-resolution tool over the archive's place and person names — `/entities/<slug>` exists, the tool that maintains it does not. |
| Verification | A verification queue over the claims a record makes, and a route to decide them. |
| Revisions | A revision-history table per record, and a route to compare two of them. |
| Tasks | A task table assigned to an account, and a route to list it. |

### Reviewer

| Feature | What is missing |
|---|---|
| Assigned manuscripts | An assignment table joining a reviewer to a work, and a route to list it. |
| Decisions | A reviewer-decision record, and a route to read it back. |
| Reviewer profile | Reviewer-specific fields on the member record, and a route to edit them. |

### Administrator

| Feature | What is missing |
|---|---|
| Users | **A user-management screen.** `/account/` shows a member their own record; nothing lists accounts, changes a role, or suspends one. This is the most conspicuous gap in the back office. |
| Sources (management) | The rights register records permissions, but there is no surface for the `ozikoro_source` records themselves. |
| Settings | The archive stores no configurable platform settings, so there is nothing to render. |
| Audit logs | An append-only audit table written by every privileged action, and a route to read it. |
| Media (management) | `/admin/rights/` covers rights. There is no separate media library — no upload, replacement, alt-text or deletion surface. |

### Account & profile

| Feature | What is missing |
|---|---|
| Editable identity | Display name and biography are read-only; the page says so. |
| Privacy settings | Profile visibility and contact preferences are not stored. |
| Languages | Reading, writing and translation languages are not stored. |
| Security | No change-password, no session list, no "sign out everywhere". The page says so rather than offering a control that does nothing. |

---

## How this was verified

Every command below was run from `/Users/nzeora/Documents/Ozikoro/staging`, against a production build served
on `http://127.0.0.1:3110` with a signed-in owner session (`POST /api/auth/signin`, then `-b /tmp/oz.jar`).
**PGlite is single-process, so no database CLI was run while the server held the cluster.**

### 1. `npm run typecheck` → exit 0

Seven workspaces typechecked (`core`, `db`, `platform`, `learn`, `site`, `web`) and the command exited **0**.

### 2. Design parity — the deliverable is unchanged

```
$ python3 -c "…sha256 comparison of design/calm-comfort-construct/public/design against apps/ozikoro/public/design…"
identical 63 differing 0 missing 0
```

`git status` reports **no modification** under either `design/` or `apps/ozikoro/public/design/`.

### 3. All fourteen dashboards — HTTP 200, filled, and zero remaining `href="#"`

| Screen | HTTP | `example-flag` absent | `href="#"` before → after | `<title>` |
|---|---|---|---|---|
| dashboard-reader | 200 | yes | 11 → **0** | Reader workspace — Ozikoro |
| dashboard-student | 200 | yes | 15 → **0** | Student workspace — Ozikoro |
| dashboard-teacher | 200 | yes | 13 → **0** | Teacher workspace — Ozikoro |
| dashboard-researcher | 200 | yes | 18 → **0** | Research workspace — Ozikoro |
| dashboard-independent-researcher | 200 | yes | 14 → **0** | Independent research workspace — Ozikoro |
| dashboard-knowledge-holder | 200 | yes | 12 → **0** | Community archive workspace — Ozikoro |
| dashboard-editor | 200 | yes | 12 → **0** | Editorial desk — Ozikoro |
| dashboard-reviewer | 200 | yes | 11 → **0** | Review workspace — Ozikoro |
| dashboard-admin | 200 | yes | 25 → **0** | Administration workspace — Ozikoro |
| dashboard-account | 200 | yes | 5 → **0** | Account & profile — Ozikoro |
| dashboard-states | 200 | yes | 3 → **0** | Workspace states — Ozikoro |
| dashboard-workflow | 200 | yes | 7 → **0** | Publishing workflow — Ozikoro |
| dashboard-moderation | 200 | yes | 5 → **0** | Moderation states — Ozikoro |
| dashboard-review | 200 | yes | 5 → **0** | Evidence review — Ozikoro |
| **total** | **14 × 200** | | **156 → 0** | |

The twelve screens the owner named plus the two the route also serves. A filled screen is confirmed by the
greeting carrying the account's own name (`Welcome back, Idenze Ezeme`) and by the metrics reading real
zeros rather than the design's `Saved histories 12`.

### 4. Every link resolves — 17 distinct destinations, none non-200

Every `href` on every dashboard was extracted from the **served** pages and fetched:

```
/  200 · /account/  200 · /admin/  200 · /admin/archive/  200 · /admin/claims/  200
/admin/reviews/  200 · /admin/rights/  200 · /archive/  200 · /dashboard-admin/  200
/dashboard-reader/  200 · /dashboard-states/  200 · /dashboard-workflow/  200
/folklore/  200 · /photographs/  200 · /projects/  200 · /publications/  200 · /towns/  200

17 distinct clickable links, 0 not resolving to a 200/30x
```

### 5. The back-office surfaces, signed in

```
200  /admin/          | h1: Administration         | h2: Audio review · Spotify · Coming to this area
200  /admin/archive/  | h1: Editorial queue        | 26 rows
200  /admin/audio/    | h1: Audio review           | Proposals awaiting a decision (0) · Rendered (0)
200  /admin/claims/   | h1: Authorship claims      | Waiting (0) · Recently decided
200  /admin/reviews/  | h1: Review queue           | Waiting (0) · How a work moves
200  /admin/rights/   | h1: Media rights           | 34 rows
200  /admin/spotify/  | h1: Spotify                | Connection · Callback address · History
200  /account/        | h1: Account & profile      | Your record · What you can change · Leaving
```

### 6. Unit tests

`npm -w @ozikoro/platform test` → **76 tests, 76 pass, 0 fail**, of which six are the new
`design-fill.test.ts` cases that read the fourteen real design screens and assert the counts above.

---

## Two things this pass found that were not asked for

Both are faults, both are fixed, and both are recorded because the next reader should not have to find them
again.

**1. The dashboards' own addresses 404'd from the trailing-slash form.** The design writes its internal
links relatively, and `/dashboard-reader/` resolves `home.html` to `/dashboard-reader/home.html`. **54 links
across the fourteen screens were dead at the address the site serves** (27 to `home.html`, 27 to
`dashboard-account.html`). Fixed at serve time, and the screens now carry `<base href="/">`.

**2. Every dashboard announced itself by its filename.** With no entry in `SCREEN_SEO`, the title fell back
to `dashboard reader — Ozikoro`, and the breadcrumb to `dashboard reader`. **The design's own filename was
being shown to readers as the name of a page.** `DASHBOARD_SEO` gives all fourteen the role's name, and the
breadcrumb now uses `DASHBOARD_ROLE`.

---

## A limitation of this report, stated rather than hidden

The verification above was run on a cluster restored from the backup at
`.data/backups/pg-2026-10-01T17-07-50`, because **the local PGlite cluster was found corrupted during this
work** (`RuntimeError: Aborted()` on every query). The restore is verified against its own manifest and the
**archive content is complete and real** — 1,051 published histories, 3,488 media items, 11 contributors,
228 clans, 995 clan–town links.

**What the restore cannot contain is anything written after 2026-10-01T17:07:53Z**, and the manifest says so
plainly: `account: 0`, `ozikoro_member: 0`, `ozikoro_publication: 0`, `ozikoro_entity: 0`. The owner's
account was therefore rebuilt for this verification (`scripts/create-account.ts` plus migration `0044`, which
adds the `owner` role) and **the account and its sessions are not something this report can promise**. The
archive records are; the accounts are not.

The corrupted cluster is preserved, not deleted, at `.data/pg-corrupt-20261003-204126`. It is the fifth
damaged cluster directory in this checkout — `pg.corrupt-20261001T0522`, `pg.damaged-20261003T165654`,
`pg.damaged-20261003T180058` and `pg.locked-20261001` predate it. **The recurrence is the finding.**

---

# Round 292 — the backlog, the six screens nobody called a dashboard, and three lists that were missing

This round answered three questions in order: **why three admin screens said "Fetching the record" and showed
nothing**, **the thirty-six `href="#"` left on six non-dashboard screens**, and **which lists the archive is
still missing**. It also found two faults nobody had asked about, both recorded below.

**Every number in this section was read from the database or from the running site.** Nothing here is
reasoned from the design or from an earlier report.

## 0. What the cluster actually holds — and the 526 that is not in it

Measured directly against `.data/pg` with the server stopped (`PGlite` is single-process, so no query was run
while it held the cluster):

| Table | Rows | What it means |
|---|---|---|
| `ozikoro_article` | **1,057** | 1,051 records (`is_page = false`) + 6 pages |
| — by status | **published 1,051 · review 0 · draft 0 · archived 0** | nothing is waiting for a decision |
| `ozikoro_publication` | 0 | no research work has been submitted |
| `ozikoro_claim` | 0 | no record makes a recorded claim |
| `ozikoro_contributor_claim` | 0 | nobody has claimed a byline |
| `ozikoro_correction` | 0 | no correction has been proposed |
| `ozikoro_media` | 3,488 | 3,462 image · 13 video · 12 document · 1 other; 3,437 hold the file |
| `ozikoro_media_rights` | **0** | **not one item has a rights basis recorded** |
| `ozikoro_source` / `ozikoro_article_source` | 0 / 0 | the archive rests on no recorded source |
| `ozikoro_audit` | 28 | `approve_claim` 14 · `grant_role` 14, all with no actor |
| `account` / `ozikoro_contributor` | 1 / 11 | one account; eleven bylines, none linked to it |

### The 526 records awaiting review are not in this cluster

The brief for this round stated that **526 articles sit in `status = 'review'`.** They do not. The count is
**0**, and it is 0 in both backups as well: `.data/backups/pg-2026-10-01T17-07-50/MANIFEST.json` and
`…/pg-2026-10-03T19-55-14/MANIFEST.json` each record `ozikoro_article: 1057`, which is the whole table — 526
more rows would make it 1,583.

Where the figure comes from is written down in this checkout: `docs/OZIKORO-REMAINING.md`, round 281, records
`published 1,053 -> 1,051` and **`in review 524 -> 526`**. That was true of the cluster that round measured.
The cluster in use now was restored from the 2026-10-01T17:07:53Z backup, whose own manifest lists 1,057
articles and 0 publications, and **the review-status rows were written after that backup was taken.**

**What this means for the owner, stated plainly: the backlog list can now be shown, but it is empty because
the work is not in this database — it is not empty because the page cannot read it.** Both facts are on the
screen: the page says which table it reads and prints the full status breakdown beside the zero, so the next
person can tell the two apart without opening a client.

## 1. The three screens that were not reading their data

### `/admin/reviews` read the wrong table

It read `ozikoro_publication` through `listReviewQueue` and nothing else. That table is empty, so the screen
said *"Waiting (0)"* — a number that was true of one table and false of the archive. It now reads **both**,
in two named panels:

* **Records waiting for review (N)** — `ozikoro_article where status = 'review'`, oldest first, with the
  contributor, the moment it entered review (read from `ozikoro_audit`'s `after->>'status'`), and a link to
  the record's own page. 25 to a page, with the count and the page number stated.
* **Research works in the publication workflow (N)** — the old `ozikoro_publication` queue, unchanged,
  because it is a different subject with a different state machine.

**The decision buttons stay on the record page.** `/admin/archive/<id>` is where a status is changed, posting
to `/api/admin/archive`, which writes the audit row. This screen links there rather than growing a second
write path.

### `/admin/claims` showed one of the two things called a claim

`ozikoro_contributor_claim` (a person claiming a byline) was the only table it read. `ozikoro_claim` (a
statement a record makes) existed and was surfaced nowhere. Both are now on the screen, each panel naming the
table it reads, so a zero is legible.

### The `Fetching the record` heading was a real fault

`apps/ozikoro/app/_components/page-loading.tsx` rendered **`<h1>Fetching the record</h1>`** as its Suspense
fallback. Next streams that fallback before the page's own content, so **the placeholder heading arrived
first** and anything taking the first heading of `/admin/claims`, `/admin/rights`, `/admin/spotify` or
`/admin/reviews` got the fallback instead of the page's name. Measured on the running site before the fix:
`/admin/claims` and `/admin/rights` both served `h1 "Fetching the record"` while their real content was
further down the same response.

The heading is gone and the fallback is now a `role="status"` region. **A loading state is not the page and
must not claim to be one** — there is no sentence that is true of `/admin/reviews`, `/search` and `/signin`
alike.

After the fix, every admin page's first heading is its own: `Administration`, `Editorial queue`,
`Review queue`, `Claims`, `Spotify`, `Media rights`, `Audio review`, `Users and contributors`,
`Media register`, `Audit trail`.

### `/admin/spotify` was already honest, and its row count of 0 was a measurement artefact

`spotifyConnectionView` returns `state: "not_configured"`, `label: "Not configured"`, and the reason:
`Set SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_TOKEN_KEY in the server environment`. The page renders
that, the requested scopes, the callback address and an explicit "What this is not yet".

**It has no `<table>`** — the connection facts are a `<dl>` — so a row counter that counts `<tr>` reports 0
on a page that is showing seven facts. Recorded here because "0 rows" was read as "broken" once already.

## 2. The thirty-six dead links on six screens

`href="#"` counts, read from the design files and then from the served pages:

| Screen | Before | Wired | Marked `Not built yet` | After |
|---|---|---|---|---|
| `/publication/` | 14 | 0 | 14 | **0** |
| `/researcher-profile/` | 11 | 2 | 9 | **0** |
| `/academy/` | 5 | 5 | 0 | **0** |
| `/archive-index/` | 3 | 1 | 2 | **0** |
| `/upload/` | 2 | 0 | 2 | **0** |
| `/watch/` | 1 | 0 | 1 | **0** |
| **total** | **36** | **8** | **28** | **0** |

The same transform (`fillDashboardLinks`) does the work; its screen list now lives in `LINKED_SCREENS` so the
route and `design-fill.test.ts` cannot disagree, and the test reads all twenty real design files.

### The eight links that were wired, each fetched before it was written down

| Screen | Label | Destination | Status |
|---|---|---|---|
| `/researcher-profile/` | Researchers (breadcrumb) | `/researchers/` | 200 |
| `/researcher-profile/` | Complete your profile | `/account/` | 200 signed in · 307 to sign-in anonymous |
| `/academy/` | the five course titles | `https://learn.ozituma.com/` | 200 |
| `/archive-index/` | All 62 clans → | `/clans/` | 200 |

The academy's five are wired to `learn.ozituma.com` **because the screen says so in its own words** —
"Delivered at learn.ozituma.com · enrolment opens there". This is not the dashboards' `Learning` item, which
promises a catalogue inside this site and remains `NOT BUILT`.

### The twenty-eight that became non-links

Every one belongs to the design's **example record**: a sample publication's author, its PDF, its five
citation formats, an example researcher's five topic chips, `Follow`, `Request contact`, `Cite this profile`,
`All 7 publications`, `Replace`, `Save as draft`, the archive index's `Previous`/`Next`, and the inline
player's `Open on YouTube ↗`. **A control that acts on a record which does not exist has no honest
destination** — pointing one at a real index would promise that record's file or citation and deliver
somebody else's page. Each carries a `title` saying what would have to exist instead, and every label is
asserted against the reason table by the test.

### Three further faults found by doing this, and fixed

1. **The `<base href="/">` was never served.** `fillDashboardLinks` inserts it; `withSeoHead` then replaced
   the whole `<head>` and deleted it. Measured: `/dashboard-reader/`, `/dashboard-admin/` and `/archive/` all
   served `base=0`. The base is now carried across, and a test asserts it.
2. **Thirteen links to `about.html#terms` (and six other fragments) stayed relative**, because the rewrite
   pattern required the closing quote immediately after `.html`. On `/archive-index/` they resolved to
   `/archive-index/about.html#entrust` and 404'd. The fragment or query is now carried onto the absolute
   address. **Six of the eight fragments the design links to on `about.html` are not defined in the design
   file either** (`privacy`, `entrust`, `access`, `contact`, `licensing`, `partners`); those links now reach
   the right page and land at the top of it, and the design file is not edited to invent anchors.
3. **`Showing 1–4 of 24` was left above twenty-four real records** on `/archive-index/`. It now reads
   "Showing the 24 most recent of 1,051 records · paging is not built yet", which is true and agrees with the
   `Previous`/`Next` controls beneath it.

## 3. The lists that were missing

### Built

| List | Where | What it shows, and what it says when empty |
|---|---|---|
| **Records waiting for review** | `/admin/reviews` | The `review` status over `ozikoro_article`, with the full status breakdown when it is zero. |
| **Claims made by records** | `/admin/claims` | `ozikoro_claim` — the claim, its anchor, its record and its status. Empty state names the table and the write path that would fill it. |
| **The media register** | `/admin/media` | All 3,488 items by kind, with size, dimensions, credit and **whether any rights basis exists**. 25 to a page with filters for kind and rights state. |
| **The audit trail** | `/admin/audit` | `ozikoro_audit` read back: what changed, which record, which account, and the JSON `before`/`after` the writer recorded. Entries with no actor are shown and counted, not hidden. |
| **The administration index** | `/admin/` | A card per queue carrying its live count, so the landing page answers "does anything need me?" without eight clicks. |

The media register is **not** a second rights queue. `/admin/rights` is the work list (what nobody has
checked, ordered by published exposure, with the permission form); `/admin/media` is the register (what the
archive holds, and on what basis). Each answers a question the other cannot.

### Decided against, with the reason

| Candidate | Decision | Why |
|---|---|---|
| **Sources** | **Not built** | `ozikoro_source` and `ozikoro_article_source` both hold **0 rows**, so any sources screen would be an empty list. The two questions it would answer are already asked elsewhere: *"which records rest on no source?"* is on `/admin/archive`, and *"on what basis may this be used?"* is the rights register. **A third screen over an empty table would add a surface, not a fact.** |
| **Contributors** | **Not built again** | Already the second tab of `/admin/users`: eleven bylines, how many records each wrote, and which have no account. Rebuilding it would be the second mechanism this round removed elsewhere. |
| **Accounts** | **Not built again** | Already `/admin/users`, gated on `manage_users`. |
| **Unattributed images / orphan media** | **Not built** | `/admin/media` filters by rights state and shows "used by N placements"; an orphan list is the same query with a zero filter, and the register already shows the zero. |
| **A corrections desk** | **Not built** | `ozikoro_correction` holds 0 rows and there is no route that writes it. The dashboards' `Moderation` item already says in the page that neither `/admin/claims` nor `/admin/reviews` is a corrections desk. |
| **A task queue** | **Not built** | No task table exists; it is one of the dashboards' `NOT BUILT` promises and building it is a project, not a list. |

## 4. A data leak found by the required verification, and closed

The brief's verification asks that an anonymous request to any admin page be **307 to sign-in with no rows in
the body**. The first two clauses held; **the third did not.**

```
before                              status  body      rows in the body
GET /admin/archive   (no session)   307     32,703 B  the editorial queue's real rows
GET /admin/rights    (no session)   307     40,463 B  media references and titles
GET /admin/media     (no session)   307     50,048 B  media references and titles
GET /admin/          (no session)   307     22,122 B  the archive's counts
GET /admin/spotify   (no session)   307     19,349 B  the callback address and scopes
```

**A redirect status is not a guarantee that the body is empty, and a script or a crawler reads the body.**
The cause is structural: React renders a layout and its children **concurrently**, so the admin pages ran
their queries and produced their markup before `app/admin/layout.tsx` threw its redirect — and the streamed
response carried them. Pages that happened to guard themselves (`/admin/users`, `/admin/audit`) leaked
nothing, which is what identified the mechanism.

The users page had already written the rule down: *"a page that relied on the layout would hand the whole
account list to anyone who could open the editorial queue, so this page asks for its own capability."*
**Every admin page now asks its own question as its first statement**, before any query:

| Page | Capability | Same as |
|---|---|---|
| `/admin/`, `/admin/archive`, `/admin/archive/<id>`, `/admin/reviews` | `edit_entity` | `/api/admin/archive` |
| `/admin/rights`, `/admin/media` | `manage_media_rights` | `/api/admin/rights` |
| `/admin/claims` | `manage_contributors` | `/api/claims` |
| `/admin/spotify` | administrator or owner | `/api/spotify/*` |
| `/admin/audio` | `review_audio` | already present |
| `/admin/users`, `/admin/users/<id>`, `/admin/audit` | `manage_users` | already present |
| `/admin/` (the door itself) | `mayEnterBackOffice` | the layout's own rule, now in `lib/access.ts` |

After the fix, every anonymous admin request is **307 with a ~10 KB redirect body and zero content markers**.

## 5. How this round was verified

Server: a production standalone build on `http://127.0.0.1:3110`, rebuilt with `bash scripts/serve-review.sh`
(stop by SIGTERM → build → copy → start; **no build was run while a server was live and no database CLI ran
while the cluster was held**). Signed in as the owner via `POST /api/auth/signin`.

```
$ npm run typecheck                       → exit 0
$ npm -w @ozikoro/platform test           → 81 tests, 81 pass, 0 fail
$ python3 …design parity…                 → identical 63 differing 0 missing 0
$ bash scripts/check-auth-boundary.sh     → checked: 13 · every gated route refuses, names itself as the
                                            return path, and every public page serves
$ bash scripts/check-not-found.sh         → PASS a missing address returns 404
$ node scripts/check-design-parity.mjs    → 17 of 18 routes match their design screen; /archive does not,
                                            and that is another agent's uncommitted rewrite of
                                            apps/ozikoro/app/archive/page.tsx (+306/−117) — not this round
```

Signed in, every screen under `/admin/` — status, first heading, and the data it actually shows
(`glanceRows` counts the `<dt>` rows of the label/value lists, which is how `/admin/spotify` can show seven
facts and no `<tr>`):

```
200  /admin/            h1 Administration          h2 Records waiting for review · Editorial queue · Media and rights · Claims · Audio review · Spotify · Users and contributors · Audit trail · Coming to this area
200  /admin/archive/    h1 Editorial queue         26 table rows
200  /admin/reviews/    h1 Review queue            h2 Records waiting for review (0) · Research works in the publication workflow (0) · How a record moves
200  /admin/claims/     h1 Claims                  h2 Authorship claims waiting (0) · Authorship claims decided · Claims made by records (0)
200  /admin/spotify/    h1 Spotify                 11 glance rows, state "Not configured"
200  /admin/rights/     h1 Media rights            34 table rows
200  /admin/audio/      h1 Audio review            h2 …(0) · Rendered — awaiting a listen (0) · Everything the archive holds
200  /admin/users/      h1 Users and contributors 2 table rows
200  /admin/media/      h1 Media register          26 table rows
200  /admin/audit/      h1 Audit trail             26 table rows
```

Anonymous, every screen including the two dynamic detail pages: **307 → `/signin?error=…&next=<the page
asked for>`, 0 content markers**, ~10 KB of redirect body.

`href="#"` on the six named screens, read from the served pages: **0 on all six**, and 0 on the fourteen
dashboards. `<base href="/">` present on all of them, and **zero remaining relative `*.html` links**.

### What still does not work, stated rather than hidden

* **No review backlog can be shown from this cluster** — the 526 `review` rows are not in it, and are in
  neither backup. See §0.
* **Six anchors the design links to on `about.html` are not defined in the design file**, so those links
  reach the right page and land at the top of it rather than at a section. The design is not edited to invent
  anchors.
* **The archive index has no paging.** `Previous`/`Next` are marked `Not built yet` and the count line says
  "paging is not built yet"; the route serves one page of 24 records.
* **`/api/admin/rights` and the other form endpoints were not exercised by a write** in this round, so what is
  verified is that the screens render real data and that they are gated — not that a save completes.
* **Another agent's `/admin/entities` page and its build were live in the same tree during this round.** It
  carries its own guard and was measured as 307/0 markers anonymously, but its contents are not this round's
  work.
* **`/archive` fails `check-design-parity.mjs`** — 8 of the design's sections and 1 of its headings. That
  page is `apps/ozikoro/app/archive/page.tsx`, which another agent had rewritten and uncommitted in the same
  working tree (+306/−117) while this round ran; the design screen it is compared against, `/archive-index/`,
  is the one this round touched and it serves its 24 real records with the new count line. **A live check
  cannot tell two agents' changes apart, so the failure is recorded rather than attributed.**
* **The server on 3110 was killed three times during verification** because a concurrent `next build` replaces
  `apps/ozikoro/.next` under a running server — one of the documented causes of this project's earlier
  cluster corruptions. The final verification was run against a **private copy** of the standalone build
  (`/tmp/oz-standalone`) pointed at the same `.data/pg`, with the whole sequence — stop by SIGTERM, build,
  copy, start, measure — run in one pass so no build could overlap a live server. **No database CLI was ever
  run while the cluster was held, and no process was ever SIGKILLed.**


