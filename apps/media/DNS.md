# `media.ozikoro.com` — created, and how

**Status: CREATED AND SERVING, 4 October 2026.** `media.ozikoro.com` is a `CNAME` to
`9f050fdf-0c19-4260-ac5b-d2f47a10677b.cfargotunnel.com`, proxied, and the tunnel `ozikoro-media` runs on the
render host and dials out. `curl https://media.ozikoro.com/health` answers **200** from the Cloudflare edge.

**The obstacle recorded below was an assumption and it is now disproved, in three parts:**

1. **`brew` is genuinely absent, and `cloudflared` installs anyway.** The direct binary download the file
   already named works: `cloudflared-darwin-amd64.tgz`, 21,740,193 bytes, `cloudflared version 2026.9.3`.
   **No Homebrew is needed** — the file offered the fallback and the fallback is the one that works.
2. **`cloudflared tunnel login` is not needed either, and that was the real blocker.** Login is interactive
   and wants a browser session in the owner's Cloudflare dashboard, so it looked like a dead end. It is not
   required: the shared token **already carries Cloudflare Tunnel: Edit on the account**, so the tunnel is
   created through the API, its token fetched, and the connector run with `--token`. Verified by doing it.
3. **The dynamic MTN Nigeria address is irrelevant, which is the whole point of a tunnel.** The connector
   dialled out from `102.90.126.152` — the exact address this file cited as the reason it could not work —
   and the tunnel reports **healthy with four connections**.

The original reasoning is kept below, because it was right about the *record* and wrong about the *machine*:
the record must not be created before the tunnel exists, and it was not.

**Two facts that bear on whether the hostname was worth creating, recorded here rather than buried.** The
local model's weights are `CC-BY-NC-4.0` — non-commercial — so the local engine is a draft-and-compare tool
and ElevenLabs carries the public archive; and **the service renders at 105–144× real time on this CPU**
(`/engines` and the README carry the measurements). Both are true and neither changes the answer to the DNS
question, because a hostname is a name rather than a promise about speed — but see §7, which is the one place
where the speed does bite.

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

## 2. Why no record was created THEN — the reasoning, kept because it was right about the record

**The correct record cannot be verified without a tunnel, and there was none.**

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

### Step 1 — install `cloudflared` (DONE — the no-Homebrew fallback, and it works)

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

**What was actually done instead of steps 2 and 3**, because `login` is interactive and the token carries
Tunnel: Edit on the account anyway:

```bash
# create the tunnel (this replaced `cloudflared tunnel login` + `cloudflared tunnel create`)
curl -s -X POST -H "Authorization: Bearer $TOK" -H 'content-type: application/json' \
  "https://api.cloudflare.com/client/v4/accounts/$ACCT/cfd_tunnel" \
  --data '{"name":"ozikoro-media","config_src":"cloudflare"}'
#   -> id 9f050fdf-0c19-4260-ac5b-d2f47a10677b

# the remotely-managed ingress, so the connector needs no config file
curl -s -X PUT -H "Authorization: Bearer $TOK" -H 'content-type: application/json' \
  "https://api.cloudflare.com/client/v4/accounts/$ACCT/cfd_tunnel/$TUN/configurations" \
  --data '{"config":{"ingress":[{"hostname":"media.ozikoro.com","service":"http://127.0.0.1:8787"},{"service":"http_status:404"}]}}'

# fetch the connector token, write it 0600, and run — never printed, never committed
curl -s -H "Authorization: Bearer $TOK" \
  "https://api.cloudflare.com/client/v4/accounts/$ACCT/cfd_tunnel/$TUN/token"
.tools/bin/cloudflared tunnel --no-autoupdate run \
  --token "$(cat .data/scratch-r322/tunnel-token)" 9f050fdf-0c19-4260-ac5b-d2f47a10677b
```

**`cloudflared` must be given the tunnel as a positional argument in this version** (2026.9.3): `run --token
<TOKEN>` alone exits 255 with *"requires the ID or name of the tunnel to run as the last command line
argument"*, and `--no-autoupdate` placed before `run` alongside `--token` produced a confusing
*"client didn't specify origincert path"*. The form above is the one that connects.

**The equivalent raw API call for the record itself**, with the real UUID in place:

```bash
TOK=$(grep -m1 '^CLOUDFLARE_API_TOKEN=' ~/Projects/Aku/.env | cut -d= -f2- | tr -d '"'"'"' \r\n')

curl -s -X POST \
  -H "Authorization: Bearer $TOK" \
  -H "content-type: application/json" \
  "https://api.cloudflare.com/client/v4/zones/1ebe8c1f9ce3dcec95448b6d93d63e00/dns_records" \
  --data '{
    "type": "CNAME",
    "name": "media",
    "content": "9f050fdf-0c19-4260-ac5b-d2f47a10677b.cfargotunnel.com",
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

---

## 6. What was verified, and one thing that does NOT work

**Done and measured on 4 October 2026:**

```
  cloudflared version                  2026.9.3 (built 2026-09-24), .tools/bin/cloudflared
  tunnel ozikoro-media                 healthy, 4 connections, origin 102.90.126.152
  dig media.ozikoro.com                resolves (Cloudflare anycast, proxied)
  curl https://media.ozikoro.com/health
                                       200, {"ok":true,"service":"ozikoro-media",...}
  POST /preview/pronunciation          a computed answer: `aha` reported AMBIGUOUS,
                                       `ndeewo` reported unknown, `bụ`/`dị` found by diacritic
  the ozikoro.com zone                 36 records, was 35; the apex still 162.213.253.73
  media.ozituma.com                    untouched — same id 614f661f5a911ee947c3023383bd015a,
                                       still CNAME public.r2.dev
```

**— and a real render does NOT complete over the public hostname at this machine's speed.**

```
  POST https://media.ozikoro.com/speak  {"text":"Ndeewo.","voice":"proof-say","engine":"local"}
    -> HTTP 524 after 125 s   (Cloudflare's own proxy timeout; the render was still running)
  POST http://127.0.0.1:8787/speak       same body, same service, no proxy in the way
    -> 503 busy while the abandoned render still held the engine, by design
```

Seven characters. The service renders at **105–144× real time on this CPU** (measured: 1.291 s of audio in
135.6 s; 2.123 s in 305.8 s), so a synchronous render cannot answer inside Cloudflare's ~100 s ceiling — and a
fourteen-minute article would need about 24 hours. **This is not a DNS fault and it is not a tunnel fault: the
hostname serves, and `/health`, `/engines`, `/voices` and `/preview/pronunciation` all work over it.** What
the public hostname cannot yet carry is a `POST /speak` that renders on demand. The candidates, none of them
DNS: a GPU host, a smaller model, an asynchronous job with a poll, or a raised proxy timeout. `POST /speak`
already returns the provenance in headers and would need a job id rather than audio bytes for the async shape.

**Recorded rather than hidden, because a hostname that answers a health check and cannot render is exactly the
kind of "working" this project keeps refusing to accept.**

---

## 7. The decision this hands back

The subdomain was the right call and it is now permanent, so no enclosure URL will ever have to move. But
**creating it did not make narration possible**: the licence (see `README.md`) says the local engine's weights
are non-commercial, and the speed says a CPU cannot serve renders on demand. Both are the owner's decisions and
both are now stated with numbers instead of being folded into "no public ingress".
