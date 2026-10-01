import { contributorContext } from '../data';
import { ProverbForm } from '../forms';
import { Head, Notice, Submitted } from '../ui';

export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<{ submitted?: string; error?: string }> }) {
  const params = await searchParams;
  const ctx = await contributorContext();
  return (
    <>
      <Head
        title="A proverb"
        lede="An ilu, with its English if you have one. A proverb with no English is held, not published — so a translation or the page you read it on is the most useful thing you can send."
      />
      {params.error ? <Notice bad>{params.error}</Notice> : null}
      <Submitted id={params.submitted} what="submission" />
      {ctx.empty ? (
        <div className="cd-empty">No language has any entries yet, so there is nothing to contribute against safely.</div>
      ) : (
        <div className="cd-panel"><ProverbForm language={ctx.language} /></div>
      )}
    </>
  );
}
