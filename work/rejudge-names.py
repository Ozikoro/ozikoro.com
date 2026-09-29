"""Re-score the search results already collected, with a stricter reading.

The first pass counted any result whose title contained the name as evidence the
name exists. That is too generous, and the giveaway was a town called Oshine being
"found" because a WordPress theme of that name ranks for it. A run that finds
everything has told you nothing.

This reads the stored results — the raw titles and URLs are all in the JSONL, so
nothing is queried again — and sorts each result into one of four kinds:

  strong    a page about a place or a people: Wikipedia, Wikivoyage, the owner's own
            archive, a Nigerian domain, a gazetteer, or any page whose title says
            town, village, clan, community, kingdom or local government area
  weak      a result that merely contains the word: a surname site, a business
            directory, a weather or map-directions page, a social media account
  junk      a title that is plainly not about a place at all — a theme, a person's
            handle, a company
  none      no result carried the name

The verdict for a name follows: `page` if any strong result, `weak` if only weak
ones, `nothing` if nothing carried the name at all, `unknown` when the search was
throttled and never answered. Only `nothing` is grounds for question, and only
`weak` is worth a second look — which is the whole point of separating them.
"""
import json, re, sys
from collections import Counter

STRONG_HOSTS = (
    "wikipedia.org", "wikivoyage.org", "wikidata.org", "ozikoro.com", "mapcarta.com",
    "geonames.org", "citypopulation.de", "mindat.org", "nigeriagalleria.com",
    "nairaland.com", ".ng", ".gov.ng", "vanguardngr.com", "pulse.ng", "legit.ng",
    "premiumtimesng.com", "sunnewsonline.com", "guardian.ng", "thenationonlineng.net",
    "tribuneonlineng.com", "dailytrust.com", "thisdaylive.com", "businessday.ng",
)
WEAK_HOSTS = (
    "instagram.com", "facebook.com", "twitter.com", "x.com", "pinterest.", "linkedin.com",
    "youtube.com", "tiktok.com", "forebears.io", "ancestry.", "behindthename.com",
    "surnames.", "tripadvisor.", "booking.com", "hotels.", "weather.com", "accuweather.",
    "meteoblue.", "viamichelin.", "michelin.", "mapcarta.com/place", "wordpress.org",
    "themeforest.", "envato.", "amazon.", "ebay.", "yelp.", "foursquare.",
)
JUNK_WORDS = (
    "theme", "template", "wordpress", "plugin", "surname", "last name", "first name",
    "baby name", "meaning of", "definition", "dictionary", "login", "sign in", "download",
    "apk", "crack", "torrent", "film", "movie", "song", "lyrics", "hotel", "booking",
    "flight", "insurance", "loan", "casino", "porn",
)
PLACE_WORDS = (
    "town", "village", "clan", "community", "kingdom", "local government", "lga",
    "state", "nigeria", "igbo", "history", "origin", "people", "settlement", "map",
    "locality", "ward", "district", "anambra", "imo", "abia", "enugu", "ebonyi",
    "rivers", "delta", "edo", "bayelsa", "cross river", "kogi", "benue",
)


def classify(result):
    url = (result.get("url") or "").lower()
    title = (result.get("title") or "")
    low = title.lower()
    if any(h in url for h in WEAK_HOSTS) or any(w in low for w in JUNK_WORDS):
        return "junk" if any(w in low for w in JUNK_WORDS) else "weak"
    if any(h in url for h in STRONG_HOSTS):
        return "strong"
    if any(w in low for w in PLACE_WORDS):
        return "strong"
    return "weak"


def main():
    path = "work/clan-search-verdicts.jsonl"
    rows = [json.loads(l) for l in open(path) if l.strip()]
    rescored = []
    for row in rows:
        if row.get("throttled") or row["verdict"] == "unknown":
            row["strict"] = "unknown"
            rescored.append(row)
            continue
        kinds = [classify(r) for r in row.get("titled_hits") or []]
        if "strong" in kinds:
            row["strict"] = "page"
        elif kinds:
            row["strict"] = "weak"
        else:
            # Nothing carried the name in its title. The broader result list may
            # still mention it, but that is not evidence about the name.
            row["strict"] = "nothing"
        rescored.append(row)

    with open("work/clan-search-strict.jsonl", "w") as out:
        for row in rescored:
            out.write(json.dumps(row, ensure_ascii=False) + "\n")

    print("strict reading of", len(rescored), "names:")
    print(" ", dict(Counter(r["strict"] for r in rescored)))
    for kind in ("nothing", "weak"):
        subset = [r for r in rescored if r["strict"] == kind]
        print(f"\n{kind.upper()} — {len(subset)} names")
        for r in subset[:70]:
            hits = ", ".join(h["title"][:38] for h in (r.get("titled_hits") or [])[:2])
            weak = ", ".join(h["title"][:38] for h in (r.get("weak_misses") or [])[:2])
            print(f"  {r['kind']:5} {r['name']:22} {(hits or weak or '-')[:76]}")


if __name__ == "__main__":
    main()
