<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->
- Treat all learner-visible Igbo as approved-content data; placeholders must be visibly labelled and never presented as verified.
- Keep the learning experience data-driven so verified curriculum can replace demonstration data without screen rewrites.
- Use TanStack file routes with a shared learner shell on the index experience; the project framework is fixed.
- Normalize all language input to Unicode NFC and use diacritic-insensitive matching only as a search aid.
- Keep Tutor answers as clearly labelled interface samples until approved curriculum and audio are connected, because generated teaching claims must not be presented as verified.
- Keep Ndebe input mapping and glyph output replaceable; use explicit prototype notation until the licensed font and verified mapping data are supplied.
- Keep lesson practice multimodal and context-led rather than duplicating the external dictionary-generated multiple-choice drill.
- Keep free Practise sessions separate from lesson activities: practise is repeatable, learner-chosen, and never advances the course path.
- Course units and lessons live in src/lib/lesson-data.ts and render through LessonFlow (cards → chat → match → culture note); lessons unlock in order — one data source for the whole path.
- Learner place is saved per device via useStickyState (localStorage, `ozituma:` prefix) until accounts sync progress server-side.
- Teacher discovery is media-first: profiles support portrait and introduction-video URLs, while fictional preview media stays explicitly labelled as sample content.
- Frontend owns presentation and interaction only; consume DSH-owned auth, booking, payment, earnings, video, and permission state without recreating business logic.
- The product UI follows a serene heritage editorial direction: calm hierarchy, one dominant next action, restrained cultural texture, and limited card repetition.
