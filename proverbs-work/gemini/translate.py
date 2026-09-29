#!/usr/bin/env python3
"""English renderings for the Igbo proverbs that carry none.

    python3 translate.py --model gemini-3.5-flash --limit 10     # taste test
    python3 translate.py --model gemini-3.5-flash                # the whole set

Reads `untranslated.tsv` (id<TAB>igbo), asks Gemini for a rendering of each
proverb in batches, and appends one JSON object per proverb to `renderings.jsonl`
as it goes — so the run is resumable and an interrupted batch costs nothing but
the batch. Proverbs already in the JSONL are skipped on a re-run.

What is asked for, per proverb:
  meaning      the sense in plain English; the English proverb if one exists
  equivalent   that English proverb, when there is one, else null
  literal      what the words say, kept as words
  usage        when a speaker reaches for it
  theme        one of the eleven themes the proverbs page filters by
  confidence   high | medium | low, and `uncertain` when the sense is not settled
"""
from __future__ import annotations

import argparse
import json
import os
import random
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
API = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
KEY = os.environ.get("GEMINI_API_KEY", "")

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

SCHEMA = {
    "type": "object",
    "properties": {
        "proverbs": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "integer"},
                    "meaning": {"type": "string"},
                    "equivalent": {"type": "string", "nullable": True},
                    "literal": {"type": "string"},
                    "usage": {"type": "string"},
                    "theme": {"type": "string", "enum": THEMES},
                    "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
                },
                "required": ["id", "meaning", "literal", "usage", "theme", "confidence"],
            },
        }
    },
    "required": ["proverbs"],
}

INSTRUCTIONS = """You are an expert Igbo-English translator and cultural expert, writing the \
English for an Igbo proverb dictionary read by Igbo speakers and by people who have never met \
the language.

For each proverb below, give:

- "meaning": the proverb's sense in plain, natural English — the point the saying makes, never a \
word-for-word gloss. If English has a proverb or common saying that carries the same point, write \
that saying as the meaning. Never invent an equivalent that does not exist in English.
- "equivalent": the English proverb or common saying, quoted exactly, when one genuinely exists. \
Use null when none does. Do not reach for one: most Igbo proverbs have no English twin.
- "literal": what the Igbo words themselves say, in English, as flatly as possible (for "Ọ bụ nwayọọ \
ka e ji aracha ọhịa": "It is with gentleness that one chews the bush"). Keep it grammatical but do \
not smooth it into the meaning.
- "usage": one short sentence on when a speaker reaches for it — the situation, and what it does \
in that situation (a warning, a consolation, a rebuke, praise of patience). Do not restate the \
meaning.
- "theme": exactly one of: """ + ", ".join(THEMES) + """.
- "confidence": "high" when the proverb's sense is well established and you are sure; "medium" when \
the sense is clear but the English could reasonably be phrased differently; "low" when the Igbo is \
corrupt, fragmentary, or you are guessing.

Where the Igbo itself is garbled — the corpus has typos and truncated lines — say so: set \
"confidence" to "low", and put [uncertain] at the start of "meaning". Never guess silently, and never \
leave a field empty. Do not add commentary outside the JSON.

Proverbs:
"""


class Quota(RuntimeError):
    """The model's quota is spent. Another model has its own."""


def call(model: str, prompt: str, *, retries: int = 6) -> dict:
    body = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.15,
            "responseMimeType": "application/json",
            "responseSchema": SCHEMA,
        },
    }
    data = json.dumps(body).encode()
    delay = 3.0
    last = None
    for attempt in range(retries):
        request = urllib.request.Request(
            API.format(model=model),
            data=data,
            headers={"x-goog-api-key": KEY, "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=600) as response:
                payload = json.loads(response.read())
            text = payload["candidates"][0]["content"]["parts"][0]["text"]
            return json.loads(text)
        except urllib.error.HTTPError as error:
            detail = error.read().decode()[:200]
            last = f"HTTP {error.code}: {detail}"
            # A spent quota is not a transient failure: retrying it just burns the
            # clock, so it is raised at once and the caller moves to another model.
            if error.code == 429:
                raise Quota(f"{model}: {last}") from None
            if error.code in (500, 502, 503, 504):
                time.sleep(delay + random.random())
                delay = min(delay * 2, 90)
                continue
            raise RuntimeError(last) from None
        except Exception as error:  # noqa: BLE001 — transient network or JSON shape
            last = f"{type(error).__name__}: {error}"
            time.sleep(delay + random.random())
            delay = min(delay * 2, 90)
    raise RuntimeError(f"gave up after {retries} attempts ({last})")


DEFAULT_MODELS = [
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-3.1-flash-lite-preview",
]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="")
    parser.add_argument(
        "--models",
        default=",".join(DEFAULT_MODELS),
        help="models to rotate through when one's quota is spent",
    )
    parser.add_argument("--batch", type=int, default=20)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--in", dest="source", default=str(HERE / "untranslated.tsv"))
    parser.add_argument("--out", dest="out", default=str(HERE / "renderings.jsonl"))
    args = parser.parse_args()

    if not KEY:
        raise SystemExit("GEMINI_API_KEY is not set")

    models = [args.model] if args.model else [m.strip() for m in args.models.split(",") if m.strip()]

    rows = []
    for line in Path(args.source).read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        if "\t" in line:
            pid, igbo = line.split("\t", 1)
        else:  # psql -F'\t' writes the escape literally when it is not a real tab
            pid, igbo = line.split("\\t", 1)
        rows.append((int(pid), igbo))

    out = Path(args.out)
    done: set[int] = set()
    if out.exists():
        for line in out.read_text(encoding="utf-8").splitlines():
            if line.strip():
                done.add(json.loads(line)["id"])

    todo = [(i, t) for i, t in rows if i not in done]
    if args.limit:
        todo = todo[: args.limit]
    batches = [todo[i : i + args.batch] for i in range(0, len(todo), args.batch)]

    print(f"{len(rows)} proverbs, {len(done)} already rendered, {len(todo)} to do "
          f"in {len(batches)} batches of {args.batch} on {', '.join(models)}", flush=True)

    lock = threading.Lock()
    spent: set[str] = set()
    written = 0
    failed = 0

    def render(batch: list[tuple[int, str]]) -> tuple[str, dict]:
        """One batch, on whichever model still has room. Raises when none has."""
        listing = "\n".join(f'{pid}. "{igbo}"' for pid, igbo in batch)
        prompt = INSTRUCTIONS + listing
        last = None
        for attempt in range(3):
            with lock:
                usable = [m for m in models if m not in spent]
            if not usable:
                raise Quota("every model's quota is spent")
            for model in usable:
                try:
                    return model, call(model, prompt)
                except Quota as error:
                    last = error
                    with lock:
                        if model not in spent:
                            spent.add(model)
                            print(f"  {model}: quota spent, {len(models) - len(spent)} left",
                                  flush=True)
            # Everything is spent or the models are busy; wait and look again.
            time.sleep(45 * (attempt + 1))
        raise Quota(str(last))

    def run(index: int, batch: list[tuple[int, str]]) -> None:
        nonlocal written, failed
        try:
            model, result = render(batch)
        except Exception as error:  # noqa: BLE001
            with lock:
                failed += len(batch)
            print(f"  batch {index + 1} FAILED: {error}", flush=True)
            return
        by_id = {item["id"]: item for item in result.get("proverbs", [])}
        with lock:
            for pid, igbo in batch:
                item = by_id.get(pid)
                if item is None:
                    failed += 1
                    print(f"  batch {index + 1}: no answer for {pid}", flush=True)
                    continue
                item["igbo"] = igbo
                item["model"] = model
                with out.open("a", encoding="utf-8") as handle:
                    handle.write(json.dumps(item, ensure_ascii=False) + "\n")
                written += 1
            print(f"  batch {index + 1}/{len(batches)}: {len(by_id)}/{len(batch)} "
                  f"on {model} (total written {written})", flush=True)

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        list(pool.map(lambda pair: run(*pair), enumerate(batches)))

    print(f"done: {written} renderings written, {failed} unanswered", flush=True)


if __name__ == "__main__":
    main()
