"""Settlements named in an entry's own text, taken only from the sentence that names them.

The sources use one construction for this, over and over:

    "The note names the communities as Akokwa, Obodo, Akporo, Oshine and Urualla."
    "Its note names the communities as Ogburike, Umuleru, Nnando and Awkuzu."
    "The note names Awka, Nibo, Ugwuoba and Ebenebe, and leaves four communities unnamed."

A general scan for capitalised words picks up countries, authors and source names and is
worthless. This reads only the list that follows one of those verbs, and it keeps a
candidate only when the list has at least two members — because a single name after
"names" is usually the group's own name restated, not a settlement inside it.
"""
import json, re, sys
from collections import Counter

NAMED = re.compile(
    r"\b(?:names?|named|lists?|listed|gives?|enters?)\b[^.]{0,60}?\b(?:as|are|were|:)\s+"
    r"([A-Z][^.]{3,300})",
)
STOP = set("""the a an and or but with from into their this that these those his her its our your by in
on at as is are was were be been it he she we they not no nor for to of so if then than when where
which who also both each few more most other some such only own same too very can will just now
between during before after above below up down out off over under again further once here there
all any because until while about against chief priest king clan group people town towns village
villages section sections note notes table survey source sources Nigeria Igbo Ibo north south east
west northern southern eastern western part parts one two three four five six seven eight nine ten
first second third among together entry entries division divisions province district local
government area state communities community settlements settlement population land river creek road
market farm farms quarter quarters kindred lineage family brother descended descent origin origins
tradition traditions founder founded according said says called known name names written printed
spelt spelled today formerly Benin Igala Ijaw Ibibio Efik Aro Ezza Nri Afigbo Meek Jones Forde
British European Cross River Native Administration Distinctive Features African""".split())


def settlements(text):
    found = []
    for match in NAMED.findall(text or ""):
        # Split the list on commas and "and", then keep only plain, single names.
        for piece in re.split(r",|\sand\s|\sor\s|;", match):
            piece = piece.strip(" .;:()")
            piece = re.sub(r"^(?:the|and|or)\s+", "", piece, flags=re.I)
            words = piece.split()
            if not words or len(words) > 3:
                continue
            if words[0].lower().strip("'’") in STOP:
                continue
            if not piece[0].isupper():
                continue
            if re.search(r"\d|page|note|table|entry|source|survey", piece, re.I):
                continue
            found.append(piece)
    return found


def main():
    doc = json.load(open("data/clans/clans.json"))
    out = []
    for clan in doc["clans"]:
        if clan.get("towns"):
            continue
        text = " ".join(clan.get("description") or []) + " " + str(clan.get("origin_summary") or "")
        names = [n for n, _count in Counter(settlements(text)).most_common()]
        # The group's own name is not one of its settlements.
        own = clan["name"].lower()
        names = [n for n in names if n.lower() != own and own not in n.lower()]
        out.append({
            "name": clan["name"],
            "division": clan.get("tribe"),
            "kind": clan.get("kind"),
            "states": clan.get("states") or [],
            "parent": clan.get("parent"),
            "settlements": names,
        })
    json.dump(out, open("work/townless-tight.json", "w"), ensure_ascii=False, indent=1)
    withnames = [r for r in out if len(r["settlements"]) >= 2]
    single = [r for r in out if len(r["settlements"]) == 1]
    none = [r for r in out if not r["settlements"]]
    print(f"entries with no towns: {len(out)}")
    print(f"  a list of settlements in their own text: {len(withnames)}")
    print(f"  a single name only: {len(single)}")
    print(f"  nothing named: {len(none)}")
    print()
    for r in withnames:
        print(f"  {r['name']:20} {', '.join(r['settlements'])[:90]}")
    print(f"\n--- single names ({len(single)}) ---")
    for r in single:
        print(f"  {r['name']:20} {r['settlements'][0]}")
    print(f"\n--- nothing named ({len(none)}) ---")
    for r in none:
        print(f"  {r['name']:20} {r['kind']:10} {str(r['division']):18} state={r['states'] or '—'}")


if __name__ == "__main__":
    main()
