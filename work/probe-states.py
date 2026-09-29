"""One more question per entry: which state is it in?

The earlier searches were for the name alone, and a Nigerian place page often carries the
state in its title — "Abbi, Delta, Nigeria", "Oshiri map, Nigeria, Ebonyi", "Ngbo Map -
Village - Ebonyi, Ebonyi State, Nigeria". The verdicts recorded those titles but nothing
read them for a state. This does, and it asks once more with the word State in the query,
because that is how these pages are titled.

A state is recorded only when it appears in the title or snippet of a result whose title
also carries the entry's own name — so "Delta emu" on GitHub cannot make Emu a Delta town.
"""
import json, re, sys, time, unicodedata, urllib.parse, urllib.request

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Ozituma/1.0"
STATES = ["Abia", "Anambra", "Ebonyi", "Enugu", "Imo", "Rivers", "Delta", "Edo", "Bayelsa",
          "Cross River", "Akwa Ibom"]


def fetch(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read().decode("utf-8", "replace")
        except Exception:
            time.sleep(2 * (i + 1))
    return ""


def plain(v):
    v = unicodedata.normalize("NFKD", v)
    v = "".join(c for c in v if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", v.lower()).strip()


def search(name):
    term = f'"{name}" Nigeria State'
    body = fetch("https://html.duckduckgo.com/html/?" + urllib.parse.urlencode({"q": term}))
    results = []
    for m in re.finditer(r'result__a"[^>]*>(.*?)</a>', body, re.S):
        results.append(re.sub(r"<[^>]+>", "", m.group(1)).strip())
    for m in re.finditer(r'result__snippet"[^>]*>(.*?)</a>', body, re.S):
        results.append(re.sub(r"<[^>]+>", "", m.group(1)).strip())
    return results


def main():
    verdicts = [json.loads(l) for l in open("work/clan-search-strict.jsonl") if l.strip()]
    rows = {r["name"]: r for r in verdicts if r["kind"] == "clan"}
    names = [l.split("\t")[0] for l in open("/tmp/nowhere.txt").read().strip().split("\n")]
    out = []
    for name in names:
        titles = [h["title"] for h in (rows.get(name, {}).get("titled_hits") or [])]
        extra = search(name) if name not in ("Okposi", "Oshiri", "Akaeze", "Nimo", "Ikwerri", "Abbi", "Amai", "Ngbo") else []
        haystack = " | ".join(titles + extra)
        target = plain(name)
        state = None
        for s in STATES:
            # The state has to appear in a string that also carries the name.
            for piece in (titles + extra):
                if plain(name) in plain(piece) and re.search(rf"\b{s}\b", piece):
                    state = s
                    break
            if state:
                break
        out.append({"name": name, "state": state, "evidence": [p[:100] for p in (titles + extra)][:3]})
        print(f"  {name:14} {state or '—':10} {str(out[-1]['evidence'][0] if out[-1]['evidence'] else '')[:78]}", flush=True)
        time.sleep(2.5)
    json.dump(out, open("work/nowhere-states.json", "w"), ensure_ascii=False, indent=1)
    found = [r for r in out if r["state"]]
    print(f"\nplaced by this pass: {len(found)} of {len(out)}")
    print("still nothing:", ", ".join(r["name"] for r in out if not r["state"]))


if __name__ == "__main__":
    main()
