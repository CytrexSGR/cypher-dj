"""J0 bring your own sounds: a stranger points the app at a folder of samples and uses one of them.

The instance starts with graphs and kits only (no catalogue, no library). The tour fills a music folder with files named like a
stranger's (rendered from the starter kit pads of the instance), adds the folder as a library source, waits for the catalogue,
imports one more file, finds the kick, puts it on a pad of a drum track and listens to the level.

The kick of the folder is the starter kick plus a short 3 kHz click that no starter pad has, so the tour can prove that the sound
which plays is the stranger's file and not the old pad: the kit file the pad now holds has the click, and the master spectrum
while the track plays has it too (and did not before). The tour uses the app's routes, not the browser.
"""
import array
import json
import math
import shutil
import struct
import time
import wave
from pathlib import Path

STUFEN = ["graphen", "kits"]      # no bibliothek stage: the library is empty on purpose
RATE = 48000
KATALOG_FRIST_S = 120
IMPORT_FRIST_S = 120
EINZELNE = (("Kick 01", 36), ("Snare 01", 38), ("Hat 01", 42), ("Clap 01", 39))
ZUSATZ = ("Tom 01", 41)
LOOP_SEK = 30
TEMPO = 120
KICK_TON = 36
KLICK_HZ = 3000.0
BAND = (2500.0, 3500.0)           # where the click lives
KLICK_MINDESTABSTAND_DB = 10.0    # the click must stand this far above what the starter kick shows in the same band
SPEKTRUM_SEK = 3.0


def _pad(kit_ordner, note):
    """Stereo float32 frames of one starter kit pad, as a flat list of samples."""
    kit = Path(kit_ordner) / "starter"
    roh = (kit / f"{note}.f32").read_bytes()
    return list(struct.unpack(f"<{len(roh) // 4}f", roh))


def _eigener_kick(kit_ordner):
    """The stranger's kick: the starter kick (a bit quieter) with a 3 kHz click on its first 30 ms. Same length, same body."""
    p = [x * 0.7 for x in _pad(kit_ordner, KICK_TON)]
    for i in range(int(RATE * 0.03)):
        if i * 2 + 1 >= len(p):
            break
        v = 0.5 * math.sin(2 * math.pi * KLICK_HZ * i / RATE) * math.exp(-i / RATE / 0.004)
        p[i * 2] += v
        p[i * 2 + 1] += v
    return p


def _band_db(samples, ab=0, frames=8192):
    """Level of the click band against the whole spectrum of `frames` frames of a stereo sample list, in dB (the click shows up as a rise)."""
    import numpy as np
    x = np.asarray(samples[ab * 2:(ab + frames) * 2], dtype="float64")
    mono = x[0::2] + x[1::2] if len(x) >= 2 else x
    spek = np.abs(np.fft.rfft(mono * np.hanning(len(mono)))) ** 2
    hz = np.fft.rfftfreq(len(mono), 1 / RATE)
    band = spek[(hz >= BAND[0]) & (hz <= BAND[1])].sum()
    return float(10 * math.log10(max(band, 1e-30) / max(spek.sum(), 1e-30)))


def _wav(pfad, samples):
    a = array.array("h", (max(-32767, min(32767, int(x * 32767))) for x in samples))
    with wave.open(str(pfad), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(a.tobytes())


def _loop(kit_ordner):
    """30 s at 120 bpm: kick on every beat, clap on 2 and 4, hat on the off beats."""
    frames = LOOP_SEK * RATE
    mix = [0.0] * (frames * 2)
    pads = {n: _pad(kit_ordner, n) for n in (36, 39, 42)}
    schritt = int(RATE * 60 / TEMPO)
    beat = 0
    while beat * schritt < frames:
        start = beat * schritt
        stuecke = [(36, start)]
        if beat % 4 in (1, 3):
            stuecke.append((39, start))
        stuecke.append((42, start + schritt // 2))
        for note, ab in stuecke:
            p = pads[note]
            n = min(len(p), (frames - ab) * 2)
            for i in range(n):
                mix[ab * 2 + i] += p[i] * 0.6
        beat += 1
    return mix


def _musik_fuellen(musik, kit_ordner, zusatz):
    if musik.exists():
        shutil.rmtree(musik)
    musik.mkdir(parents=True)
    for name, note in EINZELNE:
        _wav(musik / f"{name}.wav", _eigener_kick(kit_ordner) if note == KICK_TON else _pad(kit_ordner, note))
    _wav(musik / "Loop 120 bpm.wav", _loop(kit_ordner))
    zusatz.parent.mkdir(parents=True, exist_ok=True)
    _wav(zusatz, _pad(kit_ordner, ZUSATZ[1]))


def _stand_ruht(t):
    a = t.ruf("GET", "/bibliothek/stand")
    j = a.j or {}
    bau = j.get("letzter_bau") or {}
    return a.code == 200 and j.get("phase") == "ruht" and bau.get("rc") == 0 and bau.get("dateien") is not None, j


def _suche(t, text):
    a = t.ruf("GET", "/suche?q=" + text + "&arten=samples")
    for g in (a.j or {}).get("gruppen", []):
        if g.get("art") == "samples":
            return g.get("treffer") or []
    return []


def _aendern(t, befehle, label):
    """POST /proj/aendern with the current revision, once more when the revision moved (a 409 is declared for those tries; a last 409 is red)."""
    a = None
    for _ in range(3):
        akt = t.ruf("GET", "/proj/aktuell")
        rev = ((akt.j or {}).get("projekt") or {}).get("rev")
        a = t.ruf("POST", "/proj/aendern", {"rev": rev, "label": label, "befehle": befehle}, erwartet={409})
        if a.code != 409 or a.grund != "rev_veraltet":
            break
    if a.code == 409:
        t.rot(f"POST /proj/aendern 409 {a.grund}")
    return a


def _braucht(t, z, *schluessel):
    """Skips the current step when an earlier step did not deliver what this one builds on (that step is red or skipped itself)."""
    fehlt = [k for k in schluessel if not z.get(k)]
    if fehlt:
        t.skip(f"needs {', '.join(fehlt)} from an earlier step", ursache="abhaengigkeit")


def _klick_db(t, sek):
    """Highest level of the click band (2.5 to 3.5 kHz) in the live master spectrum over `sek` seconds, read every 150 ms; None without a picture."""
    ende = time.monotonic() + sek
    beste = None
    while True:
        a = t.ruf("GET", "/analyse/live")
        sp = (a.j or {}).get("spektrum") or {}
        if a.code == 200 and not (a.j or {}).get("leer") and not (a.j or {}).get("steht") and sp.get("hz"):
            dbs = [d for h, d in zip(sp["hz"], sp["db"]) if BAND[0] <= h <= BAND[1]]
            if dbs:
                beste = max(dbs) if beste is None else max(beste, max(dbs))
        if time.monotonic() >= ende:
            return beste
        time.sleep(0.15)


def _spielen(t, sek, mess):
    """Starts the transport at beat 0, lets it settle, runs `mess`, and always stops it."""
    try:
        a = t.ruf("POST", "/proj/transport", {"aktion": "start", "beat": 0})
        if not a.ok:
            return None
        time.sleep(0.5)                     # the transport settles
        return mess()
    finally:
        t.ruf("POST", "/proj/transport", {"aktion": "stopp"})


def schritte(t):
    musik = Path(t.ausgabe) / "musik"
    zusatz = Path(t.ausgabe) / "zusatz" / f"{ZUSATZ[0]}.wav"
    z = {}

    with t.schritt("j0.ordner", "the music folder holds files and the folder picker lists it"):
        kit_ordner = t.instanz.env.get("CYPHERDJ_KIT_ORDNER")
        if not kit_ordner or not (Path(kit_ordner) / "starter" / "kit.json").is_file():
            t.rot(f"no starter kit under {kit_ordner}")
        else:
            z["kit_ordner"] = kit_ordner
            _musik_fuellen(musik, kit_ordner, zusatz)
            a = t.ruf("GET", "/dateisystem/ordner?pfad=" + str(musik.parent), quelle="andreas")
            namen = [o.get("name") for o in (a.j or {}).get("ordner", [])]
            t.werte(dateien=sorted(p.name for p in musik.iterdir()), ordner=str(musik))
            if a.code != 200 or musik.name not in namen:
                t.rot(f"the folder picker does not list {musik.name} (code {a.code}, saw {namen})")
            else:
                z["musik"] = True

    with t.schritt("j0.quelle", "ADD FOLDER: the music folder becomes a library source"):
        _braucht(t, z, "musik")
        a = t.ruf("POST", "/bibliothek/quellen/dazu", {"pfad": str(musik), "typ": "auto"})
        if a.ok:
            q = t.ruf("GET", "/bibliothek/quellen")
            pfade = [x.get("pfad") for x in (q.j or {}).get("quellen", [])]
            if not any(p and Path(p).resolve() == musik.resolve() for p in pfade):
                t.rot(f"the source list does not name the folder (saw {pfade})")
            else:
                z["quelle"] = True

    with t.schritt("j0.katalog", "the catalogue is built from the folder"):
        _braucht(t, z, "quelle")
        letzte = {}

        def fertig():
            ok, j = _stand_ruht(t)
            letzte.update(j)
            return ok
        if not t.warte_bis(fertig, KATALOG_FRIST_S, "phase ruht with letzter_bau.rc 0"):
            t.rot(f"the catalogue never reached ruht with rc 0 within {KATALOG_FRIST_S} s (phase {letzte.get('phase')})", stand=letzte)
        else:
            kat = letzte.get("katalog") or {}
            t.werte(katalog=kat, dateien=(letzte.get("letzter_bau") or {}).get("dateien"))
            if (kat.get("oneshot") or 0) < 4:
                t.rot(f"the catalogue holds {kat.get('oneshot')} one-shots, expected the 4 of the folder")
            else:
                z["katalog"] = True

    with t.schritt("j0.import", "IMPORT: one more file goes in and is in the catalogue afterwards"):
        _braucht(t, z, "musik")
        a = t.hochladen("/import/datei", zusatz, {"name": zusatz.name, "ziel": "bibliothek"})
        if a.ok and not t.warte_bis(lambda: any(x.get("titel") == ZUSATZ[0] for x in _suche(t, "tom")), IMPORT_FRIST_S, "the imported file in the search"):
            t.rot(f"{zusatz.name} is not in the catalogue within {IMPORT_FRIST_S} s")

    with t.schritt("j0.finden", "searching kick lists the kick first"):
        _braucht(t, z, "katalog")
        treffer = _suche(t, "kick")
        t.werte(treffer=[x.get("titel") for x in treffer])
        if not treffer or treffer[0].get("titel") != EINZELNE[0][0] or not treffer[0].get("sha"):
            t.rot("the first hit of the search kick is not Kick 01")
        else:
            z["sha"] = treffer[0]["sha"]

    with t.schritt("j0.benutzen", "a drum track with the starter kit plays a four beat pattern"):
        _braucht(t, z, "sha")
        a = t.ruf("POST", "/proj/neu", {"name": "tour-j0", "werkbank": True})
        noten = [{"beat": b, "laenge": 0.5, "ton": KICK_TON, "vel": 110} for b in range(4)]
        a = _aendern(t, [{"befehl": "werkbank_spur_neu", "name": "Drums", "geraet": {"art": "intern", "name": "kit", "kit": "starter"},
                          "loop_beats": 4, "noten": noten}], "Drums") if a.ok else a
        if a.ok:
            spuren = ((a.j or {}).get("projekt") or {}).get("spuren") or [{}]
            z["spur"] = spuren[-1].get("id")
            a = _aendern(t, [{"befehl": "loop_setzen", "an": True, "von_beat": 0, "bis_beat": 4}], "Loop")
            z["projekt"] = bool(a.ok and z["spur"])

    with t.schritt("j0.vorher", "before the swap the master shows no click: the starter kick is what plays"):
        _braucht(t, z, "projekt")
        db = _spielen(t, SPEKTRUM_SEK + 0.5, lambda: _klick_db(t, SPEKTRUM_SEK))
        t.werte(klick_band_vorher_db=None if db is None else round(db, 1))
        if db is None:
            t.rot("no live spectrum while the starter track played")
        else:
            z["vorher_db"] = db
            z["vorher"] = True

    with t.schritt("j0.pad", "the kick becomes the sound of the pad: the track's kit holds the new file"):
        _braucht(t, z, "vorher")
        a = t.ruf("POST", "/sampler/datei/pad", {"spur_id": z["spur"], "ton": KICK_TON, "sha": z["sha"]})
        if a.ok:
            kit = (a.j or {}).get("kit")
            t.werte(text=(a.j or {}).get("text"), kit=kit)
            akt = t.ruf("GET", "/proj/aktuell")
            spur = next((x for x in ((akt.j or {}).get("projekt") or {}).get("spuren", []) if x.get("id") == z["spur"]), {})
            kit_der_spur = (spur.get("geraet") or {}).get("kit")
            if not kit or kit == "starter" or kit_der_spur != kit:
                t.rot(f"the track plays kit {kit_der_spur}, the route says {kit}: the pad is not on the track")
            else:
                ordner = Path(z["kit_ordner"]) / kit
                try:
                    info = json.loads((ordner / "kit.json").read_text())
                    klang = next(k for k in info["klaenge"] if k["note"] == KICK_TON)
                    neu = list(struct.unpack(f"<{(ordner / klang['datei']).stat().st_size // 4}f", (ordner / klang["datei"]).read_bytes()))
                except (OSError, ValueError, StopIteration, KeyError, struct.error) as e:
                    t.rot(f"the kit {kit} has no readable pad {KICK_TON}: {type(e).__name__}")
                    neu = None
                if neu is not None:
                    alt = _pad(z["kit_ordner"], KICK_TON)
                    ab, an = _band_db(alt), _band_db(neu)
                    t.werte(klang_quelle=klang.get("quelle"), klick_band_alt_db=round(ab, 1), klick_band_neu_db=round(an, 1))
                    if klang.get("quelle") != f"datei:{z['sha']}":
                        t.rot(f"pad {KICK_TON} of kit {kit} comes from {klang.get('quelle')}, not from the file {z['sha'][:8]}")
                    elif an < ab + KLICK_MINDESTABSTAND_DB:
                        t.rot(f"the pad file holds no click: band {an:.1f} dB against {ab:.1f} dB of the starter kick")
                    else:
                        z["pad"] = True

    with t.schritt("j0.hoeren", "the pad sounds: the click is in the master, the level is neither silent nor clipping"):
        _braucht(t, z, "pad")
        erg = {}

        def messen():
            erg["klick"] = _klick_db(t, SPEKTRUM_SEK)
            erg["pegel"] = t.pegel_phase(2)
        _spielen(t, SPEKTRUM_SEK + 2.5, messen)
        p, klick = erg.get("pegel"), erg.get("klick")
        if p is None:
            t.rot("the transport did not start")
        else:
            t.werte(max_db=round(p.max_db, 1), median_db=round(p.median_db, 1), klick_band_nachher_db=None if klick is None else round(klick, 1))
            if p.still:
                t.rot(f"silent: the master peaked at {p.max_db:.1f} dBFS")
            elif p.uebersteuert:
                t.rot(f"clipping: the master reached {p.max_db:.1f} dBFS")
            elif klick is None:
                t.rot("no live spectrum while the new kick played")
            elif klick < z["vorher_db"] + KLICK_MINDESTABSTAND_DB:
                t.rot(f"the click is not in the master: {klick:.1f} dB in the band against {z['vorher_db']:.1f} dB before the swap")


if __name__ == "__main__":
    print(json.dumps({"stufen": STUFEN}))
