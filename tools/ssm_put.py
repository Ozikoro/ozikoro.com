#!/usr/bin/env python3
"""Copy files between this machine and the Ozituma instance over SSM.

Usage:  python3 tools/ssm_put.py <local-file> <remote-path>
        python3 tools/ssm_put.py --get <remote-path> <local-file>
        python3 tools/ssm_put.py --tar <remote-dir> <local-path> [<local-path> ...]

Why this exists: the instance is reachable only through SSM, and an SSM command
document is capped at 97 KB, so anything larger than that cannot be sent in one
call and there is no scp. The file is gzipped, base64'd, and appended to a
scratch file on the instance 20,000 characters at a time; the last call decodes
and ungzips it. One chunk per SSM call, each polled to completion.

`--tar` packs several paths into one archive and extracts it under a remote
directory, preserving relative paths — one transfer for a whole set of changed
files instead of one per file. AppleDouble `._*` entries are excluded: they have
twice broken the migration runner with "invalid message format".
"""
import base64
import gzip
import json
import os
import subprocess
import sys
import time

INSTANCE = "i-0cf8b21633d2aaf22"
REGION = "us-east-1"
AWS = os.path.expanduser("~/.local/bin/aws")
PROFILE = os.environ.get("AWS_PROFILE", "ozikoro")
CHUNK = 20_000


def aws(*args: str) -> str:
    out = subprocess.run(
        [AWS, "--profile", PROFILE, *args], capture_output=True, text=True
    )
    if out.returncode:
        raise SystemExit(f"aws {' '.join(args)} failed:\n{out.stderr}")
    return out.stdout


def run(script: str, timeout: int = 600) -> str:
    """Run a shell script on the instance and return its stdout.

    The remote exit code is carried back in a trailing `__EXIT:n` marker and
    enforced here. Without that, `bash /tmp/_put.sh; echo ...` reports success for
    any script at all, and a transfer that quietly wrote an empty file looks
    exactly like one that worked.
    """
    payload = base64.b64encode(script.encode()).decode()
    command = (
        "echo " + payload + " | base64 -d > /tmp/_put.sh && "
        'bash /tmp/_put.sh; echo "__EXIT:$?"'
    )
    params = json.dumps(
        {
            "commands": ["export PATH=$PATH:/usr/local/bin:/usr/bin:/bin", command],
            "executionTimeout": [str(timeout)],
        }
    )
    cid = aws(
        "ssm", "send-command", "--region", REGION,
        "--instance-ids", INSTANCE,
        "--document-name", "AWS-RunShellScript",
        "--comment", "ssm_put",
        "--parameters", params,
        "--query", "Command.CommandId", "--output", "text",
    ).strip()
    deadline = time.time() + timeout
    while time.time() < deadline:
        time.sleep(1.5)
        inv = json.loads(
            aws(
                "ssm", "get-command-invocation", "--region", REGION,
                "--command-id", cid, "--instance-id", INSTANCE, "--output", "json",
            )
        )
        if inv["Status"] not in ("InProgress", "Pending", "Delayed"):
            out = inv.get("StandardOutputContent", "")
            err = inv.get("StandardErrorContent", "")
            if inv["Status"] != "Success":
                raise SystemExit(f"remote command {inv['Status']}:\n{out}\n{err}")
            marker = out.rstrip().rsplit("__EXIT:", 1)
            if len(marker) != 2:
                raise SystemExit(f"no exit marker in remote output:\n{out}\n{err}")
            code = int(marker[1].strip())
            body = marker[0]
            if code != 0:
                raise SystemExit(f"remote script exited {code}:\n{body}\n{err}")
            return body
    raise SystemExit("timed out waiting for the remote command")


def put(local: str, remote: str) -> None:
    raw = open(local, "rb").read()
    if not raw:
        raise SystemExit(f"{local} is empty — refusing to upload nothing")
    blob = base64.b64encode(gzip.compress(raw, 9)).decode()
    chunks = [blob[i:i + CHUNK] for i in range(0, len(blob), CHUNK)] or [""]
    scratch = f"{remote}.b64"
    print(
        f"{local}  {len(raw):,} B -> {len(blob):,} b64 chars in {len(chunks)} chunk(s)"
    )
    run(f"rm -f {scratch}")
    for index, chunk in enumerate(chunks):
        # Appending with a single-quoted printf: base64 is [A-Za-z0-9+/=], so there
        # is no quoting hazard, and `printf` (unlike `echo`) never interprets a
        # leading dash or an escape.
        run(f"printf '%s' '{chunk}' >> {scratch}")
        size = run(f"stat -c %s {scratch}").strip()
        expected = sum(len(c) for c in chunks[: index + 1])
        if size != str(expected):
            raise SystemExit(
                f"chunk {index + 1}/{len(chunks)}: {scratch} is {size} bytes, expected {expected}"
            )
        print(f"  chunk {index + 1}/{len(chunks)}  {size} bytes", flush=True)
    run(
        f"mkdir -p $(dirname {remote}) && "
        f"base64 -d {scratch} | gunzip > {remote} && rm -f {scratch}"
    )
    landed = run(f"stat -c %s {remote}").strip()
    if landed != str(len(raw)):
        raise SystemExit(f"{remote} is {landed} bytes, expected {len(raw)}")
    print(f"  -> {remote}  {landed} bytes verified")


def put_tar(remote_dir: str, paths: list[str]) -> None:
    archive = "/tmp/dsh-put.tar.gz"
    listing = "/tmp/dsh-put.list"
    with open(listing, "w") as handle:
        handle.write("\n".join(paths) + "\n")
    # COPYFILE_DISABLE stops macOS tar from writing an AppleDouble `._name` member
    # beside every file that carries extended attributes. `--exclude` is NOT enough and
    # was tried twice: a pattern must match the whole member path, and `*` does not
    # cross `/`, so `*/._*` never matched `packages/db/migrations/._0021_...sql`. That
    # stray member is not inert here — a `._` file in the migrations directory makes the
    # runner fail with "invalid message format" and it took the deploy down with it.
    env = {**os.environ, "COPYFILE_DISABLE": "1"}
    argv = ["tar", "-czf", archive, "--no-mac-metadata", "-T", listing]
    result = subprocess.run(argv, env=env, capture_output=True, text=True)
    if result.returncode:
        # bsdtar understands --no-mac-metadata; GNU tar does not. Fall back rather than
        # fail, because COPYFILE_DISABLE alone is sufficient on the platform that needs it.
        subprocess.run(["tar", "-czf", archive, "-T", listing], env=env, check=True)

    packed = subprocess.run(
        ["tar", "-tzf", archive], capture_output=True, text=True, check=True
    ).stdout.split()
    # A path tar silently skipped would deploy a partial change; an extra path would
    # deploy a file nobody asked for. Both are checked, and the second is the check that
    # would have caught the AppleDouble member the exclusions missed.
    missing = [p for p in paths if p not in packed]
    if missing:
        raise SystemExit(f"tar did not pack: {missing}")
    extra = [m for m in packed if m not in paths]
    if extra:
        raise SystemExit(f"tar packed files that were not asked for: {extra}")
    print(f"packed {len(packed)} file(s): {', '.join(os.path.basename(p) for p in packed)}")

    put(archive, "/tmp/dsh-put.tar.gz")
    out = run(
        f"mkdir -p {remote_dir} && chmod +x /tmp/dsh-put.tar.gz || true; "
        f"tar -xzf /tmp/dsh-put.tar.gz -C {remote_dir} && rm -f /tmp/dsh-put.tar.gz && "
        f"echo '--- landed ---' && "
        + " && ".join(f"stat -c '%s %n' {remote_dir}/{p}" for p in paths)
    )
    print(out)


def get(remote: str, local: str) -> None:
    """Copy a file back from the instance, gzipped and chunked the same way."""
    scratch = "/tmp/dsh-get.b64"
    size = int(
        run(
            f"gzip -9 -c {remote} | base64 -w0 > {scratch} && stat -c %s {scratch}"
        ).strip()
    )
    print(f"{remote} -> {size:,} b64 chars")
    pieces = []
    for start in range(0, size, CHUNK):
        pieces.append(run(f"dd if={scratch} bs=1 skip={start} count={CHUNK} 2>/dev/null"))
        print(f"  {min(start + CHUNK, size):,}/{size:,}", flush=True)
    run(f"rm -f {scratch}")
    blob = "".join(p.strip() for p in pieces)
    raw = gzip.decompress(base64.b64decode(blob))
    with open(local, "wb") as handle:
        handle.write(raw)
    print(f"  -> {local}  {len(raw):,} bytes")


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        raise SystemExit(__doc__)
    if args[0] == "--tar":
        put_tar(args[1], args[2:])
    elif args[0] == "--get" and len(args) == 3:
        get(args[1], args[2])
    elif len(args) == 2:
        put(args[0], args[1])
    else:
        raise SystemExit(__doc__)
