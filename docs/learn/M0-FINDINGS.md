# M0 — Findings on the existing Ozituma stack

**Work order:** M0, Discovery and setup (`Ozituma_Igbo_Learning_Platform_Spec.docx` §19.3)
**Date:** 28 September 2026
**Status:** complete; **blocked on owner answers** before M1 (see §8)
**Method:** direct inspection of the repository at `staging/`, the live database schema, and
the running production site. Every figure below was read from the source, from
`information_schema`, or from `https://ozituma.com` on the date above — none are quoted from
project documentation, because §5.1 shows that documentation has drifted.

---

## 1. What Ozituma already is

The spec was written without access to this codebase (§6.2 requires this discovery pass
precisely because of that). Here is what is actually there.

| | |
|---|---|
| **Monorepo** | npm workspaces: `apps/web` + `packages/core` + `packages/db`. TypeScript throughout, source consumed directly (no build step for packages) |
| **Frontend** | Next.js **15.5.26**, App Router, React 19. Plain CSS with custom-property design tokens — **not** Tailwind |
| **Database** | PostgreSQL. Two drivers behind one interface: `pg` in production, **PGlite** (real Postgres 16 in WASM) for local dev with no install. 40 tables, 73 indexes, generated `tsvector` columns |
| **Migrations** | Plain `.sql` applied in filename order, checksummed, tracked in `schema_migration`. Currently at `0023` |
| **Auth** | Own implementation. `scrypt` (memory-hard, per-password salt, self-describing cost params) + server-side session rows with hashed tokens and expiry/revocation |
| **Roles today** | `contributor`, `editor`, `admin`, `owner` — **4** |
| **Storage** | S3-compatible client. Cloudflare R2 in production, MinIO locally, plus a local-disk driver |
| **Payments** | Paystack, already integrated (redirect flow, webhook + idempotency) |
| **Deploy** | Single EC2 (`t4g.medium`) running Docker Compose: Postgres + app + Caddy. Cloudflare proxied in front, Origin CA cert. No SSH — SSM Session Manager only |
| **CI** | **None.** No workflow file. |
| **Tests** | `node:test` for `packages/core` (41 passing); hand-rolled assertion scripts for db layers; no browser/e2e suite |

### 1.1 Live production figures

Read from the public pages on 28 Sep 2026:

| Measure | Value |
|---|---|
| Headwords | **16,596** (Igbo 12,231 · Yoruba 4,365) |
| Definitions | 39,103 |
| Example sentences | 43,180 |
| Dialects mapped | 48 |
| Languages registered | 25 (2 with corpus) |
| Audio | ~46,400 published recordings, ~49,010 objects in R2 |

**These supersede the numbers in `README.md` and `docs/ARCHITECTURE.md`**, which say 12,467
headwords. The corpus has grown by about 4,100 entries since those documents were written and
they were never updated. Any capacity planning must use the live figures.

---

## 2. Requirement-by-requirement reconciliation

Only the rows that need a decision are listed. "Have" means it exists and is usable as-is.

| Spec requirement | Have | Gap / action |
|---|---|---|
| §7 Next.js App Router + React + TypeScript | **Have** — exact match | — |
| §7 PostgreSQL + full-text + trigram | **Have** — `pg_trgm` in production, `tsvector` generated columns | — |
| §7 Text normalisation `/lib/text` (NFC, diacritic strip, Igbo input) | **Have** — `packages/core/src/orthography.ts` | See §3.2 — do not rebuild |
| §7 S3-compatible storage + CDN for audio | **Have** — R2, already serving ~46k files | — |
| §7 Paystack | **Have** | Stripe absent (v1.1 scope) |
| §7 Supabase Auth (email, magic link, Google) | Partial — own auth has email+password only | Magic link + OAuth are new work. **Supabase not required** — see §4 |
| §7 Tailwind + Radix/shadcn | **Not present** — plain CSS tokens | Decision needed: adopt Tailwind for the new app, or reuse the existing system |
| §7 Vercel/Cloudflare Pages hosting | **Not present** — EC2 + Caddy | Substitution already permitted by §2; see §4 |
| §7 CI/CD (GitHub Actions, Playwright, Vitest, ESLint, Prettier) | **Absent** | New work, M0/M1 |
| §9 UUID PKs, `status`, `version`, soft delete, audit log | Partial — `word` has `status`, `source_id`, normalised columns; no `version`, no `deleted_at`, no `audit_log` | New schema for learner-side tables |
| §9 Row Level Security on every table | **Absent** | RLS is a Supabase-shaped control. On a single trusted app server it adds nothing over server-side authorisation — see §4.3 |
| §5.2 Eight roles | **4 present** | Needs `learner`, `linguist`, `native_reviewer`, `content_editor` (+ later `teacher`, `moderator`) |
| §5.3 Lifecycle `draft → … → published` + trust labels | Partial — `word.status` exists; no `content_versions`, `review_tasks`, trust-label machinery | New work, M8 |
| §6.2 Shared lexicon import of the Name Dictionary | Partial — name tables exist (`person_name` etc.), ~929 entries claimed | Import method to confirm |
| §13 WCAG 2.2 AA, PWA offline, performance budget | **Absent** | New work |
| §13 NDPA/GDPR: export, delete, consent | Partial — no learner-facing export/delete | New work, M1/M8 |
| §14 Monetisation | Paystack present; no plans/subscriptions | Deferred to v1.1 by default (§18 #7) |

---

## 3. Three findings that change the plan

### 3.1 The spec's §7 stack is mostly already satisfied

`§7` recommends Next.js App Router + React + TypeScript + PostgreSQL + S3 storage + Paystack.
**Five of those are already in production here.** The spec explicitly permits equivalents:
*"If the developer finds that the existing Ozituma.com stack makes a recommendation here
impractical, they MAY propose an alternative, provided every requirement in Sections 8, 10 and
13 is still met."*

The genuine divergences are **Supabase** (managed Postgres + auth + storage) and
**Vercel/Cloudflare Pages** (hosting). Neither is load-bearing for any requirement in §8, §10
or §13 — see §4.

### 3.2 The orthography problem the spec worries about is already solved and tested

§1.1 lists as a major risk: *"Dot-below vowels (ị, ọ, ụ), the dotted n (ṅ) and tone marks break
search, sorting, fonts and keyboards if handled naively."*

`packages/core/src/orthography.ts` already handles exactly this, and handles it more carefully
than the spec asks for:

- `tidy()` → NFC canonical form
- `toExactForm()` → tone stripped, **letter marks kept** (`ọ́ria` → `ọria`)
- `toSearchForm()` → fully folded for diacritic-insensitive search (`ulo` finds `ụlọ`)
- `LETTER_MARKS` explicitly distinguishes marks that **change which letter a character is**
  (U+0323 dot-below, U+0307 dot-above for ṅ) from marks that only encode **tone** (U+0301,
  U+0300, U+0304…)
- Case is deliberately **preserved** in the headword, because the corpus distinguishes `Àba`
  (the town) from `àba` (a common noun) — lowercasing would silently merge 30 real entries
- Both derived forms are stored as indexed columns, not computed per query

It carries 147 lines of tests including Igbo characters. **This is not a gap; rebuilding it in
`/lib/text` would be a regression.** The spec's `/lib/text` should be a thin re-export.

### 3.3 The Igbo content that already exists is unverified, and one rule says it cannot ship

This is the most important finding and it is a problem of my own making.

In an earlier session — before this specification arrived — a first cut of the course was built,
including **46 Igbo vocabulary items, 23 phrases, and grammar and cultural claims** in
`data/learn/igbo.json`: tone-marked forms, a `dị` vs `bụ` distinction, a `ndo`-vs-`gbaghara m`
usage note, literal glosses, and statements about Igbo naming practice.

§2.1 is unambiguous:

> MUST NOT invent Igbo vocabulary, grammar rules, translations, proverbs or cultural claims.
> All Igbo content comes from the approved content database or from files supplied by the owner.

Much of what was written is standard, well-attested Igbo (`Ndeewo`, `Daalụ`, `Biko`, `Ọ dị
mma`). **That is not the point.** The rule governs *provenance*, not plausibility, and §1.1 gives
the reason: *"A single wrong example in a curriculum spreads."* Content written by an AI and
never reviewed is exactly what the review workflow exists to catch.

**Proposed handling** (does not require deleting the work):

1. Every row in `data/learn/igbo.json` and the `learn_*` tables is re-stamped
   `generation_method = 'ai'`, `ai_generated = true`, `status = 'draft'`, and carries no
   trust label. Per §5.3 it can never skip review.
2. It is treated as a **draft corpus for building and testing the engine** — which is legitimate
   and useful — and is **not** seeded into production as learner-visible content.
3. Anything that survives must pass the §11.5 gates with a named linguist and a named native
   speaker, and record its source.
4. Where the spec wants a placeholder, these become that placeholder, marked as such.

The alternative — shipping it because it looks right — is the specific failure §2.1 was written
to prevent.

---

## 4. Recommendation

### 4.1 Keep Postgres and the existing data layer; do not adopt Supabase

Supabase bundles Postgres, auth, storage and RLS. Ozituma already has all four, self-hosted and
working, with a 16,596-headword corpus, ~46,000 audio objects and a live payment integration.
Adopting Supabase would mean a second database, a data migration, a second auth system, and a
shared-lexicon sync problem between the two — in exchange for capabilities already present.

**Recommendation: keep the existing Postgres, migrations, storage client and session auth.** Add
magic-link/OAuth as a feature of the existing auth if §18 #8 is answered "shared login".

### 4.2 Serve the platform as its own app in this repo, deployed as its own container

§6.1 recommends the subdomain over the path because of *"separate deployment and scaling;
independent release cycle; clean security boundary"*.

**Note the conflict with what was already built.** The subdomain is wired, but it is served by
the existing dictionary app via host-based routing — which delivers the DNS, cookie and branding
benefits but **not** the separate deployment or independent release cycle the spec cites.

Two readings are defensible, and this is a decision for the owner:

- **(a) Keep one app** (built, working, verified). Cheapest; one build on a host already at its
  memory floor. But a change to the lesson player ships the dictionary too.
- **(b) Split to `apps/learn`** — a new app in the same workspace and repo, sharing
  `packages/core` and `packages/db`, deployed as its own container behind Caddy at
  `learn.ozituma.com`. Matches §6.1 and §19.5, keeps the dictionary's release cycle independent,
  and still avoids duplicating the 16.6k-entry lexicon, the orthography module or the audio
  client. Cost: a second Next.js build on the same host.

**Recommendation: (b).** The spec's stated reasons are real — the dictionary is live and
carries the corpus — and the shared-package structure means most of the duplication concern is
already solved by the monorepo. It should be sized before committing: the `t4g.medium` is
described in `infrastructure/ozituma-stack.yaml` as "the floor that reliably builds the Next.js
bundle", so two apps may need a larger instance or a build on a separate machine.

### 4.3 Skip Row Level Security; keep server-side authorisation, and say why

§9 and §13 require RLS on every table. RLS defends a database that clients reach directly —
which is the Supabase model, where the browser holds an anon key and talks to Postgres. In this
architecture the browser never touches the database: every query goes through a server-side
Next.js route handler or server component holding the only credentials. RLS would add policy
maintenance on 40+ tables while changing no reachable attack surface.

This is a substitution under §2, so it is recorded rather than assumed: **the control that RLS
would provide is provided by authorisation in the data layer**, and the compensating measures
are least-privilege DB credentials, server-only secrets, and an audit log of staff actions
(§9). If a future feature puts a client in direct contact with Postgres, this decision must be
revisited.

### 4.4 CI is the first thing to add

There is no CI. §19.2's definition of done cannot be enforced without it, and §13's testing
requirements assume it. GitHub Actions running typecheck, the existing test suites, the new
domain tests, and a migration dry-run is M0/M1 work and has no dependency on any open question.

---

## 5. Proposed repository layout

Adapted from §19.5 to sit inside the existing monorepo rather than replacing it:

```
apps/learn/                 the new app (if 4.2 chooses option b)
  app/                      routes: public, /app learner area, /admin
  components/               UI + exercise renderers
  lib/
    domain/                 curriculum, lexicon, srs, gamification, review workflow
    ai/                     gateway, prompts, retrieval, validators, eval harness
    exercises/              schemas, scorers, generators
packages/core/              SHARED — orthography (exists), contracts
packages/db/                SHARED — client, migrations, repository
  migrations/               numbered .sql, continuing from 0023
data/learn/                 curriculum source files (unverified drafts, see 3.3)
docs/learn/                 this note, decisions log, style guide, runbooks
```

`/lib/text` from §19.5 is **not** created as a new module — it re-exports
`packages/core/src/orthography.ts` (see §3.2).

---

## 6. Milestones

The spec's M0–M9 are accepted as written, with one addition: **CI lands in M0/M1**, because it
is currently absent and everything downstream depends on it.

Content work must start in parallel from week 1 (§15) and is the long pole: 400–600 lexemes,
30–40 lessons and full audio will not be produced by code. Per §18 #4 the lead linguist and
reviewers are **unassigned**, which blocks all learner-visible content.

---

## 7. What cannot be done without the owner

- Any learner-visible Igbo content (§11.2 requires a linguist; §18 #4 has no default)
- Any hosted service: hosting, AI keys, email, payments (§17.2)
- Any legal instrument: contributor agreements, speaker consent releases, IP position
  (§17.4, §18 #11)

---

## 8. Questions blocking M1

Recorded in `docs/decisions.md`. The spec requires these be asked rather than guessed (§2.1).

1. **Stack and deployment** — §4.1 and §4.2 above: keep Postgres + existing auth (recommended),
   and one app (already built) or a split `apps/learn` (recommended, matches §6.1)?
2. **Tailwind** — §7 specifies it; the existing app uses CSS custom properties. Adopt Tailwind
   for the new app, or extend the existing design system?
3. **Lead linguist and native reviewers** — §18 #4, no default, blocks content and the §11.1
   style guide.
4. **Equity and IP** — §18 #11, "settle in writing before work starts".
5. **Minimum age / child policy** — §18 #5, default is 13+ with parental notice under 18.
6. **AI provider and spend cap** — §18 #10; needed only at M7, but the account must exist
   before the evaluation harness can run.
