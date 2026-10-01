import { contributorContext } from '../data';
import { ClanForm } from '../forms';
import { Head, Notice, Submitted } from '../ui';

export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<{ submitted?: string; error?: string }> }) {
  const params = await searchParams;
  const ctx = await contributorContext();
  return (
    <>
      <Head
        title="A clan or town"
        lede="A clan, town or grouping that is not in the registry yet. This is the one contribution that does not belong to a language — it is where the people are, not what they say."
      />
      {params.error ? <Notice bad>{params.error}</Notice> : null}
      <Submitted id={params.submitted} what="submission" />
      <div className="cd-panel"><ClanForm divisions={ctx.divisions} /></div>
    </>
  );
}
