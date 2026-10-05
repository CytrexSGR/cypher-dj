#!/usr/bin/env python3
"""Mutationsmatrix für das Stellwerk (Scheibe 11, Vorbild 09 NP b2 und proben/09-ki-steuerung/fassung2/mutationen.py).

Je Regel genau ein Eingriff in die Quellen (Textersatz, der genau einmal passen muss), der diese Regel abschaltet; dann
Bau und alle Prüfungen: Unit-Tests, die fünf Golden-Folgen des Vertrags, die Folgenleser-Proben. Erwartung: je
Mutation mindestens ein Fall rot. Das Original muss vorher ganz grün sein, sonst hat die Matrix keine Aussage.
Eine Arbeitskopie, ein Bauordner: je Mutation wird nur die geänderte Datei neu übersetzt und danach zurückgesetzt.
Aufruf (aus djk/kern/stellwerk/): python3 mutation/mutationen.py [<ordner der golden-folgen>]
  -> mutation/matrix.json, mutation/matrix.md. Bau mit nice -n 19 und ninja -j4 (ROADMAP §8.5). Kein Ton, keine Ports."""
import json
import pathlib
import shutil
import subprocess
import sys

HIER = pathlib.Path(__file__).resolve().parent.parent          # djk/kern/stellwerk
ARBEIT = HIER / "build-mut" / "arbeit"
BAU = HIER / "build-mut" / "bau"
FOLGEN = ["teil_rampe", "hand_gewinnt", "zu_spaet", "i4_ueberlappung", "ki_stopp"]
VERTRAG_TEXT = (HIER / ".." / ".." / ".." / "docs" / "architektur" / "SCHNITTSTELLEN.md").resolve()

# Name: (Regel, [(Datei, alt, neu), ...])
MUT = {
    "M01_ereignis_am_blockanfang": ("Start und Griff am Sample, nicht an der Blockgrenze (§1.1, §7.3 P1)", [
        ("src/ablauf.cpp", "if (t.start_sample < s_ende) starts_[n_starts_++]", "if (t.start_sample <= s0) starts_[n_starts_++]"),
        ("src/ablauf.cpp", "while (n_hand_zyklus < n_hand_ && hand_[n_hand_zyklus].sample < s_ende)",
         "while (n_hand_zyklus < n_hand_ && hand_[n_hand_zyklus].sample <= s0)")]),
    "M02_hand_bricht_ganzen_plan": ("Hand bricht nur Regler und Gruppe (ADR 023 P2)", [
        ("src/hand.cpp", "if (t.belegt && t.regler == r) beenden_mit_gruppe(j, Status::abgebrochen, Grund::hand, sample, HalterArt::mensch);",
         "if (t.belegt && t.regler == r) { const char* p = t.plan; for (int m = 0; m < MAX_TEILE; m++) "
         "if (teil_[m].belegt && std::strcmp(teil_[m].plan, p) == 0) beenden_mit_gruppe(m, Status::abgebrochen, Grund::hand, sample, HalterArt::mensch); }")]),
    "M03_ohne_gruppe": ("Gruppe fällt gemeinsam (§4.3 Feld 11)", [
        ("src/kern.cpp", "  if (gruppe[0]) {\n", "  if (false) {\n")]),
    "M04_ohne_schiedsrichter": ("Hand übernimmt, Plan hört auf (§7.3 P3)", [
        ("src/hand.cpp", "const bool plan_haelt = offen && z.halter.art != HalterArt::mensch;", "const bool plan_haelt = false; (void)offen;")]),
    "M05_erster_wert_wirkt": ("erster Wert nur Stellung (§7.3 P2)", [
        ("src/hand.cpp", "      z.phys = p;\n      z.anker = p;\n      z.phys_bekannt = true;\n      return;\n",
         "      z.phys = ReglerTabelle::zu_x(k, z.wert);\n      z.anker = z.phys;\n      z.phys_bekannt = true;\n")]),
    "M06_ohne_totzone": ("Totzone 3/128 (§7.3 P3)", [
        ("src/hand.cpp", "if (std::fabs(p - z.anker) <= TOTZONE + 1e-9) {", "if (false) {"),
        ("src/hand.cpp", "if (std::fabs(z.rel_summe) <= TOTZONE + 1e-9) return;", "")]),
    "M07_sprung_statt_skaliert": ("Übernahme skaliert ohne Sprung (§7.3 P3)", [
        ("src/hand.cpp", "    if (std::fabs(u - basis) < 1.0 / 256) u = p;\n    else if (p > basis) u = u + (p - basis) * (1.0 - u) / (1.0 - basis);\n"
         "    else if (p < basis) u = u - (basis - p) * u / basis;\n", "    u = p;\n")]),
    "M08_relativ_als_absolut": ("Encoder relativ (§7.3 P3)", [
        ("src/hand.cpp", "const double u = ReglerTabelle::zu_x(k, z.wert) + g.x;", "const double u = g.x;")]),
    "M09_ohne_rueckgabe": ("Rückgabe nach 32 Beats (§7.3 P4, P5)", [
        ("src/ablauf.cpp", "if (rs < s_ende) rueck[n_rueck++]", "if (false) rueck[n_rueck++]")]),
    "M10_startwert_nicht_ist_wert": ("Rampe startet am Ist-Wert (§4.3)", [
        ("src/ablauf.cpp", "  float w0 = z.wert;\n  if (z.laufend >= 0) {", "  float w0 = tab_.def(t.regler).vorgabe;\n  if (z.laufend >= 0) {")]),
    "M11_setzen_ziel_nicht_uebergeben": ("Rampe beginnt beim Zielwert eines Setzens am selben Sample (§4.3)", [
        ("src/ablauf.cpp", "if (v.setzen_modus && v.sA == sample) w0 = v.nach;", "if (false) w0 = v.nach;"),
        ("src/sicht.cpp", "if (fahrer->setzen_modus && fahrer->sA == t.start_sample) w0 = fahrer->nach;", "if (false) w0 = fahrer->nach;")]),
    "M12_ohne_stumm_regel": ("Rampen von/nach stumm über -60 dB (§1.2)", [
        ("src/kern.cpp", "  if (d.db && w0 <= STUMM_GRENZE && t.nach > STUMM_GRENZE) w0 = std::min(STUMM_RAMPE, t.nach);\n"
         "  t.ziel_intern = (d.db && t.nach <= STUMM_GRENZE) ? std::min(STUMM_RAMPE, w0) : t.nach;\n", "  t.ziel_intern = t.nach;\n")]),
    "M13_i4_nur_fremde_plaene": ("I4 auch im selben Plan (§17)", [
        ("src/einsortieren.cpp", "if (!x.belegt || x.regler != r) continue;",
         "if (!x.belegt || x.regler != r || (plan[0] && std::strcmp(x.plan, plan) == 0)) continue;")]),
    "M14_zu_spaet_trotzdem": ("Politik 0 zu spät verworfen (§16.1)", [
        ("src/einsortieren.cpp", "if (b.politik == 0) {   // §16.1: musik -> verworfen", "if (false) {")]),
    "M15_startsample_bei_annahme": ("Startsample je Zyklus nach der Tempo-Karte (§4.3, Beat-Zeit)", [
        ("src/ablauf.cpp", "t.start_sample = t.verspaetet ? s0 : std::max(s0, sample_von(uhr_, t.ab_beat));",
         "if (t.verspaetet) t.start_sample = s0;")]),
    "M16_ki_stopp_ohne_abbruch": ("KI-Stopp bricht cypher-Teile ab (§4.7)", [
        ("src/ki.cpp", "if (t.belegt && t.quelle == Quelle::cypher) beenden_mit_gruppe", "if (false) beenden_mit_gruppe")]),
    "M17_ki_ohne_sperre": ("nach dem Stopp cypher abgelehnt (§4.7)", [
        ("src/einsortieren.cpp", "if (b.quelle == Quelle::cypher && ki_gestoppt_) return ablehnen(Grund::ki_gestoppt);", "")]),
    "M18_ohne_halterpruefung_am_start": ("Start prüft Halter mensch (§4.3)", [
        ("src/ablauf.cpp", "if (mensch_bei(t.regler, t.start_sample, n_hand_zyklus)) g = Grund::regler_beim_menschen;",
         "if (false) g = Grund::regler_beim_menschen;")]),
    "M19_ohne_nur_hand": ("Wer darf: nur Hand (§1.5)", [
        ("src/einsortieren.cpp", "if (d.nur_hand && b.quelle != Quelle::andreas) return ablehnen(Grund::nur_hand);", "")]),
    "M20_s_kurve_linear": ("Form 1 S-Kurve (§4.3 Feld 9)", [
        ("src/formel.h", "const double g = s_kurve ? u * u * (3.0 - 2.0 * u) : u;", "const double g = u; (void)s_kurve;")]),
    "M21_beruehrung_ohne_uebernahme": ("Berührung übernimmt sofort (§7.3 P3)", [
        ("src/hand.cpp", "    if (plan_haelt) uebernehmen(r, sample);\n    else if (z.halter.art != HalterArt::mensch) {",
         "    if (false) uebernehmen(r, sample);\n    else if (z.halter.art != HalterArt::mensch) {")]),
    "M22_pruefer_vor_teilstart_nie": ("Naht: vor_teilstart wird gefragt (§17)", [
        ("src/sicht.cpp", "return pruefer_->vor_teilstart(s, s.sicht_von(idx));", "(void)s; return Grund::kein;")]),
    "M23_pruefer_je_zyklus_nie": ("Naht: je_zyklus wird gerufen (§17)", [
        ("src/sicht.cpp", "pruefer_->je_zyklus(s, s);", "(void)s;")]),
    "M24_pruefer_nach_handgriff_nie": ("Naht: nach_handgriff wird gerufen (§17)", [
        ("src/sicht.cpp", "pruefer_->nach_handgriff(s, s, r, sample);", "(void)s;")]),
    "M25_vorschau_ohne_starts": ("Naht: Vorschau kennt die Starts des Zyklus", [
        ("src/sicht.cpp", "      if (t.start_sample > s) break;\n", "      break;\n")]),
    "M26_regler_ohne_drossel": ("/e/regler höchstens 50 Hz (§5.7)", [
        ("src/melder.cpp", "} else if (s_letzt - z.gemeldet_sample >= REGLER_MELDUNG_ABSTAND) {", "} else if (true) {")]),
    "M27_hand_ohne_nachzuegler": ("/e/hand letztes Ereignis der Geste (§5.8)", [
        ("src/melder.cpp", "    if (s_letzt - z.hand_gemeldet_sample >= HAND_MELDUNG_ABSTAND) {", "    if (false) {")]),
    "M28_allokation_im_prozess": ("keine Allokation im Prozessaufruf (ADR 002)", [
        ("src/ablauf.cpp", "  if (n <= 0) return;\n", "  if (n <= 0) return;\n  { int* volatile x = new int(1); delete x; }\n")]),
    "M29_i4_zwei_setzen_erlaubt": ("I4: zwei Setzen am selben Beat überlappen (09 herleitung.py)", [
        ("src/einsortieren.cpp", "  if (xd == 0 && ad == 0) return x0 == a0;\n", "  if (xd == 0 && ad == 0) return false;\n")]),
    "M30_i4_setzen_nach_rampe_erlaubt": ("I4: Setzen nach der Rampe am selben Beat überlappt (§17 Reihenfolge)", [
        ("src/einsortieren.cpp", "    if (a0 == x0) return a_nr > x_nr;\n", "    if (a0 == x0) return false;\n")]),
    "M31_halter_am_zyklusanfang": ("Halter am Start-Sample, nicht am Zyklusanfang (Rückgabe im selben Zyklus)", [
        ("src/hand.cpp", "  if (sample_von(uhr_, z.hand_beat + RUECKGABE_BEATS) <= s) return false;\n", "")]),
    "M32_ohne_vormerkung": ("Prüfer sieht alle Teile eines Samples (§17 Reihenfolge)", [
        ("src/ablauf.cpp", "  for (int k = 0; k < n_starts_; k++) teil_[starts_[k]].im_zyklus = true;\n",
         "  for (int k = 0; k < n_starts_; k++) teil_[starts_[k]].im_zyklus = false;\n"),
        ("src/ablauf.cpp", "    if (g != Grund::kein) {\n      t.im_zyklus = false;",
         "    if (g == Grund::kein) t.im_zyklus = true;\n    if (g != Grund::kein) {\n      t.im_zyklus = false;")]),
    "M33_verspaetet_mit_grund": ("Quittung 5 mit Grund \"\" (§16.1, Lesart i, Andreas 2026-09-25)", [
        ("src/ablauf.cpp", "quittung(t, Status::verspaetet_ausgefuehrt, sample, Grund::kein);",
         "quittung(t, Status::verspaetet_ausgefuehrt, sample, Grund::zu_spaet);")]),
    "M34_gruppe_gefallen_nie": ("Naht: gruppe_gefallen wird gerufen (§4.4 Deck-Teile fallen mit)", [
        ("src/sicht.cpp", "pruefer_->gruppe_gefallen(s, plan, gruppe, g, sample);", "(void)s;")]),
    "M35_gruppe_abbrechen_wirkungslos": ("Naht: Eingriff::gruppe_abbrechen bricht die Gruppe ab", [
        ("src/sicht.cpp", "        abbrechen(j, g);   // beendet die ganze Gruppe und meldet gruppe_gefallen\n", "        (void)j;\n")]),
    "M36_deck_taste_ohne_halter": ("Deck-Halter nach der Transport-Taste (§7.3 P5)", [
        ("src/hand.cpp", "  if (d.transport) {   // §7.3 Punkt 5: Deck-Halter, kein Wert\n    Halter h;\n    h.art = HalterArt::mensch;\n",
         "  if (d.transport) {   // §7.3 Punkt 5: Deck-Halter, kein Wert\n    Halter h;\n    h.art = HalterArt::frei;\n")]),
    "M37_transport_als_regler_gemeldet": ("transport ist kein Regler: nur /e/halter (§5.9)", [
        ("src/kern.cpp", "if (!tab_.def(r).transport) melde_regler(r, sample);", "melde_regler(r, sample);")]),
    "M38_vorgaenger_wert_vor_dem_start": ("angrenzende Rampe beginnt beim Ist-Wert am Ziel-Sample (§4.3)", [
        ("src/ablauf.cpp", "    else if (!v.angehalten) w0 = wert_von(v, sample, beat, nullptr);   // Ist-Wert am Ziel-Sample\n", "")]),
    "M39_ki_blende_dem_pruefer_vorgelegt": ("KI-Stopp-Blende wird nie blockiert (ADR 013, pruefer.h intern)", [
        ("src/ablauf.cpp", "    else if (!t.intern) g = pruefe_vor_start(idx);", "    else g = pruefe_vor_start(idx);")]),
    "M40_abbruch_ohne_plan_fremde_quelle": ("/k/abbruch ohne Plan nur eigene Quelle (Festlegung F5)", [
        ("src/einsortieren.cpp", "    if (!p[0] && t.quelle != quelle) continue;\n", "")]),
    "M41_folgenleser_ignoriert_erwarte_nicht": ("Werkzeug: erwarte_nicht ist eine Negativ-Kontrolle (FORMAT.md Punkt 16)", [
        ("werkzeug/folgenleser.cpp", "          if (!passt(m, e)) continue;\n          fehl++;\n",
         "          if (!passt(m, e)) continue;\n          break;\n")]),
    "M42_folgenleser_gruen_ohne_pruefung": ("Werkzeug: keine Prüfung ist kein Beleg", [
        ("werkzeug/folgenleser.cpp", "    const bool rot = fehl > 0 || gesamt == 0;", "    const bool rot = fehl > 0;")]),
    "M43_folgenleser_ohne_punkt_8": ("Werkzeug: unverbrauchte /q 4 bis 8 macht rot (FORMAT.md Punkt 8)", [
        ("werkzeug/folgenleser.cpp", "    fehl += unerwartet;\n", "    unerwartet = 0;\n")]),
    "M44_folgenleser_ohne_verbrauch": ("Werkzeug: eine Nachricht erfüllt höchstens einen Schritt (FORMAT.md Punkt 6)", [
        ("werkzeug/folgenleser.cpp", "      if (erwarte_[k].art == Art::erwarte) ordne(static_cast<int>(k), static_cast<int>(k));",
         "      if (erwarte_[k].art == Art::erwarte) erfuellt[k] = !kandidaten[k].empty();")]),
    "M45_uebergabe_ueber_frei": ("Übergabe am selben Sample ohne Halter frei dazwischen (§5.7, §5.9)", [
        ("src/ablauf.cpp", "    quittung(v, Status::fertig, sample, Grund::kein);\n    laufend_raus(vi);\n    v.belegt = false;\n",
         "    beenden(vi, Status::fertig, Grund::kein, sample, HalterArt::frei);\n")]),
    "M47_start_vor_hand": ("Hand gewinnt am selben Sample: vor den Starts angewandt (ADR 023 P2)", [
        ("src/ablauf.cpp", "      while (kh < n_hand_zyklus && hand_[kh].sample <= s) {\n        hand_anwenden(hand_[kh], s, i, b);\n"
         "        kh++;\n      }\n      // b) Starts an diesem Sample, in Startfolge\n", "      // b) Starts an diesem Sample, in Startfolge\n"),
        ("src/ablauf.cpp", "        if (t.belegt && t.status == Status::angenommen && t.im_zyklus) starte(idx, s, i, b);\n      }\n",
         "        if (t.belegt && t.status == Status::angenommen && t.im_zyklus) starte(idx, s, i, b);\n      }\n"
         "      while (kh < n_hand_zyklus && hand_[kh].sample <= s) {\n        hand_anwenden(hand_[kh], s, i, b);\n        kh++;\n      }\n")]),
    "M48_stumm_umweg_ueber_minus_60": ("Rampe von oder nach stumm nie lauter als beide Enden (F3)", [
        ("src/kern.cpp", "  if (d.db && w0 <= STUMM_GRENZE && t.nach > STUMM_GRENZE) w0 = std::min(STUMM_RAMPE, t.nach);\n"
         "  t.ziel_intern = (d.db && t.nach <= STUMM_GRENZE) ? std::min(STUMM_RAMPE, w0) : t.nach;\n",
         "  t.ziel_intern = (d.db && t.nach <= STUMM_GRENZE) ? STUMM_RAMPE : t.nach;\n"
         "  if (d.db && w0 <= STUMM_GRENZE && t.nach > STUMM_GRENZE) w0 = STUMM_RAMPE;\n")]),
    "M49_schaltrampe_linear": ("Schaltrampe als S-Kurve wie Scheibe 04 (F2)", [
        ("src/ablauf.cpp", "  const bool s_kurve = t.setzen_modus || t.form == 1;", "  const bool s_kurve = !t.setzen_modus && t.form == 1;"),
        ("src/kern.cpp", "formel::wert(u, f, t.setzen_modus || t.form == 1,", "formel::wert(u, f, !t.setzen_modus && t.form == 1,")]),
    "M50_regler_vorgabe_falsch": ("Regler-Tabelle gleich §1.5 (Vorgabe fx/<n>/rueckweg 0 dB)", [
        ("src/regler.cpp", "neu(p, -1, Rolle::fx_rueckweg, -200, 0, 0, MS(10)", "neu(p, -1, Rolle::fx_rueckweg, -200, 0, -200, MS(10)")]),
    "M46_startwert_nicht_gemeldet": ("/e/regler beim Teilstart mit dem Wert am Start-Sample (§5.7, §1.2)", [
        ("src/ablauf.cpp", "  setze_wert(t.regler, i, wert_von(t, sample, beat, nullptr));", "  (void)0;")]),
}


def sh(args, **kw):
    return subprocess.run(args, capture_output=True, text=True, **kw)


def pruefe_alles(folgen_dir: pathlib.Path) -> dict:
    r = sh(["nice", "-n", "19", "ninja", "-C", str(BAU), "-j4"])
    if r.returncode:
        return {"bau": "ninja", "fehler": (r.stdout + r.stderr)[-600:]}
    rot, gruen = [], 0
    for exe in sorted(BAU.glob("stellwerk_test_*")):
        if not exe.is_file() or exe.name.endswith("_leer"):
            continue
        p = sh([str(exe)], timeout=900)
        for zeile in p.stdout.splitlines():
            if zeile.startswith("ROT "):
                rot.append(f"{exe.name[len('stellwerk_'):]}:{zeile.split()[1]}")
            elif zeile.startswith("OK  "):
                gruen += 1
        if p.returncode not in (0, 1):
            rot.append(f"{exe.name[len('stellwerk_'):]}:ABSTURZ({p.returncode})")
    p = sh(["python3", str(ARBEIT / "tests" / "regler_gegen_vertrag.py"), str(BAU / "stellwerk_regler_liste"), str(VERTRAG_TEXT)])
    if p.returncode == 0:
        gruen += 1
    else:
        rot.append("regler_gegen_vertrag")
    folgen = [str(folgen_dir / f"{n}.jsonl") for n in FOLGEN]
    p = sh([str(BAU / "stellwerk_folgen"), "--leise"] + folgen)
    for zeile in p.stdout.splitlines():
        if zeile.startswith("ROT ") or zeile.startswith("FORM"):
            rot.append("folge:" + pathlib.Path(zeile.split()[1].rstrip(":")).name)
        elif zeile.startswith("OK  "):
            gruen += 1
    for f in sorted((ARBEIT / "tests" / "folgen_form").glob("*.jsonl")):
        soll = 0 if f.name.startswith("gruen_") else 1 if f.name.startswith("rot_") else 2
        p = sh([str(BAU / "stellwerk_folgen"), "--leise", str(f)])
        if p.returncode == soll:
            gruen += 1
        else:
            rot.append(f"folgenleser:{f.stem}({p.returncode}!={soll})")
    return {"bau": "ok", "rot": rot, "gruen": gruen}


def main() -> int:
    folgen_dir = pathlib.Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else (HIER / ".." / ".." / "vertrag" / "folgen").resolve()
    for n in FOLGEN:
        if not (folgen_dir / f"{n}.jsonl").exists():
            print(f"Golden-Folge fehlt: {folgen_dir}/{n}.jsonl", file=sys.stderr)
            return 2
    if ARBEIT.exists():
        shutil.rmtree(ARBEIT)
    shutil.copytree(HIER, ARBEIT, ignore=shutil.ignore_patterns("build", "build-*", "__pycache__", "berichte"))
    r = sh(["cmake", "-S", str(ARBEIT), "-B", str(BAU), "-G", "Ninja", "-DCMAKE_BUILD_TYPE=RelWithDebInfo",
            f"-DVERTRAG_FOLGEN={folgen_dir}", f"-DVERTRAG_TEXT={VERTRAG_TEXT}"])
    if r.returncode:
        print(r.stderr[-800:], file=sys.stderr)
        return 2
    erg = {"_original": pruefe_alles(folgen_dir)}
    print("original:", erg["_original"].get("bau"), "gruen:", erg["_original"].get("gruen"), "rot:", erg["_original"].get("rot"), flush=True)
    if erg["_original"].get("bau") != "ok" or erg["_original"].get("rot"):
        print("Original nicht grün: Matrix wäre ohne Aussage", file=sys.stderr)
        return 2
    for name, (regel, ersetzungen) in MUT.items():
        alt_inhalt = {}
        for datei, alt, neu in ersetzungen:
            pfad = ARBEIT / datei
            if datei not in alt_inhalt:
                alt_inhalt[datei] = pfad.read_text()
            text = pfad.read_text()
            n = text.count(alt)
            if n != 1:
                print(f"{name}: Ersetzung passt {n}-mal in {datei}", file=sys.stderr)
                for d, t in alt_inhalt.items():
                    (ARBEIT / d).write_text(t)
                return 2
            pfad.write_text(text.replace(alt, neu))
        e = pruefe_alles(folgen_dir)
        for d, t in alt_inhalt.items():
            (ARBEIT / d).write_text(t)
        e["regel"] = regel
        erg[name] = e
        print(f"{name}: {e.get('bau')} rot={len(e.get('rot', []))} {e.get('rot', [])[:4]}", flush=True)
    rueck = pruefe_alles(folgen_dir)   # nach dem Zurücksetzen wieder grün: kein Rest einer Mutation
    erg["_zurueck"] = rueck
    (HIER / "mutation" / "matrix.json").write_text(json.dumps(erg, indent=1, ensure_ascii=False))
    zeilen = ["| Mutation | abgeschaltete Regel | rote Fälle | Beispiele |", "|---|---|---|---|"]
    ohne, baufehler = [], []
    for name, e in erg.items():
        if name.startswith("_"):
            continue
        rot = e.get("rot", [])
        if e.get("bau") != "ok":   # eine Mutation, die nicht baut, sagt nichts über die Tests
            baufehler.append(name)
            rot = [f"BAU {e.get('bau')}"]
        elif not rot:
            ohne.append(name)
        zeilen.append(f"| {name} | {e['regel']} | {len(rot)} | {', '.join(rot[:3])} |")
    zeilen.append(f"\nOriginal: {erg['_original']['gruen']} grün, 0 rot. Nach dem Zurücksetzen: {rueck.get('gruen')} grün, "
                  f"rot {rueck.get('rot')}. Mutationen ohne roten Fall: {ohne or 'keine'}. Baufehler: {baufehler or 'keine'}.")
    (HIER / "mutation" / "matrix.md").write_text("\n".join(zeilen) + "\n")
    print("\n".join(zeilen))
    return 1 if ohne or baufehler or rueck.get("rot") else 0


if __name__ == "__main__":
    sys.exit(main())
