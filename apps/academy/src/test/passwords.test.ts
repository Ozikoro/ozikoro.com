import { describe, expect, it } from "vitest";
import {
  AccountError,
  changeOwnPassword,
  hashPassword as academyHash,
  verifyPassword as academyVerify,
  type PasswordStore,
} from "@/backend/passwords";

/**
 * THE ACADEMY'S CHANGE-PASSWORD, AND THE REFUSAL IT TURNS ON.
 *
 * WHY THIS EXISTS AT ALL
 *
 * The Academy is a THIRD surface on the shared `account` table, and until this change it had sign-in and
 * sign-up and no way to replace a password. The owner reported exactly that fault one site along: *"why is
 * users not able to change their passwords? everyone should be able to change their passwords."*
 *
 * **AND WHY IT IS HERE RATHER THAN ONLY IN `packages/db`.** The two implementations are copies — the build
 * boundary that makes them copies is recorded at the bottom of `@/backend/passwords`, and so is what I would
 * change instead. Until that is done, **the thing that keeps a copy honest is a test that fails when it
 * drifts**, which is the rule the Academy's `AGENTS.md` already set for the password scheme.
 *
 * **THE ASSERTION THAT MATTERS IS NOT "IT REFUSES".** It is that a refusal **writes nothing**: a function
 * that refused a wrong current password *and had already written the hash* would pass every test that only
 * looked at the thrown error. So the store below records every statement and the refusals assert on it.
 *
 * No database server is needed: `changeOwnPassword` takes the two statements it needs as a parameter, and
 * `revokeOtherSessions` takes the one it needs. `./db.ts` satisfies both structurally, so production is
 * unchanged and this test can exercise the guard rather than the connection.
 */

const ORIGINAL = "the original password";
const CHANGED = "a completely different password";
const EMAIL = "learner@example.com";

function store(rows: Record<string, { password_hash: string | null; email: string }>) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const fake: PasswordStore & { calls: typeof calls } = {
    calls,
    async one<T>(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      return (rows[String(params[0])] ?? null) as T | null;
    },
    async query(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      return { rowCount: 1 };
    },
  };
  return fake;
}

const writes = (calls: { sql: string }[]) => calls.filter((c) => /^\s*(update|insert|delete)/i.test(c.sql));

/**
 * The canonical implementation, imported for the cross-check only.
 *
 * It lives at `packages/db/src/accounts.ts` in this repository and is deliberately outside the Academy's
 * build context — **which is exactly why the Academy carries a copy, and exactly why a test may reach for it
 * even though the application may not.** If this import ever fails, the copy has stopped being checkable and
 * that is itself the finding.
 */
async function canonical() {
  return import("../../../../packages/db/src/accounts");
}

describe("changeOwnPassword", () => {
  it("agrees with the canonical implementation, in both directions", async () => {
    const canon = await canonical();
    const fromAcademy = await academyHash(ORIGINAL);
    const fromCanonical = await canon.hashPassword(ORIGINAL);

    // An account is one row in one table: a hash written by either side must verify under the other, or a
    // person who registered on one Ozikoro site cannot sign in on the other.
    expect(await canon.verifyPassword(ORIGINAL, fromAcademy)).toBe(true);
    expect(await academyVerify(ORIGINAL, fromCanonical)).toBe(true);
    expect(await canon.verifyPassword("not the password", fromAcademy)).toBe(false);
    expect(await academyVerify("not the password", fromCanonical)).toBe(false);
  });

  it("refuses a wrong current password and writes NOTHING", async () => {
    const canon = await canonical();
    const s = store({ "7": { password_hash: await canon.hashPassword(ORIGINAL), email: EMAIL } });

    await expect(
      changeOwnPassword(7, "not the password", CHANGED, { keepSessionToken: "this-session" }, s)
    ).rejects.toMatchObject({ code: "wrong_password", message: "That is not your current password." });

    // The whole point: a borrowed session must not be able to turn itself into a permanent takeover, and a
    // refusal that had already replaced the hash would have done exactly that.
    expect(writes(s.calls)).toEqual([]);
  });

  it("refuses the same password, and a password the policy refuses, before writing", async () => {
    const canon = await canonical();
    const hash = await canon.hashPassword(ORIGINAL);

    const same = store({ "7": { password_hash: hash, email: EMAIL } });
    await expect(changeOwnPassword(7, ORIGINAL, ORIGINAL, {}, same)).rejects.toMatchObject({
      code: "same_password",
    });
    expect(writes(same.calls)).toEqual([]);

    const short = store({ "7": { password_hash: hash, email: EMAIL } });
    await expect(changeOwnPassword(7, ORIGINAL, "short", {}, short)).rejects.toMatchObject({
      code: "weak_password",
    });
    expect(writes(short.calls)).toEqual([]);

    // The email is refused as a password because it is public. This is the canonical policy, not one the
    // Academy invented — the point of the copy is that the rules are the same.
    const asEmail = store({ "7": { password_hash: hash, email: EMAIL } });
    await expect(changeOwnPassword(7, ORIGINAL, EMAIL, {}, asEmail)).rejects.toMatchObject({
      code: "weak_password",
    });
    expect(writes(asEmail.calls)).toEqual([]);
  });

  it("writes the hash, audits it as `self`, voids open links and keeps only this session", async () => {
    const canon = await canonical();
    const s = store({ "7": { password_hash: await canon.hashPassword(ORIGINAL), email: EMAIL } });

    await changeOwnPassword(
      7,
      ORIGINAL,
      CHANGED,
      { keepSessionToken: "this-session", ipAddress: "203.0.113.7" },
      s
    );

    const hashWrite = s.calls.find((c) => /update account set password_hash/i.test(c.sql));
    expect(hashWrite).toBeTruthy();
    const written = String(hashWrite!.params[1]);
    expect(await academyVerify(CHANGED, written)).toBe(true);
    expect(await canon.verifyPassword(CHANGED, written)).toBe(true);
    expect(await academyVerify(ORIGINAL, written)).toBe(false);

    expect(s.calls.some((c) => /insert into password_change/i.test(c.sql))).toBe(true);
    expect(s.calls.some((c) => /update password_reset set used_at/i.test(c.sql))).toBe(true);

    // Every OTHER session is closed, which is the part that matters when a password is being replaced — and
    // this one survives, because signing somebody out of the page where they just succeeded reads as a
    // failure rather than as a precaution.
    const revoke = s.calls.find((c) => /update auth_session set revoked_at/i.test(c.sql));
    expect(revoke).toBeTruthy();
    expect(revoke!.params[0]).toBe(7);
    expect(revoke!.params[1]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses an account with no password rather than silently giving it one", async () => {
    const s = store({ "7": { password_hash: null, email: EMAIL } });
    await expect(changeOwnPassword(7, ORIGINAL, CHANGED, {}, s)).rejects.toBeInstanceOf(AccountError);
    expect(writes(s.calls)).toEqual([]);
  });
});
