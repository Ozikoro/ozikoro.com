"""Every clan and town that carried a non-Igbo origin, for the owner to correct."""
import json, re, datetime

before = json.load(open("/tmp/clans-before-origins.json"))
after = json.load(open("data/clans/clans.json"))
now = {c["name"]: c for c in after["clans"]}

NON_IGBO = r"(?:Benin|Bini|Igala|Idoma|Jukun|Efik|Ibibio|Edo)"
CLAIM = re.compile(
  rf"\b(?:founder|founders|founded|origin|origins|descent|ancestry|ancestor|ancestors|"
  rf"migrated|came|come|hail|trace[sd]?|settlers?|arrivals?)\b[^.]*\b{NON_IGBO}\b"
  rf"|\b{NON_IGBO}\b[^.]*\b(?:origin|descent|ancestor|founded|founder|blood|mixture|strain|element)\b",
  re.I)

rows = []
for c in before["clans"]:
    text = " ".join(c.get("description") or []) + " " + str(c.get("origin_summary") or "")
    hits = [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if CLAIM.search(s)]
    if hits:
        rows.append({"name": c["name"], "division": c.get("tribe"), "slug": c.get("slug"),
                     "kind": c.get("kind"), "was": hits})

order = ["Western Igbo", "Riverine Igbo", "Northern Igbo", "Southern Igbo", "Cross River Igbo"]
rows.sort(key=lambda r: (order.index(r["division"]) if r["division"] in order else 99, r["name"]))

# The owner: "there's no need to list towns i already gave you proper content to write
# about their origin and information." These are the entries he has since supplied the
# account for, and they are written from his own articles — so they are not open questions
# and do not belong on a list of open questions.
SETTLED = {
    "Agbor", "Idumuje", "Abavo", "Anam", "Onitsha Town", "Aboh", "Ossissa", "Umuakasiada",
    "Emu", "Okposi", "Oshiri", "Uburu", "Ezechima", "Ibusa", "Afor", "Ada", "Onicha",
    "Arochuku", "Arondizuogu", "Abam", "Ohafia", "Nkporo", "Abiriba", "Ututu", "Ihe",
    "Okpoha", "Unwana", "Akaeze", "Ngbo", "Izi", "Ezzamgbo", "Izzi", "Ikwo", "Ezza",
}
rows = [r for r in rows if r["name"] not in SETTLED]

out = []
w = out.append
w("# Clans and towns that carried a non-Igbo origin")
w("")
w(f"{len(rows)} entries. Generated {datetime.date.today().isoformat()}.")
w("")
w("Every one of these said, in the entry, that its founder or its people came from Benin, or")
w("from Igala country, or that its population was part Igala or part Edo. All of it is now")
w("out of the registry — nothing on ozituma.com claims an origin for an Igbo clan, tribe or")
w("town except an Igbo one.")
w("")
w("**What I need from you is the correct account for each.** Where you send one it goes in as")
w("you send it. Where you do not, the origin stays unstated — which is the honest state, but")
w("it is not as good as the truth.")
w("")
w("Read each block like this: *what it used to say* / *what it says now* / *the towns it has*.")
w("Write your correction under any of them, or just send me the names and I will do the rest.")
w("")
w("---")
w("")
for division in order:
    group = [r for r in rows if r["division"] == division]
    if not group:
        continue
    w(f"## {division} ({len(group)})")
    w("")
    for r in group:
        entry = now.get(r["name"], {})
        slug = entry.get("slug") or r.get("slug") or r["name"].lower().replace(" ", "-")
        towns = entry.get("towns") or []
        where = ", ".join((entry.get("states") or []) + (entry.get("lgas") or [])) or "not established"
        w(f"### {r['name']}")
        w(f"https://ozituma.com/clans/{slug} — {r.get('kind') or 'entry'} · {where}")
        w("")
        w("**What it used to say**")
        for s in r["was"]:
            w(f"- {s}")
        w("")
        w("**What it says now**")
        summary = entry.get("origin_summary")
        if summary:
            w(f"- {summary}")
        else:
            w("- (no origin stated)")
        w("")
        w(f"**Its towns as recorded**: {', '.join(towns) if towns else 'none recorded'}")
        w("")
        w("**Correct account**:")
        w("")
        w("&nbsp;")
        w("")
    w("---")
    w("")

open("work/NON-IGBO-ORIGINS-TO-FILL.md", "w").write("\n".join(out) + "\n")
print("written: work/NON-IGBO-ORIGINS-TO-FILL.md")
print(f"{len(rows)} entries across {len(set(r['division'] for r in rows))} divisions")
