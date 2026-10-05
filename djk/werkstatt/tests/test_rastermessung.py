"""Instrument-Kontrolle vor jeder Warp-Messung (Klick-Quellen aus proben/07, sha256 geprueft)."""
from werkstatt import kontrollen as K
from werkstatt.eingang import lade_stereo48
from werkstatt.rastermessung import miss_starr
from werkstatt.warp import schreibe_f32


def test_starrer_klick_gegen_eigenes_raster_ist_null(tmp_path):
    """NEGATIV-KONTROLLE: konst134 gegen 134 BPM, Rest nahe 0 (Planprobe: 0,05 ms RMS)."""
    schreibe_f32(lade_stereo48(K.pruefe(*K.KONTROLLEN["konst134"])), tmp_path / "k.f32")
    e = miss_starr(tmp_path / "k.f32", 134.0)
    assert e["einsaetze"] == 134 and e["rest_rms_ms"] <= 0.1


def test_driftklick_gegen_128_trifft(tmp_path):
    """POSITIV-KONTROLLE: drift_synth gegen 128 BPM muss treffen (b_timemap `quelle`: 43,4 ms RMS; Planprobe 43,34)."""
    schreibe_f32(lade_stereo48(K.pruefe(*K.KONTROLLEN["drift_synth"])), tmp_path / "d.f32")
    e = miss_starr(tmp_path / "d.f32", 128.0)
    assert e["einsaetze"] == 255 and 40.0 <= e["rest_rms_ms"] <= 47.0
