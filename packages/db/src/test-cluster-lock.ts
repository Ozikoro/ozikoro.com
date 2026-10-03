/**
 * The cluster guard, tested as a guard and not as a happy path.
 *
 * WHAT THESE CHECKS ARE FOR
 *
 * `packages/db/src/cluster-lock.ts` exists because seven PGlite clusters in this checkout were
 * destroyed in one day by two processes opening the same directory. A guard is only worth having if
 * it is proven to (a) stop the second process, (b) let the second process in once the first has
 * gone, and (c) reclaim a lock whose owner is dead **without anybody running a command** — because
 * a guard that needs a manual `rm` after every crash is a guard people learn to delete.
 *
 * So every check below is run against REAL SEPARATE PROCESSES. A test that takes and releases the
 * lock inside one process would prove nothing at all: the whole failure being defended against is
 * two processes, and the atomicity being relied on is the kernel's, not this module's.
 *
 * THE FOUR CASES
 *
 *   1. refusal      — a holder runs, a second process tries, and is refused with exit 1 and a
 *                     message that names the holder, says contention and not corruption, and gives
 *                     the exact release command.
 *   2. release      — the holder leaves, by SIGTERM and by ordinary exit, and the next process
 *                     acquires without anybody deleting anything.
 *   3. stale, dead  — a lock file naming a dead PID is reclaimed.
 *   4. stale, alive — a lock file naming a LIVE PID with the wrong start time is reclaimed. This is
 *                     the PID-reuse case, and it is why liveness alone is not the test. It is
 *                     written to pass on a machine with `ps` (start times differ) and on a machine
 *                     without it (no descriptor is held open), which are the two ways the module
 *                     can reach the same verdict.
 *
 * Plus the two properties that make the rest safe: a lock held by a living process with a correct
 * record is NOT reclaimed, and the lock file is the cluster's SIBLING rather than a file inside the
 * cluster directory — the file that a restore would carry away.
 *
 * Nothing here opens a database. The guard is exercised on its own, in a scratch directory.
 *
 * Run with: npm -w @ozituma/db run test:cluster-lock
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { acquireClusterLock, inspectLock, lockPathFor, pidAlive, ClusterLockHeldError, type LockRecord } from './cluster-lock.ts';

let failures = 0;

function assert(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`);
    return;
  }
  failures += 1;
  console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
}

const HERE = dirname(fileURLToPath(import.meta.url));
const LOCK_MODULE = pathToFileURL(join(HERE, 'cluster-lock.ts')).href;

const root = mkdtempSync(join(tmpdir(), 'ozituma-lock-test-'));
const clusterDir = join(root, 'pg');
const lockPath = lockPathFor(clusterDir);

/* ---------------------------------------------------------------------------
 * The child program.
 *
 * It is a separate process because that is the only way to test a lock. `hold`
 * stays alive with the descriptor open; `exit` releases through the ordinary
 * exit path; `clean` takes and gives the lock back in one go.
 */
const CHILD = `
const [lockModule, dataDir, mode, exitCode] = process.argv.slice(1);
const m = await import(lockModule);
const lock = m.acquireClusterLock(dataDir);
process.stdout.write('ACQUIRED ' + JSON.stringify(lock.record) + '\\n');
if (mode === 'hold') {
  setInterval(() => {}, 1000);
} else if (mode === 'exit') {
  process.exit(Number(exitCode ?? 0));
} else {
  lock.release();
  process.stdout.write('RELEASED\\n');
}
`;

function childArgs(dataDir: string, mode: string, exitCode = '0'): string[] {
  return ['--input-type=module', '-e', CHILD, LOCK_MODULE, dataDir, mode, exitCode];
}

/** Run a child to completion. Returns its status, stdout and stderr. */
function runChild(dataDir: string, mode: string, exitCode = '0'): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, childArgs(dataDir, mode, exitCode), {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const failure = error as { status?: number | null; stdout?: string; stderr?: string };
    return { status: failure.status ?? -1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
}

/** Start a child that holds the lock, and resolve once it has said so. */
function startHolder(dataDir: string, mode = 'hold'): Promise<{ child: ChildProcess; stdout: string; record: LockRecord }> {
  return new Promise((resolveHolder, rejectHolder) => {
    const child = spawn(process.execPath, childArgs(dataDir, mode), { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => rejectHolder(new Error(`holder did not acquire within 15s: ${stderr}`)), 15_000);
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      const line = stdout.split('\n').find((l) => l.startsWith('ACQUIRED '));
      if (!line) return;
      clearTimeout(timer);
      try {
        resolveHolder({ child, stdout, record: JSON.parse(line.slice('ACQUIRED '.length)) as LockRecord });
      } catch (error) {
        rejectHolder(error as Error);
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      rejectHolder(error);
    });
  });
}

function waitForExit(child: ChildProcess): Promise<number | null> {
  return new Promise((resolveExit) => {
    if (child.exitCode !== null) {
      resolveExit(child.exitCode);
      return;
    }
    child.on('exit', (code) => resolveExit(code));
  });
}

console.log(`\n  cluster guard — scratch ${root}\n`);

/* ---------------------------------------------------------------------------
 * 0. The lock lives BESIDE the cluster, never inside it.
 *
 * This is the design decision the whole recovery story rests on: the documented
 * way out of a damaged cluster is to move the directory aside, and a lock inside
 * it would be moved aside with it.
 */
try {
  assert('the lock file is the cluster directory\'s sibling', lockPath === `${clusterDir}.lock`, lockPath);
  assert('the lock is not inside the cluster directory', dirname(lockPath) === root && !lockPath.startsWith(`${clusterDir}/`));

  /* -------------------------------------------------------------------------
   * 1. A living holder refuses a second process.
   */
  const holder = await startHolder(clusterDir);
  assert(
    'the holder wrote its own identity into the lock',
    holder.record.pid > 0 && holder.record.processStartTime.length > 0 && holder.record.startedAt.length > 0,
    `pid ${holder.record.pid}, started ${holder.record.processStartTime}`
  );
  assert('the holder recorded its command line', Array.isArray(holder.record.argv) && holder.record.argv.length > 0);

  const onDisk = JSON.parse(readFileSync(lockPath, 'utf8')) as LockRecord;
  assert('and the file on disk is that record', onDisk.pid === holder.record.pid && onDisk.token === holder.record.token);

  assert('no lock file was created inside the cluster directory', !existsSync(join(clusterDir, 'pg.lock')));

  const refused = runChild(clusterDir, 'clean');
  assert('a second process is refused with a non-zero exit', refused.status === 1, `exit ${refused.status}`);
  assert(
    'and is told the sentence that separates contention from corruption',
    refused.stderr.includes('PGlite is single-process; starting a second one corrupts the cluster'),
  );
  assert('and is told this is not corruption', refused.stderr.includes('This is contention, not corruption.'));
  assert('and is given the holder\'s pid', refused.stderr.includes(`holder pid    ${holder.record.pid}`), `expected pid ${holder.record.pid}`);
  assert('and is given the holder\'s start time', refused.stderr.includes(holder.record.processStartTime));
  assert('and is given the exact release command', refused.stderr.includes(`rm -f '${lockPath}'`), `expected rm -f '${lockPath}'`);
  // The parent's report: a restore once left a stale `*.lock.out` that stalled an import for
  // fifteen minutes because nobody knew WHICH file to remove. The path, not the word "lock".
  assert('and the release command prints the path, not just the word lock', refused.stderr.includes(lockPath) && /rm -f '/.test(refused.stderr));
  assert('and the refusal warns against SIGKILL and names postmaster.pid', refused.stderr.includes('Do NOT kill the holder with -9') && refused.stderr.includes('postmaster.pid'));
  assert('the refusal explains why the holder is believed alive', /believed live \S/.test(refused.stderr));
  assert('the refused process did not touch the lock', (JSON.parse(readFileSync(lockPath, 'utf8')) as LockRecord).token === holder.record.token);

  /* -------------------------------------------------------------------------
   * 2a. The holder leaves by SIGTERM, and the next process gets in — with
   *     nobody running a command.
   */
  holder.child.kill('SIGTERM');
  const holderCode = await waitForExit(holder.child);
  assert('the holder left on SIGTERM', holderCode !== null, `exit ${holderCode}`);
  assert('and released the lock as it left', !existsSync(lockPath), existsSync(lockPath) ? 'the lock file is still there' : '');

  const afterSignal = runChild(clusterDir, 'clean');
  assert('a later process acquires the lock without any manual release', afterSignal.status === 0, `exit ${afterSignal.status} ${afterSignal.stderr.slice(0, 120)}`);
  assert('and releases it on the way out', !existsSync(lockPath));

  /* -------------------------------------------------------------------------
   * 2b. The same, through the ordinary exit path.
   */
  const exiting = await startHolder(clusterDir, 'exit');
  await waitForExit(exiting.child);
  assert('an ordinary exit also releases the lock', !existsSync(lockPath));
  const afterExit = runChild(clusterDir, 'clean');
  assert('and the next process acquires it', afterExit.status === 0, `exit ${afterExit.status}`);

  /* -------------------------------------------------------------------------
   * 3. THE STALE LOCK NAMING A DEAD PID.
   *
   * The PID comes from a real process that has really exited, so the test
   * cannot pass by accident against a PID that was never alive.
   */
  const corpse = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' });
  const deadPid = corpse.pid ?? 0;
  await waitForExit(corpse);
  assert('a dead PID was obtained for the stale-lock case', deadPid > 0 && !pidAlive(deadPid), `pid ${deadPid}`);

  writeFileSync(
    lockPath,
    `${JSON.stringify({ pid: deadPid, processStartTime: new Date(Date.now() - 3_600_000).toISOString(), startedAt: new Date(Date.now() - 3_600_000).toISOString(), argv: ['node', 'a-process-that-died.js'], token: 'deadbeefdeadbeef' }, null, 2)}\n`
  );
  const deadVerdict = inspectLock(lockPath);
  assert('a lock naming a dead PID is judged stale', deadVerdict.stale, deadVerdict.reason);
  assert('and the verdict says the PID is gone', deadVerdict.basis === 'pid-dead', deadVerdict.basis);

  const reclaimed = runChild(clusterDir, 'clean');
  assert('and the next process reclaims it and starts', reclaimed.status === 0, `exit ${reclaimed.status} ${reclaimed.stderr.slice(0, 120)}`);
  assert('with no manual release', !existsSync(lockPath) || (JSON.parse(readFileSync(lockPath, 'utf8')) as LockRecord).token !== 'deadbeefdeadbeef');

  /* -------------------------------------------------------------------------
   * 4. THE STALE LOCK NAMING A LIVE PID — the PID-reuse case.
   *
   * The record names a process that really is running (this test process) but
   * with a start time from 2001 that no live process can have. Two independent
   * signals can expose it: the start time differs where the machine can report
   * one, and the lock file is not held open by anybody because this test wrote
   * it with a plain write rather than by acquiring it.
   */
  writeFileSync(
    lockPath,
    `${JSON.stringify({ pid: process.pid, processStartTime: '2001-01-01T00:00:00.000Z', startedAt: '2001-01-01T00:00:00.000Z', argv: ['node', 'a-pid-that-was-reused.js'], token: 'feedfacefeedface' }, null, 2)}\n`
  );
  const reusedVerdict = inspectLock(lockPath);
  assert('a lock naming a live PID with the wrong start time is judged stale', reusedVerdict.stale, reusedVerdict.reason);
  assert(
    'and the verdict is reached either by start time or by the absent descriptor',
    reusedVerdict.basis === 'start-time-differs' || reusedVerdict.basis === 'descriptor-free',
    reusedVerdict.basis
  );

  const afterReuse = runChild(clusterDir, 'clean');
  assert('and a real process reclaims it', afterReuse.status === 0, `exit ${afterReuse.status} ${afterReuse.stderr.slice(0, 200)}`);

  /* -------------------------------------------------------------------------
   * 5. THE GUARD DOES NOT OVER-RECLAIM.
   *
   * A lock held by a living process, with a correct record, must survive an
   * inspection — otherwise the "self-healing" above would just be a guard that
   * always says yes.
   */
  const own = acquireClusterLock(clusterDir);
  const liveVerdict = inspectLock(lockPath);
  assert('a lock held by a living process is NOT stale', !liveVerdict.stale, liveVerdict.reason);
  assert('and is judged live on the evidence that it is', liveVerdict.basis === 'live', liveVerdict.basis);
  assert('and the record on disk is ours', (JSON.parse(readFileSync(lockPath, 'utf8')) as LockRecord).pid === process.pid);

  const refusedAgain = runChild(clusterDir, 'clean');
  assert('and a second process is still refused while it is held', refusedAgain.status === 1);

  /* -------------------------------------------------------------------------
   * 5b. THE POSITIVE TEST, IN THE PARENT PROCESS.
   *
   * The refusal is observed here rather than in a child: the parent tries to
   * acquire a lock a child holds, must be refused naming that child's PID, and
   * must then succeed once the child is gone. This is the check that proves the
   * guard works from the inside, which is where the server and the scripts call
   * it from.
   */
  own.release();
  const parentCase = await startHolder(clusterDir);
  let parentError: ClusterLockHeldError | null = null;
  try {
    acquireClusterLock(clusterDir, { onRefusal: 'throw' });
  } catch (error) {
    parentError = error as ClusterLockHeldError;
  }
  assert('the parent process is refused while a child holds the lock', parentError instanceof ClusterLockHeldError);
  assert(
    'and the refusal names the holder\'s PID',
    Boolean(parentError?.report.includes(`holder pid    ${parentCase.record.pid}`)),
    `expected pid ${parentCase.record.pid}`
  );
  assert('and carries the whole operator message', Boolean(parentError?.report.includes(`rm -f '${lockPath}'`)));

  parentCase.child.kill('SIGTERM');
  await waitForExit(parentCase.child);
  const parentAfter = acquireClusterLock(clusterDir, { onRefusal: 'throw' });
  assert('and the parent acquires it once the child is gone', parentAfter.record.pid === process.pid);
  parentAfter.release();

  /* -------------------------------------------------------------------------
   * 5c. Opening the same cluster twice in ONE process is refused too, with its
   *     own reason — "another process holds it" would be a lie and would send
   *     somebody looking for a process that does not exist.
   */
  const first = acquireClusterLock(clusterDir, { onRefusal: 'throw' });
  let twiceError: ClusterLockHeldError | null = null;
  try {
    acquireClusterLock(clusterDir, { onRefusal: 'throw' });
  } catch (error) {
    twiceError = error as ClusterLockHeldError;
  }
  assert('a second acquisition in one process is refused', twiceError instanceof ClusterLockHeldError);
  assert('and is not blamed on another process', twiceError?.verdict.basis === 'same-process', twiceError?.verdict.basis);
  assert('and says to reuse the connection', Boolean(twiceError?.report.includes('closeDb')));
  first.release();

  /* -------------------------------------------------------------------------
   * 5d. Two different clusters must not contend for one lock. Every rehearsal in
   *     this project runs on a copied cluster via a separate data directory, and
   *     a fixed lock path would both block those and leave the copies unguarded.
   */
  const otherCluster = join(root, 'pg-copy');
  const otherLock = lockPathFor(otherCluster);
  assert('a second cluster gets its own lock file', otherLock === `${otherCluster}.lock` && otherLock !== lockPath);
  const onPrimary = acquireClusterLock(clusterDir, { onRefusal: 'throw' });
  const onCopy = acquireClusterLock(otherCluster, { onRefusal: 'throw' });
  assert('and holding one does not block the other', onCopy.record.pid === process.pid);
  assert('and both locks exist independently', existsSync(lockPath) && existsSync(otherLock));
  onCopy.release();
  assert('releasing the copy leaves the primary held', existsSync(lockPath) && !existsSync(otherLock));
  onPrimary.release();

  /* -------------------------------------------------------------------------
   * 5e. An in-memory cluster is guarded by taking no lock at all, and must not
   *     drop a lock file beside the working directory.
   */
  const before = readdirSync(process.cwd()).filter((f) => f.endsWith('.lock'));
  const ephemeral = acquireClusterLock('memory://', { onRefusal: 'throw' });
  assert('an in-memory data directory takes no lock', ephemeral.path === '', `path "${ephemeral.path}"`);
  assert('and releasing it is harmless', (() => { ephemeral.release(); return true; })());
  assert(
    'and no lock file appeared in the working directory',
    readdirSync(process.cwd()).filter((f) => f.endsWith('.lock')).length === before.length,
    readdirSync(process.cwd()).filter((f) => f.endsWith('.lock')).join(', ')
  );

  /* -------------------------------------------------------------------------
   * 6. The scratch directory held nothing but the lock.
   */
  const clusterEntries = existsSync(clusterDir) ? readdirSync(clusterDir) : [];
  const copyEntries = existsSync(otherCluster) ? readdirSync(otherCluster) : [];
  assert('nothing was ever created inside either cluster directory', clusterEntries.length === 0 && copyEntries.length === 0, [...clusterEntries, ...copyEntries].join(', '));
} finally {
  // Never leave a scratch lock behind: a fixture that leaks a lock is a fixture
  // that makes the next run fail for the wrong reason.
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    // Best effort.
  }
}

console.log(`\n${failures === 0 ? '  All checks passed.' : `  ${failures} check(s) failed.`}\n`);
process.exit(failures === 0 ? 0 : 1);
