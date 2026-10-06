#!/bin/sh
#
# The host's `/usr/local/bin/ozituma-docker-cleanup`, version-controlled here.
#
# ── WHY IT EXISTS AT ALL ────────────────────────────────────────────────────────────────────────
#
# Docker's build cache and superseded images grew to 96 GB on a 40 GB disk. The first symptom was
# not a warning but a failed build: `npm ci` died with ENOSPC, which reads like a package problem
# rather than a full disk — and a full disk also puts Postgres at risk. So this runs on its own
# rather than depending on somebody noticing, and it warns before it becomes critical.
#
# ── WHY A TAG DID NOT SURVIVE UNTIL THIS SCRIPT KNEW ABOUT IT ───────────────────────────────────
#
# The version this replaced ended with:
#
#     docker image prune -af
#
# **`-a` is the whole problem, and it is not obvious from the flag's name.** Without `-a`, `docker
# image prune` removes only *dangling* images — the untagged ones. With `-a` it removes every image
# that is not used by a container, **tagged or not**. A name is not a defence. So naming an image
# `ozikoro-site:<date>` would have achieved precisely nothing on its own: the moment `latest` moved
# to a new build, the old image had no container, and the next `prune -af` deleted it by name.
#
# Measured on the host, 2026-10-06, before this change: `docker images` held
#
#     ozikoro-site:latest        886ed773b44b   2026-10-06 03:29:20Z   ← running
#     <none>:<none>              d0264e81e3a9   2026-10-06 03:00:09Z   ← the build before it
#     <none>:<none>              b0b4486bd639   2026-10-06 02:49:53Z
#     <none>:<none>              3370c99ba2d5   2026-10-06 02:07:33Z
#
# Each of those three was the archive — `docker image inspect` reports
# `com.docker.compose.service=ozikoro` and `Cmd=["node","apps/ozikoro/server.js"]` — and each had
# already lost its name. The owner deployed nine times in one night and could not once have said
# "give me the image from before that".
#
# ── THE POLICY, EXPRESSED ONCE, AS A KEEP SET ───────────────────────────────────────────────────
#
# There is no `docker image prune` here at all, because the flag that would matter does not exist:
# `prune -a` cannot be told to spare an image. Instead the script computes what to KEEP and removes
# exactly the images outside that set:
#
#     keep = the newest RETAIN_IMMUTABLE immutable tags per known repository
#          ∪ every image a container references (running or stopped)
#
#   * `docker image rm` is used and `-f` never is, so an image in use is refused by Docker itself
#     rather than by a list this script maintains. **The image a running container is on is never
#     touched** — and that includes the academy's, whose service is no longer in the project's
#     compose file and which is therefore an orphan nothing else here protects.
#   * Every failure is swallowed. A retention rule that cannot run must not take the cleanup down
#     with it, because this script's other job is to stop the disk filling.
#   * Naming comes first: an unnamed archive image is given a name derived from its own `Created`
#     field, so a build from before this change is still something that can be named and returned to.
#
# ── WHAT THIS DELETES COMPARED WITH THE VERSION IT REPLACED ─────────────────────────────────────
#
# **Strictly less.** The old `prune -af` removed every image with no container; this removes every
# such image except the newest RETAIN_IMMUTABLE per known repository. Nothing that survives the old
# cleanup can fail to survive this one.
#
# ── INSTALLATION ────────────────────────────────────────────────────────────────────────────────
#
#     scripts/install-host-ops.sh          # installs this to /usr/local/bin/ozituma-docker-cleanup
#
# and the existing unit runs it: `ozituma-docker-cleanup.timer`, every 6 hours, OnBootSec=15min.
#
set -u

# How many immutable tags to keep per repository. Five is a stated number and not a default anyone
# should have to guess: the base layers are shared across every archive build, so `docker images`'
# per-image figure overstates the marginal cost — measured with `docker system df`, all 8 images on
# the host together were 1.859 GB. Override with RETAIN_IMMUTABLE=<n> for a different window.
RETAIN_IMMUTABLE="${RETAIN_IMMUTABLE:-5}"

# A repository is only "visible" to this script if it is named here. The list is deliberately short:
# an image in a repository this script does not know about is not something it can judge, and
# guessing would be worse than leaving it alone.
REPOS="ozikoro-site ozituma-web ozikoro-academy"

# ── HELPERS ─────────────────────────────────────────────────────────────────────────────────────

# The compose label that says which application an image belongs to. It is used instead of guessing
# from the size or the creation time, because d0264e81e3a9 is 693 MB and 7eab2b81e81c is 691 MB, and
# only the label distinguishes them.
service_of() {
  docker image inspect "$1" --format '{{index .Config.Labels "com.docker.compose.service"}}' 2>/dev/null
}

# `2026-10-06T03:29:20.252846205Z` -> `20261006T032920Z`. The image's own `Created`, so the tag names
# when the image was built rather than when this script happened to run.
stamp_of() {
  printf '%s' "$1" | sed -E 's/^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2}).*/\1\2\3T\4\5\6Z/'
}

# Does this image already carry an immutable tag under `$2`? Asked of the image, not of a file, so a
# re-run adds nothing.
has_immutable_tag() {
  docker image inspect "$1" --format '{{range .RepoTags}}{{println .}}{{end}}' 2>/dev/null \
    | grep -qE "^$2:20[0-9]{6}T[0-9]{6}Z"
}

# Name one image, refusing to move a name that already points somewhere else. `docker tag a b` where
# `b` exists repoints it silently, and two images built in the same minute would otherwise trade
# names on every run — which is exactly the kind of quiet repointing this project keeps paying for.
name_image() {
  id="$1"; repo="$2"; stamp="$3"
  [ -n "$id" ] || return 0
  [ -n "$stamp" ] || return 0
  target="$repo:$stamp"
  existing="$(docker image inspect "$target" --format '{{.Id}}' 2>/dev/null || true)"
  if [ -n "$existing" ] && [ "$existing" != "$id" ]; then
    logger -t ozituma-docker-retention "NOT naming $id as $target — that name already points at $existing"
    echo "retention: NOT naming $(printf '%s' "$id" | cut -c1-19) as $target — already taken by $(printf '%s' "$existing" | cut -c1-19)"
    return 0
  fi
  if docker tag "$id" "$target" 2>/dev/null; then
    logger -t ozituma-docker-retention "named $(printf '%s' "$id" | cut -c1-19) as $target"
    echo "retention: named $(printf '%s' "$id" | cut -c1-19) as $target"
  fi
}

echo "retention: keeping the newest $RETAIN_IMMUTABLE immutable tag(s) per repository"

# ── 1. NAME WHAT HAS NO NAME ────────────────────────────────────────────────────────────────────
#
# Two sources, because the running image keeps its `latest` tag and the superseded ones do not.
#
# (a) `latest` for each known repository. This is the one that matters after a restart: it makes sure
#     the image currently serving has a name that is not `latest`.
# (b) every dangling image whose compose service label maps to a known repository. This is the
#     backfill for builds made before this script existed, and it is what rescues d0264e81e3a9,
#     b0b4486bd639 and 3370c99ba2d5 from the next removal.
for repo in $REPOS; do
  id="$(docker image inspect "$repo:latest" --format '{{.Id}}' 2>/dev/null || true)"
  if [ -n "$id" ] && ! has_immutable_tag "$id" "$repo"; then
    created="$(docker image inspect "$id" --format '{{.Created}}' 2>/dev/null || true)"
    name_image "$id" "$repo" "$(stamp_of "$created")"
  fi
done

docker images --no-trunc --filter dangling=true --format '{{.ID}}' 2>/dev/null | while IFS= read -r id; do
  [ -n "$id" ] || continue
  case "$(service_of "$id")" in
    ozikoro) repo=ozikoro-site ;;
    web)     repo=ozituma-web ;;
    *)       continue ;;
  esac
  has_immutable_tag "$id" "$repo" && continue
  created="$(docker image inspect "$id" --format '{{.Created}}' 2>/dev/null || true)"
  name_image "$id" "$repo" "$(stamp_of "$created")"
done

# ── 2. KEEP: THE RETAINED WINDOW ────────────────────────────────────────────────────────────────
#
# `sort -r` on `CreatedAt` puts the newest first, so `head -n N` is the window. Only tags of the
# immutable shape are considered, which is what keeps `latest` — and any human-chosen name — out of
# this arithmetic entirely: a repository whose `latest` is the only tag it has yields no ids here,
# and its image survives because a container references it.
ALL_IDS="$(mktemp)"
KEEP_IDS="$(mktemp)"
trap 'rm -f "$ALL_IDS" "$KEEP_IDS"' EXIT

docker image ls -a --no-trunc --format '{{.ID}}' 2>/dev/null | sort -u > "$ALL_IDS"

for repo in $REPOS; do
  docker images "$repo" --no-trunc --format '{{.CreatedAt}}|{{.ID}}|{{.Tag}}' 2>/dev/null \
    | grep -E '\|20[0-9]{6}T[0-9]{6}Z(-[0-9a-f]+)?$' \
    | sort -r \
    | head -n "$RETAIN_IMMUTABLE" \
    | cut -d'|' -f2
done | sort -u > "$KEEP_IDS"

# ── 2b. KEEP: ANYTHING A CONTAINER REFERENCES ───────────────────────────────────────────────────
#
# Belt and braces — `docker image rm` would refuse these anyway — but it keeps the log honest about
# what was deliberately spared, and it covers the container whose service is no longer in the compose
# file. The academy is exactly that case: `ozituma-academy-1` is an orphan of this project's config,
# it is live, and nothing else here protects its image.
docker ps -a --format '{{.Image}}' 2>/dev/null | while IFS= read -r ref; do
  [ -n "$ref" ] || continue
  docker image inspect "$ref" --format '{{.Id}}' 2>/dev/null || true
done | sort -u >> "$KEEP_IDS"

# ── 3. REMOVE WHAT IS NEITHER ───────────────────────────────────────────────────────────────────
#
# The build cache is a separate store from the image layers, so clearing it cannot take a retained
# image with it — and it is what reached 96 GB, so it stays cleared.
docker builder prune -af >/dev/null 2>&1 || true

kept=0
considered=0
protected=0
while IFS= read -r id; do
  [ -n "$id" ] || continue
  if grep -qxF "$id" "$KEEP_IDS"; then
    kept=$((kept + 1))
    continue
  fi

  # ── A NAME SOMEBODY ELSE CHOSE IS NOT THIS SCRIPT'S TO REMOVE ─────────────────────────────────
  #
  # The host is worked on by more than one operator, and on 2026-10-06 that stopped being
  # theoretical: while this round was in progress, tags of the shape
  # `ozikoro-site:pre-backup-20261006T040000Z-607e0ac` appeared on the same images, written by a
  # concurrent session's own pre-deploy step. **Those are not this window's tags and this script does
  # not count them — so without this check it would have removed the image underneath one as soon as
  # it fell outside the newest five.**
  #
  # The rule is therefore narrower than "outside the window": an image is removable only if every tag
  # it carries is this project's immutable stamp shape. `latest` counts as foreign, and that is
  # deliberate — a rollback retags `latest` onto an older image, and an image being pointed at by
  # `latest` must not be deleted out from under that decision.
  tags="$(docker image inspect "$id" --format '{{range .RepoTags}}{{println .}}{{end}}' 2>/dev/null || true)"
  if [ -n "$tags" ] && printf '%s\n' "$tags" \
       | grep -qvE ':20[0-9]{6}T[0-9]{6}Z(-[0-9a-f]+)?$'; then
    protected=$((protected + 1))
    kept=$((kept + 1))
    continue
  fi

  considered=$((considered + 1))
  # Remove by TAG, not by id. Docker refuses `docker image rm <id>` for an image referenced by more
  # than one repository ("must be forced"), and `-f` is what would let a mistake reach a live image —
  # so the tags go one at a time and the image goes when its last tag does. An image with no tags at
  # all is removed by id, which is the only handle it has.
  if [ -n "$tags" ]; then
    printf '%s\n' "$tags" | while IFS= read -r t; do
      [ -n "$t" ] || continue
      docker rmi "$t" >/dev/null 2>&1 || true
    done
  else
    docker rmi "$id" >/dev/null 2>&1 || true
  fi
done < "$ALL_IDS"

echo "retention: $kept image(s) kept (retained window, referenced by a container, or named by somebody else; $protected of them only for the last reason); $considered offered for removal"

# What is left, so the log answers "what can I roll back to" without a shell on the box.
for repo in $REPOS; do
  echo "retention: $repo now holds:"
  docker images "$repo" --format '  {{.Tag}}  {{.ID}}  {{.CreatedAt}}' 2>/dev/null | head -n 12
done

used=$(df --output=pcent / | tail -1 | tr -d ' %')
free=$(df -h --output=avail / | tail -1 | tr -d ' ')
if [ "${used:-0}" -ge 90 ]; then
  logger -t ozituma-disk "CRITICAL: root filesystem ${used}% full, ${free} free"
elif [ "${used:-0}" -ge 80 ]; then
  logger -t ozituma-disk "warning: root filesystem ${used}% full, ${free} free"
fi
exit 0
