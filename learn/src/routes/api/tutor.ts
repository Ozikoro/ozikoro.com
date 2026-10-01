/**
 * POST /api/tutor — the Ozituma tutor orchestrator.
 *
 *   Learner -> interface -> THIS -> retrieval -> verified data -> LLM -> validation -> response
 *
 * THE ONE SENTENCE THAT GOVERNS THIS FILE
 *
 * The model writes the LESSON. The corpus writes the LANGUAGE. Everything below is arranged so the
 * two cannot be confused, and so a learner can always see which one they are looking at.
 *
 * WHY INTENT IS DETECTED
 *
 * A vocabulary question and a role-play request need different retrieval and different prompting. A
 * single prompt covering both does neither well — and, more importantly, a translation request has
 * to be REFUSED differently from a conversation request. Detecting intent is what lets the tutor say
 * the right kind of "no".
 *
 * RETRIEVAL IS AN API, NOT A PROMPT
 *
 * The dictionary is not pasted into a system prompt. `retrieve()` fetches only what this question
 * needs, which keeps the prompt small, the answers relevant, and the language facts coming from the
 * database rather than from the model's memory.
 */

import { createFileRoute } from "@tanstack/react-router";
import { languageDb, retrieve, sufficiency, trustLabel, type RetrievedEntry } from "@/lib/tutor/retrieval";
import { outputLabel, stripUnverified, validate } from "@/lib/tutor/validate";

const SUPABASE_URL = process.env["SUPABASE_URL"] ?? "";
const SERVICE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";

/** Strongest general model on the account. The task is reading comprehension plus conversation. */
const MODEL = "@cf/openai/gpt-oss-120b";

export type Intent = "translate" | "define" | "grammar" | "quiz" | "pronounce" | "converse";

/**
 * Work out what the learner is asking for.
 *
 * ORDER IS THE POINT, and it was wrong. "practise a market conversation" matched the quiz rule on
 * the word "practise" and came back as a fill-in-the-blank exercise — a real mis-classification,
 * because the learner asked to CONVERSE and got a worksheet.
 *
 * So the specific requests are tested before the general ones, and the broad word "practise" is no
 * longer treated as a request for a quiz on its own. "Quiz me" and "test me" still are.
 */
export function detectIntent(question: string): Intent {
  const q = question.toLowerCase();

  // Explicit conversation or role-play first — it is the most specific thing a learner can ask for.
  if (/\b(conversation|role.?play|chat|talk about|let.?s speak|practi[sc]e (a |the )?(conversation|dialogue)|imagine|pretend)\b/.test(q))
    return "converse";

  if (/\b(translate|how (do|can) i say|how to say|what.?s the word for|word for .* in igbo|igbo for)\b/.test(q)) return "translate";
  if (/\b(pronounc|how does .* sound|audio|listen to)\b/.test(q)) return "pronounce";
  if (/\b(quiz me|test me|give me (a )?(quiz|exercise|test)|drill me|challenge me)\b/.test(q)) return "quiz";
  if (/\b(what does|meaning of|what is the meaning|define|definition)\b/.test(q)) return "define";
  if (/\b(why|grammar|tone|conjugat|plural|tense|difference between)\b/.test(q)) return "grammar";

  // Anything else is conversation. Chatting is the safe default: it is the one intent that cannot
  // mislead by promising a specific format it does not deliver.
  return "converse";
}

/**
 * The system prompt.
 *
 * The retrieved entries are NOT in this string — they are supplied with each message. That is the
 * point of a retrieval layer: the model sees only what is relevant, and only what is evidenced.
 */
const SYSTEM = `You are the Ozituma Igbo tutor. You teach using ONLY the dictionary entries supplied with each message.

THE HARD RULES — these override everything else:

1. NEVER write an Igbo word that is not in the supplied entries. Not a common one, not an obvious one, not to finish a sentence. If you need a word that is not there, say the Ozituma dictionary does not contain it and stop.
2. NEVER invent a translation, a grammar rule, a plural, a conjugation, an etymology or a dialect note. If it is not in the entries, you do not know it.
3. If the entries do not answer the question, say so plainly and suggest what to look up instead. A clear "the dictionary does not cover this" is a GOOD answer, not a failure. Guessing is the failure.
4. This is Central Igbo (Igbo Izugbe). Never compare dialects or mention one unless an entry is explicitly tagged with it.
5. You MAY teach: explain the entries, ask follow-up questions, hold a conversation within the supplied vocabulary, set quizzes from the supplied words, role-play, and correct a learner by pointing at what the entries say.
6. When you assemble a sentence from supplied words, say that you assembled it. It is practice material, not attested language.
7. Write warm, plain English. Short paragraphs. No headings.

You are an intelligent teacher whose knowledge is the Ozituma corpus. You are not a source of Igbo.`;

export const Route = createFileRoute("/api/tutor")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => handle(request),
    },
  },
});

async function handle(request: Request): Promise<Response> {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return Response.json({ ok: false, error: "not_configured" }, { status: 503 });
  }

  let body: { question?: unknown; includeVariants?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const question = typeof body.question === "string" ? body.question.trim().slice(0, 600) : "";
  if (!question) return Response.json({ ok: false, error: "empty" }, { status: 400 });

  const intent = detectIntent(question);
  const db = languageDb(SUPABASE_URL, SERVICE_KEY);

  const entries = await retrieve(db, question, {
    includeVariants: body.includeVariants === true,
    limit: intent === "quiz" ? 20 : 12,
  });

  const enough = sufficiency(entries, question);

  /*
   * GUARDRAIL — no evidence, no model call.
   *
   * Not a prompt instruction that can be talked around: the call does not happen, so the model never
   * gets the chance to answer from memory.
   */
  if (enough === "none") {
    return Response.json({
      ok: true,
      intent,
      grounded: false,
      sufficiency: "none",
      answer:
        intent === "translate"
          ? "The Ozituma dictionary does not contain a verified entry for that, so I cannot give you a translation. I answer only from approved entries — guessing at Igbo would be worse than saying nothing. Try a different word, or search the dictionary at ozituma.com."
          : "I could not find anything in the Ozituma dictionary for that. I answer only from approved entries, so I would rather say nothing than invent a word. Try a shorter phrase, or look it up directly at ozituma.com.",
      sources: [],
      generatedNotice: "",
      trust: { level: "insufficient", label: trustLabel("insufficient") },
    });
  }

  /*
   * PARTIAL — something matched, but not the word asked about.
   *
   * The dangerous middle case: near-misses are present and the model could easily teach one of them
   * as though it were the answer. It is told explicitly to say the term itself was not found.
   */
  const partialNote =
    enough === "partial"
      ? "\n\nIMPORTANT: the exact word the learner asked about was NOT found in the corpus. Say that clearly FIRST. You may mention what WAS found, but never present it as the thing they asked for."
      : "";

  const evidence = entries
    .map((e, i) => {
      const lines = [
        `[${i + 1}] ${e.toneMarked || e.headword}${e.partOfSpeech ? ` (${e.partOfSpeech})` : ""} — ${e.meaning}`,
        `     trust: ${trustLabel(e.trust, e.dialect)}${e.source ? ` · source: ${e.source}` : ""}${e.hasPronunciation ? " · audio available" : ""}`,
      ];
      if (e.exampleIg) lines.push(`     example: ${e.exampleIg}${e.exampleEn ? ` — ${e.exampleEn}` : ""}`);
      return lines.join("\n");
    })
    .join("\n");

  const intentGuidance: Record<Intent, string> = {
    translate:
      "The learner wants a translation. If the corpus has the term, give it and explain. If it does not, say so — do not construct one.",
    define: "The learner wants a meaning. Explain what the entries say.",
    grammar:
      "The learner asked about grammar or usage. Explain ONLY what the entries demonstrate. If they do not demonstrate it, say the dictionary does not cover that.",
    quiz: "Create a short quiz using ONLY the supplied words. Label it as an exercise you generated. Give the answers at the end.",
    pronounce:
      "The learner wants pronunciation help. Say whether a recording exists and tell them to use the audio button. Do not describe tones you cannot evidence.",
    converse:
      "Hold a short conversation or role-play using ONLY the supplied vocabulary. If you need a word that is not there, ask the learner to pick another topic or say the expression is not yet verified.",
  };

  const ai = (globalThis as { __env__?: { AI?: unknown } }).__env__?.AI;
  if (!ai) return Response.json({ ok: false, error: "ai_unavailable" }, { status: 503 });

  try {
    const result = (await (ai as { run: (m: string, i: unknown) => Promise<unknown> }).run(MODEL, {
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: `Ozituma dictionary entries:\n\n${evidence}\n\n${intentGuidance[intent]}${partialNote}\n\nLearner: ${question}`,
        },
      ],
      /*
       * `reasoning_effort: "low"` is REQUIRED, not an optimisation.
       *
       * gpt-oss is a reasoning model, and at its default effort it will think for minutes on a
       * question as simple as "what does mmiri mean". The request then exceeds the Worker's limit and
       * the learner gets nothing — measured at over 180 seconds before this was set, against 1.4
       * seconds with it, for the same correct answer.
       *
       * The task does not need deep reasoning. It is reading comprehension over a handful of entries
       * that were already retrieved, so the model is choosing how to explain, not working anything
       * out. Low effort is the right setting for what this actually does.
       *
       * `reasoning` and `content` still share `max_tokens`; the budget leaves room for both.
       */
      max_tokens: 1200,
      reasoning_effort: "low",
      temperature: 0.2,
    })) as {
      response?: string;
      choices?: { message?: { content?: string | null; reasoning?: string | null } }[];
      result?: { response?: string };
    };

    const raw = result?.response ?? result?.choices?.[0]?.message?.content ?? result?.result?.response ?? "";

    if (!String(raw).trim()) {
      return Response.json({ ok: false, error: "empty_reply" }, { status: 502 });
    }

    /* LANGUAGE VALIDATION — checked against the evidence before a learner sees it. */
    const check = validate(String(raw), entries);
    const answer = check.clean ? String(raw) : stripUnverified(String(raw), check.unknown);

    /*
     * SOURCE TRACEABILITY. Every entry that informed the answer goes back with the identifiers needed
     * to audit it: row id, originating corpus, verification state and variety.
     */
    const sources = entries.map((e: RetrievedEntry) => ({
      id: e.id,
      headword: e.toneMarked || e.headword,
      meaning: e.meaning,
      partOfSpeech: e.partOfSpeech,
      audioUrl: e.audioUrl,
      source: e.source,
      // Central Igbo is the ABSENCE of a dialect tag, so it is stated positively for the reader.
      variety: e.dialect ?? "Central Igbo (Igbo Izugbe)",
      status: e.status,
      reviewed: e.reviewed,
      trust: e.trust,
      trustLabel: trustLabel(e.trust, e.dialect),
      match: e.match,
    }));

    /*
     * The overall label is the WEAKEST trust in the evidence. An answer resting on one unreviewed
     * entry is not a verified answer, and averaging would hide exactly that.
     */
    const order = ["verified", "variant", "needs_review"] as const;
    const weakest = order.find((t) => entries.some((e) => e.trust === t)) ?? "verified";

    return Response.json({
      ok: true,
      intent,
      grounded: true,
      sufficiency: enough,
      revised: !check.clean,
      removed: check.unknown,
      answer,
      // Kept separate from the source trust because they answer different questions: "is this
      // sentence attested?" and "is this entry approved?".
      generatedNotice: outputLabel(check),
      sources,
      trust: { level: weakest, label: trustLabel(weakest) },
    });
  } catch (error) {
    // Logged, not returned: a learner should not be shown an internal binding error.
    console.error("[tutor]", error);
    return Response.json({ ok: false, error: "model_failed" }, { status: 502 });
  }
}
