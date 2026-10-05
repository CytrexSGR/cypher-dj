# Traktor zaehlt den Encoder-Vorlauf der Quelle-MP3 mit (LAME: 1105 Samples = 25,057 ms bei 44,1 kHz),
# unsere eigene Dekodierung (audio.lade_mono, ffmpeg) schneidet ihn ab -- wie djk/cues/bibliothek.ts
# verschiebeTraktor() und djk/cues/tests/vorlauf.test.mjs. raster_fuer() baute den Takt-Raster fuer den
# Traktor-Grid-Pfad bisher direkt auf dem rohen grid_ms auf (Befund 2026-09-26, ~/messungen/
# 2026-09-26-djk-encoder-vorlauf/befund.md): auf der eigenen (vorlauf-freien) fm-Zeitachse lag der
# Anker damit systematisch zu spaet. vorlauf_s korrigiert das, analog zu verschiebeTraktor.
from strukturvorschlag import lauf

VORLAUF_S = 0.025057  # LAME 1105 Samples / 44100 Hz


def test_raster_fuer_verschiebt_traktor_anker_um_vorlauf():
    fm = {"dauer_s": 200.0}
    eintrag = {"grid_ms": 1000.0, "bpm_traktor": 128.0}
    r = lauf.raster_fuer(fm, eintrag, tags=None, vorlauf_s=VORLAUF_S)
    assert r["quelle"] == "traktor"
    assert abs(r["anker_s"] - (1.0 - VORLAUF_S)) < 1e-9
    assert abs(r["starts"][0] - r["nummern"][0] * r["takt_s"] - (1.0 - VORLAUF_S)) < 1e-9


def test_negativkontrolle_vorlauf_0_aendert_nichts():
    """Datei ohne Encoder-Vorlauf (z. B. WAV/FLAC) oder Aufrufer ohne vorlauf_s: Anker bleibt roh."""
    fm = {"dauer_s": 200.0}
    eintrag = {"grid_ms": 1000.0, "bpm_traktor": 128.0}
    r_ohne_param = lauf.raster_fuer(fm, eintrag, tags=None)
    r_explizit_null = lauf.raster_fuer(fm, eintrag, tags=None, vorlauf_s=0.0)
    assert abs(r_ohne_param["anker_s"] - 1.0) < 1e-9
    assert abs(r_explizit_null["anker_s"] - 1.0) < 1e-9
