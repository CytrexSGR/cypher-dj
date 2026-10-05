#!/usr/bin/env python3
"""Task 8: Knack-Metrik aus Dossier 04 an den Schaltrampen des Kanalzugs.

Metrik wie proben/04-mixer-effekte/messung.py (bereich_spitze_db, von der Keylock-Werkbank
tests/stretch-bench/analyse.py umschalt_spitze_db): Hochpass > 5 kHz, Butterworth 4. Ordnung,
nullphasig; Spitze im Fenster ±50 ms um das Ereignis gegen den Median der 100-ms-Blockspitzen im
ruhigen Bereich 1,0 bis 2,9 s. Schwelle: 16-bit-Stufe −96,33 dBFS absolut (04 §4.3 „unter der
16-bit-Stufe“, SCHNITTSTELLEN §1.3, ARCHITEKTUR §4 Regel 4). Reiz wie 04 §4.2: 780 Hz, −6 dBFS.

Aufruf: knack.py <render> <render_mutation_kill_hart> <ausgabeordner>
Rückgabe 0 nur, wenn: die Metrik eine bekannte Störung sieht (Positiv-Kontrolle), ohne Ereignis
schweigt (Negativ-Kontrolle), der harte Kill (Mutation) über der Schwelle und der Kill mit der
Schaltrampe der Bibliothek (§1.5 „5 ms, zweite Ordnung“) darunter liegt, und ein linearer 5-ms-Verlauf
von außen über der Schwelle liegt (die Metrik sieht auch einen realistischen Formfehler).
"""
import math
import os
import subprocess
import sys

import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 48000
T_EREIGNIS = 563 * 256 / SR          # 3,002667 s
SCHWELLE_DBFS = 20 * math.log10(2 ** -16)  # −96,33 dBFS


def lade(pfad):
    sr, x = wavfile.read(pfad)
    assert sr == SR, pfad
    return x.astype(np.float64)


def bereich_spitze_db(x, t0, t1, ref0, ref1, blk_s=0.1):
    sos = signal.butter(4, 5000, 'highpass', fs=SR, output='sos')
    h = np.abs(signal.sosfiltfilt(sos, x))
    blk = int(blk_s * SR)
    innen = h[int(t0 * SR):int(t1 * SR)].max()
    ref = float(np.median([h[s:s + blk].max() for s in range(int(ref0 * SR), int(ref1 * SR) - blk + 1, blk)]))
    return 20 * math.log10(innen / ref), 20 * math.log10(innen), 20 * math.log10(ref)


def messe(x):
    return bereich_spitze_db(x, T_EREIGNIS - 0.05, T_EREIGNIS + 0.05, 1.0, 2.9)


def main():
    render, render_mut, aus = sys.argv[1], sys.argv[2], sys.argv[3]
    os.makedirs(aus, exist_ok=True)

    def wav(programm, szenario):
        p = os.path.join(aus, f'{os.path.basename(programm)}_{szenario}.wav')
        subprocess.run([programm, szenario, p], check=True)
        return lade(p)

    ohne = wav(render, 'ohne')
    e = {}
    # Positiv-Kontrolle der Metrik: ein Einzelsample von −100 dBFS bei 3,0026 s muss auffallen.
    gestoert = ohne.copy()
    gestoert[int(T_EREIGNIS * SR)] += 10 ** (-100 / 20)
    e['positiv_einzelsample_-100dBFS'] = messe(gestoert)
    e['ohne_ereignis'] = messe(ohne)
    e['kill_mitte_schaltrampe'] = messe(wav(render, 'kill'))
    e['kill_mitte_hart_mutation'] = messe(wav(render_mut, 'kill'))
    e['kill_verlauf_linear_5ms'] = messe(wav(render, 'kill_verlauf_linear'))
    e['kill_verlauf_2x_einpol_2.5ms'] = messe(wav(render, 'kill_verlauf_o2'))
    e['fader_0_nach_stumm'] = messe(wav(render, 'fader_aus'))
    e['filter_0_nach_-0.5'] = messe(wav(render, 'filter'))
    print(f'Schwelle {SCHWELLE_DBFS:.2f} dBFS (16-bit-Stufe)')
    for name, (rel, spitze, ref) in e.items():
        print(f'{name:30s} spitze={spitze:8.2f} dBFS  gegen_bezug={rel:7.2f} dB  bezug={ref:8.2f} dBFS')

    fehler = []
    if e['positiv_einzelsample_-100dBFS'][0] < 20.0:
        fehler.append('Positiv-Kontrolle: die Metrik sieht ein −100-dBFS-Einzelsample nicht')
    if e['ohne_ereignis'][0] >= 3.0:
        fehler.append('Negativ-Kontrolle: ohne Ereignis schlägt die Metrik an (≥ 3 dB)')
    if e['kill_mitte_hart_mutation'][1] <= SCHWELLE_DBFS:
        fehler.append('Fehlerfall: harter Kill liegt NICHT über der Schwelle, die Messung taugt nicht')
    if e['kill_verlauf_linear_5ms'][1] <= SCHWELLE_DBFS:
        fehler.append('Gegenprobe: linearer 5-ms-Kill liegt NICHT über der Schwelle, die Messung taugt nicht')
    if e['kill_mitte_schaltrampe'][1] >= SCHWELLE_DBFS:
        fehler.append('Kill mit der Schaltrampe der Bibliothek liegt über der Schwelle')
    for f in fehler:
        print('FEHLER', f)
    return 1 if fehler else 0


if __name__ == '__main__':
    sys.exit(main())
