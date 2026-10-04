/**
 * Every way this service can fail, said plainly.
 *
 * THE RULE THIS FILE ENFORCES
 *
 * *An error must name the engine, the model, the size of the input and the reason.* A narration that
 * fails with "something went wrong" cannot be acted on, and in this archive it is worse than that: the
 * whole position of the project is that **the record says what happened**. An episode that says
 * "narrated by ElevenLabs" when the request silently fell through to a different engine makes the
 * record a lie, and a listener has no way to check.
 *
 * So there is no fallback anywhere in this service. If the engine a request names cannot answer, the
 * request fails and says so. `Engine` is echoed in the error so a caller that hedged its bets cannot
 * mistake which one refused.
 */

/** The two engines. The name is the contract: it is recorded on every episode and returned on every error. */
export type EngineName = 'elevenlabs' | 'local';

export function isEngineName(value: unknown): value is EngineName {
  return value === 'elevenlabs' || value === 'local';
}

export type MediaErrorCode =
  /** The request is malformed or names something that does not exist. */
  | 'bad_request'
  /** The named engine is not configured on this host (no key, no model). */
  | 'engine_unavailable'
  /** The text is longer than the ceiling for this engine. */
  | 'text_too_long'
  /** Too many renders are already running; the service refuses rather than queueing without bound. */
  | 'busy'
  /** The render exceeded its time budget and was abandoned. */
  | 'timeout'
  /** The render failed upstream or in the model, with the reason. */
  | 'render_failed'
  /** A voice was named that is not registered. */
  | 'unknown_voice'
  /** Nothing went wrong; this is a bug in the service. */
  | 'internal';

export type MediaErrorBody = {
  error: {
    code: MediaErrorCode;
    message: string;
    /** Which engine refused. **Always present** — a caller must never have to guess. */
    engine: EngineName | null;
    /** The model that would have done the work, when one is known. */
    model: string | null;
    /** The size of the input that was refused, so "too long" is a number rather than an adjective. */
    characters: number | null;
    /** Extra facts: the upstream status, the voice, the limits in force. */
    details: Record<string, unknown> | null;
  };
};

/**
 * The service's one exception type.
 *
 * Extends `Error` so it propagates and prints normally, and carries a status so the HTTP layer never
 * has to map strings to status codes in a second place.
 */
export class MediaError extends Error {
  readonly status: number;
  readonly code: MediaErrorCode;
  readonly engine: EngineName | null;
  readonly model: string | null;
  readonly characters: number | null;
  readonly details: Record<string, unknown> | null;

  constructor(init: {
    status?: number;
    code: MediaErrorCode;
    message: string;
    engine?: EngineName | null;
    model?: string | null;
    characters?: number | null;
    details?: Record<string, unknown> | null;
  }) {
    super(init.message);
    this.name = 'MediaError';
    this.status = init.status ?? 400;
    this.code = init.code;
    this.engine = init.engine ?? null;
    this.model = init.model ?? null;
    this.characters = init.characters ?? null;
    this.details = init.details ?? null;
  }

  toBody(): MediaErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        engine: this.engine,
        model: this.model,
        characters: this.characters,
        details: this.details,
      },
    };
  }
}

export function isMediaError(value: unknown): value is MediaError {
  return value instanceof MediaError;
}

/**
 * Turn anything thrown into a response body.
 *
 * A non-`MediaError` is reported as `internal` **with its real message** rather than a generic one —
 * this is a self-hosted service for its owner, and hiding a stack trace behind "unexpected error" costs
 * more time than it saves. The message is still not a credential.
 */
export function toErrorBody(error: unknown): { status: number; body: MediaErrorBody } {
  if (isMediaError(error)) return { status: error.status, body: error.toBody() };
  const message = error instanceof Error ? error.message : String(error);
  return {
    status: 500,
    body: {
      error: { code: 'internal', message, engine: null, model: null, characters: null, details: null },
    },
  };
}
