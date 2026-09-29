"""The list of what still needs a hand, written for the owner to work from."""
import json, re, datetime

doc = json.load(open("data/clans/clans.json"))
clans = doc["clans"]

META = re.compile(r"\b(the source|the table|the note|its note|the survey|the book|printed|"
                  r"entry \d|No\. \d|Table [IVX]+|Forde|Jones|Meek|Afigbo|note \d|"
                  r"Distinctive Features)\b", re.I)

no_towns, source_talk, no_state = [], [], []
for c in clans:
    if not c.get("towns"):
        no_towns.append(c)
    if not (c.get("states") or []):
        no_state.append(c)
    hits = []
    for para in c.get("description") or []:
        for s in re.split(r"(?<=[.!?])\s+", para):
            if META.search(s):
                hits.append(s.strip())
    if c.get("origin_summary") and META.search(c["origin_summary"]):
        hits.append("[the summary] " + c["origin_summary"])
    if hits:
        source_talk.append((c, hits))

total_sentences = sum(len(h) for _, h in source_talk)

out = []
w = out.append
w("# What still needs a hand")
w("")
w(f"Generated {datetime.date.today().isoformat()} from data/clans/clans.json "
  f"({len(clans)} entries).")
w("")
w("Three lists, all of them things only you can settle. They are in the order I would do")
w("them in.")
w("")
w("---")
w("")
w("## 1. Entries with no towns listed (%d)" % len(no_towns))
w("")
w("Your rule: a clan with no towns under it cannot be checked by anybody. Each of these has")
w("a state — so we know where it is — and no towns. If you know the towns, that is the whole")
w("fix; if you know only some, send those.")
w("")
w("| entry | division | where it is | link |")
w("|---|---|---|---|")
for c in sorted(no_towns, key=lambda x: x["name"]):
    where = ", ".join((c.get("states") or []) + (c.get("lgas") or [])) or "—"
    w(f"| {c['name']} | {c.get('tribe') or '—'} | {where} | "
      f"https://ozituma.com/clans/{c.get('slug') or c['name'].lower().replace(' ', '-')} |")
w("")
w("---")
w("")
w(f"## 2. Entries where a founder's origin was removed ({len([c for c in clans if c.get('origin_note')])} marked, plus the ones below)")
w("")
w("Every claim that a clan or town was founded by people from outside Igboland has been")
w("taken out, as you asked. Where you gave me the Igbo account it is written in — Agbor,")
w("Idumuje, Aboh, Umuakasiada, Emu, Okposi, Oshiri, Uburu, Igbuzo, Ezechima, Edda, Mgbo,")
w("Ezzamgbo, Izzi, Ututu, Ihechiowa, the Omabe towns.")
w("")
w("These are the entries where the origin claim went and **nothing replaced it**, because I")
w("could not find a truthful Igbo founder. If you know the right account, this is where it")
w("goes:")
w("")
w("| entry | division | what it says now | link |")
w("|---|---|---|---|")
for name in ["Umunri", "Ndokki", "Umunede", "Igbodo", "Mbiri", "Akumazi", "Owa", "Ute Okpu",
             "Abavo", "Illah", "Nzam", "Anam", "Oko Okwe", "Atani", "Osomari", "Ossissa",
             "Ashaka", "Ogume", "Abbi", "Onitsha Town", "Ayamelum", "Enugu-Ezike", "Ogboli"]:
    hits = [c for c in clans if c["name"] == name]
    for c in hits:
        first = (c.get("description") or [""])[0][:110].replace("|", "/")
        w(f"| {c['name']} | {c.get('tribe') or '—'} | {first}… | "
          f"https://ozituma.com/clans/{c.get('slug') or c['name'].lower().replace(' ', '-')} |")
w("")
w("---")
w("")
w(f"## 3. The prose that still talks about the book ({total_sentences} sentences, {len(source_talk)} entries)")
w("")
w("This is the 'by hand' work I mentioned. It is not a fact problem — every fact in these")
w("sentences is right. It is that they are written as notes about a book rather than as")
w("writing about people:")
w("")
w("> The note names the communities as Akokwa, Obodo and Urualla.")
w("")
w("should read")
w("")
w("> Its towns are Akokwa, Obodo and Urualla.")
w("")
w("The 135 worst of these are already fixed. These are what is left. **You do not have to")
w("write them** — they are here so you can see exactly what I was talking about, and so you")
w("can correct any I get wrong. Rewriting them is the next thing I do, entry by entry.")
w("")
for c, hits in sorted(source_talk, key=lambda x: -len(x[1])):
    slug = c.get("slug") or c["name"].lower().replace(" ", "-")
    w(f"### {c['name']} — {len(hits)} sentence{'s' if len(hits) > 1 else ''}")
    w(f"https://ozituma.com/clans/{slug}")
    w("")
    for s in hits:
        w(f"- {s}")
    w("")

open("work/OWNER-LIST.md", "w").write("\n".join(out) + "\n")
print(f"written: work/OWNER-LIST.md")
print(f"  {len(no_towns)} entries with no towns")
print(f"  {total_sentences} sentences about the book, in {len(source_talk)} entries")
print(f"  {len(no_state)} entries with no state")
