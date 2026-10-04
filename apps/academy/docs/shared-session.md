# The Ozikoro family session

How **`academy.ozikoro.com`**, **`shop.ozikoro.com`** and **`ozikoro.com`** share one sign-in, and
why **`ozituma.com`** cannot join them by these means.

---

## 1. The constraint that decides the design

Cookies are scoped to a **registrable domain**. A site at `shop.ozikoro.com` can read a cookie set
for `.ozikoro.com`; a site at `ozituma.com` cannot, at any setting, ever.

This is a browser rule, not a configuration choice, and `packages/db/src/accounts.ts` already records
it:

> *"a cookie may only be shared within ONE registrable domain. ozikoro.com and ozituma.com are
> different registrable domains, so no cookie setting can span them — that pairing needs SSO, not a
> cookie."*

So there are two groups, and they need different things:

| Group | Sites | One sign-in? |
| --- | --- | --- |
| **The ozikoro.com family** | `ozikoro.com`, `shop.ozikoro.com`, `academy.ozikoro.com` | **Yes** — one `.ozikoro.com` cookie |
| **Ozituma** | `ozituma.com` | **No** — needs a token handshake (see §6) |

**Sharing an account is not sharing a session.** Today the Academy and Ozituma share the `account`
table, so one email and password works on both — but signing in on one does not sign you in on the
other. Those are different properties and only the first exists.

---

## 2. The cookie

| | |
| --- | --- |
| **Name** | `ozikoro_session` |
| **Domain** | `.ozikoro.com` |
| **Path** | `/` |
| **HttpOnly** | yes |
| **Secure** | yes |
| **SameSite** | `Lax` |
| **Max-Age** | 2592000 (30 days) |
| **Value** | a 32-byte random token, base64url encoded |

`SameSite=Lax` is what makes the sharing safe rather than merely possible: the cookie is sent on
same-site requests — which is every hop between the three family hosts — and withheld from
cross-origin ones. A hostile site cannot make a logged-in visitor's browser carry the session to an
endpoint that would act on it.

**It is deliberately not `ozituma_session`.** That name belongs to the dictionary, which is on a
different registrable domain and can never share a cookie with these three. Reusing its name would
imply a shared session the browser will refuse.

---

## 3. Server-side storage

The token is never stored. Only its **SHA-256 hex digest** is, in the shared `auth_session` table:

```sql
select a.id, a.email, a.display_name, a.role
  from auth_session s
  join account a on a.id = s.account_id
 where s.token_hash = $1          -- sha256hex(token)
   and s.revoked_at is null
   and s.expires_at > now()
   and a.status = 'active';
```

A database leak therefore yields no usable sessions, and revoking one takes effect immediately —
which a stateless JWT cannot do without a revocation list that is this table anyway.

---

## 4. Introspection: the endpoint to call

`shop.ozikoro.com` runs on its own host and has no connection to the shared database, so the Academy
answers the question for it.

```
GET https://academy.ozikoro.com/api/session
```

The caller supplies the token **either** by forwarding the cookie:

```
Cookie: ozikoro_session=<token>
```

**or** as a bearer token, which is easier from most HTTP clients:

```
Authorization: Bearer <token>
```

### Responses

**Signed in — `200`**

```json
{ "account": { "id": 53, "email": "someone@example.com", "displayName": "Someone", "role": "contributor" } }
```

**Not signed in — `401`**

```json
{ "account": null }
```

**`405`** for any method other than `GET`/`HEAD`. **`500`** means the Academy could not reach the
database — treat it as *"try again"*, **not** as *"signed out"*. A sibling app that conflates the two
will sign people out during a blip.

`Cache-Control: no-store` is always set. Do not cache a 200.

### How a sibling app uses it

The cookie is `HttpOnly`, so **no page script can read it** — that is the point, and it is not worked
around. The sibling app reads the cookie from its own incoming request *on its own server* and
forwards it:

```ts
// In a Next.js server component, route handler, or middleware — never in the browser.
const token = request.cookies.get("ozikoro_session")?.value;

const response = await fetch("https://academy.ozikoro.com/api/session", {
  headers: { authorization: `Bearer ${token}` },
  cache: "no-store",
});
const { account } = response.status === 200 ? await response.json() : { account: null };
```

**There is no CORS header on this endpoint, deliberately.** Opening it to browser callers would mean
answering credentialed cross-origin requests; the server-side call needs no CORS at all and keeps the
token out of JavaScript.

---

## 5. If you have database access instead

`ozikoro.com` will run on the same host and the same Postgres as the Academy. It can skip the HTTP
call and use §3 directly. Both paths read the same row, so they cannot disagree.

---

## 6. Ozituma, and anything else on another domain

A cookie cannot cross from `ozikoro.com` to `ozituma.com`. Making one sign-in cover both needs a
**token handshake**, and no amount of cookie configuration substitutes for it:

1. The user signs in on whichever site they reached first.
2. That site redirects to a single agreed identity endpoint with a `return_to`.
3. The identity endpoint mints a **short-lived, single-use code** and redirects back.
4. The receiving site exchanges the code server-to-server for the account, and mints **its own local
   session** on its own domain.
5. Each site keeps its own cookie from then on. There is no shared cookie, because there cannot be.

The shared `account` and `auth_session` tables make step 4 small — the identity already exists. What
does not exist is the endpoint, the code store and the redirect handling. That is real work, and it
should be designed as its own change rather than bolted onto a cookie.

---

## 7. Endpoints, in one place

| Endpoint | Purpose |
| --- | --- |
| `GET /api/session` | Who is behind this request. `200` with the account, `401` with `null`. |
| `GET /api/health` | `{ ok, database, service }`. `503` when the database is unreachable. |
| `GET /api/health` is also the probe the Caddyfile exempts from caching, and what the container healthcheck uses. | |
