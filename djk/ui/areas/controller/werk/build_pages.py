#!/usr/bin/env python3
"""Builds the factory controller presets of the Baukasten synths from their panel files: a list of PROGRAMS per synth for the Launch Control 3.

A program is what the 16 encoders and 8 buttons drive at one time; Page up/down on the device steps through the programs and the device window
shows the panel page (MAIN, MOD, FX ...) the program belongs to. Rule, so that a program can be read off the panel: the boxes (sections) of a page
are taken in reading order (rows of the layout top to bottom, sections left to right) and whole boxes fill a program until the next box would not
fit (more than 16 knobs or more than 8 selectors); then the next program starts. A box never straddles the two rows of eight encoders: one
that would cross from encoder 8 to 9 starts at 9 and the encoders before it stay free. Inside a program the knobs and faders go to encoders 1..16 and the
selectors and switches to buttons 1..8, both in reading order; a button steps its selector (`stufen` = number of options). A box that alone has
more than 16 knobs is cut into runs of 16.
synth-mono comes out as Andreas asked on 2026-11-18: 1 = Oscillators 1..3, Mixer 4..7, Filter 9..13, Tune 14..15; 2 = Filter env, Amp env, LFO, Voice, Amp; 3 = the MOD
page; 4 = the FX page. The LPD8 gets no entries for these synths (a file without entries, so its place does not fall back to the default bank).
`eintraege` is program 1; `seiten` holds the first program of every page for a place that knows a page but no program.

Usage: build_pages.py [graph ...]   (default: every graph in GRAPHEN). Writes werk/lc3/<graph>.json and werk/lpd8/<graph>.json next to this file.
"""
import json, os, sys

HIER = os.path.dirname(os.path.abspath(__file__))
PANEELE = os.path.join(HIER, '..', '..', '..', '..', 'instruments', 'modular_dsp', 'paneele')
GRAPHEN = ['synth-mono', 'synth-poly', 'synth-neuro', 'wavetable-reese', 'wavetable-supersaw', 'wavetable-chor']
DREH_MAX, TASTEN_MAX, REIHE = 16, 8, 8   # encoders, buttons, encoders per row
LEER = ['lpd8']   # devices that get a file without entries


def nr(c):
    p = (c.get('bind') or {}).get('param') if isinstance(c.get('bind'), dict) else None
    return int(p[1:]) if isinstance(p, str) and p[:1] == 'k' and p[1:].isdigit() else None


def boxen_von(panel):
    """[(page id, box title, [knob numbers], [(selector knob number, positions)])] in reading order; boxes without controls are left out."""
    seiten = [s['id'] for s in panel.get('pages', [])] or ['main']
    reihen = (panel.get('layout') or {}).get('rows')
    sek = {s['id']: s for s in panel['sections']}
    folge = [sid for r in reihen for sid in r] if reihen else []
    folge += [s['id'] for s in panel['sections'] if s['id'] not in folge]
    aus, gesehen = [], set()
    for seite in seiten:
        for sid in folge:
            s = sek.get(sid)
            if not s or s.get('page', seiten[0]) != seite:
                continue
            dreh, wahl = [], []
            for c in s['controls']:
                if c['type'] == 'xy':   # a pad: its two axes are two knobs
                    for achse in ('x', 'y'):
                        k = nr({'bind': (c.get('bind') or {}).get(achse)})
                        if k is not None and k not in gesehen:
                            gesehen.add(k); dreh.append(k)
                    continue
                k = nr(c)
                if k is None or k in gesehen:
                    continue
                if c['type'] in ('knob', 'fader'):
                    gesehen.add(k); dreh.append(k)
                elif c['type'] in ('selector', 'switch', 'lever'):
                    gesehen.add(k); wahl.append((k, max(2, min(16, len(c.get('options') or []) or 2))))
            if dreh or wahl:
                aus.append((seite, s.get('title') or sid, dreh, wahl))
    return aus


def programme_von(panel):
    """[{name, seite, dreh: [knob], wahl: [(knob, positions)]}]: whole boxes per program, a new program at every page."""
    aus, lauf = [], None
    def schluss():
        nonlocal lauf
        if lauf and (lauf['dreh'] or lauf['wahl']):
            aus.append({'name': ' · '.join(lauf['titel'])[:60], 'seite': lauf['seite'], 'dreh': lauf['dreh'], 'wahl': lauf['wahl'][:TASTEN_MAX]})
        lauf = None
    for seite, titel, dreh, wahl in boxen_von(panel):
        stuecke = [dreh[i:i + DREH_MAX] for i in range(0, len(dreh), DREH_MAX)] or [[]]
        for n, stueck in enumerate(stuecke):
            w = wahl if n == 0 else []
            # a box does not straddle the two rows of eight encoders: one that would cross from encoder 8 to 9 starts at 9 (None = a free encoder)
            def start_von(belegt):
                return REIHE if belegt < REIHE and belegt + len(stueck) > REIHE and len(stueck) <= REIHE else belegt
            if lauf and (lauf['seite'] != seite or start_von(len(lauf['dreh'])) + len(stueck) > DREH_MAX or len(lauf['wahl']) + len(w) > TASTEN_MAX):
                schluss()
            if lauf is None:
                lauf = {'seite': seite, 'titel': [], 'dreh': [], 'wahl': []}
            if titel not in lauf['titel']:
                lauf['titel'].append(titel)
            lauf['dreh'] += [None] * (start_von(len(lauf['dreh'])) - len(lauf['dreh'])) + stueck
            lauf['wahl'] += w
    schluss()
    return aus


def baue(graph):
    panel = json.load(open(os.path.join(PANEELE, f'{graph}.json')))
    programme = []
    for p in programme_von(panel):
        eintraege = [{'regler': f'Enc {i + 1}', 'knopf': k} for i, k in enumerate(p['dreh']) if k is not None]
        eintraege += [{'regler': f'Btn {i + 1}', 'knopf': k, 'stufen': n} for i, (k, n) in enumerate(p['wahl'])]
        programme.append({'name': p['name'], 'seite': p['seite'], 'eintraege': eintraege})
    seiten = {}
    for p in programme:
        seiten.setdefault(p['seite'], p['eintraege'])
    kopf = lambda modell: {'schema': 1, 'name': graph, 'modell': modell, 'art': 'instrument', 'graph': graph}
    dateien = {'lc3': {**kopf('lc3'), 'eintraege': programme[0]['eintraege'] if programme else [], 'seiten': seiten, 'programme': programme}}
    for modell in LEER:
        dateien[modell] = {**kopf(modell), 'eintraege': []}
    for modell, preset in dateien.items():
        ziel = os.path.join(HIER, modell, f'{graph}.json')
        os.makedirs(os.path.dirname(ziel), exist_ok=True)
        text = json.dumps(preset, separators=(',', ':'))
        for feld in ('"eintraege":[{"regler":"Enc 1"', '"seiten":', '"programme":', '{"name":'):
            text = text.replace(feld, '\n' + feld)
        with open(ziel, 'w') as f:
            f.write(text + '\n')
    print(graph, [(p['name'], p['seite'], sum(1 for e in p['eintraege'] if e['regler'].startswith('Enc')), sum(1 for e in p['eintraege'] if e['regler'].startswith('Btn'))) for p in programme])


if __name__ == '__main__':
    for g in sys.argv[1:] or GRAPHEN:
        baue(g)
