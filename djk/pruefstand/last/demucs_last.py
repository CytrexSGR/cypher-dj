# Werkstatt-Last für Lastprofil P1 (ARCHITEKTUR §9.2): HTDemucs aus demucs 4.0.1 mit zufälligen Gewichten (nichts wird
# heruntergeladen) trennt Rauschen auf der CPU in Schleife; Rechen- und Speicherprofil wie eine echte Stem-Trennung.
# Kopie von proben/10-robustheit-betrieb/nachpruefung/demucs_last.py (dort gemessen: 10 NP N6), neu: endet sauber auf
# SIGTERM und meldet die Rundenzahl. Aufruf: python demucs_last.py <sekunden_laufzeit> <threads> <segment_s>
import signal
import sys
import time

import torch
from demucs.apply import apply_model
from demucs.htdemucs import HTDemucs

halt = False


def _halt(sig, frame):
    global halt
    halt = True


signal.signal(signal.SIGTERM, _halt)
dauer, threads, seg = float(sys.argv[1]), int(sys.argv[2]), float(sys.argv[3])
torch.set_num_threads(threads)
torch.manual_seed(0)
m = HTDemucs(sources=['drums', 'bass', 'other', 'vocals'], samplerate=44100, segment=7.8).eval()
x = torch.randn(1, 2, int(44100 * seg)) * 0.1
ende = time.monotonic() + dauer
n = 0
with torch.no_grad():
    while time.monotonic() < ende and not halt:
        t = time.monotonic()
        y = apply_model(m, x, shifts=0, split=True, overlap=0.25, progress=False)
        n += 1
        print(f'runde {n} {time.monotonic() - t:.2f} s', flush=True)
print('fertig', n, flush=True)
