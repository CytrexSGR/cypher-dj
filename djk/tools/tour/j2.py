"""Journey J2, the live set (journey tours plan, task 8): a 30 minute set on a test instance, measured and recorded.

Steps: j2.aufbau (build the set), j2.basis (idle xrun baseline), j2.set (the long phase), j2.szenen, j2.container, j2.apc20 (SKIP, needs
hardware), j2.mitschnitt (stop the recording), j2.datei (check the recorded file).
After the set four steps drive the loop deck pop-up and the clip editor (`popup=True`, the default): j2.popup (view, strips, the clip gain, a
scene with a tempo), j2.scheiben (8 slices of a synthetic cell, a slice launch and a slice order heard in a recording), j2.warp (the cell on the
bar grid at another master tempo, keylock on and off, transpose) and j2.geraete (a device added on the DEVICES tab changes the sound).

The set: loop deck cells from the starter loops (decks 1 and 2, three tracks, two rows), three Strudel streams, one SEQ pattern, a scene
change every 2 minutes, the four container faders moved on a fixed script. `--kurz` runs 2 minutes with a scene every 20 s.
`j2.set` is green when the core's xrun delta stays within the idle baseline scaled to the phase length, the master never stays silent
for more than 2 s outside planned breaks, and never clips. The set recording (`/mitschnitt/*`) covers the whole phase.
"""
import json
import math
import re
import shutil
import subprocess
import time
from pathlib import Path

from tour import runner as laeufer
import dauerlauf

STUFEN = ["graphen", "kits", "loops"]                       # never bibliothek (empty library), no demo project: the set builds its own
OPTIONEN = ["--strudel", "--instrumente", "--bk-stroeme", "--journal", "schlank"]

DECKS = (1, 2)
SPUREN = (1, 2, 3)                                          # tracks of a deck that get a cell in both rows
SEQ_PLATZ = 4                                               # container D (A and B hold the loop decks, C the Strudel streams)
CONTAINER = ("deck/1/fader", "deck/2/fader", "pad/1/fader", "pad/2/fader")      # containers A to D
FADER_START_DB = -6
# The fixed fader script, -6 to -18 dB. A master peak of -1.127 dBFS is the master limiter's ceiling (limiter_dbtp -1.0 dBTP; its own header,
# core/dsp/meters/include/cypherdj/dsp/master_limiter.h:10-11, measures that ceiling as -1.126 dBTP), not clipping: the master cannot reach 0 dBFS,
# and it stayed at -1.127 dB when every fader went down by 2 dB. `j2.set` still fails on 0 dBFS, which would mean a broken limiter.
FADER_DB = (-6, -18, -9, -15, -6, -12)
STROEME = (1, 2, 3)
KANAELE_SET = ("deck/1", "deck/2", "pad/1", "pad/2", "strom/1", "strom/2", "strom/3")   # container A to D and the Strudel streams in /pegel
FEHLCODES = {0, 400, 404, 409, 500, 502, 503}               # answers the steps judge themselves, so the runner does not also mark the set red
STROM_MUSTER = {                                            # the Strudel patterns of the dauerlauf driver, two variants per stream
    1: ['s("bd*4, [~ hh]*4")', 's("bd*4, hh*8")'],
    2: ['note("c2 [~ eb2] g2 [c2 bb1]").s("sawtooth")', 'note("c2 c2 [g1 bb1] c2").s("sawtooth")'],
    3: ['note("c4 [eb4 g4] ~ bb4")', 'note("g4 [bb4 c5] ~ eb4")'],
}
SEQ_TEXT = ("folge drums  kit:starter  1bar\n"
            "noten kick 36  1/16  x...x...x...x...\n"
            "noten hat 42  1/16  ..x...x...x...x.\n")
LOOP_AUFNAHME = "tour-j2"
PEGEL_LESEFEHLER_ANTEIL = 0.05


def plan(kurz):
    """Lengths in seconds. The short form is what runs while building; the full tour is the controller's job (task 11).
    `szene_frist_s`: how long a requested scene may take to show as the active row (it waits for the next grid point);
    `anlauf_s`: grace after a scene or a stream post before the channel has to be heard."""
    if kurz:
        return dict(basis_s=20, set_s=120, szene_s=20, fader_s=5, takt_s=1.0, stille_max_s=2, min_datei_s=114, szene_frist_s=10, anlauf_s=8)
    return dict(basis_s=120, set_s=1800, szene_s=120, fader_s=15, takt_s=1.0, stille_max_s=2, min_datei_s=1710, szene_frist_s=10, anlauf_s=8)


def _muss(t, methode, pfad, koerper=None, quelle="cypher"):
    """A call that has to be accepted: a refusal ends the step red with the route, the code and the reason of the page."""
    a = t.ruf(methode, pfad, koerper, quelle=quelle)
    if not a.ok:
        raise AssertionError(f"{methode} {pfad} answered {a.code} {a.grund or ''}".strip())
    return a


def _starter_loops(t):
    a = t.ruf("GET", "/loops")
    if a.code != 200 or not isinstance(a.j, list):
        return []
    return [e["name"] for e in a.j if isinstance(e, dict) and e.get("ladbar") and str(e.get("name", "")).startswith("starter-")]


def _loop_aufnehmen(t):
    """No starter loops (the starter needs cargo): record two bars of stream 1 once, as the dauerlauf driver does."""
    _muss(t, "POST", "/strudel", {"strom": 1, "text": STROM_MUSTER[1][0]})
    _muss(t, "POST", "/proj/transport", {"aktion": "start"})
    _muss(t, "POST", "/loop", {"aktion": "rec", "beats": 8, "name": LOOP_AUFNAHME})

    def da():
        a = t.ruf("GET", "/loops")
        return a.code == 200 and any(isinstance(e, dict) and e.get("name") == LOOP_AUFNAHME and e.get("ladbar") for e in (a.j or []))
    if not t.warte_bis(da, 40, f"the recorded loop {LOOP_AUFNAHME}"):
        raise AssertionError(f"the loop {LOOP_AUFNAHME} did not appear in /loops")
    _muss(t, "POST", "/proj/transport", {"aktion": "stop"})
    return [LOOP_AUFNAHME]


def _aufraeumen(t):
    """A leftover SEQ deck from an earlier run on the same instance folders would refuse `anlegen` (seq_belegt): empty it first."""
    stand = t.ruf("GET", "/seq/stand").j
    if isinstance(stand, dict) and stand.get(str(SEQ_PLATZ)):
        _muss(t, "POST", "/seq/leeren", {"platz": SEQ_PLATZ})


def _seq_aufbauen(t):
    """One SEQ pattern on place D; two scene slots: 0 plays it, 1 mutes it."""
    _muss(t, "POST", "/seq/anlegen", {"platz": SEQ_PLATZ})
    _muss(t, "POST", "/seq/text", {"platz": SEQ_PLATZ, "text": SEQ_TEXT})
    stand = _muss(t, "GET", "/seq/stand").j or {}
    try:
        spur = stand[str(SEQ_PLATZ)]["folgen"][0]["spur_id"]
    except (KeyError, IndexError, TypeError):
        raise AssertionError(f"/seq/stand shows no pattern on place {SEQ_PLATZ}") from None
    for slot, stumm in ((0, False), (1, True)):
        _muss(t, "POST", "/seq/befehle", {"platz": SEQ_PLATZ, "label": f"j2 scene {slot + 1}",
                                          "befehle": [{"befehl": "spur_aendern", "spur_id": spur, "mute": stumm}]})
        _muss(t, "POST", "/seq/szene", {"slot": slot, "aktion": "speichern"})


def _zellen_laden(t, loops):
    """Row 1 and row 2 of both decks: three tracks, a different starter loop per cell."""
    n = len(loops)
    for deck in DECKS:
        for spur in SPUREN:
            for zelle in (1, 2):
                name = loops[(spur - 1 + (zelle - 1) + (deck - 1)) % n]
                _muss(t, "POST", "/loopdeck/laden", {"deck": deck, "spur": spur, "zelle": zelle, "quelle": {"loop": name}})


def _fader(t, z, pfad, db):
    """The container faders are the DJ's hands: they carry `andreas`. A channel that plays loops opens only for a human (kein_hoerschein for
    Cypher). Every such call is counted in `z.andreas` and listed in the report."""
    key = f"POST /regler {pfad}"
    z.andreas[key] = z.andreas.get(key, 0) + 1
    return t.ruf("POST", "/regler", {"pfad": pfad, "nach": db, "takte": 0, "ab": "jetzt"}, quelle="andreas", erwartet=FEHLCODES)


def _stille_in_datei(pfad, min_s):
    """Silent stretches of at least `min_s` seconds in the recorded file (below -60 dBFS), as ffmpeg's silencedetect names them."""
    r = subprocess.run(["ffmpeg", "-v", "info", "-i", str(pfad), "-af", f"silencedetect=noise=-60dB:d={min_s}", "-f", "null", "-"],
                       capture_output=True, text=True)
    return [float(x) for x in re.findall(r"silence_duration:\s*([0-9.]+)", r.stderr)]


class _Satz:
    """What the long phase saw, kept for the steps that judge it."""

    def __init__(self):
        self.szenen = 0                  # scene changes that were accepted AND showed as the active row
        self.szenen_fehl = []
        self.regler = 0
        self.regler_fehl = []
        self.kanal_max = {}
        self.kanal_stille = {}           # channel -> longest silent stretch while it was expected to play (s)
        self.andreas = {}                # calls made as the owner: "POST /regler deck/1/fader" -> count
        self.cypher_fader = None         # (code, reason) of the opening fader call made as Cypher on a closed channel
        self.rec_start = None            # the Antwort of POST /mitschnitt/start
        self.datei = None
        self.set_sek = None
        self.sc_spur = None              # id of the test track of the pop-up steps (cell 1 of track 4 on deck 1)
        self.sc_ordner = None            # the test loop's folder in the instance's loop folder, removed when the steps are done


def _szene(t, z, k, jetzt):
    """Scene k: row 1 or 2 on both decks, SEQ scene slot 0 or 1, one Strudel stream switches variant. Returns the pending check and the stream posted."""
    zeile = 1 + k % 2
    slot = k % 2
    strom = k % 3 + 1
    anfragen = [("POST", "/loopdeck/szene", {"deck": d, "zeile": zeile}) for d in DECKS]
    anfragen.append(("POST", "/seq/szene", {"slot": slot, "aktion": "starten"}))
    anfragen.append(("POST", "/strudel", {"strom": strom, "text": STROM_MUSTER[strom][(k // 3 + 1) % 2]}))
    fehl = False
    for methode, pfad, koerper in anfragen:
        a = t.ruf(methode, pfad, koerper, erwartet=FEHLCODES)
        if not a.ok:
            fehl = True
            z.szenen_fehl.append(f"{pfad} {a.code} {a.grund or ''}".strip())
    return (None if fehl else dict(k=k, zeile=zeile, slot=slot, seit=jetzt)), strom


def _szenen_lesen(t):
    """The scene state of the page: per deck the cell each track plays, and the active SEQ scene."""
    lt = t.ruf("GET", "/loopdeck/stand", erwartet=FEHLCODES)
    sq = t.ruf("GET", "/seq/szenen", erwartet=FEHLCODES)
    zellen = {}
    decks = (lt.j or {}).get("decks") if isinstance(lt.j, dict) else None
    for d in DECKS:
        deck = (decks or {}).get(str(d)) if isinstance(decks, dict) else None
        spuren = (deck or {}).get("spuren") or []
        zellen[d] = [((s.get("lauf") or {}).get("zelle") if isinstance(s, dict) else None) for s in spuren[:len(SPUREN)]]
    return zellen, (sq.j or {}).get("aktiv") if isinstance(sq.j, dict) else None


def _szene_stimmt(pruef, zellen, aktiv):
    return all(len(zellen[d]) == len(SPUREN) and all(c == pruef["zeile"] for c in zellen[d]) for d in DECKS) and aktiv == pruef["slot"]


def _set_phase(t, z, p, xrun):
    """The timeline: one master and channel level sample per tick; scenes, fader moves and the read-back of every scene when due.
    Returns the measured values."""
    takt, dauer = p["takt_s"], p["set_s"]
    pausen = p.get("pausen", [])                                  # planned breaks (from_s, to_s): silence there is not a fault
    proben = lesefehler = 0
    max_db = -200.0
    stille_von = None
    laengste = 0.0
    uebersteuert = False
    szene_k, fader_j = 0, 0
    offen = []                                                    # scene checks waiting for the read-back
    stimmen = {}                                                  # when a channel has to be heard from: name -> second
    strom_ab = {}
    seq_ab = None                                                 # second from which the SEQ pattern has to be heard (slot 0 shown active)
    loops_ab = None
    spur = {k: None for k in KANAELE_SET}                         # start of the current silent stretch of a channel that has to play
    t0 = time.monotonic()

    def abschliessen(pruef, jetzt, grund):
        z.szenen_fehl.append(f"scene {pruef['k'] + 1}: {grund}")

    while True:
        jetzt = time.monotonic() - t0
        if jetzt >= dauer and not (offen and jetzt < dauer + p["szene_frist_s"]):
            break
        if jetzt < dauer:
            if jetzt >= szene_k * p["szene_s"]:
                for alt in offen:
                    abschliessen(alt, jetzt, "the next scene was requested before this one showed")
                offen = []
                pruef, strom = _szene(t, z, szene_k, jetzt)
                strom_ab[strom] = jetzt + p["anlauf_s"]
                if pruef is not None:
                    offen.append(pruef)
                seq_ab = None                                     # the SEQ picture changes at the next bar: not judged until it shows
                szene_k += 1
            if jetzt >= fader_j * p["fader_s"]:
                i = fader_j % len(CONTAINER)
                a = _fader(t, z, CONTAINER[i], FADER_DB[(fader_j // len(CONTAINER) + i) % len(FADER_DB)])
                z.regler += 1
                if not a.ok:
                    z.regler_fehl.append(f"{CONTAINER[i]} {a.code} {a.grund or ''}".strip())
                fader_j += 1
        # scene read-back
        if offen:
            zellen, aktiv = _szenen_lesen(t)
            rest = []
            for pruef in offen:
                if _szene_stimmt(pruef, zellen, aktiv):
                    z.szenen += 1
                    if loops_ab is None:
                        loops_ab = jetzt + p["anlauf_s"]
                    seq_ab = jetzt + p["anlauf_s"] if pruef["slot"] == 0 else None
                elif jetzt - pruef["seit"] > p["szene_frist_s"]:
                    abschliessen(pruef, jetzt, f"row {pruef['zeile']} and SEQ scene {pruef['slot'] + 1} did not show as active within "
                                               f"{p['szene_frist_s']} s (loop deck cells {zellen}, SEQ scene {aktiv})")
                else:
                    rest.append(pruef)
            offen = rest
        # level
        a = t.ruf("GET", "/pegel?sek=1", timeout=10)
        db = dauerlauf.master_db(a.j) if a.code == 200 else None
        proben += 1
        kanaele = (a.j.get("kanaele") or {}) if isinstance(a.j, dict) else {}
        erwartet = {"deck/1": loops_ab, "deck/2": loops_ab, "pad/2": seq_ab, "pad/1": min(strom_ab.values()) if len(strom_ab) == len(STROEME) else None}
        for n in STROEME:
            erwartet[f"strom/{n}"] = strom_ab.get(n)
        for kanal in KANAELE_SET:
            w = kanaele.get(kanal)
            m = w.get("max_db") if isinstance(w, dict) else None
            if isinstance(m, (int, float)):
                z.kanal_max[kanal] = max(z.kanal_max.get(kanal, -200.0), m)
            ab = erwartet.get(kanal)
            spielt = ab is not None and jetzt >= ab and jetzt < dauer
            if spielt and not (isinstance(m, (int, float)) and m >= laeufer.STUMM_DB):
                spur[kanal] = jetzt if spur[kanal] is None else spur[kanal]
                z.kanal_stille[kanal] = max(z.kanal_stille.get(kanal, 0.0), jetzt - spur[kanal] + takt)
            else:
                spur[kanal] = None
        if db is None:
            lesefehler += 1
            db = dauerlauf.PEGEL_NICHTS_DB
        if jetzt < dauer:
            max_db = max(max_db, db)
            uebersteuert = uebersteuert or db >= 0.0
            geplant = any(v <= jetzt < b for v, b in pausen)
            if db < laeufer.STUMM_DB and not geplant:
                stille_von = jetzt if stille_von is None else stille_von
                laengste = max(laengste, jetzt - stille_von + takt)
            else:
                stille_von = None
        time.sleep(max(0.0, takt - (time.monotonic() - t0 - jetzt)))
    for pruef in offen:
        abschliessen(pruef, dauer, "never showed as active")
    return dict(proben=proben, lesefehler=lesefehler, max_db=max_db, uebersteuert=uebersteuert, laengste=laengste,
                sek=min(time.monotonic() - t0, dauer + 1))


# ---------------------------------------------------------------- the loop deck pop-up, slices, warp and devices (the J2 extension)
# The pop-up is a browser overlay: the tour has no browser, so it drives the routes behind it (the same ones the pop-up's strips, scene column, CLIP
# tab and DEVICES tab send) and measures what they do: the level of the loop deck channel, the master tempo, the frequencies in a recording of the master.
# The test cell is synthetic: 4 beats at 128 bpm, 8 slices of half a beat, every slice its own sine with a whole number of cycles per slice, so a repeat
# of one slice is a seamless tone and the slice that plays can be read from the frequency alone.

RATE = 48000
SCHEIBEN_LOOP = "tour-j2-scheiben"
SCHEIBEN_BEATS = 4
SCHEIBEN_N = 8
SCHEIBEN_FRAMES = 22500 * SCHEIBEN_BEATS                    # a library loop is 128 bpm at 48 kHz: 22 500 frames per beat
_SCHEIBE_FRAMES = SCHEIBEN_FRAMES // SCHEIBEN_N
_ZYKLUS_HZ = RATE / _SCHEIBE_FRAMES                         # one cycle per slice: every multiple of this is a seamless repeat
SCHEIBEN_HZ = tuple(round(330.0 * 2 ** (k / 3) / _ZYKLUS_HZ) * _ZYKLUS_HZ for k in range(SCHEIBEN_N))      # 329 Hz up to 1664 Hz, a third of an octave apart
SCHEIBEN_GRENZEN = [k * SCHEIBEN_BEATS / SCHEIBEN_N for k in range(SCHEIBEN_N)]     # what teilung 1/8 of a 4 beat cell makes: 0, 0.5 .. 3.5
SCHEIBEN_PEGEL = 0.5
TEST_DECK, TEST_SPUR, TEST_ZELLE = 1, 4, 1                  # track 4 of deck 1 is free: the set uses tracks 1 to 3
FADER_AUS_DB = -200
MASTER_BPM = 128                                            # the tempo of the library loops: no stretch
WARP_BPM = 112                                              # the cell has to follow this, 6/7 of its own length at 128
SZENE_BPM = 116
HOERBAR_DB = -45.0                                          # a window quieter than this is not a tone
STUMM_FENSTER_S = 0.4                                       # a gap this long splits a recording into the pieces the tour played one after the other


def scheiben_signal(pegel=SCHEIBEN_PEGEL):
    """The test cell as interleaved stereo float32: 8 slices, slice k a sine of SCHEIBEN_HZ[k] (cycles complete in the slice)."""
    import numpy as np
    x = np.zeros(SCHEIBEN_FRAMES)
    n = np.arange(_SCHEIBE_FRAMES) / RATE
    for k, f in enumerate(SCHEIBEN_HZ):
        x[k * _SCHEIBE_FRAMES:(k + 1) * _SCHEIBE_FRAMES] = pegel * np.sin(2 * np.pi * f * n)
    return np.repeat(x[:, None], 2, axis=1).astype("<f4")


def loop_schreiben(ordner, name=SCHEIBEN_LOOP):
    """The test cell as a library loop (loop.f32 first, loop.json last: the loop is not listed before it is whole). Returns its folder."""
    d = Path(ordner) / name
    d.mkdir(parents=True, exist_ok=True)
    (d / "loop.f32").write_bytes(scheiben_signal().tobytes())
    meta = {"schema": 1, "name": name, "beats": SCHEIBEN_BEATS, "bpm": 128, "frames": SCHEIBEN_FRAMES, "datei": "loop.f32",
            "quelle": "tour:j2-scheiben", "erstellt": time.strftime("%Y-%m-%d %H:%M")}
    tmp = d / "loop.json.tmp"
    tmp.write_text(json.dumps(meta, indent=1))
    tmp.replace(d / "loop.json")
    return d


def ton_spur(x, fenster_s=0.05, hop_s=0.01):
    """The strongest line per window: a list of (centre second, Hz, dB of the line's amplitude, 0 dB = a full scale sine). Hann window, parabolic peak."""
    import numpy as np
    n, hop = int(fenster_s * RATE), int(hop_s * RATE)
    w = np.hanning(n)
    nfft = 1 << int(np.ceil(np.log2(n * 8)))
    f = np.fft.rfftfreq(nfft, 1.0 / RATE)
    unten = int(np.searchsorted(f, 100.0))
    summe = w.sum() / 2.0
    aus = []
    for a in range(0, len(x) - n + 1, hop):
        sp = np.abs(np.fft.rfft(x[a:a + n] * w, nfft))
        k = unten + int(np.argmax(sp[unten:]))
        y0, y1, y2 = sp[k - 1], sp[k], sp[k + 1] if k + 1 < len(sp) else sp[k]
        nenner = y0 - 2 * y1 + y2
        d = 0.5 * (y0 - y2) / nenner if nenner != 0 else 0.0
        aus.append(((a + n / 2) / RATE, float((k + d) * RATE / nfft), 20 * math.log10(max(y1 / summe, 1e-9))))
    return aus


def scheiben_laeufe(spur, skala=1.0, min_db=HOERBAR_DB, max_ln=0.11, min_fenster=3, hop_s=0.01):
    """The slices a recording played, in order: runs of consecutive windows whose line is the same slice's tone (times `skala`, the pitch change that
    is expected) within `max_ln` (natural log, 11 % of the frequency; neighbours are 26 % apart). A run of fewer than `min_fenster` windows is a
    transition, not a slice. Each run: {idx (1-based slice), von, bis (seconds), hz (median), n}."""
    erwartet = [f * skala for f in SCHEIBEN_HZ]
    laeufe, offen = [], None
    for t, f, db in spur:
        idx = None
        if db >= min_db and f > 0:
            best = min(range(len(erwartet)), key=lambda i: abs(math.log(f / erwartet[i])))
            if abs(math.log(f / erwartet[best])) <= max_ln:
                idx = best + 1
        if idx is not None and offen is not None and offen["idx"] == idx and t - offen["bis"] <= 1.5 * hop_s:
            offen["bis"] = t
            offen["fs"].append(f)
        else:
            if offen is not None:
                laeufe.append(offen)
            offen = {"idx": idx, "von": t, "bis": t, "fs": [f]} if idx is not None else None
    if offen is not None:
        laeufe.append(offen)
    aus = []
    for r in laeufe:
        r["n"] = len(r["fs"])
        if r["n"] >= min_fenster:
            fs = sorted(r.pop("fs"))
            r["hz"] = fs[len(fs) // 2]
            aus.append(r)
    return aus


def hoerstuecke(spur, min_db=HOERBAR_DB, luecke_s=STUMM_FENSTER_S):
    """The recording split into the pieces the tour played one after the other: the windows that carry a tone, a gap of `luecke_s` or more between two
    audible windows starts a new piece. Returns one list of windows per piece (the tour stopped the cell and waited for a silent master in between)."""
    aus = []
    for fenster in spur:
        if fenster[2] < min_db:
            continue
        if aus and fenster[0] - aus[-1][-1][0] < luecke_s:
            aus[-1].append(fenster)
        else:
            aus.append([fenster])
    return aus


def folge_von(stueck, n=None):
    """The slice numbers of a piece in the order they played (the first `n`)."""
    f = [r["idx"] for r in stueck]
    return f if n is None else f[:n]


def periode_s(stueck, idx=1):
    """The time between the starts of slice `idx` in a piece: first start to last start over the number of repeats between them (a bias of the detection
    cancels; None below two starts). With slice 1 this is the length of the cell."""
    starts = [r["von"] for r in stueck if r["idx"] == idx]
    return (starts[-1] - starts[0]) / (len(starts) - 1) if len(starts) >= 2 else None


def tonhoehe_verhaeltnis(stueck):
    """The pitch of a piece against the synthetic cell: median of (measured Hz / Hz of that slice) over its runs."""
    v = sorted(r["hz"] / SCHEIBEN_HZ[r["idx"] - 1] for r in stueck)
    return v[len(v) // 2] if v else None


def lauflaenge_s(stueck):
    """The median length of a slice run (start of the run to the start of the next run, seconds): half a beat when the cell plays at its tempo."""
    d = sorted(b["von"] - a["von"] for a, b in zip(stueck, stueck[1:]) if b["idx"] != a["idx"])
    return d[len(d) // 2] if d else None


def klirr_db(x, f0, von_s, bis_s, harmonische=(2, 3, 4, 5)):
    """Level of the harmonics 2 to 5 of the tone near `f0` against the tone itself, in dB (power sum): a clean sine is far below -50, a driven saturator above -30."""
    from tour import j1
    f = j1.ton_frequenz(x, f0, von_s, bis_s, spanne=15.0)
    grund = j1.ton_db(x, f, von_s, bis_s)
    leistung = sum(10 ** (j1.ton_db(x, f * h, von_s, bis_s) / 10) for h in harmonische)
    return 10 * math.log10(leistung + 1e-15) - grund


class _Mitschnitt:
    """One recording of the master (`/mitschnitt/*`): start, stop, decode, and the file is removed (it lives in /dev/shm)."""

    def __init__(self, t, name):
        self.t, self.name, self.t0, self.datei, self.sek = t, name, None, None, None

    def start(self):
        self.t0 = time.monotonic()                                  # the recorder captures from the moment of the call
        a = _muss(self.t, "POST", "/mitschnitt/start", {"name": self.name})
        self.datei = a.j.get("datei") if isinstance(a.j, dict) else None
        if not self.datei:
            raise AssertionError("POST /mitschnitt/start named no file")

    def jetzt_s(self):
        return time.monotonic() - self.t0

    def stopp(self):
        a = _muss(self.t, "POST", "/mitschnitt/stopp", {})
        j = a.j if isinstance(a.j, dict) else {}
        self.datei = j.get("datei") or self.datei
        self.sek = j.get("sekunden")
        if j.get("luecken"):
            raise AssertionError(f"the recorder reports {j.get('luecken')} gap(s)")

    def signal(self):
        from tour import j1
        try:
            return j1.lade_signal(self.datei)
        finally:
            for pfad in (self.datei, f"{self.datei}.json"):
                _loesche(pfad)


def _loesche(pfad):
    try:
        Path(pfad).unlink()
    except OSError:
        pass


def _deck_db(t, kanal="deck/1"):
    """Highest level of the last second on one channel of GET /pegel, or None."""
    a = t.ruf("GET", "/pegel?sek=1", timeout=10, erwartet=FEHLCODES)
    w = ((a.j or {}).get("kanaele") or {}).get(kanal) if isinstance(a.j, dict) else None
    m = w.get("max_db") if isinstance(w, dict) else None
    return float(m) if isinstance(m, (int, float)) else None


def _master_bpm(t):
    a = t.ruf("GET", "/lage", erwartet=FEHLCODES)
    uhr = (a.j or {}).get("uhr") if isinstance(a.j, dict) else None
    b = uhr.get("bpm") if isinstance(uhr, dict) else None
    return float(b) if isinstance(b, (int, float)) else None


def _tempo(t, bpm, frist_s=40):
    """Master tempo as Cypher (POST /tempo ramps over four beats) and wait until the clock shows it."""
    _muss(t, "POST", "/tempo", {"bpm": bpm})
    if not t.warte_bis(lambda: (_master_bpm(t) or 0) > 0 and abs(_master_bpm(t) - bpm) < 0.15, frist_s, f"master tempo {bpm}"):
        raise AssertionError(f"the master tempo did not reach {bpm} (clock shows {_master_bpm(t)})")


def _spur_zeile(t, spur=TEST_SPUR, deck=TEST_DECK):
    """The track of the loop deck as /loopdeck/stand shows it (a dict), or {}."""
    lt = t.ruf("GET", "/loopdeck/stand", erwartet=FEHLCODES).j
    d = ((lt or {}).get("decks") or {}).get(str(deck)) if isinstance(lt, dict) else None
    s = (d or {}).get("spuren") or []
    return s[spur - 1] if len(s) >= spur and isinstance(s[spur - 1], dict) else {}


def _zelle_zeile(t):
    zs = _spur_zeile(t).get("zellen") or []
    return zs[TEST_ZELLE - 1] if len(zs) >= TEST_ZELLE and isinstance(zs[TEST_ZELLE - 1], dict) else {}


def _ruhe(t, z):
    """Only deck 1 may be heard: its channel fader open, the other containers closed, the Strudel streams and the SEQ pattern quiet, all loop cells stopped.
    The faders are the DJ's hands (andreas, counted in the report)."""
    for pfad, db in (("deck/1/fader", 0), ("deck/2/fader", FADER_AUS_DB), ("pad/1/fader", FADER_AUS_DB), ("pad/2/fader", FADER_AUS_DB)):
        a = _fader(t, z, pfad, db)
        if not a.ok:
            raise AssertionError(f"POST /regler {pfad} answered {a.code} {a.grund or ''}".strip())
    for strom in STROEME:
        t.ruf("POST", "/strudel", {"strom": strom, "text": "silence"}, erwartet=FEHLCODES)
    t.ruf("POST", "/seq/szene", {"slot": 1, "aktion": "starten"}, erwartet=FEHLCODES)
    for d in DECKS:
        t.ruf("POST", "/loopdeck/stopp", {"deck": d}, erwartet=FEHLCODES)
    if not _warte_still(t):
        raise AssertionError("the master did not go quiet after the loop cells were stopped")


def _warte_still(t, frist_s=25):
    def still():
        a = t.ruf("GET", "/pegel?sek=1", timeout=10, erwartet=FEHLCODES)
        db = dauerlauf.master_db(a.j) if a.code == 200 else None
        return db is not None and db < laeufer.STUMM_DB
    return t.warte_bis(still, frist_s, "a silent master")


def _test_zelle(t, z):
    """The synthetic loop as cell 1 of track 4 on deck 1 (loaded once per tour). Returns the track id."""
    if z.sc_spur is not None:
        return z.sc_spur
    ordner = Path(t.instanz.shm) / "loops"
    z.sc_ordner = loop_schreiben(ordner)
    def da():
        a = t.ruf("GET", "/loops")
        return a.code == 200 and any(isinstance(e, dict) and e.get("name") == SCHEIBEN_LOOP and e.get("ladbar") for e in (a.j or []))
    if not t.warte_bis(da, 15, "the test loop in /loops"):
        raise AssertionError(f"the loop {SCHEIBEN_LOOP} written to the loop folder is not listed as ladbar by GET /loops")
    _muss(t, "POST", "/loopdeck/raster", {"deck": TEST_DECK, "raster": "1/4"})
    _muss(t, "POST", "/loopdeck/laden", {"deck": TEST_DECK, "spur": TEST_SPUR, "zelle": TEST_ZELLE, "quelle": {"loop": SCHEIBEN_LOOP}})
    if not t.warte_bis(lambda: isinstance(_zelle_zeile(t).get("frames"), int) and _zelle_zeile(t)["frames"] > 0, 20, "the test cell decoded"):
        raise AssertionError(f"the test cell did not finish loading: {_zelle_zeile(t)}")
    sid = _spur_zeile(t).get("spur_id")
    if not sid:
        raise AssertionError("/loopdeck/stand shows no spur_id for the test track")
    z.sc_spur = sid
    return sid


def _zelle_start(t, frist_s=20):
    """Launch the test cell and wait until the channel of deck 1 is heard."""
    if not t.warte_bis(lambda: t.ruf("POST", "/loopdeck/start", {"deck": TEST_DECK, "spur": TEST_SPUR, "zelle": TEST_ZELLE}).ok, 10, "the cell launches"):
        raise AssertionError("POST /loopdeck/start was refused for the test cell")
    if not t.warte_bis(lambda: (_deck_db(t) or -200.0) > laeufer.STUMM_DB, frist_s, "the test cell is heard"):
        raise AssertionError("the test cell was launched but deck 1 stays silent")


def _zelle_stopp(t):
    t.ruf("POST", "/loopdeck/stopp", {"deck": TEST_DECK, "spur": TEST_SPUR}, erwartet=FEHLCODES)
    if not _warte_still(t):
        raise AssertionError("the test cell was stopped but the master stays audible")


def _zelle_felder(t, z, felder):
    """The clip editor's write path (POST /session/zelle: what the CLIP tab sends). `felder` None removes the field."""
    return _muss(t, "POST", "/session/zelle", dict(spur_id=_test_zelle(t, z), zelle=TEST_ZELLE, **felder))


def _scheiben_setzen(t, z, folge):
    return _zelle_felder(t, z, {"scheiben": {"teilung": "1/8", "grenzen": list(SCHEIBEN_GRENZEN), "folge": list(folge)}})


def _ziel(a, name):
    """Value `name` of an answer's body or None."""
    return a.j.get(name) if isinstance(a.j, dict) else None


def _popup(t, z, p):
    with t.schritt("j2.popup", "loop deck pop-up: the view, a strip fader and mute, the clip gain, a scene with a tempo (each measured)") as w:
        tempo_vorher = _master_bpm(t)
        ansicht_ok = False
        szene = None
        try:
            # the view: the main window tells the page server it shows the pop-up (`studio`); the pult reads it back
            _muss(t, "POST", "/controller/ansicht", {"ansicht": "studio"})
            pult = _muss(t, "GET", "/controller/pult").j or {}
            w["ansicht_offen"] = pult.get("ansicht")
            ansicht_ok = pult.get("ansicht") == "studio"
            # the pop-up's files are served: the tabs CLIP and DEVICES are in the bottom area, the pop-up module imports it
            seiten = {}
            for pfad in ("/loopdeck/gross.js", "/session/unten.js"):
                a = t.ruf("GET", pfad, erwartet=FEHLCODES)
                seiten[pfad] = a.code
                if pfad.endswith("unten.js"):
                    w["reiter"] = re.findall(r"'(CLIP|DEVICES)'", a.roh.decode("utf8", "replace").split("TABS", 1)[-1].split("]", 1)[0])
            w["seiten"] = seiten
            _ruhe(t, z)
            sid = _test_zelle(t, z)
            _tempo(t, MASTER_BPM)
            _zelle_start(t)
            time.sleep(1.4)
            basis = _deck_db(t)
            w["pegel_basis_db"] = basis
            # a strip fader of the pop-up: -12 dB
            _muss(t, "POST", "/loopdeck/spur", {"deck": TEST_DECK, "spur": TEST_SPUR, "fader_db": -12})
            time.sleep(1.4)
            fader = _deck_db(t)
            _muss(t, "POST", "/loopdeck/spur", {"deck": TEST_DECK, "spur": TEST_SPUR, "fader_db": 0})
            # the strip's mute
            _muss(t, "POST", "/loopdeck/spur", {"deck": TEST_DECK, "spur": TEST_SPUR, "mute": True})
            time.sleep(1.4)
            mute = _deck_db(t)
            _muss(t, "POST", "/loopdeck/spur", {"deck": TEST_DECK, "spur": TEST_SPUR, "mute": False})
            # the CLIP tab: the cell's name and gain go through POST /session/zelle; the gain is heard after the next launch
            _zelle_felder(t, z, {"name": "tour slices", "gain_db": -6})
            w["name_im_stand"] = _zelle_zeile(t).get("name")
            _zelle_stopp(t)
            _zelle_start(t)
            time.sleep(1.4)
            gain = _deck_db(t)
            _zelle_felder(t, z, {"gain_db": 0})
            _zelle_stopp(t)
            # the scene column: a new row with a tempo; launching it sends the tempo ramp and the clock follows
            neu = _muss(t, "POST", "/session/szene_neu", {})
            szene = _ziel(neu, "zeile")
            _muss(t, "POST", "/session/szene_aendern", {"zeile": szene, "name": "tour", "bpm": SZENE_BPM})
            gestartet = _muss(t, "POST", "/session/szene", {"zeile": szene})
            w["szene_antwort_tempo"] = _ziel(gestartet, "tempo")
            erreicht = t.warte_bis(lambda: abs((_master_bpm(t) or 0) - SZENE_BPM) < 0.3, 30, f"clock at {SZENE_BPM} bpm")
            w["szene_bpm_gemessen"] = _master_bpm(t)
        finally:
            if szene is not None:
                t.ruf("POST", "/session/szene_loeschen", {"zeile": szene}, erwartet=FEHLCODES)
            t.ruf("POST", "/controller/ansicht", {"ansicht": "dj"}, erwartet=FEHLCODES)
            if tempo_vorher:
                t.ruf("POST", "/tempo", {"bpm": tempo_vorher}, erwartet=FEHLCODES)
        pult = t.ruf("GET", "/controller/pult", erwartet=FEHLCODES).j or {}
        w["ansicht_zu"] = pult.get("ansicht")
        fehler = []
        if not ansicht_ok:
            fehler.append(f"the view after POST /controller/ansicht studio is {w.get('ansicht_offen')!r}")
        if w.get("ansicht_zu") == "studio":
            fehler.append("the view stays studio after the pop-up was closed (ansicht dj)")
        if not all(c == 200 for c in seiten.values()):
            fehler.append(f"pop-up files not served: {seiten}")
        if sorted(set(w.get("reiter") or [])) != ["CLIP", "DEVICES"]:
            fehler.append(f"the bottom area does not offer the tabs CLIP and DEVICES: {w.get('reiter')}")
        if basis is None or basis < -30 or basis > -1:
            fehler.append(f"the test cell is not heard at a sane level on deck 1: {basis} dB")
        else:
            dfader, dgain = (fader - basis) if fader is not None else None, (gain - basis) if gain is not None else None
            w.update(strip_fader_delta_db=None if dfader is None else round(dfader, 1), strip_mute_db=mute,
                     clip_gain_delta_db=None if dgain is None else round(dgain, 1))
            if dfader is None or not -13.5 <= dfader <= -10.5:
                fehler.append(f"strip fader -12 dB moved the deck channel by {dfader} dB (expected -12 +-1.5)")
            if mute is None or mute > laeufer.STUMM_DB:
                fehler.append(f"strip mute left the deck channel at {mute} dB (expected below {laeufer.STUMM_DB:.0f})")
            if dgain is None or not -7.5 <= dgain <= -4.5:
                fehler.append(f"clip gain -6 dB moved the deck channel by {dgain} dB (expected -6 +-1.5)")
        if w.get("name_im_stand") != "tour slices":
            fehler.append(f"the cell name written on CLIP reads {w.get('name_im_stand')!r} in /loopdeck/stand")
        if w.get("szene_antwort_tempo") != SZENE_BPM:
            fehler.append(f"the scene answered tempo {w.get('szene_antwort_tempo')}, expected {SZENE_BPM}")
        if not erreicht:
            fehler.append(f"the clock never reached the scene tempo {SZENE_BPM} (shows {w.get('szene_bpm_gemessen')})")
        if fehler:
            t.rot("; ".join(fehler))




def _stueck_spielen(t, aktion, **koerper):
    """One piece of the recording: launch the test cell ("start" from the top, "sprung" at a slice), let it play 2 s, stop it, wait for a quiet master."""
    if aktion == "start":
        _zelle_start(t)
    else:
        ruf = dict(deck=TEST_DECK, spur=TEST_SPUR, **koerper)
        if not t.warte_bis(lambda: t.ruf("POST", "/loopdeck/sprung", ruf).ok, 10, "the slice launch is accepted"):
            letzter = t.ruf("POST", "/loopdeck/sprung", ruf)
            raise AssertionError(f"POST /loopdeck/sprung {koerper} answered {letzter.code} {letzter.grund or ''}".strip())
        if not t.warte_bis(lambda: (_deck_db(t) or -200.0) > laeufer.STUMM_DB, 15, "the slice is heard"):
            raise AssertionError(f"deck 1 stays silent after /loopdeck/sprung {koerper}")
    time.sleep(2.2)
    _zelle_stopp(t)


def _scheiben(t, z, p):
    with t.schritt("j2.scheiben", "8 slices on a cell: the slice launch and the slice order are heard in a recording of the master") as w:
        _ruhe(t, z)
        _test_zelle(t, z)
        _tempo(t, MASTER_BPM)
        g = _muss(t, "POST", "/session/scheiben", {"spur_id": z.sc_spur, "zelle": TEST_ZELLE, "teilung": "1/8"})
        w["grenzen"] = _ziel(g, "grenzen")
        w["scheiben_im_stand"] = (_zelle_zeile(t).get("scheiben") or {}).get("teilung")
        m = _Mitschnitt(t, "j2-scheiben")
        m.start()
        try:
            _stueck_spielen(t, "start")                                     # piece 1: from the top
            _stueck_spielen(t, "sprung", slice=3)                           # piece 2: slice 3
            _stueck_spielen(t, "sprung", slice=6)                           # piece 3: slice 6
            _scheiben_setzen(t, z, list(range(SCHEIBEN_N, 0, -1)))          # the slot order of the CLIP editor: backwards
            time.sleep(0.5)
            _stueck_spielen(t, "start")                                     # piece 4: from the top, backwards
        finally:
            t.ruf("POST", "/session/zelle", {"spur_id": z.sc_spur, "zelle": TEST_ZELLE,
                                                          "scheiben": {"teilung": "1/8", "grenzen": list(SCHEIBEN_GRENZEN), "folge": list(range(1, SCHEIBEN_N + 1))}},
                              erwartet=FEHLCODES)
            m.stopp()
        teile = hoerstuecke(ton_spur(m.signal()))
        w["stuecke"] = len(teile)
        laeufe = [scheiben_laeufe(s) for s in teile]
        w["folgen"] = [folge_von(r, 6) for r in laeufe]
        fehler = []
        if w["grenzen"] != SCHEIBEN_GRENZEN:
            fehler.append(f"teilung 1/8 on a {SCHEIBEN_BEATS} beat cell gave the boundaries {w['grenzen']}, expected {SCHEIBEN_GRENZEN}")
        if len(teile) != 4:
            fehler.append(f"the recording holds {len(teile)} played pieces, expected 4 (from the top, slice 3, slice 6, backwards)")
        else:
            erwartet = [("from the top", [1, 2, 3, 4]), ("slice 3", [3, 4, 5, 6]), ("slice 6", [6, 7, 8, 1]), ("backwards", [8, 7, 6, 5])]
            for (name, soll), r in zip(erwartet, laeufe):
                ist = folge_von(r, len(soll))
                if ist != soll:
                    fehler.append(f"{name}: the first slices heard were {ist}, expected {soll}")
            halbe = lauflaenge_s(laeufe[0])
            soll_s = 0.5 * 60.0 / MASTER_BPM
            w["scheibe_s"] = None if halbe is None else round(halbe, 3)
            if halbe is None or abs(halbe - soll_s) > 0.1 * soll_s:
                fehler.append(f"a slice lasts {w['scheibe_s']} s, expected {soll_s:.3f} s (half a beat at {MASTER_BPM} bpm, +-10 %)")
        if fehler:
            t.rot("; ".join(fehler))


WARP_VARIANTEN = (("keylock on", {"keylock": None, "transponieren": None}, 1.0, 0.03),
                  ("keylock off", {"keylock": False, "transponieren": None}, WARP_BPM / MASTER_BPM, 0.04),
                  ("transpose +12", {"keylock": None, "transponieren": 12}, 2.0, 0.05))     # name, cell fields, expected pitch factor, its tolerance (relative)


def _warp(t, z, p):
    with t.schritt("j2.warp", f"warp: at {WARP_BPM} bpm the cell stays on the bar grid, keylock keeps the pitch, re-pitch and transpose move it (recording)") as w:
        _ruhe(t, z)
        _test_zelle(t, z)
        _scheiben_setzen(t, z, list(range(1, SCHEIBEN_N + 1)))
        _tempo(t, WARP_BPM)
        bpm = _master_bpm(t)
        w["master_bpm"] = bpm
        m = _Mitschnitt(t, "j2-warp")
        m.start()
        try:
            for name, felder, skala, tol in WARP_VARIANTEN:
                _zelle_felder(t, z, felder)
                _zelle_start(t)
                time.sleep(4 * 4 * 60.0 / bpm - 0.5)                        # about four cell lengths
                _zelle_stopp(t)
        finally:
            t.ruf("POST", "/session/zelle", {"spur_id": z.sc_spur, "zelle": TEST_ZELLE, "keylock": None, "transponieren": None}, erwartet=FEHLCODES)
            m.stopp()
            t.ruf("POST", "/tempo", {"bpm": MASTER_BPM}, erwartet=FEHLCODES)
        teile = hoerstuecke(ton_spur(m.signal()))
        w["stuecke"] = len(teile)
        soll_s = 4 * 60.0 / bpm
        w["soll_laenge_s"] = round(soll_s, 3)
        fehler = []
        if len(teile) != len(WARP_VARIANTEN):
            fehler.append(f"the recording holds {len(teile)} played pieces, expected {len(WARP_VARIANTEN)}")
        else:
            for (name, felder, skala, tol), teil in zip(WARP_VARIANTEN, teile):
                r = scheiben_laeufe(teil, skala=skala)
                starts = [x["von"] for x in r if x["idx"] == 1]
                per = periode_s(r)
                ton = tonhoehe_verhaeltnis(r)
                drift = None
                if per is not None and len(starts) >= 3:
                    drift = max(abs(s - starts[0] - i * per) for i, s in enumerate(starts))
                w[name] = dict(laenge_s=None if per is None else round(per, 3), tonhoehe=None if ton is None else round(ton, 3),
                               drift_ms=None if drift is None else round(drift * 1000), scheiben=len(r))
                if per is None or abs(per - soll_s) > 0.02 * soll_s:
                    fehler.append(f"{name}: the cell lasts {w[name]['laenge_s']} s, four beats at {bpm:g} bpm are {soll_s:.3f} s (+-2 %)")
                if drift is None or drift > 0.03:
                    fehler.append(f"{name}: the cell drifts off the bar grid by {w[name]['drift_ms']} ms over its repeats (limit 30 ms)")
                if ton is None or abs(ton / skala - 1) > tol:
                    fehler.append(f"{name}: the pitch is {w[name]['tonhoehe']} of the source, expected {skala:.3f} (+-{tol:.0%})")
        if fehler:
            t.rot("; ".join(fehler))


def _insert_id(antwort, spur_id):
    """The id of the last insert of the track `spur_id` in the project an edit answered with (searched in the whole tree), or None."""
    def suche(x):
        if isinstance(x, dict):
            if x.get("id") == spur_id and isinstance(x.get("inserts"), list) and x["inserts"]:
                return x["inserts"][-1].get("id")
            for v in x.values():
                r = suche(v)
                if r:
                    return r
        elif isinstance(x, list):
            for v in x:
                r = suche(v)
                if r:
                    return r
        return None
    return suche(antwort.j)


def _aendern(t, label, befehle, versuche=3):
    """POST /proj/aendern with the current revision of the open project (the live container); once more when the revision moved meanwhile."""
    a = None
    for _ in range(versuche):
        rev = (t.ruf("GET", "/proj/aktuell?nur=rev", erwartet=FEHLCODES).j or {}).get("rev")
        a = t.ruf("POST", "/proj/aendern", {"rev": rev, "label": label, "befehle": befehle}, erwartet={409})
        if a.code != 409:
            break
    if a is None or not a.ok:
        raise AssertionError(f"POST /proj/aendern answered {a.code} {a.grund or ''}".strip())
    return a


def _geraete(t, z, p):
    with t.schritt("j2.geraete", "DEVICES: a saturator added to the track adds harmonics to a steady tone (recording), and is removed again") as w:
        _ruhe(t, z)
        sid = _test_zelle(t, z)
        _scheiben_setzen(t, z, [1] * SCHEIBEN_N)                              # one slice repeated: a steady sine of SCHEIBEN_HZ[0]
        _tempo(t, MASTER_BPM)
        m = _Mitschnitt(t, "j2-geraete")
        insert = None
        m.start()
        try:
            _zelle_start(t)
            von = m.jetzt_s()
            time.sleep(3.5)
            a = _aendern(t, "j2 DEVICES: saturator", [{"befehl": "insert_setzen", "strang_id": sid, "pos": 0, "art": "saett", "werte": {"drive": 24}}])
            insert = _insert_id(a, sid) or _insert_id(t.ruf("GET", "/proj/aktuell", erwartet=FEHLCODES), sid)
            dazu = m.jetzt_s()
            time.sleep(4.5)
            bis = m.jetzt_s()
        finally:
            m.stopp()
            if insert is not None:
                try:
                    _aendern(t, "j2 DEVICES: remove", [{"befehl": "insert_entfernen", "insert_id": insert}])
                except AssertionError as e:
                    w["entfernen_fehlt"] = str(e)
            t.ruf("POST", "/session/zelle", {"spur_id": sid, "zelle": TEST_ZELLE, "scheiben": {"teilung": "1/8", "grenzen": list(SCHEIBEN_GRENZEN),
                                                                                             "folge": list(range(1, SCHEIBEN_N + 1))}}, erwartet=FEHLCODES)
            _zelle_stopp(t)
        x = m.signal()
        bleibt = _insert_id(t.ruf("GET", "/proj/aktuell", erwartet=FEHLCODES), sid) if insert is not None else None
        vorher = klirr_db(x, SCHEIBEN_HZ[0], von + 1.0, dazu - 0.3)
        nachher = klirr_db(x, SCHEIBEN_HZ[0], dazu + 2.5, min(bis, len(x) / RATE) - 0.3)
        w.update(insert_id=insert, klirr_vorher_db=round(vorher, 1), klirr_nachher_db=round(nachher, 1), zuwachs_db=round(nachher - vorher, 1))
        fehler = []
        if insert is None:
            fehler.append("POST /proj/aendern insert_setzen answered no insert id for the track")
        if vorher > -45:
            fehler.append(f"the steady tone is not clean before the device: harmonics at {vorher:.1f} dB")
        if nachher - vorher < 20 or nachher < -35:
            fehler.append(f"the saturator (drive 24 dB) changed the harmonics from {vorher:.1f} to {nachher:.1f} dB, expected a rise of at least 20 dB to above -35 dB")
        if w.get("entfernen_fehlt") or bleibt is not None:
            fehler.append(f"the device was not removed again: {w.get('entfernen_fehlt') or 'the track still shows insert ' + str(bleibt)}")
        if fehler:
            t.rot("; ".join(fehler))


def schritte(t, xrun=None, popup=True):
    """`popup=False` runs the eight steps of the set only (the unit tests of the set use it against a fake page that answers 200 to everything)."""
    p = plan(t.kurz)
    z = _Satz()
    eigener = xrun is None
    if eigener:
        xrun = laeufer.XrunZaehler(t.instanz.kern_port)
    try:
        _alle(t, z, p, xrun, popup)
    finally:
        if eigener:
            xrun.ende()


def _alle(t, z, p, xrun, popup=True):
    with t.schritt("j2.aufbau", "build the set: live container, SEQ pattern, loop deck cells, scenes", pflicht=True) as w:
        _muss(t, "POST", "/live/oeffnen", {})
        loops = _starter_loops(t)
        w["loops"] = loops or "recorded"
        if not loops:
            loops = _loop_aufnehmen(t)
        _aufraeumen(t)
        _seq_aufbauen(t)
        _zellen_laden(t, loops)
        # the product rule the chapter states: a closed loop channel does not open for Cypher (the same call as the set makes later as the owner)
        a = t.ruf("POST", "/regler", {"pfad": CONTAINER[0], "nach": FADER_START_DB, "takte": 0, "ab": "jetzt"}, erwartet=FEHLCODES)
        z.cypher_fader = (a.code, a.grund)
        w["fader_als_cypher"] = f"{a.code} {a.grund}"

    with t.schritt("j2.basis", f"idle xrun baseline over {p['basis_s']} s") as w:
        w["basis_delta"] = xrun.basis(p["basis_s"])
        w["basis_s"] = p["basis_s"]

    with t.schritt("j2.set", f"the set for {p['set_s']} s: xruns, silence, clipping") as w:
        z.rec_start = t.ruf("POST", "/mitschnitt/start", {"name": "j2-set"}, erwartet=FEHLCODES)
        z.datei = z.rec_start.j.get("datei") if z.rec_start.ok and isinstance(z.rec_start.j, dict) else None
        for pfad in CONTAINER:
            a = _fader(t, z, pfad, FADER_START_DB)
            z.regler += 1
            if not a.ok:
                z.regler_fehl.append(f"{pfad} {a.code} {a.grund or ''}".strip())
        for strom in STROEME:
            t.ruf("POST", "/strudel", {"strom": strom, "text": STROM_MUSTER[strom][0]})
        t.ruf("POST", "/proj/transport", {"aktion": "start"})
        with xrun.phase() as m:
            r = _set_phase(t, z, p, xrun)
        z.set_sek = r["sek"]
        probleme = []
        if getattr(xrun, "_basis_delta", None) is None:
            probleme.append("xrun: no idle baseline (j2.basis failed), the gate cannot be judged")
        elif not xrun.ok(m):
            probleme.append(f"xrun delta {m.delta} above the idle baseline {xrun._basis_delta} scaled to {m.sek:.1f} s")
        if r["laengste"] > p["stille_max_s"]:
            probleme.append(f"silent for {r['laengste']:.1f} s (limit {p['stille_max_s']} s)")
        if r["uebersteuert"]:
            probleme.append("clipping: the master reached 0 dBFS")
        if r["proben"] == 0 or r["lesefehler"] > PEGEL_LESEFEHLER_ANTEIL * r["proben"]:
            probleme.append(f"no master level in {r['lesefehler']} of {r['proben']} samples")
        w.update(xrun_delta=m.delta, laengste_stille_s=round(r["laengste"], 2), max_db=r["max_db"], proben=r["proben"],
                 lesefehler=r["lesefehler"], sek=round(r["sek"], 1), aufrufe_als_andreas=dict(z.andreas))
        if probleme:
            t.rot("; ".join(probleme))

    with t.schritt("j2.szenen", "every scene change was accepted and showed as the active row and SEQ scene") as w:
        w["szenen"] = z.szenen
        w["abgelehnt"] = z.szenen_fehl[:5]
        if z.szenen_fehl:
            t.rot(f"{len(z.szenen_fehl)} scene problem(s), first: {z.szenen_fehl[0]}")
        elif z.szenen < 2:
            t.rot(f"only {z.szenen} scene change(s) were verified")

    with t.schritt("j2.container", "container faders (calls as andreas, listed in the report values) follow the script; every container and Strudel stream is heard while it should play; Cypher is refused") as w:
        w["bewegt"] = z.regler
        w["aufrufe_als_andreas"] = dict(z.andreas)
        w["fader_als_cypher"] = None if z.cypher_fader is None else f"{z.cypher_fader[0]} {z.cypher_fader[1]}"
        w["kanal_max_db"] = {k: round(v, 1) for k, v in z.kanal_max.items() if k in KANAELE_SET}
        w["laengste_stille_beim_spielen_s"] = {k: round(v, 2) for k, v in z.kanal_stille.items()}
        zu_still = {k: v for k, v in z.kanal_stille.items() if v > p["stille_max_s"]}
        nie = [k for k in KANAELE_SET if z.kanal_max.get(k, -200.0) < laeufer.STUMM_DB]
        if z.regler_fehl:
            t.rot(f"{len(z.regler_fehl)} fader move(s) refused, first: {z.regler_fehl[0]}")
        elif z.regler < len(CONTAINER):
            t.rot(f"only {z.regler} fader move(s) were made")
        elif z.cypher_fader is None or z.cypher_fader[0] != 409 or z.cypher_fader[1] != "kein_hoerschein":
            t.rot(f"the opening fader call as Cypher was not refused with kein_hoerschein: {z.cypher_fader}")
        elif zu_still:
            t.rot("silent while it should play: " + ", ".join(f"{k} {v:.1f} s" for k, v in zu_still.items()))
        elif nie:
            t.rot(f"never above {laeufer.STUMM_DB:.0f} dB: {', '.join(nie)}")

    with t.schritt("j2.apc20", "the APC20 drives the set") as w:
        t.skip("needs the APC20: owner session J2", sitzung="J2")

    with t.schritt("j2.mitschnitt", "the set recording ran for the whole phase and stops cleanly") as w:
        if z.rec_start is None or not z.rec_start.ok:
            g = z.rec_start.grund if z.rec_start is not None else "not started"
            raise AssertionError(f"POST /mitschnitt/start never started the recording: {g}")
        a = _muss(t, "POST", "/mitschnitt/stopp", {})
        j = a.j if isinstance(a.j, dict) else {}
        z.datei = j.get("datei") or z.datei
        w.update(datei=z.datei, sekunden=j.get("sekunden"), luecken=j.get("luecken"), spruenge=j.get("spruenge"))
        if j.get("luecken"):
            t.rot(f"the recorder reports {j.get('luecken')} gap(s) in the ring")
        elif not isinstance(j.get("sekunden"), (int, float)) or j["sekunden"] < p["min_datei_s"]:
            t.rot(f"the recording is {j.get('sekunden')} s long, expected at least {p['min_datei_s']} s")

    with t.schritt("j2.datei", "the recording is moved to the report folder, decodes, is long enough, does not clip and has no silent stretch") as w:
        if not z.datei:
            raise AssertionError("there is no recording file")
        quelle = Path(z.datei)
        if not quelle.is_file():
            raise AssertionError(f"the recording {quelle} does not exist")
        ziel = Path(t.ausgabe) / quelle.name
        Path(t.ausgabe).mkdir(parents=True, exist_ok=True)
        # moved, not copied: a 30 minute recording is ~700 MB in RAM (/dev/shm); the page's .json beside it goes along
        for src in (quelle, quelle.with_name(quelle.name + ".json")):
            if src.is_file():
                shutil.move(str(src), str(Path(t.ausgabe) / src.name))
        w["datei"] = str(ziel)
        d = t.pruefe_datei(ziel, p["min_datei_s"])
        w.update(dauer_s=d.dauer_s, format=d.format, spitze_db=d.spitze_db, gruende=d.gruende, bytes=ziel.stat().st_size)
        stille = _stille_in_datei(ziel, p["stille_max_s"]) if d.dauer_s else []
        w["stille_im_file_s"] = stille
        gruende = list(d.gruende) + (["stille"] if stille else [])
        if gruende:
            t.rot(", ".join(gruende))

    if popup:
        try:
            _popup(t, z, p)
            _scheiben(t, z, p)
            _warp(t, z, p)
            _geraete(t, z, p)
        finally:
            if z.sc_ordner is not None:
                shutil.rmtree(z.sc_ordner, ignore_errors=True)
