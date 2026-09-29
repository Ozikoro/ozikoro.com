#!/usr/bin/env python3
"""Assemble the curated Thomas proverb file from the correction output.

    python3 build-thomas.py            # write data/proverbs/thomas-part6.json

Sources:
  corrected.jsonl   the restored Igbo, the repaired English, the usage note, the
                    town it was collected in, and how settled the reading is
  themes.jsonl      one of the section's eleven themes per proverb

What is written is what the site will publish, so the low-confidence readings go
in TOO — but with their confidence recorded and their English left as Thomas
printed it, lightly repaired. Dropping them would be tidier and less honest: a
reader who does not speak Igbo loses the proverb entirely, and the section
already has a way to say "this reading is not settled".
"""
from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
TARGET = HERE.parent.parent / 'data' / 'proverbs' / 'thomas-part6.json'

SOURCE = 'Thomas (1914), Proverbs'
URL = 'https://archive.org/details/anthropologicalr06thomuoft'


def main() -> None:
    corrected = [json.loads(l) for l in (HERE / 'corrected.jsonl').read_text(encoding='utf-8').splitlines() if l.strip()]
    themes: dict[int, str] = {}
    theme_file = HERE / 'themes.jsonl'
    if theme_file.exists():
        for line in theme_file.read_text(encoding='utf-8').splitlines():
            if line.strip():
                row = json.loads(line)
                themes[int(row['number'])] = row['theme']

    proverbs = []
    low = 0
    for row in sorted(corrected, key=lambda r: r['number']):
        igbo = (row.get('igbo') or '').strip()
        english = (row.get('english') or '').strip()
        if not igbo or not english:
            continue
        confidence = (row.get('confidence') or 'medium').strip()
        if confidence == 'low':
            low += 1
        entry = {
            'igbo': igbo,
            'english': english,
            'usage': (row.get('usage') or '').strip() or None,
            'dialect': (row.get('dialect') or '').strip() or None,
            'theme': themes.get(int(row['number'])),
            'confidence': confidence,
            'source': SOURCE,
            'url': URL,
        }
        proverbs.append(entry)

    doc = {
        '_note': [
            'The proverbs of Northcote W. Thomas, Anthropological Report on the',
            'Ibo-Speaking Peoples of Nigeria, Part VI: Proverbs, Stories, Tones in',
            'Ibo (1914), restored from a damaged scan.',
            '',
            'WHY THIS FILE EXISTS',
            '',
            'The scan reads the Igbo badly: Thomas transcribed Asaba-district speech',
            'phonetically in 1913, and the scanner turns ị and ọ into y, p, q, ç or §',
            'depending on the letterform. So the text was read back by a model that was',
            'given BOTH the damaged Igbo and the English Thomas printed beneath it, and',
            'told to undo the scanner rather than to translate. Every English here is',
            'Thomas\u2019s own sense, repaired; nothing was invented.',
            '',
            'WHAT EACH ENTRY CARRIES',
            '',
            '  igbo        the proverb in standard Igbo orthography',
            '  english     Thomas\u2019s meaning, with scan damage repaired',
            '  usage       his note on when the proverb is used, where he gave one',
            '  dialect     the town it was collected in, where the marker could be placed',
            '  theme       one of the eleven themes /proverbs filters by',
            '  confidence  high | medium | low \u2014 how settled the restoration is',
            '',
            'Low-confidence readings are published rather than dropped, and the proverb',
            'page says so where they appear. A reader who does not speak Igbo loses the',
            'proverb entirely if they are hidden, and the alternative \u2014 quietly keeping',
            'only the easy ones \u2014 would misrepresent how much of the book is legible.',
        ],
        'proverbs': proverbs,
    }
    TARGET.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    themed = sum(1 for p in proverbs if p['theme'])
    print(f'wrote {TARGET}: {len(proverbs)} proverbs, {themed} themed, {low} low confidence')


if __name__ == '__main__':
    main()
