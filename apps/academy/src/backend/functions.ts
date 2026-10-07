/**
 * The Academy's server functions.
 *
 * This is the only place a session is read and the only place authorisation is decided. Every
 * function below either establishes who is asking (`currentUser`) or refuses when nobody is
 * (`requireAccount`); the data functions in `./academy.ts` take an `accountId` they cannot obtain
 * themselves. That split is what stops a route from accidentally reading another learner's progress:
 * there is no ambient "current account" for a data function to reach for.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader, setResponseHeader } from "@tanstack/start-server-core";
import { AccountError, changeOwnPassword } from "./passwords.ts";
import { authenticateAccount, registerAccount, type Account } from "./accounts.ts";
import {
  SESSION_COOKIE,
  createSession,
  resolveSession,
  revokeSession,
  sessionCookieOptions,
  sessionMaxAgeSeconds,
} from "./session.ts";
import { clearedCookie, readCookie, serialiseCookie } from "./cookies.ts";
import { masteryFromRecord, type ConceptRecord, type MasteryLevel } from "./mastery.ts";
import {
  conceptRecords,
  enrol,
  learningSummary,
  listProgress,
  recordAttempt,
  setProgress,
  withdraw,
  type Attempt,
  type Enrolment,
  type LessonProgress,
} from "./academy.ts";

// ---------------------------------------------------------------------------
// Session plumbing
// ---------------------------------------------------------------------------

function sessionToken(): string | undefined {
  return readCookie(getRequestHeader("cookie"), SESSION_COOKIE);
}

/**
 * The signed-in account, wrapped so that "nobody" is a value rather than an absence.
 *
 * THE WRAPPER IS NOT DECORATION. This returned a bare `Account | null`, and `null` is what a
 * signed-out visitor gets — the majority case. Seroval cannot serialise that as the result of a
 * server function: a GET to this endpoint with no session produced
 *
 *   500, an HTML error page, and "Error: Internal Server Error" in the log
 *
 * while a GET with a valid session returned 200. Server-side rendering never noticed, because the
 * loader runs in-process there; only the RPC path fails, which is the path a client-side navigation
 * takes. So clicking a link to /account or a course page while signed out was broken, and every full
 * page load looked fine.
 *
 * Returning an object makes the empty case a normal value. Never throws — pages render signed out.
 */
export const currentUser = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ account: Account | null }> => {
    const session = await resolveSession(sessionToken());
    return {
      account: session
        ? {
            id: session.id,
            email: session.email,
            displayName: session.displayName,
            role: session.role,
            status: session.status,
          }
        : null,
    };
  }
);

/**
 * The signed-in account, or a refusal.
 *
 * Throws rather than returning null so a caller cannot forget to check. The message is deliberately
 * the same one for "no cookie" and "expired session": a caller that distinguishes them would leak
 * whether a session ever existed.
 */
async function requireAccount(): Promise<Account> {
  const session = await resolveSession(sessionToken());
  if (!session) {
    throw new Error("not_signed_in");
  }
  return {
    id: session.id,
    email: session.email,
    displayName: session.displayName,
    role: session.role,
    status: session.status,
  };
}

function setSessionCookie(token: string): void {
  setResponseHeader(
    "set-cookie",
    serialiseCookie(SESSION_COOKIE, token, sessionCookieOptions(sessionMaxAgeSeconds()))
  );
}

function clearSessionCookie(): void {
  setResponseHeader("set-cookie", clearedCookie(SESSION_COOKIE, sessionCookieOptions()));
}

/**
 * Turn an expected failure into a value the browser can render.
 *
 * Server-function errors cross a serialisation boundary where only the message survives, so the
 * codes `AccountError` carries would otherwise be lost and the page would have to match on English
 * prose. Returning a discriminated result keeps the code intact.
 */
type ActionResult<T> = { ok: true; data: T } | { ok: false; code: string; message: string };

function failure(error: unknown): { ok: false; code: string; message: string } {
  if (error instanceof AccountError) {
    return { ok: false, code: error.code, message: error.message };
  }
  if (error instanceof Error && error.message === "not_signed_in") {
    return { ok: false, code: "not_signed_in", message: "Please sign in to continue." };
  }
  console.error("academy: server function failed", error);
  return { ok: false, code: "internal", message: "Something went wrong. Please try again." };
}

/**
 * A required identifier, or a refusal.
 *
 * Server functions are a public boundary: anything that can reach the endpoint can send any shape.
 * Without this, a payload missing `activitySlug` reached the insert and came back as
 * `null value in column "activity_slug" violates not-null constraint` — a 500 whose cause is a
 * database detail, logged as an internal error rather than a bad request.
 */
function requireSlug(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new AccountError("invalid_request", `${field} is required.`);
  }
  if (value.length > 200) {
    throw new AccountError("invalid_request", `${field} is too long.`);
  }
  return value.trim();
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export const signUp = createServerFn({ method: "POST" })
  .validator((input: { email: string; password: string; displayName?: string }) => input)
  .handler(async ({ data }): Promise<ActionResult<Account>> => {
    try {
      const account = await registerAccount(data);
      const session = await createSession(account.id, {
        userAgent: getRequestHeader("user-agent") ?? null,
        ipAddress: getRequestHeader("x-forwarded-for") ?? getRequestHeader("x-real-ip") ?? null,
      });
      setSessionCookie(session.token);
      return { ok: true, data: account };
    } catch (error) {
      return failure(error);
    }
  });

export const signIn = createServerFn({ method: "POST" })
  .validator((input: { email: string; password: string }) => input)
  .handler(async ({ data }): Promise<ActionResult<Account>> => {
    try {
      const account = await authenticateAccount(data.email, data.password);
      if (!account) {
        // One message for a wrong password and an unknown address, so this cannot be used to
        // discover which email addresses have accounts.
        return {
          ok: false,
          code: "invalid_credentials",
          message: "That email address and password do not match an account.",
        };
      }
      const session = await createSession(account.id, {
        userAgent: getRequestHeader("user-agent") ?? null,
        ipAddress: getRequestHeader("x-forwarded-for") ?? getRequestHeader("x-real-ip") ?? null,
      });
      setSessionCookie(session.token);
      return { ok: true, data: account };
    } catch (error) {
      return failure(error);
    }
  });

export const signOut = createServerFn({ method: "POST" }).handler(
  async (): Promise<ActionResult<null>> => {
    await revokeSession(sessionToken());
    clearSessionCookie();
    return { ok: true, data: null };
  }
);

/**
 * ── A CEILING ON GUESSING THE CURRENT PASSWORD ───────────────────────────────────────────────────────
 *
 * The change-password form is the one place a signed-in caller can ask "is this the current password?" and
 * be told the answer, which makes it an oracle: **a borrowed session plus an unmetered form is a way to
 * brute-force the password of the account it was borrowed from, and then keep the account.** Ten attempts in
 * five minutes is more than an honest typist reaches and less than a guesser can use.
 *
 * The window lives in THIS PROCESS'S MEMORY, so with several instances behind a load balancer each instance
 * allows the full quota and the real ceiling is multiplied. **That is stated rather than left to be
 * discovered**, and it is the same trade `apps/ozikoro/lib/rate-limit.ts` makes for the same reason: the
 * alternative is a shared store or a database round trip on every attempt. If the Academy later runs several
 * instances and the ceiling matters, the fix is one table with a per-key counter — not a bigger window.
 */
const attempts = new Map<string, { count: number; resetAt: number }>();

/** Ceiling on tracked keys, so the map cannot grow without bound. */
const MAX_ATTEMPT_KEYS = 5_000;

function tooManyAttempts(key: string, limit = 10, windowSeconds = 300): boolean {
  const now = Date.now();
  const window = attempts.get(key);
  if (!window || window.resetAt <= now) {
    if (attempts.size >= MAX_ATTEMPT_KEYS) attempts.clear();
    attempts.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return false;
  }
  window.count += 1;
  return window.count > limit;
}

/**
 * CHANGE THE PASSWORD OF THE ACCOUNT YOU ARE ALREADY SIGNED IN AS.
 *
 * THE CURRENT PASSWORD IS REQUIRED, AND THAT IS THE WHOLE POINT. The session proves that *a* browser signed
 * in at some point; the current password is the only thing that proves *this person* is the account holder.
 * A form that swapped the password without the old one would turn a borrowed session into a permanent
 * takeover — see the long note on `changeOwnPassword`.
 *
 * `changeOwnPassword` throws `AccountError('wrong_password')` and `failure()` already turns that into a
 * code the page can render, so the refusal is the library's sentence rather than one invented here.
 */
export const changePassword = createServerFn({ method: "POST" })
  .validator(
    (input: { currentPassword: string; newPassword: string; confirmPassword: string }) => input
  )
  .handler(async ({ data }): Promise<ActionResult<null>> => {
    try {
      const account = await requireAccount();

      if (tooManyAttempts(`change-password:${account.id}`)) {
        return {
          ok: false,
          code: "rate_limited",
          message: "Too many attempts. Wait a few minutes and try again.",
        };
      }

      // Checked here rather than in the library because it is a property of this form, not of the password:
      // `changeOwnPassword` never sees the second field.
      if (data.newPassword !== data.confirmPassword) {
        return { ok: false, code: "mismatch", message: "The two new passwords are not the same." };
      }

      await changeOwnPassword(account.id, data.currentPassword, data.newPassword, {
        userAgent: getRequestHeader("user-agent") ?? null,
        ipAddress: getRequestHeader("x-forwarded-for") ?? getRequestHeader("x-real-ip") ?? null,
        // The session doing the changing is the one that survives; every OTHER session is closed.
        keepSessionToken: sessionToken() ?? null,
      });

      return { ok: true, data: null };
    } catch (error) {
      return failure(error);
    }
  });

// ---------------------------------------------------------------------------
// Learning
// ---------------------------------------------------------------------------

export const enrolInCourse = createServerFn({ method: "POST" })
  .validator((input: { courseSlug: string }) => input)
  .handler(async ({ data }): Promise<ActionResult<Enrolment>> => {
    try {
      const account = await requireAccount();
      return { ok: true, data: await enrol(account.id, requireSlug(data.courseSlug, "courseSlug")) };
    } catch (error) {
      return failure(error);
    }
  });

export const leaveCourse = createServerFn({ method: "POST" })
  .validator((input: { courseSlug: string }) => input)
  .handler(async ({ data }): Promise<ActionResult<{ withdrawn: boolean }>> => {
    try {
      const account = await requireAccount();
      return { ok: true, data: { withdrawn: await withdraw(account.id, requireSlug(data.courseSlug, "courseSlug")) } };
    } catch (error) {
      return failure(error);
    }
  });

export const saveProgress = createServerFn({ method: "POST" })
  .validator(
    (input: {
      courseSlug: string;
      lessonSlug: string;
      state: "in_progress" | "completed";
      position?: number;
    }) => input
  )
  .handler(async ({ data }): Promise<ActionResult<LessonProgress>> => {
    try {
      const account = await requireAccount();
      return {
        ok: true,
        data: await setProgress(
          account.id,
          requireSlug(data.courseSlug, "courseSlug"),
          requireSlug(data.lessonSlug, "lessonSlug"),
          data.state,
          data.position ?? (data.state === "completed" ? 1 : 0)
        ),
      };
    } catch (error) {
      return failure(error);
    }
  });

export const submitAttempt = createServerFn({ method: "POST" })
  .validator(
    (input: {
      courseSlug: string;
      activitySlug: string;
      kind: "practice" | "assessment" | "diagnostic" | "challenge";
      score?: number | null;
      maxScore?: number | null;
      answers?: unknown;
    }) => input
  )
  .handler(async ({ data }): Promise<ActionResult<Attempt>> => {
    try {
      const account = await requireAccount();
      return {
        ok: true,
        data: await recordAttempt(account.id, {
          ...data,
          courseSlug: requireSlug(data.courseSlug, "courseSlug"),
          activitySlug: requireSlug(data.activitySlug, "activitySlug"),
        }),
      };
    } catch (error) {
      return failure(error);
    }
  });

/** Everything "My Learning" needs, for the signed-in learner. */
export const myLearning = createServerFn({ method: "GET" }).handler(
  async (): Promise<
    ActionResult<{ enrolments: Enrolment[]; progress: LessonProgress[]; attempts: Attempt[] }>
  > => {
    try {
      const account = await requireAccount();
      return { ok: true, data: await learningSummary(account.id) };
    } catch (error) {
      return failure(error);
    }
  }
);

/** Progress for one course, so a course page can show the learner's position in it. */
export const courseProgress = createServerFn({ method: "GET" })
  .validator((input: { courseSlug: string }) => input)
  .handler(async ({ data }): Promise<ActionResult<LessonProgress[]>> => {
    try {
      const account = await requireAccount();
      return { ok: true, data: await listProgress(account.id, requireSlug(data.courseSlug, "courseSlug")) };
    } catch (error) {
      // Signed out is not a failure for a course page: it renders the public syllabus and an enrol
      // button instead of a progress bar.
      if (error instanceof Error && error.message === "not_signed_in") {
        return { ok: true, data: [] };
      }
      return failure(error);
    }
  });

// ---------------------------------------------------------------------------
// Mastery
// ---------------------------------------------------------------------------

/**
 * Every concept, with the learner's real state in it.
 *
 * Returns the record alongside the level so a page can say WHY a concept sits where it does — "4 of
 * 5 correct" is accountable, a bare badge is not. Signed-out callers get the level "Not started" for
 * everything rather than a refusal, because the mastery page is readable without an account and
 * should show what it would look like.
 */
export const myMastery = createServerFn({ method: "GET" }).handler(
  async (): Promise<{
    signedIn: boolean;
    concepts: Record<string, { level: MasteryLevel; record: ConceptRecord | null }>;
  }> => {
    const session = await resolveSession(sessionToken());

    if (!session) {
      return { signedIn: false, concepts: {} };
    }

    const records = await conceptRecords(session.id);
    const concepts: Record<string, { level: MasteryLevel; record: ConceptRecord | null }> = {};
    for (const [slug, record] of Object.entries(records)) {
      concepts[slug] = { level: masteryFromRecord(record), record };
    }
    return { signedIn: true, concepts };
  }
);
