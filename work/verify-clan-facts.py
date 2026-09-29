#!/usr/bin/env python3
"""Check every clan entry's description and figures against Igbo reality.

    python3 verify-clan-facts.py --limit 12     # taste test
    python3 verify-clan-facts.py                # the whole registry

Input:  ../data/clans/clans.json
Output: clan-fact-verdicts.jsonl — resumable, one entry per line.

WHY

The owner's finding: the descriptions of the Igbo clans are wrong in places, the
population figures among them, and a plain search or a model that knows Igbo
society settles most of it. He also named the case that showed the problem —
Umueri is a town, not a clan, and the Eri clan holds more than Umueri, because
Aguleri is part of it too.

So each entry is put to a model with the entry's own text and the source it
claims, and asked four things: is the description accurate, is the category
right, is the figure right and correctly described, and does the entry belong to
a larger group that the registry has missed. Nothing is edited from the answer:
the verdicts become a curated file, so every change is readable and reversible.
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
                    "description_ok": {"type": "boolean"},
                    "kind_ok": {"type": "boolean"},
                    "kind": {"type": "string"},
                    "figure_ok": {"type": "boolean"},
                    "parents": {"type": "string"},
                    "problem": {"type": "string"},
                    "correction": {"type": "string"},
                    "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
                },
                "required": ["id", "description_ok", "kind_ok", "problem", "confidence"],
            },
        }
    },
    "required": ["entries"],
}

PROMPT = """You are an expert on Igbo society, its towns, clans and the ethnography of the \
northern Igbo, checking a registry of Igbo places for accuracy.

The registry was built from Forde & Jones, *The Ibo and Ibibio-Speaking Peoples of South-Eastern \
Nigeria* (1950), Meek (1937) and Afigbo (1981). Its faults are known to include these, and you \
should look for them in every entry:

  1. A TOWN entered as a clan. Umueri is a town — the survey groups three towns under that name,
     which is why the mistake is easy to make. A single settlement is a town, not a clan.
  2. A CLAN SPLIT ACROSS ENTRIES, or an entry that belongs under a larger one. The Eri clan holds
     Aguleri, Umueri, Nteje, Awkuzu, Ogbunike, Nando, Ogboli, Igbariam, Amanuke and Nri; a registry
     that files Umueri as a clan of its own has broken that group apart.
  3. A WRONG OR MISDESCRIBED FIGURE. This registry reports Forde & Jones's counts of ACTIVE ADULT
     MALES for 1935-40, which are not populations and not current. A figure that is presented as a
     population, or attached to the wrong group, is wrong.

For each entry below — its name, its category, its region, its summary, its full description, the \
towns listed and the source it claims — answer:

- "description_ok": true when the description is accurate about this people; false when something
  in it is wrong. Judge the substance, not the wording.
- "kind_ok": true when the category is right (clan / town / section / confederation / kingdom /
  other). False when it is not, and then give the right one in "kind".
- "kind": your category for it, whether or not the entry has it right.
- "figure_ok": true when any number in the description is right AND described as what it is
  (a 1935-40 count of active adult males, not a population). False otherwise.
- "parents": the larger people or fraternity this entry belongs to, if the registry has missed one.
  Name it as an Igbo person would — "Umu-Eri", "Ikwerri". Empty string when it belongs to nothing
  larger that you can name.
- "problem": ONE sentence naming what is wrong, or empty when nothing is.
- "correction": a corrected summary sentence, when the description is wrong enough to need one.
  Empty otherwise. Do not invent figures: if you do not know the right one, say so in "problem".
- "confidence": high | medium | low for your own judgement. "low" is the honest answer when you are
  reasoning from the name alone.

Be strict, and be specific: name the town, the lineage or the figure that decided your answer.

Reply with JSON only: {"entries": [{"id": 0, "description_ok": true, "kind_ok": true, "kind": \
"clan", "figure_ok": true, "parents": "", "problem": "", "correction": "", "confidence": "high"}]}, \
one object per entry, keeping every id.

Entries:
"""


class Quota(RuntimeError):
    pass


def _post(url: str, data: bytes, headers: dict, retries: int = 4) -> dict:
    delay = 4.0
    last = None
    for _ in range(retries):
        request = urllib.request.Request(url, data=data, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=900) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as error:
            last = f"HTTP {error.code}: {error.read().decode()[:200]}"
            if error.code == 429:
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


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--batch", type=int, default=6)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument(
        "--in", dest="source", default=str(HERE.parent / "data" / "clans" / "clans.json")
    )
    parser.add_argument("--out", dest="out", default=str(HERE / "clan-fact-verdicts.jsonl"))
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
    print(f"{len(clans)} entries, {len(done)} checked, {len(todo)} to do in {len(batches)} batches", flush=True)

    lock = threading.Lock()
    spent: set[str] = set()
    counts: dict[str, int] = {}

    def judge(batch: list[dict]) -> tuple[str, dict]:
        listing = "\n\n".join(
            f'id {c["id"]}\nNAME: {c["name"]}\nCATEGORY: {c.get("kind")}\nREGION: {c.get("region") or "-"}\n'
            f'SUMMARY: {c.get("origin_summary") or "-"}\n'
            f'DESCRIPTION: {" ".join(c.get("description") or [])[:1400]}\n'
            f'TOWNS LISTED: {", ".join(c.get("towns") or []) or "(none)"}\n'
            f'SOURCE CLAIMED: {c.get("source") or "-"}'
            for c in batch
        )
        prompt = PROMPT + listing
        with lock:
            usable = [m for m in GEMINI_MODELS if m not in spent]
        for model in usable:
            try:
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
                return model, json.loads(payload["candidates"][0]["content"]["parts"][0]["text"])
            except Quota:
                with lock:
                    spent.add(model)
                    print(f"  {model}: quota spent", flush=True)
            except Exception as error:  # noqa: BLE001
                print(f"  {model}: {error}", flush=True)
        body = {
            "model": DEEPSEEK_MODEL,
            "messages": [
                {"role": "system", "content": "You reply with JSON only."},
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
        )
        content = payload["choices"][0]["message"]["content"]
        content = re.sub(r"^```(?:json)?|```$", "", content.strip(), flags=re.M).strip()
        return DEEPSEEK_MODEL, json.loads(content)

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
                record = {
                    "id": clan["id"],
                    "name": clan["name"],
                    # The entry's own category, then the model's answer spread over
                    # it. `kind` used to be set here and never overwritten, because
                    # the spread below did not include it — so every suggested
                    # category was thrown away and the corrections applied as a
                    # no-op. It is captured as `kind_suggested` now.
                    "kind": clan.get("kind"),
                    "region": clan.get("region"),
                    "towns": clan.get("towns") or [],
                    **{
                        k: entry.get(k)
                        for k in (
                            "description_ok", "kind_ok", "figure_ok", "parents",
                            "problem", "correction", "confidence",
                        )
                    },
                    "kind_suggested": entry.get("kind"),
                    "model": model,
                }
                for key in ("description_ok", "kind_ok", "figure_ok"):
                    if record.get(key) is not None:
                        counts[key] = counts.get(key, 0) + (1 if record[key] else 0)
                with out.open("a", encoding="utf-8") as handle:
                    handle.write(json.dumps(record, ensure_ascii=False) + "\n")
            print(f"  batch {index + 1}/{len(batches)}: {counts}", flush=True)

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        list(pool.map(lambda pair: run(*pair), enumerate(batches)))
    print(f"done: {counts}", flush=True)


if __name__ == "__main__":
    main()
