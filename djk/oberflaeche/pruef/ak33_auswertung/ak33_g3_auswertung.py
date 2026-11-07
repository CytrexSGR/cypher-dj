# AK33 G3: layer exports against a reference layer on the project grid (export starts on a bar line), per beat subset, band and threshold.
# usage: ak33_g3_auswertung.py <ref.wav> <cmp.wav>[:<expected shift ms against the first cmp>] ... [--bpm 128] [--beats 31] [--json out.json]
#   difference = comparison minus reference (positive = comparison later). With an expected shift on every cmp after the first, the deltas against the first cmp are printed
#   next to it: that is the calibration (a known shift of the same sound must be read back in every cell).
import json, sys
import numpy as np
import ak33_versatz as v


def haupt(argv):
    bpm = float(argv[argv.index('--bpm') + 1]) if '--bpm' in argv else 128.0
    n = int(argv[argv.index('--beats') + 1]) if '--beats' in argv else 31
    sk = {'--bpm', '--beats', '--json'}; pos = [a for i, a in enumerate(argv) if a not in sk and (i == 0 or argv[i - 1] not in sk)]
    ref = pos[0]; cmps = [(c.split(':')[0], float(c.split(':')[1]) if ':' in c else None) for c in pos[1:]]
    g = np.arange(n) * 60 / bpm
    xr = v.lies(ref); out = {'ref': ref, 'bpm': bpm, 'beats': n, 'laeufe': {}}
    tref = {tn: v.einsaetze_tabelle(xr, g, teil=f) for tn, f in v.TEILMENGEN.items()}
    basis = None
    for pfad, erw in cmps:
        xc = v.lies(pfad); name = pfad.split('/')[-1]; zeile = {}
        print(f'== {name}' + (f' (expected shift against the first comparison: {erw:+.1f} ms)' if erw is not None else ''))
        for tn, f in v.TEILMENGEN.items():
            d = v.differenz(tref[tn], v.einsaetze_tabelle(xc, g, teil=f)); zeile[tn] = d
            for b in v.BANDEN:
                med = [d[(b, a)]['median'] for a in v.ANTEILE]; n_ = d[(b, 0.5)]['n']
                s = f'  {tn:9} {b:13} ' + '  '.join(f'{int(a * 100)}%: {m:+7.2f}' for a, m in zip(v.ANTEILE, med)) + f'   n {n_}'
                if basis is not None and erw is not None:
                    dl = [d[(b, a)]['median'] - basis[tn][(b, a)]['median'] for a in v.ANTEILE]
                    s += '   delta vs first: ' + ' '.join(f'{x:+6.2f}' for x in dl) + f'   (max |delta - expected| {max(abs(x - erw) for x in dl):.2f})'
                print(s)
            r = v.bereich(d)    # all bands, nothing filtered out (review of G3: the low band was silently dropped here before)
            print(f'  {tn:9} range over ALL bands, all thresholds: {r["min"]:+.2f} ({r["min_bei"]}) .. {r["max"]:+.2f} ({r["max_bei"]})')
        print('  range per band over all thresholds and beat sets:')
        for z in v.bereichsbericht(zeile): print('    ' + z)
        if basis is None: basis = zeile
        out['laeufe'][name] = {tn: {f'{b}@{int(a * 100)}': {k: o[k] for k in ('median', 'p10', 'p90', 'n')} for (b, a), o in d.items()} for tn, d in zeile.items()}
    if '--json' in argv: json.dump(out, open(argv[argv.index('--json') + 1], 'w'), indent=1)


if __name__ == '__main__':
    haupt(sys.argv[1:])
