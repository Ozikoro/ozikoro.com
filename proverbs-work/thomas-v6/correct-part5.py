#!/usr/bin/env python3
"""Restore Thomas's Addenda to his Ibo-English Dictionary (Part V, 1914).

    python3 correct-part5.py --limit 20     # taste test
    python3 correct-part5.py                # the whole volume

Input:  part5-entries.json — 3,946 entries read off the scan by Apple Vision.
Output: part5-corrected.jsonl — resumable, one entry per line.

WHY THE WORDS NEED RESTORING TOO

Thomas printed this dictionary in 1914 in a phonetic transcription of Asaba
speech, and the scanner destroys the letters that carry it: ị and ọ come back as
`y`, `p`, `q`, `ç`, `6` or `§`, and ụ or ɓ sometimes as `g` or `b`. So `ọkpalụmụnna`
arrives as `qkpalumunna` and `nwadịmụọ` as `nwadimwg` — recognisable to a reader,
invisible to a lookup. Measured: of 120 headwords sampled across the volume, ZERO
matched the 12,301 words this dictionary already holds, and none of that means
the dictionary lacks the words.

The English gloss beside each headword is the anchor: it says what the word
means, so the headword can be restored to the modern spelling of a word with that
meaning rather than guessed letter by letter. That is what this asks for.
"""
from __future__ import annotations

import argparse
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

PROMPT = """You are an expert in Igbo and in the early anthropological literature on it, \
restoring a machine reading of an old printed dictionary.

The items below are entries from Northcote W. Thomas, *Anthropological Report on the Ibo-Speaking \
Peoples of Nigeria, Part V: Addenda to Ibo-English Dictionary* (1914), scanned and read by OCR. \
Thomas printed the Igbo of the Asaba district phonetically, and the scanner destroys the letters \
that carry it — ị and ọ come back as `y`, `p`, `q`, `ç`, `6` or `§`, and ụ or ɓ sometimes as `g` or \
`b`. So `qkpalumunna` is `ọkpalụmụnna` and `nwadimwg` is `nwadịmụọ`.

For each item give:

- "headword": the word in standard modern Igbo orthography (ị ọ ụ ṅ, tone marks only where they are \
needed to keep the sense and where the source marks them). Use the English gloss as the anchor: it \
says what the word means, so restore a word with that meaning rather than guessing letter by letter. \
If the English on its own does not pin the word down, give your best reading and say so.
- "english": the gloss, with OCR damage repaired, as a clean English phrase. Keep Thomas's sense; do \
not improve it into a different word. If his gloss is garbled past recovery, give the plainest \
reading its words support.
- "confidence": "high" when the headword is certain; "medium" when the reading is sound but a vowel \
or tone could differ; "low" when the entry is too damaged to restore. Be honest — a low-confidence \
line is kept and marked, never guessed at.
- "note": one short sentence on what you changed or what is still uncertain. Empty when nothing is \
in doubt.

Reply with JSON only: {"entries": [{"id": 0, "headword": "...", "english": "...", "confidence": \
"high", "note": ""}]}, one object per item, keeping every id.

Items:
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
    parser = argparse.ArgumentParser()
    parser.add_argument("--batch", type=int, default=20)
    parser.add_argument("--workers", type=int, default=5)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--in", dest="source", default=str(HERE / "part5-entries.json"))
    parser.add_argument("--out", dest="out", default=str(HERE / "part5-corrected.jsonl"))
    args = parser.parse_args()
    if not KEY:
        raise SystemExit("DEEPSEEK_API_KEY is not set")

    items = json.loads(Path(args.source).read_text(encoding="utf-8"))
    for index, item in enumerate(items):
        item["id"] = index
    out = Path(args.out)
    done: set[int] = set()
    if out.exists():
        for line in out.read_text(encoding="utf-8").splitlines():
            if line.strip():
                done.add(json.loads(line)["id"])
    todo = [i for i in items if i["id"] not in done]
    if args.limit:
        todo = todo[: args.limit]
    batches = [todo[i : i + args.batch] for i in range(0, len(todo), args.batch)]
    print(f"{len(items)} entries, {len(done)} done, {len(todo)} to do in {len(batches)} batches", flush=True)

    lock = threading.Lock()
    written = 0

    def run(index: int, batch: list[dict]) -> None:
        nonlocal written
        listing = "\n\n".join(f'{item["id"]}. HEADWORD: {item["headword"]}\nENGLISH: {item["gloss"]}' for item in batch)
        try:
            result = call(PROMPT + listing)
        except Exception as error:  # noqa: BLE001
            print(f"  batch {index + 1} FAILED: {error}", flush=True)
            return
        returned = [e for e in result.get("entries", []) if isinstance(e, dict)]
        by_id: dict[int, dict] = {}
        for entry in returned:
            try:
                by_id[int(entry["id"])] = entry
            except (KeyError, TypeError, ValueError):
                continue
        with lock:
            for position, item in enumerate(batch):
                entry = by_id.get(item["id"])
                if entry is None and position < len(returned):
                    entry = returned[position]
                if entry is None:
                    continue
                entry["id"] = item["id"]
                entry["headword_raw"] = item["headword"]
                entry["gloss_raw"] = item["gloss"]
                with out.open("a", encoding="utf-8") as handle:
                    handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
                written += 1
            print(f"  batch {index + 1}/{len(batches)}: total {written}", flush=True)

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        list(pool.map(lambda pair: run(*pair), enumerate(batches)))
    print(f"done: {written} written", flush=True)


if __name__ == "__main__":
    main()
