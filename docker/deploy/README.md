# The ozikoro.com host deploy — three merged files and one override

**These are not the repository's canonical files.** They are the merges that put the archive
onto the host at `/opt/ozituma/app` **without editing anything that host already runs** — the
dictionary, the Academy, their 246 uncommitted files, their database.

## Why they exist at all

The host's checkout is a different history from this one. It has `apps/web` and `apps/learn`
and a compose file with an `academy` service that this checkout has never contained, and its
Dockerfile has no archive target. `AGENTS.md` records the detail. So "deploy the archive"
cannot mean "copy this checkout over that one" — it means **adding** the archive beside two
live applications.

## What each file is

| file | what it is | how it lands |
|---|---|---|
| `docker-compose.ozikoro.yml` | the archive's four services and the `backupdata` volume, **copied verbatim** from `docker/docker-compose.prod.yml` | a compose **override** — the host's own compose file is never edited |
| `deploy/Dockerfile.merged` | the host's Dockerfile **plus** the archive's three stages | replaces `docker/Dockerfile` after backing the original up |
| `deploy/Caddyfile.merged` | the host's Caddyfile **plus** the archive's two server blocks | replaces `docker/Caddyfile` after backing the original up |

## The rule that governs every one of them

**Each is additive.** The host's `postgres`, `web`, `caddy` and `academy` services, its
`builder-learn` and `learn` stages, its academy server block and its `/learn` and `/practice`
redirects are all present and unchanged in the merged files. Nothing was removed to make room.

**Verify that before applying one:** the host's file should be readable as a subsequence of the
merged file. If a line of theirs is missing, the merge is wrong.

## The one flag that is not optional

```
docker compose --env-file /opt/ozituma/.env \
               -f docker/docker-compose.prod.yml \
               -f docker/docker-compose.ozikoro.yml \
               up -d ozikoro
```

**`--env-file /opt/ozituma/.env` is required.** The host's `.env` sits *beside* the app
directory, and compose's default project directory is the compose file's own directory — so
without the flag every `${VAR}` resolves to nothing and the archive starts with an empty
database password. Measured by round 362; the header of the override repeats it.

## The Academy

**`deploy/Dockerfile.merged` keeps the `builder-learn` and `learn` stages deliberately.**
`ozikoro-academy:latest` is running on that host and **has no build target in either
repository** — the `learn` stages are the closest thing to it that exists. Do not remove them,
and do not run a whole-file `docker compose build` on that host. See `AGENTS.md`.
