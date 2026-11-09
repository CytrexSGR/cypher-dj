"""Misst den Frequenzgang von Cypher EQ (VST3) im echten Carla 2.5.8 unter pw-jack.
Eigener Client 'cyphereqmess', eigene Knoten eqmess-play/eqmess-rec, kein Betriebsport, kein Lautsprecher."""
import sys, time, json, subprocess, numpy as np
from scipy.io import wavfile
sys.path.insert(0, "/usr/share/carla")
import carla_backend as cb
from carla_backend import *
PFAD = sys.argv[1]; AUS = sys.argv[2]
C = "cyphereqmess"
def idle(h, s):
    t = time.monotonic()
    while time.monotonic() - t < s: h.engine_idle(); time.sleep(0.01)
h = CarlaHostDLL("/usr/lib/carla/libcarla_standalone2.so", False)
h.set_engine_option(ENGINE_OPTION_PATH_BINARIES, 0, "/usr/lib/carla")
h.set_engine_option(ENGINE_OPTION_PATH_RESOURCES, 0, "/usr/share/carla/resources")
h.set_engine_option(ENGINE_OPTION_PROCESS_MODE, ENGINE_PROCESS_MODE_CONTINUOUS_RACK, "")
h.set_engine_option(ENGINE_OPTION_PREFER_PLUGIN_BRIDGES, 0, "")
h.set_engine_option(ENGINE_OPTION_OSC_ENABLED, 0, "")
assert h.engine_init("JACK", C), h.get_last_error()
SR = int(h.get_sample_rate()); print("SR", SR, file=sys.stderr)
assert h.add_plugin(BINARY_NATIVE, PLUGIN_VST3, PFAD, "", "", 0, None, 0), h.get_last_error()
h.set_active(0, True)
par = {h.get_parameter_info(0, i)["name"]: i for i in range(h.get_parameter_count(0))}
ergebnis = {"sr": SR, "latenz_carla": h.get_plugin_latency(0) if hasattr(h, "get_plugin_latency") else None, "faelle": {}}
# Testsignal: 1 s Stille, Impuls 0,5, 3 s Stille (float32)
sig = np.zeros(4 * SR, np.float32); sig[SR] = 0.5
wavfile.write(f"{AUS}/impuls.wav", SR, np.stack([sig, sig], 1))
# Carla 2.5.8 nimmt VST3-Parameter NORMIERT (0..1). Umrechnung wie nih-plug (Skewed: ((v-min)/(max-min))^faktor).
def norm(name, v):
    if name.endswith("Freq"): return ((v - 10) / (22000 - 10)) ** (2 ** -2.2)
    if name.endswith("Q"): return ((v - 0.1) / (18 - 0.1)) ** (2 ** -2.0)
    if name.endswith("Gain"): return (v + 24) / 48
    if name.endswith("Type"): return v / 6
    if name.endswith("Slope"): return v / 3
    return v
def setze(name, v): h.set_parameter_value(0, par[name], norm(name, v))
TYP = {"Bell": 0, "Low Shelf": 1, "High Shelf": 2, "Low Cut": 3, "High Cut": 4, "Notch": 5, "Band Pass": 6}
STEIL = {12: 0, 24: 1, 36: 2, 48: 3}
faelle = {
  "neutral": [],
  "glocke16k": [dict(n=1, typ="Bell", f=16000, g=12, q=1.425)],
  "mix": [dict(n=1, typ="Low Cut", f=40, g=0, q=0.707, s=48), dict(n=2, typ="Low Shelf", f=100, g=3, q=0.707),
          dict(n=3, typ="Bell", f=250, g=-4, q=2), dict(n=5, typ="Bell", f=3000, g=5, q=1),
          dict(n=7, typ="High Shelf", f=12000, g=4, q=0.707), dict(n=8, typ="High Cut", f=19000, g=0, q=0.707, s=24)],
}
try:
  for name, baender in faelle.items():
    for n in range(1, 9): setze(f"Band {n} On", 0.0)
    for b in baender:
        n = b["n"]
        setze(f"Band {n} Type", TYP[b["typ"]])
        setze(f"Band {n} Freq", b["f"])
        setze(f"Band {n} Gain", b["g"])
        setze(f"Band {n} Q", b["q"])
        setze(f"Band {n} Slope", STEIL[b.get("s", 12)])
        setze(f"Band {n} On", 1.0)
    idle(h, 0.5)
    wav = f"{AUS}/{name}.wav"
    rec = subprocess.Popen(["pw-record", "-P", "{ node.name=eqmess-rec node.autoconnect=false }", "--rate", str(SR), "--channels", "2", "--format", "f32", wav], stderr=subprocess.DEVNULL)
    time.sleep(0.6)
    for k, p in (("1", "FL"), ("2", "FR")): subprocess.run(["pw-link", f"{C}:audio-out{k}", f"eqmess-rec:input_{p}"], check=True)
    play = subprocess.Popen(["pw-play", "-P", "{ node.name=eqmess-play node.autoconnect=false }", f"{AUS}/impuls.wav"], stderr=subprocess.DEVNULL)
    time.sleep(0.3)
    for k, p in (("1", "FL"), ("2", "FR")): subprocess.run(["pw-link", f"eqmess-play:output_{p}", f"{C}:audio-in{k}"], check=True)
    idle(h, 4.5); play.wait(); rec.terminate(); rec.wait()
    sr, x = wavfile.read(wav); l = x[:, 0].astype(float)
    i = int(np.argmax(np.abs(l) > 1e-6)) if np.any(np.abs(l) > 1e-6) else None
    ergebnis["faelle"][name] = {"baender": baender, "erstes_signal_idx": i, "spitze": float(np.abs(l).max()), "n": len(l)}
    np.save(f"{AUS}/{name}.npy", l)
finally:
    h.engine_close()
print(json.dumps(ergebnis, indent=1))
