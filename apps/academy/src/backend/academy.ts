/**
 * Enrolment, progress and attempts.
 *
 * Each function takes `accountId` explicitly rather than reading it from a request. That is
 * deliberate: authorisation belongs at the boundary where the session is resolved, and a data
 * function that reaches for ambient request state is one that can be called without a session by
 * accident. The only caller is `./functions.ts`, which resolves the session first and passes the id.
 */
import { one, query, rows, transaction } from "./db.ts";

export interface Enrolment {
  courseSlug: string;
  status: string;
  enrolledAt: string;
  completedAt: string | null;
}

export interface LessonProgress {
  courseSlug: string;
  lessonSlug: string;
  state: string;
  position: number;
  updatedAt: string;
}

export interface CourseProgress {
  courseSlug: string;
  lessons: LessonProgress[];
  /** Completed lessons divided by the number the course declares, or null when it declares none. */
  completed: number;
  total: number | null;
}

export interface Attempt {
  id: number;
  courseSlug: string;
  activitySlug: string;
  kind: string;
  score: number | null;
  maxScore: number | null;
  createdAt: string;
}

function toEnrolment(row: Record<string, unknown>): Enrolment {
  return {
    courseSlug: String(row.course_slug),
    status: String(row.status),
    enrolledAt: String(row.enrolled_at),
    completedAt: (row.completed_at as string | null) ?? null,
  };
}

/**
 * Enrol a learner, or return the enrolment they already have.
 *
 * `on conflict do nothing` followed by a select, rather than `on conflict do update`: enrolling
 * twice is not an event, and an update would move `enrolled_at` and quietly rewrite when somebody
 * started a course. The unique constraint added with the table is what makes this safe under a
 * double-click, where two requests race and one of them must lose.
 */
export async function enrol(accountId: number, courseSlug: string): Promise<Enrolment> {
  await query(
    `insert into academy_enrolment (account_id, course_slug)
     values ($1, $2)
     on conflict (account_id, course_slug) do nothing`,
    [accountId, courseSlug]
  );

  const row = await one<Record<string, unknown>>(
    `select course_slug, status, enrolled_at, completed_at
       from academy_enrolment
      where account_id = $1 and course_slug = $2`,
    [accountId, courseSlug]
  );

  if (!row) throw new Error("enrolment could not be created");
  return toEnrolment(row);
}

export async function listEnrolments(accountId: number): Promise<Enrolment[]> {
  const found = await rows<Record<string, unknown>>(
    `select course_slug, status, enrolled_at, completed_at
       from academy_enrolment
      where account_id = $1 and status <> 'withdrawn'
      order by enrolled_at desc`,
    [accountId]
  );
  return found.map(toEnrolment);
}

export async function withdraw(accountId: number, courseSlug: string): Promise<boolean> {
  const result = await query(
    `update academy_enrolment
        set status = 'withdrawn'
      where account_id = $1 and course_slug = $2 and status <> 'withdrawn'`,
    [accountId, courseSlug]
  );
  return result.rowCount > 0;
}

/**
 * Record how far through a lesson a learner is.
 *
 * Upsert rather than insert because progress is a position, not an event — reopening a lesson must
 * move the existing row, not add another. `position` is clamped into [0, 1] here rather than
 * trusted, since it arrives from the client and drives the "resume where you left off" display.
 */
export async function setProgress(
  accountId: number,
  courseSlug: string,
  lessonSlug: string,
  state: "in_progress" | "completed",
  position: number
): Promise<LessonProgress> {
  const clamped = Number.isFinite(position) ? Math.min(1, Math.max(0, position)) : 0;

  const row = await one<Record<string, unknown>>(
    `insert into academy_progress (account_id, course_slug, lesson_slug, state, position)
     values ($1, $2, $3, $4, $5)
     on conflict (account_id, course_slug, lesson_slug)
     do update set state = excluded.state,
                   position = excluded.position,
                   updated_at = now()
     returning course_slug, lesson_slug, state, position, updated_at`,
    [accountId, courseSlug, lessonSlug, state, clamped]
  );

  if (!row) throw new Error("progress could not be recorded");

  // A finished course is recorded once, on the transition, so `completed_at` keeps meaning "when
  // this was finished" instead of being rewritten by every later visit.
  if (state === "completed") {
    await query(
      `update academy_enrolment
          set status = 'completed', completed_at = coalesce(completed_at, now())
        where account_id = $1 and course_slug = $2`,
      [accountId, courseSlug]
    );
  }

  return {
    courseSlug: String(row.course_slug),
    lessonSlug: String(row.lesson_slug),
    state: String(row.state),
    position: Number(row.position),
    updatedAt: String(row.updated_at),
  };
}

export async function listProgress(accountId: number, courseSlug?: string): Promise<LessonProgress[]> {
  const found = courseSlug
    ? await rows<Record<string, unknown>>(
        `select course_slug, lesson_slug, state, position, updated_at
           from academy_progress
          where account_id = $1 and course_slug = $2
          order by updated_at desc`,
        [accountId, courseSlug]
      )
    : await rows<Record<string, unknown>>(
        `select course_slug, lesson_slug, state, position, updated_at
           from academy_progress
          where account_id = $1
          order by updated_at desc`,
        [accountId]
      );

  return found.map((row) => ({
    lessonSlug: String(row.lesson_slug),
    state: String(row.state),
    position: Number(row.position),
    updatedAt: String(row.updated_at),
  }));
}

/**
 * Record an attempt, and return it.
 *
 * The score is validated against its maximum rather than stored as given: a client that reports 12
 * out of 10 corrupts every average computed from this table later, and the corruption is invisible
 * because both columns look like numbers.
 */
export async function recordAttempt(
  accountId: number,
  input: {
    courseSlug: string;
    activitySlug: string;
    kind: "practice" | "assessment" | "diagnostic" | "challenge";
    score?: number | null;
    maxScore?: number | null;
    answers?: unknown;
  }
): Promise<Attempt> {
  let score = input.score ?? null;
  const maxScore = input.maxScore ?? null;
  if (score !== null && maxScore !== null && maxScore >= 0) {
    score = Math.min(Math.max(0, score), maxScore);
  }

  const row = await one<Record<string, unknown>>(
    `insert into academy_attempt (account_id, course_slug, activity_slug, kind, score, max_score, answers)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning id, course_slug, activity_slug, kind, score, max_score, created_at`,
    [
      accountId,
      input.courseSlug,
      input.activitySlug,
      input.kind,
      score,
      maxScore,
      input.answers === undefined ? null : JSON.stringify(input.answers),
    ]
  );

  if (!row) throw new Error("attempt could not be recorded");

  return {
    id: Number(row.id),
    courseSlug: String(row.course_slug),
    activitySlug: String(row.activity_slug),
    kind: String(row.kind),
    score: row.score === null ? null : Number(row.score),
    maxScore: row.max_score === null ? null : Number(row.max_score),
    createdAt: String(row.created_at),
  };
}

export async function listAttempts(accountId: number, limit = 50): Promise<Attempt[]> {
  const found = await rows<Record<string, unknown>>(
    `select id, course_slug, activity_slug, kind, score, max_score, created_at
       from academy_attempt
      where account_id = $1
      order by created_at desc
      limit $2`,
    [accountId, Math.min(Math.max(1, limit), 200)]
  );

  return found.map((row) => ({
    id: Number(row.id),
    courseSlug: String(row.course_slug),
    activitySlug: String(row.activity_slug),
    kind: String(row.kind),
    score: row.score === null ? null : Number(row.score),
    maxScore: row.max_score === null ? null : Number(row.max_score),
    createdAt: String(row.created_at),
  }));
}

/**
 * Everything "My Learning" needs, in one round trip.
 *
 * Three queries rather than one join because the shapes differ — an enrolment with many progress
 * rows is a fan-out that would repeat the enrolment for every lesson, and the attempt list is
 * capped independently. They run in one transaction so the page cannot render an enrolment whose
 * progress was read a moment before it existed.
 */
export async function learningSummary(accountId: number): Promise<{
  enrolments: Enrolment[];
  progress: LessonProgress[];
  attempts: Attempt[];
}> {
  return transaction(async (client) => {
    // THE THREE QUERIES RUN IN SEQUENCE, NOT IN PARALLEL, AND THAT IS THE FIX RATHER THAN A
    // PREFERENCE.
    //
    // The first version awaited them with `Promise.all` on this one client. A `PoolClient` is a
    // single Postgres connection and cannot execute two statements at once, so node-postgres queues
    // them and warns "Calling client.query() when the client is already executing a query is
    // deprecated and will be removed in pg@9.0" — which is what the production log filled with,
    // alongside the 500s that followed. They are inside one transaction either way, so the
    // consistent view this function wants is preserved; running them one after another is what makes
    // that view reachable without relying on a deprecated queue.
    const enrolmentResult = await client.query(
      `select course_slug, status, enrolled_at, completed_at
         from academy_enrolment
        where account_id = $1 and status <> 'withdrawn'
        order by enrolled_at desc`,
      [accountId]
    );

    const progressResult = await client.query(
      `select course_slug, lesson_slug, state, position, updated_at
         from academy_progress
        where account_id = $1
        order by updated_at desc`,
      [accountId]
    );

    const attemptResult = await client.query(
      `select id, course_slug, activity_slug, kind, score, max_score, created_at
         from academy_attempt
        where account_id = $1
        order by created_at desc
        limit 50`,
      [accountId]
    );

    return {
      enrolments: enrolmentResult.rows.map(toEnrolment),
      progress: progressResult.rows.map((row: Record<string, unknown>) => ({
        courseSlug: String(row.course_slug),
        lessonSlug: String(row.lesson_slug),
        state: String(row.state),
        position: Number(row.position),
        updatedAt: String(row.updated_at),
      })),
      attempts: attemptResult.rows.map((row: Record<string, unknown>) => ({
        id: Number(row.id),
        courseSlug: String(row.course_slug),
        activitySlug: String(row.activity_slug),
        kind: String(row.kind),
        score: row.score === null ? null : Number(row.score),
        maxScore: row.max_score === null ? null : Number(row.max_score),
        createdAt: String(row.created_at),
      })),
    };
  });
}
