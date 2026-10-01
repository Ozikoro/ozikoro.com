# Roadmap

- [x] Build the learner home and course path.
- [x] Connect Practice and Dictionary to ozituma.com.
- [x] Split Practise into its own in-app screen; the menu no longer links out to the site's drill page.
- [x] Build a functional Tutor interface preview with explicit content safeguards.
- [x] Add the Ndebe learning studio from the supplied course plan.
- [x] Replace the basic meaning quiz with an original tactile, three-round listening game.
- [x] Ndebe studio: type, catalogue, teaching forms, numerals, arithmetic, typing help, fonts
- [x] Typing practice (meaning → type Igbo, tone-mark check) and in-page practice with clear exit
- [ ] Connect verified Ozituma curriculum, dictionary, audio, Ndebe font, and input mappings (owner-supplied content required).- [x] Resume where learner stopped in every section (lessons, practise, Ndebe) — saved on device
- [x] Give the lesson ("Continue learning / Greetings") its own format, distinct from Practise
- [x] All lessons in the path playable (7 placeholder lessons, unlock in order, replay, next lesson, culture note)
- [x] HANDOFF.md with gaps, rules and agent prompt
- [ ] Accounts (email + Google), profile & settings, in-app dictionary, staff review area, course tables
- [ ] Keyboard page (Igbo, Ndebe, English) using data from github.com/chrisemezue/edemede.github.io; demo + handoff for PC/mobile keyboards

## Done this round
- [x] Accounts (email + Google), password reset, progress saved to account when signed in
- [x] In-app Dictionary (published words), Profile & Settings, Staff area (review/publish, CSV import, audit log)
- [x] Course path reads published course from the database, demo course until one is published
- [x] Keyboard page (Igbo / English / Ńdẹ́bẹ́ prototype) — layouts in src/lib/keyboard-data.ts, Edémédé word list in public/keyboards (Apache-2.0, unreviewed, off by default)

## For the next agent
- [ ] Installable desktop/mobile keyboards generated from keyboard-data.ts
- [ ] Real Ńdẹ́bẹ́ font + glyph mapping; full course content; recordings; first admin role assignment
- [x] Keyboard: 8 themes (Chalk, Midnight, Akwete, Uli, Forest, Ocean, Sunset, Neon), long-press vowel accents, key pop-ups, number row, height, haptics, suggestion strip
- [x] Teachers marketplace: apply → admin approve → public profiles, book lessons, school hiring requests, reviews after completed lessons
- [ ] Paystack checkout + webhook to set lesson_bookings.paid (needs Paystack secret key) — next agent
- [ ] Video lesson room (e.g. Daily/Jitsi link per booking), teacher payouts via Paystack subaccounts/transfers — next agent
- [x] Media-rich teacher discovery and profile preview with fictional portraits, sample introduction video, availability, lesson counts, and stronger booking actions

## Coherent platform frontend
- [x] Phase 1–2: audit the existing product and begin consolidating reusable design-system patterns without replacing working learning flows
- [ ] Phase 3: redesign the student and teacher dashboards around next actions, real backend state, and responsive layouts (student dashboard foundation complete)
- [ ] Phase 4: refine teacher discovery and profiles; keep sample media explicitly labelled until approved profiles exist
- [ ] Phase 5: build booking and calendar interfaces against DSH-provided availability and payment state
- [ ] Phase 6: build responsive messaging interfaces against DSH-provided conversation contracts
- [ ] Phase 7: build a provider-independent virtual classroom shell with teaching panels and connection states
- [ ] Phase 8: add assignment, lesson-note, and progress interfaces backed by real learning data
- [ ] Phase 9: add teacher earnings and transaction interfaces backed by DSH financial state
- [ ] Phase 10: expand the staff area into a coherent admin interface for supported backend resources
- [ ] Phase 11–12: complete mobile, accessibility, loading, empty, error, success, and unstable-connection polish
