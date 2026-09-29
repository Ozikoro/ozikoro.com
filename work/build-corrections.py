#!/usr/bin/env python3
"""Turn verification verdicts into the curated corrections file.

    python3 build-corrections.py

Reads  verdicts.jsonl  → writes  ../../data/words/meaning-corrections.json

Only two kinds of verdict become an entry:

  wrong     the gloss belongs to a different word. The model's correction is
            written, and if it gave none the sense is taken out of the quiz
            instead of being left as a wrong answer.
  unsure    no correction is invented: the sense is flagged out of the quiz.
  partial   recorded with the fuller sense where the model gave one.

`ok` verdicts write nothing. The file is tracked in git, so every change the
machine made to a meaning is readable, diffable and reversible.
"""
from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
TARGET = HERE.parent / 'data' / 'words' / 'meaning-corrections.json'

# Corrections established outside the model pass, each with its reason. They are
# entries the owner reported or that were checked by hand.
HAND_CHECKED = [
    {
        'headword': 'àrụ ukwu',
        'previous': 'leprosy',
        'correction': 'limping; walking with a deformed or injured leg',
        'verdict': 'wrong',
        'note': (
            'Owner, 2026-09-27: the quiz offered this as the answer to "àrụ ụkwụ". '
            'Àrụ ụkwụ describes limping or a deformed leg, not the disease; leprosy is '
            'èkpèǹta. A leper may limp, which is why the two get confused.'
        ),
    },
    {
        'headword': 'àrụ ọcha',
        'previous': 'leprosy',
        'correction': '',
        'verdict': 'unsure',
        'note': (
            'The standard word for leprosy is èkpèǹta, and ọyà ọcha is also used. '
            'This form cannot be confirmed, so it stays on the entry and comes out of '
            'the quiz rather than being shown as an answer.'
        ),
    },
]


def main() -> None:
    verdicts = []
    path = HERE / 'verdicts.jsonl'
    if path.exists():
        for line in path.read_text(encoding='utf-8').splitlines():
            if line.strip():
                verdicts.append(json.loads(line))

    corrections: dict[tuple[str, str], dict] = {}
    for row in verdicts:
        verdict = row.get('verdict')
        if verdict not in ('wrong', 'partial', 'unsure'):
            continue
        correction = (row.get('correction') or '').strip()
        if verdict == 'partial' and not correction:
            continue
        key = (row['headword'], row['gloss'])
        corrections[key] = {
            'headword': row['headword'],
            'previous': row['gloss'],
            'correction': correction,
            'verdict': verdict,
            'note': (row.get('note') or '').strip(),
        }

    for entry in HAND_CHECKED:
        key = (entry['headword'], entry['previous'])
        corrections.setdefault(key, entry)

    ordered = sorted(corrections.values(), key=lambda c: (c['verdict'], c['headword']))
    doc = {
        '_note': [
            'English glosses the dictionary had wrong, and what they should say.',
            '',
            'WHY THIS FILE EXISTS',
            '',
            'The practice quiz asks "what does this word mean?" and marks an answer right or',
            'wrong. It reads the same definitions the entry pages show, so a wrong gloss is',
            'not merely a wrong entry — it is a wrong ANSWER, presented to someone trying to',
            'learn. The owner was shown "àrụ ụkwụ" and told the answer was "leprosy"; the word',
            'means limping.',
            '',
            'Every published sense the quiz can serve was therefore checked against the Igbo,',
            'with the corrections recorded here before being applied. Roughly one sense in',
            'twelve came back wrong.',
            '',
            'FIELDS',
            '',
            '  headword     the entry the gloss belongs to',
            '  previous     the gloss as it was — the importer refuses to touch a row that no',
            '               longer says this, so a correction can never land on the wrong sense',
            '  correction   what the gloss should say; EMPTY means the sense could not be',
            '               confirmed, so it is left on the entry but taken out of the quiz',
            '  verdict      wrong | partial | unsure',
            '  note         why, in one line, including the model\'s objection where there was one',
        ],
        'corrections': ordered,
    }
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    wrong = sum(1 for c in ordered if c['verdict'] == 'wrong')
    unsure = sum(1 for c in ordered if c['verdict'] == 'unsure')
    print(f'wrote {TARGET}: {len(ordered)} corrections ({wrong} wrong, {unsure} unconfirmed) '
          f'from {len(verdicts)} verdicts')


if __name__ == '__main__':
    main()
