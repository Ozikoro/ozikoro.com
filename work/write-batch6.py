"""The four accounts the owner named, written in from his own articles."""
import json

PATH = "data/clans/clans.json"
doc = json.load(open(PATH))
by = {}
for c in doc["clans"]:
    by.setdefault(c["name"], []).append(c)

V = {}

V["Idumuje"] = dict(
  kind="clan", subgroup="Enuani", states=["Delta"], lgas=["Aniocha North"],
  origin_summary=(
    "Idumuje is an old Enuani-Igbo clan of Delta State, made up of two autonomous towns — "
    "Idumuje-Unor and Idumuje-Ugboko. It took shape in the western Niger world over "
    "generations of migration, settlement, marriage and political joining, and its quarters "
    "keep different ancestral traditions."),
  towns=["Idumuje-Unor", "Idumuje-Ugboko", "Okwunye", "Idumu-Obu", "Ogbe-Akwu", "Atuma",
         "Ogbe-Obi", "Ogbe-Ofu", "Onicha-Ukwu"],
  description=[
    "Idumuje's history cannot be told as one people making one journey, because its own "
    "quarters do not tell it that way. Idumu-Obu traces its people to Umudaike in Asaba, on "
    "the east bank of the Niger, whose ancestors crossed the river and moved west into the "
    "land that became Idumuje — an Asaba connection that stands on its own. Atuma remembers "
    "a link to Owo, in what is now Ondo State, which brings people in from another direction "
    "again. Other lineages recall coming through Obior and Ahama. Put together, those "
    "traditions place Idumuje in the wide movement of peoples across the Niger and Delta "
    "country, not at the end of a single road.",
    "Idumuje-Unor is the older settlement and the ancestral centre. As it grew, ancestral "
    "groups settled in quarters of their own — Okwunye, Idumu-Obu, Ogbe-Akwu and Atuma — each "
    "keeping its own account of where it came from while becoming part of the larger town.",
    "One further tradition belongs to the clan: Ogbeide, a chief of the Uzebu quarter of "
    "Benin, left for Ahama, and his sons Aluya and Ologbo went on to Obior and later to "
    "Idumuje-Unor. Onaifo, one of Ologbo's sons, was invested there with the title of Odogwu, "
    "which founded an important line in the growing community. That connection is one strand "
    "of Idumuje's history rather than the whole of it, and the quarters whose traditions do "
    "not run through it are just as much Idumuje as the ones that do.",
    "The two towns are one clan. A dispute over the office of the Odogwu — the title that "
    "carries military authority — split the community at Idumuje-Unor, and the faction led by "
    "Prince Nwoko moved deeper into the forest at Ugboko and founded Idumuje-Ugboko there, "
    "with Ogbe-Obi as its royal quarter and Atuma, Ogbe-Ofu and Onicha-Ukwu beside it. Both "
    "kept the same identity and the same ancestral traditions through the separation.",
    "The clan is Enuani Igbo and speaks Enuani, the Igbo of the western Niger, and its "
    "institutions sit where they belong — the Obi as traditional authority, with Iwa-Ji, the "
    "new yam, and the Ogbanigbe dance as the town's own. Idumuje is remembered for Obi James "
    "Anyasi II, who took the stool in 1946 and held it until 2023, one of the longest reigns "
    "of any traditional ruler on record, and for Obi Justin Nkeze Nwoko, born in 1897, whose "
    "household is part of the clan's remembered history.",
  ],
  source=("The owner's own account, \"The Idumuje Clan: Origins and Early Settlement\" at "
          "ozikoro.com (2026-09-28)"),
)

V["Abavo"] = dict(
  kind="clan", subgroup="Ika", states=["Delta"], lgas=["Ika South"],
  origin_summary=(
    "Abavo is an Ika Igbo clan west of the Niger in Delta State, founded by Avo, who held the "
    "Igbo title of Eze. Its three divisions are Udomi, Igbogili and Azuowa, and its roots are "
    "in the Nri country rather than anywhere else."),
  towns=["Abavo", "Udomi", "Igbogili", "Azuowa"],
  description=[
    "Abavo is Ika and Igbo. The founder the records give is Avo, and the title he bore was "
    "Eze — an Igbo royal and priestly title, which is itself the argument: a people founded "
    "from outside Igboland would not begin with an Igbo office. His descendants Udomi, "
    "Igbogili and Azuowa made up the clan's three main divisions, and they are the divisions "
    "still.",
    "What is known of Abavo was for a long time what colonial intelligence reports said of "
    "it, and those reports reached for Benin to explain Ika communities — casting "
    "decentralised Igbo towns as satellites of a state they were never part of. The evidence "
    "does not support it. Northcote Thomas found in Abavo's speech what he called proto-Igbo "
    "archaic features, in its nasalisation and its incipient aspiration, which belong to early "
    "Igbo and are not Edoid at all. The title Obi, which the ruling line carried — Osaigbobu "
    "was an Obi of Abavo and the father of Jegbefume — has no meaning in the Edo languages and "
    "does in Igbo, and it was in use across eastern and western Igbo country, and in "
    "Nri-influenced places, before Benin's reach extended this far.",
    "The account that fits the evidence is Onwuejeogwu's: Abavo was founded in the movement of "
    "Nri lineages into the Ika interior, out of Ute-Okpu and Issele-Uku, between the twelfth "
    "and eighteenth centuries and before Benin rose as a military power. Ogedengbe counts "
    "Abavo with Ogwashi-Uku, Okpanam, Owa and Igbuzo as communities carrying traditions of Nri "
    "origin, and Isichei held that Igbo-speaking people were in the Ika country first and met "
    "Benin later, through trade and war rather than as its children.",
    "That is not to say nothing came from the west. Centuries of contact across the Niger left "
    "their mark, and a thin Edo layer sits on top of a much older Igbo foundation. What did "
    "not happen is what the old reports implied: Abavo was not founded by Benin and is not an "
    "offshoot of it. Its language, its titles, its kingship and its family system are Igbo, "
    "and its own people have always said so.",
  ],
  source=("The owner's own account, \"Abavo and Its Origins: History, Migration, and Cultural "
          "Identity\" at ozikoro.com; Forde & Jones (1950), Table VII; Onwuejeogwu (1981); "
          "Ogedengbe (2004); Isichei (1976)"),
)

V["Anam"] = dict(
  kind="clan", subgroup="Oru", states=["Anambra"], lgas=["Anambra West", "Anambra East"],
  origin_summary=(
    "Anam is an old riverine Igbo community in Anambra State, made by several waves of "
    "migration rather than by one ancestor — which is what the name means: a gathering of "
    "people who came from different places and became one community."),
  towns=["Umueze Anam", "Odah", "Oroma-Etiti", "Anaku", "Olosi", "Nzam", "Mmiata"],
  description=[
    "Anam's name is not the name of a founder. It is what the people who gathered there came "
    "to be called, and the traditions say so: the first settlement was at Odah, in the country "
    "of what is now Umueze Anam, and the groups that came to it came from different places.",
    "They came during the unsettled period remembered as the Adda War, when slave raiding and "
    "fighting drove people toward the safety of the Anam wetlands and the river forests. One "
    "of the first groups came from Nsugbe, crossing the Anambra river into the fertile country "
    "beyond it; among those early settlers was a hunter named Nwavor, remembered as a "
    "founder of the settlement. Others followed from Nteje, Aguleri, Umueri, Nando, Omasi, "
    "Anaku and the other river towns — some fleeing, some looking for land, some drawn by the "
    "fishing and the game. What drew them all was the same thing: good farmland, forest, "
    "water and plenty in it.",
    "A smaller strand of Anam's ancestry runs to Idah. Ajida was a warrior of the Igala "
    "country, and one of his line reached Anam with his family after the movements the Igala "
    "remember as the Apa War, found land and settlements already there, stayed, and was "
    "absorbed into the growing community. Other descendants of the same line settled "
    "elsewhere. That accounts for an element within Anam; it does not account for Anam, and "
    "most of the traditions point to the Igbo communities of the Anambra and Niger rivers.",
    "Until the end of the nineteenth century none of this was written down, and what is known "
    "comes from what elders kept and passed on — which is why villages sometimes remember the "
    "same events differently, and why the differences are reported here rather than smoothed "
    "away. Anam is a riverine Igbo community of the Oru country: fishing, farming the "
    "floodland, and the water that made it.",
  ],
  source=("The owner's own account, \"Anam: Origins of a Riverine Igbo Community\" at "
          "ozikoro.com (2026-09-28)"),
)

V["Onitsha Town"] = dict(
  kind="clan", subgroup="Onitsha", states=["Anambra"], lgas=["Onitsha North", "Onitsha South"],
  origin_summary=(
    "Onicha Mmili, which the records call Onitsha, is the largest of the Onicha settlements "
    "and the one the Umu Eze Chima lineage is known by. It stands on the east bank of the "
    "Niger, and its Obi traces to Eze Chima through Oreze, his eldest son."),
  towns=["Onicha Mmili", "Onicha-Ugbo", "Onicha-Olona", "Onicha-Ukwu", "Obior"],
  description=[
    "Onitsha is one of a family of towns that carry the name Onicha, and the family is what "
    "matters before the town is. They trace to Eze Chima, whose migration out of the west "
    "established the settlements the Umu Eze Chima are named for — among them Onicha-Ugbo on "
    "the western bank of the Niger and Onicha Mmili on the eastern one, which became the "
    "largest of them all.",
    "The movement that made these towns is remembered as a return as much as a journey. Igbo "
    "people had gone west into the Benin country for opportunity, and in the displacements of "
    "the sixteenth century they came back east — which is why so many of the Onicha towns on "
    "the eastern side are older than the ones the return established, and why the name is "
    "found from Ebonyi to Imo to Enugu to Abia.",
    "Onicha Mmili itself is where the lineage's political weight settled. Its Obi is the head "
    "of the Umu Eze Chima towns, its market was the greatest on the lower Niger, and its "
    "position on the river made it the meeting place of trade from the delta and the "
    "hinterland long before the Europeans came up the water.",
    "The town is governed the way the Onicha towns are: the Obi with the Ndichie and the "
    "quarters around him, the Diokpa leading the family and village units, and the customary "
    "groups keeping order. Its identity is Igbo and Anioma at once — an Igbo town on the "
    "eastern bank whose people came from the western one, which is exactly what the name "
    "Onicha means: those who moved away from a main body to take up a new place.",
  ],
  source=("The owner's own account, \"The Umu Eze Chima Lineage and the Historical Evolution "
          "of Onicha Settlements\" at ozikoro.com (2026-09-28); Forde & Jones (1950), "
          "Onitsha Town, pp. 36-37"),
)

for name, spec in V.items():
    candidates = by.get(name) or []
    if not candidates:
        print(f'  ! {name} not in the file'); continue
    entry = candidates[0]
    for field, value in spec.items():
        entry[field] = value
    print(f"  wrote {entry['name']:14} {len(entry.get('towns') or []):2} towns")

open(PATH, "w").write(json.dumps(doc, ensure_ascii=False, indent=2) + "\n")
print("done")
