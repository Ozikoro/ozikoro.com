import type { MetadataRoute } from 'next';

/**
 * The web app manifest, which is what makes the site installable.
 *
 * §13 requires an "Installable PWA" and a learner who "can download the current unit and complete
 * lessons and reviews offline". Installation is the first half of that: without a manifest a browser
 * offers no install prompt at all, and every offline mechanism below is unreachable because there is
 * no installed app to run offline.
 *
 * WHY `standalone` AND NOT `fullscreen`
 *
 * A learner moves between a lesson and the dictionary on ozituma.com. `fullscreen` would hide the
 * browser's back affordance and strand them; `standalone` keeps the app looking native while
 * leaving a way out.
 *
 * THE ICONS ARE THE DICTIONARY'S
 *
 * Deliberately. These are the same records taught from a different surface, not a separate product,
 * and a second icon set would be a second brand for one thing. They are 192 and 512 pixels because
 * that is what the install criteria require — a manifest listing sizes it does not actually ship is
 * rejected without saying why.
 *
 * `orientation` is NOT set. A learner may be reading a lesson on a phone held either way or on a
 * tablet propped up, and locking to portrait would break the last of those to solve a problem nobody
 * has.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Ozituma Learn',
    short_name: 'Ozituma',
    description:
      'Learn Igbo from the Ozituma dictionary — reviewed words, native recordings, and a review schedule that remembers what you are about to forget.',
    // The subdomain root, because that is the scope the service worker controls. Pointing this
    // elsewhere would produce an installed app whose start URL falls outside its own scope, which
    // several browsers refuse to install at all.
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#fbfaf7',
    theme_color: '#1b1a2e',
    lang: 'en',
    dir: 'ltr',
    categories: ['education', 'language'],
    icons: [
      { src: '/android-chrome-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/android-chrome-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // `maskable` lets Android crop the icon to whatever shape the launcher uses without shrinking
      // the artwork into a circle. Declared as a separate entry rather than added to the two above,
      // because a maskable icon needs its content inside a safe zone and these were drawn as
      // full-bleed squares — claiming `maskable` on them would crop the mark itself.
      { src: '/android-chrome-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      {
        name: "Today's review",
        short_name: 'Review',
        description: 'The words the schedule says you are about to forget.',
        url: '/plan',
      },
      {
        name: 'Practise vocabulary',
        short_name: 'Practise',
        description: 'Practice over the dictionary’s own published words.',
        url: '/practice',
      },
    ],
  };
}
