#!/usr/bin/env python3
"""Builds the 46 recipe patches (beispiele/rezepte/<group>-<subtype>.json) and their MANIFEST.json from RECIPES.md.

Run from anywhere: `python3 baue_rezepte.py`. The script is the source of the patches: edit a recipe here, run it, and
commit the generated JSON together with the script. `--pegel FILE` reads output trims measured by tests/rezepte.rs
(`MESS_PEGEL name trim` lines), so every patch peaks at the same level, and stores them in PEGEL below; without it the
trims in PEGEL are used.

Conventions (the ones of beispiele/*.json, checked by tests/beispiele_konvention.rs):
  * every knob is named, feeds something and changes the sound on the probe; knob midpoint 0.5 is the card's value,
  * every delay and hall has its mix on a knob,
  * the last node before the output is a fixed trim (`pegel`, `pegel_l`, `pegel_r`) that sets the patch level.

Mappings used for Welsh's percent values (Welsh's Synthesizer Cookbook, [B1]):
  * cutoff p % -> 20 * 2^(p / 10) Hz (10 % = 40 Hz, 50 % = 640 Hz, 100 % = 20.5 kHz; matches every pair on the cards),
  * filter envelope amount E % -> 1.2 * E semitones of cutoff at full envelope (10 % of the scale = one octave),
  * resonance r % -> ladder `reso` r / 100 (1 = self-oscillation),
  * pulse width w -> `puls.pwm` (w - 0.5) / 0.45, wavetable `rechteck` pos (0.5 - w) / 0.45.
"""
import json
import re
import sys
from pathlib import Path

HIER = Path(__file__).resolve().parent
ZIEL = HIER.parent / "beispiele" / "rezepte"
KARTEN = HIER / "RECIPES.md"


def pw(w):
    """pwm input for pulse width w (0.02..0.98)"""
    return round((w - 0.5) / 0.45, 4)


def wt_pw(w):
    """wavetable `rechteck` position for pulse width w (0.05..0.5)"""
    return round((0.5 - w) / 0.45, 4)


def welsh_hz(p):
    return round(20 * 2 ** (p / 10), 1)


def zahl(v):
    if isinstance(v, float) and v.is_integer() and abs(v) < 1e9:
        return int(v)
    return v


class Patch:
    def __init__(self, name, stimmen):
        self.name = name
        self.stimmen = stimmen
        self.knoten = []
        self.kanten = []
        self.regler = {}
        self.ids = set()
        self.zaehler = {}
        self.node("note", "note")

    # ---- graph primitives
    def node(self, id, art, **werte):
        assert id not in self.ids, f"{self.name}: duplicate id {id}"
        assert "." not in id and "/" not in id
        self.ids.add(id)
        k = {"id": id, "art": art}
        for w, v in werte.items():
            if v is None:
                continue
            k[w] = zahl(v)
        self.knoten.append(k)
        return id

    def neu(self, prefix):
        n = self.zaehler.get(prefix, 0) + 1
        self.zaehler[prefix] = n
        return f"{prefix}{n}"

    def edge(self, von, nach):
        assert "." in von and "." in nach, (von, nach)
        self.kanten.append({"von": von, "nach": nach})

    def setze(self, knoten, port, quelle):
        """an input: a port string becomes an edge, a number a fixed value of the node"""
        if quelle is None:
            return
        if isinstance(quelle, str):
            self.edge(quelle, f"{knoten}.{port}")
        else:
            for k in self.knoten:
                if k["id"] == knoten:
                    k[port] = zahl(float(quelle))
                    return
            raise KeyError(knoten)

    def knob(self, nr, name, mn, mx, log=False, id=None):
        """a knob; midpoint 0.5 = sqrt(mn * mx) for log, (mn + mx) / 2 for linear"""
        id = id or f"k_{re.sub('[^a-z0-9]+', '_', name.lower()).strip('_')}"
        if nr in self.regler:
            assert self.regler[nr] == name, f"{self.name}: knob {nr} named twice"
        self.regler[nr] = name
        self.node(id, "regler", nr=nr, min=mn, max=mx, log=1 if log else None)
        return f"{id}.aus"

    def knob_log(self, nr, name, mitte, faktor, id=None):
        return self.knob(nr, name, round(mitte / faktor, 6), round(mitte * faktor, 6), log=True, id=id)

    def knob_lin(self, nr, name, mitte, halb, id=None):
        return self.knob(nr, name, round(mitte - halb, 6), round(mitte + halb, 6), id=id)

    # ---- building blocks (each returns an output port)
    def mul(self, a, b, id=None):
        id = id or self.neu("m")
        self.node(id, "mul")
        self.setze(id, "a", a)
        self.setze(id, "b", b)
        return f"{id}.aus"

    def add(self, *xs, id=None):
        assert 1 <= len(xs) <= 4
        id = id or self.neu("s")
        self.node(id, "add")
        for p, x in zip("abcd", xs):
            self.setze(id, p, x)
        return f"{id}.aus"

    def summe(self, *xs, id=None):
        """sum of any number of signals (chains add nodes of four)"""
        xs = list(xs)
        while len(xs) > 4:
            xs = [self.add(*xs[:4])] + xs[4:]
        return self.add(*xs, id=id)

    def tr(self, hz, st=0, cent=0, id=None):
        if st == 0 and cent == 0:
            return hz
        id = id or self.neu("ton")
        self.node(id, "transponiere")
        self.setze(id, "hz", hz)
        self.setze(id, "st", st)
        self.setze(id, "cent", cent)
        return f"{id}.aus"

    def osc(self, art, hz, pwm=None, sync=None, id=None, fm=None):
        id = id or self.neu({"saege": "saw", "puls": "pulse", "dreieck": "tri", "sinus": "sine"}[art])
        self.node(id, art)
        self.setze(id, "hz", hz)
        if art == "puls":
            self.setze(id, "pwm", pwm)
        if art == "sinus":
            self.setze(id, "fm", fm)
        self.setze(id, "sync", sync)
        return f"{id}.aus"

    def wt(self, tabelle, kopien, hz, verst=0, breite=0, pos=0, trig="note.trig", id=None, **frei):
        id = id or self.neu("wt")
        self.node(id, "wavetable", tabelle=tabelle, kopien=kopien, **frei)
        self.setze(id, "hz", hz)
        if trig:
            self.setze(id, "trig", trig)
        for p, v in (("verstimmung", verst), ("breite", breite), ("pos", pos)):
            if v:
                self.setze(id, p, v)
        return id

    def rauschen(self, id=None):
        id = id or self.neu("noise")
        self.node(id, "rauschen")
        return f"{id}.aus"

    def lfo(self, rate, form=0, id=None, **frei):
        id = id or self.neu("lfo")
        self.node(id, "lfo", form=form if form else None, **frei)
        self.setze(id, "rate", rate)
        return f"{id}.aus"

    def env(self, a, d, s, r, gate="note.gate", trig="note.trig", id=None):
        id = id or self.neu("env")
        self.node(id, "adsr", **{k: (v if not isinstance(v, str) else 0) for k, v in (("a", a), ("d", d), ("s", s), ("r", r))})
        self.setze(id, "gate", gate)
        if trig:
            self.setze(id, "trig", trig)
        for p, v in (("a", a), ("d", d), ("s", s), ("r", r)):
            if isinstance(v, str):
                self.edge(v, f"{id}.{p}")
        return f"{id}.aus"

    def ladder(self, x, cutoff, reso=0, id=None):
        id = id or self.neu("ladder")
        self.node(id, "ladder")
        self.setze(id, "x", x)
        self.setze(id, "cutoff", cutoff)
        self.setze(id, "reso", reso)
        return f"{id}.aus"

    def svf(self, x, cutoff, reso=0, pole=2, aus="tp", id=None):
        id = id or self.neu("svf")
        self.node(id, "svf", pole=4 if pole == 4 else None)
        self.setze(id, "x", x)
        self.setze(id, "cutoff", cutoff)
        self.setze(id, "reso", reso)
        return f"{id}.{aus}" if isinstance(aus, str) else id

    def saett(self, x, antrieb, id=None):
        id = id or self.neu("drive")
        self.node(id, "saett")
        self.setze(id, "x", x)
        self.setze(id, "antrieb", antrieb)
        return f"{id}.aus"

    def roehre(self, x, antrieb, id=None, **frei):
        id = id or self.neu("tube")
        self.node(id, "roehre", **frei)
        self.setze(id, "x", x)
        self.setze(id, "antrieb", antrieb)
        return f"{id}.aus"

    def krume(self, x, bits, rate=None, id=None):
        id = id or self.neu("crush")
        self.node(id, "krume", rate=rate)
        self.setze(id, "x", x)
        self.setze(id, "bits", bits)
        return f"{id}.aus"

    def glide(self, zeit, id="glide"):
        self.node(id, "glatt", zeit=zeit)
        self.edge("note.hz", f"{id}.x")
        self.edge("note.erste", f"{id}.setzen")
        return f"{id}.aus"

    def vca(self, x, env):
        return self.mul(x, env, id=self.neu("vca"))


# ---- stereo signal helpers. A signal is ("m", port) or ("s", l, r).
def mono(x):
    return ("m", x)


def eingaenge(p, id, sig):
    if sig[0] == "m":
        p.setze(id, "x", sig[1])
    else:
        p.setze(id, "l", sig[1])
        p.setze(id, "r", sig[2])


def je_seite(p, sig, f):
    """apply a per-voice block f(port, side) to each side"""
    if sig[0] == "m":
        return ("m", f(sig[1], ""))
    return ("s", f(sig[1], "_l"), f(sig[2], "_r"))


def chorus(p, sig, modus=1, mix=1.0, id="chorus"):
    x = sig[1] if sig[0] == "m" else p.add(sig[1], sig[2], id="chorus_in")
    p.node(id, "chorus", modus=modus if modus != 1 else None)
    p.setze(id, "x", x)
    p.setze(id, "mix", mix)
    return ("s", f"{id}.l", f"{id}.r")


def summenpunkt(p, art, sig, id, **werte):
    ports = {k: v for k, v in werte.items() if isinstance(v, str)}
    fest = {k: v for k, v in werte.items() if not isinstance(v, str)}
    p.node(id, art, **fest)
    eingaenge(p, id, sig)
    for k, v in ports.items():
        p.edge(v, f"{id}.{k}")
    return ("s", f"{id}.l", f"{id}.r")


def hall(p, sig, mix, id="hall", **w):
    return summenpunkt(p, "hall", sig, id, mix=mix, **w)


def delay(p, sig, mix, id="delay", **w):
    return summenpunkt(p, "delay", sig, id, mix=mix, **w)


def phaser(p, sig, mix, id="phaser", **w):
    return summenpunkt(p, "phaser", sig, id, mix=mix, **w)


def komp(p, sig, id="komp", **w):
    return summenpunkt(p, "komp", sig, id, **w)


def limiter(p, sig, id="limiter", **w):
    return summenpunkt(p, "limiter", sig, id, **w)


def gate(p, sig, id="gate", **w):
    return summenpunkt(p, "gate", sig, id, **w)


def faltung(p, sig, mix, datei, id="faltung", **w):
    s = summenpunkt(p, "faltung", sig, id, mix=mix, **w)
    for k in p.knoten:
        if k["id"] == id:
            k["datei"] = datei
    return s


def hochpass(p, sig, hz, id="hp"):
    return je_seite(p, sig, lambda x, s: p.svf(x, hz, 0, aus="hp", id=f"{id}{s}"))


def tiefpass(p, sig, hz, id="lp", reso=0, pole=2):
    return je_seite(p, sig, lambda x, s: p.svf(x, hz, reso, pole=pole, aus="tp", id=f"{id}{s}"))


def ausgang(p, sig, pegel):
    """DC block at 15 Hz, then the level trim, then the output"""
    sig = hochpass(p, sig, 15, id="dcblock")
    p.node("aus", "ausgang")
    if sig[0] == "m":
        p.node("pegel", "mul", b=pegel)
        p.edge(sig[1], "pegel.a")
        p.edge("pegel.aus", "aus.x")
    else:
        p.node("pegel_l", "mul", b=pegel)
        p.node("pegel_r", "mul", b=pegel)
        p.edge(sig[1], "pegel_l.a")
        p.edge(sig[2], "pegel_r.a")
        p.edge("pegel_l.aus", "aus.l")
        p.edge("pegel_r.aus", "aus.r")


def filter_env_cutoff(p, basis, fenv, amt):
    """cutoff = basis * 2^(fenv * amt / 12): an envelope that moves the cutoff in semitones (Welsh's env amount)"""
    return p.tr(basis, st=p.mul(fenv, amt), id=p.neu("cut"))


def inverse_knob(p, nr, name, mn, mx, id):
    """a second regler on knob `nr` running the other way (mx..mn): lets a knob crossfade (as saite.json does)"""
    p.node(id, "regler", nr=nr, min=mx, max=mn)
    return f"{id}.aus"


def tiefe_mod(p, lfo, nr, name, tiefe_mitte, id):
    """amplitude modulation 1 - depth * (1 - lfo) / 2 with depth on knob `nr` (0 .. 2 * tiefe_mitte): the level swings
    between 1 and 1 - depth"""
    halb = p.knob(nr, name, 0, tiefe_mitte, id=f"{id}_halb")
    rest = inverse_knob(p, nr, name, 1 - tiefe_mitte, 1, id=f"{id}_rest")
    return p.add(p.mul(lfo, halb), rest, id=id)


# ======================================================================================================================
# The recipes. Each function builds one card; the docstring is the build note. Notes and the module that would make the
# patch exact go to the manifest (NOTIZ). Pitches: bass patches put their lowest layer on the played note, so the card's
# octave offsets are kept as intervals between the layers (Welsh writes them against a keyboard two octaves up).

REZEPTE = {}


def rezept(id, status, modul, notizen, probe, einsatz, energie, satz, upgrade=None):
    def deko(f):
        REZEPTE[id] = dict(bau=f, status=status, modul=modul, notizen=notizen, probe=probe, einsatz=einsatz,
                           energie=energie, satz=satz, upgrade=upgrade or [])
        return f
    return deko


MONO_BASS = {"art": "note", "noten": [40]}
MONO_LEAD = {"art": "note", "noten": [57]}
AKKORD = {"art": "akkord", "noten": [57, 61, 64, 69]}
AKKORD_TIEF = {"art": "akkord", "noten": [45, 49, 52, 57]}
DRUM = {"art": "note", "noten": [60]}

# ---------------------------------------------------------------------------------------------------------------- bass


@rezept("bass.sub", "exact", None,
        ["The card asks for a sine-FM carrier because it assumed no free-running sine; the kit's `sinus` block is one, so the sine is used directly.",
         "Saturation sits before the low-pass so its harmonics are filtered with the rest."],
        MONO_BASS, ["drop", "breakdown"], 4, "Clean mono sub: sine plus a quiet triangle an octave up under a 12 dB low-pass that tracks the note.")
def bass_sub(p):
    tone = p.knob_log(1, "Tone", 2.2, 1.45)
    obere = p.knob_lin(2, "Upper octave", 0.35, 0.35)
    drive = p.knob_lin(3, "Drive", 0, 6)
    dec = p.knob_log(4, "Decay", 0.5, 2.5)
    rel = p.knob_log(5, "Release", 0.08, 2.5)
    sinus = p.osc("sinus", "note.hz", id="sine")
    tri = p.osc("dreieck", p.mul("note.hz", 2, id="okt"), id="tri")
    mix = p.add(sinus, p.mul(tri, obere, id="tri_pegel"), id="mix")
    x = p.saett(p.mul(mix, 0.35, id="vor"), drive, id="drive")
    x = p.svf(x, p.mul("note.hz", tone, id="cutoff"), 0, id="filter")
    x = p.vca(x, p.env(0.001, dec, 0.85, rel, id="env"))
    s = limiter(p, mono(x), decke=-1)
    ausgang(p, s, 1.0)


@rezept("bass.reese", "exact", None,
        ["Two detuned saws are one wavetable node with 2 unison copies at +-38 cent, so the patch costs one voice.",
         "Chorus 'on the mids only': the signal is split at 150 Hz, the lows stay mono and dry, the rest goes through the chorus.",
         "'Short hall on the highs': the hall's low-band decay factor is 0.3, so lows die fast in the tail.",
         "The card's multiband compressor is a single-band compressor (no multiband block)."],
        MONO_BASS, ["drop"], 5, "Dark DnB reese: two saws detuned +-38 cent, tube drive and a slowly moving notch, legato with glide.")
def bass_reese(p):
    cut = p.knob_log(1, "Cutoff", 600, 2.4)
    det = p.knob_lin(2, "Detune", 38, 12)
    rate = p.knob_log(3, "Notch rate", 0.15, 3)
    drive = p.knob_lin(4, "Drive", 6, 6)
    sub = p.knob_lin(5, "Sub", 0.4, 0.4)
    hmix = p.knob_lin(6, "Hall mix", 0.12, 0.12)
    hz = p.glide(0.05)
    drift = p.lfo(0.07, id="drift")
    verst = p.add(det, p.mul(drift, 3, id="drift_c"), id="verst")
    osz = p.wt(0, 2, hz, verst=verst, trig=None, id="saws")
    x = p.svf(f"{osz}.aus", cut, 0.1, pole=4, id="lp")
    x = p.add(x, p.mul(p.osc("sinus", p.mul(hz, 0.5, id="sub_hz"), id="sub"), sub, id="sub_pegel"), id="mit_sub")
    x = p.mul(p.vca(x, p.env(0.002, 0.7, 0.9, 0.15, trig=None, id="env")), 0.6, id="vor_tube")
    x = p.roehre(x, drive, id="tube")
    notch_lfo = p.lfo(rate, id="notch_lfo")
    p.svf(x, p.tr(500, st=p.mul(notch_lfo, 7, id="notch_st"), id="notch_hz"), 0.3, aus=None, id="notch")
    x = p.add("notch.tp", "notch.hp", id="notch_aus")
    tief = p.svf(x, 150, 0, aus="tp", id="tief")
    hoch = p.svf(x, 150, 0, aus="hp", id="hoch")
    s = chorus(p, mono(hoch))
    p.node("komp", "komp", ratio=4, schwelle=-20)
    p.edge(tief, "komp.x")
    p.edge(s[1], "komp.l")
    p.edge(s[2], "komp.r")
    s = hall(p, ("s", "komp.l", "komp.r"), hmix, decay=0.6, groesse=25, tief=0.3, hoch=1.0)
    ausgang(p, s, 1.0)


def acid_kern(p, okt):
    """Welsh Acid Bass [B1] p. 95: pulse 25 % +10 c over a square -2 oct -10 c, ladder 450 Hz / 60 %, no filter env"""
    cut = p.knob_log(1, "Cutoff", 450, 3)
    res = p.knob_lin(2, "Resonance", 0.6, 0.4)
    lfo_t = p.knob_lin(3, "Cutoff LFO", 0, 12)
    hz = p.glide(0.08)
    if okt:
        hz = p.mul(hz, 2 ** okt, id="lift")
    sq = p.osc("puls", p.tr(hz, cent=-10, id="ton_sq"), pwm=0, id="square")
    pu = p.osc("puls", p.tr(hz, st=24, cent=10, id="ton_pu"), pwm=pw(0.25), id="pulse25")
    mix = p.add(sq, p.mul(pu, 0.7, id="pulse_pegel"), id="mix")
    x = p.svf(p.mul(mix, 0.5, id="vor"), 20, 0, aus="hp", id="dc_osz")
    lfo = p.lfo(0.3, id="lfo")
    x = p.ladder(x, p.tr(cut, st=p.mul(lfo, lfo_t, id="lfo_st"), id="cutoff"), res, id="filter")
    return p.vca(x, p.env(0.001, 0.45, 0.15, 0.26, id="env"))


@rezept("bass.acid", "exact", None,
        ["Welsh writes the square at -2 oct under the pulse; here the square sits on the played note and the pulse two octaves above it.",
         "Knob 3 is the card's substitute for hand automation: a 0.3 Hz LFO on the cutoff, off at the midpoint (+-12 st at the ends)."],
        MONO_BASS, ["drop", "build"], 5, "Squelchy acid bass: square plus 25 % pulse into a 24 dB ladder at 450 Hz with 60 % resonance, drive and slide.")
def bass_acid(p):
    x = acid_kern(p, 0)
    drive = p.knob_lin(4, "Drive", 6, 6)
    x = p.saett(x, drive, id="drive")
    dmix = p.knob_lin(5, "Delay mix", 0.12, 0.12)
    hmix = p.knob_lin(6, "Hall mix", 0.1, 0.1)
    s = delay(p, mono(x), dmix, takt=0.25, fb=0.3)
    s = hall(p, s, hmix, decay=1.0, groesse=30)
    ausgang(p, s, 1.0)


def fm_op(p, traeger_hz, mod_hz, mod_aus, index, env, id):
    """modulation in Hz for linear FM: mod_aus * mod_hz * index * env"""
    tiefe = p.mul(mod_hz, index, id=f"{id}_tiefe")
    return p.mul(p.mul(mod_aus, tiefe, id=f"{id}_roh"), env, id=id)


@rezept("bass.fm", "approximated", "fm",
        ["Three operators from `sinus` blocks with linear FM (the card assumed one FM pair; the kit can stack sines).",
         "Cann's operator levels (mod level 60) have no defined index; both modulators run at index 1.5 at the knob midpoint, my choice.",
         "Pitches keep the card's intervals with op 3 (the lowest sounding operator) on the played note: op 1 +12 st, op 2 -7 st."],
        MONO_BASS, ["drop", "groove"], 4, "Punchy FM bass: three sine operators sharing one 2 s exponential decay, so the brightness falls with the note.",
        upgrade=["fm"])
def bass_fm(p):
    idx = p.knob_log(1, "FM depth", 1.5, 3)
    dec = p.knob_log(2, "Decay", 2, 4)
    op3_pegel = p.knob_lin(3, "Op 3 level", 1, 1)
    drive = p.knob_lin(4, "Drive", 4, 4)
    env = p.env(0.001, dec, 0, 0.3, id="env")
    hz3 = "note.hz"
    hz1 = p.mul("note.hz", 2, id="hz_op1")
    hz2 = p.tr("note.hz", st=-7, id="hz_op2")
    op2 = p.osc("sinus", hz2, id="op2")
    op3 = p.osc("sinus", hz3, id="op3")
    m = p.add(fm_op(p, hz1, hz2, op2, idx, env, "fm2"), fm_op(p, hz1, hz3, op3, idx, env, "fm3"), id="fm")
    op1 = p.osc("sinus", hz1, fm=m, id="op1")
    x = p.mul(p.add(op1, p.mul(op3, op3_pegel, id="op3_pegel"), id="ops"), 0.5, id="ops_halb")
    x = p.vca(x, env)
    x = p.svf(x, 30, 0, aus="hp", id="hp30")
    x = p.saett(x, drive, id="drive")
    s = komp(p, mono(x), ratio=4, schwelle=-18)
    ausgang(p, s, 1.0)


@rezept("bass.wobble", "approximated", None,
        ["The card's compressor is sidechained to the kick; a patch has no kick, so the compressor runs without a key.",
         "The wobble is a beat-synced LFO (1/8 note, `takt` 0.5) between 200 Hz and 2.5 kHz; the sync division is a fixed value, not a knob.",
         "The saws are one wavetable node with 3 copies at +-8 cent; the clean sine sub joins after the filter."],
        MONO_BASS, ["drop"], 5, "Dubstep wobble: detuned saws under a resonant ladder swept by a tempo-synced LFO, with a clean sine sub.")
def bass_wobble(p):
    tiefe = p.knob_lin(1, "Wobble depth", 21.9, 21.9)
    res = p.knob_lin(2, "Resonance", 0.4, 0.2)
    det = p.knob_lin(3, "Detune", 8, 8)
    sub = p.knob_lin(4, "Sub", 0.5, 0.5)
    bits = p.knob_lin(5, "Crush bits", 11, 5)
    room = p.knob_lin(6, "Room mix", 0.1, 0.1)
    hz = p.glide(0.04)
    osz = p.wt(0, 3, hz, verst=det, id="saws")
    wob = p.lfo(1, id="wobble", takt=0.5)
    reso_lfo = p.lfo(0.37, id="reso_lfo")
    x = p.ladder(p.mul(f"{osz}.aus", 0.5, id="vor"), p.tr(707, st=p.mul(wob, tiefe, id="wob_st"), id="cutoff"),
                 p.add(res, p.mul(reso_lfo, 0.08, id="reso_mod"), id="reso"), id="filter")
    x = p.add(x, p.mul(p.osc("sinus", hz, id="sub"), sub, id="sub_pegel"), id="mit_sub")
    x = p.vca(x, p.env(0.001, 0.2, 1, 0.1, id="env"))
    x = p.krume(x, bits, rate=24000, id="crush")
    x = p.svf(x, 30, 0, aus="hp", id="eq_hp")
    s = komp(p, mono(x), ratio=4, schwelle=-18)
    s = hall(p, s, room, decay=0.4, groesse=15)
    ausgang(p, s, 1.0)


@rezept("bass.analog", "exact", None,
        ["Detroit Bass variant [B1] p. 96: saw on the played note, square an octave above, ladder fully open, AR envelope, glide 10 ms.",
         "The chorus mix knob is the FX-bus send: dry plus wet, so the dry weight survives.",
         "The cutoff knob reaches 20 kHz at its midpoint (the card's open filter); above the midpoint the ladder is clamped at 0.45 sr."],
        MONO_BASS, ["groove", "drop"], 4, "Warm analog bass: saw and square an octave apart, open ladder, AR envelope, drive, compression and a light chorus.")
def bass_analog(p):
    cut = p.knob_log(1, "Cutoff", 20000, 20)
    drive = p.knob_lin(2, "Drive", 6, 6)
    rel = p.knob_log(3, "Release", 0.005, 4)
    ch = p.knob_lin(4, "Chorus mix", 0.3, 0.3)
    hz = p.glide(0.01)
    x = p.add(p.osc("saege", hz, id="saw"), p.osc("puls", p.mul(hz, 2, id="okt"), pwm=0, id="square"), id="mix")
    x = p.ladder(p.mul(x, 0.4, id="vor"), cut, 0, id="filter")
    x = p.vca(x, p.env(0.001, 10, 1, rel, id="env"))
    x = p.saett(x, drive, id="drive")
    s = komp(p, mono(x), ratio=4, schwelle=-18)
    s = hochpass(p, s, 25, id="eq_hp")
    l = p.add(s[1], s[2], id="mono")
    s = chorus(p, mono(l), mix=ch)
    ausgang(p, s, 1.0)


@rezept("bass.rolling", "approximated", None,
        ["The kick sidechain (ratio 9:1, attack 5 ms, release 200 ms) is a plain compressor with those times: a patch has no kick input.",
         "'A quarter open' is 25 % on Welsh's scale (113 Hz) and 'D quarter' is 0.18 s; 'moderate' env amount is 40 % (48 st).",
         "The two detuned saws are one wavetable node (2 copies, +-6 cent) an octave above a sine sub on the played note."],
        MONO_BASS, ["groove", "drop"], 4, "Rolling 16th-note bass: detuned saws an octave over a sine sub, plucked by a fast filter envelope, ends before the next 16th.")
def bass_rolling(p):
    cut = p.knob_log(1, "Cutoff", 113, 2.8)
    res = p.knob_lin(2, "Resonance", 0.3, 0.3)
    amt = p.knob_lin(3, "Env amount", 48, 48)
    dec = p.knob_log(4, "Decay", 0.3, 2.5)
    sub = p.knob_lin(5, "Sub", 0.5, 0.5)
    hz = p.glide(0.015)
    osz = p.wt(0, 2, p.mul(hz, 2, id="okt"), verst=6, id="saws")
    fenv = p.env(0.001, 0.18, 0, 0.02, id="fenv")
    x = p.ladder(p.mul(f"{osz}.aus", 0.5, id="vor"), filter_env_cutoff(p, cut, fenv, amt), res, id="filter")
    x = p.add(x, p.mul(p.osc("sinus", hz, id="sub"), sub, id="sub_pegel"), id="mit_sub")
    x = p.vca(x, p.env(0.001, dec, 0, 0.05, id="env"))
    x = p.saett(x, 4, id="drive")
    s = komp(p, mono(x), ratio=9, attack=5, release=200, schwelle=-24)
    s = hochpass(p, s, 30, id="eq_hp")
    ausgang(p, s, 1.0)


@rezept("bass.pluck", "exact", None,
        ["Unison saws: one wavetable node with 4 copies at +-12 cent (one voice).",
         "Resonance 50 %, env amount 85 % and amp decay 0.29 s from the parallel Welsh Funk Bass table the card cites."],
        MONO_BASS, ["groove"], 4, "Tight plucked bass: unison saws through a ladder opened by a short, deep filter envelope, no sustain.")
def bass_pluck(p):
    cut = p.knob_log(1, "Cutoff", 113, 2.8)
    res = p.knob_lin(2, "Resonance", 0.5, 0.3)
    amt = p.knob_lin(3, "Env amount", 102, 51)
    dec = p.knob_log(4, "Decay", 0.29, 2.4)
    dmix = p.knob_lin(5, "Delay mix", 0.12, 0.12)
    osz = p.wt(0, 4, "note.hz", verst=12, id="saws")
    fenv = p.env(0.001, 0.12, 0, 0.02, id="fenv")
    x = p.ladder(p.mul(f"{osz}.aus", 0.5, id="vor"), filter_env_cutoff(p, cut, fenv, amt), res, id="filter")
    x = p.vca(x, p.env(0.001, dec, 0, 0.05, id="env"))
    x = p.saett(x, 4, id="drive")
    x = p.svf(x, 35, 0, aus="hp", id="eq_hp")
    s = delay(p, mono(x), dmix, takt=0.25, fb=0.25)
    s = komp(p, s, ratio=4, schwelle=-18)
    ausgang(p, s, 1.0)


# ---------------------------------------------------------------------------------------------------------------- lead


@rezept("lead.mono", "exact", None,
        ["The two squares at -10/+10 cent are one wavetable node (`rechteck` at width 50 %, 2 copies, +-10 cent)."],
        MONO_LEAD, ["drop", "melody"], 3, "Mellow 70s mono lead: two squares 10 cent apart, open filter, fast 20 ms glide, overdrive, eighth delay and short hall.")
def lead_mono(p):
    cut = p.knob_log(1, "Cutoff", 20000, 20)
    drive = p.knob_lin(2, "Drive", 6, 6)
    rel = p.knob_log(3, "Release", 0.35, 3)
    dmix = p.knob_lin(4, "Delay mix", 0.15, 0.15)
    hmix = p.knob_lin(5, "Hall mix", 0.2, 0.2)
    hz = p.glide(0.02)
    osz = p.wt(1, 2, hz, verst=10, id="squares")
    x = p.ladder(p.mul(f"{osz}.aus", 0.5, id="vor"), cut, 0, id="filter")
    x = p.vca(x, p.env(0.001, 10, 1, rel, id="env"))
    x = p.saett(x, drive, id="drive")
    s = delay(p, mono(x), dmix, takt=0.5, fb=0.3)
    s = hall(p, s, hmix, decay=1.2, groesse=25)
    ausgang(p, s, 1.0)


@rezept("lead.poly", "exact", None,
        ["Brass Section [B1] p. 91: the 100 % filter envelope (120 st) opens the 40 Hz ladder fully in 30 ms and holds it open.",
         "PWM depth 45 % is read as a pulse-width swing of +-20 % (pwm input 0.45)."],
        AKKORD, ["melody", "breakdown"], 3, "Brassy poly lead: two pulse waves with 5.5 Hz PWM, a fast-opening ladder, chorus, eighth delay and hall.")
def lead_poly(p):
    cut = p.knob_log(1, "Cutoff", 40, 4)
    amt = p.knob_lin(2, "Env amount", 120, 60)
    pwm = p.knob_lin(3, "PWM depth", 0.45, 0.45)
    dmix = p.knob_lin(4, "Delay mix", 0.15, 0.15)
    hmix = p.knob_lin(5, "Hall mix", 0.2, 0.2)
    lfo = p.mul(p.lfo(5.5, form=1, id="pwm_lfo"), pwm, id="pwm")
    o1 = p.osc("puls", p.tr("note.hz", cent=-10, id="ton1"), pwm=lfo, id="pulse1")
    o2 = p.osc("puls", p.tr("note.hz", st=12, cent=10, id="ton2"), pwm=p.add(lfo, pw(0.2), id="pwm2"), id="pulse2")
    x = p.svf(p.mul(p.add(o1, o2, id="mix"), 0.4, id="vor"), 20, 0, aus="hp", id="dc_osz")
    fenv = p.env(0.03, 10, 1, 0.6, id="fenv")
    x = p.ladder(x, filter_env_cutoff(p, cut, fenv, amt), 0, id="filter")
    x = p.vca(x, p.env(0.001, 10, 1, 0.35, id="env"))
    s = chorus(p, mono(x))
    s = delay(p, s, dmix, takt=0.5, fb=0.3)
    s = hall(p, s, hmix, decay=2.0)
    ausgang(p, s, 1.0)


@rezept("lead.supersaw", "exact", None,
        ["The card's voice problem is gone: 7 detuned saws are one wavetable node (7 copies), so a note costs one voice and 8 notes fit.",
         "'As far apart as possible without separating' is 25 cent for the outermost copy at the knob midpoint (my choice).",
         "Gate after the hall (threshold -40 dBFS) cuts the tail; the optional parallel compression is left out."],
        AKKORD, ["drop", "build"], 5, "Trance supersaw: seven detuned saws in one voice, spread wide, hall with pre-delay, gated tail and a short delay.")
def lead_supersaw(p):
    det = p.knob_lin(1, "Detune", 25, 25)
    breite = p.knob_lin(2, "Width", 0.7, 0.3)
    cut = p.knob_log(3, "Cutoff", 20000, 20)
    hmix = p.knob_lin(4, "Hall mix", 0.3, 0.3)
    dmix = p.knob_lin(5, "Delay mix", 0.12, 0.12)
    osz = p.wt(0, 7, "note.hz", verst=det, breite=breite, id="saws")
    env = p.env(0.005, 0.3, 0.6, 0.4, id="env")
    s = ("s", p.svf(f"{osz}.l", cut, 0, id="filter_l"), p.svf(f"{osz}.r", cut, 0, id="filter_r"))
    s = ("s", p.vca(s[1], env), p.vca(s[2], env))
    s = hall(p, s, hmix, decay=2.5, pre=40)
    s = gate(p, s, schwelle=-40, release=80)
    s = delay(p, s, dmix, takt=0.5, fb=0.25)
    ausgang(p, s, 1.0)


@rezept("lead.acid", "exact", None,
        ["The acid bass patch with every oscillator one octave up (the card's derived lift); tube drive instead of the bass's tanh drive."],
        MONO_LEAD, ["build", "drop"], 5, "Acid lead: the 303-style acid bass lifted an octave, 60 % resonance, tube drive and a dotted 16th delay.")
def lead_acid(p):
    x = acid_kern(p, 1)
    drive = p.knob_lin(4, "Drive", 6, 6)
    x = p.roehre(x, drive, id="tube")
    dmix = p.knob_lin(5, "Delay mix", 0.15, 0.15)
    hmix = p.knob_lin(6, "Hall mix", 0.1, 0.1)
    s = delay(p, mono(x), dmix, takt=0.375, fb=0.3)
    s = hall(p, s, hmix, decay=1.0, groesse=30)
    ausgang(p, s, 1.0)


@rezept("lead.sync", "exact", None,
        ["The card says hard sync is missing; the kit's oscillators have had a `sync` input since slice 1 (`zyklus` of a master into `sync`), so the patch uses it.",
         "That sync smooths only the half of the step after the reset, so a fast sync sweep aliases; a band-limited sync oscillator would remove it.",
         "Unison is a second master/slave pair 8 cent up. The card gives no osc 2 offset; +7 st at the knob midpoint is my choice (an integer ratio would hide the sync)."],
        MONO_LEAD, ["drop", "melody"], 5, "Screaming sync lead: a square hard-synced to a silent master, tuned up, with slow 4.5 cent vibrato and light drive.",
        upgrade=["hard_sync"])
def lead_sync(p):
    syn = p.knob_lin(1, "Sync pitch", 7, 7)
    cut = p.knob_log(2, "Cutoff", 20000, 20)
    drive = p.knob_lin(3, "Drive", 3, 3)
    dmix = p.knob_lin(4, "Delay mix", 0.15, 0.15)
    hmix = p.knob_lin(5, "Hall mix", 0.2, 0.2)
    hz = p.glide(0.02)
    vib = p.mul(p.lfo(0.66, form=1, id="vib_lfo"), 4.5, id="vib")
    stimmen = []
    for i, cent in ((1, 0), (2, 8)):
        mhz = p.tr(hz, cent=cent, id=f"master_hz{i}") if cent else hz
        p.osc("saege", mhz, id=f"master{i}")
        stimmen.append(p.osc("puls", p.tr(mhz, st=syn, cent=vib, id=f"slave_hz{i}"), pwm=0, sync=f"master{i}.zyklus", id=f"slave{i}"))
    x = p.ladder(p.mul(p.add(*stimmen, id="mix"), 0.3, id="vor"), cut, 0, id="filter")
    x = p.vca(x, p.env(0.001, 10, 1, 0.6, id="env"))
    x = p.saett(x, drive, id="drive")
    s = delay(p, mono(x), dmix, takt=0.5, fb=0.3)
    s = hall(p, s, hmix, decay=1.5)
    ausgang(p, s, 1.0)


@rezept("lead.fm", "exact", None,
        ["Carrier on the played note, modulator at 1:2. Index 1 at sustain plus an attack envelope adding 3 (the bite), scaled by velocity.",
         "Amp envelope A 5 ms, D 1.2 s, S 45 %, R 0.3 s inside the card's ranges; optional 12 dB low-pass at 9 kHz included."],
        AKKORD, ["melody", "breakdown"], 3, "Digital FM lead: sine carrier with a 1:2 modulator whose index jumps at the attack and settles, velocity sets the bite.",
        upgrade=["fm"])
def lead_fm(p):
    idx = p.knob_log(1, "Index", 1, 4)
    biss = p.knob_lin(2, "Bite", 3, 3)
    dec = p.knob_log(3, "Decay", 1.2, 2.5)
    dmix = p.knob_lin(4, "Delay mix", 0.15, 0.15)
    hmix = p.knob_lin(5, "Hall mix", 0.2, 0.2)
    menv = p.env(0.001, 0.3, 0, 0.3, id="mod_env")
    index = p.add(idx, p.mul(p.mul(menv, biss, id="biss_env"), "note.vel", id="biss_vel"), id="index")
    mhz = p.mul("note.hz", 2, id="mod_hz")
    mod = p.osc("sinus", mhz, id="mod")
    fm = p.mul(mod, p.mul(mhz, index, id="fm_tiefe"), id="fm")
    x = p.osc("sinus", "note.hz", fm=fm, id="carrier")
    x = p.svf(x, 9000, 0, id="lp")
    x = p.vca(x, p.env(0.005, dec, 0.45, 0.3, id="env"))
    s = chorus(p, mono(x), mix=0.5)
    s = delay(p, s, dmix, takt=0.5, fb=0.3)
    s = hall(p, s, hmix, decay=1.8)
    ausgang(p, s, 1.0)


@rezept("lead.arp", "exact", None,
        ["The kit has no arpeggiator: the notes must come from the host, as the card says. The sound is complete.",
         "Saw plus 30 % pulse 7 cent up; filter envelope D 0.12 s; 24 dB high-pass at 300 Hz (the card gives no slope); delay damped at 3 kHz ('filtered')."],
        AKKORD, ["build", "groove"], 4, "Bright arp lead: saw and pulse with a short filter blip, high-passed off the bass, tempo-synced 16th delay.")
def lead_arp(p):
    cut = p.knob_log(1, "Cutoff", 900, 3)
    amt = p.knob_lin(2, "Env amount", 36, 36)
    hp = p.knob_log(3, "High-pass", 300, 3)
    dmix = p.knob_lin(4, "Delay mix", 0.25, 0.25)
    hmix = p.knob_lin(5, "Hall mix", 0.12, 0.12)
    x = p.add(p.osc("saege", "note.hz", id="saw"), p.osc("puls", p.tr("note.hz", cent=7, id="ton_pu"), pwm=pw(0.3), id="pulse"), id="mix")
    x = p.svf(p.mul(x, 0.5, id="vor"), 20, 0, aus="hp", id="dc_osz")
    fenv = p.env(0.001, 0.12, 0, 0.05, id="fenv")
    x = p.ladder(x, filter_env_cutoff(p, cut, fenv, amt), 0.2, id="filter")
    x = p.svf(x, hp, 0, pole=4, aus="hp", id="highpass")
    x = p.vca(x, p.env(0.001, 0.15, 0.15, 0.08, id="env"))
    s = delay(p, mono(x), dmix, takt=0.25, fb=0.35, daempf=3000)
    s = hall(p, s, hmix, decay=1.0)
    ausgang(p, s, 1.0)


# ----------------------------------------------------------------------------------------------------------------- pad


@rezept("pad.strings", "exact", None,
        ["Triangle plus a square detuned 4 cent; the 'second layer detuned further' is a wavetable square with 3 copies at +-12 cent.",
         "Pitch LFO 0.4 Hz, 8 cent on the square; cutoff LFO 0.15 Hz, +-3 st; filter envelope A 0.8 s, D 0.6 s, S 70 %, R 0.6 s.",
         "The optional sidechain compression from a rhythmic element is left out (no key source in a patch)."],
        AKKORD, ["breakdown", "intro"], 2, "String section: triangle and detuned squares under a mid-resonance ladder that opens slowly after the bow, chorus, phaser, hall.")
def pad_strings(p):
    cut = p.knob_log(1, "Cutoff", 900, 3)
    res = p.knob_lin(2, "Resonance", 0.5, 0.3)
    amt = p.knob_lin(3, "Env amount", 24, 24)
    fatt = p.knob_log(4, "Filter attack", 0.8, 4)
    hmix = p.knob_lin(5, "Hall mix", 0.3, 0.3)
    vib = p.mul(p.lfo(0.4, id="vib_lfo"), 8, id="vib")
    tri = p.osc("dreieck", "note.hz", id="tri")
    sq = p.osc("puls", p.tr("note.hz", cent=p.add(vib, 4, id="sq_cent"), id="ton_sq"), pwm=0, id="square")
    sek = p.wt(1, 3, "note.hz", verst=12, id="section")
    x = p.mul(p.summe(tri, p.mul(sq, 0.7, id="sq_pegel"), p.mul(f"{sek}.aus", 0.7, id="sek_pegel"), id="mix"), 0.35, id="vor")
    fenv = p.env(fatt, 0.6, 0.7, 0.6, id="fenv")
    clfo = p.mul(p.lfo(0.15, id="cut_lfo"), 3, id="cut_mod")
    x = p.ladder(x, p.tr(filter_env_cutoff(p, cut, fenv, amt), st=clfo, id="cutoff"), res, id="filter")
    x = p.vca(x, p.env(0.01, 1, 0.7, 0.7, id="env"))
    s = chorus(p, mono(x))
    s = phaser(p, s, 0.2, rate=0.3)
    s = hall(p, s, hmix, decay=2.5)
    ausgang(p, s, 1.0)


@rezept("pad.choir", "approximated", None,
        ["Welsh Choir exact: pulses at 15 % and 25 % (the second -2 oct), 24 dB ladder at 1.7 kHz, A 0.32 / R 0.93 s, 2.4 Hz 20 cent vibrato.",
         "Each pulse is a wavetable `rechteck` with 3 copies at +-6 cent, the card's 'pitch scatter per voice for a section'.",
         "Vowel: three SVF band-passes at 640 / 1200 / 2400 Hz (the card's last formant set) crossfade with the low-pass (knob 2); one fixed vowel, no vowel morph.",
         "The EQ cut 1-3 kHz is not built (no bell EQ block)."],
        AKKORD, ["breakdown", "intro"], 2, "Synth choir: two scattered pulse layers with slow vibrato and swell, a formant band-pass bank, strong chorus and long hall.")
def pad_choir(p):
    cut = p.knob_log(1, "Cutoff", 1700, 2.8)
    vokal = p.knob(2, "Vowel", 0, 1, id="k_vowel")
    trocken = inverse_knob(p, 2, "Vowel", 0, 1, id="k_vowel_inv")
    att = p.knob_log(3, "Attack", 0.32, 4)
    rel = p.knob_log(4, "Release", 0.93, 3)
    hmix = p.knob_lin(5, "Hall mix", 0.35, 0.35)
    vib = p.mul(p.lfo(2.4, form=1, id="vib_lfo"), 20, id="vib")
    hz = p.tr("note.hz", cent=vib, id="ton")
    a = p.wt(1, 3, hz, verst=6, pos=wt_pw(0.15), id="pulse15")
    b = p.wt(1, 3, p.mul(hz, 0.25, id="tief_hz"), verst=6, pos=wt_pw(0.25), id="pulse25")
    x = p.mul(p.add(f"{a}.aus", f"{b}.aus", id="mix"), 0.4, id="vor")
    lp = p.ladder(x, cut, 0, id="filter")
    formant = p.summe(*[p.mul(p.svf(x, f, 0.6, aus="bp", id=f"f{i}"), g, id=f"f{i}_pegel")
                         for i, (f, g) in enumerate(((640, 1.0), (1200, 0.6), (2400, 0.4)), 1)], id="formanten")
    x = p.add(p.mul(lp, trocken, id="lp_anteil"), p.mul(p.mul(formant, 2.0, id="formant_gain"), vokal, id="formant_anteil"), id="stimme")
    x = p.vca(x, p.env(att, 10, 1, rel, id="env"))
    s = chorus(p, mono(x), modus=2)
    s = hall(p, s, hmix, decay=4, pre=45)
    ausgang(p, s, 1.0)


@rezept("pad.atmosphere", "exact", None,
        ["Celestial Wash [B1] p. 99: noise into a self-oscillating ladder (resonance 100 %), the 5.5 Hz square LFO switches the resonance 0..1.",
         "Keyboard tracking on: cutoff = 3.82 x note frequency (1 kHz at C4)."],
        AKKORD, ["intro", "breakdown"], 1, "Celestial wash: noise rings a self-oscillating, key-tracked ladder pulsed at 5.5 Hz, slow swell, very long hall.")
def pad_atmosphere(p):
    trk = p.knob_log(1, "Tracking", 3.82, 2.8)
    tiefe = p.knob(2, "Ring depth", 0, 1, id="k_ring")
    rest = inverse_knob(p, 2, "Ring depth", 0, 1, id="k_ring_inv")
    att = p.knob_log(3, "Attack", 1.65, 4)
    hmix = p.knob_lin(4, "Hall mix", 0.4, 0.4)
    dmix = p.knob_lin(5, "Delay mix", 0.2, 0.2)
    sq = p.lfo(5.5, form=3, id="ring_lfo")
    reso = p.add(p.mul(sq, tiefe, id="ring_mod"), rest, id="reso")
    x = p.ladder(p.mul(p.rauschen(id="noise"), 0.5, id="vor"), p.mul("note.hz", trk, id="cutoff"), reso, id="filter")
    x = p.vca(x, p.env(att, 5.85, 0, 4.4, id="env"))
    s = hall(p, mono(x), hmix, decay=7)
    s = delay(p, s, dmix, takt=1, fb=0.2)
    s = hochpass(p, s, 150, id="eq_hp")
    ausgang(p, s, 1.0)


@rezept("pad.analog", "exact", None,
        ["Galactic Cathedral [B1] p. 101: squares at -11 cent and +2 oct +11 cent, ladder 1.2 kHz / 60 %, 0.3 Hz LFO on the cutoff, R 2.25 s.",
         "LFO depth 10 % is read as +-6 st (one octave peak to peak). The Galactic Chapel amplitude LFO (17 %) is left out."],
        AKKORD, ["breakdown", "intro"], 2, "Analog pad: two squares two octaves apart under a resonant ladder that breathes at 0.3 Hz, long release, chorus, phaser, hall.")
def pad_analog(p):
    cut = p.knob_log(1, "Cutoff", 1200, 3)
    res = p.knob_lin(2, "Resonance", 0.6, 0.3)
    lfo_t = p.knob_lin(3, "LFO depth", 6, 6)
    rel = p.knob_log(4, "Release", 2.25, 4)
    hmix = p.knob_lin(5, "Hall mix", 0.35, 0.35)
    o1 = p.osc("puls", p.tr("note.hz", cent=-11, id="ton1"), pwm=0, id="square1")
    o2 = p.osc("puls", p.tr("note.hz", st=24, cent=11, id="ton2"), pwm=0, id="square2")
    lfo = p.lfo(0.3, id="cut_lfo")
    x = p.ladder(p.mul(p.add(o1, o2, id="mix"), 0.35, id="vor"), p.tr(cut, st=p.mul(lfo, lfo_t, id="lfo_st"), id="cutoff"), res, id="filter")
    x = p.vca(x, p.env(0.005, 10, 1, rel, id="env"))
    s = chorus(p, mono(x))
    s = phaser(p, s, 0.25, rate=0.15)
    s = hall(p, s, hmix, decay=4)
    ausgang(p, s, 1.0)


@rezept("pad.granular", "blocked", "granular",
        ["Stand-in, not a granular pad: the kit has no grain engine. A wavetable (`analog`, 4 frames) with 5 copies stands in for the grain cloud.",
         "'Grain position' is the wavetable position, moved by a 0.07 Hz LFO plus a random LFO (S&H, 3 Hz) smoothed over 80 ms; grain size has no equivalent.",
         "Low-pass 3.8 kHz after the source, amp A 1 s / S 90 % / R 2.5 s, hall (very long) then chorus, as on the card."],
        AKKORD, ["intro", "breakdown"], 1, "Stand-in for a granular pad: a slowly scanned, randomly jittered wavetable cloud with long hall and chorus.",
        upgrade=["granular"])
def pad_granular(p):
    pos = p.knob_lin(1, "Position", 0.4, 0.4)
    bew = p.knob_lin(2, "Motion", 0.25, 0.25)
    cut = p.knob_log(3, "Cutoff", 3800, 2.5)
    hmix = p.knob_lin(4, "Hall mix", 0.45, 0.45)
    lang = p.lfo(0.07, id="scan_lfo")
    zufall = p.node("jitter_lfo", "lfo", form=4, rate=3)
    p.node("jitter", "glatt", zeit=0.08)
    p.edge("jitter_lfo.aus", "jitter.x")
    bewegung = p.add(lang, p.mul("jitter.aus", 0.3, id="jitter_pegel"), id="bewegung")
    position = p.add(pos, p.mul(bewegung, bew, id="pos_mod"), id="position")
    osz = p.wt(4, 5, "note.hz", verst=15, breite=0.8, pos=position, glatt=40, id="cloud")
    env = p.env(1.0, 3, 0.9, 2.5, id="env")
    s = ("s", p.vca(p.svf(f"{osz}.l", cut, 0, pole=4, id="lp_l"), env), p.vca(p.svf(f"{osz}.r", cut, 0, pole=4, id="lp_r"), env))
    s = hall(p, s, hmix, decay=8)
    s = chorus(p, s)
    ausgang(p, s, 1.0)


@rezept("pad.drone", "exact", None,
        ["Portus [B1] p. 102: triangles at 0 and +1 oct, ladder 75 Hz / 70 % with env 70 % (84 st), amp A 1.5 / R 3.3 s, filter A 1.8 / R 2.9 s.",
         "Glide 1.5 s per voice (`glatt` 1.5 s): in a poly patch a voice glides from the last note it played.",
         "Optional slow filter drift added: 0.1 Hz, +-2 st."],
        AKKORD_TIEF, ["intro", "breakdown"], 1, "Dark drone bed: two triangles an octave apart under a resonant ladder that opens over two seconds, long glide and hall.")
def pad_drone(p):
    cut = p.knob_log(1, "Cutoff", 75, 3)
    res = p.knob_lin(2, "Resonance", 0.7, 0.3)
    amt = p.knob_lin(3, "Env amount", 84, 42)
    att = p.knob_log(4, "Attack", 1.5, 4)
    hmix = p.knob_lin(5, "Hall mix", 0.4, 0.4)
    hz = p.glide(1.5)
    x = p.add(p.osc("dreieck", hz, id="tri1"), p.osc("dreieck", p.mul(hz, 2, id="okt"), id="tri2"), id="mix")
    fenv = p.env(1.8, 10, 1, 2.9, id="fenv")
    drift = p.mul(p.lfo(0.1, id="drift_lfo"), 2, id="drift")
    x = p.ladder(p.mul(x, 0.4, id="vor"), p.tr(filter_env_cutoff(p, cut, fenv, amt), st=drift, id="cutoff"), res, id="filter")
    x = p.vca(x, p.env(att, 10, 1, 3.3, id="env"))
    s = hall(p, mono(x), hmix, decay=8)
    s = je_seite(p, s, lambda x, sd: p.saett(x, 2, id=f"drive{sd}"))
    s = hochpass(p, s, 30, id="eq_hp")
    ausgang(p, s, 1.0)


# ---------------------------------------------------------------------------------------------------------------- keys


@rezept("keys.piano", "approximated", "physical_string",
        ["Welsh Piano: saw 75 % plus a 15 % pulse at +1 oct +2 st hard-synced to the saw, ladder 40 Hz with env 75 % (90 st) and D 5.22 s.",
         "Velocity scales the filter envelope (the card's touch). The EQ cut at 200-400 Hz is not built (no bell EQ block).",
         "A synthesized piano: no hammer transient and no string beating, as the card says; a physical string model would add them."],
        AKKORD, ["breakdown", "groove"], 3, "Synth piano: saw and synced pulse whose filter brightness decays with the note, velocity sets the touch, short room.",
        upgrade=["physical_string"])
def keys_piano(p):
    cut = p.knob_log(1, "Cutoff", 40, 4)
    amt = p.knob_lin(2, "Env amount", 90, 45)
    dec = p.knob_log(3, "Decay", 0.67, 2.7)
    room = p.knob_lin(4, "Room mix", 0.2, 0.2)
    saw = p.osc("saege", "note.hz", id="saw")
    pu = p.osc("puls", p.tr("note.hz", st=14, id="ton_pu"), pwm=pw(0.15), sync="saw.zyklus", id="pulse")
    x = p.svf(p.mul(p.add(p.mul(saw, 0.75, id="saw_pegel"), pu, id="mix"), 0.4, id="vor"), 20, 0, aus="hp", id="dc_osz")
    fenv = p.mul(p.env(0.001, 5.22, 0, 0.5, id="fenv"), "note.vel", id="fenv_vel")
    x = p.ladder(x, filter_env_cutoff(p, cut, fenv, amt), 0, id="filter")
    x = p.vca(x, p.env(0.001, dec, 0.25, 0.5, id="env"))
    s = hall(p, mono(x), room, decay=0.6, groesse=15)
    s = komp(p, s, ratio=2, schwelle=-18)
    ausgang(p, s, 1.0)


@rezept("keys.electric_piano", "exact", None,
        ["Welsh Electric Piano: saw plus a 5 % pulse at +2 oct +9 st, synced (the kit has sync, so the card's FM substitute is not needed).",
         "Ladder 630 Hz, env 50 % (60 st) with D 0.33 s, scaled by velocity (the bark); amp D 5.14 s to silence.",
         "A tine model (FM operators or a modal resonator) would give a truer bell attack."],
        AKKORD, ["breakdown", "groove"], 2, "Electric piano: saw and synced thin pulse for the tine, velocity bark, long decay to silence, chorus, phaser, room.",
        upgrade=["fm", "modal"])
def keys_electric_piano(p):
    cut = p.knob_log(1, "Cutoff", 630, 3)
    amt = p.knob_lin(2, "Env amount", 60, 60)
    dec = p.knob_log(3, "Decay", 5.14, 3)
    room = p.knob_lin(4, "Room mix", 0.2, 0.2)
    p.osc("saege", "note.hz", id="saw")
    pu = p.osc("puls", p.tr("note.hz", st=33, id="ton_pu"), pwm=pw(0.05), sync="saw.zyklus", id="pulse")
    x = p.svf(p.mul(p.add("saw.aus", pu, id="mix"), 0.4, id="vor"), 20, 0, aus="hp", id="dc_osz")
    fenv = p.mul(p.env(0.001, 0.33, 0, 0.3, id="fenv"), "note.vel", id="fenv_vel")
    x = p.ladder(x, filter_env_cutoff(p, cut, fenv, amt), 0, id="filter")
    x = p.vca(x, p.env(0.001, dec, 0, 0.63, id="env"))
    s = chorus(p, mono(x))
    s = phaser(p, s, 0.2, rate=0.25)
    s = hall(p, s, room, decay=0.8, groesse=20)
    s = komp(p, s, ratio=2, schwelle=-18)
    ausgang(p, s, 1.0)


@rezept("keys.organ", "exact", None,
        ["Welsh Organ: triangles at 0 and -2 oct, no filter, A 0.6 s, R 0.4 s, no velocity.",
         "Rotary = chorus plus a 6.5 Hz tremolo (depth 20 % at the knob midpoint); the drawbar variant could use the `orgel` wavetable instead."],
        AKKORD, ["groove", "breakdown"], 3, "Two-triangle organ: 8' and 16' with a slow click-free attack, rotary-style chorus and tremolo, tube warmth, short room.")
def keys_organ(p):
    att = p.knob_log(1, "Attack", 0.6, 4)
    rel = p.knob_log(2, "Release", 0.4, 4)
    rot = tiefe_mod(p, p.lfo(6.5, id="rotor"), 3, "Rotary", 0.2, id="tremolo")
    drive = p.knob_lin(4, "Drive", 4, 4)
    room = p.knob_lin(5, "Room mix", 0.15, 0.15)
    x = p.add(p.osc("dreieck", "note.hz", id="tri8"), p.osc("dreieck", p.mul("note.hz", 0.25, id="tief"), id="tri16"), id="mix")
    x = p.vca(p.mul(x, 0.4, id="vor"), p.env(att, 10, 1, rel, trig=None, id="env"))
    x = p.mul(x, rot, id="trem_vca")
    s = chorus(p, mono(x), modus=2)
    s = je_seite(p, s, lambda x, sd: p.roehre(x, drive, id=f"tube{sd}"))
    s = hall(p, s, room, decay=0.7, groesse=20)
    ausgang(p, s, 1.0)


@rezept("keys.mallet", "exact", None,
        ["Glockenspiel [B1] p. 82: triangles at 0 and +2 oct +6 st, ladder 3.8 kHz with env 75 % (90 st) D 0.1 s, amp D 1.2 / R 1.2 s, no sustain.",
         "Room/plate 1.1 s, then high-pass 200 Hz, then a low 1/16 delay, as on the card."],
        AKKORD, ["melody", "breakdown"], 2, "Glockenspiel: two triangles at an inharmonic +2 oct +6 st, a bright filter tick, 1.2 s decay, plate and a soft 16th delay.",
        upgrade=["modal"])
def keys_mallet(p):
    cut = p.knob_log(1, "Cutoff", 3800, 3)
    amt = p.knob_lin(2, "Env amount", 90, 45)
    dec = p.knob_log(3, "Decay", 1.2, 3)
    hmix = p.knob_lin(4, "Hall mix", 0.2, 0.2)
    dmix = p.knob_lin(5, "Delay mix", 0.1, 0.1)
    x = p.add(p.osc("dreieck", "note.hz", id="tri1"), p.osc("dreieck", p.tr("note.hz", st=30, id="ton2"), id="tri2"), id="mix")
    fenv = p.env(0.001, 0.1, 0, 0.1, id="fenv")
    x = p.ladder(p.mul(x, 0.4, id="vor"), filter_env_cutoff(p, cut, fenv, amt), 0, id="filter")
    x = p.vca(x, p.env(0.001, dec, 0, 1.2, id="env"))
    s = hall(p, mono(x), hmix, decay=1.1, groesse=20)
    s = hochpass(p, s, 200, id="eq_hp")
    s = delay(p, s, dmix, takt=0.25, fb=0.2)
    ausgang(p, s, 1.0)


@rezept("keys.chord", "approximated", None,
        ["Trance 5th: squares on the root and +7 st, each a wavetable `rechteck` with 2 unison copies (+-10 cent); open filter, hard gated R.",
         "PWM 6 Hz / 80 %: the wavetable position swings the width 50 % -> 14 % and back (same spectrum as +-36 % around 50 %).",
         "The kick sidechain on the compressor is a plain compressor (no key in a patch)."],
        AKKORD, ["build", "drop"], 4, "Stacked fifth chord: two PWM squares a fifth apart with unison, hard gate envelope, chorus, eighth delay and short hall.")
def keys_chord(p):
    pwm = p.knob_lin(1, "PWM depth", 0.4, 0.4)
    det = p.knob_lin(2, "Detune", 10, 10)
    rel = p.knob_log(3, "Release", 0.01, 4)
    dmix = p.knob_lin(4, "Delay mix", 0.15, 0.15)
    hmix = p.knob_lin(5, "Hall mix", 0.15, 0.15)
    pos = p.mul(p.add(p.lfo(6, id="pwm_lfo"), 1, id="pwm_eins"), pwm, id="pwm_pos")
    a = p.wt(1, 2, "note.hz", verst=det, pos=pos, glatt=0, id="root")
    b = p.wt(1, 2, p.tr("note.hz", st=7, id="quinte_hz"), verst=det, pos=pos, glatt=0, id="fifth")
    x = p.mul(p.add(f"{a}.aus", f"{b}.aus", id="mix"), 0.4, id="vor")
    x = p.vca(x, p.env(0.001, 10, 1, rel, id="env"))
    s = chorus(p, mono(x))
    s = delay(p, s, dmix, takt=0.5, fb=0.3)
    s = hall(p, s, hmix, decay=1.0)
    s = komp(p, s, ratio=4, schwelle=-18)
    ausgang(p, s, 1.0)


@rezept("keys.bell", "approximated", "fm",
        ["Cann Another Bell: one modulator at 7x (C:M 1:7, decay 1 s) on three of four sine carriers (amounts 47 / 74 / 100 %), carriers at 0, -32 and +16 cent.",
         "Carrier decays 7 s, the third carrier 1.2 s ('just over 1 s'); velocity scales carrier and modulator levels.",
         "The index scale (2.5 at amount 100 %) is my choice: Cann's synth defines its own level curve, which a calibrated FM operator block would reproduce."],
        AKKORD, ["breakdown", "intro"], 2, "FM bell: four sine carriers, three rung by one 1:7 modulator that dies in a second, detuned for beating, long ring.",
        upgrade=["fm", "modal"])
def keys_bell(p):
    idx = p.knob_log(1, "Index", 1, 4)
    dec = p.knob_log(2, "Decay", 7, 3)
    hmix = p.knob_lin(3, "Hall mix", 0.3, 0.3)
    dmix = p.knob_lin(4, "Delay mix", 0.1, 0.1)
    vel = "note.vel"
    menv = p.mul(p.env(0.001, 1.0, 0, 1.0, id="mod_env"), vel, id="mod_vel")
    mhz = p.mul("note.hz", 7, id="mod_hz")
    mod = p.osc("sinus", mhz, id="mod")
    roh = p.mul(p.mul(mod, mhz, id="mod_hz_amp"), menv, id="mod_roh")
    traeger = []
    for i, (cent, menge, d) in enumerate(((0, 0.47, dec), (-32, 0.74, dec), (16, 1.0, 1.2), (0, 0, dec)), 1):
        hz = p.tr("note.hz", cent=cent, id=f"c{i}_hz") if cent else "note.hz"
        fm = p.mul(p.mul(roh, idx, id=f"c{i}_idx"), 2.5 * menge, id=f"c{i}_fm") if menge else None
        c = p.osc("sinus", hz, fm=fm, id=f"c{i}")
        traeger.append(p.vca(c, p.env(0.001, d, 0, 3, id=f"c{i}_env")))
    x = p.mul(p.mul(p.summe(*traeger, id="carriers"), vel, id="carrier_vel"), 0.25, id="vor")
    s = hall(p, mono(x), hmix, decay=3.5)
    s = delay(p, s, dmix, takt=1, fb=0.25)
    ausgang(p, s, 1.0)


# --------------------------------------------------------------------------------------------------------------- pluck


@rezept("pluck.synth", "exact", None,
        ["Cann 'Thin': a pulse of width 1/3 (every third harmonic missing, a comb-like spectrum) into a 12 dB band-pass at 2 kHz, resonance 32 %.",
         "Filter env D 91 ms, S 7/127, R 142 ms, amount 58/127 of 48 st (22 st); velocity -> cutoff 100 % is 24 st per unit velocity below full.",
         "'8-tap/gated reverb' is the hall followed by a gate."],
        AKKORD, ["groove", "build"], 4, "Thin synth pluck: a combed pulse through a resonant 2 kHz band-pass with a fast envelope, velocity on the cutoff, gated verb.")
def pluck_synth(p):
    cut = p.knob_log(1, "Cutoff", 2000, 2.8)
    res = p.knob_lin(2, "Resonance", 0.32, 0.25)
    vamt = p.knob_lin(3, "Velocity amount", 24, 24)
    dec = p.knob_log(4, "Decay", 0.3, 2.4)
    hmix = p.knob_lin(5, "Hall mix", 0.25, 0.25)
    dmix = p.knob_lin(6, "Delay mix", 0.12, 0.12)
    x = p.osc("puls", "note.hz", pwm=pw(1 / 3), id="pulse")
    x = p.svf(p.mul(x, 0.5, id="vor"), 20, 0, aus="hp", id="dc_osz")
    fenv = p.env(0.001, 0.091, 7 / 127, 0.142, id="fenv")
    vel_st = p.mul(p.add("note.vel", -1, id="vel_rel"), vamt, id="vel_st")
    st = p.add(p.mul(fenv, 22, id="fenv_st"), vel_st, id="cut_st")
    x = p.svf(x, p.tr(cut, st=st, id="cutoff"), res, aus="bp", id="bandpass")
    x = p.vca(x, p.env(0.001, dec, 0, 0.1, id="env"))
    s = chorus(p, mono(x), modus=3)
    s = hall(p, s, hmix, decay=1.5, groesse=30)
    s = gate(p, s, schwelle=-45, release=60)
    s = delay(p, s, dmix, takt=0.25, fb=0.3)
    ausgang(p, s, 1.0)


@rezept("pluck.mallet", "exact", None,
        ["Xylophone [B1] p. 84: triangles at 0 and +1 oct +10 st, ladder 300 Hz with env 60 % (72 st) and D 0.53 s, amp D 1.88 / R 1.78 s.",
         "Tremolo 7.5 Hz, depth 5 % (bar ringing)."],
        AKKORD, ["melody", "groove"], 3, "Wooden xylophone: two triangles at +1 oct +10 st, a filter envelope for the strike, 1.9 s decay with light tremolo.",
        upgrade=["modal"])
def pluck_mallet(p):
    cut = p.knob_log(1, "Cutoff", 300, 3)
    amt = p.knob_lin(2, "Env amount", 72, 36)
    dec = p.knob_log(3, "Decay", 1.88, 3)
    trem = tiefe_mod(p, p.lfo(7.5, form=1, id="trem_lfo"), 4, "Tremolo", 0.05, id="tremolo")
    room = p.knob_lin(5, "Room mix", 0.2, 0.2)
    dmix = p.knob_lin(6, "Delay mix", 0.08, 0.08)
    x = p.add(p.osc("dreieck", "note.hz", id="tri1"), p.osc("dreieck", p.tr("note.hz", st=22, id="ton2"), id="tri2"), id="mix")
    fenv = p.env(0.001, 0.53, 0, 0.3, id="fenv")
    x = p.ladder(p.mul(x, 0.4, id="vor"), filter_env_cutoff(p, cut, fenv, amt), 0, id="filter")
    x = p.vca(x, p.env(0.001, dec, 0, 1.78, id="env"))
    x = p.mul(x, trem, id="trem_vca")
    s = hall(p, mono(x), room, decay=0.6, groesse=15)
    s = delay(p, s, dmix, takt=0.25, fb=0.2)
    s = hochpass(p, s, 200, id="eq_hp")
    ausgang(p, s, 1.0)


@rezept("pluck.string", "exact", None,
        ["Guitar Acoustic [B1] p. 55: 25 % pulse master and a 10 % pulse at +10 st synced to it (the kit has sync), ladder 3.1 kHz, env 70 %.",
         "The pick: a 5 ms noise burst (the card's 'very short noise burst'); amp D 1.7 / R 1.7 s.",
         "The bell EQ cut at 300-500 Hz is not built. A physical string (Karplus-Strong) block would make the string itself."],
        AKKORD, ["melody", "groove"], 3, "Plucked string: synced pulse pair with a noise pick and a falling filter, 1.7 s decay, light chorus and room.",
        upgrade=["physical_string"])
def pluck_string(p):
    cut = p.knob_log(1, "Cutoff", 3100, 3)
    amt = p.knob_lin(2, "Env amount", 84, 42)
    dec = p.knob_log(3, "Decay", 1.7, 3)
    pick = p.knob_lin(4, "Pick noise", 0.5, 0.5)
    room = p.knob_lin(5, "Room mix", 0.2, 0.2)
    p.osc("puls", "note.hz", pwm=pw(0.25), id="master")
    sl = p.osc("puls", p.tr("note.hz", st=10, id="ton_sl"), pwm=pw(0.1), sync="master.zyklus", id="slave")
    stoss = p.mul(p.rauschen(id="noise"), p.env(0.0005, 0.005, 0, 0.003, id="pick_env"), id="pick")
    x = p.add("master.aus", sl, p.mul(stoss, pick, id="pick_pegel"), id="mix")
    x = p.svf(p.mul(x, 0.35, id="vor"), 20, 0, aus="hp", id="dc_osz")
    fenv = p.env(0.001, 0.35, 0, 0.29, id="fenv")
    x = p.ladder(x, filter_env_cutoff(p, cut, fenv, amt), 0, id="filter")
    x = p.vca(x, p.env(0.001, dec, 0, 1.7, id="env"))
    s = chorus(p, mono(x), mix=0.3)
    s = hall(p, s, room, decay=0.7, groesse=20)
    s = komp(p, s, ratio=4, attack=1, schwelle=-18)
    ausgang(p, s, 1.0)


@rezept("pluck.stab", "approximated", None,
        ["Velocity -> cutoff (24 st per unit below full velocity) and a second envelope on the resonance (+0.5, D 80 ms) as on the card.",
         "Key scaling is linear in Hz (the kit has no logarithm block): -0.03 st per Hz above C4, so upper octaves are cut away.",
         "The kick sidechain is left out (no key in a patch)."],
        AKKORD, ["drop", "build"], 4, "House stab: two detuned saws with a snappy filter, velocity brightness, resonance blip on the attack, short room.")
def pluck_stab(p):
    cut = p.knob_log(1, "Cutoff", 400, 4)
    amt = p.knob_lin(2, "Env amount", 48, 24)
    vamt = p.knob_lin(3, "Velocity amount", 24, 24)
    dec = p.knob_log(4, "Decay", 0.22, 3)
    room = p.knob_lin(5, "Room mix", 0.15, 0.15)
    dmix = p.knob_lin(6, "Delay mix", 0.1, 0.1)
    x = p.add(p.osc("saege", "note.hz", id="saw1"), p.osc("saege", p.tr("note.hz", cent=8, id="ton2"), id="saw2"), id="mix")
    fenv = p.env(0.001, 0.15, 0, 0.1, id="fenv")
    renv = p.env(0.001, 0.08, 0, 0.05, id="reso_env")
    taste = p.mul(p.add("note.hz", -261.63, id="ueber_c4"), -0.03, id="key_st")
    vel_st = p.mul(p.add("note.vel", -1, id="vel_rel"), vamt, id="vel_st")
    st = p.add(p.mul(fenv, amt, id="fenv_st"), vel_st, taste, id="cut_st")
    reso = p.add(0.2, p.mul(renv, 0.5, id="reso_mod"), id="reso")
    x = p.ladder(p.mul(x, 0.4, id="vor"), p.tr(cut, st=st, id="cutoff"), reso, id="filter")
    x = p.vca(x, p.env(0.001, dec, 0, 0.1, id="env"))
    x = p.saett(x, 3, id="drive")
    s = hall(p, mono(x), room, decay=0.6, groesse=15)
    s = delay(p, s, dmix, takt=0.5, fb=0.25)
    ausgang(p, s, 1.0)


# --------------------------------------------------------------------------------------------------------------- drums


@rezept("drums.kick", "exact", None,
        ["Drum pitch is fixed (tune knob, F2 87 Hz at the midpoint), not the played note. Pitch envelope: +24 st falling exponentially (D 50 ms).",
         "Amp A 0 / D 0.12 / S 0 / R 0.12 s (Welsh); a 4 ms noise click; saturation, compressor 4:1 with 10 ms attack, room with 90 ms pre-delay.",
         "The card's multiband EQ is not built (no EQ block)."],
        DRUM, ["drop", "groove"], 5, "Punchy kick: a sine with a fast exponential pitch drop, short body, noise click, saturation and compression.")
def drums_kick(p):
    tune = p.knob_log(1, "Tune", 87.3, 1.6)
    drop = p.knob_lin(2, "Pitch drop", 24, 24)
    dec = p.knob_log(3, "Decay", 0.12, 2.5)
    klick = p.knob_lin(4, "Click", 0.3, 0.3)
    drive = p.knob_lin(5, "Drive", 4, 4)
    room = p.knob_lin(6, "Room mix", 0.08, 0.08)
    penv = p.env(0.0005, 0.05, 0, 0.05, id="pitch_env")
    x = p.osc("sinus", p.tr(tune, st=p.mul(penv, drop, id="pitch_st"), id="pitch"), id="body")
    x = p.vca(x, p.env(0.0005, dec, 0, 0.12, id="env"))
    k = p.mul(p.mul(p.rauschen(id="noise"), p.env(0.0002, 0.004, 0, 0.004, id="click_env"), id="click_roh"), klick, id="click")
    x = p.saett(p.mul(p.add(x, k, id="mix"), 0.6, id="vor"), drive, id="drive")
    s = komp(p, mono(x), ratio=4, attack=10, schwelle=-20)
    s = hall(p, s, room, decay=0.3, pre=90, groesse=10)
    ausgang(p, s, 1.0)


@rezept("drums.snare", "exact", None,
        ["Welsh Snare: triangle body (fixed 180 Hz, tune knob) at a fifth of the noise level, noise dominates; body D 0.27 s, noise D 0.12 s.",
         "Body pitch drops 3 st over about 30 ms (the card's derived drum-machine fix). The EQ cut at 200-400 Hz is not built."],
        DRUM, ["drop", "groove"], 5, "Snare: noise-dominated rattle with a short triangle body and a small pitch drop, light saturation, room and compressor.")
def drums_snare(p):
    tune = p.knob_log(1, "Tune", 180, 2)
    snares = p.knob_log(2, "Snares", 1, 2)
    dec = p.knob_log(3, "Decay", 0.27, 2.5)
    ndec = p.knob_log(4, "Noise decay", 0.12, 2.5)
    room = p.knob_lin(5, "Room mix", 0.2, 0.2)
    penv = p.env(0.0005, 0.03, 0, 0.03, id="pitch_env")
    body = p.osc("dreieck", p.tr(tune, st=p.mul(penv, 3, id="pitch_st"), id="pitch"), id="body")
    body = p.mul(p.vca(body, p.env(0.0005, dec, 0, 0.27, id="env")), 0.2, id="body_pegel")
    rausch = p.vca(p.mul(p.rauschen(id="noise"), snares, id="snare_pegel"), p.env(0.0005, ndec, 0, 0.1, id="noise_env"))
    x = p.saett(p.mul(p.add(body, rausch, id="mix"), 0.5, id="vor"), 2, id="drive")
    s = hall(p, mono(x), room, decay=0.9, groesse=20)
    s = komp(p, s, ratio=4, attack=5, schwelle=-18)
    ausgang(p, s, 1.0)


@rezept("drums.clap", "exact", None,
        ["Welsh Clap: noise into the 12 dB filter the card prefers, 1.1 kHz, resonance 30 %, env 50 % (60 st) with D 0.15 s.",
         "32 Hz square LFO on the amplitude, depth 45 %, retriggered by every hit (`neustart`), which makes the multi-hand clap."],
        DRUM, ["drop", "groove"], 4, "Analog clap: filtered noise chopped by a retriggered 32 Hz square, short decay, high-passed plate.")
def drums_clap(p):
    cut = p.knob_log(1, "Cutoff", 1100, 3)
    amt = p.knob_lin(2, "Env amount", 60, 30)
    lfo = p.node("clap_lfo", "lfo", form=3, rate=32, neustart=1)
    p.edge("note.trig", "clap_lfo.trig")
    am = tiefe_mod(p, "clap_lfo.aus", 3, "Clap depth", 0.45, id="clap_am")
    dec = p.knob_log(4, "Decay", 0.11, 2.5)
    hmix = p.knob_lin(5, "Hall mix", 0.2, 0.2)
    fenv = p.env(0.0005, 0.15, 0, 0.15, id="fenv")
    x = p.svf(p.mul(p.rauschen(id="noise"), 0.5, id="vor"), filter_env_cutoff(p, cut, fenv, amt), 0.3, id="filter")
    x = p.vca(p.mul(x, am, id="clap_vca"), p.env(0.0005, dec, 0, 0.115, id="env"))
    x = p.svf(x, 400, 0, aus="hp", id="eq_hp")
    s = hall(p, mono(x), hmix, decay=1.2, pre=20)
    s = komp(p, s, ratio=4, schwelle=-18)
    ausgang(p, s, 1.0)


ACHT_NULL_ACHT = (205.3, 304.4, 369.6, 522.7, 540.0, 800.0)


def metall(p, tune):
    """six squares at the TR-808 cymbal frequencies, transposed by `tune` semitones"""
    return p.mul(p.summe(*[p.osc("puls", p.tr(f, st=tune, id=f"metal_hz{i}"), pwm=0, id=f"metal{i}") for i, f in enumerate(ACHT_NULL_ACHT, 1)], id="metal"), 1 / 6, id="metal_pegel")


@rezept("drums.hihat", "exact", None,
        ["The metallic method: six squares at the TR-808 frequencies (205.3, 304.4, 369.6, 522.7, 540, 800 Hz; engineering values, the card gives the architecture).",
         "Three band-passes at 3 / 6 / 10 kHz, each with its own envelope (decays 1, 0.8, 0.6 x the knob, 60 ms at the midpoint), then a high-pass.",
         "Six oscillators are nodes inside one voice, so a hit costs one voice, not six. The gate after the EQ trims the tail."],
        DRUM, ["groove", "drop"], 4, "Closed hi-hat: six inharmonic squares through three band-passes with their own short envelopes, high-passed, gated, small room.",
        upgrade=["metallic"])
def drums_hihat(p):
    tune = p.knob_lin(1, "Tune", 0, 12)
    dec = p.knob_log(2, "Decay", 0.06, 4)
    hp = p.knob_log(3, "High-pass", 400, 2)
    room = p.knob_lin(4, "Room mix", 0.1, 0.1)
    m = metall(p, tune)
    baender = []
    for i, (f, k) in enumerate(((3000, 1.0), (6000, 0.8), (10000, 0.6)), 1):
        b = p.svf(m, f, 0.3, aus="bp", id=f"band{i}")
        d = p.mul(dec, k, id=f"band{i}_d") if k != 1.0 else dec
        baender.append(p.vca(b, p.env(0.0003, d, 0, 0.03, id=f"band{i}_env")))
    x = p.svf(p.summe(*baender, id="baender"), hp, 0, aus="hp", id="highpass")
    s = gate(p, mono(x), schwelle=-50, release=20)
    s = hall(p, s, room, decay=0.4, groesse=10)
    ausgang(p, s, 1.0)


@rezept("drums.cymbal", "approximated", "metallic",
        ["Welsh Cymbal: noise into a 24 dB ladder, cutoff 89 % = 9.0 kHz (the card's '904 Hz' is the OCR'd 9.04 kHz), resonance 50 %, env 70 %.",
         "A six-square metallic layer is mixed with the noise (knob 3), the card's alternative; then high-pass 400 Hz, distortion and a 3 s hall.",
         "As the card says, a believable ride or crash needs samples or a dense metallic oscillator bank."],
        DRUM, ["build", "drop"], 4, "Crash-like cymbal: noise and a six-square metal layer, resonant filter, high-pass, distortion and a long hall.",
        upgrade=["metallic"])
def drums_cymbal(p):
    cut = p.knob_log(1, "Cutoff", 9040, 2.5)
    dec = p.knob_log(2, "Decay", 1.1, 2.5)
    metal = p.knob_lin(3, "Metal", 0.5, 0.5)
    drive = p.knob_lin(4, "Drive", 9, 9)
    hmix = p.knob_lin(5, "Hall mix", 0.25, 0.25)
    m = metall(p, 0)
    x = p.add(p.mul(p.rauschen(id="noise"), 0.5, id="noise_pegel"), p.mul(m, metal, id="metal_mix"), id="mix")
    fenv = p.env(0.0005, 0.14, 0, 1.8, id="fenv")
    x = p.ladder(x, filter_env_cutoff(p, cut, fenv, 84), 0.5, id="filter")
    x = p.vca(x, p.env(0.0005, dec, 0, 1.0, id="env"))
    x = p.svf(x, 400, 0, aus="hp", id="eq_hp")
    x = p.saett(x, drive, id="drive")
    s = hall(p, mono(x), hmix, decay=3)
    ausgang(p, s, 1.0)


# ---------------------------------------------------------------------------------------------------------- percussion


@rezept("percussion.tom", "exact", None,
        ["Timpani [B1] p. 83 turned into a tom: squares at the tune pitch and -10 st, ladder 800 Hz / 45 % with env 35 % (42 st) D 0.35 s.",
         "Amp D 0.6 s at the midpoint (rack tom; the card's range 0.4-0.8 s), pitch drop 5 st with a 0.1 s exponential envelope (90 % in ~33 ms)."],
        DRUM, ["groove", "build"], 4, "Analog tom: two squares a minor seventh apart with a quick pitch drop, resonant filter thump and a short room.",
        upgrade=["modal"])
def percussion_tom(p):
    tune = p.knob_log(1, "Tune", 110, 2)
    drop = p.knob_lin(2, "Pitch drop", 5, 5)
    dec = p.knob_log(3, "Decay", 0.6, 4)
    amt = p.knob_lin(4, "Env amount", 42, 21)
    room = p.knob_lin(5, "Room mix", 0.15, 0.15)
    penv = p.env(0.0005, 0.1, 0, 0.1, id="pitch_env")
    hz = p.tr(tune, st=p.mul(penv, drop, id="pitch_st"), id="pitch")
    x = p.add(p.osc("puls", hz, pwm=0, id="square1"), p.osc("puls", p.tr(hz, st=-10, id="ton2"), pwm=0, id="square2"), id="mix")
    fenv = p.env(0.0005, 0.35, 0, 0.3, id="fenv")
    x = p.ladder(p.mul(x, 0.4, id="vor"), filter_env_cutoff(p, 800, fenv, amt), 0.45, id="filter")
    x = p.vca(x, p.env(0.0005, dec, 0, 0.4, id="env"))
    s = hall(p, mono(x), room, decay=0.5, groesse=15)
    s = komp(p, s, ratio=4, schwelle=-18)
    ausgang(p, s, 1.0)


@rezept("percussion.shaker", "exact", None,
        ["Castanets [B1] p. 85 retuned (the card's derivation): noise into a ladder at 7.6 kHz with resonance 100 %, a 40 ms grain.",
         "Velocity scales the level, so alternating velocities give the shaker pattern."],
        DRUM, ["groove"], 3, "Shaker: a 40 ms grain of noise ringing a resonant 7.6 kHz filter, high-passed, velocity-sensitive, tiny room.")
def percussion_shaker(p):
    cut = p.knob_log(1, "Cutoff", 7600, 2)
    dec = p.knob_log(2, "Decay", 0.04, 2.5)
    room = p.knob_lin(3, "Room mix", 0.15, 0.15)
    x = p.ladder(p.mul(p.rauschen(id="noise"), 0.5, id="vor"), cut, 1.0, id="filter")
    x = p.vca(p.vca(x, p.env(0.0005, dec, 0, 0.04, id="env")), "note.vel")
    x = p.svf(x, 600, 0, aus="hp", id="eq_hp")
    s = hall(p, mono(x), room, decay=0.3, groesse=8)
    ausgang(p, s, 1.0)


@rezept("percussion.conga", "exact", None,
        ["Welsh Conga: squares at the tune pitch and +1 oct +2 st (the second at 0.47 = -6.5 dB), ladder 300 Hz / 40 %, env 50 % (60 st) D 0.02 s S 80 %.",
         "Amp D 0.15 s, mono. The EQ boost and cut are not built."],
        DRUM, ["groove"], 3, "Conga: two squares a ninth apart with a quick filter slap and a 150 ms decay, short room and compressor.",
        upgrade=["modal"])
def percussion_conga(p):
    tune = p.knob_log(1, "Tune", 220, 2)
    cut = p.knob_log(2, "Cutoff", 300, 2.5)
    dec = p.knob_log(3, "Decay", 0.15, 2.5)
    room = p.knob_lin(4, "Room mix", 0.15, 0.15)
    x = p.add(p.osc("puls", tune, pwm=0, id="square1"), p.mul(p.osc("puls", p.tr(tune, st=14, id="ton2"), pwm=0, id="square2"), 0.47, id="sq2_pegel"), id="mix")
    fenv = p.env(0.0005, 0.02, 0.8, 0.15, id="fenv")
    x = p.ladder(p.mul(x, 0.4, id="vor"), filter_env_cutoff(p, cut, fenv, 60), 0.4, id="filter")
    x = p.vca(x, p.env(0.0005, dec, 0, 0.15, id="env"))
    s = hall(p, mono(x), room, decay=0.4, groesse=10)
    s = komp(p, s, ratio=4, schwelle=-18)
    ausgang(p, s, 1.0)


@rezept("percussion.rim", "exact", None,
        ["Welsh Side Stick: noise into a self-oscillating ladder at 2.7 kHz (resonance 100 %), env 85 % (102 st) D 1.19 s, amp D 90 ms.",
         "The resonant filter is the card's band-pass; very short room after it.",
         "Measured: with the transcribed env 85 % and filter D 1.19 s the cutoff stays near the top of its range for the whole 90 ms click, so the ring sits near 11 kHz, not at 2.7 kHz. A shorter filter decay (0.19 s?) would bring it to 2.7 kHz; the OCR'd table cannot settle it."],
        DRUM, ["groove"], 3, "Rim shot: a 90 ms click of noise ringing a self-oscillating 2.7 kHz filter, very short room.")
def percussion_rim(p):
    cut = p.knob_log(1, "Cutoff", 2700, 2)
    amt = p.knob_lin(2, "Env amount", 102, 51)
    dec = p.knob_log(3, "Decay", 0.09, 3)
    room = p.knob_lin(4, "Room mix", 0.12, 0.12)
    fenv = p.env(0.0005, 1.19, 0, 0.1, id="fenv")
    x = p.ladder(p.mul(p.rauschen(id="noise"), 0.5, id="vor"), filter_env_cutoff(p, cut, fenv, amt), 1.0, id="filter")
    x = p.vca(x, p.env(0.0005, dec, 0, 0.01, id="env"))
    s = hall(p, mono(x), room, decay=0.25, groesse=6)
    ausgang(p, s, 1.0)


@rezept("percussion.metallic", "exact", None,
        ["Cowbell: pulses of 10 % and 35 % at the CR-8000's measured 587 and 845 Hz (the card's frequency cross-check) instead of Welsh's +5 st.",
         "Ladder 8.1 kHz, env 65 % (78 st) D 0.02 s S 65 %, amp D 0.15 s; high-pass 500 Hz, short room, optional saturation."],
        DRUM, ["groove"], 3, "Analog cowbell: two narrow pulses at 587 and 845 Hz, a bright filter snap, 150 ms decay and a short room.",
        upgrade=["metallic"])
def percussion_metallic(p):
    tune = p.knob_lin(1, "Tune", 0, 12)
    dec = p.knob_log(2, "Decay", 0.15, 3)
    room = p.knob_lin(3, "Room mix", 0.12, 0.12)
    drive = p.knob_lin(4, "Drive", 3, 3)
    x = p.add(p.osc("puls", p.tr(587, st=tune, id="ton1"), pwm=pw(0.10), id="pulse1"),
              p.osc("puls", p.tr(845, st=tune, id="ton2"), pwm=pw(0.35), id="pulse2"), id="mix")
    x = p.svf(p.mul(x, 0.4, id="vor"), 20, 0, aus="hp", id="dc_osz")
    fenv = p.env(0.0005, 0.02, 0.65, 0.15, id="fenv")
    x = p.ladder(x, filter_env_cutoff(p, 8100, fenv, 78), 0, id="filter")
    x = p.vca(x, p.env(0.0005, dec, 0, 0.15, id="env"))
    x = p.svf(x, 500, 0, aus="hp", id="eq_hp")
    s = hall(p, mono(x), room, decay=0.4, groesse=10)
    s = je_seite(p, s, lambda x, sd: p.saett(x, drive, id=f"drive{sd}"))
    ausgang(p, s, 1.0)


# ------------------------------------------------------------------------------------------------------------------ fx


@rezept("fx.riser", "exact", None,
        ["Noise into a 12 dB band-pass a quarter open (300 Hz, resonance 25 %); a mod envelope with a 4 s attack (knob), no decay or sustain, opens it 60 st.",
         "Amp: immediate attack, full sustain, 1.5 s release. The upward wet automation comes from the host, as the card says (the hall mix is a knob)."],
        {"art": "note", "noten": [60], "sekunden": 4.0}, ["build"], 4, "Noise riser: white noise through a band-pass that sweeps up over four seconds into a long hall.")
def fx_riser(p):
    cut = p.knob_log(1, "Cutoff", 300, 3)
    rise = p.knob_log(2, "Rise time", 4, 4)
    amt = p.knob_lin(3, "Env amount", 60, 30)
    hmix = p.knob_lin(4, "Hall mix", 0.35, 0.35)
    menv = p.env(rise, 0.001, 0, 2, id="mod_env")
    x = p.svf(p.mul(p.rauschen(id="noise"), 0.5, id="vor"), filter_env_cutoff(p, cut, menv, amt), 0.25, aus="bp", id="bandpass")
    x = p.vca(x, p.env(0.001, 0.1, 1, 1.5, id="env"))
    s = hall(p, mono(x), hmix, decay=5)
    ausgang(p, s, 1.0)


@rezept("fx.downlifter", "exact", None,
        ["The riser inverted: the band-pass starts three quarters open (3.6 kHz) and the same slow envelope pulls it down 48 st (negative amount).",
         "Hall (long) then a 1/4 delay; the downward wet automation comes from the host."],
        {"art": "note", "noten": [60], "sekunden": 4.0}, ["breakdown", "outro"], 2, "Noise downlifter: a band-passed noise wash that falls from bright to dark over four seconds into hall and delay.")
def fx_downlifter(p):
    cut = p.knob_log(1, "Cutoff", 3600, 3)
    fall = p.knob_log(2, "Fall time", 4, 4)
    amt = p.knob_lin(3, "Env amount", 48, 24)
    hmix = p.knob_lin(4, "Hall mix", 0.35, 0.35)
    dmix = p.knob_lin(5, "Delay mix", 0.15, 0.15)
    menv = p.env(fall, 0.001, 0, 2, id="mod_env")
    neg = p.mul(amt, -1, id="amt_neg")
    x = p.svf(p.mul(p.rauschen(id="noise"), 0.5, id="vor"), filter_env_cutoff(p, cut, menv, neg), 0.25, aus="bp", id="bandpass")
    x = p.vca(x, p.env(0.001, 0.1, 1, 1.5, id="env"))
    s = hall(p, mono(x), hmix, decay=5)
    s = delay(p, s, dmix, takt=1, fb=0.3)
    ausgang(p, s, 1.0)


@rezept("fx.impact", "approximated", None,
        ["Sine body (60 Hz, tune knob) with a pitch fall of 18 st over ~200 ms (exponential, D 0.2 s), body D 1.2 s; noise debris band-passed at 1 kHz, D 0.12 s.",
         "Heavy saturation, hall (6 s, 45 ms pre-delay), limiter. The reversed crash layer needs a sample and is left out; the EQ is not built.",
         "The slow LFO on the reverb wet is left out: the hall mix must stay on a knob (convention)."],
        {"art": "note", "noten": [60], "sekunden": 3.0}, ["drop", "transition"], 5, "Cinematic impact: a sine boom falling an octave and a half, noise debris, heavy saturation and a long hall.")
def fx_impact(p):
    tune = p.knob_log(1, "Tune", 60, 2)
    drop = p.knob_lin(2, "Pitch drop", 18, 18)
    dec = p.knob_log(3, "Decay", 1.2, 2.5)
    debris = p.knob_lin(4, "Debris", 0.5, 0.5)
    drive = p.knob_lin(5, "Drive", 15, 9)
    hmix = p.knob_lin(6, "Hall mix", 0.3, 0.3)
    penv = p.env(0.0005, 0.2, 0, 0.2, id="pitch_env")
    body = p.osc("sinus", p.tr(tune, st=p.mul(penv, drop, id="pitch_st"), id="pitch"), id="body")
    body = p.vca(body, p.env(0.0005, dec, 0, 1.5, id="env"))
    n = p.svf(p.rauschen(id="noise"), 1000, 0.2, aus="bp", id="debris_bp")
    n = p.mul(p.vca(n, p.env(0.0005, 0.12, 0, 0.1, id="debris_env")), debris, id="debris")
    x = p.saett(p.mul(p.add(body, n, id="mix"), 0.5, id="vor"), drive, id="drive")
    s = hall(p, mono(x), hmix, decay=6, pre=45)
    s = limiter(p, s, decke=-1)
    ausgang(p, s, 1.0)


@rezept("fx.noise", "exact", None,
        ["Ocean Waves [B1] p. 108: noise into a 24 dB ladder at 4.3 kHz, resonance 30 %, amp A 0.4 / R 1.0 s.",
         "LFO triangle 0.2 Hz, depth 75 % on the amplitude (the level swings between 25 % and 100 %). The optional chorus and the foghorn saw are left out."],
        {"art": "akkord", "noten": [57, 61, 64, 69], "sekunden": 6.0}, ["intro", "breakdown"], 1, "Ocean wind: filtered noise swelling slowly at 0.2 Hz, long hall, high- and low-passed.")
def fx_noise(p):
    cut = p.knob_log(1, "Cutoff", 4300, 3)
    am = tiefe_mod(p, p.lfo(p.knob_log(3, "Swell rate", 0.2, 4), form=1, id="swell"), 2, "Swell depth", 0.75, id="swell_am")
    att = p.knob_log(4, "Attack", 0.4, 4)
    hmix = p.knob_lin(5, "Hall mix", 0.35, 0.35)
    x = p.ladder(p.mul(p.rauschen(id="noise"), 0.3, id="vor"), cut, 0.3, id="filter")
    x = p.vca(p.mul(x, am, id="swell_vca"), p.env(att, 10, 1, 1.0, id="env"))
    s = hall(p, mono(x), hmix, decay=4)
    s = hochpass(p, s, 80, id="eq_hp")
    s = tiefpass(p, s, 12000, id="eq_lp")
    ausgang(p, s, 1.0)


@rezept("fx.texture", "exact", None,
        ["Nerd-O-Tron 2000 [B1] p. 108: saw plus square at +2 oct, ladder 680 Hz / 85 %, amp R 2 s; each layer is a wavetable with 3 copies (+-12 cent) for width.",
         "'Noise as LFO source': a random (S&H) LFO at 0.9 Hz smoothed over 100 ms, depth 25 % = +-15 st on the cutoff.",
         "Phaser, 1/4 delay with 40 % feedback, convolution with the spring impulse `feder-ir.f32` (a short metallic IR from proben.rs), high-pass."],
        AKKORD_TIEF, ["intro", "breakdown"], 2, "Machine texture bed: saw and square two octaves apart, a resonant filter wandering at random, phaser, delay and spring.")
def fx_texture(p):
    cut = p.knob_log(1, "Cutoff", 680, 3)
    res = p.knob_lin(2, "Resonance", 0.85, 0.15)
    rnd = p.knob_lin(3, "Random depth", 15, 15)
    ph = p.knob_lin(4, "Phaser mix", 0.4, 0.4)
    dmix = p.knob_lin(5, "Delay mix", 0.25, 0.25)
    fmix = p.knob_lin(6, "Spring mix", 0.3, 0.3)
    a = p.wt(0, 3, "note.hz", verst=12, id="saws")
    b = p.wt(1, 3, p.mul("note.hz", 4, id="okt2"), verst=12, id="squares")
    p.node("zufall", "lfo", form=4, rate=0.9)
    p.node("zufall_glatt", "glatt", zeit=0.1)
    p.edge("zufall.aus", "zufall_glatt.x")
    x = p.mul(p.add(f"{a}.aus", f"{b}.aus", id="mix"), 0.35, id="vor")
    x = p.ladder(x, p.tr(cut, st=p.mul("zufall_glatt.aus", rnd, id="rnd_st"), id="cutoff"), res, id="filter")
    x = p.vca(x, p.env(0.005, 10, 1, 2.0, id="env"))
    s = phaser(p, mono(x), ph, rate=0.1)
    s = delay(p, s, dmix, takt=1, fb=0.4)
    s = faltung(p, s, fmix, "feder-ir.f32", laenge_max=1500)
    s = hochpass(p, s, 40, id="eq_hp")
    ausgang(p, s, 1.0)


# ======================================================================================================================
MODULE = {
    "fm": "FM operators (several operators with ratios, per-operator envelopes and calibrated levels)",
    "physical_string": "physical string (Karplus-Strong or waveguide, pitch-tracked)",
    "modal": "modal resonator (bank of tuned resonant modes)",
    "metallic": "metallic oscillator bank (many inharmonic square or pulse partials)",
    "hard_sync": "band-limited hard-sync oscillator",
    "granular": "granular engine (grain size, position, density, random scatter)",
}


def lies_karten():
    text = KARTEN.read_text(encoding="utf-8")
    karten = {}
    for teil in re.split(r"^### ", text, flags=re.M)[1:]:
        kopf, _, rest = teil.partition("\n")
        id, _, titel = kopf.partition(": ")   # card heading "### <group>.<subtype>: <title>"
        felder = {}
        for m in re.finditer(r"^- \*\*([^:]+):\*\* (.*)$", rest, flags=re.M):
            felder.setdefault(m.group(1), m.group(2).strip())
        karten[id] = dict(titel=titel.strip(), **felder)
    return karten


def woerter(zeile):
    return [w.strip(" .") for w in zeile.split("·") if w.strip(" .")]


def json_graph(p):
    zeilen = ["{", f'  "format": "baukasten/2",', f'  "name": {json.dumps(p.name)},', f'  "stimmen": {p.stimmen},']
    zeilen.append('  "regler_namen": ' + json.dumps({str(k): v for k, v in sorted(p.regler.items())}, separators=(", ", ": ")) + ",")
    zeilen.append('  "knoten": [')
    zeilen += ["    " + json.dumps(k, separators=(", ", ": ")) + ("," if i < len(p.knoten) - 1 else "") for i, k in enumerate(p.knoten)]
    zeilen.append("  ],")
    zeilen.append('  "kanten": [')
    zeilen += ["    " + json.dumps(k, separators=(", ", ": ")) + ("," if i < len(p.kanten) - 1 else "") for i, k in enumerate(p.kanten)]
    zeilen.append("  ]")
    zeilen.append("}")
    return "\n".join(zeilen) + "\n"


# Output trims, measured by tests/rezepte.rs (`MESS_PEGEL`): each patch peaks at -6 dBFS on its test render (the hi-hat
# 1 dB lower: at -6 dBFS it peaks at 0.898 on the convention probe, too close to the lint's 0.9).
PEGEL = {
    "bass-acid": 0.8958,
    "bass-analog": 0.2847,
    "bass-fm": 0.744,
    "bass-pluck": 0.8916,
    "bass-reese": 1.3195,
    "bass-rolling": 1.0297,
    "bass-sub": 1.1856,
    "bass-wobble": 1.2476,
    "drums-clap": 1.2735,
    "drums-cymbal": 0.9563,
    "drums-hihat": 1.578,
    "drums-kick": 1.0542,
    "drums-snare": 1.5472,
    "fx-downlifter": 1.5392,
    "fx-impact": 0.5749,
    "fx-noise": 2.6373,
    "fx-riser": 2.0387,
    "fx-texture": 0.9006,
    "keys-bell": 0.2619,
    "keys-chord": 0.3038,
    "keys-electric-piano": 0.4842,
    "keys-mallet": 0.4052,
    "keys-organ": 0.1161,
    "keys-piano": 0.5314,
    "lead-acid": 1.3077,
    "lead-arp": 0.8888,
    "lead-fm": 0.1525,
    "lead-mono": 0.4359,
    "lead-poly": 0.1153,
    "lead-supersaw": 0.2343,
    "lead-sync": 0.4238,
    "pad-analog": 0.3981,
    "pad-atmosphere": 1.7848,
    "pad-choir": 0.166,
    "pad-drone": 1.1043,
    "pad-granular": 0.0823,
    "pad-strings": 0.6319,
    "percussion-conga": 1.5135,
    "percussion-metallic": 0.7857,
    "percussion-rim": 2.1824,
    "percussion-shaker": 5.8298,
    "percussion-tom": 1.209,
    "pluck-mallet": 0.4175,
    "pluck-stab": 0.4234,
    "pluck-string": 0.6715,
    "pluck-synth": 0.4934,
}

STIMMEN = {"note": 1}


def main():
    pegel = dict(PEGEL)
    if "--pegel" in sys.argv:
        for z in Path(sys.argv[sys.argv.index("--pegel") + 1]).read_text().splitlines():
            if z.startswith("MESS_PEGEL "):
                _, n, t = z.split()
                pegel[n] = round(float(t), 4)
        # keep the trims in this script, so a later run without --pegel writes the same graphs
        selbst = Path(__file__).read_text(encoding="utf-8")
        literal = "PEGEL = {\n" + "".join(f'    "{k}": {v},\n' for k, v in sorted(pegel.items())) + "}"
        Path(__file__).write_text(re.sub(r"PEGEL = \{[^}]*\}", lambda _: literal, selbst, count=1), encoding="utf-8")
    karten = lies_karten()
    assert set(karten) == set(REZEPTE), f"cards without recipe: {set(karten) - set(REZEPTE)}, recipes without card: {set(REZEPTE) - set(karten)}"
    ZIEL.mkdir(parents=True, exist_ok=True)
    manifest = []
    for id, r in REZEPTE.items():
        gruppe, unter = id.split(".")
        name = f"{gruppe}-{unter.replace('_', '-')}"
        poly = r["probe"]["art"] == "akkord"
        p = Patch(name, 8 if poly else 1)
        r["bau"](p)
        trim = round(pegel.get(name, 1.0), 4)
        for k in p.knoten:
            if k["id"] in ("pegel", "pegel_l", "pegel_r"):
                k["b"] = zahl(trim)
        (ZIEL / f"{name}.json").write_text(json_graph(p), encoding="utf-8")
        k = karten[id]
        charakter = woerter(k["Target words"])[:6]
        assert len(r["satz"]) <= 160, f"{id}: sentence has {len(r['satz'])} characters"
        manifest.append({
            "datei": f"{name}.json",
            "karte": id,
            "titel": k["titel"],
            "zitat": k["Source"],
            "machbarkeit_karte": k["Feasibility"].replace("**", ""),
            "status": r["status"],
            "beschreibung": {"art": gruppe, "unterart": unter, "charakter": charakter, "einsatz": r["einsatz"],
                             "energie": r["energie"], "text": r["satz"]},
            "stimmen": p.stimmen,
            "regler": {str(n): v for n, v in sorted(p.regler.items())},
            "naeherung": r["notizen"],
            "exakt_mit": MODULE[r["modul"]] if r["modul"] else None,
            "besser_mit": [MODULE[m] for m in r["upgrade"] if m != r["modul"]],
            "probe": r["probe"],
        })
    kopf = {
        "format": "baukasten-rezepte/1",
        "quelle": "djk/instrumente/baukasten_dsp/rezepte/RECIPES.md",
        "erzeugt_von": "djk/instrumente/baukasten_dsp/rezepte/baue_rezepte.py",
        "status_werte": {
            "exact": "every oscillator, filter, envelope, modulation and voice value of the card is built; the effect order is kept; only bell-EQ moves and values the card leaves open are engineering choices (listed in naeherung)",
            "approximated": "something on the card is replaced by a substitute (listed in naeherung); exakt_mit names the module that would make it exact, null when no module of the parallel work does",
            "blocked": "the card's defining module does not exist; the patch is a stand-in",
        },
        "energie": "1 (calm bed) .. 5 (peak of a drop)",
        "patches": manifest,
    }
    (ZIEL / "MANIFEST.json").write_text(json.dumps(kopf, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{len(manifest)} patches written to {ZIEL}")


if __name__ == "__main__":
    main()
