"""Journey J3, production: a project from nothing to an exported WAV, through the hand tools (the tools Cypher uses, not the page).

Steps: j3.neu, j3.midi, j3.midi_live (SKIP), j3.instrument, j3.surge, j3.audio, j3.eingang (SKIP), j3.warp, j3.mix, j3.version,
j3.export, j3.datei. Then the extension (1.0 features, each measured in an exported file or read back from the project):
j3.midi_export, j3.einsammeln, j3.relink, j3.undo, j3.zip work on the project made above; j3.auto, j3.eq, j3.komp, j3.hall, j3.saett,
j3.limiter, j3.pdc, j3.take, j3.rack, j3.plugin, j3.zusammen, j3.resample each build a small project of their own with a controlled source (j3.take SKIPs while no sound source
exists that a production project can record, see `j3_take`; j3.plugin SKIPs without Carla or the LSP limiter plugin). `CYPHERDJ_TOUR_J3_SCHRITTE` (comma list of extension step ids, absent = all) runs only
the named extension steps after the base steps.
Two shortenings are named on purpose (they are SKIP steps or noted in the step values and in the manual chapter): audio comes from an offline bounce of the MIDI track instead of an input recording, MIDI comes from a file the tour writes
instead of live MIDI. `schritte(t, hand=None, erweitert=None)`: the tests pass a fake hand, the tour CLI lets the tour start the real one
(which also runs the extension).
"""
import contextlib
import hashlib
import math
import os
import shutil
import struct
import subprocess
import time
import urllib.parse
import zipfile
from pathlib import Path

from . import runner as laeufer
from . import j3_plugin, j3_rack, j3_take

# `djk-start --arr1` starts the production host that Surge tracks need; Surge itself must be installed. Off unless asked for.
OPTIONEN = ["--arr1"] if os.environ.get("CYPHERDJ_TOUR_ARR1") == "1" else []

TAKTE = 8                      # the exported range: eight bars
PPQ = 480
ZIEL_BPM = 105                 # the warped clip plays at this tempo (the project runs at 120)
PRESET = "werk:rb338/classic-acid"
VERSION = "tour-j3 mix"
SEND_DB = -6
FADER_DB = -3
STILLE_DB = -60.0              # a file whose peak is below this is silent
TON_UNTER_SPITZE_DB = 50.0     # a window counts as sound when its RMS is within 50 dB of the file peak (and above STILLE_DB)
FENSTER_S = 0.05
MAX_STILLE_ANTEIL = 0.5        # more than half of the file silent is red
MAX_UNTER_LIVE_DB = 6.0        # the export peak may be at most 6 dB below the live level of the same section
# The expected ends are known: the unwarped clip is as long as the range, the warped one ends at length * ZIEL_BPM / project tempo.
# Measured on instance e (lauf3 in the evidence folder): both reference exports (before the mix) end at 16.0 s and 14.0 s, the
# difference is exactly 2.00 s, so the warp shift may be off by one release and a few 50 ms windows: WARP_TOLERANZ_S.
# The final export (after the mix) ends later than the clip: the delay return (send -6 dB, feedback 45 %, echoes every 0.5 s,
# each 6.9 dB lower) rings on. With the send off the same export ends at exactly 14.0 s, with it at 15.05 s, where the echo
# drops below the -60 dBFS floor of the sound test. So the end may lie 0.3 s before and AUSKLANG_S after the clip end; a render cut
# short is off by seconds, not by this.
WARP_TOLERANZ_S = 0.25
ENDE_VOR_S = 0.3
AUSKLANG_S = 1.2

# ---- extension: expectations (measured on test instance d, see docs/veroeffentlichung/public/docs/journeys/j3-production.md)
MIDI_NOTEN = [(36, 7), (40, 7), (43, 7), (48, 8)]   # (note, length in beats) of the tour's MIDI file, one note every two bars
MIDI_NOTE_VEL = 100
SMF_TOLERANZ_BEATS = 0.002
AUTO_VON_DB, AUTO_BIS_DB = -24.0, 0.0   # the volume lane runs over four bars (16 beats) from -24 dB to 0 dB
AUTO_BEATS = 16
AUTO_STEIGUNG_TOLERANZ_DB = 0.75        # measured: exactly the lane slope (3.00 dB per second at 120 BPM)
AUTO_ABWEICHUNG_MAX_DB = 2.0            # largest distance of a window level from the straight line of the lane
FX_KLIP_BEATS = 12                      # source clip of the effect steps: 24 eighth notes on C2, six seconds at 120 BPM
FX_EXPORT_BEATS = 16
FX_ANALYSE_S = 6.0
EQ_BAND = (120.0, 250.0)                # the EQ cuts 18 dB (bell, Q 1) at 180 Hz
EQ_MIN_SENKUNG_DB = 6.0                 # measured: 11.8 dB less in the band
EQ_OBEN_HZ = 2000.0
EQ_OBEN_TOLERANZ_DB = 1.0               # measured: 0.2 dB change above 2 kHz
KOMP_UNTER_SPITZE_DB = 10.0             # threshold: ten dB under the peak of the dry export, ratio 10, attack 1 ms
KOMP_MIN_SENKUNG_DB = 2.0               # measured: the peak falls by 7.1 dB
HALL_MIN_VERLAENGERUNG_S = 2.0          # measured: the sound ends 0.2 s after the note without the hall, about 8.5 s with it
SAETT_VORVERSTAERKUNG_DB = 24.0         # a utility insert lifts the near-sine source into the range where saturation works
SAETT_DRIVE_DB = 36.0
SAETT_GRENZE_HZ = 300.0
SAETT_MIN_ANSTIEG_DB = 6.0              # measured: the share of energy above 300 Hz rises by 27 dB
LIM_UNTER_SPITZE_DB = 6.0               # ceiling: six dB under the peak of the dry export
LIM_MAX_UNTER_DECKE_DB = 4.5            # the master pan law adds 3.0 dB below the ceiling (measured exactly 3.01 dB)
PDC_MAX_VERSATZ = 1                     # samples; without compensation the EQ (69) and the limiter (86) would show up here
EXPORT_BEREIT_FRIST_S = 60              # how long an export may be refused with audio_fehlt (a clip is still being decoded) before the step is red
EINSAMMELN_FRIST_S = 30                 # how long collecting may be refused because the transport has not stopped yet
UNDO_PAUSE_S = 1.3                      # edits of one mixer field less than 1 s apart are one undo step: wait longer between the two
UNDO_FADER_A_DB, UNDO_FADER_B_DB = -6.0, -12.0


# ---------------------------------------------------------------- helpers

def _vlq(n):
    teile = [n & 0x7F]
    n >>= 7
    while n:
        teile.append((n & 0x7F) | 0x80)
        n >>= 7
    return bytes(reversed(teile))


def schreibe_midi(pfad):
    """A format 0 file at 120 BPM, 4/4: eight bars, four notes (C1 E1 G1 C2, one every two bars, the last one lasts to bar 8)."""
    spur = b"\x00\xff\x51\x03" + (500000).to_bytes(3, "big") + b"\x00\xff\x58\x04\x04\x02\x18\x08"
    jetzt = 0
    for k, (note, laenge_beats) in enumerate(MIDI_NOTEN):
        an = k * 8 * PPQ
        spur += _vlq(an - jetzt) + bytes([0x90, note, MIDI_NOTE_VEL])
        spur += _vlq(laenge_beats * PPQ) + bytes([0x80, note, 0])
        jetzt = an + laenge_beats * PPQ
    spur += _vlq(0) + b"\xff\x2f\x00"
    pfad = Path(pfad)
    pfad.parent.mkdir(parents=True, exist_ok=True)
    pfad.write_bytes(b"MThd" + struct.pack(">IHHH", 6, 0, 1, PPQ) + b"MTrk" + struct.pack(">I", len(spur)) + spur)
    return str(pfad)


def _grund(r):
    for k in ("fehler", "grund", "text"):
        if isinstance(r.get(k), str) and r[k]:
            return r[k]
    return "rpc_fehler" if r.get("rpc") else "unbekannt"


def _gut(t, r, name):
    """False (and the step marked red with the tool's own reason) when the tool answered with an error."""
    if r.get("_fehler"):
        t.rot(_grund(r), werkzeug=name, text=r.get("text"))
        return False
    return True


def _export_rufen(t, hand, arg):
    """proj_export, waiting for audio clips that are still being prepared: the product refuses such an export with audio_fehlt ("try again in a
    moment") before it does anything, so asking again is safe. Any other answer ends the wait at once; after EXPORT_BEREIT_FRIST_S the last
    audio_fehlt answer is returned and the caller marks the step red with it."""
    antwort = {}
    n = [0]

    def versuch():
        n[0] += 1
        antwort["r"] = hand.rufe("proj_export", arg, 300)
        r = antwort["r"]
        return not (r.get("_fehler") and "audio_fehlt" in (r.get("fehler"), r.get("grund")))
    t0 = time.monotonic()
    t.warte_bis(versuch, EXPORT_BEREIT_FRIST_S, "the audio clips to be prepared for the export")
    if n[0] > 1:
        t.werte(export_versuche=n[0], export_wartete_s=round(time.monotonic() - t0, 1))
    return antwort["r"]


def analysiere(pfad):
    """Decodes a file to mono and reads it as an energy envelope (RMS per 50 ms window): peak in dBFS, length, end of the last sound,
    share of silent windows. `ende_s` is 0 for a file without sound."""
    import numpy as np
    roh = subprocess.run(["ffmpeg", "-v", "error", "-i", str(pfad), "-ac", "1", "-ar", "48000", "-f", "f32le", "-"],
                         capture_output=True).stdout
    x = np.nan_to_num(np.frombuffer(roh[:len(roh) // 4 * 4], dtype="<f4").astype(np.float64))
    if not len(x):
        return {"dauer_s": 0.0, "spitze_db": -200.0, "ende_s": 0.0, "stille_anteil": 1.0, "huelle_db": []}
    spitze = float(np.abs(x).max())
    spitze_db = 20 * math.log10(spitze) if spitze > 0 else -200.0
    n = max(1, int(48000 * FENSTER_S))
    k = len(x) // n
    huelle = np.sqrt((x[:k * n].reshape(k, n) ** 2).mean(axis=1)) if k else np.array([spitze])
    huelle_db = 20 * np.log10(np.maximum(huelle, 1e-10))
    schwelle = max(STILLE_DB, spitze_db - TON_UNTER_SPITZE_DB)
    laut = np.nonzero(huelle_db > schwelle)[0]
    ende = float((laut[-1] + 1) * FENSTER_S) if len(laut) and spitze_db > STILLE_DB else 0.0
    anteil = 1.0 - (len(laut) / len(huelle_db) if spitze_db > STILLE_DB else 0.0)
    return {"dauer_s": len(x) / 48000.0, "spitze_db": spitze_db, "ende_s": ende, "stille_anteil": anteil, "huelle_db": huelle_db.tolist()}


def _spur(lage, spur_id):
    return next((s for s in (lage.get("projekt") or {}).get("spuren", []) if s.get("id") == spur_id), None)


# ---------------------------------------------------------------- steps

def _neu(t, hand, z):
    with t.schritt("j3.neu", "create a production project", pflicht=True):
        r = hand.rufe("proj_neu", {"name": z["name"]})
        if not _gut(t, r, "proj_neu"):
            return
        assert r.get("slug"), "proj_neu named no slug"
        z["slug"] = r["slug"]
        t.werte(slug=r["slug"])


def _midi(t, hand, z):
    with t.schritt("j3.midi", "import a MIDI file the tour wrote (eight bars, four notes)", pflicht=True):
        pfad = schreibe_midi(Path(t.ausgabe).resolve() / "musik" / "tour-j3.mid")
        r = hand.rufe("proj_midi_import", {"pfad": pfad})
        if not _gut(t, r, "proj_midi_import"):
            return
        ang = r.get("angelegt") or []
        assert len(ang) == 1, f"expected one track from the file, got {len(ang)}"
        noten = ((r.get("bericht") or {}).get("datei") or {}).get("noten")
        assert noten == 4, f"the import counted {noten} notes, expected 4"
        z["midi_spur"], z["midi_clip"] = ang[0]["spur_id"], ang[0]["clip_id"]
        lage = hand.rufe("proj_lage")
        z["tempo"] = float((lage.get("projekt") or {}).get("tempo_bpm") or 120)
        sp = _spur(lage, z["midi_spur"])
        clip = next((c for c in (sp or {}).get("clips", []) if c.get("id") == z["midi_clip"]), None)
        assert clip and clip.get("noten_zahl") == 4, "the project does not hold the four notes"
        t.werte(spur=z["midi_spur"], noten=noten, laenge_beats=clip.get("laenge_beats"), tempo_bpm=z["tempo"],
                kurzfassung="MIDI file instead of live MIDI")


def _midi_live(t, hand, z):
    with t.schritt("j3.midi_live", "record live MIDI from a keyboard"):
        t.skip("needs a MIDI keyboard: not recorded by the tour (a MIDI file stands in for it)", sitzung="J3")


def _instrument(t, hand, z):
    with t.schritt("j3.instrument", "apply a factory preset to the MIDI track"):
        s = hand.rufe("presets_suchen", {"familie": "instrument", "geraet": ["rb338"], "art": ["bass"]})
        if not _gut(t, s, "presets_suchen"):
            return
        ids = [x.get("id") for x in s.get("treffer") or []]
        assert ids, "no RB-338 bass preset found"
        pid = PRESET if PRESET in ids else ids[0]
        r = hand.rufe("presets_anwenden", {"id": pid, "ziel": {"art": "spur", "spur_id": z["midi_spur"]}})
        if not _gut(t, r, "presets_anwenden"):
            return
        sp = _spur(hand.rufe("proj_lage"), z["midi_spur"])
        assert ((sp or {}).get("geraet") or {}).get("preset") == pid, "the track does not carry the preset afterwards"
        t.werte(preset=pid, spur=z["midi_spur"])


def _surge(t, hand, z):
    with t.schritt("j3.surge", "add a Surge track (needs the production host)"):
        lage = hand.rufe("proj_lage")
        if not ((lage.get("wirte") or {}).get("1") or {}).get("laeuft"):
            t.skip("the Surge production host arr1 is not running: start the instance with djk-start --arr1 (Surge installed)",
                   sitzung="J3", ursache="abhaengigkeit")
        r = hand.rufe("proj_aendern", {"label": "Surge track", "befehle": [
            {"befehl": "spur_neu", "art": "instrument", "name": "Surge", "geraet": {"art": "wirt", "name": "surge", "slot": 1}}]})
        if not _gut(t, r, "proj_aendern"):
            return
        sp = [s for s in (hand.rufe("proj_lage").get("projekt") or {}).get("spuren", []) if (s.get("geraet") or {}).get("name") == "surge"]
        assert sp, "the project holds no Surge track afterwards"
        t.werte(spur=sp[0].get("id"))


def _audio(t, hand, z):
    with t.schritt("j3.audio", "bounce the instrument track to an audio track"):
        r = hand.rufe("proj_bounce", {"art": "neue_spur", "spur_ids": [z["midi_spur"]]}, 300)
        if not _gut(t, r, "proj_bounce"):
            return
        sid, cid = r.get("spur_id"), r.get("clip_id")
        sp = _spur(hand.rufe("proj_lage"), sid)
        assert sp and sp.get("art") == "audio", "the bounce made no audio track"
        assert any(c.get("id") == cid for c in sp.get("clips", [])), "the audio track holds no clip"
        z["audio_spur"], z["audio_clip"], z["audio_frames"] = sid, cid, r.get("frames") or 0
        t.werte(spur=sid, clip=cid, frames=z["audio_frames"], kurzfassung="audio bounce instead of an input recording")


def _eingang(t, hand, z):
    with t.schritt("j3.eingang", "record audio from an input"):
        t.skip("needs an audio input released by the owner: not recorded by the tour (the bounce stands in for it)", sitzung="J3")


def _warp(t, hand, z):
    with t.schritt("j3.warp", f"give the audio clip another tempo ({ZIEL_BPM} BPM), proven in the audio"):
        dauer = z["audio_frames"] / 48000.0
        assert dauer > 0, "no audio clip to warp (j3.audio did not deliver one)"
        bereich = {"von_beat": 0, "bis_beat": TAKTE * 4}
        vor = _export_rufen(t, hand, bereich)         # the same range before the warp: the reference
        if not _gut(t, vor, "proj_export") or not vor.get("datei"):
            if not vor.get("_fehler"):
                t.rot("keine_datei", text="the reference export names no file")
            return
        marker = [[0, 0], [dauer, round(dauer * ZIEL_BPM / 60.0, 6)]]
        r = hand.rufe("proj_aendern", {"label": f"Warp {ZIEL_BPM} BPM", "befehle": [{"befehl": "warp_setzen", "clip_id": z["audio_clip"], "warp": {
            "an": True, "modus": "repitch", "marker": marker, "versatz_beats": 0, "quelle": "hand", "transpose_st": 0, "detune_ct": 0}}]})
        if not _gut(t, r, "proj_aendern"):
            return
        w = hand.rufe("proj_warp", {"clip_id": z["audio_clip"]})
        if not _gut(t, w, "proj_warp"):
            return
        bpm = (((w.get("warp") or {}).get("tempo")) or {}).get("mittel_bpm")
        t.werte(mittel_bpm=bpm, projekt_bpm=z["tempo"])
        assert isinstance(bpm, (int, float)) and abs(bpm - ZIEL_BPM) < 0.5, f"the clip warp reads {bpm} BPM, expected {ZIEL_BPM}"
        assert abs(bpm - z["tempo"]) > 1, "the clip tempo equals the project tempo: nothing was warped"
        nach = _export_rufen(t, hand, bereich)         # and after it
        if not _gut(t, nach, "proj_export") or not nach.get("datei"):
            if not nach.get("_fehler"):
                t.rot("keine_datei", text="the export after the warp names no file")
            return
        a, b = analysiere(vor["datei"]), analysiere(nach["datei"])
        soll = dauer * (1 - ZIEL_BPM / z["tempo"])            # the warped clip ends this much earlier (seconds)
        diff = a["ende_s"] - b["ende_s"]
        t.werte(ende_ohne_warp_s=round(a["ende_s"], 2), ende_mit_warp_s=round(b["ende_s"], 2), verschiebung_s=round(diff, 2), erwartet_s=round(soll, 2))
        if a["ende_s"] <= 0 or b["ende_s"] <= 0:
            t.rot("export_stumm", text="an export used to prove the warp is silent")
        elif abs(diff) < 0.5 * abs(soll):
            t.rot("warp_nicht_im_audio", text=f"the sound ends at {a['ende_s']:.2f} s without and {b['ende_s']:.2f} s with the warp: the render ignores it")
        elif diff * soll <= 0:
            t.rot("warp_falsche_richtung", text=f"the warp moved the end of the sound by {diff:+.2f} s, expected {soll:+.2f} s")
        elif abs(diff - soll) > WARP_TOLERANZ_S:
            t.rot("warp_verschiebung_falsch", text=f"the warp moved the end of the sound by {diff:+.2f} s, expected {soll:+.2f} s (tolerance {WARP_TOLERANZ_S} s)")
        z["erwartetes_ende_s"] = min(TAKTE * 4 * 60.0 / z["tempo"], dauer * ZIEL_BPM / z["tempo"])


def _mix(t, hand, z):
    with t.schritt("j3.mix", "one volume change, one send, then listen"):
        sid = z["audio_spur"]
        r = hand.rufe("proj_aendern", {"label": "Volume and delay return", "befehle": [
            {"befehl": "spur_aendern", "spur_id": sid, "fader_db": FADER_DB},
            {"befehl": "return_neu", "name": "Delay", "effekt": {"graph": "fx-delay-sync"}}]})
        if not _gut(t, r, "proj_aendern"):
            return
        rets = [x for x in ((hand.rufe("proj_lage").get("projekt") or {}).get("returns") or []) if x.get("name") == "Delay"]
        assert rets, "the project holds no Delay return"
        rid = rets[-1]["id"]
        r = hand.rufe("proj_aendern", {"label": "Delay send", "befehle": [
            {"befehl": "send_setzen", "strang_id": sid, "return_id": rid, "db": SEND_DB}]})
        if not _gut(t, r, "proj_aendern"):
            return
        sp = _spur(hand.rufe("proj_lage"), sid) or {}
        assert abs(float(sp.get("fader_db", 0)) - FADER_DB) < 0.01, f"the fader reads {sp.get('fader_db')} dB, expected {FADER_DB}"
        assert any(s.get("id") == rid and abs(float(s.get("db", 0)) - SEND_DB) < 0.01 for s in sp.get("sends", [])), "the send is not in the project"
        t.werte(fader_db=sp.get("fader_db"), send=rid, send_db=SEND_DB)
        a = hand.rufe("proj_transport", {"aktion": "start", "beat": 0})
        try:
            if not _gut(t, a, "proj_transport"):
                return
            p = t.pegel_phase(3)
            z["live_db"] = p.max_db
            t.werte(max_db=round(p.max_db, 1), median_db=round(p.median_db, 1))
            if p.still:
                t.rot("still", max_db=round(p.max_db, 1))
            elif p.uebersteuert:
                t.rot("clipping", max_db=round(p.max_db, 1))
        finally:
            with contextlib.suppress(Exception):
                hand.rufe("proj_transport", {"aktion": "stopp"})


def _version(t, hand, z):
    with t.schritt("j3.version", "save a named version"):
        r = hand.rufe("proj_version_sichern", {"name": VERSION})
        if not _gut(t, r, "proj_version_sichern"):
            return
        assert r.get("ok") and r.get("id"), "no version id came back"
        v = hand.rufe("proj_versionen")
        if not _gut(t, v, "proj_versionen"):
            return
        assert any(x.get("id") == r["id"] and x.get("name") == VERSION for x in v.get("versionen") or []), "the version is not in the list"
        t.werte(id=r["id"])


def _export(t, hand, z):
    with t.schritt("j3.export", f"export {TAKTE} bars as WAV"):
        r = _export_rufen(t, hand, {"von_beat": 0, "bis_beat": TAKTE * 4})
        if not _gut(t, r, "proj_export"):
            return
        t.werte(spitze_db=r.get("spitze_db"), ueber_decke=r.get("ueber_decke"), limiter_db_max=r.get("limiter_db_max"), lufs_i=r.get("lufs_i"),
                true_peak_dbtp=r.get("true_peak_dbtp"), abgriff=r.get("abgriff"), datei=r.get("datei"))
        if r.get("ueber_decke"):
            t.rot("ueber_decke", text="the sample peak of the export is above the limiter ceiling")
        if not r.get("datei"):
            t.rot("keine_datei", text="the export answer names no file")
        else:
            z["datei"], z["spitze_db"] = r["datei"], r.get("spitze_db")


def _datei(t, hand, z):
    with t.schritt("j3.datei", "check the exported file: sound all the way, level against the live mix"):
        if not z.get("datei"):
            t.rot("keine_datei", text="j3.export delivered no file")
            return
        min_sek = TAKTE * 4 * 60.0 / z["tempo"] * 0.99
        d = t.pruefe_datei(z["datei"], min_sek)
        a = analysiere(z["datei"])
        antwort_db = z.get("spitze_db")
        live = z.get("live_db")
        t.werte(dauer_s=d.dauer_s, kanaele=d.kanaele, spitze_db=[round(x, 1) for x in d.spitze_db], dc=[round(x, 5) for x in d.dc], min_sek=round(min_sek, 2),
                ende_s=round(a["ende_s"], 2), stille_anteil=round(a["stille_anteil"], 2), datei_spitze_db=round(a["spitze_db"], 2),
                export_spitze_db=antwort_db, live_max_db=None if live is None else round(live, 2))
        gruende = list(d.gruende)
        if a["spitze_db"] < STILLE_DB:
            gruende.append("stumm")
        elif a["stille_anteil"] > MAX_STILLE_ANTEIL:
            gruende.append("ueberwiegend_stumm")
        elif a["ende_s"] < 0.5 * a["dauer_s"]:
            gruende.append("ton_endet_frueh")
        erw = z.get("erwartetes_ende_s")
        if erw is not None:
            t.werte(erwartetes_ende_s=round(erw, 2))
            if not erw - ENDE_VOR_S <= a["ende_s"] <= erw + AUSKLANG_S:
                gruende.append("ende_falsch")           # the render stops early (or runs on): the sound must end where the song ends
        if live is None or live <= STILLE_DB:
            gruende.append("kein_livepegel")        # nothing to judge the export against: j3.mix did not measure a live level
        else:
            tiefste = min(x for x in (a["spitze_db"], antwort_db) if isinstance(x, (int, float)))
            t.werte(unter_live_db=round(live - tiefste, 2))
            if tiefste < live - MAX_UNTER_LIVE_DB:
                gruende.append("export_zu_leise")
        if gruende:
            t.rot(",".join(dict.fromkeys(gruende)))


# ---------------------------------------------------------------- extension: helpers

def lies_smf(pfad):
    """Reads a Standard MIDI file (format 0 or 1, running status, meta and sysex events skipped): the division, the first tempo and the
    notes as (note, start in beats, length in beats, velocity), sorted by start and note."""
    daten = Path(pfad).read_bytes()
    assert daten[:4] == b"MThd", f"{pfad} is not a Standard MIDI file"
    kopf_laenge, fmt, spuren, ppq = struct.unpack(">IHHH", daten[4:14])
    assert ppq > 0 and not ppq & 0x8000, "only a division in ticks per quarter note is read"
    pos, tempo_us, noten = 8 + kopf_laenge, None, []

    def vlq(p):
        n = 0
        while True:
            b = daten[p]
            p += 1
            n = (n << 7) | (b & 0x7F)
            if not b & 0x80:
                return n, p

    for _ in range(spuren):
        assert daten[pos:pos + 4] == b"MTrk", "a track chunk is missing"
        ende = pos + 8 + struct.unpack(">I", daten[pos + 4:pos + 8])[0]
        p, zeit, status, offen = pos + 8, 0, None, {}
        while p < ende:
            delta, p = vlq(p)
            zeit += delta
            b = daten[p]
            if b == 0xFF:
                typ = daten[p + 1]
                n, p = vlq(p + 2)
                if typ == 0x51 and tempo_us is None:
                    tempo_us = int.from_bytes(daten[p:p + n], "big")
                p += n
                status = None
                continue
            if b in (0xF0, 0xF7):
                n, p = vlq(p + 1)
                p += n
                status = None
                continue
            if b & 0x80:
                status = b
                p += 1
            art, kanal = status & 0xF0, status & 0x0F
            if art in (0xC0, 0xD0):
                p += 1
                continue
            d1, d2 = daten[p], daten[p + 1]
            p += 2
            if art == 0x90 and d2 > 0:
                offen[(kanal, d1)] = (zeit, d2)
            elif art == 0x80 or art == 0x90:
                if (kanal, d1) in offen:
                    start, vel = offen.pop((kanal, d1))
                    noten.append((d1, round(start / ppq, 4), round((zeit - start) / ppq, 4), vel))
        pos = ende
    return {"format": fmt, "ppq": ppq, "tempo_bpm": 60e6 / tempo_us if tempo_us else None,
            "noten": sorted(noten, key=lambda n: (n[1], n[0]))}


def erwartete_noten():
    """The notes of the tour's MIDI file as lies_smf reports them: (note, start in beats, length in beats, velocity)."""
    return [(ton, k * 8.0, float(laenge), MIDI_NOTE_VEL) for k, (ton, laenge) in enumerate(MIDI_NOTEN)]


def vergleiche_noten(ist, soll, toleranz=SMF_TOLERANZ_BEATS):
    """Empty when both lists hold the same notes (same pitch, velocity, start and length within `toleranz` beats), else the differences."""
    if len(ist) != len(soll):
        return [f"{len(ist)} notes read back, {len(soll)} expected"]
    fehler = []
    for a, b in zip(ist, soll):
        if a[0] != b[0] or a[3] != b[3] or abs(a[1] - b[1]) > toleranz or abs(a[2] - b[2]) > toleranz:
            fehler.append(f"read back {a}, expected {b}")
    return fehler


def lies_pcm(pfad):
    """Decodes a file to a float array of shape (frames, 2) at 48 kHz."""
    import numpy as np
    roh = subprocess.run(["ffmpeg", "-v", "error", "-i", str(pfad), "-ac", "2", "-ar", "48000", "-f", "f32le", "-"], capture_output=True).stdout
    x = np.nan_to_num(np.frombuffer(roh[:len(roh) // 8 * 8], dtype="<f4").astype(np.float64))
    return x.reshape(-1, 2)


def spitze_db(x):
    import numpy as np
    s = float(np.abs(x).max()) if len(x) else 0.0
    return 20 * math.log10(s) if s > 0 else -200.0


def band_db(x, von_hz, bis_hz, sek=None):
    """Energy of the mono mix in a band (dB, power sum of the FFT bins), of the first `sek` seconds when given."""
    import numpy as np
    m = (x[:int(48000 * sek)] if sek else x).mean(axis=1)
    leistung = np.abs(np.fft.rfft(m)) ** 2
    f = np.fft.rfftfreq(len(m), 1 / 48000)
    return float(10 * np.log10(leistung[(f >= von_hz) & (f < bis_hz)].sum() + 1e-20))


def anteil_ueber_db(x, grenze_hz, sek=None):
    """Share of the energy above `grenze_hz` in the whole spectrum, in dB: a saturator that adds harmonics raises it."""
    return band_db(x, grenze_hz, 24000, sek) - band_db(x, 20, 24000, sek)


def huelle_je_fenster(x, fenster_s, anzahl):
    """RMS level (dB) of `anzahl` windows of `fenster_s` seconds of the mono mix, from the start."""
    import numpy as np
    n = int(round(48000 * fenster_s))
    m = x.mean(axis=1)
    return [float(20 * np.log10(max(float(np.sqrt((m[k * n:(k + 1) * n] ** 2).mean())), 1e-10))) for k in range(anzahl)]


def versatz_samples(x, sek=1.0):
    """Lag in samples between the left and the right channel (cross correlation of the first `sek` seconds): 0 when they line up."""
    import numpy as np
    n = min(len(x), int(48000 * sek))
    c = np.fft.irfft(np.fft.rfft(x[:n, 0], 2 * n) * np.conj(np.fft.rfft(x[:n, 1], 2 * n)))
    k = int(np.argmax(c))
    return k if k < n else k - 2 * n


def _dateisha(pfad):
    h = hashlib.sha256()
    with open(pfad, "rb") as f:
        for stueck in iter(lambda: f.read(1 << 20), b""):
            h.update(stueck)
    return h.hexdigest()


def _spuren_sicht(lage):
    """The tracks of a project as (id, name, kind, number of clips): what has to survive a zip round trip."""
    return [(s.get("id"), s.get("name"), s.get("art"), len(s.get("clips") or [])) for s in (lage.get("projekt") or {}).get("spuren", [])]


# ---------------------------------------------------------------- extension: steps on the project made above

def _midi_export(t, hand, z):
    with t.schritt("j3.midi_export", "export the MIDI clip as a Standard MIDI file and read the notes back"):
        if not z.get("midi_spur"):
            t.rot("kein_midi_clip", text="j3.midi delivered no MIDI track")
            return
        sp = _spur(hand.rufe("proj_lage"), z["midi_spur"]) or {}
        stumm = bool(sp.get("mute"))
        if stumm:        # the bounce muted the source track, and a muted track is not part of the MIDI export: unmute for the export, mute again after
            if not _gut(t, hand.rufe("proj_aendern", {"label": "Unmute for the MIDI export", "befehle": [
                    {"befehl": "spur_aendern", "spur_id": z["midi_spur"], "mute": False}]}), "proj_aendern"):
                return
        try:
            a = t.ruf("POST", "/proj/export_midi", {})
        finally:
            if stumm:
                with contextlib.suppress(Exception):
                    hand.rufe("proj_aendern", {"label": "Mute the source track again", "befehle": [
                        {"befehl": "spur_aendern", "spur_id": z["midi_spur"], "mute": True}]})
        if not a.ok or not isinstance(a.j, dict):
            return
        dateien = a.j.get("dateien") or []
        alle = next((d for d in dateien if d.get("art") == "alle"), None)
        spur = next((d for d in dateien if d.get("art") == "spur" and d.get("spur_id") == z["midi_spur"]), None)
        t.werte(ordner=a.j.get("ordner"), dateien=[d.get("datei") for d in dateien])
        if not alle or not spur:
            t.rot("datei_fehlt", text="the answer lists no file for the whole project or for the MIDI track")
            return
        soll = erwartete_noten()
        probleme = []
        for art, d in (("alle", alle), ("spur", spur)):
            pfad = Path(a.j.get("ordner", "")) / d.get("datei", "")
            if not pfad.is_file():
                probleme.append(f"{art}: {pfad} does not exist")
                continue
            smf = lies_smf(pfad)
            t.werte(**{f"noten_{art}": len(smf["noten"]), f"ppq_{art}": smf["ppq"], f"tempo_{art}": None if smf["tempo_bpm"] is None else round(smf["tempo_bpm"], 3)})
            probleme += [f"{art}: {x}" for x in vergleiche_noten(smf["noten"], soll)]
            if smf["tempo_bpm"] is None or abs(smf["tempo_bpm"] - z["tempo"]) > 0.01:
                probleme.append(f"{art}: tempo {smf['tempo_bpm']} BPM, the project runs at {z['tempo']}")
            if d.get("noten") != len(soll):
                probleme.append(f"{art}: the answer counts {d.get('noten')} notes")
        if probleme:
            t.rot("noten_ungleich", text="; ".join(probleme[:4]))


def _einsammeln(t, hand, z):
    with t.schritt("j3.einsammeln", "collect the audio of the project into its own folder"):
        if not z.get("audio_spur"):
            t.rot("kein_audio_clip", text="j3.audio delivered no audio track")
            return
        antwort = {}

        def gesammelt():            # a refusal because the transport is still stopping is not the answer: ask again (a poll never marks)
            antwort["a"] = t.ruf("POST", "/proj/einsammeln", {})
            return antwort["a"].code == 200
        t.warte_bis(gesammelt, EINSAMMELN_FRIST_S, "collect answers 200")
        a = antwort.get("a")
        if a is None or a.code != 200 or not isinstance(a.j, dict):
            t.rot("einsammeln_abgelehnt", text=f"POST /proj/einsammeln answered {a.code if a else 'nothing'}: {a.grund if a else ''}")
            return
        b = a.j
        audio = hand.rufe("proj_dateien").get("audio") or []
        kopiert, schon = int(b.get("kopiert") or 0), int(b.get("schon_da") or 0)
        t.werte(kopiert=kopiert, schon_da=schon, fehlt=b.get("fehlt"), abweichend=b.get("abweichend"), audio_dateien=len(audio))
        if not audio:
            t.rot("kein_audio_im_projekt", text="the project lists no audio file")
        elif b.get("fehlt"):
            t.rot("datei_fehlt", text=f"collecting could not find {b.get('fehlt')}")
        elif b.get("abweichend"):
            t.rot("abweichend", text=f"copies with another content: {b.get('abweichend')}")
        elif kopiert + schon < len(audio):
            t.rot("zu_wenig_gesammelt", text=f"{kopiert} copied and {schon} already there for {len(audio)} audio files")


def _relink(t, hand, z):
    with t.schritt("j3.relink", "a missing audio file is reported, found again by its content and relinked"):
        d = hand.rufe("proj_dateien")
        if not _gut(t, d, "proj_dateien"):
            return
        e = next((x for x in d.get("audio") or [] if not x.get("fehlt")), None)
        if not e or not Path(e.get("pfad", "")).is_file():
            t.rot("kein_audio_clip", text="the project has no audio file to take away")
            return
        sha, pfad = e["sha256"], e["pfad"]
        weg = Path(t.ausgabe).resolve() / "musik" / "tour-j3-verlegt.wav"     # the file goes out of the project, as if the drive were unplugged
        weg.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(pfad, weg)
        d2 = hand.rufe("proj_dateien")
        e2 = next((x for x in d2.get("audio") or [] if x.get("sha256") == sha), {})
        t.werte(sha=sha[:12], fehlt_nach_verlegen=e2.get("fehlt"), fehlend=[x[:12] for x in d2.get("fehlend") or []])
        if not e2.get("fehlt") or sha not in (d2.get("fehlend") or []):
            t.rot("nicht_als_fehlend_erkannt", text="the project does not report the moved file as missing")
            return
        # finden asks the library catalogue: an instance without a catalogue answers 503 katalog_fehlt, which is its documented answer
        f = hand.rufe("proj_dateien", {"aktion": "finden", "sha256": sha}, erwartet={"katalog_fehlt", "nicht_gefunden"})
        t.werte(finden=f.get("fehler") or f.get("grund") or ("ok" if f.get("ok") else "unbekannt"))
        r = hand.rufe("proj_dateien", {"aktion": "relink", "sha256": sha, "pfad": str(weg)})
        if not _gut(t, r, "proj_dateien"):
            return
        d3 = hand.rufe("proj_dateien")
        e3 = next((x for x in d3.get("audio") or [] if x.get("sha256") == sha), {})
        neu = e3.get("pfad", "")
        t.werte(fehlt_nach_relink=e3.get("fehlt"), pfad_nach_relink=Path(neu).name)
        if e3.get("fehlt") or sha in (d3.get("fehlend") or []):
            t.rot("noch_fehlend", text="the file is still reported as missing after the relink")
        elif not Path(neu).is_file() or "/audio/" not in neu.replace("\\", "/"):
            t.rot("nicht_im_projekt", text=f"the relinked file is not a copy in the audio folder of the project: {neu}")
        elif _dateisha(neu) != sha:
            t.rot("sha_ungleich", text="the copy has another content than the project expects")


def _undo(t, hand, z):
    with t.schritt("j3.undo", "one undo takes the last edit back, redo restores it (state read back)"):
        sid = z.get("audio_spur")
        if not sid:
            t.rot("kein_audio_clip", text="j3.audio delivered no audio track")
            return

        def fader():
            sp = _spur(hand.rufe("proj_lage"), sid) or {}
            return float(sp.get("fader_db", 0.0))

        def setze(db, label):
            return _gut(t, hand.rufe("proj_aendern", {"label": label, "befehle": [{"befehl": "spur_aendern", "spur_id": sid, "fader_db": db}]}), "proj_aendern")

        ausgang = fader()
        if not setze(UNDO_FADER_A_DB, "Fader A"):
            return
        time.sleep(UNDO_PAUSE_S)       # edits of one fader less than a second apart are one history entry
        if not setze(UNDO_FADER_B_DB, "Fader B"):
            return
        nach_b = fader()
        if not _gut(t, hand.rufe("proj_undo", {}), "proj_undo"):
            return
        nach_undo = fader()
        if not _gut(t, hand.rufe("proj_redo", {}), "proj_redo"):
            return
        nach_redo = fader()
        t.werte(ausgang_db=ausgang, nach_zweiter_aenderung_db=nach_b, nach_undo_db=nach_undo, nach_redo_db=nach_redo)

        def nah(a, b):
            return abs(a - b) < 0.01
        if not nah(nach_b, UNDO_FADER_B_DB):
            t.rot("aenderung_nicht_im_projekt", text=f"the fader reads {nach_b} dB after the edit, expected {UNDO_FADER_B_DB}")
        elif not nah(nach_undo, UNDO_FADER_A_DB):
            t.rot("undo_falsch", text=f"after one undo the fader reads {nach_undo} dB, expected the value before the last edit ({UNDO_FADER_A_DB}); it was {ausgang} before both")
        elif not nah(nach_redo, UNDO_FADER_B_DB):
            t.rot("redo_falsch", text=f"after redo the fader reads {nach_redo} dB, expected {UNDO_FADER_B_DB}")


def _zip(t, hand, z):
    with t.schritt("j3.zip", "portable zip: export the project, import it as a new project, open it"):
        lage = hand.rufe("proj_lage")
        slug = lage.get("slug") or z.get("slug")
        vorher = _spuren_sicht(lage)
        if not slug or not vorher:
            t.rot("kein_projekt", text="no open project to export")
            return
        a = t.ruf("GET", f"/proj/export_zip?slug={urllib.parse.quote(slug)}", None, quelle="andreas", timeout=300)
        if not a.ok:
            return
        zielzip = Path(t.ausgabe).resolve() / "musik" / f"{slug}.cypherdj.zip"
        zielzip.parent.mkdir(parents=True, exist_ok=True)
        zielzip.write_bytes(a.roh)
        try:
            with zipfile.ZipFile(zielzip) as zz:
                namen, kaputt = zz.namelist(), zz.testzip()
        except zipfile.BadZipFile:
            t.rot("kein_zip", text="the download is not a zip file")
            return
        t.werte(zip_bytes=len(a.roh), eintraege=len(namen), audio_eintraege=len([n for n in namen if n.startswith("audio/")]))
        if kaputt or "project.json" not in namen:
            t.rot("zip_unvollstaendig", text=f"damaged entry {kaputt}" if kaputt else "project.json is not in the zip")
            return
        if any(s[2] == "audio" for s in vorher) and not any(n.startswith("audio/") for n in namen):
            t.rot("audio_fehlt_im_zip", text="the project has audio but the zip holds no audio file")
            return
        b = t.hochladen("/proj/import_zip", zielzip, timeout=300)
        if not b.ok or not isinstance(b.j, dict):
            return
        neu = b.j.get("slug")
        t.werte(neuer_slug=neu)
        if not neu or neu == slug:
            t.rot("kein_neues_projekt", text=f"the import answered the slug {neu!r}, the original is {slug!r}")
            return
        if not _gut(t, hand.rufe("proj_oeffnen", {"slug": neu}), "proj_oeffnen"):
            return
        nachher = _spuren_sicht(hand.rufe("proj_lage"))
        d = hand.rufe("proj_dateien")
        t.werte(spuren=len(nachher), fehlend=len(d.get("fehlend") or []))
        if nachher != vorher:
            t.rot("spuren_ungleich", text=f"the imported project holds {nachher}, the original {vorher}")
        elif d.get("fehlend"):
            t.rot("audio_fehlt_nach_import", text=f"the imported project misses {len(d['fehlend'])} audio file(s)")


# ---------------------------------------------------------------- extension: effect steps, each in a small project of its own

FX_QUELLE = {"lautstaerke": 1.0}


def _noten_dicht(beats):
    """Eighth notes on C2 (note 48) for `beats` beats: a steady source whose level and spectrum are the same in every second."""
    return [{"beat": k * 0.5, "laenge": 0.45, "ton": 48, "vel": 100} for k in range(int(beats * 2))]


def _fx_projekt(t, hand, z, kurz, spuren, noten, beats):
    """A new project with one RB-338 track per entry of `spuren` ({name, parameter, pan?}), each with a MIDI clip of `noten`.
    Returns {ids, tempo} or None (the step is red then)."""
    if not _gut(t, hand.rufe("proj_neu", {"name": f"{z['name']}-{kurz}"}), "proj_neu"):
        return None
    r = hand.rufe("proj_aendern", {"label": "Source tracks", "befehle": [
        {"befehl": "spur_neu", "art": "instrument", "name": s["name"], "geraet": {"art": "intern", "name": "rb338", "parameter": s["parameter"]}}
        for s in spuren]})
    if not _gut(t, r, "proj_aendern"):
        return None
    lage = hand.rufe("proj_lage")
    ids = [s["id"] for s in (lage.get("projekt") or {}).get("spuren", [])][-len(spuren):]
    assert len(ids) == len(spuren), "the source tracks were not made"
    befehle = []
    for sid, s in zip(ids, spuren):
        if s.get("pan") is not None:
            befehle.append({"befehl": "spur_aendern", "spur_id": sid, "pan": s["pan"]})
        befehle.append({"befehl": "clip_neu", "spur_id": sid, "art": "midi", "start_beat": 0, "laenge_beats": beats, "noten": noten})
    if not _gut(t, hand.rufe("proj_aendern", {"label": "Source clips", "befehle": befehle}), "proj_aendern"):
        return None
    return {"ids": ids, "tempo": float((lage.get("projekt") or {}).get("tempo_bpm") or 120)}


def _fx_export(t, hand, von, bis, ausklang=None):
    """One export of the open project: (answer, samples) or (None, None) with the step red."""
    arg = {"von_beat": von, "bis_beat": bis}
    if ausklang:
        arg["ausklang_beats"] = ausklang
    r = _export_rufen(t, hand, arg)
    if not _gut(t, r, "proj_export"):
        return None, None
    if not r.get("datei"):
        t.rot("keine_datei", text="the export answer names no file")
        return None, None
    return r, lies_pcm(r["datei"])


def _fx_insert(t, hand, sid, art, werte, pos=0, label=None):
    """Puts an insert on a track and reads it back from the project: the insert id, or None (red)."""
    r = hand.rufe("proj_aendern", {"label": label or f"Insert {art}", "befehle": [
        {"befehl": "insert_setzen", "strang_id": sid, "pos": pos, "art": art, "werte": werte}]})
    if not _gut(t, r, "proj_aendern"):
        return None
    ins = (_spur(hand.rufe("proj_lage"), sid) or {}).get("inserts") or []
    treffer = [i for i in ins if i.get("art") == art]
    assert treffer and treffer[-1].get("an"), f"the project does not hold an active {art} insert afterwards"
    return treffer[-1]["id"]


def _auto(t, hand, z):
    with t.schritt("j3.auto", f"a volume lane over four bars ({AUTO_VON_DB:g} to {AUTO_BIS_DB:g} dB): the exported level follows it"):
        p = _fx_projekt(t, hand, z, "auto", [{"name": "Lane", "parameter": FX_QUELLE}], _noten_dicht(AUTO_BEATS), AUTO_BEATS)
        if p is None:
            return
        sid = p["ids"][0]
        r = hand.rufe("proj_aendern", {"label": "Volume lane", "befehle": [{"befehl": "auto_neu", "spur_id": sid, "ziel": "fader", "punkte": [
            {"beat": 0, "wert": AUTO_VON_DB}, {"beat": AUTO_BEATS, "wert": AUTO_BIS_DB}]}]})
        if not _gut(t, r, "proj_aendern"):
            return
        lanes = (_spur(hand.rufe("proj_lage"), sid) or {}).get("lanes") or []
        assert len(lanes) == 1 and lanes[0].get("punkte_zahl") == 2, f"the track holds {lanes} instead of one lane with two points"
        punkte = hand.rufe("proj_auto", {"spur_id": sid, "lane_id": lanes[0]["id"]}).get("punkte") or []
        assert [(q.get("beat"), q.get("wert")) for q in punkte] == [(0, AUTO_VON_DB), (AUTO_BEATS, AUTO_BIS_DB)], f"the lane reads back as {punkte}"
        r, x = _fx_export(t, hand, 0, AUTO_BEATS)
        if x is None:
            return
        fenster_beats = 2.0
        fenster = int(AUTO_BEATS / fenster_beats)
        pegel = huelle_je_fenster(x, fenster_beats * 60.0 / p["tempo"], fenster)
        soll = (AUTO_BIS_DB - AUTO_VON_DB) / fenster                # dB per window the lane climbs
        k = list(range(fenster))
        import numpy as np
        steigung, achse = (float(v) for v in np.polyfit(k, pegel, 1))
        abweichung = max(abs(pegel[i] - (achse + steigung * i)) for i in k)
        t.werte(steigung_db_je_fenster=round(steigung, 3), erwartet_db_je_fenster=round(soll, 3), abweichung_max_db=round(abweichung, 3),
                anstieg_db=round(pegel[-1] - pegel[0], 2), pegel_db=[round(v, 1) for v in pegel])
        if abs(steigung - soll) > AUTO_STEIGUNG_TOLERANZ_DB:
            t.rot("lane_nicht_im_audio", text=f"the level climbs {steigung:.2f} dB per window, the lane {soll:.2f}")
        elif abweichung > AUTO_ABWEICHUNG_MAX_DB:
            t.rot("lane_unstetig", text=f"a window is {abweichung:.2f} dB away from the line of the lane")


def _eq(t, hand, z):
    with t.schritt("j3.eq", f"Cypher EQ: an 18 dB cut at 180 Hz lowers the band {EQ_BAND[0]:g} to {EQ_BAND[1]:g} Hz in the export"):
        p = _fx_projekt(t, hand, z, "eq", [{"name": "FX", "parameter": FX_QUELLE}], _noten_dicht(FX_KLIP_BEATS), FX_KLIP_BEATS)
        if p is None:
            return
        sid = p["ids"][0]
        r, vor = _fx_export(t, hand, 0, FX_EXPORT_BEATS)
        if vor is None:
            return
        if _fx_insert(t, hand, sid, "eq", {"b1/an": 1, "b1/typ": 0, "b1/freq": 180, "b1/gain": -18, "b1/q": 1.0}, label="EQ cut") is None:
            return
        r, nach = _fx_export(t, hand, 0, FX_EXPORT_BEATS)
        if nach is None:
            return
        senkung = band_db(vor, *EQ_BAND, FX_ANALYSE_S) - band_db(nach, *EQ_BAND, FX_ANALYSE_S)
        oben = band_db(nach, EQ_OBEN_HZ, 24000, FX_ANALYSE_S) - band_db(vor, EQ_OBEN_HZ, 24000, FX_ANALYSE_S)
        t.werte(band_senkung_db=round(senkung, 2), oben_aenderung_db=round(oben, 2), spitze_vor_db=round(spitze_db(vor), 2), spitze_nach_db=round(spitze_db(nach), 2))
        if senkung < EQ_MIN_SENKUNG_DB:
            t.rot("eq_senkt_nicht", text=f"the band falls by {senkung:.1f} dB, expected at least {EQ_MIN_SENKUNG_DB}")
        elif abs(oben) > EQ_OBEN_TOLERANZ_DB:
            t.rot("eq_veraendert_oberhalb", text=f"the energy above {EQ_OBEN_HZ:g} Hz changed by {oben:+.1f} dB, the cut is below it")


def _komp(t, hand, z):
    with t.schritt("j3.komp", "Cypher Komp: the compressor lowers the peak of the export"):
        p = _fx_projekt(t, hand, z, "komp", [{"name": "FX", "parameter": FX_QUELLE}], _noten_dicht(FX_KLIP_BEATS), FX_KLIP_BEATS)
        if p is None:
            return
        sid = p["ids"][0]
        r, vor = _fx_export(t, hand, 0, FX_EXPORT_BEATS)
        if vor is None:
            return
        schwelle = round(spitze_db(vor) - KOMP_UNTER_SPITZE_DB, 1)
        # attack 1 ms: the lower limit of 0.1 ms is accepted by the project but refused by the render (product finding of this tour round)
        werte = {"schwelle": schwelle, "ratio": 10, "knie": 0, "attack": 1, "release": 100, "makeup": 0, "mix": 1}
        if _fx_insert(t, hand, sid, "komp", werte, label="Compressor") is None:
            return
        r, nach = _fx_export(t, hand, 0, FX_EXPORT_BEATS)
        if nach is None:
            return
        senkung = spitze_db(vor) - spitze_db(nach)
        m = FX_ANALYSE_S

        def crest(x):
            import numpy as np
            y = x[:int(48000 * m)]
            return spitze_db(y) - 20 * math.log10(max(float(np.sqrt((y ** 2).mean())), 1e-10))
        t.werte(schwelle_db=schwelle, spitze_vor_db=round(spitze_db(vor), 2), spitze_nach_db=round(spitze_db(nach), 2), spitze_senkung_db=round(senkung, 2),
                crest_vor_db=round(crest(vor), 2), crest_nach_db=round(crest(nach), 2))
        if senkung < KOMP_MIN_SENKUNG_DB:
            t.rot("komp_senkt_spitze_nicht", text=f"the peak falls by {senkung:.1f} dB, expected at least {KOMP_MIN_SENKUNG_DB} (threshold {schwelle} dB, ratio 10)")


def _hall(t, hand, z):
    with t.schritt("j3.hall", "Cypher Hall (a reverb return): the sound of one short note rings on much longer"):
        p = _fx_projekt(t, hand, z, "hall", [{"name": "Note", "parameter": {"cutoff": 0.5, "lautstaerke": 1.0}}],
                        [{"beat": 0, "laenge": 0.25, "ton": 60, "vel": 110}], 4)
        if p is None:
            return
        sid = p["ids"][0]
        r, vor = _fx_export(t, hand, 0, 4, ausklang=16)
        if vor is None:
            return
        ende_vor = analysiere(r["datei"])["ende_s"]
        r = hand.rufe("proj_aendern", {"label": "Reverb return", "befehle": [
            {"befehl": "return_neu", "name": "Hall", "hall": {"an": True, "decay": 0.9, "groesse": 0.9}}]})
        if not _gut(t, r, "proj_aendern"):
            return
        rets = [x for x in ((hand.rufe("proj_lage").get("projekt") or {}).get("returns") or []) if x.get("name") == "Hall"]
        assert rets, "the project holds no Hall return"
        if not _gut(t, hand.rufe("proj_aendern", {"label": "Reverb send", "befehle": [
                {"befehl": "send_setzen", "strang_id": sid, "return_id": rets[-1]["id"], "db": 0}]}), "proj_aendern"):
            return
        r, nach = _fx_export(t, hand, 0, 4, ausklang=16)
        if nach is None:
            return
        ende_nach = analysiere(r["datei"])["ende_s"]
        t.werte(ende_ohne_hall_s=round(ende_vor, 2), ende_mit_hall_s=round(ende_nach, 2), verlaengerung_s=round(ende_nach - ende_vor, 2))
        if ende_nach - ende_vor < HALL_MIN_VERLAENGERUNG_S:
            t.rot("hall_verlaengert_nicht", text=f"the sound ends at {ende_vor:.2f} s without and {ende_nach:.2f} s with the reverb, expected at least {HALL_MIN_VERLAENGERUNG_S} s more")


def _saett(t, hand, z):
    with t.schritt("j3.saett", "Cypher Saett: the saturator adds harmonics to a near-sine source"):
        quelle = {"cutoff": 0.0, "resonanz": 0, "env_mod": 0, "accent": 0, "lautstaerke": 1.0, "wellenform": 0.0}
        p = _fx_projekt(t, hand, z, "saett", [{"name": "Sine", "parameter": quelle}], _noten_dicht(FX_KLIP_BEATS), FX_KLIP_BEATS)
        if p is None:
            return
        sid = p["ids"][0]
        # a utility insert lifts the quiet source by 24 dB: only near full scale the saturator has something to bend. It stays in both exports.
        if _fx_insert(t, hand, sid, "utility", {"gain": SAETT_VORVERSTAERKUNG_DB}, 0, "Preamp") is None:
            return
        r, vor = _fx_export(t, hand, 0, FX_EXPORT_BEATS)
        if vor is None:
            return
        if _fx_insert(t, hand, sid, "saett", {"drive": SAETT_DRIVE_DB, "out": -24, "mix": 1}, 1, "Saturator") is None:
            return
        r, nach = _fx_export(t, hand, 0, FX_EXPORT_BEATS)
        if nach is None:
            return
        a, b = anteil_ueber_db(vor, SAETT_GRENZE_HZ, FX_ANALYSE_S), anteil_ueber_db(nach, SAETT_GRENZE_HZ, FX_ANALYSE_S)
        t.werte(anteil_vor_db=round(a, 2), anteil_nach_db=round(b, 2), anstieg_db=round(b - a, 2), grenze_hz=SAETT_GRENZE_HZ)
        if b - a < SAETT_MIN_ANSTIEG_DB:
            t.rot("saett_ohne_obertoene", text=f"the energy share above {SAETT_GRENZE_HZ:g} Hz rises by {b - a:.1f} dB, expected at least {SAETT_MIN_ANSTIEG_DB}")


def _limiter(t, hand, z):
    with t.schritt("j3.limiter", "Cypher limiter: the peak of the export stays under the ceiling"):
        p = _fx_projekt(t, hand, z, "lim", [{"name": "FX", "parameter": FX_QUELLE}], _noten_dicht(FX_KLIP_BEATS), FX_KLIP_BEATS)
        if p is None:
            return
        sid = p["ids"][0]
        r, vor = _fx_export(t, hand, 0, FX_EXPORT_BEATS)
        if vor is None:
            return
        decke = round(spitze_db(vor) - LIM_UNTER_SPITZE_DB, 1)
        if _fx_insert(t, hand, sid, "lim", {"decke": decke, "abklingen": 50}, label="Limiter") is None:
            return
        r, nach = _fx_export(t, hand, 0, FX_EXPORT_BEATS)
        if nach is None:
            return
        spitze = spitze_db(nach)
        t.werte(decke_db=decke, spitze_vor_db=round(spitze_db(vor), 2), spitze_nach_db=round(spitze, 2), unter_decke_db=round(decke - spitze, 2))
        if spitze > decke + 0.1:
            t.rot("limiter_haelt_decke_nicht", text=f"the peak is {spitze:.2f} dB over a ceiling of {decke} dB")
        elif spitze < decke - LIM_MAX_UNTER_DECKE_DB:
            t.rot("limiter_zu_leise", text=f"the peak is {decke - spitze:.1f} dB under the ceiling, the pan law accounts for 3 dB")


def _pdc(t, hand, z):
    with t.schritt("j3.pdc", "plugin delay compensation: a track with a latent insert stays sample aligned with one without"):
        quelle = {"cutoff": 1.0, "lautstaerke": 1.0, "env_mod": 0, "decay": 0.0}
        noten = [{"beat": 0, "laenge": 0.25, "ton": 60, "vel": 110}, {"beat": 1, "laenge": 0.25, "ton": 67, "vel": 110}]
        p = _fx_projekt(t, hand, z, "pdc", [{"name": "Links", "parameter": quelle, "pan": -1}, {"name": "Rechts", "parameter": quelle, "pan": 1}], noten, 4)
        if p is None:
            return
        sid = p["ids"][0]
        versatz, spitzen = {}, {}
        for name, art, werte in (("ohne", None, None), ("eq", "eq", {}), ("lim", "lim", {"decke": 0})):
            iid = None
            if art:
                iid = _fx_insert(t, hand, sid, art, werte, label=f"Latent insert {art}")
                if iid is None:
                    return
            r, x = _fx_export(t, hand, 0, 4)
            if x is None:
                return
            versatz[name] = versatz_samples(x)
            spitzen[name] = [round(spitze_db(x[:, 0]), 1), round(spitze_db(x[:, 1]), 1)]
            if iid:
                if not _gut(t, hand.rufe("proj_aendern", {"label": "Remove insert", "befehle": [{"befehl": "insert_entfernen", "insert_id": iid}]}), "proj_aendern"):
                    return
        t.werte(versatz_samples=versatz, spitzen_db=spitzen, latenz_eq_samples=69, latenz_lim_samples=86)
        if any(min(s) < STILLE_DB for s in spitzen.values()):
            t.rot("export_stumm", text="a channel of an export used to prove the alignment is silent")
        elif any(abs(v) > PDC_MAX_VERSATZ for v in versatz.values()):
            t.rot("pdc_versatz", text=f"left and right are {versatz} samples apart, the latent insert is not compensated")


def _mixdown():
    from . import j3_mixdown
    return j3_mixdown


ERWEITERUNG = (("j3.midi_export", _midi_export), ("j3.einsammeln", _einsammeln), ("j3.relink", _relink), ("j3.undo", _undo), ("j3.zip", _zip),
               ("j3.auto", _auto), ("j3.eq", _eq), ("j3.komp", _komp), ("j3.hall", _hall), ("j3.saett", _saett), ("j3.limiter", _limiter),
               ("j3.pdc", _pdc), ("j3.take", lambda t, h, z: j3_take.take(t, h, z)),   # late binding: j3_take imports this module
               ("j3.rack", lambda t, h, z: j3_rack.rack(t, h, z)),
               ("j3.plugin", lambda t, h, z: j3_plugin.plugin(t, h, z)),
               ("j3.zusammen", lambda t, h, z: _mixdown().zusammen(t, h, z)),   # imported on first use: j3_mixdown reads J3.STILLE_DB at import
               ("j3.resample", lambda t, h, z: _mixdown().resample(t, h, z)))


def gewaehlte_schritte():
    """The extension step ids named in CYPHERDJ_TOUR_J3_SCHRITTE (comma list), or None for all."""
    roh = os.environ.get("CYPHERDJ_TOUR_J3_SCHRITTE", "").strip()
    return {x.strip() for x in roh.split(",") if x.strip()} if roh else None


def schritte(t, hand=None, erweitert=None):
    """The steps of the tour. `erweitert` adds the extension steps (1.0 features, see the module text); by default the real tour runs them
    (it starts its own hand) and a test with a fake hand does not."""
    z = {"name": f"tour-j3-{time.strftime('%H%M%S')}", "audio_frames": 0, "tempo": 120.0}
    eigene = hand is None
    gewaehlt = gewaehlte_schritte()
    if erweitert is None:
        erweitert = eigene
    if eigene:
        hand = laeufer.Hand(t.instanz, tour=t)      # a failed tool call turns its step red by itself (erwartet declares an expected refusal)
    try:
        _neu(t, hand, z)
        _midi(t, hand, z)
        _midi_live(t, hand, z)
        _instrument(t, hand, z)
        _surge(t, hand, z)
        _audio(t, hand, z)
        _eingang(t, hand, z)
        _warp(t, hand, z)
        _mix(t, hand, z)
        _version(t, hand, z)
        _export(t, hand, z)
        _datei(t, hand, z)
        if erweitert:
            for kennung, schritt in ERWEITERUNG:
                if gewaehlt is None or kennung in gewaehlt:
                    schritt(t, hand, z)
    finally:
        if eigene:
            hand.ende()
