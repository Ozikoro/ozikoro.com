# `media.ozikoro.com` — what was checked, what was NOT changed, and the exact calls

**Status: NOT CREATED. Nothing was written to any Cloudflare zone.** This file exists so the record says
what was verified, what was deliberately left alone, and the one sequence that would finish the job.

---

## 1. What was checked first, and why nothing was overwritten

The concern going in was that `media.ozikoro.com` might already exist as a `CNAME → public.r2.dev`
serving the **dictionary's** audio, and that overwriting it would break ozituma.com. **It was checked
before anything else, and that concern turned out to be a zone confusion.**

Read-only evidence, all `GET`:

```bash
TOK=$(grep -m1 '^CLOUDFLARE_API_TOKEN=' ~/Projects/Aku/.env | cut -d= -f2- | tr -d '"'"'"' \r\n')

# Which zones the token can see — five, all active.
curl -s -H "Authorization: Bearer $TOK" \
  "https://api.cloudflare.com/client/v4/zones?per_page=50"
#   ezeme.org · idenze.com · omapolo.com · ozikoro.com · ozituma.com

# ozikoro.com — 35 records. NO record named `media`. NO wildcard.
curl -s -H "Authorization: Bearer $TOK" \
  "https://api.cloudflare.com/client/v4/zones/1ebe8c1f9ce3dcec95448b6d93d63e00/dns_records?per_page=100"

# ozituma.com — the `media` record lives HERE, not in the ozikoro zone.
curl -s -H "Authorization: Bearer $TOK" \
  "https://api.cloudflare.com/client/v4/zones/8d5c9e827bdfe35b236d8a3dc218df5e/dns_records?per_page=100"
```

### The result

| | |
|---|---|
| `media.ozikoro.com` | **does not exist** — no record, no wildcard, `dig` empty, `https` returns `000` |
| `media.ozituma.com` | **exists and is untouched**: `CNAME → public.r2.dev`, `proxied: true`, `id: 614f661f5a911ee947c3023383bd015a` |
| ozikoro.com apex | `A → 162.213.253.73`, proxied (the archive's cPanel host) |
| ozikoro.com zone id | `1ebe8c1f9ce3dcec95448b6d93d63e00` |
| ozituma.com zone id | `8d5c9e827bdfe35b236d8a3dc218df5e` |

**`media.ozikoro.com` is free, and the dictionary's hostname needed no protection because it is in a
different zone.** Breaking ozituma's recordings to save one DNS entry would have been the worst trade
available; it was not made, and nothing was modified.

---

## 2. Why no record was created

**The correct record cannot be verified today, because this machine has no public ingress.**

* it sits behind a dynamic NAT address — `102.90.126.152` at the time of writing, an MTN Nigeria mobile
  range (`102.90.124.0/22`) that moves;
* **`cloudflared` is not installed** (`which cloudflared` → empty) and `~/.cloudflared/` does not exist;
* no tunnel configuration exists anywhere in this checkout.

Any record that could be created today would be one of three wrong things:

| if it were recorded as | it would serve |
|---|---|
| grey-clouded to a private address | nothing reachable |
| orange-clouded with no origin | **HTTP 522** on a hostname the owner believes is live |
| pointed at `162.213.253.73` | the archive's cPanel — a public promise this service does not keep |

**A DNS record is not a deployment.** It is a promise that a hostname serves something, and every option
above breaks that promise at the exact moment somebody tries it. So the calls are written down here and
were not run.

---

## 3. The exact sequence that finishes the job

A service on a laptop behind NAT is reachable through a **Cloudflare Tunnel**, which is the right shape for
this: the tunnel dials out, so no port-forward and no static address is needed, and the hostname stays the
permanent one the podcast enclosures depend on.

### Step 1 — install `cloudflared` (not done; no Homebrew on this machine)

```bash
brew install cloudflared
# or, without Homebrew:
curl -L -o /usr/local/bin/cloudflared \
  https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz
```

### Step 2 — authenticate (interactive; opens a browser and writes `~/.cloudflared/cert.pem`)

```bash
cloudflared tunnel login
```

### Step 3 — create the tunnel, and note its UUID

```bash
cloudflared tunnel create ozikoro-media
# -> Created tunnel ozikoro-media with id <TUNNEL-UUID>
```

### Step 4 — the DNS record

`cloudflared` does this for you, and it is preferred because it reads the UUID it just created:

```bash
cloudflared tunnel route dns ozikoro-media media.ozikoro.com
```

**The equivalent raw API call**, if the record is to be made by hand — **`<TUNNEL-UUID>` must be replaced
with the real UUID from step 3. This call was NOT run.**

```bash
TOK=$(grep -m1 '^CLOUDFLARE_API_TOKEN=' ~/Projects/Aku/.env | cut -d= -f2- | tr -d '"'"'"' \r\n')

curl -s -X POST \
  -H "Authorization: Bearer $TOK" \
  -H "content-type: application/json" \
  "https://api.cloudflare.com/client/v4/zones/1ebe8c1f9ce3dcec95448b6d93d63e00/dns_records" \
  --data '{
    "type": "CNAME",
    "name": "media",
    "content": "<TUNNEL-UUID>.cfargotunnel.com",
    "proxied": true,
    "ttl": 1,
    "comment": "Ozikoro Media TTS service - Cloudflare Tunnel to the render host"
  }'
```

The record **must not be created before step 3**, because its content is the tunnel's UUID. A record
pointing at a UUID that does not exist resolves and then fails to connect.

### Step 5 — run the tunnel against this service

```bash
# terminal 1
npm -w @ozikoro/media start                     # http://127.0.0.1:8787

# terminal 2
cloudflared tunnel run --url http://127.0.0.1:8787 ozikoro-media
```

Then verify — **and this is the verification that was impossible to perform today**:

```bash
curl -s https://media.ozikoro.com/health | head -30
curl -s -X POST https://media.ozikoro.com/speak \
  -H 'content-type: application/json' \
  -d '{"text":"Ndeewo.","voice":"own","engine":"local"}' -o /tmp/check.wav
```

### Step 6 — make it survive a reboot

```bash
sudo cloudflared service install          # reads ~/.cloudflared/ and the tunnel config
```

---

## 4. The permission to re-check without writing anything

`AGENTS.md` records that `/user/tokens/verify` reports *"Invalid API Token"* for this zone-scoped token, and
that `/zones` succeeding is the real test — confirmed again here. To re-check DNS:Edit **without writing**,
post an empty body: a token with edit rights returns error `9000` (*"DNS name is invalid"*, which is content
validation) while a token without returns `403`/`9109`.

**Do not** point `media.ozikoro.com` at `162.213.253.73`. That host serves ozikoro.com's archive from
cPanel, and this service is not deployed there.

---

## 5. The hostname decision, recorded

Audio is bytes rather than documents: it wants its own cache and its own scaling. But the decisive reason
for a **subdomain** rather than a path is that **if audio ever moves hosts, Spotify feed enclosures break
for every subscriber.** An enclosure URL is a promise held by a listener's podcast app, and it can only be
kept if the hostname outlives the infrastructure behind it. **Choose the hostname once; make it permanent.**
