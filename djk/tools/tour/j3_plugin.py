"""J3 extension step j3.plugin: a foreign plugin (LSP limiter, LV2) as a Carla host stage on a track, its threshold driven by a plugin lane.
The export peak must follow the lane. Wired into `j3.schritte` by the wiring task, not here."""
import os
import time

from tour import j3 as J3

LSP_URI_TEIL = "lsp-plug.in/plugins/lv2/limiter_stereo"      # the uid of the plugin in the catalogue (test_effect_real.py: LSP)
BEATS = 16
NOTEN_BEATS = 12
HOST_FRIST_S = 60.0                      # how long the host stage may stay `startet`
HOST_POLL_S = 2.0
LANE_UNTER_SPITZE_DB = 24.0              # the lane puts the threshold this far under the dry peak
LANE_VORGABE = 0.1                       # normalised value when the parameter range is not in dB
MIN_SENKUNG_DB = 6.0                     # dry peak minus peak with the lane
MIN_WIEDER_LAUT_DB = 3.0                 # peak without the lane minus peak with it
CARLA_ORT = "/usr/share/carla"


def _carla_da():
    return os.path.isdir(CARLA_ORT)


def _lsp(katalog):
    for e in katalog.get("plugins") or []:
        if e.get("format") == "lv2" and LSP_URI_TEIL in str(e.get("uid", "")) and e.get("status", "ok") == "ok":
            return e
    return None


def _wert_fuer(param, ziel_db):
    """Normalised 0..1 value of `param` for `ziel_db` when its range is in dB, else LANE_VORGABE."""
    lo, hi = param.get("min"), param.get("max")
    if "db" in str(param.get("einheit", "")).lower() and isinstance(lo, (int, float)) and isinstance(hi, (int, float)) and hi > lo \
            and lo <= ziel_db <= hi:
        return round((ziel_db - lo) / (hi - lo), 4)
    return LANE_VORGABE


def plugin(t, hand, z):
    with t.schritt("j3.plugin", "a foreign plugin (LSP limiter, LV2) on a track through Carla, its threshold set by a plugin lane: the export peak follows"):
        if not _carla_da():
            t.skip("Carla is not installed: install it to run the plugin host", sitzung="J3", ursache="abhaengigkeit")
        eintrag = _lsp(hand.rufe("plugins", {"aktion": "liste", "text": "limiter"}))
        if eintrag is None:
            t.skip("the LSP limiter (LV2) is not in the plugin index: install the LSP plugins and let the scan run", sitzung="J3",
                   ursache="abhaengigkeit")
        p = J3._fx_projekt(t, hand, z, "plugin", [{"name": "FX", "parameter": J3.FX_QUELLE}], J3._noten_dicht(NOTEN_BEATS), NOTEN_BEATS)
        if p is None:
            return
        sid = p["ids"][0]
        r, a = J3._fx_export(t, hand, 0, BEATS)
        if a is None:
            return
        spitze_a = J3.spitze_db(a)
        if spitze_a < -60:
            t.rot("export_stumm", text=f"the dry export peaks at {spitze_a:.1f} dB")
            return
        r = hand.rufe("proj_aendern", {"label": "LSP limiter host stage", "befehle": [
            {"befehl": "insert_setzen", "strang_id": sid, "pos": 0, "art": "host", "plugin_id": eintrag["id"]}]})
        if not J3._gut(t, r, "proj_aendern"):
            return
        stufen = [i for i in (J3._spur(hand.rufe("proj_lage"), sid) or {}).get("inserts") or [] if i.get("art") == "host"]
        assert stufen, "the project holds no host stage afterwards"
        iid = stufen[-1]["id"]
        zustand = {}

        def bereit():
            lage = hand.rufe("proj_lage")
            h = next((x for x in lage.get("hosts") or [] if x.get("insert_id") == iid), None)
            zustand["h"] = h
            return bool(h) and h.get("status") == "bereit"
        ende = time.monotonic() + HOST_FRIST_S
        while not bereit():
            if time.monotonic() >= ende:
                h = zustand.get("h") or {}
                t.rot("host_nicht_bereit", text=f"the host stage stays {h.get('status', 'unknown')}: {h.get('grund', 'no reason given')}")
                return
            time.sleep(HOST_POLL_S)
        t.werte(host=iid, latenz=zustand["h"].get("latenz"))
        par = hand.rufe("plugins", {"aktion": "parameter", "insert_id": iid})
        liste = par.get("parameter") if isinstance(par, dict) else par
        schwelle = next((q for q in liste or [] if "threshold" in str(q.get("name", "")).lower()), None)
        assert schwelle is not None, "the plugin lists no threshold parameter"
        tief = _wert_fuer(schwelle, spitze_a - LANE_UNTER_SPITZE_DB)
        r = hand.rufe("proj_aendern", {"label": "Threshold lane", "befehle": [
            {"befehl": "auto_neu", "spur_id": sid, "ziel": f"plugin.{iid}.{schwelle['index']}",
             "punkte": [{"beat": 0, "wert": tief}, {"beat": BEATS, "wert": tief}]}]})
        if not J3._gut(t, r, "proj_aendern"):
            return
        lanes = (J3._spur(hand.rufe("proj_lage"), sid) or {}).get("lanes") or []
        assert len(lanes) == 1, f"the track holds {len(lanes)} lanes instead of one"
        r, b = J3._fx_export(t, hand, 0, BEATS)
        if b is None:
            return
        r = hand.rufe("proj_aendern", {"label": "Remove threshold lane", "befehle": [{"befehl": "auto_loeschen", "lane_id": lanes[0]["id"]}]})
        if not J3._gut(t, r, "proj_aendern"):
            return
        r, c = J3._fx_export(t, hand, 0, BEATS)
        if c is None:
            return
        sa, sb, sc = J3.spitze_db(a), J3.spitze_db(b), J3.spitze_db(c)
        t.werte(spitze_trocken_db=round(sa, 2), spitze_lane_db=round(sb, 2), spitze_ohne_lane_db=round(sc, 2), lane_wert=tief,
                senkung_db=round(sa - sb, 2), wieder_laut_db=round(sc - sb, 2))
        if sb < -60:
            t.rot("export_stumm", text=f"the export with the lane peaks at {sb:.1f} dB")
        elif sa - sb < MIN_SENKUNG_DB:
            t.rot("lane_nicht_im_export", text=f"the peak falls by {sa - sb:.1f} dB with the lane, expected at least {MIN_SENKUNG_DB:g}")
        elif sc - sb < MIN_WIEDER_LAUT_DB:
            t.rot("wert_haengt", text=f"without the lane the peak rises only {sc - sb:.1f} dB, expected at least {MIN_WIEDER_LAUT_DB:g}")
