"""Journey J2, the live set (journey tours plan, task 8): a 30 minute set on a test instance, measured and recorded.

Steps: j2.aufbau (build the set), j2.basis (idle xrun baseline), j2.set (the long phase), j2.szenen, j2.container, j2.apc20 (SKIP, needs
hardware), j2.mitschnitt (stop the recording), j2.datei (check the recorded file).

The set: loop deck cells from the starter loops (decks 1 and 2, three tracks, two rows), three Strudel streams, one SEQ pattern, a scene
change every 2 minutes, the four container faders moved on a fixed script. `--kurz` runs 2 minutes with a scene every 20 s.
`j2.set` is green when the core's xrun delta stays within the idle baseline scaled to the phase length, the master never stays silent
for more than 2 s outside planned breaks, and never clips. The set recording (`/mitschnitt/*`) covers the whole phase.
"""
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


def schritte(t, xrun=None):
    p = plan(t.kurz)
    z = _Satz()
    eigener = xrun is None
    if eigener:
        xrun = laeufer.XrunZaehler(t.instanz.kern_port)
    try:
        _alle(t, z, p, xrun)
    finally:
        if eigener:
            xrun.ende()


def _alle(t, z, p, xrun):
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
