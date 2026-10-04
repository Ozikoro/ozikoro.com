/**
 * The only thing in this service that talks to the Python worker.
 *
 * WHY ONE LONG-LIVED PROCESS AND NOT A COMMAND PER REQUEST
 *
 * Loading F5-TTS means reading a 1.35 GB checkpoint and building a 335 M-parameter transformer. That is
 * roughly half a minute before any speech happens. Spawning that per request would make every render pay
 * it, and the service would be unusable for the thing it exists for — narrating a whole article.
 *
 * So one process is started on demand, kept alive, and fed one JSON line at a time. `#ensureStarted` is
 * idempotent; `#closed` prevents a dead process from being handed out again.
 *
 * WHY REQUESTS ARE SHAPED AS ONE-AT-A-TIME
 *
 * A flow-matching model synthesising on CPU occupies the whole machine. Two concurrent renders do not
 * finish in the time of one, they finish in the time of two while making both wait longer. The lock in
 * `#inFlight` is therefore a correctness property, not a performance one: **the worker's stdout is a
 * protocol stream, and interleaving two requests over one pipe would corrupt both.**
 *
 * TIMEOUTS REPORT THEMSELVES
 *
 * There is no way to cancel work inside the Python process, so a timeout kills the worker rather than
 * leaving it busy. **A killed worker loses its loaded model**, which costs the next request a reload —
 * that is accepted deliberately: a render that hangs forever and holds the queue is worse than a slow
 * next request, and a timeout that does not say so is worse than both.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface, type Interface } from 'node:readline';
import { MediaError } from './errors.ts';

/** Where the Python side lives, and which interpreter runs it. */
export function pythonPaths(): { python: string; worker: string; appRoot: string } {
  const appRoot = join(import.meta.dirname, '..');
  const repoRoot = join(appRoot, '..', '..');
  const python = process.env.OZIKORO_MEDIA_PYTHON ?? join(repoRoot, '.tools', 'tts-venv', 'bin', 'python');
  const worker = join(appRoot, 'python', 'worker.py');
  return { python, worker, appRoot };
}

/** A problem with the install rather than with a request — reported distinctly so it is actionable. */
export function assertRuntimePresent(): { python: string; worker: string } {
  const { python, worker } = pythonPaths();
  const missing: string[] = [];
  if (!existsSync(python)) missing.push(python);
  if (!existsSync(worker)) missing.push(worker);
  if (missing.length > 0) {
    throw new MediaError({
      code: 'engine_unavailable',
      engine: 'local',
      status: 503,
      message:
        `the local engine is not installed on this host: missing ${missing.join(', ')}. ` +
        `Run \`npm -w @ozikoro/media run probe\` for the exact install steps; ` +
        `the service will keep serving the elevenlabs engine while this is unresolved.`,
      details: { missing, hint: 'docs/MEDIA-SERVICE.md § Installing the local engine' },
    });
  }
  return { python, worker };
}

export type WorkerLoadInfo = {
  model: string;
  device: string;
  checkpoint: string;
  vocabFile: string;
  accelerators: { cuda: boolean; mps: boolean; deviceCount: number; torch: string };
};

export type WorkerSynthResult = {
  ok: true;
  out: string;
  sampleRate: number;
  samples: number;
  durationSeconds: number;
  byteSize: number;
  peak: number;
  rms: number;
  /** True when the model returned digital silence. **Reported as a defect, never as a good render.** */
  silent: boolean;
  preparedText: string | null;
  strippedMarks: string[];
  outOfVocab: string[];
  nfeStep: number;
  speed: number;
};

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  timer: NodeJS.Timeout | null;
  label: string;
};

export type WorkerStatus = {
  started: boolean;
  ready: boolean;
  pid: number | null;
  model: string | null;
  device: string | null;
  loadError: string | null;
  accelerators: WorkerLoadInfo['accelerators'] | null;
  busy: boolean;
  pendingRequests: number;
};

export class TtsWorker {
  #child: ChildProcessWithoutNullStreams | null = null;
  #reader: Interface | null = null;
  #queue: Pending[] = [];
  #inFlight: Pending | null = null;
  #stderrTail: string[] = [];
  #load: WorkerLoadInfo | null = null;
  #loadError: string | null = null;
  #starting: Promise<void> | null = null;
  /** Set while `stop()` is shutting the process down, so its exit is not reported as a crash. */
  #stopping = false;

  /**
   * How long the model may take to load.
   *
   * A cold start downloads 1.35 GB and moves it onto the device. Ten minutes is generous on a slow link
   * and still finite; **the number exists so that a stuck download ends in a stated failure rather than
   * an indefinitely pending `/health`.**
   */
  loadTimeoutMs = Number(process.env.OZIKORO_MEDIA_LOAD_TIMEOUT_MS ?? 900_000);

  /** How long one synthesis chunk may take before the worker is killed and the request fails. */
  synthTimeoutMs = Number(process.env.OZIKORO_MEDIA_SYNTH_TIMEOUT_MS ?? 600_000);

  status(): WorkerStatus {
    return {
      started: this.#child !== null && !this.#child.killed,
      ready: this.#load !== null,
      pid: this.#child?.pid ?? null,
      model: this.#load?.model ?? null,
      device: this.#load?.device ?? null,
      loadError: this.#loadError,
      accelerators: this.#load?.accelerators ?? null,
      busy: this.#inFlight !== null,
      pendingRequests: this.#queue.length + (this.#inFlight ? 1 : 0),
    };
  }

  /** Recent stderr, for diagnostics. Bounded, because a chatty model would otherwise grow without limit. */
  stderrTail(lines = 40): string[] {
    return this.#stderrTail.slice(-lines);
  }

  async start(preload = true): Promise<void> {
    if (this.#starting) return this.#starting;
    this.#starting = (async () => {
      const { python, worker } = assertRuntimePresent();

      /*
       * WHY `--preload` IS *NOT* PASSED, EVEN WHEN `preload` IS TRUE
       *
       * It used to be, and it was a real bug with a confusing signature. The flag makes the WORKER emit a
       * `load` frame of its own, and this client then sends `{"cmd":"load"}` as well — so the worker loaded
       * the 1.35 GB checkpoint twice, and the frames came back one request out of step:
       *
       *     worker:  [load frame from --preload]  [load frame from the request]  [synth frame]
       *     client:  matches frame 1 to `load`     matches frame 2 to the SYNTH request
       *
       * The synth promise was therefore resolved with a LOAD frame, which has no `out` field, and the
       * failure surfaced three layers away as
       *
       *     TypeError: The "path" argument must be of type string ... Received undefined
       *       at concatWavs (apps/media/lib/audio.ts)
       *
       * — an error about `readFileSync` caused by a duplicate model load. **Nothing in that message points
       * at the real fault**, which is why the fix is here rather than at the symptom.
       *
       * Loading is now always driven by one explicit `load` request, so there is exactly one load and the
       * frames cannot get out of step. The startup cost is unchanged: `load()` is called immediately after
       * the spawn. `preload` is kept in the signature because every caller passes it and because the
       * *intent* — "have the model ready before the first render" — is still honoured; only the duplicate
       * mechanism is gone.
       */
      void preload;
      const child = spawn(python, [worker], {
        cwd: join(import.meta.dirname, '..'),
        env: {
          ...process.env,
          // The worker sets these itself, but passing them keeps the two in agreement when the service
          // is started from a different directory.
          PYTHONUNBUFFERED: '1',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.#child = child;

      this.#reader = createInterface({ input: child.stdout });
      this.#reader.on('line', (line) => this.#onLine(line));

      child.stderr.on('data', (chunk: Buffer) => {
        for (const line of chunk.toString('utf8').split('\n')) {
          if (line.trim()) this.#stderrTail.push(line);
        }
        if (this.#stderrTail.length > 400) this.#stderrTail.splice(0, this.#stderrTail.length - 400);
      });

      child.on('exit', (code, signal) => {
        const wasStopping = this.#stopping;
        this.#child = null;
        this.#reader?.close();
        this.#reader = null;
        const detail = `python worker exited (code ${code}, signal ${signal})`;
        if (!wasStopping) {
          this.#loadError = detail;
          const error = new MediaError({
            code: 'engine_unavailable',
            engine: 'local',
            status: 503,
            message: `${detail}. Recent worker output: ${this.stderrTail(6).join(' | ') || '(none)'}`,
            details: { exitCode: code, signal },
          });
          this.#failAll(error);
        }
      });

      child.on('error', (error) => {
        this.#loadError = error.message;
        this.#failAll(
          new MediaError({
            code: 'engine_unavailable',
            engine: 'local',
            status: 503,
            message: `could not start the python worker at ${python}: ${error.message}`,
            details: { python, worker },
          })
        );
      });

      if (preload) await this.load();
    })().finally(() => {
      this.#starting = null;
    });
    return this.#starting;
  }

  /** Load the model and wait for it. Called during startup so `/health` can answer truthfully. */
  async load(): Promise<WorkerLoadInfo> {
    if (this.#load) return this.#load;
    const response = (await this.#send({ cmd: 'load' }, this.loadTimeoutMs, 'load')) as WorkerLoadInfo & {
      ok: boolean;
      error?: string;
      traceback?: string[];
    };
    this.#load = response;
    this.#loadError = null;
    return response;
  }

  async synthesize(request: {
    text: string;
    referenceAudio: string;
    referenceText: string;
    out: string;
    nfeStep?: number;
    speed?: number;
    timeoutMs?: number;
  }): Promise<WorkerSynthResult> {
    if (!this.#child) await this.start();
    const response = (await this.#send(
      {
        cmd: 'synth',
        text: request.text,
        ref_audio: request.referenceAudio,
        ref_text: request.referenceText,
        out: request.out,
        nfe_step: request.nfeStep,
        speed: request.speed,
      },
      request.timeoutMs ?? this.synthTimeoutMs,
      `synth(${request.text.length} chars)`
    )) as WorkerSynthResult;

    /*
     * A FRAME THAT DOES NOT ANSWER THE QUESTION, REFUSED HERE.
     *
     * The protocol is positional — no request id — so a frame arriving out of step is indistinguishable
     * from the right one until its SHAPE is checked. Without this, a mis-sequenced reply travels three
     * layers down and becomes `TypeError: path argument must be a string ... Received undefined` inside
     * `concatWavs`, naming `readFileSync` for a fault in request ordering. **Checking the one field the
     * caller cannot proceed without turns that into a sentence about the protocol.**
     */
    if (typeof response?.out !== 'string') {
      throw new MediaError({
        code: 'render_failed',
        engine: 'local',
        model: this.#load?.model ?? null,
        status: 500,
        message:
          `the worker answered a synth request with a frame that has no \`out\` path ` +
          `(keys: ${response && typeof response === 'object' ? Object.keys(response).join(', ') : typeof response}). ` +
          `This means the protocol stream is one request out of step — usually a duplicated command or a ` +
          `library writing to stdout. It is reported here rather than allowed to become a filesystem error.`,
        details: { frame: response as unknown as Record<string, unknown>, stderrTail: this.stderrTail(8) },
      });
    }
    return response;
  }

  /**
   * One request over the pipe.
   *
   * The promise is parked in a FIFO and settled by `#onLine` when a frame arrives. Frames are answered in
   * order, so the head of the queue is always the request the next frame belongs to — **a request id
   * would be more robust and is deliberately not used, because adding an id would let two requests be in
   * flight and this must not allow that.**
   */
  #send(payload: Record<string, unknown>, timeoutMs: number, label: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const child = this.#child;
      if (!child || !child.stdin.writable) {
        reject(
          new MediaError({
            code: 'engine_unavailable',
            engine: 'local',
            status: 503,
            message: 'the python worker is not running (its stdin is closed)',
          })
        );
        return;
      }

      const pending: Pending = { resolve, reject, timer: null, label };
      pending.timer = setTimeout(() => {
        // Drop this request, then kill the process: there is no way to interrupt work inside it, and a
        // worker left mid-render would answer the NEXT request with this one's frame.
        const index = this.#queue.indexOf(pending);
        if (index >= 0) this.#queue.splice(index, 1);
        if (this.#inFlight === pending) this.#inFlight = this.#queue[0] ?? null;
        reject(
          new MediaError({
            code: 'timeout',
            engine: 'local',
            model: this.#load?.model ?? null,
            status: 504,
            message:
              `${label} did not finish within ${Math.round(timeoutMs / 1000)}s, so the worker was stopped. ` +
              `It will reload on the next request. Raise OZIKORO_MEDIA_SYNTH_TIMEOUT_MS if this text is ` +
              `expected to be slow on this machine.`,
            details: { timeoutMs, stderrTail: this.stderrTail(8) },
          })
        );
        this.#kill();
      }, timeoutMs);

      this.#queue.push(pending);
      // The request at the head of the queue is the one the next frame belongs to. Marking it here,
      // rather than waiting for a frame, keeps that mapping true even if the worker answers before this
      // function returns.
      if (this.#inFlight === null) this.#inFlight = pending;
      child.stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
        if (!error) return;
        const index = this.#queue.indexOf(pending);
        if (index >= 0) this.#queue.splice(index, 1);
        if (this.#inFlight === pending) {
          const next = this.#queue[0] ?? null;
          this.#inFlight = next;
        }
        if (pending.timer) clearTimeout(pending.timer);
        reject(
          new MediaError({
            code: 'engine_unavailable',
            engine: 'local',
            status: 503,
            message: `could not write to the python worker: ${error.message}`,
          })
        );
      });
    });
  }

  #onLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    let frame: { ok?: boolean; error?: string; type?: string; traceback?: string[] } & Record<string, unknown>;
    try {
      frame = JSON.parse(trimmed);
    } catch {
      // Not a protocol frame. Reporting it is better than dropping it: the usual cause is a dependency
      // printing to stdout, which would otherwise corrupt every later response silently.
      this.#stderrTail.push(`[non-JSON on stdout] ${trimmed.slice(0, 400)}`);
      return;
    }

    const pending = this.#queue.shift() ?? null;
    if (!pending) {
      this.#stderrTail.push(`[unsolicited frame] ${trimmed.slice(0, 200)}`);
      return;
    }
    this.#inFlight = this.#queue[0] ?? null;
    if (pending.timer) clearTimeout(pending.timer);

    if (frame.ok === false) {
      pending.reject(
        new MediaError({
          code: 'render_failed',
          engine: 'local',
          model: this.#load?.model ?? null,
          status: 500,
          message: `${frame.type ?? 'error'}: ${frame.error ?? 'unknown failure in the worker'}`,
          details: { workerType: frame.type ?? null, traceback: frame.traceback ?? null },
        })
      );
      return;
    }
    pending.resolve(frame);
  }

  #failAll(error: unknown): void {
    if (this.#inFlight) {
      if (this.#inFlight.timer) clearTimeout(this.#inFlight.timer);
      this.#inFlight.reject(error);
      this.#inFlight = null;
    }
    for (const pending of this.#queue.splice(0)) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#load = null;
  }

  #kill(): void {
    this.#stopping = true;
    try {
      this.#child?.kill('SIGTERM');
    } catch {
      /* already gone */
    }
    this.#child = null;
    this.#load = null;
    // The exit handler runs asynchronously and clears `#stopping`; until then a stale "exited" must not
    // be reported as a crash, which would fail the next request with a message about a process that was
    // stopped on purpose.
    setTimeout(() => {
      this.#stopping = false;
    }, 100);
  }

  /** Stop the worker on shutdown. SIGTERM, never SIGKILL — the Python side holds no database lock. */
  async stop(): Promise<void> {
    this.#stopping = true;
    const child = this.#child;
    if (!child) return;
    await new Promise<void>((resolve) => {
      const done = () => resolve();
      child.once('exit', done);
      child.stdin.end();
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) child.kill('SIGTERM');
        resolve();
      }, 3000);
    });
    this.#child = null;
    this.#load = null;
  }
}
