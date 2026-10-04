#!/usr/bin/env bash
#
# Export the live ozikoro.com WordPress database as a real `.sql` / `.sql.gz`
# through a cPanel *panel* session and phpMyAdmin's export form.
#
# Why this route: the cPanel API token can read `wp-config.php` but is refused on
# every UI path (403), so it cannot mint the `cpsess` session phpMyAdmin needs. A
# panel login can. See docs/OZIKORO-REMAINING.md, rounds 307-308.
#
# READ-ONLY. The only request that touches the database is phpMyAdmin's export,
# which is a SELECT. No query tab, no SQL editor, no "drop tables", no writes.
#
# Why per-table by default: asking for all 111 tables in one request dies halfway
# with `#2006 - MySQL server has gone away` appended to the response, after about
# 105 MB of SQL (partway through `wpc9_posts`). The gzip stays valid up to that
# point, so the truncated download *looks* like a successful 200. One request per
# table resets the clock and each part finishes; the parts are then concatenated
# into a single dump.
#
# Credentials are read from `.env.local` (gitignored) at runtime and are never
# echoed, logged or written to a tracked file. Run from the staging root:
#
#   ./scripts/export-wp-db.sh                  # every table, per-table requests
#   ./scripts/export-wp-db.sh --list           # print the database's tables
#   TABLES=wpc9_posts,wpc9_postmeta ./scripts/export-wp-db.sh
#   MODE=single ./scripts/export-wp-db.sh      # one request (known to truncate)
#
# Environment overrides (all optional):
#   WP_DB              database name          (default ozikbfpe_ozikoro)
#   CPANEL_LOGIN_HOST  panel login hostname   (default business193.web-hosting.com)
#   CPANEL_EXPORT_WORK scratch working dir    (default .scratch/cpanel)
#   OUT_DIR            output directory       (default data/ozikoro-wp/dbdump/sql)
#   TABLES             comma-separated subset (default: every table in the db)
#   MODE               per-table | single     (default per-table)
#
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"

WP_DB=${WP_DB:-ozikbfpe_ozikoro}
LOGIN_HOST=${CPANEL_LOGIN_HOST:-business193.web-hosting.com}
WORK=${CPANEL_EXPORT_WORK:-.scratch/cpanel}
OUT_DIR=${OUT_DIR:-data/ozikoro-wp/dbdump/sql}
TABLES=${TABLES:-}
MODE=${MODE:-per-table}

LIST_ONLY=0
[ "${1:-}" = "--list" ] && LIST_ONLY=1

if [ ! -f .env.local ]; then
  echo "fatal: .env.local not found (it holds the cPanel credentials)" >&2
  exit 1
fi
mkdir -p "$WORK" "$OUT_DIR"

# --- build the POST body from phpMyAdmin's own export form --------------------
# Every field the form carries is replayed as the browser would send it, then a
# few are overridden: SQL, gzip, structure+data, streamed to the client.
# `sql_drop_table` and `sql_truncate` are deliberately left off — the dump must
# never carry a directive that would destroy anything if it were ever replayed.
build_body() { # $1 = output path, $2 = optional comma-separated table subset; prints the tables
  python3 - "$WORK/export-form.html" "$1" "${2:-}" <<'PY'
import sys, re
from html.parser import HTMLParser
from urllib.parse import urlencode

form_path, out_path, only = sys.argv[1], sys.argv[2], sys.argv[3].strip()
src = open(form_path, encoding='utf-8', errors='replace').read()
i = src.find('name="dump"')
if i < 0:
    sys.exit('fatal: no export form ("dump") in the page')
i = src.rfind('<form', 0, i)
seg = src[i:src.find('</form>', i)]


class Fields(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.fields, self.select, self.opt, self.sel = [], None, '', None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        name = a.get('name')
        if tag == 'input' and name:
            kind = (a.get('type') or 'text').lower()
            if kind in ('checkbox', 'radio'):
                if 'checked' in a:
                    self.fields.append([name, a.get('value', 'on')])
            elif kind not in ('submit', 'button', 'reset', 'file', 'image'):
                self.fields.append([name, a.get('value', '')])
        elif tag == 'select':
            self.select, self.sel, self.opt = name, None, ''
        elif tag == 'option' and self.select:
            self.opt = a.get('value', '')
            if 'selected' in a:
                self.sel = self.opt
        elif tag == 'textarea' and name:
            self.fields.append([name, ''])

    def handle_endtag(self, tag):
        if tag == 'select' and self.select:
            self.fields.append([self.select, self.sel if self.sel is not None else self.opt])
            self.select = None


p = Fields()
p.feed(seg)
tables = sorted({v for n, v in p.fields if n == 'table_select[]'}) or \
    sorted(set(re.findall(r'name="table_select\[\]" value="([a-z0-9_]+)"', seg)))
if only:
    want = {t.strip() for t in only.split(',') if t.strip()}
    tables = [t for t in tables if t in want]
    if not tables:
        sys.exit('fatal: none of the requested tables exist in this database')

fields = [(n, v) for n, v in p.fields
          if n not in ('table_select[]', 'table_structure[]', 'table_data[]')]
for t in tables:
    fields += [('table_select[]', t), ('table_structure[]', t), ('table_data[]', t)]

overrides = {
    'quick_or_custom': 'custom',
    'output_format': 'sendit',
    'compression': 'gzip',
    'charset': 'utf-8',
    'sql_structure_or_data': 'structure_and_data',
    'sql_create_table': '1',
    'sql_include_comments': '1',
    'sql_auto_increment': '1',
    'sql_backquotes': '1',
    'filename_template': '@DATABASE@',
    'as_separate_files': None,
    'sql_drop_table': None,
    'sql_truncate': None,
    'sql_create_database': None,
}
fields = [(n, v) for n, v in fields if not (n in overrides and overrides[n] is None)]
for k, v in overrides.items():
    if v is not None:
        fields = [(n, x) for n, x in fields if n != k] + [(k, v)]

open(out_path, 'w').write(urlencode(fields))
print('\n'.join(tables))
PY
}

# --- 1. panel login, cookie jar kept -----------------------------------------
# `login_only=1` returns JSON; the cpsess prefix changes per session, so it is
# read from the response and never hard-coded.
set -a
# shellcheck disable=SC1091
. ./.env.local
set +a
: "${CPANEL_USER:?CPANEL_USER missing from .env.local}"
: "${CPANEL_PASSWORD:?CPANEL_PASSWORD missing from .env.local}"
CPANEL_PORT=${CPANEL_PORT:-2083}

JAR="$WORK/cookies.txt"
rm -f "$JAR"
code=$(curl -sk --max-time 60 -c "$JAR" -o "$WORK/login.json" -w '%{http_code}' \
  --data-urlencode "user=$CPANEL_USER" \
  --data-urlencode "pass=$CPANEL_PASSWORD" \
  "https://$LOGIN_HOST:$CPANEL_PORT/login/?login_only=1")

status=$(python3 - "$WORK/login.json" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    print('unparsable'); raise SystemExit
print('ok' if d.get('status') == 1 and d.get('security_token') else 'refused')
PY
)
if [ "$code" != "200" ] || [ "$status" != "ok" ]; then
  echo "fatal: cPanel login failed (http=$code status=$status)" >&2
  exit 1
fi
CPS=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['security_token'])" "$WORK/login.json")
echo "login ok (http=$code), session $CPS"

PMA="https://$LOGIN_HOST:$CPANEL_PORT$CPS/3rdparty/phpMyAdmin"

# --- 2. phpMyAdmin: the database export form ----------------------------------
# The working path, for the record:
#   /{cpsess}/3rdparty/phpMyAdmin/index.php             -> phpMyAdmin 5.2.3, logged in
#   /{cpsess}/3rdparty/phpMyAdmin/index.php?route=/database/export&db=<db>
# The dump form itself posts to /index.php?route=/export. "Save on server" is
# shown but *disabled* (SaveDir unset), so the gzip is streamed back instead.
code=$(curl -sk --max-time 120 -b "$JAR" -c "$JAR" -o "$WORK/export-form.html" -w '%{http_code}' \
  "$PMA/index.php?route=/database/export&db=$WP_DB")
if [ "$code" != "200" ]; then
  echo "fatal: could not open the phpMyAdmin export form (http=$code)" >&2
  exit 1
fi
if ! grep -qi 'phpMyAdmin' "$WORK/export-form.html"; then
  echo "fatal: export form is not a phpMyAdmin page" >&2
  exit 1
fi

# `mapfile` is bash 4; macOS ships bash 3.2 as /bin/bash, so read the list the
# long way round.
ALL_TABLES=()
while IFS= read -r line; do
  [ -n "$line" ] && ALL_TABLES+=("$line")
done < <(build_body "$WORK/body-list.txt" "$TABLES")
if [ "${#ALL_TABLES[@]}" -eq 0 ]; then
  echo "fatal: no tables found in the export form" >&2
  exit 1
fi
if [ "$LIST_ONLY" = "1" ]; then
  printf '%s\n' "${ALL_TABLES[@]}"
  exit 0
fi
echo "database $WP_DB: ${#ALL_TABLES[@]} tables"

# --- 3. stream the export back ------------------------------------------------
# One request per table. A part already on disk that verifies is kept, so a run
# that dies on table 60 resumes rather than starting over; `FRESH=1` wipes first.
# The host drops a connection now and then (curl exit 28, no response), so each
# request is retried rather than allowed to end the run.
parts="$WORK/parts"
if [ "${FRESH:-0}" = "1" ]; then rm -rf "$parts"; fi
mkdir -p "$parts"

# is_part_ok <file> <table> — a valid gzip, holding this table's CREATE TABLE,
# ending in phpMyAdmin's epilogue, with no server-death notice in the tail.
# pipefail is off from here to the end of verification: `grep -q` closes the pipe
# early, gzip then dies of SIGPIPE, and the pipeline would report failure for a
# file that is perfectly good.
set +o pipefail
is_part_ok() {
  [ -s "$1" ] || return 1
  gzip -t "$1" 2>/dev/null || return 1
  local tail
  tail=$(gzip -dc "$1" 2>/dev/null | tail -c 4000)
  case "$tail" in
    *'gone away'*) return 1 ;;
    *'COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION'*) ;;
    *) return 1 ;;
  esac
  if [ "$MODE" != "single" ]; then
    gzip -dc "$1" 2>/dev/null | grep -q "^CREATE TABLE \`$2\`" || return 1
  fi
  return 0
}

if [ "$MODE" = "single" ]; then
  build_body "$WORK/body.full.txt" "$TABLES" >/dev/null
  out="$parts/$WP_DB.sql.gz"
  if [ ! -s "$out" ]; then
    code=$(curl -sk --max-time 7200 --connect-timeout 30 --retry 3 --retry-delay 5 \
      --retry-all-errors -b "$JAR" -c "$JAR" -X POST \
      -H 'Content-Type: application/x-www-form-urlencoded' \
      --data-binary "@$WORK/body.full.txt" -o "$out" -D "$WORK/export-headers.txt" -w '%{http_code}' \
      "$PMA/index.php?route=/export") || true
    echo "single request: http=$code bytes=$(wc -c < "$out" | tr -d ' ')"
  fi
else
  for t in "${ALL_TABLES[@]}"; do
    out="$parts/$t.sql.gz"
    if is_part_ok "$out" "$t"; then
      printf '  %-46s kept  bytes=%s\n' "$t" "$(wc -c < "$out" | tr -d ' ')"
      continue
    fi
    build_body "$WORK/body.one.txt" "$t" >/dev/null
    code=$(curl -sk --max-time 300 --connect-timeout 30 --retry 3 --retry-delay 5 \
      --retry-all-errors -b "$JAR" -c "$JAR" -X POST \
      -H 'Content-Type: application/x-www-form-urlencoded' \
      --data-binary "@$WORK/body.one.txt" -o "$out" -w '%{http_code}' \
      "$PMA/index.php?route=/export") || code="curl-$?"
    printf '  %-46s http=%s bytes=%s\n' "$t" "$code" "$(wc -c < "$out" | tr -d ' ')"
  done
fi

# --- 4. verify each part is a dump, not an error page -------------------------
# The specific failure mode: a 200 carrying an HTML login page, or a gzip that is
# valid up to the point the server died and then has `#2006 ... gone away`
# appended. Both look like success. Check the bytes, not the status.
good=()
missing=()
for t in "${ALL_TABLES[@]}"; do
  src="$parts/$t.sql.gz"
  [ "$MODE" = "single" ] && src="$parts/$WP_DB.sql.gz"
  if is_part_ok "$src" "$t"; then
    good+=("$t")
  else
    missing+=("$t")
    echo "  FAIL $t: no valid, complete part on disk" >&2
  fi
done
set -o pipefail
exported=("${good[@]}")
if [ "${#exported[@]}" -eq 0 ]; then
  echo "fatal: no table exported successfully" >&2
  exit 1
fi
if [ "${#missing[@]}" -gt 0 ]; then
  echo "warning: ${#missing[@]} table(s) missing: ${missing[*]}" >&2
fi

# --- 5. assemble one dump -----------------------------------------------------
plain="$OUT_DIR/$WP_DB.sql"
gz="$OUT_DIR/$WP_DB.sql.gz"
if [ "$MODE" = "single" ]; then
  cp "$parts/$WP_DB.sql.gz" "$gz"
  gzip -dc "$gz" > "$plain"
else
  : > "$plain"
  first=1
  for t in "${exported[@]}"; do
    part="$parts/$t.plain.sql"
    gzip -dc "$parts/$t.sql.gz" > "$part"
    if [ "$first" = "1" ]; then
      cat "$part" >> "$plain"
      first=0
    else
      # drop the repeated phpMyAdmin preamble and epilogue: keep only from this
      # table's own structure comment up to and including its closing COMMIT, so
      # the assembled file has exactly one preamble and one epilogue
      python3 - "$part" >> "$plain" <<'PY'
import sys
text = open(sys.argv[1], encoding='utf-8', errors='replace').read()
start = text.find('-- Table structure for table')
end = text.rfind('COMMIT;')
if end >= 0:
    nl = text.find('\n', end + len('COMMIT;'))
    end = len(text) if nl < 0 else nl + 1
sys.stdout.write(text[start:end] if start >= 0 else text)
PY
    fi
    rm -f "$part"
  done
  gzip -9 -c "$plain" > "$gz"
fi

# --- 6. report ----------------------------------------------------------------
tables=$(grep -c '^CREATE TABLE' "$plain" || true)
echo
echo "dump   $plain"
echo "       $(wc -c < "$plain" | tr -d ' ') bytes uncompressed, $tables CREATE TABLE statements"
echo "       $(wc -c < "$gz" | tr -d ' ') bytes gzipped"
echo "       first line: $(head -1 "$plain")"
if [ "$tables" != "${#exported[@]}" ]; then
  echo "warning: $tables CREATE TABLE statements for ${#exported[@]} tables exported" >&2
fi
