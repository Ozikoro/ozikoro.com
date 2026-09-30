"""The Aro confederation, and the clans inside it.

The owner: "You did not add Aro confederation, and you forgot Arochukwu is a clan, while Aro
is a confederation. There must be 'Aro' page as a confederation, then you add every clan in
the confederation like Izuogu, Arochukwu, etc."

He is right about the shape. The registry had Arochukwu and Ndizuogu as clans with nothing
above them, and "Aro" only as a label on each. A confederation is a level between the tribe
and the clan, and the entry for it is what makes the other two make sense.
"""
import json

PATH = "data/clans/clans.json"
doc = json.load(open(PATH))
names = {c["name"] for c in doc["clans"]}

ARO = {
  "name": "Aro",
  "slug": "aro",
  "kind": "confederation",
  "ethnicGroup": "Igbo",
  "tribe": "Cross River Igbo",
  "subgroup": "Aro",
  "region": "Abia",
  "states": ["Abia"],
  "lgas": ["Arochukwu"],
  "aliases": ["Aro Confederacy", "Umuchukwu", "Aro people"],
  "origin_summary": (
    "Aro is the confederation of Arochukwu and the Aro settlements that grew from it — a "
    "commercial, political and religious network rather than a territory, which held the "
    "trade routes of the south-east from the seventeenth century until the British conquest "
    "of 1901-1902. Arochukwu is its head and its seat."),
  "towns": ["Arochukwu", "Ndizuogu", "Ndienyi"],
  "description": [
    "Aro is not a place with borders. It is a network of communities that kept their ties to "
    "Arochukwu and to each other — a trade diaspora, as the historian who has studied it most "
    "closely puts it: socially connected but geographically scattered, with more of the "
    "machinery of a state than a diaspora usually has. About a hundred and fifty Aro "
    "settlements grew up in the Bight of Biafra alone, some of them founded by conquest, "
    "some as wards inside older towns, some as small merchant compounds in a host community "
    "that was not Aro at all.",
    "Arochukwu was the centre and stayed the centre. It was the seat of the Eze Aro, of the "
    "central council called the Ọkpankpọ, and of the oracle of Ibini Ukpabi — Chukwu Abiama "
    "— which the British wrote down as the Long Juju. Litigants came to it from communities "
    "that were not Aro to settle disputes that could not be settled at home, and petitioners "
    "came for illness, for children, for harvests. Its judgments carried because the same "
    "network that spread its reputation also carried back the information its priests "
    "needed to make a judgment look well informed.",
    "The confederation governed itself by deliberation, not by a throne. Arochukwu was made "
    "of three blocs — Ezeagwu, Okennachi and Ibom Isii — which together contained nine "
    "lineages called Ọtụsị. The heads of the nine were the Ọkpankpọ, the highest council; a "
    "body of three senior men, the Nna Atọ, sat above it, chaired by the Eze Aro. He was "
    "first among them rather than a monarch over them, and authority rested on the balance "
    "between the three blocs. Nineteen village and lineage groups were organised through the "
    "Ọtụsị, and a settlement far away traced its connection home through the lineage its "
    "founders came from — which is how the centre could settle matters of common Aro concern "
    "without governing each distant town day by day.",
    "The Ekpe society served in place of an administration. In parts of southern Igboland it "
    "was known as Okonko or Ekpe Aro, and it published decisions, enforced debts, policed "
    "trade and settled disputes among Aro people. Nsibidi writing belonged to institutions "
    "of that kind — a script kept by a society rather than taught in the open — and the "
    "Ekpe's origins east of the Cross River are part of why Aro power grew in a world of "
    "several peoples rather than one.",
    "The trade is what made the confederation a power. From the eighteenth century Aro "
    "merchants settled along the routes and beside the markets that already existed, and by "
    "the nineteenth their reach ran from the interior of Igboland to the Niger, to the Cross "
    "River and down to the ports at Bonny, Old Calabar and later Opobo. Cloth, firearms, "
    "gunpowder, tobacco and metal goods came inland; palm produce and people went down to "
    "the coast. What held the network together was kinship, commercial interest, ritual "
    "affiliation and pride in being Aro — not a standing army or a tax office.",
    "That trade included the enslavement of people, and the record says so plainly. From the "
    "1740s the exports of enslaved people from the Bight of Biafra rose steeply and Aro "
    "settlements were among the chief inland collection and transport points. People entered "
    "that trade through war, kidnapping, debt and judicial process, and the oracle was "
    "entangled with it: some who were condemned through it, or who could not pay the fines "
    "it imposed, were sold. The older colonial claim that the oracle was the single great "
    "source of captives has not survived the scholarship — the trade had many routes and "
    "many hands — and neither has the colonial picture of a single Aro tyranny directing "
    "everything, which was useful to the officials who wanted an expedition and unhelpful to "
    "anyone trying to understand the region.",
    "Where force was needed it was often borrowed. Aro merchants allied with the Cross River "
    "Igbo military communities — Abam and Ohafia above all, and Ihechiowa, Abiriba, Nkporo "
    "and Afikpo with them — and those alliances supplied the fighting men for many Aro "
    "operations. It was a partnership that cut both ways: the warrior communities had their "
    "own standing, their own wars and their own interest in the trade the Aro organised.",
    "Britain abolished its slave trade in 1807 and the trade out of the Bight fell away over "
    "the following decades, but Aro commerce did not. Palm oil and palm kernels took its "
    "place, the internal market in enslaved people grew, and Aro merchants worked the new "
    "produce trade as they had worked the old. What ended the confederation was not "
    "economics but conquest: from November 1901 four columns converged on Arochukwu, and the "
    "town was occupied that December. The shrine was attacked, the network's ability to "
    "regulate the region's trade ended with it, and the campaign went on through southern "
    "Igboland and Ibibioland into 1902.",
    "Arochukwu outlived the confederation. Ibini Ukpabi was restored quietly after the "
    "expedition, destroyed again by the colonial government in 1912, and functioning at a "
    "new site by 1915. The Eze Aro, the lineages and the Aro settlements across the "
    "south-east are still there, and the route to the shrine is on Nigeria's UNESCO "
    "tentative list as the Arochukwu Long Juju Slave Route.",
  ],
  "source": ("Wikipedia, \"Aro Confederacy\" and \"Aro people\", from Dike & Ekejiuba (1990), "
             "Nwokeji (2010), Isichei (1973) and Afigbo (1981); the owner's direction to write "
             "the confederation as the level above the Aro clans (2026-09-29)"),
}

# The clans the confederation contains. Each is already in the registry; what was missing was
# the level above them.
MEMBERS = {
  "Arochukwu": {"parent": "Aro", "subgroup": "Aro"},
  "Ndizuogu": {"parent": "Aro", "subgroup": "Aro"},
  "Ndienyi": {"parent": "Aro"},
}

existing = [c for c in doc["clans"] if c["name"] == "Aro"]
if existing:
    existing[0].update(ARO)
    print("  updated the Aro entry")
else:
    doc["clans"].append(ARO)
    print("  added Aro as a confederation")

for name, fields in MEMBERS.items():
    target = next((c for c in doc["clans"] if c["name"] == name), None)
    if not target:
        print(f"  ! {name} is not in the registry")
        continue
    target.update(fields)
    if name == "Ndizuogu":
        target["aliases"] = sorted(set((target.get("aliases") or []) + ["Izuogu", "Arondizuogu", "Aro-ndizuogu"]))
    print(f"  {name} is now a clan of the confederation")

open(PATH, "w").write(json.dumps(doc, ensure_ascii=False, indent=2) + "\n")
print("\nentries:", len(doc["clans"]))
