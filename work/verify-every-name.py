"""Search every clan and every town, and record what the web actually says about it.

The owner: "you could have googled everything to be sure. In fact, google every single every single clan,
and town and be sure you verify them." This is that pass. It is deliberately dumb about judgement — it
records what came back and leaves the deciding to a human — because the failure it exists to catch is
the one that has already happened twice in this registry: a name that looked right and was not.

For each name it asks two sources:

  Wikipedia   the page, then a search, with the state the source's division maps to as context.
  DuckDuckGo  the plain name plus "Nigeria". Recorded are the top results' titles and URLs, and
              whether any of them is on ozikoro.com — the owner's own archive, which is both a
              cross-reference and the reason a spelling is likely to be right if it appears there.

WHAT IT RECORDS, AND WHY EACH FIELD IS THERE

  title_match   a result whose title carries the queried name, which is the only kind of result that
                is really about the name rather than merely mentioning it.
  near_miss     a result whose title is within two edits of the queried name. That is how Ogbunike
                was found behind "Ogburike" and Oguruguru behind "Ogrugru": the source's printed
                spelling and the name people actually use differ by a letter or two.
  verdict       'page' (a Wikipedia article), 'search' (results, none titled with the name),
                'near' (only a near-miss title), 'nothing' (the web has nothing under this name).

Output is one JSON object per line, written as it goes, so a run that dies can be resumed and read
without waiting for the end.
"""
import json, os, re, sys, time, unicodedata, urllib.parse, urllib.request

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Ozituma/1.0"
OUT = "work/clan-search-verdicts.jsonl"
WIKI_API = "https://en.wikipedia.org/w/api.php"

STATES = ["Abia", "Anambra", "Ebonyi", "Enugu", "Imo", "Rivers", "Delta", "Edo", "Bayelsa",
          "Cross River", "Akwa Ibom", "Benue", "Kogi", "Ondo", "Ogun", "Osun", "Oyo", "Lagos"]


def plain(value):
    """Lower-case, no diacritics, no punctuation — so Nkọ́ and Nko compare equal."""
    v = unicodedata.normalize("NFKD", str(value))
    v = "".join(c for c in v if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", v.lower()).strip()


def fetch(url, tries=3, headers=None):
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers=headers or {"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read().decode("utf-8", "replace")
        except Exception:
            time.sleep(1.5 * (attempt + 1))
    return ""


def wiki(name, region=None):
    query = {"action": "query", "titles": name, "prop": "extracts", "exintro": "1",
             "explaintext": "1", "redirects": "1", "format": "json", "formatversion": "2"}
    body = fetch(WIKI_API + "?" + urllib.parse.urlencode(query))
    if body:
        try:
            for page in json.loads(body).get("query", {}).get("pages", []):
                if page.get("extract") and "missing" not in page:
                    return {"page": page["title"], "extract": page["extract"][:400]}
        except json.JSONDecodeError:
            pass
    term = f"{name} {region}" if region else f"{name} Nigeria"
    query = {"action": "query", "list": "search", "srsearch": term, "srlimit": "3",
             "format": "json", "formatversion": "2"}
    body = fetch(WIKI_API + "?" + urllib.parse.urlencode(query))
    if body:
        try:
            hits = [h["title"] for h in json.loads(body).get("query", {}).get("search", [])]
            if hits:
                return {"search": hits}
        except json.JSONDecodeError:
            pass
    return {}


DDG_EMPTY_ATTEMPTS = 0


def ddg(name, region=None):
    global DDG_EMPTY_ATTEMPTS
    if DDG_EMPTY_ATTEMPTS >= 3:
        # The caller is being throttled. Stop asking rather than record a wall of
        # empty answers: "nothing found" and "not allowed to look" must not be the
        # same result, because one of them would delete an entry.
        return {"results": [], "suggestion": None, "throttled": True}
    term = f'"{name}" {region or "Nigeria"}'
    url = "https://html.duckduckgo.com/html/?" + urllib.parse.urlencode({"q": term})
    body = fetch(url)
    if 'result__a' not in body:
        DDG_EMPTY_ATTEMPTS += 1
        time.sleep(5)
        body = fetch(url)
        if 'result__a' not in body:
            return {"results": [], "suggestion": None, "throttled": True}
    DDG_EMPTY_ATTEMPTS = 0
    results = []
    for match in re.finditer(
        r'result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>', body, re.S
    ):
        href, title = match.group(1), re.sub(r"<[^>]+>", "", match.group(2))
        target = href
        m = re.search(r"uddg=([^&]+)", href)
        if m:
            target = urllib.parse.unquote(m.group(1))
        results.append({"title": title.strip(), "url": target})
        if len(results) >= 6:
            break
    # DuckDuckGo offers a spelling when it thinks the query is misspelt.
    suggestion = None
    m = re.search(r'class="did-you-mean"[^>]*>\s*<a[^>]*>(.*?)</a>', body, re.S)
    if m:
        suggestion = re.sub(r"<[^>]+>", "", m.group(1)).strip()
    return {"results": results, "suggestion": suggestion}


def distance(a, b):
    """Levenshtein, small enough to write out and cheap enough at this scale."""
    if a == b:
        return 0
    previous = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        current = [i]
        for j, cb in enumerate(b, 1):
            current.append(min(previous[j] + 1, current[j - 1] + 1,
                               previous[j - 1] + (ca != cb)))
        previous = current
    return previous[-1]


def judge(name, region, wiki_result, ddg_result):
    target = plain(name)
    titled = [r for r in ddg_result["results"] if target and target in plain(r["title"])]
    near = []
    for r in ddg_result["results"]:
        t = plain(r["title"])
        if not t:
            continue
        # Compare against the first two words of the title: "Ogbunike - Wikipedia".
        head = " ".join(t.split()[:2])
        if 1 <= distance(target, head) <= 2 or 1 <= distance(target, t.split()[0]) <= 2:
            near.append(r)
    ozikoro = [r for r in ddg_result["results"] if "ozikoro.com" in r["url"]]
    if ddg_result.get("throttled") and not wiki_result:
        # Nothing was asked, so nothing is concluded.
        return {"verdict": "unknown", "titled_hits": [], "near_misses": [], "ozikoro": [],
                "suggestion": None}
    if wiki_result.get("page") or titled:
        verdict = "page"
    elif wiki_result.get("search"):
        verdict = "search"
    elif near:
        verdict = "near"
    elif ddg_result["results"]:
        verdict = "search"
    else:
        verdict = "nothing"
    return {
        "verdict": verdict,
        "titled_hits": titled[:3],
        "near_misses": near[:3],
        "ozikoro": [r["url"] for r in ozikoro][:2],
        "suggestion": ddg_result.get("suggestion"),
    }


def main():
    doc = json.load(open("data/clans/clans.json"))
    regions = {}
    for clan in doc["clans"]:
        regions[clan["name"]] = clan.get("region")

    targets = []
    for clan in doc["clans"]:
        targets.append(("clan", clan["name"], clan.get("region"), clan.get("tribe")))
    seen = set()
    for clan in doc["clans"]:
        for town in clan.get("towns") or []:
            name = town if isinstance(town, str) else town.get("name")
            if not name or name in seen:
                continue
            seen.add(name)
            targets.append(("town", name, clan.get("region"), clan.get("name")))

    done = set()
    if os.path.exists(OUT):
        for line in open(OUT):
            try:
                row = json.loads(line)
                done.add((row["kind"], row["name"]))
            except json.JSONDecodeError:
                continue
    print(f"{len(targets)} names, {len(done)} already done", flush=True)

    with open(OUT, "a") as out:
        for index, (kind, name, region, context) in enumerate(targets, 1):
            if (kind, name) in done:
                continue
            wiki_result = wiki(name, region)
            ddg_result = ddg(name, region)
            verdict = judge(name, region, wiki_result, ddg_result)
            row = {"kind": kind, "name": name, "region": region, "context": context,
                   "wiki": wiki_result, **verdict}
            out.write(json.dumps(row, ensure_ascii=False) + "\n")
            out.flush()
            if index % 25 == 0:
                print(f"  {index}/{len(targets)}  {kind} {name}: {verdict['verdict']}", flush=True)
            time.sleep(2.5)

    rows = [json.loads(l) for l in open(OUT)]
    from collections import Counter
    print("\nverdicts:", Counter(r["verdict"] for r in rows))
    nothing = [r for r in rows if r["verdict"] == "nothing"]
    print(f"\nnothing found for {len(nothing)} names:")
    for r in nothing[:60]:
        print(f'  {r["kind"]:5} {r["name"]}')
    near = [r for r in rows if r["verdict"] == "near"]
    print(f"\n{len(near)} names whose only hits are a near-miss spelling:")
    for r in near[:60]:
        titles = ", ".join(x["title"][:40] for x in r["near_misses"][:2])
        print(f'  {r["kind"]:5} {r["name"]:22} -> {titles}')


if __name__ == "__main__":
    main()
