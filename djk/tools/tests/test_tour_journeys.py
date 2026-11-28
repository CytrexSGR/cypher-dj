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
        t.fuehre(j4.grundschritte)
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
            t.fuehre(j4.grundschritte)
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

    def __init__(self, export, wirt_laeuft=True, export_ohne=None, fehl=(), export_warp=None, audio_fehlt_zuerst=0):
        self.aufrufe = []
        self.audio_fehlt_zuerst = audio_fehlt_zuerst   # that many proj_export calls answer audio_fehlt before the clip is ready (None: never ready)
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
        if name == "proj_export" and (self.audio_fehlt_zuerst is None or self.audio_fehlt_zuerst > 0):
            if self.audio_fehlt_zuerst is not None:
                self.audio_fehlt_zuerst -= 1
            return {"fehler": "audio_fehlt", "text": "audio clip c2 is still being prepared; try again in a moment", "_fehler": True}
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


def hole(pfad):
    with urllib.request.urlopen(urllib.request.Request(SEITE + pfad, headers={"x-djk-quelle": "cypher"}), timeout=5) as r:
        return json.load(r)


def antwort(name, a):
    if name == "spur":
        return post("/spur", a)
    if name == "spur_stopp":
        return post("/spur/stopp", a)
    if name == "spuren":
        return hole("/spur")
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
        fehler = bool(j.pop("_fehler", False)) if isinstance(j, dict) else False
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
        self.spuren = {}                     # name -> {pfad, v0, v1, beat0, beats, quelle}: automation tracks (linear moves on the bar grid)
        self.spur_modus = "gut"              # gut | sprung (the value jumps to the end at the anchor) | vor_anker (moves at once) | stopp_ignoriert | nicht_gelistet
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
                if self.path.startswith("/spur"):
                    seite.spur_fortschreiben()
                    liste = [] if seite.spur_modus == "nicht_gelistet" else [
                        {"name": n, "quelle": s["quelle"], "anker_beat": s["beat0"], "ende_beat": s["beat0"] + s["beats"],
                         "fahrten": [{"ziel": s["pfad"], "ab_takt": 1}], "abgelehnt": []} for n, s in seite.spuren.items()]
                    return self._senden(200, liste)
                if self.path.startswith("/lage"):
                    seite.spur_fortschreiben()
                    reg = dict(seite.regler)
                    if seite.rampe:
                        reg[seite.rampe["pfad"]] = round(seite.rampenwert(), 3)
                    for s in seite.spuren.values():
                        reg[s["pfad"]] = round(seite.spurwert(s), 3)
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
                if self.path == "/spur":
                    return self._senden(*seite.spur_start(k, quelle))
                if self.path == "/spur/stopp":
                    return self._senden(*seite.spur_stopp(k, quelle))
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

    def spurwert(self, s):
        b = self.beat()
        if self.spur_modus == "sprung":
            return s["v1"] if b >= s["beat0"] else s["v0"]
        beginn = s["beat0"] - 100 if self.spur_modus == "vor_anker" else s["beat0"]
        f = min(1.0, max(0.0, (b - beginn) / (s["beat0"] + s["beats"] - beginn)))
        return s["v0"] + (s["v1"] - s["v0"]) * f

    def spur_fortschreiben(self):
        """A finished track leaves its end value behind, like a finished move of the core."""
        for n in [n for n, s in self.spuren.items() if self.beat() >= s["beat0"] + s["beats"]]:
            s = self.spuren.pop(n)
            self.regler[s["pfad"]] = s["v1"]

    def spur_start(self, k, quelle):
        if quelle == "cypher" and self.gestoppt:
            return 409, {"fehler": "ki_gestoppt"}
        self.spur_fortschreiben()
        if k["name"] in self.spuren:
            return 409, {"fehler": "laeuft"}
        f = k["fahrten"][0]
        anker = math.floor(self.beat() / 4) * 4 + 4          # the next bar line
        aktuell = self.regler.get(f["ziel"], 0.0)
        self.spuren[k["name"]] = {"pfad": f["ziel"], "v0": aktuell, "v1": f["nach"], "beat0": float(anker), "beats": 4.0 * f["takte"], "quelle": quelle}
        return 200, {"ok": True, "name": k["name"], "anker_beat": anker, "anker_takt": anker // 4 + 1, "ende_beat": anker + 4 * f["takte"],
                     "teile": 1, "wirt": 0, "muster": 0, "quittung": {"status": 2, "grund": ""}, "abgelehnt": []}

    def spur_stopp(self, k, quelle):
        self.spur_fortschreiben()
        s = self.spuren.get(k["name"])
        if s is None:
            return 404, {"fehler": "keine_spur", "name": k["name"]}
        if self.spur_modus == "stopp_ignoriert":
            return 200, {"ok": True, "name": k["name"], "felder": 1, "wirt": 0}
        self.regler[s["pfad"]] = self.spurwert(s)
        del self.spuren[k["name"]]
        return 200, {"ok": True, "name": k["name"], "felder": 1, "wirt": 0}

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
    SCHRITTE = ["j5.registrieren", "j5.werkzeuge", "j5.acht_takte", "j5.spielt", "j5.uebernahme", "j5.stopp_cypher", "j5.spur"]

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
        t.fuehre(lambda tt: j2.schritte(tt, xrun=xrun, popup=False))
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


def wackelton(t, f):
    """A sine at f as it comes out of the key lock stretcher: the carrier sits 0.25 Hz low (149.52 to 149.71 Hz measured for 149.83), wanders +-0.5 Hz
    at 0.4 Hz and the level swells by 60 percent at 0.7 Hz."""
    import numpy as np
    phase = 2 * np.pi * (f - 0.25) * t - (0.5 / 0.4) * np.cos(2 * np.pi * 0.4 * t)
    return np.sin(phase) * (1 + 0.6 * np.sin(2 * np.pi * 0.7 * t))


def mix_signal(versatz_ms=0.0, halber_schlag=False, cent=0.0, bass_tausch=True, fx_wirkt=True, delle_beats=0.0, rate=48000, wackel=False, boden_db=None):
    """Two decks as pulse trains and tones, with the events of a J1 run (beats on the master clock):
    deck 1 plays from beat 100 to 188, deck 2 starts on beat 116 (`versatz_ms` / half a beat late), faders ramp over 16 bars from beat 124,
    the bass swap is at beat 156 (`delle_beats`: both marker tones are cancelled for that many beats right before it), an echo (extra kicks half a beat later) runs from beat 212 to 228 when `fx_wirkt`.
    `wackel`: the marker of deck 2 comes out of the key lock stretcher as measured on instance b (a carrier that wanders about +-0.5 Hz at 0.4 Hz and
    swells at 0.7 Hz, so a coherent line at the nominal pitch reads between 2 and 10 dB too low depending on where the window sits). `boden_db`: noise in
    the 90 to 160 Hz band that does not follow the faders or the EQ (the other deck's program in the marker's bin), its power in a +-1 Hz band at that
    level in dB. Returns (signal, Zustand)."""
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
    x = musik.MARKER_PEGEL["Tour Track One.wav"] * np.sin(2 * np.pi * musik.marker("Tour Track One.wav") * t) * gain_a
    f2 = musik.marker("Tour Track Two.wav") * 2 ** (cent / 1200)
    if wackel:
        x += musik.MARKER_PEGEL["Tour Track Two.wav"] * wackelton(t, f2) * gain_b
    else:
        x += musik.MARKER_PEGEL["Tour Track Two.wav"] * np.sin(2 * np.pi * f2 * t) * gain_b
    if boden_db is not None:
        spek = np.fft.rfft(np.random.default_rng(7).standard_normal(len(t)))
        frq = np.fft.rfftfreq(len(t), 1 / rate)
        spek[(frq < 90) | (frq > 160)] = 0
        # white noise cut to the band: 0.111 of unit variance puts -58 dB into a +-1 Hz band (measured), scaled to the level asked for
        # it follows the louder fader, as in the recordings: the floor in deck 2's bin falls 10 to 14 dB over the windows before the swap with deck 1's fader
        hoeher = np.maximum(fader_a(beat), fader_b(beat))
        x += np.fft.irfft(spek, len(t)) * 0.111 * 10 ** ((boden_db + 58 + hoeher + 20) / 20) * np.sqrt(rate * 120 / len(t))

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
        assert st["werte"]["deck1_abfall_db"] > 15 and st["werte"]["deck2_anstieg_db"] > 20      # deck 1 has the other deck's kicks in its band

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

    def test_marke_aus_dem_keylock_wird_im_band_gemessen(self):
        """The marker of deck 2 as the stretcher delivers it is not a line: read as a line at the nominal pitch the same steady level moves by more than
        6 dB with the window position, as band power it moves by less than 1.5 dB."""
        import numpy as np
        t = np.arange(40 * 48000) / 48000
        x = 0.1 * wackelton(t, musik.marker("Tour Track Two.wav"))
        f = musik.marker("Tour Track Two.wav")
        zeilen = [j1.ton_db(x, f, s, s + 3.4) for s in np.arange(2.0, 30.0, 0.25)]
        band = [j1.ton_band_db(x, f, s, s + 3.4) for s in np.arange(2.0, 30.0, 0.25)]
        assert max(zeilen) - min(zeilen) > 6.0, (min(zeilen), max(zeilen))
        assert max(band) - min(band) < 1.5, (min(band), max(band))

    def test_band_misst_eine_reine_marke_wie_eine_linie(self):
        import numpy as np
        t = np.arange(8 * 48000) / 48000
        x = 0.1 * np.sin(2 * np.pi * 100.0 * t)
        assert abs(j1.ton_band_db(x, 100.0, 1.0, 4.4) - j1.ton_db(x, 100.0, 1.0, 4.4)) < 0.5

    def test_basstausch_mit_wackelnder_marke_und_boden_ist_gruen(self, tmp_path):
        """As recorded on instance b: deck 2's marker comes out of the key lock stretcher wandering and swelling, and the other deck's program puts a
        floor into the marker bins that follows the louder fader (deck 1's, down 10 to 14 dB over the windows before the swap, -61 dB at 100 Hz after
        it). The rise has to clear the 12 dB with room: read with the median of the compensated windows it is 12.7 dB here, as a low quartile 15.8."""
        st = self._schritt(tmp_path, j1.schritt_eq, wackel=True, boden_db=-68.0)
        assert st["urteil"] == "OK", st
        assert st["werte"]["deck1_abfall_db"] > 12 + 1 and st["werte"]["deck2_anstieg_db"] > 12 + 2.5, st["werte"]

    def test_ohne_basstausch_mit_wackelnder_marke_und_boden_ist_rot(self, tmp_path):
        """The wider band must not make the step pass when the low kill is missing: deck 2's marker then stays at its faded level."""
        st = self._schritt(tmp_path, j1.schritt_eq, bass_tausch=False, wackel=True, boden_db=-68.0)
        assert st["urteil"] == "FEHL" and "does not show" in st["grund"], st

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


# ---------------------------------------------------------------- J2 extension: pop-up, slices, warp, devices

class InstanzX(FalscheInstanz):
    """`Instanz` stand-in with the folder the test loop is written to."""

    def __init__(self, url, shm):
        super().__init__(url)
        self.shm = str(shm)


class UhrZeit:
    """A virtual clock for `j2.time`: sleeping only advances it, so the steps run in no time and the recording offsets they compute stay true."""

    def __init__(self):
        self.jetzt = 1000.0

    def sleep(self, s):
        self.jetzt += s

    def monotonic(self):
        return self.jetzt

    strftime = staticmethod(time.strftime)
    time = staticmethod(time.time)


def wav_aus(pfad, x, rate=48000):
    import numpy as np
    pcm = (np.clip(np.asarray(x, dtype="float64"), -1, 1) * 32767).astype("<i2")
    with wave.open(str(pfad), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(np.repeat(pcm[:, None], 2, axis=1).tobytes())


def ton_folge(folge, scheibe_s, skala=1.0, pegel=0.5, rate=48000):
    """The slices `folge` (1-based) one after the other, each `scheibe_s` long, as the synthetic cell sounds them (times the pitch factor `skala`)."""
    import numpy as np
    from tour import j2
    n = int(scheibe_s * rate)
    t = np.arange(n) / rate
    return np.concatenate([pegel * np.sin(2 * np.pi * j2.SCHEIBEN_HZ[i - 1] * skala * t) for i in folge])


def spiel(erste, sek, scheibe_s, skala=1.0, rueckwaerts=False):
    """What the cell plays for `sek` seconds from slice `erste` on, wrapping round after slice 8 (or running down when `rueckwaerts`)."""
    n = int(sek / scheibe_s) + 1
    schritt = -1 if rueckwaerts else 1
    folge = [(erste - 1 + schritt * k) % 8 + 1 for k in range(n)]
    return ton_folge(folge, scheibe_s, skala)[:int(sek * 48000)]


def luecke(sek=1.6):
    import numpy as np
    return np.zeros(int(sek * 48000))


def scheiben_aufnahme(sprung3=3, sprung6=6, rueckwaerts_erste=8):
    """A recording of the four pieces j2.scheiben plays: from the top, slice 3, slice 6, backwards from the top. The first slice of the middle two can be
    wrong on purpose."""
    import numpy as np
    s = 0.5 * 60 / 128
    return np.concatenate([luecke(), spiel(1, 2.2, s), luecke(), spiel(sprung3, 2.2, s), luecke(), spiel(sprung6, 2.2, s), luecke(),
                           spiel(rueckwaerts_erste, 2.2, s, rueckwaerts=True), luecke()])


def warp_aufnahme(bpm=112.0, laenge_s=None, tonhoehen=(1.0, 112 / 128, 2.0)):
    """Three pieces of four cell lengths each, one per warp variant; the cell is `laenge_s` long (default: four beats at `bpm`)."""
    import numpy as np
    laenge = laenge_s or 4 * 60 / bpm
    teile = [luecke()]
    for skala in tonhoehen:
        teile += [spiel(1, 4 * laenge, laenge / 8, skala), luecke()]
    return np.concatenate(teile)


def geraete_aufnahme(zuwachs=True, rate=48000):
    """3.5 s of a clean steady tone, then 4.5 s of it, driven into a saturator when `zuwachs`."""
    import numpy as np
    from tour import j2
    t = np.arange(int(8 * rate)) / rate
    ton = 0.5 * np.sin(2 * np.pi * j2.SCHEIBEN_HZ[0] * t)
    if zuwachs:
        ton[int(3.5 * rate):] = 0.5 * np.tanh(8 * ton[int(3.5 * rate):] / 0.5)
    return ton


class J2ErweitertSeite:
    """Fake page server for the J2 extension. It models what the steps measure: deck 1 is audible while its test cell plays, and its level follows the
    strip fader, the strip mute and the cell's gain; the master tempo follows /tempo; a scene with a tempo sets it. The recordings (`aufnahmen`, WAV files)
    are handed out one per recording in order."""

    def __init__(self, tmp, aufnahmen=(), strip_wirkt=True, gain_wirkt=True, ansicht_merkt=True, szene_tempo=True, entfernen_wirkt=True):
        self.tmp = Path(tmp)
        self.entfernen_wirkt, self.insert_da = entfernen_wirkt, False
        self.aufnahmen = list(aufnahmen)
        self.strip_wirkt, self.gain_wirkt, self.ansicht_merkt, self.szene_tempo = strip_wirkt, gain_wirkt, ansicht_merkt, szene_tempo
        self.spielt = False
        self.fader_db, self.mute, self.gain_db = 0.0, False, 0.0
        self.ansicht = "dj"
        self.bpm = 120.0
        self.name = "starter"
        self.scheiben = None
        self.felder = []
        self.rufe = []
        self.starts = 0
        self.szenen = {}
        self.loop_da = lambda: any((self.tmp / "shm" / "loops").glob("tour-j2-scheiben/loop.json"))
        seite = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _senden(self, code, obj, roh=None):
                roh = roh if roh is not None else json.dumps(obj).encode()
                self.send_response(code)
                self.send_header("content-type", "application/json" if roh[:1] in (b"{", b"[") else "text/javascript")
                self.send_header("content-length", str(len(roh)))
                self.end_headers()
                self.wfile.write(roh)

            def _pegel(self):
                if not seite.spielt:
                    db = -200.0
                elif seite.mute and seite.strip_wirkt:
                    db = -200.0
                else:
                    db = -6.0 + (seite.fader_db if seite.strip_wirkt else 0.0) + (seite.gain_db if seite.gain_wirkt else 0.0)
                kan = {k: {"n": 20, "max_db": -200.0, "median_db": -200.0} for k in ("deck/2", "pad/1", "pad/2")}
                kan["deck/1"] = {"n": 20, "max_db": db, "median_db": db}
                kan["master"] = {"n": 20, "max_db": db, "median_db": db}
                return {"sek": 1, "kanaele": kan}

            def _antwort(self, methode, k):
                pfad = self.path.split("?")[0]
                seite.rufe.append((methode, pfad, k))
                k = k if isinstance(k, dict) else {}
                if pfad == "/pegel":
                    return self._senden(200, self._pegel())
                if pfad == "/lage":
                    return self._senden(200, {"uhr": {"bpm": seite.bpm, "beat": 12.0}})
                if pfad == "/tempo":
                    seite.bpm = float(k["bpm"])
                    return self._senden(200, {"ok": True})
                if pfad == "/controller/ansicht":
                    if seite.ansicht_merkt:
                        seite.ansicht = k.get("ansicht")
                    return self._senden(200, {"ok": True})
                if pfad == "/controller/pult":
                    return self._senden(200, {"produktion": False, "ansicht": seite.ansicht})
                if pfad == "/loopdeck/gross.js":
                    return self._senden(200, None, b"export function bindeLoopdeckGross() {}")
                if pfad == "/session/unten.js":
                    return self._senden(200, None, b"export const TABS = ['CLIP', 'DEVICES'];\nexport const x = 1;")
                if pfad == "/loops":
                    return self._senden(200, [{"name": "tour-j2-scheiben", "ladbar": True}] if seite.loop_da() else [])
                if pfad == "/loopdeck/stand":
                    zelle = {"name": seite.name, "frames": 90000, "scheiben": seite.scheiben}
                    spuren = [{"spur_id": f"sp{i}", "zellen": [zelle if i == 4 else None] * 8, "lauf": {"zelle": 1 if seite.spielt and i == 4 else None}}
                              for i in range(1, 5)]
                    return self._senden(200, {"decks": {"1": {"spuren": spuren}, "2": {"spuren": spuren}}})
                if pfad == "/loopdeck/start" or pfad == "/loopdeck/sprung":
                    seite.spielt = True
                if pfad == "/loopdeck/stopp":
                    seite.spielt = False
                if pfad == "/loopdeck/spur":
                    seite.fader_db = float(k.get("fader_db", seite.fader_db))
                    seite.mute = bool(k.get("mute", seite.mute))
                if pfad == "/session/zelle":
                    seite.felder.append(k)
                    seite.gain_db = float(k.get("gain_db", seite.gain_db))
                    seite.name = k.get("name", seite.name)
                    if "scheiben" in k:
                        seite.scheiben = k["scheiben"]
                if pfad == "/session/scheiben":
                    seite.scheiben = {"teilung": k["teilung"], "grenzen": [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5], "folge": list(range(1, 9))}
                    return self._senden(200, {"ok": True, "grenzen": seite.scheiben["grenzen"]})
                if pfad == "/session/szene_neu":
                    return self._senden(200, {"ok": True, "zeile": 3})
                if pfad == "/session/szene_aendern":
                    seite.szenen[k["zeile"]] = k.get("bpm")
                if pfad == "/session/szene":
                    bpm = seite.szenen.get(k.get("zeile"))
                    if bpm is not None and seite.szene_tempo:
                        seite.bpm = float(bpm)
                    seite.spielt = False
                    return self._senden(200, {"ok": True, "gestartet": [], "gestoppt": [], **({"tempo": bpm} if bpm is not None and seite.szene_tempo else {})})
                if pfad == "/proj/aktuell":
                    return self._senden(200, {"rev": 5, "projekt": {"spuren": [{"id": "sp4", "inserts": [{"id": "ins-1"}] if seite.insert_da else []}]}})
                if pfad == "/proj/aendern":
                    befehl = (k.get("befehle") or [{}])[0].get("befehl")
                    seite.insert_da = befehl == "insert_setzen" or (seite.insert_da and not seite.entfernen_wirkt)
                    return self._senden(200, {"rev": 5, "projekt": {"spuren": [{"id": "sp4", "inserts": [{"id": "ins-1", "art": "saett"}]}]}})
                if pfad == "/mitschnitt/start":
                    seite.starts += 1
                    datei = seite.aufnahmen[seite.starts - 1] if len(seite.aufnahmen) >= seite.starts else str(seite.tmp / "nichts.wav")
                    return self._senden(200, {"ok": True, "datei": str(datei)})
                if pfad == "/mitschnitt/stopp":
                    datei = seite.aufnahmen[seite.starts - 1] if 0 < seite.starts <= len(seite.aufnahmen) else str(seite.tmp / "nichts.wav")
                    return self._senden(200, {"ok": True, "datei": str(datei), "sekunden": 8.0, "luecken": 0, "spruenge": 0})
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

    def pfade(self):
        return [p for _, p, _ in self.rufe]

    def stopp(self):
        self.srv.shutdown()
        self.srv.server_close()


class TestJ2Erweitert:
    """The pop-up, slice, warp and device steps of J2 against a fake page and prepared recordings (no studio, no instance)."""

    @pytest.fixture
    def umgebung(self, tmp_path, monkeypatch):
        from tour import j2
        monkeypatch.setattr(j2, "time", UhrZeit())
        monkeypatch.setattr(j2, "plan", lambda kurz: dict(KLEIN))
        echt = L.Tour.warte_bis
        monkeypatch.setattr(L.Tour, "warte_bis", lambda self, f, frist_s, text="the condition": echt(self, f, min(frist_s, 1.0), text))   # a wait that cannot succeed fails after a second
        seiten = []

        def seite(aufnahmen=(), **kw):
            dateien = []
            for i, x in enumerate(aufnahmen):
                d = tmp_path / f"aufnahme{i}.wav"
                wav_aus(d, x)
                dateien.append(d)
            s = J2ErweitertSeite(tmp_path, dateien, **kw)
            seiten.append(s)
            return s
        yield j2, seite, tmp_path
        for s in seiten:
            s.stopp()

    def lauf(self, umgebung, seite, *namen):
        j2, _, tmp = umgebung
        t = L.Tour("j2", InstanzX(seite.url, tmp / "shm"), tmp / "bericht", True)
        z = j2._Satz()

        def schritte(tt):
            try:
                for n in namen:
                    getattr(j2, f"_{n}")(tt, z, j2.plan(True))
            finally:
                if z.sc_ordner is not None:
                    import shutil
                    shutil.rmtree(z.sc_ordner, ignore_errors=True)
        t.fuehre(schritte)
        return {s["kennung"]: s for s in t.bericht().schritte}, t.bericht()

    # -- the measuring functions

    def test_loop_is_a_library_loop_the_core_accepts(self, tmp_path):
        from tour import j2
        d = j2.loop_schreiben(tmp_path)
        meta = json.loads((d / "loop.json").read_text())
        assert (meta["schema"], meta["beats"], meta["bpm"], meta["frames"], meta["datei"]) == (1, 4, 128, 90000, "loop.f32")
        assert (d / "loop.f32").stat().st_size == 90000 * 8                    # loops.ts loopGrund: frames * 8 bytes of stereo float32
        import numpy as np
        x = np.frombuffer((d / "loop.f32").read_bytes(), dtype="<f4").reshape(-1, 2)
        assert np.array_equal(x[:, 0], x[:, 1]) and abs(float(np.max(np.abs(x))) - j2.SCHEIBEN_PEGEL) < 1e-3

    def test_every_slice_tone_has_whole_cycles_so_a_repeat_is_seamless(self):
        from tour import j2
        for f in j2.SCHEIBEN_HZ:
            assert abs(f * 11250 / 48000 - round(f * 11250 / 48000)) < 1e-9
        assert all(b / a > 1.2 for a, b in zip(j2.SCHEIBEN_HZ, j2.SCHEIBEN_HZ[1:]))     # neighbours far enough apart to tell by ear of the analysis

    def test_runs_name_the_slices_in_the_order_they_played(self):
        from tour import j2
        x = spiel(3, 2.0, 0.234)
        r = j2.scheiben_laeufe(j2.ton_spur(x))
        assert j2.folge_von(r, 6) == [3, 4, 5, 6, 7, 8]
        assert abs(j2.lauflaenge_s(r) - 0.234) < 0.02

    def test_silence_splits_the_recording_into_pieces(self):
        import numpy as np
        from tour import j2
        x = np.concatenate([luecke(), spiel(1, 1.0, 0.234), luecke(), spiel(5, 1.0, 0.234), luecke()])
        teile = j2.hoerstuecke(j2.ton_spur(x))
        assert [j2.folge_von(j2.scheiben_laeufe(t), 2) for t in teile] == [[1, 2], [5, 6]]

    def test_period_and_pitch_of_a_stretched_and_pitched_cell(self):
        from tour import j2
        r = j2.scheiben_laeufe(j2.ton_spur(spiel(1, 9.0, 2.1429 / 8, 2.0)), skala=2.0)
        assert abs(j2.periode_s(r) - 2.1429) < 0.03
        assert abs(j2.tonhoehe_verhaeltnis(r) - 2.0) < 0.02

    def test_the_expected_pitch_factor_keeps_the_slices_apart_after_an_octave(self):
        from tour import j2
        x = spiel(1, 2.0, 0.234, 2.0)                       # transposed up an octave: slice 1 sounds where slice 4 sits untransposed
        assert j2.folge_von(j2.scheiben_laeufe(j2.ton_spur(x), skala=2.0), 5) == [1, 2, 3, 4, 5]
        assert j2.folge_von(j2.scheiben_laeufe(j2.ton_spur(x), skala=1.0), 2)[0] != 1

    def test_distortion_is_told_from_a_clean_tone(self):
        from tour import j2
        x = geraete_aufnahme()
        assert j2.klirr_db(x, j2.SCHEIBEN_HZ[0], 1.0, 3.2) < -60
        assert j2.klirr_db(x, j2.SCHEIBEN_HZ[0], 6.0, 7.7) > -20

    # -- the steps

    def test_pop_up_step_is_green_when_every_effect_is_measured(self, umgebung):
        _, seite, _ = umgebung
        s, b = self.lauf(umgebung, seite(), "popup")
        a = s["j2.popup"]
        assert a["urteil"] == "OK", b.markdown()
        v = a["werte"]
        assert v["ansicht_offen"] == "studio" and v["ansicht_zu"] == "dj"
        assert abs(v["strip_fader_delta_db"] + 12) < 0.5 and abs(v["clip_gain_delta_db"] + 6) < 0.5
        assert v["szene_bpm_gemessen"] == 116.0 and v["reiter"] == ["CLIP", "DEVICES"]

    def test_pop_up_step_cleans_up_what_it_made(self, umgebung):
        _, seite_, _ = umgebung
        seite = seite_()
        self.lauf(umgebung, seite, "popup")
        pfade = seite.pfade()
        assert "/session/szene_loeschen" in pfade, "the scene row it created must go again"
        assert ("POST", "/controller/ansicht", {"ansicht": "dj"}) in seite.rufe
        assert ("POST", "/tempo", {"bpm": 120.0}) in seite.rufe, "the master tempo before the step is put back"

    def test_pop_up_strip_fader_that_changes_nothing_is_red(self, umgebung):
        _, seite, _ = umgebung
        s, _ = self.lauf(umgebung, seite(strip_wirkt=False), "popup")
        assert s["j2.popup"]["urteil"] == "FEHL" and "strip fader" in s["j2.popup"]["grund"]

    def test_pop_up_clip_gain_that_changes_nothing_is_red(self, umgebung):
        _, seite, _ = umgebung
        s, _ = self.lauf(umgebung, seite(gain_wirkt=False), "popup")
        assert s["j2.popup"]["urteil"] == "FEHL" and "clip gain" in s["j2.popup"]["grund"]

    def test_pop_up_view_that_is_not_reported_is_red(self, umgebung):
        _, seite, _ = umgebung
        s, _ = self.lauf(umgebung, seite(ansicht_merkt=False), "popup")
        assert s["j2.popup"]["urteil"] == "FEHL" and "view" in s["j2.popup"]["grund"]

    def test_scene_whose_tempo_never_shows_is_red(self, umgebung, monkeypatch):
        j2, seite_, _ = umgebung
        seite = seite_(szene_tempo=False)
        s, _ = self.lauf(umgebung, seite, "popup")
        assert s["j2.popup"]["urteil"] == "FEHL" and "scene" in s["j2.popup"]["grund"]

    def test_slice_step_hears_launch_and_order(self, umgebung):
        _, seite, _ = umgebung
        s, b = self.lauf(umgebung, seite([scheiben_aufnahme()]), "scheiben")
        a = s["j2.scheiben"]
        assert a["urteil"] == "OK", b.markdown()
        assert a["werte"]["folgen"] == [[1, 2, 3, 4, 5, 6], [3, 4, 5, 6, 7, 8], [6, 7, 8, 1, 2, 3], [8, 7, 6, 5, 4, 3]]
        assert a["werte"]["grenzen"] == [0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5]

    def test_a_slice_launch_that_plays_the_wrong_part_is_red(self, umgebung):
        _, seite, _ = umgebung
        s, _ = self.lauf(umgebung, seite([scheiben_aufnahme(sprung3=1)]), "scheiben")
        assert s["j2.scheiben"]["urteil"] == "FEHL" and "slice 3" in s["j2.scheiben"]["grund"]

    def test_a_slot_order_that_is_not_heard_is_red(self, umgebung):
        _, seite, _ = umgebung
        s, _ = self.lauf(umgebung, seite([scheiben_aufnahme(rueckwaerts_erste=1)]), "scheiben")
        assert s["j2.scheiben"]["urteil"] == "FEHL" and "backwards" in s["j2.scheiben"]["grund"]

    def test_slice_step_without_a_recording_is_red_not_green(self, umgebung):
        _, seite, _ = umgebung
        s, _ = self.lauf(umgebung, seite([]), "scheiben")
        assert s["j2.scheiben"]["urteil"] == "FEHL"

    def test_slice_step_puts_the_identity_order_back(self, umgebung):
        _, seite_, _ = umgebung
        seite = seite_([scheiben_aufnahme()])
        self.lauf(umgebung, seite, "scheiben")
        assert seite.scheiben["folge"] == [1, 2, 3, 4, 5, 6, 7, 8]

    def test_warp_step_is_green_when_the_cell_keeps_the_grid(self, umgebung):
        _, seite, _ = umgebung
        s, b = self.lauf(umgebung, seite([warp_aufnahme()]), "warp")
        a = s["j2.warp"]
        assert a["urteil"] == "OK", b.markdown()
        v = a["werte"]
        assert abs(v["keylock on"]["laenge_s"] - 4 * 60 / 112) < 0.04 and abs(v["keylock on"]["tonhoehe"] - 1.0) < 0.02
        assert abs(v["keylock off"]["tonhoehe"] - 112 / 128) < 0.02 and abs(v["transpose +12"]["tonhoehe"] - 2.0) < 0.02

    def test_a_cell_that_ignores_the_master_tempo_is_red(self, umgebung):
        _, seite, _ = umgebung
        s, _ = self.lauf(umgebung, seite([warp_aufnahme(laenge_s=4 * 60 / 128)]), "warp")
        assert s["j2.warp"]["urteil"] == "FEHL" and "lasts" in s["j2.warp"]["grund"]

    def test_keylock_that_moves_the_pitch_is_red(self, umgebung):
        _, seite, _ = umgebung
        s, _ = self.lauf(umgebung, seite([warp_aufnahme(tonhoehen=(0.92, 112 / 128, 2.0))]), "warp")
        assert s["j2.warp"]["urteil"] == "FEHL" and "pitch" in s["j2.warp"]["grund"]

    def test_warp_step_restores_the_cell_and_the_base_tempo(self, umgebung):
        _, seite_, _ = umgebung
        seite = seite_([warp_aufnahme()])
        self.lauf(umgebung, seite, "warp")
        assert seite.felder[-1] == {"spur_id": "sp4", "zelle": 1, "keylock": None, "transponieren": None}
        assert seite.bpm == 128.0

    def test_device_step_is_green_when_the_saturator_adds_harmonics(self, umgebung):
        _, seite, _ = umgebung
        s, b = self.lauf(umgebung, seite([geraete_aufnahme()]), "geraete")
        a = s["j2.geraete"]
        assert a["urteil"] == "OK", b.markdown()
        assert a["werte"]["klirr_vorher_db"] < -60 and a["werte"]["zuwachs_db"] > 30 and a["werte"]["insert_id"] == "ins-1"

    def test_a_device_that_changes_nothing_is_red(self, umgebung):
        _, seite, _ = umgebung
        s, _ = self.lauf(umgebung, seite([geraete_aufnahme(zuwachs=False)]), "geraete")
        assert s["j2.geraete"]["urteil"] == "FEHL" and "saturator" in s["j2.geraete"]["grund"]

    def test_device_step_removes_the_device_again(self, umgebung):
        _, seite_, _ = umgebung
        seite = seite_([geraete_aufnahme()])
        self.lauf(umgebung, seite, "geraete")
        aendern = [k for m, p, k in seite.rufe if p == "/proj/aendern"]
        assert aendern[0]["befehle"][0]["befehl"] == "insert_setzen" and aendern[0]["befehle"][0]["art"] == "saett"
        assert aendern[-1]["befehle"] == [{"befehl": "insert_entfernen", "insert_id": "ins-1"}]

    def test_a_device_that_stays_on_the_track_is_red(self, umgebung):
        _, seite, _ = umgebung
        s, _ = self.lauf(umgebung, seite([geraete_aufnahme()], entfernen_wirkt=False), "geraete")
        assert s["j2.geraete"]["urteil"] == "FEHL" and "not removed" in s["j2.geraete"]["grund"]

    def test_the_test_loop_leaves_the_instance_folder_when_the_steps_are_done(self, umgebung):
        j2, seite_, tmp = umgebung
        seite = seite_([geraete_aufnahme()])
        s, _ = self.lauf(umgebung, seite, "geraete")
        assert not (tmp / "shm" / "loops" / "tour-j2-scheiben").exists()

    def test_the_four_steps_come_after_the_set_when_pop_up_is_on(self, umgebung):
        j2, seite_, tmp = umgebung
        wav = tmp / "set.wav"
        sinus_wav(wav, 2.0)
        seite = J2Seite(str(wav))
        try:
            t = L.Tour("j2", FalscheInstanz(seite.url), tmp / "bericht2", True)
            t.fuehre(lambda tt: j2.schritte(tt, xrun=FalscheXrun(0), popup=True))
            k = [s["kennung"] for s in t.bericht().schritte]
        finally:
            seite.stopp()
        assert k[:8] == ["j2.aufbau", "j2.basis", "j2.set", "j2.szenen", "j2.container", "j2.apc20", "j2.mitschnitt", "j2.datei"]
        assert k[8:] == ["j2.popup", "j2.scheiben", "j2.warp", "j2.geraete"]

# ---------------------------------------------------------------- J3 extension (1.0 features): fakes, no running studio

def fx_wav(pfad, x):
    """Writes a float array of shape (frames, 2) as a 16 bit stereo file (clipped to full scale)."""
    import numpy as np
    pcm = (np.clip(x, -1.0, 1.0) * 32767).astype("<i2")
    with wave.open(str(pfad), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(48000)
        w.writeframes(pcm.tobytes())


def fx_render(proj, von, bis, ausklang, flags):
    """A small model of the engine for the effect steps: sources are gated sines, the lane is a gain ramp in dB, an EQ cut, compressor,
    saturator and limiter act on the track, the pan law splits it, a Hall return adds a noise tail. `flags` switch single effects off."""
    import numpy as np
    sr = 48000
    n = int((bis - von + (ausklang or 0)) * 0.5 * sr)
    aus = np.zeros((n, 2))
    wet = np.zeros(n)
    for tr in proj["spuren"]:
        x = np.zeros(n)
        for clip in tr["clips"]:
            for no in clip["noten"]:
                a = int(no["beat"] * 0.5 * sr)
                b = min(n, a + int(no["laenge"] * 0.5 * sr))
                tt = np.arange(b - a) / sr
                if tr["parameter"].get("cutoff") == 0.0:
                    x[a:b] += 0.02 * np.sin(2 * np.pi * 130 * tt)
                else:
                    x[a:b] += 0.15 * np.sin(2 * np.pi * 150 * tt) + 0.02 * np.sin(2 * np.pi * 3000 * tt)
        if "lane_ignoriert" not in flags:
            for ln in tr["lanes"]:
                p = ln["punkte"]
                db = np.interp(np.arange(n) / sr / 0.5, [q["beat"] for q in p], [q["wert"] for q in p])
                x = x * 10 ** (db / 20)
        for ins in sorted(tr["inserts"], key=lambda i: i["pos"]):
            w, art = ins["werte"], ins["art"]
            if art == "utility":
                x = x * 10 ** (w["gain"] / 20)
            elif art == "eq" and "eq_wirkt_nicht" not in flags and w.get("b1/gain", 0) < 0:
                spek = np.fft.rfft(x)
                f = np.fft.rfftfreq(n, 1 / sr)
                spek[(f >= 120) & (f < 250)] *= 10 ** (w["b1/gain"] / 20)
                x = np.fft.irfft(spek, n)
            elif art == "komp" and "komp_wirkt_nicht" not in flags:
                thr = 10 ** (w["schwelle"] / 20)
                gross = np.abs(x) > thr
                x = np.where(gross, np.sign(x) * (thr + (np.abs(x) - thr) / w["ratio"]), x)
            elif art == "saett" and "saett_wirkt_nicht" not in flags:
                x = np.tanh(10 ** (w["drive"] / 20) * x) * 10 ** (w["out"] / 20)
            elif art == "lim" and "lim_wirkt_nicht" not in flags:
                x = np.clip(x, -(10 ** (w["decke"] / 20)), 10 ** (w["decke"] / 20))
        if "pdc_kaputt" in flags and tr["inserts"]:
            x = np.concatenate([np.zeros(69), x[:-69]])
        winkel = (tr["pan"] + 1) * math.pi / 4
        aus[:, 0] += x * math.cos(winkel)
        aus[:, 1] += x * math.sin(winkel)
        for s in tr["sends"]:
            ret = next((r for r in proj["returns"] if r["id"] == s["id"]), None)
            if ret and ret["hall"]["an"] and "hall_wirkt_nicht" not in flags and s["db"] > -60:
                wet += x * 10 ** (s["db"] / 20)
    if wet.any():
        ir = np.random.default_rng(1).normal(size=6 * sr) * np.exp(-np.arange(6 * sr) / sr / 1.5) * 0.004
        lang = np.fft.irfft(np.fft.rfft(wet, 2 ** 21) * np.fft.rfft(ir, 2 ** 21), 2 ** 21)[:n]
        aus += lang[:, None]
    return aus


class J3ErwSeite:
    """Fake instance page for the extension: GET /pegel, POST /proj/export_midi, POST /proj/einsammeln, GET /proj/export_zip, POST /proj/import_zip."""

    def __init__(self, tmp):
        self.tmp = Path(tmp)
        self.einsammeln = {"kopiert": 0, "schon_da": 1, "fehlt": [], "abweichend": [], "bytes": 0, "aufgeschoben": 0, "fehlt_grund": {}, "kits": {}}
        self.einsammeln_codes = [200]           # the answers in turn: 409 first stands for a transport that has not stopped yet
        self.midi_tausch = None                 # (old note, new note): the exported file holds another note than the project
        self.import_slug = "tour-j3-2"
        self.zip_ohne_audio = False
        self.aufrufe = []
        seite = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def antwort(self, code, roh, typ="application/json"):
                self.send_response(code)
                self.send_header("content-type", typ)
                self.send_header("content-length", str(len(roh)))
                self.end_headers()
                self.wfile.write(roh)

            def do_GET(self):
                seite.aufrufe.append(("GET", self.path, self.headers.get("x-djk-quelle")))
                if self.path.startswith("/pegel"):
                    return self.antwort(200, json.dumps({"sek": 1, "kanaele": {"master": {"n": 20, "max_db": -30.0, "median_db": -30.0}}}).encode())
                if self.path.startswith("/proj/export_zip"):
                    import io
                    import zipfile
                    puffer = io.BytesIO()
                    with zipfile.ZipFile(puffer, "w") as zz:
                        zz.writestr("project.json", "{}")
                        if not seite.zip_ohne_audio:
                            zz.writestr("audio/bounce-aaaaaaaa.wav", b"RIFF")
                    return self.antwort(200, puffer.getvalue(), "application/zip")
                self.antwort(404, b"{}")

            def do_POST(self):
                roh = self.rfile.read(int(self.headers.get("content-length") or 0))
                seite.aufrufe.append(("POST", self.path, self.headers.get("x-djk-quelle")))
                if self.path == "/proj/export_midi":
                    ordner = seite.tmp / "midi"
                    ordner.mkdir(parents=True, exist_ok=True)
                    datei = Path(J3MOD.schreibe_midi(ordner / "alle.mid"))
                    daten = datei.read_bytes()
                    if seite.midi_tausch:
                        alt, neu = seite.midi_tausch
                        daten = daten.replace(bytes([0x90, alt]), bytes([0x90, neu])).replace(bytes([0x80, alt]), bytes([0x80, neu]))
                    (ordner / "alle.mid").write_bytes(daten)
                    (ordner / "01-track-1.mid").write_bytes(daten)
                    return self.antwort(200, json.dumps({"ordner": str(ordner), "von_beat": 0, "bis_beat": 32, "dateien": [
                        {"art": "alle", "name": "p", "datei": "alle.mid", "noten": 4},
                        {"art": "spur", "spur_id": "s1", "name": "Track 1", "datei": "01-track-1.mid", "noten": 4}]}).encode())
                if self.path == "/proj/einsammeln":
                    code = seite.einsammeln_codes.pop(0) if len(seite.einsammeln_codes) > 1 else seite.einsammeln_codes[0]
                    if code != 200:
                        return self.antwort(code, json.dumps({"fehler": "transport_laeuft", "text": "music is playing"}).encode())
                    return self.antwort(200, json.dumps(seite.einsammeln).encode())
                if self.path == "/proj/import_zip":
                    return self.antwort(200, json.dumps({"ok": True, "slug": seite.import_slug, "kits_umbenannt": []}).encode())
                self.antwort(404, b"{}")

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def ende(self):
        self.server.shutdown()
        self.server.server_close()


class J3FxHand(J3Hand):
    """J3Hand plus a model of the project state the extension steps read: tracks, inserts, lanes, returns, history, files. `flags` switch single features
    off or break them (see fx_render and the branches below); the base answers of J3Hand stay as they are."""

    def __init__(self, tmp, export, flags=(), **kw):
        super().__init__(export, **kw)
        self.tmp = Path(tmp)
        self.flags = set(flags)
        self.fx = None
        self.n = 0
        self.fader = {"s2": -3.0}
        self.undo, self.redo = [], []
        self.geoeffnet = None
        self.mute_s1 = True
        bounce = self.tmp / "projekt" / "bounce" / "bounce-1.wav"
        bounce.parent.mkdir(parents=True, exist_ok=True)
        bounce.write_bytes(b"RIFF fake audio " * 100)
        import hashlib
        self.sha = hashlib.sha256(bounce.read_bytes()).hexdigest()
        self.audio_pfad = bounce

    # -- main project
    def lage(self):
        l = super().lage()
        for s in l["projekt"]["spuren"]:
            if s["id"] == "s1":
                s["mute"] = self.mute_s1
            if s["id"] == "s2":
                s["fader_db"] = self.fader["s2"]
        if self.geoeffnet and "spuren_anders" in self.flags:
            l["projekt"]["spuren"] = l["projekt"]["spuren"][:2]
        return l

    def rufe(self, name, argumente=None, timeout=120, erwartet=None):
        a = argumente or {}
        if self.fx is not None or (name == "proj_neu" and a.get("name", "").split("-")[-1] in ("auto", "eq", "komp", "hall", "saett", "lim", "pdc")):
            r = self.rufe_fx(name, a)
            if r is not None:
                self.aufrufe.append((name, a))
                return r
        r = self.rufe_haupt(name, a)
        if r is not None:
            self.aufrufe.append((name, a))
            return r
        return super().rufe(name, argumente, timeout)

    def rufe_haupt(self, name, a):
        import hashlib
        if name == "proj_aendern":
            for b in a.get("befehle", []):
                if b.get("befehl") == "spur_aendern" and "fader_db" in b:
                    self.undo.append(self.fader["s2"])
                    self.redo = []
                    self.fader["s2"] = b["fader_db"]
                elif b.get("befehl") == "spur_aendern" and "mute" in b:
                    self.mute_s1 = b["mute"]
            if any(b.get("befehl") == "warp_setzen" for b in a.get("befehle", [])):
                return None
            return {"rev": 5, "noten_zahl": {}, "_fehler": False}
        if name == "proj_undo":
            if not self.undo:
                return {"fehler": "nichts_zu_tun", "_fehler": True}
            self.redo.append(self.fader["s2"])
            self.fader["s2"] = self.undo.pop()
            if "undo_zu_weit" in self.flags and self.undo:       # takes two edits back instead of one
                self.fader["s2"] = self.undo.pop()
            return {"rev": 6, "_fehler": False}
        if name == "proj_redo":
            if self.redo and "redo_wirkt_nicht" not in self.flags:
                self.undo.append(self.fader["s2"])
                self.fader["s2"] = self.redo.pop()
            return {"rev": 7, "_fehler": False}
        if name == "proj_oeffnen":
            self.geoeffnet = a.get("slug")
            return {"slug": a.get("slug"), "_fehler": False}
        if name == "proj_dateien":
            fehlt = not self.audio_pfad.is_file()
            if not a.get("aktion"):
                return {"audio": [{"sha256": self.sha, "name": "Bounce", "pfad": str(self.audio_pfad), "clips": 1, "fehlt": fehlt}],
                        "fehlend": [self.sha] if fehlt or (self.geoeffnet and "audio_fehlt_nach_import" in self.flags) else [], "_fehler": False}
            if a["aktion"] == "finden":
                return {"fehler": "katalog_fehlt", "text": "no library catalogue", "_fehler": True}
            if a["aktion"] == "relink":
                if "relink_wirkt_nicht" not in self.flags:
                    ziel = self.tmp / "projekt" / "audio" / f"bounce-{a['sha256'][:8]}.wav"
                    ziel.parent.mkdir(parents=True, exist_ok=True)
                    ziel.write_bytes(Path(a["pfad"]).read_bytes())
                    if hashlib.sha256(ziel.read_bytes()).hexdigest() == a["sha256"]:
                        self.audio_pfad = ziel
                return {"ok": True, "_fehler": False}
        return None

    # -- the small projects of the effect steps
    def rufe_fx(self, name, a):
        if name == "proj_neu":
            self.n += 1
            self.fx = {"spuren": [], "returns": [], "tempo": 120.0, "z": 0}
            return {"slug": f"fx{self.n}", "rev": 0, "_fehler": False}
        p = self.fx

        def neu(kind):
            p["z"] += 1
            return f"{kind}{p['z']}"
        if name == "proj_aendern":
            for b in a.get("befehle", []):
                k = b["befehl"]
                if k == "spur_neu":
                    p["spuren"].append({"id": neu("s"), "name": b["name"], "art": "instrument", "parameter": b["geraet"]["parameter"], "pan": 0.0,
                                        "clips": [], "inserts": [], "lanes": [], "sends": [], "fader_db": 0.0})
                elif k == "spur_aendern":
                    next(s for s in p["spuren"] if s["id"] == b["spur_id"])["pan"] = b["pan"]
                elif k == "clip_neu":
                    next(s for s in p["spuren"] if s["id"] == b["spur_id"])["clips"].append({"id": neu("c"), "noten": b["noten"], "laenge_beats": b["laenge_beats"]})
                elif k == "auto_neu":
                    next(s for s in p["spuren"] if s["id"] == b["spur_id"])["lanes"].append({"id": neu("a"), "ziel": b["ziel"], "punkte": b["punkte"]})
                elif k == "insert_setzen":
                    s = next(s for s in p["spuren"] if s["id"] == b["strang_id"])
                    s["inserts"].append({"id": neu("i"), "art": b["art"], "an": True, "pos": b["pos"] + (0.5 if s["inserts"] else 0), "werte": b["werte"]})
                elif k == "insert_entfernen":
                    for s in p["spuren"]:
                        s["inserts"] = [i for i in s["inserts"] if i["id"] != b["insert_id"]]
                elif k == "return_neu":
                    p["returns"].append({"id": neu("r"), "name": b["name"], "hall": {"an": b["hall"]["an"]}})
                elif k == "send_setzen":
                    next(s for s in p["spuren"] if s["id"] == b["strang_id"])["sends"].append({"id": b["return_id"], "db": b["db"]})
            return {"rev": 3, "noten_zahl": {}, "_fehler": False}
        if name == "proj_lage":
            return {"slug": f"fx{self.n}", "projekt": {"tempo_bpm": p["tempo"], "returns": p["returns"], "spuren": [
                {"id": s["id"], "name": s["name"], "art": s["art"], "fader_db": s["fader_db"], "sends": s["sends"],
                 "clips": [{"id": c["id"], "art": "midi", "noten_zahl": len(c["noten"])} for c in s["clips"]],
                 "inserts": [{"id": i["id"], "art": i["art"], "an": i["an"], "werte": i["werte"]} for i in sorted(s["inserts"], key=lambda i: i["pos"])],
                 "lanes": [{"id": ln["id"], "ziel": ln["ziel"], "punkte_zahl": len(ln["punkte"])} for ln in s["lanes"]]} for s in p["spuren"]]}, "_fehler": False}
        if name == "proj_auto":
            ln = next(ln for s in p["spuren"] for ln in s["lanes"] if ln["id"] == a["lane_id"])
            return {"punkte": [{**q, "form": "linear"} for q in ln["punkte"]], "_fehler": False}
        if name == "proj_export":
            self.n += 1
            pfad = self.tmp / f"fx-{self.n}.wav"
            x = fx_render(p, a["von_beat"], a["bis_beat"], a.get("ausklang_beats"), self.flags)
            fx_wav(pfad, x)
            return {"datei": str(pfad), "spitze_db": 0.0, "ueber_decke": False, "_fehler": False}
        return None


def j3_erw_lauf(tmp_path, schritt, flags=(), seite_kw=None, z=None, monkeypatch=None):
    """Runs one extension step function against the fakes; the answer: (step as dict, hand, page, rc)."""
    seite = J3ErwSeite(tmp_path)
    for k, v in (seite_kw or {}).items():
        setattr(seite, k, v)
    try:
        hand = J3FxHand(tmp_path, {"datei": "x"}, flags)
        t = L.Tour("j3", J3Instanz(seite.url), tmp_path / "aus", kurz=True)
        zustand = {"name": "tour-j3-000000", "slug": "tour-j3", "midi_spur": "s1", "audio_spur": "s2", "tempo": 120.0, **(z or {})}
        rc = t.fuehre(lambda tt: schritt(tt, hand, zustand))
        schritte = {s["kennung"]: s for s in t.bericht().schritte}
        return next(iter(schritte.values())), hand, seite, rc
    finally:
        seite.ende()


class TestJ3Erweitert:
    @pytest.fixture(autouse=True)
    def schnell(self, monkeypatch):
        monkeypatch.setattr(J3MOD, "UNDO_PAUSE_S", 0.0)

    def gruen(self, s):
        assert s["urteil"] == "OK", (s["urteil"], s.get("grund"))

    # ---- pure helpers
    def test_lies_smf_round_trip_of_the_tours_file(self, tmp_path):
        pfad = J3MOD.schreibe_midi(tmp_path / "t.mid")
        smf = J3MOD.lies_smf(pfad)
        assert smf["ppq"] == 480 and abs(smf["tempo_bpm"] - 120.0) < 1e-6
        assert smf["noten"] == J3MOD.erwartete_noten()
        assert J3MOD.vergleiche_noten(smf["noten"], J3MOD.erwartete_noten()) == []

    def test_lies_smf_reads_running_status_and_skips_meta_and_controllers(self, tmp_path):
        # one track: tempo 100 BPM, controller 7, a note on with running status for a second note, note off written as note on with velocity 0
        ereignisse = (b"\x00\xff\x51\x03" + (600000).to_bytes(3, "big") + b"\x00\xb0\x07\x64" + b"\x00\x90\x3c\x50" + b"\x00\x3e\x60"
                      + b"\x83\x60\x3c\x00" + b"\x00\x3e\x00" + b"\x00\xff\x2f\x00")
        pfad = tmp_path / "r.mid"
        pfad.write_bytes(b"MThd" + struct.pack(">IHHH", 6, 0, 1, 480) + b"MTrk" + struct.pack(">I", len(ereignisse)) + ereignisse)
        smf = J3MOD.lies_smf(pfad)
        assert abs(smf["tempo_bpm"] - 100.0) < 1e-6
        assert smf["noten"] == [(60, 0.0, 1.0, 80), (62, 0.0, 1.0, 96)]

    def test_vergleiche_noten_names_a_changed_note_and_a_missing_one(self):
        soll = J3MOD.erwartete_noten()
        assert J3MOD.vergleiche_noten(soll[:3], soll)
        geaendert = [(soll[0][0] + 1,) + soll[0][1:]] + soll[1:]
        assert J3MOD.vergleiche_noten(geaendert, soll)
        spaeter = [(soll[0][0], soll[0][1] + 0.5) + soll[0][2:]] + soll[1:]
        assert J3MOD.vergleiche_noten(spaeter, soll)

    def test_versatz_samples_finds_the_shift_between_the_channels(self):
        import numpy as np
        rng = np.random.default_rng(3)
        n = rng.normal(size=48000) * np.exp(-np.arange(48000) / 4000)
        for lag in (0, 69, 86, -17):
            x = np.stack([np.roll(n, lag), n], axis=1)
            assert J3MOD.versatz_samples(x) == lag

    def test_huelle_je_fenster_reads_a_level_ramp(self):
        import numpy as np
        t = np.arange(8 * 48000) / 48000
        x = np.sin(2 * np.pi * 200 * t) * 10 ** ((-24 + 3 * t) / 20)
        pegel = J3MOD.huelle_je_fenster(np.stack([x, x], axis=1), 1.0, 8)
        assert [round(b - a, 1) for a, b in zip(pegel, pegel[1:])] == [3.0] * 7

    def test_anteil_ueber_db_rises_when_a_sine_is_clipped(self):
        import numpy as np
        t = np.arange(48000) / 48000
        sinus = np.sin(2 * np.pi * 130 * t) * 0.1
        hart = np.tanh(sinus * 200)
        a = J3MOD.anteil_ueber_db(np.stack([sinus, sinus], axis=1), 300)
        b = J3MOD.anteil_ueber_db(np.stack([hart, hart], axis=1), 300)
        assert b - a > 20

    # ---- the steps against the fakes
    def test_extension_is_off_with_a_fake_hand_and_on_when_asked(self, tmp_path):
        seite = J3ErwSeite(tmp_path)
        try:
            w = tmp_path / "e.wav"
            j3_wav(w, ton_sek=14.0)
            for erweitert, erwartet in ((None, 0), (True, len(J3_ERW_SCHRITTE))):
                hand = J3FxHand(tmp_path / f"h{erwartet}", {"datei": str(w), "frames": 768000, "spitze_db": -12.0, "ueber_decke": False, "limiter_db_max": 0})
                t = L.Tour("j3", J3Instanz(seite.url), tmp_path / f"aus{erwartet}", kurz=True)
                t.fuehre(lambda tt: J3MOD.schritte(tt, hand=hand, erweitert=erweitert))
                neue = [s["kennung"] for s in t.bericht().schritte if s["kennung"] in J3_ERW_SCHRITTE]
                assert len(neue) == erwartet
                if erwartet:
                    assert neue == list(J3_ERW_SCHRITTE)
                    # j3.take, j3.rack and j3.plugin, j3.zusammen and j3.resample are wired here but not modelled by J3FxHand (j3.take SKIPs: no sound source for a production project;
                    # their behaviour is covered by test_tour_j3_take.py, test_tour_j3_rack.py and test_tour_j3_plugin.py and test_tour_j3_mixdown.py): they must run, the others must be OK
                    alt = [k for k in J3_ERW_SCHRITTE if k not in ("j3.take", "j3.rack", "j3.plugin", "j3.zusammen", "j3.resample")]
                    assert {s["kennung"]: s["urteil"] for s in t.bericht().schritte if s["kennung"] in alt} == {k: "OK" for k in alt}
        finally:
            seite.ende()

    def test_env_filter_runs_only_the_named_extension_steps(self, tmp_path, monkeypatch):
        monkeypatch.setenv("CYPHERDJ_TOUR_J3_SCHRITTE", "j3.undo, j3.take")
        assert J3MOD.gewaehlte_schritte() == {"j3.undo", "j3.take"}
        seite = J3ErwSeite(tmp_path)
        try:
            w = tmp_path / "e.wav"
            j3_wav(w, ton_sek=14.0)
            hand = J3FxHand(tmp_path / "h", {"datei": str(w), "frames": 768000, "spitze_db": -12.0, "ueber_decke": False, "limiter_db_max": 0})
            t = L.Tour("j3", J3Instanz(seite.url), tmp_path / "aus", kurz=True)
            t.fuehre(lambda tt: J3MOD.schritte(tt, hand=hand, erweitert=True))
            ids = [s["kennung"] for s in t.bericht().schritte]
            assert [k for k in ids if k in J3_ERW_SCHRITTE] == ["j3.undo", "j3.take"]
            assert "j3.neu" in ids and "j3.datei" in ids
        finally:
            seite.ende()
        monkeypatch.delenv("CYPHERDJ_TOUR_J3_SCHRITTE")
        assert J3MOD.gewaehlte_schritte() is None

    def test_auto_green_and_red_when_the_lane_does_not_reach_the_audio(self, tmp_path):
        s, hand, _, _ = j3_erw_lauf(tmp_path, J3MOD._auto)
        self.gruen(s)
        assert abs(s["werte"]["steigung_db_je_fenster"] - 3.0) < 0.05
        s, *_ = j3_erw_lauf(tmp_path / "b", J3MOD._auto, flags={"lane_ignoriert"})
        assert s["urteil"] == "FEHL" and s["grund"] == "lane_nicht_im_audio"

    def test_eq_green_and_red_when_the_cut_does_nothing(self, tmp_path):
        s, *_ = j3_erw_lauf(tmp_path, J3MOD._eq)
        self.gruen(s)
        assert s["werte"]["band_senkung_db"] > 10 and abs(s["werte"]["oben_aenderung_db"]) < 0.5
        s, *_ = j3_erw_lauf(tmp_path / "b", J3MOD._eq, flags={"eq_wirkt_nicht"})
        assert s["urteil"] == "FEHL" and s["grund"] == "eq_senkt_nicht"

    def test_komp_green_and_red_when_the_peak_stays(self, tmp_path):
        s, hand, *_ = j3_erw_lauf(tmp_path, J3MOD._komp)
        self.gruen(s)
        assert s["werte"]["spitze_senkung_db"] > 5
        insert = next(a for n, a in hand.aufrufe if n == "proj_aendern" and a["befehle"][0].get("art") == "komp")["befehle"][0]
        assert insert["werte"]["attack"] >= 1       # the lower limit 0.1 ms is refused by the render
        s, *_ = j3_erw_lauf(tmp_path / "b", J3MOD._komp, flags={"komp_wirkt_nicht"})
        assert s["urteil"] == "FEHL" and s["grund"] == "komp_senkt_spitze_nicht"

    def test_hall_green_and_red_when_the_tail_does_not_grow(self, tmp_path):
        s, *_ = j3_erw_lauf(tmp_path, J3MOD._hall)
        self.gruen(s)
        assert s["werte"]["ende_ohne_hall_s"] < 1.0 and s["werte"]["verlaengerung_s"] > J3MOD.HALL_MIN_VERLAENGERUNG_S
        s, *_ = j3_erw_lauf(tmp_path / "b", J3MOD._hall, flags={"hall_wirkt_nicht"})
        assert s["urteil"] == "FEHL" and s["grund"] == "hall_verlaengert_nicht"

    def test_saett_green_and_red_without_harmonics(self, tmp_path):
        s, *_ = j3_erw_lauf(tmp_path, J3MOD._saett)
        self.gruen(s)
        assert s["werte"]["anstieg_db"] > 10
        s, *_ = j3_erw_lauf(tmp_path / "b", J3MOD._saett, flags={"saett_wirkt_nicht"})
        assert s["urteil"] == "FEHL" and s["grund"] == "saett_ohne_obertoene"

    def test_limiter_green_and_red_when_the_ceiling_is_not_held(self, tmp_path):
        s, *_ = j3_erw_lauf(tmp_path, J3MOD._limiter)
        self.gruen(s)
        assert abs(s["werte"]["unter_decke_db"] - 3.0) < 0.2        # the pan law puts the master 3 dB under the ceiling
        s, *_ = j3_erw_lauf(tmp_path / "b", J3MOD._limiter, flags={"lim_wirkt_nicht"})
        assert s["urteil"] == "FEHL" and s["grund"] == "limiter_haelt_decke_nicht"

    def test_pdc_green_and_red_when_the_latent_track_is_late(self, tmp_path):
        s, *_ = j3_erw_lauf(tmp_path, J3MOD._pdc)
        self.gruen(s)
        assert s["werte"]["versatz_samples"] == {"ohne": 0, "eq": 0, "lim": 0}
        s, *_ = j3_erw_lauf(tmp_path / "b", J3MOD._pdc, flags={"pdc_kaputt"})
        assert s["urteil"] == "FEHL" and s["grund"] == "pdc_versatz"
        assert s["werte"]["versatz_samples"]["ohne"] == 0 and abs(s["werte"]["versatz_samples"]["eq"]) == 69 and abs(s["werte"]["versatz_samples"]["lim"]) == 69

    def test_midi_export_reads_the_notes_back_and_mutes_the_track_again(self, tmp_path):
        s, hand, seite, _ = j3_erw_lauf(tmp_path, J3MOD._midi_export)
        self.gruen(s)
        assert s["werte"]["noten_alle"] == 4 and s["werte"]["noten_spur"] == 4
        assert hand.mute_s1 is True
        muted = [b["mute"] for n, a in hand.aufrufe if n == "proj_aendern" for b in a["befehle"] if "mute" in b]
        assert muted == [False, True]         # unmuted for the export, muted again after
        assert ("POST", "/proj/export_midi", "cypher") in seite.aufrufe

    def test_midi_export_red_when_a_note_differs(self, tmp_path):
        s, *_ = j3_erw_lauf(tmp_path, J3MOD._midi_export, seite_kw={"midi_tausch": (40, 41)})
        assert s["urteil"] == "FEHL" and s["grund"] == "noten_ungleich"

    def test_einsammeln_waits_out_a_running_transport_and_checks_the_report(self, tmp_path):
        s, _, seite, _ = j3_erw_lauf(tmp_path, J3MOD._einsammeln, seite_kw={"einsammeln_codes": [409, 200]})
        self.gruen(s)
        assert len([a for a in seite.aufrufe if a[1] == "/proj/einsammeln"]) == 2
        assert s["werte"]["schon_da"] == 1 and s["werte"]["audio_dateien"] == 1

    @pytest.mark.parametrize("antwort,grund", [
        ({"fehlt": ["abc"]}, "datei_fehlt"),
        ({"abweichend": ["abc"]}, "abweichend"),
        ({"kopiert": 0, "schon_da": 0}, "zu_wenig_gesammelt"),
    ])
    def test_einsammeln_red_on_a_bad_report(self, tmp_path, antwort, grund):
        s, *_ = j3_erw_lauf(tmp_path, J3MOD._einsammeln, seite_kw={"einsammeln": {"kopiert": 0, "schon_da": 1, "fehlt": [], "abweichend": [], **antwort}})
        assert s["urteil"] == "FEHL" and s["grund"] == grund

    def test_einsammeln_red_when_the_collect_never_answers_200(self, tmp_path, monkeypatch):
        monkeypatch.setattr(J3MOD, "EINSAMMELN_FRIST_S", 0.6)
        s, *_ = j3_erw_lauf(tmp_path, J3MOD._einsammeln, seite_kw={"einsammeln_codes": [409]})
        assert s["urteil"] == "FEHL" and s["grund"] in ("einsammeln_abgelehnt", "transport_laeuft")

    def test_relink_moves_the_file_away_finds_it_missing_and_relinks_a_verified_copy(self, tmp_path):
        s, hand, *_ = j3_erw_lauf(tmp_path, J3MOD._relink)
        self.gruen(s)
        assert s["werte"]["fehlt_nach_verlegen"] is True and s["werte"]["fehlt_nach_relink"] is False
        assert s["werte"]["finden"] == "katalog_fehlt"
        assert "/audio/" in str(hand.audio_pfad) and hand.audio_pfad.is_file()
        assert (tmp_path / "aus" / "musik" / "tour-j3-verlegt.wav").is_file()

    def test_relink_red_when_the_file_is_still_missing_afterwards(self, tmp_path):
        s, *_ = j3_erw_lauf(tmp_path, J3MOD._relink, flags={"relink_wirkt_nicht"})
        assert s["urteil"] == "FEHL" and s["grund"] == "noch_fehlend"

    def test_undo_takes_one_edit_back_and_redo_restores_it(self, tmp_path):
        s, hand, *_ = j3_erw_lauf(tmp_path, J3MOD._undo)
        self.gruen(s)
        assert s["werte"]["nach_undo_db"] == J3MOD.UNDO_FADER_A_DB and s["werte"]["nach_redo_db"] == J3MOD.UNDO_FADER_B_DB

    def test_undo_red_when_it_takes_back_two_edits_or_redo_does_nothing(self, tmp_path):
        s, *_ = j3_erw_lauf(tmp_path, J3MOD._undo, flags={"undo_zu_weit"})
        assert s["urteil"] == "FEHL" and s["grund"] == "undo_falsch"
        s, *_ = j3_erw_lauf(tmp_path / "b", J3MOD._undo, flags={"redo_wirkt_nicht"})
        assert s["urteil"] == "FEHL" and s["grund"] == "redo_falsch"

    def test_zip_round_trip_opens_the_import_with_the_same_tracks(self, tmp_path):
        s, hand, seite, _ = j3_erw_lauf(tmp_path, J3MOD._zip)
        self.gruen(s)
        assert hand.geoeffnet == "tour-j3-2" and s["werte"]["neuer_slug"] == "tour-j3-2" and s["werte"]["audio_eintraege"] == 1
        assert ("GET", "/proj/export_zip?slug=tour-j3", "andreas") in seite.aufrufe       # the zip routes are owner only
        assert ("POST", "/proj/import_zip", "andreas") in seite.aufrufe
        assert (tmp_path / "aus" / "musik" / "tour-j3.cypherdj.zip").is_file()

    @pytest.mark.parametrize("flags,seite_kw,grund", [
        ({"spuren_anders"}, {}, "spuren_ungleich"),
        ({"audio_fehlt_nach_import"}, {}, "audio_fehlt_nach_import"),
        (set(), {"zip_ohne_audio": True}, "audio_fehlt_im_zip"),
        (set(), {"import_slug": "tour-j3"}, "kein_neues_projekt"),
    ])
    def test_zip_red_cases(self, tmp_path, flags, seite_kw, grund):
        s, *_ = j3_erw_lauf(tmp_path, J3MOD._zip, flags=flags, seite_kw=seite_kw)
        assert s["urteil"] == "FEHL" and s["grund"] == grund


J3_ERW_SCHRITTE = ("j3.midi_export", "j3.einsammeln", "j3.relink", "j3.undo", "j3.zip", "j3.auto", "j3.eq", "j3.komp", "j3.hall", "j3.saett", "j3.limiter", "j3.pdc", "j3.take", "j3.rack", "j3.plugin", "j3.zusammen", "j3.resample")



# ---------------------------------------------------------------- J4 sound steps of the device families (fake page, synthesised exports)

class J4KlangSeite(J4Seite):
    """J4Seite for the sound steps: a project with the commands the steps send (spur_neu, spur_aendern, clip_neu, noten_neu / aendern / loeschen,
    insert_setzen, geraet_stift_setzen), the patch field of Kraken, and an export that SYNTHESISES what the devices should sound like:
    a kick for drums-909, a harmonic tone that follows the note for every other instrument, noise for the pins and pads, tanh for the
    effect stage, one Drum Synth recipe per pad whose knob k1 is the kick's tune.

    Faults (a name per device where it applies): stumm_<graph> (silence), tonhoehe_<graph> (the device ignores the note), uebersteuert_<graph>,
    ohne_abklingen_<graph> (the note never ends), kein_graph_<graph> (not in the graph list), effekt_stumm, stift_stumm (the pin is stored, the
    sound stays), stift_nicht_gespeichert, knopf_ohne_wirkung, knopf_wirkt_auf_alle, roll_loeschen_ignoriert.
    """
    GRAPHEN = ["bass-banddrive", "drums-909", "synth-mono", "juno-pad", "synth-greif2", "synth-kraken", "drum-synth", "fx-crunch"]
    DRUM_NAMEN = {"1": "Kick Tune", "2": "Kick Pitch drop", "3": "Kick Decay", "12": "Snare Tune", "27": "Closed Hat Tune"}
    KRAKEN_STIFTE = [[0, 2, 0, 0.0433], [0, 10, 8, 0.1]]       # two of the factory pins is enough for the fake

    def __init__(self, ordner, fehler=()):
        super().__init__(ordner, fehler)
        self.befehle = []                           # every project command, in order
        self.zaehler = 1

    # -- reads
    def get(self, pfad):
        if pfad.startswith("/graphen"):
            liste = [{"name": g, "art": "instrument", "regler_namen": ({"10": "Cutoff", "11": "Resonance"} if g == "bass-banddrive" else
                                                                       self.DRUM_NAMEN if g == "drum-synth" else {})}
                     for g in self.GRAPHEN if f"kein_graph_{g}" not in self.fehler]
            return 200, {"graphen": liste, "geladen": self.geladen}
        if pfad.startswith("/proj/steckfeld"):
            spur = self._spur(pfad.split("spur_id=")[1])
            if spur["geraet"]["graph"] != "synth-kraken":
                return 409, {"fehler": "kein_steckfeld"}
            eigene = "stifte" in spur["geraet"]
            return 200, {"spur_id": spur["id"], "graph": "synth-kraken", "zeilen": ["VCO 1", "VCO 2", "VCO 3", "Noise", "Ring", "Key"] + [f"R{i}" for i in range(10)],
                         "spalten": [f"C{i}" for i in range(14)] + ["Amp", "Out"], "eigene": eigene,
                         "stifte": [list(s) for s in (spur["geraet"]["stifte"] if eigene else self.KRAKEN_STIFTE)], "rev": self.projekt["rev"]}
        return super().get(pfad)

    def _spur(self, spur_id):
        return next(s for s in self.projekt["spuren"] if s["id"] == spur_id)

    # -- writes
    def post(self, pfad, d):
        p = pfad.split("?")[0]
        if p == "/proj/neu":
            self.projekt = {"slug": d["name"], "rev": 0, "tempo_bpm": 120, "naechste_noten_id": 1, "spuren": []}
            return 200, {"slug": d["name"], "rev": 0}
        if p == "/proj/aendern":
            return self.aendere(d)
        if p == "/proj/export":
            return self.export(d)
        return super().post(pfad, d)

    def _noten(self, clip, roh):
        for r in roh:
            nid = r.get("id")
            if nid is None:
                nid = f"n{self.projekt['naechste_noten_id']}"
            if any(n["id"] == nid for n in clip["noten"]):
                raise ValueError("id_belegt")
            if re.fullmatch(r"n\d+", nid):
                self.projekt["naechste_noten_id"] = max(self.projekt["naechste_noten_id"], int(nid[1:]) + 1)
            clip["noten"].append({**r, "id": nid})

    def aendere(self, d):
        if d["rev"] != self.projekt["rev"]:
            return 409, {"fehler": "veraltet"}
        for b in d["befehle"]:
            self.befehle.append(b)
            c = b["befehl"]
            if c == "spur_neu":
                self.projekt["spuren"].append({"id": f"s{len(self.projekt['spuren']) + 1}", "geraet": b["geraet"], "clips": [], "inserts": []})
                continue
            spur = self._spur(b.get("spur_id") or b.get("strang_id")) if (b.get("spur_id") or b.get("strang_id")) else None
            clip = next((k for s in self.projekt["spuren"] for k in s["clips"] if k["id"] == b.get("clip_id")), None)
            if c == "spur_aendern":
                spur["geraet"] = {**b["geraet"], **({"stifte": spur["geraet"]["stifte"]} if "stifte" in spur["geraet"] else {})}
            elif c == "clip_neu":
                k = {"id": f"c{sum(len(s['clips']) for s in self.projekt['spuren']) + 1}", "art": "midi", "start_beat": b["start_beat"],
                     "laenge_beats": b["laenge_beats"], "noten": []}
                self._noten(k, b.get("noten") or [])
                spur["clips"].append(k)
            elif c == "noten_neu":
                try:
                    self._noten(clip, b["noten"])
                except ValueError as e:
                    return 409, {"fehler": str(e)}
            elif c == "noten_aendern":
                for r in b["noten"]:
                    next(n for n in clip["noten"] if n["id"] == r["id"]).update({k: v for k, v in r.items() if k != "id"})
            elif c == "noten_loeschen":
                if "roll_loeschen_ignoriert" not in self.fehler:
                    clip["noten"] = [n for n in clip["noten"] if n["id"] not in b["ids"]]
            elif c == "insert_setzen":
                spur["inserts"].insert(b["pos"], {"art": b["art"], "graph": b["graph"]})
            elif c == "geraet_stift_setzen":
                if "stift_nicht_gespeichert" in self.fehler:
                    continue
                liste = [list(s) for s in spur["geraet"].get("stifte", self.KRAKEN_STIFTE)]
                liste = [s for s in liste if s[:3] != [b["satz"], b["zeile"], b["spalte"]]] + [[b["satz"], b["zeile"], b["spalte"], b["wert"]]]
                spur["geraet"]["stifte"] = liste
        self.projekt["rev"] += 1
        return 200, {"rev": self.projekt["rev"]}

    # -- the export: what the devices should sound like
    def export(self, d):
        spur = self.projekt["spuren"][-1]
        graph = spur["geraet"]["graph"]
        import numpy as np
        self.exporte += 1
        tempo = self.projekt["tempo_bpm"]
        beat_s = 60.0 / tempo
        sek = (d["bis_beat"] - d["von_beat"]) * beat_s
        n = int(sek * 48000)
        out = np.zeros(n)
        rng = np.random.default_rng(7)
        for clip in spur["clips"]:
            for note in clip["noten"]:
                t0 = int((clip["start_beat"] + note["beat"]) * beat_s * 48000)
                stimme = self.stimme(graph, spur, note, beat_s, rng)
                m = min(len(stimme), n - t0)
                if m > 0:
                    out[t0:t0 + m] += stimme[:m]
        if f"stumm_{graph}" in self.fehler:
            out[:] = 0.0
        if f"uebersteuert_{graph}" in self.fehler:
            out = out * 8.0
        if any(i["graph"] == "fx-crunch" for i in spur["inserts"]) and "effekt_stumm" not in self.fehler:
            out = np.tanh(6 * out) * 0.5
        out = np.clip(out, -1.0, 1.0)
        pcm = np.clip(np.round(out * 32768), -32768, 32767).astype("<i2")
        datei = os.path.join(self.ordner, f"export{self.exporte}.wav")
        with wave.open(datei, "wb") as w:
            w.setnchannels(2)
            w.setsampwidth(2)
            w.setframerate(48000)
            w.writeframes(np.repeat(pcm, 2).tobytes())
        spitze = float(np.abs(out).max())
        return 200, {"datei": datei, "frames": n, "spitze_db": round(20 * math.log10(spitze), 1) if spitze else -200.0, "ueber_decke": spitze >= 1.0}

    def stimme(self, graph, spur, note, beat_s, rng):
        import numpy as np
        sr = 48000
        if graph == "drum-synth":
            return self.drumsynth(spur, note, rng)
        if graph == "drums-909":
            t = np.arange(int(0.6 * sr)) / sr
            return 0.6 * np.sin(2 * np.pi * np.cumsum(40 + 60 * np.exp(-t * 30)) / sr) * np.exp(-t * 6)
        laenge = note["laenge"] * beat_s
        ton = 48 if f"tonhoehe_{graph}" in self.fehler else note["ton"]
        f = 440.0 * 2 ** ((ton - 69) / 12.0)
        rest = 100.0 if f"ohne_abklingen_{graph}" in self.fehler else 0.05
        t = np.arange(int((laenge + (1.5 if rest > 1 else 0.6)) * sr)) / sr
        huelle = np.minimum(1.0, t / 0.005) * np.where(t < laenge, 1.0, np.exp(-(t - laenge) / rest))
        x = sum(np.sin(2 * np.pi * f * h * t) / h for h in range(1, 7)) * 0.2 * huelle
        stifte = spur["geraet"].get("stifte") or []
        if graph == "synth-kraken" and any(s[1] == 3 and s[2] == 15 and s[3] > 0 for s in stifte) and "stift_stumm" not in self.fehler:
            x = x + 0.12 * rng.standard_normal(len(t)) * huelle
        return x

    def drumsynth(self, spur, note, rng):
        import numpy as np
        sr = 48000
        p = spur["geraet"]["parameter"]
        k1 = p.get("k1", 0.5)
        fremd = 1.0 + (k1 - 0.5) * 3 if "knopf_wirkt_auf_alle" in self.fehler else 1.0     # a knob that leaks into the other pads
        wirkt = 0.0 if "knopf_ohne_wirkung" in self.fehler else k1
        if note["ton"] == 36:
            t = np.arange(int(0.4 * sr)) / sr
            return 0.6 * np.sin(2 * np.pi * np.cumsum(30 + 40 * wirkt + 20 * np.exp(-t * 30)) / sr) * np.exp(-t * 14)
        laenge = 0.25 if note["ton"] == 38 else 0.08
        t = np.arange(int(laenge * sr)) / sr
        rausch = rng.standard_normal(len(t))
        sp = np.fft.rfft(rausch)
        fr = np.fft.rfftfreq(len(t), 1 / sr)
        if note["ton"] == 38:
            rausch = np.fft.irfft(sp / (1 + (fr / 3000.0) ** 2), len(t))      # snare: low-passed noise, a few kHz
            return 0.15 * fremd * (rausch / rausch.std() + 0.5 * np.sin(2 * np.pi * 200 * t)) * np.exp(-t * 12)
        return 0.1 * fremd * np.diff(rausch, prepend=0.0) / np.sqrt(2) * np.exp(-t * 40)     # closed hat: high-passed noise


def j4_klang_lauf(tmp_path, fehler=()):
    from tour import j4
    seite = J4KlangSeite(str(tmp_path), fehler)
    try:
        t = L.Tour("j4", J4Instanz(seite.url), tmp_path / "aus", kurz=True)
        t.fuehre(j4.klangschritte)
        return {s["kennung"]: s for s in t.bericht().schritte}, seite, t
    finally:
        seite.ende()


KLANG_SCHRITTE = ["j4.familie_drums", "j4.familie_mono", "j4.familie_poly", "j4.familie_neuro", "j4.familie_fx", "j4.kraken",
                  "j4.kraken_stift", "j4.drumsynth", "j4.drumsynth_knopf", "j4.klavierrolle"]


@pytest.fixture(scope="module")
def j4_klang_gruen(tmp_path_factory):
    return j4_klang_lauf(tmp_path_factory.mktemp("j4klang"))


class TestJ4Klang:
    def test_every_step_is_green_on_the_fake(self, j4_klang_gruen):
        s, seite, t = j4_klang_gruen
        assert list(s) == KLANG_SCHRITTE
        assert {k: v["urteil"] for k, v in s.items()} == {k: "OK" for k in KLANG_SCHRITTE}, {k: v["grund"] for k, v in s.items() if v["urteil"] != "OK"}
        assert t.bericht().exitcode() == 0

    def test_the_tour_is_the_first_eight_steps_then_the_sound_steps(self, monkeypatch):
        from tour import j4
        lauf = []
        monkeypatch.setattr(j4, "grundschritte", lambda t: lauf.append("grund"))
        monkeypatch.setattr(j4, "klangschritte", lambda t: lauf.append("klang"))
        j4.schritte(None)
        assert lauf == ["grund", "klang"]

    def test_one_device_per_registered_family_is_played(self):
        from tour import j4
        reg = json.load(open(os.path.join(L.DJK, "instruments", "modular_dsp", "geraete.json"), encoding="utf-8"))
        familien = {g["familie"] for g in reg}
        assert {x["familie"] for x in j4.FAMILIEN} == familien, "a family without a sound step (or a step for a family that is gone)"
        for x in j4.FAMILIEN:
            assert {"name": x["graph"], "familie": x["familie"]}.items() <= next(g for g in reg if g["name"] == x["graph"]).items()
        for graph in (j4.KRAKEN, j4.DRUMSYNTH, j4.FX_BASIS, j4.ROLL_GRAPH):
            assert any(g["name"] == graph for g in reg)

    def test_the_knob_of_the_drum_synth_step_exists_in_the_graph(self):
        from tour import j4
        g = json.load(open(os.path.join(L.DJK, "instruments", "modular_dsp", "demos", "drum-synth.json"), encoding="utf-8"))
        assert j4.DRUMSYNTH_KNOPF[0] in g["regler_namen"].values()
        for pad, _ in j4.DRUMSYNTH_KIT:
            assert any(v.startswith(pad + " ") for v in g["regler_namen"].values()), pad

    def test_the_report_carries_the_measured_values(self, j4_klang_gruen):
        s, _, _ = j4_klang_gruen
        w = s["j4.familie_mono"]["werte"]
        assert w["geraet"] == "synth-mono" and w["familie"] == "mono"
        assert len(w["halbtoene"]) == 3 and abs(w["halbtoene"][1] - 7) < 0.5 and abs(w["halbtoene"][2] - 12) < 0.5
        assert all(p > -50 for p in w["pegel_db"])
        assert s["j4.kraken_stift"]["werte"]["stifte_nachher"] == s["j4.kraken_stift"]["werte"]["stifte_vorher"] + 1
        d = s["j4.drumsynth"]["werte"]
        assert d["tiefer_anteil"][0] > 0.7 > 0.3 > d["tiefer_anteil"][1] and d["schwerpunkt_hz"][2] > 3000
        assert s["j4.klavierrolle"]["werte"]["noten_im_clip"] == 3

    def test_a_silent_device_is_red_and_the_others_still_run(self, tmp_path):
        s, _, t = j4_klang_lauf(tmp_path, ["stumm_juno-pad"])
        assert s["j4.familie_poly"]["urteil"] == "FEHL" and "silent" in s["j4.familie_poly"]["grund"]
        assert s["j4.familie_neuro"]["urteil"] == "OK" and s["j4.klavierrolle"]["urteil"] == "OK"
        assert t.bericht().exitcode() == 1

    def test_a_device_that_ignores_the_note_is_red(self, tmp_path):
        s, _, _ = j4_klang_lauf(tmp_path, ["tonhoehe_synth-greif2"])
        assert s["j4.familie_neuro"]["urteil"] == "FEHL" and "pitch off" in s["j4.familie_neuro"]["grund"]
        assert s["j4.familie_mono"]["urteil"] == "OK"

    def test_a_clipping_export_is_red(self, tmp_path):
        s, _, _ = j4_klang_lauf(tmp_path, ["uebersteuert_synth-mono"])
        assert s["j4.familie_mono"]["urteil"] == "FEHL" and "clipping" in s["j4.familie_mono"]["grund"]

    def test_a_note_that_never_ends_is_red(self, tmp_path):
        s, _, _ = j4_klang_lauf(tmp_path, ["ohne_abklingen_juno-pad"])
        assert s["j4.familie_poly"]["urteil"] == "FEHL" and "do not end" in s["j4.familie_poly"]["grund"]

    def test_a_registered_device_missing_from_the_graph_list_is_red(self, tmp_path):
        s, _, _ = j4_klang_lauf(tmp_path, ["kein_graph_synth-kraken"])
        assert s["j4.kraken"]["urteil"] == "FEHL" and "synth-kraken" in s["j4.kraken"]["grund"]

    def test_an_effect_that_changes_nothing_is_red(self, tmp_path):
        s, _, _ = j4_klang_lauf(tmp_path, ["effekt_stumm"])
        assert s["j4.familie_fx"]["urteil"] == "FEHL" and "does not change the sound" in s["j4.familie_fx"]["grund"]

    def test_the_effect_goes_in_as_an_insert_of_the_track(self, j4_klang_gruen):
        _, seite, _ = j4_klang_gruen
        ins = [b for b in seite.befehle if b["befehl"] == "insert_setzen"]
        assert [(b["art"], b["graph"]) for b in ins] == [("bk", "fx-crunch")]

    def test_a_pin_that_does_not_change_the_sound_is_red(self, tmp_path):
        s, _, _ = j4_klang_lauf(tmp_path, ["stift_stumm"])
        assert s["j4.kraken_stift"]["urteil"] == "FEHL" and "sound did not change" in s["j4.kraken_stift"]["grund"]

    def test_a_pin_that_is_not_stored_is_red(self, tmp_path):
        s, _, _ = j4_klang_lauf(tmp_path, ["stift_nicht_gespeichert"])
        assert s["j4.kraken_stift"]["urteil"] == "FEHL" and "not in the stored list" in s["j4.kraken_stift"]["grund"]

    def test_the_pin_is_set_by_the_label_of_its_row_and_column(self, j4_klang_gruen):
        _, seite, _ = j4_klang_gruen
        pins = [b for b in seite.befehle if b["befehl"] == "geraet_stift_setzen"]
        assert [(b["satz"], b["zeile"], b["spalte"], b["wert"]) for b in pins] == [(0, 3, 15, 0.8)]       # row Noise, column Out

    def test_a_knob_without_effect_on_its_pad_is_red(self, tmp_path):
        s, _, _ = j4_klang_lauf(tmp_path, ["knopf_ohne_wirkung"])
        assert s["j4.drumsynth_knopf"]["urteil"] == "FEHL" and "did not change the sound of its pad" in s["j4.drumsynth_knopf"]["grund"]

    def test_a_knob_that_also_changes_other_pads_is_red(self, tmp_path):
        s, _, _ = j4_klang_lauf(tmp_path, ["knopf_wirkt_auf_alle"])
        assert s["j4.drumsynth_knopf"]["urteil"] == "FEHL" and "other pads" in s["j4.drumsynth_knopf"]["grund"]

    def test_only_the_kick_changes_when_its_knob_is_turned(self, j4_klang_gruen):
        s, _, _ = j4_klang_gruen
        w = s["j4.drumsynth_knopf"]["werte"]
        assert w["knopf"] == "k1 Kick Tune"
        assert w["schwerpunkt_aenderung"][0] > 0.1 and w["schwerpunkt_aenderung"][1] < 0.1 and w["schwerpunkt_aenderung"][2] < 0.1

    def test_drawn_notes_go_in_with_noten_neu_and_the_ids_of_the_project_counter(self, j4_klang_gruen):
        _, seite, _ = j4_klang_gruen
        neu = [b for b in seite.befehle if b["befehl"] == "noten_neu"]
        assert len(neu) == 1 and [n["id"] for n in neu[0]["noten"]] == ["n1", "n2", "n3"]
        assert [b["befehl"] for b in seite.befehle if b["befehl"].startswith("noten_")] == ["noten_neu", "noten_loeschen", "noten_aendern"]

    def test_a_deleted_note_that_still_sounds_is_red(self, tmp_path):
        s, _, _ = j4_klang_lauf(tmp_path, ["roll_loeschen_ignoriert"])
        assert s["j4.klavierrolle"]["urteil"] == "FEHL" and "deleted note still sounds" in s["j4.klavierrolle"]["grund"]


class TestKlang:
    """The signal measurements of tour/surge_sound.py on synthetic signals."""

    @staticmethod
    def _ton(f, sek=0.6, harmonische=6, sub=False):
        import numpy as np
        t = np.arange(int(sek * 48000)) / 48000
        x = sum(np.sin(2 * np.pi * f * h * t) / h for h in range(1, harmonische + 1))
        return x + (np.sin(2 * np.pi * f / 2 * t) if sub else 0.0)

    def test_the_shift_of_a_note_in_semitones(self):
        from tour import surge_sound as klang
        c3 = self._ton(130.81)
        for halb in (0, 7, 12, 17, -5):
            assert abs(klang.verschiebung_halbtoene(c3, self._ton(130.81 * 2 ** (halb / 12.0))) - halb) < 0.2, halb

    def test_a_sub_oscillator_does_not_make_the_shift_jump_an_octave(self):
        from tour import surge_sound as klang
        assert abs(klang.verschiebung_halbtoene(self._ton(130.81, sub=True), self._ton(196.0, sub=True)) - 7) < 0.2

    def test_a_device_that_ignores_the_note_has_shift_zero_and_silence_has_none(self):
        import numpy as np
        from tour import surge_sound as klang
        assert klang.verschiebung_halbtoene(self._ton(130.81), self._ton(130.81)) == 0.0
        s = klang.verschiebung_halbtoene(self._ton(130.81), np.zeros(24000))
        assert s != s            # nan

    def test_energy_share_of_a_band(self):
        import numpy as np
        from tour import surge_sound as klang
        t = np.arange(24000) / 48000
        x = np.sin(2 * np.pi * 100 * t) + np.sin(2 * np.pi * 4000 * t)
        assert abs(klang.anteil(x, 0, 400) - 0.5) < 0.01 and abs(klang.anteil(x, 400, 24000) - 0.5) < 0.01
        assert klang.anteil(np.zeros(100), 0, 400) == 0.0

    def test_centroid_of_a_band_ignores_the_rest(self):
        import numpy as np
        from tour import surge_sound as klang
        t = np.arange(48000) / 48000
        x = np.sin(2 * np.pi * 100 * t) + 3 * np.sin(2 * np.pi * 5000 * t)
        assert abs(klang.schwerpunkt(x, 20, 500) - 100) < 5 and klang.schwerpunkt(x) > 3000

    def test_fall_of_a_decaying_note_and_of_a_steady_one(self):
        import numpy as np
        from tour import surge_sound as klang
        t = np.arange(48000) / 48000
        fall, kopf, schluss = klang.abfall_db(np.sin(2 * np.pi * 100 * t) * np.exp(-t * 8), 0.3)
        assert fall > 40 and kopf > schluss
        assert klang.abfall_db(np.sin(2 * np.pi * 100 * t), 0.3)[0] < 1.0

    def test_centroid_and_level(self):
        import numpy as np
        from tour import surge_sound as klang
        t = np.arange(48000) / 48000
        assert abs(klang.schwerpunkt(np.sin(2 * np.pi * 1000 * t)) - 1000) < 5
        assert abs(klang.rms_db(0.5 * np.ones(100)) - (-6.02)) < 0.01
        assert klang.rms_db(np.zeros(0)) == -240.0 and klang.spitze(0.7 * np.sin(2 * np.pi * 100 * t)) > 0.69


# ---------------------------------------------------------------- J5 automation tracks (spur, spur_stopp, spuren)

class TestJ5Spur:
    def test_the_step_is_green_and_reads_the_value_on_every_bar_line(self, j5env):
        rc, s = j5env.fahre()
        assert s["j5.spur"]["urteil"] == "OK", s["j5.spur"]["grund"]
        w = s["j5.spur"]["werte"]
        assert w["anker_beat"] % 4 == 0 and w["ende_beat"] == w["anker_beat"] + 16 and w["spuren_listet"] is True
        assert [x["takt"] for x in w["lesungen"]] == [0, 1, 2, 3, 4]
        assert all(abs(x["wert"] - x["soll"]) <= 0.08 for x in w["lesungen"])
        assert w["lesungen"][4]["wert"] > w["lesungen"][0]["wert"] + 0.5
        assert rc == 0

    def test_the_agent_sends_the_ramp_as_a_linear_move_of_four_bars(self, j5env):
        j5env.fahre()
        spur = [k for pfad, _, k in j5env.seite.aufrufe if pfad == "/spur"]
        assert len(spur) == 2
        assert spur[0]["fahrten"] == [{"ziel": "deck/2/filter", "ab_takt": 1, "takte": 4, "nach": 0.9, "form": "linear"}]
        assert spur[1]["fahrten"][0]["nach"] == 0.1 and spur[0]["name"] != spur[1]["name"]

    def test_a_stopped_ramp_stays_where_it_was_and_a_second_stop_is_refused(self, j5env):
        rc, s = j5env.fahre()
        w = s["j5.spur"]["werte"]
        assert 0.25 < w["wert_beim_stopp"] < 0.75 and abs(w["wert_ein_takt_danach"] - w["wert_beim_stopp"]) <= 0.03
        assert w["zweiter_stopp"] == "keine_spur"
        stopps = [k["name"] for pfad, _, k in j5env.seite.aufrufe if pfad == "/spur/stopp"]
        assert stopps[0] == w["spur"].replace("rampe", "halt") or stopps[0].startswith("tour-j5-halt")

    def test_the_step_leaves_nothing_behind(self, j5env):
        j5env.fahre()
        assert j5env.seite.spuren == {}

    def test_a_value_that_jumps_instead_of_following_the_grid_is_red(self, j5env):
        j5env.seite.spur_modus = "sprung"
        rc, s = j5env.fahre()
        assert s["j5.spur"]["urteil"] == "FEHL" and "does not follow the bar grid" in s["j5.spur"]["grund"]
        assert rc == 1

    def test_a_ramp_that_moves_before_its_bar_line_is_red(self, j5env):
        j5env.seite.spur_modus = "vor_anker"
        rc, s = j5env.fahre()
        assert s["j5.spur"]["urteil"] == "FEHL"
        assert "before the bar line" in s["j5.spur"]["grund"] or "does not follow the bar grid" in s["j5.spur"]["grund"]

    def test_a_track_that_spuren_does_not_list_is_red(self, j5env):
        j5env.seite.spur_modus = "nicht_gelistet"
        rc, s = j5env.fahre()
        assert s["j5.spur"]["urteil"] == "FEHL" and "spuren does not list" in s["j5.spur"]["grund"]

    def test_a_stop_that_does_not_stop_is_red(self, j5env):
        j5env.seite.spur_modus = "stopp_ignoriert"
        rc, s = j5env.fahre()
        assert s["j5.spur"]["urteil"] == "FEHL"
        assert "moved on after spur_stopp" in s["j5.spur"]["grund"] or "still lists" in s["j5.spur"]["grund"]

    def test_the_other_steps_are_not_touched_by_a_red_spur_step(self, j5env):
        j5env.seite.spur_modus = "sprung"
        rc, s = j5env.fahre()
        assert {k: v["urteil"] for k, v in s.items() if k != "j5.spur"} == {k: "OK" for k in TestJ5.SCHRITTE if k != "j5.spur"}



# ---------------------------------------------------------------- J1 extension: hotcues, loops, jumps, scrub, pre-listen, compressor, hall, cue output

class UhrV:
    """Virtual time for the extension tests: `sleep` advances it at once, so a step that waits seconds runs in milliseconds. Everything else is the
    real `time` module (the report writes a real timestamp)."""

    def __init__(self):
        self.t = 1000.0

    def monotonic(self):
        return self.t

    def sleep(self, s):
        self.t += max(0.0, s)

    def __getattr__(self, name):
        return getattr(time, name)


class ErweiterungSeite:
    """Fake page server for the J1 extension steps: one deck that follows a clock of 124 bpm (source beat = clock beat + offset), and the meters
    that go with it. Each `fehler` entry switches one thing the real page does to something it does not (the red cases)."""

    EINS = 0.77
    BPM = 124.0

    def __init__(self, uhr, fehler=()):
        self.uhr, self.fehler = uhr, set(fehler)
        self.versatz = 5.0 - self.beat0()          # source beat 5 now
        self.status = 0
        self.schleife = None                       # (start, laenge) while the deck loops
        self.cues = {}
        self.ereignisse = []                       # (clock beat, effect): jumps that land later
        self.regler = {"deck/1/fader": -200.0, "cue/mix": -1.0, "cue/pegel": -12.0, "deck/1/pfl": 0.0, "deck/1/komp/an": 0.0}
        self.fx = {"an": False, "art": 0}
        self.fx_zu = {}
        self.stopp_s = None
        self.aufrufe = []
        self.griff = 0.0
        self.vorh = False                          # the pre-listen deck plays
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
                seite.aufrufe.append(("GET", self.path, ""))
                u = urllib.parse.urlparse(self.path)
                if u.path == "/lage":
                    return self._senden(200, seite.lage())
                if u.path == "/pegel":
                    return self._senden(200, {"sek": 1, "kanaele": seite.pegel()})
                if u.path == "/deck/hotcues":
                    return self._senden(200, {str(k): v for k, v in seite.cues.items()})
                if u.path == "/deck/loop":
                    s = seite.schleife
                    return self._senden(200, {"start": s[0], "laenge": s[1]} if s else {})
                if u.path == "/ausgang":
                    return self._senden(200, {"zustand": "gut"})
                if u.path == "/vorhoeren":
                    return self._senden(200, {"spielt": seite.vorh})
                self._senden(404, {"fehler": "keine_route"})

            def do_POST(self):
                n = int(self.headers.get("content-length") or 0)
                d = json.loads(self.rfile.read(n) or b"{}")
                q = self.headers.get("x-djk-quelle")
                seite.aufrufe.append(("POST", self.path, q))
                code, obj = seite.post(self.path, d, q)
                self._senden(code, obj)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def ende(self):
        self.server.shutdown()
        self.server.server_close()

    # -- the clock and the deck
    def beat0(self):
        return 100.0 + (self.uhr.t - 1000.0) * self.BPM / 60.0

    def lauf(self):
        """Lets the jumps that are due land."""
        c = self.beat0()
        for e in sorted(self.ereignisse):
            if e[0] <= c:
                self.ereignisse.remove(e)
                e[1]()

    def quell(self):
        q = self.beat0() + self.versatz
        if self.schleife:
            s, l = self.schleife
            q = s + (q - s) % l if "loop_haelt_nicht" not in self.fehler else q
        return q

    def lage(self):
        self.lauf()
        decks = [{"deck": 1, "status": (3 if self.schleife and self.status else self.status), "quell_beat": self.quell()}] if self.status else \
                [{"deck": 1, "status": 0, "quell_beat": 0.0}]
        return {"uhr": {"beat": self.beat0(), "bpm": self.BPM}, "decks": decks, "regler": dict(self.regler), "hall_pool": {"an": False}, "fx": [None, None]}

    def offen(self):
        return self.regler["deck/1/fader"] > -100

    def pegel(self):
        self.lauf()
        spielt = self.status in (2, 3)
        deck = -6.0 if spielt and self.offen() else PEGEL_STUMM
        if spielt and self.offen() and self.regler["deck/1/komp/an"] and "komp_wirkt_nicht" not in self.fehler:
            deck -= 12.0
        master = deck
        if not spielt and self.stopp_s is not None and self.offen():
            dt = self.uhr.t - self.stopp_s
            lang = 2.0 if self.fx["an"] and "hall_wirkt_nicht" not in self.fehler else 0.05
            master = -6.0 - 60.0 * dt / lang if dt < lang else PEGEL_STUMM
            master = max(master, PEGEL_STUMM)
        pfl = -6.0 if spielt and self.regler["deck/1/pfl"] >= 0.5 and "pfl_wirkt_nicht" not in self.fehler else PEGEL_STUMM
        if "pfl_leckt" in self.fehler and pfl > PEGEL_STUMM:
            master = -20.0
        mix = self.regler["cue/mix"] if "cue_mix_wirkt_nicht" not in self.fehler else -1.0
        teil_m = master + 20 * math.log10(max(1e-9, 0.5 * (1 + mix))) if master > PEGEL_STUMM else PEGEL_STUMM
        vorh = -12.0 if self.vorh and "vorhoerdeck_stumm" not in self.fehler else PEGEL_STUMM
        teile = [10 ** (x / 20.0) for x in (pfl, teil_m, vorh) if x > PEGEL_STUMM]
        cue = 20 * math.log10(sum(teile)) + self.regler["cue/pegel"] if teile else PEGEL_STUMM
        return {"deck/1": {"max_db": deck}, "master": {"max_db": master}, "cue": {"max_db": max(cue, PEGEL_STUMM)}}

    def post(self, pfad, d, q):
        self.lauf()
        c = self.beat0()
        ok = (200, {"ok": True})
        if pfad == "/regler":
            if d["pfad"] == "deck/1/fader" and d["nach"] > -100 and q == "cypher":
                return 409, {"fehler": "kein_hoerschein"}
            if (d["pfad"].endswith("/pfl") or d["pfad"].startswith("cue/")) and q == "cypher":
                return 200, {"ok": True, "quittung": {"status": 6, "grund": "nur_hand"}}
            self.regler[d["pfad"]] = d["nach"]
            return ok
        if pfad == "/deck/start":
            self.status, self.versatz, self.schleife, self.stopp_s = 2, 5.0 + self.EINS - c - (5.0 + self.EINS - c) % 1 + 0.0, None, None
            self.versatz = self.EINS - (c + 1.0)           # the first downbeat at the next beat grid line
            return 200, {"ok": True, "felder": {"ab_beat": c + 1.0}}
        if pfad == "/deck/stopp":
            self.status, self.schleife, self.stopp_s = 0, None, self.uhr.t
            return ok
        if pfad == "/deck/hotcue":
            if d["aktion"] == "setzen":
                h = {"quell_beat": self.EINS + round(d["quell_beat"] - self.EINS), "art": d.get("art", "shot")}
                if h["art"] == "loop":
                    h["laenge"] = d["laenge"]
                self.cues[d["nr"]] = h
                return ok
            if d["aktion"] == "loeschen":
                self.cues.pop(d["nr"], None)
                return ok
            h, ab = self.cues[d["nr"]], c + 1.0

            def lande():
                if "hotcue_wirkt_nicht" not in self.fehler:
                    self.versatz = h["quell_beat"] - ab + (0.0 if "hotcue_schief" not in self.fehler else 1.0)
                if h["art"] == "loop":
                    self.schleife = (h["quell_beat"], h["laenge"])
            self.ereignisse.append((ab, lande))
            return 200, {"ok": True, "felder": {"ab_beat": ab}}
        if pfad == "/deck/sprung":
            ab = c + 0.2

            def spring():
                self.versatz += d["delta"] if "sprung_zu_kurz" not in self.fehler else d["delta"] / 2
            self.ereignisse.append((ab, spring))
            return 200, {"ok": True, "felder": {"ab_beat": ab}}
        if pfad == "/deck/loop":
            if d["laenge"] == 0:
                if self.schleife:
                    self.versatz = self.quell() - c
                self.schleife = None
            elif self.schleife and d.get("behalte_start"):
                self.schleife = (self.schleife[0], d["laenge"])
            else:
                self.schleife = (float(round(self.quell())), d["laenge"])
            return 200, {"ok": True, "felder": {"ab_beat": c}}
        if pfad == "/deck/scrub":
            if d["phase"] == 1:
                self.griff = 0.0
            if d["phase"] == 0:
                self.versatz += d["delta"] + (1.0 if "scrub_phase_verloren" in self.fehler else 0.0)
            return ok
        if pfad == "/vorhoeren":
            if d.get("aktion") == "stopp":
                self.vorh = False
                return ok
            if "kein_kopfhoerer" in self.fehler:
                return 409, {"fehler": "kein_kopfhoerer"}
            self.vorh = True
            return 200, {"ok": True, "spielt": True}
        if pfad == "/fx/zuweisung":
            self.fx_zu[d["einheit"]] = d["kanal"]
            return ok
        if pfad == "/fx":
            self.fx = {"an": bool(d.get("an")), "art": d["art"]}
            return ok
        return 404, {"fehler": "keine_route"}


PEGEL_STUMM = -200.0


@pytest.fixture
def ext(monkeypatch):
    uhr = UhrV()
    monkeypatch.setattr(j1, "time", uhr)
    monkeypatch.setattr(L, "time", uhr)
    return uhr


def ext_schritt(tmp_path, uhr, schritt, kennung, fehler=()):
    seite = ErweiterungSeite(uhr, fehler)
    try:
        t = j1_tour(seite, tmp_path / "aus")
        z = j1.Zustand()
        z.mids = {"a.wav": "m1", "b.wav": "m2"}
        t.fuehre(lambda t: schritt(t, z))
        return j1_schritt(t, kennung), seite, z
    finally:
        seite.ende()


class TestJ1Erweiterung:
    # -- the measurement helpers on their own
    def test_landung_abweichung_null_wenn_das_deck_dem_ziel_folgt(self):
        p = {"uhr": 120.0, "quell": 40.0 + (120.0 - 110.0)}
        assert j1.landung_abweichung(40.0, 110.0, p) == pytest.approx(0.0)
        assert j1.landung_abweichung(40.0, 110.0, dict(p, quell=p["quell"] + 1.5)) == pytest.approx(1.5)

    def test_versatz_ist_quelle_minus_uhr(self):
        assert j1.versatz({"uhr": 100.0, "quell": 37.5}) == -62.5

    def test_loop_drinnen_nennt_nur_was_ausserhalb_liegt(self):
        assert j1.loop_drinnen([10.0, 11.9, 13.9, 14.2], 10.0, 4) == []
        assert j1.loop_drinnen([10.0, 14.5, 9.5], 10.0, 4) == [14.5, 9.5]

    def test_loop_runden_zaehlt_nur_echte_ruecksprung(self):
        assert j1.loop_runden([10.0, 11.0, 12.0, 13.0, 10.2, 11.2, 12.2, 10.1]) == 2
        assert j1.loop_runden([10.0, 10.2, 9.9, 10.1]) == 0       # jitter is not a wrap

    # -- hotcues
    def test_hotcues_gruen(self, tmp_path, ext):
        st, seite, _ = ext_schritt(tmp_path, ext, j1.schritt_hotcues, "j1.hotcues")
        assert st["urteil"] == "OK", st
        assert sorted(st["werte"]["hotcues"]) == [str(n) for n in range(1, 9)]
        assert st["werte"]["hotcues"]["2"]["art"] == "loop" and st["werte"]["hotcues"]["2"]["laenge"] == 4
        assert abs(st["werte"]["schuss_abweichung_beats"]) <= j1.HOTCUE_TOLERANZ_BEATS
        assert st["werte"]["loop_cue_status"] == 3

    def test_hotcue_der_das_deck_nicht_bewegt_ist_rot(self, tmp_path, ext):
        st, _, _ = ext_schritt(tmp_path, ext, j1.schritt_hotcues, "j1.hotcues", fehler=["hotcue_wirkt_nicht"])
        assert st["urteil"] == "FEHL" and "beats from where it must be" in st["grund"]

    def test_hotcue_der_um_einen_beat_daneben_landet_ist_rot(self, tmp_path, ext):
        st, _, _ = ext_schritt(tmp_path, ext, j1.schritt_hotcues, "j1.hotcues", fehler=["hotcue_schief"])
        assert st["urteil"] == "FEHL"
        assert st["werte"]["schuss_abweichung_beats"] == pytest.approx(1.0, abs=0.1)

    # -- jumps
    def test_sprung_gruen(self, tmp_path, ext):
        st, _, _ = ext_schritt(tmp_path, ext, j1.schritt_sprung, "j1.sprung")
        assert st["urteil"] == "OK", st
        assert [round(s["bewegt"]) for s in st["werte"]["spruenge"]] == [8, -8]

    def test_zu_kurzer_sprung_ist_rot(self, tmp_path, ext):
        st, _, _ = ext_schritt(tmp_path, ext, j1.schritt_sprung, "j1.sprung", fehler=["sprung_zu_kurz"])
        assert st["urteil"] == "FEHL" and "does not move the deck" in st["grund"]

    # -- the deck loop
    def test_loop_gruen(self, tmp_path, ext):
        st, seite, _ = ext_schritt(tmp_path, ext, j1.schritt_loop, "j1.loop")
        assert st["urteil"] == "OK", st
        assert st["werte"]["draussen"] == 0 and st["werte"]["runden"] >= 1
        assert st["werte"]["laengen"] == {str(n): True for n in j1.LOOP_LAENGEN}
        assert seite.schleife is None, "the loop is off again"

    def test_loop_der_nicht_haelt_ist_rot(self, tmp_path, ext):
        st, _, _ = ext_schritt(tmp_path, ext, j1.schritt_loop, "j1.loop", fehler=["loop_haelt_nicht"])
        assert st["urteil"] == "FEHL" and "left the 4-beat loop" in st["grund"]

    # -- scrub
    def test_scrub_gruen(self, tmp_path, ext):
        st, _, _ = ext_schritt(tmp_path, ext, j1.schritt_scrub, "j1.scrub")
        assert st["urteil"] == "OK", st
        assert abs(st["werte"]["abweichung_hin_zurueck"]) <= j1.SCRUB_TOLERANZ_BEATS
        assert st["werte"]["zug_bewegt"] == pytest.approx(j1.SCRUB_BEATS, abs=0.1)

    def test_scrub_der_die_phase_verliert_ist_rot(self, tmp_path, ext):
        st, _, _ = ext_schritt(tmp_path, ext, j1.schritt_scrub, "j1.scrub", fehler=["scrub_phase_verloren"])
        assert st["urteil"] == "FEHL" and "does not keep the phase" in st["grund"]

    # -- pre-listen
    def test_vorhoeren_gruen_und_pfl_wird_als_hand_gerufen(self, tmp_path, ext):
        st, seite, z = ext_schritt(tmp_path, ext, j1.schritt_vorhoeren, "j1.vorhoeren")
        assert st["urteil"] == "OK", st
        assert st["werte"]["cue_mit_pfl_db"] > -60 and st["werte"]["master_db"] <= -60
        assert ("POST", "/regler", "andreas") in seite.aufrufe
        assert any("pfl" in n for n in z.als_andreas)
        assert seite.regler["deck/1/pfl"] == 0.0, "PFL is off again"

    def test_vorhoeren_ohne_cue_ist_rot(self, tmp_path, ext):
        st, _, _ = ext_schritt(tmp_path, ext, j1.schritt_vorhoeren, "j1.vorhoeren", fehler=["pfl_wirkt_nicht"])
        assert st["urteil"] == "FEHL" and "cue meter" in st["grund"]

    def test_vorhoeren_das_in_den_master_leckt_ist_rot(self, tmp_path, ext):
        st, _, _ = ext_schritt(tmp_path, ext, j1.schritt_vorhoeren, "j1.vorhoeren", fehler=["pfl_leckt"])
        assert st["urteil"] == "FEHL" and "master" in st["grund"]

    # -- pre-listen deck
    def test_vorhoerdeck_gruen(self, tmp_path, ext):
        st, seite, z = ext_schritt(tmp_path, ext, j1.schritt_vorhoerdeck, "j1.vorhoerdeck")
        assert st["urteil"] == "OK", st
        assert st["werte"]["cue_db"] > -60 and st["werte"]["master_db"] <= -60 and st["werte"]["cue_danach_db"] <= -60
        assert "POST /vorhoeren" in z.als_andreas and seite.vorh is False

    def test_vorhoerdeck_ohne_kopfhoerer_ist_ein_skip_und_kein_rot(self, tmp_path, ext):
        st, _, _ = ext_schritt(tmp_path, ext, j1.schritt_vorhoerdeck, "j1.vorhoerdeck", fehler=["kein_kopfhoerer"])
        assert st["urteil"] == "SKIP" and "409" in st["grund"], st

    def test_vorhoerdeck_das_stumm_bleibt_ist_rot(self, tmp_path, ext):
        st, _, _ = ext_schritt(tmp_path, ext, j1.schritt_vorhoerdeck, "j1.vorhoerdeck", fehler=["vorhoerdeck_stumm"])
        assert st["urteil"] == "FEHL" and "cue meter" in st["grund"]

    # -- compressor
    def test_kompressor_gruen(self, tmp_path, ext):
        st, seite, _ = ext_schritt(tmp_path, ext, j1.schritt_kompressor, "j1.kompressor")
        assert st["urteil"] == "OK", st
        assert st["werte"]["minderung_db"] >= j1.KOMP_MINDERUNG_DB
        assert seite.regler["deck/1/komp/an"] == 0.0

    def test_kompressor_der_nichts_tut_ist_rot(self, tmp_path, ext):
        st, _, _ = ext_schritt(tmp_path, ext, j1.schritt_kompressor, "j1.kompressor", fehler=["komp_wirkt_nicht"])
        assert st["urteil"] == "FEHL" and "less than" in st["grund"]

    # -- cue output
    def test_ausgang_gruen(self, tmp_path, ext):
        st, seite, _ = ext_schritt(tmp_path, ext, j1.schritt_ausgang, "j1.ausgang")
        assert st["urteil"] == "OK", st
        assert abs(st["werte"]["cue_gegen_master_db"] - j1.CUE_MASTER_DB) <= j1.CUE_MASTER_TOLERANZ_DB
        assert seite.regler["cue/mix"] == -1 and seite.regler["cue/pegel"] == j1.CUE_MASTER_DB

    def test_ausgang_dessen_mix_nichts_aendert_ist_rot(self, tmp_path, ext):
        st, _, _ = ext_schritt(tmp_path, ext, j1.schritt_ausgang, "j1.ausgang", fehler=["cue_mix_wirkt_nicht"])
        assert st["urteil"] == "FEHL" and "cue" in st["grund"]

    # -- hall
    def test_hall_gruen(self, tmp_path, ext):
        st, seite, _ = ext_schritt(tmp_path, ext, j1.schritt_hall, "j1.hall")
        assert st["urteil"] == "OK", st
        assert st["werte"]["verlaengert_s"] >= j1.HALL_VERLAENGERUNG_S
        assert seite.fx_zu == {2: "master"} and seite.fx["art"] == j1.HALL_ART

    def test_hall_der_den_schwanz_nicht_verlaengert_ist_rot(self, tmp_path, ext):
        st, _, _ = ext_schritt(tmp_path, ext, j1.schritt_hall, "j1.hall", fehler=["hall_wirkt_nicht"])
        assert st["urteil"] == "FEHL" and "longer" in st["grund"]

    # -- the whole extension leaves the instance as it found it
    def test_aufraeumen_stellt_alles_zurueck(self, tmp_path, ext):
        seite = ErweiterungSeite(ext)
        try:
            t = j1_tour(seite, tmp_path / "aus")
            z = j1.Zustand()
            t.fuehre(lambda t: (j1.schritt_hotcues(t, z), j1.schritt_vorhoeren(t, z), j1.schritt_kompressor(t, z), j1.erweiterung_aufraeumen(t, z)))
            assert seite.status == 0 and seite.regler["deck/1/fader"] == -200
            assert seite.regler["deck/1/pfl"] == 0 and seite.regler["deck/1/komp/an"] == 0 and seite.cues == {}
        finally:
            seite.ende()


class TestJ3ExportBereit:
    """A proj_export that the product refuses with audio_fehlt (a clip is still being decoded) is asked again until the deadline."""

    @pytest.fixture(autouse=True)
    def schnell(self, monkeypatch):
        monkeypatch.setattr(J3MOD, "EXPORT_BEREIT_FRIST_S", 0.8)

    @pytest.fixture
    def seite(self):
        s = J3Seite()
        yield s
        s.ende()

    def lauf(self, seite, tmp_path, **hand_kw):
        ohne, nach = tmp_path / "ohne.wav", tmp_path / "nach.wav"
        j3_wav(ohne)
        j3_wav(nach, ton_sek=14.0)
        basis = {"frames": 768000, "spitze_db": -12.0, "ueber_decke": False, "limiter_db_max": 0}
        hand = J3Hand({**basis, "datei": str(nach)}, export_ohne={**basis, "datei": str(ohne)}, **hand_kw)
        t = L.Tour("j3", J3Instanz(seite.url), tmp_path / "aus", kurz=True)
        rc = t.fuehre(lambda tt: J3MOD.schritte(tt, hand=hand))
        return rc, {s["kennung"]: s for s in t.bericht().schritte}, hand

    def test_a_clip_that_is_ready_after_two_refusals_makes_warp_and_export_green(self, seite, tmp_path):
        rc, s, hand = self.lauf(seite, tmp_path, audio_fehlt_zuerst=2)
        assert s["j3.warp"]["urteil"] == "OK" and s["j3.export"]["urteil"] == "OK"
        assert s["j3.warp"]["werte"]["export_versuche"] == 3        # two refusals, then the reference export
        assert [n for n, _ in hand.aufrufe].count("proj_export") == 5   # 3 for the reference, one after the warp, one for the export step

    def test_a_clip_that_never_gets_ready_is_red_with_the_products_reason_after_the_deadline(self, seite, tmp_path):
        rc, s, hand = self.lauf(seite, tmp_path, audio_fehlt_zuerst=None)
        assert s["j3.warp"]["urteil"] == "FEHL" and s["j3.warp"]["grund"] == "audio_fehlt"
        assert s["j3.export"]["urteil"] == "FEHL" and s["j3.export"]["grund"] == "audio_fehlt"
        assert [n for n, _ in hand.aufrufe].count("proj_export") >= 4   # asked more than once per step before giving up
        assert rc == 1

    def test_another_refusal_is_not_waited_for(self, seite, tmp_path):
        t = L.Tour("j3", J3Instanz(seite.url), tmp_path / "aus", kurz=True)
        hand = J3Hand({"fehler": "export_luecke", "text": "gap", "_fehler": True})
        rc = t.fuehre(lambda tt: J3MOD.schritte(tt, hand=hand))
        s = {x["kennung"]: x for x in t.bericht().schritte}
        assert s["j3.export"]["grund"] == "export_luecke"
        assert [n for n, _ in hand.aufrufe].count("proj_export") == 2   # the warp reference and the export step, no retries

    def test_the_effect_step_export_waits_too(self, seite, tmp_path):
        w = tmp_path / "fx.wav"
        j3_wav(w)
        hand = J3Hand({"datei": str(w), "frames": 768000, "spitze_db": -12.0, "_fehler": False}, audio_fehlt_zuerst=2)
        t = L.Tour("j3", J3Instanz(seite.url), tmp_path / "aus", kurz=True)
        with t.schritt("j3.fx", "probe"):
            r, x = J3MOD._fx_export(t, hand, 0, 16)
        assert r is not None and x is not None
        assert [n for n, _ in hand.aufrufe].count("proj_export") == 3
