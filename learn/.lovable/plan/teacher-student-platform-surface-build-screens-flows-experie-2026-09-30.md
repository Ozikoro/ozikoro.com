# Teacher–student platform: surface build (screens, flows, experience only)

Scope, as agreed: I build how every screen looks and behaves. Your agent builds the real infrastructure (database rules, double-booking protection, payment verification, wallets, video provider, notifications engine, permissions). Every screen reads from a named data contract so your agent can plug in without redesigning.

## Audit

**Already working**
- Accounts (email + Google), profiles, roles (admin, linguist, editor)
- Teacher profiles with approval, lesson bookings, reviews only after completed lessons, school hire requests
- Protected payment fields (only the server can mark a booking paid)
- Teacher discovery with photos and video, sample teachers and dashboards
- Learner dashboard, course path, lessons, practise, dictionary, keyboard, Ndebe, staff content review

**Partially there**
- Booking: request exists, but no availability, slots, reschedule, recurring
- Payment: Pay button is a stub; Paystack verification not connected
- Teacher and learner dashboards: sample-only

**Missing (surface I will build)**
- Role-based navigation (student / teacher / admin)
- Booking flow: lesson type, duration, calendar, time, review, pay, confirmation
- Calendars: teacher availability editor, student bookable slots
- Messages: conversation list + chat (desktop and mobile)
- Virtual classroom: video stage, controls, chat, materials, whiteboard, notes, timer, connection status, AI assistant panel
- Lesson notes, assignments (student + teacher), progress page
- Earnings and withdrawals screens
- Notifications centre
- Admin console: users, teachers, bookings, payments, withdrawals, reviews, reports, disputes, settings

**Architecture risks for your agent**
- Single-page tab shell will get heavy; teacher/admin areas should become their own pages
- No availability or lessons tables yet; bookings double as lessons
- No messaging, notifications, assignments, wallet tables
- Video provider not chosen

## Build order (surface only)
1. Role-based navigation and page structure
2. Teacher dashboard + student management
3. Booking flow + both calendars
4. Messages
5. Virtual classroom (with a replaceable VideoService interface only — no provider)
6. Lesson notes, assignments, progress
7. Earnings, withdrawals, notifications
8. Admin console
9. Mobile and accessibility pass

## Rules I keep
- No fake success: where real data is missing, screens show a clear "Preview" label or an empty state that names what's pending
- Nothing already built is removed or rewritten
- Serene heritage editorial design throughout

## Technical details
- Contracts file `src/lib/contracts.ts`: TypeScript types for Availability, Slot, Booking, Lesson, Conversation, Message, Assignment, Progress, Wallet, Withdrawal, Notification, AdminAction
- `src/lib/video-service.ts`: interface only (createRoom, joinRoom, leaveRoom, mute/unmute, camera on/off, shareScreen, start/stopRecording) with a local camera preview adapter for design
- Preview data lives in one labelled file, removable in one step
- Handoff notes appended to AGENT_PROMPT.md listing each contract your agent must fill
