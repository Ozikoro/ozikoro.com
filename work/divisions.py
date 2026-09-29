"""Put every clan under one of the six divisions, and name its tribe where a source names one.

The owner, 2026-09-28: "Isu tribe is part of Southern Igbo region, so remove it from being among the
list of these" — that list being the six divisions his own article sets out at
ozikoro.com/alaigbo-a-classification-of-ethnic-divisions-tribes-and-sub-tribes/.

Isu was sitting in that list as a sixth peer of the divisions because 25 clans carried `tribe: "Isu"`.
It is a tribe of Southern Igbo (Isu-Urata), and that is where it goes.

NOTHING HERE IS GUESSED. A clan's division comes from the Forde & Jones table its own source line
cites, mapped onto the owner's division names:

  Table I, Table II, Onitsha Town   Northern Igbo        -> Northern Igbo (Wawaa)
  Table III, IV, V, VI              Southern or Owerri   -> Southern Igbo (Isu-Urata)
  Table X, XI, XII                  Eastern or Cross River -> Cross River Igbo (Aro)
  Table XIII                        North-Eastern        -> Northeast Igbo (Ogu Ukwu)
  Table VII  Northern Ika           Western              -> Western Igbo (Anioma)
  Table IX   Riverain Igbo          Western              -> Riverine Igbo (Oru)
  Table VIII Southern Ika or Kwale  Western              -> the one table that spans two divisions

Table VIII is the only judgement call, and it is made clan by clan against the source's own words
rather than by district guesswork. Forde & Jones heads that table "Southern Ika or Kwale" because it
carries both: the Ika groups it calls the earliest settlers of Southern Ika country, and the
Aboh-Kwale-Ndokwa groups that the owner's article places in Riverine Igbo (Oru). Where the source
places a Table VIII group in the Riverain Igbo table instead — as it does for Afor — that settles it.
Every Table VIII clan gets the evidence for its side written into the file.
"""
import json, re, sys

PATH = 'data/clans/clans.json'
doc = json.load(open(PATH))
clans = doc['clans']

DIVISION = {
    'Northern Igbo': 'Northern Igbo (Wawaa)',
    'Southern Igbo': 'Southern Igbo (Isu-Urata)',
    'Eastern Igbo': 'Cross River Igbo (Aro)',
    'North-Eastern Igbo': 'Northeast Igbo (Ogu Ukwu)',
    'Isu': 'Southern Igbo (Isu-Urata)',
}

# Table VIII, decided from the source's own sentences.
TABLE_VIII_IKA = {'Umuakasiada', 'Umunkwata', 'Abedei'}
TABLE_VIII_ORU = {'Orogun', 'Abbi', 'Amai', 'Akoko', 'Utagba', 'Onicha', 'Emu', 'Ogume', 'Okpai', 'Afor'}

# The tribes of the owner's article, by the name a clan carries. Only exact or
# alias matches: a name that merely looks similar is not evidence.
TRIBE_BY_NAME = {
    # Cross River Igbo (Aro)
    'Arochuku': 'Aro', 'Ada (Edda)': 'Edda', 'Afikpo': 'Afikpo (Ehugbo)', 'Abam': 'Abam',
    'Item': 'Item', 'Isuikwuato': 'Isuikwuato',
    # Northeast Igbo (Ogu Ukwu)
    'Izi': 'Izzi', 'Ezza': 'Ezza', 'Mgbo': 'Mgbo', 'Ezzamgbo': 'Ezzamgbo', 'Ikwo': 'Ikwo',
    # Northern Igbo (Wawaa)
    'Idemili': 'Idemili', 'Nkanu': 'Nkanu', 'Otanchara': 'Otanzu-Otanchara', 'Agbaja': 'Agbaja',
    'Nsukka': 'Nsukka', 'Ezeagu': 'Ezeagu', 'Awgu': 'Awka', 'Nri': 'Nri', 'Umunri': 'Nri',
    # Southern Igbo (Isu-Urata)
    'Ngwa': 'Ngwa', 'Ikwerri': 'Ikwerre (Iwhuruohna)', 'Etche': 'Etche', 'Ndokki': 'Ndoki',
    'Orsu I': 'Orsu', 'Orsu II': 'Orsu', 'Oratta': 'Uratta (Owerre)', 'Owerri': 'Uratta (Owerre)',
    'Ezinihitte': 'Ezinihitte (Mbaise)', 'Mbano': 'Agbaja-Ehime (Mbano)', 'Asa': 'Asa',
    'Isu': 'Isu', 'Isu-Orlu': 'Isu', 'Isu-Mbieri': 'Isu', 'Isuochi': 'Isu', 'Isuikwuato (Isu)': 'Isu',
    # Riverine Igbo (Oru)
    'Onicha': 'Onitsha (Onicha)', 'Oguta': 'Oguta (Ugwuta)', 'Ekpeya': 'Ekpeye', 'Ogba': 'Ogba',
    'Ogbaru': 'Ogbaru', 'Egbema': 'Egbema', 'Ndokwa': 'Ndokwa (Ukwuani)', 'Aboh': 'Ndokwa (Ukwuani)',
    # Western Igbo (Anioma)
    'Agbor': 'Ika', 'Ika': 'Ika', 'Aniocha': 'Aniocha', 'Ukwuani': 'Ukwuani',
}

report = []
for clan in clans:
    old = clan.get('tribe')
    if old in DIVISION:
        division = DIVISION[old]
    elif old == 'Western Igbo':
        source = str(clan.get('source', ''))
        if 'Table IX' in source:
            division = 'Riverine Igbo (Oru)'
        elif 'Table VII' in source:
            division = 'Western Igbo (Anioma)'
        elif 'Table VIII' in source:
            if clan['name'] in TABLE_VIII_IKA:
                division = 'Western Igbo (Anioma)'
            elif clan['name'] in TABLE_VIII_ORU:
                division = 'Riverine Igbo (Oru)'
            else:
                division = None
        else:
            division = None
    else:
        # A people that is not Igbo at all: Yoruba, Ijaw, Edo, Igala, Efik and the
        # rest. They belong to no Igbo division, and 40 of them are unpublished.
        division = None
    report.append((clan['name'], old, division, clan.get('ethnicGroup') or 'Igbo'))

unplaced = [r for r in report if r[2] is None]
print('clans:', len(report))
from collections import Counter
for name, count in Counter(r[2] for r in report).most_common():
    print(f'  {count:4}  {name}')
print('\nno division (not Igbo, or undecided):', len(unplaced))
for row in unplaced:
    print('   ', row[0], '|', row[3])
