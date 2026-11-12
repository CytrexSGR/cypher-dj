#!/usr/bin/env python3
"""Building blocks for the synth build-out (plan synth-ausbau, Decisions 2 and 4-7).

Every function appends nodes and edges to a graph under construction `g` (a dict with the lists "knoten" and "kanten", the same
lists a generator script keeps) and returns a dict: `"aus"` (the output port, or a structure of ports), `"namen"` {nr: name},
`"vorgaben"` {nr: vorgabe} and `"klassen"` {nr: class}. Names and vorgaben go into the graph's `regler_namen` and the panel.

Knob classes (Decision 2). Every knob created here is a `regler` node whose `vorgabe` follows its class:
  G   gate: an amount, level or mix. Exactly 0 effect at the default.
        unipolar: `min` 0, plain linear, `vorgabe` 0 (class "G")        bipolar: plain linear -x..x, `vorgabe` 0.5 (class "GB")
  N   neutral: changes an existing path in place and keeps the old value at the default. `mitte` = the old value, `vorgabe` 0.5
        written out; discrete knobs put the old option at its position (`diskretWert(i, n)` = i / (n - 1)) and `vorgabe` there.
  F   free parameter of a new module that reaches the sound only through a class G knob: any musical default.

Why the null is exact (the harness `measure_null.py` checks it bit for bit):
  * bipolar -x..x at knob 0.5: the engine computes `min + (max - min) * k` in f32; max - min = 2x is exact, times 0.5 is x, and
    -x + x is +0.0. Not -0.0, not 1e-17. (`tests/test_ausbau.py` checks every bipolar knob this way.)
  * a modulation joins an existing signal through `add` with the new term last: old + 0.0 == old. The term is `signal * amount`
    with amount exactly 0.0.
  * `mitte` returns its value by branch at knob 0.5, so `old * mitte(1.0)` and `mitte(alt)` are bit-identical to the old path.
  * `wahl` in switch mode passes the selected candidate unchanged when it is not fading; the first position applies at once.
  * `hall` nodes get `"mix": 0` (their smoother starts at the node's own value, see kosten-gate.md), chorus and delay take their
    input at once.

The semantic constants and the node set of the existing graphs are described in docs/presets/geraete/ and bestand.md; the engine
side of `vorgabe` and `mitte` is `Schritt::Regler` in src/programm.rs.
"""
import math

HZ_REF = 261.63          # C4: the key-follow reference
NOTE = "note"            # id of the note node the envelopes read gate and trig from (override with `note=`)


# ---- graph primitives ---------------------------------------------------------------------------------------------------------

def _frei(g, id):
    if any(k["id"] == id for k in g["knoten"]):
        raise ValueError(f"node id {id!r} already exists")


def knoten(g, id, art, **werte):
    _frei(g, id)
    g["knoten"].append({"id": id, "art": art, **werte})
    return id


def kante(g, von, nach, **extra):
    g["kanten"].append({"von": von, "nach": nach, **extra})


def regler(g, id, nr, lo, hi, log=False, vorgabe=None, mitte=None):
    w = {"nr": nr, "min": lo, "max": hi}
    if log:
        w["log"] = 1
    if vorgabe is not None:
        w["vorgabe"] = vorgabe
    if mitte is not None:
        w["mitte"] = mitte
    knoten(g, id, "regler", **w)
    return f"{id}.aus"


def mul(g, id, a, b):
    """Product of port `a` and port or number `b`."""
    knoten(g, id, "mul", **({"b": b} if isinstance(b, (int, float)) else {}))
    kante(g, a, f"{id}.a")
    if isinstance(b, str):
        kante(g, b, f"{id}.b")
    return f"{id}.aus"


def add(g, id, *quellen):
    """Sum of up to four ports or numbers, in the order given (the engine adds a + b + c + d)."""
    assert 1 <= len(quellen) <= 4
    knoten(g, id, "add")
    for p, q in zip("abcd", quellen):
        if isinstance(q, str):
            kante(g, q, f"{id}.{p}")
        else:
            g["knoten"][-1][p] = q
    return f"{id}.aus"


def eingang_von(g, ziel):
    """The edges that feed input port `ziel`."""
    return [e for e in g["kanten"] if e["nach"] == ziel]


def knoten_von(g, id):
    for k in g["knoten"]:
        if k["id"] == id:
            return k
    raise KeyError(id)


def umhaengen(g, alt, neu, ausser=()):
    """Every consumer of output port `alt` reads `neu` instead (edges into the ports in `ausser` keep `alt`)."""
    for e in g["kanten"]:
        if e["von"] == alt and e["nach"] not in ausser:
            e["von"] = neu


def einspeisen(g, id, ziel, term):
    """Join `term` into input port `ziel`: the port reads `old + term` from a new add node `id` (term last, so a term of exactly
    0.0 leaves the old value unchanged). The old value is the edge feeding `ziel`, or the node's own value for that port."""
    alt = eingang_von(g, ziel)
    if len(alt) > 1:
        raise ValueError(f"{ziel} has {len(alt)} feeding edges")
    knoten(g, id, "add")
    if alt:
        e = alt[0]
        # a one-sample delay marker belongs to the old signal, not to the add output
        extra = {"verzoegerung": e.pop("verzoegerung")} if "verzoegerung" in e else {}
        kante(g, e["von"], f"{id}.a", **extra)
        e["von"] = f"{id}.aus"
    else:
        nk, port = ziel.split(".")
        wert = knoten_von(g, nk).pop(port, None)
        if wert is not None:
            knoten_von(g, id)["a"] = wert
        kante(g, f"{id}.aus", ziel)
    kante(g, term, f"{id}.b")
    return f"{id}.aus"


def summe_erweitern(g, id, quelle, term):
    """Extend a sum that already exists as output port `quelle`: all its consumers read `quelle + term` (new add node `id`)."""
    p = add(g, id, quelle, term)
    umhaengen(g, quelle, p, ausser=(f"{id}.a",))
    return p


# ---- knob construction -----------------------------------------------------------------------------------------------------------

def _vlin(v, lo, hi):
    return (v - lo) / (hi - lo)


def _vlog(v, lo, hi):
    return math.log(v / lo) / math.log(hi / lo)


def diskret(i, n):
    """The knob position of option i of n (`diskretWert` in public/panel_skala.js)."""
    return 0.0 if n <= 1 else i / (n - 1)


class _Info:
    """Collects names, vorgaben and classes of the knobs a block creates, and refuses a number used twice."""

    def __init__(self):
        self.namen, self.vorgaben, self.klassen, self.stufen = {}, {}, {}, {}

    def neu(self, nr, name, vorgabe, klasse, stufen=None):
        if nr in self.namen:
            raise ValueError(f"knob number {nr} used twice")
        self.namen[nr], self.vorgaben[nr], self.klassen[nr] = name, vorgabe, klasse
        if stufen:
            self.stufen[nr] = stufen          # (n options, index of the default option)

    def ergebnis(self, **aus):
        return {**aus, "namen": self.namen, "vorgaben": self.vorgaben, "klassen": self.klassen, "stufen": self.stufen}


def _g_uni(g, info, id, nr, name, hi):
    """class G unipolar: 0..hi, vorgabe 0."""
    info.neu(nr, name, 0.0, "G")
    return regler(g, id, nr, 0, hi, vorgabe=0)


def _g_bi(g, info, id, nr, name, x):
    """class G bipolar: plain linear -x..x, vorgabe 0.5 (-x + 2x * 0.5 is exactly +0.0 in f32)."""
    info.neu(nr, name, 0.5, "GB")
    return regler(g, id, nr, -x, x, vorgabe=0.5)


def _n_mitte(g, info, id, nr, name, lo, hi, mitte, log=False):
    """class N: `mitte` is the old value, vorgabe 0.5 written out."""
    info.neu(nr, name, 0.5, "N")
    return regler(g, id, nr, lo, hi, log=log, vorgabe=0.5, mitte=mitte)


def _f(g, info, id, nr, name, lo, hi, wert, log=False):
    """class F: free, starts at `wert`."""
    v = _vlog(wert, lo, hi) if log else _vlin(wert, lo, hi)
    info.neu(nr, name, v, "F")
    return regler(g, id, nr, lo, hi, log=log, vorgabe=v)


def _wahl_knopf(g, info, id, nr, name, n, index, klasse="F"):
    """A selector knob: option `index` of `n`, stored as `diskretWert(index, n)`."""
    v = diskret(index, n)
    info.neu(nr, name, v, klasse, stufen=(n, index))
    return regler(g, id, nr, 0, 1, vorgabe=v)


def _wahl(g, id, n, eingaenge, wahl_port, blende=10, **werte):
    """Switch-mode `wahl` over `eingaenge` (ports) picking by knob `wahl_port` (0..1 split into n zones)."""
    knoten(g, id, "wahl", n=n, blende=blende, **werte)
    for i, q in enumerate(eingaenge):
        kante(g, q, f"{id}.e{i + 1}")
    kante(g, wahl_port, f"{id}.wahl")
    return f"{id}.aus"


def _ziel_eintrag(z):
    """(port, skala, modus) from "node.port" | (port, skala) | (port, skala, "ein"|"aus")."""
    if isinstance(z, str):
        return z, 1.0, "ein"
    return z[0], z[1], (z[2] if len(z) > 2 else "ein")


def _ziel_einspeisen(g, id, z, term):
    port, _, modus = _ziel_eintrag(z)
    return (einspeisen if modus == "ein" else summe_erweitern)(g, id, port, term)


# ---- modulation ------------------------------------------------------------------------------------------------------------------

def mod_env(g, prefix, nr0, ziele, note=NOTE):
    """A fourth ADSR for modulation: knobs nr0..nr0+3 = A, D, S, R (class F), then one bipolar amount knob (class G) per entry of
    `ziele`. An entry is `name`, `(name, skala)` or `(name, skala, ziel_port[, "ein"|"aus"])`: `skala` is the amount at full knob
    in the destination's unit. With a `ziel_port` the signal is joined into that port (`einspeisen`, or `summe_erweitern` for
    "aus"). Returns {"aus": {name: port}, "env": port, ...}."""
    info = _Info()
    env = knoten(g, f"{prefix}_env", "adsr", a=0.01, d=0.3, s=0.5, r=0.3)
    kante(g, f"{note}.gate", f"{env}.gate")
    kante(g, f"{note}.trig", f"{env}.trig")
    for i, (p, name, lo, hi, wert, log) in enumerate((
            ("a", "ModEnv attack", 0.001, 5, 0.01, True), ("d", "ModEnv decay", 0.01, 8, 0.3, True),
            ("s", "ModEnv sustain", 0, 1, 0.5, False), ("r", "ModEnv release", 0.01, 8, 0.3, True))):
        kante(g, _f(g, info, f"{prefix}_k_{p}", nr0 + i, name, lo, hi, wert, log), f"{env}.{p}")
    aus = {}
    for i, z in enumerate(ziele):
        name, skala, ziel = (z, 1.0, None) if isinstance(z, str) else (z[0], z[1], z[2:] or None)
        amt = _g_bi(g, info, f"{prefix}_k_amt_{name}", nr0 + 4 + i, f"ModEnv to {name}", skala)
        aus[name] = mul(g, f"{prefix}_to_{name}", f"{env}.aus", amt)
        if ziel:
            _ziel_einspeisen(g, f"{prefix}_in_{name}", (ziel[0], 1.0, ziel[1] if len(ziel) > 1 else "ein"), aus[name])
    return info.ergebnis(aus=aus, env=f"{env}.aus")


def ziel_wahl(g, prefix, signal, ziel_ports, wahl_port):
    """The target demux (Decision 6): one `wahl` per destination with n inputs (n = number of destinations), one live and the
    others `konst` 0, `blende` 10 ms, picked by `wahl_port`. Destination i receives `signal` when the knob selects option i,
    0.0 otherwise. `ziel_ports` entries: "node.port" | (port, skala) | (port, skala, "aus"); `skala` scales the live signal into
    the destination's unit. The demux output is joined into each destination (`einspeisen` for an input port, `summe_erweitern`
    for "aus" = the output port of an existing sum). Returns {"aus": [demux output ports]}."""
    n = len(ziel_ports)
    if not 2 <= n <= 8:
        raise ValueError("a demux needs 2..8 destinations")
    if not any(k["id"] == f"{prefix}_null" for k in g["knoten"]):
        knoten(g, f"{prefix}_null", "konst", wert=0)
    aus = []
    for i, z in enumerate(ziel_ports):
        port, skala, _ = _ziel_eintrag(z)
        live = signal if skala == 1.0 else mul(g, f"{prefix}_sk{i}", signal, skala)
        d = _wahl(g, f"{prefix}_zw{i}", n, [live if j == i else f"{prefix}_null.aus" for j in range(n)], wahl_port)
        _ziel_einspeisen(g, f"{prefix}_zin{i}", z, d)
        aus.append(d)
    return {"aus": aus}


def lfo2(g, prefix, nr0, ziele=None):
    """LFO 2 (Decision 6). Knobs nr0 rate (F, Hz log), nr0+1 shape (F, selector sine/triangle/saw/square), nr0+2 sync (F, seven
    positions: Free first, then 1/4 .. 8 beats), nr0+3 target (F, selector over `ziele`, default five options), nr0+4 amount (G,
    bipolar). Free mode = four `lfo` nodes picked by the shape knob; synced = six `lfo` nodes with `takt` 0.25 0.5 1 2 4 8, form
    triangle; the shape acts in Free mode only. Returns {"aus": signal x amount, "wahl": target knob port}; with `ziele` (see
    `ziel_wahl`) the demux is built and joined as well."""
    info = _Info()
    rate = _f(g, info, f"{prefix}_k_rate", nr0, "LFO2 rate", 0.05, 20, 2.0, log=True)
    form = _wahl_knopf(g, info, f"{prefix}_k_form", nr0 + 1, "LFO2 shape", 4, 0)
    sync = _wahl_knopf(g, info, f"{prefix}_k_sync", nr0 + 2, "LFO2 sync", 7, 0)
    nz = len(ziele) if ziele else 5
    ziel = _wahl_knopf(g, info, f"{prefix}_k_ziel", nr0 + 3, "LFO2 target", nz, 0)
    amt = _g_bi(g, info, f"{prefix}_k_amt", nr0 + 4, "LFO2 amount", 1.0)
    frei = []
    for i in range(4):
        knoten(g, f"{prefix}_f{i}", "lfo", form=i)
        kante(g, rate, f"{prefix}_f{i}.rate")
        frei.append(f"{prefix}_f{i}.aus")
    w_form = _wahl(g, f"{prefix}_form", 4, frei, form)
    takte = []
    for i, takt in enumerate((0.25, 0.5, 1, 2, 4, 8)):
        knoten(g, f"{prefix}_t{i}", "lfo", form=1, takt=takt)
        takte.append(f"{prefix}_t{i}.aus")
    w_sync = _wahl(g, f"{prefix}_sync", 7, [w_form] + takte, sync)
    aus = mul(g, f"{prefix}_sig", w_sync, amt)
    if ziele:
        ziel_wahl(g, f"{prefix}_z", aus, ziele, ziel)
    return info.ergebnis(aus=aus, wahl=ziel)


def lfo_klein(g, prefix, nr0, ziele):
    """The small LFO of Task 15: one free triangle `lfo`. Knobs nr0 rate (F), nr0+1 amount (G, bipolar), nr0+2 target (F, only when
    there are two or three `ziele`). `ziele` as in `ziel_wahl` (at most three). Returns {"aus": signal x amount}."""
    if not 1 <= len(ziele) <= 3:
        raise ValueError("lfo_klein takes one to three targets")
    info = _Info()
    rate = _f(g, info, f"{prefix}_k_rate", nr0, "LFO rate", 0.05, 20, 2.0, log=True)
    amt = _g_bi(g, info, f"{prefix}_k_amt", nr0 + 1, "LFO amount", 1.0)
    knoten(g, f"{prefix}_lfo", "lfo", form=1)
    kante(g, rate, f"{prefix}_lfo.rate")
    aus = mul(g, f"{prefix}_sig", f"{prefix}_lfo.aus", amt)
    if len(ziele) == 1:
        port, skala, _ = _ziel_eintrag(ziele[0])
        _ziel_einspeisen(g, f"{prefix}_zin", ziele[0], aus if skala == 1.0 else mul(g, f"{prefix}_sk", aus, skala))
    else:
        ziel = _wahl_knopf(g, info, f"{prefix}_k_ziel", nr0 + 2, "LFO target", len(ziele), 0)
        ziel_wahl(g, f"{prefix}_z", aus, ziele, ziel)
    return info.ergebnis(aus=aus)


def filter_env_menge(g, prefix, nr, env_port, cutoff_summe_port, skala=60):
    """Filter envelope amount (class G, bipolar +-`skala` semitones): `env_port` x amount is added to the cutoff semitone sum
    `cutoff_summe_port` (an output port; every consumer of the sum reads the extended one)."""
    info = _Info()
    amt = _g_bi(g, info, f"{prefix}_k_env", nr, "Env amount", skala)
    p = summe_erweitern(g, f"{prefix}_cut", cutoff_summe_port, mul(g, f"{prefix}_envst", env_port, amt))
    return info.ergebnis(aus=p)


# ---- times, glide, key follow, velocity, tuning -----------------------------------------------------------------------------------

def zeit_faktor(g, prefix, nr, quelle_port, alt_wert, lo, hi, name="Time"):
    """A class N time knob (log, `mitte` keeps the old value at the default).
    `quelle_port` given: the knob is a factor `lo..hi` around `mitte` 1.0 and the result is `quelle x factor` (old x 1.0 is old,
    bit for bit); `alt_wert` is not used. `quelle_port` None: the time was a node constant `alt_wert`; the knob is the time itself
    in `lo..hi` with `mitte` = `alt_wert`. Returns {"aus": port of the new time}; the caller connects it."""
    info = _Info()
    if quelle_port is not None:
        k = _n_mitte(g, info, f"{prefix}_k", nr, name, lo, hi, 1.0, log=True)
        return info.ergebnis(aus=mul(g, f"{prefix}_f", quelle_port, k))
    return info.ergebnis(aus=_n_mitte(g, info, f"{prefix}_k", nr, name, lo, hi, alt_wert, log=True))


_STD_ZEIT = {"a": (0.0005, 5.0, "Attack"), "d": (0.01, 10.0, "Decay"), "r": (0.01, 10.0, "Release")}


def huellen_zeit(g, adsr_id, attack=None, decay=None, sustain=None, release=None):
    """Rewire the `a`, `d`, `s`, `r` input ports of the existing `adsr` node `adsr_id` through class N knobs. Each argument is
    `(nr, alt)` or `(nr, alt, lo, hi)`. A port fed by an edge gets `source x factor` (factor log 0.1..10 unless lo/hi are given,
    `mitte` 1.0); a port that carries a node constant gets a knob whose `mitte` is that constant (a, d, r: log; s: linear 0..1).
    `alt` must match the node constant when the port has one. A sustain that is already fed by an edge is refused."""
    info = _Info()
    node = knoten_von(g, adsr_id)
    for port, arg, name in (("a", attack, "Attack"), ("d", decay, "Decay"), ("s", sustain, "Sustain"), ("r", release, "Release")):
        if arg is None:
            continue
        nr, alt, *bereich = arg
        edges = eingang_von(g, f"{adsr_id}.{port}")
        pre = f"{adsr_id}_{port}"
        if edges:
            if port == "s":
                raise ValueError(f"{adsr_id}.s is fed by an edge: the sustain is already a knob there")
            lo, hi = bereich or (0.1, 10.0)
            r = zeit_faktor(g, pre, nr, edges[0]["von"], None, lo, hi, name=name)
            edges[0]["von"] = r["aus"]
        else:
            if port in node and node[port] != alt:
                raise ValueError(f"{adsr_id}.{port} is {node[port]} in the graph, not {alt}")
            if port == "s":
                lo, hi = bereich or (0.0, 1.0)
                if not lo < alt < hi:
                    raise ValueError("sustain `mitte` must lie strictly inside 0..1")
                k = _n_mitte(g, info, f"{pre}_k", nr, name, lo, hi, alt)
                r = {"aus": k}
            else:
                lo, hi = bereich or _STD_ZEIT[port][:2]
                if not lo < alt < hi:
                    lo, hi = min(lo, alt / 4), max(hi, alt * 4)
                r = zeit_faktor(g, pre, nr, None, alt, lo, hi, name=name)
            kante(g, r["aus"], f"{adsr_id}.{port}")
        for k in ("namen", "vorgaben", "klassen"):
            getattr(info, k).update(r.get(k, {}))
        if port == "s":
            info.neu(nr, name, 0.5, "N") if nr not in info.namen else None
    return info.ergebnis()


def glide(g, prefix, nr, hz_port, reset_port):
    """Portamento (Decision 6, class G): a selector knob (Off, six times: 10, 25, 50, 120, 300, 800 ms) over six `glatt` nodes,
    one per time, per voice from the pitch the voice had last. `reset_port` (e.g. `note.erste`) sets the glide to the new pitch
    at once. Off passes `hz_port` unchanged. Returns {"aus": the new hz port}; the caller points the oscillators at it."""
    info = _Info()
    k = _g_uni(g, info, f"{prefix}_k", nr, "Glide", 1.0)
    info.stufen[nr] = (7, 0)
    zeiten = (0.01, 0.025, 0.05, 0.12, 0.3, 0.8)
    for i, z in enumerate(zeiten):
        knoten(g, f"{prefix}_g{i}", "glatt", zeit=z)
        kante(g, hz_port, f"{prefix}_g{i}.x")
        kante(g, reset_port, f"{prefix}_g{i}.setzen")
    aus = _wahl(g, f"{prefix}_w", 7, [hz_port] + [f"{prefix}_g{i}.aus" for i in range(6)], k)
    return info.ergebnis(aus=aus)


_KF_ANKER = [12 * math.log2(1 + 3 * i / 7) for i in range(8)]     # 0 .. 24 semitones over one two-octave band


def schluesselfolge(g, prefix, nr, hz_port, cutoff_summe_port):
    """Key follow (class G, 0..1, vorgabe 0): adds `amount x 12 x log2(hz / 261.63)` semitones to the cutoff semitone sum
    `cutoff_summe_port` (an output port; every consumer reads the extended sum). The engine has no log block, so log2 is built from
    four two-octave bands, each a clamped ramp through a morph-mode `wahl` of eight anchors (3 nodes per band); it follows 12 log2
    within 0.45 semitone from 16 Hz to 4.2 kHz and holds its end values outside (`schluessel_modell` is the same curve in Python)."""
    info = _Info()
    amt = _g_uni(g, info, f"{prefix}_k", nr, "Key follow", 1.0)
    x = mul(g, f"{prefix}_x", hz_port, 1 / HZ_REF)
    baender = []
    for b in range(4):
        unten = 2.0 ** (2 * b - 4)                           # lower edge of the band as a hz ratio
        m = mul(g, f"{prefix}_m{b}", x, 1 / (3 * unten))
        w = add(g, f"{prefix}_w{b}", m, -1 / 3)              # (x / unten - 1) / 3, 0..1 over the band, clamped by the morph
        anker = {f"e{i + 1}": _KF_ANKER[i] - (48.0 if b == 0 else 0.0) for i in range(8)}
        knoten(g, f"{prefix}_b{b}", "wahl", n=8, modus=1, **anker)
        kante(g, w, f"{prefix}_b{b}.wahl")
        baender.append(f"{prefix}_b{b}.aus")
    st = add(g, f"{prefix}_st", *baender)
    p = summe_erweitern(g, f"{prefix}_cut", cutoff_summe_port, mul(g, f"{prefix}_term", st, amt))
    return info.ergebnis(aus=p)


def schluessel_modell(hz):
    """The curve `schluesselfolge` builds, in semitones (for the tests): piecewise linear over the anchors."""
    x = hz / HZ_REF
    s = -48.0
    for b in range(4):
        w = min(1.0, max(0.0, (x / 2.0 ** (2 * b - 4) - 1) / 3))
        pos = w * 7
        i = min(int(pos), 7)
        j = min(i + 1, 7)
        s += _KF_ANKER[i] * (1 - (pos - i)) + _KF_ANKER[j] * (pos - i)
    return s


def vel_tiefe(g, prefix, nr, vel_port, alt_term_port):
    """Velocity depth (class N): a knob 0..2, linear, `mitte` 1.0, multiplies the velocity-dependent term `alt_term_port` (the
    port that carries it today; `vel_port` is used when there is none). Returns {"aus": the new term}; the caller reads it
    instead of the old one (`umhaengen(g, alt_term_port, new, ausser=(first mul input,))` does that for all consumers)."""
    info = _Info()
    k = _n_mitte(g, info, f"{prefix}_k", nr, "Velocity depth", 0, 2, 1.0)
    return info.ergebnis(aus=mul(g, f"{prefix}_t", alt_term_port or vel_port, k))


def vel_zu_cutoff(g, prefix, nr, vel_port, cutoff_summe_port, skala=36):
    """Velocity to cutoff (class G, bipolar +-`skala` semitones): `vel_port x amount` is added to the cutoff semitone sum."""
    info = _Info()
    amt = _g_bi(g, info, f"{prefix}_k", nr, "Velocity to cutoff", skala)
    p = summe_erweitern(g, f"{prefix}_cut", cutoff_summe_port, mul(g, f"{prefix}_t", vel_port, amt))
    return info.ergebnis(aus=p)


def stimmung(g, prefix, nr, hz_port):
    """Master tune (class G, bipolar +-100 ct): `transponiere` adds the knob (in cent) to the pitch; at 0.0 the factor is
    2^0 = 1.0 exactly. Returns {"aus": the new hz port}."""
    info = _Info()
    k = _g_bi(g, info, f"{prefix}_k", nr, "Tune", 100)
    knoten(g, f"{prefix}_hz", "transponiere")
    kante(g, hz_port, f"{prefix}_hz.hz")
    kante(g, k, f"{prefix}_hz.cent")
    return info.ergebnis(aus=f"{prefix}_hz.aus")


# ---- second oscillator --------------------------------------------------------------------------------------------------------------

def osc2(g, prefix, nr0, tier, hz_port, pw_port, sync_port=None, ring_port=None):
    """The second oscillator of synth-poly. Tier B (one copy plus pulse): a saw and a pulse (width from `pw_port`), picked by a
    selector, pitch = `hz_port` + octave + semitone + detune, optional hard sync and ring modulation. Knobs: nr0 level (G), nr0+1
    wave (F: saw / pulse), nr0+2 octave (F: five options -2..+2), nr0+3 semitone (F, +-12), nr0+4 detune (F, +-50 ct), nr0+5 sync
    (F: off / on), nr0+6 ring (F, 0..1). Everything reaches the sound through the level (ring included), so level 0 adds exactly
    0.0. `sync_port`: the master cycle (`zyklus`) of oscillator 1; `ring_port`: its signal; when absent an internal saw at
    `hz_port` serves as master. Returns {"aus": mono signal}. Tier A (a second full stack) is not built: it would repeat the
    unison wiring of build_synth_poly.py with a second set of gains, and the cost gate dropped it."""
    if tier != "B":
        raise NotImplementedError("osc2 tier A (second full unison stack) is not implemented: the cost gate chose tier B")
    info = _Info()
    lv = _g_uni(g, info, f"{prefix}_k_lv", nr0, "Osc2 level", 1.0)
    wave = _wahl_knopf(g, info, f"{prefix}_k_wave", nr0 + 1, "Osc2 wave", 2, 0)
    okt = _wahl_knopf(g, info, f"{prefix}_k_okt", nr0 + 2, "Osc2 octave", 5, 2)
    st = info.neu(nr0 + 3, "Osc2 semitone", 0.5, "F") or regler(g, f"{prefix}_k_st", nr0 + 3, -12, 12, vorgabe=0.5)
    det = info.neu(nr0 + 4, "Osc2 detune", 0.5, "F") or regler(g, f"{prefix}_k_det", nr0 + 4, -50, 50, vorgabe=0.5)
    sy = _wahl_knopf(g, info, f"{prefix}_k_sync", nr0 + 5, "Osc2 sync", 2, 0)
    ring = _f(g, info, f"{prefix}_k_ring", nr0 + 6, "Osc2 ring", 0, 1, 0.0)
    if sync_port is None or ring_port is None:
        knoten(g, f"{prefix}_master", "saege")
        kante(g, hz_port, f"{prefix}_master.hz")
        sync_port = sync_port or f"{prefix}_master.zyklus"
        ring_port = ring_port or f"{prefix}_master.aus"
    cent = add(g, f"{prefix}_cent",
               _wahl(g, f"{prefix}_okt", 5, [], okt, **{f"e{i + 1}": -2400 + 1200 * i for i in range(5)}),
               mul(g, f"{prefix}_stc", st, 100), det)
    knoten(g, f"{prefix}_hz", "transponiere")
    kante(g, hz_port, f"{prefix}_hz.hz")
    kante(g, cent, f"{prefix}_hz.cent")
    knoten(g, f"{prefix}_nullsync", "konst", wert=0)
    gate = _wahl(g, f"{prefix}_sg", 2, [f"{prefix}_nullsync.aus", sync_port], sy)
    knoten(g, f"{prefix}_saw", "saege")
    kante(g, f"{prefix}_hz.aus", f"{prefix}_saw.hz")
    kante(g, gate, f"{prefix}_saw.sync")
    knoten(g, f"{prefix}_puls", "puls")
    kante(g, f"{prefix}_hz.aus", f"{prefix}_puls.hz")
    kante(g, pw_port, f"{prefix}_puls.pwm")
    kante(g, gate, f"{prefix}_puls.sync")
    w = _wahl(g, f"{prefix}_wave", 2, [f"{prefix}_saw.aus", f"{prefix}_puls.aus"], wave)
    sig = add(g, f"{prefix}_sig", w, mul(g, f"{prefix}_rg", mul(g, f"{prefix}_rp", ring_port, w), ring))
    return info.ergebnis(aus=mul(g, f"{prefix}_out", sig, lv))


# ---- effects at the end -------------------------------------------------------------------------------------------------------------

_FX_FOLGE = ("chorus", "chorus_modus", "delay_zeit", "delay_fb", "delay_mix", "hall_decay", "hall_mix", "pingpong")


def fx_ende(g, prefix, nr0, quelle, abschnitte=("chorus", "delay", "hall"), nrs=None, pingpong=True,
            hall_stufen=(0.9, 2.2, 5.0)):
    """Effects at the end of the signal path (Decision 7): chorus, delay, reverb in that order. `quelle` is ("x", port) for a mono
    source or ("lr", port_l, port_r). `abschnitte` picks the sections. Knobs (default numbers count up from `nr0` in this order,
    skipping what is left out; `nrs` {key: nr} overrides any of them): "chorus" amount (G, 0) and "chorus_modus" (F, I/II/I+II),
    "delay_zeit" (F, ms), "delay_fb" (F), "delay_mix" (G, 0), "hall_decay" (F), "hall_mix" (G, 0), "pingpong" (F switch,
    `pingpong=False` leaves it out and fixes ping-pong on). The mix knobs sit at exactly 0, so the dry signal passes unchanged: a
    mono source comes out as l = r = the source.
    The engine takes `decay` and `pingpong` as node constants, not as ports, so those two knobs pick between nodes: one `hall` per
    entry of `hall_stufen` (decay in seconds; a single entry leaves the decay knob out) and a delay with ping-pong off and one
    with it on. Every candidate runs all the time. Returns {"l", "r", "aus": (l, r)}."""
    nrs = dict(nrs or {})
    folge = iter(range(nr0, nr0 + 20))
    gebraucht = []
    if "chorus" in abschnitte:
        gebraucht += ["chorus", "chorus_modus"]
    if "delay" in abschnitte:
        gebraucht += ["delay_zeit", "delay_fb", "delay_mix"]
    if "hall" in abschnitte:
        gebraucht += (["hall_decay"] if len(hall_stufen) > 1 else []) + ["hall_mix"]
    if "delay" in abschnitte and pingpong:
        gebraucht += ["pingpong"]
    nr = {k: nrs.get(k) if k in nrs else None for k in gebraucht}
    for k in _FX_FOLGE:
        if k in nr and nr[k] is None:
            nr[k] = next(folge)
    info = _Info()
    cur = quelle

    def eingaben(knoten_id, c):
        if c[0] == "x":
            kante(g, c[1], f"{knoten_id}.x")
        else:
            kante(g, c[1], f"{knoten_id}.l")
            kante(g, c[2], f"{knoten_id}.r")

    if "chorus" in abschnitte:
        amt = _g_uni(g, info, f"{prefix}_k_ch", nr["chorus"], "Chorus", 1.0)
        modus = _wahl_knopf(g, info, f"{prefix}_k_chm", nr["chorus_modus"], "Chorus mode", 3, 0)
        if cur[0] == "x":
            x = cur[1]
        else:
            # Stereo source: the chorus runs on the mid signal and only its wet part joins the dry sides. The chorus is a sum point
            # (it adds the voices up and answers in voice 0), so the dry mid it contains is taken from a second chorus at mix 0, not
            # from the per-voice mid: `chorus - chorus(mix 0)` is exactly 0.0 at amount 0 whatever the voice count.
            x = mul(g, f"{prefix}_mid", add(g, f"{prefix}_lr", cur[1], cur[2]), 0.5)
            knoten(g, f"{prefix}_ch0", "chorus", modus=1, mix=0)
            kante(g, x, f"{prefix}_ch0.x")
        for i in (1, 2, 3):
            knoten(g, f"{prefix}_ch{i}", "chorus", modus=i)
            kante(g, x, f"{prefix}_ch{i}.x")
            kante(g, amt, f"{prefix}_ch{i}.mix")
        seiten = []
        for s in ("l", "r"):
            w = _wahl(g, f"{prefix}_chw_{s}", 3, [f"{prefix}_ch{i}.{s}" for i in (1, 2, 3)], modus)
            if cur[0] == "x":
                seiten.append(w)
            else:
                wet = add(g, f"{prefix}_chd_{s}", w, mul(g, f"{prefix}_chn_{s}", f"{prefix}_ch0.{s}", -1))
                seiten.append(add(g, f"{prefix}_cho_{s}", cur[1 if s == "l" else 2], wet))
        cur = ("lr", seiten[0], seiten[1])

    if "delay" in abschnitte:
        zeit = _f(g, info, f"{prefix}_k_dz", nr["delay_zeit"], "Delay time", 20, 800, 375, log=True)
        fb = _f(g, info, f"{prefix}_k_dfb", nr["delay_fb"], "Delay feedback", 0, 0.9, 0.35)
        mix = _g_uni(g, info, f"{prefix}_k_dmix", nr["delay_mix"], "Delay mix", 1.0)
        pp = _wahl_knopf(g, info, f"{prefix}_k_dpp", nr["pingpong"], "Ping-pong", 2, 0) if pingpong else None
        varianten = (0, 1) if pingpong else (1,)
        for v in varianten:
            knoten(g, f"{prefix}_dl{v}", "delay", pingpong=v, mix=0)
            eingaben(f"{prefix}_dl{v}", cur)
            kante(g, zeit, f"{prefix}_dl{v}.zeit")
            kante(g, fb, f"{prefix}_dl{v}.fb")
            kante(g, mix, f"{prefix}_dl{v}.mix")
        if pingpong:
            cur = ("lr", *[_wahl(g, f"{prefix}_dlw_{s}", 2, [f"{prefix}_dl{v}.{s}" for v in (0, 1)], pp) for s in ("l", "r")])
        else:
            cur = ("lr", f"{prefix}_dl1.l", f"{prefix}_dl1.r")

    if "hall" in abschnitte:
        n = len(hall_stufen)
        dec = None
        if n > 1:                                                   # a selector over the hall nodes, default the one closest to 2.2 s
            dec = _wahl_knopf(g, info, f"{prefix}_k_hd", nr["hall_decay"], "Reverb decay", n, min(range(n), key=lambda i: abs(hall_stufen[i] - 2.2)))
        mix = _g_uni(g, info, f"{prefix}_k_hmix", nr["hall_mix"], "Reverb mix", 1.0)
        for i, d in enumerate(hall_stufen):
            knoten(g, f"{prefix}_hl{i}", "hall", mix=0, decay=d)
            eingaben(f"{prefix}_hl{i}", cur)
            kante(g, mix, f"{prefix}_hl{i}.mix")
        if n > 1:
            cur = ("lr", *[_wahl(g, f"{prefix}_hlw_{s}", n, [f"{prefix}_hl{i}.{s}" for i in range(n)], dec) for s in ("l", "r")])
        else:
            cur = ("lr", f"{prefix}_hl0.l", f"{prefix}_hl0.r")

    l, r = (cur[1], cur[1]) if cur[0] == "x" else (cur[1], cur[2])
    return info.ergebnis(l=l, r=r, aus=(l, r))


def fx_klein(g, prefix, nr0, quelle, welche):
    """A subset of `fx_ende` for the small graphs: `welche` is any of "delay", "hall", "chorus" (no ping-pong knob)."""
    welche = tuple(welche)
    if not welche or any(w not in ("delay", "hall", "chorus") for w in welche):
        raise ValueError('`welche` must be a non-empty subset of "delay", "hall", "chorus"')
    return fx_ende(g, prefix, nr0, quelle, abschnitte=tuple(a for a in ("chorus", "delay", "hall") if a in welche), pingpong=False)
