/**
 * /admin — the administration landing page.
 *
 * One entry per thing an administrator can actually do, and nothing that is not built. The
 * archive, the researchers' network and the Academy are all still to come; listing them here
 * would make this page a promise rather than a menu, so they are named as forthcoming in one
 * sentence at the bottom instead of as links that lead nowhere.
 */
import Link from 'next/link';
import { Card, Head } from './ui';

export const dynamic = 'force-dynamic';

export default async function Page() {
  return (
    <>
      <Head title="Administration" />

      <Card title="Spotify">
        <p>
          Connect the Spotify account Ozikoro publishes from, see whether it is still authorised,
          and check it against Spotify on demand.
        </p>
        <p className="actions">
          <Link className="btn btn--primary" href="/admin/spotify">
            Spotify connection
          </Link>
        </p>
      </Card>

      <Card title="Coming to this area" quiet>
        <p>
          The history archive, its sources and citations, the researchers&rsquo; network and the
          Academy all belong here too. They are not built yet, so they are not listed as though they
          were.
        </p>
      </Card>
    </>
  );
}
