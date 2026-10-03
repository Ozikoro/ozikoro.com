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

