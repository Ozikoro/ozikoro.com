import Link from 'next/link';
import type { Metadata } from 'next';
import { getDb } from '@ozituma/db/client';
import { openApiDocument } from '@/lib/openapi';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'API documentation',
  description:
    'A free public REST API for African language dictionaries: search words, fetch entries, list languages. Igbo available now.',
};

function Endpoint({
  method,
  path,
  children,
}: {
  method: string;
  path: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
        <span className="chip">{method}</span>
        <code className="mono">{path}</code>
      </h3>
      {children}
    </div>
  );
}

export default async function DocsPage() {
  const db = await getDb();
  const limits = await db.rows<{ plan: string; endpoint: string; daily_limit: number; monthly_limit: number | null }>(
    `select plan, endpoint, daily_limit, monthly_limit from plan_limit
      order by plan, endpoint = '*' desc, endpoint`
  );

  return (
    <div className="wrap wrap-narrow">
      <h1>API documentation</h1>
      <p className="hero-lede">
        A free REST API over the Ozituma dictionary. Send an{' '}
        <code className="mono">X-API-Key</code> header. JSON in, JSON out.
      </p>

      <div className="notice" style={{ marginBottom: '2rem' }}>
        <strong>Base URL</strong>
        <p style={{ margin: '0.4rem 0 0' }}>
          <code className="mono">
            {process.env.OZITUMA_SITE_URL ?? 'https://ozituma.com'}/api/v1
          </code>
        </p>
      </div>

      <section className="section">
        <h2>Authentication</h2>
        <p>
          <Link href="/developers">Get a free key</Link> — no card, no approval queue. Keys are
          generated from your own account, so you need to{' '}
          <Link href="/join">create an account</Link> or <Link href="/signin">sign in</Link> first;
          the key is shown once when it is created and never again, and it can be revoked from there
          at any time. Then send it in
          the <code className="mono">X-API-Key</code> header:
        </p>
        <pre>{`curl "${process.env.OZITUMA_SITE_URL ?? 'https://ozituma.com'}/api/v1/words?keyword=mmiri" \\
  -H "X-API-Key: ozt_live_your_key_here"`}</pre>
        <p>
          Keys are stored hashed, so we can only ever show yours once, at creation. A{' '}
          <code className="mono">Bearer</code> token in the <code className="mono">Authorization</code>{' '}
          header is accepted as an alternative.
        </p>
      </section>

      <section className="section">
        <h2>Endpoints</h2>

        <Endpoint method="GET" path="/api/v1/words">
          <p>Search the dictionary. Matches headwords, alternate and dialect spellings, and English definitions in one call.</p>
          <table className="table">
            <thead>
              <tr>
                <th>Parameter</th>
                <th>Type</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="mono">keyword</td>
                <td>string</td>
                <td>Search text. <code className="mono">q</code> also works. Empty browses common words.</td>
              </tr>
              <tr>
                <td className="mono">language</td>
                <td>string</td>
                <td>ISO 639-3 code. Default <code className="mono">ibo</code>.</td>
              </tr>
              <tr>
                <td className="mono">page</td>
                <td>int</td>
                <td>Page number, from 1.</td>
              </tr>
              <tr>
                <td className="mono">limit</td>
                <td>int</td>
                <td>Results per page, 1–100. Default 20.</td>
              </tr>
              <tr>
                <td className="mono">strict</td>
                <td>bool</td>
                <td>Exact headword matches only.</td>
              </tr>
              <tr>
                <td className="mono">dialect</td>
                <td>string</td>
                <td>Dialect code, e.g. <code className="mono">ONI</code>.</td>
              </tr>
              <tr>
                <td className="mono">wordClasses</td>
                <td>csv</td>
                <td>Grammar categories, e.g. <code className="mono">NNC,AV</code>.</td>
              </tr>
              <tr>
                <td className="mono">tags</td>
                <td>csv</td>
                <td>Tag slugs, e.g. <code className="mono">proverb</code>.</td>
              </tr>
              <tr>
                <td className="mono">common</td>
                <td>bool</td>
                <td>Only high-frequency words.</td>
              </tr>
            </tbody>
          </table>
          <p style={{ marginTop: '0.9rem' }}>
            Response includes a <code className="mono">Content-Range</code> header carrying the total
            match count, plus <code className="mono">X-RateLimit-*</code> headers.
          </p>
          <pre>{`{
  "data": [
    {
      "id": 5192,
      "language": "ibo",
      "headword": "mmiri",
      "exactForm": "mmiri",
      "slug": "mmiri",
      "isCommon": true,
      "glosses": ["liquid"],
      "partOfSpeech": "Noun",
      "matchType": "headword",
      "score": 1185
    }
  ],
  "total": 93,
  "page": 1,
  "perPage": 20,
  "hasMore": true
}`}</pre>
        </Endpoint>

        <Endpoint method="GET" path="/api/v1/words/:id">
          <p>
            One entry in full — every definition, spelling variant, dialect form, example sentence,
            related word and pronunciation. <code className="mono">:id</code> accepts a numeric id or
            a slug.
          </p>
          <pre>{`curl ".../api/v1/words/ulo" -H "X-API-Key: $KEY"`}</pre>
        </Endpoint>

        <Endpoint method="GET" path="/api/v1/word-of-the-day">
          <p>Deterministic daily entry — the same for every caller, so it is cacheable.</p>
        </Endpoint>

        <Endpoint method="GET" path="/api/v1/languages">
          <p>
            Registered languages with real per-language word counts, so you can tell what is usable
            today.
          </p>
        </Endpoint>

        <Endpoint method="GET" path="/api/v1/stats">
          <p>Dictionary size: headwords, definitions, examples, dialects.</p>
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/developers">
          <p>Create an API key. Unauthenticated, rate limited per IP.</p>
          <pre>{`curl -X POST ".../api/v1/developers" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"Ada","email":"ada@example.com","useCase":"language learning app"}'`}</pre>
          <p className="muted" style={{ fontSize: '0.88rem' }}>
            The response contains your key. It is hashed on our side and cannot be retrieved again.
          </p>
        </Endpoint>
      </section>

      <section className="section">
        <h2>Rate limits</h2>
        <p>
          Limits are per developer, per endpoint, per UTC day, and the number published here is
          the number actually enforced on your key.
        </p>
        <table className="table">
          <thead>
            <tr>
              <th>Plan</th>
              <th>Endpoint</th>
              <th style={{ textAlign: 'right' }}>Per day</th>
              <th style={{ textAlign: 'right' }}>Per month</th>
            </tr>
          </thead>
          <tbody>
            {limits.map((limit) => (
              <tr key={`${limit.plan}-${limit.endpoint}`}>
                <td>{limit.plan}</td>
                <td className="mono">{limit.endpoint === '*' ? 'all endpoints' : limit.endpoint}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {Number(limit.daily_limit).toLocaleString()}
                </td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {limit.monthly_limit === null ? 'unlimited' : Number(limit.monthly_limit).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="section">
        <h2>Errors</h2>
        <p>
          Failures return a JSON body with a stable <code className="mono">code</code> and the correct
          HTTP status:
        </p>
        <pre>{`{ "error": { "code": "quota_exceeded", "message": "Daily quota exceeded ..." } }`}</pre>
        <table className="table">
          <thead>
            <tr>
              <th>Code</th>
              <th style={{ textAlign: 'right' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['missing_api_key', 401],
              ['invalid_api_key', 401],
              ['revoked_api_key', 401],
              ['quota_exceeded', 429],
              ['rate_limited', 429],
              ['not_found', 404],
              ['invalid_parameter', 400],
              ['unsupported_language', 400],
              ['internal_error', 500],
            ].map(([code, status]) => (
              <tr key={String(code)}>
                <td className="mono">{code}</td>
                <td style={{ textAlign: 'right' }}>{status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="section">
        <h2>OpenAPI specification</h2>
        <p>
          The full machine-readable schema is available at{' '}
          <a href="/api/v1/openapi.json">/api/v1/openapi.json</a> — {openApiDocument.paths ? Object.keys(openApiDocument.paths).length : 0}{' '}
          documented operations. Point code generators and Postman at it.
        </p>
      </section>

      {/*
        The id is here because the OpenAPI document's `info.license.url` points at
        it: a machine-readable terms URL has to resolve to the terms, and this is
        where a developer reads them.
      */}
      <section className="section" id="fair-use">
        <h2>Fair use</h2>
        <p>
          Use the dictionary freely, for anything, commercially included. All we ask in return is
          that whatever you publish says it came from Ozituma. Bulk downloads are allowed on the Team
          and Institution plans; if you need the whole dictionary rather than API access, tell us
          what you are building and we will export it for you.
        </p>
      </section>
    </div>
  );
}
