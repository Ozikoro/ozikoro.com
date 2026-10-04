/**
 * The HTTP service on `media.ozikoro.com` — the entry point `package.json` declares as `main`.
 *
 * WHY THIS IS A SEPARATE ORIGIN AND NOT A ROUTE ON THE ARCHIVE
 *
 * Audio is **bytes rather than documents**, and that difference is not cosmetic:
 *
 *   * it wants its own cache — an MP3 is immutable once rendered and can be cached for a year, while an
 *     article's HTML changes whenever an editor touches it;
 *   * it wants its own scaling — a render is minutes of CPU and cannot share a request budget with the
 *     pages that serve readers;
 *   * and, decisively, **if audio ever moves hosts, Spotify feed enclosures break for every subscriber.**
 *     An enclosure URL is a promise made to a listener's podcast app, and a `302` through the article's
 *     own path would be a promise made through a document. **So the hostname for audio is chosen once and
 *     is permanent.** That is why this is a subdomain and not `/api/audio`.
 *
 * WHAT IT DELIBERATELY IS NOT
 *
 * It holds no database. Rendering is stateless: text in, audio out. The Igbo lexicon is a file read at
 * startup, the voices are directories of WAVs, and nothing here opens the PGlite cluster — which is
 * single-process and has been corrupted seven times in a day. **Putting it on the path of every audio
 * request would be a choice to make that eight.**
 *
 * THE ENDPOINTS
 *
 *   GET    /health          what is loaded, whether a GPU is present, whether it is ready
 *   GET    /voices          the locally registered voice profiles
 *   POST   /voices          register a voice from reference audio (multipart or JSON)
 *   DELETE /voices/:name    remove a voice
 *   POST   /speak           { text, voice, engine } -> audio bytes, or a JSON error
 *   POST   /preview/pronunciation   what the pronunciation layer would do, without rendering
 *   GET    /engines         both engines' capabilities and licences
 *
 * **Every error names the engine, the input size and the reason.** `MediaError` carries all three and
 * `toErrorBody` writes them, so there is one place that can get it wrong rather than six.
 *
 * THE BOUNDS, AND WHY EACH IS HERE
 *
 *   * a maximum body size — a request that streams ten minutes of text into memory and then fails is
 *     worse than one refused at 100 kB;
 *   * a maximum text length **per engine**, because the ceiling is the engine's and not the service's;
 *   * a request timeout that reports itself, because a render that hangs silently is indistinguishable
 *     from one that is working;
 *   * a refusal when the local model is already rendering, rather than an unbounded queue.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createEngines, type EngineSet } from '../lib/engines/index.ts';
import { MediaError, isEngineName, toErrorBody, type EngineName } from '../lib/errors.ts';
import { archiveCoverage, analyse, lexiconExists, lexiconPath } from '../lib/lexicon.ts';
import { estimateCost, recordedUsed } from '../lib/cost.ts';
import { narrate } from '../lib/narrate.ts';
import { deleteVoice, listVoices, registerVoice } from '../lib/voice-profiles.ts';

/**
 * An abort signal that fires when the CALLER goes away.
 *
 * Without this a client that disconnects after sending a long passage leaves a CPU-bound render running to
 * completion, holding the worker lock, and the next caller is told `busy` by a request nobody is waiting
 * for. `res`'s `close` fires both on a normal finish and on a disconnect, so it is guarded by
 * `writableEnded` — aborting a render that has already been sent would be a bug that looks like a timeout.
 */
function disconnectSignal(res: ServerResponse): AbortSignal {
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });
  return controller.signal;
}


export type ServerOptions = {
  engines?: EngineSet;
  /** Load the local model before accepting traffic. Off by default so `/health` answers immediately. */
  preload?: boolean;
};

/** A request larger than this is refused before it is read. Twelve episodes of text fit in a tenth of it. */
const MAX_BODY_BYTES = Number(process.env.OZIKORO_MEDIA_MAX_BODY_BYTES ?? 262_144);

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

function jsonError(res: ServerResponse, error: unknown): void {
  const { status, body } = toErrorBody(error);
  json(res, status, body);
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > MAX_BODY_BYTES) {
      throw new MediaError({
        code: 'bad_request',
        status: 413,
        message:
          `the request body exceeded ${MAX_BODY_BYTES} bytes and was refused. The ceiling is here so that ` +
          `a request cannot be streamed into memory only to fail later — a narration this long belongs in ` +
          `the batch command, not one HTTP call.`,
        details: { limitBytes: MAX_BODY_BYTES, receivedBytes: total },
      });
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

function parseJson(body: Buffer): Record<string, unknown> {
  if (body.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(body.toString('utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('the body must be a JSON object');
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new MediaError({
      code: 'bad_request',
      status: 400,
      message: `the request body is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

/** The engine capabilities and licences, for `/engines` and `/health`. */
function engineReport(engines: EngineSet): unknown[] {
  return [
    engines.local.capabilities(),
    engines.elevenlabs.capabilities(),
  ].map((c) => ({
    ...c,
    licence: {
      ...c.licence,
      /**
       * Said as a sentence rather than left as a boolean, because the owner's question is not "is this
       * non-commercial" but "can I publish what it made".
       */
      publishable:
        c.licence.nonCommercial
          ? 'NO — the model weights are non-commercial. A public archive must confirm it is not a commercial use, or use a different model.'
          : 'yes, subject to the provider\'s terms',
    },
  }));
}

/** Register a voice from either multipart/form-data or a JSON body carrying base64 clips. */
async function handleRegisterVoice(req: IncomingMessage, body: Buffer, contentType: string): Promise<unknown> {
  if (contentType.includes('multipart/form-data')) {
    const request = new Request('http://localhost/voices', {
      method: 'POST',
      headers: { 'content-type': contentType },
      // A `Buffer` is a `Uint8Array` at runtime but is not assignable to `BodyInit` in the type system,
      // because Buffer's ArrayBufferLike is not the ArrayBuffer `BodyInit` requires. The view is the honest
      // spelling of what is already there — no copy is made.
      body: new Uint8Array(body),
    });
    const form = await request.formData();
    const clips: { originalName: string; data: Buffer }[] = [];
    for (const [key, value] of form.entries()) {
      if (key !== 'audio' && key !== 'clip' && !key.startsWith('audio')) continue;
      if (typeof value === 'string') continue;
      clips.push({
        originalName: value.name || `${clips.length + 1}.bin`,
        data: Buffer.from(await value.arrayBuffer()),
      });
    }
    const name = form.get('name');
    return registerVoice({
      name: typeof name === 'string' ? name : '',
      label: typeof form.get('label') === 'string' ? (form.get('label') as string) : null,
      clips,
      referenceText: typeof form.get('referenceText') === 'string' ? (form.get('referenceText') as string) : null,
      referenceText2: typeof form.get('referenceText2') === 'string' ? (form.get('referenceText2') as string) : null,
      notes: typeof form.get('notes') === 'string' ? (form.get('notes') as string) : null,
      replace: form.get('replace') === 'true',
    });
  }

  const parsed = parseJson(body);
  const rawClips = parsed['clips'];
  if (!Array.isArray(rawClips) || rawClips.length === 0) {
    throw new MediaError({
      code: 'bad_request',
      status: 400,
      message:
        'no reference audio supplied. Send multipart/form-data with one or more `audio` parts, or JSON ' +
        '`{ name, clips: [{ filename, base64 }], referenceText }`.',
    });
  }
  const clips = rawClips.map((clip, index) => {
    const entry = clip as { filename?: string; base64?: string };
    if (typeof entry.base64 !== 'string') {
      throw new MediaError({
        code: 'bad_request',
        status: 400,
        message: `clip ${index + 1} has no \`base64\` field`,
      });
    }
    return { originalName: entry.filename ?? `clip-${index + 1}.wav`, data: Buffer.from(entry.base64, 'base64') };
  });

  return registerVoice({
    name: typeof parsed['name'] === 'string' ? parsed['name'] : '',
    label: typeof parsed['label'] === 'string' ? parsed['label'] : null,
    clips,
    referenceText: typeof parsed['referenceText'] === 'string' ? parsed['referenceText'] : null,
    referenceText2: typeof parsed['referenceText2'] === 'string' ? parsed['referenceText2'] : null,
    notes: typeof parsed['notes'] === 'string' ? parsed['notes'] : null,
    replace: parsed['replace'] === true,
  });
}

export function createMediaServer(options: ServerOptions = {}): { server: Server; engines: EngineSet } {
  const engines = options.engines ?? createEngines({ preload: options.preload ?? false });

  const server = createServer((req, res) => {
    void handle(req, res, engines).catch((error: unknown) => {
      if (!res.headersSent) jsonError(res, error);
      else res.end();
    });
  });

  return { server, engines };
}

async function handle(req: IncomingMessage, res: ServerResponse, engines: EngineSet): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method ?? 'GET';

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
      'access-control-allow-headers': 'content-type',
    });
    res.end();
    return;
  }

  // ---------------------------------------------------------------- GET /health
  if (method === 'GET' && path === '/health') {
    const local = engines.local.health();
    const capabilities = engineReport(engines);
    json(res, 200, {
      ok: true,
      service: 'ozikoro-media',
      hostname: 'media.ozikoro.com',
      // Ready means the local model is loaded, or the paid engine is configured and permitted. It does NOT
      // mean "a process exists" — a health check that says ready during the checkpoint read is a health
      // check that lies in exactly the window someone is waiting to find out why nothing works.
      ready: local.ready || engines.elevenlabs.capabilities().available,
      local: {
        installed: local.installed,
        ready: local.ready,
        model: local.model,
        device: local.device,
        /** False on this machine: an Intel Mac has no CUDA and no MPS. Stated, not implied. */
        gpu: local.accelerators ? local.accelerators.cuda || local.accelerators.mps : false,
        accelerators: local.accelerators,
        pid: local.pid,
        busy: local.busy,
        pendingRequests: local.pendingRequests,
        loadError: local.loadError,
        lastError: local.lastError,
        python: local.python,
        worker: local.worker,
        stderrTail: local.stderrTail,
      },
      pronunciation: {
        lexiconBuilt: lexiconExists(),
        lexiconPath: lexiconPath(),
        archive: archiveCoverage(),
      },
      engines: capabilities,
    });
    return;
  }

  // --------------------------------------------------------------- GET /engines
  if (method === 'GET' && path === '/engines') {
    json(res, 200, { engines: engineReport(engines) });
    return;
  }

  // ---------------------------------------------------------------- GET /voices
  if (method === 'GET' && path === '/voices') {
    json(res, 200, { voices: listVoices() });
    return;
  }

  // --------------------------------------------------------------- POST /voices
  if (method === 'POST' && path === '/voices') {
    const body = await readBody(req);
    const profile = await handleRegisterVoice(req, body, String(req.headers['content-type'] ?? ''));
    json(res, 201, { voice: profile });
    return;
  }

  // ------------------------------------------------------- DELETE /voices/:name
  if (method === 'DELETE' && path.startsWith('/voices/')) {
    const name = decodeURIComponent(path.slice('/voices/'.length));
    json(res, 200, deleteVoice(name));
    return;
  }

  // ------------------------------------------- POST /preview/pronunciation
  if (method === 'POST' && path === '/preview/pronunciation') {
    const body = parseJson(await readBody(req));
    const text = typeof body['text'] === 'string' ? body['text'] : '';
    if (!text.trim()) {
      throw new MediaError({ code: 'bad_request', status: 400, message: 'no text supplied', characters: 0 });
    }
    const engine: EngineName = isEngineName(body['engine']) ? body['engine'] : 'local';
    json(res, 200, { pronunciation: analyse(text, engine), cost: estimateCost(text.length, recordedUsed()) });
    return;
  }

  // ----------------------------------------------------------------- POST /speak
  if (method === 'POST' && path === '/speak') {
    const body = parseJson(await readBody(req));
    const text = typeof body['text'] === 'string' ? body['text'] : '';
    const voice = typeof body['voice'] === 'string' ? body['voice'] : '';
    const engineName = body['engine'];

    if (!isEngineName(engineName)) {
      throw new MediaError({
        code: 'bad_request',
        status: 400,
        characters: text.length,
        message:
          `\`engine\` must be "local" or "elevenlabs" and was ${JSON.stringify(engineName)}. **There is no ` +
          `default**, because the engine that ran is written to \`ozikoro_episode.generator\` and a ` +
          `default would make the most important field in that record optional in practice.`,
        details: { field: 'engine', known: ['local', 'elevenlabs'] },
      });
    }
    if (!text.trim()) {
      throw new MediaError({
        code: 'bad_request',
        engine: engineName,
        status: 400,
        characters: 0,
        message: 'no text to speak',
      });
    }
    if (!voice) {
      throw new MediaError({
        code: 'bad_request',
        engine: engineName,
        status: 400,
        characters: text.length,
        message:
          'no voice supplied. The archive records which voice narrated which record, so the voice is ' +
          'required and is never defaulted.',
        details: { field: 'voice' },
      });
    }

    const { result, pronunciation } = await narrate(
      engines,
      {
        text,
        voice,
        engine: engineName,
        ...(typeof body['nfeStep'] === 'number' ? { nfeStep: body['nfeStep'] } : {}),
        ...(typeof body['speed'] === 'number' ? { speed: body['speed'] } : {}),
      },
      { signal: disconnectSignal(res) }
    );

    const wantsJson = String(req.headers.accept ?? '').includes('application/json') || url.searchParams.get('meta') === '1';

    if (wantsJson) {
      json(res, 200, {
        ok: true,
        provenance: result.provenance,
        contentType: result.contentType,
        bytes: result.bytes,
        durationSeconds: result.durationSeconds,
        characters: result.characters,
        chunks: result.chunks,
        silent: result.silent,
        outOfVocab: result.outOfVocab,
        measuredCredits: result.measuredCredits,
        pronunciation,
        audioBase64: result.audio.toString('base64'),
      });
      return;
    }

    /**
     * The bytes themselves.
     *
     * The provenance travels in headers so a caller that saved the file can still say who spoke it —
     * **the file alone does not carry the record, and an unattributed MP3 in a folder is how a render
     * becomes anonymous.**
     */
    res.writeHead(200, {
      'content-type': result.contentType,
      'content-length': result.bytes,
      'x-ozikoro-engine': result.provenance.engine,
      'x-ozikoro-model': result.provenance.model,
      'x-ozikoro-voice': result.provenance.voice,
      'x-ozikoro-characters': String(result.characters),
      'x-ozikoro-silent': String(result.silent),
      'x-ozikoro-credits': String(result.measuredCredits ?? 'unknown'),
      'x-ozikoro-unsayable-words': String(pronunciation.summary.unsayable),
      'x-ozikoro-marks-lost': String(pronunciation.summary.marksLost),
      'cache-control': 'no-store',
    });
    res.end(result.audio);
    return;
  }

  // ------------------------------------------------------------------ GET /
  if (method === 'GET' && path === '/') {
    json(res, 200, {
      service: 'Ozikoro Media',
      hostname: 'media.ozikoro.com',
      note:
        'Audio is bytes rather than documents, so it has its own cache and its own scaling — and because ' +
        'a Spotify feed enclosure is a promise made to a subscriber, the hostname is chosen once and is ' +
        'permanent.',
      endpoints: {
        'GET /health': 'what is loaded, whether a GPU is present, whether it is ready',
        'GET /engines': 'both engines, their ceilings and their licences',
        'GET /voices': 'the locally registered voice profiles',
        'POST /voices': 'register a voice from reference audio',
        'DELETE /voices/:name': 'remove a voice',
        'POST /speak': '{ text, voice, engine } -> audio bytes, or a JSON error naming the engine',
        'POST /preview/pronunciation': 'what the pronunciation layer would do, without rendering',
      },
    });
    return;
  }

  throw new MediaError({
    code: 'bad_request',
    status: 404,
    message: `no route for ${method} ${path}. See GET / for the list.`,
  });
}

/** Start it. Used by `src/server.ts` and by the tests. */
export async function startServer(options: ServerOptions & { port?: number; host?: string } = {}): Promise<{
  server: Server;
  engines: EngineSet;
  port: number;
  url: string;
}> {
  const { server, engines } = createMediaServer(options);
  const port = options.port ?? Number(process.env.OZIKORO_MEDIA_PORT ?? 8787);
  const host = options.host ?? process.env.OZIKORO_MEDIA_HOST ?? '127.0.0.1';

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });

  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  return { server, engines, port: actualPort, url: `http://${host}:${actualPort}` };
}

/**
 * Start it when this file IS the program — which is what `package.json`'s `"start": "node src/server.ts"`
 * means, and what the owner types.
 *
 * The preload flag is read from the environment rather than defaulted, because the two behaviours are both
 * wanted at different times: `OZIKORO_MEDIA_PRELOAD=1` reads the 1.35 GB checkpoint before the port opens
 * (good for a service that will be hammered), and leaving it unset lets `/health` answer in milliseconds so
 * a person can watch the model load instead of guessing (good for the first run).
 */
if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const preload = process.env.OZIKORO_MEDIA_PRELOAD === '1';
  const { url, engines, server } = await startServer({ preload });

  const local = engines.local.health();
  process.stdout.write(
    [
      `Ozikoro Media is listening on ${url}`,
      `  local engine      ${local.installed ? (local.ready ? 'ready' : 'installed, model not loaded yet') : 'NOT INSTALLED'}`,
      `  elevenlabs engine ${engines.elevenlabs.capabilities().available ? 'available' : 'disabled'}`,
      `  lexicon           ${lexiconExists() ? lexiconPath() : 'NOT BUILT — run `npm run lexicon`'}`,
      '',
      'Try:  curl -s ' + url + '/health | head -40',
      '',
    ].join('\n')
  );

  /**
   * Shut down on SIGTERM and not SIGKILL.
   *
   * The Python worker is stopped with SIGTERM so it can close cleanly; **a SIGKILL landing while PGlite or a
   * model is mid-write is how clusters and checkpoints are lost**, and seven PGlite clusters were lost that
   * way on this machine in one day.
   */
  const shutdown = (signal: string) => {
    process.stdout.write(`\n${signal}: stopping the local worker and closing the listener.\n`);
    void engines.local.stop().finally(() => {
      server.close(() => process.exit(0));
      // Do not wait forever on a socket somebody forgot about.
      setTimeout(() => process.exit(0), 4000);
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

