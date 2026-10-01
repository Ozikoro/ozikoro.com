import type { Tables } from "@/integrations/supabase/types";

/**
 * Sample teacher data, removed.
 *
 * This file held four FICTIONAL teachers — "Adaeze O. (Sample)", "Mr. Emeka N. (Sample)",
 * "Chiamaka U. (Sample)", "Dr. Obinna A. (Sample)" — with invented reviews, ratings, prices and
 * photographs, shown so the marketplace screens could be previewed before any real teacher existed.
 * The owner has asked for them to come off the site.
 *
 * The exports are kept as EMPTY rather than deleted, because `teachers-view.tsx` reads them as its
 * fallback pool. An empty pool renders the honest "no teachers yet" state; deleting the exports
 * would be a compile error and a blank screen instead.
 *
 * Two reasons removing them is right beyond the owner's request:
 *
 *   1. They were fictional people presented as bookable. Even labelled, a marketplace whose only
 *      listings are invented undermines every real listing that follows.
 *   2. Their `dialects` fields carried tags like "Anambra", "Imo" and "Abia". The owner's rule is
 *      that **Central Igbo (Igbo Izugbe) is the only language used in generating anything**, so
 *      advertising teachers by non-standard dialect contradicted it.
 *
 * When real teachers are approved through the app they come from `teacher_profiles` and this file
 * is never consulted.
 */

type Teacher = Tables<"teacher_profiles">;

/** No fictional teachers. Real ones come from `teacher_profiles` where status = 'approved'. */
export const sampleTeachers: Teacher[] = [];

export const sampleRatings: Record<string, { avg_rating: number | null; review_count: number | null }> = {};

export const sampleReviews: { id: string; rating: number; comment: string; who: string; date: string }[] = [];

export const sampleTeacherDetails: Record<string, { languages: string; response: string; slots: string[] }> = {};
