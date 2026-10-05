"""Herleitung der Golden-Erwartungswerte aus dem Vertragstext (SCHNITTSTELLEN.md §1.2, §1.5, §1.6, §4, §7.3, §14.4,
§16, §17). Die Tempo-Karte §1.3 kommt aus karte.py (Scheibe 02), nicht aus einer zweiten Umsetzung.

Jede Funktion trägt den Abschnitt, aus dem sie stammt. Keine Funktion kennt Kern, Attrappe oder Leitstand: das hier
ist die dritte, unabhängige Lesart des Vertrags, gegen die beide gemessen werden.
"""
import json
import math
import re

SR = 48000
STUMM = -200.0            # §1.2
STUMM_GRENZE = -120.0     # §1.2: jeder Wert <= -120 gilt als stumm
RAMPE_STUMM_DB = -60.0    # §1.2: Rampen von/nach stumm interpolieren bis/ab -60 dB
HOERBAR_DB = -26.0        # §1.6, §2.1 hoerbar_db
TIEF_OFFEN_DB = -12.0     # §1.6, §2.1 tief_offen_db
HS_TEMPO_TOLERANZ = 0.005 # §17 I3: |bpm_jetzt/bpm_messung - 1| <= 0,005
HS_ABSCHNITT_NACHLAUF = 64.0  # §17 I3a: Quellposition in [quell_von, quell_bis + 64]
HS_GUELTIG_BEATS = 64.0   # §14.5: gueltig_bis_beat = gemessen_bis_beat + 64
TOTZONE = 3.0 / 128.0     # §7.3 Punkt 3
HALTER_RUECKGABE_BEATS = 32.0  # §7.3 Punkt 4
KI_STOPP_BEATS = 4.0      # §4.7 /k/ki/stopp
FRIST_BEATS = 32.0        # §17 Frist-Wächter
RUECKFALL_LAENGE = 16.0   # §17 Frist-Wächter


def llround(x):
    """§1.1: Runden auf die nächste ganze Zahl, bei ,5 vom Nullpunkt weg (C llround); wie karte.ziel_sample."""
    return int(math.floor(x + 0.5)) if x >= 0 else -int(math.floor(-x + 0.5))


def takt_beat(takt):
    """§10: ab_beat = (ab_takt - 1)·4 (Schlag 1)."""
    return (takt - 1) * 4.0


def ist_db_regler(pfad):
    """§1.5: Regler in dB (Rampen dort mit der Stumm-Regel §1.2)."""
    return pfad.endswith(("/fader", "/trim", "/eq/tief", "/eq/mitte", "/eq/hoch", "/rueckweg")) \
        or "/send/" in pfad or "/stem/" in pfad or pfad in ("master/pegel", "cue/pegel", "duck/tiefe")


def form_f(u, form):
    """§4.3 Feld 9: 0 linear, 1 S-Kurve u -> 3u² - 2u³."""
    u = min(1.0, max(0.0, u))
    return u if form == 0 else 3 * u * u - 2 * u * u * u


def rampe_wert(pfad, w0, nach, ab_beat, dauer_beats, beat, form=0):
    """§4.3 Semantik plus §1.2 Stumm-Regel; Beat-Zeit, also unabhängig vom Tempo."""
    if beat < ab_beat:
        return w0
    if dauer_beats == 0:
        return nach
    u = (beat - ab_beat) / dauer_beats
    if u >= 1.0:
        return nach
    if ist_db_regler(pfad) and nach <= STUMM_GRENZE:
        return w0 + (RAMPE_STUMM_DB - w0) * form_f(u, form)
    if ist_db_regler(pfad) and w0 <= STUMM_GRENZE:
        if u <= 0.0:
            return w0
        return RAMPE_STUMM_DB + (nach - RAMPE_STUMM_DB) * form_f(u, form)
    return w0 + (nach - w0) * form_f(u, form)


def beat_bei_wert(w0, nach, ab_beat, dauer_beats, schwelle):
    """Beat, an dem eine lineare Rampe w0 -> nach die Schwelle kreuzt (für I1/I2-Haltepunkte)."""
    return ab_beat + dauer_beats * (schwelle - w0) / (nach - w0)


def restrampe_wert(w_start, nach, start_beat, ende_beat, beat):
    """§16.1 Politik 1 zu spät: Restrampe vom Ist-Wert am tatsächlichen Start bis zum unveränderten Ende-Beat."""
    if beat >= ende_beat:
        return nach
    return w_start + (nach - w_start) * (beat - start_beat) / (ende_beat - start_beat)


def kanalpegel(trim, fader):
    """§1.6: Kanalpegel = trim + fader."""
    return trim + fader


def offen(trim, fader):
    """§1.6: offen <=> Kanalpegel > -26 dB (unabhängig von Bus, Crossfader, Master)."""
    return kanalpegel(trim, fader) > HOERBAR_DB


def hoerbar(trim, fader, x_gewicht_db=0.0, bus_db=0.0, master_db=0.0, ist_deck=True, deck_laeuft=True):
    """§1.6: effektiver Kanalpegel > -26 dB und, bei Decks, das Deck läuft (Status 2 bis 5)."""
    eff = kanalpegel(trim, fader) + x_gewicht_db + bus_db + master_db
    return eff > HOERBAR_DB and (deck_laeuft or not ist_deck)


def tief_offen(ist_hoerbar, kill_tief, eq_tief, stem_bass=None):
    """§1.6: hörbar ∧ kill/tief = 0 ∧ eq/tief > -12 (mit Stems zusätzlich stem/bass > -12)."""
    return ist_hoerbar and kill_tief == 0 and eq_tief > TIEF_OFFEN_DB and (stem_bass is None or stem_bass > TIEF_OFFEN_DB)


def trim_beim_laden(ziel_lufs, lufs_integriert):
    """§1.5: Trim = ziel_lufs - lufs_integriert, auf -24 bis +24 begrenzt."""
    return max(-24.0, min(24.0, ziel_lufs - lufs_integriert))


def hs_grund(hs, kanal, inhalt, beat, bpm_jetzt, quell_bei_ab=None):
    """§17 I3a (und §16.2 Codes): None, wenn der Hörschein gilt, sonst der Grund.
    hs = None heißt: keine gültige hs_id angegeben oder unbekannt."""
    if hs is None:
        return "kein_hoerschein"
    if hs["kanal"] != kanal:
        return "hoerschein_anderer_kanal"
    if hs["inhalt"] != inhalt:
        return "hoerschein_anderer_inhalt"
    if beat > hs["gueltig_bis_beat"]:
        return "hoerschein_abgelaufen"
    if abs(bpm_jetzt / hs["bpm_messung"] - 1.0) > HS_TEMPO_TOLERANZ:
        return "hoerschein_anderes_tempo"
    if quell_bei_ab is not None and not (hs["quell_von"] <= quell_bei_ab <= hs["quell_bis"] + HS_ABSCHNITT_NACHLAUF):
        return "hoerschein_anderer_abschnitt"
    return None


def phase(x):
    """§4.4 hotcue: phase(x) = x - floor(x)."""
    return x - math.floor(x)


def wrap(x):
    """§4.4 hotcue: nach [-0,5; 0,5)."""
    return x - math.floor(x + 0.5)


def hotcue_ziel(p, hc):
    """§4.4: ziel = hc + wrap(phase(p) - phase(hc))."""
    return hc + wrap(phase(p) - phase(hc))


def rueckfall_q0(q_ende, e):
    """§17 Frist-Wächter: q0 = e + floor((Q_ende - e - 16)/16)·16."""
    return e + math.floor((q_ende - e - RUECKFALL_LAENGE) / RUECKFALL_LAENGE) * RUECKFALL_LAENGE


def naechster_rasterpunkt(ankunft_beat, raster_beats):
    """§4 Politik 2, §16.1: nächster erreichbarer Rasterpunkt der Größe raster_beats (streng nach der Ankunft)."""
    return math.floor(ankunft_beat / raster_beats + 1.0) * raster_beats


def loop_position(q_start_loop, laenge, q_ohne_loop):
    """§4.4 loop (Band) und §17 Rückfall-Loop: Position, wenn das Deck ohne Loop bei q_ohne_loop stünde. Vor dem
    Loop-Anfang (Rückfall-Loop liegt vor dem Lesekopf, §17) läuft das Deck geradeaus, danach kreist es in
    [q_start, q_start + laenge)."""
    if q_ohne_loop < q_start_loop:
        return q_ohne_loop
    return q_start_loop + (q_ohne_loop - q_start_loop) % laenge


def i4_ueberlappt(a, b):
    """§17 I4: a, b = (ab_beat, dauer_beats, nr) am selben Regler. Rampen als [ab, ab+dauer), Setzen als Punkt.
    Setzen am selben Beat wie eine anschließende Rampe ist erlaubt (Reihenfolge nach Teil-Nummer)."""
    (a0, ad, an), (b0, bd, bn) = a, b
    if ad > 0 and bd > 0:
        return max(a0, b0) < min(a0 + ad, b0 + bd)
    if ad == 0 and bd == 0:
        return a0 == b0
    setzen, rampe = (a, b) if ad == 0 else (b, a)
    s0, _, sn = setzen
    r0, rd, rn = rampe
    if s0 == r0:
        return sn > rn          # erlaubt nur: Setzen vor der Rampe (kleinere Nummer)
    return r0 < s0 < r0 + rd


# §14.4 Spielarten (Parametersatz), Werte wörtlich aus der Tabelle
SPIELARTEN = {
    "sicher": dict(name="sicher", takte=16, verlauf="linear", einstieg_db=-15.0, rampe_takte=8, basstausch_takt=9,
                   a_raus_ab_takt=13, grenze_sub=0.10, grenze_tief=0.20, pump_db=0.0),
    "hart": dict(name="hart", takte=4, verlauf="kante", einstieg_db=0.0, rampe_takte=0, basstausch_takt=3,
                 a_raus_ab_takt=3, grenze_sub=0.25, grenze_tief=0.35, pump_db=0.0),
}


def stuetzwerte(sp):
    """§14.4 Regel: Stützwerte je Regler am Anfang von Takt t = 1..N und Endwert am Anfang von Takt N+1."""
    N, E, R, m, a, P = sp["takte"], sp["einstieg_db"], sp["rampe_takte"], sp["basstausch_takt"], sp["a_raus_ab_takt"], sp["pump_db"]
    w = {"b_fader": [], "b_eq_tief": [], "a_eq_tief": [], "a_eq_mitte": [], "a_fader": []}
    for t in range(1, N + 1):
        u = min(1.0, (t - 1) / max(1, R))
        w["b_fader"].append(E * (1 - u) + P * u)
        w["b_eq_tief"].append(-30.0 if t < m else 0.0)
        w["a_eq_tief"].append(0.0 if t < m else -30.0)
        w["a_eq_mitte"].append(-30.0 * min(1.0, max(0.0, t - 1 - N / 2) / (N / 2)))
        w["a_fader"].append(0.0 if t < a else -40.0 * (t - a + 1) / (N - a + 1))
    ende = {"b_fader": P, "b_eq_tief": 0.0, "a_eq_tief": None, "a_eq_mitte": None, "a_fader": STUMM}
    return w, ende


def _linear_abschnitte(werte, ende, t0_beat, takt_beats=4.0):
    """§14.4 verlauf=linear: je Abschnitt ungleicher Nachbarn eine Rampe über den Takt; gleichmäßige Folgen
    zu einer Rampe zusammengefasst. Liefert [(ab_beat, dauer_beats, nach)], ohne Setzen am Anfang."""
    folge = list(werte) + ([ende] if ende is not None else [werte[-1]])
    stuecke = []
    for i in range(len(folge) - 1):
        if folge[i + 1] != folge[i]:
            stuecke.append([t0_beat + i * takt_beats, takt_beats, folge[i + 1], folge[i + 1] - folge[i]])
    zus = []
    for s in stuecke:
        if zus and abs(zus[-1][0] + zus[-1][1] - s[0]) < 1e-9 and abs(zus[-1][3] - s[3]) < 1e-9 \
                and zus[-1][2] > STUMM_GRENZE and s[2] > STUMM_GRENZE:
            zus[-1][1] += s[1]
            zus[-1][2] = s[2]
        else:
            zus.append(list(s))
    return [(z[0], z[1], z[2]) for z in zus]


def plan_und_wahl(text):
    """Das Beispiel §14.1 (Plan) und die Wahl §14.2, wörtlich aus dem Vertragstext gelesen."""
    plan = json.loads(re.search(r"### 14\.1.*?```json\n(.*?)\n```", text, re.S).group(1))
    wahl = json.loads(re.search(r"`(\{\"id\":\"w9\".*?\})`", text, re.S).group(1))
    return plan, wahl


def expandiere(wahl, deck_a, spielart_name="sicher"):
    """§14.4 Regel für verlauf=linear, Teile-Reihenfolge wie §14.1 (je Beat: Deck-Start, B EQ tief, B Fader,
    A EQ tief, A EQ mitte, A EQ hoch, A Fader, Deck-Stopp, Rücksetzen). Liefert die Teile-Liste."""
    sp = SPIELARTEN[spielart_name]
    if sp["verlauf"] != "linear":
        raise NotImplementedError("nur linear hergeleitet (Golden-Folge expandiere_sicher)")
    S = takt_beat(wahl["start_takt"])
    E = S + sp["takte"] * 4.0
    w, ende = stuetzwerte(sp)
    b, a, hs = wahl["deck"], deck_a, wahl["hoerschein"]

    def R(pfad, ab, dauer, nach, pol, gr, h=""):
        return dict(art="regler", pfad=pfad, ab_beat=ab, dauer_beats=dauer, nach=nach, form=0,
                    politik=pol, gruppe=gr, hoerschein=h)

    roh = [(S, 0, dict(art="deck", deck=b, aktion="start", ab_beat=S, quell_beat=wahl["einstieg_quell_beat"],
                       politik=0, gruppe="b_rein", hoerschein=""))]
    if w["b_eq_tief"][0] != 0.0:
        roh.append((S, 1, R(f"deck/{b}/eq/tief", S - 1, 0, w["b_eq_tief"][0], 0, "b_rein")))  # einen Beat vor S: I1 über die Schaltrampe (§17, Lesart n)
    roh.append((S, 2, R(f"deck/{b}/fader", S, 0, w["b_fader"][0], 0, "b_rein", hs)))
    roh += [(ab, 3, R(f"deck/{b}/fader", ab, d, n, 0, "b_rein", hs))
            for ab, d, n in _linear_abschnitte(w["b_fader"], ende["b_fader"], S)]
    roh += [(ab, 4, R(f"deck/{b}/eq/tief", ab, d, n, 0, "basstausch"))
            for ab, d, n in _linear_abschnitte(w["b_eq_tief"], ende["b_eq_tief"], S)]
    roh += [(ab, 5, R(f"deck/{a}/eq/tief", ab, d, n, 0, "basstausch"))
            for ab, d, n in _linear_abschnitte(w["a_eq_tief"], ende["a_eq_tief"], S)]
    for ab, d, n in _linear_abschnitte(w["a_eq_mitte"], ende["a_eq_mitte"], S):
        roh.append((ab, 6, R(f"deck/{a}/eq/mitte", ab, d, n, 1, "a_raus")))
        roh.append((ab, 7, R(f"deck/{a}/eq/hoch", ab, d, n, 1, "a_raus")))
    roh += [(ab, 8, R(f"deck/{a}/fader", ab, d, n, 1, "a_raus"))
            for ab, d, n in _linear_abschnitte(w["a_fader"], ende["a_fader"], S)]
    roh.append((E, 9, dict(art="deck", deck=a, aktion="stopp", ab_beat=E, politik=1, gruppe="a_raus", hoerschein="")))
    for rang, pfad in ((10, "eq/tief"), (11, "eq/mitte"), (12, "eq/hoch")):
        roh.append((E, rang, R(f"deck/{a}/{pfad}", E, 0, 0.0, 1, "a_raus")))
    roh.sort(key=lambda r: (r[0], r[1]))
    return [dict(nr=nr, **t) for nr, (_, _, t) in enumerate(roh)]
