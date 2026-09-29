"""Ask again about the names the first pass could not place.

Two things made the first pass's negative answers useless, and both are fixable by
asking differently:

  1. It searched the names AS THEY WERE IN THE FILE, brackets and all. A query for
     "Uburu (Nsukka)" or "Isu (Arochukwu)" is not how anybody writes, so those names
     came back with nothing. The brackets are gone from the registry now, so the
     plain name is what should be asked for.
  2. A name whose page exists under a slightly different spelling — Arochuku for
     Arochukwu, Ugulangu for Ugwulangwu — looks like a name with no page until the
     near-spelling is looked for deliberately.

So this re-asks only the names the strict reading could not place, with the plain
name, and with the division and state as context. Everything else is left alone.
"""
import json, os, re, sys, time, unicodedata, urllib.parse, urllib.request

sys.path.insert(0, "work")
import importlib.util
spec = importlib.util.spec_from_file_location("v", "work/verify-every-name.py")
verify = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify)

OUT = "work/clan-search-recheck.jsonl"


def plain_name(name):
    """Uburu (Nsukka) -> Uburu; Arochuku stays Arochuku."""
    return re.sub(r"\s*[（(][^)）]*[)）]\s*$", "", name).strip()


def main():
    strict = [json.loads(l) for l in open("work/clan-search-strict.jsonl") if l.strip()]
    todo = [r for r in strict if r["strict"] in ("nothing", "weak", "unknown")]
    done = set()
    if os.path.exists(OUT):
        for line in open(OUT):
            try:
                row = json.loads(line)
                done.add((row["kind"], row.get("was") or row.get("asked")))
            except json.JSONDecodeError:
                continue
    todo = [r for r in todo if (r["kind"], r["name"]) not in done]
    print(f"{len(todo)} names to ask about again", flush=True)

    with open(OUT, "a") as out:
        for index, row in enumerate(todo, 1):
            name = plain_name(row["name"])
            region = row.get("region")
            wiki = verify.wiki(name, region)
            ddg = verify.ddg(name, region)
            verdict = verify.judge(name, region, wiki, ddg)
            record = {
                "kind": row["kind"],
                "asked": name,
                "was": row["name"],
                "context": row.get("context"),
                "region": region,
                "wiki": wiki,
                **verdict,
            }
            out.write(json.dumps(record, ensure_ascii=False) + "\n")
            out.flush()
            if index % 20 == 0:
                print(f"  {index}/{len(todo)}  {name}: {verdict['verdict']}", flush=True)
            time.sleep(2.5)

    rows = [json.loads(l) for l in open(OUT)]
    from collections import Counter
    print("\n", Counter(r["verdict"] for r in rows))
    for verdict in ("nothing", "near"):
        subset = [r for r in rows if r["verdict"] == verdict]
        print(f"\n{verdict.upper()} — {len(subset)}")
        for r in subset[:80]:
            near = ", ".join(h["title"][:36] for h in r["near_misses"][:2])
            print(f"  {r['kind']:5} {r['asked']:20} {near}")


if __name__ == "__main__":
    main()
