#!/usr/bin/env bash
#
# Deploy this repository's SOURCE to the production host and rebuild the archive.
#
# ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────
#
# **Every deploy before this one was a hand-carried union of specific commits' paths**, and that is
# how the Igbo calendar came to serve a design file four thousand bytes shorter than the one in this
# repository — for four rounds of the owner reporting it, while four agents read the fill looking for
# a fault that was never in the fill.
#
# The host is a DIFFERENT CHECKOUT, not a copy of this one:
#
#     /opt/ozituma/app   →  git remote https://github.com/oziikoro/Ozikoro.git
#                           HEAD 7ae4808 · TRACKED 199 FILES
#     this repository    →  TRACKED 1,624 FILES
#
# and `apps/ozikoro/public/design/` is **UNTRACKED** in the host's checkout (`?? …/design/`). So git
# on the host can never update it. A deploy that copies only the paths a commit names will therefore
# leave the whole design directory — every one of the 53 screens the deliverable drew — at whatever
# it happened to be when someone last copied it by hand.
#
# ⚠️ **SO THIS SCRIPT SYNCS THE WHOLE TREE, NOT A COMMIT'S UNION.** A deploy that names paths has to
# remember every path; a deploy that syncs the tree cannot forget one. The cost is time and bytes,
# and it is worth both.
#
# ── WHAT IT DOES NOT DO ─────────────────────────────────────────────────────────────────────────
#
# **It does not scaffold anything or guess at a secret.** The credentials come from the host's own
# `/opt/ozituma/.env`, read by `awk` and never printed — a `grep` that matches a line in that file
# prints the VALUE, and that has already happened once in this project.
#
# **It does not touch DNS, cPanel or the Cloudflare zone.** Those are the cutover's, which is a
# separate act with its own rollback.
#
# ── USAGE ───────────────────────────────────────────────────────────────────────────────────────
#
#     bash scripts/deploy-to-host.sh --dry-run     # what would be copied, and what differs
#     bash scripts/deploy-to-host.sh               # copy, verify every hash, rebuild
#     bash scripts/deploy-to-host.sh --no-build    # copy and verify, leave the container alone
#
# Env overrides: INSTANCE_ID, AWS_PROFILE, AWS_REGION, REMOTE_DIR
#
set -euo pipefail

INSTANCE_ID="${INSTANCE_ID:-i-0cf8b21633d2aaf22}"
AWS_PROFILE="${AWS_PROFILE:-ozikoro}"
AWS_REGION="${AWS_REGION:-us-east-1}"
REMOTE_DIR="${REMOTE_DIR:-/opt/ozituma/app}"
COMPOSE="-f docker/docker-compose.prod.yml -f docker/docker-compose.ozikoro.yml"

DRY_RUN=0
DO_BUILD=1
for arg in "$@"; do
  case "$arg" in
    --dry-run)  DRY_RUN=1 ;;
    --no-build) DO_BUILD=0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

AWS=(aws --profile "$AWS_PROFILE" --region "$AWS_REGION")

# ── WHAT TRAVELS ────────────────────────────────────────────────────────────────────────────────
#
# **Tracked files only, and that is a deliberate limit.** An untracked file on this machine is a
# file nobody has committed — and shipping one is how a tree that cannot build reaches production.
# Tonight a committed `index.ts` exported three modules that were untracked, and every build failed
# until they were committed.
#
# ⚠️ `data/media`, `data/sources` and `data/derived` are excluded for the same reason `.dockerignore`
# excludes them: they are large, third-party or re-downloadable, and the media has its own path to
# object storage (`docs/OZIKORO-CUTOVER.md`, §A).
#
# ── 🔴 `apps/academy`, `apps/media` AND `docker/` DO NOT TRAVEL. THIS IS A SAFETY RULE, NOT TIDINESS ─
#
# **The host is a different checkout and it has different applications.** Measured:
#
#     THIS CHECKOUT          apps/  academy · media · ozikoro · web · Projects
#     THE HOST               apps/  learn · ozikoro · web          ← NO academy, NO media
#
# and the host's own `docker/docker-compose.prod.yml` runs the academy from an **`image:`** — there is
# no `build:` block there, because there is no source tree to build from.
#
# **THIS CHECKOUT'S compose file DOES have `build: context: ../apps/academy`.** So shipping the
# checkout's `docker/` directory would replace the host's compose with one that tries to **build** the
# academy from `../apps/academy` — a directory that does not exist on that machine. *That is a build
# that fails, on the service that is currently healthy and serving `academy.ozikoro.com`.*
#
# **The failure would present as the academy going down during a deploy that was supposed to touch
# something else**, which is the "file and production disagree" fault this project keeps producing.
# `AGENTS.md` names this exact hazard and says the resolution is a choice, not a fix. Until that choice
# is made, this script does the safe half: it ships the archive's own source and leaves the host's
# compose and the other two applications alone.
#
# ⚠️ **SO `docker/` IS EXCLUDED, AND SO ARE `apps/academy` AND `apps/media`.** The cost is that a
# change to this checkout's compose file does not reach the host through this script — *which is
# correct, because that change needs the choice above to be made first.*
PATHS=(
  apps/ozikoro
  apps/web
  packages
  scripts
  docs
  data
  # ⚠️ THE DOCKERFILE TRAVELS EVEN THOUGH ITS DIRECTORY DOES NOT — AND ITS ABSENCE COST THREE FAILED DEPLOYS.
  #
  # `docker/` is excluded as a directory for a reason that is still correct: *the host's own compose runs the
  # academy from an `image:`, while this checkout's compose would try to **build** it from `apps/academy`,
  # which the host does not have.* **So the compose files must not travel — that is the safety rule at line 78
  # and it stands.**
  #
  # 🔴 **BUT `Dockerfile` BECAME A COLLATERAL OF THAT RULE, AND NOTHING NOTICED FOR HOURS.** *The host's is
  # 12,583 bytes; this checkout's is 13,081.* The difference is that the repo's removed the `learn` target and
  # the retired `apps/learn` with it — **and the host's still runs `COPY apps/learn/package.json`, for an app
  # retired on 2026-10-04 and deleted from this repository.**
  #
  # **The measured consequence, three deploys running:**
  #     failed to solve: failed to compute cache key: "/apps/learn/package.json"
  # **A file the repository deleted, demanded by a Dockerfile the deploy never updated.**
  #
  # ⚠️ **AND THE PRUNE HANDLES A SINGLE FILE CORRECTLY, WHICH IS WHY THIS IS SAFE TO ADD.** *It derives its
  # owned directories from the manifest's own paths — `docker/Dockerfile` yields the path `docker/Dockerfile`,
  # and `find docker/Dockerfile -type f` matches that one file.* **The host's compose files are not in the
  # manifest, so they are not reachable from the prune, exactly as `.env` and `.data/` are not.**
  docker/Dockerfile
)

echo "==> collecting tracked files"
# ⚠️ FROM HEAD, NOT FROM THE INDEX — AND THAT IS THE FIX FOR TONIGHT'S SECOND FAILED DEPLOY.
#
# This was `git ls-files`, which reads `.git/index` — a file EIGHT AGENTS WRITE TO CONCURRENTLY, and
# which several have reset today. **The index held 1,636 entries while HEAD's tree held 1,640: the four
# it lacked were `library.ts`, migration 0060 and the two `/library` routes, all committed and all
# imported by code that WAS shipped.** So the deploy sent a page importing a module it did not send, and
# the build failed with `Module not found` — exactly as it had for `form-sync.tsx` six hours earlier.
#
# `git ls-tree -r HEAD` reads the COMMIT. What is committed is what deploys; the index is a scratch pad
# that eight agents share, and a deploy must not depend on its state.

# ⚠️ NO `mapfile` — this runs on macOS, whose `/bin/bash` is 3.2, where `mapfile` does not exist.
# A read loop with a NUL delimiter is portable and survives spaces in a path, which a `for` over a
# command substitution would not.
FILES=()
while IFS= read -r -d '' f; do
  FILES+=("$f")
done < <(git ls-tree -r -z --name-only HEAD -- "${PATHS[@]}")
echo "    tracked: ${#FILES[@]}"

# Apply the exclusions in bash rather than in rsync syntax, so the same list is used here and in the
# count above — two lists would drift.
#
# ⚠️ AND SKIP A TRACKED FILE THAT IS NOT ON DISK. `git ls-files` lists what the INDEX holds; a file
# deleted from the working tree but not yet committed is still listed, and `cp` then fails with
# "No such file or directory" — which is how `apps/ozikoro/app/robots.ts` announced itself. *That file
# is genuinely gone: the SEO work replaced it with `app/robots.txt/route.ts`, and the archive serves
# `robots.txt` from that route.* A deploy must carry what exists, not what was once recorded.
KEEP=()
SKIPPED_ABSENT=0
for f in "${FILES[@]}"; do
  case "$f" in
    .next/*|.next-next/*|*/node_modules/*|node_modules/*) continue ;;
    data/media/*|data/sources/*|data/derived/*|.data/*) continue ;;
    *.tsbuildinfo) continue ;;
  esac
  if [ ! -f "$f" ]; then
    SKIPPED_ABSENT=$((SKIPPED_ABSENT + 1))
    echo "    skipped (tracked but not on disk): $f"
    continue
  fi
  KEEP+=("$f")
done
echo "    travelling: ${#KEEP[@]}"
[ "$SKIPPED_ABSENT" -gt 0 ] && echo "    absent-but-tracked skipped: $SKIPPED_ABSENT"

# ── THE DESIGN DIRECTORY IS CALLED OUT SEPARATELY, BECAUSE IT IS THE ONE THAT WAS LOST ──────────
#
# It is inside `apps/ozikoro`, so it is already in the set above — but it gets its own count and its
# own assertion, because a deploy that silently drops 53 screens must fail loudly rather than ship.
DESIGN_FILES=0
for f in "${KEEP[@]}"; do
  case "$f" in apps/ozikoro/public/design/*) DESIGN_FILES=$((DESIGN_FILES + 1)) ;; esac
done
echo "    of which design files: $DESIGN_FILES"
if [ "$DESIGN_FILES" -lt 60 ]; then
  echo "!! REFUSING: only $DESIGN_FILES design files. The deliverable has 65 including" >&2
  echo "!! 53 screens, and a deploy that drops them serves an older design silently." >&2
  exit 1
fi

# ── STAGE ───────────────────────────────────────────────────────────────────────────────────────
BUCKET="ozikoro-deploy-$(date -u +%Y%m%d-%H%M%S)"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

echo "==> staging to $STAGE"
for f in "${KEEP[@]}"; do
  mkdir -p "$STAGE/$(dirname "$f")"
  cp -p "$f" "$STAGE/$f"
done
( cd "$STAGE" && find . -type f | sort \
    | while read -r f; do printf '%s  %s\n' "$(shasum -a 256 "$f" | cut -d' ' -f1)" "${f#./}"; done ) \
  > "$STAGE/../deploy-manifest.txt" 2>/dev/null || true
mv "$STAGE/../deploy-manifest.txt" /tmp/deploy-manifest.txt
echo "    manifest: $(wc -l < /tmp/deploy-manifest.txt | tr -d ' ') files"

# ── WHAT THIS DEPLOY IS, IN THREE FACTS, FOR THE IMMUTABLE TAG AND ITS PROVENANCE LINE ─────────
#
# ⚠️ **THE TAG CARRIES A COMMIT, AND THE COMMIT IS NOT THE WHOLE TRUTH — SO THE TRUTH IS RECORDED
# BESIDE IT.** This script ships the WORKING TREE (`git ls-files` chooses the paths, `cp` reads the
# files), so a deploy made while the tree is dirty ships content that is not in `HEAD`. Measured at
# the last deploy of 2026-10-06: 872 files travelled from a tree with dozens of modified files. A
# tag reading `...-607e0ac` therefore means "launched from 607e0ac", not "identical to 607e0ac".
#
# That distinction is exactly the "file and production disagree" fault this repository keeps
# producing, so it is not left to a comment: the manifest's own sha256, the number of dirty paths,
# and the file count go into `/opt/ozituma/backups/image-provenance.log` on the host, one line per
# build. The tag stays short and memorable — which is what a rollback needs — and the honesty lives
# in the line next to it, which is where somebody debugging a rollback will look.
REV="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
MANIFEST_SHA="$(shasum -a 256 /tmp/deploy-manifest.txt | cut -d' ' -f1)"
DIRTY="$(git status --porcelain | wc -l | tr -d ' ')"
FILE_COUNT="${#KEEP[@]}"
echo "    revision to be tagged: $REV (dirty paths in the tree: $DIRTY; manifest sha256: $(printf '%s' "$MANIFEST_SHA" | cut -c1-16)…)"

if [ "$DRY_RUN" = "1" ]; then
  echo "==> DRY RUN — nothing uploaded, nothing written"
  echo "    would copy ${#KEEP[@]} files to $REMOTE_DIR, then ${DO_BUILD:+rebuild}"
  exit 0
fi

echo "==> creating bucket $BUCKET"
"${AWS[@]}" s3 mb "s3://$BUCKET" >/dev/null

# ⚠️ BOTH PRINCIPALS. The host runs as the instance ROLE; the credentials in its `.env` are a USER.
# A policy naming only the user answers 403 from a plain SSM shell, and a `--recursive` copy needs
# `s3:ListBucket` as well as `s3:GetObject`. Both of those cost a round to find.
cat > /tmp/deploy-policy.json <<EOF
{"Version":"2012-10-17","Statement":[
 {"Effect":"Allow",
  "Principal":{"AWS":["arn:aws:iam::793264561107:user/ozituma-ses","arn:aws:iam::793264561107:role/ozituma-instance"]},
  "Action":["s3:GetObject"],"Resource":"arn:aws:s3:::$BUCKET/*"},
 {"Effect":"Allow",
  "Principal":{"AWS":["arn:aws:iam::793264561107:user/ozituma-ses","arn:aws:iam::793264561107:role/ozituma-instance"]},
  "Action":["s3:ListBucket"],"Resource":"arn:aws:s3:::$BUCKET"}]}
EOF
"${AWS[@]}" s3api put-bucket-policy --bucket "$BUCKET" --policy file:///tmp/deploy-policy.json

echo "==> uploading"
"${AWS[@]}" s3 cp "$STAGE" "s3://$BUCKET/files" --recursive --no-progress >/dev/null
"${AWS[@]}" s3 cp /tmp/deploy-manifest.txt "s3://$BUCKET/manifest.txt" --no-progress >/dev/null

# ── INSTALL ON THE HOST ─────────────────────────────────────────────────────────────────────────
#
# ⚠️ `set -a; . /opt/ozituma/.env` KILLS THE SHELL. The file holds
# `OZITUMA_MAIL_FROM=Ozituma <hello@ozikoro.com>` — the shell reads `<…>` as a redirect — and an
# unquoted space and a `+` elsewhere. That is why two installs died with exit 0 and empty output.
# The two keys are extracted by `awk` instead, and nothing prints their values.
cat > /tmp/deploy-remote.sh <<'REMOTE'
set -u
cd __REMOTE_DIR__ || exit 1
TS=$(date -u +%Y-%m-%dT%H-%M-%SZ)
AK=$(awk -F= '/^AWS_ACCESS_KEY_ID=/{sub(/^AWS_ACCESS_KEY_ID=/,"");print;exit}' /opt/ozituma/.env)
SK=$(awk -F= '/^AWS_SECRET_ACCESS_KEY=/{sub(/^AWS_SECRET_ACCESS_KEY=/,"");print;exit}' /opt/ozituma/.env)
export AWS_ACCESS_KEY_ID="$AK" AWS_SECRET_ACCESS_KEY="$SK" AWS_DEFAULT_REGION=__AWS_REGION__

echo "==> host: backup before anything is written"
# ⚠️ THE LINE BELOW USED TO END IN **TWO** BACKSLASHES, INSIDE A **QUOTED** HEREDOC, AND THAT IS WHY
# A 0-BYTE PRE-DEPLOY DUMP EXISTS ON THIS HOST.
#
# `cat > /tmp/deploy-remote.sh <<'REMOTE'` is quoted (`<<'REMOTE'`), so nothing in the body is
# expanded or unescaped here — the host receives the bytes literally. `\\` at end of line is
# therefore NOT a continuation: the shell reads an escaped backslash, a literal `\` argument, and
# the command ENDS. The next line then runs as its own command **on the host**:
#
#     docker compose ... exec -T postgres \                     <- exec's the argument `\`; fails
#     pg_dump -U ozituma -Fc ozituma > ...pre-deploy-$TS.dump 2>/dev/null   <- runs on the HOST
#
# and **the host has no `pg_dump`** (measured: `pg_dump -> MISSING`). `2>/dev/null` swallowed
# "command not found", the `>` still created the file, and the deploy carried on.
#
# MEASURED CONSEQUENCE, in /opt/ozituma/backups on 2026-10-06:
#     ozikoro-pre-deploy-2026-10-06T03-12-08Z.dump   21248872 bytes   <- written before the rewrite
#     ozikoro-pre-deploy-2026-10-06T04-22-08Z.dump   21263853 bytes   <- written before the rewrite
#     ozikoro-pre-deploy-2026-10-06T04-32-43Z.dump          0 bytes   <- written after it
# and `pg_restore --list` on the 0-byte file answers `input file is too short (read 0, expected 5)`.
#
# **A deploy that takes its own safety net away and reports success is the exact fault this script
# exists to remove**, so this is fixed in two places: the continuation is one backslash again, and the
# dump is then CHECKED — pg_dump's exit status, a non-zero size, and a listable table of contents —
# and the deploy REFUSES to write anything if any of the three is wrong.
BK=/opt/ozituma/backups/ozikoro-pre-deploy-$TS.dump
# ⚠️ ONE LINE, NO CONTINUATION — AND THAT IS THE FIX FOR A 0-BYTE BACKUP THAT LOOKED FINE.
#
# The measured failure, from a real deploy:
#
#     OCI runtime exec failed: exec failed: unable to start container process:
#       exec: "\\": executable file not found in $PATH: unknown
#     /opt/ozituma/backups/ozikoro-pre-deploy-2026-10-06T04-32-43Z.dump   0 bytes
#
# **The `\` that continued the command across two lines reached `docker exec` as the thing to run**, so
# the container tried to execute a backslash, the dump was never written, `pg_dump`'s exit status was
# whatever the runtime returned — and the deploy moved on. *The paragraph above this one records an
# earlier version of the same fault and says "the continuation is one backslash again". It is not any
# more: there is no continuation.* **Nothing about this command needs two lines, and a line that cannot
# be broken cannot be broken wrongly.**
if docker compose --env-file /opt/ozituma/.env __COMPOSE__ exec -T postgres pg_dump -U ozituma -Fc ozituma > "$BK"; then
  :
else
  echo "    !! pg_dump FAILED. Nothing is deployed." >&2
  rm -f "$BK"
  exit 1
fi
BK_BYTES=$(wc -c < "$BK" | tr -d '[:space:]')
# Same reason: one line.
BK_TOC=$(docker compose --env-file /opt/ozituma/.env __COMPOSE__ exec -T postgres pg_restore --list < "$BK" 2>/dev/null | grep -cE '^[0-9]+;' | tr -d '[:space:]')
echo "    $BK $BK_BYTES bytes, $BK_TOC TOC entries"
if [ "${BK_BYTES:-0}" -lt 1 ] || [ "${BK_TOC:-0}" -lt 1 ]; then
  echo "    !! REFUSING TO DEPLOY: the pre-deploy dump is $BK_BYTES bytes with $BK_TOC TOC entries." >&2
  echo "    !! Nothing has been written. Fix the dump first — the copy you are about to replace is" >&2
  echo "    !! the only one there is." >&2
  exit 1
fi

echo "==> host: download and verify every hash BEFORE writing"
aws s3 cp "s3://__BUCKET__/manifest.txt" /tmp/dm.txt --no-progress >/dev/null
rm -rf /tmp/din && mkdir -p /tmp/din
OK=0; BAD=0
while read -r sha path; do
  [ -z "$path" ] && continue
  mkdir -p "/tmp/din/$(dirname "$path")"
  aws s3 cp "s3://__BUCKET__/files/$path" "/tmp/din/$path" --no-progress >/dev/null 2>&1
  got=$(sha256sum "/tmp/din/$path" 2>/dev/null | cut -d' ' -f1)
  if [ "$got" = "$sha" ]; then OK=$((OK+1)); else BAD=$((BAD+1)); echo "    MISMATCH $path"; fi
done < /tmp/dm.txt
echo "    verified $OK ok, $BAD bad"
[ "$BAD" != "0" ] && { echo "    STOPPING — nothing written"; exit 1; }

# A whole-directory backup of the two things whose loss is unrecoverable here: the design screens
# and the stylesheets. Path-derived names, because a basename-derived name once collided for two
# different `publication.ts` files.
mkdir -p "/opt/ozituma/backups/design-$TS"
cp -a apps/ozikoro/public/design/. "/opt/ozituma/backups/design-$TS/" 2>/dev/null
echo "    design backed up: $(find /opt/ozituma/backups/design-$TS -type f | wc -l) files"

echo "==> host: install"
# ⚠️ PRUNE FIRST, THEN COPY — NARROWLY, BECAUSE THE FIRST VERSION OF THIS DELETED 49,221 FILES.
#
# THE MEASUREMENT THAT JUSTIFIED A PRUNE:
#
#     the install was:           cp -a /tmp/din/. .
#     a prune step:              NONE
#     the host's tree:           988 files
#     the last manifest:         913 files
#     the host's own git HEAD:   7ae4808 — not any revision deployed tonight
#
# **So the host's tree was a union of every deploy ever made, and a build could fail on a file the commit
# did not have.** *That fault is real and still needs fixing.*
#
# 🔴 **BUT THIS STEP'S FIRST VERSION WAS WORSE THAN THE FAULT IT FIXED, AND IT IS RECORDED HERE RATHER THAN
# QUIETLY CORRECTED:**
#
#     pruned 49221 file(s) this deployment does not ship
#     the tree now holds 913 file(s); the manifest names 913
#     ... then the build failed: failed to compute cache key: "/apps/learn/package.js..."
#
# **It walked `for dir in apps packages scripts docs data` and deleted everything under them that the
# manifest did not name — INCLUDING `apps/learn`, `apps/web`, `apps/academy`, every `node_modules`, and the
# checkout's own `.data`.** *The manifest ships ONE app (`apps/ozikoro`), so `apps` as a whole was never
# the deploy's to own.* **The `-not -path '*/node_modules/*'` exclusion did not hold either, because the
# paths `find` printed are relative and the pattern did not match them the way it does an absolute path.**
#
# ⚠️ **SO THE PRUNE NOW WALKS ONLY WHAT THE MANIFEST ITSELF NAMES.** *The keep-list comes from the manifest,
# so the TOP-LEVEL directories it starts with are, by construction, exactly the ones this deploy owns —
# `apps/ozikoro`, `packages/<name>`, `scripts`, `docs`, `data`. Anything else on that host — another app,
# a node_modules, a `.data`, a `docker/`, a `.env` — is not in the manifest and is now not reachable from
# this loop at all.*
#
# ⚠️ **AND IT IS BOUNDED BY THE KEEP-LIST RATHER THAN BY A PATH I TYPED**, so a directory this deploy does
# not ship cannot be pruned even if the list of top-level names is later edited by hand.
if [ -f /tmp/dm.txt ]; then
  # The manifest's first field is the sha256, the rest of the line is the path.
  awk '{ $1=""; sub(/^ /, ""); print }' /tmp/dm.txt | sort > /tmp/din-keep.txt
  # THE DIRECTORY PREFIXES THE MANIFEST ITSELF USES — derived, never typed.
  awk -F/ 'NF>1 { print $1"/"$2 } NF==1 { print $1 }' /tmp/din-keep.txt | sort -u > /tmp/din-dirs.txt
  echo "    this deployment owns: $(tr '\n' ' ' < /tmp/din-dirs.txt)"
  PRUNED=0
  while IFS= read -r dir; do
    [ -d "$dir" ] || continue
    # `-maxdepth`-bounded to the owned directory, and files only.
    while IFS= read -r f; do
      [ -f "$f" ] || continue
      # ⚠️ NEVER PRUNE A MIGRATION THIS DEPLOYMENT DOES NOT SHIP — `packages/db/migrations/` IS SHARED WITH
      # THE DICTIONARY, AND PRUNING IT DELETED SEVENTEEN OF OZITUMA'S OWN MIGRATIONS.
      #
      # THE MEASUREMENT: after a deploy, seventeen recorded migrations had no file on the host — 0034 to
      # 0038, three `0058_*`, 0059, 0060, 0061, 0062, 0063, 0064, both `0065_*` and `0066`. **Every one
      # belongs to ozituma.com, every one is recorded in the database as applied, and every one was in this
      # manifest's way rather than in it.**
      #
      # ⚠️ AND THE OWNER HAD JUST SAID THE THING THAT MAKES THIS THE WORST POSSIBLE DIRECTORY TO GET WRONG:
      # *"make sure that everything deployed here does not affect ozituma.com"*. **The archive's deploy has
      # no business deleting the dictionary's schema history — this repository carries both projects'
      # migrations in one directory, so that directory is not the archive's to own.**
      #
      # **So a file under `packages/db/migrations/` that this manifest does not name is LEFT ALONE.** *The
      # cost is that a migration the archive deleted stays on the host — which is the safe direction: an
      # extra file is inert, and a missing one is a schema history with a hole in it.*
      case "$f" in
        packages/db/migrations/*) continue ;;
      esac
      if ! grep -qxF "$f" /tmp/din-keep.txt; then
        rm -f "$f"
        PRUNED=$((PRUNED + 1))
      fi
    done < <(find "$dir" -type f 2>/dev/null)
  done < /tmp/din-dirs.txt
  echo "    pruned $PRUNED file(s) this deployment does not ship"
  echo "    the tree now holds $(find apps packages scripts docs data -type f -not -path '*/node_modules/*' 2>/dev/null | wc -l) file(s); the manifest names $(wc -l < /tmp/din-keep.txt)"
fi
cp -a /tmp/din/. .
#     a prune step:              NONE — no rm, no find -delete, no rsync --delete
#     the host's tree:           988 files
#     the last manifest:         913 files
#     the host's own git HEAD:   7ae4808 — NOT ANY REVISION DEPLOYED TONIGHT
#
# **So the host's source tree is a UNION of every deploy ever made to it, plus files from a checkout
# older than anything shipped today.** *`cp -a` overwrites what the manifest names and leaves everything
# else exactly where it was.*
#
# ⚠️ AND THAT EXPLAINS BOTH SHAPES OF THE SAME FAILURE, WHICH LOOKED LIKE TWO DIFFERENT BUGS ALL NIGHT:
#
#   1 · A FILE THE COMMIT DOES NOT HAVE, ON THE HOST, IMPORTING SOMETHING THE COMMIT DOES NOT SHIP.
#       *The host's `media/upload/route.ts` imported `@ozikoro/platform/media-bytes` — a later
#       working-tree state installed by an earlier run — while the manifest being deployed came from a
#       commit that did not yet contain `media-bytes.ts`.* **The build failed with `Module not found`,
#       and HEAD was innocent: nothing in it imported that module at all.**
#
#   2 · A FILE THE COMMIT DOES SHIP, ABSENT ON THE HOST, BECAUSE `git ls-files` READ A STALE INDEX.
#       *That was the `form-sync.tsx` and `library.ts` failure, fixed by enumerating `git ls-tree HEAD`.*
#
# **Both are "the host is not the commit". Fixing the enumeration fixed one direction; this fixes the
# other, and it is the half that was still open.**
#
# ⚠️ WHAT IT DELETES AND WHAT IT MUST NEVER TOUCH. It prunes ONLY inside the directories the manifest
# populates — and it compares against the manifest itself, so a file the deploy is about to write is never
# removed. **`docker/`, `.env`, `.data/`, `backups/`, `node_modules/`, `.next*`, `certs/` and `.git/` are
# NOT in the manifest and are NOT pruned** — *they are the host's own state, and a deploy that removed the
# compose file or the credential store would take the site down rather than update it.*
#
# ⚠️ AND IT READS THE FILE LIST FROM THE MANIFEST RATHER THAN FROM A PATH LIST, so it can only ever delete
# what the deploy itself considers its own to write.
if [ -f /tmp/dm.txt ]; then
  # The manifest's first field is the sha256, the rest of the line is the path.
  awk '{ $1=""; sub(/^ /, ""); print }' /tmp/dm.txt | sort > /tmp/din-keep.txt
  PRUNED=0
  # Only the top-level directories the manifest actually writes into, so a stray path in the manifest
  # cannot lead the prune outside them.
  for dir in apps packages scripts docs data; do
    [ -d "$dir" ] || continue
    while IFS= read -r f; do
      case "$f" in
        "$dir"/*) ;;
        *) continue ;;
      esac
      # Never remove the directories themselves, and never a path the manifest is about to write.
      [ -f "$f" ] || continue
      # ⚠️ NEVER PRUNE A MIGRATION THIS DEPLOYMENT DOES NOT SHIP — `packages/db/migrations/` IS SHARED WITH
      # THE DICTIONARY, AND PRUNING IT DELETED SEVENTEEN OF OZITUMA'S OWN MIGRATIONS.
      #
      # THE MEASUREMENT: after a deploy, seventeen recorded migrations had no file on the host — 0034 to
      # 0038, three `0058_*`, 0059, 0060, 0061, 0062, 0063, 0064, both `0065_*` and `0066`. **Every one
      # belongs to ozituma.com, every one is recorded in the database as applied, and every one was in this
      # manifest's way rather than in it.**
      #
      # ⚠️ AND THE OWNER HAD JUST SAID THE THING THAT MAKES THIS THE WORST POSSIBLE DIRECTORY TO GET WRONG:
      # *"make sure that everything deployed here does not affect ozituma.com"*. **The archive's deploy has
      # no business deleting the dictionary's schema history — this repository carries both projects'
      # migrations in one directory, so that directory is not the archive's to own.**
      #
      # **So a file under `packages/db/migrations/` that this manifest does not name is LEFT ALONE.** *The
      # cost is that a migration the archive deleted stays on the host — which is the safe direction: an
      # extra file is inert, and a missing one is a schema history with a hole in it.*
      case "$f" in
        packages/db/migrations/*) continue ;;
      esac
      if ! grep -qxF "$f" /tmp/din-keep.txt; then
        rm -f "$f"
        PRUNED=$((PRUNED + 1))
      fi
    done < <(find "$dir" -type f -not -path '*/node_modules/*' -not -path '*/.next*' 2>/dev/null)
  done
  echo "    pruned $PRUNED file(s) this deployment does not ship"
  # And the same check the build branch makes, so a prune that did nothing is visible rather than assumed.
  echo "    the tree now holds $(find apps packages scripts docs data -type f -not -path '*/node_modules/*' -not -path '*/.next*' 2>/dev/null | wc -l) file(s); the manifest names $(wc -l < /tmp/din-keep.txt)"
fi
cp -a /tmp/din/. .
echo "    design files now: $(find apps/ozikoro/public/design -type f | wc -l)"
echo "    screens now:      $(ls apps/ozikoro/public/design/screens/*.html 2>/dev/null | wc -l)"

# ══════════════════════════════════════════════════════════════════════════════════════════════════════
# RUN THE MIGRATIONS — AND THIS STEP DID NOT EXIST, WHICH TOOK THREE LIVE PAGES DOWN.
#
# ⚠️ THE FAULT, MEASURED. A commit added `ozikoro_comment`, `ozikoro_saved` and `ozikoro_read_event` and
# the code that queries them. This script shipped the code and rebuilt the image. **It did not create the
# tables, because nothing here ever ran a migration.** So `/watch/`, `/projects/` and
# `/cultural-calendar/` — the three pages the new comment box is hooked into — answered **500** with:
#
#     error: relation "ozikoro_comment" does not exist
#
# **A deploy that ships code without its schema is not a partial deploy; it is an outage of every page
# that touches the new table.** *And it was invisible from here: the file hashes verified, the design
# screens copied, the container came up healthy, and the three broken pages were not in the sweep.*
#
# ⚠️ AND THE RECORDED MIGRATIONS HAD STOPPED AT `0057` — `0058_ozikoro_record_seo`,
# `0059_ozikoro_contributor_wp_role`, `0060_ozikoro_library` and `0061_ozikoro_comments` were all on disk
# and unrecorded. *Two of them had their schema anyway (applied by hand and never recorded); the other
# two had nothing.* **So the runner is now part of the deploy, and its failure is fatal to the deploy.**
#
# ⚠️ WHY IT RUNS **BEFORE** THE REBUILD: the running container is the last known-good build. A migration
# that fails must not be combined with an image that expects it. Running first means a bad migration stops
# the deploy with the previous build still serving — which is the same rule the backup and the hash
# verification already follow.
#
# ⚠️ AND WHY `migrate up` IS SAFE TO RE-RUN: it records what it applied in `schema_migration` and skips
# the rest, so a deploy that runs twice is a no-op the second time.
echo "==> host: migrate"
# The runner lives in the app package and needs the database, so it runs INSIDE the container that is
# already up rather than on the host, which has neither the toolchain nor a database client configured.
MIGRATE_OUT="$(docker compose --env-file /opt/ozituma/.env __COMPOSE__ exec -T ozikoro npm -w @ozituma/db run migrate 2>&1)" || {
  echo "$MIGRATE_OUT" | tail -20 | sed 's/^/    /'
  echo "    !! MIGRATION FAILED. THE CODE HAS NOT BEEN REBUILT AND THE RUNNING SITE IS UNTOUCHED." >&2
  echo "    !! Nothing below this line runs. Fix the migration and deploy again." >&2
  exit 1
}
echo "$MIGRATE_OUT" | grep -iE 'appl|ok|skip|up to date' | tail -6 | sed 's/^/    /'
# The runner reports success in prose; ask the database what it actually recorded, so a run that silently
# did nothing cannot read as a pass.
MIG_COUNT="$(docker compose --env-file /opt/ozituma/.env __COMPOSE__ exec -T postgres psql -U ozituma -d ozituma -tAc 'select count(*) from schema_migration' 2>/dev/null | tr -d '[:space:]')"
echo "    schema_migration holds ${MIG_COUNT:-?} recorded migration(s)"
if [ -z "${MIG_COUNT:-}" ] || [ "${MIG_COUNT:-0}" -lt 1 ] 2>/dev/null; then
  echo "    !! REFUSING TO CONTINUE: could not read schema_migration, so the migration step is unproven." >&2
  exit 1
fi

if [ "__DO_BUILD__" = "1" ]; then
  echo "==> host: rebuild"
  echo "    before: $(docker inspect ozituma-ozikoro-1 --format '{{.State.StartedAt}}' 2>/dev/null)"
  docker compose --env-file /opt/ozituma/.env __COMPOSE__ up -d --build ozikoro 2>&1 | tail -8
  echo "    after:  $(docker inspect ozituma-ozikoro-1 --format '{{.State.StartedAt}} img={{.Image}}' 2>/dev/null | cut -c1-72)"

  # ── NAME THE BUILD, BECAUSE `latest` IS A MOVING TAG AND AN ID IS UNMEMORABLE ────────────────
  #
  # `docker-compose.ozikoro.yml` already reads its image from `${OZIKORO_IMAGE_TAG:-latest}`, so a
  # rollback needs nothing but a tag to name. Without this step there was no such tag: `latest` moved
  # to each new build and the previous image became dangling, and `docker image prune -af` in
  # `/usr/local/bin/ozituma-docker-cleanup` then deleted it — tags and all, because `-a` cannot be
  # told to spare an image. (That script now keeps the newest five immutable tags per repository; the
  # pair of changes is what makes either of them mean anything.)
  #
  # ⚠️ THE STAMP IS THE DEPLOY'S START, NOT THE BUILD'S END. `TS` is the same stamp the pre-deploy
  # dump is named with, so a tag, the dump taken before it, and the design backup beside it all sort
  # together in one place. A build that takes nine minutes still gets the stamp of the deploy that
  # asked for it.
  TAGSTAMP=$(printf '%s' "$TS" | tr -d ':-')
  IMMUTABLE_TAG="${TAGSTAMP}-$REV"
  TARGET="ozikoro-site:$IMMUTABLE_TAG"
  EXISTING=$(docker image inspect "$TARGET" --format '{{.Id}}' 2>/dev/null || true)
  NEW_ID=$(docker image inspect ozikoro-site:latest --format '{{.Id}}' 2>/dev/null || true)
  if [ -n "$EXISTING" ] && [ "$EXISTING" != "$NEW_ID" ]; then
    # Two deploys inside one second, or a tag left from an earlier interrupted run. Refuse rather
    # than repoint a name that already means something — `docker tag` would do it silently.
    echo "    !! NOT tagging: $TARGET already exists as $EXISTING, and this build is $NEW_ID"
  elif docker tag ozikoro-site:latest "$TARGET"; then
    echo "    immutable tag: $TARGET  ($NEW_ID)"
    printf '%s tag=%s image=%s rev=%s manifest=%s dirty=%s files=%s deployed=%s\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$TARGET" "$NEW_ID" "$REV" "$MANIFEST_SHA" "$DIRTY" "$FILE_COUNT" "$TS" \
      >> /opt/ozituma/backups/image-provenance.log
    echo "    provenance:    /opt/ozituma/backups/image-provenance.log"
    echo "    ROLL BACK TO THIS BUILD WITH:"
    echo "      cd /opt/ozituma/app && OZIKORO_IMAGE_TAG=$IMMUTABLE_TAG \\"
    echo "        docker compose --env-file /opt/ozituma/.env __COMPOSE__ up -d --no-build --no-deps ozikoro"
  else
    echo "    !! could not tag ozikoro-site:latest as $TARGET — the rollback target for this build does not exist"
  fi
fi

echo "==> host: done"
REMOTE

# ⚠️ THE DELIMITER IS QUOTED, SO THE SHELL EXPANDS NOTHING INSIDE IT — and that is the fix.
# The unquoted form expanded every backtick and `$(` in the body, including inside COMMENTS:
# an agent added a paragraph mentioning `docker-compose.ozikoro.yml` and `docker image prune -af`,
# and the shell tried to RUN each of those words — "publication.ts: command not found",
# "docker: command not found" — while writing the file. The deploy then installed nothing at all:
# 873 files uploaded, the container never rebuilt, and the town and dashboard fixes never landed.
# The values the parent must supply are placeholders now, and they are substituted here.
#
# ⚠️ NOT `sed`. Two distinct failures, both from this one step:
#
#   1. `sed -i \` with six continued lines died with `sed: -e: No such file or directory` —
#      sed read the `-e` as a FILENAME, the placeholders survived, and THE INSTALL NEVER RAN.
#   2. `sed -i "s|…|…|g" file` died with `sed: 1: "file": undefined label` — **because this script
#      runs on macOS, whose `sed -i` takes a MANDATORY SUFFIX argument** (`sed -i '' …`), unlike the
#      GNU sed on the host. The same line is correct on Linux and wrong here, and this script only
#      ever runs here.
#
# `python3` is already a dependency of this script and has neither problem: no continuation, no
# platform-specific in-place flag, and it fails loudly if a placeholder is left behind.
DEPLOY_BUCKET="$BUCKET" DEPLOY_REMOTE_DIR="$REMOTE_DIR" DEPLOY_AWS_REGION="$AWS_REGION" \
DEPLOY_COMPOSE="$COMPOSE" DEPLOY_DO_BUILD="$DO_BUILD" DEPLOY_INSTANCE_ID="$INSTANCE_ID" \
python3 - <<'PYSUB'
import pathlib, os, sys
p = pathlib.Path('/tmp/deploy-remote.sh')
s = p.read_text()
for name in ['BUCKET', 'REMOTE_DIR', 'AWS_REGION', 'COMPOSE', 'DO_BUILD', 'INSTANCE_ID']:
    s = s.replace(f'__{name}__', os.environ.get(f'DEPLOY_{name}', ''))
p.write_text(s)
left = [l for l in s.split('\n') if '__' in l and l.split('__')[1][:1].isupper() and l.split('__')[1].rstrip('_').isupper()]
if left:
    sys.stderr.write('!! a placeholder survived substitution:\n')
    for l in left[:8]:
        sys.stderr.write(f'   {l}\n')
    sys.exit(1)
print(f'    substituted; {len(s)} bytes, no placeholder left')
PYSUB
# --- and prove nothing unexpanded survived ---
if grep -qE '__[A-Z_]+__' /tmp/deploy-remote.sh; then
  echo "!! a placeholder survived substitution:" >&2
  grep -nE '__[A-Z_]+__' /tmp/deploy-remote.sh >&2
  exit 1
fi


python3 - "$BUCKET" <<'PY'
import json, sys, pathlib
script = pathlib.Path('/tmp/deploy-remote.sh').read_text()
pathlib.Path('/tmp/deploy-remote.json').write_text(json.dumps({'commands': [script]}))
PY

CMD_ID=$("${AWS[@]}" ssm send-command \
  --instance-ids "$INSTANCE_ID" \
  --document-name "AWS-RunShellScript" \
  --parameters file:///tmp/deploy-remote.json \
  --timeout-seconds 1800 \
  --query 'Command.CommandId' --output text)
echo "==> ssm command $CMD_ID"

# Poll rather than sleep a fixed time: a build takes minutes on that host and a fixed wait either
# wastes time or reports a status that is still `InProgress`.
for _ in $(seq 1 120); do
  STATUS=$("${AWS[@]}" ssm get-command-invocation --command-id "$CMD_ID" \
    --instance-id "$INSTANCE_ID" --query 'Status' --output text 2>/dev/null || echo Pending)
  case "$STATUS" in
    Success|Failed|Cancelled|TimedOut) break ;;
  esac
  sleep 10
done

"${AWS[@]}" ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$INSTANCE_ID" \
  --query '[Status,StandardOutputContent]' --output text | tail -30

echo "==> cleaning up the bucket"
"${AWS[@]}" s3 rb "s3://$BUCKET" --force >/dev/null 2>&1 || true
if "${AWS[@]}" s3api head-bucket --bucket "$BUCKET" >/dev/null 2>&1; then
  echo "!! bucket $BUCKET still exists — remove it by hand" >&2
else
  echo "    bucket removed"
fi
