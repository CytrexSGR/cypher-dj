"""Journey tours J0 to J5 (journey tours plan): each class runs one tour module against its own fake page server; no real instance."""
import contextlib
import json
import math
import os
import re
import struct
import sys
import threading
import types
import time
import urllib.parse
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace

import pytest

AUS = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(AUS, ".."))
sys.path.insert(0, os.path.join(AUS, "..", "..", "core", "tests", "restart"))
from tour import j1, musik  # noqa: E402
from tour import j3 as J3MOD  # noqa: E402
from tour import runner as L  # noqa: E402


class TestJ0:
    """J0 bring your own sounds. The fake page keeps the state the tour reads back: sources, a catalogue build, imports, one project."""

    SHA_KICK = "a" * 64

    class Seite:
        def __init__(self, ordner_namen=None):
            self.quellen, self.dateien_im_katalog, self.projekt_rev = [], 0, 0
            self.ruht_nie = False          # the build never reaches `ruht`
            self.ohne_kick = False         # the search finds no kick
            self.pegel_db = -20.0
            self.ordner_namen = ordner_namen
            self.pad = None
            self.kit_ordner = None         # set by the fixture: the pad route writes the new kit there
            self.pad_ohne_klick = False    # the pad route keeps the old starter kick in the new kit
            self.pad_nicht_auf_spur = False
            self.import_500 = False
            self.klick_im_master = True    # the master shows the click while the new kick plays
            self.spur_kit = "starter"
            self.laeuft = False
            self.transport = []
            self.aufrufe = []
            self.eingefuegt = []
            seite = self

            class H(BaseHTTPRequestHandler):
                def log_message(self, *a):
                    pass

                def _senden(self, code, obj):
                    roh = json.dumps(obj).encode()
                    self.send_response(code)
                    self.send_header("content-type", "application/json")
                    self.send_header("content-length", str(len(roh)))
                    self.end_headers()
                    self.wfile.write(roh)

                def _koerper(self):
                    n = int(self.headers.get("content-length") or 0)
                    return self.rfile.read(n)

                def do_GET(self):
                    u = urllib.parse.urlparse(self.path)
                    q = urllib.parse.parse_qs(u.query)
                    k = {x.lower(): v for x, v in self.headers.items()}
                    seite.aufrufe.append(("GET", u.path, k.get("x-djk-quelle")))
                    if u.path == "/lage":
                        return self._senden(200, {"ok": True})
                    if u.path == "/dateisystem/ordner":
                        if k.get("x-djk-quelle") != "andreas":
                            return self._senden(403, {"fehler": "nur_andreas", "text": "owner only"})
                        namen = seite.ordner_namen if seite.ordner_namen is not None else [Path(q["pfad"][0]) / "musik"]
                        return self._senden(200, {"pfad": q["pfad"][0], "eltern": None, "ordner": [{"name": Path(n).name, "pfad": str(n)} for n in namen]})
                    if u.path == "/bibliothek/quellen":
                        return self._senden(200, {"datei": "bibliothek.json", "quellen": [{"pfad": p, "typ": "auto", "fehlt": False} for p in seite.quellen]})
                    if u.path == "/bibliothek/stand":
                        if not seite.quellen:
                            return self._senden(200, {"phase": "ruht", "letzter_bau": None, "leer": True, "katalog": None})
                        if seite.ruht_nie:
                            return self._senden(200, {"phase": "merkmale", "fertig": 1, "gesamt": 5, "letzter_bau": None, "leer": True, "katalog": None})
                        return self._senden(200, {"phase": "ruht", "letzter_bau": {"zeit": "t", "dateien": seite.dateien_im_katalog, "rc": 0}, "leer": False,
                                                  "katalog": {"track": 0, "loop": 1, "oneshot": seite.dateien_im_katalog - 1}})
                    if u.path == "/suche":
                        text = q.get("q", [""])[0].lower()
                        treffer = []
                        if "kick" in text and not seite.ohne_kick:
                            treffer = [{"typ": "oneshot", "sha": TestJ0.SHA_KICK, "titel": "Kick 01", "instrument": "kick"}]
                        if "tom" in text and "Tom 01.wav" in seite.eingefuegt:
                            treffer = [{"typ": "oneshot", "sha": "b" * 64, "titel": "Tom 01", "instrument": "tom"}]
                        return self._senden(200, {"q": text, "gruppen": [{"art": "samples", "name": "Samples", "zahl": len(treffer), "treffer": treffer}], "passt": None})
                    if u.path == "/proj/aktuell":
                        return self._senden(200, {"projekt": {"rev": seite.projekt_rev, "spuren": [{"id": "s1", "geraet": {"art": "intern", "name": "kit", "kit": seite.spur_kit}}]}})
                    if u.path == "/analyse/live":
                        db = [-70.0] * 40
                        if seite.laeuft and seite.pad is not None and seite.klick_im_master:
                            db[20] = -35.0
                        return self._senden(200, {"leer": False, "w": 1, "steht": not seite.laeuft, "spektrum": {"hz": [2000.0 + 50 * i for i in range(40)], "db": db}})
                    if u.path == "/pegel":
                        return self._senden(200, {"sek": 1, "kanaele": {"master": {"n": 20, "max_db": seite.pegel_db, "median_db": seite.pegel_db}}})
                    self._senden(404, {"fehler": "keine_route"})

                def do_POST(self):
                    u = urllib.parse.urlparse(self.path)
                    q = urllib.parse.parse_qs(u.query)
                    roh = self._koerper()
                    k = {x.lower(): v for x, v in self.headers.items()}
                    seite.aufrufe.append(("POST", u.path, k.get("x-djk-quelle")))
                    try:
                        d = json.loads(roh) if roh and u.path != "/import/datei" else {}
                    except ValueError:
                        d = {}
                    if u.path == "/bibliothek/quellen/dazu":
                        seite.quellen.append(d["pfad"])
                        seite.dateien_im_katalog = 5
                        return self._senden(200, {"ok": True})
                    if u.path == "/import/datei":
                        if k.get("x-djk-quelle") != "andreas":
                            return self._senden(403, {"fehler": "nur_andreas", "text": "owner only"})
                        if seite.import_500:
                            return self._senden(500, {"fehler": "kaputt"})
                        seite.eingefuegt.append(q["name"][0])
                        seite.dateien_im_katalog += 1
                        return self._senden(200, {"ok": True, "pfad": "/x/" + q["name"][0], "art": "audio", "sha256": "c" * 64})
                    if u.path == "/proj/neu":
                        seite.projekt_rev = 0
                        return self._senden(200, {"slug": d.get("name"), "projekt": {"rev": 0}})
                    if u.path == "/proj/aendern":
                        if d.get("rev") != seite.projekt_rev:
                            return self._senden(409, {"fehler": "rev_veraltet", "text": "stale"})
                        seite.projekt_rev += 1
                        return self._senden(200, {"rev": seite.projekt_rev, "projekt": {"rev": seite.projekt_rev, "spuren": [{"id": "s1"}]}})
                    if u.path == "/sampler/datei/pad":
                        seite.pad = d
                        seite.schreibe_kit(d)
                        if not seite.pad_nicht_auf_spur:
                            seite.spur_kit = "starter-2"
                        return self._senden(200, {"rev": seite.projekt_rev + 1, "kit": "starter-2", "ton": d["ton"], "name": "bd:0", "text": "Kick 01.wav is now bd:0"})
                    if u.path == "/proj/transport":
                        seite.transport.append(d.get("aktion"))
                        seite.laeuft = d.get("aktion") == "start"
                        return self._senden(200, {"ok": True, "quittung": {"status": 2, "grund": ""}})
                    self._senden(404, {"fehler": "keine_route"})

            self.server = ThreadingHTTPServer(("127.0.0.1", 0), H)
            self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
            threading.Thread(target=self.server.serve_forever, daemon=True).start()

        def schreibe_kit(self, d):
            """What /sampler/datei/pad does: a copy of the starter kit whose pad 36 is the decoded file Kick 01.wav of the music folder."""
            import shutil
            import wave
            alt, neu = Path(self.kit_ordner) / "starter", Path(self.kit_ordner) / "starter-2"
            shutil.copytree(alt, neu)
            if not self.pad_ohne_klick:
                with wave.open(str(Path(self.quellen[0]) / "Kick 01.wav")) as w:
                    pcm = struct.unpack(f"<{w.getnframes() * 2}h", w.readframes(w.getnframes()))
                (neu / "36.f32").write_bytes(struct.pack(f"<{len(pcm)}f", *[x / 32767 for x in pcm]))
            info = json.loads((neu / "kit.json").read_text())
            for k in info["klaenge"]:
                if k["note"] == d["ton"]:
                    k["quelle"] = f"datei:{d['sha']}"
            (neu / "kit.json").write_text(json.dumps(info))

        def ende(self):
            self.server.shutdown()
            self.server.server_close()

    class Attrappe:
        def __init__(self, url, kit_ordner):
            self.url, self.kern_port, self.buchstabe = url, 0, "d"
            self.env = {"CYPHERDJ_KIT_ORDNER": str(kit_ordner)}

    @staticmethod
    def kit_anlegen(ordner):
        """A starter kit like the one the kits stage writes: kit.json plus stereo float32 pads at 48 kHz."""
        k = Path(ordner) / "starter"
        k.mkdir(parents=True)
        klaenge = []
        for note, name in ((36, "bd:0"), (38, "sd:0"), (39, "cp:0"), (41, "lt:0"), (42, "hh:0")):
            frames = 2400
            (k / f"{note}.f32").write_bytes(struct.pack(f"<{frames * 2}f", *([0.0] + [0.5 * (1 - i / frames) * (1 if i % 2 else -1) for i in range(frames * 2 - 1)])))
            klaenge.append({"note": note, "name": name, "datei": f"{note}.f32", "frames": frames})
        (k / "kit.json").write_text(json.dumps({"schema": 1, "name": "starter", "klaenge": klaenge}))

    @pytest.fixture
    def j0(self, tmp_path, monkeypatch):
        from tour import j0 as modul
        monkeypatch.setattr(modul, "KATALOG_FRIST_S", 1.5)
        monkeypatch.setattr(modul, "IMPORT_FRIST_S", 1.5)
        monkeypatch.setattr(modul, "LOOP_SEK", 3)
        self.kit_anlegen(tmp_path / "kits")
        seite = TestJ0.Seite()
        seite.kit_ordner = str(tmp_path / "kits")
        t = L.Tour("j0", TestJ0.Attrappe(seite.url, tmp_path / "kits"), tmp_path / "aus", kurz=True)
        yield modul, seite, t
        seite.ende()

    def test_the_steps_run_in_the_order_the_stranger_goes(self, j0):
        modul, seite, t = j0
        assert modul.STUFEN == ["graphen", "kits"]
        rc = t.fuehre(modul.schritte)
        b = t.bericht()
        assert [s["kennung"] for s in b.schritte] == ["j0.ordner", "j0.quelle", "j0.katalog", "j0.import", "j0.finden", "j0.benutzen", "j0.vorher",
                                                      "j0.pad", "j0.hoeren"]
        assert [s["urteil"] for s in b.schritte] == ["OK"] * 9, b.markdown()
        assert rc == 0

    def test_the_music_folder_is_filled_with_named_like_a_stranger_files(self, j0, tmp_path):
        modul, seite, t = j0
        t.fuehre(modul.schritte)
        musik = tmp_path / "aus" / "musik"
        namen = sorted(p.name for p in musik.iterdir())
        assert namen == ["Clap 01.wav", "Hat 01.wav", "Kick 01.wav", "Loop 120 bpm.wav", "Snare 01.wav"]
        assert seite.quellen == [str(musik)]

    def test_the_music_folder_is_emptied_at_the_start(self, j0, tmp_path):
        modul, seite, t = j0
        musik = tmp_path / "aus" / "musik"
        musik.mkdir(parents=True)
        (musik / "alt.wav").write_bytes(b"x")
        t.fuehre(modul.schritte)
        assert not (musik / "alt.wav").exists()

    def test_the_import_goes_up_as_the_owner_and_lands_in_the_catalogue(self, j0):
        modul, seite, t = j0
        t.fuehre(modul.schritte)
        assert seite.eingefuegt == ["Tom 01.wav"]
        assert ("POST", "/import/datei", "andreas") in seite.aufrufe
        assert ("GET", "/dateisystem/ordner", "andreas") in seite.aufrufe

    def test_the_kick_goes_on_a_pad_and_is_triggered_then_stopped(self, j0):
        modul, seite, t = j0
        t.fuehre(modul.schritte)
        assert seite.pad == {"spur_id": "s1", "ton": 36, "sha": TestJ0.SHA_KICK}
        assert seite.transport == ["start", "stopp", "start", "stopp"], "once with the starter kit, once with the new pad"

    def test_a_catalogue_that_never_rests_makes_katalog_red_at_the_deadline(self, j0):
        modul, seite, t = j0
        seite.ruht_nie = True
        t.fuehre(modul.schritte)
        s = {x["kennung"]: x for x in t.bericht().schritte}
        assert s["j0.katalog"]["urteil"] == "FEHL"
        assert "ruht" in s["j0.katalog"]["grund"] or "rest" in s["j0.katalog"]["grund"]
        assert s["j0.ordner"]["urteil"] == "OK" and s["j0.quelle"]["urteil"] == "OK"
        assert t.bericht().exitcode() == 1

    def test_a_search_without_the_kick_makes_finden_red_and_the_pad_step_does_not_guess(self, j0):
        modul, seite, t = j0
        seite.ohne_kick = True
        t.fuehre(modul.schritte)
        s = {x["kennung"]: x for x in t.bericht().schritte}
        assert s["j0.finden"]["urteil"] == "FEHL"
        assert s["j0.benutzen"]["urteil"] == "SKIP" and s["j0.pad"]["urteil"] == "SKIP" and s["j0.hoeren"]["urteil"] == "SKIP"
        assert seite.pad is None
        assert t.bericht().exitcode() == 1

    def test_the_kick_of_the_folder_carries_a_click_the_starter_kick_does_not(self, j0, tmp_path):
        modul, seite, t = j0
        t.fuehre(modul.schritte)
        s = {x["kennung"]: x for x in t.bericht().schritte}
        w = s["j0.pad"]["werte"]
        assert w["klick_band_neu_db"] >= w["klick_band_alt_db"] + modul.KLICK_MINDESTABSTAND_DB
        assert w["klang_quelle"] == f"datei:{TestJ0.SHA_KICK}"
        h = s["j0.hoeren"]["werte"]
        assert h["klick_band_nachher_db"] >= s["j0.vorher"]["werte"]["klick_band_vorher_db"] + modul.KLICK_MINDESTABSTAND_DB

    def test_a_500_on_the_import_is_red_and_the_later_steps_still_report_themselves(self, j0):
        modul, seite, t = j0
        seite.import_500 = True
        t.fuehre(modul.schritte)
        b = t.bericht()
        s = {x["kennung"]: x for x in b.schritte}
        assert s["j0.import"]["urteil"] == "FEHL" and s["j0.import"]["code"] == 500
        assert [x["kennung"] for x in b.schritte][-1] == "j0.hoeren", "no step is dropped"
        assert s["j0.hoeren"]["urteil"] == "OK" and b.exitcode() == 1

    def test_a_pad_that_is_not_on_the_track_is_red_and_the_listening_is_skipped(self, j0):
        modul, seite, t = j0
        seite.pad_nicht_auf_spur = True
        t.fuehre(modul.schritte)
        s = {x["kennung"]: x for x in t.bericht().schritte}
        assert s["j0.pad"]["urteil"] == "FEHL" and "pad is not on the track" in (s["j0.pad"]["grund"] or "")
        assert s["j0.hoeren"]["urteil"] == "SKIP"

    def test_a_kit_without_the_click_is_red_even_though_the_route_answered_200(self, j0):
        modul, seite, t = j0
        seite.pad_ohne_klick = True
        t.fuehre(modul.schritte)
        s = {x["kennung"]: x for x in t.bericht().schritte}
        assert s["j0.pad"]["urteil"] == "FEHL" and "no click" in (s["j0.pad"]["grund"] or "")

    def test_a_master_without_the_click_while_playing_is_red_although_level_and_kit_are_fine(self, j0):
        modul, seite, t = j0
        seite.klick_im_master = False
        t.fuehre(modul.schritte)
        s = {x["kennung"]: x for x in t.bericht().schritte}
        assert s["j0.pad"]["urteil"] == "OK" and s["j0.hoeren"]["urteil"] == "FEHL"
        assert "click is not in the master" in (s["j0.hoeren"]["grund"] or "")

    @pytest.mark.parametrize("db,urteil", [(-90.0, "FEHL"), (0.5, "FEHL"), (-18.0, "OK")])
    def test_hoeren_is_red_when_silent_or_clipping(self, j0, db, urteil):
        modul, seite, t = j0
        seite.pegel_db = db
        t.fuehre(modul.schritte)
        s = {x["kennung"]: x for x in t.bericht().schritte}
        assert s["j0.hoeren"]["urteil"] == urteil
        assert seite.transport[-1] == "stopp", "the transport is stopped even when the level is wrong"

    def test_a_missing_kit_folder_is_a_red_step_not_a_crash(self, tmp_path, monkeypatch):
        from tour import j0 as modul
        seite = TestJ0.Seite()
        try:
            t = L.Tour("j0", TestJ0.Attrappe(seite.url, tmp_path / "gibt-es-nicht"), tmp_path / "aus", kurz=True)
            rc = t.fuehre(modul.schritte)
            assert rc == 1
            assert t.bericht().schritte[0]["kennung"] == "j0.ordner" and t.bericht().schritte[0]["urteil"] == "FEHL"
        finally:
            seite.ende()


class J4Instanz:
    def __init__(self, url):
        self.url, self.kern_port, self.env, self.buchstabe = url, 0, {}, "f"


class J4Seite:
    """Fake page server for J4: graph load, regler, a project with instrument tracks, export (a sine whose pitch follows knob k10), presets.

    Faults: ohne_id (the save answers without herkunft/geraet/slug), nicht_in_liste (the preset list never shows it),
    stumm_preset (the apply plan changes nothing, so the preset does not sound), schreibt_nichts (the save answers ok with a
    full id but stores nothing), alt (an older preset of the same base name is already stored).
    """

    def __init__(self, ordner, fehler=()):
        self.ordner, self.fehler = ordner, set(fehler)
        self.geladen, self.regler, self.presets, self.exporte = {}, [], {}, 0
        self.projekt = None
        if "alt" in self.fehler:
            self.presets[("baukasten", "j4-tour-1")] = {"graph": "bass-banddrive", "parameter": {"k10": 0.15, "k11": 0.8}}
        seite = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _senden(self, code, obj):
                roh = json.dumps(obj).encode()
                self.send_response(code)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(roh)))
                self.end_headers()
                self.wfile.write(roh)

            def do_GET(self):
                self._senden(*seite.get(self.path))

            def do_POST(self):
                n = int(self.headers.get("content-length") or 0)
                d = json.loads(self.rfile.read(n) or b"{}")
                self._senden(*seite.post(self.path, d))

        self.srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.url = f"http://127.0.0.1:{self.srv.server_address[1]}"
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()

    def ende(self):
        self.srv.shutdown()
        self.srv.server_close()

    def get(self, pfad):
        if pfad.startswith("/graphen"):
            return 200, {"graphen": [{"name": "bass-banddrive", "art": "instrument", "regler_namen": {"10": "Cutoff", "11": "Resonance"}}],
                         "geladen": self.geladen}
        if pfad.startswith("/proj/aktuell?nur=rev"):
            return 200, {"slug": self.projekt["slug"], "rev": self.projekt["rev"]}
        if pfad.startswith("/proj/aktuell"):
            return 200, {"slug": self.projekt["slug"], "projekt": self.projekt}
        m = re.match(r"/presets/nutzer/([^/]+)/(.+)$", pfad)
        if m and (m[1], m[2]) in self.presets:
            p = self.presets[(m[1], m[2])]
            return 200, {"graph": p["graph"], "werte": {"knob" + k[1:]: v for k, v in p["parameter"].items()}}
        return 404, {"fehler": "keine_route"}

    def post(self, pfad, d):
        pfad = pfad.split("?")[0]
        if pfad == "/live/oeffnen":
            return 200, {"slug": "live"}
        if pfad == "/graph":
            self.geladen[d["kanal"]] = d["name"]
            return 200, {"ok": True, "kanal": d["kanal"], "name": d["name"], "quittung": {"status": 3, "grund": ""}}
        if pfad == "/regler":
            self.regler.append((d["pfad"], d["nach"]))
            return 200, {"ok": True, "quittung": {"status": 2, "grund": ""}}
        if pfad == "/proj/neu":
            self.projekt = {"slug": d["name"], "rev": 0, "tempo_bpm": 480, "spuren": []}   # 480 BPM: four bars last two seconds
            return 200, {"slug": d["name"], "rev": 0}
        if pfad == "/proj/aendern":
            if d["rev"] != self.projekt["rev"]:
                return 409, {"fehler": "veraltet"}
            for b in d["befehle"]:
                if b["befehl"] == "spur_neu":
                    self.projekt["spuren"].append({"id": f"s{len(self.projekt['spuren']) + 1}", "geraet": b["geraet"], "clips": []})
                elif b["befehl"] == "spur_aendern":
                    next(s for s in self.projekt["spuren"] if s["id"] == b["spur_id"])["geraet"] = b["geraet"]
                elif b["befehl"] == "clip_neu":
                    next(s for s in self.projekt["spuren"] if s["id"] == b["spur_id"])["clips"].append(b)
            self.projekt["rev"] += 1
            return 200, {"rev": self.projekt["rev"]}
        if pfad == "/proj/export":
            return self.export(d)
        if pfad == "/presets/von_ziel":
            spur = next(s for s in self.projekt["spuren"] if s["id"] == d["ziel"]["spur_id"])
            slug = re.sub(r"[^a-z0-9]+", "-", d["name"].lower()).strip("-")
            if ("baukasten", slug) in self.presets and not d.get("ueberschreiben"):
                return 409, {"fehler": "name_vergeben"}
            if "schreibt_nichts" not in self.fehler:
                self.presets[("baukasten", slug)] = {"graph": spur["geraet"]["graph"], "parameter": dict(spur["geraet"]["parameter"])}
            if "ohne_id" in self.fehler:
                return 200, {"ok": True}
            return 200, {"herkunft": "nutzer", "geraet": "baukasten", "slug": slug, "geaendert": "now"}
        if pfad == "/presets/suche":
            if "nicht_in_liste" in self.fehler:
                return 200, {"gesamt": 0, "treffer": []}
            t = [{"id": f"nutzer:{g}/{s}"} for (g, s) in self.presets]
            return 200, {"gesamt": len(t), "treffer": t}
        m = re.match(r"/presets/nutzer/([^/]+)/([^/]+)/loeschen$", pfad)
        if m:
            self.presets.pop((m[1], m[2]), None)
            return 200, {"ok": True}
        if pfad == "/presets/anwenden":
            m = re.match(r"nutzer:([^/]+)/(.+)$", d["id"])
            p = self.presets[(m[1], m[2])]
            if "stumm_preset" in self.fehler:
                return 200, {"weg": "proj", "label": "Preset", "befehle": [
                    {"befehl": "spur_aendern", "spur_id": d["ziel"]["spur_id"], "geraet": {"art": "intern", "name": "bk", "graph": p["graph"], "parameter": {}}}]}
            return 200, {"weg": "proj", "label": "Preset", "befehle": [
                {"befehl": "spur_aendern", "spur_id": d["ziel"]["spur_id"], "geraet": {"art": "intern", "name": "bk", "graph": p["graph"], "parameter": p["parameter"]}}]}
        return 404, {"fehler": "keine_route"}

    def export(self, d):
        import numpy as np
        self.exporte += 1
        cut = self.projekt["spuren"][-1]["geraet"]["parameter"].get("k10", 0.5)
        sek = (d["bis_beat"] - d["von_beat"]) * 60.0 / self.projekt["tempo_bpm"]
        x = np.arange(int(sek * 48000)) / 48000.0
        s = (0.3 * np.sin(2 * np.pi * (200 + 2400 * cut) * x) * 32767).astype("<i2")
        datei = os.path.join(self.ordner, f"export{self.exporte}.wav")
        with wave.open(datei, "wb") as w:
            w.setnchannels(2)
            w.setsampwidth(2)
            w.setframerate(48000)
            w.writeframes(np.repeat(s, 2).tobytes())
        return 200, {"datei": datei, "frames": len(x), "spitze_db": -10.5, "ueber_decke": False}


def j4_lauf(tmp_path, fehler=()):
    from tour import j4
    seite = J4Seite(str(tmp_path), fehler)
    try:
        t = L.Tour("j4", J4Instanz(seite.url), tmp_path / "aus", kurz=True)
        t.fuehre(j4.schritte)
        return {s["kennung"]: s for s in t.bericht().schritte}, seite, t
    finally:
        seite.ende()


class TestJ4:
    def test_green_path_runs_every_step_in_order(self, tmp_path):
        s, seite, t = j4_lauf(tmp_path)
        assert list(s) == ["j4.oeffnen", "j4.aendern", "j4.hoeren", "j4.speichern", "j4.wieder", "j4.in_j3", "j4.aufraeumen", "j4.knoten"]
        assert {k: v["urteil"] for k, v in s.items()} == {**{k: "OK" for k in list(s)[:-1]}, "j4.knoten": "SKIP"}
        assert s["j4.knoten"]["grund"] == "graph editor gesture: owner session J4"
        assert s["j4.knoten"]["werte"]["sitzung"] == "J4"
        assert t.bericht().exitcode() == 0

    def test_two_knobs_go_through_regler_on_the_stream_channel(self, tmp_path):
        s, seite, t = j4_lauf(tmp_path)
        assert seite.geladen == {"erz/2": "bass-banddrive"}
        assert [p for p, _ in seite.regler] == ["erz/2/bk/10", "erz/2/bk/11"]

    def test_the_saved_preset_comes_back_with_a_nutzer_id_and_sounds_in_the_export(self, tmp_path):
        s, seite, t = j4_lauf(tmp_path)
        assert re.fullmatch(r"nutzer:baukasten/j4-tour-\d+", s["j4.speichern"]["werte"]["id"])
        assert s["j4.wieder"]["werte"]["in_liste"] is True
        w = s["j4.in_j3"]["werte"]
        assert w["frisch_schwerpunkt_hz"] > 2 * w["preset_schwerpunkt_hz"] > 0

    def test_a_save_without_an_id_is_red(self, tmp_path):
        s, _, t = j4_lauf(tmp_path, ["ohne_id"])
        assert s["j4.speichern"]["urteil"] == "FEHL"
        assert "without an id" in s["j4.speichern"]["grund"]
        assert t.bericht().exitcode() == 1
        assert s["j4.wieder"]["urteil"] == "SKIP" and s["j4.in_j3"]["urteil"] == "SKIP"

    def test_a_preset_list_without_the_saved_id_makes_wieder_red(self, tmp_path):
        s, _, t = j4_lauf(tmp_path, ["nicht_in_liste"])
        assert s["j4.speichern"]["urteil"] == "OK"
        assert s["j4.wieder"]["urteil"] == "FEHL"
        assert "is not in the preset list" in s["j4.wieder"]["grund"]
        assert t.bericht().exitcode() == 1

    def test_a_preset_that_does_not_change_the_sound_is_red(self, tmp_path):
        s, _, t = j4_lauf(tmp_path, ["stumm_preset"])
        assert s["j4.in_j3"]["urteil"] == "FEHL"
        assert "does not sound" in s["j4.in_j3"]["grund"]

    def test_the_tour_deletes_its_preset_at_the_end(self, tmp_path):
        s, seite, t = j4_lauf(tmp_path)
        assert s["j4.aufraeumen"]["urteil"] == "OK" and s["j4.aufraeumen"]["werte"]["noch_da"] is False
        assert seite.presets == {}

    def test_a_save_that_writes_nothing_is_red_even_with_an_older_preset_of_the_same_base_name(self, tmp_path):
        s, seite, t = j4_lauf(tmp_path, ["schreibt_nichts", "alt"])
        assert s["j4.speichern"]["urteil"] == "OK"
        assert s["j4.wieder"]["urteil"] == "FEHL"
        assert "is not in the preset list" in s["j4.wieder"]["grund"]
        assert t.bericht().exitcode() == 1

    def test_a_preset_of_the_run_name_that_already_exists_is_red_before_the_save(self, tmp_path, monkeypatch):
        from tour import j4
        monkeypatch.setattr(j4.time, "time", lambda: 4242)
        seite = J4Seite(str(tmp_path), [])
        seite.presets[("baukasten", "j4-tour-4242")] = {"graph": "bass-banddrive", "parameter": {}}
        try:
            t = L.Tour("j4", J4Instanz(seite.url), tmp_path / "aus", kurz=True)
            t.fuehre(j4.schritte)
            r = {x["kennung"]: x for x in t.bericht().schritte}
        finally:
            seite.ende()
        assert r["j4.speichern"]["urteil"] == "FEHL" and "exists before the save" in r["j4.speichern"]["grund"]
        assert r["j4.wieder"]["urteil"] == "SKIP"
        assert t.bericht().exitcode() == 1


class J3Seite:
    """Fake page: only GET /pegel with a settable master level."""

    def __init__(self, db=-30.0):
        self.db = db
        seite = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_GET(self):
                roh = json.dumps({"sek": 1, "kanaele": {"master": {"n": 20, "max_db": seite.db, "median_db": seite.db}}}).encode()
                self.send_response(200 if self.path.startswith("/pegel") else 404)
                self.send_header("content-length", str(len(roh)))
                self.end_headers()
                self.wfile.write(roh)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def ende(self):
        self.server.shutdown()
        self.server.server_close()


class J3Instanz:
    def __init__(self, url):
        self.url, self.kern_port, self.env, self.buchstabe = url, 0, {}, "e"


def j3_wav(pfad, sek=16.0, amp=0.3, ton_sek=None):
    """A 48 kHz stereo 16 bit file with a sine; amp 1.0 reaches full scale (clipping); ton_sek: the sine ends there, silence follows."""
    import numpy as np
    x = (np.sin(np.arange(int(48000 * sek)) * 0.05) * min(1.0, amp) * 32767).astype("<i2")
    if ton_sek is not None:
        x[int(48000 * ton_sek):] = 0
    with wave.open(str(pfad), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(48000)
        w.writeframes(np.repeat(x, 2).tobytes())


class J3Hand:
    """Fake hand server: canned answers per tool (a callable answers from the arguments), every call is logged."""

    def __init__(self, export, wirt_laeuft=True, export_ohne=None, fehl=(), export_warp=None):
        self.aufrufe = []
        self.export = export
        self.export_ohne = export_ohne       # answer of an export before the warp is set (default: the same as after)
        self.fehl = set(fehl)
        self.warp_gesetzt = False
        self.export_warp = export_warp       # answer of the first export after the warp (the proof); later exports answer `export`
        self.nach_warp = 0
        self.wirt = wirt_laeuft
        self.ende_gerufen = False

    def lage(self):
        surge = [{"id": "s3", "art": "instrument", "geraet": {"art": "wirt", "name": "surge", "slot": 1}, "clips": []}] if self.wirt else []
        return {"slug": "tour-j3", "projekt": {"tempo_bpm": 120, "spuren": surge + [
            {"id": "s1", "art": "instrument", "geraet": {"art": "intern", "name": "rb338", "preset": "werk:rb338/classic-acid"},
             "clips": [{"id": "c1", "art": "midi", "start_beat": 0, "laenge_beats": 32, "noten_zahl": 4}]},
            {"id": "s2", "art": "audio", "fader_db": -3, "sends": [{"id": "r1", "db": -6}],
             "clips": [{"id": "c2", "art": "audio", "start_beat": 0, "laenge_beats": 32}]}],
            "returns": [{"id": "r1", "name": "Delay"}]},
            "wirte": {"1": {"laeuft": self.wirt, "fehler": []}, "2": {"laeuft": False, "fehler": []}}, "_fehler": False}

    def rufe(self, name, argumente=None, timeout=120):
        self.aufrufe.append((name, argumente or {}))
        if name in self.fehl:
            return {"fehler": "kaputt", "text": f"{name} failed", "_fehler": True}
        if name == "proj_aendern" and any(b.get("befehl") == "warp_setzen" for b in (argumente or {}).get("befehle", [])):
            self.warp_gesetzt = True
        antworten = {
            "proj_neu": {"slug": "tour-j3", "rev": 0, "spuren": []},
            "proj_midi_import": {"rev": 1, "angelegt": [{"spur_id": "s1", "clip_id": "c1"}], "bericht": {"datei": {"noten": 4, "laenge_beats": 32}}},
            "presets_suchen": {"gesamt": 1, "treffer": [{"id": "werk:rb338/classic-acid"}]},
            "presets_anwenden": {"ok": True, "rev": 2},
            "proj_bounce": {"art": "neue_spur", "rev": 3, "spur_id": "s2", "clip_id": "c2", "frames": 768000, "quellen": ["s1"]},
            "proj_aendern": {"rev": 4, "noten_zahl": {}},
            "proj_warp": {"clip_id": "c2", "warp": {"tempo": {"mittel_bpm": 105, "min_bpm": 105, "max_bpm": 105}}},
            "proj_transport": {"ok": True},
            "proj_version_sichern": {"ok": True, "id": "2026T--tour-j3 mix"},
            "proj_versionen": {"versionen": [{"id": "2026T--tour-j3 mix", "name": "tour-j3 mix", "auto": False}]},
        }
        if name == "proj_lage":
            return self.lage()
        if name == "proj_export":
            if self.warp_gesetzt:
                self.nach_warp += 1
                if self.nach_warp == 1 and self.export_warp is not None:
                    return dict(self.export_warp)
                return dict(self.export)
            return dict(self.export if self.export_ohne is None else self.export_ohne)
        return {**antworten.get(name, {"fehler": "unbekanntes_werkzeug"}), "_fehler": name not in antworten}

    def ende(self):
        self.ende_gerufen = True


class TestJ3:
    @pytest.fixture
    def seite(self):
        s = J3Seite()
        yield s
        s.ende()

    def lauf(self, seite, tmp_path, export, wirt_laeuft=True, **hand_kw):
        hand = J3Hand(export, wirt_laeuft, **hand_kw)
        t = L.Tour("j3", J3Instanz(seite.url), tmp_path / "aus", kurz=True)
        rc = t.fuehre(lambda tt: J3MOD.schritte(tt, hand=hand))
        return rc, {s["kennung"]: s for s in t.bericht().schritte}, hand

    def gut(self, tmp_path, **kw):
        """The export after the warp: the warped clip ends two seconds early (sound for 14 of 16 s)."""
        w = tmp_path / "export.wav"
        j3_wav(w, ton_sek=14.0)
        return {"datei": str(w), "frames": 768000, "spitze_db": -12.0, "ueber_decke": False, "limiter_db_max": 0, **kw}

    def ohne(self, tmp_path):
        """The export before the warp: sound to the very end."""
        w = tmp_path / "ohne.wav"
        j3_wav(w)
        return {"datei": str(w), "frames": 768000, "spitze_db": -12.0, "ueber_decke": False, "limiter_db_max": 0}

    def lauf_gut(self, seite, tmp_path, **kw):
        return self.lauf(seite, tmp_path, self.gut(tmp_path, **kw), export_ohne=self.ohne(tmp_path))

    def test_steps_in_order_and_all_green(self, seite, tmp_path):
        rc, s, hand = self.lauf_gut(seite, tmp_path)
        assert [k for k in s if k.startswith("j3.")] == [
            "j3.neu", "j3.midi", "j3.midi_live", "j3.instrument", "j3.surge", "j3.audio", "j3.eingang", "j3.warp", "j3.mix",
            "j3.version", "j3.export", "j3.datei"]
        assert {k: v["urteil"] for k, v in s.items() if v["urteil"] == "FEHL"} == {}
        assert s["j3.export"]["urteil"] == "OK" and s["j3.datei"]["urteil"] == "OK"
        assert rc == 0 or rc == 77

    def test_live_midi_and_audio_input_are_named_skips_of_the_owner_session(self, seite, tmp_path):
        rc, s, _ = self.lauf_gut(seite, tmp_path)
        for k in ("j3.midi_live", "j3.eingang"):
            assert s[k]["urteil"] == "SKIP" and s[k]["werte"]["sitzung"] == "J3" and s[k]["grund"]
        assert s["j3.midi_live"]["werte"]["ursache"] == "sonst"

    def test_export_over_ceiling_is_red(self, seite, tmp_path):
        rc, s, _ = self.lauf_gut(seite, tmp_path, ueber_decke=True)
        assert s["j3.export"]["urteil"] == "FEHL" and "ueber_decke" in s["j3.export"]["grund"]
        assert rc == 1

    def test_export_luecke_is_red_with_that_reason(self, seite, tmp_path):
        rc, s, _ = self.lauf(seite, tmp_path, {"fehler": "export_luecke", "text": "the render had a gap", "_fehler": True})
        assert s["j3.export"]["urteil"] == "FEHL" and s["j3.export"]["grund"] == "export_luecke"
        assert s["j3.datei"]["urteil"] != "OK"      # no file, so the file step cannot be green
        assert rc == 1

    def test_missing_surge_host_is_a_skip_not_a_failure(self, seite, tmp_path):
        rc, s, hand = self.lauf(seite, tmp_path, self.gut(tmp_path), wirt_laeuft=False, export_ohne=self.ohne(tmp_path))
        assert s["j3.surge"]["urteil"] == "SKIP" and s["j3.surge"]["werte"]["ursache"] == "abhaengigkeit" and s["j3.surge"]["werte"]["sitzung"] == "J3"
        assert [k for k, v in s.items() if v["urteil"] == "FEHL"] == []
        assert rc == 77
        assert not any(n == "proj_aendern" and any(b.get("befehl") == "spur_neu" and b.get("geraet", {}).get("name") == "surge" for b in a["befehle"])
                       for n, a in hand.aufrufe)

    def test_short_or_clipping_file_is_red(self, seite, tmp_path):
        w = tmp_path / "kurz.wav"
        j3_wav(w, sek=2.0, amp=1.0)
        rc, s, _ = self.lauf(seite, tmp_path, {"datei": str(w), "frames": 96000, "spitze_db": 0.0, "ueber_decke": False})
        assert s["j3.datei"]["urteil"] == "FEHL" and "zu_kurz" in s["j3.datei"]["grund"]

    def test_transport_is_always_stopped_even_when_the_mix_goes_red(self, seite, tmp_path):
        seite.db = -200.0      # silent master: the mix step is red, the transport still has to be stopped
        rc, s, hand = self.lauf_gut(seite, tmp_path)
        assert s["j3.mix"]["urteil"] == "FEHL"
        starts = [a for n, a in hand.aufrufe if n == "proj_transport" and a.get("aktion") == "start"]
        stopps = [a for n, a in hand.aufrufe if n == "proj_transport" and a.get("aktion") == "stopp"]
        assert len(starts) == 1 and len(stopps) >= 1

    # ---- fix round: silence, level, warp, failed calls

    @pytest.mark.parametrize("wav,grund", [
        (dict(amp=0.0), "stumm"),                              # digital silence
        (dict(amp=0.0004), "stumm"),                           # -68 dBFS
        (dict(sek=16.0, ton_sek=3.0), "ueberwiegend_stumm"),   # 3 s of sound, then 13 s of silence
    ])
    def test_a_silent_export_is_red(self, seite, tmp_path, wav, grund):
        w = tmp_path / "stumm.wav"
        j3_wav(w, **wav)
        export = {"datei": str(w), "frames": 768000, "spitze_db": -12.0, "ueber_decke": False, "limiter_db_max": 0}
        rc, s, _ = self.lauf(seite, tmp_path, export, export_ohne=self.ohne(tmp_path))
        assert s["j3.datei"]["urteil"] == "FEHL" and grund in s["j3.datei"]["grund"]
        assert rc == 1

    def test_levels_are_in_the_report_and_a_fair_export_is_green(self, seite, tmp_path):
        rc, s, _ = self.lauf_gut(seite, tmp_path)
        w = s["j3.datei"]["werte"]
        assert s["j3.datei"]["urteil"] == "OK"
        assert w["live_max_db"] == -30.0 and isinstance(w["datei_spitze_db"], float) and w["export_spitze_db"] == -12.0
        assert s["j3.mix"]["werte"]["max_db"] == -30.0

    def test_export_more_than_6_db_below_the_live_level_is_red(self, seite, tmp_path):
        w = tmp_path / "leise.wav"
        j3_wav(w, amp=0.005)                                  # about -46 dBFS against -30 dB live: 16 dB below
        export = {"datei": str(w), "frames": 768000, "spitze_db": -46.0, "ueber_decke": False, "limiter_db_max": 0}
        rc, s, _ = self.lauf(seite, tmp_path, export, export_ohne=self.ohne(tmp_path))
        assert s["j3.datei"]["urteil"] == "FEHL" and "export_zu_leise" in s["j3.datei"]["grund"]
        assert s["j3.datei"]["werte"]["unter_live_db"] > 6

    def test_export_5_db_below_the_live_level_is_still_green(self, seite, tmp_path):
        w = tmp_path / "knapp.wav"
        j3_wav(w, amp=10 ** (-35 / 20), ton_sek=14.0)         # -35 dBFS against -30 dB live
        export = {"datei": str(w), "frames": 768000, "spitze_db": -35.0, "ueber_decke": False, "limiter_db_max": 0}
        rc, s, _ = self.lauf(seite, tmp_path, export, export_ohne=self.ohne(tmp_path))
        assert s["j3.datei"]["urteil"] == "OK"

    def test_a_render_that_ignores_the_warp_is_red(self, seite, tmp_path):
        # both exports end where the unwarped clip ends: the markers read back right, the audio did not change
        export = self.ohne(tmp_path)
        rc, s, _ = self.lauf(seite, tmp_path, export, export_ohne=export)
        assert s["j3.warp"]["urteil"] == "FEHL" and s["j3.warp"]["grund"] == "warp_nicht_im_audio"
        assert s["j3.warp"]["werte"]["verschiebung_s"] == 0.0
        assert "j3.datei" in s

    def test_the_warp_is_measured_in_the_audio(self, seite, tmp_path):
        rc, s, _ = self.lauf_gut(seite, tmp_path)
        w = s["j3.warp"]["werte"]
        assert s["j3.warp"]["urteil"] == "OK"
        assert abs(w["verschiebung_s"] - 2.0) < 0.2 and abs(w["erwartet_s"] - 2.0) < 0.01

    def test_a_failed_call_is_red_and_the_later_steps_still_run(self, seite, tmp_path):
        rc, s, hand = self.lauf(seite, tmp_path, self.gut(tmp_path), export_ohne=self.ohne(tmp_path), fehl={"proj_bounce"})
        assert s["j3.audio"]["urteil"] == "FEHL" and s["j3.audio"]["grund"] == "kaputt"
        for k in ("j3.eingang", "j3.warp", "j3.mix", "j3.version", "j3.export", "j3.datei"):
            assert k in s
        assert s["j3.version"]["urteil"] == "OK"
        assert rc == 1

    def test_a_failed_mix_call_is_red_and_the_export_still_runs(self, seite, tmp_path):
        rc, s, hand = self.lauf(seite, tmp_path, self.gut(tmp_path), export_ohne=self.ohne(tmp_path), fehl={"proj_version_sichern"})
        assert s["j3.version"]["urteil"] == "FEHL" and s["j3.export"]["urteil"] == "OK" and "j3.datei" in s

    # ---- fix round 2: the end of the sound, the warp shift in both directions

    def wav_export(self, tmp_path, name, **wav):
        w = tmp_path / name
        j3_wav(w, **wav)
        return {"datei": str(w), "frames": 768000, "spitze_db": -12.0, "ueber_decke": False, "limiter_db_max": 0}

    @pytest.mark.parametrize("ende", [9.0, 8.5, 13.0])
    def test_a_render_cut_short_is_red(self, seite, tmp_path, ende):
        # the warp proof is fine (14 s), the final export stops early
        rc, s, _ = self.lauf(seite, tmp_path, self.wav_export(tmp_path, "kurz.wav", ton_sek=ende), export_ohne=self.ohne(tmp_path),
                             export_warp=self.wav_export(tmp_path, "warp.wav", ton_sek=14.0))
        assert s["j3.warp"]["urteil"] == "OK"
        assert s["j3.datei"]["urteil"] == "FEHL" and "ende_falsch" in s["j3.datei"]["grund"]
        assert s["j3.datei"]["werte"]["erwartetes_ende_s"] == 14.0 and rc == 1

    def test_the_delay_tail_after_the_clip_end_is_green_but_not_much_more(self, seite, tmp_path):
        for ende, urteil in ((15.05, "OK"), (15.5, "FEHL")):            # the real run ends at 15.05 s (echo tail)
            rc, s, _ = self.lauf(seite, tmp_path, self.wav_export(tmp_path, f"t{ende}.wav", ton_sek=ende), export_ohne=self.ohne(tmp_path),
                                 export_warp=self.wav_export(tmp_path, "warp.wav", ton_sek=14.0))
            assert s["j3.datei"]["urteil"] == urteil, ende

    def test_a_warp_shift_that_is_too_big_is_red(self, seite, tmp_path):
        rc, s, _ = self.lauf(seite, tmp_path, self.gut(tmp_path), export_ohne=self.ohne(tmp_path),
                             export_warp=self.wav_export(tmp_path, "warp.wav", ton_sek=9.0))      # 7 s earlier, 2 s expected
        assert s["j3.warp"]["urteil"] == "FEHL" and s["j3.warp"]["grund"] == "warp_verschiebung_falsch"
        assert s["j3.warp"]["werte"]["verschiebung_s"] == pytest.approx(7.0, abs=0.1)

    def test_a_warp_in_the_wrong_direction_is_red(self, seite, tmp_path):
        # before 14 s, after 16 s: the clip got longer although 105 BPM against 120 must shorten it
        rc, s, _ = self.lauf(seite, tmp_path, self.gut(tmp_path), export_ohne=self.wav_export(tmp_path, "v.wav", ton_sek=14.0),
                             export_warp=self.wav_export(tmp_path, "n.wav"))
        assert s["j3.warp"]["urteil"] == "FEHL" and s["j3.warp"]["grund"] == "warp_falsche_richtung"


# ---------------------------------------------------------------- J5

FAKE_MCP_J5 = r'''
import json, os, sys, urllib.error, urllib.request

SEITE = os.environ["FAKE_SEITE"]
N = int(os.environ["FAKE_N"])


def post(pfad, k):
    kopf = {"content-type": "application/json", "x-djk-quelle": "cypher"}
    if os.environ.get("FAKE_NICHT_ABLEHNEN"):
        kopf["x-fake-nicht-ablehnen"] = "1"
    q = urllib.request.Request(SEITE + pfad, data=json.dumps(k).encode(), method="POST", headers=kopf)
    try:
        with urllib.request.urlopen(q, timeout=5) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        return {**json.load(e), "_fehler": True}


def antwort(name, a):
    if name == "proj_neu":
        return {"slug": "tour-j5", "rev": 0}
    if name == "proj_kits":
        return {"kits": [{"name": "starter", "klaenge": 20}]}
    if name == "proj_aendern":
        return {"rev": 1}
    if name == "proj_lage":
        return {"projekt": {"tempo_bpm": 120, "spuren": [{"id": "s1"}]}}
    if name == "proj_muster":
        return {"rev": 2, "muster": [{"clip_id": "c1", "takte": int(os.environ.get("FAKE_TAKTE", "8")), "noten_zahl": 6}]}
    if name == "proj_transport":
        return post("/proj/transport", a)
    if name in ("regler", "tempo"):
        j = post("/regler" if name == "regler" else "/tempo", a)
        q = j.get("quittung") or {}
        if q.get("status") == 6:      # the hand turns a refused quittung into a tool error with the reason
            return {"_fehler": True, "fehler": q.get("grund")}
        return j
    return {"ok": True}


for z in sys.stdin:
    m = json.loads(z)
    if "id" not in m:
        continue
    if m["method"] == "initialize":
        r = {"protocolVersion": "2024-11-05", "capabilities": {}, "serverInfo": {"name": "fake", "version": "0"}}
    elif m["method"] == "tools/list":
        r = {"tools": [{"name": f"werkzeug_{i}"} for i in range(N)]}
    elif m["method"] == "tools/call":
        j = antwort(m["params"]["name"], m["params"].get("arguments") or {})
        fehler = bool(j.pop("_fehler", False))
        r = {"content": [{"type": "text", "text": json.dumps(j)}]}
        if fehler:
            r["isError"] = True
    else:
        print(json.dumps({"jsonrpc": "2.0", "id": m["id"], "error": {"code": -32601, "message": "no"}}), flush=True)
        continue
    print(json.dumps({"jsonrpc": "2.0", "id": m["id"], "result": r}), flush=True)
'''

ZEITRAFFER = 8.0      # the fake clock runs 8 times faster than real time: a bar of the fake (120 BPM) takes 0.25 s


class SeiteJ5:
    """Fake page with a master clock (beat), a transport that sounds eight bars, controls with ramps and the hand's hold.

    /lage (beat, bpm, ki.gestoppt, regler), /pegel?sek=N (loud while the window overlaps the clip), /regler (ramps from the agent,
    refused while the human holds the control), /griff (the first value sets the position, a second one more than 3/128 away takes
    over: ramp stopped, holder for 32 beats), /tempo, /taste, /proj/transport. Switches are plain attributes.
    """

    def __init__(self):
        self.pegel_modus = "clip"            # clip: loud over the clip, laut: always -12 dB, still: always -200 dB
        self.takte_klingen = 8               # bars of the clip that sound (1: only bar 1)
        self.rampe_ignoriert_halter = False  # a grab does not stop the running ramp
        self.halt_ignorieren = False         # the agent is not refused inside the hold
        self.gestoppt = False
        self.pruefmodus_aus = False
        self.regler_ignorieren = False       # /regler answers 200 but keeps the old value
        self.bpm = 120.0
        self.regler = {}
        self.rampe = None
        self.halt = {}                       # pfad -> beat until which the human holds it
        self.griff_pos = {}
        self.klip = None                     # (start_beat, laenge_beats)
        self.aufrufe = []
        self._t0 = time.monotonic()
        self._beat0 = 100.0
        self._b = self._beat0
        self._t = self._t0
        seite = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _senden(self, code, obj):
                roh = json.dumps(obj).encode()
                self.send_response(code)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(roh)))
                self.end_headers()
                self.wfile.write(roh)

            def do_GET(self):
                if self.path.startswith("/lage"):
                    reg = dict(seite.regler)
                    if seite.rampe:
                        reg[seite.rampe["pfad"]] = round(seite.rampenwert(), 3)
                    return self._senden(200, {"uhr": {"bpm": seite.bpm, "beat": seite.beat()}, "ki": {"gestoppt": seite.gestoppt}, "regler": reg})
                if self.path.startswith("/pegel"):
                    sek = int(self.path.split("sek=")[1]) if "sek=" in self.path else 3
                    return self._senden(200, {"sek": sek, "kanaele": {"master": {"n": 20, "max_db": seite.pegel(sek), "median_db": seite.pegel(sek)}}})
                self._senden(404, {"fehler": "keine_route"})

            def do_POST(self):
                k = json.loads(self.rfile.read(int(self.headers.get("content-length") or 0)) or b"{}")
                quelle = self.headers.get("x-djk-quelle")
                seite.aufrufe.append((self.path, quelle, k))
                if self.path == "/taste":
                    if quelle == "cypher":
                        return self._senden(403, {"fehler": "nur_hand"})
                    if seite.pruefmodus_aus:
                        return self._senden(409, {"fehler": "pruefmodus_aus"})
                    seite.gestoppt = k.get("name") == "stopp"
                    return self._senden(200, {"ok": True})
                if self.path == "/griff":
                    return self._senden(*seite.griff(k, quelle))
                if self.path == "/regler":
                    return self._senden(200, seite.setze_regler(k, quelle, bool(self.headers.get("x-fake-nicht-ablehnen"))))
                if self.path == "/tempo":
                    if quelle == "cypher" and seite.gestoppt and not self.headers.get("x-fake-nicht-ablehnen"):
                        return self._senden(409, {"fehler": "ki_gestoppt"})
                    seite._uhr_fortschreiben()
                    seite.bpm = float(k["bpm"])
                    return self._senden(200, {"ok": True})
                if self.path == "/proj/transport":
                    if k.get("aktion") == "start":
                        start = math.ceil(seite.beat() / 4) * 4 + 4
                        seite.klip = (start, 4.0 * seite.takte_klingen)
                    else:
                        seite.klip = None
                    return self._senden(200, {"ok": True})
                self._senden(200, {"ok": True})

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    # -- the clock: beats advance with the (sped up) real time, the tempo may change on the way
    def _uhr_fortschreiben(self):
        jetzt = time.monotonic()
        self._b += (jetzt - self._t) * ZEITRAFFER * self.bpm / 60.0
        self._t = jetzt

    def beat(self):
        self._uhr_fortschreiben()
        return round(self._b, 3)

    def pegel(self, sek):
        if self.pegel_modus == "still":
            return -200.0
        if self.pegel_modus == "laut":
            return -12.0
        b = self.beat()
        von = b - sek * self.bpm / 60.0
        if self.klip and b > self.klip[0] and von < self.klip[0] + self.klip[1]:
            return -12.0
        return -200.0

    def rampenwert(self):
        r = self.rampe
        f = min(1.0, max(0.0, (self.beat() - r["beat0"]) / r["beats"]))
        return r["v0"] + (r["v1"] - r["v0"]) * f

    def setze_regler(self, k, quelle, nicht_ablehnen):
        pfad, nach, takte = k["pfad"], k["nach"], k.get("takte", 0)
        if quelle == "cypher" and self.gestoppt and not nicht_ablehnen:
            return {"ok": True, "quittung": {"status": 6, "grund": "ki_gestoppt"}}
        if quelle == "cypher" and not self.halt_ignorieren and self.beat() < self.halt.get(pfad, -1):
            return {"ok": True, "quittung": {"status": 6, "grund": "regler_beim_menschen"}}
        if self.regler_ignorieren:
            return {"ok": True, "quittung": {"status": 2, "grund": ""}}
        aktuell = self.rampenwert() if self.rampe and self.rampe["pfad"] == pfad else self.regler.get(pfad, 0.0)
        if takte and quelle == "cypher":
            self.rampe = {"pfad": pfad, "v0": aktuell, "v1": nach, "beat0": math.ceil(self.beat() / 4) * 4, "beats": 4.0 * takte}
        else:
            if self.rampe and self.rampe["pfad"] == pfad:
                self.rampe = None
            self.regler[pfad] = nach
        return {"ok": True, "quittung": {"status": 2, "grund": ""}}

    def griff(self, k, quelle):
        if quelle == "cypher":
            return 403, {"fehler": "nur_hand"}
        pfad, u = k["pfad"], k["u"]
        if pfad not in self.griff_pos:
            self.griff_pos[pfad] = u                    # the first value only sets the position
            return 200, {"ok": True}
        if abs(u - self.griff_pos[pfad]) > 3 / 128:     # a second one outside the dead zone takes over
            self.halt[pfad] = self.beat() + 32
            if self.rampe and self.rampe["pfad"] == pfad and not self.rampe_ignoriert_halter:
                self.regler[pfad] = self.rampenwert()
                self.rampe = None
        return 200, {"ok": True}

    def ende(self):
        self.server.shutdown()
        self.server.server_close()


@pytest.fixture
def j5env(tmp_path, monkeypatch):
    from tour import j5
    seite = SeiteJ5()
    skript = tmp_path / "fake_mcp_j5.py"
    skript.write_text(FAKE_MCP_J5)
    monkeypatch.setenv("FAKE_SEITE", seite.url)
    monkeypatch.setenv("FAKE_N", str(j5.code_zahl()))
    inst = SimpleNamespace(url=seite.url, buchstabe="b")

    def fahre(live_url="http://127.0.0.1:1", **kw):
        t = L.Tour("j5", inst, tmp_path / "aus", kurz=True)
        rc = t.fuehre(lambda tt: j5.schritte(tt, befehl=[sys.executable, str(skript)], live_url=live_url,
                                          **{"frist_s": 0.5, "tempo_frist_s": 0.5, "anlauf_s": 0.3, **kw}))
        return rc, {s["kennung"]: s for s in t.bericht().schritte}

    try:
        yield SimpleNamespace(seite=seite, fahre=fahre, j5=j5)
    finally:
        seite.ende()


class TestJ5:
    SCHRITTE = ["j5.registrieren", "j5.werkzeuge", "j5.acht_takte", "j5.spielt", "j5.uebernahme", "j5.stopp_cypher"]

    def test_code_count_is_the_count_of_the_tool_lines_in_hand_ts(self):
        from tour import j5
        zeilen = open(os.path.join(L.DJK, "hand", "hand.ts"), encoding="utf-8").read().split("\n")
        assert j5.code_zahl() == len([z for z in zeilen if z.startswith("  { name: '")]) > 50

    def test_registration_line_is_in_the_manual(self):
        from tour import j5
        assert j5.REGISTRIERUNG in open(os.path.join(L.DJK, "hand", "AUFRUF.md"), encoding="utf-8").read()

    def test_all_green(self, j5env):
        rc, s = j5env.fahre()
        assert [k for k in s] == self.SCHRITTE
        assert {k: v["urteil"] for k, v in s.items()} == {k: "OK" for k in self.SCHRITTE}, s
        assert rc == 0
        assert j5env.seite.gestoppt is False          # the tour never leaves the studio stopped

    def test_tool_count_different_from_the_code_count_is_red(self, j5env, monkeypatch):
        monkeypatch.setenv("FAKE_N", str(j5env.j5.code_zahl() + 1))
        rc, s = j5env.fahre()
        assert s["j5.werkzeuge"]["urteil"] == "FEHL"
        assert str(j5env.j5.code_zahl() + 1) in json.dumps(s["j5.werkzeuge"]["werte"])
        assert s["j5.stopp_cypher"]["urteil"] == "OK"   # the other steps still ran
        assert rc == 1

    def test_agent_call_not_refused_after_stop_cypher_is_red(self, j5env, monkeypatch):
        monkeypatch.setenv("FAKE_NICHT_ABLEHNEN", "1")
        rc, s = j5env.fahre()
        assert s["j5.stopp_cypher"]["urteil"] == "FEHL"
        assert "not refused" in s["j5.stopp_cypher"]["grund"]
        assert j5env.seite.gestoppt is False          # released even though the step went red
        assert rc == 1

    def test_stop_without_test_mode_is_skip_not_red(self, j5env):
        j5env.seite.pruefmodus_aus = True
        rc, s = j5env.fahre()
        assert s["j5.stopp_cypher"]["urteil"] == "SKIP"
        assert "pruefmodus" in s["j5.stopp_cypher"]["grund"]
        assert rc == 0

    def test_takeover_that_does_not_keep_the_human_value_is_red(self, j5env):
        j5env.seite.regler_ignorieren = True
        rc, s = j5env.fahre()
        assert s["j5.uebernahme"]["urteil"] == "FEHL"
        assert rc == 1

    def test_silence_over_the_eight_bars_is_red(self, j5env):
        j5env.seite.pegel_modus = "still"
        rc, s = j5env.fahre()
        assert s["j5.spielt"]["urteil"] == "FEHL"
        assert rc == 1

    def test_clip_that_sounds_only_in_bar_one_is_red(self, j5env):
        j5env.seite.takte_klingen = 1        # the maximum over the phase is loud, bars 2 to 8 are silent
        rc, s = j5env.fahre()
        assert s["j5.spielt"]["urteil"] == "FEHL"
        assert "bar 2" in s["j5.spielt"]["grund"] and "bar 1," not in s["j5.spielt"]["grund"]
        assert rc == 1

    def test_every_bar_is_measured(self, j5env):
        rc, s = j5env.fahre()
        assert len(s["j5.spielt"]["werte"]["takt_max_db"]) == 8
        assert all(db > -60 for db in s["j5.spielt"]["werte"]["takt_max_db"])

    def test_ramp_that_ignores_the_grab_of_the_human_is_red(self, j5env):
        j5env.seite.rampe_ignoriert_halter = True
        rc, s = j5env.fahre()
        assert s["j5.uebernahme"]["urteil"] == "FEHL"
        assert "ramp went on" in s["j5.uebernahme"]["grund"]
        assert rc == 1

    def test_agent_that_is_not_refused_inside_the_hold_is_red(self, j5env):
        j5env.seite.halt_ignorieren = True
        rc, s = j5env.fahre()
        assert s["j5.uebernahme"]["urteil"] == "FEHL"
        assert "inside the hold" in s["j5.uebernahme"]["grund"]

    def test_the_takeover_goes_through_the_grab_route_as_the_human(self, j5env):
        rc, s = j5env.fahre()
        griffe = [(q, k) for pfad, q, k in j5env.seite.aufrufe if pfad == "/griff"]
        assert len(griffe) >= 2 and {q for q, _ in griffe} == {"andreas"}
        assert s["j5.uebernahme"]["werte"]["agent_im_halt"] == "regler_beim_menschen"
        assert s["j5.uebernahme"]["werte"]["halt_beats"] >= 28

    def test_clip_of_the_wrong_length_is_red(self, j5env, monkeypatch):
        monkeypatch.setenv("FAKE_TAKTE", "4")
        rc, s = j5env.fahre()
        assert s["j5.acht_takte"]["urteil"] == "FEHL"

    def test_music_on_the_live_studio_skips_the_sound_step_with_exit_77(self, j5env):
        live = SeiteJ5()
        live.pegel_modus = "laut"
        try:
            rc, s = j5env.fahre(live_url=live.url)       # the fake answers -12 dB: music is playing
        finally:
            live.ende()
        assert s["j5.spielt"]["urteil"] == "SKIP" and s["j5.spielt"]["werte"]["ursache"] == "live"
        assert rc == 77

    def test_hand_that_does_not_start_aborts_with_a_report(self, tmp_path):
        from tour import j5
        seite = SeiteJ5()
        try:
            t = L.Tour("j5", SimpleNamespace(url=seite.url, buchstabe="b"), tmp_path / "aus", kurz=True)
            rc = t.fuehre(lambda tt: j5.schritte(tt, befehl=["/nonexistent/hand"], live_url="http://127.0.0.1:1"))
        finally:
            seite.ende()
        assert rc == 1
        assert [s["kennung"] for s in t.bericht().schritte][0] == "j5.registrieren"
        assert t.bericht().schritte[0]["urteil"] == "FEHL"
        assert (tmp_path / "aus" / "bericht.json").is_file()


# ---------------------------------------------------------------- J2 (fake instance and page)

class FalscheInstanz:
    """Stand-in for `Instanz`: only what `Tour` reads."""

    def __init__(self, url):
        self.buchstabe, self.url, self.kern_port = "b", url, 0


# ---------------------------------------------------------------- J2

class J2Seite:
    """Fake page server for J2: every route answers 200 {ok: true} unless `abgelehnt` names it; /pegel follows `pegel_db(t)` (t = seconds since start)."""

    def __init__(self, wav=None):
        self.t0 = time.monotonic()
        self.pegel_db = lambda t: -12.0
        self.abgelehnt = {}                  # path -> (code, body)
        self.rufe = []                       # (method, path, parsed body)
        self.wav = wav
        self.loops = [{"name": "starter-909-groove", "ladbar": True}, {"name": "starter-neuro-bass", "ladbar": True}]
        self.kanal_db = lambda kanal, t: None                # per channel level override; None follows pegel_db
        self.zeile = {1: None, 2: None}                      # the cell row each loop deck plays (1-based), as /loopdeck/stand shows it
        self.aktiv = None                                    # the active SEQ scene slot
        self.zellen_haengen = False                          # only the loop deck cells do not follow a scene call
        self.seq_haengt = False                              # only the SEQ scene slot does not follow a scene call
        self.luecken = 0                                     # gaps the recorder reports on stop
        self.szene_haengt = False                            # scene calls are accepted (200) but the state never changes
        self.hoerschein = True                               # a fader of a loop deck opens only for a human (the product rule)
        self.quellen = []                                    # (path, x-djk-quelle) of every call
        seite = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _senden(self, code, obj):
                roh = json.dumps(obj).encode()
                self.send_response(code)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(roh)))
                self.end_headers()
                self.wfile.write(roh)

            def _antwort(self, methode, koerper):
                pfad = self.path.split("?")[0]
                seite.rufe.append((methode, self.path, koerper))
                quelle = self.headers.get("x-djk-quelle")
                seite.quellen.append((pfad, quelle))
                if pfad in seite.abgelehnt:
                    code, body = seite.abgelehnt[pfad]
                    return self._senden(code, body)
                if pfad == "/pegel":
                    t = time.monotonic() - seite.t0
                    master = seite.pegel_db(t)
                    kan = {}
                    for k in ("master", "deck/1", "deck/2", "pad/1", "pad/2", "strom/1", "strom/2", "strom/3"):
                        db = seite.kanal_db(k, t)
                        db = master if db is None else db
                        kan[k] = {"n": 20, "max_db": db, "median_db": db}
                    return self._senden(200, {"sek": 1, "kanaele": kan})
                if pfad == "/regler" and seite.hoerschein and quelle != "andreas" and isinstance(koerper, dict) \
                        and str(koerper.get("pfad", "")).startswith("deck/"):
                    return self._senden(409, {"ok": False, "grund": "kein_hoerschein", "text": "Only a human opens this channel."})
                if pfad == "/loopdeck/szene" and isinstance(koerper, dict) and not seite.szene_haengt and not seite.zellen_haengen:
                    seite.zeile[koerper["deck"]] = koerper["zeile"]
                if pfad == "/seq/szene" and isinstance(koerper, dict) and not seite.szene_haengt and not seite.seq_haengt and koerper.get("aktion") == "starten":
                    seite.aktiv = koerper["slot"]
                if pfad == "/loopdeck/stand":
                    return self._senden(200, {"decks": {str(d): {"spuren": [{"lauf": {"zelle": seite.zeile[d]}} for _ in range(4)]}
                                                        for d in (1, 2)}})
                if pfad == "/seq/szenen":
                    return self._senden(200, {"szenen": [None] * 8, "aktiv": seite.aktiv, "wartet": None})
                if pfad == "/loop" and isinstance(koerper, dict) and koerper.get("aktion") == "rec":
                    seite.loops.append({"name": koerper["name"], "ladbar": True})
                if pfad == "/loops":
                    return self._senden(200, seite.loops)
                if pfad == "/seq/stand":
                    return self._senden(200, {"4": {"gruppe_id": "g", "folgen": [{"spur_id": "s1", "name": "drums"}]}})
                if pfad == "/mitschnitt/start":
                    return self._senden(200, {"ok": True, "datei": seite.wav, "seit": "now"})
                if pfad == "/mitschnitt/stopp":
                    return self._senden(200, {"ok": True, "datei": seite.wav, "sekunden": 1.5, "luecken": seite.luecken, "spruenge": 0})
                self._senden(200, {"ok": True})

            def do_GET(self):
                self._antwort("GET", None)

            def do_POST(self):
                n = int(self.headers.get("content-length") or 0)
                roh = self.rfile.read(n)
                try:
                    k = json.loads(roh) if roh else None
                except ValueError:
                    k = None
                self._antwort("POST", k)

        self.srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.url = f"http://127.0.0.1:{self.srv.server_address[1]}"
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()

    def pfade(self, methode=None):
        return [p.split("?")[0] for m, p, _ in self.rufe if methode in (None, m)]

    def stopp(self):
        self.srv.shutdown()
        self.srv.server_close()


class FalscheXrun(L.XrunZaehler):
    """The real counting rules without the UDP subscriber: a phase reports `delta`, the baseline is `basis_delta` over its measured seconds."""

    def __init__(self, delta, basis_delta=0, basis_fehlt=False):
        self._delta, self._bd, self._basis_fehlt = delta, basis_delta, basis_fehlt
        self._basis_delta = self._basis_sek = None

    def basis(self, sek):
        if self._basis_fehlt:
            raise RuntimeError("no /zustand/kern message from the core: the idle baseline cannot be measured")
        self._basis_delta, self._basis_sek = self._bd, float(sek)
        return self._bd

    @contextlib.contextmanager
    def phase(self):
        m, t0 = L.Messung(), time.monotonic()
        yield m
        m.delta, m.sek = self._delta, time.monotonic() - t0

    def ende(self):
        pass


def sinus_wav(pfad, sek, db=-12.0):
    a = 10 ** (db / 20)
    with wave.open(str(pfad), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(48000)
        n = int(48000 * sek)
        w.writeframes(b"".join(struct.pack("<hh", *(int(a * 32767 * math.sin(2 * math.pi * 220 * i / 48000)),) * 2) for i in range(n)))


def luecke_wav(pfad, laut_s, stille_s, db=-12.0):
    """A WAV: `laut_s` of sine, `stille_s` of digital silence, `laut_s` of sine."""
    a = 10 ** (db / 20)
    ton = b"".join(struct.pack("<hh", *(int(a * 32767 * math.sin(2 * math.pi * 220 * i / 48000)),) * 2) for i in range(int(48000 * laut_s)))
    with wave.open(str(pfad), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(48000)
        w.writeframes(ton + b"\0\0\0\0" * int(48000 * stille_s) + ton)


KLEIN = dict(basis_s=0.2, set_s=1.6, szene_s=0.5, fader_s=0.3, takt_s=0.05, stille_max_s=0.3, min_datei_s=1.0, szene_frist_s=0.4, anlauf_s=0.2)


class TestJ2:
    @pytest.fixture
    def umgebung(self, tmp_path, monkeypatch):
        from tour import j2
        wav = tmp_path / "set.wav"
        sinus_wav(wav, 2.0)
        seite = J2Seite(str(wav))
        monkeypatch.setattr(j2, "plan", lambda kurz: dict(KLEIN))
        yield j2, seite, tmp_path
        seite.stopp()

    def lauf(self, umgebung, xrun, kurz=True):
        j2, seite, tmp = umgebung
        t = L.Tour("j2", FalscheInstanz(seite.url), tmp / "bericht", kurz)
        t.fuehre(lambda tt: j2.schritte(tt, xrun=xrun))
        return {s["kennung"]: s for s in t.bericht().schritte}, t.bericht()

    def test_clean_run_is_green_except_the_apc20_skip(self, umgebung):
        s, b = self.lauf(umgebung, FalscheXrun(0))
        assert [k for k in s] == ["j2.aufbau", "j2.basis", "j2.set", "j2.szenen", "j2.container", "j2.apc20", "j2.mitschnitt", "j2.datei"]
        assert {k: v["urteil"] for k, v in s.items() if v["urteil"] != "OK"} == {"j2.apc20": "SKIP"}, b.markdown()
        assert b.exitcode() == 0
        assert (Path(b.ausgabe) / "bericht.json").is_file()

    def test_apc20_is_skip_with_reason_and_owner_session_never_ok(self, umgebung):
        s, _ = self.lauf(umgebung, FalscheXrun(0))
        a = s["j2.apc20"]
        assert a["urteil"] == "SKIP" and "APC20" in a["grund"] and "owner session J2" in a["grund"]
        assert a["werte"]["sitzung"] == "J2"

    def test_delta_above_the_scaled_baseline_is_red(self, umgebung):
        s, b = self.lauf(umgebung, FalscheXrun(3, basis_delta=0))
        assert s["j2.set"]["urteil"] == "FEHL" and "xrun" in s["j2.set"]["grund"], b.markdown()
        assert b.exitcode() == 1

    def test_delta_inside_the_scaled_baseline_is_green(self, umgebung):
        # baseline 10 over 0.2 s scales to 80 over the 1.6 s phase: a delta of 40 passes
        s, _ = self.lauf(umgebung, FalscheXrun(40, basis_delta=10))
        assert s["j2.set"]["urteil"] == "OK"

    def test_baseline_that_cannot_be_measured_is_red_not_green(self, umgebung):
        s, _ = self.lauf(umgebung, FalscheXrun(0, basis_fehlt=True))
        assert s["j2.basis"]["urteil"] == "FEHL"
        assert s["j2.set"]["urteil"] == "FEHL" and "baseline" in s["j2.set"]["grund"]

    def test_silent_stretch_inside_the_set_is_red(self, umgebung):
        j2, seite, _ = umgebung
        # silent from 0.5 s to 1.1 s after the set recording began (stille_max_s is 0.3)
        seite.pegel_db = lambda t: pegel_nach_start(seite, 0.5, 1.1)
        s, b = self.lauf(umgebung, FalscheXrun(0))
        assert s["j2.set"]["urteil"] == "FEHL" and "silent" in s["j2.set"]["grund"], b.markdown()
        assert s["j2.set"]["werte"]["laengste_stille_s"] >= 0.5

    def test_a_dip_shorter_than_the_limit_is_fine(self, umgebung):
        j2, seite, _ = umgebung
        seite.pegel_db = lambda t: pegel_nach_start(seite, 0.5, 0.6)
        s, _ = self.lauf(umgebung, FalscheXrun(0))
        assert s["j2.set"]["urteil"] == "OK"

    def test_clipping_in_the_set_is_red(self, umgebung):
        j2, seite, _ = umgebung
        seite.pegel_db = lambda t: pegel_nach_start(seite, 0.5, 0.6, laut=0.0)
        s, _ = self.lauf(umgebung, FalscheXrun(0))
        assert s["j2.set"]["urteil"] == "FEHL" and "clip" in s["j2.set"]["grund"]

    def test_scenes_and_faders_are_driven_on_the_script(self, umgebung):
        j2, seite, _ = umgebung
        s, _ = self.lauf(umgebung, FalscheXrun(0))
        pf = seite.pfade("POST")
        assert pf.count("/loopdeck/szene") >= 2 * 2          # two decks, at least two scene changes in 1.6 s at 0.5 s
        assert "/seq/szene" in pf and "/strudel" in pf
        regler = [k["pfad"] for m, p, k in seite.rufe if p == "/regler"]
        assert {"deck/1/fader", "deck/2/fader", "pad/1/fader", "pad/2/fader"} <= set(regler)
        assert s["j2.szenen"]["werte"]["szenen"] >= 2 and s["j2.container"]["urteil"] == "OK"

    def test_a_refused_scene_makes_the_scene_step_red(self, umgebung):
        j2, seite, _ = umgebung
        seite.abgelehnt["/loopdeck/szene"] = (409, {"ok": False, "grund": "kein_loopdeck", "text": "No loop deck on that place."})
        s, _ = self.lauf(umgebung, FalscheXrun(0))
        assert s["j2.szenen"]["urteil"] == "FEHL" and "kein_loopdeck" in s["j2.szenen"]["grund"]

    def test_recording_that_cannot_start_is_red_and_the_file_step_too(self, umgebung):
        j2, seite, _ = umgebung
        seite.abgelehnt["/mitschnitt/start"] = (503, {"ok": False, "grund": "kern_fehlt", "text": "no core"})
        s, _ = self.lauf(umgebung, FalscheXrun(0))
        assert s["j2.mitschnitt"]["urteil"] == "FEHL" and "kern_fehlt" in s["j2.mitschnitt"]["grund"]
        assert s["j2.datei"]["urteil"] == "FEHL"

    def test_short_recording_file_is_red(self, umgebung, monkeypatch):
        j2, seite, tmp = umgebung
        monkeypatch.setattr(j2, "plan", lambda kurz: {**KLEIN, "min_datei_s": 30.0})
        s, _ = self.lauf(umgebung, FalscheXrun(0))
        assert s["j2.datei"]["urteil"] == "FEHL" and "zu_kurz" in s["j2.datei"]["grund"]

    def test_missing_starter_loops_are_recorded_from_a_stream(self, umgebung):
        j2, seite, _ = umgebung
        seite.loops = []
        s, _ = self.lauf(umgebung, FalscheXrun(0))
        assert s["j2.aufbau"]["urteil"] == "OK"
        assert any(k and k.get("aktion") == "rec" for m, p, k in seite.rufe if p == "/loop")

    def test_silence_inside_the_recorded_file_is_found(self, tmp_path):
        from tour import j2
        sauber, luecke = tmp_path / "sauber.wav", tmp_path / "luecke.wav"
        sinus_wav(sauber, 2.0)
        luecke_wav(luecke, 1.0, 1.5)
        assert j2._stille_in_datei(sauber, 0.5) == []
        gefunden = j2._stille_in_datei(luecke, 0.5)
        assert len(gefunden) == 1 and 1.3 < gefunden[0] < 1.7

    def test_recording_with_a_silent_stretch_is_red(self, umgebung):
        j2, seite, tmp = umgebung
        luecke_wav(tmp / "set.wav", 1.0, 1.5)
        s, _ = self.lauf(umgebung, FalscheXrun(0))
        assert s["j2.datei"]["urteil"] == "FEHL" and "stille" in s["j2.datei"]["grund"]
        assert s["j2.datei"]["werte"]["stille_im_file_s"]

    def test_recording_is_checked_for_silence_by_the_step_not_only_by_the_file_check(self, umgebung, monkeypatch):
        j2, seite, _ = umgebung
        monkeypatch.setattr(j2, "_stille_in_datei", lambda pfad, min_s: [3.0])
        s, _ = self.lauf(umgebung, FalscheXrun(0))
        assert s["j2.datei"]["urteil"] == "FEHL" and "stille" in s["j2.datei"]["grund"]

    def test_recording_is_moved_out_of_the_ram_not_copied(self, umgebung):
        j2, seite, tmp = umgebung
        quelle = tmp / "set.wav"
        assert quelle.is_file() and not hasattr(j2, "KOPIE_GRENZE_BYTES")
        s, b = self.lauf(umgebung, FalscheXrun(0))
        ziel = Path(b.ausgabe) / "set.wav"
        assert ziel.is_file() and not quelle.exists()
        assert s["j2.datei"]["urteil"] == "OK" and s["j2.datei"]["werte"]["datei"] == str(ziel)

    def test_scene_state_that_never_changes_is_red_although_every_call_answers_200(self, umgebung):
        j2, seite, _ = umgebung
        seite.szene_haengt = True
        s, _ = self.lauf(umgebung, FalscheXrun(0))
        assert s["j2.szenen"]["urteil"] == "FEHL" and "did not show" in s["j2.szenen"]["grund"]

    def test_a_silent_seq_container_while_its_scene_is_on_is_red(self, umgebung, monkeypatch):
        j2, seite, _ = umgebung
        monkeypatch.setattr(j2, "plan", lambda kurz: {**KLEIN, "stille_max_s": 0.1})
        seite.kanal_db = lambda k, t: -200.0 if k == "pad/2" else None
        s, _ = self.lauf(umgebung, FalscheXrun(0))
        assert s["j2.container"]["urteil"] == "FEHL" and "pad/2" in s["j2.container"]["grund"]
        assert s["j2.set"]["urteil"] == "OK"                      # the master is fine; the per-channel check names the silent container

    def test_a_channel_that_is_loud_first_and_silent_later_while_it_should_play_is_red(self, umgebung):
        j2, seite, _ = umgebung
        seite.kanal_db = lambda k, t: -200.0 if (k == "deck/1" and t > 0.8) else None
        s, _ = self.lauf(umgebung, FalscheXrun(0))
        assert s["j2.container"]["urteil"] == "FEHL" and "silent while it should play" in s["j2.container"]["grund"]
        assert "deck/1" in s["j2.container"]["grund"]

    def test_scene_whose_loop_cells_do_not_switch_is_red(self, umgebung):
        j2, seite, _ = umgebung
        seite.zellen_haengen = True
        s, _ = self.lauf(umgebung, FalscheXrun(0))
        assert s["j2.szenen"]["urteil"] == "FEHL" and "did not show" in s["j2.szenen"]["grund"]

    def test_scene_whose_seq_slot_does_not_switch_is_red(self, umgebung):
        j2, seite, _ = umgebung
        seite.seq_haengt = True
        s, _ = self.lauf(umgebung, FalscheXrun(0))
        assert s["j2.szenen"]["urteil"] == "FEHL" and "did not show" in s["j2.szenen"]["grund"]

    def test_recorder_gaps_make_the_recording_step_red(self, umgebung):
        j2, seite, _ = umgebung
        seite.luecken = 2
        s, _ = self.lauf(umgebung, FalscheXrun(0))
        assert s["j2.mitschnitt"]["urteil"] == "FEHL" and "gap" in s["j2.mitschnitt"]["grund"]

    def test_a_silent_strudel_stream_after_its_post_is_red(self, umgebung):
        j2, seite, _ = umgebung
        seite.kanal_db = lambda k, t: -200.0 if k == "strom/1" else None
        s, _ = self.lauf(umgebung, FalscheXrun(0))
        assert s["j2.container"]["urteil"] == "FEHL" and "strom/1" in s["j2.container"]["grund"]

    def test_calls_made_as_andreas_are_listed_and_the_cypher_refusal_is_checked(self, umgebung):
        j2, seite, _ = umgebung
        s, b = self.lauf(umgebung, FalscheXrun(0))
        assert s["j2.container"]["urteil"] == "OK"
        liste = s["j2.container"]["werte"]["aufrufe_als_andreas"]
        assert liste["POST /regler deck/1/fader"] >= 1 and liste["POST /regler pad/2/fader"] >= 1
        assert s["j2.set"]["werte"]["aufrufe_als_andreas"]
        assert s["j2.container"]["werte"]["fader_als_cypher"] == "409 kein_hoerschein"
        assert "aufrufe_als_andreas" in (Path(b.ausgabe) / "bericht.json").read_text()
        regler = [q for p, q in seite.quellen if p == "/regler"]
        assert regler.count("cypher") == 1 and regler.count("andreas") == len(regler) - 1

    def test_the_same_fader_call_as_cypher_being_accepted_is_red(self, umgebung):
        j2, seite, _ = umgebung
        seite.hoerschein = False
        s, _ = self.lauf(umgebung, FalscheXrun(0))
        assert s["j2.container"]["urteil"] == "FEHL" and "kein_hoerschein" in s["j2.container"]["grund"]

    def test_the_fader_script_swings_by_a_real_amount(self, umgebung):
        j2, seite, _ = umgebung
        self.lauf(umgebung, FalscheXrun(0))
        werte = [k["nach"] for m, p, k in seite.rufe if p == "/regler" and k["pfad"] in j2.CONTAINER]
        assert max(werte) - min(werte) >= 12 and max(werte) <= -6 and min(werte) <= -15
        assert max(j2.FADER_DB) - min(j2.FADER_DB) >= 12

    def test_instance_options_name_strudel_and_the_stream_hosts(self):
        from tour import j2
        assert {"--strudel", "--instrumente", "--bk-stroeme"} <= set(j2.OPTIONEN)
        assert "bibliothek" not in j2.STUFEN and "loops" in j2.STUFEN

    def test_default_plan_lengths(self):
        from tour import j2
        voll, kurz = j2.plan(False), j2.plan(True)
        assert (voll["set_s"], voll["basis_s"], voll["szene_s"]) == (1800, 120, 120)
        assert (kurz["set_s"], kurz["basis_s"], kurz["szene_s"]) == (120, 20, 20)
        assert voll["stille_max_s"] == 2


def pegel_nach_start(seite, von, bis, laut=-200.0):
    """Master level that is `laut` (default silent) from `von` to `bis` seconds after the set recording was started, else -12 dB."""
    starts = [i for i, r in enumerate(seite.rufe) if r[1].startswith("/mitschnitt/start")]
    if not starts:
        return -12.0
    if getattr(seite, "_start", None) is None:
        seite._start = time.monotonic()
    return laut if von <= time.monotonic() - seite._start <= bis else -12.0


class J1Seite:
    """Fake page server for J1: catalogue, preparation, /bestand with a settable analysed tempo, recorder answers."""

    def __init__(self, ordner, bpm_eins=124.0, bpm_zwei=128.0, start_antwort=(200, None), camelot=("8A", "9A")):
        self.ordner = str(ordner)
        self.bpm = {"Tour Track One.wav": bpm_eins, "Tour Track Two.wav": bpm_zwei}
        self.start_antwort = start_antwort
        self.camelot = {"Tour Track One.wav": camelot[0], "Tour Track Two.wav": camelot[1]}
        self.aufrufe = []
        self.quellen = [{"pfad": "/weg/alte-fixtures", "fehlt": True}, {"pfad": "/da/musik", "fehlt": False}, {"pfad": "/da/ausgabe/musik-0123abcd", "fehlt": False}]
        seite = self
        mids = {"Tour Track One.wav": "a" * 16, "Tour Track Two.wav": "b" * 16}

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _senden(self, code, obj):
                roh = json.dumps(obj).encode()
                self.send_response(code)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(roh)))
                self.end_headers()
                self.wfile.write(roh)

            def do_GET(self):
                seite.aufrufe.append(("GET", self.path))
                if self.path.startswith("/bibliothek/quellen"):
                    return self._senden(200, {"quellen": seite.quellen})
                if self.path.startswith("/bibliothek/stand"):
                    return self._senden(200, {"letzter_bau": {"rc": 0}})
                if self.path.startswith("/stoebern"):
                    return self._senden(200, {"treffer": [{"name": Path(n).stem, "ordner": seite.ordner, "material_id": m, "status": "ready", "bpm": None, "camelot": None}
                                                          for n, m in mids.items()]})
                if self.path.startswith("/bestand"):
                    return self._senden(200, [{"material_id": m, "quelle_bpm": seite.bpm[n], "camelot": seite.camelot[n]} for n, m in mids.items()])
                if self.path.startswith("/lage"):
                    return self._senden(200, {"uhr": {"beat": 100.0, "bpm": 124.0, "schlag": 4}, "decks": [], "regler": {"keylock": 1}})
                if self.path.startswith("/mitschnitt/stand"):
                    return self._senden(200, {"laeuft": True})
                self._senden(404, {"fehler": "keine_route"})

            def do_POST(self):
                n = int(self.headers.get("content-length") or 0)
                self.rfile.read(n)
                seite.aufrufe.append(("POST", self.path))
                if self.path == "/mitschnitt/start":
                    code, grund = seite.start_antwort
                    if code != 200:
                        return self._senden(code, {"ok": False, "grund": grund, "fehler": grund, "text": "x"})
                    return self._senden(200, {"ok": True, "datei": "/x/mix.wav", "seit": 0})
                self._senden(200, {"ok": True})

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def ende(self):
        self.server.shutdown()
        self.server.server_close()


def j1_tour(seite, ausgabe):
    inst = types.SimpleNamespace(url=seite.url, buchstabe="c")
    return L.Tour("j1", inst, ausgabe, kurz=True)


def j1_schritt(t, kennung):
    return next(s for s in t.bericht().schritte if s["kennung"] == kennung)


def j1_zustand(ordner):
    z = j1.Zustand()
    z.dateien = [Path(ordner) / "Tour Track One.wav", Path(ordner) / "Tour Track Two.wav"]
    return z


def j1_wav(pfad, sek, luecke=None, rate=48000):
    """Mono-as-stereo noise of `sek` seconds at about -12 dBFS, zeros inside `luecke` = (from_s, to_s)."""
    import numpy as np
    rng = np.random.default_rng(1)
    a = (rng.uniform(-1, 1, int(sek * rate)) * 0.25)
    if luecke:
        a[int(luecke[0] * rate):int(luecke[1] * rate)] = 0.0
    pcm = np.repeat(np.round(a * 32767).astype("<i2")[:, None], 2, axis=1)
    with wave.open(str(pfad), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm.tobytes())


class TestJ1:
    def _analyse(self, tmp_path, **kw):
        ordner = tmp_path / "musik"
        ordner.mkdir()
        s = J1Seite(ordner, **kw)
        try:
            t = j1_tour(s, tmp_path / "aus")
            z = j1_zustand(ordner)
            t.fuehre(lambda t: j1.schritt_analyse(t, z, ordner))
            return j1_schritt(t, "j1.analyse")
        finally:
            s.ende()

    def test_tempo_im_toleranzband_ist_gruen(self, tmp_path):
        st = self._analyse(tmp_path, bpm_eins=124.3, bpm_zwei=127.6)
        assert st["urteil"] == "OK", st

    def test_tempo_um_drei_daneben_ist_rot(self, tmp_path):
        st = self._analyse(tmp_path, bpm_eins=127.0)
        assert st["urteil"] == "FEHL"
        assert "analysis failed" in st["grund"] and "124" in st["grund"] and "127.0" in st["grund"]

    def test_veraltete_quelle_wird_entfernt(self, tmp_path):
        ordner = tmp_path / "musik"
        ordner.mkdir()
        s = J1Seite(ordner)
        try:
            t = j1_tour(s, tmp_path / "aus")
            t.fuehre(lambda t: j1.schritt_analyse(t, j1_zustand(ordner), ordner))
            posts = [p for m, p in s.aufrufe if m == "POST"]
            assert "/bibliothek/quellen/weg" in posts and posts.count("/bibliothek/quellen/weg") == 2
        finally:
            s.ende()

    def test_falsche_tonart_ist_rot(self, tmp_path):
        st = self._analyse(tmp_path, camelot=("8A", "4B"))
        assert st["urteil"] == "FEHL" and "4B" in st["grund"]

    def test_mitschnitt_kern_fehlt_ist_rot(self, tmp_path):
        s = J1Seite(tmp_path, start_antwort=(503, "kern_fehlt"))
        try:
            t = j1_tour(s, tmp_path / "aus")
            z = j1_zustand(tmp_path)
            t.fuehre(lambda t: j1.schritt_mitschnitt(t, z))
            st = j1_schritt(t, "j1.mitschnitt")
            assert st["urteil"] == "FEHL"
            assert "kern_fehlt" in st["grund"]
            assert z.mitschnitt_laeuft is False
        finally:
            s.ende()

    def _datei(self, tmp_path, luecke):
        pfad = tmp_path / "mix.wav"
        j1_wav(pfad, 6.0, luecke)
        s = J1Seite(tmp_path)
        try:
            t = j1_tour(s, tmp_path / "aus")
            z = j1_zustand(tmp_path)
            z.aufnahme = {"datei": str(pfad)}
            z.mix_start, z.mix_ende = 100.0, 104.0
            t.fuehre(lambda t: j1.schritt_datei(t, z))
            return j1_schritt(t, "j1.datei")
        finally:
            s.ende()

    def test_wav_mit_zwei_sekunden_stille_ist_rot(self, tmp_path):
        st = self._datei(tmp_path, (2.0, 4.0))
        assert st["urteil"] == "FEHL"
        assert "stille" in st["grund"]
        assert 1.9 <= st["werte"]["laengste_stille_s"] <= 2.1

    def test_wav_ohne_luecke_ist_gruen(self, tmp_path):
        st = self._datei(tmp_path, None)
        assert st["urteil"] == "OK", st
        assert st["werte"]["laengste_stille_s"] == 0.0

    def test_projekt_fuer_die_fixtures(self):
        p = musik.projekt(128, 7)
        assert p["tempo_bpm"] == 128
        kicks = {round(n["beat"]) for s in p["spuren"] if s["nr"] == 1 for n in s["clips"][0]["noten"] if n["ton"] == 36}
        assert kicks >= set(range(128)), "a kick on every beat"
        eins = musik.projekt(124, 0)
        zwei = musik.projekt(124, 7)
        a = [n["ton"] for n in eins["spuren"][1]["clips"][0]["noten"]]
        b = [n["ton"] for n in zwei["spuren"][1]["clips"][0]["noten"]]
        assert [x + 7 for x in a] == b

# ---------------------------------------------------------------- a synthetic mix with known properties

P124 = 60.0 / 124


def mix_signal(versatz_ms=0.0, halber_schlag=False, cent=0.0, bass_tausch=True, fx_wirkt=True, delle_beats=0.0, rate=48000):
    """Two decks as pulse trains and tones, with the events of a J1 run (beats on the master clock):
    deck 1 plays from beat 100 to 188, deck 2 starts on beat 116 (`versatz_ms` / half a beat late), faders ramp over 16 bars from beat 124,
    the bass swap is at beat 156 (`delle_beats`: both marker tones are cancelled for that many beats right before it), an echo (extra kicks half a beat later) runs from beat 212 to 228 when `fx_wirkt`. Returns (signal, Zustand)."""
    import numpy as np
    z = j1.Zustand()
    z.dateien = [Path("Tour Track One.wav"), Path("Tour Track Two.wav")]
    z.tempo = 124
    z.a_beat, z.b_beat, z.rampe_beat, z.swap_beat, z.swap_beat_ende = 100.0, 116.0, 124.0, 156.0, 157.0
    z.ende_beat, z.fx_an_beat, z.fx_aus_beat, z.stopp_beat = 188.0, 212.0, 228.0, 244.0
    anker = 0.5
    dauer = anker + (z.stopp_beat - z.a_beat) * P124 + 0.5
    t = np.arange(int(dauer * rate)) / rate
    beat = z.a_beat + (t - anker) / P124

    def fader_a(b):
        return -40.0 * np.clip((b - z.rampe_beat) / 64.0, 0, 1)

    def fader_b(b):
        return -40.0 + 40.0 * np.clip((b - z.rampe_beat) / 64.0, 0, 1)

    def eq(b, richtung):
        f = np.clip((b - z.swap_beat) / 4.0, 0, 1) if bass_tausch else np.zeros_like(b)
        return -60.0 * f if richtung == "ab" else -60.0 * (1 - f)

    gain_a = 10 ** ((fader_a(beat) + eq(beat, "ab")) / 20) * ((beat >= z.a_beat) & (beat < z.ende_beat))
    gain_b = 10 ** ((fader_b(beat) + eq(beat, "auf")) / 20) * (beat >= z.b_beat)
    if delle_beats:
        delle = 1.0 - ((beat >= z.swap_beat - delle_beats) & (beat < z.swap_beat))
        gain_a, gain_b = gain_a * delle, gain_b * delle
    x = 0.05 * np.sin(2 * np.pi * musik.marker("Tour Track One.wav") * t) * gain_a
    x += 0.05 * np.sin(2 * np.pi * musik.marker("Tour Track Two.wav") * 2 ** (cent / 1200) * t) * gain_b

    def kick(zeit_s, amp):
        i0 = int(zeit_s * rate)
        n = int(0.25 * rate)
        if i0 < 0 or i0 + n > len(x):
            return
        tt = np.arange(n) / rate
        x[i0:i0 + n] += amp * np.exp(-tt / 0.04) * np.sin(2 * np.pi * 60 * tt)

    for k in range(int(z.a_beat), int(z.stopp_beat)):
        zeit = anker + (k - z.a_beat) * P124
        ga = float(10 ** ((fader_a(k) + eq(np.array(k, dtype=float), "ab")) / 20)) if k < z.ende_beat else 0.0
        kick(zeit, 0.5 * ga)
        if k >= z.b_beat:
            gb = float(10 ** ((fader_b(k) + eq(np.array(k, dtype=float), "auf")) / 20))
            kick(zeit + versatz_ms / 1000.0 + (P124 / 2 if halber_schlag else 0.0), 0.5 * gb)
        if fx_wirkt and z.fx_an_beat + 1 <= k < z.fx_aus_beat:
            kick(zeit + P124 / 2, 0.25)
    z.aufnahme = {"datei": "synthetic"}
    z.signal = x
    return x, z


class TestJ1Messung:
    def _schritt(self, tmp_path, fn, **kw):
        _, z = mix_signal(**kw)
        s = J1Seite(tmp_path)
        try:
            t = j1_tour(s, tmp_path / "aus")
            t.fuehre(lambda t: fn(t, z))
            return j1_schritt(t, {j1.schritt_sync: "j1.sync", j1.schritt_keylock: "j1.keylock", j1.schritt_eq: "j1.eq", j1.schritt_fx: "j1.fx"}[fn])
        finally:
            s.ende()

    def test_sync_auf_dem_gitter_ist_gruen(self, tmp_path):
        st = self._schritt(tmp_path, j1.schritt_sync, versatz_ms=4.0)
        assert st["urteil"] == "OK", st
        assert abs(st["werte"]["allein_ms"] - 4.0) < 3.0 and abs(st["werte"]["ueberlappung_ms"] - 4.0) < 3.0

    def test_sync_einen_halben_schlag_daneben_ist_rot(self, tmp_path):
        st = self._schritt(tmp_path, j1.schritt_sync, halber_schlag=True)
        assert st["urteil"] == "FEHL"
        assert abs(abs(st["werte"]["allein_ms"]) - 1000 * P124 / 2) < 10, st["werte"]

    def test_sync_fuenfundzwanzig_ms_daneben_ist_rot(self, tmp_path):
        st = self._schritt(tmp_path, j1.schritt_sync, versatz_ms=25.0)
        assert st["urteil"] == "FEHL" and "off deck 1's grid" in st["grund"]

    def test_keylock_gehaltene_tonhoehe_ist_gruen(self, tmp_path):
        st = self._schritt(tmp_path, j1.schritt_keylock, cent=3.0)
        assert st["urteil"] == "OK", st
        assert abs(st["werte"]["cent"] - 3.0) < 3.0

    def test_keylock_aus_ist_rot(self, tmp_path):
        """128 played at 124 without key lock is 55 cents low."""
        st = self._schritt(tmp_path, j1.schritt_keylock, cent=1200 * __import__("math").log2(124 / 128))
        assert st["urteil"] == "FEHL" and "cents" in st["grund"]
        assert abs(st["werte"]["cent"] + 54.9) < 3.0

    def test_basstausch_ist_gruen(self, tmp_path):
        st = self._schritt(tmp_path, j1.schritt_eq)
        assert st["urteil"] == "OK", st
        assert st["werte"]["deck1_abfall_db"] > 20 and st["werte"]["deck2_anstieg_db"] > 20

    def test_basstausch_eine_ausloeschung_im_letzten_fenster_zaehlt_nicht(self, tmp_path):
        """Both markers vanish for the last 4 beats before the swap (a cancellation against program content): the last single window would read
        far too low, the median of the windows before must not move."""
        ohne = self._schritt(tmp_path, j1.schritt_eq)["werte"]
        mit = self._schritt(tmp_path, j1.schritt_eq, delle_beats=4.0)
        assert mit["urteil"] == "OK", mit
        assert abs(mit["werte"]["deck1_vor_db"] - ohne["deck1_vor_db"]) < 1.5, (mit["werte"], ohne)
        assert abs(mit["werte"]["deck2_vor_db"] - ohne["deck2_vor_db"]) < 1.5, (mit["werte"], ohne)

    def test_basstausch_ohne_keylock_misst_die_verschobene_marke(self, tmp_path, monkeypatch):
        """Key lock off: 128 played at 124 puts the marker of deck 2 55 cents low. The level must be read there, not at the rendered frequency."""
        monkeypatch.setattr(j1, "KEYLOCK", False)
        st = self._schritt(tmp_path, j1.schritt_eq, cent=1200 * __import__("math").log2(124 / 128))
        assert st["urteil"] == "OK", st
        assert st["werte"]["deck2_anstieg_db"] > 20, st["werte"]

    def test_ohne_basstausch_ist_rot(self, tmp_path):
        st = self._schritt(tmp_path, j1.schritt_eq, bass_tausch=False)
        assert st["urteil"] == "FEHL" and "does not show" in st["grund"]

    def test_fx_mit_wirkung_ist_gruen(self, tmp_path):
        st = self._schritt(tmp_path, j1.schritt_fx)
        assert st["urteil"] == "OK", st
        assert st["werte"]["anstieg"] >= j1.FX_ANSTIEG

    def test_fx_ohne_wirkung_ist_rot(self, tmp_path):
        st = self._schritt(tmp_path, j1.schritt_fx, fx_wirkt=False)
        assert st["urteil"] == "FEHL"


class TestJ1Musik:
    def test_nur_audio_im_bibliotheksordner(self, tmp_path, monkeypatch):
        import numpy as np

        def falsch(proj, ziel, arbeit):
            assert str(arbeit) != str(tmp_path / "lib")        # the scratch folder is never the library folder
            musik._schreibe_wav(ziel, np.zeros((48000, 2)))
            return {}
        monkeypatch.setattr(musik, "_rendere", falsch)
        monkeypatch.setattr(musik, "_lies_wav", lambda p: np.zeros((48000, 2)))
        aus = musik.erzeuge(tmp_path / "lib", kurz=True)
        assert sorted(p.name for p in (tmp_path / "lib").iterdir()) == ["Tour Track One.wav", "Tour Track Two.wav"]
        with wave.open(str(aus[1])) as w:
            roh = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").reshape(-1, 2)
            dauer = w.getnframes() / w.getframerate()
        assert abs(dauer - (48 * 4 * 60 / 128 + 0.37)) < 0.01
        assert np.abs(roh[:int(0.36 * 48000)]).max() == 0, "silence before the first kick of track two"
        assert np.abs(roh[int(0.5 * 48000):]).max() > 0, "the marker tone runs after it"


class TestSpitze:
    def test_flache_kuppe_gibt_die_mitte_nicht_das_maximum(self):
        import numpy as np
        h = np.zeros(484)
        h[285:316] = 0.97
        h[300] = 1.0
        h[290] = 0.995          # the maximum itself is arbitrary on a flat top
        assert abs(j1.spitze_ms(h, 60 / 124) - 300.0 * (60 / 124 * 1000 / 484)) < 0.5 * (60 / 124 * 1000 / 484) * 2

    def test_maximum_am_rand_der_kuppe_gibt_trotzdem_die_mitte(self):
        import numpy as np
        h = np.zeros(484)
        h[285:316] = 0.97
        h[285] = 1.0            # the highest bin sits on the left edge of the plateau: argmax would say 285
        bin_ms = 60 / 124 * 1000 / 484
        assert abs(j1.spitze_ms(h, 60 / 124) - 300.0 * bin_ms) < 3.0

    def test_phase_ueber_den_kreisrand(self):
        import numpy as np
        h = np.zeros(484)
        h[[480, 481, 482, 483, 0, 1, 2]] = [0.6, 0.8, 0.95, 1.0, 0.95, 0.8, 0.6]
        ms = j1.spitze_ms(h, 60 / 124)
        assert min(ms, 483.87 - ms) < 2.0
