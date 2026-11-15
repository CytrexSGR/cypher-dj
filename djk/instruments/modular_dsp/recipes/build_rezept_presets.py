#!/usr/bin/env python3
"""Read demos/recipes/MANIFEST.json and write patches/recipes-patches.json: one preset entry per recipe graph.
build_factory_presets.py turns the entries into factory presets. Usage: build_rezept_presets.py [output file]

Each entry: graph, name, knobs (every knob of the graph at its start position), beschreibung, notiz, datum.
Eight character words of the manifest are outside the closed vocabulary v2; they are mapped to a word that is inside and the
original stays in `notiz` (no new vocabulary word: that is a decision of the product owner, presets/DECISIONS.md F9)."""
import json
import os
import sys

HIER = os.path.dirname(os.path.abspath(__file__))
MOD = os.path.dirname(HIER)
REZEPTE = os.path.join(MOD, 'demos', 'recipes')
DATUM = '2026-11-15'
VOKABULAR = os.path.join(MOD, '..', '..', 'ui', 'presets', 'vokabular.json')
GEGENSAETZE = json.load(open(VOKABULAR))['inhalt']['gegensaetze']
# use words of the manifest outside the vocabulary: both name the main section of a loop or a line, which is a drop
EINSATZ = {'groove': 'drop', 'melody': 'drop'}

ABBILD = {'sub': 'deep', 'harsh': 'aggressive', 'nasal': 'thin', 'digital': 'clean',
          'analog': 'warm', 'boxy': 'dark', 'boomy': 'thick', 'heavy': 'thick'}


def start_stellung(graph):
    """Start position per knob: `vorgabe` of the first `regler` node of a number in document order, 0.5 where none."""
    pos = {}
    for k in graph['knoten']:
        if k['art'] == 'regler' and int(k['nr']) not in pos:
            pos[int(k['nr'])] = float(k.get('vorgabe', 0.5))
    return pos


def eintraege():
    manifest = json.load(open(os.path.join(REZEPTE, 'MANIFEST.json')))
    out = []
    for p in manifest['patches']:
        graph = p['datei'][:-5]
        g = json.load(open(os.path.join(REZEPTE, p['datei'])))
        start = start_stellung(g)
        knobs = {str(int(n)): start.get(int(n), 0.5) for n in g['regler_namen']}
        b = p['beschreibung']
        char, verworfen = [], []
        for w in b['charakter']:
            m = ABBILD.get(w, w)
            if m in char:
                continue
            if any([m, c] in GEGENSAETZE or [c, m] in GEGENSAETZE for c in char):
                verworfen.append(w)   # the vocabulary forbids opposites in one description: the word named first stays
                continue
            char.append(m)
        einsatz = []
        for w in b['einsatz']:
            if EINSATZ.get(w, w) not in einsatz:
                einsatz.append(EINSATZ.get(w, w))
        notiz = f"Source rule: recipe card `{p['karte']}`, {p['zitat']}. Measured by `tests/rezepte.rs`, not yet heard."
        ersetzt = [w for w in b['charakter'] if w in ABBILD]
        if ersetzt:
            notiz += ' Manifest character words outside the vocabulary: ' + ', '.join(f'{w} (as {ABBILD[w]})' for w in ersetzt) + '.'
        if verworfen:
            notiz += ' Dropped as the opposite of an earlier word: ' + ', '.join(verworfen) + '.'
        ersetzt_e = [w for w in b['einsatz'] if w in EINSATZ]
        if ersetzt_e:
            notiz += ' Manifest use words outside the vocabulary: ' + ', '.join(f'{w} (as {EINSATZ[w]})' for w in ersetzt_e) + '.'
        out.append({'graph': graph, 'name': p['titel'][0].upper() + p['titel'][1:], 'knobs': knobs,
                    'beschreibung': {'art': b['art'], 'unterart': b['unterart'], 'charakter': char, 'genre': [],
                                     'einsatz': einsatz, 'energie': b['energie'], 'text': b['text']},
                    'notiz': notiz, 'datum': DATUM})
    return out


if __name__ == '__main__':
    ziel = sys.argv[1] if len(sys.argv) > 1 else os.path.join(MOD, 'patches', 'recipes-patches.json')
    e = eintraege()
    open(ziel, 'w').write(json.dumps(e, indent=1, ensure_ascii=False) + '\n')
    print(len(e), 'recipe presets in', ziel)
