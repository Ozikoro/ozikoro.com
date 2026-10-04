/**
 * GET /admin/design/preview — look at the edit before saving it.
 *
 * WHY A REDIRECT AND NOT A SECOND RENDERER
 *
 * A preview that drew the page itself would be a second implementation of every fill, and the two would
 * disagree the first time a fill changed — the preview would show a page no reader will ever get. So this
 * builds nothing: it packages the pending edit into a URL parameter and sends the owner to **the same
 * `/design-screen/` route a reader goes through**, which applies it after the fills exactly as it applies a
 * stored one. What he sees in the new tab is the page he will get.
 *
 * WHY A NEW TAB AND A 303 RATHER THAN AN IFRAME
 *
 * The site answers `X-Frame-Options: DENY`, deliberately, and that is not a header to weaken so an editor can
 * embed its own pages. A 303 to a real address needs nothing loosened, and the owner gets a real browser tab
 * with the real stylesheet, the real fonts and its own address.
 *
 * THE PARAMETER IS GATED AT BOTH ENDS. This endpoint needs `manage_design` to make one, and the route that
 * renders it checks the same capability again before honouring it — because the URL it produces is copyable,
 * and a link that restyles the site for whoever opens it is not a preview.
 */
import { ALL_SCREENS, encodeDesignPreview, type DesignOverride, type DesignOverrideKind, type DesignOverrideValue } from '@ozikoro/platform';
import { redirectTo, requireCapability } from '@/lib/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KINDS: DesignOverrideKind[] = ['token', 'text', 'image', 'link', 'hide'];

function valueFor(kind: DesignOverrideKind, params: URLSearchParams): DesignOverrideValue {
  if (kind === 'token') {
    // The text field wins when it has been filled in: a native colour input cannot express `rgba(…)`, and a
    // gradient or a shadow is not a colour at all.
    return { value: (params.get('value_text') ?? '').trim() || (params.get('value') ?? '').trim() };
  }
  if (kind === 'text') return { text: params.get('text') ?? '' };
  if (kind === 'hide') return { hidden: true };
  if (kind === 'image') {
    return {
      src: (params.get('src') ?? '').trim(),
      alt: params.get('alt') ?? '',
      credit: params.get('credit') ?? undefined,
      creditKey: params.get('creditKey') || undefined,
    };
  }
  return { href: (params.get('href') ?? '').trim(), label: params.get('linkLabel') ?? '' };
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const params = url.searchParams;
  const guard = await requireCapability('manage_design', { returnTo: '/admin/design/' });
  if (!guard.ok) return guard.response;

  const kind = (params.get('kind') ?? '') as DesignOverrideKind;
  const key = (params.get('key') ?? '').trim();
  if (!KINDS.includes(kind) || key.length === 0) {
    return redirectTo('/admin/design/', { error: 'There was nothing to preview.' });
  }
  const screen = kind === 'token' ? ALL_SCREENS : (params.get('screen') ?? '').trim();
  const override: DesignOverride = { screen, kind, key, value: valueFor(kind, params) };

  /*
   * THE PUBLIC ADDRESS, NOT THE ROUTE'S OWN.
   *
   * `/<screen>/` is what a reader types and what the middleware rewrites to `/design-screen/<screen>`. Sending
   * the preview to `/design-screen/about` instead would make the address bar say so, and the design's own
   * relative links (`about.html`, `../styles/main.css`) would then resolve against it and 404 — a preview tab
   * whose menu is broken is a preview of a fault that does not exist.
   *
   * The middleware carries the query across its rewrite, which is what lets the parameter reach the route at
   * all; see the note there.
   */
  const target = screen === ALL_SCREENS ? (params.get('previewScreen') ?? 'home') : screen;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(target)) {
    return redirectTo('/admin/design/', { error: 'There is no screen to preview that on.' });
  }
  const path = target === 'home' ? '/' : `/${target}/`;
  const preview = encodeDesignPreview([override]);
  return new Response(null, {
    status: 303,
    headers: { Location: `${path}?ozpreview=${preview}`, 'cache-control': 'no-store' },
  });
}
