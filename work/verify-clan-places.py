"""Look every clan entry up on Wikipedia and record what came back and where it is.

For each name: the direct page, then a search fallback. A hit gives a title and an intro, and the
intro is scanned for the present-day state. What could not be found is reported, not guessed at.
"""
import json, re, sys, time, urllib.parse, urllib.request
UA = "Ozikoro/1.0 (https://ozikoro.com; hello@ozikoro.com)"
API = "https://en.wikipedia.org/w/api.php"
STATES = ["Abia","Anambra","Ebonyi","Enugu","Imo","Rivers","Delta","Edo","Bayelsa","Cross River",
          "Akwa Ibom","Benue","Kogi","Abuja","Federal Capital Territory"]

def api(p):
    p = {**p, "format":"json", "formatversion":"2"}
    req = urllib.request.Request(API + "?" + urllib.parse.urlencode(p), headers={"User-Agent": UA})
    for _ in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode())
        except Exception:
            time.sleep(1.0)
    return {}

def look_up(name):
    d = api({"action":"query","titles":name,"prop":"extracts","exintro":"1","explaintext":"1","redirects":"1"})
    for page in d.get("query",{}).get("pages",[]):
        if "missing" not in page and page.get("extract"):
            return page["title"], page["extract"]
    s = api({"action":"query","list":"search","srsearch":f"{name} Igbo Nigeria","srlimit":"1"})
    hits = s.get("query",{}).get("search",[])
    if not hits:
        return None, None
    title = hits[0]["title"]
    d2 = api({"action":"query","titles":title,"prop":"extracts","exintro":"1","explaintext":"1"})
    for page in d2.get("query",{}).get("pages",[]):
        if page.get("extract"):
            return title, page["extract"]
    return None, None

def state_in(text):
    for s in STATES:
        if re.search(rf"\b{re.escape(s)}\b", text or ""):
            return s
    return None

clans = json.load(open("data/clans/clans.json"))["clans"]
out = []
for i, c in enumerate(clans, 1):
    name = c["name"]
    title, extract = look_up(name)
    out.append({"name": name, "title": title, "state": state_in(extract),
                "intro": (extract or "")[:400].replace("\n", " ")})
    if i % 25 == 0:
        print(f"  {i}/{len(clans)}", flush=True)
json.dump(out, open("/tmp/clan-wikipedia.json","w"), ensure_ascii=False, indent=1)
found = [r for r in out if r["title"]]
print(f"\nlooked up {len(out)}; a Wikipedia page was found for {len(found)}")
print(f"  with a present-day state named in the intro: {len([r for r in found if r['state']])}")
print(f"  nothing found: {len(out)-len(found)}")
