'use client';

import { useState } from 'react';

/**
 * The only interactive client component in the dictionary UI.
 *
 * Key creation has to be client-side because the plaintext key is returned
 * exactly once and must be shown to the human before the page is lost. The
 * result panel makes that unmissable and offers a copy button, since the key
 * cannot be retrieved afterwards.
 */
export function KeySignupForm() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ apiKey: string; plan: string; prefix: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/v1/developers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.get('name'),
          email: form.get('email'),
          organization: form.get('organization') || undefined,
          useCase: form.get('useCase') || undefined,
        }),
      });

      const body = await response.json();
      if (!response.ok) {
        setError(body?.error?.message ?? 'Could not create a key. Please try again.');
        return;
      }
      setIssued({ apiKey: body.apiKey, plan: body.developer.plan, prefix: body.keyPrefix });
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setPending(false);
    }
  }

  if (issued) {
    return (
      <div className="notice notice-warn">
        <strong>Your API key — copy it now.</strong>
        <p style={{ margin: '0.5rem 0' }}>
          This is the only time it will ever be shown. We store only a hash of it, so it cannot be
          recovered if you lose it.
        </p>
        <pre style={{ margin: '0.75rem 0' }}>{issued.apiKey}</pre>
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(issued.apiKey);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              } catch {
                setError('Could not access the clipboard — select the key and copy it manually.');
              }
            }}
          >
            {copied ? 'Copied' : 'Copy key'}
          </button>
          <a className="button button-secondary" href="/docs">
            Read the docs
          </a>
        </div>
        <p style={{ margin: '0.9rem 0 0', fontSize: '0.9rem' }}>
          Plan: <strong style={{ textTransform: 'capitalize' }}>{issued.plan}</strong>. Send the key as
          the <code className="mono">X-API-Key</code> header.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} style={{ display: 'grid', gap: '0.85rem' }}>
      <div>
        <label htmlFor="name">Your name</label>
        <input id="name" name="name" required maxLength={200} className="search-input" style={{ width: '100%' }} />
      </div>
      <div>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          required
          maxLength={200}
          className="search-input"
          style={{ width: '100%' }}
        />
      </div>
      <div>
        <label htmlFor="organization">Organisation (optional)</label>
        <input id="organization" name="organization" maxLength={200} className="search-input" style={{ width: '100%' }} />
      </div>
      <div>
        <label htmlFor="useCase">What are you building? (optional)</label>
        <textarea
          id="useCase"
          name="useCase"
          rows={3}
          maxLength={500}
          className="search-input"
          style={{ width: '100%', fontFamily: 'inherit' }}
        />
      </div>

      {error ? (
        <div className="notice notice-warn" role="alert">
          {error}
        </div>
      ) : null}

      <div>
        <button type="submit" className="button" disabled={pending}>
          {pending ? 'Creating…' : 'Create free key'}
        </button>
      </div>
    </form>
  );
}
