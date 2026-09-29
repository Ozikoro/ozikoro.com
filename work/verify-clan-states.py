"""Second look at the clans whose recorded state disagrees with their recorded region.

The first pass looked every clan name up on Wikipedia as a bare name, which is how a group called
Onicha ended up in Abia: the search matched a different Onicha. This pass asks a narrower question
and refuses more answers.

For each name it searches Wikipedia WITH the region the source's own table puts the clan in, and it
accepts a page only when the page's title carries the clan name and the page's opening actually names
a Nigerian state. Anything else is reported as unresolved rather than written down.
"""
import json, re, sys, time, urllib.parse, urllib.request

UA = "Ozikoro/1.0 (https://ozikoro.com; hello@ozikoro.com)"
API = "https://en.wikipedia.org/w/api.php"
STATES = ["Abia", "Anambra", "Ebonyi", "Enugu", "Imo", "Rivers", "Delta", "Edo", "Bayelsa",
          "Cross River", "Akwa Ibom", "Benue", "Kogi", "Ondo", "Ogun", "Osun", "Oyo", "Lagos"]

def api(params):
    p = {**params, "format": "json", "formatversion": "2"}
    req = urllib.request.Request(API + "?" + urllib.parse.urlencode(p), headers={"User-Agent": UA})
    for _ in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode())
        except Exception:
            time.sleep(1.5)
    return {}

def intro(title):
    d = api({"action": "query", "titles": title, "prop": "extracts", "exintro": "1",
             "explaintext": "1", "redirects": "1"})
    for page in d.get("query", {}).get("pages", []):
        if page.get("extract"):
            return page["extract"]
    return ""

def states_in(text):
    found = []
    for s in STATES:
        if re.search(rf"\b{re.escape(s)}\b", text or ""):
            found.append(s)
    return found

def strip_diacritics(value):
    import unicodedata
    v = unicodedata.normalize("NFKD", value)
    return "".join(c for c in v if not unicodedata.combining(c)).lower()

def search(term, limit=4):
    d = api({"action": "query", "list": "search", "srsearch": term, "srlimit": str(limit)})
    return [h["title"] for h in d.get("query", {}).get("search", [])]

def resolve(name, region):
    base = strip_diacritics(re.sub(r"\s*\(.*?\)\s*", " ", name)).strip()
    candidates = []
    for term in (f'"{base}" {region} Nigeria', f"{base} {region} State", f"{base} Igbo Nigeria"):
        for title in search(term):
            t = strip_diacritics(title)
            # The page has to be about this name, not merely mention it.
            # Only a page whose title IS the clan's name. "Uburu Ekwe" is not
            # Uburu, "Isu people" is the whole subgroup and not the Afikpo clan, and
            # "Ogba-Egbema-Ndoni" is an administrative area named after three of them.
            stripped = re.sub(r"\s*\(.*?\)\s*", " ", t).strip()
            if stripped == base:
                candidates.append(title)
        if candidates:
            break
    for title in candidates[:3]:
        text = intro(title)
        found = states_in(text)
        if found:
            # The first state the opening names is the state the subject is in;
            # the rest are usually neighbours the same sentence mentions.
            first = re.search(
                r"\b(" + "|".join(STATES) + r")(?:\s+State)?\b", text)
            ordered = [first.group(1)] if first else found[:1]
            return {"title": title, "states": ordered, "intro": text[:350].replace("\n", " ")}
    return {"title": None, "states": [], "intro": ""}

# The clans as they were before the correction, so this can be re-run after the
# file has already been changed once.
suspicious = json.load(open("work/clan-states-original.json"))

print(f"re-checking {len(suspicious)} clans\n")
out = []
for i, c in enumerate(suspicious, 1):
    r = resolve(c["name"], c["region"])
    out.append({"name": c["name"], "region": c["region"], "recorded": c.get("states"),
                "division": c.get("tribe"), **r})
    print(f'  {i:2}/{len(suspicious)}  {c["name"][:26]:28} region {c["region"]:9} '
          f'recorded {str(c.get("states")):18} -> {r["title"]} {r["states"]}', flush=True)
json.dump(out, open("work/clan-states-recheck.json", "w"), ensure_ascii=False, indent=1)
clean = [r for r in out if r["states"]]
print(f"\n{len(clean)} of {len(out)} resolved to a page naming a state")
print(f"{len(out) - len(clean)} still unresolved, and left alone")
