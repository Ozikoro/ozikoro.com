# Credential rotation — what to change, in what order, and how to prove it worked

**Written for someone who has never rotated a credential.** Every step is a command to paste or a
button to press. Where a console path could not be confirmed, this document says **"not confirmed"**
rather than guessing a menu name — *a runbook with a wrong menu path is worse than one that says
"look for the API keys section"*.

---

## 0. Why this exists

On **2026-10-05** an agent reached the production host over SSM and ran a command that printed
`/opt/ozituma/.env` in full. The **names** would have answered the question — *what is configured?* —
but the **values** went into a session transcript, and every credential in that file must now be
treated as disclosed. The rule that prevents a repeat is in `AGENTS.md`:
**read a secret's NAME, never its VALUE.**

This document is the other half of that rule: the work the disclosure created. `AGENTS.md` names the
principle; this file is the procedure. **The script beside it, [`scripts/rotate-credential.mjs`](../scripts/rotate-credential.mjs),
is the mechanical half.**

### 0.1 The rule every rotation follows

**Rotating is three steps, always in this order:**

| | step | why this order |
|---|---|---|
| 1 | **Create** the new credential at its issuer | Creating usually leaves the old one alive, so nothing breaks yet |
| 2 | **Put it where the application reads it** and restart what reads it | The site now uses the new value; the old one is still valid as a fallback |
| 3 | **Revoke** the old credential at the issuer | Now the disclosed value is dead. *This is the step that makes it a rotation* |

**Revoking before step 2 is an outage.** A rotation that creates a new key and never revokes the old
one **changed nothing an attacker cares about** — that is why every section below ends with a check
that the old value now **fails**.

### 0.2 ⚠️ Do not ask an agent to do this

**`scripts/rotate-credential.mjs` is for you, on the host, with the new credential already in your
hand.** It is not an agent instrument. To run it, an agent would have to be *given* the new value —
through a conversation, which is a transcript, **which is the incident this work exists to remedy.**
An agent's part of this job is this document and that script. **The value never passes through
either.**

### 0.3 Where things live — two files, and they are not the same file

This distinction matters, because it changes which credentials are even at risk:

| file | on | holds | in git? |
|---|---|---|---|
| `/opt/ozituma/.env` | **the production host** | the credentials **the applications use** — object storage, database, mail, payments | no |
| `.env.local` | **this checkout, on the laptop** | local development keys, and the **cPanel** credentials used by hand for the WordPress extraction | no (gitignored) |

**`CPANEL_PASSWORD` and `CPANEL_API_TOKEN` are in the checkout's `.env.local`, not on the host.**
They are not read by either application. See §7.

### 0.4 How to run any step below

The script changes **one credential per run** — on purpose. A script that rotated everything at once
would be a script that can take the whole site down at once, and it would leave no checkpoint to stop
at.

```bash
cd /opt/ozituma/app

# The value is typed at a hidden prompt, so it never reaches the shell history or `ps`.
node scripts/rotate-credential.mjs <credential>

# Backup location (a file full of secrets — mode 0700 directory, 0600 file):
#   /root/.ozituma-credential-backups
# It is refused anywhere the application serves or the bucket holds.
```

It reads the new value at a hidden prompt, backs up `/opt/ozituma/.env` **first**, proves the new
value works **before** it writes anything, restarts what needs restarting, and **if anything fails it
puts the old value back and exits non-zero.** It prints the variable **name**, its **length**, a
**sha256 fingerprint**, and whether it works — **never a value.**

---

## 1. The order, and why it is this order

The order is not a preference. It is ranked by **how much damage the disclosed value does**, and
secondarily by **how self-contained the change is** — a credential that one application reads and
nothing else coordinates can be rotated calmly, while one whose value has to change in two places at
once has to be handled last, with the most care.

| # | credential | where it lives | why here | time |
|---|---|---|---|---|
| **1** | `S3_ACCESS_KEY_ID` + `S3_SECRET_ACCESS_KEY` | host `.env` | **Highest value, and the most self-contained.** The bucket is the most exposed and the most destructive thing here — see §2 | **~10 min** |
| **2** | `GITHUB_TOKEN` | **macOS keychain**, not the host | Push access to the repository. Self-contained; does not touch the running site at all | **~8 min** |
| **3** | `OZITUMA_SMTP_PASSWORD` | host `.env` | High value — sending mail as the domain is how an account is taken over — but multi-part, so slower | **~15 min** |
| **4** | Email API key (`RESEND_API_KEY` *if present*) | host `.env` | Same value class as 3, and only matters if the host actually holds one — **check first (§4.0)** | **~8 min** |
| **5** | `PAYSTACK_SECRET_KEY`, `NOWPAYMENTS_API_KEY` | host `.env` | ⚠️ **First establish whether these are TEST or LIVE.** Test is nearly free; live is money and it jumps the queue — see §5 | **~25 min** |
| **6** | `POSTGRES_PASSWORD` | host `.env` **and** the database | Different in kind: the password changes in **two** places at once, and getting the sequence wrong takes the whole archive offline | **~30 min** |

**Total: roughly 1 hour 36 minutes of work, in six sittings** — *S3 10 min, GitHub 8, mail 15 + Resend
8, payments 12 + 13, Postgres 30.* Do them across a few days rather than
in one go if you can — each one is a separate change, and a separate chance to stop.

**Where I disagreed with an earlier reading of this order:** the brief that commissioned this work
listed `GITHUB_TOKEN` second and treated it as equal in urgency with the storage keys. It is second,
but **it is not equal.** The bucket is worse, and the reason is in §2.

---

## 2. `S3_*` first — and why it is not close

### 2.1 What issued it, and where the new one is created

**Issuer: Cloudflare, in your own account** — this is the object storage that serves every photograph,
recording and episode.

1. Go to **<https://dash.cloudflare.com/>** → **Storage & databases** → **R2** → **Overview**.
2. Select **Manage** in the **API Tokens** section.
3. Select **Create Account API token** (or **Create User API token**).
4. Permission: **Object Read & Write**. Scope it with **Apply to specific buckets only** and select
   the media bucket — **do not grant account-wide access.**
5. Select **Create API Token**.
6. **Copy the Access Key ID and the Secret Access Key now.** Cloudflare shows the secret **once** and
   never again.

*Source for these steps: [Cloudflare R2 — S3 API get started](https://developers.cloudflare.com/r2/get-started/s3/).*

> ⚠️ **Do not revoke the old token yet.** Leave the old token alive until §2.5 passes. Cloudflare
> lets both exist at once, which is what makes this rotation safe.

### 2.2 Why this is first

`media.ozituma.com` is the bucket's public address, and it **serves objects anonymously.** Measured,
with no credentials at all (`docs/OZIKORO-CUTOVER.md`):

```bash
curl -sI https://media.ozituma.com/ozikoro/9274-osm-intl8aa250x200@2x.png
# HTTP/2 200
# content-type: image/png
# content-length: 47361
```

Read access is already public — **that is not the problem.** The problem is that `S3_ACCESS_KEY_ID`
and `S3_SECRET_ACCESS_KEY` are **write** credentials. The disclosed pair is the only thing between a
stranger and the ability to **overwrite or delete every photograph and every episode**, and a
`DELETE` does not need a backup to be annoying: the audio is 4.45 GB and is the dictionary's entire
spoken record.

It is first because it is **both** the highest-value credential **and** the most self-contained: the
applications read the keys and nothing else coordinates with them. There is no second system to keep
in step, so there is no window in which two things disagree.

### 2.3 What breaks if the order is wrong

- **If you revoke the old token before the new one is in place**, the dictionary loses the ability to
  upload pronunciation audio and documents. The site still serves — reading is anonymous — so
  **the failure is silent in a browser** and shows up only when someone tries to add audio.
- **If the new token is scoped to the wrong bucket**, the proof in §2.4 returns `403` and the script
  refuses to write it. That is the script working.

### 2.4 Put the new value in place

```bash
ssh <your-ssm-or-ssh-route-to-the-host>
sudo -i
cd /opt/ozituma/app
node scripts/rotate-credential.mjs s3
```

It asks for **two** values — the Access Key ID, then the Secret Access Key — at a hidden prompt.
Expected output (the fingerprint will differ; **this is the shape**):

```
  For each variable — the old value and the new one, by name only:
    S3_ACCESS_KEY_ID
      before  length=32  sha256:1a2b3c4d
      after   length=32  sha256:5e6f7a8b
    S3_SECRET_ACCESS_KEY
      before  length=64  sha256:9c0d1e2f
      after   length=64  sha256:3a4b5c6d

  BACKUP TAKEN — the old value survives this run whatever happens next:
    /root/.ozituma-credential-backups/.env.<timestamp>.s3.bak   (mode 0600, mode-0700 directory)

  ── proving the new value: a real signed HEAD request against the bucket ──
  ✓ HEAD <account>.r2.cloudflarestorage.com → 200

  ── writing ──
  ✓ /opt/ozituma/.env rewritten (mode 0600)
  ✓ restart: nothing to restart — no container on this host reads this variable

  ── the old value, probed again: it must now FAIL ──
  ✓ the old value was refused
```

**Two things to notice in that output.** It proves the key with a **real signed request** — a
`HEAD` for a known object — not by checking that the strings look plausible. And it re-probes the
**old** key and expects the service to refuse it: **that is what makes it a rotation.**

> If the probe says `404 (credential accepted; probe key absent)`, the credential is **fine** and the
> object has moved. That is not a failure and the script says so.

### 2.5 Prove it — the new value works

`/api/health` proves the app is up, but it does not touch the bucket. The end-to-end proof is the
public door and a signed request:

```bash
# 1. the public read still works (was already true before the rotation)
curl -sI https://media.ozituma.com/ozikoro/9274-osm-intl8aa250x200@2x.png | head -1
# expect: HTTP/2 200

# 2. a signed request with the NEW keys — the script already did this, but do it once by hand
#    so you have seen it yourself. NAMES come from the file; the VALUES are never printed.
cd /opt/ozituma/app
docker compose --env-file /opt/ozituma/.env -f docker/docker-compose.prod.yml run --rm -T --entrypoint sh backup-upload -c '
  aws s3api head-object --endpoint-url "$S3_ENDPOINT" --bucket "$S3_BUCKET" \
    --key ozikoro/9274-osm-intl8aa250x200@2x.png --query ContentLength --output text'
# expect: a number (47361 for this object). Any number means the signature was accepted.
```

### 2.6 Prove it — the OLD value now FAILS

**This is the step everyone skips.** Revoke the old token in Cloudflare (**Storage & databases** →
**R2** → **API Tokens** → the old token → **Delete**), then measure it:

```bash
# The OLD pair, typed at the prompt. They never appear in this file, on the command line, or in
# the shell's in-memory history; `history -c` afterwards closes the on-disk history too.
printf 'old access key id: '        # then paste and press Return
read -r AWS_ACCESS_KEY_ID
printf 'old secret access key: '    # then paste and press Return
read -rs AWS_SECRET_ACCESS_KEY
printf '\n'
export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
aws s3api head-object --endpoint-url "$S3_ENDPOINT" --bucket "$S3_BUCKET" \
  --key ozikoro/9274-osm-intl8aa250x200@2x.png
```

**Expected failure — `403`:**

```
An error occurred (403) when calling the HeadObject operation: Forbidden
```

⚠️ **If you get a number back instead, the rotation is NOT finished.** The old key is still live.
Go back to Cloudflare and delete it.

> **Never** put the old values on a command line you have not cleared (`history -c`), and never paste
> them into a chat, a ticket or a document. `export` in a shell that is about to close is fine;
> anything that saves text is not.

---

## 3. `GITHUB_TOKEN` second

### 3.1 Where it is issued, and where it actually lives

**Issuer: GitHub.** Create at **<https://github.com/settings/tokens>**.

> ⚠️ **This token is NOT in the host's `/opt/ozituma/.env`.** `AGENTS.md` records it as living in the
> **macOS keychain on the laptop**, service `github-api-token-oziikoro`, account `oziikoro`, and that
> matches the host `.env` inventory in `docs/OZIKORO-CUTOVER.md` §5.8 — which lists `S3_*`, mail,
> payments, `AWS_*` and `POSTGRES_PASSWORD`, and no GitHub token.
>
> **So `node scripts/rotate-credential.mjs github` is not the tool for this one unless a GitHub token
> is later added to the host.** With the token in the keychain, the rotation is: create the new token
> at GitHub, put it in the keychain, revoke the old token — all on the laptop. §3.4 gives that
> sequence. **I could not confirm from this checkout whether a `GITHUB_TOKEN` also exists on the host**
> — the cutover document's inventory is a measurement from another round and says it does not. Check
> the host's *names* before assuming either way:

```bash
# NAMES ONLY. Do not print values.
grep -oE '^[A-Z_]+=' /opt/ozituma/.env | tr -d '=' | sort | grep -i github
# no output = there is no GITHUB_TOKEN on the host
```

### 3.2 Create the new one

At **<https://github.com/settings/tokens>** → **Generate new token**. For a classic token, the scopes
that let `git push` work are **`repo`** (and `workflow` if you push workflow files). Set an expiry —
90 days is a reasonable default and the keychain entry can be replaced when it lapses.

**The old token keeps working until you delete it.** That is what makes this safe.

### 3.3 What breaks if the order is wrong

Nothing on the live site — which is exactly why this is second. It does not touch a container, a
database or the bucket. The only thing that breaks is **your ability to push**, and only if you
delete the old token before the new one is stored.

### 3.4 Put it in place (keychain path)

```bash
# Store the NEW token. Use `security add-generic-password -U` to REPLACE the existing item.
security add-generic-password -U -s github-api-token-oziikoro -a oziikoro -w
# paste the new token at the prompt, then press Return
```

### 3.5 Prove the new value works

```bash
security find-generic-password -s github-api-token-oziikoro -a oziikoro -w \
  | tr -d '\n\r' > /tmp/tok

# read access: returns the login
curl -s -H "Authorization: Bearer $(cat /tmp/tok)" https://api.github.com/user | head -3

# write access: a blob POST returning 201 proves the token can push
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  -H "Authorization: Bearer $(cat /tmp/tok)" \
  -H 'Accept: application/vnd.github+json' \
  https://api.github.com/repos/oziikoro/Ozikoro/git/blobs \
  -d '{"content":"cHJvb2Y=","encoding":"base64"}'
# expect: 201
```

*`AGENTS.md` records both of these probes: `/user` returns the login, and a `201` from `/git/blobs`
proves write access. If the API works but `git push` reports `Repository not found`, the cause is the
credential helper, not the token — push with `-c credential.helper=`.*

### 3.6 Prove it — the OLD token now FAILS

Revoke the old token at <https://github.com/settings/tokens> (the token → **Delete**), then:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer REPLACE_ME_OLD_TOKEN" \
  https://api.github.com/user
```

**Expected failure — `401`:**

```
401
```

⚠️ A `200` means the old token is still live: it was not deleted.

---

## 4. The mail credentials, third

### 4.0 Check which mail credential the host actually holds, before anything else

**Read NAMES, never values:**

```bash
grep -oE '^[A-Z_]+=' /opt/ozituma/.env | tr -d '=' | sort | grep -E 'SMTP|RESEND|ZOHO|MAIL'
```

`docs/OZIKORO-CUTOVER.md` §5.8 measured the host's names this round and reports **`OZITUMA_SMTP_*`
and `OZITUMA_MAIL_FROM` are present**, and **`RESEND_API_KEY` is NOT** — *"each of which is a feature
that will be off rather than broken, which is the intended behaviour but should be a decision rather
than a surprise."* **So expect to rotate the SMTP password (§4.2) and to skip Resend (§4.4) unless
that grep contradicts it.**

> ⚠️ **`AGENTS.md` lists `OZITUMA_ZOHO_KEY` among the disclosed values. That name appears NOWHERE in
> the code or in any `.env.example` — only in that table.** The mail module reads
> `OZITUMA_SMTP_HOST`, `OZITUMA_SMTP_PORT`, `OZITUMA_SMTP_USER`, `OZITUMA_SMTP_PASSWORD` and
> `OZITUMA_SMTP_ALLOW_PLAINTEXT` (`packages/core/src/mail.ts`). **Treat `OZITUMA_ZOHO_KEY` as a stale
> name in the incident table**, not as a live variable — but if the grep above shows it on the host,
> rotate it as a `secret` step (§8) because nothing reads it and nothing can prove it.

### 4.1 What issued it, and where the new one is created

**Issuer: whichever mail provider `OZITUMA_SMTP_HOST` points at.** `AGENTS.md` says **Zoho**; the host
inventory says the SMTP names are set. Read the host's `OZITUMA_SMTP_HOST` **name** to confirm which
mailbox this is — the value is not a secret, but read it as a name to be safe:

```bash
grep -E '^OZITUMA_SMTP_(HOST|PORT|USER)=' /opt/ozituma/.env
```

**The password is not the same as the login.** Most providers do not accept your account password
over SMTP; they issue an **app-specific password** for it. Zoho's feature is documented at
<https://help.zoho.com/> — *search that help centre for **"app-specific password"***.

> **⚠️ Not confirmed, and deliberately not invented.** This document does not give the Zoho menu path
> (which Settings screen, which tab) because it could not be verified. The *feature* and the search
> term are confirmed; the navigation is not. If the provider is not Zoho, find the equivalent
> **"app password" / "SMTP password"** section in that provider's account settings — every provider
> that offers SMTP offers it under one of those two names.

**Create a new app-specific password and leave the old one valid.** Where the provider offers to
revoke the old one at the same moment, **do not** — this rotation needs both alive until §4.5.

### 4.2 Put the new value in place

```bash
cd /opt/ozituma/app
node scripts/rotate-credential.mjs smtp
```

Its proof is an **authenticated SMTP handshake, not a send** — a send would prove the password by
putting mail in somebody's inbox, which is a real message you did not want to send. Expected shape:

```
  ── proving the new value: an authenticated SMTP handshake (not a send) ──
  ✓ authenticated to <smtp-host>:587

  ── writing ──
  ✓ /opt/ozituma/.env rewritten (mode 0600)
  ✓ restart: recreated: web, ozikoro

  ── the old value, probed again: it must now FAIL ──
  ✓ the old value was refused
```

**If the server does not offer STARTTLS**, the script **refuses** rather than putting your password
on the wire in clear text. It says so, and it tells you the escape hatch — set
`OZITUMA_SMTP_ALLOW_PLAINTEXT=1` in the file, which is **the same opt-in the application itself
requires** (`packages/core/src/mail.ts`). Only do that if you have decided an unencrypted mail
session is acceptable for this mailbox.

### 4.3 What breaks if the order is wrong

- **Revoke the app password before the new one is in the file** → the site can no longer send mail.
  Password resets, registration confirmations and any notification silently stop.
- **Rotate the password but forget that compose passes a service only the variables it names** — the
  script recreates `web` and `ozikoro` for you. If you edit `.env` by hand instead, the containers
  keep the old value until they are **recreated** (`docker compose up -d web ozikoro`), not merely
  restarted. `restart` brings the old value straight back, because compose resolves `${…}` when it
  *creates* a container.

### 4.4 Resend, if and only if the host holds a key

**Issuer: Resend.** Create at **<https://resend.com/api-keys>** → **Create API Key**; give it
**Sending access** and restrict it to the sending domain if offered. *Source: [Resend — Create an API
key](https://resend.com/docs/create-an-api-key) and [Resend — Manage API keys](https://resend.com/docs/dashboard/api-keys/introduction).*

**Resend is tried BEFORE SMTP** (`packages/core/src/mail.ts`), so if this key exists it is the
transport actually in use and SMTP is the fallback — rotate it first if both exist.

```bash
node scripts/rotate-credential.mjs resend
# proof: GET https://api.resend.com/domains → 200  (a list; it sends nothing)
```

**Prove the old one fails:** delete the old key at <https://resend.com/api-keys> → the key →
**Remove API key**, then

```bash
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer REPLACE_ME_OLD_KEY" \
  https://api.resend.com/domains
# expected failure: 401
```

### 4.5 Prove it — the old SMTP password now FAILS

Revoke the old app-specific password at the mail provider, then:

```bash
# A real login attempt with the OLD password. Any mail client will do; swaks is the small one.
# If swaks is not installed, use the provider's webmail login for the same mailbox.
swaks --to you@example.com --server "$OZITUMA_SMTP_HOST" --port 587 --auth LOGIN \
      --auth-user "$OZITUMA_SMTP_USER" --auth-password 'REPLACE_ME_OLD_PASSWORD'
```

**Expected failure — the server refuses the login:**

```
<~  535 5.7.8 Authentication credentials invalid
*** Error: Authentication failed
```

⚠️ **If the login succeeds, the old password is still live and mail can still be sent as your
domain.** Go back to the provider and revoke it. *(`swaks` is not installed by default. If you do not
have it, the provider's own webmail is a valid proof: the old app password fails there too.)*

---

## 5. The payment keys, fourth — **and check test-or-live FIRST**

### 5.0 ⚠️ The test-or-live question, answered before anything is rotated

**This changes the priority, and it is why this section starts here rather than with the console.**

- If the exposed keys are **`sk_test_…` / sandbox**, this rotation is **nearly free**: a test key can
  move no money. Rotate it in its turn below and do not hurry.
- If the exposed keys are **`sk_live_…` / production**, **stop and do these two before the rest of
  this document**: they can move money, and every hour they stay disclosed is an hour someone could
  use them.

**How to tell without reading the value.** Both providers put the mode in the value's own **prefix**
or in **which host answers** — so this reports the mode and nothing else:

```bash
# Paystack: the prefix IS the mode. This prints one word, or nothing at all.
grep -oE '^PAYSTACK_SECRET_KEY=sk_(test|live)_' /opt/ozituma/.env \
  | sed -E 's/^PAYSTACK_SECRET_KEY=//'
```

- `sk_test_` → **TEST. Not urgent.**
- `sk_live_` → **LIVE. Urgent.**
- **nothing printed** → an unrecognised prefix. **Do not paste the value to find out** — read the
  first twelve characters by eye and judge, or treat it as LIVE and be wrong in the safe direction.

For **NOWPayments**, the mode is which API host answers, and the script reports it:

```bash
node scripts/rotate-credential.mjs nowpayments
# its proof line prints:  mode=TEST ... or  mode=LIVE ...  or  mode=UNRECOGNISED
```

> ### What I could not confirm
>
> **I could not confirm whether the exposed Paystack and NOWPayments keys are test or live.** They
> are not in this checkout, and reading them is exactly what must not happen. **This is not a
> "probably fine" — it is genuinely unknown, and the first action in this section is to find out.**
> The runbook is written so that either answer has a procedure; only you can supply the answer.

### 5.1 Paystack

**Issuer: Paystack.**

1. **<https://dashboard.paystack.com/>** → **Settings** → **API Keys & Webhooks**.
2. Find the section for the mode you are rotating — **Test Mode** or **Live Mode**.
3. Select **Generate new secret key**. Paystack asks **when the old key should expire** and for your
   account password. **Choose the longest delay it offers** — the old key must stay alive until the
   new one is proven, and an immediate expiry is a self-inflicted outage.
4. Copy the new secret key.

*Source for these steps: [Paystack — API keys and webhooks](https://support.paystack.com/fr/articles/3073730)
(the article is in French; the dashboard links in it are the canonical ones).*

```bash
cd /opt/ozituma/app
node scripts/rotate-credential.mjs paystack
# proof: mode=LIVE; GET https://api.paystack.co/transaction?perPage=1 → 200
```

**What breaks if the order is wrong:** donations stop working. With an immediate expiry, the first
donor after the switch gets an error page while the site looks fine to everyone else. **Set the expiry
in the future; that is the whole reason Paystack asks.**

**Prove the old key fails** — after Paystack's expiry time has passed:

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer REPLACE_ME_OLD_KEY" \
  'https://api.paystack.co/transaction?perPage=1'
# expected failure: 401
```

### 5.2 NOWPayments

**Issuer: NOWPayments.**

1. Sign in to the **NOWPayments** dashboard → **Account** → the **API keys** section.
2. **Not confirmed:** the exact tab name may be **API keys**, **Store settings**, or **Payment
   settings**. Look for the section that holds an **API key** and an **IPN secret**.
3. Create a new **API key**. Copy it.
4. **The IPN secret is a second, separate value** and it is what makes
   `/api/webhooks/nowpayments` trustworthy — with it unset the route answers `503` and records
   nothing, deliberately, because *"an endpoint that accepts unsigned payments when a key is missing
   is worse than one that does not exist."*
   **Treat the IPN secret as its own rotation (§8)** — here is why:

> ⚠️ **The IPN secret cannot be verified by a read-only call, and a wrong IPN secret is worse than a
> missing one.** The route re-serialises the body and compares an HMAC-SHA512; if the secret is wrong
> every genuine webhook is refused with `401` and **payments stop being recorded**. This is why the
> script has no automated proof for it and refuses to touch it without `--i-have-checked`. Rotate the
> API key first; rotate the IPN secret only when you can watch the webhook logs immediately after.

```bash
cd /opt/ozituma/app
node scripts/rotate-credential.mjs nowpayments
# proof: mode=... ; GET https://api.nowpayments.io/v1/status → 200

# The IPN secret, deliberately unproven by the script:
node scripts/rotate-credential.mjs secret NOWPAYMENTS_IPN_SECRET --i-have-checked
```

**Then watch one real webhook land** before you revoke anything:

```bash
docker compose --env-file /opt/ozituma/.env -f /opt/ozituma/app/docker/docker-compose.prod.yml logs --tail 50 ozikoro | grep -i nowpayments
# expect a 200/acknowledged line, NOT a 401
```

**Prove the old API key fails** — delete it in the NOWPayments dashboard, then:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -H 'x-api-key: REPLACE_ME_OLD_KEY' \
  https://api.nowpayments.io/v1/status
# expected failure: 401
```

**Prove the old IPN secret fails** — a payload signed with the old secret must be refused:

```
expected: HTTP 401 from POST /api/webhooks/nowpayments
```

---

## 6. `POSTGRES_PASSWORD` last, and with the most care

### 6.1 Why it is different in kind

Every other credential has **one** source of truth. This one has **two**: the `role` inside PostgreSQL,
and the `POSTGRES_PASSWORD` line in `/opt/ozituma/.env` that the application uses to authenticate.
**They must agree, and the order in which they are changed decides whether the archive stays up.**

If the database is changed and the file is not, **every container fails to connect** — the dictionary,
the archive and the Academy — until the file is fixed. Get this wrong and *"the archive is offline
until it is fixed."*

**Good news: PostgreSQL does not close existing connections when a role's password changes.** The
running application keeps its live sessions. The failure mode is a **reconnect** — a container
restart, a pool timeout — so the window is real but not instant. **Move deliberately, not frantically.**

### 6.2 What issued it

**Nobody issued it — you choose it.** There is no console. This is the one credential in this document
whose new value you generate rather than look up. **A machine-generated value is better than one you
invent**: if you need one, `openssl rand -base64 32` produces a strong 32-byte password. **Do not
paste its output into a document, a ticket or a chat** — put it straight into the prompt the script
shows, or keep it only in the backup until the rotation is proven.

> ⚠️ **`POSTGRES_USER` and `POSTGRES_DB` do NOT change.** Only the password. `docker-compose.prod.yml`
> builds `DATABASE_URL: postgres://ozituma:${POSTGRES_PASSWORD}@postgres:5432/ozituma`, so changing
> the user or the database name is a different and much larger change.

### 6.3 The exact command order

**The script does steps 3–6 for you in that order. They are written out because you should know what
it is doing while it does it.**

| # | where | what | why |
|---|---|---|---|
| 1 | host | **Take a backup** — the script does this first, to `/root/.ozituma-credential-backups/` | The old value must survive anything that follows |
| 2 | host | **Prove the database is writable** — the script sets a *throwaway* password, proves the app's connection path accepts it, and puts the old one straight back if anything is off | If this host's Postgres auth is unusual, you find out **before** the real password changes |
| 3 | **the database** | `ALTER ROLE "ozituma" WITH PASSWORD '<new>'` — **first** | The new password exists, and the running containers are still on the old one, which still works |
| 4 | **the file** | `/opt/ozituma/.env` → `POSTGRES_PASSWORD=<new>` | Now BOTH are the new value |
| 5 | **the containers** | `docker compose up -d web ozikoro backup backup-upload` — **recreate, not restart** | Compose resolves `${…}` when it *creates* a container. `restart` would bring the old value straight back |
| 6 | host | `/api/health` must report `"database":"reachable"` | The check that the database still answers |

**Do not skip step 2.** It is the difference between finding a problem with the database untouched and
finding it after the file has been written.

### 6.4 Run it

```bash
cd /opt/ozituma/app
node scripts/rotate-credential.mjs postgres
```

Expected shape:

```
  ── postgres: prove the new password BEFORE changing anything ──
  ✓ a throwaway password round-tripped; the role is writable and auth works
  ✓ POSTGRES_PASSWORD set on the role (value not shown)

  ── proving the new value: SELECT 1 through the app's own connection string ──
  ✓ SELECT 1 succeeded through the app's own connection string

  ── writing ──
  ✓ /opt/ozituma/.env rewritten (mode 0600)
  ✓ restart: recreated: web, ozikoro, backup, backup-upload;
      no `academy` service on this host (or it did not come up) — if an academy container exists,
      restart it by hand
  ✓ health: /api/health reports "database":"reachable"
```

> ⚠️ **`academy.ozikoro.com` SHARES THIS DATABASE.** `AGENTS.md` measures it as live, running as
> `ozituma-academy-1` sharing the dictionary's own `account` table — *which is why it names the same
> `DATABASE_URL`.* **If an academy container is running, it must be recreated too, or it is left
> holding the password that was just retired.** The script tries `academy` automatically and says so;
> it cannot always succeed because **the `academy` service is not in this checkout's compose file —
> the repository and the host disagree.** If the line above says no academy service was found, check
> by hand:

```bash
docker ps --format '{{.Names}}\t{{.Image}}' | grep -i academy
# if a container is listed, recreate it:
docker compose --env-file /opt/ozituma/.env -f /opt/ozituma/app/docker/docker-compose.prod.yml up -d academy
```

### 6.5 Prove it — the new password works, and the database still answers

```bash
# 1. the health route runs a REAL QUERY, not a socket check
curl -s http://127.0.0.1:3000/api/health
# expect the body to contain:  "database":"reachable"

# 2. the containers are up and have not been restart-looping
docker compose --env-file /opt/ozituma/.env -f /opt/ozituma/app/docker/docker-compose.prod.yml ps
# expect:  Up (healthy)  — not  Restarting

# 3. the app can still read its own content (a real query, through the app)
curl -s -o /dev/null -w '%{http_code}\n' https://ozituma.com/
# expect: 200
```

### 6.6 Prove it — the OLD password now FAILS

```bash
# On the host, inside the postgres container. This uses the OLD password.
docker compose --env-file /opt/ozituma/.env -f /opt/ozituma/app/docker/docker-compose.prod.yml exec -T postgres \
  sh -c 'PGPASSWORD="REPLACE_ME_OLD_PASSWORD" psql -h postgres -U ozituma -d ozituma -tAc "select 1"'
```

**Expected failure:**

```
psql: error: connection to server at "postgres" (172.x.x.x), port 5432 failed:
FATAL:  password authentication failed for user "ozituma"
```

⚠️ **If it prints `1`, the old password still works** — the database was not actually changed, or a
second role still carries it. Do not stop here.

### 6.7 If it goes wrong

**The script fails closed and puts everything back** — the file from the backup, the role onto the old
password, then it recreates the containers. If you have to do it by hand:

```bash
# 1. restore the file
cp /root/.ozituma-credential-backups/.env.<the-newest>.postgres.bak /opt/ozituma/.env
chmod 600 /opt/ozituma/.env

# 2. put the role back — you need the OLD password, which is in that backup
docker compose --env-file /opt/ozituma/.env -f /opt/ozituma/app/docker/docker-compose.prod.yml exec -T postgres \
  sh -c 'psql -U ozituma -d postgres -v newpw="$OLD" -c "ALTER ROLE ozituma WITH PASSWORD :'"'"'newpw'"'"'"'

# 3. recreate the containers
docker compose --env-file /opt/ozituma/.env -f /opt/ozituma/app/docker/docker-compose.prod.yml up -d web ozikoro backup backup-upload

# 4. confirm
curl -s http://127.0.0.1:3000/api/health
```

---

## 7. Not rotated, and why

### `CPANEL_PASSWORD` / `CPANEL_API_TOKEN` — **not rotated**

**The owner's instruction, verbatim:** *"this project is meant to be in aws, postdegre
[PostgreSQL], and cloudflare for it to be live. cpanel is going as it will expire."*

**cPanel is being decommissioned, so its credentials die with it.** Rotating a credential for a host
that is being switched off is work that buys nothing — the host, not the credential, is the thing
being retired. The five minutes are better spent on §2.

**Where they live, and what that means:** `CPANEL_PASSWORD` and `CPANEL_API_TOKEN` are in **this
checkout's `.env.local`**, **not** in `/opt/ozituma/.env` on the host. `docs/OZIKORO-ROUND-340-BACKEND.md`
records them as *"not read by the app at all — these are for the WordPress extraction, run by hand."*
So no application is holding them and no deploy depends on them.

#### The residual risk, stated honestly — this has a real shape

**Until cPanel is actually closed, the exposed `CPANEL_PASSWORD` is full control of a host that still
answers for `ozikoro.com`.** That host is at `162.213.253.73` and **the zone's apex still points at
it** (`AGENTS.md`: 27 records → cPanel, proxied). The window is open **until the cutover happens or
the account is closed, whichever comes first.** That is a fact to record, not a task to perform.

**And it has no end date, which is the part worth being uncomfortable about.** *"When the cutover
completes"* is not a date — **the cutover is presently blocked** (the host pulls from a commit this
checkout cannot resolve, and runs a compose file this checkout has never seen). **So this window is
open indefinitely, and "it will expire" is a plan rather than a fact.**

#### The one thing to confirm at decommission time

> ⚠️ **That the cPanel account is actually CLOSED, not merely abandoned.**
>
> **An abandoned account with a live password is not a retired account.** Letting the subscription
> lapse leaves the credentials valid until someone else takes the hostname or the machine. Closing
> the account is what kills the credential; the expiry date is administrative tidiness.

**So there is one line to add to the cutover's completion checklist:** *suspend or delete the cPanel
account, and confirm the login no longer answers.* Until then, do not delete this section — a reader
who finds a rotation runbook with no mention of the disclosed cPanel password will assume it was
forgotten.

---

## 8. Anything else, and the escape hatch

For a name that is not in the table above, the script has a general path — **but it has no automated
proof**, so it **refuses to run until you say you have checked the new value yourself:**

```bash
node scripts/rotate-credential.mjs secret SOME_VARIABLE_NAME --i-have-checked
```

**An unproven rotation that LOOKS verified is the worst outcome available here** — it is a change that
reports success without having tested anything. That is why the flag exists and why it must not be
passed casually.

**Candidate names**, from the `AGENTS.md` incident table and the host inventory — check each against
the host's *names* before treating it as live:

| name | where it would live | note |
|---|---|---|
| `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_TOKEN_KEY` | host `.env` (may be absent) | Spotify ingest. Absence turns the feature off, not broken |
| `ELEVENLABS_API_KEY` | host `.env` (may be absent) | Spoken records |
| `HEALTH_TOKEN` | host `.env` (may be absent) | Enables `/api/health`'s detailed branch |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | host `.env` | **These are the `ozikoro` AWS profile**, separate from the R2 keys. If they exist on the host, rotate them through AWS IAM, not here |
| `OZITUMA_ZOHO_KEY` | **nowhere in the code** | Stale name in `AGENTS.md`. See §4.0 |
| `DATABASE_URL` | host `.env` | **Not a credential of its own** — it is built by compose from `POSTGRES_PASSWORD`. Rotating that is §6 and only §6 |

**Delete the old value from the issuer, then confirm the old value fails.** The pattern is the same
for every one of them, and the confirmation is the part that makes it true.

---

## 9. After each rotation

1. **Keep the backup** until the new value has been in use for a few days. Then remove it — it is a
   file full of secrets:
   ```bash
   shred -u /root/.ozituma-credential-backups/.env.<the-one-you-are-done-with>.bak
   ```
2. **Confirm the site**: `curl -s -o /dev/null -w '%{http_code}\n' https://ozituma.com/` → `200`.
3. **Revoke the old credential at the issuer** and **probe for the expected failure** (§2.6, §3.6,
   §4.5, §5.1, §5.2, §6.6). *A rotation that leaves the old key active has changed nothing an
   attacker cares about.*
4. **Write down what you did** — which credential, when, and that the old value failed afterwards.
   The date matters: it is how the next person knows when this is due again.

---

## 10. The rule this work came from, and the check that keeps it

**`AGENTS.md`: read a secret's NAME, never its VALUE.** The commands that answer *"what is
configured"* without answering *"what is the secret"*:

```bash
grep -oE '^[A-Z_]+=' /opt/ozituma/.env        # names only
docker compose config --environment            # names only, from compose
systemctl show -p Environment <unit>           # names only
```

### 10.1 ⚠️ `docker compose config` — the one that CAN leak, and where

**`docker compose config` RESOLVES `${VAR}` interpolation and prints the resolved values.** Ran bare,
it is a documented command that dumps every secret in the file.

**Where it appears in this repository — and it is already filtered:**

`docs/OZIKORO-CUTOVER.md` line **297**:

```bash
# 1. compose resolves the interpolation for the caddy service, and reports the value it will use
docker compose -f /opt/ozituma/app/docker/docker-compose.prod.yml config | \
  sed -n '/^  caddy:/,/^  [a-z]/p' | grep -E 'OZIKORO_DOMAIN|OZITUMA_DOMAIN'
```

**This is filtered, and the filter is an allow-list rather than a deny-list.** The `config` output is
piped through `sed` to keep only the `caddy` service block, then through `grep -E` for **exactly two
names** — `OZIKORO_DOMAIN` and `OZITUMA_DOMAIN`. Both are **public hostnames**, not secrets:
`OZIKORO_DOMAIN=ozikoro.com` is in `.env.example` in the clear. The pipeline cannot emit
`S3_SECRET_ACCESS_KEY` or `POSTGRES_PASSWORD`, because neither name matches that `grep`. **It was
already filtered. Nothing needed fixing, and this is reported as found rather than as a fix.**

**The rest of the repository was checked for the same fault:**

| check | result |
|---|---|
| Composed `docker compose config` anywhere else | **none.** The other two mentions — `docs/OZIKORO-ROUND-340-BACKEND.md` lines 121 and 360, and `docs/OZIKORO-CUTOVER-AND-ROLLBACK.md` line 277 — are **prose about the command, not commands**. No shell block pipes an unfiltered `config` anywhere |
| A script that dumps the environment (`printenv`, bare `env`, `set -x`) | **none** in `scripts/` or `tools/` |
| A doc command that cats the host's env (`cat /opt/ozituma/.env`, `source …`) | **none** in `docs/` or `scripts/` |
| `docker compose config --environment` | appears **once**, in `AGENTS.md`, as the *recommended* names-only form. Correct as written |
| `scripts/check-compose-env.mjs` | parses the compose file and **reports by NAME**; it prints, in its own words, *"No docker daemon here, so this parses the two files and reports by NAME. Values are never printed."* Verified against its output code: it prints names and verdicts, never resolved values |

**The lesson worth carrying:** the dangerous form is the bare one. **If you ever need
`docker compose config`, pipe it through a `grep` for the exact names you want** — an allow-list, as
line 297 does. A deny-list (`grep -v SECRET`) fails open the moment a new secret is added to the file.

### 10.2 The check that keeps the rule

`npm run check:secrets` (`scripts/check-secrets.sh`) runs on the pre-commit hook. It refuses a tracked
`.env`, refuses credential-shaped text (`AKIA…`, `ghp_…`, `sk-…`, private-key headers), refuses a
secret assigned a literal, and refuses an untracked `.env` one `git add -A` away from being committed.
It **self-tests its own detector first**, because a pattern that cannot match reports every repository
clean.

**It must pass. If it fails, the commit does not happen, and that is the point.**

---

## 11. Quick reference

| # | credential | issuer | script argument | proof | old value must now | time |
|---|---|---|---|---|---|---|
| 1 | `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Cloudflare → R2 → API Tokens | `s3` | signed `HEAD` → 200 | `403` | 10 min |
| 2 | `GITHUB_TOKEN` | GitHub → Settings → Developer settings | `github` (if a host copy exists) | `GET /user` → 200 + scope | `401` | 8 min |
| 3 | `OZITUMA_SMTP_PASSWORD` | the mailbox's provider (Zoho per `AGENTS.md`) | `smtp` | authenticated handshake | login refused (`535`) | 15 min |
| 4 | `RESEND_API_KEY` *(if present)* | Resend → API keys | `resend` | `GET /domains` → 200 | `401` | 8 min |
| 5 | `PAYSTACK_SECRET_KEY` | Paystack → Settings → API Keys & Webhooks | `paystack` | `GET /transaction` → 200 + mode | `401` | 12 min |
| 5 | `NOWPAYMENTS_API_KEY` | NOWPayments → Account → API keys | `nowpayments` | `GET /v1/status` → 200 + mode | `401` | 13 min |
| 6 | `POSTGRES_PASSWORD` | **you choose it** | `postgres` | `SELECT 1` via the app's path | auth fails | 30 min |
| — | `NOWPAYMENTS_IPN_SECRET` | NOWPayments dashboard | `secret … --i-have-checked` | a real webhook lands | `401` on old signature | 10 min |
| — | `CPANEL_PASSWORD`, `CPANEL_API_TOKEN` | *(in the checkout's `.env.local`)* | **NOT ROTATED** — see §7 | — | account closed at decommission | — |

**Do them in the numbered order.** Steps 1, 2 and 3 are the highest value and the least entangled.
Step 6 is last because it is the only one that can take the site down if the sequence slips.
