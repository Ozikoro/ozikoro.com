/**
 * `@ozikoro/platform` — the platform layer for ozikoro.com.
 *
 * WHY THIS PACKAGE EXISTS
 *
 * Three sites, one institution: ozikoro.com is the parent, and ozituma.com (the dictionary)
 * and the Academy are its children. **The Academy's host is `academy.ozikoro.com`, which replaced
 * the retired `learn.ozituma.com` and is still being prepared**, so the parts
 * that make them one are deliberately shared:
 *
 *   - one database, one schema, one migration lineage (`@ozituma/db`)
 *   - one account table, so a person is one person across all three (`@ozituma/db/accounts`)
 *   - one orthography model and language registry (`@ozituma/core`)
 *
 * What is NOT shared is any one site's product surface. The dictionary's words are not the
 * archive's articles, and the archive's Spotify connection is not the dictionary's business.
 * This package is where ozikoro.com's own surface lives, so that:
 *
 *   - the dictionary and the courses cannot import it by accident, because they do not
 *     depend on it and it is not in any shared barrel;
 *   - it does not ride along in their bundles;
 *   - it can be tested on its own, with the repository's plain-node script convention,
 *     without standing up a Next.js server.
 *
 * The dependency direction is one way and stays that way:
 *
 *     apps/ozikoro  ->  @ozikoro/platform  ->  @ozituma/db  ->  Postgres
 *                                              @ozituma/core (pure)
 *
 * `@ozikoro/platform` never imports from an app, and never imports from `apps/ozikoro`
 * route handlers. If the podcast pipeline arrives, it arrives here.
 *
 * WHAT IS IN IT TODAY
 *
 * The secure Spotify connection: authorisation, state validation, token storage and
 * renewal, and the API seam the publishing workflow will call. Publishing itself is not
 * possible through Spotify's Web API — see docs/PODCAST-PIPELINE.md — so this is the
 * connection layer and deliberately nothing more.
 */
export * from './spotify.ts';
export * from './connection.ts';
export * from './content.ts';
export * from './archive.ts';
export * from './media.ts';
export * from './media-key.ts';
export * from './members.ts';
export * from './roles.ts';
export * from './users.ts';
export * from './editorial.ts';
export * from './trash.ts';
export * from './entity-graph.ts';
export * from './audit.ts';
export * from './publications.ts';
export * from './publication-files.ts';
export * from './follows.ts';
export * from './rights.ts';
export * from './search.ts';
export * from './entities.ts';
export * from './places.ts';
export * from './seo.ts';
export * from './redirects.ts';

export * from './knowledge.ts';
export * from './design-fill.ts';
export * from './design-paths.ts';
/*
 * WHICH WORKSPACES AN ACCOUNT MAY LOOK AT.
 *
 * The deliverable draws fourteen dashboards, and the design's own switcher offered all of them to
 * everybody — which is why it was removed. `dashboard-modes.ts` holds the allow-list that replaces it:
 * one table, read by the design screens at serve time, by the administration's navigation and by the
 * application's masthead, so the three cannot disagree about who may open what.
 */
export * from './dashboard-modes.ts';
/*
 * THE OVERRIDE LAYER, WHICH IS WHAT MAKES THE DESIGN EDITABLE WITHOUT BEING EDITED.
 *
 * `design-override.ts` is pure — the token catalogue, the selector grammar, the serve-time apply and the
 * contrast maths — and `design-override-store.ts` is the table. They are separate because the pure half has
 * to be testable in a plain `node --test` with no database, which is where the ordering rule and the
 * selector rule are actually asserted.
 */
export * from './design-override.ts';
export * from './design-override-store.ts';
export * from './seo-head.ts';
export * from './spoken.ts';
export * from './narration.ts';
/*
 * THE TRANSCRIPT'S OWN PAGE, FILLED FROM THE DESIGN'S ARTICLE READING FRAME.
 *
 * It is its own module rather than another fill in `design-fill.ts` because it is the one reader-facing page
 * built on a screen the design drew for something else, and the reasoning for that — which screen draws a
 * transcript, and which does not — belongs beside the code rather than in a file of fifty fills. See
 * `transcript-page.ts`.
 */
export * from './transcript-page.ts';
/*
 * WHERE THE AUDIO LIVES WHEN IT IS NOT HELD HERE.
 *
 * `external-audio.ts` owns the second way an episode can carry audio — a link to Spotify or another service
 * instead of a file this archive rendered. It is separate from `narration.ts` because it is the one path in
 * the audio pipeline that spends nothing: a proposal costs nothing, a render costs credits, and an external
 * link costs nothing but is still a publication and is therefore audited.
 */
export * from './external-audio.ts';
export * from './mp3.ts';
/*
 * THE IGBO PRONUNCIATION PIPELINE, in the order the owner described it:
 *
 *   igbo-words.ts      find every Igbo word in an article, and say how it knows   ("any words that is Igbo")
 *   pronunciation.ts   look it up in ozituma, then dissect it into pieces          ("pull out the record")
 *   missing-words.ts   queue what cannot be said, notify, and gate the render      ("inform the admin")
 *   credit-planner.ts  what the plan buys, and what one record costs first         ("how many credits")
 *
 * They are exported from the barrel because `apps/ozikoro` is their only consumer and the barrel is how it
 * already imports `narration.ts` and `spoken.ts`.
 */
export * from './igbo-words.ts';
export * from './pronunciation.ts';
export * from './missing-words.ts';
export * from './credit-planner.ts';
export * from './pdf/writer.ts';
export * from './pdf/png.ts';
export * from './pdf/sfnt.ts';
export * from './pdf/publication.ts';
