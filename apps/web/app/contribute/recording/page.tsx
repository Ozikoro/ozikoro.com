import { contributorContext } from '../data';
import { RecordingForm } from '../forms';
import { Head, Notice, Submitted } from '../ui';

export const dynamic = 'force-dynamic';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ submitted?: string; error?: string; recorded?: string }>;
}) {
  const params = await searchParams;
  const ctx = await contributorContext();

  return (
    <>
      <Head
        title="A recording"
        lede="Say the word and upload the clip. This is the one contribution that lets a reader hear the language rather than read it."
      />
      {params.error ? <Notice bad>{params.error}</Notice> : null}
      <Submitted id={params.submitted} what="recording" />
      {ctx.empty ? (
        <div className="cd-empty">No language has any entries yet, so there is no word to record.</div>
      ) : (
        <div className="cd-panel">
          <RecordingForm language={ctx.language} dialects={ctx.dialects} />
        </div>
      )}
    </>
  );
}
