/**
 * The owner's colour and type overrides, as a stylesheet.
 *
 * WHY A STYLESHEET AND NOT AN INLINE BLOCK IN EACH PAGE
 *
 * The design is themed with CSS custom properties: `tokens.css` declares them, `main.css` and `showcase.css`
 * read them in 1,300-odd places, and `main.css` imports `tokens.css` at the top. **An override therefore wins
 * by coming LATER in the cascade, not by being more specific**, and `seoHead` puts this sheet after every sheet
 * the design names — an inline `<style>` before them would be overwritten, which is the stored-but-invisible
 * failure this work exists to avoid.
 *
 * IT IS ONE ADDRESS FOR EVERY SCREEN. `design-screen` serves the fifty-two design screens and `[slug]` serves
 * every article from the same deliverable; both build their head with `seoHead`, which links this. So changing
 * the accent changes it on an article page as well, which is what "change the colour" means to a person.
 *
 * THE PREVIEW PARAMETER IS GATED AND NEVER STORED.
 *
 * `?ozpreview=<base64url JSON>` renders a pending value so the owner can see a colour before saving it. It is
 * honoured ONLY for an account holding `manage_design`, because otherwise a public URL would let anyone
 * restyle the site for a victim; a request without the capability gets the stored values as though the
 * parameter were not there. Nothing about it is written down.
 */
import { getDb } from '@ozituma/db/client';
import { can, decodeDesignPreview, listDesignOverrides, themeCss, type DesignOverride } from '@ozikoro/platform';
import { getCurrentAccount } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const preview = url.searchParams.get('ozpreview');

  let overrides: DesignOverride[] = [];
  try {
    const db = await getDb();
    overrides = (await listDesignOverrides(db)).filter((override) => override.kind === 'token');

    if (preview) {
      /*
       * THE CAPABILITY IS ASKED FOR, NOT ASSUMED. A preview is a write to the page for one reader, and a
       * reader who cannot edit must not be able to make the site look like something it is not — even in
       * their own browser, because that is a screenshot away from being believed.
       */
      const viewer = await getCurrentAccount().catch(() => null);
      if (viewer && (await can(db, viewer.account.id, 'manage_design'))) {
        overrides = [
          ...overrides,
          // Only token overrides can be delivered here: this response is a stylesheet, so a text or image
          // preview has nothing to apply to. It arrives through the page route instead.
          ...decodeDesignPreview(preview).filter((override) => override.kind === 'token'),
        ];
      }
    }
  } catch (error) {
    // Degrade to the design: a database that is briefly unavailable must not cost a page its palette.
    console.error('design-theme: could not read the design overrides', error);
    overrides = [];
  }

  const css = themeCss(overrides);
  return new Response(css.length > 0 ? css : '/* no design overrides are set */\n', {
    headers: {
      'content-type': 'text/css; charset=utf-8',
      /*
       * NO STORE, AND THAT IS THE POINT. The owner changes a colour and reloads; a cached stylesheet would
       * show him the old one and he would conclude the editor does not work — which is the exact experience
       * this feature exists to remove. One small request per page is the price of a change being visible.
       */
      'cache-control': 'no-store',
    },
  });
}
