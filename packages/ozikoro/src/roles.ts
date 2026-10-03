/**
 * Who may grant which archive role.
 *
 * WHY THIS IS A MODULE OF ITS OWN
 *
 * The rank rule is one line of SQL, `ozikoro_role_may_grant`, added in migration 0044 with a long comment
 * explaining why an administrator must not be able to mint another administrator. That rule is only worth
 * anything if the *acts* obey it, and the acts live in several places: this administration screen, any
 * future CLI, and the tests. **A rule re-expressed in TypeScript at each call site is a rule that will be
 * expressed slightly differently at one of them**, which is the same mistake migration 0043 records about
 * capability resolution — the fix there was to stop holding the rule in application code and ask Postgres.
 * The same fix is applied here.
 *
 * So this module holds no ranks of its own. It asks the database for `ozikoro_role_rank` and then asks the
 * database whether the grant is permitted, and it presents the answer with the two numbers, because a
 * refusal that says "an administrator ranks at 80 and an administrator also ranks at 80" is one a person
 * can act on and "you may not do that" is not.
 */
import type { Db } from '@ozituma/db/client';
import { MemberError, isOzikoroRole, roleLabel, type OzikoroRole } from './members.ts';

/**
 * What each archive role is worth, as the database counts it.
 *
 * Read rather than declared. If migration 0044's ladder is ever changed, this map changes with it and the
 * refusal messages stay true; a literal copy here would keep saying 80 after the database had stopped.
 */
export async function roleRanks(db: Db): Promise<Map<string, number>> {
  const rows = await db.rows<{ role: string; rank: number }>(
    `select r::text as role, ozikoro_role_rank(r) as rank
       from unnest(array[
         'owner','admin','moderator','editor','expert_reviewer','researcher',
         'independent_researcher','community_knowledge_holder','teacher','student','reader'
       ]) r`
  );
  return new Map(rows.map((row) => [row.role, Number(row.rank)]));
}

/**
 * The rank an account acts with: the highest rank among the archive roles it holds.
 *
 * Highest and not the first or the sum. A person who is both an editor and a moderator may do what a
 * moderator may do — that is what holding two roles means — and `capabilitiesFor` already unions the two
 * capability sets for exactly that reason. Reading only one role here would make the screen refuse a grant
 * the same person is actually entitled to make.
 *
 * A platform administrator or the owner with no archive role row ranks as an administrator, because that is
 * what `ozikoro_capabilities` already decides about them: they hold admin's capabilities without a granted
 * row. Without this line the one account that exists — an owner with an owner archive row, so a rank — would
 * be fine, but an owner whose archive row had been lost would hold `manage_roles` and rank at nothing, and
 * the screen would refuse every grant the capability had just allowed.
 */
export async function actorRank(db: Db, accountId: number, ranks: Map<string, number>): Promise<number> {
  const rows = await db.rows<{ role: string }>(
    `select r.role from ozikoro_member_role r where r.account_id = $1
      union
     select a.role::text as role from account a
      where a.id = $1 and a.role::text in ('admin', 'owner')`,
    [accountId]
  );
  return rows.reduce((highest, row) => Math.max(highest, ranks.get(row.role) ?? 0), 0);
}

/** The role with a given rank, for naming the actor's own standing in a refusal. */
function roleAtRank(ranks: Map<string, number>, rank: number): string | null {
  for (const [role, value] of ranks) if (value === rank) return label(role);
  return null;
}

/**
 * A role's name as prose.
 *
 * `roleLabel` only accepts the roles `OZIKORO_ROLES` declares and throws a type error for anything else, so
 * the fallback keeps a refusal message renderable for a role this build does not know. **A refusal that
 * crashes while explaining itself is worse than no explanation**, and the database is free to gain a role
 * before this file learns about it — that is what `isOzikoroRole` is for.
 */
function label(role: string): string {
  if (isOzikoroRole(role)) return roleLabel(role);
  const words = role.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Whether `actorId` may grant `target` an archive role — asked of the database, never reimplemented.
 *
 * Returns the numbers as well as the answer so the caller can say *why*. The two queries are deliberately
 * separate: `ozikoro_role_may_grant` is the authority and it is called with the actor's own top rank, so a
 * change to the ladder in SQL is obeyed here without this file being touched.
 */
export async function mayGrantRole(
  db: Db,
  actorId: number,
  target: OzikoroRole
): Promise<{ allowed: boolean; actorRank: number; targetRank: number; reason?: string }> {
  if (!isOzikoroRole(target)) {
    return { allowed: false, actorRank: 0, targetRank: 0, reason: 'That is not a role on this site.' };
  }

  const ranks = await roleRanks(db);
  const mine = await actorRank(db, actorId, ranks);
  const theirs = ranks.get(target) ?? 0;

  /*
   * THE CHECK IS THE DATABASE'S. The `ranks` map is used to explain the answer, not to reach it: the
   * boolean comes from the function migration 0044 defines, so there is exactly one implementation of
   * "may grant" in the system and this is a caller of it.
   */
  const allowed = await db
    .one<{ ok: boolean }>(`select ozikoro_role_may_grant($1, $2) as ok`, [rankRoleName(ranks, mine), target])
    .then((row) => Boolean(row?.ok));

  if (allowed) return { allowed, actorRank: mine, targetRank: theirs };

  const mineLabel = roleAtRank(ranks, mine) ?? 'no archive role';
  return {
    allowed,
    actorRank: mine,
    targetRank: theirs,
    reason:
      `You hold ${mineLabel} (rank ${mine}) and “${label(target)}” ranks ${theirs}. ` +
      `The archive allows a role to be granted only strictly below your own, so a ${mineLabel.toLowerCase()} ` +
      `cannot appoint another ${label(target).toLowerCase()}.`,
  };
}

/**
 * The role name for a rank, so `ozikoro_role_may_grant` can be called with a name rather than a number.
 *
 * The function takes role NAMES, so the actor's numeric top rank has to be turned back into the role it came
 * from. Falls back to `reader`, the lowest role every account holds, which ranks below everything and
 * therefore refuses rather than permits if the ladder ever gains a rank this file cannot name.
 */
function rankRoleName(ranks: Map<string, number>, rank: number): string {
  for (const [role, value] of ranks) if (value === rank) return role;
  return 'reader';
}

/**
 * Whether `actorId` may revoke `target` from an account — the same rule, and the same refusal.
 *
 * Revocation is not exempt. An administrator who cannot grant the administrator role but can revoke it holds
 * the same power from the other end: they could remove every other administrator and be the only one left.
 * So the rank test is symmetric, which is also what migration 0044 says.
 */
export async function mayRevokeRole(
  db: Db,
  actorId: number,
  target: OzikoroRole
): Promise<{ allowed: boolean; actorRank: number; targetRank: number; reason?: string }> {
  return mayGrantRole(db, actorId, target);
}

/**
 * The roles an actor may offer on a screen, so the form does not list what the endpoint would refuse.
 *
 * Asking this is presentation; the endpoint asks `mayGrantRole` again for itself. **A hidden button is not
 * authorisation**, and this does not pretend to be: it exists so an administrator is not invited to try
 * something that will be refused.
 */
export async function grantableRoles(db: Db, actorId: number): Promise<OzikoroRole[]> {
  const ranks = await roleRanks(db);
  const mine = await actorRank(db, actorId, ranks);
  return [...ranks.keys()]
    .filter((role) => (ranks.get(role) ?? 0) < mine)
    .map((role) => role as OzikoroRole)
    .sort((a, b) => (ranks.get(b) ?? 0) - (ranks.get(a) ?? 0));
}

/** A refusal from `mayGrantRole`, as the error the rest of the archive already throws. */
export function rankRefusal(reason: string | undefined, code = 'rank'): MemberError {
  return new MemberError(code, reason ?? 'That grant is above your own standing.');
}

/**
 * Whether `actorId` may APPROVE a pronunciation that `recorderId` recorded — asked of the database, never
 * reimplemented.
 *
 * WHY THIS IS HERE AND NOT IN THE PRONUNCIATION MODULE
 *
 * The owner's pipeline ends in an approval that unblocks a spend: *"approved before it produces any record,
 * as to not waste credits."* Approving somebody else's recording is a review of their work, and the archive
 * already has exactly one ladder for "who stands above whom" — `ozikoro_role_may_grant`, added by migration
 * 0044 and CALLED rather than copied by every act that needs it (see the note at the head of this file). **A
 * second copy of the rank comparison inside the pronunciation code would be the drift migration 0043 exists
 * to prevent**, so the comparison is made by asking the same SQL function the user table asks.
 *
 * THE RULE, AND THE ONE CASE IT DELIBERATELY DOES NOT FORBID
 *
 *   - an actor who strictly OUTRANKS the recorder may approve. This is why capability alone is not enough:
 *     "may review audio" and "stands above the person who recorded it" are different questions.
 *   - an actor who does NOT outrank them may still approve **their own recording**, and the caller is told
 *     which it was. `ownRecording` is returned rather than a bare `true`, so "the owner checked his own
 *     work" is a fact the audit trail can carry. **An approval whose provenance is indistinguishable from an
 *     independent review is exactly what this flag exists to prevent.**
 *
 * **It does not refuse the owner.** The archive holds ONE account, and migration 0046 states the rule this
 * follows — "admin must never be locked out of a decision". A rank rule that stopped the only account from
 * approving the only recording would not be a safeguard; it would be the feature not working. So the
 * self-approval case is permitted and LABELLED rather than forbidden.
 */
export async function mayApprovePronunciation(
  db: Db,
  actorId: number,
  recorderId: number | null
): Promise<{ allowed: boolean; ownRecording: boolean; actorRank: number; recorderRank: number; reason?: string }> {
  const ranks = await roleRanks(db);
  const mine = await actorRank(db, actorId, ranks);

  if (recorderId === null) {
    // Nobody recorded it: an imported or composed reference, with no standing for anyone to be below.
    return { allowed: true, ownRecording: false, actorRank: mine, recorderRank: 0 };
  }

  const theirs = await actorRank(db, recorderId, ranks);
  if (theirs === 0) {
    // The recorder holds no archive role at all, so no rank can be below them.
    return { allowed: true, ownRecording: actorId === recorderId, actorRank: mine, recorderRank: 0 };
  }

  /*
   * THE BOOLEAN IS THE DATABASE'S. `rankRoleName` gives a role NAME for each rank so the same function the
   * grant screen calls can be called here; the numbers are used to EXPLAIN the answer, not to reach it.
   */
  const allowed = await db
    .one<{ ok: boolean }>(`select ozikoro_role_may_grant($1, $2) as ok`, [
      rankRoleName(ranks, mine),
      rankRoleName(ranks, theirs),
    ])
    .then((row) => Boolean(row?.ok));

  if (allowed) return { allowed: true, ownRecording: actorId === recorderId, actorRank: mine, recorderRank: theirs };
  if (actorId === recorderId) return { allowed: true, ownRecording: true, actorRank: mine, recorderRank: theirs };

  const mineLabel = roleAtRank(ranks, mine) ?? 'no archive role';
  return {
    allowed: false,
    ownRecording: false,
    actorRank: mine,
    recorderRank: theirs,
    reason:
      `You hold ${mineLabel} (rank ${mine}) and this recording was made by somebody at rank ${theirs}. ` +
      'The archive allows one person’s work to be approved only by somebody who outranks them, or by ' +
      'themselves when they are the account that can decide.',
  };
}
