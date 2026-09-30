/**
 * Contribution and review lifecycle test.
 *
 * Exercises the whole path a real contribution takes — sign up, submit, review,
 * publish, search — and asserts the things that would be security or data
 * problems if they broke:
 *
 *   - a contributor cannot review anything, least of all their own submission
 *   - a reviewed submission cannot be applied twice
 *   - approved content is attributed, so verify.ts is not satisfied by a lie
 *   - hostile input (bidi overrides, control characters) is refused
 *   - sessions stop working the moment they are revoked
 *
 * Creates its own accounts and submissions with a unique suffix, then removes
 * everything it created, so it is safe to run against a populated database.
 *
 *   npm -w @ozituma/db run test:contributions
 */
import { closeDb, getDb } from './client.ts';
import {
  AccountError,
  authenticateAccount,
  canReview,
  createSession,
  registerAccount,
  resolveSession,
  revokeSession,
  setAccountRole,
} from './accounts.ts';
import {
  ContributionError,
  getQueueStats,
  listSuggestions,
  reviewSuggestion,
  submitSuggestion,
} from './contributions.ts';
import { searchWords, getWord } from './repository.ts';
import {
  MAX_AUDIO_BYTES,
  StorageError,
  audioKey,
  getStorage,
  normaliseAudioType,
  verifyAudioSignature,
} from './storage.ts';

const db = await getDb();
let failures = 0;

function assert(label: string, condition: boolean, detail = ''): void {
  console.log(`  ${condition ? '✓' : '✗'} ${label}${detail ? `  — ${detail}` : ''}`);
  if (!condition) failures += 1;
}

/** Assert that an async call rejects with a specific domain error code. */
async function assertRejects(
  label: string,
  fn: () => Promise<unknown>,
  expectedCode: string
): Promise<void> {
  try {
    await fn();
    assert(label, false, 'expected it to be refused, but it succeeded');
  } catch (error) {
    const code =
      error instanceof ContributionError || error instanceof AccountError
        ? error.code
        : 'unexpected';
    assert(label, code === expectedCode, code === expectedCode ? code : `got "${code}"`);
  }
}

/**
 * Build a valid 16-bit PCM WAV.
 *
 * A real container rather than random bytes, because the whole point of the
 * signature check is that it accepts genuine audio and rejects everything else
 * — a test using arbitrary bytes would pass for the wrong reason.
 */
function makeWav(seconds: number): Buffer {
  const sampleRate = 8000;
  const samples = Math.floor(sampleRate * seconds);
  const dataSize = samples * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16); // PCM header size
  buffer.writeUInt16LE(1, 20); // format: PCM
  buffer.writeUInt16LE(1, 22); // channels: mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);

  // A quiet 440 Hz tone, so the file is audibly a recording rather than silence.
  for (let i = 0; i < samples; i += 1) {
    buffer.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 8000), 44 + i * 2);
  }
  return buffer;
}

const suffix = Date.now().toString(36);
const contributorEmail = `contributor-${suffix}@ozituma.test`;
const editorEmail = `editor-${suffix}@ozituma.test`;
const createdWordIds: number[] = [];
const createdSuggestionIds: number[] = [];
const createdAccountIds: number[] = [];
/**
 * Examples are tracked separately because deleting a `word` cascades away its
 * `example_word` link but leaves the `example` row behind — an orphan that no
 * page can reach. verify.ts flags those, which is how this was caught.
 */
const createdExampleIds: number[] = [];
/** Clans and names added by this run, removed on cleanup so the registry is left as it was. */
const createdClanIds: number[] = [];
const createdNameIds: number[] = [];
/** The existing corpus entry the merge test extends, needed by cleanup. */
let uloId: number | null = null;
/** Storage keys written by the audio section, removed from the bucket on cleanup. */
const createdAudioKeys: string[] = [];
/**
 * Orphaned examples present BEFORE this run.
 *
 * The assertion at the end must measure what this run left behind, not a global
 * invariant. The sentence corpus legitimately contains examples that no word in
 * the dictionary appears in — they are valid bilingual sentence pairs awaiting a
 * word — so "zero orphans" stopped being true and the check failed for a reason
 * unrelated to this test.
 */
let orphansAtStart: number | null = null;

async function main(): Promise<void> {
{
  const baseline = await db.one<{ n: number }>(
    `select count(*)::int as n from example e
      where not exists (select 1 from example_word ew where ew.example_id = e.id)`
  );
  orphansAtStart = Number(baseline?.n ?? 0);
}

console.log('\n--- Accounts: registration and password policy ---');

const contributor = await registerAccount(db, {
  email: contributorEmail,
  password: 'a-long-and-memorable-passphrase',
  displayName: 'Test Contributor',
});
createdAccountIds.push(contributor.id);
assert('account created as contributor', contributor.role === 'contributor', contributor.role);
assert('contributor cannot review', !canReview(contributor));

await assertRejects(
  'short password refused',
  () => registerAccount(db, { email: `weak-${suffix}@ozituma.test`, password: 'short' }),
  'weak_password'
);
await assertRejects(
  'password equal to email refused',
  () =>
    registerAccount(db, {
      email: `self-${suffix}@ozituma.test`,
      password: `self-${suffix}@ozituma.test`,
    }),
  'weak_password'
);
await assertRejects(
  'duplicate email refused',
  () =>
    registerAccount(db, {
      email: contributorEmail,
      password: 'another-long-passphrase',
    }),
  'email_taken'
);

console.log('\n--- Accounts: authentication ---');
const goodLogin = await authenticateAccount(db, contributorEmail, 'a-long-and-memorable-passphrase');
assert('correct password authenticates', goodLogin !== null);
assert('wrong password rejected', (await authenticateAccount(db, contributorEmail, 'wrong-password-here')) === null);
assert('unknown email rejected', (await authenticateAccount(db, `nobody-${suffix}@ozituma.test`, 'whatever-long')) === null);
assert('email match is case-insensitive', (await authenticateAccount(db, contributorEmail.toUpperCase(), 'a-long-and-memorable-passphrase')) !== null);

console.log('\n--- Accounts: sessions ---');
const session = await createSession(db, contributor.id, { userAgent: 'test-runner', ipAddress: '203.0.113.7' });
assert('session token issued', session.token.length > 20, `${session.token.length} chars`);

const resolved = await resolveSession(db, session.token);
assert('session resolves to the account', resolved?.account.id === contributor.id);
assert('session returns the right role', resolved?.account.role === 'contributor');
assert('unknown token does not resolve', (await resolveSession(db, 'not-a-real-token-but-long-enough')) === null);

const storedRow = await db.one<{ token_hash: string }>(
  `select token_hash from auth_session where account_id = $1`,
  [contributor.id]
);
assert('raw session token is not stored', storedRow?.token_hash !== session.token);

await revokeSession(db, session.token);
assert('revoked session stops resolving', (await resolveSession(db, session.token)) === null);

console.log('\n--- Contributions: submission validation ---');
const newWord = await submitSuggestion(db, contributor.id, {
  kind: 'new_word',
  language: 'ibo',
  payload: {
    headword: `nnwale-${suffix}`,
    definitions: ['a test entry created by the contribution test suite'],
    partOfSpeech: 'NNC',
    example: { text: `Nnwale ${suffix}`, translation: 'a test' },
  },
});
createdSuggestionIds.push(newWord.id);
assert('new_word submission accepted', newWord.status === 'pending', `id=${newWord.id}`);

await assertRejects(
  'identical pending submission refused',
  () =>
    submitSuggestion(db, contributor.id, {
      kind: 'new_word',
      language: 'ibo',
      payload: { headword: `nnwale-${suffix}`, definitions: ['duplicate attempt'] },
    }),
  'duplicate_submission'
);

await assertRejects(
  'empty definitions refused',
  () =>
    submitSuggestion(db, contributor.id, {
      kind: 'new_word',
      language: 'ibo',
      payload: { headword: `empty-${suffix}`, definitions: ['   '] },
    }),
  'invalid_submission'
);

await assertRejects(
  'unknown language refused',
  () =>
    submitSuggestion(db, contributor.id, {
      kind: 'new_word',
      language: 'zzz',
      payload: { headword: `bogus-${suffix}`, definitions: ['nope'] },
    }),
  'invalid_language'
);

// A right-to-left override would make the stored headword render as a different
// word in search results than the one actually recorded — a spoofing vector.
await assertRejects(
  'bidi override in a headword refused',
  () =>
    submitSuggestion(db, contributor.id, {
      kind: 'new_word',
      language: 'ibo',
      payload: { headword: `evil\u202egnihs-${suffix}`, definitions: ['spoof attempt'] },
    }),
  'invalid_submission'
);

await assertRejects(
  'control characters in a headword refused',
  () =>
    submitSuggestion(db, contributor.id, {
      kind: 'new_word',
      language: 'ibo',
      payload: { headword: `bad\u0007word-${suffix}`, definitions: ['control char'] },
    }),
  'invalid_submission'
);

// Kinds the schema recognises but with no review handler yet must be refused
// outright, rather than accepted into a queue nobody can act on.
// ('audio' used to be in this set; it is supported now and tested further down.)
for (const kind of ['new_example', 'edit_word', 'dialect'] as const) {
  await assertRejects(
    `unsupported submission kind "${kind}" refused`,
    () =>
      submitSuggestion(db, contributor.id, {
        kind,
        language: 'ibo',
        payload: { anything: true },
      }),
    'unsupported_kind'
  );
}

console.log('\n--- Contributions: the queue ---');
const pending = await listSuggestions(db, { status: 'pending' });
assert('pending queue includes the new submission', pending.data.some((s) => s.id === newWord.id));
assert('queue row carries the submitter name', Boolean(pending.data.find((s) => s.id === newWord.id)?.submittedByName));

const mine = await listSuggestions(db, { submittedBy: contributor.id });
assert('submissions are listable per contributor', mine.total >= 1, `${mine.total} total`);

const beforeStats = await getQueueStats(db);
assert('queue stats count contributors', beforeStats.contributors >= 1);

console.log('\n--- Review: role enforcement and self-review ---');
const editor = await registerAccount(db, {
  email: editorEmail,
  password: 'editor-passphrase-long-enough',
  displayName: 'Test Editor',
});
createdAccountIds.push(editor.id);
assert('new account is not an editor by default', !canReview(editor));

const promoted = await setAccountRole(db, editorEmail, 'editor');
assert('promotion to editor works', promoted?.role === 'editor', promoted?.role ?? '');
assert('promoted account can review', promoted ? canReview(promoted) : false);

// The contributor owns this submission, so approving it as themselves must fail.
await assertRejects(
  'self-review refused',
  () => reviewSuggestion(db, { suggestionId: newWord.id, reviewerId: contributor.id, decision: 'approve' }),
  'self_review'
);

console.log('\n--- Review: approval publishes the entry ---');
const approved = await reviewSuggestion(db, {
  suggestionId: newWord.id,
  reviewerId: editor.id,
  decision: 'approve',
  note: 'Verified against a speaker.',
});
assert('approval succeeded', approved.applied?.outcome === 'created', approved.applied?.detail ?? '');
assert('suggestion marked approved', approved.suggestion.status === 'approved', approved.suggestion.status);
assert('reviewer recorded', approved.suggestion.reviewedBy === editor.id);
assert('review note recorded', approved.suggestion.reviewNote === 'Verified against a speaker.');

const wordId = approved.applied?.wordId ?? null;
if (wordId) {
  createdWordIds.push(wordId);
  const linked = await db.rows<{ id: string }>(
    `select e.id from example e join example_word ew on ew.example_id = e.id where ew.word_id = $1`,
    [wordId]
  );
  for (const row of linked) createdExampleIds.push(Number(row.id));
}

const created = wordId ? await getWord(db, wordId, 'ibo') : null;
assert('approved entry exists in the dictionary', created !== null);
assert('entry has its definition', (created?.definitions.length ?? 0) >= 1);
assert(
  'entry is attributed to community contributions',
  created?.attribution?.sourceName === 'Ozituma community contributions',
  created?.attribution?.sourceName ?? 'no attribution'
);
assert('entry includes the supplied example', (created?.examples.length ?? 0) >= 1);

console.log('\n--- Review: the published entry is searchable ---');
const found = await searchWords(db, { query: `nnwale-${suffix}`, language: 'ibo', perPage: 5 });
assert('new entry is findable by search', found.total >= 1, `${found.total} result(s)`);
assert(
  'search returns the approved entry',
  found.data.some((row) => row.id === wordId),
  `top=${found.data[0]?.headword ?? 'none'}`
);

console.log('\n--- Review: a submission can only be applied once ---');
await assertRejects(
  'second approval refused',
  () => reviewSuggestion(db, { suggestionId: newWord.id, reviewerId: editor.id, decision: 'approve' }),
  'already_reviewed'
);

const wordCountAfter = await db.one<{ n: number }>(
  `select count(*)::int as n from word where language_code = 'ibo' and search_form = $1`,
  [`nnwale-${suffix}`.toLowerCase()]
);
assert('approval created exactly one entry', Number(wordCountAfter?.n ?? 0) === 1, `${wordCountAfter?.n} rows`);

/*
 * An editor's own work does not wait for an administrator.
 *
 * The owner: "editors should not need admin approval to publish anything. they can also review what
 * other contributors added." An editor reviewing a contributor is checked above; this checks the
 * other half — that an editor submitting something themselves gets it published on the spot rather
 * than sitting in the queue for somebody with a bigger badge.
 */
console.log('\n--- Review: an editor publishes without asking anyone ---');
const editorOwn = await submitSuggestion(db, editor.id, {
  kind: 'new_proverb',
  language: 'ibo',
  targetWordId: null,
  payload: { text: `Ilu ndezi ${suffix}`, translation: null },
});
createdSuggestionIds.push(editorOwn.id);
assert(
  "an editor's own submission is applied at once",
  editorOwn.status === 'approved',
  editorOwn.status
);
const editorProverb = await db.one<{ id: string }>(
  `select id from example where language_code = 'ibo' and text = $1`,
  [`Ilu ndezi ${suffix}`]
);
assert("the editor's proverb was published", editorProverb !== null);
if (editorProverb) createdExampleIds.push(Number(editorProverb.id));

console.log('\n--- Review: merging into an existing entry ---');
// "ụlọ" already exists in the corpus. Adding a sense should attach to it rather
// than create a near-duplicate entry.
const mergeSubmission = await submitSuggestion(db, contributor.id, {
  kind: 'new_definition',
  language: 'ibo',
  payload: { headword: 'ụlọ', definitions: [`a sense contributed by the test suite ${suffix}`] },
});
createdSuggestionIds.push(mergeSubmission.id);

// Resolve the merge target by exact headword, the same way the review code does.
// Searching for "ụlọ" is ambiguous on purpose — "ùlò" and "ụlō" fold to the same
// key — so a test that picked data[0] would be asserting against whichever tone
// happened to sort first.
const uloRow = await db.one<{ id: string }>(
  `select id from word where language_code = 'ibo' and headword = 'ụlọ'`
);
uloId = uloRow ? Number(uloRow.id) : null;
assert('the reference entry ụlọ exists in the corpus', uloId !== null);
const definitionsBefore = uloId
  ? Number((await db.one<{ n: number }>(`select count(*)::int as n from definition where word_id = $1`, [uloId]))?.n ?? 0)
  : 0;

const merged = await reviewSuggestion(db, {
  suggestionId: mergeSubmission.id,
  reviewerId: editor.id,
  decision: 'approve',
});
assert('merge reported as merged', merged.applied?.outcome === 'merged', merged.applied?.detail ?? '');
assert('merge recorded as merged status', merged.suggestion.status === 'merged', merged.suggestion.status);

const definitionsAfter = uloId
  ? Number((await db.one<{ n: number }>(`select count(*)::int as n from definition where word_id = $1`, [uloId]))?.n ?? 0)
  : 0;
assert(
  'merge added a definition to the existing entry',
  definitionsAfter === definitionsBefore + 1,
  `${definitionsBefore} -> ${definitionsAfter}`
);

const uloWordCount = await db.one<{ n: number }>(
  `select count(*)::int as n from word where language_code = 'ibo' and headword = 'ụlọ'`
);
assert('merge did not create a duplicate entry', Number(uloWordCount?.n ?? 0) === 1, `${uloWordCount?.n} rows`);

console.log('\n--- Review: rejection ---');
const rejectSubmission = await submitSuggestion(db, contributor.id, {
  kind: 'new_word',
  language: 'ibo',
  payload: { headword: `tojuru-${suffix}`, definitions: ['this will be rejected'] },
});
createdSuggestionIds.push(rejectSubmission.id);

const rejected = await reviewSuggestion(db, {
  suggestionId: rejectSubmission.id,
  reviewerId: editor.id,
  decision: 'reject',
  note: 'Not a word we can verify.',
});
assert('rejection recorded', rejected.suggestion.status === 'rejected', rejected.suggestion.status);
assert('rejection has no applied change', rejected.applied === null);

const rejectedWord = await db.one<{ id: string }>(
  `select id from word where language_code = 'ibo' and headword = $1`,
  [`tojuru-${suffix}`]
);
assert('rejected submission did not create an entry', rejectedWord === null);

await assertRejects(
  'a rejected submission cannot later be approved',
  () => reviewSuggestion(db, { suggestionId: rejectSubmission.id, reviewerId: editor.id, decision: 'approve' }),
  'already_reviewed'
);

// ---------------------------------------------------------------------------
// Audio: storage, validation, and publication through the same queue.
// ---------------------------------------------------------------------------
console.log('\n--- Audio: storage validation ---');

const storage = getStorage();
const wav = makeWav(0.25);
assert('storage driver selected', storage.driver === 'local' || storage.driver === 's3', storage.driver);
assert('a synthetic WAV was built', wav.length > 44, `${wav.length} bytes`);

// The security case: a file declared as audio but containing something else.
// These bytes are served back to browsers from our own origin, so accepting
// them would be a stored-XSS vector.
const htmlBytes = Buffer.from('<html><script>alert(1)</script></html>', 'utf8');
try {
  verifyAudioSignature(htmlBytes, 'audio/wav');
  assert('HTML disguised as audio is rejected', false, 'it was accepted');
} catch (error) {
  assert(
    'HTML disguised as audio is rejected',
    error instanceof StorageError && error.code === 'content_type_mismatch',
    error instanceof Error ? error.message : ''
  );
}

try {
  verifyAudioSignature(Buffer.alloc(0), 'audio/wav');
  assert('empty file rejected', false, 'it was accepted');
} catch (error) {
  assert('empty file rejected', error instanceof StorageError && error.code === 'empty_file');
}

try {
  normaliseAudioType('video/mp4');
  assert('non-audio content type rejected', false, 'it was accepted');
} catch (error) {
  assert(
    'non-audio content type rejected',
    error instanceof StorageError && error.code === 'unsupported_audio_type'
  );
}

assert(
  'WAV alias normalises to a known type',
  normaliseAudioType('audio/x-wav; codecs=1') === 'audio/wav',
  normaliseAudioType('audio/x-wav')
);

// A key that escapes the media root must not be readable or writable.
const traversalKey = '../../../etc/passwd';
assert('path traversal yields nothing', (await storage.get(traversalKey)) === null);
try {
  await storage.put(traversalKey, wav, 'audio/wav');
  assert('path traversal on write rejected', false, 'it was accepted');
} catch (error) {
  assert(
    'path traversal on write rejected',
    error instanceof StorageError && error.code === 'invalid_key'
  );
}

console.log('\n--- Audio: recording submitted and published ---');
assert('a corpus entry is available to pronounce', uloId !== null);

const audioKeyValue = audioKey('ibo', uloId!, 'audio/wav');
const stored = await storage.put(audioKeyValue, wav, 'audio/wav');
createdAudioKeys.push(stored.key);
assert('recording stored', stored.byteSize === wav.length, `${stored.byteSize} bytes`);
assert('stored object is retrievable', (await storage.get(stored.key))?.body.length === wav.length);

const audioSubmission = await submitSuggestion(db, contributor.id, {
  kind: 'audio',
  language: 'ibo',
  targetWordId: uloId,
  payload: {
    storageKey: stored.key,
    mimeType: 'audio/wav',
    byteSize: stored.byteSize,
    durationMs: 250,
    dialectCode: 'ONI',
    provenanceNote: `Recorded by the test suite ${suffix}.`,
  },
});
createdSuggestionIds.push(audioSubmission.id);
assert('audio submission accepted', audioSubmission.status === 'pending', `id=${audioSubmission.id}`);

await assertRejects(
  'audio without a target word refused',
  () =>
    submitSuggestion(db, contributor.id, {
      kind: 'audio',
      language: 'ibo',
      payload: { storageKey: stored.key, mimeType: 'audio/wav', byteSize: stored.byteSize },
    }),
  'invalid_submission'
);

await assertRejects(
  'oversized audio refused',
  () =>
    submitSuggestion(db, contributor.id, {
      kind: 'audio',
      language: 'ibo',
      targetWordId: uloId,
      payload: {
        storageKey: `${stored.key}-big`,
        mimeType: 'audio/wav',
        byteSize: MAX_AUDIO_BYTES + 1,
      },
    }),
  'invalid_submission'
);

// Nothing is public before review.
const audioBeforeReview = await getWord(db, uloId!, 'ibo');
assert(
  'recording is not public before review',
  !audioBeforeReview?.audio.some((clip) => clip.url.includes(stored.key)),
  `${audioBeforeReview?.audio.length ?? 0} public clip(s)`
);

const audioApproved = await reviewSuggestion(db, {
  suggestionId: audioSubmission.id,
  reviewerId: editor.id,
  decision: 'approve',
  note: 'Clear recording.',
});
assert('audio approval published the recording', audioApproved.applied?.outcome === 'approved', audioApproved.applied?.detail ?? '');

const audioAfterReview = await getWord(db, uloId!, 'ibo');
const publishedClip = audioAfterReview?.audio.find((clip) => clip.url.includes(stored.key));
assert('published recording appears on the entry', Boolean(publishedClip));
assert('recording carries its dialect', publishedClip?.dialect === 'Ọnịcha', publishedClip?.dialect ?? 'none');
assert(
  'recording is credited to the speaker',
  publishedClip?.speaker === 'Test Contributor',
  publishedClip?.speaker ?? 'nobody'
);

// The URL must actually serve the bytes we stored.
if (publishedClip) {
  const served = await storage.get(stored.key);
  assert('the published URL resolves to real bytes', served?.body.length === wav.length);
}

/*
 * The three additions, which are not words.
 *
 * The owner asked for them in one sentence — "there should be an option for contributors to add new
 * words, clans, names, or proverbs" — and each reaches a different table by a different road, so
 * each is exercised here rather than assumed to work because the branch compiles. What is checked
 * is what would be a data problem if it broke: the row lands in the right table, it is published
 * with something in every field that was filled, and an entry that says nothing about itself never
 * reaches a reviewer at all.
 */
console.log('\n--- Contributions: a clan, a name and a proverb ---');

const clanName = `Nkata ${suffix}`;
const clanSubmission = await submitSuggestion(db, contributor.id, {
  kind: 'new_clan',
  targetWordId: null,
  payload: {
    name: clanName,
    kind: 'clan',
    division: 'Southern Igbo',
    origin: `A test clan recorded by the suite, ${suffix}.`,
    description: [`First paragraph for ${suffix}.`, `Second paragraph for ${suffix}.`],
    states: ['Abia'],
    lgas: ['Test Local Government'],
    towns: [`Town One ${suffix}`, `Town Two ${suffix}`],
  },
});
createdSuggestionIds.push(clanSubmission.id);
assert('a clan can be submitted', clanSubmission.status === 'pending', clanSubmission.status);

await assertRejects(
  'a clan with nothing said about it is refused',
  () =>
    submitSuggestion(db, contributor.id, {
      kind: 'new_clan',
      targetWordId: null,
      payload: { name: `Empty ${suffix}`, description: [], states: [], lgas: [], towns: [] },
    }),
  'invalid_submission'
);

await assertRejects(
  'an entry kind the registry does not hold is refused',
  () =>
    submitSuggestion(db, contributor.id, {
      kind: 'new_clan',
      targetWordId: null,
      payload: { name: `Odd ${suffix}`, kind: 'duchy', origin: 'x', description: [] },
    }),
  'invalid_submission'
);

const clanApproved = await reviewSuggestion(db, {
  suggestionId: clanSubmission.id,
  reviewerId: editor.id,
  decision: 'approve',
});
assert(
  'clan approval created the entry',
  clanApproved.applied?.outcome === 'created',
  clanApproved.applied?.detail ?? ''
);

const clanRow = await db.one<{ id: string; slug: string; published: boolean; states: string[] }>(
  `select id, slug, published, states from clan where lower(name) = lower($1)`,
  [clanName]
);
assert('the clan is in the registry', clanRow !== null);
if (clanRow) createdClanIds.push(Number(clanRow.id));
assert('a contributed clan is published', clanRow?.published === true);
assert('the clan carries the state it was given', clanRow?.states?.[0] === 'Abia', clanRow?.states?.join(', ') ?? 'none');

const clanTownRows = clanRow
  ? await db.rows<{ name: string }>(`select name from clan_town where clan_id = $1`, [clanRow.id])
  : [];
assert('the clan carries its towns', clanTownRows.length === 2, `${clanTownRows.length} town(s)`);

const nameValue = `Chinwete${suffix}`;
const nameSubmission = await submitSuggestion(db, contributor.id, {
  kind: 'new_name',
  language: 'ibo',
  targetWordId: null,
  payload: {
    name: nameValue,
    meaning: `test meaning ${suffix}`,
    gender: 'unisex',
    variants: [`Chin${suffix}`],
    origins: [`Town One ${suffix}`],
  },
});
createdSuggestionIds.push(nameSubmission.id);

await assertRejects(
  'a gender outside the three words is refused',
  () =>
    submitSuggestion(db, contributor.id, {
      kind: 'new_name',
      language: 'ibo',
      targetWordId: null,
      payload: { name: `Bad${suffix}`, gender: 'sometimes', variants: [], origins: [] },
    }),
  'invalid_submission'
);

const nameApproved = await reviewSuggestion(db, {
  suggestionId: nameSubmission.id,
  reviewerId: editor.id,
  decision: 'approve',
});
assert(
  'name approval created the entry',
  nameApproved.applied?.outcome === 'created',
  nameApproved.applied?.detail ?? ''
);

const nameRow = await db.one<{ id: string; slug: string; gender_basis: string; origins: string[] }>(
  `select id, slug, gender_basis, origins from person_name where language_code = 'ibo' and name = $1`,
  [nameValue]
);
assert('the name is in the dictionary', nameRow !== null);
if (nameRow) createdNameIds.push(Number(nameRow.id));
assert('the name carries the place it is borne', nameRow?.origins?.[0] === `Town One ${suffix}`, nameRow?.origins?.join(', ') ?? 'none');

/*
 * The proverb, and the duplicate guard with it.
 *
 * The old duplicate index read only `payload ->> 'headword'`, which a proverb does not have, so the
 * expression folded to the empty string and two identical pending submissions were both let
 * through. Resubmitting the same proverb while the first is still pending is the exact case, and it
 * now has to be refused.
 */
const proverbText = `Ilu nnwale ${suffix}`;
const proverbSubmission = await submitSuggestion(db, contributor.id, {
  kind: 'new_proverb',
  language: 'ibo',
  targetWordId: null,
  payload: { text: proverbText, translation: `A test proverb recorded by the suite, ${suffix}.` },
});
createdSuggestionIds.push(proverbSubmission.id);

await assertRejects(
  'the same proverb submitted twice is refused',
  () =>
    submitSuggestion(db, contributor.id, {
      kind: 'new_proverb',
      language: 'ibo',
      targetWordId: null,
      payload: { text: proverbText, translation: null },
    }),
  'duplicate_submission'
);

const proverbApproved = await reviewSuggestion(db, {
  suggestionId: proverbSubmission.id,
  reviewerId: editor.id,
  decision: 'approve',
});
assert(
  'proverb approval created the entry',
  proverbApproved.applied?.outcome === 'created',
  proverbApproved.applied?.detail ?? ''
);

const proverbRow = await db.one<{ id: string; translation: string | null; style: string | null }>(
  `select id, translation, style from example where language_code = 'ibo' and text = $1`,
  [proverbText]
);
assert('the proverb is in the collection', proverbRow !== null);
assert('it is stored as a proverb', proverbRow?.style === 'proverb', proverbRow?.style ?? 'none');
assert(
  'its English was kept',
  proverbRow?.translation === `A test proverb recorded by the suite, ${suffix}.`,
  proverbRow?.translation ?? 'none'
);
if (proverbRow) createdExampleIds.push(Number(proverbRow.id));
}

/**
 * Remove everything this run created.
 *
 * Lives in its own function and runs from a `finally`, because an earlier
 * version cleaned up only on the success path — a mid-run SQL error left test
 * accounts and orphaned examples in the database, which then showed up as a
 * verify.ts failure attributed to the wrong cause.
 */
async function cleanup(): Promise<void> {
  console.log('\n--- Cleanup ---');

  // Audio rows and their stored objects. The rows are deleted explicitly
  // rather than relying on the word cascade, so a recording attached to a word
  // that is NOT deleted still gets cleaned up.
  if (createdAudioKeys.length > 0) {
    await db.query(`delete from audio where storage_key = any($1::text[])`, [createdAudioKeys]);
    const storageForCleanup = getStorage();
    for (const key of createdAudioKeys) await storageForCleanup.remove(key);
    const leftoverObjects = await Promise.all(
      createdAudioKeys.map((key) => storageForCleanup.get(key))
    );
    assert(
      'stored recordings removed',
      leftoverObjects.every((object) => object === null),
      `${leftoverObjects.filter(Boolean).length} left`
    );
  }

  // Examples first: deleting a word removes its link, which would orphan these.
  for (const id of createdExampleIds) {
    await db.query(`delete from example where id = $1`, [id]);
  }
  for (const id of createdSuggestionIds) {
    await db.query(`delete from suggestion where id = $1`, [id]);
  }
  for (const id of createdClanIds) {
    // The towns go with it: `clan_town` cascades from `clan`.
    await db.query(`delete from clan where id = $1`, [id]);
  }
  for (const id of createdNameIds) {
    await db.query(`delete from person_name where id = $1`, [id]);
  }
  for (const id of createdWordIds) {
    await db.query(`delete from word where id = $1`, [id]);
  }
  // Remove the merged test definition so the corpus returns to its imported state.
  if (uloId !== null) {
    await db.query(`delete from definition where word_id = $1 and text like $2`, [
      uloId,
      `%test suite ${suffix}%`,
    ]);
  }
  for (const id of createdAccountIds) {
    await db.query(`delete from account where id = $1`, [id]);
  }

  const leftovers = await db.one<{ n: number }>(
    `select count(*)::int as n from account where email like $1`,
    [`%-${suffix}@ozituma.test`]
  );
  assert('test accounts removed', Number(leftovers?.n ?? 0) === 0, `${leftovers?.n} left`);

  const leftoverWords = await db.one<{ n: number }>(
    `select count(*)::int as n from word where headword like $1 or headword like $2`,
    [`%${suffix}%`, `%${suffix.toUpperCase()}%`]
  );
  assert('test entries removed', Number(leftoverWords?.n ?? 0) === 0, `${leftoverWords?.n} left`);

  const leftoverClans = await db.one<{ n: number }>(
    `select count(*)::int as n from clan where name like $1`,
    [`%${suffix}%`]
  );
  assert('test clans removed', Number(leftoverClans?.n ?? 0) === 0, `${leftoverClans?.n} left`);

  const leftoverNames = await db.one<{ n: number }>(
    `select count(*)::int as n from person_name where name like $1`,
    [`%${suffix}%`]
  );
  assert('test names removed', Number(leftoverNames?.n ?? 0) === 0, `${leftoverNames?.n} left`);

  // This is the assertion that would have caught the orphaned-example bug at
  // the source instead of in verify.ts.
  const orphans = await db.one<{ n: number }>(
    `select count(*)::int as n from example e
      where not exists (select 1 from example_word ew where ew.example_id = e.id)`
  );
  const orphanCount = Number(orphans?.n ?? 0);
  assert(
    'this run left no orphaned examples behind',
    orphanCount === (orphansAtStart ?? 0),
    `baseline ${orphansAtStart}, now ${orphanCount}`
  );
}

try {
  await main();
} catch (error) {
  failures += 1;
  console.error('\n  ! test run aborted:', error instanceof Error ? error.message : error);
} finally {
  // Cleanup must run even when the body threw, or a failing run pollutes the
  // database and the next run's failures look like something else.
  await cleanup();
}

console.log(
  `\n${failures === 0 ? 'ALL CONTRIBUTION CHECKS PASSED' : `${failures} CONTRIBUTION CHECKS FAILED`}\n`
);
process.exitCode = failures === 0 ? 0 : 1;
await closeDb();
