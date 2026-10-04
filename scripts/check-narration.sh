#!/usr/bin/env bash
#
# THE RULES OF THE NARRATION PIPELINE, AS CHECKS RATHER THAN AS INTENTIONS.
#
# WHY THIS EXISTS
#
# Four rules hold this workflow together, and every one of them is the kind that survives review and rots in a
# later commit:
#
#   1. A PROPOSAL MUST NOT BE ABLE TO SPEND. It is enforced by structure — `proposeNarration` imports no API
#      client and nothing that could reach one — **because a rule that lives in a comment is a rule the next
#      edit is free to break silently.** If someone adds a `fetch` there, the credits start going without a
#      human ever seeing a script, and nothing else in this repository would notice.
#   2. THERE MUST BE ONE RENDER PATH. `speak` is the only thing that costs money. A second caller — a new
#      route, a helper, a copy of the loop — is a way around the approval gate, and this project has already
#      paid for that mistake once: `prepare-episode.ts` had its own renderer, it did not chunk, and an
#      11,000-character record failed there while the route beside it handled the same article.
#   3. EVERY ENDPOINT THAT TOUCHES NARRATION MUST ASK FOR A CAPABILITY FIRST. A route that forgets is a route
#      anyone signed in can use, and `capability-check` cannot see a MISSING call site.
#   4. THE PLAYER APPEARS ONLY FOR A PUBLISHED EPISODE. This is the owner's requirement verbatim — before
#      approval the article carries no audio and no player at all — and it is one `where` clause away from
#      being wrong.
#
# The first four are static, so they run anywhere. The database invariants run through
# `scripts/narration-review.ts check`, which needs the PGlite cluster to itself. The live check needs a server
# and is skipped, loudly, when there is none.
#
# Usage: ./scripts/check-narration.sh [BASE_URL]
set -uo pipefail

cd "$(git rev-parse --show-toplevel)" || exit 2

BASE="${1:-http://127.0.0.1:3100}"
failed=0
checked=0

echo ""
echo "  Narration pipeline checks"

# ---------------------------------------------------------------------------------------------------------
# 1. A PROPOSAL CANNOT SPEND
# ---------------------------------------------------------------------------------------------------------
checked=$((checked + 1))
# The patterns are the three ways a charge could be reached: an HTTP call, the API host, or the client module.
# **Comments mention ElevenLabs by name and that is fine** — what is forbidden is a way to CALL it.
if grep -nE "fetch\(|api\.elevenlabs\.io|require\(.*elevenlabs|from ['\"][^'\"]*elevenlabs" \
     packages/ozikoro/src/narration.ts > /tmp/dsh-narration-reach.txt 2>/dev/null; then
  echo "  FAIL  the proposal module can reach the API — a proposal could spend credits:" >&2
  sed 's/^/          /' /tmp/dsh-narration-reach.txt >&2
  failed=$((failed + 1))
else
  echo "  PASS  proposeNarration imports no API client and makes no HTTP call"
fi

# ---------------------------------------------------------------------------------------------------------
# 2. ONE RENDER PATH
# ---------------------------------------------------------------------------------------------------------
checked=$((checked + 1))
# Only the definition and the one approved-render module may call it. The definition is excluded because it IS
# `speak`; anything else in the list is a second path to a charge.
SPEAK_CALLERS=$(grep -rln "speak(" --include='*.ts' apps/ozikoro scripts 2>/dev/null | grep -v 'node_modules' \
  | grep -v '^apps/ozikoro/lib/elevenlabs\.ts$' | grep -v '^apps/ozikoro/lib/render-episode\.ts$' || true)
if [ -n "$SPEAK_CALLERS" ]; then
  echo "  FAIL  speak() is called outside the one approved render module:" >&2
  printf '          %s\n' $SPEAK_CALLERS >&2
  failed=$((failed + 1))
else
  echo "  PASS  speak() is called from exactly one place: apps/ozikoro/lib/render-episode.ts"
fi

# ---------------------------------------------------------------------------------------------------------
# 3. EVERY NARRATION ENDPOINT ASKS FOR A CAPABILITY
# ---------------------------------------------------------------------------------------------------------
checked=$((checked + 1))
UNGATED=""
for route in $(find apps/ozikoro/app/api/podcast -name route.ts | sort); do
  # `guardNarration` is the shared guard; `can(` is the direct check the download route uses for a GET.
  # The 405 bodies that only explain the API answer GET/POST but still call the guard, so one either/or is
  # enough here — what is being caught is a file that checks nothing at all.
  if ! grep -qE "guardNarration\(|[^a-zA-Z]can\(" "$route"; then
    UNGATED="$UNGATED $route"
  fi
done
if [ -n "$UNGATED" ]; then
  echo "  FAIL  an endpoint under /api/podcast checks no capability:" >&2
  printf '          %s\n' $UNGATED >&2
  failed=$((failed + 1))
else
  echo "  PASS  every endpoint under /api/podcast asks for a capability"
fi

# ---------------------------------------------------------------------------------------------------------
# 4. THE DOWNLOAD IS AN ATTACHMENT, AND IT IS NOT UNGATED
# ---------------------------------------------------------------------------------------------------------
checked=$((checked + 1))
DOWNLOAD='apps/ozikoro/app/api/podcast/download/[slug]/route.ts'
if [ ! -f "$DOWNLOAD" ]; then
  echo "  FAIL  the raw download route is missing — the Spotify path has no door." >&2
  failed=$((failed + 1))
elif ! grep -q "content-disposition.*attachment" "$DOWNLOAD"; then
  echo "  FAIL  the download route does not set content-disposition: attachment." >&2
  failed=$((failed + 1))
else
  echo "  PASS  the raw MP3 downloads as an attachment, at any status"
fi

# ---------------------------------------------------------------------------------------------------------
# 5. THE PLAYER IS OFFERED ONLY FOR AN APPROVED EPISODE THAT HAS SOMETHING TO PLAY
#
# THIS CHECK WAS PASSING WHILE CHECKING NOTHING, AND THEN IT WAS FAILING FOR THE WRONG REASON.
#
# It grepped the article route for the literal `status = 'published'` — the episode gate written out at the
# call site. That clause now lives in `playableEpisodeSql`/`playableEpisodeAudioSql` in the platform package,
# where the article, the podcast feed and the transcript compose it, and the article route's only remaining
# `status = 'published'` is the ARTICLE's own filter. **So the old grep would have kept passing if the
# episode gate had been deleted from that file entirely.** Its second half grepped for `if (episode)`, a line
# the route had already stopped having — the player script is added under `if (directAudio)` — so the check
# also reported a fault that was not there.
#
# It asserts the SHARING now, in three places, because that is the property that stops the surfaces drifting:
# the article composes the shared floor, the listening library composes the same one, and the floor is itself
# composed from `playableEpisodeSql` rather than restating it. **A second place that decides "has audio" is
# the copy that drifts**, and this repository has paid for that four times.
# ---------------------------------------------------------------------------------------------------------
checked=$((checked + 1))
ARTICLE='apps/ozikoro/app/[slug]/route.ts'
LISTEN='apps/ozikoro/app/design-screen/[screen]/route.ts'
NARRATION='packages/ozikoro/src/narration.ts'
if ! grep -q "playableEpisodeAudioSql()" "$ARTICLE"; then
  echo "  FAIL  the article page does not compose the shared audio floor for its episode lookup." >&2
  failed=$((failed + 1))
elif ! grep -q "playableEpisodeAudioSql('e')" "$LISTEN"; then
  echo "  FAIL  the listen page does not compose the same floor — it is a second place deciding 'has audio'." >&2
  failed=$((failed + 1))
elif ! grep -q 'playableEpisodeSql(alias)' "$NARRATION"; then
  echo "  FAIL  playableEpisodeAudioSql no longer composes playableEpisodeSql — the floor is restated, not shared." >&2
  failed=$((failed + 1))
elif ! grep -q "if (directAudio)" "$ARTICLE"; then
  echo "  FAIL  the article page adds the player script without checking an episode exists." >&2
  failed=$((failed + 1))
else
  echo "  PASS  article and listen compose one audio floor; the player script follows the episode"
fi

# ---------------------------------------------------------------------------------------------------------
# 6. THE CAPABILITY THE OWNER ASKED FOR EXISTS, AND SOMEONE HOLDS IT
# ---------------------------------------------------------------------------------------------------------
checked=$((checked + 1))
if ! grep -rq "review_audio" packages/db/migrations/*.sql; then
  echo "  FAIL  no migration grants review_audio — an editor granted audio access has no way in." >&2
  failed=$((failed + 1))
else
  echo "  PASS  review_audio is granted in a migration"
fi

# ---------------------------------------------------------------------------------------------------------
# 7. THE DATABASE INVARIANTS
#
# PGlite is single-process, so this is skipped while a server holds the cluster rather than corrupting it.
# **A check that breaks the database it is checking is not a check.**
# ---------------------------------------------------------------------------------------------------------
checked=$((checked + 1))
if lsof -nP -iTCP:3100 -sTCP:LISTEN >/dev/null 2>&1 || lsof -nP -iTCP:3110 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "  SKIP  the database invariants — a server holds the PGlite cluster. Stop it and re-run."
elif ! node scripts/narration-review.ts check > /tmp/dsh-narration-db.txt 2>&1; then
  echo "  FAIL  the database invariants:" >&2
  sed 's/^/          /' /tmp/dsh-narration-db.txt >&2
  failed=$((failed + 1))
else
  echo "  PASS  database invariants ($(grep -c '^  PASS' /tmp/dsh-narration-db.txt) holding)"
fi

# ---------------------------------------------------------------------------------------------------------
# 8. THE GATE, OVER HTTP — skipped when nothing is serving
# ---------------------------------------------------------------------------------------------------------
checked=$((checked + 1))
if ! curl -s -o /dev/null --max-time 10 "$BASE/"; then
  echo "  SKIP  the live article gate — nothing is serving at $BASE"
else
  # A slug WITH a published episode comes from the feed; a slug WITHOUT one comes from the archive index, and
  # the two are compared so the check is about the difference rather than about a hardcoded address that will
  # rot. **The feed's guid is `ozikoro-episode-<slug>` and the episode slug is the article's own.**
  LIVE=$(BASE="$BASE" python3 - <<'PY'
import os, re, sys, urllib.request
base = os.environ["BASE"]
def get(path):
    with urllib.request.urlopen(base + path, timeout=60) as r:
        return r.read().decode("utf-8", "replace")
try:
    feed = get("/podcast/feed.xml")
    guids = re.findall(r"<guid[^>]*>ozikoro-episode-([^<]+)</guid>", feed)
    index = get("/archive-index")
    links = re.findall(r'href="/([a-z0-9-]{4,})/"', index)
    with_audio = guids[0] if guids else ""
    without = next((s for s in links if s not in guids), "")
    print(f"{with_audio} {without}")
except Exception as error:  # a check that cannot run must say so, not fail the build
    print(f"ERROR {error}")
PY
)
  set -- $LIVE
  WITH="${1:-}"
  WITHOUT="${2:-}"
  if [ "$WITH" = "ERROR" ]; then
    echo "  SKIP  the live article gate — the site could not be read: $WITHOUT"
  elif [ -z "$WITH" ] || [ -z "$WITHOUT" ]; then
    echo "  SKIP  the live article gate — no published episode in the feed, or no un-narrated record on the index"
  else
    A=$(curl -s --max-time 90 "$BASE/$WITH/")
    B=$(curl -s --max-time 90 "$BASE/$WITHOUT/")
    if ! printf '%s' "$A" | grep -q 'data-listen-audio'; then
      echo "  FAIL  /$WITH/ has a published episode and serves no audio element." >&2
      failed=$((failed + 1))
    elif printf '%s' "$B" | grep -q 'data-listen-audio'; then
      echo "  FAIL  /$WITHOUT/ has no published episode and serves an audio element." >&2
      failed=$((failed + 1))
    else
      echo "  PASS  the gate: /$WITH/ carries the player, /$WITHOUT/ carries none"
    fi
  fi
fi

echo "  checked: $checked"
if [ "$checked" -eq 0 ]; then
  echo "  NOTHING WAS CHECKED — not a pass." >&2
  exit 2
fi
echo ""
exit $((failed > 0))
