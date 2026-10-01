import { Link } from "@tanstack/react-router";
import { ArrowLeft, BadgeCheck, Building2, CalendarPlus, Clock3, GraduationCap, MessageCircle, Play, Search, SlidersHorizontal, Star, Video } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/button";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { startLessonCheckout } from "@/lib/checkout.functions";
import { useAuth } from "@/lib/use-auth";

type Teacher = Tables<"teacher_profiles">;
type Rating = { teacher_id: string | null; avg_rating: number | null; review_count: number | null };
type Screen = { name: "browse" } | { name: "profile"; id: string } | { name: "teach" } | { name: "mine" };

const money = (kobo: number, cur = "NGN") => new Intl.NumberFormat("en-NG", { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(kobo / 100);
const input = "w-full rounded-md border border-input bg-card px-3 py-2.5 text-sm outline-none focus:border-primary";

export function TeachersView() {
  const auth = useAuth();
  const [screen, setScreen] = useState<Screen>({ name: "browse" });
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [ratings, setRatings] = useState<Record<string, Rating>>({});
  const [q, setQ] = useState("");
  const [schoolsOnly, setSchoolsOnly] = useState(false);

  const load = useCallback(async () => {
    const [{ data: t }, { data: r }] = await Promise.all([
      supabase.from("teacher_profiles").select("*").order("created_at", { ascending: false }),
      supabase.from("teacher_ratings").select("*"),
    ]);
    setTeachers(t ?? []);
    setRatings(Object.fromEntries((r ?? []).filter((x) => x.teacher_id).map((x) => [x.teacher_id as string, x])));
  }, []);
  useEffect(() => { void load(); }, [load, auth.user]);

  const approved = teachers.filter((t) => t.status === "approved");
  const pending = teachers.filter((t) => t.status === "pending");
  const mine = teachers.find((t) => t.user_id === auth.user?.id);
  const pool = approved;
  const allRatings = ratings;
  const list = useMemo(() => pool.filter((t) =>
    (!schoolsOnly || t.open_to_schools) &&
    [t.display_name, t.headline, t.specialties.join(" "), t.dialects.join(" ")].join(" ").toLowerCase().includes(q.toLowerCase())), [pool, q, schoolsOnly]);

  if (screen.name === "profile") {
    const t = teachers.find((x) => x.id === screen.id);
    if (t) return <TeacherProfile t={t} rating={allRatings[t.id]} onBack={() => setScreen({ name: "browse" })} />;
  }
  if (screen.name === "teach") return <TeachForm existing={mine} onDone={() => { void load(); setScreen({ name: "mine" }); }} onBack={() => setScreen({ name: "browse" })} />;
  if (screen.name === "mine") return <MyLessons teacher={mine} onBack={() => setScreen({ name: "browse" })} onEdit={() => setScreen({ name: "teach" })} />;

  return (
    <div className="rise-in">
      <section className="teacher-market-head overflow-hidden rounded-lg border border-border bg-card p-5 shadow-sm sm:p-7">
        <div className="grid items-end gap-5 md:grid-cols-[minmax(0,1fr)_auto]">
          <div>
            <p className="text-xs font-extrabold uppercase text-primary">Ozituma live teachers</p>
            <h1 className="mt-2 max-w-2xl font-display text-3xl font-semibold leading-tight sm:text-4xl">Find an Igbo teacher who fits your goals.</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Compare real teaching styles, credentials, reviews and availability before you book a one-to-one video lesson.</p>
          </div>
          <div className="flex flex-wrap gap-2 md:justify-end">
          <Button variant="secondary" onClick={() => setScreen({ name: "teach" })} disabled={!auth.user}><GraduationCap className="size-4" /> {mine ? "Edit my teacher profile" : "Teach on Ozituma"}</Button>
            {auth.user ? <Button onClick={() => setScreen({ name: "mine" })}><CalendarPlus className="size-4" /> My lessons</Button>
              : <Button asChild><Link to="/auth">Sign in to book</Link></Button>}
          </div>
        </div>
      </section>

      {auth.isAdmin && pending.length > 0 && (
        <section className="mt-6 rounded-lg border-2 border-highlight bg-card p-5">
          <h2 className="font-display text-xl font-semibold">Teacher applications ({pending.length})</h2>
          <div className="mt-3 space-y-2">{pending.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3">
              <div><p className="font-bold">{t.display_name}</p><p className="text-xs text-muted-foreground">{t.qualifications || "No qualifications listed"}</p></div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setScreen({ name: "profile", id: t.id })}>View</Button>
                <Button onClick={async () => { await supabase.from("teacher_profiles").update({ status: "approved" }).eq("id", t.id); void load(); }}>Approve</Button>
              </div>
            </div>))}</div>
        </section>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3 shadow-sm">
        <div className="relative min-w-64 flex-1"><Search className="absolute left-3 top-3 size-4 text-muted-foreground" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search teachers, dialects or goals" className={`${input} border-0 bg-muted pl-9`} /></div>
        <label className="flex items-center gap-2 rounded-md border border-border px-3 py-2.5 text-sm font-bold"><input type="checkbox" checked={schoolsOnly} onChange={(e) => setSchoolsOnly(e.target.checked)} className="size-4 accent-primary" /><Building2 className="size-4" /> Open to schools</label>
        <Button variant="secondary" title="More filters coming with real teacher availability"><SlidersHorizontal className="size-4" /> Filters</Button>
      </div>

      {list.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-border bg-card p-10 text-center">
          <GraduationCap className="mx-auto size-8 text-primary" />
          <p className="mt-3 font-display text-xl font-semibold">No approved teachers yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Teachers appear here once Ozituma staff approve their application.</p>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          {list.map((t) => <TeacherCard key={t.id} t={t} rating={allRatings[t.id]} onOpen={() => setScreen({ name: "profile", id: t.id })} />)}
        </div>
      )}
    </div>
  );
}

function Stars({ rating }: { rating?: Rating | undefined }) {
  if (!rating?.review_count) return <span className="text-xs font-bold text-muted-foreground">New teacher</span>;
  return <span className="flex items-center gap-1 text-sm font-extrabold"><Star className="size-4 text-highlight" fill="currentColor" />{rating.avg_rating} <span className="font-normal text-muted-foreground">({rating.review_count})</span></span>;
}

function Avatar({ t, size = "size-14" }: { t: Teacher; size?: string }) {
  return t.photo_url ? <img src={t.photo_url} alt={`Portrait of ${t.display_name}`} width={768} height={960} loading="lazy" className={`${size} rounded-full object-cover`} />
    : <div className={`${size} grid place-items-center rounded-full bg-secondary font-display text-xl font-semibold text-secondary-foreground`}>{t.display_name.slice(0, 1)}</div>;
}

function TeacherCard({ t, rating, onOpen }: { t: Teacher; rating?: Rating | undefined; onOpen: () => void }) {
  return (
    <article className="group overflow-hidden rounded-lg border border-border bg-card p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-primary hover:shadow-md sm:p-5">
      <div className="flex gap-4">
        <button onClick={onOpen} aria-label={`View ${t.display_name}'s introduction`} className="relative h-32 w-28 shrink-0 overflow-hidden rounded-md bg-muted sm:h-36 sm:w-32">
          {t.photo_url ? <img src={t.photo_url} alt={`Portrait of ${t.display_name}`} width={768} height={960} loading="lazy" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" /> : <Avatar t={t} size="size-full" />}
          <span className="absolute inset-0 bg-ink/10" />
          <span className="absolute inset-0 grid place-items-center"><span className="grid size-10 place-items-center rounded-full bg-card/95 text-primary shadow-lg"><Play className="ml-0.5 size-4" fill="currentColor" /></span></span>
          <span className="absolute bottom-2 left-2 rounded-sm bg-ink/85 px-1.5 py-0.5 text-[9px] font-black uppercase text-brand-foreground">{t.video_url ? "Video" : "Profile"}</span>
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0"><h2 className="flex items-center gap-1 font-display text-lg font-semibold leading-tight">{t.display_name}<BadgeCheck className="size-4 shrink-0 text-primary" /></h2><div className="mt-1"><Stars rating={rating} /></div></div>
            <p className="shrink-0 text-right"><span className="block text-lg font-black">{money(t.hourly_rate_kobo, t.currency)}</span><span className="block text-[10px] font-bold uppercase text-muted-foreground">per hour</span></p>
          </div>
          <p className="mt-2 line-clamp-2 text-sm font-semibold leading-5">{t.headline}</p>
          <div className="mt-2 flex flex-wrap gap-1">{[...t.dialects, ...t.specialties].slice(0, 4).map((s) => <span key={s} className="rounded-sm border border-border bg-muted px-2 py-0.5 text-[10px] font-bold">{s}</span>)}</div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-3 text-xs font-bold text-muted-foreground">
        <span className="flex items-center gap-1.5"><Clock3 className="size-3.5" />Ask for availability</span>
      </div>
      <p className="mt-3 line-clamp-2 text-sm leading-6 text-muted-foreground">{t.bio}</p>
      <div className="mt-4 flex gap-2">
        <Button className="flex-1" onClick={onOpen}><CalendarPlus className="size-4" /> Book trial lesson</Button>
        <Button variant="secondary" onClick={onOpen}><MessageCircle className="size-4" /> <span className="hidden sm:inline">View profile</span></Button>
      </div>
    </article>
  );
}

function TeacherProfile({ t, rating, onBack }: { t: Teacher; rating?: Rating | undefined; onBack: () => void }) {
  const auth = useAuth();
  const [reviews, setReviews] = useState<Tables<"teacher_reviews">[]>([]);
  const [mode, setMode] = useState<"book" | "hire">("book");
  const [msg, setMsg] = useState("");
  useEffect(() => { supabase.from("teacher_reviews").select("*").eq("teacher_id", t.id).order("created_at", { ascending: false }).then(({ data }) => setReviews(data ?? [])); }, [t.id]);

  const book = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    const minutes = Number(f.get("minutes"));
    const { error } = await supabase.from("lesson_bookings").insert({ teacher_id: t.id, learner_id: auth.user!.id, starts_at: new Date(String(f.get("when"))).toISOString(), minutes, note: String(f.get("note") ?? "") });
    setMsg(error ? error.message : "Request sent. The teacher will confirm, then you'll pay securely to lock the slot.");
  };
  const hire = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    const { error } = await supabase.from("school_hire_requests").insert({ teacher_id: t.id, requester_id: auth.user!.id, school_name: String(f.get("school")), contact_email: String(f.get("email")), role_details: String(f.get("details") ?? "") });
    setMsg(error ? error.message : "Your request has been sent to the teacher.");
  };

  return (
    <div className="rise-in">
      <Button variant="ghost" onClick={onBack}><ArrowLeft className="size-4" /> All teachers</Button>
      <div className="mt-4 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <section className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="relative aspect-video bg-muted">
              {t.video_url ? <video src={t.video_url} poster={t.photo_url ?? undefined} controls playsInline preload="metadata" className="h-full w-full object-cover" aria-label={`${t.display_name} introduction video`} /> : t.photo_url ? <img src={t.photo_url} alt={`Portrait of ${t.display_name}`} width={768} height={960} className="h-full w-full object-cover object-[center_28%]" /> : <div className="grid h-full place-items-center"><Avatar t={t} size="size-28" /></div>}
              <span className="absolute left-3 top-3 rounded-sm bg-ink/85 px-2 py-1 text-[10px] font-black uppercase text-brand-foreground">"Teacher introduction"</span>
            </div>
            <div className="p-6">
              <div className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="font-display text-3xl font-semibold">{t.display_name}</h1><p className="mt-1 text-muted-foreground">{t.headline}</p><div className="mt-2"><Stars rating={rating} /></div></div><div className="flex items-center gap-2 text-sm font-bold text-primary"><Video className="size-4" />1-to-1 video lessons</div></div>
            {t.status !== "approved" && <p className="mt-4 rounded-md bg-muted px-3 py-2 text-xs font-black uppercase">Awaiting approval · not visible to learners</p>}
            <p className="mt-5 whitespace-pre-line leading-7">{t.bio}</p>
            </div>
          </section>
          <section className="grid gap-4 sm:grid-cols-2">
            <Info title="Qualifications" body={t.qualifications || "Not listed"} />
            <Info title="Experience" body={`${t.years_experience} year${t.years_experience === 1 ? "" : "s"} teaching`} />
            <Info title="Dialects" body={t.dialects.join(", ") || "—"} />
            <Info title="Specialities" body={t.specialties.join(", ") || "—"} />
          </section>
          <section className="rounded-lg border border-border bg-card p-6">
            <h2 className="font-display text-xl font-semibold">Reviews</h2>
            {reviews.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No reviews yet. Only learners who completed a lesson can review.</p> :
              <div className="mt-3 divide-y divide-border">{reviews.map((r) => <div key={r.id} className="py-3"><p className="flex gap-0.5 text-highlight">{Array.from({ length: r.rating }).map((_, i) => <Star key={i} className="size-4" fill="currentColor" />)}</p><p className="mt-1 text-sm">{r.comment}</p><p className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</p></div>)}</div>}
          </section>
        </div>

        <aside className="sticky top-24 rounded-lg border border-border bg-card p-5 shadow-sm">
          <p><span className="text-3xl font-black">{money(t.hourly_rate_kobo, t.currency)}</span><span className="text-sm text-muted-foreground"> / hour</span></p>
          <div className="mt-4 grid grid-cols-2 gap-1 rounded-md bg-muted p-1">
            <button onClick={() => { setMode("book"); setMsg(""); }} className={`rounded px-3 py-2 text-sm font-bold ${mode === "book" ? "bg-card shadow-sm" : ""}`}>Book lesson</button>
            <button onClick={() => { setMode("hire"); setMsg(""); }} disabled={!t.open_to_schools} className={`rounded px-3 py-2 text-sm font-bold disabled:opacity-40 ${mode === "hire" ? "bg-card shadow-sm" : ""}`}>Hire for school</button>
          </div>
          {!auth.user ? <Button asChild className="mt-4 w-full"><Link to="/auth">Sign in to continue</Link></Button> : mode === "book" ? (
            <form onSubmit={book} className="mt-4 space-y-3">
              <label className="block text-xs font-bold">Date and time<input name="when" type="datetime-local" required className={`${input} mt-1`} /></label>
              <label className="block text-xs font-bold">Length<select name="minutes" className={`${input} mt-1`}><option value="30">30 minutes</option><option value="60">60 minutes</option><option value="90">90 minutes</option></select></label>
              <label className="block text-xs font-bold">What would you like to learn?<textarea name="note" rows={3} className={`${input} mt-1`} /></label>
              <Button type="submit" className="w-full">Request lesson</Button>
              <p className="text-[11px] text-muted-foreground">Payment by Paystack is taken after the teacher confirms.</p>
            </form>
          ) : (
            <form onSubmit={hire} className="mt-4 space-y-3">
              <label className="block text-xs font-bold">School or organisation<input name="school" required className={`${input} mt-1`} /></label>
              <label className="block text-xs font-bold">Contact email<input name="email" type="email" required defaultValue={auth.user?.email ?? ""} className={`${input} mt-1`} /></label>
              <label className="block text-xs font-bold">Role, hours and location<textarea name="details" rows={4} className={`${input} mt-1`} /></label>
              <Button type="submit" className="w-full">Send hiring request</Button>
            </form>
          )}
          {msg && <p className="mt-3 rounded-md bg-secondary px-3 py-2 text-sm font-bold text-secondary-foreground" role="status">{msg}</p>}
        </aside>
      </div>
    </div>
  );
}

function Info({ title, body }: { title: string; body: string }) {
  return <div className="rounded-lg border border-border bg-card p-4"><p className="text-xs font-extrabold uppercase text-muted-foreground">{title}</p><p className="mt-1 font-bold">{body}</p></div>;
}

function TeachForm({ existing, onDone, onBack }: { existing?: Teacher | undefined; onDone: () => void; onBack: () => void }) {
  const auth = useAuth();
  const [err, setErr] = useState("");
  const list = (v: FormDataEntryValue | null) => String(v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const save = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    const row = {
      display_name: String(f.get("name")), headline: String(f.get("headline")), bio: String(f.get("bio")),
      dialects: list(f.get("dialects")), specialties: list(f.get("specialties")), qualifications: String(f.get("qualifications")),
      years_experience: Number(f.get("years")), hourly_rate_kobo: Math.round(Number(f.get("rate")) * 100),
      video_url: String(f.get("video")) || null, photo_url: String(f.get("photo")) || null, country: String(f.get("country")),
      open_to_schools: f.get("schools") === "on",
    };
    const { error } = existing ? await supabase.from("teacher_profiles").update(row).eq("id", existing.id)
      : await supabase.from("teacher_profiles").insert({ ...row, user_id: auth.user!.id });
    if (error) setErr(error.message); else onDone();
  };
  const d = existing;
  return (
    <div className="rise-in mx-auto max-w-2xl">
      <Button variant="ghost" onClick={onBack}><ArrowLeft className="size-4" /> Back</Button>
      <h1 className="mt-3 font-display text-4xl font-semibold">{d ? "Your teacher profile" : "Teach Igbo on Ozituma"}</h1>
      <p className="mt-2 text-muted-foreground">Set your own rate. Learners and schools find you through your reviews and qualifications. Profiles go live after staff approval.</p>
      <form onSubmit={save} className="mt-6 grid gap-4 sm:grid-cols-2">
        <label className="text-xs font-bold sm:col-span-2">Display name<input name="name" required defaultValue={d?.display_name} className={`${input} mt-1`} /></label>
        <label className="text-xs font-bold sm:col-span-2">Headline<input name="headline" required maxLength={120} defaultValue={d?.headline} placeholder="e.g. Certified Igbo teacher for children and beginners" className={`${input} mt-1`} /></label>
        <label className="text-xs font-bold sm:col-span-2">About you<textarea name="bio" rows={5} defaultValue={d?.bio} className={`${input} mt-1`} /></label>
        <label className="text-xs font-bold sm:col-span-2">Qualifications<input name="qualifications" defaultValue={d?.qualifications} placeholder="e.g. B.A. Igbo, UNN; NCE" className={`${input} mt-1`} /></label>
        <label className="text-xs font-bold">Dialects (comma separated)<input name="dialects" defaultValue={d?.dialects.join(", ")} className={`${input} mt-1`} /></label>
        <label className="text-xs font-bold">Specialities (comma separated)<input name="specialties" defaultValue={d?.specialties.join(", ")} placeholder="Children, Conversation, WAEC" className={`${input} mt-1`} /></label>
        <label className="text-xs font-bold">Years teaching<input name="years" type="number" min={0} defaultValue={d?.years_experience ?? 0} className={`${input} mt-1`} /></label>
        <label className="text-xs font-bold">Rate per hour (₦)<input name="rate" type="number" min={0} step={100} required defaultValue={d ? d.hourly_rate_kobo / 100 : ""} className={`${input} mt-1`} /></label>
        <label className="text-xs font-bold">Country<input name="country" defaultValue={d?.country} className={`${input} mt-1`} /></label>
        <label className="text-xs font-bold">Photo link<input name="photo" type="url" defaultValue={d?.photo_url ?? ""} className={`${input} mt-1`} /></label>
        <label className="text-xs font-bold sm:col-span-2">Intro video link<input name="video" type="url" defaultValue={d?.video_url ?? ""} className={`${input} mt-1`} /></label>
        <label className="flex items-center gap-2 text-sm font-bold sm:col-span-2"><input name="schools" type="checkbox" defaultChecked={d?.open_to_schools ?? true} className="size-4 accent-primary" /> Schools can contact me for hiring</label>
        {err && <p className="text-sm font-bold text-destructive sm:col-span-2">{err}</p>}
        <Button type="submit" className="sm:col-span-2">{d ? "Save changes" : "Submit for approval"}</Button>
      </form>
    </div>
  );
}

function MyLessons({ teacher, onBack, onEdit }: { teacher?: Teacher | undefined; onBack: () => void; onEdit: () => void }) {
  /* A failed payment must be visible. The row had no error state, so it borrowed a sibling's. */
  const [listError, setListError] = useState("");
  const auth = useAuth();
  const [bookings, setBookings] = useState<Tables<"lesson_bookings">[]>([]);
  const [hires, setHires] = useState<Tables<"school_hire_requests">[]>([]);
  const load = useCallback(async () => {
    const [{ data: b }, { data: h }] = await Promise.all([
      supabase.from("lesson_bookings").select("*").order("starts_at", { ascending: true }),
      supabase.from("school_hire_requests").select("*").order("created_at", { ascending: false }),
    ]);
    setBookings(b ?? []); setHires(h ?? []);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const setStatus = async (id: string, status: Tables<"lesson_bookings">["status"]) => { await supabase.from("lesson_bookings").update({ status }).eq("id", id); void load(); };
  const review = async (b: Tables<"lesson_bookings">) => {
    const rating = Number(prompt("Rate this lesson from 1 to 5")); if (!(rating >= 1 && rating <= 5)) return;
    const comment = prompt("A short comment (optional)") ?? "";
    await supabase.from("teacher_reviews").insert({ booking_id: b.id, teacher_id: b.teacher_id, reviewer_id: auth.user!.id, rating, comment });
    alert("Thanks for your review.");
  };

  return (
    <div className="rise-in mx-auto max-w-3xl">
      <Button variant="ghost" onClick={onBack}><ArrowLeft className="size-4" /> All teachers</Button>
      <h1 className="mt-3 font-display text-4xl font-semibold">My lessons</h1>
      {teacher && <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card p-4"><p className="text-sm"><b>Teacher profile:</b> {teacher.status === "approved" ? "Live" : teacher.status === "pending" ? "Awaiting approval" : "Suspended"}</p><Button variant="secondary" onClick={onEdit}>Edit profile</Button></div>}
      <section className="mt-6 space-y-2">
        {bookings.length === 0 && <p className="text-sm text-muted-foreground">No lessons yet.</p>}
        {bookings.map((b) => {
          const iTeach = teacher?.id === b.teacher_id;
          return (
            <div key={b.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4">
              <div><p className="font-bold">{new Date(b.starts_at).toLocaleString()} · {b.minutes} min</p><p className="text-xs text-muted-foreground">{iTeach ? "You are teaching" : "You are learning"} · {b.status}{b.paid ? " · paid" : ""}</p>{b.note && <p className="mt-1 text-sm">{b.note}</p>}</div>
              <div className="flex flex-wrap gap-2">
                {iTeach && b.status === "requested" && <Button onClick={() => setStatus(b.id, "confirmed")}>Confirm</Button>}
                {iTeach && b.status === "confirmed" && <Button onClick={() => setStatus(b.id, "completed")}>Mark taught</Button>}
                {!iTeach && b.status === "confirmed" && !b.paid && <PayWithPaystack bookingId={b.id} priceKobo={b.price_kobo} onError={setListError} />}
                {!iTeach && b.status === "completed" && <Button variant="secondary" onClick={() => review(b)}>Leave review</Button>}
                {(b.status === "requested" || b.status === "confirmed") && <Button variant="ghost" onClick={() => setStatus(b.id, "cancelled")}>Cancel</Button>}
              </div>
            </div>
          );
        })}
      </section>
      {hires.length > 0 && (
        <section className="mt-8">
          <h2 className="font-display text-2xl font-semibold">School hiring requests</h2>
          <div className="mt-3 space-y-2">{hires.map((h) => (
            <div key={h.id} className="rounded-lg border border-border bg-card p-4">
              <p className="font-bold">{h.school_name} <span className="text-xs font-normal text-muted-foreground">· {h.status}</span></p>
              <p className="text-sm text-muted-foreground">{h.contact_email}</p><p className="mt-1 text-sm">{h.role_details}</p>
              {teacher?.id === h.teacher_id && h.status === "sent" && <div className="mt-2 flex gap-2">
                <Button onClick={async () => { await supabase.from("school_hire_requests").update({ status: "accepted" }).eq("id", h.id); void load(); }}>Accept</Button>
                <Button variant="ghost" onClick={async () => { await supabase.from("school_hire_requests").update({ status: "declined" }).eq("id", h.id); void load(); }}>Decline</Button></div>}
            </div>))}</div>
        </section>
      )}
    </div>
  );
}

/**
 * Pay for a confirmed lesson.
 *
 * WHY IT IS A COMPONENT RATHER THAN AN onClick
 *
 * The button has four states a learner needs to be able to tell apart — idle, opening the checkout,
 * failed, and "your card was declined by Paystack" — and an inline handler cannot render any of them
 * without the surrounding list growing a flag per row. Keeping its own state means one row's payment
 * failing does not disable every other row's button.
 *
 * The learner is sent to Paystack with `window.location.assign` rather than opening a popup, because
 * a popup is blocked by default on mobile and a blocked popup looks exactly like a broken button.
 */
function PayWithPaystack({ bookingId, priceKobo, onError }: { bookingId: string; priceKobo: number; onError: (m: string) => void }) {
  const [state, setState] = useState<"idle" | "opening" | "failed">("idle");
  const [reason, setReason] = useState("");

  const REASONS: Record<string, string> = {
    not_signed_in: "Sign in again to pay.",
    not_found: "That booking no longer exists.",
    not_yours: "That booking is not yours to pay for.",
    already_paid: "This lesson is already paid for.",
    not_confirmed: "The teacher has not confirmed this time yet.",
    no_price: "This teacher has not set a rate.",
    no_email: "Your account has no email address for the receipt.",
    paystack_failed: "Paystack would not start the payment. Try again shortly.",
    could_not_store: "We could not record the payment attempt. Nothing was charged.",
  };

  async function pay() {
    setState("opening");
    setReason("");
    try {
      const result = await startLessonCheckout({ data: { bookingId } });
      if (result.ok) {
        window.location.assign(result.authorizationUrl);
        return;
      }
      const message = REASONS[result.reason] ?? "That could not be started.";
      setReason(message);
      setState("failed");
      onError(message);
    } catch {
      setReason("Could not reach the payment server.");
      setState("failed");
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button onClick={pay} disabled={state === "opening"}>
        {state === "opening" ? "Opening…" : `Pay ${priceKobo > 0 ? `₦${(priceKobo / 100).toLocaleString()}` : ""} with Paystack`}
      </Button>
      {state === "failed" && <p className="max-w-56 text-right text-[11px] font-semibold text-destructive">{reason}</p>}
      <p className="text-[11px] text-muted-foreground">Held by Paystack until your lesson happens.</p>
    </div>
  );
}
