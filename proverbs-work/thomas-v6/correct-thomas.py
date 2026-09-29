#!/usr/bin/env python3
"""Restore Thomas's 1914 proverbs to readable Igbo and clean their English.

    python3 correct-thomas.py --limit 10        # taste test
    python3 correct-thomas.py                   # the whole set

Input:  parsed.json — number, igbo_raw, english_raw, taken from Apple Vision's
        reading of the scanned volume (Part VI, Proverbs, 1914).
Output: corrected.jsonl, one object per proverb, appended as it goes so the run
        is resumable.

WHY THIS IS NOT A TRANSLATION JOB

These proverbs already HAVE an English meaning: Thomas printed one under each.
So nothing here is invented — the model's job is to undo the scanner, not to
interpret. Thomas's transcription is also not modern Igbo: it is a phonetic
record of Asaba-district speech as heard in 1913, and the scan renders ị and ọ
as y, p, q or § depending on the letterform. The model is told to normalise to
standard Igbo only where the English meaning makes the reading certain, and to
say so when it does not.
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

SHAPE = {
    "proverbs": [
        {
            "number": 0,
            "igbo": "",
            "english": "",
            "usage": "",
            "dialect": "",
            "confidence": "high",
            "note": "",
        }
    ]
}

PROMPT = """You are an expert in Igbo language and in the anthropological literature on the Igbo, \
correcting a machine reading of an old printed book.

The text below is Northcote W. Thomas, *Anthropological Report on the Ibo-Speaking Peoples of \
Nigeria, Part VI: Proverbs, Stories, Tones in Ibo* (1914), scanned and read by OCR. Each numbered \
item gives the Igbo proverb as Thomas transcribed it — a phonetic record of Asaba-district speech, \
with the town it was collected in as a bracketed abbreviation — followed by his English meaning, \
and sometimes a note on when it is used.

The OCR is damaged, and so is the transcription. Undo both:

- "igbo": the proverb in standard modern Igbo orthography (ị ọ ụ ṅ, and tone marks only where they \
are needed to keep the sense). Use the English meaning and the proverb's known shape to settle a \
reading. Thomas writes ị and ọ inconsistently and the scanner turns them into `y`, `p`, `q`, `§`, \
`ç` or `B`; `rh` is a breathed r, `gb` and `kp` are single sounds. Do NOT translate the proverb — \
restore it.
- "english": Thomas's meaning, with OCR damage repaired, as one clean sentence. Keep his sense \
exactly; do not improve it into a different proverb. Drop the line-break hyphenation and stray \
punctuation. If his English is itself garbled past recovery, reconstruct the plainest reading its \
words support.
- "usage": the extra note Thomas gives on when the proverb is used (often a sentence beginning \
"The ..." or describing a situation). Empty string when there is none. Do not repeat the meaning.
- "dialect": the bracketed abbreviation expanded to the place it stands for — (As.) Asaba, (On.) \
Onitsha, (O.O.) Onitsha/Owerri, (Ubul.) Ubulu, (Ala.) Ala, (I.A.) Ika, (Uk.) Uku, (Ns.) Nsukka. \
Empty string if there is no marker or you cannot place it.
- "confidence": "high" when the Igbo clearly reads that way and the English is intact; "medium" \
when the reading is sound but a word could be spelled differently; "low" when the OCR leaves the \
proverb unrecoverable. Be honest — a low-confidence line is kept and marked, never guessed at.
- "note": one short sentence on what you changed or what is still uncertain. Empty when nothing \
is in doubt.

Reply with JSON only: {"proverbs": [...]}, one object per item given, keeping every number.

Items:
"""


class Exhausted(RuntimeError):
    pass


def call(prompt: str, retries: int = 5) -> dict:
    body = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": "You reply with JSON only, never prose or code fences."},
            {"role": "user", "content": prompt},
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0.1,
        # This model reasons before it answers, at length: on this task it spent
        # 59k characters of reasoning and returned an EMPTY answer under a
        # 16k cap, with finish_reason "length". Both numbers matter — the cap is
        # raised and the effort lowered, because the work here is undoing a
        # scanner, not solving a puzzle.
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
            detail = error.read().decode()[:200]
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


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--batch", type=int, default=12)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--in", dest="source", default=str(HERE / "parsed.json"))
    parser.add_argument("--out", dest="out", default=str(HERE / "corrected.jsonl"))
    args = parser.parse_args()

    if not KEY:
        raise SystemExit("DEEPSEEK_API_KEY is not set")

    items = json.loads(Path(args.source).read_text(encoding="utf-8"))
    items = [i for i in items if i["number"] >= 382]
    out = Path(args.out)
    done: set[int] = set()
    if out.exists():
        for line in out.read_text(encoding="utf-8").splitlines():
            if line.strip():
                done.add(json.loads(line)["number"])
    todo = [i for i in items if i["number"] not in done]
    if args.limit:
        todo = todo[: args.limit]
    batches = [todo[i : i + args.batch] for i in range(0, len(todo), args.batch)]
    print(f"{len(items)} proverbs, {len(done)} already done, {len(todo)} to do "
          f"in {len(batches)} batches on {MODEL}", flush=True)

    lock = threading.Lock()
    written = 0
    failed = 0

    def run(index: int, batch: list[dict]) -> None:
        nonlocal written, failed
        listing = "\n\n".join(
            f'{item["number"]}. IGBO: {item["igbo_raw"]}\nENGLISH: {item["english_raw"]}'
            for item in batch
        )
        try:
            result = call(PROMPT + listing)
        except Exception as error:  # noqa: BLE001
            with lock:
                failed += len(batch)
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
            matched_positions: set[int] = set()
            for position, item in enumerate(batch):
                entry = by_number.get(item["number"])
                # The model renumbers sometimes, answering 1..N instead of the
                # numbers it was given. The batch is in order and the answers are
                # in order, so position settles it — but only when that slot has
                # not already been claimed by a matching number.
                if entry is None and position < len(returned):
                    candidate = returned[position]
                    claimed = {id(v) for v in by_number.values()}
                    if id(candidate) not in claimed and position not in matched_positions:
                        entry = candidate
                        matched_positions.add(position)
                if entry is None:
                    failed += 1
                    continue
                entry["number"] = item["number"]
                entry["igbo_raw"] = item["igbo_raw"]
                entry["english_raw"] = item["english_raw"]
                with out.open("a", encoding="utf-8") as handle:
                    handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
                written += 1
            print(f"  batch {index + 1}/{len(batches)}: {len(by_number)}/{len(batch)} "
                  f"(total {written})", flush=True)

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        list(pool.map(lambda pair: run(*pair), enumerate(batches)))
    print(f"done: {written} written, {failed} unanswered", flush=True)


if __name__ == "__main__":
    main()
