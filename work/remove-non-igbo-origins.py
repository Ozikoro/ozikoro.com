"""Take every non-Igbo origin out of the registry.

The owner: "on the history of the clans or towns that were written to be founded by non
Igbo, please do not agree with it. The ones written to be founded by Benin and Igala should
have the ethnicity of the founders that arent Igbo removed... If you cannot find the true
Igbo founder, then remove where the founder is from entirely. no clan, tribe or town must
have any other origin except Igbo."

He also gave the reason for one of them: "Agbor was not founded by Chime as Agbor is older
than Ezechime, and they are not Benin, so remove it."

So this pass does one thing, and it is deliberately narrow: a clause that says an ancestor
came FROM a non-Igbo place, or that a group's origin is non-Igbo, is removed. The rest of
the sentence is kept, because most of these sentences carry a second fact that is worth
having — "Its founder is given, with those of Otolokpu, Akumazi and Mbiri, as having come
from Benin" also says which other groups share a founder.

Where the whole sentence is the foreign origin and nothing else, the sentence goes.

What is NOT touched: places that are simply places. Benin City is a city, Igala is a
neighbouring people, and a sentence that says a town traded with them, fought them or
married into them is history rather than a claim about where the Igbo came from.
"""
import json
import re
import sys

PATH = "data/clans/clans.json"

NON_IGBO = r"(?:Benin|Bini|Igala|Idoma|Efik|Ibibio|Jukun|Edo|Cameroon|Bantu)"

# 1. Whole sentences that assert a non-Igbo origin and nothing else.
DROP_SENTENCE = [
    re.compile(rf"^Its founder is (?:said|given|recorded|held)[^.]*\b{NON_IGBO}\b[^.]*\.$", re.I),
    re.compile(rf"^Its founder[^.]*\b(?:came|come|hail|trace[sd]?)\b[^.]*\b{NON_IGBO}\b[^.]*\.$", re.I),
    re.compile(rf"^[A-Z][^.]*\b(?:origin|descent|ancestry|ancestors?)\b[^.]*\b{NON_IGBO}\b[^.]*\.$", re.I),
    re.compile(rf"^[A-Z][^.]*\b{NON_IGBO}\b[^.]*\b(?:origin|descent|strain|element|mixture)\b[^.]*\.$", re.I),
    re.compile(rf"^[A-Z][^.]*\b(?:shown|evidenced|explained)\b[^.]*\b{NON_IGBO}\b[^.]*\.$", re.I),
]

# 2. Clauses inside a sentence: remove the origin claim, keep what else it says.
DROP_CLAUSE = [
    # ", and says that it once made up a single clan with ..." survives when the first half goes.
    (re.compile(rf"\bclaims? a founder who came from [^,]*{NON_IGBO}[^,]*, and ", re.I), "says "),
    (re.compile(rf"\bclaims? a founder who came from [^,]*{NON_IGBO}[^,]*, ", re.I), ""),
    (re.compile(rf"\bwho came from [^,]*{NON_IGBO}[^,]*,?(?=\s+(?:and|who|which|its)\b)", re.I), ""),
    (re.compile(rf",?\s*(?:and\s+)?(?:is|are|was|were)\s+said to have (?:come|come down) from "
                rf"[^,.]*{NON_IGBO}[^,.]*", re.I), ""),
    (re.compile(rf",?\s*(?:and\s+)?(?:the|its|their)\s+(?:origin|descent|ancestry)\s+(?:is|was|are|were)\s+"
                rf"(?:traced|given|recorded|held)\s+to\s+[^,.]*{NON_IGBO}[^,.]*", re.I), ""),
    (re.compile(rf",?\s*(?:and\s+)?(?:an?|the)\s+(?:admixture|mixture|element|strain)\s+of\s+"
                rf"{NON_IGBO}[^,.]*", re.I), ""),
    (re.compile(rf",?\s*(?:and\s+)?with\s+(?:an?\s+)?(?:admixture|mixture|element|strain)\s+of\s+"
                rf"{NON_IGBO}[^,.]*", re.I), ""),
]


def clean(sentence):
    text = sentence
    # A sentence is NEVER dropped whole. An earlier version dropped any sentence that
    # mentioned both a non-Igbo people and the word origin, and it threw away "Crossing
    # they met people they call Mboko, probably Anang Ibibio, who gave them land" — which
    # is a fact about who was already there, not a claim about where the Ngwa came from.
    # What goes is the origin clause; if nothing is left of the sentence, it goes with it.
    for pattern, replacement in DROP_CLAUSE:
        text = pattern.sub(replacement, text)
    # Tidy what removing a clause leaves behind.
    text = re.sub(r"\s*,\s*,", ",", text)
    text = re.sub(r"\s+and\s+and\s+", " and ", text)
    text = re.sub(r"^\s*,\s*", "", text)
    text = re.sub(r"\s{2,}", " ", text)
    text = text.strip()
    if text and text[0].islower():
        text = text[0].upper() + text[1:]
    return text


def main():
    apply_changes = "--apply" in sys.argv
    doc = json.load(open(PATH))
    report = []
    for clan in doc["clans"]:
        for field in ("description",):
            paragraphs = clan.get(field) or []
            new_paragraphs = []
            for para in paragraphs:
                parts = re.split(r"(?<=[.!?])\s+", para)
                kept = []
                for s in parts:
                    before = s
                    after = clean(s)
                    if after != before:
                        report.append((clan["name"], before.strip()[:90], after.strip()[:90]))
                    if after:
                        kept.append(after)
                joined = " ".join(kept).strip()
                if joined:
                    new_paragraphs.append(joined)
            clan[field] = new_paragraphs
        origin = clan.get("origin_summary")
        if origin:
            cleaned = clean(origin)
            if cleaned != origin:
                report.append((clan["name"], f"[origin] {origin[:80]}", f"[origin] {cleaned[:80]}"))
            clan["origin_summary"] = cleaned or None

    print(f"{len(report)} passages changed\n")
    for name, before, after in report[:22]:
        print(f"  {name}")
        print(f"    was: {before}")
        print(f"    now: {after}")
    if report[22:]:
        print(f"  … and {len(report) - 22} more")

    if apply_changes:
        open(PATH, "w").write(json.dumps(doc, ensure_ascii=False, indent=2) + "\n")
        print("\nwritten.")
    else:
        print("\n(dry run — pass --apply to write)")


if __name__ == "__main__":
    main()
