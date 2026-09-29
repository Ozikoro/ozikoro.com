#!/usr/bin/env bash
# Bulk-acquire the candidate corpus sources for Ozituma.
#
# Two classes of source, and the distinction matters:
#
#   STRUCTURED  JSON/CSV/TSV from GitHub, Hugging Face or CLDF. These import
#               directly — no OCR, no transcription. Always try these first.
#   DOCUMENTS   PDFs of print dictionaries and grammars. Whether they are usable
#               at all depends on having a text layer, which `probe:pdf` answers
#               in seconds. A scan needs OCR plus speaker review.
#
# Everything lands in data/sources/<language>/<slug>/ so the importer and the
# probe tool can find it, and so nothing lands in the repository by accident.
#
# Usage:
#   bash scripts/acquire-sources.sh            # everything
#   bash scripts/acquire-sources.sh documents  # only the PDFs
#   bash scripts/acquire-sources.sh structured # only the repos

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
DEST_ROOT="data/sources"
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
ONLY="${1:-all}"

fetched=0
skipped=0
failed=0
failed_list=()

# fetch <language> <slug> <url>
fetch() {
  local lang="$1" slug="$2" url="$3"
  local dir="$DEST_ROOT/$lang/$slug"
  local name
  name="$(basename "${url%%\?*}")"
  [ -z "$name" ] && name="download.pdf"
  local dest="$dir/$name"

  if [ -s "$dest" ]; then
    skipped=$((skipped + 1))
    return 0
  fi

  mkdir -p "$dir"
  # --fail so an HTML error page is not saved as if it were a PDF.
  if curl -sSL --fail --max-time 180 -A "$UA" -o "$dest" "$url" 2>/dev/null && [ -s "$dest" ]; then
    local size
    size=$(wc -c <"$dest" | tr -d ' ')
    # A tiny response is almost always an error page or a login wall.
    if [ "$size" -lt 20000 ]; then
      # Keep it only if it really is a PDF, otherwise drop it.
      if ! head -c 4 "$dest" | grep -q '%PDF'; then
        rm -f "$dest"
        failed=$((failed + 1))
        failed_list+=("$lang/$slug (blocked or login wall)")
        return 0
      fi
    fi
    fetched=$((fetched + 1))
    printf '  ok    %-46s %8s bytes\n' "$lang/$slug/$name" "$size"
  else
    failed=$((failed + 1))
    failed_list+=("$lang/$slug")
  fi
}

echo
echo "Acquiring DOCUMENT sources (PDF dictionaries and grammars)"
echo

if [ "$ONLY" = "all" ] || [ "$ONLY" = "documents" ]; then

  # --- Edo ---------------------------------------------------------------
  fetch edo munro                 "https://centreforedostudies.be/Munro/Munro.pdf"

  # --- Urhobo ------------------------------------------------------------
  fetch urhobo okrokoto           "https://urhobodigitallibrarymuseum.com/wp-content/uploads/2021/10/urhobo_dictionary_by_ebireri_okrokoto_ur-1.pdf"
  fetch urhobo urhobo-net         "http://www.urhobo.net/Resources/UrhoboDictionary.pdf"

  # --- Efik --------------------------------------------------------------
  fetch efik wikisource           "https://upload.wikimedia.org/wikipedia/commons/f/fe/Efik_language_%28IA_efiklanguage00unafrich%29.pdf"

  # --- Mende -------------------------------------------------------------
  fetch mende sierra-leone        "https://www.sierra-leone.org/Books/MendeManual.pdf"

  # --- Fula / Fulfulde ---------------------------------------------------
  fetch fuv stennes-adamawa       "https://theswissbay.ch/pdf/Books/Linguistics/Mega%20linguistics%20pack/African/Niger-Congo/other%20Atlantic-Congo/Fula%3B%20A%20Reference%20Grammar%20of%20Adamawa%20Fulani%20%28Stennes%29.pdf"
  fetch fuv fulani-en-1932        "https://onipabooks.com/books/fulani-en-1932.pdf"

  # --- Wolof -------------------------------------------------------------
  fetch wol ucla-opl19            "https://linguistics.ucla.edu/publications/opl_19.pdf"
  fetch wol gambia-wollof         "https://resourcepage.gambia.dk/ftp/wollof.pdf"

  # --- Mandinka ----------------------------------------------------------
  fetch mnk peace-corps           "https://fsi-languages.yojik.eu/languages/PeaceCorps/Mandinka/Peace%20Corps%20Mandinka-English%20Dictionary.pdf"
  fetch mnk gambia-mandinka       "https://resourcepage.gambia.dk/ftp/mandinka.pdf"

  # --- Gullah ------------------------------------------------------------
  fetch gul scripture-earth-bible "https://www.scriptureearth.org/data/gul/PDF/00-WNTgul-web.pdf"
  fetch gul wolakota-handouts     "https://www.wolakotaproject.org/wp-content/uploads/2015/02/CodeTalkerStudentHandouts.pdf"
  fetch gul eric-ed198712         "https://files.eric.ed.gov/fulltext/ED198712.pdf"
  fetch gul grammar-sketch        "https://www.dbfrank.net/papers/gullah_grammar_sketch.pdf"

  # --- Ekpeye (treated as a dialect of Igbo, not a separate language) -----
  # Blench's site refuses direct downloads (HTTP 403), so this comes from the
  # Internet Archive copy, which also provides a plain-text rendering and so
  # needs no PDF parsing at all.
  fetch ekpeye archive-org-text "https://archive.org/download/ekpeyedictionary/Ekpeye%20dictionary_djvu.txt"

  # --- Hausa -------------------------------------------------------------
  # The two Hausa links were Google Drive files, which need an authenticated
  # session. Recorded here so the gap is explicit rather than forgotten.
  echo "  skip  hau/* (Google Drive links need an authenticated session)"
fi

echo
echo "Document acquisition: $fetched downloaded, $skipped already present, $failed unavailable"
if [ "${#failed_list[@]}" -gt 0 ]; then
  echo "Unavailable:"
  for f in "${failed_list[@]}"; do echo "    $f"; done
fi
