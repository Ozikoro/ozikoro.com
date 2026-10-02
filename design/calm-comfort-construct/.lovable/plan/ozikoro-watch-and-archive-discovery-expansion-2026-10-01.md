# Ozikoro Watch and archive discovery expansion

## Goal
Add a distinctive, mobile-first video experience for young Africans, then fill the most useful discovery gaps revealed by the reference archive without turning Ozikoro into a crowded research blog.

## What I’ll build

### 1. Watch library
- Add a new **Watch** page linked from the main navigation and home page.
- Use a bold charcoal-and-gold “screening room” direction that belongs to Ozikoro, not HISTORY’s interface.
- Organize videos through simple rails: New, Short Histories, Oral Traditions, Places & Communities, Conversations, and Series.
- Show duration, source/channel, format, captions status, and series position before opening a video.
- Include search, clear category filters, and an A–Z route for easy discovery.
- Use verified YouTube or other public video links only; any illustrative slots will be labelled as examples rather than presented as real Ozikoro productions.

### 2. Video viewing page
- Add a focused **Watch video** screen with a responsive embedded player.
- Keep title, source, description, chapter list, transcript area, related videos, share controls, and citation/provenance together.
- Provide a direct “Watch on YouTube” fallback and a low-bandwidth transcript-first option.
- Keep every control keyboard accessible and phone-friendly.

### 3. Home-page video section
- Add one calm, image-led Watch section to the home page rather than another dense grid.
- Give all listed videos equal editorial weight beneath the shared visual introduction.
- Link clearly to the complete Watch library.

### 4. Useful archive-discovery additions
Add only the reference-site ideas that strengthen Ozikoro’s archive structure:
- **Collections hub:** Photographs, Oral Recordings, Documents, and Material Culture as media-based ways into the archive.
- **Journeys & Places:** a map/timeline-ready page showing how records connect to communities and locations, with demonstration states where verified coordinates are unavailable.
- **Topics A–Z:** a flat, accessible tag index across towns, people, practices, periods, and media.
- Extend the existing contribution flow with a visible **Correct or add community knowledge** path; do not create a duplicate upload system.

I will not copy the reference site’s colonial framing, dated blog structure, or HISTORY’s streaming-service styling and commercial patterns.

## Mobile and accessibility
- Design first for 375px, including horizontal rails that remain understandable without hidden content.
- Use large tap targets, visible focus states, restrained motion, reduced-motion support, captions/transcript status, and no autoplay.
- Keep embeds in stable aspect-ratio containers so pages do not jump while loading.

## Deliverable updates
- Create the new static HTML screens under `public/design/screens` and extend the shared CSS.
- Update navigation, category/discovery links, the walkthrough, design notes, and the root screen list.
- Preserve the no-build, backend-ready handoff format.
- Verify the home page, Watch library, viewing page, collections, journeys, and A–Z pages on desktop and mobile, including broken media and overflow checks.
