# Ozituma Learn — Handoff for the next AI agent

Read this file, `AGENTS.md`, `roadmap.md`, and the two owner documents
(`Ozituma_Igbo_Learning_Platform_Spec.docx`, `Ndebe_Typing_Course_Plan_v2.docx`)
before changing anything. The spec's Section 2.1 (agent rules), 8.1 (AI guardrails)
and 19 (kickoff pack, work orders) are binding.

## Goal
A trustworthy Igbo learning platform at learn.ozituma.com. The design and front-end
flows are built with demonstration data. Your job: connect real, approved content
(words, recordings, lessons, culture notes, Ndebe glyphs) and build the back end,
**without redesigning screens or inventing Igbo**.

## Non-negotiable rules
1. Never write, translate or "correct" Igbo yourself. Every learner-visible Igbo string
   comes from owner-approved data. Anything not yet approved stays visibly labelled
   PLACEHOLDER.
2. Screens are data-driven. Replace data files / connect a database; do not rewrite
   components to fit content.
3. Normalise all Igbo text to Unicode NFC (`src/lib/igbo-text.ts`). Diacritic-insensitive
   matching is only a search aid / "almost correct" hint, never full credit.
4. Tutor replies stay labelled samples until approved curriculum + audio + guardrails
   (spec 8.1) are connected. Every AI answer carries a trust label.
5. Ndebe keeps bracketed prototype notation until the licensed font and verified
   key-to-glyph mapping are supplied. Do not guess glyphs.
6. Lessons (guided path, advance progress) and Practise (free, repeatable, never
   advance the path) stay separate. The Practise menu never links to ozituma.com/practice.
   Dictionary may link to ozituma.com.
7. Framework is fixed: TanStack Start + React + Tailwind v4. No other router.

## What exists (front end, demo data)
| Area | Files | Data to replace |
|---|---|---|
| App shell, home, journey, learning path | `src/routes/index.tsx` | `src/lib/learning-data.ts` (learner, journey) |
| Lessons: word cards → story chat → matching pairs → culture note | `src/components/lesson-flow.tsx` | `src/lib/lesson-data.ts` (units, lessons, cards, story, cultureNote) |
| Practise hub + session (tiles, typing with ị ọ ụ ṅ + tone keys) | `practice-view.tsx`, `practice-game.tsx` | `src/lib/practice-data.ts` |
| Tutor (chat UI, labelled samples) | `tutor-view.tsx` | wire to server function + guardrails |
| Ndebe studio (Type, Learn, Catalogue, Teaching, Numerals, Arithmetic, Help, Fonts) | `ndebe-studio.tsx` | `src/lib/ndebe-data.ts` (full 6,709 catalogue, glyph map, font) |
| Resume where you stopped | `src/lib/use-sticky-state.ts` (device storage) | move to per-user DB sync once accounts exist |

## What is NOT done yet (from the spec)
- F1 Accounts, onboarding, age question, placement test, data export/delete
- F2 Real curriculum: Level 0 (sounds/alphabet) + Level 1, 6–8 units, 30–40 lessons,
  400–600 words; pronunciation view; grammar/usage note per lesson; offline sync
- F3 In-app dictionary with word pages (currently links to ozituma.com)
- F4 Native audio playback (0.75x/1x/1.25x), speaker metadata/consent — Listen buttons are placeholders
- F5 Remaining exercise types: sentence builder, fill the gap (engine should render from JSON)
- F6 Spaced repetition (SM-2), Review with Again/Hard/Good/Easy, adaptive daily plan
- F7 Server-authoritative XP, levels, streak with weekly freeze, badges, time zones
- F8 Real text tutor with trust labels, daily limits, Report button
- F10 Admin/linguist CMS with review workflow, audit log, CSV import/export
- F11 AI-assisted exercise drafting (admin only, never auto-published)
- F12 Analytics and error reporting; F13 settings (theme, text size, audio speed, reduced motion)
- Profile page (currently "taking shape")
- PWA offline unit packs; payments plumbing switched off (Paystack/Stripe, v1.1)
- Ndebe: real glyphs, full catalogue, licensed font, typed-text keyboard mapping

## Order of work
1. Enable the database + auth; create tables from spec Section 9 / Appendix A
   (lexemes, audio, lessons, exercises, culture notes, progress, SRS state, reports),
   with roles in a separate table and row-level security.
2. Import the owner's approved data (see below) with a dry-run validator.
3. Point `lesson-data`, `practice-data`, `learning-data` at the database via route loaders.
4. Audio player + storage; attach recordings to words and sentences.
5. Accounts/onboarding, then SRS review, then gamification, then CMS, then Tutor.
6. Ndebe glyphs once the font and mapping are supplied.

## Data the owner will provide (put in `/content-import/`, never commit secrets)
- Dictionary export (headword, tone-marked form, part of speech, meanings, examples)
- Audio recordings (file naming: `<lexeme_id>_<speaker>.mp3`) + speaker consent sheet
- Lesson plans, culture notes (with sources), approved exercise lists
- Ndebe font files (licensed), key-to-glyph mapping, full 6,709 character list

---

## Prompt to paste to your AI agent

```
You are continuing the Ozituma Learn project (learn.ozituma.com). Before writing any code,
read HANDOFF.md, AGENTS.md, roadmap.md, and the attached Ozituma_Igbo_Learning_Platform_Spec.docx
and Ndebe_Typing_Course_Plan_v2.docx. Treat the spec's Sections 2.1, 8.1 and 19 as binding.

The design and all screens are finished and use demonstration data. Do NOT redesign screens,
change the visual style, or replace the framework (TanStack Start, React, Tailwind v4).
Your job is to connect real approved content and build the back end, following
"Order of work" in HANDOFF.md.

Hard rules:
- Never invent, translate or correct Igbo. Only use the approved data I supply in
  /content-import/. Anything missing stays visibly labelled PLACEHOLDER.
- Keep screens data-driven: replace data sources, not components.
- Normalise Igbo to Unicode NFC; diacritic-insensitive matching is a hint only.
- Lessons advance the path; Practise is free and never advances it.
- Tutor answers carry trust labels and stay samples until guardrails and approved content exist.
- Ndebe keeps prototype notation until I supply the licensed font and glyph mapping.
- Never ask me for production secrets in chat; use the platform's secret settings.

Start by listing, in your own words, what is built, what is missing (from HANDOFF.md
"What is NOT done yet"), and your plan for the first work order. Wait for my approval,
then build one work order at a time, and update roadmap.md after each.
```

## Keyboard
Page: Keyboard tab. Layout data: src/lib/keyboard-data.ts (single source for future Windows/Mac/Android/iOS keyboards). Igbo shortcuts and public/keyboards/ig-vocab.txt come from Edémédé (Apache-2.0, credit Chris C. & Handel C. Emezue; README asks not to reproduce code, so it was reimplemented — confirm permission before shipping the word list). Suggestions are labelled "not reviewed by Ozituma".

## Staff access
Make the first admin by inserting a row into user_roles (role 'admin') for your account; admins then grant 'linguist'/'editor'.
