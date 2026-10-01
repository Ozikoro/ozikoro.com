import { Bot, Flag, Mic, Send, Sparkles, Volume2 } from "lucide-react";
import { FormEvent, useState } from "react";
import { Button } from "@/components/button";

type Source = {
  id: string;
  headword: string;
  meaning: string;
  source: string | null;
  variety: string;
  trustLabel: string;
  audioUrl: string | null;
};

/**
 * A message carries its EVIDENCE, not just its words.
 *
 * The trust label and the sources travel with the answer so they cannot be separated from it. A
 * conversational reply is still a linguistic claim, and stripping the label because the AI made it
 * sound natural is exactly the failure this whole layer exists to prevent.
 */
type Message = {
  id: number;
  from: "tutor" | "learner";
  text: string;
  /** The weakest trust in the evidence behind this answer. */
  trust?: { level: string; label: string };
  /** The entry ids and their provenance, for auditing the claim. */
  sources?: Source[];
  /** The label for any Igbo the tutor ASSEMBLED, which is never "verified". */
  generatedNotice?: string;
};

const starters = [
  "What does mmiri mean?",
  "How do I say mother?",
  "Quiz me with five words",
  "Let us practise a market conversation",
] as const;

export function TutorView() {
  const [draft, setDraft] = useState("");
  const [reported, setReported] = useState(false);
  const [audioNotice, setAudioNotice] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { id: 1, from: "tutor", text: "Ask me about any Igbo word. I answer from the Ozituma dictionary and name the entries I used — I will not guess at a word I cannot find." },
  ]);

  /*
   * Ask the server, which answers from the dictionary or declines.
   *
   * The reply is NOT generated here. `/api/tutor` retrieves verified entries first and refuses to
   * answer at all when it finds none, so a refusal is a real answer rather than a failure.
   */
  const [busy, setBusy] = useState(false);
  const send = async (text: string) => {
    const clean = text.trim();
    if (!clean || busy) return;
    setMessages((items) => [...items, { id: Date.now(), from: "learner", text: clean }]);
    setDraft("");
    setBusy(true);

    try {
      const response = await fetch("/api/tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: clean }),
      });
      const data = (await response.json()) as {
        answer?: string;
        revised?: boolean;
        removed?: string[];
        sources?: Source[];
        trust?: { level: string; label: string };
        generatedNotice?: string;
      };

      setMessages((items) => [
        ...items,
        {
          id: Date.now() + 1,
          from: "tutor",
          text: data.answer || "I could not reach the dictionary just now. Please try again.",
          ...(data.trust ? { trust: data.trust } : {}),
          ...(data.sources ? { sources: data.sources } : {}),
          ...(data.generatedNotice ? { generatedNotice: data.generatedNotice } : {}),
        },
      ]);
    } catch {
      setMessages((items) => [
        ...items,
        { id: Date.now() + 1, from: "tutor", text: "I could not reach the dictionary just now. Please try again." },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    send(draft);
  };

  return (
    <section className="rise-in grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]" aria-label="Tutor preview">
      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between gap-4 border-b border-border bg-brand px-5 py-4 text-brand-foreground sm:px-6">
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-full bg-highlight text-highlight-foreground"><Bot className="size-5" /></span>
            <div><h2 className="font-display text-xl font-semibold">Ozituma Tutor</h2><p className="text-xs text-brand-foreground/75">Learning preview · not live AI</p></div>
          </div>
          <span className="flex items-center gap-2 text-xs font-bold"><span className="size-2 rounded-full bg-highlight" /> Ready</span>
        </div>

        <div className="min-h-[360px] space-y-5 px-4 py-6 sm:px-6" aria-live="polite">
          {messages.map((message) => (
            <div key={message.id} className={`flex ${message.from === "learner" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[86%] rounded-lg px-4 py-3 text-sm leading-6 sm:max-w-[72%] ${message.from === "learner" ? "bg-primary text-primary-foreground" : "border border-border bg-secondary text-secondary-foreground"}`}>
                <p className="whitespace-pre-wrap">{message.text}</p>

                {/*
                  The evidence panel.
                  
                  The trust label is shown BESIDE the words, not on a separate page, because a
                  conversational answer is still a linguistic claim and separating the two is how a
                  source gets forgotten. The weakest trust in the evidence is the one shown, and the
                  entries are listed with their id and originating corpus so any claim can be traced
                  back to the row it came from.
                */}
                {message.from === "tutor" && message.trust && (
                  <div className="mt-3 border-t border-border/70 pt-3">
                    <p className="text-[11px] font-black uppercase tracking-wide">{message.trust.label}</p>

                    {message.generatedNotice && (
                      <p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">{message.generatedNotice}</p>
                    )}

                    {message.sources && message.sources.length > 0 && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[11px] font-bold text-muted-foreground">
                          {message.sources.length} dictionary {message.sources.length === 1 ? "entry" : "entries"} used
                        </summary>
                        <ul className="mt-2 space-y-1.5">
                          {message.sources.slice(0, 8).map((src) => (
                            <li key={src.id} className="text-[11px] leading-5">
                              <span className="font-bold" lang="ig">{src.headword}</span>
                              {" — "}{src.meaning.slice(0, 70)}{src.meaning.length > 70 ? "…" : ""}
                              <br />
                              <span className="text-muted-foreground">
                                {src.trustLabel} · {src.variety}
                                {src.source ? ` · ${src.source}` : ""}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}

                    <div className="mt-2 flex items-center gap-1">
                      <Button variant="ghost" className="min-h-8 px-2 text-xs" onClick={() => setAudioNotice(true)}><Volume2 className="size-3.5" /> Listen</Button>
                      <Button variant="ghost" className="min-h-8 px-2 text-xs" onClick={() => setReported(true)}><Flag className="size-3.5" /> Report</Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-border bg-background p-4 sm:p-5">
          <form onSubmit={submit} className="flex items-end gap-2">
            <label className="min-w-0 flex-1">
              <span className="sr-only">Ask your tutor</span>
              <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={2} placeholder="Ask about an approved lesson…" className="w-full resize-none rounded-md border border-input bg-card px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
            </label>
            <Button type="button" variant="icon" aria-label="Voice input preview" onClick={() => setAudioNotice(true)}><Mic className="size-5" /></Button>
            <Button type="submit" variant="icon" aria-label="Send question" disabled={!draft.trim()} className="bg-primary text-primary-foreground hover:bg-primary/90"><Send className="size-5" /></Button>
          </form>
          {(audioNotice || reported) && <p className="mt-3 text-xs font-semibold text-muted-foreground">{reported ? "Thanks. The sample response has been marked for review." : "Audio will activate when approved recordings are added."}</p>}
        </div>
      </div>

      <aside className="space-y-5">
        <section className="rounded-md border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center gap-2"><Sparkles className="size-4 text-primary" /><h2 className="font-display text-xl font-semibold">Choose a goal</h2></div>
          <div className="mt-4 space-y-2">
            {starters.map((starter) => <Button key={starter} variant="secondary" className="h-auto w-full justify-start py-3 text-left" onClick={() => send(starter)}>{starter}</Button>)}
          </div>
        </section>
        <section className="rounded-md border border-border bg-secondary p-5">
          <p className="text-xs font-extrabold uppercase text-muted-foreground">Content status</p>
          <h2 className="mt-2 font-display text-xl font-semibold">Safe by design</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">This screen demonstrates the tutoring experience only. It does not invent translations or language instruction.</p>
          <span className="mt-4 inline-flex rounded-sm bg-card px-2 py-1 text-[10px] font-black uppercase text-muted-foreground">Grounded in Ozituma entries · AI-generated teaching, not verified language</span>
        </section>
      </aside>
    </section>
  );
}