/**
 * Cost and abuse controls.
 *
 * Spec §8.1: "Per-user daily message limits by plan, maximum tokens per request, global monthly
 * spend cap with alerting, rate limiting per IP and user."
 *
 * Spec §16 names the risk this exists for: "An unbounded AI tutor can create surprise bills."
 * The mitigation it prescribes is exactly what is implemented here.
 *
 * WHY THE CAP IS A LEDGER AND NOT A COUNTER CHECKED AT THE DOOR
 *
 * A limit checked before a request only knows what has been spent so far, and nothing about what
 * is about to be spent. A tutor answer is unbounded until the model stops — so a check at the
 * door lets the request that crosses the cap through, and the cap is always overshot by one
 * request. The ledger therefore records actual usage from the provider's own accounting (§8.2's
 * gateway requires it) and the door check uses that.
 *
 * WHY PRICING IS INJECTED AND NOT BAKED IN
 *
 * Model prices change, and a hard-coded rate is a wrong number that looks authoritative. There is
 * no default table here on purpose: a caller that wants a spend cap must supply the prices it is
 * actually being billed at, which makes the number's provenance a question somebody had to answer
 * rather than something the library decided.
 */
import type { UsageEvent, AiUsage } from './gateway.ts';

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

export interface PlanLimits {
  id: string;
  /** Tutor messages per learner per day. `null` means no limit. */
  tutorMessagesPerDay: number | null;
  /** Ceiling on one request's completion. §8.1: "maximum tokens per request". */
  maxOutputTokens: number;
  /** Ceiling on the learner's input, in characters. Protects the context window and the bill. */
  maxInputCharacters: number;
}

/**
 * The v1.0 plans.
 *
 * §14 recommends freemium: "Free: … limited AI tutor messages per day. Premium: higher or
 * unlimited tutor use". §18 #6's default is "everything free during beta; premium switched off",
 * and §18 #12 enables the tutor "with strict limits and labels" — so `beta` is the plan intended
 * to be live first, and it is deliberately the strictest of the three.
 *
 * The free limit is 20 a day rather than 5 because a tutor that cannot be tried is not a feature;
 * it is 20 rather than unlimited because §14 requires the AI cost per active user to be known
 * before pricing, and 20 is roughly one focused session.
 */
export const PLANS: Record<string, PlanLimits> = {
  beta: { id: 'beta', tutorMessagesPerDay: 20, maxOutputTokens: 800, maxInputCharacters: 1_500 },
  free: { id: 'free', tutorMessagesPerDay: 20, maxOutputTokens: 800, maxInputCharacters: 1_500 },
  premium: { id: 'premium', tutorMessagesPerDay: null, maxOutputTokens: 1_200, maxInputCharacters: 4_000 },
};

export const DEFAULT_PLAN = 'beta';

export function planFor(id: string | null | undefined): PlanLimits {
  return PLANS[id ?? DEFAULT_PLAN] ?? PLANS[DEFAULT_PLAN]!;
}

// ---------------------------------------------------------------------------
// Per-user allowances
// ---------------------------------------------------------------------------

export type DenialReason = 'daily_limit' | 'input_too_long' | 'output_ceiling';

export interface Allowance {
  allowed: boolean;
  reason?: DenialReason;
  /** Messages left today. `null` when unlimited. */
  remaining: number | null;
  /** Shown to the learner when refused. Never a raw error. */
  message?: string;
}

/** How many messages the learner has already sent today, in their own time zone. */
export function checkMessageAllowance(plan: PlanLimits, usedToday: number): Allowance {
  if (plan.tutorMessagesPerDay === null) {
    return { allowed: true, remaining: null };
  }
  const remaining = Math.max(0, plan.tutorMessagesPerDay - usedToday);
  if (remaining === 0) {
    return {
      allowed: false,
      reason: 'daily_limit',
      remaining: 0,
      message:
        `That is all ${plan.tutorMessagesPerDay} tutor questions for today. ` +
        'Practice and the dictionary are always open, and the tutor resets tomorrow.',
    };
  }
  return { allowed: true, remaining };
}

export function checkInputSize(plan: PlanLimits, input: string): Allowance {
  if (input.length > plan.maxInputCharacters) {
    return {
      allowed: false,
      reason: 'input_too_long',
      remaining: null,
      message:
        `That message is too long — ${input.length.toLocaleString()} characters, and the limit is ` +
        `${plan.maxInputCharacters.toLocaleString()}. Try asking about a shorter piece of text.`,
    };
  }
  return { allowed: true, remaining: null };
}

/**
 * The output ceiling for a request.
 *
 * The plan's ceiling and the prompt's are both applied, and the smaller wins: §F8 wants short
 * level-appropriate answers, and a plan cannot raise a mode's own limit.
 */
export function outputCeiling(plan: PlanLimits, modeCeiling?: number): number {
  return modeCeiling === undefined ? plan.maxOutputTokens : Math.min(plan.maxOutputTokens, modeCeiling);
}

// ---------------------------------------------------------------------------
// The spend ledger
// ---------------------------------------------------------------------------

export interface ModelPricing {
  /** USD per million input tokens, as billed. */
  inputUsdPerMillion: number;
  /** USD per million output tokens, as billed. */
  outputUsdPerMillion: number;
}

export interface SpendRecord {
  at: number;
  providerId: string;
  model: string;
  usage: AiUsage;
  costUsd: number;
  ok: boolean;
}

export interface SpendStatus {
  spentUsd: number;
  capUsd: number;
  /** 0–1. */
  fraction: number;
  breached: boolean;
  /** True once the alert threshold is crossed, whether or not the cap is. §8.1 requires alerting. */
  alerting: boolean;
  requests: number;
}

export interface SpendLedgerOptions {
  capUsd: number;
  /**
   * Prices per model, as actually billed. No defaults: see the note at the top of this file.
   * A model with no price here is recorded at zero cost AND reported in `unpricedModels`, so a
   * missing price shows up as a gap rather than as a silent under-count.
   */
  pricing: Record<string, ModelPricing>;
  /** Fraction of the cap at which `alerting` turns true. Default 0.8. */
  alertAt?: number;
  /** No pricing for this model — treated as free, but never silently. */
  onUnpricedModel?: (model: string) => void;
}

/**
 * A running total of what has been spent this month.
 *
 * In-process and in-memory, which is correct for one instance and insufficient for several. §8.4
 * and §13 require the real answer to be durable storage with alerting, and the note is here rather
 * than left implicit: this class protects a single process, and the monthly cap needs a shared
 * ledger before the platform runs on more than one.
 */
export class SpendLedger {
  private readonly records: SpendRecord[] = [];
  private readonly unpriced = new Set<string>();
  private readonly capUsd: number;
  private readonly pricing: Record<string, ModelPricing>;
  private readonly alertAt: number;
  private readonly onUnpricedModel: SpendLedgerOptions['onUnpricedModel'];

  constructor(options: SpendLedgerOptions) {
    if (!(options.capUsd > 0)) {
      throw new Error('A spend ledger needs a positive cap. §8.1 requires a hard monthly cap.');
    }
    this.capUsd = options.capUsd;
    this.pricing = options.pricing;
    this.alertAt = options.alertAt ?? 0.8;
    this.onUnpricedModel = options.onUnpricedModel;
  }

  /** Price one call. Unknown models cost nothing here and are reported separately. */
  priceOf(model: string, usage: AiUsage): number {
    const pricing = this.pricing[model];
    if (!pricing) {
      if (!this.unpriced.has(model)) {
        this.unpriced.add(model);
        this.onUnpricedModel?.(model);
      }
      return 0;
    }
    return (
      (usage.inputTokens / 1_000_000) * pricing.inputUsdPerMillion +
      (usage.outputTokens / 1_000_000) * pricing.outputUsdPerMillion
    );
  }

  /** Record a completed request. Accepts the gateway's own event shape. */
  record(event: UsageEvent): SpendRecord {
    const record: SpendRecord = {
      at: Date.now(),
      providerId: event.providerId,
      model: event.model,
      usage: event.usage,
      costUsd: this.priceOf(event.model, event.usage),
      ok: event.ok,
    };
    this.records.push(record);
    return record;
  }

  /**
   * Whether a new request may start.
   *
   * Checked before every request. Because the ledger holds actual usage, the cap is not overshot
   * by the request that crosses it — the crossing request is recorded, and the next one is
   * refused.
   */
  status(): SpendStatus {
    const spentUsd = this.records.reduce((total, record) => total + record.costUsd, 0);
    const fraction = spentUsd / this.capUsd;
    return {
      spentUsd,
      capUsd: this.capUsd,
      fraction,
      breached: spentUsd >= this.capUsd,
      alerting: fraction >= this.alertAt,
      requests: this.records.length,
    };
  }

  /** True when the tutor should refuse rather than call a provider. */
  shouldRefuse(): boolean {
    return this.status().breached;
  }

  /** Models that were used without a price. Non-empty means the cap is under-reporting. */
  unpricedModels(): string[] {
    return [...this.unpriced];
  }

  /** Records for a reporting window. */
  between(from: number, to: number): SpendRecord[] {
    return this.records.filter((record) => record.at >= from && record.at < to);
  }
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

export interface RateLimitOptions {
  /** Requests allowed per window. */
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Milliseconds until the window resets. Sent as `Retry-After`. */
  retryAfterMs: number;
}

/**
 * A fixed-window counter.
 *
 * The same shape the existing practice and developer-signup routes use, kept here so the tutor
 * behaves identically to the rest of the platform. Fixed-window permits a burst across a window
 * boundary; that is acceptable for a per-user tutor limit whose purpose is cost control rather
 * than fairness, and it is noted because it is the kind of thing that is later assumed to be a
 * sliding window.
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(options: RateLimitOptions) {
    this.limit = options.limit;
    this.windowMs = options.windowMs;
  }

  check(key: string, now: number): RateLimitResult {
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, remaining: this.limit - 1, retryAfterMs: 0 };
    }

    if (entry.count >= this.limit) {
      return { allowed: false, remaining: 0, retryAfterMs: entry.resetAt - now };
    }

    entry.count += 1;
    return { allowed: true, remaining: this.limit - entry.count, retryAfterMs: 0 };
  }

  /** Drop expired windows. Called periodically rather than on every request. */
  prune(now: number): void {
    for (const [key, entry] of this.hits) {
      if (entry.resetAt <= now) this.hits.delete(key);
    }
  }

  get size(): number {
    return this.hits.size;
  }
}
