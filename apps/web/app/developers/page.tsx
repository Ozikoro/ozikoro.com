import Link from 'next/link';
import type { Metadata } from 'next';
import { getDb } from '@ozituma/db/client';
import { KeySignupForm } from '@/components/key-signup';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Get a free API key',
  description:
    'A free API key for the Ozituma dictionary API. No card, no approval queue. 1,000 requests a day.',
};

export default async function DevelopersPage() {
  const db = await getDb();
  const plans = await db.rows<{ plan: string; endpoint: string; daily_limit: number }>(
    `select plan, endpoint, daily_limit from plan_limit
      where endpoint = '*'
      order by case plan when 'free' then 0 when 'team' then 1 else 2 end`
  );

  return (
    <div className="wrap wrap-narrow">
      <h1>Get an API key</h1>
      <p className="hero-lede">
        Free, instant, no card. The same dictionary the website uses, over HTTP.
      </p>

      <section className="section">
        <h2>What you get</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Plan</th>
              <th style={{ textAlign: 'right' }}>Requests / day</th>
              <th>Cost</th>
            </tr>
          </thead>
          <tbody>
            {plans.map((plan) => (
              <tr key={plan.plan}>
                <td style={{ textTransform: 'capitalize' }}>{plan.plan}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {Number(plan.daily_limit).toLocaleString()}
                </td>
                <td>{plan.plan === 'free' ? 'Free' : 'Contact us'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted" style={{ fontSize: '0.88rem', marginTop: '0.75rem' }}>
          Limits are per endpoint, with tighter caps on anything expensive. The number published
          here is the number actually enforced, so the two cannot drift apart.
        </p>
      </section>

      <section className="section">
        <h2>Create your key</h2>
        <KeySignupForm />
      </section>

      <section className="section">
        <h2>Then read the docs</h2>
        <p>
          <Link href="/docs">API documentation</Link> covers every endpoint, parameter and error code.
          There is also an <a href="/api/v1/openapi.json">OpenAPI specification</a> you can point code
          generators at.
        </p>
      </section>
    </div>
  );
}
