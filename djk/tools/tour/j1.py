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

After those, a second block drives six features no other tour touches, on deck 1 with its fader closed or opened as the step needs. Each step
measures an effect (a position read back from one /lage answer, or a level on the /pegel meters), not just a 200:
  j1.hotcues      cues 1 to 8 (shot and loop) read back; a played shot cue lands phase-true; a loop cue leaves the deck looping
  j1.sprung       a jump of +8 and -8 beats moves the play position by that distance
  j1.loop         a 4-beat deck loop keeps the position inside the loop over two bars (and wraps); the other lengths up to 64 are accepted
  j1.scrub        a scrub out and back leaves the phase unchanged; a drag of two beats moves the position by two beats
  j1.vorhoerdeck  the pre-listen deck (a library track to the headphones) is on the cue meter, not on the master; SKIP without a headphone edge
  j1.vorhoeren    PFL on a closed channel is on the cue meter, not on the master or the channel; silent again after PFL off
  j1.kompressor   the channel compressor lowers the peak of a loud deck by a set amount, and gives it back when off
  j1.ausgang      the cue/master mix and the cue level move the cue meter by the amounts the mix maths says
  j1.hall         the REVERB beat FX lengthens the tail after the deck stops
PFL and the cue knobs are hand controls (the core answers a Cypher call with a refusal), so those calls go out as `andreas` and are named in the notes.
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


def ton_band_db(x, f, von_s, bis_s, halb=1.0):
    """Level of the marker around frequency f in the window (dB, amplitude of a line with the same power): the power of the bins within f +- halb Hz.
    A marker that went through the key lock stretcher is not a line: its carrier wanders about +-0.5 Hz and swells, so the coherent line at the nominal
    pitch (`ton_db`) reads 2 to 10 dB low depending on where the window sits. The band power does not care where the energy sits inside the band."""
    import numpy as np
    seg = x[int(von_s * RATE):int(bis_s * RATE)]
    if len(seg) < RATE // 2:
        raise ValueError("window shorter than 0.5 s")
    fenster = np.hanning(len(seg))
    sp = np.fft.rfft(seg * fenster)
    frq = np.fft.rfftfreq(len(seg), 1 / RATE)
    p = np.abs(sp[(frq >= f - halb) & (frq <= f + halb)]) ** 2
    # a sine of amplitude a gives |X|^2 = (a sum(w) / 2)^2 in the bin and spreads over bins by the window's equivalent noise bandwidth (1.5 bins, Hann)
    a2 = 4.0 * p.sum() / 1.5 / np.sum(fenster) ** 2
    return 10 * math.log10(a2 + 1e-24)


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
        vor_je_fenster = [ton_band_db(x, f, plan.s(b), plan.s(b + breite)) - richtung * je_beat * (b + breite / 2 - z.swap_beat)
                          for b in np.arange(z.swap_beat - 16, z.swap_beat - breite + 0.01, 1.0)]
        # Deck 1's marker is there before the swap and follows its fader: the median. Deck 2's is killed, what the windows read is a floor of the other
        # deck's program, and that follows deck 1's fader down (10 to 14 dB over these windows in the recordings), not deck 2's fader up, which is what the
        # compensation adds. The compensated floor is highest in the early windows, so the best bound on the killed marker is a low quartile.
        vor = float(np.percentile(vor_je_fenster, 50 if richtung < 0 else 25))
        danach = ton_band_db(x, f, *nach)
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


# ---------------------------------------------------------------- 1.0 features no tour drove before
#
# The steps below run after the recording is measured, on deck 1 (the track at the master tempo, so source beats and clock beats run 1:1).
# Each one measures an effect the page can be asked for, not the 200 of the call: a position read back, a level on a meter, a tail in seconds.
# A position is read as `source beat - clock beat` from ONE /lage answer: it stays constant while the deck plays, a jump changes it by the
# distance jumped, so a stale clock cancels out.

EXT_DECK = 1
HOTCUE_ERSTER = 12.0                  # source beat of hotcue 1; the next ones follow HOTCUE_ABSTAND beats later (eight cues, track is 90 s or more)
HOTCUE_ABSTAND = 12.0
HOTCUE_LOOPS = {2: 4, 6: 8}           # cue number -> loop length in beats; every other cue is a shot cue
HOTCUE_TOLERANZ_BEATS = 0.25          # where a played cue lands, against where the cue is (a read of the position can be a cycle old)
SPRUNG_BEATS = 8.0
SPRUNG_TOLERANZ_BEATS = 0.25
LOOP_BEATS = 4
LOOP_MESS_BEATS = 8                   # two bars inside the loop
LOOP_RAND_BEATS = 0.3                 # slack at both ends of the loop for a position read that is a cycle old
LOOP_LAENGEN = (1, 2, 8, 16, 32, 64)  # the other lengths of the length buttons (4 is measured above): each must show as the loop's length
SCRUB_BEATS = 2.0                     # how far the hand drags
SCRUB_DAUER_S = 1.5
SCRUB_TOLERANZ_BEATS = 0.25           # the deck's phase against the master after the release, against before the grab
PEGEL_NICHTS_DB = -200.0
KANAL_STUMM_DB = -60.0                # a meter below this is silent (the tour's own limit for "silent", see laeufer.STUMM_DB)
VORHOEREN_ABSTAND_DB = 20.0           # the cue meter with a pre-listen deck on, above the cue meter without it
KOMP_SCHWELLE_DB = -50.0              # far under the loud deck (its peaks sit near -20 dB), so the reduction does not hang on the crest of the material
KOMP_RATIO = 10.0
KOMP_MINDERUNG_DB = 6.0               # the channel peak with the compressor on, below the peak without it
KOMP_FENSTER_S = 3                    # peak window on the loop: longer than the 4-beat loop (1.94 s at 124 bpm)
HALL_ART = 5                          # beatfx.h: REVERB
HALL_BEATS = 4                        # decay time of the hall (T60), in beats
HALL_PARAM = {"einheit": 2, "art": HALL_ART, "beats": HALL_BEATS, "wet": 0.9, "param1": 0.8, "param2": 0.5, "param3": 0.5}
HALL_VERLAENGERUNG_S = 0.5            # the tail after a stop with the hall on, longer than without it
CUE_MASTER_DB = -12.0                 # cue/pegel default: the master part of the cue mix sits this far below the master
CUE_MASTER_TOLERANZ_DB = 3.0


def _punkt(t, nr=EXT_DECK):
    """The clock beat and the source beat of deck `nr` from one /lage answer, or None while the deck shows no position."""
    lage = _lage(t)
    uhr = float((lage.get("uhr") or {}).get("beat") or 0.0)
    for d in lage.get("decks") or []:
        if d.get("deck") == nr and d.get("quell_beat") is not None:
            return {"uhr": uhr, "quell": float(d["quell_beat"]), "status": d.get("status")}
    return None


def versatz(p):
    """Source beat minus clock beat: what a jump changes and a running deck keeps."""
    return p["quell"] - p["uhr"]


def versatz_mitte(t, nr=EXT_DECK, n=3, pause_s=0.12):
    """The median of `n` readings of `versatz` (a single reading is a cycle old at worst)."""
    werte = []
    for i in range(n):
        p = _punkt(t, nr)
        if p is not None:
            werte.append(versatz(p))
        if i < n - 1:
            time.sleep(pause_s)
    assert werte, f"deck {nr} shows no position"
    return sorted(werte)[len(werte) // 2]


def landung_abweichung(ziel, ab_beat, p):
    """How far deck position `p` is from where a jump to source beat `ziel` that landed at clock beat `ab_beat` must have brought it (beats)."""
    return p["quell"] - (ziel + p["uhr"] - ab_beat)


def loop_drinnen(proben, start, laenge, rand=LOOP_RAND_BEATS):
    """The source beats of `proben` that lie outside the loop [start, start + laenge] (slack `rand` at both ends)."""
    return [q for q in proben if q < start - rand or q > start + laenge + rand]


def loop_runden(proben, mindest=1.0):
    """How often the position went back by more than `mindest` between two readings: each is one wrap of the loop."""
    return sum(1 for a, b in zip(proben, proben[1:]) if b < a - mindest)


def _kanaele_db(t, *kanaele, sek=1):
    """Peaks of several /pegel channels from ONE answer (the same window, so a track whose level moves does not skew a difference);
    PEGEL_NICHTS_DB for a channel that is missing or silent."""
    a = t.ruf("GET", f"/pegel?sek={sek}", timeout=10)
    k = a.j.get("kanaele") if a.code == 200 and isinstance(a.j, dict) else None
    aus = []
    for kanal in kanaele:
        v = k.get(kanal) if isinstance(k, dict) else None
        db = v.get("max_db") if isinstance(v, dict) else None
        aus.append(float(db) if isinstance(db, (int, float)) and not isinstance(db, bool) and db == db else PEGEL_NICHTS_DB)
    return tuple(aus)


def _kanal_db(t, kanal, sek=1):
    """Peak of one /pegel channel over the last `sek` seconds; PEGEL_NICHTS_DB when the channel is missing or silent."""
    return _kanaele_db(t, kanal, sek=sek)[0]


def _als_hand(t, z, pfad, nach):
    """A control only the hand may turn (PFL, cue mix and level): called as the owner and named in the notes."""
    z.als_andreas.append(f"POST /regler {pfad}")
    return _ok(t.ruf("POST", "/regler", {"pfad": pfad, "nach": nach, "ab": "jetzt"}, quelle="andreas"), f"{pfad} to {nach:g}")


def _deck_laeuft(t, z, nr=EXT_DECK, fader_zu=True):
    """Deck `nr` plays at the master tempo, outside a loop; its channel fader closed unless `fader_zu` is False."""
    d = _deck(t, nr)
    if d.get("status") == 3:
        _ok(_ruf(t, z, "POST", "/deck/loop", {"deck": nr, "laenge": 0, "raster": 0}), f"loop off on deck {nr}")
    if d.get("status") not in (2, 3):
        if fader_zu:
            _ok(_ruf(t, z, "POST", "/regler", {"pfad": f"deck/{nr}/fader", "nach": -200, "ab": "jetzt"}), f"close fader {nr}")
        _ok(_ruf(t, z, "POST", "/deck/start", {"deck": nr, "ab": "takt"}), f"SYNC deck {nr}")
        assert t.warte_bis(lambda: _deck(t, nr).get("status") in (2, 3), 30, f"deck {nr} playing"), f"deck {nr} did not start"
    assert t.warte_bis(lambda: _deck(t, nr).get("status") == 2, 15, f"deck {nr} outside a loop"), f"deck {nr} stays in a loop"


def schritt_hotcues(t, z):
    with t.schritt("j1.hotcues", f"hotcues 1 to 8 are set and read back; playing a cue puts the deck on it (within {HOTCUE_TOLERANZ_BEATS:g} beat)") as w:
        _deck_laeuft(t, z)
        soll = {nr: HOTCUE_ERSTER + HOTCUE_ABSTAND * (nr - 1) for nr in range(1, 9)}
        for nr, q in soll.items():
            koerper = {"deck": EXT_DECK, "nr": nr, "aktion": "setzen", "quell_beat": q, "raster": 0}
            if nr in HOTCUE_LOOPS:
                koerper.update(art="loop", laenge=HOTCUE_LOOPS[nr])
            _ok(_ruf(t, z, "POST", "/deck/hotcue", koerper), f"set hotcue {nr}")
        a = t.ruf("GET", f"/deck/hotcues?deck={EXT_DECK}")
        gelesen = a.j if a.code == 200 and isinstance(a.j, dict) else {}
        schlecht = []
        ziele = {}
        for nr, q in soll.items():
            h = gelesen.get(str(nr)) or {}
            art = "loop" if nr in HOTCUE_LOOPS else "shot"
            ziele[nr] = h.get("quell_beat")
            if h.get("quell_beat") is None or abs(float(h["quell_beat"]) - q) > 0.5 or h.get("art") != art or (art == "loop" and h.get("laenge") != HOTCUE_LOOPS[nr]):
                schlecht.append(f"cue {nr} reads back as {h or 'nothing'}")
        w["hotcues"] = {str(nr): gelesen.get(str(nr)) for nr in soll}
        if schlecht:
            t.rot("the cues read back wrong: " + "; ".join(schlecht))
            return
        # a shot cue far from the head: the deck must be on it afterwards
        schuss = max((n for n in soll if n not in HOTCUE_LOOPS), key=lambda n: abs(float(ziele[n]) - _punkt(t)["quell"]))
        vorher = _punkt(t)
        ab = float(_ok(_ruf(t, z, "POST", "/deck/hotcue", {"deck": EXT_DECK, "nr": schuss, "aktion": "spielen", "raster": 1}), f"play hotcue {schuss}").j["felder"]["ab_beat"])
        _warte_beat(t, ab + 1.0, 30)
        nach = _punkt(t)
        abw = landung_abweichung(float(ziele[schuss]), ab, nach)
        w.update(schuss_nr=schuss, schuss_ziel=ziele[schuss], schuss_von=round(vorher["quell"], 2), schuss_nach=round(nach["quell"], 2), schuss_abweichung_beats=round(abw, 3))
        if abs(abw) > HOTCUE_TOLERANZ_BEATS:
            t.rot(f"hotcue {schuss} (source beat {ziele[schuss]}) was played and the deck sits {abw:+.2f} beats from where it must be")
        # a loop cue: the deck is in a loop of the cue's length that starts on the cue
        lauf = min(HOTCUE_LOOPS)
        ab = float(_ok(_ruf(t, z, "POST", "/deck/hotcue", {"deck": EXT_DECK, "nr": lauf, "aktion": "spielen", "raster": 1}), f"play loop cue {lauf}").j["felder"]["ab_beat"])
        _warte_beat(t, ab + 1.0, 30)
        l = t.ruf("GET", f"/deck/loop?deck={EXT_DECK}").j or {}
        w.update(loop_cue_nr=lauf, loop_cue_status=_deck(t, EXT_DECK).get("status"), loop_cue_loop=l)
        im_loop = _deck(t, EXT_DECK).get("status") == 3
        if not im_loop or l.get("laenge") != HOTCUE_LOOPS[lauf] or abs(float(l.get("start", -99)) - float(ziele[lauf])) > HOTCUE_TOLERANZ_BEATS:
            t.rot(f"loop cue {lauf} (source beat {ziele[lauf]}, {HOTCUE_LOOPS[lauf]} beats) did not start that loop: status {_deck(t, EXT_DECK).get('status')}, loop {l}")
        _ruf(t, z, "POST", "/deck/loop", {"deck": EXT_DECK, "laenge": 0, "raster": 0})


def schritt_sprung(t, z):
    with t.schritt("j1.sprung", f"a beat jump of {SPRUNG_BEATS:g} beats forward and back moves the deck by that distance (within {SPRUNG_TOLERANZ_BEATS:g} beat)") as w:
        _deck_laeuft(t, z)
        spruenge = []
        for delta in (SPRUNG_BEATS, -SPRUNG_BEATS):
            vorher = versatz_mitte(t)
            ab = float(_ok(_ruf(t, z, "POST", "/deck/sprung", {"deck": EXT_DECK, "delta": delta, "raster": 0}), f"jump {delta:+g}").j["felder"]["ab_beat"])
            _warte_beat(t, ab + 0.5, 30)
            bewegt = versatz_mitte(t) - vorher
            spruenge.append({"delta": delta, "bewegt": round(bewegt, 3)})
        w["spruenge"] = spruenge
        schlecht = [f"{s['delta']:+g} moved the deck {s['bewegt']:+.2f}" for s in spruenge if abs(s["bewegt"] - s["delta"]) > SPRUNG_TOLERANZ_BEATS]
        if schlecht:
            t.rot("a beat jump does not move the deck by its distance: " + "; ".join(schlecht))


def schritt_loop(t, z):
    with t.schritt("j1.loop", f"a {LOOP_BEATS}-beat deck loop keeps the position inside the loop for {LOOP_MESS_BEATS // 4} bars; the length buttons 1 to 64 show") as w:
        _deck_laeuft(t, z)
        _ok(_ruf(t, z, "POST", "/deck/loop", {"deck": EXT_DECK, "laenge": LOOP_BEATS, "raster": 1}), f"loop {LOOP_BEATS}")
        assert t.warte_bis(lambda: _deck(t, EXT_DECK).get("status") == 3, 15, "deck in the loop"), "the deck did not go into the loop"
        l = {}
        t.warte_bis(lambda: (t.ruf("GET", f"/deck/loop?deck={EXT_DECK}").j or {}).get("laenge") == LOOP_BEATS, 5, "the loop is known")
        l = t.ruf("GET", f"/deck/loop?deck={EXT_DECK}").j or {}
        assert l.get("laenge") == LOOP_BEATS and l.get("start") is not None, f"the page does not know the loop: {l}"
        start = float(l["start"])
        proben, status = [], []
        ziel = _beat(t) + LOOP_MESS_BEATS
        while _beat(t) < ziel:
            p = _punkt(t)
            if p is not None:
                proben.append(p["quell"])
                status.append(p["status"])
            time.sleep(0.2)
        draussen = loop_drinnen(proben, start, LOOP_BEATS)
        runden = loop_runden(proben)
        w.update(loop_start=start, proben=len(proben), kleinste=round(min(proben), 2), groesste=round(max(proben), 2), draussen=len(draussen), runden=runden,
                 status_ausser_3=sum(1 for s in status if s != 3))
        if draussen or runden < 1 or any(s != 3 for s in status):
            t.rot(f"over {LOOP_MESS_BEATS} beats the deck left the {LOOP_BEATS}-beat loop at source beat {start:g}: {len(draussen)} readings outside "
                  f"(range {min(proben):.2f} to {max(proben):.2f}), {runden} wraps, status {sorted(set(status))}")
        zeigt = {}
        for laenge in LOOP_LAENGEN:
            _ok(_ruf(t, z, "POST", "/deck/loop", {"deck": EXT_DECK, "laenge": laenge, "raster": 0, "behalte_start": True}), f"loop length {laenge}")
            da = t.warte_bis(lambda: (t.ruf("GET", f"/deck/loop?deck={EXT_DECK}").j or {}).get("laenge") == laenge, 5, f"loop length {laenge}")
            zeigt[str(laenge)] = bool(da) and _deck(t, EXT_DECK).get("status") == 3
        w["laengen"] = zeigt
        fehlt = [k for k, v in zeigt.items() if not v]
        if fehlt:
            t.rot("the loop length buttons did not take: " + ", ".join(fehlt) + " beats")
        _ok(_ruf(t, z, "POST", "/deck/loop", {"deck": EXT_DECK, "laenge": 0, "raster": 0}), "loop off")
        assert t.warte_bis(lambda: _deck(t, EXT_DECK).get("status") == 2, 10, "deck out of the loop"), "the deck stays in the loop after it is switched off"


def scrub_zug(t, z, ziel_beats, dauer_s, nr=EXT_DECK):
    """The hand takes hold (phase 1), drags to `ziel_beats` in about 60 steps a second (phase 2) and lets go there (phase 0)."""
    _ok(_ruf(t, z, "POST", "/deck/scrub", {"deck": nr, "phase": 1, "delta": 0}), "scrub grab")
    schritte_n = max(2, int(dauer_s * 60))
    for i in range(1, schritte_n + 1):
        _ok(_ruf(t, z, "POST", "/deck/scrub", {"deck": nr, "phase": 2, "delta": ziel_beats * i / schritte_n}), "scrub drag")
        time.sleep(dauer_s / schritte_n)
    _ok(_ruf(t, z, "POST", "/deck/scrub", {"deck": nr, "phase": 0, "delta": ziel_beats}), "scrub release")


def schritt_scrub(t, z):
    with t.schritt("j1.scrub", f"a scrub keeps the phase: out and back leaves the deck where it was, a drag of {SCRUB_BEATS:g} beats moves it by that "
                               f"(within {SCRUB_TOLERANZ_BEATS:g} beat)") as w:
        _deck_laeuft(t, z)
        v0 = versatz_mitte(t)
        scrub_zug(t, z, SCRUB_BEATS, SCRUB_DAUER_S / 2)
        scrub_zug(t, z, -SCRUB_BEATS, SCRUB_DAUER_S / 2)    # the second drag, in the other direction: the net distance is zero
        time.sleep(1.0)                                      # the release lands within a few hundred ms
        v1 = versatz_mitte(t)
        scrub_zug(t, z, SCRUB_BEATS, SCRUB_DAUER_S)
        time.sleep(1.0)
        v2 = versatz_mitte(t)
        w.update(versatz_vor=round(v0, 3), versatz_hin_zurueck=round(v1, 3), versatz_nach_zug=round(v2, 3),
                 abweichung_hin_zurueck=round(v1 - v0, 3), zug_bewegt=round(v2 - v1, 3), status=_deck(t, EXT_DECK).get("status"))
        schlecht = []
        if abs(v1 - v0) > SCRUB_TOLERANZ_BEATS:
            schlecht.append(f"out and back left the deck {v1 - v0:+.2f} beats off its phase")
        if abs((v2 - v1) - SCRUB_BEATS) > SCRUB_TOLERANZ_BEATS:
            schlecht.append(f"a drag of {SCRUB_BEATS:g} beats moved the deck {v2 - v1:+.2f}")
        if _deck(t, EXT_DECK).get("status") not in (2, 3):
            schlecht.append("the deck stopped")
        if schlecht:
            t.rot("the scrub does not keep the phase: " + "; ".join(schlecht))


def schritt_vorhoeren(t, z):
    with t.schritt("j1.vorhoeren", f"pre-listen: a deck with PFL on is audible on the cue meter while its channel fader is closed, and the master stays without it") as w:
        _deck_laeuft(t, z)                                   # playing, channel fader closed
        time.sleep(1.3)
        ohne = _kanal_db(t, "cue")
        _als_hand(t, z, f"deck/{EXT_DECK}/pfl", 1)
        time.sleep(1.3)
        cue, master, kanal = _kanal_db(t, "cue"), _kanal_db(t, "master"), _kanal_db(t, f"deck/{EXT_DECK}")
        _als_hand(t, z, f"deck/{EXT_DECK}/pfl", 0)
        time.sleep(1.3)
        danach = _kanal_db(t, "cue")
        w.update(cue_ohne_pfl_db=ohne, cue_mit_pfl_db=cue, master_db=master, deck_kanal_db=kanal, cue_nach_pfl_db=danach)
        schlecht = []
        if cue <= KANAL_STUMM_DB or cue - ohne < VORHOEREN_ABSTAND_DB:
            schlecht.append(f"the cue meter shows {cue:.1f} dB with PFL on and {ohne:.1f} dB without")
        if master > KANAL_STUMM_DB or kanal > KANAL_STUMM_DB:
            schlecht.append(f"the closed channel is heard: master {master:.1f} dB, deck channel {kanal:.1f} dB")
        if danach > KANAL_STUMM_DB:
            schlecht.append(f"the cue meter stays at {danach:.1f} dB after PFL is off")
        if schlecht:
            t.rot("pre-listen does not work as it should: " + "; ".join(schlecht))


def schritt_vorhoerdeck(t, z):
    """The pre-listen deck (the browser's audition): a library track played to the headphones only. It needs a headphone edge on the core's cue
    output; an instance without one answers 409 kein_kopfhoerer and the step is a SKIP, not a red."""
    with t.schritt("j1.vorhoerdeck", "the pre-listen deck plays a track on the cue meter only, and the master stays without it") as w:
        if not z.mids:
            t.skip("no prepared track to audition", ursache="abhaengigkeit")
        _ok(_ruf(t, z, "POST", "/deck/stopp", {"deck": EXT_DECK, "ab": "jetzt"}), f"stop deck {EXT_DECK}")
        time.sleep(1.3)
        ohne = _kanal_db(t, "cue")
        z.als_andreas.append("POST /vorhoeren")
        a = t.ruf("POST", "/vorhoeren", {"mid": list(z.mids.values())[-1]}, quelle="andreas", erwartet={409, 422, 503, 504})
        if a.code != 200:
            w["antwort"] = {"code": a.code, "grund": a.grund}
            t.skip(f"the pre-listen deck did not start on this instance: {a.code} {a.grund}")
        time.sleep(2.0)
        cue, master = _kanaele_db(t, "cue", "master")
        stand = t.ruf("GET", "/vorhoeren")
        t.ruf("POST", "/vorhoeren", {"aktion": "stopp"}, quelle="andreas")
        time.sleep(1.5)
        danach = _kanal_db(t, "cue")
        w.update(cue_ohne_db=ohne, cue_db=cue, master_db=master, cue_danach_db=danach, vorhoeren=stand.j if stand.code == 200 else None)
        schlecht = []
        if cue <= KANAL_STUMM_DB or cue - ohne < VORHOEREN_ABSTAND_DB:
            schlecht.append(f"the cue meter shows {cue:.1f} dB with the pre-listen deck playing and {ohne:.1f} dB before")
        if master > KANAL_STUMM_DB:
            schlecht.append(f"the pre-listen deck is heard on the master ({master:.1f} dB)")
        if danach > KANAL_STUMM_DB:
            schlecht.append(f"the cue meter stays at {danach:.1f} dB after the pre-listen deck is stopped")
        if schlecht:
            t.rot("the pre-listen deck does not work as it should: " + "; ".join(schlecht))


def _fader_auf(t, z, nr=EXT_DECK):
    """Opens the channel fader of deck `nr`; the page asks for a hearing check, so the call is repeated as the owner and noted."""
    _ok(_ruf(t, z, "POST", "/regler", {"pfad": f"deck/{nr}/fader", "nach": 0, "ab": "jetzt"}), f"open fader {nr}")


def schritt_kompressor(t, z):
    with t.schritt("j1.kompressor", f"the channel compressor lowers the peak of a loud deck by at least {KOMP_MINDERUNG_DB:g} dB and lets go when it is off") as w:
        _deck_laeuft(t, z, fader_zu=False)
        _fader_auf(t, z)
        # the track's level moves from bar to bar, so the peak is read on a loop: the same material goes round, and a window as long as the loop
        # (a bit more) holds every part of it each time
        _ok(_ruf(t, z, "POST", "/deck/loop", {"deck": EXT_DECK, "laenge": LOOP_BEATS, "raster": 1}), f"loop {LOOP_BEATS}")
        assert t.warte_bis(lambda: _deck(t, EXT_DECK).get("status") == 3, 15, "deck in the loop"), "the deck did not go into the loop"
        time.sleep(KOMP_FENSTER_S + 0.3)
        ohne = _kanal_db(t, f"deck/{EXT_DECK}", sek=KOMP_FENSTER_S)
        for pfad, nach in (("schwelle", KOMP_SCHWELLE_DB), ("ratio", KOMP_RATIO), ("attack", 0.1), ("release", 120), ("makeup", 0), ("mix", 1), ("an", 1)):
            _ok(_ruf(t, z, "POST", "/regler", {"pfad": f"deck/{EXT_DECK}/komp/{pfad}", "nach": nach, "ab": "jetzt"}), f"compressor {pfad}")
        time.sleep(KOMP_FENSTER_S + 0.3)
        mit = _kanal_db(t, f"deck/{EXT_DECK}", sek=KOMP_FENSTER_S)
        _ok(_ruf(t, z, "POST", "/regler", {"pfad": f"deck/{EXT_DECK}/komp/an", "nach": 0, "ab": "jetzt"}), "compressor off")
        time.sleep(KOMP_FENSTER_S + 0.3)
        zurueck = _kanal_db(t, f"deck/{EXT_DECK}", sek=KOMP_FENSTER_S)
        _ok(_ruf(t, z, "POST", "/deck/loop", {"deck": EXT_DECK, "laenge": 0, "raster": 0}), "loop off")
        w.update(spitze_ohne_db=ohne, spitze_mit_db=mit, spitze_aus_db=zurueck, minderung_db=round(ohne - mit, 2), schwelle_db=KOMP_SCHWELLE_DB, ratio=KOMP_RATIO)
        schlecht = []
        if ohne <= KANAL_STUMM_DB:
            schlecht.append(f"the deck is silent without the compressor ({ohne:.1f} dB)")
        elif ohne - mit < KOMP_MINDERUNG_DB:
            schlecht.append(f"the peak went from {ohne:.1f} to {mit:.1f} dB, less than {KOMP_MINDERUNG_DB:g} dB lower")
        if abs(zurueck - ohne) > 2.0:
            schlecht.append(f"with the compressor off again the peak is {zurueck:.1f} dB, it was {ohne:.1f} dB")
        if schlecht:
            t.rot("the channel compressor: " + "; ".join(schlecht))


def schritt_ausgang(t, z):
    with t.schritt("j1.ausgang", "the cue output carries what the cue mix says: PFL only, or the master (about "
                                 f"{CUE_MASTER_DB:g} dB below it, within {CUE_MASTER_TOLERANZ_DB:g} dB), and its level knob moves it") as w:
        _deck_laeuft(t, z, fader_zu=False)
        _fader_auf(t, z)
        time.sleep(1.5)
        a = t.ruf("GET", "/ausgang")
        w["ausgang"] = a.j if a.code == 200 else None
        _als_hand(t, z, "cue/mix", -1)
        time.sleep(1.3)
        cue_pfl = _kanal_db(t, "cue")
        _als_hand(t, z, "cue/mix", 1)
        time.sleep(1.3)
        cue_master, master = _kanaele_db(t, "cue", "master")
        _als_hand(t, z, "cue/pegel", CUE_MASTER_DB + 6)
        time.sleep(1.3)
        cue_lauter, master_lauter = _kanaele_db(t, "cue", "master")
        _als_hand(t, z, "cue/pegel", CUE_MASTER_DB)
        _als_hand(t, z, "cue/mix", -1)
        gegen, gegen_lauter = round(cue_master - master, 2), round(cue_lauter - master_lauter, 2)
        w.update(master_db=master, cue_mix_pfl_db=cue_pfl, cue_mix_master_db=cue_master, cue_pegel_plus6_db=cue_lauter,
                 cue_gegen_master_db=gegen, cue_gegen_master_lauter_db=gegen_lauter, cue_pegel_hub_db=round(gegen_lauter - gegen, 2))
        schlecht = []
        if master <= KANAL_STUMM_DB:
            schlecht.append(f"the master is silent ({master:.1f} dB)")
        if cue_pfl > KANAL_STUMM_DB:
            schlecht.append(f"with the cue mix on PFL (nothing has PFL) the cue meter shows {cue_pfl:.1f} dB")
        if abs(gegen - CUE_MASTER_DB) > CUE_MASTER_TOLERANZ_DB:
            schlecht.append(f"with the cue mix on the master the cue meter is {gegen:+.1f} dB from the master, expected {CUE_MASTER_DB:g}")
        if abs((gegen_lauter - gegen) - 6.0) > 2.0:
            schlecht.append(f"6 dB more cue level moved the cue meter by {gegen_lauter - gegen:+.1f} dB (against the master of the same window)")
        if schlecht:
            t.rot("the cue output: " + "; ".join(schlecht))


def hall_nachklang_s(t, frist_s=12.0):
    """Seconds from this call until the master stays below the silent limit for a whole second (the /pegel window), minus that window: the tail."""
    t0 = time.monotonic()
    while time.monotonic() - t0 < frist_s:
        if _kanal_db(t, "master") <= KANAL_STUMM_DB:
            return round(max(0.0, time.monotonic() - t0 - 1.0), 2)
        time.sleep(0.1)
    return frist_s


def schritt_hall(t, z):
    with t.schritt("j1.hall", f"the REVERB beat FX lengthens the tail after a stop by at least {HALL_VERLAENGERUNG_S:g} s") as w:
        _ok(_ruf(t, z, "POST", "/fx/zuweisung", {"einheit": HALL_PARAM["einheit"], "kanal": "master", "an": True}), "assign the hall unit to the master")
        schwanz = {}
        for lauf, fx_an in (("ohne", False), ("mit", True)):
            _deck_laeuft(t, z, fader_zu=False)
            _fader_auf(t, z)
            _ok(_ruf(t, z, "POST", "/fx", dict(HALL_PARAM, **({} if fx_an else {"wet": 0.0}), an=fx_an)), f"hall {'on' if fx_an else 'off'}")
            time.sleep(2.0)
            _ok(_ruf(t, z, "POST", "/deck/stopp", {"deck": EXT_DECK, "ab": "jetzt"}), f"stop deck {EXT_DECK}")
            schwanz[lauf] = hall_nachklang_s(t)
            _ok(_ruf(t, z, "POST", "/fx", dict(HALL_PARAM, wet=0.0, an=False)), "hall off")
            time.sleep(2.0)
        lage = _lage(t)
        w.update(nachklang_ohne_s=schwanz["ohne"], nachklang_mit_s=schwanz["mit"], verlaengert_s=round(schwanz["mit"] - schwanz["ohne"], 2),
                 hall_pool=lage.get("hall_pool"), fx=(lage.get("fx") or [None, None])[:2])
        if schwanz["mit"] - schwanz["ohne"] < HALL_VERLAENGERUNG_S:
            t.rot(f"the tail after the stop is {schwanz['mit']:.2f} s with the REVERB on and {schwanz['ohne']:.2f} s without it, less than {HALL_VERLAENGERUNG_S:g} s longer")


def erweiterung_aufraeumen(t, z):
    """Leaves the instance as the extension found it: no cue, no PFL, no compressor, no FX, deck 1 stopped with its fader closed, no hotcues."""
    for pfad, nach in ((f"deck/{EXT_DECK}/pfl", 0), ("cue/mix", -1), ("cue/pegel", CUE_MASTER_DB)):
        t.ruf("POST", "/regler", {"pfad": pfad, "nach": nach, "ab": "jetzt"}, quelle="andreas")
    t.ruf("POST", "/regler", {"pfad": f"deck/{EXT_DECK}/komp/an", "nach": 0, "ab": "jetzt"})
    t.ruf("POST", "/fx", dict(HALL_PARAM, wet=0.0, an=False))
    t.ruf("POST", "/deck/loop", {"deck": EXT_DECK, "laenge": 0, "raster": 0})
    t.ruf("POST", "/deck/stopp", {"deck": EXT_DECK, "ab": "jetzt"})
    t.ruf("POST", "/regler", {"pfad": f"deck/{EXT_DECK}/fader", "nach": -200, "ab": "jetzt"})
    for nr in range(1, 9):
        t.ruf("POST", "/deck/hotcue", {"deck": EXT_DECK, "nr": nr, "aktion": "loeschen", "raster": 0})


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
    schritt_hotcues(t, z)
    schritt_sprung(t, z)
    schritt_loop(t, z)
    schritt_scrub(t, z)
    schritt_vorhoeren(t, z)
    schritt_vorhoerdeck(t, z)
    schritt_kompressor(t, z)
    schritt_ausgang(t, z)
    schritt_hall(t, z)
    erweiterung_aufraeumen(t, z)
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
