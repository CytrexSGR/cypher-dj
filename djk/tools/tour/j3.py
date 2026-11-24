"""Journey J3, production: a project from nothing to an exported WAV, through the hand tools (the tools Cypher uses, not the page).

Steps: j3.neu, j3.midi, j3.midi_live (SKIP), j3.instrument, j3.surge, j3.audio, j3.eingang (SKIP), j3.warp, j3.mix, j3.version,
j3.export, j3.datei. Two shortenings are named on purpose (they are SKIP steps or noted in the step values and in the manual chapter):
audio comes from an offline bounce of the MIDI track instead of an input recording, MIDI comes from a file the tour writes
instead of live MIDI. `schritte(t, hand=None)`: the tests pass a fake hand, the tour CLI lets the tour start the real one.
"""
import contextlib
import math
import os
import struct
import subprocess
import time
from pathlib import Path

from . import runner as laeufer

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
    for k, (note, laenge_beats) in enumerate([(36, 7), (40, 7), (43, 7), (48, 8)]):
        an = k * 8 * PPQ
        spur += _vlq(an - jetzt) + bytes([0x90, note, 100])
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
        vor = hand.rufe("proj_export", bereich, 300)         # the same range before the warp: the reference
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
        nach = hand.rufe("proj_export", bereich, 300)         # and after it
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
        r = hand.rufe("proj_export", {"von_beat": 0, "bis_beat": TAKTE * 4}, 300)
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


def schritte(t, hand=None):
    z = {"name": f"tour-j3-{time.strftime('%H%M%S')}", "audio_frames": 0, "tempo": 120.0}
    eigene = hand is None
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
    finally:
        if eigene:
            hand.ende()
