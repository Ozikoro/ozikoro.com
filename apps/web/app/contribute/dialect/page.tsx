import { contributorContext } from '../data';
import { DialectForm } from '../forms';
import { Head, Notice, Submitted } from '../ui';

export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<{ submitted?: string; error?: string }> }) {
  const params = await searchParams;
  const ctx = await contributorContext();
  return (
    <>
      <Head
        title="A dialect"
        lede="A variety of Igbo the dictionary does not record yet. Once it is here, a spelling or a recording can be filed under it."
      />
      {params.error ? <Notice bad>{params.error}</Notice> : null}
      <Submitted id={params.submitted} what="submission" />
      {ctx.empty ? (
        <div className="cd-empty">No language has any entries yet, so there is nothing to contribute against safely.</div>
      ) : (
        <div className="cd-panel"><DialectForm language={ctx.language} /></div>
      )}
    </>
  );
}
