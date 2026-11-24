#!/usr/bin/env python3
"""Verdict logic of the soak run (R3). Pure functions; the only I/O is the CLI wrapper.

Input: minute rows (one JSON object per line in minuten.jsonl), schema (all keys required):
  t_min, phase ("leerlauf"|"last"), rss_kib {unit: int}, fds {unit: int}, luecken_frames_delta, luecke_ereignisse,
  luecke_frames, cb_max_us, cb_p99_us_max, neustarts {unit: int}, generation, treiber_fehler, treiber_aufrufe,
  zustand_n (core state messages in the minute), treiber_endpunkte {name: [calls, errors]},
  treiber_lebt (driver thread alive at the end of the minute), pegel_master_db (maximum master level seen in the minute).
treiber_* counts are per minute (not cumulative).

Verdict kinds: FAIL wins over everything (a restart, growth, gap, dead or failing driver, silent master is a FAIL even in
an aborted or otherwise unusable run). Without a FAIL, anything that cannot be judged is "unbrauchbar" (aborted run,
missing window, unit missing in a row, minute hole, ...), never a pass. PASS needs the whole planned run.

Readings (strict on purpose):
- reference memory = median of a unit's rss_kib over load minutes [bezug[0], bezug[1]) counted from the first load row;
  end memory = median over the last `ende_min` load minutes; growth must be strictly under 5 % per unit. A unit that
  first appears after t0 is measured from its first row: its own reference window starts at its first load row. The
  sum over all units is reported, not judged. In a dry run memory is reported and NOT judged.
- gaps: baseline per hour = idle sums scaled by 60 / idle minutes. The load phase is cut into 60 minute blocks; a
  remainder shorter than 60 minutes is merged into the last block (a load phase shorter than 60 minutes is one block);
  every block is scaled to an hour. A block passes when events, the core's frame counter delta and the frames summed
  from /e/luecke are each not above the baseline's.
- restarts: every unit's counter equals its first row's in every row, and the generation never changes. A unit that
  disappears from the rows after it was there is a FAIL; a unit appearing later is reported (`neue_einheiten`).
- driver: from the second load minute on (the first is the setup), every minute holds at least ERWARTET calls per
  endpoint (knob, deck launch, strudel post), each endpoint's error rate is at most 5 %, the driver thread is alive in
  every load minute. The master level must be at least PEGEL_BODEN dB in every such minute (the load really sounds).
  No driver calls at all is unusable.
"""
import argparse
import json
import sys
from statistics import median

SCHLUESSEL = ("t_min", "phase", "rss_kib", "fds", "luecken_frames_delta", "luecke_ereignisse", "luecke_frames",
              "cb_max_us", "cb_p99_us_max", "neustarts", "generation", "treiber_fehler", "treiber_aufrufe",
              "zustand_n", "treiber_endpunkte", "treiber_lebt", "pegel_master_db")
ZAHLEN = ("t_min", "luecken_frames_delta", "luecke_ereignisse", "luecke_frames", "cb_max_us", "cb_p99_us_max",
          "generation", "treiber_fehler", "treiber_aufrufe", "zustand_n")
GRENZE_PROZENT = 5.0
GRENZE_FEHLER = 0.05
# per endpoint: minimum calls per minute (knob 1 per second; a deck launch every 16 bars, valid for tempo >= 70 bpm;
# one strudel post every 16/3 bars)
ERWARTET = {"regler": 45, "deck_start": 1, "strudel": 1}
PEGEL_BODEN = -50.0


class Unbrauchbar(Exception):
    pass


def _ganz(v):
    return isinstance(v, int) and not isinstance(v, bool)


def _zahl(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v == v


def _pruefe(zeilen):
    if not zeilen:
        raise Unbrauchbar("no rows")
    for i, z in enumerate(zeilen):
        if not isinstance(z, dict):
            raise Unbrauchbar(f"row {i} is not an object")
        fehlt = [k for k in SCHLUESSEL if k not in z]
        if fehlt:
            raise Unbrauchbar(f"row {i} lacks {fehlt}")
        if z["phase"] not in ("leerlauf", "last"):
            raise Unbrauchbar(f"row {i} has phase {z['phase']!r}")
        for k in ZAHLEN:
            if not _ganz(z[k]):
                raise Unbrauchbar(f"row {i}: {k} is not an integer")
        for k in ("rss_kib", "fds", "neustarts"):
            if not isinstance(z[k], dict) or not all(_ganz(v) for v in z[k].values()):
                raise Unbrauchbar(f"row {i}: {k} is not a map of integers")
        if not (set(z["rss_kib"]) == set(z["fds"]) == set(z["neustarts"])):
            raise Unbrauchbar(f"row {i}: the unit sets of rss_kib, fds and neustarts differ")
        if not isinstance(z["treiber_lebt"], bool):
            raise Unbrauchbar(f"row {i}: treiber_lebt is not a boolean")
        if not _zahl(z["pegel_master_db"]):
            raise Unbrauchbar(f"row {i}: pegel_master_db is not a number")
        e = z["treiber_endpunkte"]
        if not isinstance(e, dict) or not all(isinstance(v, list) and len(v) == 2 and all(_ganz(x) for x in v)
                                              for v in e.values()):
            raise Unbrauchbar(f"row {i}: treiber_endpunkte is not a map of [calls, errors]")
        if z["zustand_n"] < 1:
            # a minute without any /zustand/kern means the collector was deaf or the core silent: zero gaps in
            # that minute would be no reading
            raise Unbrauchbar(f"row {i}: no /zustand/kern message in that minute")
        if i and z["t_min"] != zeilen[i - 1]["t_min"] + 1:
            raise Unbrauchbar(f"minute hole or disorder between rows {i - 1} and {i}")
    phasen = [z["phase"] for z in zeilen]
    n_leer = phasen.count("leerlauf")
    if n_leer == 0 or n_leer == len(phasen):
        raise Unbrauchbar("idle or load phase has no rows")
    if phasen != ["leerlauf"] * n_leer + ["last"] * (len(phasen) - n_leer):
        raise Unbrauchbar("phases are not idle first, then load")


def _einheiten(zeilen):
    """unit -> index of its first row. A unit that vanishes after it was there is reported as a FAIL reason."""
    erste, weg = {}, []
    for i, z in enumerate(zeilen):
        for u in z["rss_kib"]:
            erste.setdefault(u, i)
    letzte = set(zeilen[-1]["rss_kib"])
    for u, i0 in erste.items():
        luecken = [j for j in range(i0, len(zeilen)) if u not in zeilen[j]["rss_kib"]]
        if luecken or u not in letzte:
            weg.append((u, zeilen[luecken[0]]["t_min"] if luecken else zeilen[-1]["t_min"]))
    return erste, weg


def _neustarts_roh(zeilen):
    """Restart reading on raw rows, tolerant of other defects, so that a FAIL is never hidden by an unusable run."""
    gruende, einheiten = [], set()
    erste, gen0 = {}, None
    for z in zeilen:
        if not isinstance(z, dict):
            continue
        n = z.get("neustarts")
        if isinstance(n, dict):
            for u, v in n.items():
                if u not in erste:
                    erste[u] = v
                elif v != erste[u]:
                    einheiten.add(u)
        g = z.get("generation")
        if _ganz(g):
            if gen0 is None:
                gen0 = g
            elif g != gen0:
                gruende.append("generation changed")
                gen0 = g
                break
    if einheiten:
        gruende.append("restart of " + ", ".join(sorted(einheiten)))
    return gruende, sorted(einheiten), "generation changed" not in gruende


def _speicher(zeilen, last, einheiten, bezug, ende_min, probelauf):
    a, b = bezug
    if not 0 <= a < b:
        raise Unbrauchbar(f"bad reference window {bezug}")
    if ende_min < 1:
        raise Unbrauchbar("bad end window")
    erste_last = len(zeilen) - len(last)
    speicher, sb, se = {}, 0, 0
    for u, i0 in sorted(einheiten.items()):
        von = max(i0, erste_last)                 # first load row of this unit
        verschoben = von - erste_last             # > 0: the unit appeared after the load began
        reihe = [z["rss_kib"][u] for z in zeilen[von:] if u in z["rss_kib"]]   # a vanished unit is a FAIL elsewhere
        if verschoben == 0:
            ref_zeilen = reihe[a:b] if len(reihe) >= b else []
        else:
            ref_zeilen = reihe[:b - a] if len(reihe) >= (b - a) + ende_min else []
        ende = reihe[-ende_min:] if len(reihe) >= ende_min else []
        if len(ref_zeilen) != b - a or not ende:
            if probelauf:
                continue
            raise Unbrauchbar(f"unit {u}: reference or end window has no rows (load phase has {len(reihe)} rows of it)")
        ref, end = median(ref_zeilen), median(ende)
        if ref <= 0 or end <= 0:
            if probelauf:
                continue
            raise Unbrauchbar(f"unit {u}: resident memory {ref}/{end} is not a reading")
        speicher[u] = {"bezug_kib": ref, "ende_kib": end, "wachstum_prozent": round((end - ref) / ref * 100.0, 3),
                       "ok": None if probelauf else (end - ref) * 100 < GRENZE_PROZENT * ref,
                       "spaeter_gestartet": verschoben > 0}
        sb += ref
        se += end
    summe = {"bezug_kib": sb, "ende_kib": se, "wachstum_prozent": round((se - sb) / sb * 100.0, 3)} if sb else None
    return speicher, summe


def _luecken(leer, last, leerlauf_min):
    if len(leer) < leerlauf_min:
        raise Unbrauchbar(f"idle phase has {len(leer)} rows, {leerlauf_min} expected")
    felder = ("luecke_ereignisse", "luecken_frames_delta", "luecke_frames")
    basis = {k: sum(z[k] for z in leer) for k in felder}
    nl = len(leer)
    if len(last) < 60:
        bloecke = [last]
    else:
        n = len(last) // 60
        bloecke = [last[i * 60:(i + 1) * 60] for i in range(n)]
        bloecke[-1] = last[(n - 1) * 60:]
    pro_stunde = []
    ok = True
    for b in bloecke:
        s = {k: sum(z[k] for z in b) for k in felder}
        # s/len(b) <= basis/nl, kept exact with integers
        ok = ok and all(s[k] * nl <= basis[k] * len(b) for k in felder)
        pro_stunde.append({"ereignisse": round(s[felder[0]] * 60 / len(b), 3),
                           "frames": round(s[felder[1]] * 60 / len(b), 3),
                           "ereignis_frames": round(s[felder[2]] * 60 / len(b), 3),
                           "minuten": len(b)})
    return {"grundlinie_pro_stunde": {"ereignisse": round(basis[felder[0]] * 60 / nl, 3),
                                      "frames": round(basis[felder[1]] * 60 / nl, 3),
                                      "ereignis_frames": round(basis[felder[2]] * 60 / nl, 3)},
            "last_pro_stunde": pro_stunde, "ok": ok}


def _treiber(last):
    """Returns (section, fail reasons)."""
    aufrufe = sum(z["treiber_aufrufe"] for z in last)
    fehler = sum(z["treiber_fehler"] for z in last)
    if aufrufe == 0:
        raise Unbrauchbar("load driver made no calls")
    gruende = []
    tot = [z["t_min"] for z in last if not z["treiber_lebt"]]
    if tot:
        gruende.append(f"driver thread dead in load minute(s) {tot[:5]}")
    pruef = last[1:]                               # the first load minute is the setup
    endpunkte = {}
    for name, minimum in ERWARTET.items():
        calls = [z["treiber_endpunkte"].get(name, [0, 0])[0] for z in pruef]
        fehl = [z["treiber_endpunkte"].get(name, [0, 0])[1] for z in pruef]
        n, f = sum(calls), sum(fehl)
        zu_wenig = [z["t_min"] for z, c in zip(pruef, calls) if c < minimum]
        rate = f / n if n else 1.0
        endpunkte[name] = {"aufrufe": n, "fehler": f, "fehlerquote": round(rate, 5), "minimum_je_minute": minimum,
                           "minuten_darunter": zu_wenig, "ok": not zu_wenig and f * 100 <= n * 5 and n > 0}
        if zu_wenig:
            gruende.append(f"{name}: fewer than {minimum} calls per minute in minute(s) {zu_wenig[:5]}")
        if n == 0 or f * 100 > n * 5:
            gruende.append(f"{name}: error rate {rate:.3f} over {n} calls")
    leise = [z["t_min"] for z in pruef if z["pegel_master_db"] < PEGEL_BODEN]
    if leise:
        gruende.append(f"master level below {PEGEL_BODEN} dB in load minute(s) {leise[:5]} (load not audible)")
    return {"fehlerquote": round(fehler / aufrufe, 5), "aufrufe": aufrufe, "fehler": fehler,
            "endpunkte": endpunkte, "lebt": not tot, "pegel_ok": not leise,
            "pegel_min_db": min((z["pegel_master_db"] for z in pruef), default=None),
            "ok": not gruende}, gruende


def auswerten(zeilen, leerlauf_min=30, bezug=(25, 30), ende_min=5, last_min=240, probelauf=False,
              nicht_abgedeckt=()):
    """`nicht_abgedeckt`: what the load did not exercise (for example no instrument plugin host). Without a FAIL it makes
    the run "partial R3 coverage", never a PASS."""
    fails, unbr, hinweise = [], [], []
    erg = {"art": "probelauf" if probelauf else "r3", "speicher": {}, "speicher_summe": None, "luecken": None,
           "neustarts": None, "treiber": None, "bestanden": False, "unbrauchbar": None, "fails": fails,
           "neue_einheiten": [], "hinweise": hinweise, "nicht_abgedeckt": list(nicht_abgedeckt)}
    if nicht_abgedeckt:
        unbr.append("partial R3 coverage, not covered: " + "; ".join(nicht_abgedeckt))
    n_gruende, n_einh, gen_ok = _neustarts_roh(zeilen)
    fails += n_gruende
    erg["neustarts"] = {"ok": not n_gruende, "einheiten": n_einh, "generation_gleich": gen_ok}
    try:
        _pruefe(zeilen)
    except Unbrauchbar as e:
        unbr.append(str(e))
        return _abschluss(erg, fails, unbr)
    leer = [z for z in zeilen if z["phase"] == "leerlauf"]
    last = [z for z in zeilen if z["phase"] == "last"]
    if len(last) < last_min:
        unbr.append(f"aborted: {len(last)} of {last_min} planned load minutes")
    einheiten, weg = _einheiten(zeilen)
    for u, t in weg:
        fails.append(f"unit {u} disappeared from the rows at minute {t}")
    erg["neue_einheiten"] = [{"einheit": u, "t_min": zeilen[i]["t_min"]} for u, i in sorted(einheiten.items()) if i > 0]
    try:
        erg["speicher"], erg["speicher_summe"] = _speicher(zeilen, last, einheiten, bezug, ende_min, probelauf)
        for u, s in erg["speicher"].items():
            if s["ok"] is False:
                fails.append(f"memory of {u} grew {s['wachstum_prozent']} %")
    except Unbrauchbar as e:
        unbr.append(str(e))
    try:
        erg["luecken"] = _luecken(leer, last, leerlauf_min)
        if not erg["luecken"]["ok"]:
            fails.append("frame gaps in a load hour above the baseline")
    except Unbrauchbar as e:
        unbr.append(str(e))
    try:
        erg["treiber"], gr = _treiber(last)
        fails += gr
    except Unbrauchbar as e:
        unbr.append(str(e))
    return _abschluss(erg, fails, unbr)


def _abschluss(erg, fails, unbr):
    if fails:
        erg["bestanden"], erg["unbrauchbar"] = False, None      # a FAIL wins over an unusable reading
        erg["hinweise"] += unbr
    elif unbr:
        erg["bestanden"], erg["unbrauchbar"] = False, "; ".join(unbr)
    else:
        erg["bestanden"], erg["unbrauchbar"] = True, None
    return erg


def _leer_ergebnis(grund):
    return {"art": "r3", "speicher": {}, "speicher_summe": None, "luecken": None, "neustarts": None, "treiber": None,
            "bestanden": False, "unbrauchbar": grund, "fails": [], "neue_einheiten": [], "hinweise": []}


def markdown(e, titelzusatz=""):
    probe = e.get("art") == "probelauf"
    if e["fails"]:
        kopf = "FAILED"
    elif e["unbrauchbar"]:
        u = str(e["unbrauchbar"])
        kopf = ("ABORTED" if u.startswith("aborted") else
                "PARTIAL R3 COVERAGE" if u.startswith("partial R3 coverage") else "UNUSABLE")
    else:
        kopf = "PASSED"
    if probe:
        z = [f"# Dry run (10 min): says nothing about leaks, NOT an R3 verdict. Tool checks: "
             f"{'OK' if kopf == 'PASSED' else kopf}"]
    else:
        z = [f"# Soak verdict: {kopf}"]
    if titelzusatz:
        z += ["", titelzusatz]
    if e["fails"]:
        z += ["", "Reasons for FAILED:"] + [f"- {g}" for g in e["fails"]]
    if e["unbrauchbar"]:
        z += ["", f"Not judgeable: {e['unbrauchbar']}"]
    elif e["hinweise"]:
        z += ["", "Also not judgeable: " + "; ".join(e["hinweise"])]
    if e["neue_einheiten"]:
        z += ["", "Units that appeared after the first row (measured from their first minute): "
              + ", ".join(f"{n['einheit']} (minute {n['t_min']})" for n in e["neue_einheiten"])]
    ja = lambda ok: "not judged" if ok is None else ("pass" if ok else "FAIL")  # noqa: E731
    if e["speicher"]:
        z += ["", "| Unit | reference KiB | end KiB | growth % | result |", "|---|---|---|---|---|"]
        for u, s in e["speicher"].items():
            z.append(f"| {u}{' (late)' if s.get('spaeter_gestartet') else ''} | {s['bezug_kib']} | {s['ende_kib']} "
                     f"| {s['wachstum_prozent']} | {ja(s['ok'])} |")
        sm = e["speicher_summe"]
        if sm:
            z.append(f"| sum (not judged) | {sm['bezug_kib']} | {sm['ende_kib']} | {sm['wachstum_prozent']} | |")
    g = e["luecken"]
    if g:
        z += ["", "| Frame gaps per hour | events | frames (core counter) | frames (/e/luecke) |", "|---|---|---|---|",
              "| baseline | {ereignisse} | {frames} | {ereignis_frames} |".format(**g["grundlinie_pro_stunde"])]
        for i, b in enumerate(g["last_pro_stunde"], 1):
            z.append("| load block {} ({} min) | {} | {} | {} |".format(i, b["minuten"], b["ereignisse"], b["frames"],
                                                                          b["ereignis_frames"]))
        z += ["", f"- gaps not above baseline: {ja(g['ok'])}"]
    n, t = e["neustarts"], e["treiber"]
    if n:
        z.append(f"- no unit restart, generation unchanged: {ja(n['ok'])}"
                 + (f" (restarted: {', '.join(n['einheiten'])})" if n["einheiten"] else "")
                 + ("" if n["generation_gleich"] else " (generation changed)"))
    if t:
        z.append(f"- driver: thread alive {ja(t['lebt'])}, master level at least {PEGEL_BODEN} dB {ja(t['pegel_ok'])} "
                 f"(lowest {t['pegel_min_db']} dB)")
        for name, p in t["endpunkte"].items():
            z.append(f"- driver {name}: {p['aufrufe']} calls, {p['fehler']} errors, at least {p['minimum_je_minute']} "
                     f"per minute: {ja(p['ok'])}")
    z.append("")
    return "\n".join(z)


def lies_zeilen(pfad):
    zeilen = []
    with open(pfad, encoding="utf-8") as f:
        for n, s in enumerate(f, 1):
            if s.strip():
                try:
                    zeilen.append(json.loads(s))
                except ValueError as ex:
                    raise Unbrauchbar(f"line {n} is not JSON: {ex}")
    return zeilen


def exit_code(e):
    return 1 if e["fails"] else (2 if e["unbrauchbar"] else 0)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Soak run verdict")
    ap.add_argument("minuten")
    ap.add_argument("--leerlauf-min", type=int, default=30)
    ap.add_argument("--last-min", type=int, default=240, help="planned load minutes; a shorter run is never PASSED")
    ap.add_argument("--bezug", default="25:30")
    ap.add_argument("--ende-min", type=int, default=5)
    ap.add_argument("--probelauf", action="store_true", help="dry run: 2 idle, 8 load minutes, memory not judged")
    ap.add_argument("--json", default="")
    a = ap.parse_args(argv)
    try:
        if a.probelauf:
            a.leerlauf_min, a.last_min, a.bezug = 2, 8, "3:4"
        von, bis = (int(x) for x in a.bezug.split(":"))
        e = auswerten(lies_zeilen(a.minuten), a.leerlauf_min, (von, bis), a.ende_min, a.last_min, a.probelauf)
    except (Unbrauchbar, OSError, ValueError) as ex:
        e = _leer_ergebnis(str(ex))
    print(markdown(e))
    if a.json:
        with open(a.json, "w", encoding="utf-8") as f:
            json.dump(e, f, indent=1)
    return exit_code(e)


if __name__ == "__main__":
    sys.exit(main())
