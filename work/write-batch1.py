"""Write the Aro family and the Afikpo group from the sources the owner named.

Everything here is a rewrite rather than an edit, because the entries being replaced share
the fault the owner pointed at: they talk about the source and the table instead of about
the people. "The table carries no note for it and names no village belonging to it" is a
sentence about a book. A reader wants to know about Okpoha.

So each entry below says what the group is, where it is, what is inside it and what is
known of its history — and where something is not known, it says so in one short clause
rather than in a paragraph about the absence of evidence.
"""
import json

PATH = "data/clans/clans.json"
doc = json.load(open(PATH))
by_name = {c["name"]: c for c in doc["clans"]}

print("entries to be written:", [n for n in [
    "Afikpo", "Arochuku", "Arondizuogu", "Abam", "Ohafia", "Nkporo", "Abiriba", "Ututu",
    "Ihe", "Okpoha", "Unwana", "Akaeze", "Amaseri",
] if n in by_name])


# ---------------------------------------------------------------------------
# The entries themselves.
# ---------------------------------------------------------------------------
V = {}

V["Afikpo"] = dict(
  kind="clan",
  subgroup="Afikpo",
  states=["Ebonyi"],
  lgas=["Afikpo North", "Afikpo South"],
  origin_summary=(
    "Afikpo is the Ehugbo clan of Ebonyi State: the town and the country around it in "
    "Afikpo North, on the west bank of the Cross River. Its people speak Ehugbo, a form of "
    "Igbo of their own, and their new year falls at the end of August with the new yam."),
  towns=["Ehugbo", "Itim Ukwu", "Ohaisu", "Nkpoghoro", "Ugwuegu", "Ozizza", "Ibii",
         "Akpoha", "Unwana", "Amasiri", "Okpoha", "Enohia", "Ndibe"],
  description=[
    "Afikpo is one of the oldest continuously inhabited places in Igboland. Its people "
    "kept the ancient hamlet culture of the Egu — the fortified household clusters that "
    "were already old when Nri was rising — and the masks that go with it survive in the "
    "state's collection. An Afikpo man's adulthood is marked by initiation into the Ogo, "
    "which women are never shown.",
    "The clan is a set of towns that each run their own affairs: Ehugbo itself, which is "
    "the head, and with it Itim Ukwu, Ohaisu, Nkpoghoro, Ugwuegu and Ozizza. Unwana, "
    "Amasiri, Ibii and Akpoha stand with them, and Okpoha is a village of the group rather "
    "than a clan in its own right.",
    "Unwana is the largest of the towns after Ehugbo. It sits on a hill above the Cross "
    "River with Edda to its west, and it is where Akanu Ibiam, the first governor of "
    "Eastern Nigeria, was born — the federal polytechnic there carries his name.",
    "Farming is the base of it: yam, cassava and rice, sold at the Eke and Nkwo markets. "
    "The trade is old enough that Afikpo's pots and its raffia work travelled before the "
    "roads did.",
  ],
  source=("Wikipedia, \"Afikpo North\" and \"Unwana\"; the owner's own account of Okpoha, "
          "Unwana and Amaseri as towns of Afikpo rather than clans (2026-09-28); "
          "Forde & Jones (1950), pp. 52-53, Table X and note 1; Afigbo (1981), pp. 14, 301"),
)

V["Arochuku"] = dict(
  name="Arochukwu",
  slug="arochukwu",
  aliases=["Arochuku", "Aro"],
  kind="clan",
  subgroup="Aro",
  states=["Abia"],
  lgas=["Arochukwu"],
  origin_summary=(
    "Arochukwu is the head clan of the Aro, in Arochukwu local government area of Abia "
    "State. Its nineteen towns are what the Aro tribe's name grew from, and its oracle, "
    "the Long Juju of Chukwu Abiama, is what made the Aro a power across the south-east "
    "for two centuries."),
  description=[
    "Arochukwu is a clan before it is a town. Its nineteen settlements each descend from "
    "one of nine patrilineages called otusi, seated in nine parent towns, and each of "
    "those had a headman of its own lineage over it. The other ten settlements were "
    "founded later from the first nine.",
    "The clan's power came from the oracle of Chukwu Abiama, called the Long Juju, whose "
    "priests settled disputes from across the South-eastern Provinces. Traffic in that "
    "authority made Aro traders, moneylenders and agents of the oracle's influence present "
    "in towns far from Arochukwu — which is why Aro settlements are found in some 250 "
    "places across the south-east and beyond.",
    "The town is Igbo. Its founding is remembered in the union of Eze Agwu, who came from "
    "Abiriba, with Nnachi, who came from Edda, and with the Akpa who came from the east of "
    "the Cross River; the Aro-Ibibio wars that followed are the ground the kingdom stands "
    "on. The name is written Arochukwu, and the old form Arochuku is the survey's "
    "spelling of it.",
  ],
  source=("Wikipedia, \"Aro people\" and \"Aro Confederacy\"; the owner's correction of "
          "the name and of the tribe-and-clan relationship (2026-09-28); "
          "Forde & Jones (1950), pp. 55-56, Table XII"),
)

V["Arondizuogu"] = dict(
  name="Ndizuogu",
  slug="ndizuogu",
  aliases=["Arondizuogu", "Aro-Ndizuogu"],
  kind="clan",
  subgroup="Aro",
  states=["Imo"],
  lgas=["Okigwe", "Ideato North", "Onuimo"],
  origin_summary=(
    "Ndizuogu is an Aro clan of Imo State whose settlements fall in Okigwe, Ideato North "
    "and Onuimo. It grew from Arochukwu, and it is the largest of the Aro settlements "
    "outside Arochukwu itself."),
  towns=["Ndizuogu", "Ndi-Okporo", "Ndi-Umuokoro", "Ndi-Ogbu", "Ndi-Aku"],
  description=[
    "Ndizuogu began as an Aro trading settlement on the Orlu and Okigwi boundary: the "
    "Aro who came out from Arochukwu in the nineteenth century to work the trade routes "
    "west of the Cross River stayed, and their families became a clan of their own.",
    "The name is written Ndizuogu. The form Arondizuogu, which the survey and the "
    "administrative records used, is the same name with the Aro prefix run into it.",
    "Its people remain Aro: the descent from Arochukwu is remembered, the ties to the "
    "parent clan are kept, and the clan is counted among the Aro in Imo State rather than "
    "as a group of the surrounding Igbo.",
  ],
  source=("Wikipedia, \"Arondizuogu\" and \"Aro people\"; the owner's correction that "
          "Ndizuogu is an Aro clan (2026-09-28); Afigbo (1981), printed p. 272"),
)

V["Abam"] = dict(
  kind="clan",
  subgroup="Abam",
  states=["Abia"],
  lgas=["Arochukwu"],
  origin_summary=(
    "Abam is an Igbo clan of Arochukwu local government area in Abia State, and the "
    "largest in that area by land and by population. Its progenitor is remembered as "
    "Onyerubi Atita, which is why its people are also called Abam Onyerubi."),
  towns=["Abam", "Ndi Oji Abam", "Ndi Agwu", "Ndi Ebe Abam", "Amaeke Abam", "Amuru Abam"],
  description=[
    "Abam and Ohafia are brother clans: one ancestry, one dialect, one warrior tradition. "
    "The men were fighters by trade as much as farmers — Abam companies were hired for "
    "war and for police duties across Igboland and beyond, and it was Abam who first "
    "danced the ikpirikpi ogu, the war dance Ohafia and Abiriba later made their own.",
    "The clan was one of the warrior powers of the Cross River country. With Ohafia, "
    "Abiriba, Edda, Alayi, Igbere and Ututu it formed the military bloc that the Aro drew "
    "on for their expeditions, and one reading of the history is that without those clans "
    "there would have been no Aro confederacy at all.",
    "None of that is the whole of Abam. Its land is among the most fertile in Abia — "
    "oil palm, rubber, rice, cassava and cocoa — and its people farm it and trade it. "
    "Abam's sons and daughters have settled far from home, and the towns that trace "
    "descent from Abam are found across Ikwuano, Bende and beyond.",
  ],
  source=("Wikipedia, \"Abam\"; the owner's direction to write the clan from it (2026-09-28)"),
)

V["Ohafia"] = dict(
  kind="clan",
  subgroup="Abam",
  states=["Abia"],
  lgas=["Ohafia"],
  origin_summary=(
    "Ohafia is an Igbo clan of Abia State whose ancestral village is Elu-OHAFIA, the "
    "central settlement of the town, and whose twenty-six villages make it one of the "
    "largest clans in the old Bende country."),
  towns=["Elu", "Ibina", "Nde Okala", "Nde Anyaorie", "Amuma", "Amaekpu", "Ebem",
         "Nde Amogu", "Okagwe", "Nde Uduma Ukwu", "Oboro", "Nde Nku", "Nkwebi", "Amuke",
         "Asaga", "Ndi Uduma Awoke", "Amankwu", "Nde Ibe", "Nde Orieke", "Okon-Aku",
         "Amangwu", "Ufiele", "Eziafor", "Abia", "Akanu", "Isiugwu"],
  description=[
    "Ohafia's people were warriors, and they have never stopped saying so. The knitted "
    "leopard cap, okpu agu, is theirs; iri agha, the dance that retells a warrior's "
    "killing, is theirs; and the memory of the mercenary companies that fought for "
    "whichever town paid them is still the centre of how the clan describes itself.",
    "Twenty-six villages make the clan, and Elu is the ancestral one — the first "
    "settlement, and the seat from which the rest are reckoned. Ebem holds the "
    "administration of the local government area today, and the Nigerian Army's 14 "
    "Brigade is based in the town.",
    "The country is farmland: yam, cassava, melon and vegetables, with trade at the "
    "Amavo market, and blacksmithing and wood carving alongside it. The clan sits about "
    "fifty kilometres from Umuahia.",
  ],
  source=("Wikipedia, \"Ohafia\"; the owner's direction to write the clan from it "
          "(2026-09-28); Forde & Jones (1950), Table XI and notes"),
)

V["Nkporo"] = dict(
  kind="clan",
  subgroup="Abam",
  states=["Abia"],
  lgas=["Ohafia"],
  origin_summary=(
    "Nkporo, the Okwe ancient kingdom, is a clan of Ohafia local government area in Abia "
    "State whose eight villages are grouped into three divisions. Its king is called the "
    "Eze-Aja, and the name Nkporo is what an Ibibio king called its people."),
  towns=["Agbaja", "Amurie", "Elughu", "Etitiama", "Ndi-Nko", "Obofia", "Okwoko", "Ukwa"],
  description=[
    "The name came from the Ibibio word for buffalo. Aja, the young leader who brought "
    "the people out of Ama Mpoto in the Ibibio country, fought the Ibibio king Afachima "
    "Achi so hard that the king warned Arochukwu to stay at peace with him, calling Aja's "
    "people nkporo — buffalo. The name stayed, and every king of Nkporo is the Eze-Aja.",
    "The journey to the present home took centuries: from Ama Mpoto to Okpukpu-Iyi Aro "
    "near Amuvi, then to Ugwu Iyi Ekirika by Nde Okpo, then to Ugwu Isiagha between "
    "Ihechiowa and Nde Uduma Awoke, and at last to Udara Ebuo and the land they hold now.",
    "Eight villages make the clan, in three divisions. Ndi Elu is Etitiama and Amurie; "
    "Ndi Etiti is Elughu, Obofia and Ndi-Nko; Ndi Agbo is Agbaja, Okwoko and Ukwa.",
    "Nkporo is the oldest of the Cross River Igbo settlements in the reading of the "
    "anthropologists who grouped them, and it borders Abiriba to the south, Item to the "
    "west, Akaeze and Oso-Edda to the north, Edda to the east and Ohafia to the "
    "south-east.",
  ],
  source=("Wikipedia, \"Nkporo\"; the owner's direction to write the clan from it "
          "(2026-09-28)"),
)

V["Abiriba"] = dict(
  kind="clan",
  subgroup="Abam",
  states=["Abia"],
  lgas=["Ohafia"],
  origin_summary=(
    "Abiriba is the Enuda kingdom of Ohafia local government area in Abia State: three "
    "villages — Ameke, Amogudu and Agboji — under one crown, the Enachioken, held by "
    "Ameke as first among equals."),
  towns=["Ameke", "Amogudu", "Agboji"],
  description=[
    "Abiriba's people came from the Cross River basin and share ancestry with Arochukwu. "
    "Disputes between the seven families under Ukpaghiri drove them out; they moved to "
    "Ena, then to Akpa, then to Usukpam, and were never left in peace until they reached "
    "the land they hold now, part of which they took from Nkporo at Oriakwa.",
    "The clan was known across Igboland for iron. Abiriba smiths smelted and forged for "
    "the whole region, and the craft is still part of how the town describes itself.",
    "The three villages each have an Eze, and the three together are the "
    "Enachioken-in-council. Succession is hereditary within three royal compounds.",
    "At the centre of the town is the Okpu Achi, an ancient achi tree that the kingdom "
    "treats as its own life: the tradition is that if it falls, water from it will cover "
    "Abiriba. Itu Eye, the festival in which the Enachioken enacts the year's new laws and "
    "hands them to an age grade to enforce, is more than six hundred years old.",
  ],
  source=("Wikipedia, \"Abiriba\"; the owner's direction to write the clan from it "
          "(2026-09-28)"),
)

V["Ututu"] = dict(
  kind="clan",
  subgroup="Abam",
  states=["Abia"],
  lgas=["Arochukwu"],
  origin_summary=(
    "Ututu is an Igbo clan of Arochukwu local government area in Abia State, named for "
    "Mazi Otutu Ezema, who led the first settlers to Amaeke. Its nineteen villages are "
    "grouped in four zones, and it is a confederacy rather than a single descent group."),
  towns=["Abuma", "Amaebem", "Amaeke", "Amakofia", "Amankwu", "Amasa", "Amatiti", "Amodu",
         "Eziama", "Nkpakpi", "Obiagwulu", "Obiakang", "Obiene", "Obijoma", "Obiluoko",
         "Ohomja", "Ubila", "Ugwuogo", "Ukwuakwu"],
  description=[
    "Ututu takes its name from its founder. Mazi Otutu Ezema brought the first settlers "
    "to Amaeke-Ututu, and the migration is remembered as happening in the same period as "
    "those of Ohafia and Abam — the same wave of movement that carried the Cross River "
    "Igbo into their present country.",
    "The clan is a confederacy, not one lineage: the early families descended from Cheke "
    "Ukwu at Abuma Ututu, the Akpa who came as mercenaries from the east of the Cross "
    "River, and neighbours like the Ukwa who had come up from Ibibio country. They hold "
    "together as Ututu and keep their own villages.",
    "Nineteen villages make it, in four zones: Abuma, Amaebem, Amaeke, Amakofia, "
    "Amankwu, Amasa, Amatiti, Amodu, Eziama, Nkpakpi, Obiagwulu, Obiakang, Obiene, "
    "Obijoma, Obiluoko, Ohomja, Ubila, Ugwuogo and Ukwuakwu. Amaeke is the ancestral one.",
    "Ututu shares boundaries with Ihechiowa and with Arochukwu, and the ties that matter "
    "most to it are with those neighbours and with the Cross River country behind them.",
    "The old religion is still visible in the clan: the shrine of Obasi Ututu and the "
    "offor that goes with it, and the Izu Ututu festival, a thanksgiving to Obasi Ututu at "
    "the end of the yam-planting year. Village affairs are settled by compound elders at "
    "the nkuma etiti ogo, the village hearthstones; the affairs of the whole clan belong "
    "to the Eze Ututu and his council of seven, the Akpa Asaa.",
  ],
  source=("The owner's own account of the Ututu clan (2026-09-28); Forde & Jones (1950), "
          "Table XI and notes"),
)

V["Ihe"] = dict(
  name="Ihechiowa",
  slug="ihechiowa",
  aliases=["Ihe", "Ihe Clan"],
  kind="clan",
  subgroup="Abam",
  states=["Abia"],
  lgas=["Arochukwu"],
  origin_summary=(
    "Ihechiowa is an Igbo clan of Arochukwu local government area in Abia State, named "
    "for its founding ancestor Chiowa. Its seventeen villages sit on the fertile land "
    "between the Uduma and Iyi Ocha rivers, and its rulers meet at Agbor village."),
  towns=["Agbor", "Amaeke", "Amangwu", "Amankwu", "Aro", "Atan", "Elu", "Etiti", "Ihe",
         "Nde Okpo", "Obinto", "Obuohu", "Ohomja", "Okpo", "Umuahia", "Umuokoro", "Uzo"],
  description=[
    "The clan's full name is Ihechiowa, and it honours Chiowa, the ancestor it is named "
    "for: the name is read as the light of Chiowa, or Chiowa's own covenant land. The "
    "old intelligence reports and legal papers of the early twentieth century shortened "
    "it to the Ihe clan, and neighbours — Abam, Ututu, Aro — still say Ihe for short.",
    "The ancestors came with the Igbo migrations across the Niger, and before they "
    "settled here they stayed at Uturu, at Ibeku and at Ihenta, which is now part of "
    "Ohafia. That shared road is why Ihechiowa, Ohafia, Abam and Ututu keep the same "
    "speech and the same stories.",
    "Seventeen villages make the clan, and each is autonomous within its own bounds under "
    "its own Eze Ogo. The seventeen Eze Ogo together are the cabinet of Ihechiowa, and "
    "they sit at Agbor village for land cases, disputes and the keeping of the peace.",
    "Inheritance here runs both ways at once: property and standing pass through the "
    "father's line and through the mother's, the ikwu, and the maternal line is honoured "
    "in a way that neighbouring clans find remarkable. Politically the villages divide "
    "into two halves, Ikwun and Eleoha.",
    "The clan was a fighting one in the years of the Aro confederacy, and it is a farming "
    "one now: yam above all, with cassava, cocoa and oil palm on the same land. The year "
    "ends with the new yam festival, and the dances that go with it — Akang, Ovuwa and "
    "the others — are still danced.",
  ],
  source=("The owner's own account of the Ihechiowa clan (2026-09-28); Forde & Jones "
          "(1950), Table XI and notes"),
)

# Okpoha is a village of Afikpo, not a clan of its own.
okpoha = by_name.get("Okpoha")
if okpoha:
    okpoha["kind"] = "town"
    okpoha["parent"] = "Afikpo"
    okpoha["subgroup"] = "Afikpo"
    okpoha["states"] = ["Ebonyi"]
    okpoha["lgas"] = ["Afikpo North"]
    okpoha["origin_summary"] = (
        "Okpoha is a village of the Afikpo clan in Afikpo North, Ebonyi State — one of the "
        "settlements that make up Ehugbo rather than a clan in its own right.")
    okpoha["description"] = [
        "Okpoha stands with the other villages of Afikpo and is governed with them. It has "
        "no separate origin tradition: it is part of Ehugbo, and its people are Afikpo.",
    ]
    okpoha["source"] = ("The owner's correction that Okpoha is a village of Afikpo rather "
                        "than a clan (2026-09-28); a gazetteer entry placing it in Afikpo "
                        "North, Ebonyi State")

unwana = by_name.get("Unwana")
if unwana:
    unwana["kind"] = "town"
    unwana["parent"] = "Afikpo"
    unwana["subgroup"] = "Afikpo"
    unwana["states"] = ["Ebonyi"]
    unwana["lgas"] = ["Afikpo North"]
    unwana["origin_summary"] = (
        "Unwana, also written Unwara, is a town of the Afikpo clan in Ebonyi State: the "
        "largest of the settlements after Ehugbo, on a hill above the Cross River, with "
        "Edda to its west and Cross River State to its east.")
    unwana["description"] = [
        "Unwana is part of the Afikpo country and shares the Ehugbo culture of the group. "
        "It is bordered by Afikpo to the north, Edda to the west and Cross River State to "
        "the east, and the Akanu Ibiam Federal Polytechnic is there.",
        "Its best-known son is Akanu Ibiam, Ezeogo and first governor of Eastern Nigeria, "
        "whose name the polytechnic carries.",
    ]
    unwana["source"] = ("Wikipedia, \"Unwana\"; the owner's direction that Unwana belongs "
                        "to the Afikpo group (2026-09-28)")

for name, spec in V.items():
    entry = by_name.get(name)
    if entry is None:
        print(f"  ! {name} is not in the file — skipped")
        continue
    for field, value in spec.items():
        entry[field] = value
    # A rename means the slug has to follow, or the old page keeps serving the old name.
    if "name" in spec and spec["name"] != name:
        entry["slug"] = spec.get("slug")
    print(f"  wrote {entry['name']:12} {len(entry.get('towns') or []):3} towns")

open(PATH, "w").write(json.dumps(doc, ensure_ascii=False, indent=2) + "\n")
print("\nwritten.")
