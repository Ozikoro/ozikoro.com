import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { units as demoUnits, type Lesson, type StoryTurn, type Unit, type WordCard } from "@/lib/lesson-data";

/**
 * Loads the published course from the database. Until at least one unit with
 * published lessons exists, the clearly labelled demo course is used.
 */
export function useCourse() {
  const [units, setUnits] = useState<readonly Unit[]>(demoUnits);
  const [isDemo, setIsDemo] = useState(true);

  useEffect(() => {
    (async () => {
      const [u, l] = await Promise.all([
        supabase.from("course_units").select("id,title,level,position").eq("status", "published").order("level").order("position"),
        supabase.from("course_lessons").select("*").eq("status", "published").order("position"),
      ]);
      const lessons = l.data ?? [];
      const built: Unit[] = (u.data ?? []).map((unit, i) => ({
        number: i + 1,
        title: unit.title,
        lessons: lessons.filter((x) => x.unit_id === unit.id).map((x): Lesson => ({
          id: x.slug, title: x.title, unit: unit.title, scene: x.scene, objective: x.objective,
          cultureNote: x.culture_note, cards: x.cards as unknown as WordCard[], story: x.story as unknown as StoryTurn[],
        })),
      })).filter((x) => x.lessons.length > 0);
      if (built.length) { setUnits(built); setIsDemo(false); }
    })();
  }, []);

  return { units, allLessons: units.flatMap((u) => u.lessons), isDemo };
}
