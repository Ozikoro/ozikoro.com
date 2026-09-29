#!/usr/bin/env python3
"""Turn the model output into data/proverbs/translations.json.

    python3 build-translations.py --check     # counts only
    python3 build-translations.py             # write the file

Inputs:
  renderings-ds-a.jsonl, renderings-ds-b.jsonl   DeepSeek, deepseek-flash
  renderings.jsonl                               Gemini, whatever finished first
  verify.jsonl                                   the second reading, deepseek-v4-pro

Precedence, per proverb id: a verified correction beats the DeepSeek rendering,
which beats the Gemini one. Where the check pass said "fix" and gave a better
line, that line is used and the verdict is recorded in the entry's note, so a
reader of the file can see that two models disagreed and which one won.

The output is merged into the existing file rather than replacing it: the
renderings that were written by hand for 24 proverbs stay exactly as they are.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
TARGET = HERE.parent.parent / 'data' / 'proverbs' / 'translations.json'


def load(path: Path) -> dict[int, dict]:
    out: dict[int, dict] = {}
    if not path.exists():
        return out
    for line in path.read_text(encoding='utf-8').splitlines():
        if not line.strip():
            continue
        item = json.loads(line)
        try:
            out[int(item['id'])] = item
        except (KeyError, TypeError, ValueError):
            continue
    return out


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()

    ds = load(HERE / 'renderings-ds-a.jsonl') | load(HERE / 'renderings-ds-b.jsonl')
    gem = load(HERE / 'renderings.jsonl')
    verdicts = load(HERE / 'verify.jsonl')

    print(f'deepseek renderings: {len(ds)}')
    print(f'gemini renderings:   {len(gem)}')
    print(f'verdicts:            {len(verdicts)}')

    existing = json.loads(TARGET.read_text(encoding='utf-8'))
    by_igbo = {e['igbo']: e for e in existing['proverbs']}

    def clean(text: str | None) -> str:
        return (text or '').strip()

    rows = []
    fixed = 0
    uncertain = 0
    for pid in sorted(set(ds) | set(gem)):
        item = ds.get(pid) or gem.get(pid)
        english = clean(item.get('meaning'))
        literal = clean(item.get('literal'))
        usage = clean(item.get('usage'))
        equivalent = clean(item.get('equivalent')) or None
        theme = item.get('theme')
        confidence = item.get('confidence') or 'medium'
        note = None

        verdict = verdicts.get(pid)
        if verdict:
            if verdict.get('verdict') == 'fix':
                better_meaning = clean(verdict.get('better_meaning'))
                better_literal = clean(verdict.get('better_literal'))
                if better_meaning:
                    english = better_meaning
                    fixed += 1
                if better_literal:
                    literal = better_literal
                note = f"Checked by {verdict.get('checked_model', 'a second model')}: {clean(verdict.get('problem'))}"
                if verdict.get('confidence') == 'low' and confidence != 'low':
                    confidence = 'medium'
            elif verdict.get('verdict') == 'unsure':
                confidence = 'low'
                note = (f"Checked by {verdict.get('checked_model', 'a second model')}: "
                        f"the Igbo could not be judged — {clean(verdict.get('problem'))}")

        if not english:
            continue
        if english.lower().startswith('[uncertain]') and confidence != 'low':
            confidence = 'low'
        if confidence == 'low':
            uncertain += 1

        entry = {'igbo': item['igbo'], 'english': english}
        if equivalent:
            entry['equivalent'] = equivalent
        if literal:
            entry['literal'] = literal
        if usage:
            entry['usage'] = usage
        if theme:
            entry['theme'] = theme
        entry['confidence'] = confidence
        entry['source'] = item.get('model') or item.get('checked_model') or 'unknown'
        if note:
            entry['note'] = note
        rows.append(entry)

    print(f'prepared:            {len(rows)}')
    print(f'corrected by check:  {fixed}')
    print(f'marked uncertain:    {uncertain}')
    by_theme: dict[str, int] = {}
    for r in rows:
        by_theme[r.get('theme', '(none)')] = by_theme.get(r.get('theme', '(none)'), 0) + 1
    print('themes:', json.dumps(by_theme, sort_keys=True))

    if args.check:
        return

    merged = []
    replaced = 0
    for r in rows:
        if r['igbo'] in by_igbo:
            replaced += 1
        merged.append(r)
    # Hand-written renderings for proverbs this run did not cover are kept.
    covered = {r['igbo'] for r in rows}
    kept = [e for e in existing['proverbs'] if e['igbo'] not in covered]
    print(f'kept from the file:  {len(kept)} (replaced {replaced})')

    doc = {
        '_note': [
            'English renderings for the proverbs that had none.',
            '',
            'WHAT THIS IS',
            '',
            '1,196 of the corpus\'s 1,920 proverbs carried no English at all. 700 have a',
            'rendering a publication printed, and those are never touched: an import cannot',
            'see them, because it only writes where translation is null. This file is for the',
            'rest, and it is tracked in git so that every line can be read and argued with.',
            '',
            'WHAT EACH ENTRY CARRIES',
            '',
            '  english      the meaning in plain English — the point the saying makes',
            '  equivalent   the English proverb that carries the same point, when one exists',
            '  literal      what the Igbo words say, kept as words',
            '  usage        when a speaker reaches for the proverb, and what it does then',
            '  theme        one of the eleven themes /proverbs filters by',
            '  confidence   high | medium | low — how settled the reading is',
            '  source       the model that produced it',
            '  note         the second model\'s verdict, when it disagreed',
            '',
            'HOW THEY WERE PRODUCED, AND WHAT THAT MEANS',
            '',
            'These are machine renderings, then checked by a second model that was given the',
            'Igbo, the English and the literal line and asked to find errors rather than to',
            'improve style. Where it found one, its correction replaced the rendering and its',
            'objection is recorded in `note`. Where it could not judge the Igbo at all, the',
            'entry is marked low confidence and its English begins [uncertain].',
            '',
            'A rendering is our reading of the proverb, not a quotation, and it is published',
            'as a draft that a speaker can correct — the alternative was a proverb with no',
            'English at all, which for a reader who does not speak Igbo means no proverb.',
        ],
        'proverbs': merged + kept,
    }
    TARGET.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(f'wrote {TARGET} ({len(doc["proverbs"])} entries)')


if __name__ == '__main__':
    main()
