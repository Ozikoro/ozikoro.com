#!/bin/sh
# Run a data import on the instance, against the CURRENT files.
#
# WHY THIS EXISTS
#
# The container has no bind mount over /app: it runs the copy of the repository
# that was baked into the image. So uploading a changed data file to
# /opt/ozituma/app and then running the importer with `docker exec` imports the
# file AS IT WAS AT BUILD TIME — the upload is invisible to it, the import reports
# success, and the database keeps the old text. That is a silent failure with a
# confident success message, and it is what left clan rows holding wording the file
# had already had corrected.
#
# This copies the files into the running container first, so the import reads what
# is actually on the box. Idempotent, and safe to run at any time.
#
#   docker cp is used rather than a rebuild because a data correction should not
#   need a twenty-minute image build. A rebuild also carries the files, so both
#   routes agree.
set -e

copy() {
  src="/opt/ozituma/app/$1"
  if [ ! -f "$src" ]; then
    echo "  ! $1 is not on the box — skipping"
    return 0
  fi
  docker cp "$src" "ozituma-web-1:/app/$1"
  echo "  copied $1"
}

echo "Copying the data files into the container"
copy data/clans/clans.json

echo
echo "Running the imports"
docker exec -w /app ozituma-web-1 node packages/db/src/import/clans.ts --apply "$@"
