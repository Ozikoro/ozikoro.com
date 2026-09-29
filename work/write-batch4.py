"""The accounts the owner supplied, and the Igbo origins where a foreign one was written.

Every entry here is written from a source he named. Where a tradition sends an ancestor to
Benin, Igala country or the Idoma, the account is given the way his own sources give it:
the movement is Igbo, and the places on the road are places the people passed through
rather than where they came from.
"""
import json

PATH = "data/clans/clans.json"
doc = json.load(open(PATH))
by = {}
for c in doc["clans"]:
    by.setdefault(c["name"], []).append(c)

def one(name):
    return by[name][0] if name in by else None

# ---------------------------------------------------------------------------
# Umuakasiada — the Akashiada clans of Ukwuani.
# ---------------------------------------------------------------------------
u = one("Umuakasiada")
if u:
    u.update({
      "name": "Umuakasiada", "slug": "umuakasiada", "kind": "clan",
      "aliases": ["Akashiada", "Akashiada clans"],
      "tribe": "Western Igbo", "subgroup": "Ukwuani", "states": ["Delta"],
      "lgas": ["Ukwuani", "Ndokwa West"],
      "origin_summary": (
        "Umuakasiada is the Akashiada group of Ukwuani clans in Delta State: Eziokpor, "
        "Ezionum and Umuebu, with Obiaruku grown out of Umuebu land. Their own account of "
        "where they came from is an Igbo one — migration out of eastern Igboland by way of "
        "the western Igbo towns of Asaba, Ebu, Utchi and Afor — and the older story that "
        "traces them to Benin is rejected by the researchers who have worked on it."),
      "towns": ["Eziokpor", "Ezionum", "Umuebu", "Obiaruku", "Umuaja"],
      "description": [
        "The Akashiada are Eziokpor, Ezionum and Umuebu, and Obiaruku grew out of Umuebu's "
        "land beside the Ethiope. The clans share the customs and the speech of the Ukwuani "
        "country, and their own researchers treat them as the most recent arrivals in it — "
        "coming in from the late sixteenth century into the seventeenth, with Obiaruku "
        "settled only at the end of the nineteenth.",
        "Their ancestry is Igbo. The account that traces the Akashiada to Benin does not "
        "survive the evidence: the clans bear Igbo names, they keep Igbo customs, and the "
        "verifiable traditions point the other way — migration out of eastern Igboland and "
        "through the western Igbo towns of Asaba, Ebu, Utchi and Afor, which are named again "
        "and again as the places the migrations started from. The first settlement in the new "
        "country was Umuoshi quarter in Eziokpor, and the later villages grew from there.",
        "Obiaruku is the largest town in Ukwuani land and the headquarters of its local "
        "government. It began as Mokka's farm settlement on the Ethiope, and it is remembered "
        "that he left Umuebu about 1880 to keep watch on the approach to his own clan as much "
        "as to farm. Others came after him — the Awkuzu quarter, whose ancestors are said to "
        "have gone from Awkuzu in eastern Igboland to Aboh and then to Umuebu before moving "
        "again — and the Ogwezi who followed them from Aboh and founded Umundede quarter.",
        "The river is what made the place. The Ethiope's banks carried the timber and the "
        "rubber the Royal Niger Company came for, and the trade turned a farm settlement into "
        "the administrative centre of the district.",
      ],
      "source": ("The owner's own account of the Akashiada clans (2026-09-28) and the history "
                 "he supplied, \"The History, Migration & Settlement of the Akashiada Clans in "
                 "Ukwuani Land\" by Justin Okpu, recording the work of Paul O. Opone and others"),
    })
    print("  wrote Umuakasiada")

# ---------------------------------------------------------------------------
# Idumuje.
# ---------------------------------------------------------------------------
i = one("Idumuje")
if i:
    i.update({
      "kind": "clan", "subgroup": "Enuani", "states": ["Delta"],
      "lgas": ["Aniocha North"],
      "origin_summary": (
        "Idumuje is an Enuani Igbo community of Aniocha North in Delta State, formed over "
        "generations by several movements of people rather than by one ancestor. Its two "
        "towns are Idumuje-Unor, the older settlement, and Idumuje-Ugboko, founded when a "
        "faction left after a dispute over the Odogwu title."),
      "towns": ["Idumuje-Unor", "Idumuje-Ugboko", "Okwunye", "Idumu-Obu", "Ogbe-Akwu",
                "Atuma", "Ogbe-Obi", "Ogbe-Ofu", "Onicha-Ukwu"],
      "description": [
        "Idumuje was not founded by one migration and its own quarter histories say so. "
        "Idumu-Obu traces its people to Umudaike in Asaba, on the eastern bank of the Niger, "
        "whose ancestors crossed westward into the Idumuje country; Atuma traces its own to "
        "Owo. The community is best read as an Enuani one that grew by taking people in — "
        "movements arriving across the Niger, settling among those already there, and keeping "
        "their own traditions of where each quarter came from.",
        "Idumuje-Unor is the older settlement and the ancestral centre, and its quarters are "
        "Okwunye, Idumu-Obu, Ogbe-Akwu and Atuma. The town is remembered for Obi James Anyasi "
        "II, who took the stool in 1946 and held it until 2023 — one of the longest reigns of "
        "any traditional ruler on record.",
        "The two towns come from a quarrel. A dispute over the office of the Odogwu, which "
        "carries military authority, split the community; the faction led by Prince Nwoko "
        "left Idumuje-Unor and went deeper into the forest at Ugboko, and Idumuje-Ugboko was "
        "founded there, with Ogbe-Obi as its royal quarter and the palace, and Atuma, "
        "Ogbe-Ofu and Onicha-Ukwu beside it. The two kept one identity and the same "
        "traditions through the separation.",
        "The people speak Enuani, the Igbo of the western Niger, and their institutions put "
        "them where they belong — in the Enuani country around the river. Authority is the "
        "Obi's, with the quarters and their elders around him, and the year turns on Iwa-Ji, "
        "the new yam, with the Ogbanigbe dance as the town's own.",
      ],
      "source": "The owner's own account of Idumuje (2026-09-28)",
    })
    print("  wrote Idumuje")

# ---------------------------------------------------------------------------
# Aboh.
# ---------------------------------------------------------------------------
a = one("Aboh")
if a:
    a.update({
      "kind": "clan", "subgroup": "Ndokwa", "states": ["Delta"], "lgas": ["Ndokwa East"],
      "origin_summary": (
        "Aboh is a riverine Igbo kingdom on the lower Niger in Ndokwa East, Delta State. It "
        "was made by two Igbo peoples meeting: the Akarai already living along the water, and "
        "Ika migrants from the Agbor country who came south and became its royal line, the "
        "Umudei."),
      "towns": ["Aboh", "Umu Ossai", "Umu Ozegbe", "Umu Ojugbali", "Umu Ogwezi"],
      "description": [
        "The lower Niger was not empty when Aboh began. The Akarai were already there — "
        "fishermen, farmers, canoe builders and traders of the river, of the Nri and Awka "
        "country in their origins, with the Ofo, the omenala and titled leadership that go "
        "with it. They knew the water and its channels, and Aboh stands where they lived.",
        "The second strand is Ika. A group of Ika Igbo came south out of the Agbor country "
        "during a period of war and succession trouble in the western Niger, led in the "
        "tradition by Obi Essumei Ukwu, and settled among the riverine communities. The two "
        "peoples married into each other, allied and merged, and the kingdom that came out of "
        "it was neither Agbor carried south nor the old fishing villages unchanged, but a new "
        "Igbo state on the water.",
        "The royal line is called the Umudei, and the name is the link: it belongs to the "
        "ancient royal title Dein of Agbor, and in Ika a prince is Nwadei, while in Aboh "
        "Umudei means the children of the royal house. Four royal houses hold the succession "
        "in turn — Umu Ossai, Umu Ozegbe, Umu Ojugbali and Umu Ogwezi — which kept the "
        "monarchy from becoming one branch's property.",
        "The Obi ruled, and did not rule alone. The Ofo stood for legitimate authority and "
        "the ancestral sanction behind it; the Ndiche and the titled men and lineage heads "
        "sat with the Obi over the affairs of the kingdom. Aboh is one of the clearest cases "
        "in Igboland of a centralised Igbo monarchy, and it was still a government of "
        "councils and custom rather than of one man.",
        "Its position made it rich. Canoe-building, navigation, fishing, farming and "
        "riverine warfare were its trades, and the trade on the Niger from the delta up past "
        "Asaba was in its hands until the nineteenth century closed. The groups between the "
        "Orashi and the Sombreiro, Oguta and Izombe and Awarra and Egbema among them, are "
        "said once to have accepted its overlordship, and Meek records that in the travellers' "
        "accounts of the 1840s the ruler of Aboh claimed Onitsha among his territories.",
      ],
      "source": ("The owner's own account of Aboh (2026-09-28); the Oru article at ozikoro.com; "
                 "Forde & Jones (1950), pp. 49-51, Table IX and notes; Meek (1937)"),
    })
    print("  wrote Aboh")

# ---------------------------------------------------------------------------
# Agbor — the founder claim goes, as the owner asked.
# ---------------------------------------------------------------------------
ag = one("Agbor")
if ag:
    ag["subgroup"] = "Ika"
    ag["states"] = ["Delta"]
    ag["lgas"] = ["Ika South", "Ika North East"]
    ag["origin_summary"] = (
      "Agbor is the head town of the Ika Igbo in Delta State, and the largest of them. It "
      "is older than the Ezechime dispersal, and its people are Ika — Igbo of the western "
      "Niger who were in this country before the movements that later stories attach to "
      "them.")
    ag["description"] = [
      "Agbor is the seat of the Ika. The Dein of Agbor is its ruler, and the title is old "
      "enough that the royal houses of Aboh, far to the south, took their own name Umudei "
      "from it — the children of the house of Dein.",
      "The town is older than the accounts that give it a founder from outside Igboland. "
      "The tradition that makes Chima its founder does not hold: Agbor was there before the "
      "Ezechime movement, and the Ika are Igbo of the western Niger rather than settlers "
      "from anywhere else. Where a founder's origin cannot be given truthfully, this entry "
      "gives none.",
      "Its quarters and villages are many — Owa, Boji-Boji, Alihame, Idumuesa, Obinomba and "
      "the rest — and the town is the administrative centre of Ika South and the market of "
      "the Ika country. Farming is the base of it, with yam and cassava and oil palm, and "
      "the Ogwa and Igbogene markets have traded for as long as anyone records.",
    ]
    ag["source"] = ("The owner's correction (2026-09-28): \"Agbor was not founded by Chime as "
                    "Agbor is older than Ezechime, and they are not Benin, so remove it\"; "
                    "Forde & Jones (1950), Table VII and notes")
    print("  wrote Agbor")

# ---------------------------------------------------------------------------
# Afor — a town of the Ukwuani, not a clan.
# ---------------------------------------------------------------------------
af = one("Afor")
if af:
    af.update({
      "kind": "town", "subgroup": "Ukwuani", "states": ["Delta"], "lgas": ["Ndokwa East"],
      "parent": None,
      "origin_summary": (
        "Afor is a historic village of the Ukwuani country in Ndokwa East, Delta State. It "
        "is a town of the Ukwuani, one of the places the Akashiada migrations set out from, "
        "and it is not a clan."),
      "towns": ["Afor", "Umuachi Afor", "Obetim"],
      "description": [
        "Afor sits in Ndokwa East, on the Ase river, and it is a village of the Ukwuani "
        "rather than a clan with villages under it. Its people farm the riverside land and "
        "fish the Ase.",
        "The town's name travels. Umuachi Afor is named in the Akashiada accounts as one of "
        "the places the migrations into Ukwuani land started from, alongside Asaba, Ebu and "
        "Utchi — which places Afor among the older western Igbo settlements the later "
        "movements came out of.",
      ],
      "source": ("The owner's correction that Afor is a town of the Ukwuani (2026-09-28); the "
                 "Akashiada history he supplied; Forde & Jones (1950), Table VIII and notes"),
    })
    print("  wrote Afor")

# ---------------------------------------------------------------------------
# Onicha — a section, with the towns that belong to it.
# ---------------------------------------------------------------------------
on = one("Onicha")
if on:
    on.update({
      "kind": "section", "name": "Onicha", "slug": "onicha", "subgroup": "Enuani",
      "states": ["Delta", "Anambra"],
      "lgas": ["Aniocha North", "Aniocha South", "Oshimili North", "Oshimili South",
               "Onitsha North"],
      "origin_summary": (
        "Onicha is a section of the west Niger Igbo: the family of towns whose names carry "
        "the word — Onicha-Olona, Onicha-Ugbo, Onicha-Ukwu and Onitsha Mmili across the "
        "river — which belong together by descent and by the Ezechime tradition."),
      "towns": ["Onicha-Ugbo", "Onicha-Olona", "Onicha-Ukwu", "Onicha-Mmili", "Onitsha"],
      "description": [
        "Onicha is not one town. It is the set of towns that carry the name, and what holds "
        "them together is the tradition that they came out of the same movement: Ezechime, "
        "Onicha his eldest son, and the dispersal that put Onicha-Ugbo and Onicha-Olona and "
        "Onicha-Ukwu on the west bank and Onitsha Mmili on the east.",
        "The word describes the people it named. Onicha is read as those who moved away from "
        "a main body to take up a new place — a name for a settlement made by leaving, which "
        "is what every town that carries it did.",
        "Onicha-Ugbo is the ancestral home on the western side and the head of the group; "
        "Onicha-Olona was founded by people who moved from it; Onicha-Ukwu stands with them. "
        "Onitsha Mmili, Onitsha Ado, is the largest of them all — across the Niger in "
        "Anambra State, founded when Oreze, Ezechime's eldest, crossed the river. It is the "
        "Onitsha whose Obi traces to him.",
        "The towns are governed the way Enuani towns are. The Diokpa, the oldest man of a "
        "family or a village, leads it; the Onotu and the customary groups around him keep "
        "order and see to the defence of the town. Farming is the base of the west-bank "
        "towns, with yam at the centre of it, and Onicha-Ugbo's market is as old as the "
        "town.",
      ],
      "source": ("The owner's own account of the Onicha section (2026-09-28); Forde & Jones "
                 "(1950), Table VII and notes"),
    })
    print("  wrote Onicha")

# ---------------------------------------------------------------------------
# Riverine Igbo, from the owner's own article on the Oru.
# ---------------------------------------------------------------------------
for division in doc["divisions"]:
    if division["name"] == "Riverine Igbo":
        division["note"] = (
          "The riverine Igbo call themselves Oru, and the adage Oru na Igbo bu ofu — Oru and "
          "Igbo are one — is how they place themselves: Igbo, with a way of life of their "
          "own. Their towns run along the Niger and up its great tributaries, the Orashi and "
          "the Omambala, and they built their settlements on the water's edge where the "
          "interior Igbo avoided it — compact towns at the riverbank, fishing, canoe-building "
          "and trade. Oguta, Aboh, Anam and Ogbaru grew into the trading centres of the "
          "lower Niger, dealing with the Igala, the Edo and the Izon as well as with Igbo "
          "towns, and the Oru fed much of Igboland from their farms and their waters. They "
          "developed kingship earlier and further than most Igbo societies — an Obi or "
          "Ezeigwe with a council of Ndiche and Ndiokpara to balance him — and Oru titles "
          "such as Iyase-Onowu, Onise and Odogwu passed into Igbo political life more "
          "widely. Oru is not one descent group: it is proto-Igbo peoples who moved east and "
          "took to the water, and their towns are found on both banks and down into the "
          "creeks as far as Sagbama, Mbiama, Nembe and Odioma. The names Ogbashu and Ozizor "
          "are still used among them for those who paddle downriver and those who go up "
          "against it."
        )
        print("  rewrote the Riverine Igbo note")

open(PATH, "w").write(json.dumps(doc, ensure_ascii=False, indent=2) + "\n")
print("\nentries:", len(doc["clans"]))
