/**
 * `@ozikoro/platform` — the platform layer for ozikoro.com.
 *
 * WHY THIS PACKAGE EXISTS
 *
 * Three sites, one institution: ozikoro.com is the parent, and ozituma.com (the dictionary)
 * and learn.ozituma.com (the courses) are its children. They are one platform, and the parts
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
export * from './members.ts';
export * from './roles.ts';
export * from './users.ts';
export * from './editorial.ts';
export * from './publications.ts';
export * from './rights.ts';
export * from './search.ts';
export * from './entities.ts';
export * from './places.ts';
export * from './seo.ts';
export * from './redirects.ts';

export * from './knowledge.ts';
export * from './design-fill.ts';
export * from './seo-head.ts';
export * from './spoken.ts';
export * from './narration.ts';
export * from './pdf/writer.ts';
export * from './pdf/publication.ts';
