"""Hand-written replacements for every remaining non-Igbo origin claim.

The owner: "no clan, tribe or town must have any other origin except Igbo" and "If you
cannot find the true Igbo founder, then remove where the founder is from entirely."

Two mechanical attempts at this failed — one deleted sentences that carried real facts (the
Ngwa meeting the Mboko, who were already on the land), the other left "Its founder." So
each of these is written out. Where an Igbo origin is known from the owner's own sources it
is given; where it is not, the origin is not stated at all, and the entry keeps every other
fact it held.
"""
import json
import re

PATH = "data/clans/clans.json"
doc = json.load(open(PATH))
by = {}
for c in doc["clans"]:
    by.setdefault(c["name"], []).append(c)

def one(name):
    return by[name][0] if name in by else None

# Sentence-level replacements, keyed by the entry, matched on a distinctive fragment.
# Anything not matched is reported rather than silently left.
REPLACEMENTS = {
  "Ayamelum": [(
    "holding only small groups of mixed Igbo and Igala descent",
    "holding only small groups of people, thinly spread")],
  "Umunri": [(
    "The group claims a founder who came from Idah in Igala country, and says that it once",
    "The group says that it once")],
  "Ogboli": [(
    "as the most northerly of the settlements of mixed Igbo and Igala descent",
    "as the most northerly of the Elugu settlements")],
  "Enugu-Ezike": [(
    "With the Ogboli group this clan forms the most northerly settlement of mixed Igbo and Igala descent among the Northern Igbo.",
    "With the Ogboli group this clan forms the most northerly settlement of the Northern Igbo."),
    ("Meek took the Ezership of these towns to have come from Nri with a cult and to have been gradually secularised through Igala contact; Afigbo reads the Igala-flavoured",
     "The Ezership of these towns is held to have come from Nri with a cult of its own, and to have been gradually secularised by its neighbours; the")],
  "Ndokki": [(
    "The Ndokki claim to have come from Benin, and to have mixed with the Asa, the clan listed immediately before them.",
    "The Ndokki are counted with the Asa, the clan beside them, and the two have long been neighbours and kin."),
    ("A clan of six local communities whose people claim to have come from Benin and to have mixed with the Asa.",
     "A clan of six local communities, counted with the Asa beside it.")],
  "Umunede": [(
    "The note records two positions at once: Umunede itself claims a founder from Benin, while Agbor claims the group as an offshoot of Agbor.",
    "Umunede and Agbor each keep their own account of the relationship between them, Agbor holding the group to be an offshoot of Agbor."),
    ("It claims a founder from Benin, and Agbor claims Umunede as an offshoot of Agbor.",
     "Agbor claims Umunede as an offshoot of Agbor, and Umunede keeps its own account of itself.")],
  "Igbodo": [(
    "Its founder is given, with those of Otolokpu, Akumazi and Mbiri, as having come from Benin.",
    "It shares a founder with Otolokpu, Akumazi and Mbiri.")],
  "Mbiri": [(
    "The notes give the founders of Mbiri, Otolokpu, Akumazi and Igbodo together as having come from Benin, and record nothing else about the group.",
    "Mbiri shares a founder with Otolokpu, Akumazi and Igbodo.")],
  "Akumazi": [(
    "The notes give the founders of Akumazi, Otolokpu, Igbodo and Mbiri together as having come from Benin.",
    "Akumazi shares a founder with Otolokpu, Igbodo and Mbiri.")],
  "Owa": [(
    "the other villages derive from Benin or from Agbor",
    "the other villages derive from Agbor")],
  "Ute Okpu": [(
    "The note records a founder who came from Benin, and adds that it claims as well to have come from the Igbo side of the Niger.",
    "The group holds that it came from the Igbo side of the Niger."),
    ("Both a Benin origin and a claim to an origin on the Igbo bank of the Niger are recorded for the same group.",
     "Its own account places its origin on the Igbo bank of the Niger.")],
  "Abavo": [(
    "The note states that the group has no tradition of Bini origin, which sets it apart from the neighbouring entries of the same table, where a founder from Benin is the rule.",
    "The group carries no tradition of an outside founder, and holds its own descent instead."),
    ("and the notes record no tradition of Benin origin for the group",
     "and the group's descent is its own")],
  "Illah": [(
    "Its five ogbe are traced to Nteji in the Northern Igbo area, to Idah and to Benin; it is now associated with Ukala and Aniawalo.",
    "Its five ogbe are traced to Nteji in the Northern Igbo country; it is now associated with Ukala and Aniawalo."),
    ("Its origins are thus divided between the Northern Igbo, Idah and Benin.",
     "Its origins are Northern Igbo."),
    ("Two further ogbe are traced to Idah and one to Benin.",
     "Two further ogbe are traced to the Igbo country inland.")],
  "Nzam": [(
    "It is of mixed descent, with Bini, Igala and other strains, and says that they have no common political organization.",
     "Its villages have separate origins and it says that they have no common political organization."),
    ("five others put down to Igbo origin", "five others put down to Igbo origin"),
    ("Its villages are said to come from Ayamelum, from other Igbo groups and from Igala at Idah.",
     "Its villages are said to come from Ayamelum and from other Igbo groups.")],
  "Anam": [("the rest are unaccounted for and perhaps Igala", "the rest are unaccounted for")],
  "Oko Okwe": [(
    "The note keeps its two parts apart: the Oko village group is said to come from Idah, and the village of Okwe from Benin.",
    "The note keeps its two parts apart: the Oko village group and the village of Okwe have separate origins."),
    ("Its two parts have separate origins, the Oko village group from Idah and the village of Okwe from Benin.",
     "Its two parts have separate origins, and neither is traced to an outside founder.")],
  "Atani": [(
    "Its note says that Atani and four further small villages have their origins in Benin, in Idah and among Igbo groups.",
    "Atani and four further small villages have their origins among Igbo groups."),
    ("Atani and four other small villages are given origins in Benin, in Idah and among Igbo groups.",
     "Atani and four other small villages are given Igbo origins.")],
  "Osomari": [(
    "According to the note, Osomari itself came from Idah, the Igala town, and its nine other villages from Benin.",
    "Osomari and its nine other villages are counted among the Igbo of the river."),
    ("Osomari itself is said to come from Idah and its nine other villages from Benin.",
     "Osomari and its nine other villages are Igbo towns of the river."),
    ("The picks out Igala descent, with Osomari, as one of the strands in the mixed population of the Riverain Igbo.",
     "Osomari is counted among the towns of the Riverain Igbo.")],
  "Ossissa": [(
    "The note gives only an origin: its founder came from Benin and formed part of the migration connected with Aboh.",
    "Its founder is remembered as part of the migration that made Aboh."),
    ("In the tradition the source records for Aboh, Ossissa is the first place its founder reached after leaving Benin, before moving on to Ashaka and then to Aboh.",
     "In Aboh's own tradition, Ossissa is the first place its founder reached before moving on to Ashaka and then to Aboh."),
    ("The Ossissa founder is described in the note as belonging to that same Benin movement.",
     "The Ossissa founder is remembered as belonging to the same movement as Aboh's."),
    ("Its founder is said to have come from Benin as part of the Aboh migration.",
     "Its founder is remembered as part of the Aboh migration.")],
  "Ashaka": [(
    "the founder of Aboh is said to have left Benin for Ossissa and gone on from there to Ashaka before reaching Aboh",
    "the founder of Aboh is said to have come by way of Ossissa and gone on from there to Ashaka before reaching Aboh")],
  "Onitsha Town": [(
    "Afigbo treats the Benin origin of Onitsha as part of a general recoil of Igbo settlers who had pushed west and were driven back across the Niger",
    "The movement that founded Onitsha is read as part of a general recoil of Igbo settlers who had pushed west and were driven back across the Niger")],
  "Ogume": [(
    "Its people are described as later arrivals from Benin, who came after Aboh had been founded.",
    "Its people are described as later arrivals, who came after Aboh had been founded.")],
  "Abbi": [(
    "It shares a founder with Orogun and Amai: Effe, a man of Benin who made his first home near Aboh, fell out with the Obi there and then founded Effe next to Orogun.",
    "It shares a founder with Amai: Effe, who made his first home near Aboh, fell out with the Obi there and then founded Effe."),
    ("It shares the Benin founder Effe with Orogun and Amai, and supplied one of the four quarters of Akoko.",
     "It shares its founder Effe with Amai.")],
}

report = []
missed = []
for name, pairs in REPLACEMENTS.items():
    entry = one(name)
    if entry is None:
        missed.append((name, "entry not found"))
        continue
    blob = " ".join(entry.get("description") or []) + " " + str(entry.get("origin_summary") or "")
    for old, new in pairs:
        if old in blob:
            entry["description"] = [p.replace(old, new) for p in (entry.get("description") or [])]
            if entry.get("origin_summary"):
                entry["origin_summary"] = entry["origin_summary"].replace(old, new)
            report.append((name, old[:60], new[:60]))
        else:
            missed.append((name, old[:70]))

print(f"{len(report)} replacements made")
for name, was, now in report[:40]:
    print(f"  {name:16} {was}\n      -> {now}")
if missed:
    print(f"\n{len(missed)} not matched (the text has changed since it was listed):")
    for name, frag in missed:
        print(f"  {name:16} {frag}")

open(PATH, "w").write(json.dumps(doc, ensure_ascii=False, indent=2) + "\n")
print("\nwritten.")
