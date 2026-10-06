#!/bin/sh
#
# Enforce the REMOTE retention policy for the archive's encrypted dumps in R2.
#
# ── WHY THIS EXISTS AS A HOST JOB WHEN THE DESIGN ALREADY HAS A REMOTE-RETENTION LEG ────────────
#
# `docker/docker-compose.ozikoro.yml`'s `backup-upload` service is supposed to do this itself, in a
# block that computes a cutoff and deletes objects older than `BACKUP_REMOTE_RETENTION_DAYS`:
#
#     cutoff=$$(date -u -d "$$REMOTE_DAYS days ago" +%Y-%m-%dT%H-%M-%SZ 2>/dev/null || echo "")
#     if [ -n "$$cutoff" ]; then ... delete older ... else
#       echo "upload: remote retention skipped — this image's date cannot compute 'days ago'"
#
# **That leg has never once run, and the `|| echo ""` is why it failed silently.** Measured on the
# host, 2026-10-06, inside the very image the service runs:
#
#     $ docker run --rm ozituma-backup-tools:latest date -u -d "45 days ago" +%Y-%m-%dT%H-%M-%SZ
#     date: invalid date '45 days ago'
#     $ date --help          # BusyBox v1.37.0 — `-d` takes only @epoch, hh:mm, YYYY.MM.DD-hh:mm
#
# `docker-compose.ozikoro.yml`'s log line was seen saying exactly this on the first pass:
#
#     upload-1  | upload: remote retention skipped — this image's date cannot compute 'days ago'
#
# So the dumps accumulate in R2 for ever, and the retention policy stated in the compose file and in
# `docs/OZIKORO-BACKUP-AND-ROLLBACK.md` would be a claim nothing enforces. **A retention policy that
# only exists in a comment is not a policy.**
#
# ── WHY THIS IS A HOST JOB AND NOT AN EDIT TO THE COMPOSE FILE ──────────────────────────────────
#
# Because the instruction for this round is explicit — *do not touch the compose files* — and that
# instruction is right for its own reason (the host's `docker-compose.prod.yml` and this checkout's
# are different files, and shipping one for the other would make a deploy build an academy whose
# source is not on that machine). The host has GNU coreutils 8.32:
#
#     $ date -u -d "45 days ago" +%Y-%m-%dT%H-%M-%SZ
#     2026-08-22T03-58-41Z                       # exit 0
#
# so the same rule can be enforced from outside the container with no image change and no compose
# change. If the compose line is ever fixed at source, this job becomes a harmless second pass over
# the same prefix with the same cutoff — it is idempotent, and two enforcers of one rule that agree
# are not a conflict.
#
# ── WHAT IT MAY TOUCH, WHICH IS DELIBERATELY ALMOST NOTHING ─────────────────────────────────────
#
# The bucket it writes to is `ozituma-media`, which is SHARED: it holds the dictionary's `audio/` and
# the archive's `ozikoro/`, 75,462 objects and about 8.4 GB. So:
#
#   * the prefix must begin `backups/` or the script refuses to run at all — the same guard the
#     compose uploader makes, for the same reason;
#   * only keys matching exactly `backups/ozituma/ozituma-<stamp>.dump.age` are ever considered, so
#     a key under `audio/` or `ozikoro/` cannot be reached by any input;
#   * a key whose timestamp is not the exact 16-character stamp shape is skipped rather than judged,
#     because nothing here can know how old a name it did not write is;
#   * **the newest object under the prefix is never deleted**, whatever the arithmetic says, as
#     insurance against a clock or parse fault removing the only recent copy;
#   * `--dry-run` reports and deletes nothing.
#
# Usage:  ozikoro-offsite-retention [--dry-run]
# Env:    ENV_FILE (default /opt/ozituma/.env), PREFIX, RETAIN_DAYS
#
set -u

ENV_FILE="${ENV_FILE:-/opt/ozituma/.env}"
PREFIX="${PREFIX:-backups/ozituma}"
RETAIN_DAYS="${RETAIN_DAYS:-45}"

DRY_RUN=0
case "${1:-}" in
  --dry-run) DRY_RUN=1 ;;
  "") : ;;
  *) echo "usage: $0 [--dry-run]" >&2; exit 2 ;;
esac

# `backups/` or nothing. A prefix that could name the media prefixes is a fault, not a setting.
case "$PREFIX" in
  backups/*) : ;;
  *) echo "REFUSING: PREFIX is '$PREFIX', which does not begin 'backups/'. This bucket also holds audio/ and ozikoro/." >&2; exit 78 ;;
esac

case "$RETAIN_DAYS" in
  ''|*[!0-9]*) echo "REFUSING: RETAIN_DAYS is '$RETAIN_DAYS', not a number of days" >&2; exit 78 ;;
esac

# Read the names, never the values. `.env` cannot be sourced by a shell — it holds
# `OZITUMA_MAIL_FROM=Ozituma <hello@ozikoro.com>` and the shell reads `<…>` as a redirect — and a
# `grep` that matches a line prints the secret, which this project has already paid for once.
read_var() {
  awk -F= -v K="$1" '$0 ~ "^"K"=" {sub("^"K"=",""); print; exit}' "$ENV_FILE"
}

S3_ACCESS_KEY_ID="$(read_var S3_ACCESS_KEY_ID)"
S3_SECRET_ACCESS_KEY="$(read_var S3_SECRET_ACCESS_KEY)"
S3_ENDPOINT="$(read_var S3_ENDPOINT)"
S3_BUCKET="$(read_var S3_BUCKET)"
S3_REGION="$(read_var S3_REGION)"

for pair in "S3_ACCESS_KEY_ID:$S3_ACCESS_KEY_ID" "S3_SECRET_ACCESS_KEY:$S3_SECRET_ACCESS_KEY" \
            "S3_ENDPOINT:$S3_ENDPOINT" "S3_BUCKET:$S3_BUCKET"; do
  if [ -z "${pair#*:}" ]; then
    echo "REFUSING: ${pair%%:*} is empty in $ENV_FILE — nothing would be pruned and nothing would say so." >&2
    exit 78
  fi
done

AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID"
AWS_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY"
AWS_DEFAULT_REGION="${S3_REGION:-auto}"
AWS_PAGER=
AWS_CLI_AUTO_PROMPT=off
export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_DEFAULT_REGION AWS_PAGER AWS_CLI_AUTO_PROMPT

# Path-style addressing, written to a config file rather than an invented environment variable. The
# compose uploader records why: `AWS_S3_ADDRESSING_STYLE` is not a real AWS CLI variable and would
# have been accepted and ignored.
AWS_CONFIG_FILE="/tmp/ozikoro-offsite-retention-aws-config"
mkdir -p /tmp
printf '[default]\nregion = %s\ns3 =\n    addressing_style = path\n' "$AWS_DEFAULT_REGION" > "$AWS_CONFIG_FILE"
export AWS_CONFIG_FILE

EP_ARGS="--endpoint-url $S3_ENDPOINT"

# The host has GNU date, which is the whole reason this job can exist.
CUTOFF="$(date -u -d "$RETAIN_DAYS days ago" +%Y-%m-%dT%H-%M-%SZ)" || {
  echo "REFUSING: cannot compute a cutoff — 'date -d' is not GNU. Nothing was deleted." >&2
  exit 1
}

echo "retention: bucket=$S3_BUCKET prefix=$PREFIX/ retain=${RETAIN_DAYS}d cutoff=$CUTOFF dry_run=$DRY_RUN"

KEYS="$(mktemp)"
trap 'rm -f "$KEYS" "$AWS_CONFIG_FILE"' EXIT

aws $EP_ARGS s3api list-objects-v2 --bucket "$S3_BUCKET" --prefix "$PREFIX/" --max-keys 1000 \
  --query 'Contents[].[Key,Size]' --output text 2>/dev/null | tr '\t' ' ' > "$KEYS" || true

considered=0
matched=0
while read -r key size; do
  [ -n "$key" ] || continue
  case "$key" in
    "$PREFIX"/ozituma-*.dump.age) : ;;
    *) continue ;;
  esac
  considered=$((considered + 1))
done < "$KEYS"

if [ "$considered" -eq 0 ]; then
  echo "retention: nothing under $PREFIX/ matches ozituma-*.dump.age — nothing to do"
  exit 0
fi

# The newest object under the prefix, by the timestamp in its name. Never deleted.
#
# ⚠️ THE TIMESTAMP IN THE KEY IS HYPHENATED, and the first draft of this script assumed the compact
# `20261006T035754Z` form and therefore matched nothing at all. The dumper builds the name with
#
#     stamp=$(date -u +%Y-%m-%dT%H-%M-%SZ)     →     ozituma-2026-10-06T03-57-54Z.dump.age
#
# and the compose file's own remote-retention leg compares that same hyphenated form against
# `date -u -d "N days ago" +%Y-%m-%dT%H-%M-%SZ`. Both sides must agree, and a shape check that
# matches nothing fails *closed* — it skips every object — which is the safe direction but also the
# reason it has to be tested against a real key rather than reasoned about.
NEWEST="$(sed -n 's#^\(.*/ozituma-\([0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}T[0-9]\{2\}-[0-9]\{2\}-[0-9]\{2\}Z\)\.dump\.age\) .*#\2 \1#p' "$KEYS" | sort | tail -n 1 | cut -d' ' -f2)"
echo "retention: $considered candidate(s); newest is ${NEWEST:-none} (never deleted)"

while read -r key size; do
  [ -n "$key" ] || continue
  case "$key" in
    "$PREFIX"/ozituma-*.dump.age) : ;;
    *) continue ;;
  esac

  ts="$(printf '%s' "$key" | sed 's|.*/ozituma-||; s|\.dump\.age$||')"
  case "$ts" in
    20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]-[0-9][0-9]-[0-9][0-9]Z) : ;;
    *) echo "retention: skipping $key — its name does not carry a timestamp this job can judge"; continue ;;
  esac

  [ "$key" = "$NEWEST" ] && continue

  if [ "$ts" \< "$CUTOFF" ]; then
    matched=$((matched + 1))
    if [ "$DRY_RUN" = "1" ]; then
      echo "retention: WOULD DELETE $key (${size:-?} bytes, stamped $ts, older than $CUTOFF)"
    # ⚠️ NO `--only-show-errors` HERE, AND THE FIRST VERSION OF THIS SCRIPT HAD IT. It was copied
    # from the compose entrypoint's own `delete-object` line, and it is not an `aws s3api` option —
    # it belongs to the high-level `aws s3` family. Measured on the host, 2026-10-06, on the first
    # real deletion this job ever attempted:
    #
    #     usage: aws [options] <command> <subcommand> [parameters]
    #     Unknown options: --only-show-errors
    #     retention: FAILED to delete backups/ozituma/ozituma-2026-01-01T00-00-00Z.dump.age — it stays
    #
    # **The same invalid flag is why the compose `backup-upload` service has never uploaded
    # anything** — see `scripts/offsite-upload.sh`, which exists for that reason and no other. A flag
    # copied from a file that has never run is a flag nobody has tested, and this is the second place
    # in one round that it was found.
    elif aws $EP_ARGS s3api delete-object --bucket "$S3_BUCKET" --key "$key"; then
      echo "retention: deleted $key (${size:-?} bytes, stamped $ts, older than $CUTOFF)"
    else
      echo "retention: FAILED to delete $key — it stays, and the next pass will try again" >&2
    fi
  fi
done < "$KEYS"

echo "retention: done — $matched object(s) older than $CUTOFF under $PREFIX/"
exit 0
