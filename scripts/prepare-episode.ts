/**
 * Prepare an episode: the article's own words, made speakable, held for review.
 *
 * WHAT THIS DOES NOT DO, AND WHY THAT IS THE POINT
 *
 * The brief this was built from asks for a script refiner that rewrites an article into "the precise narrative
 * tone of The 48 Laws of Power" — grim maxims, dramatic pauses, a chilling closing law. **That is the one thing
 * this archive must not do.**
 *
 * The brief's own rules say never to invent content and never to put a generated answer above primary evidence.
 * A history rewritten into a menacing audiobook is a different document from the record it came from: **it
 * asserts a tone the source does not have, and a listener has no way to tell which sentences are the archive's
 * and which were added for effect.** The founding rule of this work is that the record is reproduced faithfully.
 *
 * So the "script" is the article, prepared for speaking rather than rewritten:
 *
 *   headings become spoken sentences            "The Nri Tradition" -> "The Nri Tradition."
 *   citation brackets and file references go    a listener cannot follow "see figure 3"
 *   numbers and dates are left exactly as they are
 *   sentences are not reordered, shortened or dramatised
 *
 * IT NOW GOES THROUGH THE PROPOSAL, LIKE EVERY OTHER RENDER
 *
 * This script used to build its own episode row and call `speak` itself. **That made it a second path to a
 * charge with nothing in front of it** — the one thing the owner's rule forbids — and it meant two
 * implementations of the same render that could drift, which they already had: its own copy had no chunking,
 * so an 11,000-character record failed here while the API route beside it handled the same article.
 *
 * So it now does exactly what the review flow does, in two steps that are both visible on the console:
 *
 *   1. it PROPOSES the narration — the script, the character count and the cost, with no audio and no charge;
 *   2. with `--approve`, it renders that proposal through `renderProposedNarration`, the one renderer.
 *
 * Without `--approve` it stops after the proposal and spends nothing. **A render is attributed to a person**,
 * so `--actor=` is required when approving: an episode that nobody can be asked about is not a record.
 *
 * WHAT IT NEEDS, AND WHAT HAPPENS WITHOUT IT
 *
 * An ElevenLabs key and a chosen voice for the render; the proposal needs neither, because it costs nothing.
 * **Without them it stops and says so**, rather than writing a placeholder that looks like an episode.
 *
 * THE VOICE
 *
 * `--voice=own` uses a cloned voice the owner has trained in their own ElevenLabs account, and
 * `narrator_kind` is recorded as `synthetic_own_voice` with the disclosure that implies. **A cloned voice
 * belongs to the person who trained it**, which is what Spotify's second rule requires and why this takes a
 * voice ID from the environment rather than choosing one.
 *
 * Usage:
 *   node scripts/prepare-episode.ts <article-slug> [--voice=own|generic] [--dry-run]
 *   node --env-file=.env.local scripts/prepare-episode.ts <article-slug> --approve --actor=you@example.com
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { closeDb, getDb } from '@ozituma/db/client';
import { can, isNarrationVoice, proposeNarration, type NarrationVoice } from '@ozikoro/platform';
import { ownVoiceId, genericVoiceId, configured } from '../apps/ozikoro/lib/elevenlabs.ts';
import { renderProposedNarration } from '../apps/ozikoro/lib/render-episode.ts';

const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith('--'));
const dryRun = args.includes('--dry-run');
const approve = args.includes('--approve');
const actorFlag = args.find((a) => a.startsWith('--actor='))?.split('=').slice(1).join('=');
const voiceRaw = args.find((a) => a.startsWith('--voice='))?.split('=')[1] ?? 'own';

if (!slug) {
  console.error('  usage: node scripts/prepare-episode.ts <article-slug> [--voice=own|generic] [--dry-run] [--approve --actor=<email>]');
  process.exit(2);
}
if (!isNarrationVoice(voiceRaw)) {
  console.error('  --voice must be "own" or "generic".');
  process.exit(2);
}
const voice: NarrationVoice = voiceRaw;

const VOICE_ID = voice === 'own' ? ownVoiceId() : genericVoiceId();

const db = await getDb();

try {
  /*
   * THE PROPOSAL FIRST, ALWAYS — INCLUDING FOR A DRY RUN.
   *
   * It costs nothing and it is the thing the owner asked to see before a credit is spent. A dry run stops
   * after this and writes the script to a file rather than to the database.
   */
  const actor = actorFlag
    ? await db.one<{ id: number }>(
        `select id from account where lower(email) = lower($1) or id::text = $1`,
        [actorFlag]
      )
    : null;
  if (actorFlag && !actor) {
    console.error(`  No account matches --actor=${actorFlag}.`);
    process.exit(2);
  }

  const proposal = await proposeNarration(db, {
    slug,
    voice,
    actorId: actor ? Number(actor.id) : null,
    note: 'Prepared from the command line.',
  });

  console.log(`  article      ${proposal.title}`);
  console.log(`  spoken words ${proposal.words.toLocaleString('en-GB')}   (about ${Math.floor(proposal.estimatedSeconds / 60)}m ${proposal.estimatedSeconds % 60}s)`);
  console.log(`  characters   ${proposal.characters.toLocaleString('en-GB')}`);
  console.log(`  estimated    ~${proposal.estimatedCredits.toLocaleString('en-GB')} credits`);
  console.log('  the article\'s own sentences, with markup and citation brackets removed — nothing rewritten');

  if (dryRun) {
    mkdirSync(join(process.cwd(), 'data', 'episodes'), { recursive: true });
    const out = join(process.cwd(), 'data', 'episodes', `${slug}.script.txt`);
    writeFileSync(out, proposal.script);
    console.log(`  dry run — the script was written to ${out}; only a costless proposal was recorded`);
    process.exit(0);
  }

  if (!approve) {
    console.log('');
    console.log('  NOT RENDERED. The proposal above is recorded and awaiting a decision, and NOTHING WAS SPENT.');
    console.log('  Approve it with:');
    console.log(`    node --env-file=.env.local scripts/prepare-episode.ts ${slug} --approve --actor=<your-email>`);
    console.log('  Or decline it at no cost:');
    console.log(`    node scripts/narration-review.ts decline ${slug} --actor=<your-email>`);
    process.exit(0);
  }

  if (!actor) {
    console.error('');
    console.error('  --actor=<email> is required with --approve. A render is attributed to a person.');
    console.error('  Nothing was rendered.');
    console.error('');
    process.exit(2);
  }
  /*
   * THE PERMISSION, NOT ONLY THE NAME.
   *
   * Before this line `--actor=` proved only that the account exists, so anybody who could run a shell command
   * could spend the owner's credits in the owner's cloned voice and the transition row would name whoever they
   * typed. The API's render route has always required `manage_ai_corpus`; this console is the other door to
   * the same charge and now asks the same question.
   */
  if (!(await can(db, Number(actor.id), 'manage_ai_corpus'))) {
    console.error('');
    console.error(`  ${actorFlag} does not hold “manage ai corpus”, which authorises a charge.`);
    console.error('  Nothing was sent. An administrator or the owner must approve the render.');
    console.error('');
    process.exit(2);
  }
  if (!configured() || !VOICE_ID) {
    console.error('');
    console.error('  NOT RENDERED — narration needs an ElevenLabs key and a chosen voice:');
    console.error(`    ELEVENLABS_API_KEY          ${configured() ? 'set' : 'MISSING'}`);
    console.error(`    ELEVENLABS_VOICE_ID_${voice.toUpperCase()}   ${VOICE_ID ? 'set' : 'MISSING'}`);
    console.error('  The proposal is recorded and nothing was spent.');
    console.error('');
    process.exit(2);
  }

  const result = await renderProposedNarration(db, {
    slug,
    actorId: Number(actor.id),
    voice,
    note: 'Approved from the command line.',
  });
  if (!result.ok) {
    console.error(`  RENDER FAILED (${result.code}) — ${result.message}`);
    console.error('  Nothing was published. The proposal is still recorded.');
    process.exit(1);
  }

  console.log('');
  console.log(`  episode ${result.episodeId} is PENDING REVIEW — nothing is in the feed until you approve it`);
  console.log(`  audio    ${result.audioUrl}  (${(result.bytes / 1024 / 1024).toFixed(1)} MB)`);
  console.log(
    `  charge   ${
      result.measuredCredits === null
        ? `estimate ~${result.estimatedCredits} credits; the allowance could not be re-read`
        : `${result.measuredCredits} credits measured (estimate ~${result.estimatedCredits})`
    }`
  );
  console.log(`  then     node scripts/narration-review.ts publish ${slug} --actor=<your-email>`);
} finally {
  await closeDb();
}
