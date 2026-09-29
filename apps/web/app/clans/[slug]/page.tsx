import Link from 'next/link';
import { getCurrentAccount } from '@/lib/session';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getDb } from '@ozituma/db/client';
import { getClan } from '@ozituma/db/clans';
import '../clans.css';

export const dynamic = 'force-dynamic';

interface ClanPageProps {
  params: Promise<{ slug: string }>;
}

async function load(slug: string) {
  const db = await getDb();
  return getClan(db, slug);
}

export async function generateMetadata({ params }: ClanPageProps): Promise<Metadata> {
  const { slug } = await params;
  const clan = await load(slug);
  if (!clan) return { title: 'Clan not found' };
  return {
    title: clan.name,
    description:
      clan.originSummary ??
      `${clan.name}, an Igbo clan${clan.region ? ` in ${clan.region}` : ''}, with its towns and the names borne there.`,
  };
}

export default async function ClanPage({ params }: ClanPageProps) {
  const { slug } = await params;
  const clan = await load(slug);
  const currentAccount = await getCurrentAccount();
  if (!clan) notFound();

  /*
   * The kind is in the eyebrow, not left to be assumed.
   *
   * A reader who lands on a town's page should not be told it is a clan, and a
   * confederation's page should not read like a village's. The sources did not
   * make that distinction legible — a colonial survey did not need to — so the
   * page makes it.
   */
  const kindWord =
    clan.kind === 'clan'
      ? 'Clan'
      : clan.kind === 'town'
        ? 'Town'
        : clan.kind === 'section'
          ? 'Section'
          : clan.kind === 'confederation'
            ? 'Confederation of clans'
            : clan.kind === 'kingdom'
              ? 'Kingdom'
              : 'Grouping';
  const eyebrow = [clan.ethnicGroup, kindWord, clan.tribe ?? clan.region]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="clans-page">
      <main className="clans-one">
        <Link className="clans-back" href="/clans">
          ← Clan Registry
        </Link>

        <p className="clans-one-eyebrow">{eyebrow}</p>
        <h1 className="clans-one-title">{clan.name}</h1>
        {clan.parent ? (
          <p className="clans-alias">
            Part of <Link href={`/clans/${clan.parent.slug}`}>{clan.parent.name}</Link>
          </p>
        ) : null}
        {clan.aliases.length > 0 ? (
          <p className="clans-alias">Also known as {clan.aliases.join(', ')}</p>
        ) : null}
        {/*
          Where it is, in the present day.
          
          The owner: "you also still retained the colonial definitions like 'awka division and other
          divisions, instead of simply googling, find the present location and state, then add it. you
          must clarify the towns and states the clans and towns are in. no more colonial definitions."
          
          So the entry states the state and the local government areas it falls under today, before
          anything else about it. A group with none recorded says nothing here rather than reaching
          for the division it sat in under a survey taken in 1950.
        */}
        {clan.states.length > 0 || clan.lgas.length > 0 ? (
          <p className="clans-alias">
            {clan.states.length > 0 ? clan.states.join(', ') : null}
            {clan.states.length > 0 && clan.lgas.length > 0 ? ' · ' : null}
            {clan.lgas.length > 0
              ? `${clan.lgas.join(' and ')} local government area${clan.lgas.length > 1 ? 's' : ''}`
              : null}
          </p>
        ) : null}

        {clan.originSummary ? <p className="clans-one-summary">{clan.originSummary}</p> : null}

        {clan.description.length > 0 ? (
          <div className="clans-body">
            {clan.description.map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </div>
        ) : null}

        {clan.members.length > 0 ? (
          <section className="clans-section">
            <h2>Made up of</h2>
            <ul className="clans-towns">
              {clan.members.map((member) => (
                <li key={member.slug} className="clans-town">
                  <Link href={`/clans/${member.slug}`}>{member.name}</Link>
                  <span className="clans-note"> {member.kind}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {clan.towns.length > 0 ? (
          <section className="clans-section">
            <h2>Towns in {clan.name}</h2>
            <ul className="clans-towns">
              {clan.towns.map((town) => (
                <li
                  key={town.name}
                  className={town.isHead ? 'clans-town clans-town-head' : 'clans-town'}
                >
                  {town.name}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {clan.names.length > 0 ? (
          <section className="clans-section">
            <h2>Names borne in {clan.name}</h2>
            <ul className="clans-names">
              {clan.names.map((name) => (
                <li key={name.id}>
                  <Link href={`/names/${encodeURIComponent(name.slug)}`}>
                    <span className="clans-names-name">{name.name}</span>
                    {name.meaning ? (
                      <span className="clans-names-meaning">{name.meaning}</span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <p className="clans-note">
          Something here that is wrong, or a clan that is missing?{' '}
          <Link href="/contribute">Send a correction</Link> — it is read before it is published.
        </p>
        {/*
          Editing the entry, for anyone signed in.

          The owner: "let editors and contributors be able to edit the clans, and fill information
          needed, so we can be able to fill up the places we don't have information on." The need is
          concrete — most entries have no state recorded, because the records came from a survey that
          located a group by colonial division — and the people who can fill that in are the ones
          reading the page. A proposal, not an edit: an editor reads it first.
        */}
        <section className="clans-section" aria-label="Propose an edit">
          <h2>Propose an edit</h2>
          {currentAccount ? (
            <>
              <p className="muted" style={{ fontSize: '0.88rem', margin: '0 0 0.7rem' }}>
                Submitting as{' '}
                <strong>
                  {currentAccount.account.displayName ?? currentAccount.account.email}
                </strong>
                . An editor reads every proposal before it is published.
              </p>
              <form
                action="/api/contributions"
                method="post"
                style={{ display: 'grid', gap: '0.6rem', maxWidth: '42rem' }}
              >
                <input type="hidden" name="kind" value="clan_edit" />
                <input type="hidden" name="language" value="ibo" />
                <input type="hidden" name="clanId" value={clan.id} />
                <input type="hidden" name="previousSlug" value={clan.slug} />
                <input type="hidden" name="previousName" value={clan.name} />
                <input type="hidden" name="previousOrigin" value={clan.originSummary ?? ''} />
                {clan.description.map((p, i) => (
                  <input key={i} type="hidden" name="previousDescription" value={p} />
                ))}
                {clan.states.map((v) => (
                  <input key={v} type="hidden" name="previousState" value={v} />
                ))}
                {clan.lgas.map((v) => (
                  <input key={v} type="hidden" name="previousLga" value={v} />
                ))}
                {clan.towns.map((t) => (
                  <input key={t.name} type="hidden" name="previousTown" value={t.name} />
                ))}

                <label htmlFor="clan-name" style={{ fontSize: '0.85rem' }}>
                  The name
                </label>
                <input id="clan-name" name="name" className="search-input" defaultValue={clan.name} maxLength={120} />

                <label htmlFor="clan-states" style={{ fontSize: '0.85rem' }}>
                  State or states it is in today, separated by commas
                </label>
                <input
                  id="clan-states"
                  name="state"
                  className="search-input"
                  defaultValue={clan.states.join(', ')}
                  placeholder="e.g. Anambra"
                />

                <label htmlFor="clan-lgas" style={{ fontSize: '0.85rem' }}>
                  Local government areas, separated by commas
                </label>
                <input
                  id="clan-lgas"
                  name="lga"
                  className="search-input"
                  defaultValue={clan.lgas.join(', ')}
                  placeholder="e.g. Idemili North, Idemili South"
                />

                <label htmlFor="clan-towns" style={{ fontSize: '0.85rem' }}>
                  Towns, separated by commas or one per line
                </label>
                <textarea
                  id="clan-towns"
                  name="town"
                  className="search-input"
                  rows={Math.max(3, Math.ceil(clan.towns.length / 3))}
                  defaultValue={clan.towns.map((t) => t.name).join(', ')}
                />

                <label htmlFor="clan-origin" style={{ fontSize: '0.85rem' }}>
                  The one-line summary
                </label>
                <textarea
                  id="clan-origin"
                  name="origin"
                  className="search-input"
                  rows={2}
                  defaultValue={clan.originSummary ?? ''}
                  maxLength={4000}
                />

                <label htmlFor="clan-description" style={{ fontSize: '0.85rem' }}>
                  The description, one paragraph per blank line
                </label>
                <textarea
                  id="clan-description"
                  name="description"
                  className="search-input"
                  rows={7}
                  defaultValue={clan.description.join('\n\n')}
                  maxLength={12000}
                />

                <label htmlFor="clan-note" style={{ fontSize: '0.85rem' }}>
                  Why, and where the information is from (optional)
                </label>
                <input
                  id="clan-note"
                  name="note"
                  className="search-input"
                  maxLength={1000}
                  placeholder="What is missing or wrong, and how you know"
                />

                <div>
                  <button className="button" type="submit">
                    Propose this edit
                  </button>
                </div>
              </form>
            </>
          ) : (
            <p>
              <Link href="/signin">Sign in</Link> or <Link href="/join">create an account</Link> to
              propose an edit. An editor reads every proposal before anything changes.
            </p>
          )}
        </section>

      </main>
    </div>
  );
}
