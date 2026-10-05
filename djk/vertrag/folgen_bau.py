"""Baukasten für Golden-Folgen (SCHNITTSTELLEN.md §19.0, Format folgen/FORMAT.md samt den Zusätzen ab Punkt 13).

Jede Methode schreibt Zeilen in eine Folge; Samples kommen aus karte.py (Scheibe 02), alle anderen Zahlen aus
herleitung.py, nie von Hand. Typ-Zeichenketten kommen aus osc.json (Scheibe 02), der einen Quelle.
"""
import json
import pathlib

import herleitung as h
from karte import Karte, ziel_sample

HIER = pathlib.Path(__file__).resolve().parent
TYPEN = {a["adresse"]: a["typen"] for a in json.loads((HIER / "osc.json").read_text(encoding="utf-8"))["adressen"]}

MARGE = 2400          # 50 ms: bis dahin muss eine Quittung nach ihrem Ereignis-Sample da sein
ZYKLEN2 = 512         # zwei Zyklen bei Quantum 256: Fenster für zyklusweise geprüfte Ereignisse
LADEN_FRIST = 48000   # 1 s für Laden bis fertig (Kopie liegt schon im Arbeitsbestand)
STARTFRIST = 12000    # 250 ms: Zusage "Kern wieder hörbar" (ARCHITEKTUR §7)
TOL = 1e-6            # Toleranz für Beats und andere Gleitkommawerte in Quittungen (FORMAT.md Punkt 6: Vorgabe 0)
ANGENOMMEN, GESTARTET, FERTIG, VERWORFEN, VERSP_AUSGEFUEHRT, ABGELEHNT, ABGEBROCHEN = 1, 2, 3, 4, 5, 6, 7


def inhalt(material_id, bpm=128.0, fassung=1, schuss=None):
    """§4.5 inhalt: <material_id>/<bpm·1000>_r<fassung>[/s<nr>]."""
    s = f"{material_id}/{int(round(bpm * 1000))}_r{fassung}"
    return s + (f"/s{schuss}" if schuss else "")


def osc(adresse, *werte):
    return [adresse, TYPEN[adresse], *werte]


def _hat_gleitkomma(nachricht):
    return any(t in "fd" and isinstance(w, float) for t, w in zip(nachricht[1][1:], nachricht[2:]))


class Folge:
    def __init__(self, name, vertrag, fuer, zweck, bpm=128.0, zeitachse=True):
        self.name, self.vertrag, self.fuer, self.zweck = name, vertrag, fuer, zweck
        self.karte = Karte(bpm)
        self.zeilen = []
        self._id = 0
        self.material = set()
        if zeitachse:   # Rechner-Folgen haben keine Zeitachse (FORMAT.md Punkt 17)
            self.sende(0, osc("/k/set/neu", self.nid(), "pruefstand", float(bpm)), "zeitachse",
                       f"§4.2: neue Zeitachse mit {bpm:g} BPM, Beat 0 am nächsten Zyklus = Sample 0 (§1.1)")

    # --- Grundzeilen -------------------------------------------------------------------------------------------
    def S(self, beat):
        return ziel_sample(self.karte, beat)

    def nid(self):
        self._id += 1
        return self._id

    def _zeile(self, d, bereich, herleitung):
        if bereich:
            d["bereich"] = bereich
        if herleitung:
            d["herleitung"] = herleitung
        self.zeilen.append(d)

    def sende(self, sample, nachricht, bereich, herleitung=None):
        self._zeile({"t": "sende", "sample": sample, "osc": nachricht}, bereich, herleitung)

    def buendel(self, sample, nachrichten, bereich, herleitung=None):
        self._zeile({"t": "buendel", "sample": sample, "nachrichten": nachrichten}, bereich, herleitung)

    def hand(self, sample, pfad, midi_roh, herleitung=None):
        self._zeile({"t": "hand", "sample": sample, "pfad": pfad, "midi_roh": midi_roh}, "regler", herleitung)

    def _fenster(self, t, bis, nachricht, bereich, ab, toleranz, herleitung):
        d = {"t": t}
        if ab is not None:
            d["ab_sample"] = ab
        d["bis_sample"] = bis
        d["osc"] = nachricht
        if toleranz is None and _hat_gleitkomma(nachricht):
            toleranz = TOL
        if toleranz is not None:
            d["toleranz"] = toleranz
        self._zeile(d, bereich, herleitung)

    def erwarte(self, bis, nachricht, bereich, ab=None, toleranz=None, herleitung=None):
        self._fenster("erwarte", bis, nachricht, bereich, ab, toleranz, herleitung)

    def erwarte_nicht(self, ab, bis, nachricht, bereich, toleranz=None, herleitung=None):
        self._fenster("erwarte_nicht", bis, nachricht, bereich, ab, toleranz, herleitung)

    def erlaube(self, ab, bis, nachricht, bereich, herleitung):
        self._fenster("erlaube", bis, nachricht, bereich, ab, None, herleitung)

    def wert(self, sample, pfad, wert, toleranz, bereich, herleitung=None):
        self._zeile({"t": "wert", "sample": sample, "pfad": pfad, "wert": wert, "toleranz": toleranz}, bereich, herleitung)

    def deck_wert(self, sample, deck, feld, wert, toleranz, bereich="deck", herleitung=None):
        self._zeile({"t": "deck_wert", "sample": sample, "deck": deck, "feld": feld, "wert": wert, "toleranz": toleranz},
                    bereich, herleitung)

    def messung(self, sample, name, wert, toleranz, herleitung=None):
        self._zeile({"t": "messung", "sample": sample, "name": name, "wert": wert, "toleranz": toleranz}, "pruefstand",
                    herleitung)

    def aktion(self, sample, was, herleitung=None):
        self._zeile({"t": "aktion", "sample": sample, "was": was}, "pruefstand", herleitung)

    def ws_sende(self, sample, typ, daten, herleitung=None):
        self._zeile({"t": "ws_sende", "sample": sample, "typ": typ, "daten": daten}, "leitstand", herleitung)

    def ws_erwarte(self, ab, bis, typ, daten, herleitung=None):
        self._zeile({"t": "ws_erwarte", "ab_sample": ab, "bis_sample": bis, "typ": typ, "daten": daten}, "leitstand",
                    herleitung)

    def rechner_frage(self, zeile, herleitung=None):
        self._zeile({"t": "rechner_frage", "zeile": zeile}, "rechner", herleitung)

    def rechner_antwort(self, zeile, herleitung=None):
        self._zeile({"t": "rechner_antwort", "zeile": zeile}, "rechner", herleitung)

    # --- Quittungen --------------------------------------------------------------------------------------------
    def q(self, id_, quelle, status, ist_sample, ist_beat, grund, bis, ab=None, bereich="regler", toleranz=None,
          herleitung=None):
        self.erwarte(bis, osc("/q", id_, quelle, status, ist_sample, ist_beat, grund), bereich, ab=ab,
                     toleranz=toleranz, herleitung=herleitung)

    def angenommen(self, id_, quelle, gesendet, bereich):
        self.q(id_, quelle, ANGENOMMEN, None, None, "", gesendet + MARGE, ab=gesendet, bereich=bereich,
               herleitung="§5.1 Status 1: im Ring, Prüfung beim Einsortieren bestanden")

    def gestartet(self, id_, quelle, ab, bereich="regler", herleitung=None):
        s = self.S(ab)
        self.q(id_, quelle, GESTARTET, s, float(ab), "", s + MARGE, ab=s, bereich=bereich,
               herleitung=herleitung or f"§5.1 Status 2 am Ziel-Sample llround(sample_at({ab:g})) = {s}")

    def fertig(self, id_, quelle, ende_beat, bereich="regler", herleitung=None):
        s = self.S(ende_beat)
        self.q(id_, quelle, FERTIG, s, float(ende_beat), "", s + MARGE, ab=s, bereich=bereich,
               herleitung=herleitung or f"§5.1 Status 3: Rampe am Ende, Beat {ende_beat:g} = Sample {s}")

    def fertig_setzen(self, id_, quelle, ab, bereich="regler"):
        s = self.S(ab)
        self.q(id_, quelle, FERTIG, None, None, "", s + 480 + ZYKLEN2, ab=s, bereich=bereich,
               herleitung="§1.5 Schaltrampe 10 ms (480 Samples) nach dem Setzen, danach fertig")

    def abgelehnt_am_start(self, id_, quelle, ab, grund, bereich="regler", herleitung=None):
        s = self.S(ab)
        self.q(id_, quelle, ABGELEHNT, s, float(ab), grund, s + MARGE, ab=s, bereich=bereich,
               herleitung=herleitung or f"§17: am Start abgelehnt ({grund}), Start = Sample {s}")
        if grund in I3_GRUENDE:
            self.erlaube(s, s + MARGE, osc("/e/invariante", "hoerschein", None, None, None, None), "invariante",
                         "FORMAT.md Punkt 22 a: ob eine I3-Ablehnung zusätzlich /e/invariante hoerschein meldet, "
                         "lässt §5.9 offen")

    def nicht_gestartet(self, id_, quelle, ab_beat, bis_beat, bereich="regler", herleitung=None):
        self.erwarte_nicht(self.S(ab_beat), self.S(bis_beat), osc("/q", id_, quelle, GESTARTET, None, None, None), bereich,
                           herleitung=herleitung)

    def nicht_fertig(self, id_, quelle, ab_beat, bis_beat, bereich="regler", herleitung=None):
        self.erwarte_nicht(self.S(ab_beat), self.S(bis_beat), osc("/q", id_, quelle, FERTIG, None, None, None), bereich,
                           herleitung=herleitung)

    # --- Befehle -----------------------------------------------------------------------------------------------
    def teil(self, sende_beat, quelle, plan, nr, pfad, ab, dauer, nach, form=0, politik=0, gruppe="", hs="",
             angenommen=True, herleitung=None):
        i = self.nid()
        s = self.S(sende_beat)
        self.sende(s, osc("/k/teil", i, quelle, plan, nr, pfad, float(ab), float(dauer), float(nach), form, politik,
                          gruppe, hs), "regler", herleitung)
        if angenommen:
            self.angenommen(i, quelle, s, "regler")
        return i

    def laden(self, sende_beat, deck, material_id, quelle="leitstand", mit_stems=0, ergebnis="fertig", grund=""):
        i = self.nid()
        s = self.S(sende_beat)
        self.material.add(material_id)
        self.sende(s, osc("/k/deck/laden", i, quelle, deck, material_id, 128.0, 1, mit_stems), "deck",
                   f"§4.4 /k/deck/laden, Fixture folgen/material/{material_id}/")
        if ergebnis == "fertig":
            self.angenommen(i, quelle, s, "deck")
            self.q(i, quelle, FERTIG, None, None, "", s + LADEN_FRIST, ab=s, bereich="deck",
                   herleitung="§4.4: Quittung fertig nach dem Tausch")
            self.erwarte(s + LADEN_FRIST, osc("/e/geladen", deck, material_id, 128.0, 1, mit_stems, None), "deck", ab=s,
                         herleitung="§4.4, §5.9 /e/geladen")
        else:
            self.q(i, quelle, ABGELEHNT, None, None, grund, s + LADEN_FRIST, ab=s, bereich="deck",
                   herleitung=f"§4.4: Laden abgelehnt, Grund {grund}")
        return i

    def _deck(self, adresse, sende_beat, quelle, plan, gruppe, hs, deck, *rest, angenommen=True, herleitung=None):
        i = self.nid()
        s = self.S(sende_beat)
        self.sende(s, osc(adresse, i, quelle, plan, gruppe, hs, deck, *rest), "deck", herleitung)
        if angenommen:
            self.angenommen(i, quelle, s, "deck")
        return i

    def deck_start(self, sende_beat, deck, ab, quell, quelle="andreas", plan="", gruppe="", hs="", politik=0, **kw):
        return self._deck("/k/deck/start", sende_beat, quelle, plan, gruppe, hs, deck, float(ab), float(quell), politik,
                          **kw)

    def deck_stopp(self, sende_beat, deck, ab, quelle="andreas", plan="", gruppe="", hs="", politik=1, **kw):
        return self._deck("/k/deck/stopp", sende_beat, quelle, plan, gruppe, hs, deck, float(ab), politik, **kw)

    def deck_loop(self, sende_beat, deck, ab, laenge, quelle="andreas", politik=0, raster=0.0, plan="", gruppe="", hs="",
                  **kw):
        return self._deck("/k/deck/loop", sende_beat, quelle, plan, gruppe, hs, deck, float(ab), float(laenge), politik,
                          float(raster), **kw)

    def deck_roll(self, sende_beat, deck, ab, laenge, quelle="andreas", art=0, politik=0, raster=0.0, **kw):
        return self._deck("/k/deck/roll", sende_beat, quelle, "", "", "", deck, float(ab), float(laenge), art, politik,
                          float(raster), **kw)

    def deck_sprung(self, sende_beat, deck, ab, delta, quelle="andreas", politik=0, raster=0.0, plan="", gruppe="",
                    hs="", **kw):
        return self._deck("/k/deck/sprung", sende_beat, quelle, plan, gruppe, hs, deck, float(ab), float(delta), politik,
                          float(raster), **kw)

    def deck_hotcue(self, sende_beat, deck, ab, nr, quelle="andreas", politik=0, raster=0.0, **kw):
        return self._deck("/k/deck/hotcue", sende_beat, quelle, "", "", "", deck, float(ab), nr, politik, float(raster),
                          **kw)

    def hotcue_setzen(self, sende_beat, deck, nr, quell_beat, material_id, quelle="andreas"):
        i = self.nid()
        s = self.S(sende_beat)
        self.sende(s, osc("/k/deck/hotcue_setzen", i, quelle, deck, nr, float(quell_beat)), "deck")
        self.angenommen(i, quelle, s, "deck")
        self.erwarte(s + MARGE, osc("/e/hotcue", deck, material_id, nr, float(quell_beat), None), "deck", ab=s,
                     herleitung="§4.4 hotcue_setzen → Ereignis /e/hotcue")
        return i

    def hoerschein(self, sende_beat, hs_id, kanal, inh, gueltig_bis, quell_von, quell_bis, bpm=128.0):
        i = self.nid()
        s = self.S(sende_beat)
        qv = "NaN" if quell_von is None else float(quell_von)
        qb = "NaN" if quell_bis is None else float(quell_bis)
        self.sende(s, osc("/k/hoerschein", i, "pruefstand", hs_id, kanal, inh, "ok", float(bpm), float(gueltig_bis),
                          qv, qb, 0.5, 0.0, -14.0), "hoerschein",
                   "§4.5 Hörschein registrieren (Quelle pruefstand: §1.4 kennt keine Quelle analyse)")
        self.q(i, "pruefstand", None, None, None, None, s + MARGE, ab=s, bereich="hoerschein",
               herleitung="§4: jeder Befehl bekommt eine /q; welchen Status legt §4.5 nicht fest")
        return dict(kanal=kanal, inhalt=inh, gueltig_bis_beat=gueltig_bis, bpm_messung=bpm,
                    quell_von=quell_von, quell_bis=quell_bis, id=hs_id)

    def hand_auf(self, pfad, beat, herleitung=None):
        """§7.3 Punkt 2: erster Wert nur Stellung (0,0), dann Anschlag oben (1,0) = Obergrenze des Reglers.
        Danach steht der Regler physisch auf 1,0: ein späterer Griff an ihm beginnt dort (kein erster Wert mehr)."""
        self.hand(self.S(beat), pfad, 0.0, "§7.3 Punkt 2: erster Wert setzt nur die Stellung")
        self.hand(self.S(beat + 1), pfad, 1.0, herleitung or "§7.2 Übernahme skaliert: Anschlag oben = Obergrenze")
        self.erwarte(self.S(beat + 1) + MARGE, osc("/e/halter", pfad, "mensch", self.S(beat + 1), float(beat + 1)),
                     "regler", ab=self.S(beat + 1), herleitung="§7.3 Punkt 3, ADR 023: Halter mensch am selben Sample")
        frei = beat + 1 + h.HALTER_RUECKGABE_BEATS
        self.erwarte(self.S(frei) + ZYKLEN2, osc("/e/halter", pfad, "frei", None, None), "regler", ab=self.S(frei),
                     herleitung=f"§7.3 Punkt 4: 32 Beats ohne Handbewegung → frei bei Beat {frei:g}")


I3_GRUENDE = ("kein_hoerschein", "hoerschein_anderer_kanal", "hoerschein_anderer_inhalt", "hoerschein_anderes_tempo",
              "hoerschein_abgelaufen", "hoerschein_anderer_abschnitt", "ziel_ungehoert")
MA, MB, MC, MD, ME = "f0000000000000a1", "f0000000000000b2", "f0000000000000c3", "f0000000000000d4", "f0000000000000e5"
M96, M128, MFEHLT = "f000000000000096", "f000000000000128", "f0000000000000ff"
SPUR = 22500.0  # Samples je Beat bei 128 BPM (§1.3: 48000·60/128)


def a_hoerbar(f, deck=1, material=MA, start=8):
    """A läuft ab Beat `start` von Quell-Beat 0, Fader per Hand auf 0 dB (Andreas' Deck, hörbar nach §1.6)."""
    f.laden(1, deck, material)
    ida = f.deck_start(start - 4, deck, start, 0.0, herleitung="A: Andreas' Deck, ohne Plan")
    f.gestartet(ida, "andreas", start, "deck")
    f.hand_auf(f"deck/{deck}/fader", start + 1)


def b_rein(f, plan, sende_beat, S, quell, hs_id, gruppe="b_rein", eq_zu=True, gruppe_fader=None):
    """B rein wie §14.1 Teile 0 bis 3: Start am Einstieg, Bass zu, Fader -15 mit Hörschein, Rampe auf 0 über 32 Beats.
    Den Bass schließt das Setzen einen Beat vor S, solange B noch hinter dem geschlossenen Fader liegt: so hält I1 bei
    beiden Lesarten des Setzens (Zielwert oder Schaltrampe, FORMAT.md Punkt 22 n).
    gruppe_fader: Gruppe der zwei Fader-Teile; "" (keine Kopplung), wo die Folge ihre Ablehnung prüft, damit das
    Ergebnis nicht davon abhängt, ob eine Ablehnung die Gruppe mitreißt (FORMAT.md Punkt 22 b)."""
    ids = {}
    gf = gruppe if gruppe_fader is None else gruppe_fader
    ids["start"] = f.deck_start(sende_beat, 2, S, quell, quelle="cypher", plan=plan, gruppe=gruppe)
    nr = 1
    if eq_zu:
        ids["eq"] = f.teil(sende_beat, "cypher", plan, nr, "deck/2/eq/tief", S - 1, 0, -30.0, gruppe=gruppe,
                           herleitung="Bass zu einen Beat vor S, B noch stumm (FORMAT.md Punkt 22 n)")
        nr += 1
    ids["setz"] = f.teil(sende_beat, "cypher", plan, nr, "deck/2/fader", S, 0, -15.0, gruppe=gf, hs=hs_id,
                         herleitung="öffnet deck/2 (−15 > −26, §1.6): I3a braucht den Hörschein")
    ids["rampe"] = f.teil(sende_beat, "cypher", plan, nr + 1, "deck/2/fader", S, 32, 0.0, gruppe=gf, hs=hs_id)
    return ids
