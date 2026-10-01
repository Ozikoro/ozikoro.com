import { Link } from "@tanstack/react-router";
import { standingFrom } from "@/lib/learner-standing";
import { Download, LogOut, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { supabase } from "@/integrations/supabase/client";
import { signOut, useAuth } from "@/lib/use-auth";
import { applySettings, defaultSettings, type LearnerSettings } from "@/lib/settings";
import { useStickyState } from "@/lib/use-sticky-state";

type Profile = { display_name: string | null; native_language: string | null; learning_reason: string | null; daily_goal_minutes: number; starting_level: string; is_adult: boolean; onboarded: boolean; settings: LearnerSettings };

export function ProfileView() {
  const { user, roles, ready } = useAuth();
  const [settings, setSettings] = useStickyState<LearnerSettings>("settings", defaultSettings);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => { applySettings(settings); }, [settings]);

  useEffect(() => {
    if (!user) return;
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle().then(({ data }) => {
      if (!data) return;
      const s = { ...defaultSettings, ...(data.settings as Partial<LearnerSettings>) };
      setProfile({ ...data, settings: s } as Profile);
      setSettings(s);
    });
  }, [user, setSettings]);

  const save = async () => {
    if (!user || !profile) return;
    await supabase.from("profiles").update({
      display_name: profile.display_name, native_language: profile.native_language, learning_reason: profile.learning_reason,
      daily_goal_minutes: profile.daily_goal_minutes, starting_level: profile.starting_level, onboarded: true, settings,
    }).eq("id", user.id);
    setSaved(true); setTimeout(() => setSaved(false), 2000);
  };

  const exportData = async () => {
    if (!user) return;
    const [p, prog] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
      supabase.from("lesson_progress").select("*").eq("user_id", user.id),
    ]);
    /*
     * XP, streak and level are DERIVED from the completions above rather than stored, so they are
     * computed here instead of selected. They belong in the export because they are part of what
     * the learner has earned — an export that omitted them would be incomplete — and this surfaces
     * them without adding a panel to the interface.
     */
    const standing = standingFrom((prog.data ?? []) as { completed_at: string | null }[], 0);
    const blob = new Blob(
      [JSON.stringify({ email: user.email, profile: p.data, progress: prog.data, standing }, null, 2)],
      { type: "application/json" }
    );
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "ozituma-my-data.json"; a.click();
  };

  const deleteData = async () => {
    if (!user || !confirm("Delete your profile and all saved progress? This cannot be undone.")) return;
    await supabase.from("lesson_progress").delete().eq("user_id", user.id);
    await supabase.from("profiles").delete().eq("id", user.id);
    Object.keys(localStorage).filter((k) => k.startsWith("ozituma:")).forEach((k) => localStorage.removeItem(k));
    await signOut();
  };

  const field = "mt-1 min-h-11 w-full rounded-md border-2 border-input bg-card px-3 outline-none focus:border-primary";
  const setS = <K extends keyof LearnerSettings>(k: K, v: LearnerSettings[K]) => setSettings({ ...settings, [k]: v });

  return (
    <div className="rise-in mx-auto grid max-w-5xl gap-6 lg:grid-cols-[1.2fr_1fr]">
      <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
        <p className="text-xs font-extrabold uppercase text-primary">Profile</p>
        {!ready ? <p className="mt-4 text-sm text-muted-foreground">Loading…</p> : !user ? (
          <div className="mt-2">
            <h1 className="font-display text-3xl font-semibold">Save your progress</h1>
            <p className="mt-2 text-muted-foreground">Create a free account to keep your lessons, practice and settings on every device.</p>
            <Button asChild className="mt-5"><Link to="/auth">Sign in or create account</Link></Button>
          </div>
        ) : profile ? (
          <div className="mt-2 space-y-4">
            <h1 className="font-display text-3xl font-semibold">{profile.onboarded ? `Hello, ${profile.display_name ?? "learner"}` : "Tell us about you"}</h1>
            <p className="text-sm text-muted-foreground">{user.email}{roles.length ? ` · Staff: ${roles.join(", ")}` : ""}</p>
            <label className="block text-sm font-bold">Name<input className={field} value={profile.display_name ?? ""} onChange={(e) => setProfile({ ...profile, display_name: e.target.value })} /></label>
            <label className="block text-sm font-bold">First language<input className={field} value={profile.native_language ?? ""} onChange={(e) => setProfile({ ...profile, native_language: e.target.value })} placeholder="e.g. English" /></label>
            <label className="block text-sm font-bold">Why are you learning Igbo?
              <select className={field} value={profile.learning_reason ?? ""} onChange={(e) => setProfile({ ...profile, learning_reason: e.target.value })}>
                <option value="">Choose one</option><option>Family and heritage</option><option>Travel</option><option>Culture</option><option>School or work</option><option>Other</option>
              </select></label>
            <label className="block text-sm font-bold">Starting level
              <select className={field} value={profile.starting_level} onChange={(e) => setProfile({ ...profile, starting_level: e.target.value })}>
                <option value="beginner">Complete beginner</option><option value="few_words">I know a few words</option><option value="conversational">I can hold simple conversations</option>
              </select></label>
            <label className="block text-sm font-bold">Daily goal: {profile.daily_goal_minutes} minutes
              <input type="range" min={5} max={30} step={5} value={profile.daily_goal_minutes} onChange={(e) => setProfile({ ...profile, daily_goal_minutes: Number(e.target.value) })} className="mt-2 w-full accent-primary" /></label>
            <div className="flex flex-wrap gap-3 pt-2">
              <Button onClick={save}>{saved ? "Saved" : "Save profile"}</Button>
              <Button variant="ghost" onClick={signOut}><LogOut className="size-4" /> Sign out</Button>
            </div>
            <div className="flex flex-wrap gap-3 border-t border-border pt-4">
              <Button variant="secondary" onClick={exportData}><Download className="size-4" /> Export my data</Button>
              <Button variant="ghost" onClick={deleteData}><Trash2 className="size-4" /> Delete my data</Button>
            </div>
          </div>
        ) : <p className="mt-4 text-sm text-muted-foreground">Loading profile…</p>}
      </section>

      <section className="h-fit rounded-lg border border-border bg-card p-6 shadow-sm">
        <p className="text-xs font-extrabold uppercase text-primary">Settings</p>
        <div className="mt-4 space-y-5">
          <Toggle label="Dark theme" on={settings.theme === "dark"} set={(v) => setS("theme", v ? "dark" : "light")} />
          <label className="block text-sm font-bold">Text size
            <div className="mt-2 flex gap-2">{(["normal", "large", "xlarge"] as const).map((s) => <Button key={s} variant={settings.textSize === s ? "primary" : "secondary"} onClick={() => setS("textSize", s)}>{s === "normal" ? "A" : s === "large" ? "A+" : "A++"}</Button>)}</div>
          </label>
          <label className="block text-sm font-bold">Audio speed
            <div className="mt-2 flex gap-2">{([0.75, 1, 1.25] as const).map((s) => <Button key={s} variant={settings.audioSpeed === s ? "primary" : "secondary"} onClick={() => setS("audioSpeed", s)}>{s}×</Button>)}</div>
          </label>
          <Toggle label="Reduce motion" on={settings.reducedMotion} set={(v) => setS("reducedMotion", v)} />
          <Toggle label="Show culture notes" on={settings.cultureNotes} set={(v) => setS("cultureNotes", v)} />
          <label className="block text-sm font-bold">Keyboard layout
            <select className={field} value={settings.keyboard} onChange={(e) => setS("keyboard", e.target.value as LearnerSettings["keyboard"])}>
              <option value="igbo">Igbo</option><option value="ndebe">Ńdẹ́bẹ́ (prototype)</option><option value="english">English</option>
            </select></label>
          <p className="text-xs text-muted-foreground">{user ? "Settings save to your account when you press Save profile." : "Settings are saved on this device."}</p>
        </div>
      </section>
    </div>
  );
}

function Toggle({ label, on, set }: { label: string; on: boolean; set: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 text-sm font-bold">
      {label}
      <button type="button" role="switch" aria-checked={on} onClick={() => set(!on)} className={`relative h-7 w-12 rounded-full transition ${on ? "bg-primary" : "bg-muted"}`}>
        <span className={`absolute top-1 size-5 rounded-full bg-card shadow transition-all ${on ? "left-6" : "left-1"}`} />
      </button>
    </label>
  );
}
