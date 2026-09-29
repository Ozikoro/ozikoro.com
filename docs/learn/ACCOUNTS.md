# One account across ozikoro.com, ozituma.com and learn.ozituma.com

**Owner's requirement:** "anyone who registered in either ozikoro.com, learn.ozituma.com and
ozituma.com will be one. any account created is to work on this three platforms."

**Status:** implemented for ozituma.com ↔ learn.ozituma.com. **Not possible as a cookie for
ozikoro.com** — see §2, which explains why and what it needs instead.

---

## 1. What was built: ozituma.com ↔ learn.ozituma.com

These two share an account today, by two mechanisms.

**One account table.** Both apps read `packages/db/src/accounts.ts`, which reads the single
`account` table in the one Postgres database. There is no copy to keep in step, because there is
no copy.

**One session cookie.** `sessionCookieOptions()` now sets a `Domain` when
`OZITUMA_AUTH_COOKIE_DOMAIN` is configured:

```
OZITUMA_AUTH_COOKIE_DOMAIN=.ozituma.com
```

Without it the cookie is **host-only**: a session created on `ozituma.com` is not sent to
`learn.ozituma.com`, so a learner signs in on the dictionary and arrives at the courses signed
out. With the leading-dot domain, one cookie is valid for both. This is §6.2's "shared auth cookie
domain (.ozituma.com)".

**It is off by default, deliberately.** The value is validated rather than passed through,
because a browser silently discards a cookie whose `Domain` does not match the request and logs
nothing — so a malformed value looks exactly like a broken sign-in. A value containing a scheme, a
path or a port is rejected and the safe host-only default is used instead. `test:accounts` covers
this, including the values that would break sign-in silently.

Signing in anywhere on `.ozituma.com` therefore works everywhere on `.ozituma.com`. Nothing about
the learner's identity is duplicated.

---

## 2. The limit: ozikoro.com cannot be a cookie

**This is a browser rule, not a configuration choice, and no setting crosses it.**

A cookie may only be shared within ONE registrable domain. `ozikoro.com` and `ozituma.com` are
different registrable domains, so a cookie set for `.ozituma.com` is never sent to `ozikoro.com`.
There is no `Domain` value that spans them; a browser will not accept one. `test:accounts` asserts
this explicitly so the constraint sits next to the code that looks like it should be able to do it.

### And ozikoro.com is a different platform

Checked on 28 September 2026:

```
$ curl -sI https://ozikoro.com/
link: <https://ozikoro.com/wp-json/>; rel="https://api.w.org/"
generator: WordPress 7.1.2
generator: Elementor 4.3.2
server: cloudflare
```

ozikoro.com is **WordPress 7.1.2 with Elementor**, on cPanel at `162.213.253.73`. It is not this
codebase, not this database, and it has its own user table and its own login. The other two are
Next.js apps on EC2 sharing one Postgres.

So "one account across all three" is not a small change. It is an identity federation problem
between two unrelated systems on two unrelated domains.

---

## 3. What ozikoro.com actually needs: SSO

Because a cookie cannot cross the domain boundary, the account has to be handed over explicitly.
Three viable routes, in the order I would recommend them.

### Option A — Ozituma becomes the identity provider (recommended)

Ozituma already has real accounts: `scrypt` password hashing with per-password salts, server-side
session rows with expiry and revocation, and roles. It becomes an OIDC provider; the WordPress
site consumes it with an off-the-shelf OIDC **client** plugin.

Why this direction: WordPress has mature OIDC *client* plugins and no good story for being an
identity provider to a custom app, whereas the Ozituma side is code we control and can test.

The flow: a reader clicks "Sign in" on ozikoro.com → redirected to `ozituma.com/oauth/authorize`
→ signs in once → redirected back with an authorisation code → WordPress exchanges it for an ID
token → WordPress creates or matches a local user and starts its own session.

Two sessions, one identity. That is normal and unavoidable across registrable domains.

**What it needs:** cPanel/WordPress admin access on ozikoro.com to install and configure the
plugin. That host is outside this repository and outside anything I can reach.

### Option B — WordPress becomes the identity provider

The reverse. Every Ozituma account would be created through WordPress. Rejected as the primary
recommendation: it puts the dictionary's authentication behind a plugin on a shared cPanel host,
and it means a WordPress outage signs learners out of the courses.

### Option C — Accounts remain separate, linked later

Each platform keeps its own accounts and a signed-in learner can link them. Cheapest, weakest:
two accounts is what the owner explicitly asked to avoid, and it is the state things drift back to
if nothing is done.

### What is not an option

**A shared cookie.** §2 explains why. Any plan that assumes one cookie spans ozikoro.com and
ozituma.com will fail at the browser, silently.

**Sharing the WordPress database.** WordPress's `wp_users` and Ozituma's `account` have different
schemas, different password hashing and different roles. Pointing one app at the other's tables
would couple two systems at the schema level, which is worse than the problem it solves.

---

## 4. What still needs doing

| # | Item | Owner |
|---|---|---|
| 1 | Set `OZITUMA_AUTH_COOKIE_DOMAIN=.ozituma.com` in staging and production | Deploy step |
| 2 | Confirm ozikoro.com's WordPress has, or can install, an OIDC client plugin | Needs WP admin access |
| 3 | Decide Option A, B or C | **Owner** |
| 4 | Build the OIDC provider endpoints on Ozituma (if A) | This repository |
| 5 | Legal: one privacy policy covering all three, and one data-deletion path | §17.4, §18 #11 |

Item 3 is the blocker. Items 1 and 4 are ready to proceed; item 2 is the one that needs access
nobody here has.

---

## 5. A related decision this raises

§18 #8 asks "shared login with ozituma.com from day one or later", and the spec's default was
**later — separate accounts in v1.0**. The owner has now answered it in the opposite direction, and
that is cheaper than the spec assumed for the two Ozituma hosts: it is one cookie domain rather
than a second auth system. Recorded in `docs/decisions.md`.
