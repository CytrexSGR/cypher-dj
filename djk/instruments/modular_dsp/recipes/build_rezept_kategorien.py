#!/usr/bin/env python3
"""Add the 46 recipe graphs to kategorien.json (category, synthesis type `prinzip` and a text of at most 90 characters per instrument graph).
Usage: build_rezept_kategorien.py [kategorien.json]

The category comes from the name prefix of the graph file, the prinzip from the node types of the graph (see prinzip()), the text from the manifest sentence (cut at a clause end when it is
longer than 90 characters). Existing entries keep their place and content; the recipe entries are replaced in place or appended."""
import json
import os
import re
import sys

HIER = os.path.dirname(os.path.abspath(__file__))
MOD = os.path.dirname(HIER)
TEXT_MAX = 90

# prefix of the graph name -> id of kategorien.json (the picker's groups: drums, bass, lead, pad, keys, textur)
KATEGORIE = {'bass': 'bass', 'lead': 'lead', 'pad': 'pad', 'keys': 'keys',
             'pluck': 'keys',        # synth pluck, mallet, string, stab: the existing plucked and struck graphs (saite-*, fm-glocke) are keys
             'drums': 'drums',
             'percussion': 'drums',  # tom, conga, shaker, rim, metallic: resonator-conga and metall-hihat are drums
             'fx': 'textur'}         # riser, downlifter, impact, noise, texture: labor and granular-textur are textur


# Synthesis type by the node types of the graph, first match wins (plan 2026-11-18-instrument-picker-by-type). A recipe has no fm, granular or
# sampler node today, so in practice: drums category, wavetable node, else analog; the other rules keep the table total for a future recipe.
QUELLEN_PHYSIK = ('saite', 'resonator', 'kamm')
# Decided by hand where the node types miss the sound: these two build FM from sine operators (no fm node), and a person looks for them under FM.
PRINZIP_FEST = {'bass-fm': 'fm', 'lead-fm': 'fm'}


def prinzip(kategorie, arten):
    if kategorie == 'drums':
        return 'drums'
    for art, p in (('fm', 'fm'), ('granular', 'granular'), ('sampler', 'sampler')):
        if art in arten:
            return p
    if any(a in arten for a in QUELLEN_PHYSIK):
        return 'physik'
    return 'wavetable' if 'wavetable' in arten else 'analog'


SCHNITT = re.compile(r"(?<!\d)[,;:](?!\d)| (?=(?:that|whose|which|with|into|under|through|over|and|at|by|for|then|plus) )")


def kurztext(text):
    """The sentence itself when it fits, else the longest part that ends before a clause mark (, ; :, not inside a number) or before a
    connecting word (that, with, into ...), so the text never ends on a dangling word."""
    text = text.strip().rstrip('.')
    if len(text) + 1 <= TEXT_MAX:
        return text + '.'
    stellen = [m.start() for m in SCHNITT.finditer(text) if 30 <= m.start() <= TEXT_MAX - 1]
    if not stellen:
        raise ValueError('no clause end between 30 and 89 characters: ' + text)
    return text[:max(stellen)].rstrip(' ,;:') + '.'


def eintraege():
    manifest = json.load(open(os.path.join(MOD, 'demos', 'recipes', 'MANIFEST.json')))['patches']
    aus = {}
    for p in manifest:
        kategorie = KATEGORIE[p['datei'].split('-', 1)[0]]
        arten = {k['art'] for k in json.load(open(os.path.join(MOD, 'demos', 'recipes', p['datei'])))['knoten']}
        name = p['datei'][:-5]
        aus[name] = {'kategorie': kategorie, 'prinzip': PRINZIP_FEST.get(name) or prinzip(kategorie, arten), 'text': kurztext(p['beschreibung']['text'])}
    return aus


if __name__ == '__main__':
    ziel = sys.argv[1] if len(sys.argv) > 1 else os.path.join(MOD, 'kategorien.json')
    kat = json.load(open(ziel))
    kat.update(eintraege())   # dict.update keeps the place of an existing key and appends new ones
    open(ziel, 'w').write(json.dumps(kat, indent=1, ensure_ascii=False) + '\n')
    print(len(eintraege()), 'recipe categories in', ziel)
