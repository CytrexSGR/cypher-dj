"""Auswertung und Bericht an einem synthetischen Laufordner mit bekannter Wahrheit (ohne JACK): Prüfquelle-Signal,
ein kill -9 mit harter Naht, Schleife um einen Takt, Rückgabe auf dem Raster. Fehlerfall: derselbe Lauf mit einem Block
Stille an der Naht und mit Rückkehr 333 Samples daneben."""
import json
from pathlib import Path

import numpy as np
from scipy.io import wavfile

import auswertung
import bericht
import profil

SR, SPB, TAKT, T0 = 48000, 22500.0, 90000, 10_000_000_000


def signal(n):
    s = np.arange(n)
    ton = 0.1 * np.sin(2 * np.pi * 11.0 * (s % 2400) / 2400.0)
    klick = np.zeros(n)
    form = np.exp(-np.arange(96) / 12.0) * np.cos(2 * np.pi * 2000.0 * np.arange(96) / SR)
    for b in range(int(n / SPB) + 1):
        e = int(round(b * SPB))
        if e + 96 <= n:
            klick[e:e + 96] = (0.5 if b % 4 == 0 else 0.25) * form
    return ton, klick


def baue_lauf(o, stille_an_naht=False, rueck_versatz=0):
    n = 20 * SR
    ton, klick = signal(n + TAKT)
    a = 8 * SR                                     # Eingriff bei 8 s
    naht = a + 256                                 # Notbahn übernimmt einen Block später
    rueck = naht + 10 * 256                        # Rückgabe nach zehn Blöcken
    L, R = ton[:n].copy(), klick[:n].copy()
    L[naht:rueck], R[naht:rueck] = ton[naht - TAKT:rueck - TAKT], klick[naht - TAKT:rueck - TAKT]
    g = np.arange(256) / 256.0                     # Rückgabe mit 256 Samples Blende (wie die Notbahn)
    L[rueck:rueck + 256] = (1 - g) * ton[rueck - TAKT:rueck - TAKT + 256] + g * ton[rueck:rueck + 256]
    if rueck_versatz:
        R[rueck:] = 0.0
        R[rueck + rueck_versatz:] = klick[rueck:n - rueck_versatz]
    if stille_an_naht:
        L[naht:naht + 256] = 0.0
        R[naht:naht + 256] = 0.0
    wavfile.write(o / "aufnahme.wav", SR, np.stack([L, R], axis=1).astype(np.float32))
    (o / "aufnahme.wav.json").write_text(json.dumps({"erster_mono_ns": T0, "erster_jack_frame": 0, "frames": n,
                                                     "luecken": 0, "luecken_bei": [], "ueberlauf": 0, "quantum": 256}))
    t_e = T0 + int(a * 1e9 / SR)
    nb = [(t_e - 2_000_000_000, 0, 0), (t_e + 6_000_000, 1, 0), (t_e + 60_000_000, 3, 0), (t_e + 70_000_000, 0, 0)]
    (o / "osc.jsonl").write_text("".join(json.dumps({"t_ns": t, "adresse": "/nb", "typen": "iiih", "werte": [z, k, 0, 0]})
                                         + "\n" for t, z, k in nb))
    (o / "journal-quelle.txt").write_text("pruefquelle start modus ring\npruefquelle ende zyklen 10 spins 0 luecken 0 "
                                          "luecken_frames 0 w 1\npruefquelle start modus ring\n")
    p = profil.pruefe({"name": "synth", "zweck": "Test.", "dauer_s": 20.0, "quelle": {"art": "pruefquelle",
                       "neustart": True}, "eingriff": [{"nach_s": 8.0, "art": "kill9", "ziel": "quelle"}],
                       "erwartung": {"stille_ms_max": 0.0, "spruenge_je_eingriff_min": 1, "raster_versatz_max": 1.0,
                                     "schleife_in_jedem_eingriff": True}})
    fl = {"uptime": "x", "last1": 1.0, "gpu": "0 MiB"}
    lauf = {"profil": p, "senke": "cypherdj-pruef-f-synth", "senke_modul": "1", "fehler": None,
            "eingriffe": [{"art": "kill9", "ziel": "quelle", "pid": 1, "t_ns": t_e, "neue_pid": 2,
                           "t_neu_ns": t_e + 40_000_000}],
            "module_vorher": ["1 a"], "module_nachher": ["1 a"], "units_reste": "",
            "fremdlast_vorher": fl, "fremdlast_nachher": fl}
    (o / "lauf.json").write_text(json.dumps(lauf))


def test_naht_schleife_rueckgabe(tmp_path):
    baue_lauf(tmp_path)
    A = auswertung.werte_aus(tmp_path)
    m = A["eingriffe"][0]
    assert m["spruenge"]["anzahl"] == 1 and m["spruenge"]["an_ms"][0] == round(256 * 1000 / SR, 2)
    assert m["stille"]["ereignisse"] == 0
    assert m["raster_schleife"]["versatz_samples"] == 0.0
    assert m["raster_rueckkehr"]["versatz_samples"] == 0.0
    assert m["notbahn"]["uebernahmen"] == 1 and 1 in m["notbahn"]["zustaende"]
    assert A["ruhe"]["spruenge"] == 0 and A["ruhe"]["stille_ereignisse"] == 0 and A["ruhe"]["raster_streuung"] == 0.0
    assert A["ergebnis"] == "erfuellt", A["urteile"]
    b = bericht.schreibe(tmp_path).read_text()
    assert "Zusagen aus ARCHITEKTUR §7" in b and "Kern stirbt: Stille" in b


def test_fehlerfall_stille_und_rastersprung(tmp_path):
    baue_lauf(tmp_path, stille_an_naht=True, rueck_versatz=333)
    A = auswertung.werte_aus(tmp_path)
    m = A["eingriffe"][0]
    assert m["stille"]["ereignisse"] == 1 and 5.3 <= m["stille"]["laengste_ms"] <= 5.4
    assert m["raster_rueckkehr"]["versatz_samples"] == 333.0
    assert A["ergebnis"] == "verfehlt"
    verfehlt = {u["schluessel"] for u in A["urteile"] if not u["ok"]}
    assert verfehlt == {"stille_ms_max", "raster_versatz_max"}


def test_instrument_luecke_macht_unbrauchbar(tmp_path):
    baue_lauf(tmp_path)
    meta = json.loads((tmp_path / "aufnahme.wav.json").read_text())
    meta["luecken"] = 1
    (tmp_path / "aufnahme.wav.json").write_text(json.dumps(meta))
    A = auswertung.werte_aus(tmp_path)
    assert A["ergebnis"] == "unbrauchbar" and A["grund"].startswith("Aufnehmer 1 Lücken")


def baue_kern_lauf(o, loch=False):
    """Kern mit Prüfklick auf L und R, kill -9 bei 8 s ohne Neustart: die Notbahn schleift den letzten Takt 8 Takte lang
    und blendet über 2 Takte aus (ADR 016). Fehlerfall `loch`: ein Block Stille über einem Klick in der Schleife."""
    n = 30 * SR
    _, klick = signal(n)
    a = 8 * SR
    ue = a + 512                                   # Übernahme zwei Blöcke nach dem Eingriff
    y = klick.copy()
    for s in range(ue, n, TAKT):                   # Schleife: das Frame einen Takt früher
        y[s:s + TAKT] = y[s - TAKT:s][:n - s]
    aus = ue + 8 * TAKT                            # Ausblende über 2 Takte, danach Stille
    g = np.clip(1.0 - (np.arange(n) - aus) / (2.0 * TAKT), 0.0, 1.0)
    y = np.where(np.arange(n) >= aus, y * g, y)
    if loch:
        e = [int(round(b * SPB)) for b in range(80) if ue + TAKT < round(b * SPB) < aus - TAKT]
        y[e[2] - 50:e[2] + 206] = 0.0
    wavfile.write(o / "aufnahme.wav", SR, np.stack([y, y], axis=1).astype(np.float32))
    (o / "aufnahme.wav.json").write_text(json.dumps({"erster_mono_ns": T0, "erster_jack_frame": 0, "frames": n,
                                                     "luecken": 0, "luecken_bei": [], "ueberlauf": 0, "quantum": 256}))
    t_e = T0 + int(a * 1e9 / SR)
    zeilen = [{"t_ns": t_e - 2_000_000_000, "adresse": "/nb", "typen": "iiih", "werte": [0, 0, 0, 0]},
              {"t_ns": t_e + 8_000_000, "adresse": "/nb", "typen": "iiih", "werte": [1, 0, 0, 0]},
              {"t_ns": t_e + 17_000_000_000, "adresse": "/nb", "typen": "iiih", "werte": [2, 8, 0, 0]}]
    zeilen += [{"t_ns": T0 + k * 50_000_000, "adresse": "/zustand/kern", "typen": "iihiiiiiiii",
                "werte": [0, 256, k * 2400, 3, 3, 40, 20, 90, 0, 0, 0]} for k in range(160)]
    (o / "osc.jsonl").write_text("".join(json.dumps(z) + "\n" for z in zeilen))
    p = profil.pruefe({"name": "synth-kern", "zweck": "Test.", "dauer_s": 30.0,
                       "quelle": {"art": "kern", "argumente": ["--konfig", "{ordner}/kern.toml"]},
                       "eingriff": [{"nach_s": 8.0, "art": "kill9", "ziel": "quelle"}],
                       "erwartung": {"fehlende_klicks_max": 0, "schleife_in_jedem_eingriff": True,
                                     "schleife_abweichung_max": 0, "notbahn_uebernahmen_min": 1,
                                     "kern_luecken_max": 0}})
    fl = {"uptime": "x", "last1": 1.0, "gpu": "0 MiB"}
    lauf = {"profil": p, "senke": "cypherdj-pruef-f-synth-kern", "senke_modul": "1", "fehler": None,
            "eingriffe": [{"art": "kill9", "ziel": "quelle", "pid": 1, "t_ns": t_e}],
            "module_vorher": ["1 a"], "module_nachher": ["1 a"], "units_reste": "",
            "fremdlast_vorher": fl, "fremdlast_nachher": fl}
    (o / "lauf.json").write_text(json.dumps(lauf))


def test_kern_schleife_treu(tmp_path):
    baue_kern_lauf(tmp_path)
    A = auswertung.werte_aus(tmp_path)
    m = A["eingriffe"][0]
    assert m["schleife"]["abweichend"] == 0 and m["schleife"]["stille_frames"] == 0
    assert m["stille"]["fehlende_klicks"] == 0
    assert A["kern"]["frame_luecken"] == 0 and A["kern"]["cb_max_us"] == 40
    assert A["ergebnis"] == "erfuellt", A["urteile"]


def test_kern_fehlerfall_loch_in_der_schleife(tmp_path):
    baue_kern_lauf(tmp_path, loch=True)
    A = auswertung.werte_aus(tmp_path)
    m = A["eingriffe"][0]
    assert m["schleife"]["stille_frames"] > 0 and m["stille"]["fehlende_klicks"] == 1
    verfehlt = {u["schluessel"] for u in A["urteile"] if not u["ok"]}
    assert verfehlt == {"fehlende_klicks_max", "schleife_abweichung_max"}


def test_last_belegt_und_fehlerfall_demucs_lief_nicht():
    gut = {"lastgen_kerne": 10.0, "demucs_kerne": 5.0, "demucs_runden": 3, "lastgen_durchsatz_gib_s": 40.0}
    assert auswertung.last_belegt(gut)
    assert not auswertung.last_belegt(dict(gut, demucs_kerne=0.0, demucs_runden=0))
    assert not auswertung.last_belegt(None)


def test_senke_eigen_nur_mit_genauem_namen(tmp_path):
    baue_lauf(tmp_path)
    L = json.loads((tmp_path / "lauf.json").read_text())
    fremd = "7\tmodule-null-sink\tsink_name=cypherdj-pruef-f-synth2 sink_properties=node.description=cypherdj-pruef-f-synth2"
    L["module_nachher"] = L["module_nachher"] + [fremd]          # andere Session, gleiche Instanz, ähnlicher Name
    (tmp_path / "lauf.json").write_text(json.dumps(L))
    A = auswertung.werte_aus(tmp_path)
    assert A["senke"]["fremde_aenderungen"] == [fremd] and A["senke"]["eigene_aenderungen"] == []
    assert A["ergebnis"] == "erfuellt"
    eigen = "8\tmodule-null-sink\tsink_name=cypherdj-pruef-f-synth sink_properties=node.description=cypherdj-pruef-f-synth"
    L["module_nachher"] = L["module_nachher"] + [eigen]           # eigene Senke nicht entladen: Fehler
    (tmp_path / "lauf.json").write_text(json.dumps(L))
    A = auswertung.werte_aus(tmp_path)
    assert A["senke"]["eigene_aenderungen"] == [eigen] and A["ergebnis"] == "verfehlt"


def baue_daneben_lauf(o, stille_bloecke=1, falsche_schleife=False, aufnehmer_luecke=False):
    """Notbahn daneben wie Scheibe 10 (ADR 016 Nachtrag): kill -9 auf die Prüfquelle bei 6 s ohne Neustart, am Ziel
    `stille_bloecke` Blöcke Stille, dann spielt die Notbahn Durchgänge des letzten VOLLENDETEN Takts am fortgesetzten
    Raster: ziel(f) = quelle(anf - T + (f - anf) mod T), anf = Anfang des laufenden Takts. Fehlerfall `falsche_schleife`:
    die Notbahn spielt immer „einen Takt früher“ (quelle(f - T)), das ist keine Schleife."""
    n = 30 * SR
    ton, klick = signal(n)
    kill = 6 * SR - (6 * SR) % 256                                  # auf einem Blockanfang
    los = kill + 256 * stille_bloecke
    anf = (kill // TAKT) * TAKT
    L, R = ton.copy(), klick.copy()
    L[kill:los] = R[kill:los] = 0.0
    f = np.arange(los, n)
    q = f - TAKT if falsche_schleife else anf - TAKT + (f - anf) % TAKT
    L[los:], R[los:] = ton[q], klick[q]
    aus = anf + 9 * TAKT                                            # Ausblende nach 8 Takten über 2 Takte
    g = np.clip(1.0 - (np.arange(n) - aus) / (2.0 * TAKT), 0.0, 1.0)
    L, R = np.where(np.arange(n) >= aus, L * g, L), np.where(np.arange(n) >= aus, R * g, R)
    wavfile.write(o / "aufnahme.wav", SR, np.stack([L, R], axis=1).astype(np.float32))
    (o / "aufnahme.wav.json").write_text(json.dumps({"erster_mono_ns": T0, "erster_jack_frame": 0, "frames": n,
                                                     "luecken": 1 if aufnehmer_luecke else 0, "luecken_bei": [],
                                                     "ueberlauf": 0, "quantum": 256}))
    t_e = T0 + int(kill * 1e9 / SR)
    nb = [(t_e - 2_000_000_000, 0), (t_e + 11_000_000, 1), (t_e + 17_000_000_000, 2)]
    (o / "osc.jsonl").write_text("".join(json.dumps({"t_ns": t, "adresse": "/nb", "typen": "iiih", "werte": [z, 0, 0, 0]})
                                         + "\n" for t, z in nb))
    (o / "journal-quelle.txt").write_text("pruefquelle start modus ring+master\n")
    p = profil.lade(Path(__file__).resolve().parent.parent / "profile" / "naht-kill.toml")
    fl = {"uptime": "x", "last1": 0.3, "gpu": "0 MiB"}
    lauf = {"profil": p, "senke": "cypherdj-pruef-f-naht-kill", "senke_modul": "1", "fehler": None,
            "notbahn_aufruf": ["nb", "--master", "cypherdj-pruef-f-naht-kill:playback_F", "--daneben", "--kante",
                               "cypherdj-pruefquelle-f:master_L"],
            "eingriffe": [{"art": "kill9", "ziel": "quelle", "pid": 1, "t_ns": t_e}],
            "module_vorher": ["1 a"], "module_nachher": ["1 a"], "units_reste": "",
            "fremdlast_vorher": fl, "fremdlast_nachher": fl}
    (o / "lauf.json").write_text(json.dumps(lauf))


def test_daneben_ein_block_knack_und_treue(tmp_path):
    baue_daneben_lauf(tmp_path)
    A = auswertung.werte_aus(tmp_path)
    m = A["eingriffe"][0]
    assert m["bloecke"]["stille"] == 1 and 5.3 <= m["stille"]["laengste_ms"] <= 5.4
    assert m["spruenge"]["anzahl"] >= 1                           # der Knack an der Übernahme
    assert m["schleife"]["abweichend"] == 0 and m["schleife"]["stille_frames"] == 0 and m["schleife"]["frames"] > 5 * TAKT
    assert A["ergebnis"] == "erfuellt", [u for u in A["urteile"] if not u["ok"]]
    b = bericht.schreibe(tmp_path).read_text()
    assert "höchstens 1 Block in 1 von 1" in b and "alte Grenze" in b


def test_daneben_fehlerfall_zwei_bloecke(tmp_path):
    baue_daneben_lauf(tmp_path, stille_bloecke=2)
    A = auswertung.werte_aus(tmp_path)
    assert A["eingriffe"][0]["bloecke"]["stille"] == 2
    assert {u["schluessel"] for u in A["urteile"] if not u["ok"]} == {"stille_bloecke_max"}


def test_daneben_fehlerfall_keine_schleife(tmp_path):
    baue_daneben_lauf(tmp_path, falsche_schleife=True)
    A = auswertung.werte_aus(tmp_path)
    assert A["eingriffe"][0]["schleife"]["abweichend"] > 0
    assert "schleife_abweichung_max" in {u["schluessel"] for u in A["urteile"] if not u["ok"]}


def test_bericht_mit_aufnehmer_luecke_heisst_unbrauchbar(tmp_path):
    baue_daneben_lauf(tmp_path, aufnehmer_luecke=True)             # sonst erfüllt (Test oben)
    A = auswertung.werte_aus(tmp_path)
    b = bericht.schreibe(tmp_path).read_text()
    assert A["ergebnis"] == "unbrauchbar" and "Ergebnis: **unbrauchbar**" in b and "Ergebnis: **erfuellt**" not in b


def test_spins_im_fenster_und_abweichung(tmp_path):
    baue_lauf(tmp_path)
    L = json.loads((tmp_path / "lauf.json").read_text())
    L["profil"]["erwartung"] = {"spins_min": 2, "spin_luecken_abweichung_max": 1}
    (tmp_path / "lauf.json").write_text(json.dumps(L))
    t = [T0 - 1_000_000_000, T0 + 1_000_000_000, T0 + 2_000_000_000, T0 + 99_000_000_000]   # 2 von 4 im Fenster
    (tmp_path / "journal-quelle.txt").write_text("".join(f"pruefquelle spin {i + 1} t_ns {x}\n" for i, x in enumerate(t)))
    A = auswertung.werte_aus(tmp_path)
    assert A["quelle"]["spins_im_fenster"] == 2 and A["gesamt"]["stille_ereignisse"] == 0
    u = {x["schluessel"]: x for x in A["urteile"]}
    assert u["spins_min"]["ok"] and not u["spin_luecken_abweichung_max"]["ok"] and u["spin_luecken_abweichung_max"]["wert"] == 2


def test_rueckgabe_folge():
    assert auswertung.folge([0, 0, 1, 1, 3, 0, 0]) == [0, 1, 3, 0]
    assert auswertung.enthaelt([0, 1, 3, 0], [1, 3, 0]) and not auswertung.enthaelt([0, 1, 2], [1, 3, 0])
    assert not auswertung.enthaelt([0, 3, 1, 0], [1, 3, 0])


def test_kern_luecken_am_ziel_gegen_zaehler(tmp_path):
    """luecke-kern synthetisch: der Kern lässt 3 Perioden aus (Klicks später), meldet 3 (Fehlerfall zählt), Mutante:
    er meldet 0 -> verfehlt."""
    n = 30 * SR
    _, klick = signal(n)
    y = klick.copy()
    for s in (5 * SR, 12 * SR, 20 * SR):                            # je eine ausgelassene Periode: alles danach 256 später
        y[s + 256:] = y[s:n - 256].copy()
        y[s:s + 256] = 0.0
    def schreibe(meldet):
        wavfile.write(tmp_path / "aufnahme.wav", SR, np.stack([y, y], axis=1).astype(np.float32))
        (tmp_path / "aufnahme.wav.json").write_text(json.dumps({"erster_mono_ns": T0, "frames": n, "luecken": 0,
                                                                "luecken_bei": [], "ueberlauf": 0, "quantum": 256}))
        z = [{"t_ns": T0 + k * 50_000_000, "adresse": "/zustand/kern", "typen": "iihiiiiiiii",
              "werte": [0, 256, k * 2400, 0, min(meldet, k // 100), 40, 20, 90, 0, 0, 0]} for k in range(600)]
        (tmp_path / "osc.jsonl").write_text("".join(json.dumps(x) + "\n" for x in z))
        p = profil.lade(Path(__file__).resolve().parent.parent / "profile" / "luecke-kern.toml")
        p["erwartung"] = {"ziel_luecken_min": 3, "kern_ziel_luecken_abweichung_max": 1}
        fl = {"uptime": "x", "last1": 0.3, "gpu": "0 MiB"}
        (tmp_path / "lauf.json").write_text(json.dumps({"profil": p, "senke": "cypherdj-pruef-f-luecke-kern",
            "senke_modul": "1", "fehler": None, "eingriffe": [], "module_vorher": [], "module_nachher": [],
            "units_reste": "", "fremdlast_vorher": fl, "fremdlast_nachher": fl}))
        return auswertung.werte_aus(tmp_path)
    A = schreibe(3)
    assert A["ruhe"]["ziel_luecken"] == 3 and A["kern"]["ausgelassene_perioden"] == 3 and A["ergebnis"] == "erfuellt"
    A = schreibe(0)
    assert {u["schluessel"] for u in A["urteile"] if not u["ok"]} == {"kern_ziel_luecken_abweichung_max"}


def test_notbahn_journal_rueckgabe():
    txt = ("[ 3503.157049] host pw-jack[1]: zustand 1 w 607744\n[ 3506.163144] host pw-jack[1]: zustand 3 w 751872\n"
           "[ 3506.163144] host pw-jack[1]: zustand 0 w 752128\n[ 3523.18] host pw-jack[1]: {\"zyklen\":6133}\n")
    j = auswertung.notbahn_journal(txt)
    assert j == [(3503157049000, 1), (3506163144000, 3), (3506163144000, 0)]
    f = auswertung.nb_im_fenster([], 3503_000_000_000, 3507_000_000_000, j)
    assert f["folge_journal"] == [1, 3, 0] and auswertung.enthaelt(f["folge_journal"], [1, 3, 0])
    assert auswertung.nb_im_fenster([], 3503_000_000_000, 3504_000_000_000, j)["folge_journal"] == [1]


def test_vorlaeufig_nur_fremde_last(tmp_path):
    baue_daneben_lauf(tmp_path)
    L = json.loads((tmp_path / "lauf.json").read_text())
    L["fremdlast_nachher"]["last1"] = 35.8                         # nach dem Lauf hoch
    (tmp_path / "lauf.json").write_text(json.dumps(L))
    assert auswertung.werte_aus(tmp_path)["vorlaeufig"]            # ohne P1: fremde Last, vorläufig
    L["profil"]["last"]["profil"] = "p1"                          # mit P1 ist das die eigene Last
    (tmp_path / "lauf.json").write_text(json.dumps(L))
    assert not auswertung.werte_aus(tmp_path)["vorlaeufig"]
    L["fremdlast_vorher"]["last1"] = 4.5                          # vorher schon fremde Last: vorläufig
    (tmp_path / "lauf.json").write_text(json.dumps(L))
    assert auswertung.werte_aus(tmp_path)["vorlaeufig"]
