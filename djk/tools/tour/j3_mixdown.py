"""J3 extension steps for merge and resample: j3.zusammen, j3.resample.

Each step runs in a small project of its own (J3._fx_projekt) and compares two exports of the same range: the sources as they play, and the
new audio track that proj_zusammenfuehren / proj_resample made from them. The measures are fixed numbers (no measurement series):
RMS and per-channel peak within MIX_TOLERANZ_DB, cross-correlation lag at most MIX_VERSATZ_SAMPLES. One undo must take the new track away.
Wired into j3.schritte by the wiring task, not here."""
import math

from . import j3 as J3

BEATS = 8
MIX_TOLERANZ_DB = 0.5          # RMS and each channel's peak of the new track within 0.5 dB of the sources
MIX_VERSATZ_SAMPLES = 1        # cross-correlation lag between the two exports
STILLE_DB = J3.STILLE_DB
RESAMPLE_GAIN_DB = 6.0         # utility insert on the resampled strip: the strip's post-chain level is what the new track must carry
NOTE_B = 55                    # second source of the merge (G2); the first one plays note 48 (C2)


def rms_db(x):
    import numpy as np
    s = float(np.sqrt((np.asarray(x) ** 2).mean())) if len(x) else 0.0
    return 20 * math.log10(s) if s > 0 else -200.0


def peak_kanal_db(x, k):
    import numpy as np
    s = float(np.abs(x[:, k]).max()) if len(x) else 0.0
    return 20 * math.log10(s) if s > 0 else -200.0


def versatz_zwischen(a, b):
    """Lag in samples of b against a (mono sum, cross correlation): 0 when the two exports line up."""
    import numpy as np
    n = min(len(a), len(b))
    ma, mb = a[:n].mean(axis=1), b[:n].mean(axis=1)
    c = np.fft.irfft(np.fft.rfft(ma, 2 * n) * np.conj(np.fft.rfft(mb, 2 * n)))
    k = int(np.argmax(c))
    return -(k if k < n else k - 2 * n)


def _ids(lage):
    return [s.get("id") for s in (lage.get("projekt") or {}).get("spuren", [])]


def _vergleich(t, a, b):
    """Writes the measures into the step and marks it red (pegel_weicht_ab, versatz); the values are always recorded."""
    d_rms = rms_db(b) - rms_db(a)
    d_l = peak_kanal_db(b, 0) - peak_kanal_db(a, 0)
    d_r = peak_kanal_db(b, 1) - peak_kanal_db(a, 1)
    lag = versatz_zwischen(a, b)
    t.werte(rms_a_db=round(rms_db(a), 2), rms_b_db=round(rms_db(b), 2), rms_diff_db=round(d_rms, 3),
            spitze_l_diff_db=round(d_l, 3), spitze_r_diff_db=round(d_r, 3), versatz_samples=lag)
    if max(abs(d_rms), abs(d_l), abs(d_r)) > MIX_TOLERANZ_DB:
        t.rot("pegel_weicht_ab", text=f"the new track differs from the sources by {d_rms:+.2f} dB RMS, {d_l:+.2f} dB left peak, {d_r:+.2f} dB right peak (limit {MIX_TOLERANZ_DB} dB)")
        return False
    if abs(lag) > MIX_VERSATZ_SAMPLES:
        t.rot("versatz", text=f"the new track is {lag} samples off the sources (limit {MIX_VERSATZ_SAMPLES})")
        return False
    return True


def _stumm(t, name, x):
    if J3.spitze_db(x) <= STILLE_DB:
        t.rot("export_stumm", text=f"the {name} export is silent")
        return True
    return False


def _undo_prueft(t, hand, vorher_ids, quellen_stumm_vorher):
    """One proj_undo: the track list and the mute flags read as before the call. True when restored."""
    if not J3._gut(t, hand.rufe("proj_undo", {}), "proj_undo"):
        return False
    lage = hand.rufe("proj_lage")
    mute = {s["id"]: bool(s.get("mute")) for s in (lage.get("projekt") or {}).get("spuren", [])}
    ok = _ids(lage) == vorher_ids and all(mute.get(k) == v for k, v in quellen_stumm_vorher.items())
    t.werte(undo_ok=ok)
    if not ok:
        t.rot("undo_stellt_nicht_her", text=f"after one undo the tracks read {_ids(lage)} (mute {mute}), expected {vorher_ids} (mute {quellen_stumm_vorher})")
    return ok


def zusammen(t, hand, z):
    with t.schritt("j3.zusammen", "merge two tracks into one audio track: the export stays the same"):
        p = J3._fx_projekt(t, hand, z, "zusammen", [{"name": "Left", "parameter": J3.FX_QUELLE, "pan": -0.5}], J3._noten_dicht(BEATS), BEATS)
        if p is None:
            return
        try:
            noten_b = [{**n, "ton": NOTE_B} for n in J3._noten_dicht(BEATS)]
            if not J3._gut(t, hand.rufe("proj_aendern", {"label": "Second source", "befehle": [
                    {"befehl": "spur_neu", "art": "instrument", "name": "Right", "geraet": {"art": "intern", "name": "rb338", "parameter": J3.FX_QUELLE}}]}), "proj_aendern"):
                return
            lage = hand.rufe("proj_lage")
            quellen = _ids(lage)
            assert len(quellen) == 2, f"the project holds {quellen} instead of two source tracks"
            if not J3._gut(t, hand.rufe("proj_aendern", {"label": "Second source clip", "befehle": [
                    {"befehl": "spur_aendern", "spur_id": quellen[1], "pan": 0.5},
                    {"befehl": "clip_neu", "spur_id": quellen[1], "art": "midi", "start_beat": 0, "laenge_beats": BEATS, "noten": noten_b}]}), "proj_aendern"):
                return
            vorher_ids = _ids(hand.rufe("proj_lage"))
            r, a = J3._fx_export(t, hand, 0, BEATS)
            if a is None or _stumm(t, "source", a):
                return
            r = hand.rufe("proj_zusammenfuehren", {"spur_ids": quellen, "von_beat": 0, "bis_beat": BEATS})
            if not J3._gut(t, r, "proj_zusammenfuehren"):
                return
            lage = hand.rufe("proj_lage")
            spuren = (lage.get("projekt") or {}).get("spuren", [])
            neu = [s for s in spuren if s.get("id") not in vorher_ids]
            stumm_quellen = [bool(s.get("mute")) for s in spuren if s.get("id") in quellen]
            t.werte(neue_spuren=[s.get("id") for s in neu], quellen_stumm=stumm_quellen)
            if len(neu) != 1 or neu[0].get("art") != "audio" or not all(stumm_quellen):
                t.rot("kein_neuer_track", text=f"the merge left {[(s.get('id'), s.get('art')) for s in neu]} as new tracks and the sources' mute flags {stumm_quellen}; expected one audio track and both sources muted")
                return
            r, b = J3._fx_export(t, hand, 0, BEATS)
            if b is None or _stumm(t, "merged", b):
                return
            if not _vergleich(t, a, b):
                return
            _undo_prueft(t, hand, vorher_ids, {k: False for k in quellen})
        finally:
            hand.rufe("proj_transport", {"aktion": "stopp"})


def resample(t, hand, z):
    with t.schritt("j3.resample", "resample a strip to a new track: the new track sounds like the strip"):
        p = J3._fx_projekt(t, hand, z, "resample", [{"name": "Strip", "parameter": J3.FX_QUELLE}], J3._noten_dicht(BEATS), BEATS)
        if p is None:
            return
        sid = p["ids"][0]
        try:
            if J3._fx_insert(t, hand, sid, "utility", {"gain": RESAMPLE_GAIN_DB}, label="Utility +6 dB") is None:
                return
            vorher_ids = _ids(hand.rufe("proj_lage"))
            r, a = J3._fx_export(t, hand, 0, BEATS)
            if a is None or _stumm(t, "strip", a):
                return
            r = hand.rufe("proj_resample", {"strang_id": sid, "von_beat": 0, "bis_beat": BEATS})
            if not J3._gut(t, r, "proj_resample"):
                return
            spuren = (hand.rufe("proj_lage").get("projekt") or {}).get("spuren", [])
            neu = [s for s in spuren if s.get("id") not in vorher_ids]
            t.werte(neue_spuren=[s.get("id") for s in neu])
            if len(neu) != 1 or neu[0].get("art") != "audio":
                t.rot("kein_neuer_track", text=f"the resample left {[(s.get('id'), s.get('art')) for s in neu]} as new tracks, expected one audio track")
                return
            if not J3._gut(t, hand.rufe("proj_aendern", {"label": "Mute the strip", "befehle": [{"befehl": "spur_aendern", "spur_id": sid, "mute": True}]}), "proj_aendern"):
                return
            r, b = J3._fx_export(t, hand, 0, BEATS)
            if b is None or _stumm(t, "resampled", b):
                return
            if not _vergleich(t, a, b):
                return
            # undo the mute first, then the resample: two undo steps, the track list reads as before the resample
            if not J3._gut(t, hand.rufe("proj_undo", {}), "proj_undo"):
                return
            _undo_prueft(t, hand, vorher_ids, {sid: False})
        finally:
            hand.rufe("proj_transport", {"aktion": "stopp"})
