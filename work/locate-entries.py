"""Find where each unplaced entry actually is, from the full article rather than its opening.

The first pass read only the first paragraph, and a great many Nigerian place articles
defer the state to a later sentence or an infobox line — "Okposi is a town in Ohaozara,
Ebonyi State" lives further down than the intro sometimes reaches. So an entry looked
unplaceable when the article knew perfectly well where it was.

This reads the whole article, and it takes a state only from a page whose TITLE is the
entry's own name. That restriction is the whole value: without it "Emu" finds the bird and
"Ihe" finds a fish.
"""
import json, re, sys, time, unicodedata, urllib.parse, urllib.request
from collections import Counter

UA = "Ozikoro/1.0 (https://ozikoro.com; hello@ozikoro.com)"
API = "https://en.wikipedia.org/w/api.php"
STATES = ["Abia", "Anambra", "Ebonyi", "Enugu", "Imo", "Rivers", "Delta", "Edo", "Bayelsa",
          "Cross River", "Akwa Ibom"]
LGAS = re.compile(r"([A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+){0,2})\s+(?:Local Government Area|LGA)\b")


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


def plain(value):
    v = unicodedata.normalize("NFKD", value)
    v = "".join(c for c in v if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", v.lower()).strip()


def title_matches(title, name):
    """
    Does this page title name the entry?

    "Nike, Nigeria" is the article about the Enugu community, and a check for the bare
    name missed it — which is how a place with a Wikipedia article and a state in its
    first sentence came out unplaceable. Parentheticals and a trailing ", Nigeria" or
    ", <State>" are the two ways these articles carry a qualifier.
    """
    stripped = re.sub(r"\s*\(.*?\)\s*", " ", title)
    stripped = re.sub(r",\s*(Nigeria|Niger State|.*?State)$", "", stripped, flags=re.I)
    return plain(stripped) == plain(name)


def article(name):
    d = api({"action": "query", "titles": name, "prop": "extracts", "explaintext": "1",
             "redirects": "1"})
    for page in d.get("query", {}).get("pages", []):
        if page.get("extract") and "missing" not in page:
            return page["title"], page["extract"]
    # The same title forms, asked for directly before searching.
    for suffix in (", Nigeria", " (Nigeria)", ", Enugu State", ", Anambra State"):
        d0 = api({"action": "query", "titles": f"{name}{suffix}", "prop": "extracts",
                  "explaintext": "1", "redirects": "1"})
        for page in d0.get("query", {}).get("pages", []):
            if page.get("extract") and "missing" not in page:
                return page["title"], page["extract"]
    d = api({"action": "query", "list": "search", "srsearch": f"{name} Nigeria", "srlimit": "3"})
    hits = [h["title"] for h in d.get("query", {}).get("search", [])]
    for title in hits:
        # Only a page whose title IS the name: otherwise this reads about the wrong thing.
        if title_matches(title, name):
            d2 = api({"action": "query", "titles": title, "prop": "extracts", "explaintext": "1"})
            for page in d2.get("query", {}).get("pages", []):
                if page.get("extract"):
                    return page["title"], page["extract"]
    return None, None


def main():
    names = [l.split("\t")[0] for l in open("/tmp/nowhere.txt").read().strip().split("\n")]
    out = []
    for name in names:
        title, text = article(name)
        states, lgas = [], []
        if text:
            states = [s for s in STATES if re.search(rf"\b{re.escape(s)}\b(?:\s+State)?", text)]
            lgas = sorted({m.strip() for m in LGAS.findall(text)})
        out.append({"name": name, "title": title, "states": states, "lgas": lgas[:4],
                    "opening": (text or "")[:160].replace("\n", " ")})
        print(f"  {name:14} {str(title)[:26]:28} {','.join(states) or '—':26} {', '.join(lgas[:2])[:40]}", flush=True)
        time.sleep(1.0)
    json.dump(out, open("work/nowhere-located.json", "w"), ensure_ascii=False, indent=1)
    placed = [r for r in out if r["states"]]
    print(f"\nplaced: {len(placed)} of {len(out)}")
    print("still nothing:", ", ".join(r["name"] for r in out if not r["states"]))


if __name__ == "__main__":
    main()
