#!/usr/bin/env python3
"""Verify that a phpMyAdmin dump of the ozikoro.com WordPress database is real,
and count what it holds.

The failure mode this exists for: a 200 response carrying an HTML login page
looks exactly like a successful export. So the check is on the bytes — the SQL
header, the CREATE TABLE count, the file size — and then on the contents.

Usage:
    scripts/verify-wp-dump.py data/ozikoro-wp/dbdump/sql/ozikbfpe_ozikoro.sql[.gz]
"""
from __future__ import annotations

import gzip
import io
import re
import sys
from collections import Counter

KNOWN = {
    # table: (rows already known, how that figure was obtained)
    'wpc9_posts': '4,834 exported + 4,255 revisions + 2 auto-drafts = 9,091 by construction',
    'wpc9_postmeta': '25,634 counted through the REST API',
    'wpc9_users': '15 counted through the REST API',
    'wpc9_terms': '11,116 counted through the REST API',
    'wpc9_term_taxonomy': '11,116 counted through the REST API',
    'wpc9_term_relationships': '20,673 derived from WXR taxonomy assignments',
    'wpc9_comments': '47 approved counted through the REST API (4 spam were omitted)',
    'wpc9_commentmeta': '228 counted through the REST API',
}

CREATE_RE = re.compile(r'^CREATE TABLE `([^`]+)`')
INSERT_RE = re.compile(r"^INSERT INTO `([^`]+)` \(([^)]*)\) VALUES")


def split_fields(tuple_text: str) -> list[str]:
    """Split one SQL VALUES tuple into its fields, honouring quotes and escapes."""
    out, buf, i, n = [], [], 0, len(tuple_text)
    in_str = False
    while i < n:
        c = tuple_text[i]
        if in_str:
            if c == '\\':
                buf.append(tuple_text[i:i + 2])
                i += 2
                continue
            if c == "'":
                if i + 1 < n and tuple_text[i + 1] == "'":
                    buf.append("''")
                    i += 2
                    continue
                in_str = False
            buf.append(c)
        else:
            if c == "'":
                in_str = True
                buf.append(c)
            elif c == ',':
                out.append(''.join(buf).strip())
                buf = []
            else:
                buf.append(c)
        i += 1
    out.append(''.join(buf).strip())
    return out


def unquote(field: str):
    if field == 'NULL':
        return None
    if field.startswith("'") and field.endswith("'"):
        return field[1:-1]
    return field


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__)
        return 2
    path = argv[1]

    if path.endswith('.gz'):
        raw = open(path, 'rb').read()
        size = len(raw)
        if raw[:2] != b'\x1f\x8b':
            print(f'FAIL: {path} does not start with the gzip magic bytes; '
                  f'first bytes: {raw[:80]!r}')
            return 1
        try:
            text = gzip.decompress(raw).decode('utf-8', 'replace')
        except Exception as exc:  # truncated stream, or not gzip at all
            print(f'FAIL: gzip stream is not intact ({exc}); a truncated export '
                  f'looks like a successful download')
            return 1
    else:
        size = __import__('os').path.getsize(path)
        text = open(path, encoding='utf-8', errors='replace').read()

    # split('\n'), not splitlines(): `str.splitlines` also breaks on \x0b, \x0c,
    # \x1c-\x1e, \x85 and \u2028, and post content contains those, so five of the
    # 9,144 post rows were cut in half and could not be re-assembled.
    lines = text.split('\n')
    first_line = lines[0] if lines else ''

    print(f'file            {path}')
    print(f'bytes           {size:,} ({size / 1_048_576:.1f} MiB)')
    print(f'first line      {first_line}')
    print(f'second line     {lines[1] if len(lines) > 1 else ""}')
    if not first_line.startswith('-- phpMyAdmin SQL Dump'):
        print('FAIL: the first line is not a phpMyAdmin SQL header — '
              'this is probably an HTML error or login page')
        return 1

    creates = [m.group(1) for line in lines if (m := CREATE_RE.match(line))]
    counts: Counter[str] = Counter()
    current: str | None = None
    columns: dict[str, list[str]] = {}
    status_by_type: Counter[tuple[str | None, str | None]] = Counter()
    meta_keys: Counter[str] = Counter()

    for line in lines:
        if (m := CREATE_RE.match(line)):
            current = None
            continue
        if (m := INSERT_RE.match(line)):
            current = m.group(1)
            columns[current] = [c.strip().strip('`') for c in m.group(2).split(',')]
            continue
        if current and line.startswith('('):
            counts[current] += 1
            # phpMyAdmin writes one row per line and escapes newlines inside
            # strings, so a row is a whole physical line — but strip the line
            # ending before trimming the statement's `,`/`;` terminator. Trimming
            # first silently does nothing, and every row then gains an empty
            # final field, which is how the first run of this counted 26 posts
            # out of 9,144 and called the rest unparsable.
            text_line = line.rstrip('\r\n')
            if text_line.endswith((';', ',')):
                text_line = text_line[:-1]
            cols = columns.get(current)
            if cols:
                fields = split_fields(text_line)
                if len(fields) == len(cols):
                    row = dict(zip(cols, (unquote(f) for f in fields)))
                    if current == 'wpc9_posts':
                        status_by_type[(row.get('post_type'), row.get('post_status'))] += 1
                    elif current == 'wpc9_postmeta':
                        meta_keys[row.get('meta_key') or '(none)'] += 1
        elif line.endswith(';'):
            current = None

    print(f'CREATE TABLE    {len(creates)} statements')
    print(f'tables present  {len(counts)} (of {len(creates)}; the rest hold no rows)')
    print()
    print('rows per key table (exact, counted from the INSERT tuples)')
    print(f'{"table":24} {"rows":>9}  {"known figure":>9}  status')
    for table in sorted(KNOWN):
        got = counts.get(table, 0)
        known = {'wpc9_posts': 9091, 'wpc9_postmeta': 25634, 'wpc9_users': 15,
                 'wpc9_terms': 11116, 'wpc9_term_taxonomy': 11116,
                 'wpc9_term_relationships': 20673, 'wpc9_comments': 47,
                 'wpc9_commentmeta': 228}[table]
        mark = 'same' if got == known else f'differs ({got - known:+,})'
        print(f'{table:24} {got:>9,}  {known:>9,}  {mark}')
        print(f'{"":24} known from: {KNOWN[table]}')

    print()
    print(f'all {len(counts)} tables holding rows, and the {len(creates) - len(counts)} that hold none')
    for table, n in sorted(counts.items()):
        print(f'  {n:>9,}  {table}')
    empty = [t for t in creates if t not in counts]
    for table in empty:
        print(f'  {0:>9,}  {table}')
    print()

    print('wpc9_posts by post_type and post_status')
    # Iterating a Counter yields its KEYS, so `Counter(t for t, _ in c)` counts
    # each distinct type once — it labelled 9,144 post rows as 26. Sum the values.
    statuses: Counter[str] = Counter()
    types: Counter[str] = Counter()
    for (ptype, pstatus), n in status_by_type.items():
        statuses[pstatus or '(none)'] += n
        types[ptype or '(none)'] += n
    print(f'  total rows parsed: {sum(statuses.values()):,}')
    print('  post_status:')
    for k, n in statuses.most_common():
        print(f'    {n:>7,}  {k}')
    print('  post_type:')
    for k, n in types.most_common():
        print(f'    {n:>7,}  {k}')
    print('  post_type=post by post_status:')
    for (ptype, pstatus), n in sorted(status_by_type.items()):
        if ptype == 'post':
            print(f'    {n:>7,}  {pstatus}')
    print()
    print('top wpc9_postmeta meta_key counts')
    for k, n in meta_keys.most_common(15):
        print(f'  {n:>7,}  {k}')

    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
