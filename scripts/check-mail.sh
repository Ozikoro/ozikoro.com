#!/usr/bin/env bash
#
# Would the password-reset link actually leave this machine, and from a domain Resend will accept?
#
# WHY THIS IS A CHECK AND NOT A SENTENCE IN A README
#
# The recovery flow's only outbound act is one message, and every way it fails is silent from inside the
# site: an unset key, a sender on a domain the provider will not send from, a domain whose DKIM records
# were removed. The person waiting is locked out, the reader sees "if that address has an account here" —
# which is the correct answer and therefore tells nobody anything — and the only trace is a line in a log
# on a server. **A configuration this consequential should fail where somebody is looking.**
#
# IT ALSO GUARDS A COMMENT, WHICH IS THE PART THAT WENT WRONG.
#
# `mail.ts` and `.env.example` both used to state that ozikoro.com was not verified with Resend. That was
# true when it was written and was false within days, and nothing noticed because nothing re-read the
# API. This check does, so the comment and the world cannot drift apart again unnoticed.
#
# WHAT IT DOES NOT DO: prove delivery to an inbox. It proves the provider ACCEPTED the message, which is
# its own boundary. Use `--send=<address>` for that, and look in the inbox.
#
# Usage:
#   bash scripts/check-mail.sh
#   bash scripts/check-mail.sh --send=someone@example.org
set -uo pipefail

cd "$(git rev-parse --show-toplevel)" || exit 2

ENV_FILE=apps/ozikoro/.env.local
TARGET="${1:-}"

# The only argument accepted is `--send=<address>`, passed straight through to `mail-test.ts`. Anything
# else is refused here rather than half-understood: a check that silently ignores what it was told is a
# check that reports on the wrong thing.
if [ -n "$TARGET" ] && [ "${TARGET#--send=}" = "$TARGET" ]; then
  echo "  unknown argument \"$TARGET\" — usage: bash scripts/check-mail.sh [--send=<address>]" >&2
  exit 2
fi

# `--env-file` only when the file is there. Expanded unquoted, deliberately: an empty value has to vanish
# rather than become an argument. The path has no spaces, so nothing is lost in the splitting.
NODE_ENV_FILE=""
[ -f "$ENV_FILE" ] && NODE_ENV_FILE="--env-file=$ENV_FILE"

echo ""
echo "  Checking that mail can leave this machine"

# ---------------------------------------------------------------------------------------------
# 1. What the application itself thinks.
# ---------------------------------------------------------------------------------------------
REPORT=$(node $NODE_ENV_FILE --input-type=module -e '
const m = await import("./packages/core/src/mail.ts");
const s = m.mailStatus();
console.log("configured=" + (s.configured ? "yes" : "no"));
console.log("transport=" + (s.transport ?? ""));
console.log("from=" + (s.from ?? ""));
console.log("reason=" + (s.reason ?? ""));
' 2>/dev/null) || {
  echo "  mailStatus() could not be read at all — the mail client did not load. Not a pass." >&2
  exit 2
}

pick() { printf '%s\n' "$REPORT" | sed -n "s/^$1=//p" | head -1; }

CONFIGURED=$(pick configured)
TRANSPORT=$(pick transport)
FROM=$(pick from)
REASON=$(pick reason)

if [ -z "$CONFIGURED" ]; then
  echo "  mailStatus() printed nothing useful — the extractor is wrong, not the machine. Not a pass." >&2
  exit 2
fi

echo "  transport: ${TRANSPORT:-(none)}"
echo "  from:      ${FROM:-(none)}"

if [ "$CONFIGURED" != "yes" ]; then
  echo ""
  echo "  NOT CONFIGURED — $REASON" >&2
  echo "  A reset request would be recorded and no link would reach anybody." >&2
  echo "" >&2
  exit 1
fi

# ---------------------------------------------------------------------------------------------
# 2. Is the sender on a domain Resend will send from?
#
# Only asked of the Resend transport. For SMTP or SES the question belongs to that provider and this
# check says so rather than inventing a verdict it cannot support.
# ---------------------------------------------------------------------------------------------
if [ "$TRANSPORT" != "resend" ]; then
  echo ""
  echo "  Transport is $TRANSPORT, so Resend's domain list is not what decides. Skipping the domain check."
  echo "  Send one real message to confirm delivery:  bash scripts/check-mail.sh --send=<address>"
  echo ""
  exit 0
fi

FROM_DOMAIN=$(printf '%s' "$FROM" | sed -n 's/.*@\([^ >]*\).*/\1/p')
if [ -z "$FROM_DOMAIN" ]; then
  echo "  the From address has no domain this check can read: \"$FROM\"" >&2
  exit 1
fi
echo "  sender domain: $FROM_DOMAIN"

KEY=$(sed -n 's/^RESEND_API_KEY=//p' "$ENV_FILE" 2>/dev/null | tr -d '"'"'"'' | head -1)
if [ -z "$KEY" ]; then
  echo "  configured for Resend but no RESEND_API_KEY in $ENV_FILE — cannot verify the domain." >&2
  exit 2
fi

DOMAINS_FILE=$(mktemp)
CODE=$(curl -s -o "$DOMAINS_FILE" -w '%{http_code}' --max-time 30 \
  -H "Authorization: Bearer $KEY" https://api.resend.com/domains)
DOMAINS=$(cat "$DOMAINS_FILE")

# `000` is curl reporting NO RESPONSE, not a refusal. The convention in this repository's checks is to
# retry once before believing it; a single dropped request reported as a failure is a false alarm that
# teaches people to ignore the check.
if [ "$CODE" = "000" ] || [ -z "$DOMAINS" ]; then
  sleep 1
  CODE=$(curl -s -o "$DOMAINS_FILE" -w '%{http_code}' --max-time 45 \
    -H "Authorization: Bearer $KEY" https://api.resend.com/domains)
  DOMAINS=$(cat "$DOMAINS_FILE")
fi
rm -f "$DOMAINS_FILE"

if [ "$CODE" != "200" ]; then
  echo "  Resend answered $CODE for its domain list — the key or the network is the problem, not the sender." >&2
  exit 2
fi

# The comparator is proved against a domain that CANNOT be in the list, in the same pass that answers the
# real question. "Nothing matched" reads exactly like success, so a comparison that can never match would
# otherwise pass for ever — the self-test rule this repository applies to every detector.
VERDICT=$(printf '%s' "$DOMAINS" | python3 -c '
import json, sys
domain = sys.argv[1]
try:
    payload = json.loads(sys.stdin.read())
except Exception as exc:
    print("UNREADABLE " + str(exc))
    raise SystemExit(2)
rows = payload.get("data") or []
sending = sorted(r.get("name") for r in rows if (r.get("capabilities") or {}).get("sending") == "enabled")
print("SENDING " + ",".join(sending))
print("FOUND yes" if domain in sending else "FOUND no")
print("DETECTOR broken" if "example.invalid" in sending else "DETECTOR ok")
' "$FROM_DOMAIN")

echo "  Resend will send from: $(printf '%s\n' "$VERDICT" | sed -n 's/^SENDING //p')"

if printf '%s\n' "$VERDICT" | grep -q '^DETECTOR broken'; then
  echo "  DETECTOR IS BROKEN — a domain that cannot exist was reported as sendable. Not a pass." >&2
  exit 2
fi
if printf '%s\n' "$VERDICT" | grep -q '^UNREADABLE'; then
  echo "  Resend's answer could not be read as JSON — refusing to call that a pass." >&2
  exit 2
fi

if ! printf '%s\n' "$VERDICT" | grep -q '^FOUND yes'; then
  echo "" >&2
  echo "  THE SENDER IS NOT ON A DOMAIN RESEND WILL SEND FROM." >&2
  echo "  Every reset message would be refused, and the person waiting would never be told." >&2
  echo "  Set OZIKORO_MAIL_FROM to an address on one of the domains listed above." >&2
  echo "" >&2
  exit 1
fi

echo "  PASS  $FROM_DOMAIN is a domain Resend sends from"

# ---------------------------------------------------------------------------------------------
# 3. Optionally prove it end to end.
# ---------------------------------------------------------------------------------------------
if [ -n "$TARGET" ]; then
  echo ""
  node $NODE_ENV_FILE scripts/mail-test.ts "$TARGET"
  exit $?
fi

echo ""
echo "  Accepted configuration. Nothing was sent; pass --send=<address> to send one real message."
echo ""
exit 0
