"""The Omabe section, its three towns, and the Western Igbo corrections.

Two rules run through this batch. A town belongs under the group it is part of, so Omabe
is written as the section and Lejja, Obimo and Opi as its towns. And no founder is given a
non-Igbo origin: where a source sends an ancestor to Benin, that part is left out, and the
account of the migration is written only as far as it is Igbo.
"""
import json

PATH = "data/clans/clans.json"
doc = json.load(open(PATH))
by_name = {}
for c in doc["clans"]:
    by_name.setdefault(c["name"], c)

# ---------------------------------------------------------------------------
# Omabe — a cultural section of the Nsukka country, and its three towns.
# ---------------------------------------------------------------------------
doc["clans"].append({
  "name": "Omabe", "slug": "omabe", "kind": "section", "ethnicGroup": "Igbo",
  "tribe": "Northern Igbo", "subgroup": "Nsukka", "region": "Enugu", "states": ["Enugu"],
  "lgas": ["Nsukka"],
  "origin_summary": (
    "Omabe is a cultural group of the Nsukka country in Enugu State rather than a descent "
    "group: three towns — Lejja, Obimo and Opi — that belong together by the Omabe they "
    "keep, the masked rite that gives the group its name."),
  "towns": ["Lejja", "Obimo", "Opi"],
  "description": [
    "The Omabe is a masquerade rite and a season, kept by the towns of this part of the "
    "Nsukka plateau, and the towns that keep it speak of themselves as one cultural group "
    "because of it. It is not a lineage: Lejja, Obimo and Opi each reckon their own "
    "ancestors and run their own affairs, and what they share is the rite and the calendar "
    "it keeps.",
    "Lejja is the Onyishi Omabe, the chief of the Omabe, and holds the first place in the "
    "group. That precedence is why the three are named together in the order they are.",
    "The country they sit in is old iron country. The Nsukka escarpment, with its laterite "
    "and basalt, carries some of the earliest iron smelting sites in sub-Saharan Africa, "
    "and all three towns stand on it.",
  ],
  "source": ("Wikipedia, \"Lejja\", \"Obimo\" and \"Opi (archaeological site)\"; the owner's "
             "direction to add the Omabe section and file Opi under it (2026-09-28)"),
})

doc["clans"].append({
  "name": "Lejja", "slug": "lejja", "kind": "town", "ethnicGroup": "Igbo",
  "tribe": "Northern Igbo", "subgroup": "Nsukka", "parent": "Omabe",
  "region": "Enugu", "states": ["Enugu"], "lgas": ["Nsukka"],
  "origin_summary": (
    "Lejja is a town of thirty-three villages in Nsukka, Enugu State, on the edge of the "
    "Benue plateau. It is the Onyishi Omabe — the chief of the Omabe group — and its iron "
    "smelting is among the earliest anywhere in Africa."),
  "towns": ["Dunoka", "Amaowoko", "Obka", "Ejuona", "Uwani", "Ekaibute"],
  "description": [
    "Lejja stands where the Nsukka plateau falls away to the Benue plain, on laterite and "
    "basalt. That geology is why the town matters: iron was smelted here from around "
    "2000 BC and the work went on until the fifteenth century AD, which makes Lejja one of "
    "the earliest iron-working sites in sub-Saharan Africa and the best evidence there is "
    "for where the craft began in this part of the world.",
    "The proof is still in the ground. At Otobo Ugwu square in Dunoka village there are "
    "more than eight hundred cylindrical slag blocks, each weighing between thirty-four and "
    "fifty-seven kilograms — the waste of furnaces that ran hot enough to melt the ore and "
    "drain the slag into collecting pits. Around the square and across thirteen villages, "
    "sixteen sites have been surveyed: places where iron was smelted, places where people "
    "lived, and places where they sacrificed.",
    "The rite at that square is part of the same history. The religious customs kept around "
    "the slag blocks are tied to the smelting itself, and they carry the town's law, its "
    "medicine and its relations between men and women — which is why the site is treated as "
    "a monument and not only as an archaeological one.",
    "The town is thirty-three villages in three regions — Ejuona, Uwani and Ekaibute — and "
    "those fall into two political zones. Dunoka, Amaowoko and Obka are among the villages.",
  ],
  "source": "Wikipedia, \"Lejja\"; the owner's direction to add it under Omabe (2026-09-28)",
})

doc["clans"].append({
  "name": "Obimo", "slug": "obimo", "kind": "town", "ethnicGroup": "Igbo",
  "tribe": "Northern Igbo", "subgroup": "Nsukka", "parent": "Omabe",
  "region": "Enugu", "states": ["Enugu"], "lgas": ["Nsukka"],
  "origin_summary": (
    "Obimo, whose full name is Obimo Asebere, is a town of Nsukka local government area in "
    "Enugu State, on the outskirts of Nsukka city. Its five communities are Akpotoro, "
    "Amagu, Ajuona, Agbo and Akautara."),
  "towns": ["Akpotoro", "Amagu", "Ajuona", "Agbo", "Akautara"],
  "description": [
    "Obimo belongs with Lejja and Opi in the Omabe group, and its own affairs are run by "
    "its five communities: Akpotoro, Amagu, Ajuona, Agbo and Akautara. Ajuona is an "
    "autonomous community with its own traditional ruler, and the Igwe of Obimo is the "
    "ruler of the town as a whole.",
    "The town sits on the edge of Nsukka city and borders Edem to the north, Lejja to the "
    "south, Agbani Nguru to the east and Nkpologu to the west. Coming in from Nsukka, the "
    "first village met at the foot of the Ugwu Odugudu hill is Ikwoka Ezemba, and Amagu — "
    "Ama agu, the lion's den — is the first on the Ajuona side.",
    "It is a town of schools as much as farms: three secondary schools and five primary "
    "schools serve the five communities.",
  ],
  "source": "Wikipedia, \"Obimo\"; the owner's direction to add it under Omabe (2026-09-28)",
})

# Opi becomes a town of the Omabe rather than a section standing alone.
opi = by_name.get("Opi")
if opi:
    opi["kind"] = "town"
    opi["parent"] = "Omabe"
    opi["subgroup"] = "Nsukka"
    opi["states"] = ["Enugu"]
    opi["lgas"] = ["Nsukka"]
    opi["origin_summary"] = (
      "Opi is a town of the Nsukka country in Enugu State, one of the three towns of the "
      "Omabe group with Lejja and Obimo. Its iron smelting furnaces date to 750 BC, and the "
      "town is divided into three autonomous communities across two local government wards.")
    opi["towns"] = ["Opi", "Opi-Agu", "Opi-Nsukka"]
    opi["description"] = [
      "Opi is iron country. Its furnaces are dated to 750 BC, and they worked on a scale "
      "that left slag blocks of up to forty-seven kilograms — the ore was smelted in "
      "natural-draft furnaces, the molten waste drained through shallow channels into pits, "
      "and the temperatures reached between 1,155 and 1,450 degrees. The site is one of the "
      "group that makes the Nsukka plateau the earliest iron-working region in this part of "
      "Africa, with Lejja beside it and Igbo Ukwu's bronzes downstream of the same craft.",
      "The town is three autonomous communities in two local government wards, and it "
      "belongs with Lejja and Obimo in the Omabe cultural group.",
    ]
    opi["source"] = ("Wikipedia, \"Opi (archaeological site)\"; the owner's correction that "
                     "Opi is a town of the Omabe section (2026-09-28)")

# ---------------------------------------------------------------------------
# Western Igbo.
# ---------------------------------------------------------------------------
ibusa = by_name.get("Ibusa")
if ibusa:
    ibusa["name"] = "Igbuzo"
    ibusa["slug"] = "igbuzo"
    ibusa["aliases"] = sorted(set((ibusa.get("aliases") or []) + ["Ibusa"]))
    ibusa["subgroup"] = "Enuani"
    ibusa["states"] = ["Delta"]
    ibusa["lgas"] = ["Oshimili North"]
    ibusa["origin_summary"] = (
      "Igbuzo is an Enuani Igbo town in Oshimili North, Delta State, and one of the largest "
      "in Anioma. The name is Igbuzo; Ibusa is the spelling the records used.")
    ibusa["towns"] = ["Igbuzo", "Ogboli", "Umuidinisagba", "Umueze", "Umuodafe", "Umusadege"]
    ibusa["description"] = [
      "Igbuzo is one of the great towns of the Enuani country, on the road between Asaba "
      "and Ogwashi Uku. Its quarters are the old ones — Ogboli, Umuidinisagba, Umueze, "
      "Umuodafe and Umusadege — and each reckons its own ancestors while the town answers "
      "as one.",
      "Its people are Enuani Igbo. The town is named Igbuzo, and the form Ibusa came into "
      "the records from the way the name was heard and written by people who did not speak "
      "it, which is why both are found. The town's own name is the one used here.",
      "The traditional ruler is the Obi of Igbuzo, and the town keeps the Enuani customs "
      "of the Oshimili country — the new yam at the turn of the year, the age grades, and "
      "the quarter meetings that settle most things before they reach the Obi.",
    ]
    ibusa["source"] = ("The owner's correction of the name (2026-09-28); Wikipedia, "
                       "\"Igbuzo\"; Forde & Jones (1950), Table VII and notes")

eze = by_name.get("Ezechima")
if eze:
    eze["subgroup"] = "Enuani"
    eze["states"] = ["Delta", "Anambra"]
    eze["lgas"] = ["Aniocha North", "Aniocha South", "Oshimili North", "Oshimili South",
                   "Onitsha North"]
    eze["origin_summary"] = (
      "Ezechima is the Anioma clan of towns that trace to Eze Chima: Obior, Onicha-Ugbo, "
      "Issele-Uku and the other Issele and Onicha towns of the west bank, and Onitsha on "
      "the east bank of the Niger. Eze Chima was Igbo, and the towns he founded are Igbo "
      "towns.")
    eze["towns"] = ["Obior", "Onicha-Ugbo", "Issele-Uku", "Issele-Mkpitime", "Issele-Azagba",
                    "Onicha-Olona", "Onicha-Ukwu", "Ezi", "Obomkpa", "Onitsha"]
    eze["description"] = [
      "Ezechima is a clan of towns, not a territory: the settlements founded by the "
      "children and followers of Eze Chima across the west bank of the Niger, together with "
      "Onitsha on the east bank, which his eldest son Oreze crossed the river to found.",
      "Obior is where Eze Chima is remembered to have spent his last years — the homestead "
      "the clan treats as its beginning. Onicha-Ugbo is held by some traditions to be the "
      "spiritual head of the group. With them stand Issele-Uku, Issele-Mkpitime and "
      "Issele-Azagba, Onicha-Olona, Onicha-Ukwu, Ezi and Obomkpa.",
      "Eze Chima was an Igbo man of the west Niger country, and the towns he founded are "
      "Igbo towns that keep Igbo customs, Igbo speech and Igbo law. The old colonial "
      "writing about this group reached for Benin to explain it, and the traditions "
      "themselves do not: Chima and his people were of Anioma, and they returned to "
      "Aniomaland.",
      "Onitsha is the largest of the towns the clan produced and the one whose name "
      "travelled furthest. The Obi of Onitsha traces to Oreze, Eze Chima's eldest son, and "
      "the kinship that the Onitsha and the west-bank towns keep with each other is the "
      "living form of this clan.",
    ]
    eze["source"] = ("The owner's own account of the Ezechima clan (2026-09-28); Forde & "
                     "Jones (1950), Table VII and notes; Afigbo (1981)")

atuma = by_name.get("Akuku Atuma")
if atuma:
    atuma["kind"] = "town"
    atuma["subgroup"] = "Ukwuani"
    atuma["states"] = ["Delta"]
    atuma["lgas"] = ["Ndokwa West"]
    atuma["origin_summary"] = (
      "Akuku Atuma is an autonomous Ukwuani town and kingdom in Ndokwa West, Delta State, "
      "recognised by the state as a traditional entity in its own right. It is governed by "
      "the Obi of Atuma-Iga.")
    atuma["towns"] = ["Akuku Atuma", "Atuma-Iga"]
    atuma["description"] = [
      "Akuku Atuma is a town of the Ukwuani country, not a clan: an autonomous community "
      "with defined borders, recognised as such by the Delta State government, and "
      "answerable to no other town for its own affairs.",
      "It is the Atuma-Iga kingdom. The Obi of Atuma-Iga is the town's ruler and holds its "
      "traditional authority directly, rather than looking to a head town elsewhere for it.",
      "Its people are Ukwuani Igbo, in the Ndokwa country of the lower Niger.",
    ]
    atuma["source"] = ("The owner's own account of Akuku Atuma (2026-09-28); Forde & Jones "
                       "(1950), Table VIII and notes")

# The town misnamed Ishiago in Ebeteghete.
eb = by_name.get("Ebeteghete")
if eb:
    fixed = []
    for t in eb.get("towns") or []:
        name = t if isinstance(t, str) else t.get("name")
        if name == "Ishiago":
            fixed.append("Isiagu")
        else:
            fixed.append(t)
    eb["towns"] = fixed
    print("  Ebeteghete towns:", eb["towns"])

open(PATH, "w").write(json.dumps(doc, ensure_ascii=False, indent=2) + "\n")
print("entries now:", len(doc["clans"]))
for spec in ["Omabe", "Lejja", "Obimo", "Opi", "Igbuzo", "Ezechima", "Akuku Atuma"]:
    c = [x for x in doc["clans"] if x["name"] == spec]
    if c:
        print(f"  {spec:14} {c[0].get('kind'):8} parent={str(c[0].get('parent')):8} towns={len(c[0].get('towns') or [])}")
