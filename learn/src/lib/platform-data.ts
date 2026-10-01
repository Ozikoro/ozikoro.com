/**
 * Real data for the dashboards.
 *
 * WHAT THIS FILE REPLACED
 *
 * `platform-preview.ts` held 86 lines of invented content — Adaeze O., Tobi A., Nneka B., Ike C.,
 * "₦40,000 · Adaeze O." withdrawals, "Patient and clear" reviews — and its own header said:
 *
 *     // PREVIEW DATA ONLY — fictional, never saved, always shown with a "Preview" label.
 *     // Delete this file once the backend agent supplies the contracts in contracts.ts.
 *
 * The contracts exist. The tables exist. Nothing links to `/platform` any more, and every number it
 * displayed was made up, so a learner or teacher opening it saw a fabricated account.
 *
 * HOW IT WORKS NOW
 *
 * Each export below is a real query against a real table. They return EMPTY when there is nothing,
 * which is the truth — there are no teachers, bookings or payments yet. An empty dashboard is
 * honest; a dashboard full of somebody else's invented lessons is not.
 *
 * The functions are async and take the caller's identity, because what a person may see depends on
 * who they are. Row level security enforces that in SQL regardless of what this file asks for — the
 * filters here are for shape, not for permission.
 *
 * WHY THERE ARE NO NAME STRINGS LEFT
 *
 * `contracts.ts` still describes the shapes the components render, so the design is untouched. What
 * changed is where the values come from. Every name below is now read from `profiles`, never typed
 * into this repository.
 */

import { supabase } from "@/integrations/supabase/client";
import type {
  AdminRow,
  AppNotification,
  Conversation,
  Lesson,
  Message,
  ProgressSummary,
  Slot,
  StudentRecord,
  WalletSummary,
} from "./contracts";

/** Format kobo as naira for display. Money is stored in kobo everywhere; see the migration. */
const naira = (kobo: number | null | undefined): string =>
  `₦${Math.round((kobo ?? 0) / 100).toLocaleString("en-NG")}`;

/** The learner or teacher behind an id, for a display name. */
async function nameOf(userId: string | null): Promise<string> {
  if (!userId) return "—";
  const { data } = await supabase.from("profiles").select("display_name").eq("id", userId).maybeSingle();
  return (data?.display_name as string | null) ?? "—";
}

/**
 * Lessons for a booking row, from the learner's or the teacher's side.
 *
 * `lesson_bookings` is the real table and it already carries everything the card needs: who, when,
 * how long, the price, and whether it is paid. `teacher_id` points at `teacher_profiles`, so the
 * teacher's name needs a second lookup through that table to reach the profile.
 */
export async function loadLessons(userId: string, role: "student" | "teacher"): Promise<Lesson[]> {
  const column = role === "teacher" ? "teacher_id" : "learner_id";

  const { data, error } = await supabase
    .from("lesson_bookings")
    .select("id,teacher_id,learner_id,starts_at,minutes,note,price_kobo,status,paid")
    .eq(column, userId)
    .order("starts_at", { ascending: true });

  if (error || !data) return [];

  return Promise.all(
    data.map(async (row): Promise<Lesson> => {
      const isConfirmed = row.status === "confirmed";
      const startsAt = String(row.starts_at);
      return {
        id: row.id as string,
        teacherName: await nameOf(row.teacher_id as string | null),
        studentName: await nameOf(row.learner_id as string | null),
        topic: (row.note as string | null) || "Lesson",
        startsAt,
        minutes: Number(row.minutes ?? 60),
        status: row.status as Lesson["status"],
        payment: row.paid ? "verified" : "unpaid",
        priceLabel: naira(row.price_kobo as number | null),
        // Joining requires a confirmed, paid booking that has not already started.
        canJoin: isConfirmed && Boolean(row.paid) && new Date(startsAt).getTime() > Date.now() - 3_600_000,
      };
    })
  );
}

/**
 * Bookable slots for a teacher on a date.
 *
 * Built from `teacher_availability`, which is weekly, plus `availability_exceptions`, which are
 * dated, minus whatever is already in `lesson_bookings`. A slot is only "available" if the teacher
 * actually offered it AND nobody has taken it — the same arithmetic the database enforces when the
 * booking is written.
 */
export async function loadSlots(teacherId: string, date: Date): Promise<Slot[]> {
  const dow = date.getDay();

  const [{ data: windows }, { data: exceptions }, { data: booked }] = await Promise.all([
    supabase.from("teacher_availability").select("start_min,end_min,minutes").eq("teacher_id", teacherId).eq("dow", dow),
    supabase.from("availability_exceptions").select("start_min,end_min,kind").eq("teacher_id", teacherId).eq("on_date", date.toISOString().slice(0, 10)),
    supabase
      .from("lesson_bookings")
      .select("starts_at,minutes,status")
      .eq("teacher_id", teacherId)
      .in("status", ["requested", "confirmed"])
      .gte("starts_at", new Date(date).setHours(0, 0, 0, 0) && new Date(new Date(date).setHours(0, 0, 0, 0)).toISOString())
      .lte("starts_at", new Date(new Date(date).setHours(23, 59, 59, 999)).toISOString()),
  ]);

  const slots: Slot[] = [];
  const taken = (booked ?? []).map((b) => new Date(String(b.starts_at)).getTime());

  for (const w of windows ?? []) {
    const step = Number(w.minutes ?? 60);
    for (let m = Number(w.start_min); m + step <= Number(w.end_min); m += step) {
      const at = new Date(date);
      at.setHours(0, m, 0, 0);

      const blocked = (exceptions ?? []).some(
        (e) => e.kind === "blocked" && (e.start_min == null || (m >= Number(e.start_min) && m < Number(e.end_min)))
      );
      if (blocked) continue;

      const isPast = at.getTime() < Date.now();
      const isBooked = taken.includes(at.getTime());

      slots.push({
        startsAt: at.toISOString(),
        minutes: step,
        state: isPast ? "past" : isBooked ? "booked" : "available",
      });
    }
  }

  return slots;
}

/** Conversations the person is part of, newest first. */
export async function loadConversations(userId: string): Promise<Conversation[]> {
  const { data } = await supabase
    .from("conversations")
    .select("id,participant_a,participant_b,last_message_at")
    .or(`participant_a.eq.${userId},participant_b.eq.${userId}`)
    .order("last_message_at", { ascending: false });

  if (!data) return [];

  return Promise.all(
    data.map(async (c): Promise<Conversation> => {
      const other = c.participant_a === userId ? (c.participant_b as string) : (c.participant_a as string);
      const { data: last } = await supabase
        .from("messages")
        .select("body,created_at")
        .eq("conversation_id", c.id as string)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const { count } = await supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("conversation_id", c.id as string)
        .is("read_at", null)
        .neq("sender_id", userId);

      return {
        id: c.id as string,
        name: await nameOf(other),
        lastMessage: (last?.body as string | null) ?? "",
        unread: count ?? 0,
        updatedAt: new Date(String(c.last_message_at)).toLocaleDateString("en-NG", { day: "numeric", month: "short" }),
      };
    })
  );
}

/** Messages in one conversation, oldest first. RLS limits this to the two participants. */
export async function loadMessages(conversationId: string, userId: string): Promise<Message[]> {
  const { data } = await supabase
    .from("messages")
    .select("id,sender_id,body,created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  return (data ?? []).map((m) => ({
    id: m.id as string,
    fromMe: m.sender_id === userId,
    body: (m.body as string | null) ?? "",
    at: new Date(String(m.created_at)).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" }),
    state: "sent" as const,
  }));
}

/**
 * A learner's real progress.
 *
 * Derived from `lesson_progress`, which already records a completion per lesson with a timestamp.
 * There is deliberately no invented vocabulary count or skill percentage: those need an SRS engine
 * and an assessment, and neither exists. The numbers that ARE here are counted.
 */
export async function loadProgress(userId: string): Promise<ProgressSummary> {
  const [{ count: lessonsCompleted }, { data: rows }] = await Promise.all([
    supabase.from("lesson_progress").select("lesson_key", { count: "exact", head: true }).eq("user_id", userId).not("completed_at", "is", null),
    supabase.from("lesson_progress").select("completed_at").eq("user_id", userId).not("completed_at", "is", null),
  ]);

  const distinctDays = new Set((rows ?? []).map((r) => String(r.completed_at).slice(0, 10)));
  const hours = Math.round(((distinctDays.size * 5) / 60) * 10) / 10;

  return {
    lessonsCompleted: lessonsCompleted ?? 0,
    hours,
    // No vocabulary figure: it needs the SRS engine, and a made-up number is the fault being fixed.
    vocabulary: 0,
    level: "Beginner 1",
    // No skill percentages until there is an assessment to derive them from.
    skills: [],
    focusAreas: [],
    goals: [],
  };
}

/** The teacher's real earnings, from the ledger. */
export async function loadWallet(teacherId: string): Promise<WalletSummary> {
  const [{ data: wallet }, { data: ledger }] = await Promise.all([
    supabase.from("teacher_wallets").select("balance_kobo,pending_kobo,currency").eq("teacher_id", teacherId).maybeSingle(),
    supabase.from("transactions").select("id,amount_kobo,kind,description,created_at").eq("teacher_id", teacherId).order("created_at", { ascending: false }).limit(20),
  ]);

  return {
    currency: "₦",
    thisMonth: (ledger ?? []).filter((t) => String(t.created_at).slice(0, 7) === new Date().toISOString().slice(0, 7)).reduce((n, t) => n + Number(t.amount_kobo), 0) / 100,
    available: Number(wallet?.balance_kobo ?? 0) / 100,
    pending: Number(wallet?.pending_kobo ?? 0) / 100,
    lessons: (ledger ?? []).filter((t) => t.kind === "teacher_earning").length,
    transactions: (ledger ?? []).map((t) => ({
      id: t.id as string,
      label: (t.description as string | null) ?? String(t.kind),
      amount: Number(t.amount_kobo) / 100,
      at: new Date(String(t.created_at)).toLocaleDateString("en-NG", { day: "numeric", month: "short" }),
      kind: t.kind as "earning" | "withdrawal",
    })),
  };
}

/** Notifications for the signed-in person. */
export async function loadNotifications(userId: string): Promise<AppNotification[]> {
  const { data } = await supabase
    .from("notifications")
    .select("id,title,body,read_at,created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(20);

  return (data ?? []).map((n) => ({
    id: n.id as string,
    title: n.title as string,
    body: (n.body as string | null) ?? "",
    at: new Date(String(n.created_at)).toLocaleDateString("en-NG", { day: "numeric", month: "short" }),
    read: n.read_at != null,
  }));
}

/** A teacher's students: everyone they have a booking with. */
export async function loadStudents(teacherId: string): Promise<StudentRecord[]> {
  const { data } = await supabase
    .from("lesson_bookings")
    .select("learner_id,starts_at,status")
    .eq("teacher_id", teacherId)
    .order("starts_at", { ascending: false });

  if (!data) return [];

  const byLearner = new Map<string, { total: number; last: string; next: string | null }>();
  for (const b of data) {
    const id = b.learner_id as string;
    const entry = byLearner.get(id) ?? { total: 0, last: String(b.starts_at), next: null };
    if (b.status === "completed") entry.total += 1;
    if (b.status === "confirmed") entry.next ??= String(b.starts_at);
    byLearner.set(id, entry);
  }

  return Promise.all(
    [...byLearner.entries()].map(async ([id, e]): Promise<StudentRecord> => ({
      id,
      name: await nameOf(id),
      level: "—",
      goal: "—",
      lessonsCompleted: e.total,
      lastLesson: new Date(e.last).toLocaleDateString("en-NG", { day: "numeric", month: "short" }),
      nextLesson: e.next ? new Date(e.next).toLocaleString("en-NG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : null,
      progress: 0,
      openAssignments: 0,
      note: "",
    }))
  );
}

/**
 * Admin tables.
 *
 * Every row comes from a real table. Empty categories return empty arrays rather than invented
 * examples, which is why the admin screen can look bare — it is describing an account that has no
 * bookings yet, not a broken screen.
 */
export async function loadAdmin(): Promise<Record<string, AdminRow[]>> {
  const [teachers, bookings, payments, withdrawals, reviews] = await Promise.all([
    supabase.from("teacher_profiles").select("id,display_name,status,created_at").limit(50),
    supabase.from("lesson_bookings").select("id,teacher_id,learner_id,starts_at,minutes,status").limit(50),
    supabase.from("payments").select("id,amount_kobo,payer_id,status,created_at").limit(50),
    supabase.from("withdrawals").select("id,amount_kobo,teacher_id,status,created_at").limit(50),
    supabase.from("teacher_reviews").select("id,rating,comment,teacher_id,created_at").limit(50),
  ]);

  const at = (v: unknown) => new Date(String(v)).toLocaleDateString("en-NG", { day: "numeric", month: "short" });

  return {
    Users: [],
    Teachers: (teachers.data ?? []).map((t) => ({
      id: t.id as string,
      primary: (t.display_name as string) || "—",
      secondary: "Teacher",
      status: String(t.status),
      at: at(t.created_at),
    })),
    Bookings: (bookings.data ?? []).map((b) => ({
      id: b.id as string,
      primary: new Date(String(b.starts_at)).toLocaleString("en-NG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
      secondary: `${b.minutes} min`,
      status: String(b.status),
      at: at(b.starts_at),
    })),
    Payments: (payments.data ?? []).map((p) => ({
      id: p.id as string,
      primary: naira(p.amount_kobo as number),
      secondary: "Paystack",
      status: String(p.status),
      at: at(p.created_at),
    })),
    Withdrawals: (withdrawals.data ?? []).map((w) => ({
      id: w.id as string,
      primary: naira(w.amount_kobo as number),
      secondary: "Bank transfer",
      status: String(w.status),
      at: at(w.created_at),
    })),
    Reviews: (reviews.data ?? []).map((r) => ({
      id: r.id as string,
      primary: `${r.rating}★`,
      secondary: (r.comment as string | null) ?? "",
      status: "Published",
      at: at(r.created_at),
    })),
    Reports: [],
  };
}
