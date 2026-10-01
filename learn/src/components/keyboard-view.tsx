import { Check, Copy, Download, Eraser, Palette, Settings2, Smartphone, Monitor } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/button";
import { normalizeIgboText } from "@/lib/igbo-text";
import { cycleIgboVowel, igboVowelCycles, keyboardLayouts, type KeyboardId, type KeyDef } from "@/lib/keyboard-data";
import { defaultSettings, type LearnerSettings } from "@/lib/settings";
import { useStickyState } from "@/lib/use-sticky-state";

/** Keyboard skins. Colours live in styles.css (.kb-*) so new skins are CSS-only. */
export const keyboardThemes = [
  { id: "kb", name: "Chalk" },
  { id: "kb-midnight", name: "Midnight" },
  { id: "kb-akwete", name: "Akwete" },
  { id: "kb-uli", name: "Uli" },
  { id: "kb-forest", name: "Forest" },
  { id: "kb-ocean", name: "Ocean" },
  { id: "kb-sunset", name: "Sunset" },
  { id: "kb-neon", name: "Neon" },
] as const;
type ThemeId = (typeof keyboardThemes)[number]["id"];

type KbPrefs = { theme: ThemeId; numberRow: boolean; flat: boolean; popups: boolean; haptics: boolean; height: "compact" | "normal" | "tall" };
const defaultPrefs: KbPrefs = { theme: "kb", numberRow: true, flat: false, popups: true, haptics: true, height: "normal" };

let vocabCache: string[] | null = null;

export function KeyboardView() {
  const [settings, setSettings] = useStickyState<LearnerSettings>("settings", defaultSettings);
  const [prefs, setPrefs] = useStickyState<KbPrefs>("keyboard:prefs", defaultPrefs);
  const [text, setText] = useStickyState("keyboard:text", "");
  const [suggest, setSuggest] = useStickyState("keyboard:suggest", false);
  const [shift, setShift] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pressed, setPressed] = useState<string | null>(null);
  const [alts, setAlts] = useState<{ key: string; options: readonly string[] } | null>(null);
  const [panel, setPanel] = useState<"themes" | "settings">("themes");
  const [vocab, setVocab] = useState<string[]>(vocabCache ?? []);
  const ref = useRef<HTMLTextAreaElement>(null);
  const holdTimer = useRef<number | null>(null);
  const layoutId = settings.keyboard;
  const layout = keyboardLayouts[layoutId];
  const p = { ...defaultPrefs, ...prefs };
  const keyH = p.height === "compact" ? "h-10" : p.height === "tall" ? "h-14" : "h-12";

  useEffect(() => {
    if (!suggest || vocabCache) return;
    fetch("/keyboards/ig-vocab.txt").then((r) => r.text()).then((t) => {
      vocabCache = Array.from(new Set(t.split(/\s+/).map((w) => w.normalize("NFC")).filter(Boolean)));
      setVocab(vocabCache);
    });
  }, [suggest]);

  const currentWord = useMemo(() => (text.split(/\s/).pop() ?? "").toLowerCase(), [text]);
  const suggestions = useMemo(() => {
    if (!suggest || layoutId !== "igbo" || currentWord.length < 2) return [];
    return vocab.filter((w) => w.startsWith(currentWord) && w !== currentWord).slice(0, 3);
  }, [suggest, layoutId, currentWord, vocab]);

  const buzz = () => { if (p.haptics && typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(8); };

  const insertAtCaret = (insert: string, replaceLast = false) => {
    const el = ref.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    let before = text.slice(0, start);
    if (replaceLast) before = [...before].slice(0, -1).join("");
    const next = normalizeIgboText(before + insert + text.slice(end));
    setText(next);
    const pos = normalizeIgboText(before + insert).length;
    requestAnimationFrame(() => { el?.setSelectionRange(pos, pos); });
  };

  const press = (k: KeyDef) => {
    buzz();
    if (k.action === "shift") return setShift((s) => !s);
    if (k.action === "space") return insertAtCaret(" ");
    if (k.action === "enter") return insertAtCaret("\n");
    if (k.action === "backspace") {
      const el = ref.current; const start = el?.selectionStart ?? text.length; const end = el?.selectionEnd ?? text.length;
      const before = start === end ? [...text.slice(0, start)].slice(0, -1).join("") : text.slice(0, start);
      setText(before + text.slice(end));
      requestAnimationFrame(() => el?.setSelectionRange(before.length, before.length));
      return;
    }
    let out = k.insert ?? k.label;
    if (shift && !k.insert) { out = out.toLocaleUpperCase("ig"); setShift(false); }
    insertAtCaret(out);
  };

  // Long-press a vowel for its dotted / tone forms, like a phone keyboard.
  const startHold = (k: KeyDef) => {
    setPressed(k.label);
    const options = layoutId === "igbo" && !k.action ? igboVowelCycles[k.label] : undefined;
    if (options) holdTimer.current = window.setTimeout(() => { setAlts({ key: k.label, options }); buzz(); }, 380);
  };
  const endHold = (k: KeyDef) => {
    if (holdTimer.current) window.clearTimeout(holdTimer.current);
    setPressed(null);
    if (!alts) press(k);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (layoutId !== "igbo" || !e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key.length !== 1 || !"aeioumn".includes(key)) return;
    e.preventDefault();
    const r = cycleIgboVowel(text.slice(0, e.currentTarget.selectionStart), key);
    insertAtCaret(r.insert, r.replaceLast);
  };

  const pickSuggestion = (w: string) => {
    const parts = text.split(/(\s)/); parts[parts.length - 1] = w; setText(normalizeIgboText(parts.join("") + " "));
  };

  const copy = async () => { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); };
  const download = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" })); a.download = "ozituma-text.txt"; a.click(); };

  const rows = p.numberRow && layoutId !== "ndebe" ? [("1 2 3 4 5 6 7 8 9 0".split(" ").map((c) => ({ label: c })) as KeyDef[]), ...layout.rows] : layout.rows;
  /*
   * The language attribute is what selects the FONT.
   *
   * This read `layoutId === "english" ? "en" : "ig"`, so choosing Ńdẹ́bẹ́ set lang="ig" and the
   * Ndebe glyphs were drawn by the Igbo font — which has no codepoints in the Private Use Area
   * where the script lives. Every key produced a tofu box: the keyboard LOOKED broken because the
   * characters were correct and the font was wrong.
   *
   * `[lang="ndb"]` in styles.css is what pulls in the self-hosted Ndebe fonts. It was written and
   * never reachable, because nothing set the attribute it matches.
   */
  const lang = layoutId === "english" ? "en" : layoutId === "ndebe" ? "ndb" : "ig";

  return (
    <div className="rise-in grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div>
        <p className="text-xs font-extrabold uppercase text-primary">Ozituma Keyboard</p>
        <h1 className="mt-1 font-display text-4xl font-semibold sm:text-5xl">Your language, your look.</h1>
        <p className="mt-2 max-w-xl text-muted-foreground">Type Igbo with every tone mark, try Ńdẹ́bẹ́, and dress the keyboard in a theme you love. Hold a vowel for ị, ì, í and friends.</p>

        <div className="mt-5 inline-flex rounded-full bg-muted p-1" role="tablist" aria-label="Language">
          {(Object.keys(keyboardLayouts) as KeyboardId[]).map((id) => (
            <button key={id} role="tab" aria-selected={layoutId === id} onClick={() => setSettings({ ...settings, keyboard: id })}
              className={`rounded-full px-4 py-2 text-sm font-bold transition ${layoutId === id ? "bg-card shadow-sm" : "text-muted-foreground"}`}>{keyboardLayouts[id].name}</button>
          ))}
        </div>

        {/* Phone-style device */}
        <div className="mx-auto mt-6 max-w-2xl overflow-hidden rounded-[2rem] border-8 border-ink bg-card shadow-2xl">
          <textarea ref={ref} value={text} onChange={(e) => setText(normalizeIgboText(e.target.value))} onKeyDown={onKeyDown} lang={lang} rows={4}
            placeholder={layoutId === "ndebe" ? "Tap the parts below…" : "Kedu? Start typing…"} className="w-full resize-none bg-card p-5 text-xl leading-8 outline-none" />
          <div className={`kb-surface ${p.theme} ${p.flat ? "kb-flat" : ""} relative select-none p-2 pb-4`} onPointerLeave={() => setPressed(null)}>
            {/* Suggestion strip */}
            <div className="mb-2 grid h-9 grid-cols-3 items-center text-center text-sm font-bold">
              {suggestions.length ? suggestions.map((w, i) => (
                <button key={w} onClick={() => pickSuggestion(w)} className={`truncate px-2 ${i === 1 ? "text-base" : "opacity-80"} ${i > 0 ? "border-l border-current/20" : ""}`} lang="ig">{w}</button>
              )) : <span className="col-span-3 text-xs font-bold opacity-60">{layout.name}{suggest && layoutId === "igbo" ? " · suggestions on" : ""}</span>}
            </div>
            {rows.map((r, i) => (
              <div key={i} className="mb-1.5 flex justify-center gap-1 last:mb-0">
                {r.map((k, j) => {
                  const special = !!k.action;
                  const label = shift && !k.action && !k.insert ? k.label.toLocaleUpperCase("ig") : k.label;
                  const isAlt = alts?.key === k.label;
                  return (
                    <div key={`${k.label}-${j}`} className={`relative ${k.wide ? "flex-[4]" : special ? "flex-[1.4]" : "flex-1"} max-w-20`}>
                      <button type="button" lang={lang}
                        onPointerDown={(e) => { e.preventDefault(); startHold(k); }}
                        onPointerUp={() => endHold(k)}
                        className={`${keyH} w-full rounded-lg text-lg font-semibold transition-transform active:scale-95 ${k.action === "enter" || (k.action === "shift" && shift) ? "kb-key-accent" : special ? "kb-key-special" : "kb-key"}`}>
                        {k.action === "space" ? <span className="text-xs opacity-70">{layout.name}</span> : label}
                      </button>
                      {p.popups && pressed === k.label && !special && !isAlt && (
                        <span lang={lang} className="kb-popup kb-key pointer-events-none absolute -top-14 left-1/2 grid h-12 min-w-12 -translate-x-1/2 place-items-center rounded-lg px-2 text-2xl font-bold shadow-lg">{label}</span>
                      )}
                      {isAlt && (
                        <div className="kb-popup kb-key absolute -top-14 left-1/2 z-10 flex -translate-x-1/2 gap-1 rounded-xl p-1 shadow-xl">
                          {alts.options.map((o) => (
                            <button key={o} onPointerUp={(e) => { e.stopPropagation(); insertAtCaret(o); setAlts(null); }} className="kb-key-special grid size-11 place-items-center rounded-lg text-xl font-bold hover:opacity-80" lang="ig">{o}</button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
            {alts && <button aria-label="Close accents" className="fixed inset-0 z-0 cursor-default" onClick={() => setAlts(null)} />}
          </div>
        </div>

        <div className="mx-auto mt-3 flex max-w-2xl flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={copy}>{copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? "Copied" : "Copy"}</Button>
          <Button variant="secondary" onClick={download}><Download className="size-4" /> Save</Button>
          <Button variant="ghost" onClick={() => setText("")}><Eraser className="size-4" /> Clear</Button>
        </div>
        {suggestions.length > 0 && <p className="mx-auto mt-2 max-w-2xl text-[10px] font-black uppercase text-muted-foreground">Suggestions from the open Edémédé word list · not reviewed by Ozituma</p>}
        <p className="mx-auto mt-2 max-w-2xl text-sm text-muted-foreground">{layout.note}</p>
      </div>

      <aside className="rounded-lg border border-border bg-card p-5 shadow-sm xl:sticky xl:top-24">
        <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1">
          <button onClick={() => setPanel("themes")} className={`flex items-center justify-center gap-2 rounded px-3 py-2 text-sm font-bold ${panel === "themes" ? "bg-card shadow-sm" : ""}`}><Palette className="size-4" /> Themes</button>
          <button onClick={() => setPanel("settings")} className={`flex items-center justify-center gap-2 rounded px-3 py-2 text-sm font-bold ${panel === "settings" ? "bg-card shadow-sm" : ""}`}><Settings2 className="size-4" /> Settings</button>
        </div>
        {panel === "themes" ? (
          <div className="mt-4 grid grid-cols-2 gap-3">
            {keyboardThemes.map((t) => (
              <button key={t.id} onClick={() => setPrefs({ ...p, theme: t.id })} aria-pressed={p.theme === t.id}
                className={`overflow-hidden rounded-lg border-2 text-left transition hover:-translate-y-0.5 ${p.theme === t.id ? "border-primary" : "border-border"}`}>
                <div className={`kb-surface ${t.id} grid grid-cols-4 gap-1 p-2`}>
                  {"q w e r a s d ⏎".split(" ").map((c, i) => <span key={c} className={`grid h-6 place-items-center rounded text-[10px] font-bold ${i === 7 ? "kb-key-accent" : "kb-key"}`}>{c}</span>)}
                </div>
                <p className="flex items-center justify-between px-2 py-1.5 text-xs font-bold">{t.name}{p.theme === t.id && <Check className="size-3.5 text-primary" />}</p>
              </button>
            ))}
          </div>
        ) : (
          <div className="mt-4 space-y-3 text-sm">
            <Toggle label="Number row" on={p.numberRow} set={(v) => setPrefs({ ...p, numberRow: v })} />
            <Toggle label="Key pop-ups" on={p.popups} set={(v) => setPrefs({ ...p, popups: v })} />
            <Toggle label="Borderless keys" on={p.flat} set={(v) => setPrefs({ ...p, flat: v })} />
            <Toggle label="Vibrate on tap (phones)" on={p.haptics} set={(v) => setPrefs({ ...p, haptics: v })} />
            {layoutId === "igbo" && <Toggle label="Word suggestions" on={suggest} set={setSuggest} />}
            <div>
              <p className="font-bold">Keyboard height</p>
              <div className="mt-2 grid grid-cols-3 gap-1 rounded-md bg-muted p-1">
                {(["compact", "normal", "tall"] as const).map((h) => <button key={h} onClick={() => setPrefs({ ...p, height: h })} className={`rounded px-2 py-1.5 text-xs font-bold capitalize ${p.height === h ? "bg-card shadow-sm" : ""}`}>{h}</button>)}
              </div>
            </div>
          </div>
        )}
        <div className="mt-6 space-y-2 border-t border-border pt-4 text-sm">
          <p className="font-bold">Get it everywhere</p>
          <p className="flex items-center gap-2 text-muted-foreground"><Smartphone className="size-4" /> Android & iPhone — coming soon</p>
          <p className="flex items-center gap-2 text-muted-foreground"><Monitor className="size-4" /> Windows & Mac — coming soon</p>
          <p className="pt-2 text-xs text-muted-foreground">On a computer: Shift + a / e / i / o / u / n cycles the dotted and tone-marked forms.</p>
          <p className="text-[11px] text-muted-foreground">Igbo shortcuts and word list adapted from Edémédé by Chris C. Emezue &amp; Handel C. Emezue (Apache-2.0).</p>
        </div>
      </aside>
    </div>
  );
}

function Toggle({ label, on, set }: { label: string; on: boolean; set: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 font-bold">
      {label}
      <button type="button" role="switch" aria-checked={on} onClick={() => set(!on)} className={`relative h-6 w-11 rounded-full transition ${on ? "bg-primary" : "bg-muted"}`}>
        <span className={`absolute top-0.5 size-5 rounded-full bg-card shadow transition-all ${on ? "left-5" : "left-0.5"}`} />
      </button>
    </label>
  );
}
