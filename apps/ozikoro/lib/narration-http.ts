/**
 * One shape for the narration endpoints, so a form and a program see the same rules.
 *
 * WHY BOTH, RATHER THAN TWO SETS OF ROUTES
 *
 * The review screen is a server-rendered page whose buttons are ordinary HTML forms, and the same acts have to
 * be available to `scripts/narration-review.ts` and to any future caller. **Two endpoints per action would be
 * two places for the capability check to be forgotten** — which is the failure mode `/api/admin/archive` was
 * written to avoid. So each endpoint reads either a JSON body or a form body, and answers in the shape the
 * caller can use: a 303 back to the page with a notice, or JSON with a status.
 *
 * THE CAPABILITY CHECK IS SHARED FOR THE SAME REASON.
 *
 * `guardNarration` is the first thing every route calls. **An endpoint that checked a role name inline would
 * be a second definition of who may touch audio**, and the two would drift.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@ozituma/db/client';
import { can } from '@ozikoro/platform';
import { getCurrentAccount } from './session';
import { redirectTo } from './access';

export type ActionInput = {
  /** Every field as a string, whether it arrived as JSON or as form data. */
  data: Record<string, string>;
  /** True when the caller was a browser form, which wants a redirect rather than a JSON body. */
  isForm: boolean;
  /** Where a form caller should be returned to. Relative only — `redirectTo` refuses anything else. */
  returnTo: string;
};

/** Reads a request body of either kind into one flat `Record<string, string>`. */
export async function readAction(request: Request, defaultReturnTo = '/admin/audio/'): Promise<ActionInput> {
  const contentType = request.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    const raw = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const data: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (value === null || value === undefined) continue;
      data[key] = typeof value === 'string' ? value : JSON.stringify(value);
    }
    return { data, isForm: false, returnTo: data.returnTo ?? defaultReturnTo };
  }

  const form = await request.formData();
  const data: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === 'string') data[key] = value;
  }
  return { data, isForm: true, returnTo: data.returnTo ?? defaultReturnTo };
}

export type ActionOutcome = {
  ok: boolean;
  /** The HTTP status for a JSON caller. Defaults to 200 when `ok`, 400 when not. */
  status?: number;
  payload?: Record<string, unknown>;
  /** What a form caller is told. One sentence, in the archive's own voice. */
  notice?: string;
};

/** Answers in the shape the caller can actually use. */
export function answerAction(input: ActionInput, outcome: ActionOutcome): Response {
  if (input.isForm) {
    return outcome.ok
      ? redirectTo(input.returnTo, { saved: outcome.notice ?? 'Done.' })
      : redirectTo(input.returnTo, { error: outcome.notice ?? 'That did not work, and nothing was changed.' });
  }
  return NextResponse.json(outcome.payload ?? { ok: outcome.ok }, {
    status: outcome.status ?? (outcome.ok ? 200 : 400),
    headers: { 'cache-control': 'no-store' },
  });
}

/**
 * The first thing every narration endpoint does: is there an account, and may it do this?
 *
 * **Returns a Response rather than throwing**, because "not signed in" and "signed in without the capability"
 * are different answers and a form caller needs a redirect while a JSON caller needs a status.
 */
export async function guardNarration(
  input: ActionInput,
  capability: string
): Promise<{ ok: true; actorId: number } | { ok: false; response: Response }> {
  const current = await getCurrentAccount();
  if (!current) {
    return {
      ok: false,
      response: answerAction(input, {
        ok: false,
        status: 403,
        payload: { error: 'Not signed in.' },
        notice: 'Sign in first.',
      }),
    };
  }

  const db = await getDb();
  if (!(await can(db, current.account.id, capability))) {
    return {
      ok: false,
      response: answerAction(input, {
        ok: false,
        status: 403,
        payload: { error: `Needs the “${capability}” capability.`, capability },
        notice: `That needs the “${capability.replace(/_/g, ' ')}” permission, which this account does not have.`,
      }),
    };
  }

  return { ok: true, actorId: current.account.id };
}

/** A domain error from `@ozikoro/platform`, as an answer. `MemberError` carries a code worth showing. */
export function memberErrorOutcome(error: unknown, fallbackStatus = 409): ActionOutcome {
  const message = error instanceof Error ? error.message : String(error);
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : 'failed';
  return {
    ok: false,
    status: code === 'no_article' || code === 'no_episode' ? 404 : fallbackStatus,
    payload: { error: message, code },
    notice: message,
  };
}
