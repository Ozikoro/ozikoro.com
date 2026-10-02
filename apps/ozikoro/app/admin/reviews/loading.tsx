/**
 * Segment-level Suspense boundary. See `_components/page-loading.tsx` for why this sits here and
 * not at `app/` — a root-level file turns every unmatched address into a 200 (rounds 200-201).
 */
export { default } from '../../_components/page-loading.tsx';
