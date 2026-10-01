# Prompt for the AI agent (paste everything below)

You are taking over the Ozituma Igbo learning app. The full source is in the GitHub repository I've given you access to. It replaces everything currently at learn.ozituma.com.

## 1. Copy / deploy
1. Clone the repo. Stack: TanStack Start (React 19, Vite 7, Tailwind v4, file routes in src/routes). Don't switch frameworks.
2. Read AGENTS.md, HANDOFF.md, roadmap.md and drizzle/migrations/*.sql before changing anything. They are the rules.
3. Create a Supabase project (or reuse ours) and run every file in drizzle/migrations in order. Set VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Turn on email/password and Google auth, and add learn.ozituma.com to the auth redirect URLs.
4. Deploy to learn.ozituma.com (Cloudflare Workers or any host that supports TanStack Start SSR). Back up the old site first, then replace it.
5. Give my account the admin role: insert into user_roles (user_id, role) values ('<my uuid>', 'admin').

## 2. Rules you must not break
- Every learner-visible Igbo word comes from approved content (lexemes / course_lessons with status = 'published'). Label demo text PLACEHOLDER. Never invent Igbo.
- Screens stay data-driven. Import content through the Staff area (CSV/JSON) or the DB. Don't hard-code it into components.
- Normalise all Igbo text to Unicode NFC. Diacritic-insensitive matching is only a search aid.
- Free Practise never advances the course path. Only lessons do.
- Keep the AI Tutor labelled as a sample until approved curriculum and audio are connected.
- Ńdẹ́bẹ́ keeps its prototype notation ([CH] etc.) until the licensed font and verified key-to-glyph map are supplied (see src/lib/ndebe-data.ts, src/lib/keyboard-data.ts).
- Keep the existing visual design and themes. Extend them, don't restyle.

## 3. Add my data
- Put our files in /content-import/: dictionary, course units and lessons, audio recordings, images, Ndebe font and mapping.
- Dictionary → lexemes table. Course → course_units + course_lessons (cards/story JSON shapes are in src/lib/lesson-data.ts). Audio → Supabase Storage, with URLs on each card. Import everything as draft, and have linguists publish it in the Staff tab.
- Once one unit is published, the app switches from the demo course automatically (src/lib/use-course.ts).

## 4. Finish these
1. **Paystack payments for teacher lessons.** Secret key goes in env PAYSTACK_SECRET_KEY, server only. Add a server function that initialises a transaction for a confirmed lesson_bookings row, with the amount from teacher_profiles.hourly_rate_kobo × minutes/60. Add a webhook at src/routes/api/public/paystack.ts that verifies the x-paystack-signature HMAC-SHA512, then sets paid=true, payment_reference and price_kobo using the service role (a DB trigger blocks clients from changing those). Wire up the disabled "Pay with Paystack" button in src/components/teachers-view.tsx.
2. **Teacher payouts.** Use Paystack subaccounts (split payments) or transfers. Take a platform commission (ask me for the %). Add an earnings view for teachers.
3. **Video lessons.** Generate a meeting link per confirmed booking (Jitsi, Daily or Google Meet). Send email reminders.
4. **Teacher availability calendar and time zones.** Admin tools to suspend teachers and moderate reviews.
5. **Real audio** for lessons, practice and dictionary, plus audio-speed support from Settings.
6. **Onboarding and placement test**, SRS review, sentence builder, fill-the-gap. Server-side XP, streaks and badges (replace the demo values in src/lib/learning-data.ts).
7. **Real AI Tutor** grounded only in published content, with trust labels.
8. **Installable keyboards** generated from src/lib/keyboard-data.ts (themes are in src/styles.css .kb-*): Android IME, iOS keyboard extension, Windows (.klc/Keyman), macOS (.keylayout). Get permission from the Edémédé authors before shipping their word list (public/keyboards/).
9. Offline/PWA, and the remaining items in roadmap.md and HANDOFF.md.

Work in small commits. After each feature, test it signed in as a real user and update roadmap.md.

## Lessons platform surface (/platform) — handoff
The UI is built; wire these. Contracts: src/lib/contracts.ts. Preview data: src/lib/platform-preview.ts (delete once real data flows).
- Availability + bookable Slots (server prevents double booking), availability exceptions, reschedule, recurring.
- Booking → Paystack payment → server verification → Lesson.canJoin.
- Conversations/Messages (text first; attachments later), Notifications.
- VideoService (src/lib/video-service.ts): implement a managed-provider adapter replacing LocalPreviewVideoService; classroom only calls the interface.
- Lesson notes, Assignments/submissions, ProgressSummary, StudentRecord.
- WalletSummary, withdrawals, commission, refunds.
- Admin rows + approve/suspend actions with audit log; role check server-side.
Disabled buttons ("connects soon") mark each handoff point.
