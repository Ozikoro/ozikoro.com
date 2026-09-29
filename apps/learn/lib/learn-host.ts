/**
 * Where Ozituma Learn is served from.
 *
 * This app IS the courses. When the courses lived inside the dictionary app, a helper had to work
 * out whether a request had arrived on `learn.ozituma.com` or on `ozituma.com/learn`, and emit
 * links with the matching prefix — a link written as `/learn/igbo` would rewrite to
 * `/learn/learn/igbo` on the subdomain and 404, invisibly, in exactly the environment where the
 * path form was the one being tested.
 *
 * That entire class of problem is gone here. Routes in this app are at the ROOT: `/igbo`,
 * `/igbo/saying-hello`. So `base` is always the empty string, and `learnHref` survives only because
 * the page components call it — keeping those call sites unchanged is what made this split a move
 * rather than a rewrite.
 *
 * WHY THIS FILE STILL MENTIONS A HOST
 *
 * Only for `origin`, which is configuration rather than detection: it is the canonical address
 * written into course canonical links and used for outbound sharing, and it must be settable per
 * environment so a staging deployment does not advertise production URLs.
 */

/** The production address, used when OZITUMA_LEARN_URL is unset. */
export const DEFAULT_LEARN_HOST = 'learn.ozituma.com';

/**
 * The dictionary, for the outbound links in the chrome and on the word cards.
 *
 * §6.2: "from each dictionary entry a link to related lessons; from lessons a link back to the
 * dictionary entry." This constant is the return half of that.
 */
export const DICTIONARY_URL = process.env.OZITUMA_SITE_URL ?? 'https://ozituma.com';

export interface LearnHostInfo {
  /** Always true in this app. Kept so the chrome's props do not change shape. */
  onLearnHost: boolean;
  /** Always '', because routes are at the root of this app. */
  base: string;
  /** The canonical origin, for canonical links and sharing. */
  origin: string;
}

export function learnOrigin(): string {
  const configured = process.env.OZITUMA_LEARN_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  return `https://${DEFAULT_LEARN_HOST}`;
}

/**
 * Build an in-app link.
 *
 * Kept as a function rather than replaced with plain strings so that the day this app gains a
 * path prefix — a language segment, say — the change is made in one place instead of across every
 * page.
 */
export function learnHref(info: LearnHostInfo, path: string): string {
  const normalised = path.startsWith('/') ? path : `/${path}`;
  return `${info.base}${normalised}`;
}
