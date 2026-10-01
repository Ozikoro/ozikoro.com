# Ozituma Learn Igbo — MVP build plan

## Goal
Build the Igbo-first learning platform described in the supplied specification, using the document’s default owner decisions where choices remain open. The first release will be a polished, mobile-first learning experience with clear separation between verified content and AI-assisted material.

## First build milestone
- Replace the blank page with the signed-in learner home experience so the product is immediately usable.
- Create the Ozituma visual system: warm editorial surfaces, strong green and coral accents, accessible type, compact mobile navigation, and restrained cultural pattern details.
- Add a responsive app shell with Home, Learn, Practise, Tutor, Dictionary, and Profile destinations.
- Build “Today’s journey” with progress, streak, XP, daily-goal status, lesson continuation, review, listening, and practice activities.
- Build an interactive course pathway showing levels, units, lesson progress, locked states, and a sample beginner lesson flow.
- Include a functional sample exercise interaction using content explicitly labelled as placeholder, never presented as verified Igbo teaching material.
- Add trust labels and report controls wherever language content appears.

## Product foundations
- Keep language content separate from presentation so approved curriculum data can replace placeholders without redesigning screens.
- Normalize text as Unicode NFC and prepare diacritic-insensitive matching utilities for Igbo search.
- Use the fixed TanStack application structure and semantic design tokens.
- Add route-specific titles and descriptions for every page created.
- Record project rules in the repository guidance file.

## Later milestones requiring Lovable Cloud or owner-provided content
- Accounts, learner profiles, roles, progress syncing, review queues, and content storage.
- Verified lexicon, native audio, lesson library, six exercise types, spaced repetition, XP and streak calculations.
- AI tutor grounded only in published content, with limits, labels, reporting, and staff drafting workflow.
- Content management, linguist/native-speaker approvals, audit history, CSV import/export, analytics, notifications, offline packs, and payments.

## Validation
- Check desktop and mobile layouts and the central learning flow in the live preview.
- Confirm navigation and exercise interactions work without console errors.
- Confirm accessible landmarks, labels, focus states, reduced-motion behavior, and no overlapping text.
- Confirm the latest preview build succeeds.

## Defaults applied from the specification
- Display name: “Ozituma Learn Igbo”.
- Standard Igbo with documented variants later.
- Beta access is free; payments remain off.
- Adults and teens 13+; no child-specific experience yet.
- Any learner-facing Igbo example remains visibly marked PLACEHOLDER until approved content is supplied.
