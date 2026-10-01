import { contributorContext } from '../data';
import { WordForm } from '../forms';
import { Head, Notice, Submitted } from '../ui';

export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<{ submitted?: string; error?: string }> }) {
  const params = await searchParams;
  const ctx = await contributorContext();
  return (
    <>
      <Head
        title="A word"
        lede="A headword, its meanings in English, an example of it in a sentence, and the variety it is said in."
      />
      {params.error ? <Notice bad>{params.error}</Notice> : null}
      <Submitted id={params.submitted} what="submission" />
      {ctx.empty ? (
        <div className="cd-empty">No language has any entries yet, so there is nothing to contribute against safely.</div>
      ) : (
        <div className="cd-panel"><WordForm languages={ctx.available} /></div>
      )}
    </>
  );
}
