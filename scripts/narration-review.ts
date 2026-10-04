/**
 * narration-review — the operator's console for the audio pipeline, and THE CRON ENTRY POINT.
 *
 * WHY THIS EXISTS AS WELL AS THE API ROUTES
 *
 * The routes need a signed-in account, because every decision they record has to be attributable to a person.
 * A scheduler has no session, so the automatic step — *propose narration for records that went live a few
 * minutes ago* — has to be runnable without one. That is this script.
 *
 * **There is no scheduler in this codebase.** The ways an article reaches `published` were traced before this
 * was written (`updateArticleFacets`, and the importers), and there is no worker, no queue and no timer
 * anywhere in the repository. So the sweep is an idempotent function with two doors — `POST
 * /api/podcast/sweep` for a reviewer and this command for cron — and the cron line is:
 *
 *     node --env-file=.env.local scripts/narration-review.ts sweep
 *
 * `--env-file` is Node's own loader, so nothing here re-implements the environment. Without an ElevenLabs key
 * the sweep still works: proposing costs nothing and needs no key at all.
 *
 * THE ACTOR IS REQUIRED ON EVERY ACT THAT RECORDS A PERSON
 *
 * A decision column filled with the wrong name is worse than an empty one, and this script has no session to
 * read a name from. So `--actor=` is required for declines, edits, rejections and publications, and the
 * account is looked up by email or id. **The sweep takes no actor, because nobody proposed those** — which is
 * itself the honest record, and why `proposed_by` is a separate column from `approved_by`.
 *
 * RENDERING IS BEHIND `--yes`
 *
 * `approve-proposal` spends real credits. Typing the command is already a deliberate act, and the credit
 * charge is the one thing here that cannot be undone, so it is asked for twice.
 *
 * Usage:
 *   node scripts/narration-review.ts list
 *   node scripts/narration-review.ts show <slug>
 *   node scripts/narration-review.ts sweep [--limit=5] [--since=ISO] [--delay=5] [--max-age-hours=24] [--voice=own]
 *   node scripts/narration-review.ts propose <slug> [--voice=own] [--actor=you@example.com] [--note=…]
 *   node scripts/narration-review.ts decline <slug> --actor=you@example.com [--note=…]
 *   node scripts/narration-review.ts approve-proposal <slug> --actor=you@example.com --yes [--voice=own]
 *   node scripts/narration-review.ts publish <slug> --actor=you@example.com [--note=…]
 *   node scripts/narration-review.ts reject <slug> --actor=you@example.com [--script-file=corrected.txt] [--note=…]
 *   node scripts/narration-review.ts correct <slug> --actor=you@example.com --script-file=corrected.txt
 *   node scripts/narration-review.ts check
 */
import { readFileSync } from 'node:fs';
import { closeDb, getDb, type Db } from '@ozituma/db/client';
import {
  can,
  declineNarration,
  findNarrationEpisode,
  isNarrationVoice,
  listNarrationQueue,
  MemberError,
  narrationCounts,
  proposeNarration,
  publishNarrationEpisode,
  rejectNarration,
  setNarrationScript,
  sweepNarrationProposals,
  type NarrationVoice,
} from '@ozikoro/platform';
// The ONE render path. There is deliberately no second `speak` call anywhere in this repository's tooling.
import { renderProposedNarration } from '../apps/ozikoro/lib/render-episode.ts';

const argv = process.argv.slice(2);
const positional = argv.filter((a) => !a.startsWith('--'));
const command = positional[0] ?? 'list';
const subject = positional[1];

function flag(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}
function has(name: string): boolean {
  return argv.includes(`--${name}`);
}
function int(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) {
    console.error(`  “${raw}” is not a number.`);
    process.exit(2);
  }
  return n;
}
const voiceFlag = (): NarrationVoice | undefined => {
  const raw = flag('voice');
  if (!raw) return undefined;
  if (!isNarrationVoice(raw)) {
    console.error('  --voice must be "own" or "generic".');
    process.exit(2);
  }
  return raw;
};

function say(line = ''): void {
  console.log(`  ${line}`);
}
function heading(text: string): void {
  console.log('');
  console.log(`  ${text}`);
  console.log('');
}

/** The account a decision is attributed to. **Required wherever a person is being recorded.** */
async function actor(db: Db, required: boolean): Promise<number | null> {
  const raw = flag('actor')?.trim();
  if (!raw) {
    if (!required) return null;
    console.error('');
    console.error('  --actor= is required for this command. A decision recorded against nobody is not a record.');
    console.error('  Pass an account email or id, e.g. --actor=idenzeme@gmail.com');
    console.error('');
    process.exit(2);
  }
  const id = Number.parseInt(raw, 10);
  const row =
    (Number.isFinite(id) ? await db.one<{ id: number }>(`select id from account where id = $1`, [id]) : null) ??
    (await db.one<{ id: number }>(`select id from account where lower(email) = lower($1)`, [raw]));
  if (!row) {
    console.error(`  No account matches --actor=${raw}.`);
    process.exit(2);
  }
  return row.id;
}

function scriptFromFile(): string | null {
  const path = flag('script-file');
  if (!path) return null;
  return readFileSync(path, 'utf8');
}

function requireSubject(what: string): string {
  if (!subject) {
    console.error(`  usage: node scripts/narration-review.ts ${command} <${what}>`);
    process.exit(2);
  }
  return subject;
}

/*
 * THE RENDERING COMMAND IMPORTS THE APP'S OWN RENDERER.
 *
 * `renderProposedNarration` is the only bridge from an approved proposal to `speak`, and it is imported from
 * `apps/ozikoro/lib/` rather than reimplemented here. **A console with its own `fetch` to the speech endpoint
 * is how a pipeline acquires a second path around its own approval gate** — the mistake 0045's note records
 * about `prepare-episode.ts` having its own non-chunking renderer.
 */
const db = await getDb();

try {
  await run();
} catch (error) {
  /*
   * A REFUSAL IS AN ANSWER, NOT A CRASH.
   *
   * `proposeNarration` refuses a record with no speakable words, an episode already under way, or a slug that
   * is not published — and every one of those is a fact the operator needs to read. **An unhandled
   * `MemberError` printed a stack trace instead**, which buries the sentence that says what is wrong and makes
   * an expected refusal look like a fault in the tool.
   */
  if (error instanceof MemberError) {
    console.error('');
    console.error(`  ${error.message}`);
    console.error(`  (${error.code}) — nothing was changed.`);
    console.error('');
    process.exitCode = 1;
  } else {
    throw error;
  }
} finally {
  await closeDb();
}

async function run(): Promise<void> {
  if (command === 'list') {
    const [queue, counts] = await Promise.all([listNarrationQueue(db, { limit: 100 }), narrationCounts(db)]);
    heading('The audio pipeline, as it stands');
    for (const c of counts) say(`${c.status.padEnd(16)} ${c.count}`);
    if (queue.length === 0) {
      say('');
      say('Nothing is waiting for a person.');
    }
    for (const item of queue) {
      say('');
      say(`${item.status.toUpperCase().padEnd(14)} ${item.title}`);
      say(`  slug ${item.slug}`);
      say(
        `  ${(item.characters ?? 0).toLocaleString('en-GB')} characters · about ` +
          `${(item.estimatedCredits ?? 0).toLocaleString('en-GB')} credits at the estimate · ` +
          `${item.hasAudio ? 'audio ready' : 'NO AUDIO — nothing rendered'}`
      );
    }
    console.log('');
  } else if (command === 'show') {
    const slug = requireSubject('slug');
    const episode = await findNarrationEpisode(db, { slug });
    if (!episode) {
      console.error(`  No episode for “${slug}”.`);
      process.exit(1);
    }
    heading(`${episode.title} — ${episode.status}`);
    say(`characters ${episode.charCount ?? episode.script.length}`);
    say(`estimated  ${episode.estimatedCredits ?? '—'} credits`);
    say(`audio      ${episode.storageKey ?? episode.externalUrl ?? 'none — a proposal has no audio'}`);
    say('');
    console.log(episode.script);
  } else if (command === 'sweep') {
    const outcome = await sweepNarrationProposals(db, {
      actorId: null,
      ...(voiceFlag() ? { voice: voiceFlag() } : {}),
      ...(int(flag('limit')) !== undefined ? { limit: int(flag('limit')) } : {}),
      ...(int(flag('delay')) !== undefined ? { delayMinutes: int(flag('delay')) } : {}),
      ...(int(flag('max-age-hours')) !== undefined ? { maxAgeHours: int(flag('max-age-hours')) } : {}),
      ...(flag('since') ? { since: new Date(String(flag('since'))).toISOString() } : {}),
    });
    heading('Sweep');
    say(`window       ${outcome.since} .. now, at least ${outcome.delayMinutes} minutes after publication`);
    say(`considered   ${outcome.considered}`);
    for (const p of outcome.proposed) {
      say(`proposed     ${p.slug} — ${p.characters.toLocaleString('en-GB')} characters, ~${p.estimatedCredits} credits`);
    }
    for (const f of outcome.failed) say(`FAILED       ${f.slug}: ${f.reason}`);
    say('');
    say('Nothing was rendered. Every proposal waits for a person to approve the spend.');
  } else if (command === 'propose') {
    const slug = requireSubject('slug');
    const actorId = await actor(db, false);
    const proposal = await proposeNarration(db, {
      slug,
      actorId,
      ...(voiceFlag() ? { voice: voiceFlag() } : {}),
      note: flag('note') ?? null,
    });
    heading('Proposed — NOTHING HAS BEEN SPENT');
    say(`record      ${proposal.title}`);
    say(`characters  ${proposal.characters.toLocaleString('en-GB')}`);
    say(`estimated   ~${proposal.estimatedCredits.toLocaleString('en-GB')} credits`);
    say(`voice       ${proposal.voice}`);
    say('');
    say('Review it, then `approve-proposal --yes` to render or `decline` to refuse at no cost.');
  } else if (command === 'decline') {
    const slug = requireSubject('slug');
    const actorId = await actor(db, true);
    const result = await declineNarration(db, { slug, actorId: actorId as number, note: flag('note') ?? null });
    heading('Declined — nothing was rendered, nothing was spent');
    say(`${result.title} (${result.slug})`);
    say('The sweep will not propose this record again. Propose it directly to try again.');
  } else if (command === 'approve-proposal') {
    const slug = requireSubject('slug');
    const actorId = await actor(db, true);
    /*
     * THE CAPABILITY IS CHECKED HERE TOO, AND IT WAS NOT BEFORE.
     *
     * `--actor=` proved only that an account with that email EXISTS. The API routes gate the same render on
     * `manage_ai_corpus` through `guardNarration`, and this console did not — so anyone who could run a shell
     * command could render the whole article in the owner's cloned voice on the owner's account, and the
     * transition row would name whoever the operator typed. **A gate that lets anyone approve is not the gate
     * the owner asked for**, and the console is a second door to the same charge.
     */
    if (!(await can(db, actorId as number, 'manage_ai_corpus'))) {
      console.error('');
      console.error(`  --actor=${flag('actor')} does not hold “manage ai corpus”, which is the permission that`);
      console.error('  authorises a charge. Rendering it would spend the owner’s credits on somebody else’s say-so.');
      console.error('  Nothing was sent. An administrator or the owner must run this command.');
      console.error('');
      process.exit(2);
    }
    if (!has('yes')) {
      const episode = await findNarrationEpisode(db, { slug });
      heading('This would SPEND CREDITS');
      say(`record      ${episode?.title ?? slug}`);
      say(`characters  ${(episode?.script.length ?? 0).toLocaleString('en-GB')}`);
      say(`estimated   ~${(episode?.charCount ?? episode?.script.length ?? 0).toLocaleString('en-GB')} credits`);
      say('');
      say('Re-run with --yes to render it. Nothing has been sent.');
      process.exit(0);
    }
    const result = await renderProposedNarration(db, {
      slug,
      actorId: actorId as number,
      ...(voiceFlag() ? { voice: voiceFlag() } : {}),
      note: flag('note') ?? null,
    });
    if (!result.ok) {
      console.error(`  NOT RENDERED (${result.code}): ${result.message}`);
      process.exit(1);
    }
    heading('Rendered — AWAITING REVIEW');
    say(`audio       ${result.audioUrl}`);
    say(`download    /api/podcast/download/${result.slug}`);
    say(`bytes       ${result.bytes.toLocaleString('en-GB')} (${(result.bytes / 1024 / 1024).toFixed(1)} MB)`);
    say(`characters  ${result.characters.toLocaleString('en-GB')}`);
    say(
      `charge      ${
        result.measuredCredits === null
          ? `estimate ~${result.estimatedCredits} credits; the allowance could not be re-read`
          : `${result.measuredCredits} credits measured (estimate ~${result.estimatedCredits})`
      }`
    );
    say(`revision    ${result.revision}`);
    say('');
    say('It is on the article and in the feed only after `publish`.');
  } else if (command === 'publish') {
    const slug = requireSubject('slug');
    const actorId = await actor(db, true);
    const published = await publishNarrationEpisode(db, { slug, actorId: actorId as number, note: flag('note') ?? null });
    heading('PUBLISHED — the player now appears on the article');
    say(`${published.title} · /${published.slug}/ · ${published.publishedAt}`);
    say('The feed at /podcast/feed.xml lists it from now on.');
  } else if (command === 'reject') {
    const slug = requireSubject('slug');
    const actorId = await actor(db, true);
    const result = await rejectNarration(db, {
      slug,
      actorId: actorId as number,
      note: flag('note') ?? null,
      correctedScript: scriptFromFile(),
    });
    heading('Rejected — waiting to be rendered again');
    say(`${result.slug} is now “${result.status}”`);
    say(result.revision ? `corrections saved as revision ${result.revision} (the old take is kept)` : 'no corrected script was given');
  } else if (command === 'correct') {
    const slug = requireSubject('slug');
    const actorId = await actor(db, true);
    const script = scriptFromFile();
    if (!script) {
      console.error('  --script-file=<path> is required: the corrected script.');
      process.exit(2);
    }
    const result = await setNarrationScript(db, { slug, actorId: actorId as number, script, note: flag('note') ?? null });
    heading('Script saved');
    say(`${result.slug} is now “${result.status}”, revision ${result.revision}`);
    say('It has to be rendered again before it can go live.');
  } else if (command === 'check') {
    process.exitCode = await check(db);
  } else {
    console.error(`  Unknown command “${command}”.`);
    console.error('  list | show | sweep | propose | decline | approve-proposal | publish | reject | correct | check');
    process.exit(2);
  }
}

/**
 * The invariants, asked of the database rather than of the code.
 *
 * Each of these is a way the review step could be quietly defeated, and each is a query so that the answer is
 * about the rows that exist rather than about the code that wrote them.
 */
async function check(db: Db): Promise<number> {
  const failures: string[] = [];
  const pass = (label: string): void => say(`PASS  ${label}`);

  const publishedUnapproved = await db.rows<{ slug: string }>(
    `select slug from ozikoro_episode
      where status = 'published'
        and (approved_by is null or approved_at is null or published_at is null)`
  );
  if (publishedUnapproved.length > 0) {
    failures.push(`published without an approver: ${publishedUnapproved.map((r) => r.slug).join(', ')}`);
  } else pass('every published episode records who approved it and when');

  const proposalWithAudio = await db.rows<{ slug: string }>(
    `select slug from ozikoro_episode where status = 'proposed' and (storage_key is not null or external_url is not null)`
  );
  if (proposalWithAudio.length > 0) {
    failures.push(`a proposal holds audio, which means a render happened before approval: ${proposalWithAudio.map((r) => r.slug).join(', ')}`);
  } else pass('no proposal holds audio — nothing is rendered before it is approved');

  const renderedWithoutAudio = await db.rows<{ slug: string }>(
    `select slug from ozikoro_episode
      where status in ('pending_review')
        and storage_key is null and external_url is null`
  );
  if (renderedWithoutAudio.length > 0) {
    failures.push(`awaiting review with no audio: ${renderedWithoutAudio.map((r) => r.slug).join(', ')}`);
  } else pass('everything awaiting review has audio to listen to');

  const publishedWithoutRevision = await db.rows<{ slug: string }>(
    `select e.slug from ozikoro_episode e
      where e.status = 'published'
        and not exists (
          select 1 from ozikoro_episode_revision r
           where r.episode_id = e.id and r.storage_key is not null and r.script = e.script
        )`
  );
  if (publishedWithoutRevision.length > 0) {
    failures.push(`published with no revision recording the rendered script: ${publishedWithoutRevision.map((r) => r.slug).join(', ')}`);
  } else pass('every published episode has a revision holding the exact script that was rendered');

  const unheld = await db.rows<{ capability: string }>(
    `select distinct capability from ozikoro_role_capability where capability = 'review_audio'`
  );
  if (unheld.length === 0) {
    failures.push('no role holds review_audio — the capability is on nobody, which is the 0042 defect again');
  } else pass('review_audio is held by at least one role');

  console.log('');
  if (failures.length > 0) {
    for (const f of failures) console.error(`  FAIL  ${f}`);
    console.error('');
    console.error(`  ${failures.length} check(s) FAILED.`);
    return 1;
  }
  console.log('  All narration checks passed.');
  return 0;
}
