#!/usr/bin/env python3
"""File each corrected Thomas proverb under one of the section's themes.

    python3 themes-thomas.py

The proverbs page filters by eleven themes, and the proverbs that came from
Thomas have none — they would appear in the list with no chip and would be
invisible to the filter. This asks for the same eleven labels the page offers,
one per proverb, from the Igbo and the English that the correction pass already
settled. Nothing else is changed.

Input:  corrected.jsonl      Output: themes.jsonl  (resumable, one per line)
"""
from __future__ import annotations

import json
import os
import random
import re
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
API = "https://api.deepseek.com/chat/completions"
KEY = os.environ.get("DEEPSEEK_API_KEY", "")
MODEL = "deepseek-flash"

THEMES = [
    "Community",
    "Character",
    "Wisdom",
    "Determination",
    "Home",
    "Gratitude",
    "Memory",
    "Life",
    "Humility",
    "Responsibility",
]

PROMPT = """Below are Igbo proverbs with their English meanings. File each one under exactly one \
of these themes:

""" + ", ".join(THEMES) + """

A theme is a reading, not a fact: the same proverb can be about patience and about humility at once, \
so choose the one a reader is most likely to look for it by. Reply with JSON only: \
{"proverbs": [{"number": 0, "theme": "Wisdom"}]} covering every number given.

Proverbs:
"""


def call(prompt: str, retries: int = 5) -> dict:
    body = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": "You reply with JSON only, never prose or code fences."},
            {"role": "user", "content": prompt},
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0.1,
        "max_tokens": 64000,
        "reasoning_effort": "low",
    }
    data = json.dumps(body).encode()
    delay = 3.0
    last = None
    for _ in range(retries):
        request = urllib.request.Request(
            API, data=data, headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}
        )
        try:
            with urllib.request.urlopen(request, timeout=900) as response:
                payload = json.loads(response.read())
            content = payload["choices"][0]["message"]["content"]
            content = re.sub(r"^```(?:json)?|```$", "", content.strip(), flags=re.M).strip()
            return json.loads(content)
        except urllib.error.HTTPError as error:
            last = f"HTTP {error.code}: {error.read().decode()[:160]}"
            if error.code >= 500:
                time.sleep(delay + random.random())
                delay = min(delay * 2, 60)
                continue
            raise RuntimeError(last) from None
        except Exception as error:  # noqa: BLE001
            last = f"{type(error).__name__}: {error}"
            time.sleep(delay + random.random())
            delay = min(delay * 2, 60)
    raise RuntimeError(f"gave up after {retries} attempts ({last})")


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--batch", type=int, default=25)
    parser.add_argument("--workers", type=int, default=4)
    args = parser.parse_args()
    if not KEY:
        raise SystemExit("DEEPSEEK_API_KEY is not set")

    items = [json.loads(l) for l in (HERE / "corrected.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
    out = HERE / "themes.jsonl"
    done: set[int] = set()
    if out.exists():
        for line in out.read_text(encoding="utf-8").splitlines():
            if line.strip():
                done.add(json.loads(line)["number"])
    todo = [i for i in items if i["number"] not in done and i.get("igbo") and i.get("english")]
    batches = [todo[i : i + args.batch] for i in range(0, len(todo), args.batch)]
    print(f"{len(items)} proverbs, {len(done)} themed, {len(todo)} to do in {len(batches)} batches", flush=True)

    lock = threading.Lock()
    written = 0

    def run(index: int, batch: list[dict]) -> None:
        nonlocal written
        listing = "\n\n".join(
            f'{item["number"]}. IGBO: {item["igbo"]}\nENGLISH: {item["english"]}' for item in batch
        )
        try:
            result = call(PROMPT + listing)
        except Exception as error:  # noqa: BLE001
            print(f"  batch {index + 1} FAILED: {error}", flush=True)
            return
        returned = [e for e in result.get("proverbs", []) if isinstance(e, dict)]
        by_number: dict[int, dict] = {}
        for entry in returned:
            try:
                by_number[int(entry["number"])] = entry
            except (KeyError, TypeError, ValueError):
                continue
        with lock:
            for position, item in enumerate(batch):
                entry = by_number.get(item["number"])
                if entry is None and position < len(returned):
                    entry = returned[position]
                if entry is None:
                    continue
                theme = str(entry.get("theme") or "").strip()
                if theme not in THEMES:
                    continue
                with out.open("a", encoding="utf-8") as handle:
                    handle.write(json.dumps({"number": item["number"], "theme": theme}, ensure_ascii=False) + "\n")
                written += 1
            print(f"  batch {index + 1}/{len(batches)}: total {written}", flush=True)

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        list(pool.map(lambda pair: run(*pair), enumerate(batches)))
    print(f"done: {written} themes written", flush=True)


if __name__ == "__main__":
    main()
