import { ADSENSE_LOADER_SRC } from '@/lib/adsense';

/**
 * THE ADSENSE LOADER, IN THE `<head>` OF THE REACT ROUTES.
 *
 * ⚠️ **THIS IS A SERVER COMPONENT ON PURPOSE, AND IT IS A SEPARATE FILE FROM THE UNIT FOR THE SAME REASON.**
 * The loader is one `<script async src>` tag with no state and no handler, so it must not be pulled into the
 * client bundle — an ad script that the archive pays to download should not be the thing that also adds
 * JavaScript to pages that carry no ad at all. Keeping it in a file with no `'use client'` is what says that.
 *
 * `app/layout.tsx` renders it only when `isAdsenseReaderPath(pathname)` is true, so the back office, the
 * sign-in screen, the account screen and the nine React routes that answer 307 to `/signin` never receive it.
 */
export function AdsenseLoader() {
  return <script async src={ADSENSE_LOADER_SRC} crossOrigin="anonymous" />;
}
