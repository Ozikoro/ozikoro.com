#!/usr/bin/env python3
"""The same renderings, through DeepSeek, and a check pass over all of them.

    python3 translate-deepseek.py --out renderings.jsonl              # finish the set
    python3 translate-deepseek.py --verify --out renderings.jsonl --report verify.jsonl

Written when the Gemini free tier ran out mid-run: 620 proverbs had renderings
and 576 had none. The prompt, the schema and the output format are the same as
translate.py, so the two runs land in one file and one provenance column — every
line records which model produced it.

`--verify` is the second reading the collection needs: each rendering is handed
back with its Igbo and asked whether the English actually says what the proverb
says, in a different model from the one that wrote it where possible. It writes a
verdict per proverb and never edits the rendering — the repair pass reads the
verdicts.
"""
from __future__ import annotations

import argparse
import json
import os
import random
import re
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
API = "https://api.deepseek.com/chat/completions"
KEY = os.environ.get("DEEPSEEK_API_KEY", "")
DEFAULT_MODEL = "deepseek-flash"

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

RENDER_SHAPE = {
    "proverbs": [
        {
            "id": 0,
            "meaning": "",
            "equivalent": None,
            "literal": "",
            "usage": "",
            "theme": "Wisdom",
            "confidence": "high",
        }
    ]
}

VERIFY_SHAPE = {
    "proverbs": [
        {
            "id": 0,
            "verdict": "ok",
            "problem": "",
            "better_meaning": "",
            "better_literal": "",
            "confidence": "high",
        }
    ]
}

RENDER_PROMPT = """You are an expert Igbo-English translator and cultural expert, writing the \
English for an Igbo proverb dictionary read by Igbo speakers and by people who have never met the \
language.

For each proverb below give:

- "meaning": the proverb's sense in plain, natural English — the point the saying makes, never a \
word-for-word gloss. If English has a proverb or common saying that carries the same point, write \
that saying as the meaning. Never invent an equivalent that does not exist in English.
- "equivalent": the English proverb or common saying, quoted exactly, when one genuinely exists; \
null when none does. Most Igbo proverbs have no English twin, so null is the common answer.
- "literal": what the Igbo words themselves say, in English, as flatly as possible — grammatical, \
but not smoothed into the meaning.
- "usage": one short sentence on when a speaker reaches for it and what it does in that situation \
(a warning, a consolation, a rebuke, praise of patience). Do not restate the meaning.
- "theme": exactly one of: """ + ", ".join(THEMES) + """.
- "confidence": "high" when the proverb's sense is well established and you are sure; "medium" when \
the sense is clear but the English could reasonably be phrased differently; "low" when the Igbo is \
corrupt, fragmentary, or you are guessing.

Where the Igbo is garbled — this corpus has typos and truncated lines — set "confidence" to "low" \
and put [uncertain] at the start of "meaning". Never guess silently and never leave a field empty. \
Reply with JSON only: {"proverbs": [...]} covering every id given.

Proverbs:
"""

VERIFY_PROMPT = """You are an expert Igbo-English translator and cultural expert checking another \
translator's work on Igbo proverbs. You are the second reading, and your job is to catch errors, \
not to rewrite for style.

For each item you are given the Igbo proverb, the English "meaning", the "literal" line, and the \
"usage" note. Judge whether:

1. the "literal" line actually says what the Igbo words say (watch for a misread word — a wrong \
sense of a verb, a noun taken as another noun, a tone difference that changes the word);
2. the "meaning" is what the proverb means in use, and not a generic sentiment that could belong to \
any proverb;
3. the "usage" is plausible for that proverb.

Answer per item:
- "verdict": "ok" when all three hold; "fix" when something is wrong; "unsure" when the Igbo itself \
is too corrupt to judge.
- "problem": one short sentence naming the error, in English. Empty when verdict is "ok".
- "better_meaning": a corrected meaning, only when the given one is wrong. Empty otherwise.
- "better_literal": a corrected literal line, only when the given one is wrong. Empty otherwise.
- "confidence": your own confidence in this verdict: high, medium or low.

Be strict about the literal line and about meanings that are generic. Do not flag a rendering merely \
because you would have phrased it differently. Reply with JSON only: {"proverbs": [...]} covering \
every id given.

Items:
"""


class Exhausted(RuntimeError):
    pass


def call(model: str, prompt: str, shape: dict, *, retries: int = 5) -> dict:
    body = {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": "You reply with JSON only, and you never wrap it in prose or code fences.",
            },
            {"role": "user", "content": prompt},
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0.15,
        "max_tokens": 16000,
    }
    data = json.dumps(body).encode()
    delay = 3.0
    last = None
    for _ in range(retries):
        request = urllib.request.Request(
            API,
            data=data,
            headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=900) as response:
                payload = json.loads(response.read())
            content = payload["choices"][0]["message"]["content"]
            # Some replies arrive fenced despite the instruction; strip it.
            content = re.sub(r"^```(?:json)?|```$", "", content.strip(), flags=re.M).strip()
            return json.loads(content)
        except urllib.error.HTTPError as error:
            detail = error.read().decode()[:300]
            last = f"HTTP {error.code}: {detail}"
            if error.code in (429, 402):
                raise Exhausted(last) from None
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


def rows_from(path: Path, done: set[int] | None = None) -> list[tuple[int, str]]:
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        if "\t" in line:
            pid, igbo = line.split("\t", 1)
        else:
            pid, igbo = line.split("\\t", 1)
        out.append((int(pid), igbo))
    if done is not None:
        out = [r for r in out if r[0] not in done]
    return out


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--verify-model", default="deepseek-v4-pro")
    parser.add_argument("--batch", type=int, default=15)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--verify", action="store_true")
    parser.add_argument("--in", dest="source", default=str(HERE / "untranslated.tsv"))
    parser.add_argument("--out", dest="out", default=str(HERE / "renderings.jsonl"))
    parser.add_argument("--report", default=str(HERE / "verify.jsonl"))
    args = parser.parse_args()

    if not KEY:
        raise SystemExit("DEEPSEEK_API_KEY is not set")

    out = Path(args.out)
    if args.verify:
        # Every rendering, whoever wrote it, is checked — the point is a second
        # reading, not a check of one model's work.
        items = []
        for line in out.read_text(encoding="utf-8").splitlines():
            if line.strip():
                items.append(json.loads(line))
        already: set[int] = set()
        report = Path(args.report)
        if report.exists():
            for line in report.read_text(encoding="utf-8").splitlines():
                if line.strip():
                    already.add(json.loads(line)["id"])
        todo = [i for i in items if i["id"] not in already]
        if args.limit:
            todo = todo[: args.limit]
        batches = [todo[i : i + args.batch] for i in range(0, len(todo), args.batch)]
        print(f"{len(items)} renderings, {len(already)} already checked, {len(todo)} to check "
              f"in {len(batches)} batches on {args.verify_model}", flush=True)
        prompt_for = lambda batch: VERIFY_PROMPT + "\n".join(  # noqa: E731
            json.dumps(
                {
                    "id": i["id"],
                    "igbo": i["igbo"],
                    "meaning": i.get("meaning"),
                    "literal": i.get("literal"),
                    "usage": i.get("usage"),
                },
                ensure_ascii=False,
            )
            for i in batch
        )
        target = report
    else:
        done: set[int] = set()
        if out.exists():
            for line in out.read_text(encoding="utf-8").splitlines():
                if line.strip():
                    done.add(json.loads(line)["id"])
        todo = rows_from(Path(args.source), done)
        if args.limit:
            todo = todo[: args.limit]
        batches = [todo[i : i + args.batch] for i in range(0, len(todo), args.batch)]
        print(f"{len(done)} already rendered, {len(todo)} to do in {len(batches)} batches "
              f"of {args.batch} on {args.model}", flush=True)
        prompt_for = lambda batch: RENDER_PROMPT + "\n".join(  # noqa: E731
            f'{pid}. "{igbo}"' for pid, igbo in batch
        )
        target = out

    lock = threading.Lock()
    written = 0
    failed = 0

    def run(index: int, batch) -> None:
        nonlocal written, failed
        try:
            result = call(args.verify_model if args.verify else args.model, prompt_for(batch),
                          VERIFY_SHAPE if args.verify else RENDER_SHAPE)
        except Exception as error:  # noqa: BLE001
            with lock:
                failed += len(batch)
            print(f"  batch {index + 1} FAILED: {error}", flush=True)
            return
        # The id comes back as a string about as often as a number, and a
        # mismatch here silently drops every answer in the batch.
        by_id: dict[int, dict] = {}
        for item in result.get("proverbs", []):
            try:
                by_id[int(item["id"])] = item
            except (KeyError, TypeError, ValueError):
                continue
        with lock:
            for entry in batch:
                pid = entry["id"] if isinstance(entry, dict) else entry[0]
                item = by_id.get(pid)
                if item is None:
                    failed += 1
                    continue
                item["id"] = pid
                if isinstance(entry, dict):
                    item["igbo"] = entry["igbo"]
                    item["checked_model"] = args.verify_model
                else:
                    item["igbo"] = entry[1]
                    item["model"] = args.model
                with target.open("a", encoding="utf-8") as handle:
                    handle.write(json.dumps(item, ensure_ascii=False) + "\n")
                written += 1
            print(f"  batch {index + 1}/{len(batches)}: {len(by_id)}/{len(batch)} "
                  f"(total {written})", flush=True)

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        list(pool.map(lambda pair: run(*pair), enumerate(batches)))
    print(f"done: {written} written, {failed} unanswered", flush=True)


if __name__ == "__main__":
    main()
