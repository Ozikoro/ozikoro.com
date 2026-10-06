#!/bin/sh
#
# Upload the archive's encrypted dumps to R2 — and this exists because the service that was supposed
# to do it **cannot**, on three separate lines.
#
# ── THE DEFECT, MEASURED, BECAUSE IT IS THE WHOLE REASON FOR THIS FILE ──────────────────────────
#
# `docker/docker-compose.ozikoro.yml`'s `backup-upload` entrypoint calls the AWS CLI like this:
#
#     aws $ENDPOINT_ARGS s3api put-object --bucket "$S3_BUCKET" --key "$key" --body "$dump" --acl private --only-show-errors
#
# **`--only-show-errors` is not an `aws s3api` option.** It belongs to the high-level `aws s3`
# family. Measured in the very image the service runs:
#
#     $ docker run --rm --entrypoint sh ozituma-backup-tools:latest -c 'printf x > /tmp/x; \
#         aws s3api put-object --bucket nowhere --key k --body /tmp/x --only-show-errors'
#     aws: [ERROR]: Unknown options: --only-show-errors
#
# and the service said so itself, on the first pass that ever reached the upload, at 04:31 on
# 2026-10-06:
#
#     upload: put-object FAILED for backups/ozituma/ozituma-2026-10-06T03-57-54Z.dump.age — dump kept, will be retried
#
# **It retries for ever and never succeeds.** The same invalid flag is on the read-back `get-object`
# (line 856) and the remote-retention `delete-object` (line 902), so even a successful upload could
# not have been verified and no expired object could have been deleted. The design's own remote
# retention was separately dead because BusyBox `date -d "45 days ago"` is rejected in that image —
# see `scripts/offsite-retention.sh`.
#
# **This is why the `backups/` prefix in R2 was empty**, and it is why "the design exists" and "the
# backup exists" were two different facts.
#
# ── WHY A HOST JOB RATHER THAN A ONE-FLAG EDIT TO THE COMPOSE FILE ──────────────────────────────
#
# Because this round was instructed, explicitly and with its own reason, not to touch the compose
# files — the host's `docker-compose.prod.yml` and this checkout's are different files, and shipping
# one for the other would make a deploy build an academy whose source is not on that machine. The
# instruction is right about that, and it does not stop this job from existing: a script under
# `scripts/`, installed by `scripts/install-host-ops.sh`, run by a systemd timer, using the same
# image the service uses, is entirely outside the compose files.
#
# **When the three flags are removed at source, this job becomes redundant and harmless** — it skips
# any dump already marked `.uploaded`, so both would agree.
#
# ── WHAT IT DOES, WHICH IS WHAT THE SERVICE INTENDED TO ─────────────────────────────────────────
#
#   * only dumps the dumper has marked `.verified` (its own decrypt-and-list verdict) are considered;
#   * the plaintext is verified again here — a full `age -d` to nowhere for authentication, then
#     `pg_restore --list` for the table of contents — and its TOC entry count is printed;
#   * upload, then compare `ContentLength` against the local size;
#   * **then download the object back out of R2, decrypt it and list it again.** Only the bytes that
#     came back from R2 earn the `.uploaded` marker, which is what `healthwatch` reads;
#   * local retention: a `backupdata` dump older than `LOCAL_RETENTION_DAYS` is deleted **only after
#     an object of that exact name is confirmed present in R2**. The dumper deliberately has no prune
#     of its own, and neither does this job until that confirmation succeeds.
#
# ── WHAT IT MAY TOUCH ──────────────────────────────────────────────────────────────────────────
#
# The prefix must begin `backups/`, or it refuses to run at all. That bucket is shared: it holds the
# dictionary's `audio/` and the archive's `ozikoro/`, 75,462 objects and about 8.4 GB. Nothing here
# can name either of those.
#
# The R2 credential and the age identity are passed to the container through a **mode-600 temporary
# env file**, never on the command line — a value in `docker run -e VAR=value` is a value in `ps` and
# in `docker inspect`. The file is removed by a trap on every exit path.
#
# Usage:  ozikoro-offsite-upload [--dry-run]
# Env:    ENV_FILE, VOLUME, IMAGE, PREFIX, MIN_AGE_MINUTES, LOCAL_RETENTION_DAYS
#
set -u

ENV_FILE="${ENV_FILE:-/opt/ozituma/.env}"
VOLUME="${VOLUME:-ozituma_backupdata}"
IMAGE="${IMAGE:-ozituma-backup-tools:latest}"
PREFIX="${PREFIX:-backups/ozituma}"
# The dumper renames the file into place only after `pg_dump` and `age` have both finished, so a
# `*.dump.age` name is complete by construction; this gate is belt and braces against a filesystem
# whose mtime is briefly behind, and it is minutes rather than the service's 30.
MIN_AGE_MINUTES="${MIN_AGE_MINUTES:-2}"
LOCAL_RETENTION_DAYS="${LOCAL_RETENTION_DAYS:-14}"

DRY_RUN=0
case "${1:-}" in
  --dry-run) DRY_RUN=1 ;;
  "") : ;;
  *) echo "usage: $0 [--dry-run]" >&2; exit 2 ;;
esac

case "$PREFIX" in
  backups/*) : ;;
  *) echo "REFUSING: PREFIX is '$PREFIX', which does not begin 'backups/'. This bucket also holds audio/ and ozikoro/." >&2; exit 78 ;;
esac
case "$MIN_AGE_MINUTES" in ''|*[!0-9]*) echo "REFUSING: MIN_AGE_MINUTES is '$MIN_AGE_MINUTES', not a number" >&2; exit 78 ;; esac
case "$LOCAL_RETENTION_DAYS" in ''|*[!0-9]*) echo "REFUSING: LOCAL_RETENTION_DAYS is '$LOCAL_RETENTION_DAYS', not a number" >&2; exit 78 ;; esac

# Names, never values — and this file cannot be sourced by a shell at all, because it holds
# `OZITUMA_MAIL_FROM=Ozituma <hello@ozikoro.com>` and the shell reads `<…>` as a redirect.
read_var() {
  awk -F= -v K="$1" '$0 ~ "^"K"=" {sub("^"K"=",""); print; exit}' "$ENV_FILE"
}

ENVF="$(mktemp)"
chmod 600 "$ENVF"
trap 'rm -f "$ENVF"' EXIT INT TERM

for k in S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY S3_ENDPOINT S3_BUCKET S3_REGION S3_FORCE_PATH_STYLE \
         BACKUP_AGE_IDENTITY BACKUP_AGE_RECIPIENT; do
  v="$(read_var "$k")"
  if [ -z "$v" ]; then
    echo "REFUSING: $k is empty in $ENV_FILE. Nothing would be uploaded and nothing would say so." >&2
    exit 78
  fi
  printf '%s=%s\n' "$k" "$v" >> "$ENVF"
done
printf 'BACKUP_UPLOAD_PREFIX=%s\n' "$PREFIX" >> "$ENVF"
printf 'MIN_AGE_MINUTES=%s\n' "$MIN_AGE_MINUTES" >> "$ENVF"
printf 'LOCAL_RETENTION_DAYS=%s\n' "$LOCAL_RETENTION_DAYS" >> "$ENVF"
printf 'DRY_RUN=%s\n' "$DRY_RUN" >> "$ENVF"

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "REFUSING: image $IMAGE is not present. Build it with the backup/backup-upload services, or run scripts/install-host-ops.sh after a deploy." >&2
  exit 78
fi

echo "upload: image=$IMAGE volume=$VOLUME prefix=$PREFIX min_age=${MIN_AGE_MINUTES}m local_days=$LOCAL_RETENTION_DAYS dry_run=$DRY_RUN"

# The inner script is single-quoted so the host shell expands nothing in it; every value it needs
# arrives through the env file.
docker run --rm \
  --env-file "$ENVF" \
  -v "$VOLUME:/backups" \
  --entrypoint sh \
  "$IMAGE" -c '
set -u

# Path-style addressing, written to a config file. The compose entrypoint records why the invented
# `AWS_S3_ADDRESSING_STYLE` variable was wrong: it is not a real AWS CLI setting and would have been
# accepted and ignored.
export AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="${S3_REGION:-auto}" AWS_PAGER= AWS_CLI_AUTO_PROMPT=off
export AWS_CONFIG_FILE=/tmp/.aws/config
mkdir -p /tmp/.aws
printf "[default]\nregion = %s\ns3 =\n    addressing_style = path\n" "$AWS_DEFAULT_REGION" > "$AWS_CONFIG_FILE"

# Fail closed on the key, before judging a single dump. A mismatched pair looks exactly like a
# corrupt dump, and a job that blames the dumps for a key fault is worse than one that refuses.
umask 077
printf "%s\n" "$BACKUP_AGE_IDENTITY" > /tmp/id
chmod 600 /tmp/id
derived=$(age-keygen -y /tmp/id 2>/dev/null) || { echo "REFUSING: BACKUP_AGE_IDENTITY is not a readable age identity"; exit 78; }
if [ "$derived" != "$BACKUP_AGE_RECIPIENT" ]; then
  echo "REFUSING: the identity derives $derived but BACKUP_AGE_RECIPIENT is $BACKUP_AGE_RECIPIENT — the halves are from different keys"
  exit 78
fi

echo "upload: $(age --version); $(aws --version 2>&1); $(pg_restore --version)"

# ⚠️ NOT AN ARRAY. The compose services run their entrypoints on `postgres:16-alpine`, whose `sh` is
# **BusyBox ash**, and `AWS=(aws --endpoint-url ...)` is a bashism: measured inside this very image,
# the script dies with `sh: syntax error: unexpected "("` — after printing two lines of its own
# version banner, which is the shape of failure that reads like a mystery. A function is POSIX and
# does the same job.
awsx() { aws --endpoint-url "$S3_ENDPOINT" "$@"; }
up=0; failed=0; tocuploaded=0

for dump in /backups/ozituma-*.dump.age; do
  [ -f "$dump" ] || continue
  name=$(basename "$dump")
  [ -f "$dump.uploaded" ] && continue
  if [ ! -f "$dump.verified" ]; then
    echo "upload: skipping $name — no .verified marker, so the dumper has not vouched for it"
    continue
  fi
  if [ -n "$(find "$dump" -mmin -"$MIN_AGE_MINUTES" 2>/dev/null)" ]; then
    continue
  fi

  local_size=$(wc -c < "$dump" | tr -d "[:space:]")
  # 1. Authenticate every byte, then read the table of contents. Two separate passes so a failure
  #    says which of the two it was.
  if ! age -d -i /tmp/id "$dump" > /dev/null 2>&1; then
    echo "upload: FAIL $name — age cannot authenticate it. Not uploaded."
    failed=$((failed+1)); continue
  fi
  toc=$(age -d -i /tmp/id "$dump" 2>/dev/null | pg_restore --list | grep -cE "^[0-9]+;")
  if [ "${toc:-0}" -lt 1 ]; then
    echo "upload: FAIL $name — pg_restore --list found no TOC entries. Not uploaded."
    failed=$((failed+1)); continue
  fi

  key="$BACKUP_UPLOAD_PREFIX/$name"
  if [ "$DRY_RUN" = "1" ]; then
    echo "upload: WOULD UPLOAD $key (${local_size} bytes, TOC $toc entries)"
    continue
  fi

  # 2. PUT. NO --only-show-errors: that flag is what the compose service dies on.
  if ! awsx s3api put-object --bucket "$S3_BUCKET" --key "$key" --body "$dump" > /tmp/put.out 2>&1; then
    echo "upload: FAIL put-object $key — $(tail -1 /tmp/put.out)"
    failed=$((failed+1)); continue
  fi
  remote_size=$(awsx s3api head-object --bucket "$S3_BUCKET" --key "$key" --query ContentLength --output text 2>/dev/null | tr -d "[:space:]")
  if [ -z "$remote_size" ] || [ "$remote_size" != "$local_size" ]; then
    echo "upload: FAIL size $key — local $local_size, R2 reports ${remote_size:-nothing}. Object left in place, dump NOT pruned, retried next pass."
    failed=$((failed+1)); continue
  fi

  # 3. READ IT BACK. Only the bytes that come back from R2 earn the marker. (No apostrophe may
  #    appear inside this single-quoted script: one terminates it and the syntax error appears at the
  #    last `done`, hundreds of lines from the cause.)
  v="/tmp/verify.$$.age"
  if awsx s3api get-object --bucket "$S3_BUCKET" --key "$key" "$v" > /dev/null 2>&1 \
     && age -d -i /tmp/id "$v" > /dev/null 2>&1 \
     && age -d -i /tmp/id "$v" 2>/dev/null | pg_restore --list | grep -qE "^[0-9]+;"; then
    rm -f "$v"
    : > "$dump.uploaded"
    echo "upload: OK $key (${remote_size} bytes, TOC $toc entries, read back from R2, decrypted and listed) — marked .uploaded"
    up=$((up+1)); tocuploaded=$toc
  else
    rm -f "$v"
    echo "upload: FAIL read-back $key — the object is in R2 but would not decrypt and list after download. Object left in place, dump NOT pruned, retried next pass."
    failed=$((failed+1))
  fi
done

echo "upload: $up uploaded, $failed failed this pass"

# ── LOCAL RETENTION, AND THE ONE INVARIANT IT HOLDS ─────────────────────────────────────────────
#
# A local dump is deleted only when it is older than LOCAL_RETENTION_DAYS *and* an object of that
# exact name is confirmed present in R2. Nothing else here deletes, which is why the dumper has no
# prune of its own: a delete that runs ahead of a failed upload destroys the only copy there is.
if [ "$DRY_RUN" = "1" ]; then
  echo "upload: local retention not run in dry-run mode"
else
  pruned=0; kept=0
  for old in $(find /backups -maxdepth 1 -name "ozituma-*.dump.age" -mtime +"$LOCAL_RETENTION_DAYS" 2>/dev/null); do
    oname=$(basename "$old")
    present=$(awsx s3api head-object --bucket "$S3_BUCKET" --key "$BACKUP_UPLOAD_PREFIX/$oname" --query ContentLength --output text 2>/dev/null || echo "")
    if [ -n "$present" ] && [ "$present" != "None" ]; then
      rm -f "$old" "$old.verified" "$old.attempts" "$old.rejected" "$old.uploaded"
      echo "upload: local retention — deleted $oname (its object is in R2 and it is older than $LOCAL_RETENTION_DAYS days)"
      pruned=$((pruned+1))
    else
      echo "upload: local retention — KEEPING $oname; older than $LOCAL_RETENTION_DAYS days but no object of that name is in R2, so removing it would destroy the only copy"
      kept=$((kept+1))
    fi
  done
  echo "upload: local retention — $pruned pruned, $kept kept"
fi
'
