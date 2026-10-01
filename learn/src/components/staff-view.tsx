import { Link } from "@tanstack/react-router";
import { Check, FileUp, Send, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/button";
import { supabase } from "@/integrations/supabase/client";
import { foldIgboText, normalizeIgboText } from "@/lib/igbo-text";
import { useAuth } from "@/lib/use-auth";

type Status = "draft" | "in_review" | "published" | "rejected";
type Lexeme = { id: string; headword: string; tone_marked: string | null; part_of_speech: string | null; meaning: string; status: Status; source: string | null; ai_generated: boolean; updated_at: string };
type Unit = { id: string; title: string; level: number; position: number; status: Status };
type Lesson = { id: string; title: string; slug: string; unit_id: string; status: Status; position: number };
type Tab = "words" | "course" | "review" | "reports" | "activity";

const statusStyle: Record<Status, string> = {
  draft: "bg-muted text-muted-foreground", in_review: "bg-secondary text-secondary-foreground",
  published: "bg-primary text-primary-foreground", rejected: "bg-accent/15 text-foreground",
};
const Pill = ({ s }: { s: Status }) => <span className={`rounded-sm px-2 py-0.5 text-[10px] font-black uppercase ${statusStyle[s]}`}>{s.replace("_", " ")}</span>;
const field = "mt-1 min-h-11 w-full rounded-md border-2 border-input bg-card px-3 outline-none focus:border-primary";
const searchKey = (s: string) => foldIgboText(normalizeIgboText(s)).toLowerCase();

/** Staff portal: editors draft and submit; linguists/admins approve or reject (also enforced by the database). */
export function StaffView() {
  const auth = useAuth();
  const [tab, setTab] = useState<Tab>("review");
  const [err, setErr] = useState<string | null>(null);

  if (!auth.ready) return <p className="text-muted-foreground">Loading…</p>;
  if (!auth.user) return <Gate text="Sign in with a staff account to manage content." cta />;
  if (!auth.isStaff) return <Gate text="This area is for Ozituma linguists and editors. Ask an admin to give your account a staff role." />;

  return (
    <div className="rise-in">
      <p className="text-xs font-extrabold uppercase text-primary">Staff · {auth.roles.join(", ")}</p>
      <h1 className="mt-1 font-display text-4xl font-semibold">Content studio</h1>
      <p className="mt-2 max-w-2xl text-muted-foreground">Nothing reaches learners until a linguist publishes it. Every change is logged.</p>
      <div className="mt-6 flex flex-wrap gap-2">
        {(["review", "words", "course", "reports", "activity"] as Tab[]).map((t) => (
          <Button key={t} variant={tab === t ? "primary" : "secondary"} onClick={() => setTab(t)}>{{ review: "Review queue", words: "Dictionary words", course: "Course", reports: "Learner reports", activity: "Activity log" }[t]}</Button>
        ))}
      </div>
      {err && <p className="mt-4 rounded-md bg-accent/10 p-3 text-sm">{err} <button className="font-bold" onClick={() => setErr(null)}>Dismiss</button></p>}
      <div className="mt-6">
        {tab === "words" && <Words userId={auth.user.id} canPublish={auth.canPublish} onError={setErr} />}
        {tab === "course" && <Course userId={auth.user.id} canPublish={auth.canPublish} onError={setErr} />}
        {tab === "review" && <Review canPublish={auth.canPublish} onError={setErr} />}
        {tab === "reports" && <Reports />}
        {tab === "activity" && <Activity />}
      </div>
    </div>
  );
}

function Gate({ text, cta }: { text: string; cta?: boolean }) {
  return <div className="mx-auto max-w-lg py-20 text-center"><h1 className="font-display text-3xl font-semibold">Content studio</h1><p className="mt-3 text-muted-foreground">{text}</p>{cta && <Button asChild className="mt-6"><Link to="/auth">Sign in</Link></Button>}</div>;
}

async function setStatus(table: "lexemes" | "course_units" | "course_lessons", id: string, status: Status, onError: (e: string) => void) {
  const { error } = await supabase.from(table).update({ status }).eq("id", id);
  if (error) onError(error.message);
}

function Words({ userId, canPublish, onError }: { userId: string; canPublish: boolean; onError: (e: string) => void }) {
  const [rows, setRows] = useState<Lexeme[]>([]);
  const [form, setForm] = useState({ headword: "", tone_marked: "", part_of_speech: "", meaning: "", example_ig: "", example_en: "", audio_url: "", source: "" });
  const [csv, setCsv] = useState<{ ok: Record<string, string>[]; bad: string[] } | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from("lexemes").select("id,headword,tone_marked,part_of_speech,meaning,status,source,ai_generated,updated_at").order("updated_at", { ascending: false }).limit(200);
    setRows((data ?? []) as Lexeme[]);
  }, []);
  useEffect(() => { load(); }, [load]);

  const create = async (status: Status) => {
    const hw = normalizeIgboText(form.headword.trim());
    if (!hw || !form.meaning.trim()) return onError("Headword and meaning are required.");
    const tm = normalizeIgboText(form.tone_marked.trim());
    const { error } = await supabase.from("lexemes").insert({
      ...form, headword: hw, tone_marked: tm || null, search_key: `${searchKey(hw)} ${searchKey(tm)}`.trim(),
      example_ig: normalizeIgboText(form.example_ig) || null, status, author_id: userId,
    });
    if (error) return onError(error.message);
    setForm({ headword: "", tone_marked: "", part_of_speech: "", meaning: "", example_ig: "", example_en: "", audio_url: "", source: "" });
    load();
  };

  const parseCsv = async (file: File) => {
    const text = await file.text();
    const [head, ...lines] = text.split(/\r?\n/).filter(Boolean);
    const cols = (head ?? "").split(",").map((c) => c.trim());
    const ok: Record<string, string>[] = []; const bad: string[] = [];
    lines.forEach((l, i) => {
      const vals = l.split(","); const r: Record<string, string> = {};
      cols.forEach((c, j) => { r[c] = normalizeIgboText((vals[j] ?? "").trim()); });
      if (!r["headword"] || !r["meaning"]) bad.push(`Row ${i + 2}: missing headword or meaning`); else ok.push(r);
    });
    setCsv({ ok, bad });
  };

  const importCsv = async () => {
    if (!csv) return;
    const payload = csv.ok.map((r) => ({
      headword: r["headword"]!, tone_marked: r["tone_marked"] || null, part_of_speech: r["part_of_speech"] || null, meaning: r["meaning"]!,
      example_ig: r["example_ig"] || null, example_en: r["example_en"] || null, audio_url: r["audio_url"] || null, source: r["source"] || null,
      search_key: `${searchKey(r["headword"]!)} ${searchKey(r["tone_marked"] ?? "")}`.trim(), status: "draft" as const, author_id: userId,
    }));
    const { error } = await supabase.from("lexemes").insert(payload);
    if (error) return onError(error.message);
    setCsv(null); load();
  };

  const exportJson = () => {
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" })); a.download = "lexemes.json"; a.click();
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
      <div className="space-y-6">
        <section className="rounded-lg border border-border bg-card p-5">
          <h2 className="font-display text-xl font-semibold">New word</h2>
          {(["headword", "tone_marked", "part_of_speech", "meaning", "example_ig", "example_en", "audio_url", "source"] as const).map((k) => (
            <label key={k} className="mt-3 block text-xs font-bold uppercase text-muted-foreground">{k.replace("_", " ")}
              <input className={field} value={form[k]} lang={k.includes("ig") || k.startsWith("head") || k.startsWith("tone") ? "ig" : undefined} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
            </label>
          ))}
          <div className="mt-4 flex gap-2"><Button variant="secondary" onClick={() => create("draft")}>Save draft</Button><Button onClick={() => create("in_review")}><Send className="size-4" /> Submit for review</Button></div>
        </section>
        <section className="rounded-lg border border-border bg-card p-5">
          <h2 className="font-display text-xl font-semibold">Bulk import (CSV)</h2>
          <p className="mt-1 text-xs text-muted-foreground">Columns: headword, tone_marked, part_of_speech, meaning, example_ig, example_en, audio_url, source. Rows import as drafts.</p>
          <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm font-bold text-primary"><FileUp className="size-4" /> Choose CSV<input type="file" accept=".csv" className="hidden" onChange={(e) => e.target.files?.[0] && parseCsv(e.target.files[0])} /></label>
          {csv && <div className="mt-3 text-sm"><p>Dry run: {csv.ok.length} valid, {csv.bad.length} with problems.</p>{csv.bad.slice(0, 5).map((b) => <p key={b} className="text-xs text-muted-foreground">{b}</p>)}<Button className="mt-2" disabled={!csv.ok.length} onClick={importCsv}>Import {csv.ok.length} drafts</Button></div>}
          <Button variant="ghost" className="mt-3" onClick={exportJson}>Export all as JSON</Button>
        </section>
      </div>
      <section>
        <h2 className="font-display text-xl font-semibold">All words ({rows.length})</h2>
        <div className="mt-3 space-y-2">
          {rows.length === 0 && <p className="text-sm text-muted-foreground">No words yet.</p>}
          {rows.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card p-3">
              <div className="min-w-0 flex-1"><p className="font-bold" lang="ig">{r.tone_marked || r.headword} <Pill s={r.status} /></p><p className="text-sm text-muted-foreground">{r.meaning}{r.source ? ` · ${r.source}` : ""}</p></div>
              {r.status === "draft" && <Button variant="secondary" onClick={() => setStatus("lexemes", r.id, "in_review", onError).then(load)}>Submit</Button>}
              {canPublish && r.status === "in_review" && <><Button onClick={() => setStatus("lexemes", r.id, "published", onError).then(load)}><Check className="size-4" /></Button><Button variant="ghost" onClick={() => setStatus("lexemes", r.id, "rejected", onError).then(load)}><X className="size-4" /></Button></>}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

const cardsExample = `[{"id":"w1","icon":"🌅","igbo":"…","meaning":"…","note":"…"}]`;
const storyExample = `[{"speaker":"them","name":"Neighbour","avatar":"👩🏾","line":"…","meaning":"…"},{"speaker":"you","prompt":"…","options":[{"text":"…","meaning":"…"}],"correct":0,"why":"…"}]`;

function Course({ userId, canPublish, onError }: { userId: string; canPublish: boolean; onError: (e: string) => void }) {
  const [units, setUnits] = useState<Unit[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [unitTitle, setUnitTitle] = useState("");
  const [lf, setLf] = useState({ unit_id: "", title: "", slug: "", scene: "", objective: "", culture_note: "", culture_source: "", cards: cardsExample, story: storyExample });

  const load = useCallback(async () => {
    const [u, l] = await Promise.all([
      supabase.from("course_units").select("id,title,level,position,status").order("level").order("position"),
      supabase.from("course_lessons").select("id,title,slug,unit_id,status,position").order("position"),
    ]);
    setUnits((u.data ?? []) as Unit[]); setLessons((l.data ?? []) as Lesson[]);
  }, []);
  useEffect(() => { load(); }, [load]);

  const addUnit = async () => {
    if (!unitTitle.trim()) return;
    const { error } = await supabase.from("course_units").insert({ title: unitTitle.trim(), position: units.length, author_id: userId });
    if (error) return onError(error.message);
    setUnitTitle(""); load();
  };

  const addLesson = async (status: Status) => {
    let cards: unknown, story: unknown;
    try { cards = JSON.parse(normalizeIgboText(lf.cards)); story = JSON.parse(normalizeIgboText(lf.story)); } catch { return onError("Cards and story must be valid JSON."); }
    if (!Array.isArray(cards) || !Array.isArray(story)) return onError("Cards and story must be lists.");
    if (!lf.unit_id || !lf.title || !lf.slug) return onError("Unit, title and slug are required.");
    const { error } = await supabase.from("course_lessons").insert({
      unit_id: lf.unit_id, title: lf.title, slug: lf.slug, scene: lf.scene, objective: lf.objective, culture_note: lf.culture_note,
      culture_source: lf.culture_source || null, cards: cards as never, story: story as never, status, author_id: userId,
      position: lessons.filter((l) => l.unit_id === lf.unit_id).length,
    });
    if (error) return onError(error.message);
    setLf({ ...lf, title: "", slug: "", scene: "", objective: "", culture_note: "", culture_source: "" }); load();
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
      <div className="space-y-6">
        <section className="rounded-lg border border-border bg-card p-5">
          <h2 className="font-display text-xl font-semibold">New unit</h2>
          <input className={field} value={unitTitle} onChange={(e) => setUnitTitle(e.target.value)} placeholder="e.g. First conversations" />
          <Button className="mt-3" variant="secondary" onClick={addUnit}>Add unit</Button>
        </section>
        <section className="rounded-lg border border-border bg-card p-5">
          <h2 className="font-display text-xl font-semibold">New lesson</h2>
          <label className="mt-3 block text-xs font-bold uppercase text-muted-foreground">Unit<select className={field} value={lf.unit_id} onChange={(e) => setLf({ ...lf, unit_id: e.target.value })}><option value="">Choose</option>{units.map((u) => <option key={u.id} value={u.id}>{u.title}</option>)}</select></label>
          {(["title", "slug", "scene", "objective", "culture_note", "culture_source"] as const).map((k) => (
            <label key={k} className="mt-3 block text-xs font-bold uppercase text-muted-foreground">{k.replace("_", " ")}<input className={field} value={lf[k]} onChange={(e) => setLf({ ...lf, [k]: e.target.value })} /></label>
          ))}
          <label className="mt-3 block text-xs font-bold uppercase text-muted-foreground">Word cards (JSON)<textarea rows={4} className={`${field} py-2 font-mono text-xs`} value={lf.cards} onChange={(e) => setLf({ ...lf, cards: e.target.value })} /></label>
          <label className="mt-3 block text-xs font-bold uppercase text-muted-foreground">Story chat (JSON)<textarea rows={5} className={`${field} py-2 font-mono text-xs`} value={lf.story} onChange={(e) => setLf({ ...lf, story: e.target.value })} /></label>
          <div className="mt-4 flex gap-2"><Button variant="secondary" onClick={() => addLesson("draft")}>Save draft</Button><Button onClick={() => addLesson("in_review")}><Send className="size-4" /> Submit</Button></div>
        </section>
      </div>
      <section className="space-y-4">
        {units.length === 0 && <p className="text-sm text-muted-foreground">No units yet. Until a unit and its lessons are published, learners see the labelled demo course.</p>}
        {units.map((u) => (
          <div key={u.id} className="rounded-lg border border-border bg-card p-4">
            <div className="flex flex-wrap items-center gap-2"><h3 className="flex-1 font-display text-lg font-semibold">{u.title} <Pill s={u.status} /></h3>
              {u.status === "draft" && <Button variant="secondary" onClick={() => setStatus("course_units", u.id, "in_review", onError).then(load)}>Submit</Button>}
              {canPublish && u.status === "in_review" && <Button onClick={() => setStatus("course_units", u.id, "published", onError).then(load)}>Publish unit</Button>}
            </div>
            <ul className="mt-3 space-y-2">
              {lessons.filter((l) => l.unit_id === u.id).map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-2 rounded-md bg-muted/60 p-2 text-sm">
                  <span className="flex-1 font-bold">{l.title} <Pill s={l.status} /></span>
                  {l.status === "draft" && <Button variant="ghost" onClick={() => setStatus("course_lessons", l.id, "in_review", onError).then(load)}>Submit</Button>}
                  {canPublish && l.status === "in_review" && <><Button onClick={() => setStatus("course_lessons", l.id, "published", onError).then(load)}><Check className="size-4" /></Button><Button variant="ghost" onClick={() => setStatus("course_lessons", l.id, "rejected", onError).then(load)}><X className="size-4" /></Button></>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </div>
  );
}

function Review({ canPublish, onError }: { canPublish: boolean; onError: (e: string) => void }) {
  const [items, setItems] = useState<{ table: "lexemes" | "course_units" | "course_lessons"; id: string; label: string; detail: string }[]>([]);
  const load = useCallback(async () => {
    const [w, u, l] = await Promise.all([
      supabase.from("lexemes").select("id,headword,tone_marked,meaning").eq("status", "in_review"),
      supabase.from("course_units").select("id,title").eq("status", "in_review"),
      supabase.from("course_lessons").select("id,title,objective").eq("status", "in_review"),
    ]);
    setItems([
      ...(w.data ?? []).map((r) => ({ table: "lexemes" as const, id: r.id, label: r.tone_marked || r.headword, detail: `Word · ${r.meaning}` })),
      ...(u.data ?? []).map((r) => ({ table: "course_units" as const, id: r.id, label: r.title, detail: "Unit" })),
      ...(l.data ?? []).map((r) => ({ table: "course_lessons" as const, id: r.id, label: r.title, detail: `Lesson · ${r.objective}` })),
    ]);
  }, []);
  useEffect(() => { load(); }, [load]);
  return (
    <section>
      <h2 className="font-display text-xl font-semibold">Waiting for review ({items.length})</h2>
      {!canPublish && <p className="mt-1 text-sm text-muted-foreground">Only linguists and admins can approve. You can see what's waiting.</p>}
      <div className="mt-3 space-y-2">
        {items.length === 0 && <p className="text-sm text-muted-foreground">Nothing waiting. 🎉</p>}
        {items.map((i) => (
          <div key={i.id} className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card p-3">
            <div className="flex-1"><p className="font-bold" lang="ig">{i.label}</p><p className="text-sm text-muted-foreground">{i.detail}</p></div>
            {canPublish && <><Button onClick={() => setStatus(i.table, i.id, "published", onError).then(load)}><Check className="size-4" /> Publish</Button><Button variant="ghost" onClick={() => setStatus(i.table, i.id, "rejected", onError).then(load)}><X className="size-4" /> Reject</Button></>}
          </div>
        ))}
      </div>
    </section>
  );
}

function Reports() {
  const [rows, setRows] = useState<{ id: string; target_type: string; target_id: string | null; message: string; resolved: boolean; created_at: string }[]>([]);
  const load = useCallback(async () => { const { data } = await supabase.from("error_reports").select("*").order("created_at", { ascending: false }).limit(100); setRows(data ?? []); }, []);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="space-y-2">
      {rows.length === 0 && <p className="text-sm text-muted-foreground">No reports.</p>}
      {rows.map((r) => (
        <div key={r.id} className="flex items-center gap-3 rounded-md border border-border bg-card p-3 text-sm">
          <div className="flex-1"><p className="font-bold">{r.target_type} · {r.message}</p><p className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</p></div>
          {r.resolved ? <span className="text-xs font-bold text-primary">Resolved</span> : <Button variant="secondary" onClick={async () => { await supabase.from("error_reports").update({ resolved: true }).eq("id", r.id); load(); }}>Mark resolved</Button>}
        </div>
      ))}
    </div>
  );
}

function Activity() {
  const [rows, setRows] = useState<{ id: number; table_name: string; action: string; new_status: string | null; created_at: string }[]>([]);
  useEffect(() => { supabase.from("audit_log").select("id,table_name,action,new_status,created_at").order("created_at", { ascending: false }).limit(100).then(({ data }) => setRows(data ?? [])); }, []);
  return (
    <ul className="space-y-1 text-sm">
      {rows.length === 0 && <li className="text-muted-foreground">No activity yet.</li>}
      {rows.map((r) => <li key={r.id} className="flex gap-3 rounded-md bg-card px-3 py-2"><span className="w-44 text-muted-foreground">{new Date(r.created_at).toLocaleString()}</span><span className="font-bold">{r.table_name}</span><span>{r.action}</span><span className="text-muted-foreground">{r.new_status}</span></li>)}
    </ul>
  );
}
