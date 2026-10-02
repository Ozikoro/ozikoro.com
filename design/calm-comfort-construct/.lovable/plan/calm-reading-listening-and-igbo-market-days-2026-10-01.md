# Calm reading, listening, and Igbo market days

## Goal
Make Ozikoro easier to enter and read: a clear Igbo market-day destination from the home page, a quieter equal-weight folklore library, and one consistent book-like reader for articles and stories with listening support.

## What will change
- Add an **Igbo Market Days** screen reached prominently from the home page. It will show the modern weekday/date beside Eke, Orie/Oye, Afọ/Afor, and Nkwọ/Nkwor, with a date lookup and visible community/source context.
- Avoid claiming one universal market-day conversion. The design will require a selected community or verified calendar basis before giving a definitive market day, because communities can use different anchors.
- Rebuild **Folklores & Myths** in the selected African parchment direction: compact introduction, one calm shared image, equal-weight story entries, short descriptive subtitles, and no oversized featured story or repeated spread.
- Add a dedicated folklore reading screen so stories stay inside Ozikoro rather than breaking into unrelated page layouts.
- Restyle the article screen and folklore reader as the same warm-paper book system: generous central text, chapter/contents drawer, previous/next reading, related content, sources, and a compact mobile reading bar.
- Add an accessible **Listen** panel to both readers with play/pause, progress, speed, download/queue affordances, and transcript status. Audio remains clearly labelled as a design state until verified recordings or narration are supplied.
- Add a **Listen / Podcasts** library that can group narrated articles and folklore into series without inventing episodes or audio.
- Update the walkthrough, screen links, notes, and mobile layouts.

## Verification
- Check desktop and 375px layouts for the market-day page, folklore library, folklore reader, article reader, and listening library.
- Confirm no horizontal overflow, broken images, missing headings, or inaccessible unnamed controls.
- Confirm all demonstration calendar and audio states are labelled and no unverified cultural mapping is presented as fact.

## Technical details
- Keep the deliverable as plain HTML and CSS under `public/design`; no backend or payment work.
- Preserve Noto Serif/Sans for Igbo diacritics and the approved black, emerald, gold, bronze, and cream palette.
- Use native semantic controls and progressive enhancement; the static files remain readable without JavaScript.
