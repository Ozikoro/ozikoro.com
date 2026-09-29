#!/usr/bin/env python3
"""Check every clan entry against Igbo reality, not against the source alone.

    python3 verify-clans.py --limit 12      # taste test
    python3 verify-clans.py                 # the whole registry

Input:  ../data/clans/clans.json
Output: clan-verdicts.jsonl — resumable, one clan per line.

WHY

The owner looked at the registry and said plainly that some of what is entered as
a clan is a town, and that some clans have been divided — and that the fault is in
the sources, which he supplied. He is right on both counts, and the reason is
structural rather than a slip: Forde & Jones tabulates the groups a colonial
division was administered through, and that is not always the unit an Igbo person
would name as their clan. Some rows are single towns; some single clans are split
across two rows; some names are sections or confederations.

The sources cannot be asked what they meant, so this asks a model that knows Igbo
place organisation — with the three books' answer in hand — to say which it is. The
result is a verdict per entry, never an edit: reclassification is applied from a
curated file afterwards, where each change can be read and argued with.

WHAT IS ASKED PER ENTRY

  kind          clan | town | section | confederation | kingdom | other
  confidence    high | medium | low
  towns_are_clans  whether the entry's towns list appears to hold towns that are
                themselves clans (the reverse error)
  missing       a clan this entry appears to have been split from, if any
  note          one sentence, naming the reason
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
        "entries": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "integer"},
                    "kind": {
                        "type": "string",
                        "enum": ["clan", "town", "section", "confederation", "kingdom", "other"],
                    },
                    "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
                    "towns_are_clans": {"type": "boolean"},
                    "missing": {"type": "string"},
                    "note": {"type": "string"},
                },
                "required": ["id", "kind", "confidence", "note"],
            },
        }
    },
    "required": ["entries"],
}

PROMPT = """You are an expert on Igbo society and its place organisation, checking a clan \
registry that was assembled from colonial-era ethnography.

The registry is drawn from Forde & Jones, *The Ibo and Ibibio-Speaking Peoples of South-Eastern \
Nigeria* (1950), with Meek (1937) and Afigbo (1981). That survey tabulates the groups a colonial \
division was administered through, and those are NOT always the unit an Igbo person would call \
their clan. The owner has reviewed the registry and reports two faults: some entries that are \
called clans are in fact single TOWNS, and some single clans have been SPLIT across several \
entries. Both are faults of the sources, and both are your job to find.

For each entry below — its name, its section, its region, a one-line summary and the towns the \
source lists for it — answer:

- "kind": what the entry actually is.
    clan            a named group of towns claiming common descent or a common origin — the unit
                    an Igbo person names when asked where they are from
    town            a single settlement, not a group of settlements
    section         an administrative or colonial grouping, or a district rather than a people
    confederation   a federation of clans that are themselves the units people name
    kingdom         a monarchy whose subject units are themselves clans
    other           anything else, explained in "note"
- "confidence": high | medium | low. Use low when the entry is obscure and you are reasoning from
  the name and the summary alone.
- "towns_are_clans": true when the towns listed for this entry are themselves clans (the reverse
  error — a section entered as a clan, whose "towns" are really its member clans).
- "missing": if this entry looks like one part of a clan that has been split across several
  entries, name the clan they are parts of. Empty string otherwise.
- "note": ONE sentence naming your reason. This is what a reviewer will read, so make it specific —
  name the towns, the tradition or the feature of the name that decided it.

Ground rules: an entry whose name is a town and whose "towns" list contains only itself is a town. \
A name that is widely known as a kingdom (Onitsha, Nri, Aboh) is still a clan in this registry's \
sense if its people name it as where they are from — say "clan" and note the ambiguity. Do not \
invent entries, and do not correct spellings.

Reply with JSON only: {"entries": [{"id": 0, "kind": "clan", "confidence": "high", \
"towns_are_clans": false, "missing": "", "note": ""}]}, one object per entry, keeping every id.

Entries:
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
    parser.add_argument("--batch", type=int, default=12)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument(
        "--in", dest="source", default=str(HERE.parent / "data" / "clans" / "clans.json")
    )
    parser.add_argument("--out", dest="out", default=str(HERE / "clan-verdicts.jsonl"))
    args = parser.parse_args()
    if not GEMINI_KEY and not DEEPSEEK_KEY:
        raise SystemExit("no API key is set")

    doc = json.loads(Path(args.source).read_text(encoding="utf-8"))
    clans = doc["clans"]
    for index, clan in enumerate(clans):
        clan["id"] = index

    out = Path(args.out)
    done: set[int] = set()
    if out.exists():
        for line in out.read_text(encoding="utf-8").splitlines():
            if line.strip():
                done.add(json.loads(line)["id"])
    todo = [c for c in clans if c["id"] not in done]
    if args.limit:
        todo = todo[: args.limit]
    batches = [todo[i : i + args.batch] for i in range(0, len(todo), args.batch)]
    print(f"{len(clans)} clans, {len(done)} checked, {len(todo)} to do in {len(batches)} batches", flush=True)

    lock = threading.Lock()
    spent: set[str] = set()
    counts: dict[str, int] = {}

    def judge(batch: list[dict]) -> tuple[str, dict]:
        listing = "\n\n".join(
            f'id {c["id"]}\nNAME: {c["name"]}\nSECTION: {c.get("tribe") or "-"}\n'
            f'REGION: {c.get("region") or "-"}\nSUMMARY: {c.get("origin_summary") or "-"}\n'
            f'TOWNS LISTED: {", ".join(c.get("towns") or []) or "(none)"}'
            for c in batch
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
        returned = [e for e in result.get("entries", []) if isinstance(e, dict)]
        by_id: dict[int, dict] = {}
        for entry in returned:
            try:
                by_id[int(entry["id"])] = entry
            except (KeyError, TypeError, ValueError):
                continue
        with lock:
            for position, clan in enumerate(batch):
                entry = by_id.get(clan["id"])
                if entry is None and position < len(returned):
                    entry = returned[position]
                if entry is None:
                    continue
                kind = str(entry.get("kind") or "other")
                counts[kind] = counts.get(kind, 0) + 1
                record = {
                    "id": clan["id"],
                    "name": clan["name"],
                    "tribe": clan.get("tribe"),
                    "region": clan.get("region"),
                    "towns": clan.get("towns") or [],
                    "kind": kind,
                    "confidence": str(entry.get("confidence") or "low"),
                    "towns_are_clans": bool(entry.get("towns_are_clans")),
                    "missing": (entry.get("missing") or "").strip(),
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
