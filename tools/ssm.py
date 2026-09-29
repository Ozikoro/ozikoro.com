#!/usr/bin/env python3
"""Run a shell script on the Ozituma instance over SSM and stream the output.

Usage:  python3 tools/ssm.py <script-file> [--timeout 3600]
        echo 'uptime' | python3 tools/ssm.py -
"""
import base64
import json
import os
import subprocess
import sys
import time

INSTANCE = "i-0cf8b21633d2aaf22"
REGION = "us-east-1"
AWS = os.path.expanduser("~/.local/bin/aws")


PROFILE = os.environ.get("AWS_PROFILE", "ozikoro")


def aws(*args: str) -> str:
    out = subprocess.run(
        [AWS, "--profile", PROFILE, *args], capture_output=True, text=True
    )
    if out.returncode:
        raise SystemExit(f"aws {' '.join(args)} failed:\n{out.stderr}")
    return out.stdout


def main() -> None:
    args = sys.argv[1:]
    timeout = 3600
    if "--timeout" in args:
        i = args.index("--timeout")
        timeout = int(args[i + 1])
        del args[i:i + 2]
    if not args:
        raise SystemExit(__doc__)
    src = sys.stdin.read() if args[0] == "-" else open(args[0]).read()
    payload = base64.b64encode(src.encode()).decode()
    script = (
        "echo " + payload + " | base64 -d > /tmp/_ssm.sh && "
        "bash /tmp/_ssm.sh; echo \"__EXIT:$?\""
    )
    params = json.dumps({
        "commands": ["export PATH=$PATH:/usr/local/bin:/usr/bin:/bin", script],
        "executionTimeout": [str(timeout)],
    })
    cid = json.loads(aws(
        "ssm", "send-command", "--region", REGION,
        "--instance-ids", INSTANCE,
        "--document-name", "AWS-RunShellScript",
        "--comment", "dsh",
        "--parameters", params,
        "--query", "Command.CommandId", "--output", "text",
    )) if False else aws(
        "ssm", "send-command", "--region", REGION,
        "--instance-ids", INSTANCE,
        "--document-name", "AWS-RunShellScript",
        "--comment", "dsh",
        "--parameters", params,
        "--query", "Command.CommandId", "--output", "text",
    ).strip()
    sys.stderr.write(f"[ssm] {cid}\n")
    deadline = time.time() + timeout
    seen = 0
    while time.time() < deadline:
        time.sleep(3)
        raw = aws(
            "ssm", "get-command-invocation", "--region", REGION,
            "--command-id", cid, "--instance-id", INSTANCE, "--output", "json",
        )
        inv = json.loads(raw)
        out = inv.get("StandardOutputContent", "")
        err = inv.get("StandardErrorContent", "")
        if len(out) > seen:
            sys.stdout.write(out[seen:])
            sys.stdout.flush()
            seen = len(out)
        if err and inv["Status"] not in ("InProgress", "Pending", "Delayed"):
            sys.stderr.write(err)
        if inv["Status"] not in ("InProgress", "Pending", "Delayed"):
            sys.stderr.write(f"\n[ssm] status={inv['Status']}\n")
            return
    raise SystemExit("timed out waiting for the command")


if __name__ == "__main__":
    main()
