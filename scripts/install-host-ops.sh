#!/usr/bin/env bash
#
# Install (or re-install) the host's operational scripts and their systemd units, over SSM.
#
# ── WHAT THIS PUTS ON THE HOST, AND WHY EACH THING IS SEPARATE FROM A DEPLOY ────────────────────
#
# `scripts/deploy-to-host.sh` ships *application source*. It deliberately does not ship `docker/`,
# and it has no business writing into `/usr/local/bin` or `/etc/systemd/system` — a source deploy
# that also rewrites the host's own service definitions is a deploy that can change something other
# than the app, which is the fault this repository keeps producing. So installation is its own,
# explicit, re-runnable act, and this is it.
#
#     /usr/local/bin/ozituma-docker-cleanup        ← scripts/host-docker-cleanup.sh
#         the existing 6-hourly unit runs it; it now names superseded images by build time and keeps
#         the newest five immutable tags per repository instead of letting `prune -af` take them
#
#     /usr/local/bin/ozikoro-offsite-retention     ← scripts/offsite-retention.sh
#     /etc/systemd/system/ozikoro-offsite-retention.{service,timer}
#         the R2 retention leg, daily, because the compose uploader's own leg cannot compute a
#         cutoff (BusyBox `date -d` rejects "45 days ago") and has never run
#
# ── WHAT IT DOES NOT TOUCH ──────────────────────────────────────────────────────────────────────
#
#   * It does not run `docker compose` at all. No container is created, recreated, stopped or
#     restarted, and the academy, the dictionary and the archive are all untouched by it.
#   * It does not modify the compose files, the Caddyfile or the Dockerfile.
#   * It does not delete anything: the previous `/usr/local/bin/ozituma-docker-cleanup` is copied
#     into `/opt/ozituma/backups/` under a timestamped name before it is replaced.
#   * It does not read, print or move a secret. The scripts read `/opt/ozituma/.env` by NAME with
#     `awk` at run time; this installer never opens it.
#
# ── USAGE ───────────────────────────────────────────────────────────────────────────────────────
#
#     bash scripts/install-host-ops.sh --dry-run   # print what would be installed, change nothing
#     bash scripts/install-host-ops.sh             # install and enable the timer
#
# Env overrides: INSTANCE_ID, AWS_PROFILE, AWS_REGION
#
set -euo pipefail

INSTANCE_ID="${INSTANCE_ID:-i-0cf8b21633d2aaf22}"
AWS_PROFILE="${AWS_PROFILE:-ozikoro}"
AWS_REGION="${AWS_REGION:-us-east-1}"

DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

AWS=(aws --profile "$AWS_PROFILE" --region "$AWS_REGION")

for f in scripts/host-docker-cleanup.sh scripts/offsite-retention.sh scripts/offsite-upload.sh; do
  [ -f "$f" ] || { echo "missing $f" >&2; exit 1; }
done

# ⚠️ ENCODE WITH `python3`, NOT WITH `base64`, AND THE REASON IS MEASURED. macOS ships
# `/usr/bin/base64` from a wrapper that opens `/dev/stdout`, and in a sandboxed shell that open is
# refused — `base64: line 136: /dev/stdout: Operation not permitted` — so the first version of this
# script failed before it sent anything. `python3` is already a dependency of the JSON step below,
# `base64.b64encode` has no such indirection, and the output is byte-identical to
# `openssl base64 -A` on the same input (checked). Encoding happens here; decoding happens on the
# host with GNU `base64 -d`.
b64() {
  python3 -c 'import base64,sys;print(base64.b64encode(open(sys.argv[1],"rb").read()).decode())' "$1"
}
CLEANUP_B64="$(b64 scripts/host-docker-cleanup.sh)"
RETENTION_B64="$(b64 scripts/offsite-retention.sh)"
UPLOAD_B64="$(b64 scripts/offsite-upload.sh)"

cat > /tmp/install-host-ops-remote.sh <<REMOTE
set -u
STAMP=\$(date -u +%Y-%m-%dT%H-%M-%SZ)
echo "==> host: \$STAMP"

echo "--- 1. preserve the cleanup script that is there now (additive: nothing is removed) ---"
if [ -f /usr/local/bin/ozituma-docker-cleanup ]; then
  cp -p /usr/local/bin/ozituma-docker-cleanup "/opt/ozituma/backups/ozituma-docker-cleanup.replaced-\$STAMP"
  echo "    kept /opt/ozituma/backups/ozituma-docker-cleanup.replaced-\$STAMP (\$(wc -c < /usr/local/bin/ozituma-docker-cleanup) bytes)"
else
  echo "    none present"
fi

echo "--- 2. install the scripts ---"
printf '%s' "$CLEANUP_B64" | base64 -d > /usr/local/bin/ozituma-docker-cleanup
printf '%s' "$RETENTION_B64" | base64 -d > /usr/local/bin/ozikoro-offsite-retention
printf '%s' "$UPLOAD_B64" | base64 -d > /usr/local/bin/ozikoro-offsite-upload
chmod 755 /usr/local/bin/ozituma-docker-cleanup /usr/local/bin/ozikoro-offsite-retention /usr/local/bin/ozikoro-offsite-upload
for f in /usr/local/bin/ozituma-docker-cleanup /usr/local/bin/ozikoro-offsite-retention /usr/local/bin/ozikoro-offsite-upload; do
  echo "    \$f \$(wc -c < "\$f") bytes sha256=\$(sha256sum "\$f" | cut -d' ' -f1)"
done
sh -n /usr/local/bin/ozituma-docker-cleanup && echo "    syntax ok: ozituma-docker-cleanup"
sh -n /usr/local/bin/ozikoro-offsite-retention && echo "    syntax ok: ozikoro-offsite-retention"
sh -n /usr/local/bin/ozikoro-offsite-upload && echo "    syntax ok: ozikoro-offsite-upload"

echo "--- 3. the upload unit and timer ---"
cat > /etc/systemd/system/ozikoro-offsite-upload.service <<'UNIT'
[Unit]
Description=Upload the archive's encrypted dumps to R2, verify them by read-back, and prune confirmed local copies
Documentation=file:///opt/ozituma/app/docs/OZIKORO-BACKUP-AND-ROLLBACK.md
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/ozikoro-offsite-upload
UNIT
cat > /etc/systemd/system/ozikoro-offsite-upload.timer <<'UNIT'
[Unit]
Description=Upload the archive's encrypted dumps to R2 every five minutes

[Timer]
# Five minutes, because the dumper's pass is daily and the point of the timer is that a dump which
# exists is off the machine within minutes rather than at the next daily boundary. The uploader skips
# anything already marked .uploaded, so a pass with nothing to do costs one \`docker run\`.
OnBootSec=5min
OnUnitActiveSec=5min
Persistent=true

[Install]
WantedBy=timers.target
UNIT
cat > /etc/systemd/system/ozikoro-offsite-retention.service <<'UNIT'
[Unit]
Description=Enforce R2 retention for the archive's encrypted dumps
Documentation=file:///opt/ozituma/app/docs/OZIKORO-BACKUP-AND-ROLLBACK.md
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/ozikoro-offsite-retention
UNIT
cat > /etc/systemd/system/ozikoro-offsite-retention.timer <<'UNIT'
[Unit]
Description=Run the R2 dump retention daily

[Timer]
# The dumper's own pass is daily and the remote policy is 45 days, so a daily sweep is the right
# granularity. \`Persistent=true\` means a sweep missed while the instance was down runs at the next
# boot rather than being skipped - for a retention job that only ever deletes, that is safe.
OnBootSec=30min
OnUnitActiveSec=24h
Persistent=true

[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now ozikoro-offsite-upload.timer >/dev/null 2>&1 && echo "    upload timer enabled and started"
systemctl enable --now ozikoro-offsite-retention.timer >/dev/null 2>&1 && echo "    retention timer enabled and started"
echo "    (only these timers are started; no container and no other unit is touched)"

echo "--- 4. state ---"
for u in ozikoro-offsite-upload.timer ozikoro-offsite-retention.timer; do
  echo "    \$u: enabled=\$(systemctl is-enabled \$u 2>&1) active=\$(systemctl is-active \$u 2>&1)"
done
systemctl list-timers 'ozikoro*' 'ozituma*' --all --no-pager 2>&1 | sed 's/^/    /'

echo "--- 5. the retention job, in dry-run, so it is proven to run and proven to delete nothing ---"
/usr/local/bin/ozikoro-offsite-retention --dry-run 2>&1 | sed 's/^/    /'

echo "--- 6. the uploader, in dry-run, so it is proven to run and proven to upload nothing ---"
/usr/local/bin/ozikoro-offsite-upload --dry-run 2>&1 | sed 's/^/    /'
REMOTE

if [ "$DRY_RUN" = "1" ]; then
  echo "==> DRY RUN — would install these to $INSTANCE_ID:"
  echo "    /usr/local/bin/ozituma-docker-cleanup       ($(wc -c < scripts/host-docker-cleanup.sh) bytes)"
  echo "    /usr/local/bin/ozikoro-offsite-retention    ($(wc -c < scripts/offsite-retention.sh) bytes)"
  echo "    /etc/systemd/system/ozikoro-offsite-retention.service"
  echo "    /etc/systemd/system/ozikoro-offsite-retention.timer"
  exit 0
fi

python3 - <<'PY'
import json, pathlib
script = pathlib.Path('/tmp/install-host-ops-remote.sh').read_text()
pathlib.Path('/tmp/install-host-ops-remote.json').write_text(json.dumps({'commands': [script]}))
PY

CMD_ID=$("${AWS[@]}" ssm send-command \
  --instance-ids "$INSTANCE_ID" \
  --document-name "AWS-RunShellScript" \
  --parameters file:///tmp/install-host-ops-remote.json \
  --timeout-seconds 300 \
  --query 'Command.CommandId' --output text)
echo "==> ssm command $CMD_ID"

for _ in $(seq 1 60); do
  STATUS=$("${AWS[@]}" ssm get-command-invocation --command-id "$CMD_ID" \
    --instance-id "$INSTANCE_ID" --query 'Status' --output text 2>/dev/null || echo Pending)
  case "$STATUS" in Success|Failed|Cancelled|TimedOut) break ;; esac
  sleep 5
done

"${AWS[@]}" ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$INSTANCE_ID" \
  --query 'StandardOutputContent' --output text
echo "--- stderr ---"
"${AWS[@]}" ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$INSTANCE_ID" \
  --query 'StandardErrorContent' --output text
echo "==> status: $STATUS"
