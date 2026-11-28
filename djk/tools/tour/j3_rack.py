"""Tour step j3.rack: an instrument rack of two RB-338 members split by key zone, macro 1 on a member parameter, a macro variation.

The step lives in its own module (plan strand 10, decision 2); `tour.j3.schritte` wires it in a later task. Helpers come from `tour.j3`."""
from tour import j3 as J3

RACK_BEATS = 8                 # the clip and the export: eight beats = four seconds at 120 BPM
HAELFTE_BEATS = 4              # low member plays beats 0..4, high member beats 4..8
TON_TIEF = 36                  # inside the zone of g1 (0..59)
TON_HOCH = 72                  # inside the zone of g2 (60..127)
ZONE_TIEF = [0, 59]
ZONE_HOCH = [60, 127]
CUTOFF_ZU = 0.05               # the closed filter of g1 and the start of the macro range
CUTOFF_AUF = 0.95              # the macro range end
GRENZE_HZ = 1000.0
MIN_OEFFNUNG_DB = 6.0          # the share above 1 kHz of the low half rises by at least this much when macro 1 opens g1
MAX_HOCH_ABWEICHUNG_DB = 1.5   # the high half (g2) stays where it was
WERT_TOLERANZ = 1e-6
VARIATION = "open"


def _noten(ton, von_beat, bis_beat):
    """Eighth notes on one key from `von_beat` to `bis_beat`."""
    n = int((bis_beat - von_beat) * 2)
    return [{"beat": von_beat + k * 0.5, "laenge": 0.45, "ton": ton, "vel": 100} for k in range(n)]


def _makro_ziele(sp):
    """(number of macro targets, member ids hit) of the rack read back from proj_lage."""
    rack = (sp or {}).get("rack") or {}
    ziele = [z for m in rack.get("makros") or [] for z in (m.get("ziel") or [])]
    return len(ziele), [z.get("glied") for z in ziele]


def _wert1(t, hand, sid):
    sp = J3._spur(hand.rufe("proj_lage"), sid)
    werte = ((sp or {}).get("rack") or {}).get("werte") or []
    return float(werte[0]) if werte else None


def _export(t, hand):
    """One export of the whole clip, split into its two halves: (low, high) or None with the step red."""
    r, x = J3._fx_export(t, hand, 0, RACK_BEATS)
    if x is None:
        return None
    mitte = len(x) // 2          # the clip is split evenly: four beats each
    return x[:mitte], x[mitte:]


def rack(t, hand, z):
    with t.schritt("j3.rack", "a rack of two RB-338 members split by key, macro 1 opens the filter of the low member"):
        if not J3._gut(t, hand.rufe("proj_neu", {"name": f"{z['name']}-rack"}), "proj_neu"):
            return
        glieder = [
            {"id": "g1", "geraet": {"art": "intern", "name": "rb338", "parameter": {"cutoff": CUTOFF_ZU, "resonanz": 0, "env_mod": 0, "lautstaerke": 1}},
             "ton": ZONE_TIEF},
            {"id": "g2", "geraet": {"art": "intern", "name": "rb338", "parameter": dict(J3.FX_QUELLE)}, "ton": ZONE_HOCH}]
        r = hand.rufe("proj_aendern", {"label": "Rack track", "befehle": [
            {"befehl": "spur_neu", "art": "instrument", "name": "Rack", "geraet": {"art": "rack", "kette": 0, "glieder": glieder}}]})
        if not J3._gut(t, r, "proj_aendern"):
            return
        lage = hand.rufe("proj_lage")
        spuren = (lage.get("projekt") or {}).get("spuren", [])
        assert spuren, "the rack track was not made"
        sid = spuren[-1]["id"]
        gl = (spuren[-1].get("geraet") or {}).get("glieder") or []
        assert [m.get("id") for m in gl] == ["g1", "g2"], "the project does not hold the two rack members afterwards"
        noten = _noten(TON_TIEF, 0, HAELFTE_BEATS) + _noten(TON_HOCH, HAELFTE_BEATS, RACK_BEATS)
        r = hand.rufe("proj_aendern", {"label": "Rack clip", "befehle": [
            {"befehl": "clip_neu", "spur_id": sid, "art": "midi", "start_beat": 0, "laenge_beats": RACK_BEATS, "noten": noten}]})
        if not J3._gut(t, r, "proj_aendern"):
            return
        ziel = {"glied": "g1", "param": "cutoff", "von": CUTOFF_ZU, "bis": CUTOFF_AUF}
        r = hand.rufe("proj_aendern", {"label": "Macro 1 on g1 cutoff", "befehle": [
            {"befehl": "rack_setzen", "strang_id": sid, "makros": [{"name": "Open", "ziel": [ziel]}]}]})
        if not J3._gut(t, r, "proj_aendern"):
            return
        n, glied_ids = _makro_ziele(J3._spur(hand.rufe("proj_lage"), sid))
        if n != 1 or glied_ids != ["g1"]:
            t.rot("makro_nicht_gelesen", text=f"the rack reads back {n} macro target(s) on {glied_ids}, expected one on g1")
            return

        def makro(wert):
            return J3._gut(t, hand.rufe("proj_aendern", {"label": f"Macro 1 to {wert}", "befehle": [
                {"befehl": "rack_makro", "strang_id": sid, "nr": 1, "wert": wert}]}), "proj_aendern")
        if not makro(0):
            return
        a = _export(t, hand)
        if a is None or not makro(1):
            return
        b = _export(t, hand)
        if b is None:
            return
        a_tief, a_hoch = a
        b_tief, b_hoch = b
        pegel = [J3.spitze_db(x) for x in (a_tief, a_hoch, b_tief, b_hoch)]
        oeffnung = J3.anteil_ueber_db(b_tief, GRENZE_HZ) - J3.anteil_ueber_db(a_tief, GRENZE_HZ)
        hoch_diff = J3.anteil_ueber_db(b_hoch, GRENZE_HZ) - J3.anteil_ueber_db(a_hoch, GRENZE_HZ)
        t.werte(spitze_db=[round(p, 2) for p in pegel], oeffnung_db=round(oeffnung, 2), hoch_diff_db=round(hoch_diff, 2))
        if min(pegel) <= J3.STILLE_DB:
            t.rot("glied_stumm", text=f"a half of the export is silent (peaks {[round(p, 1) for p in pegel]} dB): one member does not play")
            return
        if abs(hoch_diff) > MAX_HOCH_ABWEICHUNG_DB:
            t.rot("makro_trifft_anderes_glied", text=f"the high half changes by {hoch_diff:.1f} dB, expected within {MAX_HOCH_ABWEICHUNG_DB} (macro 1 targets g1 only)")
            return
        if oeffnung < MIN_OEFFNUNG_DB:
            t.rot("makro_nicht_im_audio", text=f"the share above {GRENZE_HZ:g} Hz of the low half rises by {oeffnung:.1f} dB, expected at least {MIN_OEFFNUNG_DB}")
            return
        # variation: store macro 1 = 1, set it to 0, load it back; one undo takes the load back
        if not J3._gut(t, hand.rufe("proj_aendern", {"label": "Save variation", "befehle": [
                {"befehl": "makro_variation_speichern", "strang_id": sid, "name": VARIATION}]}), "proj_aendern") or not makro(0):
            return
        if not J3._gut(t, hand.rufe("proj_aendern", {"label": "Load variation", "befehle": [
                {"befehl": "makro_variation_laden", "strang_id": sid, "name": VARIATION}]}), "proj_aendern"):
            return
        geladen = _wert1(t, hand, sid)
        if not J3._gut(t, hand.rufe("proj_undo"), "proj_undo"):
            return
        zurueck = _wert1(t, hand, sid)
        t.werte(variation_geladen=geladen, nach_undo=zurueck)
        if geladen is None or abs(geladen - 1.0) > WERT_TOLERANZ:
            t.rot("variation_nicht_geladen", text=f"macro 1 reads {geladen} after the load, expected 1")
        elif zurueck is None or abs(zurueck) > WERT_TOLERANZ:
            t.rot("variation_nicht_geladen", text=f"macro 1 reads {zurueck} after the undo of the load, expected 0")
