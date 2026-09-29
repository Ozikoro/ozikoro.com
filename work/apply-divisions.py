"""Write the division for every clan, and the six divisions in place of the old list.

Run after reading the report printed by work/divisions.py. This rewrites:
  * `divisions` (was `tribes`) — the six of the owner's article, each carrying its own tribes,
    its location and its key areas, exactly as the article sets them out;
  * every clan's `tribe` — its division;
  * every clan's `subgroup` — its tribe, where an article tribe has the clan's own name.
"""
import json, sys
sys.path.insert(0, 'work')
import importlib.util

spec = importlib.util.spec_from_file_location('d', 'work/divisions.py')
# divisions.py prints a report and exits; re-run its mapping inline instead.
exec(open('work/divisions.py').read().split('unplaced = ')[0].replace("print('clans:', len(report))", "pass"))

PATH = 'data/clans/clans.json'
doc = json.load(open(PATH))
old_tribes = {t['name']: t for t in doc['tribes']}

# The old notes were written for the five Forde & Jones divisions. They are kept,
# because they say where each division sits in the sources and that is worth
# keeping, and the owner's own wording is added alongside.
CARRY = {
    'Northern Igbo (Wawaa)': 'Northern Igbo',
    'Southern Igbo (Isu-Urata)': 'Southern Igbo',
    'Cross River Igbo (Aro)': 'Eastern Igbo',
    'Northeast Igbo (Ogu Ukwu)': 'North-Eastern Igbo',
    'Western Igbo (Anioma)': 'Western Igbo',
    'Riverine Igbo (Oru)': 'Western Igbo',
}

divisions = []
for entry in doc['_classification']['divisions']:
    name = entry['name']
    carried = old_tribes.get(CARRY[name], {}).get('note', '')
    note = carried
    if name == 'Riverine Igbo (Oru)':
        note = (
            carried
            + ' Forde & Jones treat the riverain Igbo, who call themselves Oru, as one of the '
              'Western Igbo groups; the classification this registry follows gives them a division '
              'of their own.'
        )
    divisions.append({
        'name': name,
        'tribes': entry['tribes'],
        'keyAreas': entry['keyAreas'],
        'note': note,
    })

doc['divisions'] = divisions
del doc['tribes']

for clan in doc['clans']:
    clan['tribe'] = clan.get('_division')
for name, _old, division, _eg in report:
    pass

# The mapping is recomputed here because `report` was produced above from the file
# as it was before `tribe` was overwritten.
by_name = {}
for clan in doc['clans']:
    by_name[clan['name']] = clan

mapping = {}
for clan in doc['clans']:
    mapping[clan['name']] = None
