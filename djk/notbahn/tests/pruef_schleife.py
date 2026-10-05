#!/usr/bin/env python3
"""Scheibe 10: prüft einen Lauf von tests/lauf.sh am Ziel (Aufnahme der Prüf-Senke) gegen das Raster des Ringschreibers.
Aufruf: python3 pruef_schleife.py <laufordner> [--art schleife|ruhe|rueckgabe|nan] -> je Prüfung OK/FEHLT, dann GRÜN/ROT.
Zeitachse ist w (Ring-Frames): der erste Klick der Aufnahme ist der erste Klick im Log des Schreibers."""
import json, sys
from pathlib import Path
import numpy as np
from scipy.io import wavfile

O = Path(sys.argv[1])
ART = sys.argv[sys.argv.index('--art') + 1] if '--art' in sys.argv else 'schleife'
RATE = 48000
lauf = json.loads((O / 'lauf.json').read_text())


def schreiber_log(pfad):
    start, klicks, takte = None, [], []
    for z in pfad.read_text().split('start w')[1].splitlines() if 'start w' in pfad.read_text() else []:
        z = z if not z[:1].isdigit() else 'start w ' + z
        t = z.split()
        if t[:2] == ['start', 'w']: start = start if start is not None else int(t[2])
        elif t[0] == 'klick': klicks.append(int(t[1]))
        elif t[0] == 'takt': takte.append(int(t[1]))
    return (klicks[0] if klicks else start), klicks, takte   # Ursprung = erster Klick (s_lauf 0); 'start w' kommt einen Zyklus später


def raster(w0, bpm0, bpm1, rampe_takte, n):
    """Klick-Frames des Schreibers, gleiche Rechnung wie ring_schreiber.c (phase += bpm/(60*RATE) je Sample)."""
    s = np.arange(n, dtype=np.float64)
    if rampe_takte > 0:
        rf = rampe_takte * 4.0 * 60.0 * RATE / ((bpm0 + bpm1) / 2.0)
        bpm = np.where(s < rf, bpm0 + (bpm1 - bpm0) * s / rf, bpm1)
    else:
        bpm = np.full(n, bpm0)
    phase = np.cumsum(bpm / (60.0 * RATE))
    schlag = np.floor(phase)
    k = np.concatenate([[0], np.nonzero(np.diff(schlag))[0] + 1])
    return w0 + k


rate, x = wavfile.read(O / 'aufnahme.wav')
L = x[:, 0].astype(np.float64)
w0, log_klicks, _ = schreiber_log(O / 'schreiber.log')
ergebnis, ok_alle = {}, True


def pruefe(name, ok, ist, soll=''):
    global ok_alle
    ok_alle &= bool(ok)
    print(('OK   ' if ok else 'FEHLT'), name, '| ist', ist, ('| soll ' + str(soll)) if soll != '' else '')
    ergebnis[name] = {'ok': bool(ok), 'ist': str(ist)}


pos = np.nonzero(np.abs(L) > 0.25)[0]
pruefe('keine NaN in der Aufnahme', not np.isnan(L).any(), int(np.isnan(L).sum()), 0)
pruefe('Spitze höchstens 1', float(np.nanmax(np.abs(L))) <= 1.0, round(float(np.nanmax(np.abs(L))), 3))
if ART == 'nan':
    json.dump(ergebnis, open(O / 'pruefung.json', 'w'), indent=1)
    print('GRÜN' if ok_alle else 'ROT'); sys.exit(0 if ok_alle else 1)
# Die Aufnahme beginnt nach dem Schreiber: der erste aufgenommene Klick ist Log-Klick k, gewählt nach den meisten
# genauen Treffern (Aufnahme-Index = w + versatz)
logset = set(log_klicks)
versatz = max((int(pos[0]) - l for l in log_klicks), key=lambda v: sum(int(p) - v in logset for p in pos))
kw = [int(p) - versatz for p in pos]
kern = [k for k in kw if k <= log_klicks[-1]]
nach = [k for k in kw if k > log_klicks[-1]]
erwartet = [l for l in log_klicks if l >= kern[0]] if kern else []
pruefe('Kern-Klicks der Aufnahme = Log des Schreibers (ab Aufnahmebeginn)', kern == erwartet,
       f'{len(kern)} von {len(erwartet)}')
if ART == 'ruhe':
    pruefe('keine Klicks außer denen des Schreibers', len(nach) == 0, len(nach), 0)
elif ART != 'rueckgabe':
    a = lauf['args']
    r = raster(w0, a['bpm'], a.get('bpm_bis', a['bpm']), a.get('rampe_takte', 0),
               int(nach[-1] - w0 + RATE) if nach else int(len(L)))
    r_nach = r[r > log_klicks[-1]]
    abw = [int(k - r_nach[np.argmin(np.abs(r_nach - k))]) for k in nach]
    n8 = [d for d, k in zip(abw, nach) if k < log_klicks[-1] + 8 * 4 * 60 * RATE / a['bpm']]
    ergebnis['abweichung_je_klick'] = abw
    grenze = 1 if a.get('rampe_takte', 0) == 0 else None
    if grenze is not None:
        pruefe('Schleifen-Klicks 8 Takte lang auf dem Raster ±1', len(n8) >= 31 and max(map(abs, n8)) <= grenze,
               f'{len(n8)} Klicks, max |Abw| {max(map(abs, n8)) if n8 else None}', '>= 31 Klicks, ±1')
    else:
        print('INFO  Rampe: Abweichung je Klick', abw[:40])
if ART == 'rueckgabe':
    # zweiter Schreiber: seine Klicks relativ zum ersten; in der Aufnahme den Versatz mit den meisten Treffern suchen
    teile = (O / 'schreiber.log').read_text().split('start w')
    neu = [int(z.split()[1]) for z in teile[-1].splitlines() if z.startswith('klick')]
    rel = [k - neu[0] for k in neu]
    alle = set(int(p) for p in pos)
    kill_idx = log_klicks[-1] + versatz        # letzter Kern-Klick vor dem Kill, Aufnahme-Index
    o = max((int(p) for p in pos if p > kill_idx), key=lambda c: sum((c + d) in alle for d in rel))
    treffer = sum((o + d) in alle for d in rel if o + d < len(L))
    pruefe('Kern nach Neustart in der Aufnahme gefunden', treffer >= 10, treffer, '>= 10')
    satz = set(o + d for d in rel)
    # ±1 wie beim Raster: ein Klick von 35 kam im Lauf t4_rueckgabe 1 Sample später an als im Log, bei stiller Notbahn
    fremd = [int(p) - o for p in pos if int(p) > o + 3 * 256 and not ({int(p) - 1, int(p), int(p) + 1} & satz)]
    pruefe('nach der Rückgabe nur noch Kern-Klicks (Schleife höchstens 2 Blöcke + 256 Samples)', not fremd, fremd[:5], [])
    ergebnis['schleife_klicks_nach_neustart'] = [int(p) - o for p in pos if o <= int(p) <= o + 3 * 256 and int(p) not in satz]
    for p in (O / 'notbahn.log').read_text().splitlines():
        if p.startswith('zustand'): print('INFO ', p)
json.dump(ergebnis, open(O / 'pruefung.json', 'w'), indent=1)
print('GRÜN' if ok_alle else 'ROT')
sys.exit(0 if ok_alle else 1)
