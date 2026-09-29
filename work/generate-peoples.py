#!/usr/bin/env python3
"""The constituent peoples of the Nigerian nations, beyond the Igbo.

    python3 generate-peoples.py

Writes  peoples-generated.json  → merged into data/clans/clans.json by
        merge-peoples.py.

WHY

The owner's ruling: the registry is not only Igbo. Yoruba, Ijaw and the rest
belong in it, and the tribal divisions inside those nations belong there too —
the same distinction the Igbo side already makes between a confederation and the
clans under it.

He sent a Facebook post listing "the 22 tribes of the Yoruba nation". Facebook
serves only a truncated meta description of that post (eight of the twenty-two
names), so the list is asked for here instead, seeded with those eight, and every
name is then put to a second pass that is told to reject anything it cannot place.
A name that cannot be placed is dropped rather than published: an invented tribe
is worse than a missing one, exactly as with the Igbo entries.

Every entry carries the state(s) it is found in and a one-line note, so a reader
sees where it is rather than only what it is called.
"""
from __future__ import annotations

import json
import os
import random
import re
import time
import urllib.error
import urllib.request
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
        "peoples": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "nation": {"type": "string"},
                    "kind": {"type": "string", "enum": ["tribe", "kingdom", "confederation"]},
                    "states": {"type": "string"},
                    "summary": {"type": "string"},
                    "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
                },
                "required": ["name", "nation", "kind", "states", "summary", "confidence"],
            },
        }
    },
    "required": ["peoples"],
}

PROMPT = """You are an expert on the peoples of Nigeria. List the constituent traditional \
peoples (often called tribes or sub-ethnic groups) of the following Nigerian nations, as an Igbo \
person would name their own clan:

  Yoruba, Ijaw (Izon), Edo, Urhobo, Isoko, Itsekiri, Igala, Ebira, Nupe, Idoma, Tiv, Efik, Ibibio

For the Yoruba, the owner supplied this beginning of a list of 22 — complete it and correct it:
Yoruba-Ife, Yoruba-Oyo, Yoruba-Ohori (Benin Republic), Yoruba-Ekiti, Yoruba-Ife-Togo, Yoruba-Oworo,
Yoruba-Akoko, Yoruba-Ijesa.

For each people give:
- "name": the name the people call themselves, in the spelling used in Nigeria (e.g. "Ijesa", not
  "Ijesha" unless that is the common Nigerian form). Do NOT prefix it with the nation's name.
- "nation": one of the nations listed above — the wider people it belongs to.
- "kind": "tribe" for a people, "kingdom" where the group is primarily known as a monarchy whose
  subject units are themselves communities (Benin, Oyo, Nupe), "confederation" where it is a
  federation of smaller peoples (Ijaw, Tiv).
- "states": the Nigerian state or states it is found in, comma-separated.
- "summary": ONE sentence — where it is and what it is known for. No population figures.
- "confidence": "high" when you are sure this is a recognised people of that nation; "medium" when
  it is a recognised name but its standing as a separate people is debated; "low" when you are not
  sure it exists as a people at all.

Be strict. A town, a dialect, a quarter or a family is not a people, and naming one as a people is
the error this list exists to avoid. If you know a name only as a town or a dialect, leave it out.
Aim for completeness within each nation rather than length overall.

Reply with JSON only: {"peoples": [...]}.
"""

# The check answers in its OWN shape. The first version read "peoples" out of a
# reply the model had correctly put under "checks", found nothing, and kept all
# 41 proposals — including one people placed in the wrong country. A verification
# step that silently passes everything is worse than none, because it is
# indistinguishable from a verification step that found nothing wrong.
VERIFY_SHAPE = {
    "type": "object",
    "properties": {
        "checks": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "verdict": {"type": "string", "enum": ["keep", "fix", "drop"]},
                    "nation": {"type": "string"},
                    "kind": {"type": "string"},
                    "states": {"type": "string"},
                    "reason": {"type": "string"},
                },
                "required": ["name", "verdict", "reason"],
            },
        }
    },
    "required": ["checks"],
}

VERIFY_PROMPT = """You are checking a list of Nigerian peoples for invented or misplaced names.

For each item, say whether it is a real, recognised people (tribe, kingdom or confederation) of the \
nation given, and whether its category and state are right.

- verdict "keep"   — a real people of that nation, correctly placed
- verdict "fix"    — a real people, but the nation, category or state is wrong; give the correction
- verdict "drop"   — not a people of that nation: a town, a dialect, a quarter, a family, or a name
                     you cannot place. Dropping is the safe answer and costs nothing.

Reply with JSON only: {"checks": [{"name": "...", "verdict": "keep", "nation": "", "kind": "", \
"states": "", "reason": ""}]}, one object per item, keeping every name.

Items:
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
            if error.code in (429,):
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


def ask(prompt: str, shape: dict) -> dict:
    spent: set[str] = set()
    for model in GEMINI_MODELS:
        if model in spent:
            continue
        body = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.2, "responseMimeType": "application/json", "responseSchema": shape},
        }
        try:
            payload = _post(
                GEMINI_URL.format(model=model),
                json.dumps(body).encode(),
                {"x-goog-api-key": GEMINI_KEY, "Content-Type": "application/json"},
            )
            return json.loads(payload["candidates"][0]["content"]["parts"][0]["text"])
        except Quota:
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
        "temperature": 0.2,
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
    return json.loads(content)


def main() -> None:
    if not GEMINI_KEY and not DEEPSEEK_KEY:
        raise SystemExit("no API key is set")

    print("asking for the peoples ...", flush=True)
    first = ask(PROMPT, SHAPE)
    peoples = [p for p in first.get("peoples", []) if isinstance(p, dict) and p.get("name")]
    print(f"  {len(peoples)} proposed", flush=True)

    listing = "\n".join(
        f'- {p["name"]} | nation: {p.get("nation")} | kind: {p.get("kind")} | states: {p.get("states")} | {p.get("summary")}'
        for p in peoples
    )
    print("checking them ...", flush=True)
    checked = ask(VERIFY_PROMPT + listing, VERIFY_SHAPE)
    checks = {c.get("name"): c for c in checked.get("checks", []) if isinstance(c, dict)}
    if not checks:
        raise SystemExit(
            'the check returned nothing usable; refusing to publish names nobody verified'
        )

    kept = []
    dropped = []
    for p in peoples:
        verdict = checks.get(p["name"], {})
        # An unchecked name is dropped, not kept: the whole point of the second
        # pass is that a name nobody could place does not go out.
        decision = str(verdict.get("verdict") or "drop")
        if decision == "drop":
            dropped.append(p["name"])
            continue
        if decision == "fix":
            p["nation"] = verdict.get("nation") or p.get("nation")
            p["kind"] = verdict.get("kind") or p.get("kind")
            p["states"] = verdict.get("states") or p.get("states")
        kept.append(p)

    # The nation labels the model returns vary ("Ijaw", "Ijaw (Izon)"). The
    # registry needs one label per nation or the filter shows the same people
    # twice, so they are normalised here rather than in the database.
    canonical = {
        'ijaw': 'Ijaw', 'ijaw (izon)': 'Ijaw', 'izon': 'Ijaw',
        'yoruba': 'Yoruba', 'edo': 'Edo', 'urhobo': 'Urhobo', 'isoko': 'Isoko',
        'itsekiri': 'Itsekiri', 'igala': 'Igala', 'ebira': 'Ebira', 'nupe': 'Nupe',
        'idoma': 'Idoma', 'tiv': 'Tiv', 'efik': 'Efik', 'ibibio': 'Ibibio',
    }
    for person in kept:
        label = str(person.get('nation') or '').strip()
        person['nation'] = canonical.get(label.lower(), label)

    out = {
        "_note": [
            "Traditional peoples of the Nigerian nations other than the Igbo, for the registry.",
            "",
            "Proposed by a model and then checked by a second pass that was told to reject anything",
            "it could not place: a town, a dialect, a quarter or a family is not a people, and an",
            "invented people is worse than a missing one. Names the check could not place are",
            "listed under _dropped rather than published.",
            "",
            "The owner's ruling is that the registry is not only Igbo. These entries carry their",
            "nation in `nation`, so the section can group and filter by it.",
        ],
        "_dropped": dropped,
        "peoples": kept,
    }
    (HERE / "peoples-generated.json").write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote peoples-generated.json: {len(kept)} kept, {len(dropped)} dropped")


if __name__ == "__main__":
    main()
