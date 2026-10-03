/**
 * The PGlite cluster guard: one process at a time, or a refusal that says so.
 *
 * WHY THIS EXISTS
 *
 * PGlite is a single-process Postgres compiled to WebAssembly. The cluster under `.data/pg` is
 * opened read/write by whoever starts first and it has **no lock of its own** — it writes a
 * `postmaster.pid` containing the sentinel PID `-42`, which protects nothing. A second process
 * opening the same directory — a CLI script while the server is running, two agents building at
 * once, a verification script racing the server it just started — corrupts it. In a single day
 * this checkout produced SEVEN damaged cluster directories, and each one cost a restore plus the
 * imports that had to be replayed on top of it.
 *
 * Every earlier remedy was a remedy to a CALLER: a paragraph in AGENTS.md, a warning in
 * `.env.example`, a script taught to ask before it kills. All of them depend on the next person
 * remembering, and the seven directories are the measurement of how well that works.
 *
 * So this one lives where the cluster is opened rather than where it is used. `createDb()` calls
 * `acquireClusterLock()` immediately before `PGlite.create()`, which covers every caller by
 * construction: the Next.js server, the migrations, the importers, the tests, and whatever script
 * is written next. A guard that a caller has to remember to call is not a guard.
 *
 * WHY THE LOCK FILE IS BESIDE THE CLUSTER AND NOT INSIDE IT
 *
 * `.data/pg.lock`, never `.data/pg/lock`.
 *
 * A lock inside the data directory is destroyed by exactly the procedure that needs it most. The
 * documented recovery from a damaged cluster is to move the directory aside — `pg.damaged-<stamp>`
 * — and restore a backup. A lock inside that directory travels with the wreckage and leaves the
 * replacement unguarded; and when a cluster is rebuilt from scratch the lock inside it is simply
 * not there. Beside the cluster the lock survives both, and its meaning is obvious from its name.
 *
 * WHY O_CREAT|O_EXCL AND NOT "CHECK, THEN CREATE"
 *
 * The failure that has happened seven times is two processes starting in the same instant.
 * `existsSync()` followed by a write is a race whose window is exactly as wide as the work between
 * the two calls. `open(path, 'wx')` is one atomic syscall: the kernel creates the file or reports
 * that it exists, and there is no instant in which both processes can believe they won.
 *
 * WHY LIVENESS ALONE IS NOT ENOUGH, AND WHAT REPLACES IT
 *
 * The obvious staleness test — is the recorded PID still alive? — is wrong on its own, because
 * **PID numbers are reused** on macOS and Linux. The holder dies, the counter wraps, an unrelated
 * process inherits the number, and the lock now names a live process that has nothing to do with
 * the cluster. A guard that trusts liveness alone then refuses forever, and *a guard that must be
 * removed by hand after every crash is a guard people learn to delete.*
 *
 * Three tests are used, in increasing order of cost:
 *
 *   1. the recorded PID is not alive                        -> stale
 *   2. it is alive, but its start time differs from the
 *      recorded one                                          -> stale (the PID was reused)
 *   3. it is alive, its start time cannot be read on this
 *      machine, and no process holds the lock file open      -> stale
 *
 * Test 3 is what makes this work on macOS, which is where this is developed. `ps` is the only
 * source of another process's start time on macOS and it is not always available — in the sandbox
 * this repository is developed inside, executing it is denied outright. So the holder **keeps the
 * lock file's descriptor open for its whole life**, and a lock whose file no process holds open
 * cannot have a living owner: the kernel closed that descriptor when the owner died, whether it
 * exited, crashed, or was killed. That test identifies the *descriptor* rather than a number, so
 * PID reuse cannot fool it, and it needs no start time at all.
 *
 * **"Nothing holds it open" is absence of evidence, so the instrument is checked before it is
 * believed.** A probe that cannot see the process it is asking about is not evidence that the
 * process is gone — `lsof` run without the privilege to see another user's descriptors reports
 * nothing and exits successfully. So before any `free` verdict is acted on, the probe must be shown
 * to be able to see the recorded PID at all; if it cannot, the verdict is `unknown` and the guard
 * refuses. That distinction — a verified instrument reporting nothing, versus an instrument that
 * never looked — is the whole difference between self-healing and a silent double-open.
 *
 * Test 2 is exact where the platform can answer (/proc on Linux, `ps` elsewhere) and is skipped
 * where it cannot. It is never the only test, so a machine without `ps` loses precision, not
 * safety.
 *
 * THE LIVENESS TEST IS A DESCRIPTOR PROBE, NOT `ps` — recorded here because it is the reasoning
 * somebody will otherwise try to correct later:
 *
 * > `ps` is denied in some sandboxes, and a rule that refuses whenever an instrument is unavailable
 * > would make a dead holder's lock unreclaimable — which is how a guard becomes a file people
 * > delete. The holder keeps the lock file descriptor open for its whole life, so a verified probe
 * > that sees no holder is positive evidence of death, and it cannot be fooled by a recycled PID.
 * > Where no evidence can be obtained, the guard refuses.
 *
 * This is stronger than comparing process start times, because it does not depend on reading
 * anything the operating system may refuse to tell us: it depends on an invariant of our own code.
 *
 * WHERE THE LOCK FILE GOES, EXACTLY
 *
 * Always `dirname(dataDir)/basename(dataDir).lock` for the RESOLVED data directory, so:
 *
 *     .data/pg        -> .data/pg.lock        (the repository's own cluster)
 *     /tmp/copy/pg    -> /tmp/copy/pg.lock    (a rehearsal on a copy — its own lock)
 *     memory://       -> no lock at all       (see below)
 *
 * The path is derived rather than fixed, and that is load-bearing for two measured reasons:
 * **every rehearsal and every test in this project runs on a copied cluster through a separate data
 * directory**, and a fixed path would both make those contend for one lock and leave two processes
 * on the same copy entirely unguarded — the exact runs that have damaged clusters here.
 *
 * An in-memory PGlite (`memory://`, `idb://`) has no on-disk cluster for a second process to
 * corrupt, and the URL is not a directory that could hold a lock, so **no lock is taken for it and
 * a no-op lock is returned.** That is deliberate rather than incidental: the alternative is
 * `resolve('memory://')` producing a relative path and dropping a file called `memory:` beside the
 * working directory, which is the kind of small mystery that gets a guard distrusted.
 *
 * WHY THIS IS NOT A HEARTBEAT
 *
 * A lock that went stale when a timestamp stopped advancing would be reclaimed while its holder
 * was inside a long PGlite query: the query runs on the same thread as the heartbeat, so the
 * heartbeat stops for the one reason that matters most. Two processes would then share the cluster
 * and produce precisely the corruption this exists to prevent. Time is therefore never evidence of
 * death here. Only the operating system is asked.
 *
 * WHAT IT REFUSES TO DO
 *
 * It does not reclaim a lock when it cannot tell. If the PID is alive, no start time is available,
 * and the descriptor probe cannot be trusted to have looked properly, it refuses. Refusing costs a
 * restart somebody can see; reclaiming wrongly costs a cluster, and a cluster is not recoverable.
 *
 * It is also deliberately **not** disableable by an environment variable. An escape hatch would be
 * the first thing reached for under exactly the pressure that produces the corruption. Removing a
 * named lock file by hand is louder and far harder to do by accident, which is why the refusal
 * prints that exact command and nothing else.
 *
 * WHAT IT DOES NOT COVER, AND MUST NOT APPEAR TO
 *
 * **It cannot make `SIGKILL` safe.** The documented cause of a damaged cluster is a `SIGKILL`
 * landing while PGlite is opening its cluster and writing WAL. This guard prevents a *second*
 * opener; it does nothing about a first one being shot mid-boot. Worse, a `SIGKILL` leaves a lock
 * whose descriptor the kernel closes, so self-healing will clear it and the next process will
 * cheerfully open a cluster that may have been killed mid-write. **A guard believed to cover
 * `SIGKILL` is worse than no guard, because the prohibition then quietly stops being enforced.**
 * The "never `SIGKILL`" rule stays where it is — in `scripts/serve-review.sh`, which sends SIGTERM
 * and waits, and refuses to force a process that holds the cluster — and the refusal message below
 * repeats it so the two are read together.
 *
 * IT IS NOT `postmaster.pid`
 *
 * PGlite writes its own `.data/pg/postmaster.pid`, inside the cluster, containing the sentinel PID
 * `-42`. It protects nothing, and `scripts/serve-review.sh` deletes it as part of a clean start.
 * **This guard is a different file, in a different place, with a different purpose.** Conflating
 * them is how somebody will one day "fix" the guard by deleting the wrong file.
 *
 * IT IS PER-MACHINE, NOT PER-VOLUME
 *
 * `O_CREAT|O_EXCL` is atomic because it is an atomic operation on a local filesystem. On some
 * network filesystems it is documented as unreliable. This guard is therefore a guard for a
 * single machine's processes — which is what this cluster is — and nothing here should be read as
 * protecting the same directory mounted from two hosts.
 *
 * DATABASE_URL
 *
 * None of this applies when a real Postgres is configured. PGlite is only reached when no
 * connection string is set, so the call site in `client.ts` never runs for Postgres — and that is
 * correct, because a real server handles its own concurrency and a lock here would be a lie about
 * what is being protected.
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

/** What the holder writes, so a refusal can name it and a reader can understand it. */
export interface LockRecord {
  /** The holder's process id. */
  pid: number;
  /**
   * When the holder's process started, derived from its own uptime. Recorded because a PID alone
   * cannot be trusted across reuse, and because a refusal that names a start time is checkable.
   */
  processStartTime: string;
  /** When the lock was taken. Usually a few milliseconds after the process started. */
  startedAt: string;
  /** The holder's command line, so an operator can see which of their commands owns the cluster. */
  argv: string[];
  /** Unguessable, so release can never delete a successor's lock. */
  token: string;
}

export interface ClusterLock {
  /** Absolute path of the lock file, which is beside the cluster directory. */
  readonly path: string;
  readonly record: LockRecord;
  /** Remove the lock. Idempotent, and safe to call from a signal handler. */
  release(): void;
}

interface HeldLock {
  fd: number;
  path: string;
  token: string;
  record: LockRecord;
}

type ShutdownHook = () => Promise<void> | void;

let held: HeldLock | null = null;
let handlersInstalled = false;
let shuttingDown = false;
const shutdownHooks: ShutdownHook[] = [];

/**
 * How long a clean shutdown may take before the process leaves anyway.
 *
 * PGlite is flushed per transaction, so nothing is lost by a quick exit; the timeout exists so a
 * stuck close cannot make the process unkillable by the ordinary `SIGTERM` that
 * `scripts/serve-review.sh` sends and waits 20 seconds for.
 */
const SHUTDOWN_TIMEOUT_MS = 10_000;

/**
 * Two start times are treated as the same process within this window.
 *
 * `ps -o lstart` reports whole seconds while the recorded value has milliseconds, so an exact
 * comparison would call every live holder a reused PID. A genuine reuse is minutes or hours apart,
 * so a two-second window separates the two cases with room to spare.
 */
const START_TIME_TOLERANCE_MS = 2_000;

/**
 * How many times a process will reclaim a stale lock and try the exclusive create again.
 *
 * It is bounded rather than a `while (true)` because an unbounded loop turns a lock that cannot be
 * taken into a hang, and because a bound is what makes the race benign: every attempt is an
 * `O_CREAT|O_EXCL`, so if several processes are all reclaiming, exactly one wins each round and the
 * losers run out of attempts and refuse. Five is generous — a stale lock is reclaimed on the first
 * or second round in every real case.
 */
const MAX_ACQUIRE_ATTEMPTS = 5;

/** How a refusal is delivered. `exit` is the production behaviour; `throw` exists for tests. */
export type RefusalMode = 'exit' | 'throw';

export interface AcquireOptions {
  /**
   * `exit` (the default) prints the refusal and exits non-zero, which is what a server or a CLI
   * script must do. `throw` raises `ClusterLockHeldError` instead, so a test can assert the refusal
   * **inside the parent process** rather than having to spawn a child to observe it. It is not a
   * bypass: the lock is still respected, only the reporting differs.
   */
  onRefusal?: RefusalMode;
}

/** The lock file is a sibling of the cluster directory. See the header for why. */
export function lockPathFor(dataDir: string): string {
  const resolved = resolve(dataDir);
  return `${join(dirname(resolved), basename(resolved))}.lock`;
}

/**
 * True for a PGlite data directory that is not on this disk, such as `memory://` or `idb://`.
 *
 * There is nothing for a second process to corrupt and no directory to hold a lock beside, so the
 * guard deliberately steps aside. Detected by URL scheme: without this, `resolve('memory://')`
 * yields a path under the working directory and the guard would create a lock file named `memory:`
 * there.
 */
export function isEphemeralDataDir(dataDir: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(dataDir.trim());
}

/** This process's own start time, to the millisecond, without asking the operating system. */
export function ownStartTime(): string {
  return new Date(Date.now() - process.uptime() * 1_000).toISOString();
}

/** True when a PID is alive. EPERM means alive and not ours, which is still alive. */
export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function startTimeFromProc(pid: number): string | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    // The comm field is parenthesised and may itself contain spaces, so parse from the last ')'.
    const after = stat.slice(stat.lastIndexOf(')') + 2).split(/\s+/);
    // starttime is field 22 of the record, i.e. index 19 of what follows field 3.
    const ticks = Number(after[19] ?? NaN);
    if (!Number.isFinite(ticks)) return null;
    const boot = /^btime\s+(\d+)/m.exec(readFileSync('/proc/stat', 'utf8'));
    const bootSeconds = Number(boot?.[1] ?? NaN);
    if (!Number.isFinite(bootSeconds)) return null;
    // USER_HZ is 100 on every Linux this runs on; a wrong constant shifts by seconds, and the
    // tolerance above absorbs it without ever mistaking one process for another.
    return new Date((bootSeconds + ticks / 100) * 1_000).toISOString();
  } catch {
    return null;
  }
}

function startTimeFromPs(pid: number): string | null {
  try {
    const out = execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2_000,
    }).trim();
    if (out.length === 0) return null;
    const parsed = new Date(out);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  } catch {
    // Denied, absent, or timed out. Callers fall back to the descriptor probe.
    return null;
  }
}

/**
 * When a live process started, or null when this machine will not say.
 *
 * `/proc` first because it needs no child process and is exact; `ps` second because it is the only
 * source on macOS. Null is a legitimate answer and is handled by the descriptor probe.
 */
export function liveStartTime(pid: number): string | null {
  return startTimeFromProc(pid) ?? startTimeFromPs(pid);
}

/**
 * Is the lock file held open by some living process?
 *
 * This is the PID-reuse-proof test. The holder keeps its descriptor on the lock file open for its
 * whole life, so an open descriptor *is* a living owner and the kernel has already closed the
 * descriptor of anything that died. `lsof` exits 1 with no output when nothing holds the path, and
 * `unknown` is returned for anything else — including `lsof` not being installed — because the
 * caller must refuse rather than guess.
 *
 * `free` here means only "nothing is holding it", and is deliberately **not** acted on by itself.
 * See `probeLockOwnership`.
 */
export function descriptorHeldOpen(path: string): 'held' | 'free' | 'unknown' {
  try {
    const out = execFileSync('lsof', ['--', path], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3_000,
    });
    return out.trim().length > 0 ? 'held' : 'free';
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { status?: number | null; stdout?: string };
    if (failure.code === 'ENOENT') return 'unknown';
    // lsof's documented "nothing found" result.
    if (failure.status === 1 && !failure.stdout) return 'free';
    return 'unknown';
  }
}

/**
 * Can this machine's `lsof` see the given process at all?
 *
 * Every live process has open files — at minimum its text and its working directory — so an
 * `lsof -p <pid>` that reports nothing for a process we already know is alive does not mean the
 * process is gone. It means the instrument could not look.
 */
function instrumentCanSee(pid: number): boolean {
  try {
    const out = execFileSync('lsof', ['-p', String(pid)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3_000,
    });
    // A header line alone is not a sighting.
    return out.trim().split('\n').length > 1;
  } catch {
    return false;
  }
}

/**
 * The descriptor test, with the instrument itself verified before its silence is believed.
 *
 * The distinction this function exists to make: *"I looked and nobody holds this file"* is evidence
 * that the owner is gone; *"I am not able to look"* is not evidence of anything, and treating the
 * two the same is how a guard silently stops guarding. So a `free` result is only returned as
 * `free` once the same instrument has demonstrated that it can see the process in question.
 */
export function probeLockOwnership(lockPath: string, holderPid: number | null): 'held' | 'free' | 'unknown' {
  const held = descriptorHeldOpen(lockPath);
  if (held !== 'free') return held;
  // Nothing holds it open. Believe that only if the probe can see the recorded owner — or, when the
  // record is unreadable and there is no owner to name, if it can see this process.
  return instrumentCanSee(holderPid ?? process.pid) ? 'free' : 'unknown';
}

export function readLockRecord(path: string): LockRecord | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<LockRecord>;
    if (typeof parsed.pid !== 'number' || !Number.isInteger(parsed.pid)) return null;
    return {
      pid: parsed.pid,
      processStartTime: typeof parsed.processStartTime === 'string' ? parsed.processStartTime : '',
      startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : '',
      argv: Array.isArray(parsed.argv) ? parsed.argv.filter((a): a is string => typeof a === 'string') : [],
      token: typeof parsed.token === 'string' ? parsed.token : '',
    };
  } catch {
    return null;
  }
}

export interface LockVerdict {
  stale: boolean;
  /** One sentence for the operator, used verbatim in the refusal. */
  reason: string;
  holder: LockRecord | null;
  /** How the verdict was reached, for the refusal's detail and for the tests. */
  basis:
    | 'record-unreadable'
    | 'pid-dead'
    | 'start-time-differs'
    | 'descriptor-free'
    | 'live'
    | 'same-process'
    | 'undetermined';
}

/** Decide whether the lock already on disk has a living owner. Pure in the OS probes. */
export function inspectLock(lockPath: string): LockVerdict {
  const holder = readLockRecord(lockPath);

  if (!holder) {
    // A torn write: the file was created and the creator was killed before its record landed.
    const probe = probeLockOwnership(lockPath, null);
    if (probe === 'held') {
      return {
        stale: false,
        basis: 'undetermined',
        holder: null,
        reason: 'the lock file exists but carries no readable record, and a process holds it open',
      };
    }
    if (probe === 'free') {
      return {
        stale: true,
        basis: 'record-unreadable',
        holder: null,
        reason: 'the lock file carries no readable record and a verified probe found no process holding it open',
      };
    }
    return {
      stale: false,
      basis: 'undetermined',
      holder: null,
      reason: 'the lock file carries no readable record and it could not be determined whether any process holds it open',
    };
  }

  if (!pidAlive(holder.pid)) {
    return {
      stale: true,
      basis: 'pid-dead',
      holder,
      reason: `PID ${holder.pid} is no longer running`,
    };
  }

  const live = liveStartTime(holder.pid);
  const recordedAt = Date.parse(holder.processStartTime);
  const comparable = live !== null && holder.processStartTime.length > 0 && !Number.isNaN(recordedAt);

  if (comparable) {
    const drifted = Math.abs(Date.parse(live) - recordedAt) > START_TIME_TOLERANCE_MS;
    if (drifted) {
      return {
        stale: true,
        basis: 'start-time-differs',
        holder,
        reason: `PID ${holder.pid} is alive but started at ${live}, not at ${holder.processStartTime}, so the PID has been reused`,
      };
    }
    return {
      stale: false,
      basis: 'live',
      holder,
      reason: `PID ${holder.pid} is running and started at ${holder.processStartTime}, as recorded`,
    };
  }

  // Alive, but this machine will not say since when. Ask the kernel's descriptor table instead:
  // an owner that died took its descriptor with it, however it died. The probe is only believed
  // once it has shown it can see this process at all.
  const probe = probeLockOwnership(lockPath, holder.pid);
  if (probe === 'free') {
    return {
      stale: true,
      basis: 'descriptor-free',
      holder,
      reason: `PID ${holder.pid} is alive but its start time cannot be read here, and a verified probe found no process holding the lock file open, so it is not the holder`,
    };
  }
  if (probe === 'held') {
    return {
      stale: false,
      basis: 'live',
      holder,
      reason: `PID ${holder.pid} is running and a process holds the lock file open`,
    };
  }
  return {
    stale: false,
    basis: 'undetermined',
    holder,
    reason: `PID ${holder.pid} is alive and neither its start time nor a trustworthy answer about the lock file's descriptor could be obtained here`,
  };
}

function ago(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1_000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

/**
 * The refusal, as one string, so a test can assert that it says the four things it must say:
 * the holder's identity, the sentence that distinguishes contention from corruption, the reason
 * this process believes the holder is alive, and the exact release command.
 */
export function formatRefusal(lockPath: string, verdict: LockVerdict): string {
  const holder = verdict.holder;

  // This process is the holder. Saying "another process holds it" would send somebody looking for a
  // process that does not exist, so this case gets its own words.
  if (verdict.basis === 'same-process') {
    return [
      '',
      '  REFUSING TO OPEN THE PGLITE CLUSTER A SECOND TIME IN THIS PROCESS.',
      '',
      '  PGlite is single-process; starting a second one corrupts the cluster.',
      '',
      `    lock   ${lockPath}`,
      `    held by this process (PID ${process.pid})`,
      `    ${verdict.reason}`,
      '',
      '  Call getDb() to reuse the open connection, or await closeDb() before opening it again.',
      '',
    ].join('\n');
  }

  const lines: string[] = [
    '',
    '  REFUSING TO OPEN THE PGLITE CLUSTER: ANOTHER PROCESS HOLDS IT.',
    '',
    '  PGlite is single-process; starting a second one corrupts the cluster.',
    '',
    '  This is contention, not corruption. Nothing is wrong with the database,',
    '  and nothing here should be deleted, migrated or restored.',
    '',
    `    lock          ${lockPath}`,
  ];
  if (holder) {
    lines.push(`    holder pid    ${holder.pid}`);
    if (holder.processStartTime) {
      lines.push(`    started       ${holder.processStartTime}  (${ago(holder.processStartTime)})`);
    }
    if (holder.startedAt) {
      lines.push(`    took lock     ${holder.startedAt}  (${ago(holder.startedAt)})`);
    }
    if (holder.argv.length > 0) {
      lines.push(`    holder argv   ${holder.argv.join(' ')}`);
    }
  }
  lines.push(
    `    believed live ${verdict.reason}`,
    '',
    '  Stop that process and start again. A lock whose owner has died is reclaimed',
    '  automatically, so this command is only for a lock whose owner you have',
    '  already confirmed is gone:',
    '',
    `    rm -f '${lockPath}'`,
    '',
    '  Do NOT kill the holder with -9. PGlite writes WAL as it opens its cluster, and a',
    '  SIGKILL landing in that window leaves a cluster that cannot be opened at all.',
    '  SIGTERM, wait, and let it close. This lock is not `postmaster.pid` — that file is',
    '  inside the cluster, PGlite writes it itself, and deleting it fixes nothing here.',
    ''
  );
  return lines.join('\n');
}

/** Thrown instead of exiting when the caller asked to handle the refusal itself. */
export class ClusterLockHeldError extends Error {
  readonly lockPath: string;
  readonly verdict: LockVerdict;
  /** The full operator-facing message, identical to what would have been printed. */
  readonly report: string;

  constructor(lockPath: string, verdict: LockVerdict) {
    const report = formatRefusal(lockPath, verdict);
    super(`the PGlite cluster at ${lockPath} is held by another process; PGlite is single-process and starting a second one corrupts the cluster`);
    this.name = 'ClusterLockHeldError';
    this.lockPath = lockPath;
    this.verdict = verdict;
    this.report = report;
  }
}

function refuse(lockPath: string, verdict: LockVerdict, mode: RefusalMode): never {
  if (mode === 'throw') throw new ClusterLockHeldError(lockPath, verdict);
  process.stderr.write(formatRefusal(lockPath, verdict));
  process.exit(1);
}

function releaseOwn(): void {
  if (!held) return;
  const { fd, path, token } = held;
  held = null;
  try {
    closeSync(fd);
  } catch {
    // Already closed.
  }
  try {
    const current = readLockRecord(path);
    // Never delete a successor's lock. An unreadable record can only be our own torn one,
    // because the file's existence blocked anyone else from acquiring it.
    if (!current || current.token === token) unlinkSync(path);
  } catch {
    // Already gone, which is the desired state.
  }
}

async function shutdown(signal: 'SIGINT' | 'SIGTERM'): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  // Close the database BEFORE releasing the lock. A successor that opens the cluster while PGlite
  // is still flushing is the corruption this file exists to prevent, so the lock must outlive the
  // close, not the process's willingness to leave.
  const deadline = Date.now() + SHUTDOWN_TIMEOUT_MS;
  for (const hook of shutdownHooks) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    try {
      await Promise.race([
        Promise.resolve(hook()),
        new Promise((resolveTimeout) => setTimeout(resolveTimeout, remaining).unref?.()),
      ]);
    } catch {
      // A hook that fails must not stop the lock being released.
    }
  }

  releaseOwn();

  // Node's default action for these signals terminates the process; because there is a listener
  // now, that no longer happens on its own. Exiting explicitly preserves the behaviour every
  // caller already depends on — including `scripts/serve-review.sh`, which sends SIGTERM, waits
  // up to twenty seconds, and reports a process that will not leave rather than shooting it.
  process.exit(signal === 'SIGINT' ? 130 : 143);
}

function installHandlers(): void {
  if (handlersInstalled) return;
  handlersInstalled = true;

  process.on('exit', releaseOwn);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void shutdown(signal);
    });
  }
}

/**
 * Register work to finish before the lock is released on a signal.
 *
 * `client.ts` registers the PGlite close here so the cluster is flushed before a successor may
 * take it. Hooks run in registration order, and the lock is always released last.
 */
export function registerShutdownHook(hook: ShutdownHook): void {
  shutdownHooks.push(hook);
}

/**
 * Take the cluster lock, or refuse loudly.
 *
 * Must be called before the cluster is read, not only before it is written: a reader and a writer
 * corrupt each other equally, because both open the same files for writing as Postgres recovers
 * and checkpoints.
 *
 * The retry loop is bounded and every attempt is an exclusive create, so two processes that both
 * judge a stale lock stale cannot both go on to open the cluster: they both unlink, they both race
 * for `O_CREAT|O_EXCL`, and exactly one of them wins it. The loser sees `EEXIST` again and, because
 * the attempts are bounded, ends in the refusal rather than proceeding optimistically.
 */
export function acquireClusterLock(dataDir: string, options: AcquireOptions = {}): ClusterLock {
  // An in-memory cluster is a private one. There is no second opener to guard against.
  if (isEphemeralDataDir(dataDir)) {
    return {
      path: '',
      record: {
        pid: process.pid,
        processStartTime: ownStartTime(),
        startedAt: new Date().toISOString(),
        argv: [],
        token: '',
      },
      release: () => {},
    };
  }

  const lockPath = lockPathFor(dataDir);
  const refusalMode: RefusalMode = options.onRefusal ?? 'exit';

  // The cluster is the lock's sibling, so its directory must exist before the cluster does.
  mkdirSync(dirname(lockPath), { recursive: true });

  if (held && held.path === lockPath) {
    // This process already holds it. Reusing the lock would let a caller open a second PGlite
    // client on one cluster, which is exactly as dangerous as a second process doing it, so this
    // refuses — but with its own reason, because "another process holds it" would be a lie and
    // would send somebody looking for a process that does not exist. The fix is to reuse the
    // connection (`getDb`) or to close it first (`closeDb`).
    refuse(
      lockPath,
      {
        stale: false,
        basis: 'same-process',
        holder: held.record,
        reason: `this process already holds it (as PID ${held.record.pid}); reuse the open connection, or close it with closeDb() first, rather than opening the cluster twice in one process`,
      },
      refusalMode
    );
  }

  for (let attempt = 0; attempt < MAX_ACQUIRE_ATTEMPTS; attempt += 1) {
    try {
      const fd = openSync(lockPath, 'wx', 0o600);
      const record: LockRecord = {
        pid: process.pid,
        processStartTime: ownStartTime(),
        startedAt: new Date().toISOString(),
        argv: process.argv.slice(),
        token: randomBytes(8).toString('hex'),
      };
      /*
       * ONE write, kept small. A reader must never see a half-written record, and the shortest
       * honest record is the one least likely to be torn. `argv` is the only part that can grow,
       * so it is capped; it exists to tell an operator which of their commands owns the cluster,
       * not to reproduce the command exactly.
       */
      writeSync(fd, `${JSON.stringify({ ...record, argv: record.argv.slice(0, 8) })}\n`);
      // The descriptor is deliberately kept open for the life of the process: it is the kernel's
      // own evidence that this lock has a living owner, and the test that survives PID reuse.
      held = { fd, path: lockPath, token: record.token, record };
      installHandlers();
      return { path: lockPath, record, release: releaseOwn };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }

    const verdict = inspectLock(lockPath);
    if (!verdict.stale) refuse(lockPath, verdict, refusalMode);

    // Reclaim and loop back to the exclusive create. Another reclaimer may have won the unlink;
    // the next iteration's O_EXCL is what actually decides, and only one process can win it.
    try {
      unlinkSync(lockPath);
    } catch {
      // Already gone.
    }
  }

  // Every attempt lost. Report the current state rather than proceeding.
  refuse(lockPath, inspectLock(lockPath), refusalMode);
}
