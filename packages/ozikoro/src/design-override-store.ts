/**
 * The design overrides, read and written.
 *
 * WHY THE READ AND THE WRITE ARE ONE MODULE
 *
 * The owner's reason for wanting an override layer rather than an edited file is that his changes can be
 * undone, compared and audited. **A write path that forgot its audit row would take that away silently**, so
 * every function here that changes a row also writes the `ozikoro_audit` row naming the actor, and there is
 * no way to reach the table except through them.
 *
 * THE ROW IS THE PRESENT; THE AUDIT IS THE HISTORY. `ozikoro_design_override` holds one row per edited thing
 * with the value in force now, who set it and when. Removing a row does not erase the fact that it existed —
 * `ozikoro_audit` keeps the before and after, which is what makes `/admin/audit/` able to answer "what did
 * the About heading say last week, and who changed it".
 */
import type { Db } from '@ozituma/db/client';
import {
  ALL_SCREENS,
  applyDesignOverrides,
  checkOverrideValue,
  type DesignOverride,
  type DesignOverrideKind,
  type DesignOverrideValue,
  type DesignTokenClass,
} from './design-override.ts';

export class DesignOverrideError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DesignOverrideError';
  }
}

interface Row {
  id: number | string;
  screen: string;
  kind: string;
  key: string;
  label: string | null;
  value: unknown;
  note: string | null;
  actor_id: number | string | null;
  actor_name: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function jsonObject(value: unknown): DesignOverrideValue {
  if (value === null || value === undefined) return {};
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed !== null && typeof parsed === 'object' ? (parsed as DesignOverrideValue) : {};
    } catch {
      return {};
    }
  }
  return typeof value === 'object' ? (value as DesignOverrideValue) : {};
}

function toOverride(row: Row): DesignOverride {
  return {
    id: Number(row.id),
    screen: row.screen,
    kind: row.kind as DesignOverrideKind,
    key: row.key,
    label: row.label,
    value: jsonObject(row.value),
    note: row.note,
    actorId: row.actor_id === null ? null : Number(row.actor_id),
    actorName: row.actor_name,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

/**
 * Every override in force, optionally for one screen.
 *
 * ONE QUERY FOR EVERYTHING, FILTERED IN MEMORY. The table is one row per edited thing — a screen with fifty
 * edits is a busy one — so asking for all of it costs less than the round trip the filter would save, and the
 * serve path can then answer "what applies to this page" without a second query for the shared palette. The
 * actor's name is joined in because the editor list reads as a record of a person's work.
 */
export async function listDesignOverrides(db: Db, screen?: string): Promise<DesignOverride[]> {
  const rows = await db.rows<Row>(
    `select o.id, o.screen, o.kind, o.key, o.label, o.value, o.note, o.actor_id,
            coalesce(m.display_name, a.email) as actor_name,
            o.created_at, o.updated_at
       from ozikoro_design_override o
       left join account a on a.id = o.actor_id
       left join ozikoro_member m on m.account_id = o.actor_id
      where ($1::text is null or o.screen = $1 or o.screen = '*')
      order by o.screen, o.kind, o.id`,
    [screen ?? null]
  );
  return rows.map(toOverride);
}

/** Whether any override exists at all — the gate in front of a query the editor page does not always need. */
export async function countDesignOverrides(db: Db): Promise<number> {
  const row = await db.one<{ n: number }>(`select count(*)::int as n from ozikoro_design_override`);
  return row?.n ?? 0;
}

async function audit(
  db: Db,
  event: { entityId: number; action: string; before?: unknown; after?: unknown; actorId: number | null; note?: string | null }
): Promise<void> {
  /*
   * RECORDING HISTORY MUST NEVER BE THE REASON A CHANGE FAILS. This is a record, not a gate — the same rule
   * `grantRole` follows — so a failure here is logged and the change stands.
   */
  try {
    await db.query(
      `insert into ozikoro_audit (entity_type, entity_id, action, before, after, actor_id, note)
       values ('design_override', $1, $2, $3::jsonb, $4::jsonb, $5, $6)`,
      [
        event.entityId,
        event.action,
        event.before === undefined ? null : JSON.stringify(event.before),
        event.after === undefined ? null : JSON.stringify(event.after),
        event.actorId,
        event.note ?? null,
      ]
    );
  } catch (error) {
    console.error('[ozikoro/design-overrides] could not record audit event:', String(error).slice(0, 160));
  }
}

export interface SetDesignOverrideInput {
  screen: string;
  kind: DesignOverrideKind;
  key: string;
  label?: string | null;
  value: DesignOverrideValue;
  note?: string | null;
  actorId: number | null;
  /**
   * What kind of value the design declares for this token, when the caller knows it.
   *
   * Passed in rather than looked up here because the stylesheet lives in the application, not in this
   * package — and the caller that SAVES a value is the one that can read it.
   */
  expectedTokenClass?: DesignTokenClass;
}

/**
 * Set one edited thing, or update the one that is already there.
 *
 * ONE ROW PER (screen, kind, key), which is why this is an upsert: editing the same heading twice must leave
 * one value in force, not two values that then have to be ordered against each other at serve time. The
 * `before` half of the audit row is read first so the change can be compared afterwards — an audit that
 * recorded only the new value could not answer "what did it say".
 */
export async function setDesignOverride(db: Db, input: SetDesignOverrideInput): Promise<DesignOverride> {
  const problem = checkOverrideValue(input.kind, input.key, input.value, input.expectedTokenClass);
  if (problem) throw new DesignOverrideError(problem);
  if (input.kind === 'token' && input.screen !== ALL_SCREENS) {
    /*
     * A TOKEN IS NOT ONE SCREEN'S. `tokens.css` is imported by `main.css`, which every screen loads, so a
     * token override filed under `about` would change the accent on all fifty-two screens while claiming to
     * belong to one — the kind of quiet mismatch this whole layer exists to avoid.
     */
    throw new DesignOverrideError('A colour or type token applies to every screen, so it is filed under “*”.');
  }
  /*
   * AN ELEMENT EDIT MAY BE SITE-WIDE, AND THE PREVIOUS RULE SAID IT COULD NOT.
   *
   * The rule was "a text, image, link or visibility edit belongs to one screen", and it was right about the
   * ROW — one screen's own heading is one screen's heading. It was wrong about the PAGE: the header, the menu
   * and the footer are the same markup in all fifty-two screen files, so the footer's "Academy — Learn Igbo",
   * or the label on a menu item, is one decision the owner was made to repeat fifty-two times. **That is the
   * opposite of what he asked for**, and `selectorReach` measures exactly how many screens a given key
   * reaches, so the editor can say "on 52 screens" before he decides.
   *
   * So `*` is allowed for every kind, and the meaning is narrow and stated rather than assumed: **apply this
   * wherever this key names exactly one element.** The serve step already enforces that half —
   * `applyDesignOverrides` edits nothing when a key matches zero or two elements — so a site-wide row can only
   * ever land where it names one thing, and never as a shape that sweeps a page.
   */


  const before = await db.one<Row>(
    `select id, screen, kind, key, label, value, note, actor_id, null::text as actor_name, created_at, updated_at
       from ozikoro_design_override where screen = $1 and kind = $2 and key = $3`,
    [input.screen, input.kind, input.key]
  );

  /*
   * `returning` names the columns rather than selecting through a subquery for the actor's name: the name is
   * for the editor's list, which re-reads through `listDesignOverrides` and joins it there, and a correlated
   * subquery inside `returning` is the kind of SQL that works until the day it is run on a different driver.
   */
  const row = await db.one<Row>(
    `insert into ozikoro_design_override (screen, kind, key, label, value, note, actor_id)
     values ($1, $2, $3, $4, $5::jsonb, $6, $7)
     on conflict (screen, kind, key) do update
        set value = excluded.value,
            label = coalesce(excluded.label, ozikoro_design_override.label),
            note = excluded.note,
            actor_id = excluded.actor_id,
            updated_at = now()
     returning id, screen, kind, key, label, value, note, actor_id,
               null::text as actor_name, created_at, updated_at`,
    [
      input.screen,
      input.kind,
      input.key,
      input.label ?? null,
      JSON.stringify(input.value),
      input.note ?? null,
      input.actorId,
    ]
  );
  if (!row) throw new DesignOverrideError('The override could not be saved.');

  await audit(db, {
    entityId: Number(row.id),
    action: before ? 'update' : 'set',
    before: before ? { screen: before.screen, kind: before.kind, key: before.key, value: jsonObject(before.value) } : undefined,
    after: { screen: row.screen, kind: row.kind, key: row.key, value: jsonObject(row.value), label: row.label },
    actorId: input.actorId,
    note: input.note ?? null,
  });
  return toOverride(row);
}

/**
 * Remove one override, returning the page to the design's own value.
 *
 * THE ROW GOES AND THE HISTORY STAYS. A reset that deleted its own audit trail would leave the owner unable
 * to see that anything had ever been changed, which is the trap the brief names — an editor whose changes
 * nobody could see, in the other direction.
 */
export async function removeDesignOverride(
  db: Db,
  input: { id: number; actorId: number | null; note?: string | null }
): Promise<DesignOverride | null> {
  const before = await db.one<Row>(
    `select id, screen, kind, key, label, value, note, actor_id, null::text as actor_name, created_at, updated_at
       from ozikoro_design_override where id = $1`,
    [input.id]
  );
  if (!before) return null;
  await db.query(`delete from ozikoro_design_override where id = $1`, [input.id]);
  await audit(db, {
    entityId: Number(before.id),
    action: 'reset',
    before: { screen: before.screen, kind: before.kind, key: before.key, value: jsonObject(before.value) },
    after: { removed: true },
    actorId: input.actorId,
    note: input.note ?? 'Returned to the design’s own value.',
  });
  return toOverride(before);
}

/** Remove one by its key, for a form that knows what it edited but not the row's id. */
export async function removeDesignOverrideByKey(
  db: Db,
  input: { screen: string; kind: DesignOverrideKind; key: string; actorId: number | null; note?: string | null }
): Promise<DesignOverride | null> {
  const row = await db.one<{ id: number }>(
    `select id from ozikoro_design_override where screen = $1 and kind = $2 and key = $3`,
    [input.screen, input.kind, input.key]
  );
  if (!row) return null;
  return removeDesignOverride(db, { id: Number(row.id), actorId: input.actorId, note: input.note });
}

/**
 * Every override, back to the design.
 *
 * `screen` limits it to one page; omitting it clears the lot, tokens included. Both are offered because both
 * are real intentions: "put this page back" and "put everything back", and the owner has been bitten today by
 * changes nobody could see, so the second one must exist and must be easy.
 *
 * Each row is removed and audited individually rather than with one `delete … returning`, because the audit
 * is per-thing and a single summary row would lose which values were discarded.
 */
export async function resetDesignOverrides(
  db: Db,
  input: { screen?: string | null; actorId: number | null; note?: string | null }
): Promise<number> {
  const rows = await db.rows<{ id: number }>(
    `select id from ozikoro_design_override
      where ($1::text is null or screen = $1)
      order by id`,
    [input.screen ?? null]
  );
  for (const row of rows) {
    await removeDesignOverride(db, {
      id: Number(row.id),
      actorId: input.actorId,
      note: input.note ?? (input.screen ? `Returned ${input.screen} to the design.` : 'Returned every screen to the design.'),
    });
  }
  return rows.length;
}

/**
 * Apply the overrides in force to one served page, loaded here so BOTH design routes share one rule.
 *
 * WHY THIS LIVES HERE AND NOT IN EITHER ROUTE
 *
 * A text, image, link or hide edit made through `/admin/design/` worked on the design screens and did
 * **nothing** on an article, because `design-screen/[screen]/route.ts` applied the overrides and
 * `[slug]/route.ts` did not — while `/design-theme.css` was linked by both, so a *colour* edit reached the
 * article and an *element* edit did not. The same omission had already left four dead controls on 1,051
 * articles once (`reader.js`), and the fix then was to move the shared rule into `design-paths.ts` and call
 * it from both routes. **This is that fix again, for the same fault, so the ordering rule lives in one
 * function rather than two copies that drift.**
 *
 * THE ORDERING IS THE WHOLE CORRECTNESS. Stored edits are applied first and the pending preview last, so a
 * value being previewed beats the one it is replacing, and both run AFTER the fills — an override applied
 * before the fills would be overwritten by the pass that rewrites a heading's words.
 *
 * A FAILURE HERE DEGRADES TO THE DESIGN. A page that cannot read its overrides is the deliverable's page; a
 * thrown error would be a 404 for a whole record, which is worse than a heading that did not change.
 *
 * `asDesign` is the owner's own off switch (`?oznooverride=1`), which his save path needs because a saved
 * edit must be PROVED by rendering the page without it and comparing. **The caller decides that**, because
 * the test for it — is this viewer allowed to see the site without its edits — is an account question, and
 * this module has no accounts.
 */
export async function withStoredDesignOverrides(
  db: Db,
  html: string,
  screen: string,
  options: { preview?: DesignOverride[]; asDesign?: boolean; label?: string } = {}
): Promise<string> {
  if (options.asDesign) return html;
  try {
    const stored = await listDesignOverrides(db, screen);
    let out = stored.length > 0 ? applyDesignOverrides(html, stored) : html;
    const preview = options.preview ?? [];
    if (preview.length > 0) out = applyDesignOverrides(out, preview, { inlineTokens: true });
    return out;
  } catch (error) {
    console.error(`${options.label ?? 'design-override'}: could not apply the design overrides to ${screen}`, error);
    return html;
  }
}
