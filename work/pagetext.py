import re, html, subprocess, sys
url = sys.argv[1]
h = subprocess.run(['curl','-sS','-A','Mozilla/5.0',url], capture_output=True, text=True).stdout
body = re.sub(r'(?is)<(script|style)[^>]*>.*?</\1>', ' ', h)
body = re.sub(r'(?i)<(br|/p|/li|/h[1-6]|/div|/section|/td|/tr)[^>]*>', '\n', body)
txt = html.unescape(re.sub(r'(?s)<[^>]+>', ' ', body))
lines = [re.sub(r'[ \t\xa0]+', ' ', l).strip() for l in txt.split('\n')]
print('\n'.join(l for l in lines if l))
