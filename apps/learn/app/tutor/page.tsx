import type { Metadata } from 'next';
import { TutorRunner } from '@/components/learn/tutor-runner';
import { providerConfigured } from '@/lib/ai-provider';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Igbo tutor · Ozituma Learn',
  description:
    'Ask about Igbo and get answers grounded in the reviewed Ozituma dictionary — labelled, and never invented.',
};

/**
 * The text tutor.
 *
 * §4 scopes v1.0 to a text-only tutor with four modes: explain, correct, translate and "Explain
 * this Igbo". §8.1 sets the guardrails: retrieval before generation, validation after, a safe reply
 * on failure, a visible label, rate limits and a spend cap.
 *
 * The page reads whether a provider is configured on the SERVER and passes it down, so a learner is
 * told before they type rather than after. A chat box that accepts a question and only then explains
 * that it cannot answer is a worse experience than one that says so up front.
 */
export default function TutorPage() {
  return (
    <div className="wrap">
      <section className="learn-hero">
        <p className="learn-eyebrow">Tutor</p>
        <h1 className="learn-hero-title">Ask about Igbo</h1>
        <p className="hero-lede">
          The tutor answers from the reviewed Ozituma dictionary — the same entries you can read for
          yourself. It will not invent vocabulary or grammar, and every answer says where it came
          from.
        </p>
      </section>

      <section className="learn-section">
        <TutorRunner configured={providerConfigured()} />
      </section>

      <section className="learn-section">
        <h2 className="learn-section-title">What it will and will not do</h2>
        <div className="learn-about-grid">
          <div>
            <h3 className="learn-about-heading">It is grounded, not free-ranging</h3>
            <p>
              Before any answer is written, the tutor retrieves the approved Ozituma entries relevant
              to your question and is allowed to use only those. If nothing relevant exists, it says
              so instead of answering from general knowledge — a confident wrong answer about a
              language is worse than no answer.
            </p>
          </div>
          <div>
            <h3 className="learn-about-heading">Every answer is labelled</h3>
            <p>
              A reply built on reviewed content is marked as such. Anything that fails a check is
              replaced by a plain statement that it could not be answered from the approved material.
              You will never be shown AI text that looks like a dictionary entry.
            </p>
          </div>
          <div>
            <h3 className="learn-about-heading">It shows its sources</h3>
            <p>
              Each answer carries the entries it used, and you can open them. The person best placed
              to check whether an answer is right about Igbo is a speaker — so the material is put in
              front of you rather than summarised away.
            </p>
          </div>
          <div>
            <h3 className="learn-about-heading">It has limits, on purpose</h3>
            <p>
              A fixed number of questions per day. That is not a paywall — everything here is free
              during beta — it is what keeps an open-ended model from producing an open-ended bill,
              which §14 requires to be known before anything is priced.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
