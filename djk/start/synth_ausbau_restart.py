#!/usr/bin/env python3
"""Snapshot and restore of the loaded Baukasten graphs and their knob rows around the core restart of the 64-knob build-out.

The core does not restore graphs loaded at runtime, and maybe not the current rows (kanban t_e998388c). Usage:
  synth_ausbau_restart.py snapshot <file>   # against the OLD page server: GET /graphen (.geladen) and the rows of /lage
  synth_ausbau_restart.py restore <file>    # against the NEW page server: per channel rows 1..64 first, then the graph
Restore follows the project restore order: rows before graph, and the graph load with vorgaben: false so it does not overwrite them.
Rows the snapshot lacks get the graph's own vorgabe (GET /graphen/panel). It never starts or stops a unit.
"""
import json, sys, urllib.parse, urllib.request

BASIS = 'http://127.0.0.1:47300'
KNOEPFE = 64


def http(basis, pfad, koerper=None):
    req = urllib.request.Request(basis + pfad, data=None if koerper is None else json.dumps(koerper).encode(),
                                 headers={'x-djk-quelle': 'cypher', 'content-type': 'application/json'},
                                 method='GET' if koerper is None else 'POST')
    with urllib.request.urlopen(req, timeout=10) as r:
        t = r.read().decode()
    return json.loads(t) if t else None


def snapshot(basis=BASIS):
    geladen = {k: v for k, v in (http(basis, '/graphen').get('geladen') or {}).items() if v}
    regler = http(basis, '/lage').get('regler') or {}
    kanaele = {}
    for kanal, graph in sorted(geladen.items()):
        zeilen = {}
        for n in range(1, KNOEPFE + 1):
            w = regler.get(f'{kanal}/bk/{n}')
            if isinstance(w, (int, float)):
                zeilen[str(n)] = w
        kanaele[kanal] = {'graph': graph, 'regler': zeilen}
        print(f'snapshot {kanal}: {graph}, {len(zeilen)} rows')
    return {'kanaele': kanaele}


def vorgaben(basis, graph):
    r = http(basis, '/graphen/panel?name=' + urllib.parse.quote(graph)) or {}
    bereiche = r.get('regler') or {}
    return {int(n): float(b.get('vorgabe', 0.5)) for n, b in bereiche.items()}


def restore(stand, basis=BASIS):
    for kanal, e in sorted(stand['kanaele'].items()):
        graph, zeilen = e['graph'], e['regler']
        v = vorgaben(basis, graph)
        gesendet = 0
        for n in range(1, KNOEPFE + 1):
            w = zeilen.get(str(n))
            if w is None:
                w = v.get(n, 0.5)
            http(basis, '/regler', {'pfad': f'{kanal}/bk/{n}', 'nach': w, 'ab': 'jetzt'})
            gesendet += 1
        antwort = http(basis, '/graph', {'kanal': kanal, 'name': graph, 'vorgaben': False})
        print(f'restore {kanal}: {gesendet} rows ({len(zeilen)} from the snapshot), graph {graph} -> {json.dumps(antwort)[:120]}')


def main(argv):
    if len(argv) != 3 or argv[1] not in ('snapshot', 'restore'):
        print(__doc__); return 2
    if argv[1] == 'snapshot':
        with open(argv[2], 'w') as f:
            json.dump(snapshot(), f, indent=1)
    else:
        with open(argv[2]) as f:
            restore(json.load(f))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
