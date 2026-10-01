import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type StaffRole = "admin" | "linguist" | "editor";

/** Current signed-in user plus their staff roles (roles are read from the database, never from the device). */
export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [roles, setRoles] = useState<StaffRole[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    supabase.auth.getUser().then(({ data }) => { setUser(data.user ?? null); setReady(true); });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) { setRoles([]); return; }
    supabase.from("user_roles").select("role").eq("user_id", user.id).then(({ data }) => {
      setRoles((data ?? []).map((r) => r.role as StaffRole));
    });
  }, [user]);

  return {
    user, roles, ready,
    isStaff: roles.length > 0,
    canPublish: roles.includes("linguist") || roles.includes("admin"),
    isAdmin: roles.includes("admin"),
  };
}

export async function signOut() {
  await supabase.auth.signOut();
}
