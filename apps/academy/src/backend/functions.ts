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
import { AccountError } from "./passwords.ts";
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
import {
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

/** The signed-in account, or null. Never throws — used by pages that render signed-out too. */
export const currentUser = createServerFn({ method: "GET" }).handler(
  async (): Promise<Account | null> => {
    const session = await resolveSession(sessionToken());
    return session
      ? {
          id: session.id,
          email: session.email,
          displayName: session.displayName,
          role: session.role,
          status: session.status,
        }
      : null;
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

// ---------------------------------------------------------------------------
// Learning
// ---------------------------------------------------------------------------

export const enrolInCourse = createServerFn({ method: "POST" })
  .validator((input: { courseSlug: string }) => input)
  .handler(async ({ data }): Promise<ActionResult<Enrolment>> => {
    try {
      const account = await requireAccount();
      return { ok: true, data: await enrol(account.id, data.courseSlug) };
    } catch (error) {
      return failure(error);
    }
  });

export const leaveCourse = createServerFn({ method: "POST" })
  .validator((input: { courseSlug: string }) => input)
  .handler(async ({ data }): Promise<ActionResult<{ withdrawn: boolean }>> => {
    try {
      const account = await requireAccount();
      return { ok: true, data: { withdrawn: await withdraw(account.id, data.courseSlug) } };
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
          data.courseSlug,
          data.lessonSlug,
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
      return { ok: true, data: await recordAttempt(account.id, data) };
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
      return { ok: true, data: await listProgress(account.id, data.courseSlug) };
    } catch (error) {
      // Signed out is not a failure for a course page: it renders the public syllabus and an enrol
      // button instead of a progress bar.
      if (error instanceof Error && error.message === "not_signed_in") {
        return { ok: true, data: [] };
      }
      return failure(error);
    }
  });
