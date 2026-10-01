import {
  BookOpen,
  Calculator,
  Check,
  ChevronRight,
  Copy,
  Delete,
  Download,
  ExternalLink,
  Grid3X3,
  Hash,
  Keyboard,
  LayoutGrid,
  RotateCcw,
  Search,
  Sprout,
  Type,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/button";
import {
  arithmeticRules,
  bodyOf,
  catalogueCategories,
  catalogueGlyphs,
  catalogueTotal,
  flagOf,
  fontsRepo,
  keymanPackage,
  ndebeCombined,
  ndebeCredit,
  ndebeFonts,
  ndebeModules,
  ndebeNumeralNames,
  ndebeParts,
  ndebeStemRows,
  ndebeStems,
  ndebeTones,
  ndebeVowels,
  teachingRadicals,
  teachingStems,
  teachingVowelBases,
  teachingVowelTones,
  numeralNotation,
  operationSummary,
  palettes,
  placeValues,
  typingNotes,
  typingShortcuts,
  toBase20,
} from "@/lib/ndebe-data";
import { useStickyState } from "@/lib/use-sticky-state";

const workspaces = [
  { id: "type", label: "Type", icon: Keyboard },
  { id: "learn", label: "Learn", icon: BookOpen },
  { id: "catalogue", label: "Script catalogue", icon: LayoutGrid },
  { id: "teaching", label: "How a character grows", icon: Sprout },
  { id: "numerals", label: "Numerals", icon: Hash },
  { id: "arithmetic", label: "Arithmetic", icon: Calculator },
  { id: "help", label: "Typing help", icon: Type },
  { id: "fonts", label: "Fonts", icon: Download },
] as const;
type Workspace = (typeof workspaces)[number]["id"];

const card = "rounded-md border border-border bg-card p-5 shadow-sm";
const eyebrow = "text-xs font-extrabold uppercase text-primary";
const Badge = () => <span className="rounded-sm bg-muted px-2 py-1 text-[10px] font-black uppercase text-muted-foreground">Prototype notation</span>;

async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); } catch { /* clipboard unavailable */ }
}

export function NdebeStudio() {
  const [workspace, setWorkspace] = useStickyState<Workspace>("ndebe:workspace", "type");
  return (
    <section className="rise-in" aria-label="Ndebe learning studio">
      <div className="mb-6 overflow-hidden rounded-lg bg-ink text-primary-foreground shadow-lg">
        <div className="px-5 py-6 sm:px-8 sm:py-8">
          <p className="text-xs font-extrabold uppercase text-highlight">Ndebe learning studio</p>
          <h2 className="mt-2 font-display text-3xl font-semibold sm:text-4xl">A whole world in every character</h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-primary-foreground/75">{ndebeCredit} Type, explore the script, learn its numerals and arithmetic, and download the fonts.</p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Button className="bg-highlight text-highlight-foreground hover:bg-highlight/90" onClick={() => setWorkspace("type")}><Keyboard className="size-4" /> Start typing</Button>
            <Button className="border border-primary-foreground/25 bg-transparent text-primary-foreground hover:bg-primary-foreground/10" onClick={() => setWorkspace("catalogue")}><Grid3X3 className="size-4" /> Explore the script</Button>
            <Button className="border border-primary-foreground/25 bg-transparent text-primary-foreground hover:bg-primary-foreground/10" onClick={() => setWorkspace("numerals")}><Hash className="size-4" /> Numerals</Button>
          </div>
        </div>
      </div>

      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-border" role="tablist" aria-label="Ndebe tools">
        {workspaces.map(({ id, label, icon: Icon }) => (
          <Button key={id} variant="ghost" role="tab" aria-selected={workspace === id} onClick={() => setWorkspace(id)} className={`shrink-0 rounded-b-none ${workspace === id ? "border-b-2 border-primary text-primary" : ""}`}><Icon className="size-4" /> {label}</Button>
        ))}
      </div>

      {workspace === "type" && <TypeWorkspace />}
      {workspace === "learn" && <LearnWorkspace go={setWorkspace} />}
      {workspace === "catalogue" && <CatalogueWorkspace />}
      {workspace === "teaching" && <TeachingWorkspace />}
      {workspace === "numerals" && <NumeralsWorkspace go={setWorkspace} />}
      {workspace === "arithmetic" && <ArithmeticWorkspace />}
      {workspace === "help" && <HelpWorkspace />}
      {workspace === "fonts" && <FontsWorkspace />}
    </section>
  );
}

function TypeWorkspace() {
  const [stem, setStem] = useState<string | null>(null);
  const [tokens, setTokens] = useStickyState<string[]>("ndebe:tokens", []);
  const [copied, setCopied] = useState(false);
  const [palette, setPalette] = useState<keyof typeof palettes | null>(null);

  /*
   * Real glyphs, not bracket notation.
   *
   * `push` used to emit `[stem · vowel · tone]` — a labelled description of a character, because no
   * verified mapping existed. It does now: `ndebeCombined` holds the 630 attested combinations from
   * typendebe.com's own data, so the studio can emit the character itself.
   *
   * The tone names are mapped to the suffixes the source data uses. `TONE_KEY` is the translation
   * between the two, kept beside the lookup that needs it.
   */
  const TONE_KEY: Record<string, string> = { High: "enu", Mid: "ntela", Low: "ani" };
  const glyphFor = (consonant: string, vowel: string, tone: string): string =>
    ndebeCombined[`${consonant}|${vowel}|${TONE_KEY[tone] ?? "ntela"}`] ?? "";

  const push = (t: string) => { setTokens((x) => [...x, t]); setCopied(false); };
  const addVowel = (vowel: string, tone: string) => { const g = glyphFor(stem ?? "", vowel, tone); push(g || `?${vowel}`); setStem(null); };

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="overflow-hidden rounded-md border border-border bg-card shadow-sm">
        <div className="border-b border-border p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><p className={eyebrow}>Type Ńdẹ́bẹ́</p><h3 className="mt-1 font-display text-2xl font-semibold">Your text</h3></div><Badge /></div>
          <div className="mt-5 min-h-32 rounded-md border border-input bg-background p-4" aria-live="polite">
            {tokens.length ? <p lang="ndb" className="ndebe break-words text-3xl leading-[1.6]">{tokens.join(" ")}{stem && <span className="text-primary text-lg"> · {stem} selected</span>}</p> : <p className="text-sm text-muted-foreground">Pick a stem, then a vowel in its tone row. The character appears above in the Ńdẹ́bẹ́ font.</p>}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="mr-auto text-xs font-bold text-muted-foreground">{tokens.length} characters</span>
            <Button variant="secondary" onClick={async () => { await copy(tokens.join(" ")); setCopied(true); }} disabled={!tokens.length}>{copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? "Copied" : "Copy text"}</Button>
            <Button variant="secondary" disabled={!tokens.length} onClick={() => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([tokens.join(" ")], { type: "text/plain;charset=utf-8" })); a.download = "ndebe.txt"; a.click(); }}><Download className="size-4" /> Save text</Button>
            <Button variant="ghost" onClick={() => setTokens((x) => x.slice(0, -1))} disabled={!tokens.length}><Delete className="size-4" /> Backspace</Button>
            <Button variant="ghost" onClick={() => { setTokens([]); setStem(null); }} disabled={!tokens.length && !stem}><RotateCcw className="size-4" /> Clear</Button>
          </div>
        </div>

        <div className="space-y-6 p-5 sm:p-6">
          <div>
            <p className="mb-2 text-xs font-extrabold uppercase text-muted-foreground">1. Stem {stem && <span className="text-primary">· {stem} selected</span>}</p>
            <div className="grid grid-cols-7 gap-1.5">
              {ndebeStemRows.flat().map((s) => <button key={s} type="button" onClick={() => setStem(stem === s ? null : s)} className={`min-h-11 rounded-sm border px-1 text-[11px] font-black transition-colors sm:text-xs ${stem === s ? "border-primary bg-primary text-primary-foreground" : "border-border bg-secondary hover:border-primary"}`}>{s}</button>)}
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-extrabold uppercase text-muted-foreground">2. Vowel and tone</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] table-fixed border-separate border-spacing-1 text-xs">
                <thead><tr><th />{ndebeVowels.map((v) => <th key={v} className="font-black">{v}</th>)}</tr></thead>
                <tbody>{ndebeTones.map((tone, ti) => (
                  <tr key={tone}><th className="pr-2 text-left font-black text-muted-foreground">{tone}</th>{ndebeVowels.map((v) => (
                    <td key={v}><button type="button" onClick={() => addVowel(v, tone)} aria-label={`${v} ${tone}`} className={`h-10 w-full rounded-sm border border-border font-black hover:border-primary ${ti === 0 ? "bg-highlight/25" : ti === 1 ? "bg-secondary" : "bg-muted"}`}>{v}</button></td>
                  ))}</tr>
                ))}</tbody>
              </table>
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-extrabold uppercase text-muted-foreground">Numerals, marks and palettes</p>
            <div className="grid grid-cols-10 gap-1.5">
              {ndebeNumeralNames.map((name, i) => <button key={name} type="button" title={name} onClick={() => push(`[${i} · ${name}]`)} className="min-h-10 rounded-sm border border-border bg-card text-xs font-black hover:border-primary">{i}</button>)}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Button variant="secondary" onClick={() => push("[nzobe]")}>Nzobe `</Button>
              <Button variant="secondary" onClick={() => push("·")}>Interpunct ·</Button>
              <Button variant="secondary" onClick={() => push("[vigesimal marker]")}>Vigesimal marker</Button>
              <Button variant="secondary" onClick={() => push("[decimal marker]")}>Decimal marker</Button>
              {(Object.keys(palettes) as (keyof typeof palettes)[]).map((p) => <Button key={p} variant={palette === p ? "primary" : "ghost"} onClick={() => setPalette(palette === p ? null : p)}>{p}</Button>)}
            </div>
            {palette && <div className="mt-3 flex flex-wrap gap-1.5 rounded-md border border-border bg-secondary p-3">{palettes[palette].map((c) => <button key={c} type="button" onClick={() => push(c)} className="min-h-9 min-w-9 rounded-sm border border-border bg-card px-2 text-sm font-bold hover:border-primary">{c === "\u00A0" ? "NBSP" : c === "\u202F" ? "NNBSP" : c}</button>)}</div>}
          </div>
        </div>
      </div>

      <aside className="space-y-4">
        <section className="rounded-md border border-border bg-secondary p-5"><p className="text-xs font-extrabold uppercase text-muted-foreground">Key colours</p><ul className="mt-3 space-y-2 text-sm font-bold"><li className="flex items-center gap-2"><span className="size-3 rounded-sm bg-highlight/60" /> Vowel · high</li><li className="flex items-center gap-2"><span className="size-3 rounded-sm bg-secondary border border-border" /> Vowel · mid</li><li className="flex items-center gap-2"><span className="size-3 rounded-sm bg-muted-foreground/40" /> Vowel · low</li><li className="flex items-center gap-2"><span className="size-3 rounded-sm bg-primary" /> Stem</li></ul></section>
        <section className="rounded-md border border-border bg-card p-5"><h3 className="font-display text-lg font-semibold">Real characters</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">When the verified key-to-glyph mapping is supplied, this same keyboard will output real Ndebe characters in your chosen font.</p><a className="mt-3 inline-flex items-center gap-1 text-sm font-bold text-primary" href="https://typendebe.com/" target="_blank" rel="noopener noreferrer">Open Type Ńdẹ́bẹ́ <ExternalLink className="size-3.5" /></a></section>
      </aside>
    </div>
  );
}

function LearnWorkspace({ go }: { go: (w: Workspace) => void }) {
  const target: Record<number, Workspace> = { 0: "fonts", 5: "teaching", 7: "numerals", 8: "arithmetic" };
  return <div className="grid gap-3 lg:grid-cols-2">{ndebeModules.map((m) => (
    <article key={m.number} className="flex min-h-32 gap-4 rounded-md border border-border bg-card p-5 shadow-sm">
      <span className={`grid size-11 shrink-0 place-items-center rounded-md font-black ${m.status === "current" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{m.number}</span>
      <div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><h3 className="font-display text-lg font-semibold">{m.title}</h3>{m.status === "current" && <span className="text-[10px] font-black uppercase text-primary">Start here</span>}</div><p className="mt-2 text-sm leading-5 text-muted-foreground">{m.detail}</p>
        <Button variant="ghost" className="mt-2 min-h-8 px-0 text-primary" onClick={() => go(target[m.number] ?? "type")}>Open <ChevronRight className="size-4" /></Button></div>
    </article>))}</div>;
}

function CatalogueWorkspace() {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<(typeof catalogueCategories)[number]>("All");
  const [selected, setSelected] = useState<(typeof catalogueGlyphs)[number] | null>(null);
  const list = useMemo(() => catalogueGlyphs.filter((g) => (cat === "All" || g.category === cat) && `${g.name} ${g.code ?? ""}`.toLowerCase().includes(q.toLowerCase().trim())), [q, cat]);
  return (
    <div>
      <p className={eyebrow}>01 / The collection</p>
      <h3 className="mt-1 font-display text-3xl font-semibold">Every form, in one place.</h3>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Search by name or code point. Select a card to inspect its encoding. The full release holds {catalogueTotal.toLocaleString()} glyphs; a sample is loaded here until the complete glyph list is imported.</p>
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <label className="flex min-h-11 flex-1 items-center gap-2 rounded-md border border-input bg-card px-3"><Search className="size-4 text-muted-foreground" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a character" className="w-full bg-transparent text-sm outline-none" /></label>
        <Button variant="ghost" onClick={() => { setQ(""); setCat("All"); }}>Reset filters</Button>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">{catalogueCategories.map((c) => <Button key={c} variant={cat === c ? "primary" : "secondary"} className="min-h-9" onClick={() => setCat(c)}>{c}</Button>)}</div>
      <p className="mt-4 text-xs font-bold text-muted-foreground">{list.length} of {catalogueGlyphs.length} loaded glyphs</p>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {list.map((g) => <button key={g.name} type="button" onClick={() => setSelected(g)} className="flex min-h-28 flex-col justify-between rounded-md border border-border bg-card p-3 text-left hover:border-primary"><span className="grid h-12 place-items-center rounded-sm border border-dashed border-border text-lg text-muted-foreground">◌</span><span><b className="block truncate text-sm">{g.name}</b><span className="text-xs text-muted-foreground">{g.code ?? "Code pending"}</span></span></button>)}
      </div>
      {selected && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/60 p-4" role="dialog" aria-modal="true" aria-label={selected.name} onClick={() => setSelected(null)}>
          <div className="w-full max-w-sm rounded-lg bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between"><div><p className={eyebrow}>{selected.category}</p><h4 className="mt-1 font-display text-2xl font-semibold">{selected.name}</h4></div><Button variant="ghost" aria-label="Close" onClick={() => setSelected(null)}>×</Button></div>
            <div className="mt-4 grid h-32 place-items-center rounded-md border border-dashed border-border text-4xl text-muted-foreground">◌</div>
            <p className="mt-3 text-sm text-muted-foreground">Encoding: <b className="text-foreground">{selected.code ?? "awaiting verified mapping"}</b>. Outline preview appears once the licensed font is connected.</p>
            <div className="mt-4 flex gap-2">
              <Button variant="secondary" disabled={!selected.code} onClick={() => selected.code && copy(String.fromCodePoint(parseInt(selected.code.slice(2), 16)))}><Copy className="size-4" /> Copy character</Button>
              <Button variant="ghost" onClick={() => copy(selected.name)}>Copy name</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TeachingWorkspace() {
  const [stem, setStem] = useState("none");
  const [radical, setRadical] = useState("none");
  const [vowel, setVowel] = useState("none");
  const [nzobe, setNzobe] = useState(false);
  const vowelOptions = teachingVowelBases.flatMap((b) => teachingVowelTones.map((t) => `${b}-${t.id}`));
  const parts = [
    vowel !== "none" && (vowel === "dotted" ? "[vowel ◌]" : vowel),
    nzobe && "nzobe",
    vowel !== "none" && "branch",
    stem !== "none" && (stem === "dotted" ? "[stem ◌]" : stem),
    radical !== "none" && (radical === "dotted" ? "[radical ◌]" : radical),
  ].filter(Boolean) as string[];
  const Select = ({ label, value, set, options, dotted }: { label: string; value: string; set: (v: string) => void; options: readonly string[]; dotted: string }) => (
    <label className="block text-sm font-bold">{label}<select value={value} onChange={(e) => set(e.target.value)} className="mt-1 min-h-11 w-full rounded-md border border-input bg-card px-3"><option value="none">None</option><option value="dotted">{dotted}</option>{options.map((o) => <option key={o} value={o}>{o}</option>)}</select></label>
  );
  const shapes = [["◌", "Vowel above a stem placeholder"], ["◌", "Radical beside a stem placeholder"], ["", "Bare stem"], ["", "Bare stem and radical"], ["◌", "Both body placeholders"], ["", "Vowel placeholder above a body"], ["", "Stem with radical placeholder"], ["◌", "Nzobe above both body placeholders"]];
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
      <section>
        <p className={eyebrow}>02 / How a character grows</p>
        <h3 className="mt-1 font-display text-3xl font-semibold">Stem. Branch. Fruit.</h3>
        <p className="mt-2 text-sm text-muted-foreground">Show a component, leave a dotted space for it, or remove it. Teaching forms are separate from ordinary input.</p>
        <div className="mt-5 space-y-3">
          <Select label="Consonant stem" value={stem} set={setStem} options={teachingStems} dotted="Dotted stem rectangle" />
          <Select label="Fruit radical" value={radical} set={setRadical} options={teachingRadicals} dotted="Dotted radical square" />
          <Select label="Vowel above" value={vowel} set={(v) => { setVowel(v); if (v === "none") setNzobe(false); }} options={vowelOptions} dotted="Dotted vowel rectangle" />
          <label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={nzobe} disabled={vowel === "none"} onChange={(e) => setNzobe(e.target.checked)} className="size-4 accent-primary" /> Nzobe (needs a vowel)</label>
          <p className="text-xs text-muted-foreground">A vowel or vowel placeholder requires the connecting branch.</p>
        </div>
      </section>
      <section className="space-y-4">
        <div className={card}>
          <div className="flex items-center justify-between"><p className="text-xs font-extrabold uppercase text-muted-foreground">Teaching form</p><Badge /></div>
          <div className="mt-4 flex min-h-40 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-background p-4">
            {parts.length ? parts.map((p, i) => <span key={i} className={`rounded-sm px-3 py-1 font-mono text-sm font-bold ${p.includes("◌") ? "border-2 border-dashed border-muted-foreground" : p === "branch" ? "bg-muted text-muted-foreground" : "bg-primary/15 text-primary"}`}>{p}</span>) : <span className="text-sm text-muted-foreground">Choose components to build a form.</span>}
          </div>
          <Button variant="secondary" className="mt-3" disabled={!parts.length} onClick={() => copy(parts.join(" + "))}><Copy className="size-4" /> Copy teaching form</Button>
        </div>
        <div className="grid grid-cols-2 gap-2">{shapes.map(([, label]) => <div key={label} className="rounded-md border border-border bg-card p-3 text-xs font-bold">{label}</div>)}</div>
        <div className="grid gap-2">{ndebeParts.map((p) => <div key={p.name} className="rounded-md border border-border bg-secondary p-3"><b className="text-sm">{p.name}</b><p className="text-xs text-muted-foreground">{p.description}</p></div>)}</div>
      </section>
    </div>
  );
}

function NumeralCard({ d, small }: { d: number; small?: boolean }) {
  return (
    <div className={`rounded-md border border-border bg-card text-center ${small ? "p-2" : "p-3"}`}>
      <div className="mx-auto flex w-12 flex-col items-center">
        <span className={`w-full rounded-t-sm py-0.5 text-[10px] font-black ${flagOf(d) ? "bg-accent/30" : "border border-dashed border-border text-muted-foreground"}`}>{flagOf(d)}F</span>
        <span className={`w-full rounded-b-sm py-1 text-sm font-black ${bodyOf(d) ? "bg-primary/15 text-primary" : "border border-dashed border-border text-muted-foreground"}`}>{bodyOf(d)}B</span>
      </div>
      <p className="mt-2 text-sm font-black">{d}</p>
      {!small && <p className="text-xs text-muted-foreground">{ndebeNumeralNames[d]}</p>}
    </div>
  );
}

function NumeralsWorkspace({ go }: { go: (w: Workspace) => void }) {
  const [form, setForm] = useState("Normal");
  return (
    <div>
      <p className={eyebrow}>03 / Numeral forms</p>
      <h3 className="mt-1 font-display text-3xl font-semibold">Twenty digits. A complete system.</h3>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Every numeral from 0 to 19 is one glyph with two layers: a <b>flag</b> on top (0, 5, 10 or 15) and a <b>body</b> below (0–4). A flag step is worth 5 and the largest body is 4, so the flag always outweighs the body.</p>
      <div className="mt-4 flex flex-wrap gap-1.5">{["Normal", "Superscript", "Subscript", "Numerator", "Denominator"].map((f) => <Button key={f} variant={form === f ? "primary" : "secondary"} className="min-h-9" onClick={() => setForm(f)}>{f}</Button>)}</div>
      <p className="mt-2 text-xs text-muted-foreground">Showing the {form.toLowerCase()} form structure; small forms render at size once the font is connected.</p>
      <div className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-5 lg:grid-cols-10">{ndebeNumeralNames.map((_, d) => <NumeralCard key={d} d={d} />)}</div>
      <h4 className="mt-8 font-display text-xl font-semibold">Number flags · okoloto</h4>
      <div className="mt-3 grid grid-cols-3 gap-2 sm:max-w-md">{[["okoloto.ise", 5], ["okoloto.ili", 10], ["okoloto.mise", 15]].map(([n, v]) => <div key={n} className={card}><b className="block text-2xl">{v}F</b><span className="text-xs text-muted-foreground">{n}</span></div>)}</div>
      <Button className="mt-6" onClick={() => go("arithmetic")}>Continue to place value <ChevronRight className="size-4" /></Button>
    </div>
  );
}

function ArithmeticWorkspace() {
  const [value, setValue] = useState(77);
  const [a, setA] = useState(15);
  const [b, setB] = useState(7);
  const digits = toBase20(value);
  const sum = a + b;
  const bodies = bodyOf(a) + bodyOf(b);
  const flags = flagOf(a) + flagOf(b) + (bodies >= 5 ? 5 : 0);
  const cmp = (x: number, y: number) => (x > y ? ">" : x < y ? "<" : "=");
  const [c1, setC1] = useState(39);
  const [c2, setC2] = useState(40);
  const num = (v: number, set: (n: number) => void, max = 3199999) => <input type="number" min={0} max={max} value={v} onChange={(e) => set(Math.max(0, Math.min(max, Number(e.target.value) || 0)))} className="min-h-11 w-28 rounded-md border border-input bg-card px-3 font-bold" />;
  return (
    <div className="space-y-8">
      <section>
        <p className={eyebrow}>Arithmetic in Ńdẹ́bẹ́ numerals</p>
        <h3 className="mt-1 font-display text-3xl font-semibold">Base 20, sub-base 5</h3>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">Each place is worth 20 times the place to its right. Examples run on two tracks: the procedure track works entirely in base 20; the commentary track shows base-10 figures to help you check.</p>
      </section>

      <section className={card}>
        <h4 className="font-display text-xl font-semibold">Place value converter</h4>
        <div className="mt-3 flex flex-wrap items-center gap-3"><span className="text-sm font-bold">Base-10 value</span>{num(value, setValue)}<span className="font-mono text-sm text-muted-foreground">[{digits.join(", ")}]₂₀ · {digits.map(numeralNotation).join(", ")}</span></div>
        <div className="mt-4 flex flex-wrap gap-3">{digits.map((d: number, i: number) => <div key={i} className="text-center"><NumeralCard d={d} small /><p className="mt-1 max-w-24 text-[10px] font-bold text-muted-foreground">{placeValues[digits.length - 1 - i]}</p></div>)}</div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className={card}>
          <h4 className="font-display text-xl font-semibold">Comparing numbers</h4>
          <p className="mt-1 text-sm text-muted-foreground">More digits wins. Otherwise compare the leftmost digit — flag first, then body.</p>
          <div className="mt-3 flex items-center gap-3">{num(c1, setC1)}<b className="text-3xl text-primary">{cmp(c1, c2)}</b>{num(c2, setC2)}</div>
          <p className="mt-3 font-mono text-xs text-muted-foreground">{toBase20(c1).map(numeralNotation).join(", ")} {cmp(c1, c2)} {toBase20(c2).map(numeralNotation).join(", ")}</p>
        </div>
        <div className={card}>
          <h4 className="font-display text-xl font-semibold">Adding two digits</h4>
          <div className="mt-3 flex items-center gap-2">{num(a, setA, 19)}<b>+</b>{num(b, setB, 19)}</div>
          <ol className="mt-3 space-y-1 text-sm">
            <li>Flags: {flagOf(a)}F + {flagOf(b)}F · Bodies: {bodyOf(a)}B + {bodyOf(b)}B = {bodies}B</li>
            {bodies >= 5 && <li className="text-primary">Flag promotion: body reached {bodies}B → +5F, body {bodies - 5}B</li>}
            {flags >= 20 && <li className="text-primary">Place promotion: flags reached {flags}F → carry 1B to the twenties</li>}
            <li className="font-bold">Result: {toBase20(sum).map(numeralNotation).join(", ")} = {sum}</li>
          </ol>
        </div>
      </section>

      <section>
        <h4 className="font-display text-xl font-semibold">Promotion and demotion rules</h4>
        <div className="mt-3 grid gap-3 md:grid-cols-2">{arithmeticRules.map((r) => <article key={r.title} className={card}><b>{r.title}</b><p className="mt-2 text-sm"><span className="font-bold text-muted-foreground">Trigger:</span> {r.trigger}</p><p className="text-sm"><span className="font-bold text-muted-foreground">Effect:</span> {r.effect}</p><p className="mt-2 rounded-sm bg-muted px-2 py-1 font-mono text-xs">{r.example}</p></article>)}</div>
      </section>

      <section className="overflow-x-auto">
        <h4 className="font-display text-xl font-semibold">The operations at a glance</h4>
        <table className="mt-3 w-full min-w-[640px] text-left text-sm">
          <thead><tr className="border-b border-border text-xs uppercase text-muted-foreground"><th className="py-2">Operation</th><th>Core method</th><th>Key rule</th></tr></thead>
          <tbody>{operationSummary.map((o) => <tr key={o.op} className="border-b border-border align-top"><td className="py-2 font-bold">{o.op}</td><td className="pr-3">{o.method}</td><td>{o.rule}</td></tr>)}</tbody>
        </table>
      </section>
    </div>
  );
}

function HelpWorkspace() {
  return (
    <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
      <section>
        <p className={eyebrow}>04 / From key to character</p>
        <h3 className="mt-1 font-display text-3xl font-semibold">Make yourself understood.</h3>
        <div className="mt-4 overflow-hidden rounded-md border border-border bg-card">{typingShortcuts.map((s) => <div key={s.keys} className="flex flex-wrap items-start gap-3 border-b border-border p-3 last:border-0"><kbd className="min-w-40 rounded-sm bg-muted px-2 py-1 font-mono text-xs font-bold">{s.keys}</kbd><span className="flex-1 text-sm">{s.action}</span></div>)}</div>
      </section>
      <section className="space-y-3">{typingNotes.map((n) => <div key={n.title} className={card}><b>{n.title}</b><p className="mt-1 text-sm text-muted-foreground">{n.body}</p></div>)}</section>
    </div>
  );
}

function FontsWorkspace() {
  return (
    <div>
      <p className={eyebrow}>05 / Take the script with you</p>
      <h3 className="mt-1 font-display text-3xl font-semibold">Two voices. One script.</h3>
      <p className="mt-2 text-sm text-muted-foreground">Version 1.000 RC1. Desktop fonts and the Keyman keyboard.</p>
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        {ndebeFonts.map((f) => <article key={f.name} className={card}><h4 className="font-display text-xl font-semibold">{f.name}</h4><p className="text-sm text-muted-foreground">{f.tagline} · weight {f.weight}</p><a href={f.href} className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-bold text-primary-foreground"><Download className="size-4" /> Download TTF</a></article>)}
        <article className={card}><p className="text-xs font-extrabold uppercase text-muted-foreground">Desktop input</p><h4 className="font-display text-xl font-semibold">Ńdẹ́bẹ́ keyboard</h4><p className="text-sm text-muted-foreground">Install with Keyman, then select Ńdẹ́bẹ́ and an Ńdẹ́bẹ́ font in your document app.</p><a href={keymanPackage} className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-bold text-primary-foreground"><Download className="size-4" /> Keyman package</a></article>
      </div>
      <div className={`${card} mt-4`}><b>Installation and current limits</b><p className="mt-1 text-sm text-muted-foreground">Open the TTF to install it. Each is a separate family with a Regular face. Installing a font does not change your keyboard mapping. Rendering was checked on macOS; Windows and mobile input remain unverified.</p><a href={fontsRepo} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-sm font-bold text-primary">Ńdẹ́bẹ́ Fonts repository <ExternalLink className="size-3.5" /></a></div>
    </div>
  );
}
