#!/usr/bin/env python3
"""Check every meaning the practice section can ask about.

    python3 verify-meanings.py --limit 20        # taste test
    python3 verify-meanings.py                   # the whole pool

Input:  pool.psv     — word id | headword | definition id | the English gloss,
                       for every published Igbo sense the practice quiz can serve.
Output: verdicts.jsonl — one line per sense, resumable.

WHY THIS EXISTS

The owner was quizzed on "àrụ ụkwụ" and told the answer was "leprosy". The word
means limping; leprosy is èkpèǹta. The entry came from the source corpus with that
gloss attached, and the quiz inherited it — so a wrong gloss in the dictionary is
not a wrong entry, it is a wrong ANSWER, shown to someone trying to learn.

WHAT IS ASKED, AND WHAT IS DONE WITH THE ANSWER

Each sense is checked as Igbo-to-English: does this Igbo word mean that English
gloss? The verdict is one of:

  ok          the gloss is right
  wrong       the gloss is wrong — and a corrected gloss is required
  partial     the gloss is one sense among others (recorded, not treated as wrong)
  unsure      the word is unfamiliar, dialectal or unreadable — no correction is
              invented, and the sense is taken out of the practice pool

Nothing is deleted on a model's word alone: the corrections land in a curated file
that a person can read, and the ones marked unsure are excluded from the quiz
rather than silently rewritten.
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
        "senses": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "integer"},
                    "verdict": {"type": "string", "enum": ["ok", "wrong", "partial", "unsure"]},
                    "correction": {"type": "string"},
                    "note": {"type": "string"},
                },
                "required": ["id", "verdict"],
            },
        }
    },
    "required": ["senses"],
}

PROMPT = """You are an Igbo lexicographer checking a dictionary's English glosses.

Each item below is an Igbo headword and the English meaning the dictionary gives it. Say whether \
that meaning is right.

- "ok": the gloss is a correct meaning of the word.
- "wrong": the gloss is NOT a meaning of this Igbo word — it belongs to a different word. Say which \
word in "note" where you can, and give the correct meaning of THIS headword in "correction".
- "partial": the gloss is right but narrow, or one sense among several the word carries. Do not \
treat a missing sense as wrong; put the fuller sense in "correction" when it matters.
- "unsure": you cannot judge — the headword is dialectal, damaged, or unfamiliar to you. Never \
guess in this case; "unsure" is the honest answer and the entry is removed from the quiz.

Two traps to watch for, both of which have put wrong answers in front of learners:

1. A gloss that describes a CAUSE or a SYMPTOM rather than the word itself. "àrụ ụkwụ" is limping \
or walking with a deformed leg; leprosy is "èkpèǹta". A leper may limp, and that does not make \
limping leprosy.
2. A gloss from a different language. Ẹkpẹyẹ, Igala and Edo words sit in this dictionary beside \
Igbo ones; if the headword does not look like the Igbo you know, say so.

The "correction" field must be an English gloss in the dictionary's own style — lower case, no full \
stop, senses separated by semicolons. Leave it empty when the verdict is "ok".

Reply with JSON only: {"senses": [{"id": 0, "verdict": "ok", "correction": "", "note": ""}]}, one \
object per item, keeping every id.

Items:
"""


class Quota(RuntimeError):
    pass


def _post(url: str, data: bytes, headers: dict, retries: int = 4, quota_codes=(429,)) -> dict:
    delay = 4.0
    last = None
    for _ in range(retries):
        request = urllib.request.Request(url, data=data, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=900) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as error:
            detail = error.read().decode()[:200]
            last = f"HTTP {error.code}: {detail}"
            if error.code in quota_codes:
                raise Quota(last) from None
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


def call_gemini(model: str, prompt: str) -> dict:
    body = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.1,
            "responseMimeType": "application/json",
            "responseSchema": SHAPE,
        },
    }
    payload = _post(
        GEMINI_URL.format(model=model),
        json.dumps(body).encode(),
        {"x-goog-api-key": GEMINI_KEY, "Content-Type": "application/json"},
    )
    return json.loads(payload["candidates"][0]["content"]["parts"][0]["text"])


def call_deepseek(prompt: str) -> dict:
    body = {
        "model": DEEPSEEK_MODEL,
        "messages": [
            {"role": "system", "content": "You reply with JSON only, never prose or code fences."},
            {"role": "user", "content": prompt},
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0.1,
        "max_tokens": 64000,
        "reasoning_effort": "low",
    }
    payload = _post(
        DEEPSEEK_URL,
        json.dumps(body).encode(),
        {"Authorization": f"Bearer {DEEPSEEK_KEY}", "Content-Type": "application/json"},
        quota_codes=(),
    )
    content = payload["choices"][0]["message"]["content"]
    content = re.sub(r"^```(?:json)?|```$", "", content.strip(), flags=re.M).strip()
    return json.loads(content)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--batch", type=int, default=20)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--in", dest="source", default=str(HERE / "pool.psv"))
    parser.add_argument("--out", dest="out", default=str(HERE / "verdicts.jsonl"))
    args = parser.parse_args()
    if not GEMINI_KEY and not DEEPSEEK_KEY:
        raise SystemExit("no API key is set")

    items = []
    for line in Path(args.source).read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        parts = line.split("|")
        if len(parts) < 4:
            continue
        items.append(
            {"wordId": int(parts[0]), "headword": parts[1], "defId": int(parts[2]), "gloss": parts[3]}
        )

    out = Path(args.out)
    done: set[int] = set()
    if out.exists():
        for line in out.read_text(encoding="utf-8").splitlines():
            if line.strip():
                done.add(json.loads(line)["defId"])
    todo = [i for i in items if i["defId"] not in done]
    if args.limit:
        todo = todo[: args.limit]
    batches = [todo[i : i + args.batch] for i in range(0, len(todo), args.batch)]
    print(f"{len(items)} senses, {len(done)} checked, {len(todo)} to do in {len(batches)} batches", flush=True)

    lock = threading.Lock()
    spent: set[str] = set()
    counts: dict[str, int] = {}

    def judge(batch: list[dict]) -> tuple[str, dict]:
        listing = "\n\n".join(
            f'{s["defId"]}. IGBO: {s["headword"]}\nMEANING GIVEN: {s["gloss"]}' for s in batch
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
                    print(f"  {model}: quota spent", flush=True)
            except Exception as error:  # noqa: BLE001
                print(f"  {model} error: {error}", flush=True)
        if DEEPSEEK_KEY:
            return DEEPSEEK_MODEL, call_deepseek(prompt)
        raise Quota("every model is spent")

    def run(index: int, batch: list[dict]) -> None:
        try:
            model, result = judge(batch)
        except Exception as error:  # noqa: BLE001
            print(f"  batch {index + 1} FAILED: {error}", flush=True)
            return
        returned = [s for s in result.get("senses", []) if isinstance(s, dict)]
        by_id: dict[int, dict] = {}
        for entry in returned:
            try:
                by_id[int(entry["id"])] = entry
            except (KeyError, TypeError, ValueError):
                continue
        with lock:
            for position, sense in enumerate(batch):
                entry = by_id.get(sense["defId"])
                if entry is None and position < len(returned):
                    entry = returned[position]
                if entry is None:
                    continue
                verdict = str(entry.get("verdict") or "unsure")
                counts[verdict] = counts.get(verdict, 0) + 1
                record = {
                    "defId": sense["defId"],
                    "wordId": sense["wordId"],
                    "headword": sense["headword"],
                    "gloss": sense["gloss"],
                    "verdict": verdict,
                    "correction": (entry.get("correction") or "").strip(),
                    "note": (entry.get("note") or "").strip(),
                    "model": model,
                }
                with out.open("a", encoding="utf-8") as handle:
                    handle.write(json.dumps(record, ensure_ascii=False) + "\n")
            print(f"  batch {index + 1}/{len(batches)}: {counts}", flush=True)

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        list(pool.map(lambda pair: run(*pair), enumerate(batches)))
    print(f"done: {counts}", flush=True)


if __name__ == "__main__":
    main()
