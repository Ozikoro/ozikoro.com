import { getDb } from '@ozituma/db/client';
import { readSettings, HOME_BLOCKS } from '@ozituma/db/settings';
import { BlockEditor } from '@/components/block-editor';
import { Head, Card, Notices } from '../ui';

export const dynamic = 'force-dynamic';

/*
 * The front page, block by block.
 *
 * The other half of "let the admin be able to edit and change any colour or any design from the
 * website". Colours are /admin/appearance; this is the arrangement — which sections the front page
 * is made of and in what order, dragged rather than typed.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const params = await searchParams;
  const db = await getDb();
  const settings = await readSettings(db);

  return (
    <>
      <Head title="Page blocks" />
      <Notices saved={params.saved} error={params.error} />

      <form method="post" action="/api/admin/site">
        <input type="hidden" name="action" value="save-blocks" />
        <Card title="The front page">
          <p className="wphelp" style={{ marginBottom: '0.8rem' }}>
            These are the sections the home page is built from. What you arrange here is what a
            reader sees, in this order.
          </p>
          <BlockEditor blocks={HOME_BLOCKS.map((b) => ({ ...b, on: true }))} initialOrder={settings['home.blocks']} />
        </Card>
        <p className="wpcard-foot" style={{ border: '1px solid #c3c4c7', borderRadius: 4 }}>
          <button className="wpbtn" type="submit">Save the arrangement</button>
        </p>
      </form>

      <Card title="What is not here">
        <p>
          The layout of the other pages — a word entry, a clan entry, the proverbs list — is the
          design and is not a list of blocks. What is arranged here is the front page, because that
          is the one page made of parts that can move without breaking anything.
        </p>
      </Card>
    </>
  );
}
