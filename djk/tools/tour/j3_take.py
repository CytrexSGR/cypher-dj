"""Journey J3 extension step `j3.take`: two recorded takes over the same bars, a comp of one bar from each, audition, undo.

Takes come from recording an internal input twice over the same two bars (the real user path, no hardware): pass A plays a kick sound,
pass B a hi-hat sound. The sound source is `quelle_suchen`: it has to be one that sounds while a PRODUCTION project is open. Strudel does not
(`POST /strudel` answers 409 kein_liveprojekt, the module sits in the live container), and neither do the loop decks and modules (live container).
The only recordable inputs left are the players of the container strips (pad/1, pad/2), which need a library track; the tour instance has an
empty library, so `quelle_suchen` finds nothing today and the step SKIPs with ursache=abhaengigkeit (the row stays below 1.0). The main lane holds the last pass (hats in both bars). `comp_waehlen` then takes bar 1 from the kick take, and the
export of the main lane has to show it: low band over high band (`rel`) is high in bar 1 and low in bar 2. Undo restores the lane, redo the comp.
The step is wired into `j3.schritte` by the slice wiring task, not here.
"""
import contextlib
import time

from tour import j3 as J3

KICK, HAT = "kick", "hat"
TAKTE = 2                              # bars per pass
BEATS = TAKTE * 4                      # 8 beats
COMP_BIS_BEAT = 4                      # the comp covers bar 1
REL_VOR_MAX_DB = 0.0                   # before the comp both bars are hats: low minus high band stays below this
REL_ABSTAND_MIN_DB = 12.0              # after the comp bar 1 (kick) over bar 2 (hats), low minus high band
STILLE_GRENZE_DB = -60.0               # a bar whose peak is not above this counts as silent
RAND_S = 0.5                           # margin after the nominal length of a pass before the recording is stopped
SCHLAF = time.sleep                    # the tests replace it


def _takt_s(tempo):
    return 4 * 60.0 / tempo


class Quelle:
    """A sound source a production project can record: `eingang` is the track input, `spiele(art)` starts the sound (KICK or HAT), `still()` ends it."""
    eingang = None

    def spiele(self, art):
        raise NotImplementedError

    def still(self):
        raise NotImplementedError


def quelle_suchen(t, hand):
    """The sound source for the two passes, or None. Nothing qualifies today: erz/1..3, erz/5..7 are Strudel streams (live container only, POST /strudel is
    refused in a production project), pad/1 and pad/2 hear a deck player (needs a library track, the tour library is empty). The tests replace this."""
    return None


def _voll(t, spur_id):
    """The full track of the open project (main lane clips and take lanes) from the page: (clips of the main lane, take lanes) or None."""
    a = t.ruf("GET", "/proj/aktuell")
    j = a.j if isinstance(a.j, dict) else {}
    s = J3._spur({"projekt": j.get("projekt") or {}}, spur_id)
    if s is None:
        return None
    haupt = sorted(((c.get("id"), c.get("start_beat")) for c in s.get("clips") or []), key=lambda e: (e[1], str(e[0])))
    return haupt, list(s.get("takes") or [])


def _echte_takes(takes):
    """Take lanes in order, without the Original lane (it carries `art`)."""
    return [x for x in takes if x.get("art") is None]


def _lauf(t, hand, quelle, art, tempo):
    """One recording pass over the armed track. True when the take was saved, False with the step red."""
    quelle.spiele(art)
    SCHLAF(_takt_s(tempo))                                   # one bar, so the pattern is playing when the take starts
    a = hand.rufe("proj_aufnahme", {"aktion": "start", "von_beat": 0})
    if a.get("_fehler"):
        t.rot(J3._grund(a), werkzeug="proj_aufnahme", **({"abbruch_grund": a["grund"]} if a.get("grund") else {}))
        return False
    SCHLAF(BEATS * 60.0 / tempo + RAND_S)
    b = hand.rufe("proj_aufnahme", {"aktion": "stopp"})
    if not J3._gut(t, b, "proj_aufnahme"):
        return False
    fehl = [x for x in b.get("takes") or [] if isinstance(x, dict) and x.get("fehler")]
    if fehl:
        t.rot(str(fehl[0]["fehler"]), werkzeug="proj_aufnahme")
        return False
    return True


def _bars(x, tempo):
    n = int(round(48000 * _takt_s(tempo)))
    return [x[k * n:(k + 1) * n] for k in range(TAKTE)]


def _rel(takt):
    return J3.band_db(takt, 30, 150) - J3.band_db(takt, 5000, 16000)


def take(t, hand, z):
    with t.schritt("j3.take", "two takes over the same bars, comp one bar from each, audition, undo: the export plays the comp"):
        quelle = quelle_suchen(t, hand)
        if quelle is None:
            t.skip("no sound source a production project can record: Strudel streams sit in the live container (POST /strudel is refused with "
                   "kein_liveprojekt) and the container players need a library track, the tour library is empty",
                   sitzung="J3", ursache="abhaengigkeit")
        if not J3._gut(t, hand.rufe("proj_neu", {"name": f"{z['name']}-take"}), "proj_neu"):
            return
        try:
            _durchlauf(t, hand, quelle)
        finally:
            with contextlib.suppress(Exception):
                hand.rufe("proj_transport", {"aktion": "stopp"})
            with contextlib.suppress(Exception):
                quelle.still()


def _durchlauf(t, hand, quelle):
    r = hand.rufe("proj_aendern", {"label": "Takes track", "befehle": [{"befehl": "spur_neu", "art": "audio", "name": "Takes"}]})
    if not J3._gut(t, r, "proj_aendern"):
        return
    lage = hand.rufe("proj_lage")
    spuren = (lage.get("projekt") or {}).get("spuren") or []
    sid = next((s["id"] for s in spuren if s.get("name") == "Takes"), None)
    assert sid, "the project holds no track Takes afterwards"
    tempo = float((lage.get("projekt") or {}).get("tempo_bpm") or 120)
    schleife = (lage.get("projekt") or {}).get("loop") or {}
    befehle = [{"befehl": "spur_aendern", "spur_id": sid, "arm": True, "eingang": quelle.eingang}]
    if schleife.get("an"):
        befehle.append({"befehl": "loop_setzen", "an": False, "von_beat": schleife.get("von_beat", 0), "bis_beat": schleife.get("bis_beat", BEATS)})
    if not J3._gut(t, hand.rufe("proj_aendern", {"label": "Arm for recording", "befehle": befehle}), "proj_aendern"):
        return

    for art in (KICK, HAT):
        if not _lauf(t, hand, quelle, art, tempo):
            return
    quelle.still()
    if not J3._gut(t, hand.rufe("proj_aendern", {"label": "Disarm", "befehle": [{"befehl": "spur_aendern", "spur_id": sid, "arm": False}]}), "proj_aendern"):
        return

    sp = J3._spur(hand.rufe("proj_lage"), sid) or {}
    zahl = int(sp.get("takes_zahl") or 0)
    voll = _voll(t, sid)
    echte = _echte_takes(voll[1]) if voll else []
    t.werte(takes_zahl=zahl)
    if zahl < 2 or len(echte) < 2:
        t.rot("zu_wenig_takes", takes_zahl=zahl, take_lanes=len(echte))
        return
    take1 = echte[0]["id"]
    haupt_nach_aufnahme = voll[0]

    # audition: the take plays instead of the comp, the audition is not part of the project
    r = hand.rufe("take_vorhoeren", {"spur_id": sid, "take_id": take1})
    if not J3._gut(t, r, "take_vorhoeren"):
        return
    gesetzt = (hand.rufe("proj_lage").get("vorhoeren") or {}).get(sid) == take1
    if gesetzt:
        if not J3._gut(t, hand.rufe("take_vorhoeren", {"spur_id": sid, "take_id": None}), "take_vorhoeren"):
            return
        gesetzt = sid not in (hand.rufe("proj_lage").get("vorhoeren") or {})
    t.werte(vorhoeren_ok=gesetzt)
    if not gesetzt:
        t.rot("vorhoeren_nicht_gesetzt")
        return

    _, x_vor = J3._fx_export(t, hand, 0, BEATS)
    if x_vor is None:
        return
    takte_vor = _bars(x_vor, tempo)
    rel_vor = [round(_rel(k), 1) for k in takte_vor]
    t.werte(rel_vor_db=rel_vor)
    if any(J3.spitze_db(k) <= STILLE_GRENZE_DB for k in takte_vor):
        t.rot("export_stumm", spitze_db=[round(J3.spitze_db(k), 1) for k in takte_vor])
        return
    if not all(v < REL_VOR_MAX_DB for v in rel_vor):
        t.rot("vorher_nicht_hats", rel_vor_db=rel_vor)
        return

    r = hand.rufe("proj_aendern", {"label": "Comp bar 1 from take 1", "befehle": [
        {"befehl": "comp_waehlen", "spur_id": sid, "take_id": take1, "von_beat": 0, "bis_beat": COMP_BIS_BEAT}]})
    if not J3._gut(t, r, "proj_aendern"):
        return
    haupt_comp = _voll(t, sid)[0]
    _, x_nach = J3._fx_export(t, hand, 0, BEATS)
    if x_nach is None:
        return
    takte_nach = _bars(x_nach, tempo)
    rel_nach = [round(_rel(k), 1) for k in takte_nach]
    t.werte(rel_nach_db=rel_nach)
    if any(J3.spitze_db(k) <= STILLE_GRENZE_DB for k in takte_nach):
        t.rot("export_stumm", spitze_db=[round(J3.spitze_db(k), 1) for k in takte_nach])
        return
    if rel_nach[0] - rel_nach[1] < REL_ABSTAND_MIN_DB:
        t.rot("comp_nicht_im_audio", abstand_db=round(rel_nach[0] - rel_nach[1], 1), mindestens_db=REL_ABSTAND_MIN_DB)
        return

    if not J3._gut(t, hand.rufe("proj_undo"), "proj_undo"):
        return
    zurueck = _voll(t, sid)[0] == haupt_nach_aufnahme
    if zurueck:
        if not J3._gut(t, hand.rufe("proj_redo"), "proj_redo"):
            return
        zurueck = _voll(t, sid)[0] == haupt_comp and haupt_comp != haupt_nach_aufnahme
    t.werte(undo_ok=zurueck)
    if not zurueck:
        t.rot("undo_stellt_nicht_her")
