#!/usr/bin/env bash
#
# Is any credential committed?
#
# WHY THIS IS STANDING RATHER THAN DONE ONCE
#
# The question was answered by hand once and answered correctly. That is not the same as being guarded: a
# single `git add -A` after a local experiment puts a `.env` in the history, and nothing here would have
# noticed. Round 46's lesson — a check that lives in someone's memory is a check that reverts.
#
# It also guards the INVERSE, which is easier to get wrong: `.env.example` must exist and must list every
# variable the application reads. An example file that has drifted is how a deployment fails at two in the
# morning, and a missing one is how a new contributor hardcodes a secret to get moving.
#
# Offline: it reads the git index and the tracked files only. Nothing running, nothing unlocked.
set -uo pipefail

cd "$(git rev-parse --show-toplevel)" || exit 2

failed=0

# 1. No real environment file may be tracked. `.env.example` is the opposite of a leak and is required.
REAL_ENV=$(git ls-files | grep -E '(^|/)\.env($|\.)' | grep -v '\.env\.example$' || true)
if [ -n "$REAL_ENV" ]; then
  echo "  TRACKED ENVIRONMENT FILE(S) — these must never be committed:" >&2
  printf '    %s\n' $REAL_ENV >&2
  failed=$((failed + 1))
else
  echo "  PASS  no environment file is tracked"
fi

# 2. Credential shapes, anywhere in tracked files. The DATABASE_URL lines in this repo are placeholders
#    (`ozituma:ozituma@localhost`) and a `${POSTGRES_PASSWORD}` interpolation, so the pattern deliberately
#    targets real credential material rather than any URL with an @ in it.
PATTERNS='AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY|sk-[A-Za-z0-9]{24,}|ghp_[A-Za-z0-9]{30,}|xox[baprs]-[A-Za-z0-9-]{10,}'
HITS=$(git grep -nIE "$PATTERNS" -- . 2>/dev/null || true)
if [ -n "$HITS" ]; then
  echo "  CREDENTIAL-SHAPED TEXT IN TRACKED FILES:" >&2
  printf '    %s\n' "$HITS" >&2
  failed=$((failed + 1))
else
  echo "  PASS  no credential-shaped text in tracked files"
fi

# 3. A secret assigned a literal, as opposed to read from the environment. The names come from the
#    application's own configuration surface.
ASSIGNED=$(git grep -nIE '(SPOTIFY_CLIENT_SECRET|HEALTH_TOKEN|S3_SECRET_ACCESS_KEY|AWS_SECRET_ACCESS_KEY)[[:space:]]*[:=][[:space:]]*["'"'"'][^"'"'"'$]{8,}' -- . 2>/dev/null || true)
if [ -n "$ASSIGNED" ]; then
  echo "  SECRET ASSIGNED A LITERAL VALUE:" >&2
  printf '    %s\n' "$ASSIGNED" >&2
  failed=$((failed + 1))
else
  echo "  PASS  no secret is assigned a literal value"
fi

# 4. UNTRACKED files. This is the gap round 92 found: `git grep` reads the INDEX, so a stray `.env` sitting
#    in the working tree — the exact thing a later `git add -A` would commit — is invisible to checks 1-3.
#    It was discovered while committing apps/web, whose 214 new files had never been scanned by anything.
UNTRACKED_ENV=$(git ls-files --others --exclude-standard | grep -E '(^|/)\.env($|\.)' | grep -v '\.env\.example$' || true)
if [ -n "$UNTRACKED_ENV" ]; then
  echo "  UNTRACKED ENVIRONMENT FILE(S) — one 'git add -A' away from being committed:" >&2
  printf '    %s\n' $UNTRACKED_ENV >&2
  failed=$((failed + 1))
else
  echo "  PASS  no untracked environment file"
fi

UNTRACKED_HITS=$(git ls-files --others --exclude-standard | while IFS= read -r f; do
  # Skip anything large or binary: these are source trees, and the archive export is 190MB of JSON.
  [ -f "$f" ] || continue
  [ "$(wc -c < "$f" 2>/dev/null || echo 0)" -gt 2000000 ] && continue
  grep -lIE 'AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY|sk-[A-Za-z0-9]{24,}|ghp_[A-Za-z0-9]{30,}' "$f" 2>/dev/null || true
done || true)
if [ -n "$UNTRACKED_HITS" ]; then
  echo "  CREDENTIAL-SHAPED TEXT IN UNTRACKED FILES:" >&2
  printf '    %s\n' "$UNTRACKED_HITS" >&2
  failed=$((failed + 1))
else
  echo "  PASS  no credential-shaped text in untracked files"
fi

# 5. The example file must exist, or a new contributor has no list to work from.
if [ -f .env.example ]; then
  echo "  PASS  .env.example exists ($(grep -cE '^[A-Z_]+=' .env.example) variables listed)"
else
  echo "  .env.example is MISSING — the variable list lives nowhere." >&2
  failed=$((failed + 1))
fi

echo ""
if [ "$failed" -eq 0 ]; then
  echo "  All secret checks passed."
else
  echo "  $failed secret check(s) FAILED."
fi
echo ""
exit $((failed > 0))
