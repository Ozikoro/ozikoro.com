"""Rewrite the registry's prose so it reads as writing rather than as notes about a book.

The owner: "why are you writing publicly about whether the source or information fed to you
are there? like this you said 'The table gives no figure for its local communities and
prints no note for it, and no town or village within it is named.' This made the website
look like robot generation, instead of humans."

He is right, and the fault is systematic: 156 of the 246 entries talk about the book they
came from. Three things cause it.

  1. THE FRAMING. "The note names the communities as Akokwa, Obodo and Urualla" is a
     sentence about a note. The same fact, said to a reader, is "Its towns are Akokwa,
     Obodo and Urualla."
  2. THE ABSENCES. "The table carries no note for it and names no village belonging to it"
     reports that nothing is known. A reader does not need a paragraph about the absence
     of evidence; where there is nothing to say, the entry says nothing.
  3. THE CROSS-REFERENCES. "(entry 12)", "No. 2", "Table XIII", "Distinctive Features" —
     these are the book's furniture, and they mean nothing to anybody who has not got the
     book open.

WHAT THIS PRESERVES

Every fact: names, figures, relationships, towns, traditions. What goes is the framing, the
attributions and the cross-references. Where a sentence exists only to report that a source
is silent, it is deleted — nothing is lost, because an absence of evidence is not a fact
about the people. Where such a sentence also carries a fact ("no origin tradition is
recorded, and its survey places the group in the Nkwo valley"), the fact is kept and the
silence is dropped.

Nothing here touches the `source` field, which is where the repository keeps the book and
page for anybody checking the entry. That is the record; the prose is for readers.
"""
import json
import re
import sys

PATH = "data/clans/clans.json"

# ---------------------------------------------------------------------------
# 1. Naming: a note that names the towns becomes a sentence that says what they are.
# ---------------------------------------------------------------------------
NAMING = [
    # "The note names the communities as X, Y and Z." -> "Its towns are X, Y and Z."
    (re.compile(r"\b(?:The|Its|His|Her)\s+(?:note|notes|table|source|survey)\s+names?\s+"
                r"(?:the\s+)?(?:communities|community|towns|villages|sections|local communities|"
                r"constituent communities|settlements)\s+(?:as\s+)?", re.I), "Its towns are "),
    (re.compile(r"\b(?:The|Its|His|Her)\s+(?:note|notes|table|source|survey)\s+names?\s+"
                r"(?:them|these|those)\s+(?:as\s+)?", re.I), "Its towns are "),
    (re.compile(r"\b(?:The|Its|His|Her)\s+(?:note|notes|table|source|survey)\s+"
                r"names?\s+(?:it|him)\s+(?:as\s+)?", re.I), "It is called "),
    (re.compile(r"\b(?:The|Its|His|Her)\s+(?:note|notes|table|source|survey)\s+"
                r"(?:names?|lists?|gives?|enters?)\s+(?:the\s+)?(?:communities|towns|villages|"
                r"sections|local communities|settlements)\s+(?:as\s+|:)?", re.I), "Its towns are "),
    # "The note names X, Y and Z." with no noun after the verb.
    (re.compile(r"\b(?:The|Its|His|Her)\s+(?:note|notes|table|source|survey)\s+names?\s+(?=[A-Z])",
                re.I), "Its towns are "),
    # "The source enters it as ..." -> "It is entered as ..." reads as bookkeeping; say it plainly.
    (re.compile(r"\b(?:The|Its)\s+(?:table|source|survey)\s+enters?\s+(?:it|the group|them)\s+as\s+",
                re.I), "It is "),
    # "The survey counts the group as ..." -> "It is counted as ..." -> "It is ..."
    (re.compile(r"\b(?:The|Its)\s+(?:note|table|source|survey)\s+counts?\s+"
                r"(?:the group|it|them|the communities)\s+(?:as|among)\s+", re.I), "It is counted "),
    # The note identifies X, Y and Z.
    (re.compile(r"\b(?:The|Its)\s+(?:note|table|source|survey)\s+identifies?\s+"
                r"(?:the\s+)?(?:three|four|five|six|two|seven|eight|nine|ten)?\s*(?:as\s+)?", re.I),
     "Its towns are "),
    (re.compile(r"\b(?:The|Its)\s+(?:note|table|source|survey)\s+describes?\s+(?:it|the group|them)\s+as\s+",
                re.I), "It is "),
    (re.compile(r"\b(?:The|Its)\s+(?:note|table|source|survey)\s+records?\s+(?:it|the group|them)\s+as\s+",
                re.I), "It is "),
    (re.compile(r"\b(?:The|Its)\s+(?:note|table|source|survey)\s+classes?\s+(?:it|the group|them)\s+"
                r"(?:with|among|as)\s+", re.I), "It is counted with "),
]

# ---------------------------------------------------------------------------
# 2. Attributions: the facts stay, the historian's name goes.
# ---------------------------------------------------------------------------
ATTRIBUTION = [
    (re.compile(r"\b(?:the|The)\s+note\s+to\s+[A-Z][a-zA-Z]+\s+(?:reports?|says?|states?|records?|refers?)"
                r"\s+(?:back\s+)?(?:that|to)?\s*", re.I), ""),
    (re.compile(r"\bAfigbo's\s+(?:genealogical charter|account|reading|argument|view)\s+", re.I),
     "The genealogical charter "),
    (re.compile(r"\bAfigbo\s+", re.I), "The wider tradition "),
    (re.compile(r"\bMeek\s+", re.I), "The account "),
    (re.compile(r"\bForde\s*&\s*Jones\s+", re.I), "The survey "),
    (re.compile(r"\bentered by the survey as\b", re.I), "one of"),
    (re.compile(r"\bwhich the source treats as\b", re.I), "which is"),
    (re.compile(r"\bthe source treats as\b", re.I), "counted as"),
    # "The survey places the group in the western uplands" -> "The group lies in ..."
    (re.compile(r"\b(?:The|Its)\s+(?:survey|source|note|table)(?:\s+of\s+sub-areas)?\s+places?\s+"
                r"(?:the group|it|them|[A-Z][a-zA-Z]+)\s+(?:in|among|with|on)\s+", re.I), "It lies in "),
    (re.compile(r"\b(?:The|Its)\s+(?:survey|source|note|table)(?:\s+of\s+sub-areas)?\s+counts?\s+"
                r"(?:the group|it|them|[A-Z][a-zA-Z]+)\s+(?:among|with|in)\s+", re.I), "It is counted among "),
    (re.compile(r"\b(?:The|Its)\s+(?:survey|source|note|table)(?:\s+of\s+sub-areas)?\s+lists?\s+"
                r"(?:it|the group|them)\s+(?:with|among|in)\s+", re.I), "It is counted with "),
    (re.compile(r"\b(?:The|Its)\s+(?:survey|source|note|table)\s+enters?\s+(?:it|the group|them)\s+"
                r"(?:as|among|with)\s+", re.I), "It is "),
    # "X is the name the survey enters, and it prints that name jointly with Y"
    (re.compile(r"\bis the name the survey enters, and it prints that name jointly with\s+", re.I),
     "takes its name from "),
    # "The survey prints the group as X and its towns as Y; those spellings are the survey's"
    (re.compile(r"\b(?:The|Its)\s+(?:survey|source)\s+prints?\s+[^.]*?spellings? are the (?:survey|source)'s[^.]*\.",
                re.I), ""),
    (re.compile(r"\b(?:The|Its)\s+(?:survey|source)(?:'s)?\s+(?:own\s+)?name (?:for|of) the group\b",
                re.I), "The name"),
    (re.compile(r"\bIn the survey the\s+", re.I), "The "),
    (re.compile(r"\bthe survey of sub-areas\b", re.I), "the wider account"),
    (re.compile(r"\bThis is one of the few statements of wider grouping the (?:source|survey) makes "
                r"for this region, where it reports that\s+", re.I), ""),
    (re.compile(r"\b(?:the|The) (?:source|survey) makes for this region, where it reports that\s+", re.I), ""),
    (re.compile(r"\bAfigbo also lists\s+", re.I), "There are also "),
    (re.compile(r"\bhad\s+", re.I), "had "),
    # "The source's account of the Northern Igbo notes that yam growing is ..." -> the fact.
    (re.compile(r"\b(?:The|Its)\s+(?:note|table|source|survey)(?:'s)?\s+(?:account|description|"
                r"prose|section|introduction)\s+(?:of\s+[^,]{0,40}?\s+)?(?:notes?|says?|states?|"
                r"records?|reports?|gives?|describes?)\s+that\s+", re.I), ""),
    (re.compile(r"\b(?:The|Its)\s+(?:note|table|source|survey)(?:'s)?\s+(?:account|description|"
                r"prose|section|introduction)\s+(?:of\s+[^,]{0,40}?\s+)?(?:notes?|says?|states?|"
                r"records?|reports?|gives?|describes?)\s+", re.I), ""),
    # "Note 12 to the table adds that ..." / "Note 2 says ..."
    (re.compile(r"\bNotes?\s+\d+\s+(?:to|under)\s+the\s+(?:table|entry)\s+(?:adds?|says?|states?|"
                r"records?|reports?|gives?)\s+that\s+", re.I), ""),
    (re.compile(r"\bNotes?\s+\d+\s+(?:adds?|says?|states?|records?|reports?|gives?)\s+that\s+", re.I), ""),
    (re.compile(r"\bNotes?\s+\d+\s+(?:to|under)\s+the\s+(?:table|entry)\s+(?:adds?|says?|states?|"
                r"records?|reports?|gives?)\s+", re.I), ""),
    (re.compile(r"\bin note\s+\d+\b", re.I), "elsewhere"),
    (re.compile(r"\bnote\s+\d+\b", re.I), "a further note"),
    (re.compile(r"\bthe (?:source|table|note|survey)\s+(?:notes?|says?|states?|records?|reports?|"
                r"gives?|describes?|shows?|adds?)\s+that\s+", re.I), ""),
    (re.compile(r"\bthe (?:source|table|note|survey)\s+(?:notes?|says?|states?|records?|reports?|"
                r"gives?|describes?|shows?|adds?)\s+", re.I), ""),
    (re.compile(r"\bAfigbo\s+(?:records|reports|notes|writes|shows|observes|adds)\s+that\s+", re.I), ""),
    (re.compile(r"\bAfigbo\s+(?:records|reports|notes|writes|shows|observes|adds)\s+", re.I), ""),
    (re.compile(r"\bAfigbo\s+(?:treats|holds|argues|reads|describes|cites|gives|lists|identifies)\s+",
                re.I), ""),
    (re.compile(r"\bAfigbo\s+would\s+", re.I), "The wider tradition would "),
    (re.compile(r"\bMeek\s+(?:reports|records|notes|writes|observes)\s+that\s+", re.I), ""),
    (re.compile(r"\bMeek\s+(?:reports|records|notes|writes|observes)\s+", re.I), ""),
    (re.compile(r"\bForde\s*&\s*Jones\s+(?:records|reports|notes|writes|enters|divides)\s+that\s+",
                re.I), ""),
    (re.compile(r"\bForde\s*&\s*Jones\s+(?:records|reports|notes|writes|enters|divides|treats)\s+",
                re.I), ""),
    (re.compile(r"\b(?:The|Its)\s+note\s+(?:to|under)\s+[A-Z][a-zA-Z]+(?:\s+\(entry\s+\d+\))?\s+"
                r"(?:adds?|says?|states?|reports?|records?|gives?)\s+that\s+", re.I), ""),
    (re.compile(r"\b(?:The|Its)\s+note\s+(?:to|under)\s+[A-Z][a-zA-Z]+\s+(?:adds?|says?|states?|"
                r"reports?|records?|gives?)\s+", re.I), ""),
]

# ---------------------------------------------------------------------------
# 3. Cross-references: the book's furniture, removed.
# ---------------------------------------------------------------------------
REFERENCES = [
    (re.compile(r"\bentries?\s+\d+\s*(?:to|and|-|–)\s*\d+\b", re.I), "the neighbouring groups"),
    (re.compile(r"\bentries?\s+\d+\b", re.I), "the neighbouring groups"),
    (re.compile(r"\btaking in entries[^.]*?(?=[,.])", re.I), ""),
    (re.compile(r"\s*\(entry\s+\d+\)"), ""),
    (re.compile(r"\s*\(\s*No\.\s*\d+\s*\)"), ""),
    (re.compile(r",\s*No\.\s*\d+\b"), ""),
    (re.compile(r"\s*\bTable\s+[IVX]+\b"), ""),
    (re.compile(r"\s*and\s+Distinctive Features\b", re.I), ""),
    (re.compile(r"\s*,?\s*distinctive features\b", re.I), ""),
    (re.compile(r"\s*\((?:printed\s+)?pp?\.\s*[\d\-–,\s]+\)"), ""),
    (re.compile(r"\bthe note to (?:the )?table [IVX]+\b", re.I), "the account"),
]

# ---------------------------------------------------------------------------
# 4. The absences: sentences that report only that a source is silent.
# ---------------------------------------------------------------------------
ABSENCE_SENTENCE = re.compile(
    r"^(?:The|Its|His|Her|No|Nothing|Neither)\b[^.]*\b(?:"
    r"carries no note|prints no note|gives no note|no note appears|carries no note of its own|"
    r"records no origin|records neither|gives neither|gives no origin|offers nothing|"
    r"gives no further detail|nothing further is recorded|no town or village|"
    r"is given no origin|gives no figure|leaves its number of local communities|"
    r"the source gives no|no origin tradition|no separate origin|no origin is recorded|"
    r"nothing is recorded|records nothing|says nothing|no relationship is|no tradition is|"
    r"is not recorded|are not recorded|no separate tradition|apart from this nothing|"
    r"beyond this|the source offers|no separate origin tradition is recorded|"
    r"nothing else is recorded|no relationship with a neighbouring group"
    r")\b[^.]*\.\s*",
    re.I,
)

# A sentence that reports the absence of a settlement list specifically.
ABSENCE_TAIL = re.compile(
    r"\s*(?:and\s+)?(?:no|neither)\s+(?:town|village|settlement|community|place)s?\s+"
    r"(?:within it |in it |belonging to it |of it )?is\s+(?:named|given|recorded|listed)[^.]*\.",
    re.I,
)

# ---------------------------------------------------------------------------
# 5. Non-Igbo origins. The owner: no clan, tribe or town has any origin but Igbo.
# ---------------------------------------------------------------------------
FOREIGN_ORIGIN = [
    re.compile(r"\b(?:who|which|said to have|is said to have|are said to have|"
               r"given as having|recorded as having|held to have)\s+come\s+from\s+"
               r"(?:Benin|Bini|Igala|Idoma|the Igala|Benin City)[^.]*\.", re.I),
    re.compile(r"\b(?:its|his|their)\s+founder[^.]*\b(?:from|of)\s+(?:Benin|Igala|Idoma)\b[^.]*\.", re.I),
    re.compile(r"\btrace[sd]?\s+(?:its|their|his)\s+(?:origin|descent|ancestry)\s+to\s+"
               r"(?:Benin|Igala|Idoma)[^.]*\.", re.I),
    re.compile(r"\b(?:a|the)\s+(?:Benin|Igala|Idoma|Bini)\s+(?:origin|element|strain|descent)\b[^.]*\.", re.I),
    re.compile(r"\b(?:came|come)\s+(?:by way of|through)\s+Benin[^.]*\.", re.I),
]


def sentences(paragraph):
    return re.split(r"(?<=[.!?])\s+", paragraph)


# Sentences that must be handled whole, before the generic patterns touch them, because
# the generic version leaves a fragment: "The note names the communities in the survey's
# own spelling — X, Y, Z — which are written today as ..." became "Its towns are in the
# survey's own spelling".
WHOLE_SENTENCE = [
    (re.compile(r"^Its note records the people as .*?\s+and names a single community,\s*([^;.]+);"
                r"\s*the remaining (\w+) are left unnamed\.$", re.I),
     lambda m: f"Its people are Igbo, and {m.group(1).strip()} is one of its communities."),
    (re.compile(r"^(?:The|Its)\s+(?:note|table|source|survey)\s+(?:names?|lists?)\s+the communities "
                r"in the survey's own spelling[^—]*—\s*([^—]+)—\s*which are written today as ([^.]*)\.",
                re.I),
     lambda m: f"Its towns are {m.group(2).strip()}; the older spellings {m.group(1).strip()} are also recorded."),
    (re.compile(r"^Neither an origin tradition nor a relationship with a neighbouring group[^;.]*;\s*",
                re.I), lambda m: ""),
]


# The last resort: a relative clause or a trailing clause that refers to the book is
# dropped, and the sentence keeps the fact it was carrying.
SOURCE_CLAUSE = re.compile(
    r"(?:,\s*)?(?:which|where|as|and)\s+the\s+(?:source|survey|note|table|book)\b[^.]*?(?=[,.]|$)",
    re.I)


# Only the rewrites that cannot damage a sentence are applied by default: naming
# ("The note names X, Y and Z" becomes "Its towns are X, Y and Z"), the deletion of
# sentences that report nothing but a source's silence, and the removal of the book's
# furniture. The reframing substitutions are kept behind --full because they mangle some
# sentences: "the three communities Forde & Jones enter under that name" came out as
# "the three communities The survey enter under that name", which is worse than the
# original fault.
SAFE = "--full" not in sys.argv


def rewrite_sentence(sentence):
    text = sentence
    for pattern, replacement in WHOLE_SENTENCE:
        if pattern.search(text):
            return pattern.sub(replacement, text).strip()
    for pattern, replacement in REFERENCES:
        text = pattern.sub(replacement, text)
    if not SAFE:
        for pattern, replacement in ATTRIBUTION:
            text = pattern.sub(replacement, text)
    for pattern, replacement in NAMING:
        text = pattern.sub(replacement, text)
    text = SOURCE_CLAUSE.sub("", text)
    # A naming rewrite can leave "Its towns are are"; tidy the joins.
    text = re.sub(r"\b(are|is|were|was)\s+(are|is|were|was)\b", r"\1", text, flags=re.I)
    text = re.sub(r"\s{2,}", " ", text)
    if text and text[0].islower():
        text = text[0].upper() + text[1:]
    return text.strip()


def rewrite_paragraph(paragraph):
    if not paragraph:
        return paragraph
    out = []
    for sentence in sentences(paragraph):
        s = rewrite_sentence(sentence)
        s = ABSENCE_TAIL.sub("", s)
        if not s.strip():
            continue
        # A sentence that only reports a silence is dropped whole.
        if ABSENCE_SENTENCE.match(s + " "):
            continue
        if not SAFE:
            for pattern in FOREIGN_ORIGIN:
                s = pattern.sub("", s).strip()
        if not s:
            continue
        if s[0].islower():
            s = s[0].upper() + s[1:]
        if not s.endswith((".", "!", "?")):
            s += "."
        out.append(s)
    return " ".join(out).strip()


def main():
    apply_changes = "--apply" in sys.argv
    doc = json.load(open(PATH))
    changed = 0
    samples = []
    for clan in doc["clans"]:
        original = clan.get("description") or []
        rewritten = [rewrite_paragraph(p) for p in original]
        rewritten = [p for p in rewritten if p.strip()]
        origin = clan.get("origin_summary")
        new_origin = rewrite_paragraph(origin) if origin else origin
        if rewritten != original or new_origin != origin:
            changed += 1
            if len(samples) < 4:
                samples.append((clan["name"], original, rewritten))
        clan["description"] = rewritten
        if origin:
            clan["origin_summary"] = new_origin or None

    # What is left, so the next iteration of patterns is written from the real residue
    # rather than from a guess about it.
    residue = []
    trigger = re.compile(
        r"\b(the source|the table|the note|its note|the survey|the book|printed|entry \d|No\. \d|"
        r"Table [IVX]+|Forde|Jones|Meek|Afigbo|Distinctive Features|note \d)\b", re.I)
    for clan in doc["clans"]:
        text = " ".join(clan.get("description") or []) + " " + str(clan.get("origin_summary") or "")
        for s in re.split(r"(?<=[.!?])\s+", text):
            if trigger.search(s):
                residue.append((clan["name"], s.strip()))
    damaged = []
    for clan in doc["clans"]:
        for para in clan.get("description") or []:
            for s in re.split(r"(?<=[.!?])\s+", para):
                st = s.strip()
                if not st:
                    continue
                if st[0].islower() or re.match(r"^(and|but|which|that|who|the neighbouring groups)\b", st, re.I):
                    damaged.append((clan["name"], st))
                if re.search(r"\b(are|is|were|was)\s+(in|with|among)\s+the (survey|source)\b", st, re.I):
                    damaged.append((clan["name"], st))
                if "  " in st:
                    damaged.append((clan["name"], st))
    print(f"{changed} entries would change; {len(residue)} sentences still refer to the book; "
          f"{len(damaged)} look broken\n")
    for name, s in damaged[:15]:
        print(f"  BROKEN {name:16} {s[:120]}")
    for name, s in residue[:25]:
        print(f"  {name:18} {s[:130]}")
    for name, before, after in samples:
        print(f"=== {name}")
        b = " ".join(before)
        a = " ".join(after)
        print("  before:", b[:300])
        print("  after: ", a[:300])
        print()

    if apply_changes:
        open(PATH, "w").write(json.dumps(doc, ensure_ascii=False, indent=2) + "\n")
        print("written.")
    else:
        print("(dry run — pass --apply to write)")


if __name__ == "__main__":
    main()
