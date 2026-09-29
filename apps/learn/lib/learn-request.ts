/**
 * The current request's learn context.
 *
 * Separate from `learn-host.ts` so the pure helpers stay importable without a request object —
 * which matters because middleware and tests can then use them. In this app there is nothing to
 * detect: the app is the courses, so this resolves configuration and nothing else.
 */
import { learnOrigin, type LearnHostInfo } from './learn-host';

export { DEFAULT_LEARN_HOST, DICTIONARY_URL, learnHref, learnOrigin } from './learn-host';
export type { LearnHostInfo } from './learn-host';

export async function learnHost(): Promise<LearnHostInfo> {
  return {
    onLearnHost: true,
    // Routes are at the root of this app: `/igbo`, not `/learn/igbo`.
    base: '',
    origin: learnOrigin(),
  };
}
