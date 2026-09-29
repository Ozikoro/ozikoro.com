"""What can be established about the entries that have no towns.

The owner: "Any clan that does not have towns under it is false... unless you have sure
verification to determine towns under it. Also, any clan you cannot pinpoint the states
they occupy, their towns and villages of theirs in other places, that means it is not
right, so remove."

So every entry with no towns gets one of three verdicts, and never a guess:

  towns   the sources name settlements for it, and here they are
  state   only where it is could be established, not what is inside it
  nothing nothing anywhere names a settlement or a place for it

The settlements are taken from two places only: the entry's own description and origins —
which quote Forde & Jones, whose notes do name villages for many of these — and the
opening of the Wikipedia article about the place, when there is one. Anything else, such
as a name that merely appears in a blog post about the area, is not counted, because the
one thing this must not do is invent a village.

It only reports. Nothing is written to the registry by this file.
"""
import json, re, sys, unicodedata
from collections import Counter

sys.path.insert(0, "work")
import importlib.util
spec = importlib.util.spec_from_file_location("v", "work/verify-every-name.py")
verify = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify)

STATES = ["Abia", "Anambra", "Ebonyi", "Enugu", "Imo", "Rivers", "Delta", "Edo", "Bayelsa",
          "Cross River", "Akwa Ibom", "Benue", "Kogi", "Ondo", "Ogun", "Osun", "Oyo", "Lagos"]

# Words that introduce a list of settlements in this corpus's prose.
INTRO = re.compile(
    r"(?:names?|named|lists?|listed|comprises?|consists? of|made up of|divided into|"
    r"communities? (?:are|as)|towns? (?:are|as)|villages? (?:are|as)|sections? (?:are|as))"
    r"[^.]{0,400}", re.I,
)
# A capitalised word that is not the first word of a sentence and is not a common word.
NOT_A_PLACE = set("""the a an and or but with from into onto their they them this that these those
his her its our your by in on at as is are was were be been being it he she we you i not no nor
for to of so if then than when where which who whom whose also both each few more most other some
such only own same too very can will just should now between during before after above below up
down out off over under again further once here there all any because until while about against
chief priest king clan group group's people town towns village villages section sections notes note
table survey source sources Nigeria Igbo Ibo north south east west northern southern eastern
western upper lower part parts one two three four five six seven eight nine ten first second third
among together entry entries division divisions province district local government area state
communities community settlements settlement population land area river creek road market farm
farms quarter quarters kindred kindreds lineage lineages family families brother brothers sister
descended descent origin origins tradition traditions founder founded according said says called
known name names written printed spelt spelled today formerly formerly 's""".split())


def sentences(text):
    return re.split(r"(?<=[.;])\s+", text or "")


def candidates_from(text):
    """Settlements a sentence says belong to a group, taken from the sentence itself."""
    out = []
    for chunk in INTRO.findall(text or ""):
        for piece in re.findall(r"\b([A-Z][a-zà-ÿ'’-]{2,}(?:\s+[A-Z][a-zà-ÿ'’-]{2,})?)", chunk):
            cleaned = piece.strip()
            head = cleaned.split()[0].lower().strip("'’")
            if head in NOT_A_PLACE or len(cleaned) < 4:
                continue
            out.append(cleaned)
    return out


def main():
    doc = json.load(open("data/clans/clans.json"))
    verdicts = [json.loads(l) for l in open("work/clan-search-strict.jsonl") if l.strip()]
    by_name = {}
    for row in verdicts:
        by_name.setdefault((row["kind"], row["name"]), row)

    rows = []
    for clan in doc["clans"]:
        if clan.get("towns"):
            continue
        text = " ".join(clan.get("description") or [])
        own = candidates_from(text)
        intro_candidates = []
        state = None
        found = by_name.get(("clan", clan["name"]))
        if found:
            extract = (found.get("wiki") or {}).get("extract") or ""
            intro_candidates = candidates_from(extract)
            for s in STATES:
                if re.search(rf"\b{s}\b", extract):
                    state = s
                    break
        rows.append({
            "name": clan["name"],
            "division": clan.get("tribe"),
            "kind": clan.get("kind"),
            "recordedState": clan.get("states") or [],
            "statesFromSearch": state,
            "townsFromOwnText": sorted(set(own)),
            "townsFromSearch": sorted(set(intro_candidates)),
            "parent": clan.get("parent"),
            "source": clan.get("source"),
        })

    json.dump(rows, open("work/townless-verdicts.json", "w"), ensure_ascii=False, indent=1)
    print(f"{len(rows)} published entries with no towns\n")
    has_own = [r for r in rows if r["townsFromOwnText"]]
    has_search = [r for r in rows if not r["townsFromOwnText"] and r["townsFromSearch"]]
    has_state = [r for r in rows if not r["townsFromOwnText"] and not r["townsFromSearch"] and r["statesFromSearch"]]
    nothing = [r for r in rows if not r["townsFromOwnText"] and not r["townsFromSearch"] and not r["statesFromSearch"]]

    print(f"A. settlements named in the entry's own text: {len(has_own)}")
    for r in has_own[:30]:
        print(f"   {r['name']:20} {', '.join(r['townsFromOwnText'])[:80]}")
    print(f"\nB. settlements named by the search about the place: {len(has_search)}")
    for r in has_search[:30]:
        print(f"   {r['name']:20} state={r['statesFromSearch']} {', '.join(r['townsFromSearch'])[:70]}")
    print(f"\nC. only where it is, no settlements: {len(has_state)}")
    for r in has_state:
        print(f"   {r['name']:20} {r['statesFromSearch']}  ({r['kind']}, {r['division']})")
    print(f"\nD. nothing anywhere: {len(nothing)}")
    for r in nothing:
        print(f"   {r['name']:20} {r['kind']:10} {str(r['division']):16} parent={r['parent']}")


if __name__ == "__main__":
    main()
