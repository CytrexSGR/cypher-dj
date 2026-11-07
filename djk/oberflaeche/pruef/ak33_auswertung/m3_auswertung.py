# AK33 M3: onset of each layer against the PROJECT GRID in the export (export starts on beat 64 = sample 0, grid period 60/128 s), and of the SOURCE against its own warp grid.
# onset = steepest rise of the folded band envelope (quelle_phase.anstieg), window -60..+120 ms around the grid line. Same function for source and export.
import sys, json, numpy as np
sys.path.insert(0, __import__('os').path.dirname(__file__))
import quelle_phase as Q
T = 60/128
BANDEN = [('hi 2-8k', 2000, 8000), ('mid 100-600', 100, 600), ('low 40-120', 40, 120)]
def zeile(pfad, name):
    x = Q.lies(pfad); r = {}
    for b, lo, hi in BANDEN: r[b] = round(Q.anstieg(x, 0.0, T, lo, hi)[0], 2)
    return name, r
if __name__ == '__main__':
    ordner = sys.argv[1]; muster = sys.argv[2:]
    for m in muster:
        n, r = zeile(f'{ordner}/{m}.wav', m); print(f'{n:28}', '  '.join(f'{k} {v:+7.2f}' for k, v in r.items()))
