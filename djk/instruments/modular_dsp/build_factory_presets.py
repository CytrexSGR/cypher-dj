#!/usr/bin/env python3
"""Turn the agents' patch files into factory presets (factory/modular/<slug>.preset.json). Usage: build_factory_presets.py <werk dir> [patch dir]"""
import json, re, sys, os
M = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), 'patches')
# name -> (art, unterart, charakter, genre, einsatz, energie)
B = {
 'drums-909': {
  'Berlin Techno': ('drums','kit',['punchy','dark','dirty'],['techno','minimal'],['drop'],4),
  'DnB Tight': ('drums','kit',['tight','punchy','bright'],['dnb','breaks'],['drop'],4),
  'Goa': ('drums','kit',['punchy','bright','tight'],['trance','progressive'],['drop','build'],4),
  'House Classic': ('drums','kit',['warm','punchy','clean'],['house','deep_house','disco'],['drop','intro'],3),
  'Zap Kit': ('drums','kit',['aggressive','bright','dirty'],['techno','electro'],['build','transition'],4),
  'Hard Industrial': ('drums','kit',['aggressive','dirty','thick'],['techno','hardstyle'],['drop'],5),
  'Dusty Boom Bap': ('drums','kit',['warm','soft','dirty'],['breaks','downtempo'],['intro','breakdown'],2),
  'Rave Stab Toms': ('drums','kit',['punchy','bright','aggressive'],['techno','breaks'],['build','drop'],4)},
 'drums-808': {
  'Classic 808': ('drums','kit',['warm','deep','clean'],['electro','house'],['drop','intro'],3),
  'Long Boom': ('drums','kit',['deep','thick','smooth'],['dubstep','downtempo'],['drop','breakdown'],3),
  'Miami Bass': ('drums','kit',['deep','punchy','bright'],['electro','breaks'],['drop'],4),
  'Trap': ('drums','kit',['deep','tight','dark'],['dubstep','downtempo'],['drop'],3),
  'Electro Clave': ('drums','kit',['tight','bright','clean'],['electro','minimal'],['drop','intro'],3),
  'Tape Lo-fi': ('drums','kit',['warm','soft','dirty'],['downtempo','ambient'],['intro','breakdown'],1),
  'Zap Kit': ('drums','kit',['aggressive','bright','dirty'],['electro','techno'],['build','transition'],4),
  'Tight Funk': ('drums','kit',['tight','punchy','dry'],['disco','house','breaks'],['drop'],3)},
 'synth-mono': {
  'Acid 303': ('bass','acid',['aggressive','bright','tight'],['acid','techno'],['drop','build'],4),
  'Rolling Techno Bass': ('bass','rolling',['dark','deep','punchy'],['techno','minimal'],['drop'],4),
  'MS-20 Screamer': ('lead','mono',['aggressive','dirty','bright'],['techno','electro'],['drop','build'],5),
  'Goa Lead': ('lead','mono',['bright','evolving','aggressive'],['trance','progressive'],['drop','build'],4),
  'DnB Sub': ('bass','sub',['deep','clean','mono'],['dnb','dubstep'],['drop'],3),
  'House Bass': ('bass','analog',['warm','punchy','smooth'],['house','deep_house'],['drop','intro'],3),
  'Sync Lead': ('lead','sync',['bright','aggressive','thin'],['electro','trance'],['drop','build'],4),
  'Hoover Growl': ('bass','reese',['aggressive','thick','dirty'],['techno','hardstyle','dnb'],['drop'],5),
  'Evolving Lead': ('lead','mono',['evolving','bright','wide'],['trance','progressive'],['build','drop'],4),
  'Dub Bass': ('bass','analog',['warm','deep','wide'],['house','deep_house'],['drop','intro'],3)},
 'synth-poly': {
  'Trance Supersaw': ('lead','supersaw',['wide','bright','thick'],['trance','progressive'],['drop','build'],4),
  'Goa Lead Stack': ('lead','supersaw',['bright','aggressive','wide'],['trance'],['drop'],5),
  'House Chord Stab': ('pluck','stab',['punchy','warm','tight'],['house','deep_house','garage'],['drop','intro'],3),
  'Juno Pad': ('pad','analog',['warm','wide','soft'],['deep_house','ambient'],['breakdown','intro'],1),
  'DnB Atmosphere': ('pad','atmosphere',['dark','wide','evolving'],['dnb','ambient'],['breakdown','intro'],2),
  'Pluck': ('pluck','synth',['bright','tight','clean'],['progressive','house','trance'],['drop','build'],3),
  'Brass': ('lead','poly',['bright','punchy','thick'],['house','disco'],['drop'],4),
  'Detroit Strings': ('pad','strings',['warm','wide','smooth'],['techno','deep_house'],['breakdown','intro'],2)},
 'synth-neuro': {
  'Classic Reese': ('bass','reese',['dark','thick','wide'],['dnb'],['drop','breakdown'],4),
  'Neuro Growl': ('bass','reese',['aggressive','dirty','evolving'],['dnb','dubstep'],['drop'],5),
  'Talking Bass': ('bass','wobble',['evolving','dirty','punchy'],['dnb','dubstep'],['drop'],4),
  'Notch Sweep': ('bass','reese',['evolving','dark','smooth'],['dnb','techno'],['build','drop'],3),
  'Fold Scream': ('bass','reese',['aggressive','bright','dirty'],['dnb','dubstep'],['drop'],5),
  'Techno Rumble Bass': ('bass','rolling',['dark','deep','thick'],['techno'],['drop','intro'],3),
  'Goa Zap': ('fx','texture',['bright','aggressive','metallic'],['trance','progressive'],['build','transition'],4),
  'Sub only': ('bass','sub',['deep','clean','mono'],['dnb','techno','dubstep'],['drop'],2)},
}
ziel = os.path.join(sys.argv[1], 'modular'); os.makedirs(ziel, exist_ok=True)
n = 0
for graph, tab in B.items():
    for p in json.load(open(f'{M}/{graph}-patches.json')):
        if p['name'] not in tab: continue   # presets of the synth build-out come from baue_ausbau_presets_<synth>.py
        art, unter, char, genre, eins, en = tab[p['name']]
        slug = f"{graph}-" + re.sub(r'[^a-z0-9]+', '-', p['name'].lower()).strip('-')
        text = re.split(r'(?<=[.!?])\s', p['beschreibung'].strip())[0].rstrip('.')
        while len(text) > 158:
            cut = max(text.rfind(';', 0, 158), text.rfind(',', 0, 158))
            text = text[:cut] if cut > 20 else text[:158].rsplit(' ', 1)[0]
        text = text.rstrip(' ,;:') + '.'
        doc = {'schema': 1, 'name': f"{graph.split('-',1)[1].upper() if graph.startswith('drums') else graph.split('-')[1].capitalize()} {p['name']}",
               'geraet_typ': 'instrument', 'geraet': 'baukasten', 'graph': graph,
               'werte': {f'knob{int(k)}': round(float(v), 4) for k, v in sorted(p['knobs'].items(), key=lambda kv: int(kv[0]))},
               'beschreibung': {'art': art, 'unterart': unter, 'charakter': char, 'genre': genre, 'einsatz': eins, 'energie': en, 'text': text},
               'tags': [graph], 'notiz': 'Measured by level and pitch on render, not yet heard (2026-11-11).',
               'angelegt': '2026-11-11T00:00:00.000Z', 'geaendert': '2026-11-11T00:00:00.000Z'}
        open(os.path.join(ziel, slug + '.preset.json'), 'w').write(json.dumps(doc, indent=1, ensure_ascii=False) + '\n'); n += 1
print(n, 'presets in', ziel)
