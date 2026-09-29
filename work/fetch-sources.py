"""Fetch the articles the owner named, with retries, and keep them for the write-up.

Vanilla urllib died twice on this network mid-run, which loses the whole set; so each
page is fetched through curl with a retry, and each is written as it arrives. A run that
dies can be restarted and will skip what it already has.
"""
import json, os, subprocess, time, urllib.parse

UA = "Ozikoro/1.0 (https://ozikoro.com; hello@ozikoro.com)"

PAGES = {
    "aro": "Aro people",
    "aro_confederacy": "Aro Confederacy",
    "abirika": "Abiriba",
    "abam": "Abam",
    "nkporo": "Nkporo",
    "ohafia": "Ohafia",
    "ezza": "Ezaa people",
    "ikwo": "Ikwo people",
    "izzi": "Izzi people",
    "afikpo_south": "Afikpo South",
    "opi": "Opi (archaeological site)",
    "lejja": "Lejja",
    "obimo": "Obimo",
    "igbuzo": "Igbuzo",
    "uburu_news": None,   # fetched from the news site below
    "okposi_history": None,
}


def wiki_extract(title):
    query = urllib.parse.urlencode({
        "action": "query", "titles": title, "prop": "extracts", "explaintext": "1",
        "redirects": "1", "format": "json", "formatversion": "2",
    })
    url = f"https://en.wikipedia.org/w/api.php?{query}"
    for attempt in range(3):
        out = subprocess.run(["curl", "-sS", "-m", "45", "-A", UA, url],
                             capture_output=True, text=True)
        if out.returncode == 0 and out.stdout.strip():
            try:
                data = json.loads(out.stdout)
            except json.JSONDecodeError:
                time.sleep(3)
                continue
            for page in data.get("query", {}).get("pages", []):
                return page.get("title"), page.get("extract") or ""
        time.sleep(3)
    return None, ""


def page_text(url):
    for attempt in range(3):
        out = subprocess.run(["curl", "-sS", "-L", "-m", "45", "-A", "Mozilla/5.0", url],
                             capture_output=True, text=True)
        if out.returncode == 0 and len(out.stdout) > 2000:
            return out.stdout
        time.sleep(3)
    return ""


def strip_html(html):
    import html as html_mod
    import re
    body = re.sub(r"(?is)<(script|style|nav|header|footer)[^>]*>.*?</\1>", " ", html)
    body = re.sub(r"(?i)<(br|/p|/li|/h[1-6]|/div|/td|/tr)[^>]*>", "\n", body)
    text = html_mod.unescape(re.sub(r"(?s)<[^>]+>", " ", body))
    lines = [re.sub(r"[ \t\xa0]+", " ", l).strip() for l in text.split("\n")]
    return "\n".join(l for l in lines if l)


os.makedirs("work/sources", exist_ok=True)

for key, title in PAGES.items():
    path = f"work/sources/{key}.txt"
    if os.path.exists(path) and os.path.getsize(path) > 800:
        print(f"{key:16} already have it")
        continue
    if title:
        got, text = wiki_extract(title)
        open(path, "w").write(f"# {got}\n\n{text}")
        print(f"{key:16} {str(got):22} {len(text):6} chars", flush=True)
    time.sleep(1)

# The two that are not Wikipedia.
NEWS = {
    "uburu_news": "https://southeastnewsdaily.wordpress.com/2018/10/21/origin-and-migration-of-uburu/",
}
for key, url in NEWS.items():
    path = f"work/sources/{key}.txt"
    if os.path.exists(path) and os.path.getsize(path) > 500:
        print(f"{key:16} already have it")
        continue
    text = strip_html(page_text(url))
    open(path, "w").write(f"# {url}\n\n{text}")
    print(f"{key:16} {len(text):6} chars", flush=True)
