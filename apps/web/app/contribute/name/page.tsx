import { contributorContext } from '../data';
import { NameForm } from '../forms';
import { Head, Notice, Submitted } from '../ui';

export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<{ submitted?: string; error?: string }> }) {
  const params = await searchParams;
  const ctx = await contributorContext();
  return (
    <>
      <Head
        title="A name"
        lede="An Igbo personal name, with the meaning the family gives it. A name is unisex unless the name itself is stated to be male or female."
      />
      {params.error ? <Notice bad>{params.error}</Notice> : null}
      <Submitted id={params.submitted} what="submission" />
      {ctx.empty ? (
        <div className="cd-empty">No language has any entries yet, so there is nothing to contribute against safely.</div>
      ) : (
        <div className="cd-panel"><NameForm language={ctx.language} /></div>
      )}
    </>
  );
}
