/** Two small pieces of chrome the dashboard pages share. */
export function Head({ title, lede, children }: { title: string; lede?: string; children?: React.ReactNode }) {
  return (
    <header className="cd-head">
      <div>
        <h1>{title}</h1>
        {lede ? <p>{lede}</p> : null}
      </div>
      {children ? <div className="cd-head-act">{children}</div> : null}
    </header>
  );
}

export function Notice({ ok, bad, children }: { ok?: boolean; bad?: boolean; children: React.ReactNode }) {
  const cls = ok ? 'cd-note cd-note-ok' : bad ? 'cd-note cd-note-bad' : 'cd-note';
  return <div className={cls}>{children}</div>;
}

/** The message a form leaves behind when it succeeds. */
export function Submitted({ id, what }: { id?: string; what: string }) {
  if (!id) return null;
  return (
    <Notice ok>
      <strong>Thank you — {what} #{id} is in.</strong>
      <p style={{ margin: '0.3rem 0 0' }}>An editor reads it before anything changes. You can follow it on Your submissions.</p>
    </Notice>
  );
}
