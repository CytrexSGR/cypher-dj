"""J1 DJ: two tracks, a mix of 16 bars, the mix recorded to a file, and the mix measured.

The tour renders two fixture tracks (124 and 128 bpm, a fifth apart; track two starts 0.37 s late and both carry a low marker tone, see
`musik.py`), adds their folder as a library source, lets the page prepare both (beat analysis), loads them on deck 1 and 2, starts the
recording and plays deck 1, brings deck 2 in with SYNC, swaps the basses over 16 bars, takes deck 1 out, switches a beat FX on and off
over the remaining deck and stops the recording.

Calls are made the way the page makes them: PLAY on a deck is the hand grip `/griff deck/<n>/play` (key down 1, key up 0; only the hand may send it), SYNC is `/deck/start` with `ab: takt`. They carry
the source `cypher`. A page that refuses a Cypher call because only the hand may do it (an open channel needs a hearing check) is asked
again as `andreas`, the way a person at the desk would; every such call is named in the report notes.

What the steps prove, they prove from the recording, not from state read back:
  j1.sync     deck 2's kicks sit on deck 1's beat grid (offset in ms, in the overlap and after deck 1 left)
  j1.keylock  the pitch of deck 2's marker tone is the rendered one (cents) while deck 2 plays at the master tempo
  j1.eq       after the bass swap the low band of deck 1 is down and that of deck 2 is up (dB, minus what the faders did)
  j1.fx       the beat FX changes the signal while it is on (extra energy half a beat after the kicks)
"""
import math
import os
import re
import subprocess
import threading
import time
from pathlib import Path

from tour import musik

STUFEN = ["graphen", "kits"]          # the library is empty on purpose: the tour adds the fixture folder itself
BPM_TOLERANZ = 0.5                    # analysis only: the found tempo against the rendered one
KATALOG_FRIST_S = 300
VORBEREITEN_FRIST_S = 900
MASTER_TEMPO = 124                    # track one: deck 2 (128 bpm) follows
LEISE_DB = -40                        # the quiet end of the crossfade (a ramp in dB: -200 would leave the middle silent)
UEBERGANG_TAKTE = 16
VORLAUF_TAKTE_A = 4                   # bars deck 1 plays alone
STILLE_VOR_RAMPE_TAKTE = 2            # bars deck 2 runs quietly before the ramps start
AUSKLANG_SAUBER_TAKTE = 6             # bars deck 2 plays alone and unaffected after deck 1 left
FX_TAKTE = 4                          # bars the beat FX is on
FX_NACH_TAKTE = 4                     # bars after the FX is off
LUECKE_MAX_S = 1.0
GITTER_TOLERANZ_MS = 10.0             # a kick of deck 2 against the beat grid of deck 1
TON_TOLERANZ_CENT = 20.0              # the marker of deck 2 against its rendered pitch
BASS_ABFALL_DB = 12.0                 # what the bass swap must do to the marker of each deck, beyond what the faders did
FX_ANSTIEG = 1.5                      # the half-beat share while the FX is on, as a multiple of the share without it
RATE = musik.RATE
HAND_GRUENDE = {"kein_hoerschein", "ziel_ungehoert", "nur_andreas"}
HAND_CODES = {403, 409}
A_START = os.environ.get("CYPHERDJ_TOUR_A_START", "play")      # "sync": deck 1 starts with SYNC on a bar line instead of PLAY (shows the product finding is PLAY's)
KEYLOCK = os.environ.get("CYPHERDJ_TOUR_KEYLOCK", "1") != "0"   # "0" runs the tour with key lock off: j1.keylock must go red (proof of the check)


class Zustand:
    """What the steps hand to each other."""

    def __init__(self):
        self.dateien = []
        self.mids = {}                 # file name -> material id usable for /laden
        self.als_andreas = []
        self.mitschnitt_laeuft = False
        self.mix_start = None          # monotonic seconds when the recording started
        self.mix_ende = None           # monotonic seconds when deck 1 stopped
        self.aufnahme = None           # the answer of /mitschnitt/stopp
        self.tempo = MASTER_TEMPO
        # events in master clock beats (None until the step that makes them ran)
        self.a_beat = None             # deck 1 starts: its first sample sounds here
        self.b_beat = None             # deck 2 starts (the beat of its first downbeat)
        self.rampe_beat = None         # the fader ramps start
        self.swap_beat = None          # the bass swap calls were made between these two beats
        self.swap_beat_ende = None
        self.ende_beat = None          # deck 1 stops
        self.fx_an_beat = None
        self.fx_aus_beat = None
        self.stopp_beat = None
        self.signal = None             # the recording as mono samples, loaded by the first measuring step


def _ruf(t, z, methode, pfad, koerper=None, timeout=60):
    """Cypher first; a refusal that only the hand may lift is repeated as the hand and noted."""
    a = t.ruf(methode, pfad, koerper, timeout=timeout, erwartet=HAND_CODES)       # a refusal for the hand is expected, anything else is judged below
    if a.code in HAND_CODES and a.grund in HAND_GRUENDE:
        z.als_andreas.append(f"{methode} {pfad}" + (f" {koerper.get('pfad')}" if isinstance(koerper, dict) and koerper.get("pfad") else ""))
        a = t.ruf(methode, pfad, koerper, quelle="andreas", timeout=timeout)
    elif not a.ok:
        t._melde(f"{methode} {pfad}", a.code, a.grund, None, [a.code], a)
    return a


def _lage(t):
    a = t.ruf("GET", "/lage")
    return a.j if a.code == 200 and isinstance(a.j, dict) else {}


def _beat(t):
    return float((_lage(t).get("uhr") or {}).get("beat") or 0.0)


def _warte_beat(t, ziel, frist_s=120):
    if not t.warte_bis(lambda: _beat(t) >= ziel, frist_s, f"clock at beat {ziel:.0f}"):
        raise AssertionError(f"the clock did not reach beat {ziel:.0f} within {frist_s} s")


def _ok(a, was):
    assert a.ok, f"{was} answered {a.code} {a.grund}"
    return a


def _deck(t, nr):
    for d in _lage(t).get("decks") or []:
        if d.get("deck") == nr:
            return d
    return {}


def _start_beat(t, nr):
    """The clock beat at which deck `nr` started: the clock beat now minus the source beat it plays (source beats and clock beats run 1:1
    on a deck that follows the master)."""
    lage = _lage(t)
    uhr = float((lage.get("uhr") or {}).get("beat") or 0.0)
    for d in lage.get("decks") or []:
        if d.get("deck") == nr and d.get("quell_beat") is not None:
            return round(uhr - float(d["quell_beat"]), 3)
    return None


# ---------------------------------------------------------------- steps

def schritt_musik(t, z, ordner):
    with t.schritt("j1.musik", "two fixture tracks are rendered", pflicht=True) as w:
        try:
            z.dateien = musik.erzeuge(ordner, t.kurz)
        except musik.MusikFehlt as e:
            t.skip(str(e), ursache="abhaengigkeit")
        w["dateien"] = [str(p) for p in z.dateien]
        assert len(z.dateien) == 2, f"expected 2 tracks, got {len(z.dateien)}"


def _katalog_treffer(t, ordner):
    """file name -> catalogue row; the page names a row by `name` (the file name without its extension) and `ordner`, never by path."""
    a = t.ruf("GET", "/stoebern?typ=track&limit=200")
    if a.code != 200:
        return {}
    wurzel = os.path.realpath(str(ordner))
    stamm = {Path(n).stem: n for n in (m[0] for m in musik.TRACKS)}
    aus = {}
    for z in a.j.get("treffer") or []:
        if os.path.realpath(z.get("ordner") or "") == wurzel and z.get("name") in stamm:
            aus[stamm[z["name"]]] = z
    return aus


def schritt_analyse(t, z, ordner):
    """Library source, catalogue, preparation (beat analysis) of both tracks; tempo within 0.5 and the key as rendered."""
    with t.schritt("j1.analyse", "both tracks are analysed: the rendered tempo (within 0.5) and the rendered key are found") as w:
        z.mids = {}
        soll = musik.sollwerte()
        # A test instance keeps its library between runs: a source whose folder is gone (an older fixture folder) would stop the next build.
        q = t.ruf("GET", "/bibliothek/quellen")
        # The catalogue keeps one row per content hash: the same fixture rendered into an older run's folder would keep the row and hide this run's.
        for s in (q.j.get("quellen") or []) if q.code == 200 and isinstance(q.j, dict) else []:
            alt = re.fullmatch(r"musik-[0-9a-f]{8}", os.path.basename(str(s.get("pfad") or "").rstrip("/"))) and \
                os.path.realpath(str(s.get("pfad"))) != os.path.realpath(str(ordner))
            if s.get("fehlt") or alt:
                t.ruf("POST", "/bibliothek/quellen/weg", {"pfad": s.get("pfad")})
        _ok(t.ruf("POST", "/bibliothek/quellen/dazu", {"pfad": str(ordner)}), "add library source")
        namen = [p.name for p in z.dateien]
        treffer = {}

        def katalog_da():
            nonlocal treffer
            treffer = _katalog_treffer(t, ordner)
            if all(n in treffer for n in namen):
                return True
            bau = (t.ruf("GET", "/bibliothek/stand").j or {}).get("letzter_bau") or {}
            if bau.get("rc"):
                raise AssertionError(f"the catalogue build failed: {bau.get('grund')}")
            return False
        assert t.warte_bis(katalog_da, KATALOG_FRIST_S, "both tracks in the catalogue"), "the catalogue did not list both tracks"
        w["katalog"] = {n: {"bpm": treffer[n].get("bpm"), "camelot": treffer[n].get("camelot")} for n in namen}
        for n in namen:
            mid = treffer[n].get("material_id")
            if treffer[n].get("status") != "ready":
                r = t.ruf("POST", "/mediathek/vorbereiten", {"material_id": mid})
                assert r.code in (200, 202), f"prepare {n} answered {r.code} {r.grund}"
        fehler = []

        def bereit():
            nonlocal fehler
            fehler = []
            offen = 0
            bestand = t.ruf("GET", "/bestand").j or []
            da = {e["material_id"] for e in bestand}
            for n in namen:
                mid = treffer[n].get("material_id")
                if mid in da:
                    z.mids[n] = mid
                    continue
                s = t.ruf("GET", f"/mediathek/vorbereiten?material_id={mid}")
                if isinstance(s.j, dict) and s.j.get("status") == "fehler":
                    fehler.append(f"{n}: {s.j.get('grund')}")
                elif isinstance(s.j, dict) and s.j.get("status") == "vorhanden":
                    z.mids[n] = mid
                else:
                    offen += 1
            return offen == 0 or bool(fehler)
        t.warte_bis(bereit, VORBEREITEN_FRIST_S, "both tracks prepared")
        assert not fehler, "preparation failed: " + "; ".join(fehler)
        assert len(z.mids) == len(namen), f"only {sorted(z.mids)} were prepared within {VORBEREITEN_FRIST_S} s"
        bestand = {e["material_id"]: e for e in t.ruf("GET", "/bestand").j or []}
        schlecht = []
        for n in namen:
            e = bestand[z.mids[n]]
            tempo, camelot = soll[n]
            gemessen = e.get("quelle_bpm")
            w[n] = {"soll_bpm": tempo, "gemessen_bpm": gemessen, "camelot": e.get("camelot"), "soll_camelot": camelot}
            if gemessen is None or abs(float(gemessen) - tempo) > BPM_TOLERANZ:
                schlecht.append(f"{n}: rendered {tempo} bpm, analysis found {gemessen}")
            if e.get("camelot") != camelot:
                schlecht.append(f"{n}: rendered in {camelot}, analysis found {e.get('camelot')}")
        if schlecht:
            t.rot("the analysis failed: " + "; ".join(schlecht))


def schritt_laden(t, z):
    with t.schritt("j1.laden", "both tracks are on deck 1 and deck 2", pflicht=True) as w:
        assert len(z.mids) == 2, "no prepared tracks to load"
        namen = [p.name for p in z.dateien]
        for deck, n in ((1, namen[0]), (2, namen[1])):
            _ok(_ruf(t, z, "POST", "/laden", {"deck": deck, "material_id": z.mids[n]}), f"load deck {deck}")
        assert t.warte_bis(lambda: all(_deck(t, d).get("material_id") == z.mids[n] and _deck(t, d).get("status") for d, n in ((1, namen[0]), (2, namen[1]))),
                           60, "both decks loaded"), "the decks did not show the loaded tracks"
        w["decks"] = {d: {"titel": _deck(t, d).get("titel"), "basis_bpm": _deck(t, d).get("basis_bpm"), "camelot": _deck(t, d).get("camelot")} for d in (1, 2)}


def schritt_mitschnitt(t, z):
    """REC MIX, then PLAY on deck 1.

    The recorder takes about a second to answer, and it captures from the moment of the call. Deck 1 therefore starts while the call is
    still on its way: the file has the head of the mix in it and no silence of over a second before it."""
    with t.schritt("j1.mitschnitt", "REC MIX starts the recording, PLAY starts deck 1 with it") as w:
        _ok(_ruf(t, z, "POST", "/regler", {"pfad": "keylock", "nach": 1 if KEYLOCK else 0, "ab": "jetzt"}), "key lock")
        w["keylock"] = KEYLOCK
        w["start_von_deck_1"] = A_START
        _ok(t.ruf("POST", "/tempo", {"bpm": z.tempo}), "master tempo")
        assert t.warte_bis(lambda: abs(float((_lage(t).get("uhr") or {}).get("bpm") or 0) - z.tempo) < 0.2, 30, f"master at {z.tempo} bpm"), \
            f"the master tempo did not reach {z.tempo}"
        if A_START == "sync":
            t.warte_bis(lambda: (_beat(t) % 4) >= 3.0, 20, "the last beat of a bar")
        rec = {}

        def aufnehmen():
            rec["a"] = t.ruf("POST", "/mitschnitt/start", {}, timeout=30)
        th = threading.Thread(target=aufnehmen)
        t0 = time.monotonic()
        th.start()
        time.sleep(0.05)                 # the recorder call is on its way; the page plays deck 1 from here
        try:
            # PLAY is a hand grip: the page sends /griff with the key down (1) and up (0); /regler has no such path and Cypher may not use /griff
            if A_START == "sync":
                druck = _ruf(t, z, "POST", "/deck/start", {"deck": 1, "ab": "takt"})
                los = druck
            else:
                z.als_andreas.append("POST /griff deck/1/play")
                druck = t.ruf("POST", "/griff", {"pfad": "deck/1/play", "u": 1}, quelle="andreas")
                los = t.ruf("POST", "/griff", {"pfad": "deck/1/play", "u": 0}, quelle="andreas")
            offen = _ruf(t, z, "POST", "/regler", {"pfad": "deck/1/fader", "nach": 0, "ab": "jetzt"})
        finally:
            th.join(40)
        z.mix_start = t0
        a = rec["a"]
        _ok(a, "mitschnitt/start")
        z.mitschnitt_laeuft = True
        w["datei"] = a.j.get("datei")
        w["start_dauer_s"] = round(time.monotonic() - t0, 3)
        _ok(druck, "play deck 1")
        _ok(los, "release play deck 1")
        _ok(offen, "open fader 1")
        assert t.warte_bis(lambda: _deck(t, 1).get("status") in (2, 3), 20, "deck 1 playing"), "deck 1 did not start"
        z.a_beat = _start_beat(t, 1)
        w["a_beat"] = z.a_beat
        w["deck1_lage"] = _deck(t, 1)
        st = t.ruf("GET", "/mitschnitt/stand")
        assert st.code == 200 and st.j.get("laeuft") is True, f"the recording does not run: {st.j}"


def schritt_spielen(t, z):
    with t.schritt("j1.spielen", "deck 1 plays and the master is audible", pflicht=True) as w:
        from tour import runner as laeufer
        import dauerlauf

        def laut():
            a = t.ruf("GET", "/pegel?sek=1", timeout=10)
            db = dauerlauf.master_db(a.j) if a.code == 200 else None
            return db is not None and db > laeufer.STUMM_DB
        assert t.warte_bis(laut, 15, "master above -60 dB"), "deck 1 plays but the master stays silent"
        w["deck1"] = _deck(t, 1).get("status")


def schritt_einsatz(t, z):
    """Deck 2 comes in with SYNC (quiet, bass down). Its downbeat must be a whole number of bars after deck 1's start."""
    with t.schritt("j1.einsatz", "SYNC starts deck 2 on a bar line, quiet and with its bass down") as w:
        assert z.a_beat is not None, "the start beat of deck 1 is not known"
        _warte_beat(t, z.a_beat + VORLAUF_TAKTE_A * 4, 120)   # deck 1 plays alone for a few bars first
        _ok(_ruf(t, z, "POST", "/regler", {"pfad": "deck/2/eq/tief", "nach": -60, "ab": "jetzt"}), "bass of deck 2 down")
        _ok(_ruf(t, z, "POST", "/regler", {"pfad": "deck/2/fader", "nach": LEISE_DB, "ab": "jetzt"}), "open fader 2 quietly")
        a = _ok(_ruf(t, z, "POST", "/deck/start", {"deck": 2, "ab": "takt"}), "SYNC deck 2")
        ab = (a.j.get("felder") or {}).get("ab_beat") if isinstance(a.j, dict) else None
        assert ab is not None, f"SYNC gave no start beat: {a.j}"
        z.b_beat = float(ab)   # the bar the page asked for; the core may move the start to the bar phase of the playing deck (politik 3 takt)
        assert t.warte_bis(lambda: _deck(t, 2).get("status") in (2, 3), 30, "deck 2 playing"), "deck 2 did not start"
        echt = _start_beat(t, 2)   # measured: where deck 2 really started, like deck 1 above
        if echt is not None:
            z.b_beat = echt
        w["a_beat"], w["b_beat"] = z.a_beat, z.b_beat
        versatz = (z.b_beat - z.a_beat) % 4
        w["takt_versatz_beats"] = round(min(versatz, 4 - versatz), 3)
        w["deck2_lage"] = _deck(t, 2)
        if w["takt_versatz_beats"] > 0.05:
            t.rot(f"SYNC puts deck 2's downbeat on clock beat {z.b_beat:g}, deck 1 started on clock beat {z.a_beat:g}: the bars of the two decks are "
                  f"{w['takt_versatz_beats']:g} beat(s) apart")


def schritt_uebergang(t, z):
    """16 bars: fader 1 down and fader 2 up in dB (linear), bass swap in the middle, deck 1 stops."""
    with t.schritt("j1.uebergang", f"crossfade over {UEBERGANG_TAKTE} bars with a bass swap, then deck 1 stops") as w:
        takte = UEBERGANG_TAKTE
        assert z.b_beat is not None, "deck 2 was not started"
        _warte_beat(t, z.b_beat + STILLE_VOR_RAMPE_TAKTE * 4, 120)
        jetzt = _beat(t)
        z.rampe_beat = jetzt + 4 - (jetzt % 4)       # the next bar line, where the ramps start
        _ok(_ruf(t, z, "POST", "/regler", {"pfad": "deck/1/fader", "nach": LEISE_DB, "takte": takte, "ab": "takt", "form": "linear"}), "ramp fader 1")
        _ok(_ruf(t, z, "POST", "/regler", {"pfad": "deck/2/fader", "nach": 0, "takte": takte, "ab": "takt", "form": "linear"}), "ramp fader 2")
        _warte_beat(t, z.rampe_beat + takte * 4 / 2, 120)
        z.swap_beat = _beat(t)
        _ok(_ruf(t, z, "POST", "/regler", {"pfad": "deck/2/eq/tief", "nach": 0, "takte": 1, "ab": "jetzt", "form": "linear"}), "bass of 2 back")
        _ok(_ruf(t, z, "POST", "/regler", {"pfad": "deck/1/eq/tief", "nach": -60, "takte": 1, "ab": "jetzt", "form": "linear"}), "bass of 1 away")
        z.swap_beat_ende = _beat(t)
        _warte_beat(t, z.rampe_beat + takte * 4, 120)
        _ok(_ruf(t, z, "POST", "/regler", {"pfad": "deck/1/fader", "nach": -200, "ab": "jetzt"}), "close fader 1")
        _ok(_ruf(t, z, "POST", "/deck/stopp", {"deck": 1, "ab": "jetzt"}), "stop deck 1")
        z.mix_ende = time.monotonic()
        z.ende_beat = _beat(t)
        w.update(rampe_beat=z.rampe_beat, swap_beat=z.swap_beat, swap_beat_ende=z.swap_beat_ende, ende_beat=z.ende_beat)
        r = _lage(t).get("regler", {})
        w["fader_2_ende"] = r.get("deck/2/fader")
        w["deck1_status"] = _deck(t, 1).get("status")


FX_PARAM = {"einheit": 1, "art": 1, "beats": 0.5, "wet": 0.8, "param1": 0.6, "param2": 0.5, "param3": 0.5}


def schritt_ausklang(t, z):
    """Deck 2 plays on alone: a clean stretch, then the beat FX for a few bars, then clean again."""
    with t.schritt("j1.ausklang", "deck 2 plays alone: clean, beat FX on, beat FX off") as w:
        assert z.ende_beat is not None, "the transition did not run"
        _warte_beat(t, z.ende_beat + AUSKLANG_SAUBER_TAKTE * 4, 120)
        _ok(_ruf(t, z, "POST", "/fx/zuweisung", {"einheit": 1, "kanal": "master", "an": True}), "assign fx 1")
        z.fx_an_beat = _beat(t)
        _ok(_ruf(t, z, "POST", "/fx", dict(FX_PARAM, an=True)), "fx 1 on")
        _warte_beat(t, z.fx_an_beat + FX_TAKTE * 4, 60)
        z.fx_aus_beat = _beat(t)
        _ok(_ruf(t, z, "POST", "/fx", dict(FX_PARAM, wet=0.0, an=False)), "fx 1 off")
        _warte_beat(t, z.fx_aus_beat + FX_NACH_TAKTE * 4, 60)
        z.stopp_beat = _beat(t)
        w.update(fx_an_beat=z.fx_an_beat, fx_aus_beat=z.fx_aus_beat, stopp_beat=z.stopp_beat)


def schritt_mitschnitt_stopp(t, z):
    """REC MIX again: the recording stops and names its file; deck 2 stops."""
    with t.schritt("j1.mitschnitt.stopp", "the recording stops and names its file") as w:
        if not z.mitschnitt_laeuft:
            t.rot("no recording was started")
            return
        a = _ok(t.ruf("POST", "/mitschnitt/stopp", {}, timeout=60), "mitschnitt/stopp")
        z.mitschnitt_laeuft = False
        z.aufnahme = a.j
        w.update({k: a.j.get(k) for k in ("datei", "sekunden", "luecken", "spruenge")})
        _ruf(t, z, "POST", "/deck/stopp", {"deck": 2, "ab": "jetzt"})
        _ruf(t, z, "POST", "/regler", {"pfad": "deck/2/fader", "nach": -200, "ab": "jetzt"})
        if a.j.get("luecken") or a.j.get("spruenge"):
            t.rot(f"the recorder reports {a.j.get('luecken')} gaps and {a.j.get('spruenge')} jumps")


def schritt_datei(t, z):
    """The recorded WAV: as long as the mix, no NaN, no clipping, no DC, and no silence longer than one second."""
    with t.schritt("j1.datei", "the recorded file is a whole mix: long enough, no clipping, never silent for over 1 s") as w:
        assert z.aufnahme and z.aufnahme.get("datei"), "no recording file was reported"
        pfad = Path(z.aufnahme["datei"])
        mix_s = (z.mix_ende - z.mix_start) if z.mix_start and z.mix_ende else 0.0
        w["mix_sekunden"] = round(mix_s, 1)
        e = t.pruefe_datei(pfad, mix_s, max_stille=LUECKE_MAX_S)
        w.update({"dauer_s": e.dauer_s, "gruende": e.gruende, "spitze_db": e.spitze_db, "dc": e.dc, "laengste_stille_s": e.max_stille_s})
        try:
            import shutil
            beleg = Path(t.ausgabe) / "mitschnitt"
            beleg.mkdir(parents=True, exist_ok=True)
            for ende in ("", ".json", ".log"):
                if Path(str(pfad) + ende).is_file():
                    shutil.copy(str(pfad) + ende, beleg / (pfad.name + ende))
            w["beleg"] = str(beleg / pfad.name)
        except OSError as ex:
            w["beleg_fehler"] = str(ex)
        if e.gruende:
            t.rot("the file fails: " + ", ".join(e.gruende) + (f" (longest silence {e.max_stille_s:.1f} s)" if "stille" in e.gruende else ""))


# ---------------------------------------------------------------- measuring the recording

def lade_signal(pfad):
    """The recording as mono float64 samples at 48 kHz."""
    import numpy as np
    r = subprocess.run(["ffmpeg", "-v", "error", "-i", str(pfad), "-f", "f32le", "-acodec", "pcm_f32le", "-ac", "1", "-ar", str(RATE), "-"], capture_output=True)
    if r.returncode != 0 or not r.stdout:
        raise RuntimeError(f"cannot decode {pfad}: {r.stderr.decode(errors='replace')[-200:]}")
    return np.nan_to_num(np.frombuffer(r.stdout, dtype="<f4").astype("float64"))


def huellkurve(x, lo=40.0, hi=200.0):
    """Envelope of the kick band at 1 kHz (zero phase filters: no delay of its own)."""
    import numpy as np
    from scipy.signal import butter, sosfiltfilt
    y = np.abs(sosfiltfilt(butter(4, [lo, hi], btype="band", fs=RATE, output="sos"), x))
    e = sosfiltfilt(butter(2, 40.0, fs=RATE, output="sos"), y)
    return e[::RATE // 1000]


def einsaetze(huelle):
    import numpy as np
    return np.maximum(0.0, np.diff(huelle, prepend=huelle[0]))


def profil(einsatz, von_s, bis_s, periode_s):
    """Onset strength of the window [von_s, bis_s) folded onto one beat period, in about 1 ms bins (circular, lightly smoothed)."""
    import numpy as np
    n = max(8, int(round(periode_s * 1000)))
    i0, i1 = max(0, int(von_s * 1000)), min(len(einsatz), int(bis_s * 1000))
    if i1 - i0 < 2 * n:
        raise ValueError(f"window {von_s:.1f}..{bis_s:.1f} s is shorter than two beats")
    idx = np.arange(i0, i1)
    phase = (idx % (periode_s * 1000)) / (periode_s * 1000)
    h = np.bincount((phase * n).astype(int) % n, weights=einsatz[i0:i1], minlength=n)
    return (np.roll(h, 1) + 2 * h + np.roll(h, -1)) / 4.0


def spitze_ms(h, periode_s):
    """Phase of a folded profile's main peak in ms: the centre of mass of the stretch around the maximum that stays above half of it.

    The highest bin alone is not stable: a kick's onset curve is flat on top, and in one real recording three neighbouring bins were within 3 %,
    so the maximum jumped by 20 ms between windows of the same mix."""
    import numpy as np
    n = len(h)
    k = int(h.argmax())
    mitte = n // 2
    g = np.roll(h, mitte - k)                      # the maximum sits in the middle, the circle cut at the far side
    schwelle = 0.5 * g[mitte]
    lo = mitte
    while lo > 0 and g[lo - 1] > schwelle:
        lo -= 1
    hi = mitte
    while hi < n - 1 and g[hi + 1] > schwelle:
        hi += 1
    i = np.arange(lo, hi + 1)
    w = g[lo:hi + 1] - schwelle
    schwerpunkt = float((i * w).sum() / w.sum()) if w.sum() > 0 else float(mitte)
    return ((schwerpunkt - mitte + k) % n) * periode_s * 1000 / n


def versatz_ms(ref, x, periode_s):
    """x against ref on the beat circle, in (-period/2, +period/2]."""
    p = periode_s * 1000
    d = (x - ref) % p
    return d - p if d > p / 2 else d


def ton_frequenz(x, f0, von_s, bis_s, spanne=8.0):
    """Frequency of the strongest line within f0 +- spanne Hz in the window, in Hz (Hann window, zero padded, parabolic)."""
    import numpy as np
    seg = x[int(von_s * RATE):int(bis_s * RATE)]
    if len(seg) < RATE:
        raise ValueError("window shorter than 1 s")
    seg = seg * np.hanning(len(seg))
    n = 1 << int(np.ceil(np.log2(len(seg) * 8)))
    sp = np.abs(np.fft.rfft(seg, n))
    f = np.fft.rfftfreq(n, 1.0 / RATE)
    m = (f >= f0 - spanne) & (f <= f0 + spanne)
    k0 = np.flatnonzero(m)
    k = k0[np.argmax(sp[k0])]
    y0, y1, y2 = sp[k - 1], sp[k], sp[k + 1]
    d = 0.5 * (y0 - y2) / (y0 - 2 * y1 + y2) if (y0 - 2 * y1 + y2) != 0 else 0.0
    return float((k + d) * RATE / n)


def ton_db(x, f, von_s, bis_s):
    """Level of the sine of frequency f in the window (dB, amplitude of the line)."""
    import numpy as np
    seg = x[int(von_s * RATE):int(bis_s * RATE)]
    if len(seg) < RATE // 2:
        raise ValueError("window shorter than 0.5 s")
    n = np.arange(len(seg))
    fenster = np.hanning(len(seg))
    z = np.sum(seg * fenster * np.exp(-2j * np.pi * f * n / RATE)) * 2.0 / np.sum(fenster)
    return 20 * math.log10(abs(z) + 1e-12)


def halb_anteil(einsatz, von_s, bis_s, periode_s):
    """How much of the onset strength lies half a beat after the strongest phase, relative to the strongest phase (0 = nothing, 1 = as strong)."""
    import numpy as np
    h = profil(einsatz, von_s, bis_s, periode_s)
    n = len(h)
    k = int(h.argmax())
    br = max(2, n // 32)

    def masse(mitte):
        return float(sum(h[(mitte + j) % n] for j in range(-br, br + 1)))
    return masse((k + n // 2) % n) / max(masse(k), 1e-12)


def erster_einsatz_s(einsatz):
    """First time the kick band gets going (a quarter of the strongest onset of the first ten seconds)."""
    import numpy as np
    k = einsatz[:10000]
    hit = np.flatnonzero(k > 0.25 * k.max())
    return float(hit[0]) / 1000.0 if len(hit) else 0.0


class Zeitplan:
    """Clock beats to seconds in the recording: deck 1 starts at `a_beat` and its first kick is the first one the recording hears."""

    def __init__(self, z, einsatz):
        self.tempo = z.tempo
        self.periode = 60.0 / z.tempo
        self.a = z.a_beat
        self.anker = erster_einsatz_s(einsatz)

    def s(self, beat):
        return self.anker + (beat - self.a) * self.periode


def _signal(z):
    if z.signal is None:
        assert z.aufnahme and z.aufnahme.get("datei"), "no recording to measure"
        z.signal = lade_signal(z.aufnahme["datei"])
    return z.signal


def _gebraucht(z, *namen):
    fehlt = [n for n in namen if getattr(z, n) is None]
    assert not fehlt, "the steps before did not record: " + ", ".join(fehlt)


def messe_gitter(x, z):
    """Kick offsets of deck 2 against deck 1's grid, in ms: {'ueberlappung': .., 'allein': ..} plus the phases."""
    einsatz = einsaetze(huellkurve(x))
    plan = Zeitplan(z, einsatz)
    p = plan.periode
    ref = spitze_ms(profil(einsatz, plan.s(z.a_beat + 4), plan.s(z.b_beat - 2), p), p)       # deck 1 alone
    ue = spitze_ms(profil(einsatz, plan.s(z.swap_beat_ende + 5), plan.s(z.rampe_beat + UEBERGANG_TAKTE * 4 - 4), p), p)   # both play, deck 2 owns the lows
    al = spitze_ms(profil(einsatz, plan.s(z.ende_beat + 8), plan.s(z.fx_an_beat), p), p)   # deck 1 is gone
    return {"referenz_ms": round(ref, 2), "ueberlappung_ms": round(versatz_ms(ref, ue, p), 2), "allein_ms": round(versatz_ms(ref, al, p), 2),
            "anker_s": round(plan.anker, 3)}


def messe_ton(x, z, name):
    """Pitch of the marker tone of the file `name` in the stretch where deck 2 plays alone and clean, in cents against the rendered one."""
    einsatz = einsaetze(huellkurve(x))
    plan = Zeitplan(z, einsatz)
    soll = musik.marker(name)
    f = ton_frequenz(x, soll, plan.s(z.ende_beat + 8), plan.s(z.fx_an_beat))
    return f, 1200.0 * math.log2(f / soll)


def _marker_hz(z, name):
    """Where a marker sits in the mix: at its rendered pitch with key lock, shifted by the playback factor without it."""
    faktor = 1.0 if KEYLOCK else z.tempo / dict((n, t) for n, t, *_ in musik.TRACKS)[name]
    return musik.marker(name) * faktor


def messe_bass(x, z, namen):
    """Marker levels of deck 1 and deck 2 before and after the bass swap, minus what the faders did in between.

    The level before is the median of 6-beat windows over the 16 beats before the swap, each moved to the swap's fader position: the
    marker sits among program content near 100 Hz, and one window can land on a cancellation (one run read 11 dB too low)."""
    import numpy as np
    plan = Zeitplan(z, einsaetze(huellkurve(x)))
    je_beat = abs(LEISE_DB) / (UEBERGANG_TAKTE * 4)             # each fader moves this far per beat (deck 1 down, deck 2 up)
    breite = 6
    nach = (plan.s(z.swap_beat_ende + 5), plan.s(z.swap_beat_ende + 12))
    fader = je_beat * ((z.swap_beat_ende + 8.5) - z.swap_beat)
    out = {"fader_db": round(fader, 1)}
    for nr, (name, richtung) in enumerate(zip(namen, (-1, 1)), start=1):          # the fader moves deck 1 down and deck 2 up
        f = _marker_hz(z, name)
        vor = float(np.median([ton_db(x, f, plan.s(b), plan.s(b + breite)) - richtung * je_beat * (b + breite / 2 - z.swap_beat)
                               for b in np.arange(z.swap_beat - 16, z.swap_beat - breite + 0.01, 1.0)]))
        danach = ton_db(x, f, *nach)
        erwartet = vor + richtung * fader                       # what the fader alone would leave
        out[f"deck{nr}_vor_db"] = round(vor, 1)
        out[f"deck{nr}_nach_db"] = round(danach, 1)
        out["deck1_abfall_db" if nr == 1 else "deck2_anstieg_db"] = round(erwartet - danach if nr == 1 else danach - erwartet, 1)
    return out


def messe_fx(x, z):
    einsatz = einsaetze(huellkurve(x))
    plan = Zeitplan(z, einsatz)
    p = plan.periode
    vor = halb_anteil(einsatz, plan.s(z.ende_beat + 8), plan.s(z.fx_an_beat), p)
    an = halb_anteil(einsatz, plan.s(z.fx_an_beat + 2), plan.s(z.fx_aus_beat), p)
    nach = halb_anteil(einsatz, plan.s(z.fx_aus_beat + 6), plan.s(z.stopp_beat - 1), p)
    return {"vor": round(vor, 3), "an": round(an, 3), "nach": round(nach, 3)}


def schritt_sync(t, z):
    with t.schritt("j1.sync", f"deck 2's kicks sit on deck 1's beat grid in the recording (within {GITTER_TOLERANZ_MS:g} ms)") as w:
        _gebraucht(z, "a_beat", "b_beat", "swap_beat_ende", "rampe_beat", "ende_beat", "fx_an_beat")
        m = messe_gitter(_signal(z), z)
        w.update(m)
        schlecht = [f"{n} {m[k]:+.1f} ms" for n, k in (("in the overlap", "ueberlappung_ms"), ("after deck 1 left", "allein_ms")) if abs(m[k]) > GITTER_TOLERANZ_MS]
        if schlecht:
            t.rot(f"deck 2's kicks are off deck 1's grid: " + ", ".join(schlecht) + f" (one beat is {60000.0 / z.tempo:.0f} ms)")


def schritt_keylock(t, z):
    with t.schritt("j1.keylock", f"key lock holds the pitch of deck 2 in the recording (within {TON_TOLERANZ_CENT:g} cents) at the master tempo") as w:
        _gebraucht(z, "a_beat", "ende_beat", "fx_an_beat")
        name = z.dateien[1].name
        f, cent = messe_ton(_signal(z), z, name)
        faktor = z.tempo / musik.TRACKS[1][1]
        w.update(marker_hz=round(f, 2), marker_soll_hz=round(musik.marker(name), 2), cent=round(cent, 1), abspielfaktor=round(faktor, 4),
                 cent_ohne_keylock=round(1200 * math.log2(faktor), 1), keylock=KEYLOCK)
        if abs(cent) > TON_TOLERANZ_CENT:
            t.rot(f"deck 2 sounds {cent:+.0f} cents from the rendered pitch while it plays at {faktor:.4f} of its tempo (key lock {'on' if KEYLOCK else 'off'})")


def schritt_eq(t, z):
    with t.schritt("j1.eq", f"the bass swap is in the recording: the low band of deck 1 drops, that of deck 2 rises (at least {BASS_ABFALL_DB:g} dB each)") as w:
        _gebraucht(z, "a_beat", "swap_beat", "swap_beat_ende")
        m = messe_bass(_signal(z), z, [p.name for p in z.dateien])
        w.update(m)
        schlecht = []
        if m["deck1_abfall_db"] < BASS_ABFALL_DB:
            schlecht.append(f"the low band of deck 1 dropped {m['deck1_abfall_db']:.1f} dB beyond its fader")
        if m["deck2_anstieg_db"] < BASS_ABFALL_DB:
            schlecht.append(f"the low band of deck 2 rose {m['deck2_anstieg_db']:.1f} dB beyond its fader")
        if schlecht:
            t.rot("the bass swap does not show in the recording: " + "; ".join(schlecht))


def schritt_fx(t, z):
    with t.schritt("j1.fx", f"the beat FX changes the recording while it is on (half-beat share at least {FX_ANSTIEG:g} times the one without)") as w:
        _gebraucht(z, "a_beat", "fx_an_beat", "fx_aus_beat", "stopp_beat", "ende_beat")
        m = messe_fx(_signal(z), z)
        w.update(m)
        ohne = max(m["vor"], m["nach"], 0.02)
        w["anstieg"] = round(m["an"] / ohne, 2)
        if m["an"] < FX_ANSTIEG * ohne:
            t.rot(f"the beat FX is on for {FX_TAKTE} bars but the half-beat share is {m['an']:.2f} against {m['vor']:.2f} before and {m['nach']:.2f} after")


def schritte(t):
    z = Zustand()
    ordner = Path(t.ausgabe) / f"musik-{musik.fingerabdruck(t.kurz)}"      # a new fixture is a new folder, never a stale preparation
    schritt_musik(t, z, ordner)
    schritt_analyse(t, z, ordner)
    schritt_laden(t, z)
    schritt_mitschnitt(t, z)
    schritt_spielen(t, z)
    schritt_einsatz(t, z)
    schritt_uebergang(t, z)
    schritt_ausklang(t, z)
    schritt_mitschnitt_stopp(t, z)
    schritt_datei(t, z)
    schritt_sync(t, z)
    schritt_keylock(t, z)
    schritt_eq(t, z)
    schritt_fx(t, z)
    try:
        import json
        ereignisse = {k: v for k, v in vars(z).items() if k in ("tempo", "a_beat", "b_beat", "rampe_beat", "swap_beat", "swap_beat_ende", "ende_beat",
                                                                "fx_an_beat", "fx_aus_beat", "stopp_beat")}
        ereignisse["datei"] = (z.aufnahme or {}).get("datei")
        Path(t.ausgabe).mkdir(parents=True, exist_ok=True)
        (Path(t.ausgabe) / "ereignisse.json").write_text(json.dumps(ereignisse, indent=1))      # for measuring a recording again offline
    except OSError:
        pass
    if z.als_andreas and hasattr(t.instanz, "hinweise"):
        t.instanz.hinweise.append("repeated as the hand (hearing check or owner-only): " + ", ".join(sorted(set(z.als_andreas))))
