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
/*
 * Writing a post or a page from nothing: the create / save-draft / publish path the Classic Editor
 * screen drives. A module of its own rather than more of `editorial.ts`, because that one edits records
 * the WordPress import made and refuses a page by construction, while this one creates both kinds and
 * knows which is which. See its header for the three differences and the one decision.
 */
export * from './authoring.ts';
export * from './trash.ts';
export * from './entity-graph.ts';
export * from './audit.ts';
export * from './publications.ts';
export * from './publication-files.ts';
export * from './follows.ts';
export * from './rights.ts';
/*
 * THE SECOND MARK ON A RECORD, AND THE AGREEMENT THAT OPENS IT.
 *
 * `rights.ts` holds the claim about REUSE (`restricted`: read it here, do not republish it). This holds the
 * claim about READING (`access_tier = by_agreement`: not readable at all without an institutional access
 * agreement). **They are separate modules because they are separate claims**, and `institutional-access.ts`
 * carries the note that says why they must not share a column, a flag or a word.
 */
export * from './institutional-access.ts';
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
/*
 * THE DESIGN EDITOR'S OWN LOGIC — which control a token gets, and whether a value survives it.
 *
 * Separate from `design-override.ts` because it answers a different question: that module knows what the
 * design's tokens ARE, and this one knows which of them a colour picker can honestly be offered and what a
 * font chooser may name. The page renders what this returns, so the decision is testable without a browser
 * and without a database.
 */
export * from './design-editor.ts';
/*
 * THE SITE'S OWN ICON — the mark in a browser tab, stored in `site_setting` and served from `/favicon.ico`.
 *
 * Its own module rather than another key inside `seo-verification.ts` because the reach is the whole point:
 * `/favicon.ico` is the one address a browser asks for unprompted, which is how an icon set here reaches the
 * fifty-three design screens and the 1,051 articles that never run `app/layout.tsx`.
 */
export * from './site-icon.ts';
/*
 * THE SITE-VERIFICATION TOKENS — the owner's own, held in `site_setting`, emitted by `seoHead` into every
 * page's `<head>`. Exported beside the head builder rather than inside it because the catalogue of engines,
 * the paste reader and the table are what the administration's screen is built from, and none of those needs
 * a head to be testable.
 */
export * from './seo-verification.ts';
export * from './seo-head.ts';
/*
 * THE SITE'S OWN SEARCH-ENGINE IDENTITY, AND THE REDIRECTS A MOVED ADDRESS LEAVES BEHIND.
 *
 * Its own module beside `seo-verification.ts` because it is the same kind of thing — rows in `site_setting`
 * under the `seo.` prefix, read at serve time by the one head builder — and a different kind of thing from
 * `seo.ts`, which is the sitemap and the indexable-URL enumeration. What it carries: the site name, the title
 * separator, the title template and its variables, the front page's own title and meta description, and the
 * redirect map a permalink change writes into. **The permalink write path lives here rather than in
 * `seo-records.ts`** because changing an address is a redirect decision and not a search-result one; see the
 * header of `site-seo.ts`, and `changeRecordPermalink`.
 */
export * from './site-seo.ts';
/*
 * THE ENTITIES WORDPRESS STORED AS LITERAL TEXT, DECODED BACK TO THE CHARACTERS THEY NAME.
 *
 * Exported from the barrel because the repair is not a rendering concern: the entity is in the column, and
 * every consumer — the page, the head, the PDF, the search index, the sitemap, an export — reads it from
 * there. See `stored-entities.ts` for why it decodes to a fixed point and why `body_html` is refused.
 */
export * from './stored-entities.ts';
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
/*
 * THE PER-RECORD SEO OVERRIDE: the title and meta description an editor writes for ONE record.
 *
 * A module of its own rather than more of `seo.ts`, because they answer different questions. `seo.ts` is the
 * SITE's statement to a crawler — the sitemap, the canonical origin, what is indexable — and it is read by a
 * build check that compares its list against the routes. This is one editor's decision about one record's
 * search result: it is written from a screen, it is read by the single route that serves that record, and an
 * absent row means the record's own words. See the header of `seo-records.ts` for what is stored and what is
 * deliberately not — the canonical, the social card, the redirect table and the sitemap are all named there
 * as things this is not.
 */
export * from './seo-records.ts';
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
