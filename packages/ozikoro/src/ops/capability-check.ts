/**
 * Is every capability the code requires actually held by somebody?
 *
 * THE BUG THIS EXISTS TO CATCH
 *
 * In round 12 the byline claim path was built, wired to a screen, and unusable. `manage_contributors`
 * was required by the decision endpoint and held by **no role at all** — not an editor, not an
 * administrator. An author could request a byline, an editor could see it waiting, and nobody could
 * decide it. It would have sat pending forever.
 *
 * It was found by exercising the path with a real account and being refused, then asking the role
 * table why. That is luck, not a process: the capability matrix lives only in SQL migrations and in
 * the database, so nothing connected "this string is required by code" to "this string is granted to
 * anyone".
 *
 * So this reads the capability names OUT OF THE SOURCE — the arguments to `requireCapability` and
 * `hasCapability`, and the destination states in `TRANSITION_CAPABILITY` — and checks each against the
 * grants. A capability required and held by nobody fails the run.
 *
 * The list is discovered, not remembered, for the same reason the residue check discovers its tables:
 * a thing that has to be remembered will eventually not be.
 *
 * Run with: node src/ops/capability-check.ts
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, closeDb, type Db } from '@ozituma/db/client';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
const SOURCE_DIRS = ['apps/ozikoro/app', 'apps/ozikoro/lib', 'packages/ozikoro/src'];

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (
      /\.tsx?$/.test(entry.name) &&
      // Two naming conventions in this repository: `x.test.ts` and `test-x.ts`. Both are excluded,
      // and so is this file — its own doc comment contains an example call, and the first version
      // of this check dutifully reported the example as an ungranted capability.
      !entry.name.endsWith('.test.ts') &&
      !entry.name.startsWith('test-') &&
      entry.name !== 'capability-check.ts'
    ) {
      out.push(full);
    }
  }
  return out;
}

/** Every capability name the source requires, with where it was found. */
export async function requiredCapabilities(): Promise<Map<string, string[]>> {
  const found = new Map<string, string[]>();
  const add = (capability: string, where: string) => {
    if (!/^[a-z][a-z0-9_]*$/.test(capability)) return;
    if (!found.has(capability)) found.set(capability, []);
    found.get(capability)!.push(where);
  };

  for (const dir of SOURCE_DIRS) {
    for (const file of await walk(join(REPO_ROOT, dir))) {
      const text = await readFile(file, 'utf8');
      const shown = file.slice(REPO_ROOT.length + 1);

      // requireCapability('x', …) and requireCapabilityOrRedirect('x', …)
      for (const m of text.matchAll(/requireCapability(?:OrRedirect)?\(\s*'([a-z0-9_]+)'/g)) add(m[1]!, shown);
      // hasCapability(accountId, 'x')
      for (const m of text.matchAll(/hasCapability\([^,]+,\s*'([a-z0-9_]+)'/g)) add(m[1]!, shown);
      // The destination-state capability table: `state: 'capability',`
      if (shown.endsWith('ozikoro/src/publications.ts')) {
        for (const m of text.matchAll(/^\s{2}[a-z_]+:\s*'([a-z0-9_]+)',/gm)) add(m[1]!, shown);
      }
    }
  }
  return found;
}

export async function ungrantedCapabilities(db: Db): Promise<{ capability: string; where: string[] }[]> {
  const required = await requiredCapabilities();
  const granted = new Set(
    (await db.rows<{ capability: string }>(`select distinct capability from ozikoro_role_capability`))
      .map((r) => String(r.capability))
  );
  return [...required.entries()]
    .filter(([capability]) => !granted.has(capability))
    .map(([capability, where]) => ({ capability, where }));
}

if (process.argv[1] && process.argv[1].endsWith('capability-check.ts')) {
  const db = await getDb();
  const required = await requiredCapabilities();
  const missing = await ungrantedCapabilities(db);
  await closeDb();

  console.log(`\n  ${required.size} capabilities required by the source.`);
  if (missing.length === 0) {
    console.log('  Every one is held by at least one role.\n');
    process.exit(0);
  }

  console.error('\n  UNGRANTED CAPABILITIES — required by code, held by NOBODY.\n');
  for (const { capability, where } of missing) {
    console.error(`    ${capability}`);
    for (const w of [...new Set(where)].slice(0, 3)) console.error(`        required by ${w}`);
  }
  console.error(
    '\n  A capability held by no role is a feature no one can use — the round-12 bug, where the byline\n' +
      '  claim path could be started and never decided. Grant it in a migration.\n'
  );
  process.exit(1);
}
