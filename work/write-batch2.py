"""Write the Edda, Mgbo, Ezzamgbo, Izzi, Ikwo, Ezza, Okposi, Oshiri and Uburu entries.

The owner's rule for all of it: an Igbo founder, or no founder named at all. Where a
source traces a group to Benin, to Igala country, to the Idoma or to the Ibibio, that
part is not written — the account of where the people came from is left out rather than
repeated with a foreign ancestor attached to it.
"""
import json

PATH = "data/clans/clans.json"
doc = json.load(open(PATH))
by_name = {c["name"]: c for c in doc["clans"]}

V = {}

V["Ada"] = dict(
  name="Edda", slug="edda", aliases=["Ada", "Edda"],
  kind="clan", subgroup="Edda", states=["Ebonyi"], lgas=["Afikpo South"],
  origin_summary=(
    "Edda is an Igbo clan of Ebonyi State, in the local government area that carries its "
    "name: Afikpo South, also called Edda. Its ancestral capital is Nguzu Edda, and its ten "
    "autonomous communities hold some seventy-two villages between them."),
  towns=["Nguzu Edda", "Ekoli Edda", "Ebunwana Edda", "Owutu Edda", "Oso Edda",
         "Amangwu Edda", "Etiti Edda", "Ogbu Edda", "Amasiri Edda", "Okporoenyi Edda"],
  description=[
    "Edda, not Ada: the name the old records print with an a is the anglicised spelling of "
    "Edda, and the clan's own name is Edda. Its people are the Edda, and the land is Edda.",
    "Edda is a hill country. Its towns sit on the high ground of Afikpo South looking over "
    "the Cross River plain, and that ground is why the clan held out as long as it did when "
    "the columns came through in the early years of the last century: the settlements were "
    "on the tops and the approaches were narrow.",
    "Ten communities make the clan — Nguzu Edda at the head, then Ekoli, Ebunwana, Owutu, "
    "Oso, Amangwu, Etiti, Ogbu, Amasiri and Okporoenyi. Each has its own Ezeogo, and the "
    "Ezeogo of Nguzu is recognised as the Eze Edda, the paramount ruler of the whole.",
    "The clan's original speech is gone. The Edda once spoke a language of their own, "
    "closer to the Cross River tongues than to Igbo, and it faded into the Igbo they speak "
    "now, which keeps a strong accent and a vocabulary from the river neighbours. It is "
    "this that makes an Edda man recognisable in a room full of Igbo speakers.",
    "The age grade is the spine of the society. Age mates are grouped by birth year, they "
    "compete to build the schools, roads and markets their town needs, and they pass "
    "through the Ogo together as the rite that makes them adults. An age grade that has "
    "grown old is retired from the work — ikpa unwu — and becomes part of the council of "
    "elders. The year turns at the Ike-ji Edda, the new yam festival.",
  ],
  source=("The owner's own account of the Edda clan (2026-09-28); Wikipedia, \"Edda people\" "
          "and \"Afikpo South\"; Forde & Jones (1950), Table X and notes"),
)

V["Ngbo"] = dict(
  name="Mgbo", slug="mgbo", aliases=["Ngbo", "Mgbolizhia"],
  kind="clan", subgroup="Mgbo", states=["Ebonyi"], lgas=["Ohaukwu"],
  origin_summary=(
    "Mgbo is an Igbo clan of Ohaukwu local government area in Ebonyi State, with ten "
    "traditional communities. Its people speak Mgbolizhia, and the name is written Mgbo — "
    "the n the old records printed in front of it is not part of it."),
  towns=["Ekwashi Mgbo", "Umuogudu Akpu", "Umuogudu Oshia", "Ukwuagba Mgbo",
         "Amoffia Mgbo", "Umuezeaka", "Okposhi Eshi", "Okposhi Eheku", "Umuakpu Mgbo",
         "Amaeku Mgbo"],
  description=[
    "Ekwashi is where the clan begins: the ancestral settlement, the place the traditions "
    "of Mgbo root in. From it the communities branched, and the ten that stand now are "
    "Ekwashi, Umuogudu Akpu, Umuogudu Oshia, Ukwuagba, Amoffia, Umuezeaka, Okposhi Eshi, "
    "Okposhi Eheku, Umuakpu and Amaeku.",
    "The clan was organised around farming and around a society that ran without a single "
    "ruler. Authority sat with the elders of each community, disputes went to them, and "
    "what held the ten together was descent and the obligation to answer when one of them "
    "was attacked. Mgbo's reputation for answering is the thing its neighbours remember.",
    "The people speak Mgbolizhia, and the name of the speech is the name of the people. "
    "The land is farm country — yam, cassava and rice — on the northern side of Ebonyi.",
  ],
  source=("The owner's own account of the Mgbo clan (2026-09-28); Forde & Jones (1950), "
          "Table XIII and notes"),
)

V["Ezza"] = dict(
  kind="clan", subgroup="Ezza", states=["Ebonyi"], lgas=["Ezza North", "Ezza South", "Onicha"],
  origin_summary=(
    "Ezza is one of the three great clans of the north-eastern Igbo, with Izzi and Ikwo, in "
    "Ebonyi State. Its people trace descent from Ezekuna, and its name is written Ezza — "
    "the a doubled at the end, as the clan writes it."),
  towns=["Ezzamgbo", "Ezza Inyimagu", "Ezza North", "Ezza South", "Amuzu", "Ekeimoha"],
  description=[
    "Ezza, Izzi and Ikwo are brothers. The tradition that all three keep is that Ekumenyi "
    "was their grandfather and that Ezekuna, Noyo and Olodo were his sons — Ezekuna the "
    "father of Ezza, Olodo of Izzi and Noyo of Ikwo. Ezza and Izzi argue about whether they "
    "shared a mother as well as a father, and the argument is old and friendly: Izzi says "
    "they are half-brothers, and the marriages between the two clans are the proof either "
    "way.",
    "The clan's founding figure is Ezekuna, and Amuzu near the Ekeimoha market is where the "
    "first settlement is remembered. That market is still the heart of the country.",
    "Ezza is farmland on a large scale — yam, rice and cassava — and its people have spread "
    "beyond their own local government areas into Onicha and beyond, so that Ezza towns are "
    "found across northern Ebonyi.",
  ],
  source=("The owner's own account of Ezza (2026-09-28) and the term paper on the origin of "
          "Abakaliki he supplied; Wikipedia, \"Ezaa people\"; Forde & Jones (1950), Table XIII"),
)

V["Ezzamgbo"] = dict(
  name="Ezzamgbo", slug="ezzamgbo", aliases=["Ezzangbo"],
  kind="clan", subgroup="Ezza", states=["Ebonyi"], lgas=["Ohaukwu"],
  origin_summary=(
    "Ezzamgbo, also written Ezzangbo, is a clan and the headquarters of Ohaukwu local "
    "government area in northern Ebonyi State. Its name is the record of its own making: "
    "Ezza and Mgbo, the two peoples who became one."),
  towns=["Amananta", "Amechi", "Amike", "Amovu", "Ezzamgbo", "Ndi-Akpu", "Ndiagu Ogbodo"],
  description=[
    "The name says what happened. Ezza families came north looking for farmland and "
    "settled among the Mgbo who were already there; the two had old ties, they intermarried, "
    "and the settlement they made together took a name from each — Ezza-Mgbo. It has been "
    "Ezzamgbo since.",
    "The clan is a large one and it is the seat of Ohaukwu: the local government's "
    "headquarters are here, and the market and the roads of the area run through it.",
    "Its people speak Mgbolizhia, the speech of the Mgbo side of the family, which is what "
    "the generations of living together did. The land is good for yam, cassava and rice, "
    "and those are what Ezzamgbo farms.",
    "The communities that make it are Amananta, Amechi, Amike, Amovu, Ezzamgbo itself, "
    "Ndi-Akpu and Ndiagu Ogbodo.",
  ],
  source="The owner's own account of the Ezzamgbo clan (2026-09-28)",
)

V["Izzi"] = dict(
  name="Izzi", slug="izzi", aliases=["Izi", "Iji"],
  kind="clan", subgroup="Izzi", states=["Ebonyi"],
  lgas=["Izzi", "Abakaliki", "Ebonyi"],
  origin_summary=(
    "Izzi is one of the three great clans of the north-eastern Igbo, with Ezza and Ikwo, "
    "in Ebonyi State. Its people live in Izzi, Abakaliki and Ebonyi local government areas, "
    "and Iboko is the administrative headquarters of the Izzi area."),
  towns=["Iboko", "Abakaliki", "Ndiaboishiagu", "Edupkachi", "Igbunu", "Igwekaeyim",
         "Ndioga", "Ohuruekpe", "Okpoduma", "Ndigwe", "Ndinwakpu", "Ndiokpoto", "Ndiubia",
         "Nwaezariyi", "Azuda", "Isiege", "Ndieze", "Ndiezeoke", "Oyege", "Enyigba",
         "Okpitumo", "Nkaleke Achara"],
  description=[
    "Izzi is a clan of hundreds of villages, which is why it is counted by districts "
    "rather than by towns: the Agbaja district, the Igbeagu district that holds Iboko, the "
    "Ezza-Inyimagu district, and the communities of Izzi Unuhu, Amachi, Nkaleke Achara, "
    "Enyigba and Okpitumo among others.",
    "Its people are the indigenous population of Abakaliki itself. The state capital sits "
    "on Izzi land, and the town's oldest quarters are Izzi quarters.",
    "Izzi, Ezza and Ikwo are brothers, and the tradition they share is that Ekumenyi was "
    "their grandfather: Ezekuna fathered Ezza, Olodo fathered Izzi, Noyo fathered Ikwo. "
    "Izzi holds that it is a half-brother to Ezza rather than a full one, and says so when "
    "the question comes up.",
    "The clan speaks the Izzi dialect of Igbo, which is also spoken across the border in "
    "parts of Benue State.",
  ],
  source=("The owner's own account of the Izzi people (2026-09-28); Wikipedia, \"Izzi "
          "people\"; Forde & Jones (1950), Table XIII and notes"),
)

V["Ikwo"] = dict(
  kind="clan", subgroup="Ikwo", states=["Ebonyi"], lgas=["Ikwo", "Ezza South"],
  origin_summary=(
    "Ikwo is one of the three great clans of the north-eastern Igbo, with Ezza and Izzi, in "
    "Ebonyi State. Its people are some six hundred thousand, they speak the Ikwo dialect, "
    "and Noyo is the ancestor they trace."),
  towns=["Ikwo", "Echialike", "Igbudu", "Inyimagu", "Ndufu", "Amanwu"],
  description=[
    "Ikwo, Ezza and Izzi come from one grandfather, Ekumenyi, and Ikwo's own line runs from "
    "Noyo. The clan is the third of the three great groups of the north-eastern Igbo, and "
    "its dialect is one of the three that give the area its speech.",
    "The land is rich, and it has been worked for a very long time. Iron was smelted and "
    "cast in this part of Igboland over a thousand years ago, and the bronzes found at Igbo "
    "Ukwu belong to the same long craft tradition that made this country one of the early "
    "metal-working centres of West Africa.",
    "Farming is what Ikwo does now — rice, yam and cassava — and the clan has produced "
    "governors, deputy governors, ambassadors and senators for the state and the country.",
  ],
  source=("Wikipedia, \"Ikwo people\"; the owner's direction to write the clan from it "
          "(2026-09-28); Forde & Jones (1950), Table XIII and notes"),
)

V["Okposi"] = dict(
  kind="town", parent="Oshiri", subgroup="Oshiri", states=["Ebonyi"], lgas=["Ohaozara"],
  origin_summary=(
    "Okposi is a town of Ebonyi State in Ohaozara, and one of the two salt towns of the "
    "eastern Igbo. Enechi Akuma founded it, and its eight broad divisions — Okposi ezi "
    "nasato — are still how the town counts itself."),
  towns=["Avu", "Amechi", "Okposi Okwu", "Uhuaba", "Umudomi", "Nduruku", "Enuagu", "Agbabor"],
  description=[
    "Enechi Akuma is the founder, and the town began at Egu Okpuhu Ukpo before moving to "
    "Avu, where he lived and died. The eight broad divisions of Okposi were founded by his "
    "sons, and they are what Okposi ezi nasato — the eight houses of Okposi — means. Smaller "
    "villages merge into them, and a man's standing in the town is reckoned through which "
    "one he belongs to.",
    "The salt is the town's other name. Two hunters, Ekuma Chita and Uta Ano, found the "
    "lakes, and from then the women of Okposi made salt and the men farmed yam, which is "
    "the division of labour the town kept for generations. The brine here is the saltiest in "
    "the south-east, and the salt scarcity after the war made every family in Okposi "
    "comfortable. Okposi and Uburu are the two salt towns of the eastern Igbo, and their "
    "rivalry is as old as the trade.",
    "The town had no king. Government was the mass meeting: Okwu-Okposi, held at the Eke "
    "Okposi market before the shrine of Ani-oha, where the eight flat stones laid for the "
    "eight divisions stand in order of seniority and every adult man could speak. Above the "
    "villages sat the Oviri-Uke, the council of elders, and below them the Uke-Ogonogo, the "
    "selected middle-aged men who enforced what the meeting decided. The district officer "
    "who saw it working called Okposi a republic in the true sense of the word.",
    "The last month of the year, Onwa Aju, belongs to the ancestors: every man whose parents "
    "have died slaughters at least a goat, and the priest who keeps the rite brings back the "
    "year's programme from the meeting he attends with them. The title that matters most "
    "here is earned by yam: Ikwa Odju, which makes a man an Onyiba, and it was expensive "
    "long before the currency changed.",
  ],
  source=("The owner's own account of Okposi (2026-09-28) and the history by Okike Obaji he "
          "supplied; Forde & Jones (1950), Table XIII and notes"),
)

V["Oshiri"] = dict(
  kind="town", states=["Ebonyi"], lgas=["Onicha"], subgroup="Oshiri",
  origin_summary=(
    "Oshiri is an ancient Igbo town of Onicha local government area in Ebonyi State, "
    "founded by Ezekpechu, who is also called Ugo-Eze. Its name is a memory of the river "
    "its founder crossed: Oshimiri, a big river."),
  towns=["Umuorie", "Umuimam", "Agbabi", "Amaokpara", "Ebia", "Uvu"],
  description=[
    "Ezekpechu, called Ugo-Eze, came from Ekpelu in the Ikwo country and settled the land "
    "that became Oshiri. On the way he crossed the Ebonyi with his half-brother Onyikwa "
    "Igbo-Eze, and the crossing stayed with him — he named the place after the water, "
    "Oshimiri, and the name became Oshiri.",
    "The town divides in two: Ebia and Uvu. Sixteen villages sit inside those halves, among "
    "them Umuorie, Umuimam, Agbabi and Amaokpara, and the two halves answer to each other "
    "in the way that close neighbours do.",
    "Oshiri is bounded by Ezza and Agba-Ebo to the north and east, and by Onicha and "
    "Ugwulangwu to the west and south. The Ebonyi runs along one side of it, which is why "
    "fishing and mat-making grew up beside the farming — along with palm wine, and yam in "
    "the barns.",
    "The year ends with the Aji festival in November: the traditional new year, kept for "
    "the ancestors, and the point from which the town counts the next one.",
  ],
  source=("The owner's own account of Oshiri (2026-09-28); Forde & Jones (1950), Table XIII "
          "and notes"),
)

V["Uburu"] = dict(
  name="Uburu", slug="uburu-afikpo", kind="town", subgroup="Oshiri",
  states=["Ebonyi"], lgas=["Ohaozara"], parent=None,
  origin_summary=(
    "Uburu is a town of Ohaozara in Ebonyi State, and with Okposi one of the two salt towns "
    "of the eastern Igbo. Adu founded it, and the name comes from what he called the place "
    "when he saw what it held: Ebe Uru, the place of prosperity."),
  towns=["Umunaga", "Umuchima", "Ogwu", "Umuobuna", "Amenu", "Umuodoigbo", "Umuanum",
         "Umuneketa", "Amegu", "Mgbom", "Umuegwuoke", "Uhuabaa", "Urobo", "Ihenu"],
  description=[
    "Adu was a hunter, and it was while hunting that he found the water that would not "
    "quench a thirst because of the salt in it. He had come with his elder brother Ezentum "
    "from Isuikwuato country, and where the two of them settled divided: Ezentum stayed at "
    "the place now called Isu in Onicha, and Adu came on to the land that became Uburu. The "
    "name he gave it was Ebe Uru, and Uburu is that name worn down.",
    "Fourteen sons by his two wives founded the town, and each village is one of them: "
    "Umunaga, Umuchima, Ogwu, Umuobuna, Amenu, Umuodoigbo, Umuanum, Umuneketa, Amegu, "
    "Mgbom, Umuegwuoke, Uhuabaa, Urobo and Ihenu. The Esu river cuts the town in two, one "
    "side for living and the other for the farms.",
    "Salt made Uburu. The lakes gave the town a trade that reached far past its own "
    "borders, and the market that grew on it drew traders south and north, which is how the "
    "town came to be one of the busiest places in this part of Ebonyi before the roads "
    "arrived.",
    "The Uburu market is also part of the harder history of the south-east: when the trade "
    "at Okposi's Odenigbo market broke up, the traders who fled set up where they stopped, "
    "and the market that became famous for the trade in people grew there. It is part of "
    "the record and it is written down as such.",
  ],
  source=("The owner's own account of Uburu (2026-09-28) and the history he supplied; "
          "Forde & Jones (1950), Table XIII and notes"),
)

# Uburu under Nsukka keeps its own name and slug; the northern one is a different place.
for name, spec in V.items():
    target = None
    # Two entries share the name Uburu; the one being written here is the Ebonyi town.
    candidates = [c for c in doc["clans"] if c["name"] == name]
    for c in candidates:
        if name != "Uburu" or (c.get("tribe") == "Northeast Igbo"):
            target = c
            break
    if target is None:
        print(f"  ! {name} not found — adding it")
        doc["clans"].append({**{"kind": "clan", "ethnicGroup": "Igbo", "towns": []}, **spec})
        continue
    for field, value in spec.items():
        target[field] = value
    if name == "Uburu":
        target["states"] = ["Ebonyi"]
    print(f"  wrote {target['name']:12} {len(target.get('towns') or []):3} towns")

open(PATH, "w").write(json.dumps(doc, ensure_ascii=False, indent=2) + "\n")
print("\ndone.")
