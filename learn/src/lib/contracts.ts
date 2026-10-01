// Data contracts the platform screens read. The owning agent (DSH) fills these
// from the real backend; the UI never computes availability, payment, earnings
// or permissions itself.

export type Role = "student" | "teacher" | "admin";
export type SlotState = "available" | "selected" | "booked" | "unavailable" | "past" | "pending";
export type LessonStatus = "requested" | "confirmed" | "live" | "completed" | "cancelled";
export type PaymentStatus = "unpaid" | "pending" | "verified" | "refunded" | "failed";

export interface Slot { startsAt: string; minutes: number; state: SlotState }
export interface AvailabilityRule { weekday: number; start: string; end: string }
export interface AvailabilityException { date: string; reason: string }

export interface Lesson {
  id: string; teacherName: string; studentName: string; topic: string;
  startsAt: string; minutes: number; status: LessonStatus; payment: PaymentStatus;
  priceLabel: string; canJoin: boolean; // canJoin is decided server-side
  teacherPhotoUrl?: string; studentPhotoUrl?: string; // profile images come from the backend
}

export interface Conversation { id: string; name: string; photoUrl?: string; lastMessage: string; unread: number; updatedAt: string }
export interface Message { id: string; fromMe: boolean; body: string; at: string; state: "sending" | "sent" | "failed" }

export interface Assignment {
  id: string; title: string; studentName: string; due: string;
  state: "not_started" | "in_progress" | "submitted" | "reviewed" | "overdue"; progress: number;
}

export interface ProgressSummary {
  lessonsCompleted: number; hours: number; vocabulary: number; level: string;
  skills: { name: string; value: number }[]; focusAreas: string[]; goals: string[];
}

export interface StudentRecord {
  id: string; name: string; photoUrl?: string; level: string; goal: string; lessonsCompleted: number;
  lastLesson: string; nextLesson: string | null; progress: number; openAssignments: number; note: string;
}

export interface WalletSummary {
  currency: string; thisMonth: number; available: number; pending: number; lessons: number;
  transactions: { id: string; label: string; amount: number; at: string; kind: "earning" | "withdrawal" | "refund" }[];
}

export interface AppNotification { id: string; title: string; body: string; at: string; read: boolean }

export interface AdminRow { id: string; primary: string; secondary: string; status: string; at: string }
