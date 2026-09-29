#!/usr/bin/env python3
"""Two example sentences for every word that has none.

    python3 examples-generate.py --limit 20        # taste test
    python3 examples-generate.py                   # the whole set

Input:  no-examples.psv — id | headword | gloss | part of speech, for the words
        that carry no example sentence at all (7,363 of them).
Output: examples.jsonl — resumable, one word per line.

WHY TWO, AND WHY NOT ONE

An entry page shows one example when the word has one sense and two when it has
more, and the owner asked for a minimum of two per page. One sentence shows a
word in one construction; two show it doing two different things, which is the
difference between an entry a learner can use and an entry that merely has a
line under it.

WHAT THE MODEL IS ASKED TO DO, AND WHAT IT IS TOLD NOT TO

The dictionary's own gloss is the anchor: the sentences must illustrate THAT
sense and no other. The Igbo has to be standard orthography and idiomatic, short
enough to read at a glance, and about ordinary things — a market, a farm, a
child, a journey — rather than the abstractions a language model reaches for by
default. Where a word is a verb stem written with a leading hyphen ("-pàtò"), the
sentence uses it in a real construction rather than quoting the stem.

Gemini first, because the owner asked for it by name; DeepSeek when its quota is
spent. Both are recorded per word, so the provenance of an example is never a
guess.
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
GEMINI_KEY = os.environ.get("GEMINI_API_KEY", "")
DEEPSEEK_KEY = os.environ.get("DEEPSEEK_API_KEY", "")
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
DEEPSEEK_URL = "https://api.deepseek.com/chat/completions"

GEMINI_MODELS = ["gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]
DEEPSEEK_MODEL = "deepseek-flash"

SHAPE = {
    "type": "object",
    "properties": {
        "words": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "integer"},
                    "examples": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "igbo": {"type": "string"},
                                "english": {"type": "string"},
                            },
                            "required": ["igbo", "english"],
                        },
                    },
                    "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
                    "note": {"type": "string"},
                },
                "required": ["id", "examples", "confidence"],
            },
        }
    },
    "required": ["words"],
}

PROMPT = """You are an Igbo teacher writing example sentences for a dictionary.

For each entry below you are given an Igbo word, its English meaning, and its part of speech. \
Write TWO example sentences that show that word being used in that sense.

Rules, and they matter more than style:

- The Igbo must be standard modern orthography — ị ọ ụ ṅ, and tone marks where the word itself \
carries them — and it must be idiomatic. A sentence that is grammatical but that no speaker would \
say is worse than no sentence.
- The sentence must illustrate THAT meaning and no other sense of the word.
- Keep sentences short: six to twelve words. A learner reads them at a glance.
- Make the two sentences different in shape, not two versions of one: if the first is a statement, \
let the second be a question, a command or a contrast, and use the word in a different construction \
or with a different object.
- Write about ordinary life: a market, a farm, food, a child, a journey, work, weather. Avoid \
proverbs, abstractions and anything that sounds like a grammar exercise.
- If the headword begins with a hyphen it is a verb stem: write the sentence with the verb properly \
inflected, not with a bare "-" in it.
- The English is a plain translation of the Igbo sentence, not a second gloss.
- "confidence": "high" when you are sure both sentences are idiomatic and correct; "medium" when \
they are sound but you would phrase one differently; "low" when the word's sense is unclear to you. \
If you are not sure of the word at all, return an EMPTY examples array and say why in "note" — an \
entry with no examples is recoverable, an entry with wrong Igbo is not.

Reply with JSON only: {"words": [{"id": 0, "examples": [{"igbo": "...", "english": "..."}], \
"confidence": "high", "note": ""}]}, one object per entry, keeping every id.

Entries:
"""


class Quota(RuntimeError):
    pass


def call_gemini(model: str, prompt: str, retries: int = 4) -> dict:
    body = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.3,
            "responseMimeType": "application/json",
            "responseSchema": SHAPE,
        },
    }
    data = json.dumps(body).encode()
    delay = 4.0
    last = None
    for _ in range(retries):
        request = urllib.request.Request(
            GEMINI_URL.format(model=model),
            data=data,
            headers={"x-goog-api-key": GEMINI_KEY, "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=600) as response:
                payload = json.loads(response.read())
            text = payload["candidates"][0]["content"]["parts"][0]["text"]
            return json.loads(text)
        except urllib.error.HTTPError as error:
            detail = error.read().decode()[:200]
            last = f"HTTP {error.code}: {detail}"
            if error.code == 429:
                raise Quota(last) from None
            if error.code in (500, 502, 503, 504):
                time.sleep(delay + random.random())
                delay = min(delay * 2, 60)
                continue
            raise RuntimeError(last) from None
        except Exception as error:  # noqa: BLE001
            last = f"{type(error).__name__}: {error}"
            time.sleep(delay + random.random())
            delay = min(delay * 2, 60)
    raise RuntimeError(f"gemini gave up after {retries} attempts ({last})")


def call_deepseek(prompt: str, retries: int = 4) -> dict:
    body = {
        "model": DEEPSEEK_MODEL,
        "messages": [
            {"role": "system", "content": "You reply with JSON only, never prose or code fences."},
            {"role": "user", "content": prompt},
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0.3,
        "max_tokens": 64000,
        "reasoning_effort": "low",
    }
    data = json.dumps(body).encode()
    delay = 4.0
    last = None
    for _ in range(retries):
        request = urllib.request.Request(
            DEEPSEEK_URL,
            data=data,
            headers={"Authorization": f"Bearer {DEEPSEEK_KEY}", "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=900) as response:
                payload = json.loads(response.read())
            content = payload["choices"][0]["message"]["content"]
            content = re.sub(r"^```(?:json)?|```$", "", content.strip(), flags=re.M).strip()
            return json.loads(content)
        except urllib.error.HTTPError as error:
            detail = error.read().decode()[:200]
            last = f"HTTP {error.code}: {detail}"
            if error.code >= 500 or error.code == 429:
                time.sleep(delay + random.random())
                delay = min(delay * 2, 60)
                continue
            raise RuntimeError(last) from None
        except Exception as error:  # noqa: BLE001
            last = f"{type(error).__name__}: {error}"
            time.sleep(delay + random.random())
            delay = min(delay * 2, 60)
    raise RuntimeError(f"deepseek gave up after {retries} attempts ({last})")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--batch", type=int, default=10)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--in", dest="source", default=str(HERE / "no-examples.psv"))
    parser.add_argument(
        "--out",
        dest="out",
        # Under data/, with the other curated knowledge: that is the only part of
        # the tree the runtime image carries, so a file written anywhere else
        # cannot be imported where it is needed.
        default=str(HERE.parent / "data" / "words" / "examples-generated.jsonl"),
    )
    args = parser.parse_args()

    if not GEMINI_KEY and not DEEPSEEK_KEY:
        raise SystemExit("neither GEMINI_API_KEY nor DEEPSEEK_API_KEY is set")

    words = []
    for line in Path(args.source).read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        parts = line.split("|")
        if len(parts) < 3:
            continue
        words.append({"id": int(parts[0]), "headword": parts[1], "gloss": parts[2]})

    out = Path(args.out)
    done: set[int] = set()
    if out.exists():
        for line in out.read_text(encoding="utf-8").splitlines():
            if line.strip():
                done.add(json.loads(line)["id"])
    todo = [w for w in words if w["id"] not in done]
    if args.limit:
        todo = todo[: args.limit]
    batches = [todo[i : i + args.batch] for i in range(0, len(todo), args.batch)]
    print(f"{len(words)} words, {len(done)} done, {len(todo)} to do in {len(batches)} batches", flush=True)

    lock = threading.Lock()
    spent: set[str] = set()
    written = 0
    empty = 0

    def render(batch: list[dict]) -> tuple[str, dict]:
        listing = "\n\n".join(
            f'{w["id"]}. IGBO: {w["headword"]}\nMEANING: {w["gloss"]}' for w in batch
        )
        prompt = PROMPT + listing
        with lock:
            usable = [m for m in GEMINI_MODELS if m not in spent]
        for model in usable:
            try:
                return model, call_gemini(model, prompt)
            except Quota:
                with lock:
                    spent.add(model)
                    print(f"  {model}: quota spent, falling back", flush=True)
            except Exception as error:  # noqa: BLE001
                print(f"  {model} error: {error}", flush=True)
        if DEEPSEEK_KEY:
            return DEEPSEEK_MODEL, call_deepseek(prompt)
        raise Quota("every model is spent")

    def run(index: int, batch: list[dict]) -> None:
        nonlocal written, empty
        try:
            model, result = render(batch)
        except Exception as error:  # noqa: BLE001
            print(f"  batch {index + 1} FAILED: {error}", flush=True)
            return
        returned = [e for e in result.get("words", []) if isinstance(e, dict)]
        by_id: dict[int, dict] = {}
        for entry in returned:
            try:
                by_id[int(entry["id"])] = entry
            except (KeyError, TypeError, ValueError):
                continue
        with lock:
            for position, word in enumerate(batch):
                entry = by_id.get(word["id"])
                if entry is None and position < len(returned):
                    entry = returned[position]
                if entry is None:
                    continue
                examples = [e for e in (entry.get("examples") or []) if e.get("igbo") and e.get("english")]
                record = {
                    "id": word["id"],
                    "headword": word["headword"],
                    "gloss": word["gloss"],
                    "examples": examples[:2],
                    "confidence": entry.get("confidence") or "medium",
                    "note": entry.get("note") or "",
                    "model": model,
                }
                if not examples:
                    empty += 1
                    continue
                with out.open("a", encoding="utf-8") as handle:
                    handle.write(json.dumps(record, ensure_ascii=False) + "\n")
                written += 1
            print(f"  batch {index + 1}/{len(batches)}: total {written} ({empty} empty)", flush=True)

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        list(pool.map(lambda pair: run(*pair), enumerate(batches)))
    print(f"done: {written} words with examples, {empty} the model declined", flush=True)


if __name__ == "__main__":
    main()
