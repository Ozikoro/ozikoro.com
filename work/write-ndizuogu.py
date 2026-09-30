"""Ndizuogu, from the owner's own article on Arondizuogu."""
import json

PATH = "data/clans/clans.json"
doc = json.load(open(PATH))

ENTRY = {
  "name": "Ndizuogu",
  "slug": "ndizuogu",
  "kind": "clan",
  "ethnicGroup": "Igbo",
  "tribe": "Cross River Igbo",
  "subgroup": "Aro",
  "parent": "Aro",
  "region": "Imo",
  "states": ["Imo"],
  "lgas": ["Ideato North", "Okigwe", "Onuimo"],
  "aliases": ["Arondizuogu", "Ndi Izuogu", "Izuogu na Iheme", "Aro-Ndizuogu", "Izuogu"],
  "origin_summary": (
    "Ndizuogu — Arondizuogu, Ndi Izuogu, Izuogu na Iheme — is the largest of the Aro "
    "settlements outside Arochukwu, made in the eighteenth century by the merchant Izuogu "
    "Mgbokpo and his associate Iheme. Its villages are spread across Ideato North, Okigwe and "
    "Onuimo in Imo State, and its two divisions are still Ndi Izuogu and Ndi Iheme."),
  "towns": ["Awa", "Uche", "Njoku", "Imoko", "Amazu", "Ejezie", "Adimoha", "Anyake",
            "Uwaonu", "Ucheagwu", "Ndubisi", "Ekwulu", "Aro-Umuduru", "Aro-Amuro",
            "Aniche", "Onuoha", "Eze", "Okonkwo", "Ogbuonyeoma", "Akaeme", "Ukwu",
            "Akunwanta"],
  "description": [
    "Ndizuogu did not begin as a town that grew old. It began as a merchant's settlement, and "
    "it was made in the eighteenth century by Izuogu Mgbokpo, an Aro from Arochukwu who "
    "travelled the country toward Awka looking for trade and for captives. He came to "
    "Umualaoma, was received and sheltered there by a local associate, and then turned on the "
    "community that had taken him in: the tradition is a violent one, and it holds that his "
    "followers took the land by force, killed, and displaced or absorbed the people who were "
    "already on it. Whatever came after, that is how the settlement started.",
    "He did not do it alone, and the clan is named for the two traditions rather than one. "
    "With Izuogu were his sons Uche and Awa, his brothers Imoko and Njoku, and Iheme — his "
    "principal servant and his ally, said to have come from Isi-Akpu Nise near Awka. The "
    "community that grew from them is Izuogu na Iheme, and the name Arondizuogu is the Aro "
    "who belong to Izuogu.",
    "The two divisions are the frame the clan still understands itself by. Ndi Izuogu trace to "
    "Izuogu, his family and the first settlements around them — Awa, Uche, Njoku, Imoko, "
    "Amazu, Ejezie, Adimoha, Anyake, Uwaonu, Ucheagwu, Ndubisi and Ekwulu, with Awa-Izuogu, "
    "Ndiuche and Ejezie-Izuogu among the autonomous communities. Ndi Iheme trace to Iheme: "
    "Aniche, Onuoha, Eze, Okonkwo, Ogbuonyeoma, Akaeme, Ukwu and Akunwanta. They were never "
    "two separate peoples — they grew inside one political and economic system, and the pair "
    "of names is how that system is described.",
    "What made Ndizuogu big was trade. It sat inside the Aro network that joined Arochukwu to "
    "markets across the south-east, and its merchants ran long distances with agricultural "
    "produce, manufactured goods and enslaved people. The wealth that came back built the "
    "merchant families, the fighting men and the institutions that gave the settlement its "
    "weight — and it rested on the capture, movement and sale of human beings, whose suffering "
    "the record of the settlement's growth should not be read past.",
    "Its expansion was contested, and not only by force. Prolonged fighting with neighbouring "
    "communities was brought to an end, in the tradition, by Ezerioha Udensi of Obiokwara, "
    "Obinihu, Umualaoma, a patriarch of the host community, who worked out a peaceful "
    "allocation of land to the growing population of Ndizuogu — an arrangement that accepted "
    "what had happened and settled what would follow. So the territory was consolidated by "
    "negotiation and accommodation as well as by conquest.",
    "The next phase belongs to Okoro Idozuka, born Okoli Idozuka, who came from Isi-Akpu Nise "
    "in the nineteenth century when Ndizuogu was already a centre of Aro commerce. He was a "
    "warrior, a merchant and a political leader at once, and he extended the land under the "
    "settlement's influence further than it had gone. His son Nwankwo Okoro went into the "
    "trade young, and after the British arrived he was among the local leaders taken into the "
    "colonial system as a warrant chief — the point at which a house built on kinship, wealth "
    "and war began to deal with an administration instead.",
    "Colonial rule changed what the clan was. Authority that had been exercised through "
    "lineage, trade and fighting was rerouted through warrant chiefs and native courts, and "
    "the older Aro commercial and military system declined, especially after the campaigns "
    "against Arochukwu in the early twentieth century.",
    "One thing about Ndizuogu is easy to miss: it is not a town. It is a spread of villages "
    "across Ideato North, Okigwe and Onuimo, each keeping its own identity and all of them "
    "keeping the wider one. Its people came from the descendants of Izuogu and Iheme, from "
    "other Igbo communities, from neighbouring populations brought in by war and marriage, and "
    "from the movement of trade — and some traditions hold that people taken as captives and "
    "brought into the community took the Izuogu name as their own. Izuogu na Iheme is still "
    "how the clan says itself.",
  ],
  "source": ("The owner's own account, \"The History and Origins of Arondizuogu\" at ozikoro.com "
             "(2026-09-29); Nwokeji (2010) on the Aro settlements"),
}

target = next((c for c in doc["clans"] if c["name"] == "Ndizuogu"), None)
if target is None:
    doc["clans"].append(ENTRY)
    print("  added Ndizuogu")
else:
    target.update(ENTRY)
    print("  rewrote Ndizuogu")

open(PATH, "w").write(json.dumps(doc, ensure_ascii=False, indent=2) + "\n")
print("towns:", len(ENTRY["towns"]))
