# Complete Ozikoro discovery, towns, calendars, and careers

## Goal
Make every homepage promise lead to a complete, clearly organised screen: visible archive collections, browsable towns with article lists, a real citation guide, two distinct calendar experiences, and a careers destination. Refine the homepage Watch, category, and town areas so they remain balanced and easy to use on phones.

## What will change
- Rebuild **Collections** as a visual collection hub with visible previews, then add dedicated screens for photographs, documents, oral recordings, and material culture. Every collection card will open its own relevant listing rather than sharing one destination.
- Align the homepage **Watch** image and copy on one level, tighten the video rows, and preserve the on-site YouTube player experience on desktop and mobile.
- Redesign **Browse by category** as a stronger editorial category panel that complements the homepage instead of looking like loose pills.
- Strengthen **Explore by town** with bolder, higher-contrast labels over its images. Add an All Towns directory and town profile screen where each town opens to an organised list of related articles, records, photographs, and contributions. Existing homepage town links will point into this journey.
- Add a dedicated **How to cite Ozikoro** guide covering article, archive-record, photograph, audio, and publication citations, with clearly labelled sample references and practical format choices. The homepage citation button will point there.
- Add an **African Cultural Calendar & Events** screen combining a calendar/list view, region and country filters, event-type filters, date search, event detail states, source/verification labels, and submission affordance. Sample events will be explicitly labelled until verified event data is supplied.
- Upgrade **Igbo Calendar** into a dedicated date tool with today’s modern date, market day, month view, date lookup, four-day cycle, naming variants, event context, source note, and calendar-basis explanation.
- Use the supplied JavaScript helper as the selected demonstration basis (1 January 2026 = Orie), while clearly stating that this anchor must be verified before production and may not represent every community calendar.
- Replace “Ozi Ikoro Limited” in the homepage’s narrow top bar with a compact live modern date plus market day link. On smaller screens it will shorten cleanly without crowding the platform links.
- Add a premium **Careers** page with mission, working areas, open-role state, transparent application steps, accessibility/equality statements, and a general-interest path. No vacancies or employment claims will be invented.
- Add the new pages to the design walkthrough and relevant shared navigation/footer links.

## Verification
- Check the homepage, all collection screens, town directory/detail, citation guide, both calendars, and careers at desktop and 375px widths.
- Confirm every new card and call-to-action has a valid local destination, all town cards open article lists, and collection cards no longer collapse into one generic page.
- Confirm date lookup and the compact top-bar date update correctly, with no horizontal overflow, broken images, unnamed controls, or console errors.
- Confirm example events, careers states, citation records, and the supplied calendar anchor are not presented as verified production facts.

## Technical details
- Keep the deliverable as plain HTML/CSS/JavaScript under `public/design`, with no build dependency.
- Reuse the established charcoal, gold, emerald, and cream visual system and Noto type family.
- Share one small calendar script between the top bar and Igbo calendar screen; preserve readable fallback content without JavaScript.
- Use only existing verified Ozikoro images already in the design, and label sample entries instead of inventing factual archive or cultural-event data.
