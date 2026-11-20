//! Prüfen und Übersetzen: JSON → `Programm`. Reihenfolge topologisch über die Kanten ohne Verzögerung, bei Gleichstand
//! nach Knoten-ID (Spec E3: dasselbe JSON ergibt immer dieselbe Reihenfolge). Ein Kreis ohne Verzögerungskante ist ein
//! Fehler, keine stille Auflösung (Spec E1). Ein unverbundener Eingang liest den gleichnamigen festen Wert des Knotens,
//! fehlt der, 0. Makros sind vorher aufgelöst (`makro::aufloesen`).
//! `hall` ist Cypher Hall (hall_dsp) als Summenpunkt, Strukturwerte fest (Slice 4a).
//! `delay` ist ein Echo (echo.rs) als Summenpunkt; feste Zeit liest Thiran, verbundene Lagrange (Slice 4b).
//! `limiter`, `gate` und `komp` sind Summenpunkte (Slice 4c); die Latenz des Limiters läuft beim Übersetzen den Graphen
//! entlang (`Programm::latenz`).
//! `leitung` verzögert je Stimme; die Kante in `leitung.x` gilt immer als verzögert, darum darf ein Kreis durch eine
//! Leitung laufen (Slice 4f).
//! `eingang` liefert das Host-Audio (Effekt-Graph, S3c), nur in Stimme 0.
use crate::adsr::Adsr;
use crate::chorus::Chorus;
use crate::echo::Echo;
use crate::faltung::Faltung;
use crate::format::{Graph, PaulaPlatz, FORMATE};
use crate::gate::Gate;
use crate::krume::Krume;
use crate::leitung::Leitung;
use crate::lfo::Lfo;
use crate::sh::Sh;
use crate::mseg::{Mseg, MsegSatz};
use crate::folger::Folger;
use crate::limiter::{vorlauf, Limiter};
use crate::osz::{Osz, Rauschen, Sinus};
use crate::phaser::Phaser;
use crate::programm::{Programm, Quelle, Schritt, MAX_STIMMEN, REGLER};
use crate::sampler::{karte_datei, lade_datei, Daten, Einstellung, Sampler, ZonenTabelle};
use crate::roehre::{Roehre, RoehrenSatz, BIAS_MAX, BIAS_MIN};
use crate::svf::Svf;
use crate::allpass::Allpass;
use crate::kreuz::Kreuz;
use crate::lfsr::Lfsr;
use crate::paula::{Bank as PaulaBank, Platz as PaulaPlatz2, PlatzEinst, Stimme as PaulaStimme};
use crate::sem::Sem;
use crate::diode::Diode;
use crate::vocoder::Vocoder;
use crate::wavetable::{Stimme as WtStimme, TABELLEN};
use crate::resonator::{Satz, Stimme as RsStimme, SAETZE};
use crate::saite::{Stimme as SaStimme, ANREGER, KOERPER};
use rb_dsp::Ladder;
use saett_dsp::Adaa1;
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

#[derive(Debug, Clone, PartialEq)]
pub enum Fehler {
    Format(String),
    FalschesFormat(String),
    Stimmen(usize),
    DoppelteId(String),
    UnbekannteArt { knoten: String, art: String },
    UnbekannterWert { knoten: String, wert: String },
    FehlenderWert { knoten: String, wert: String },
    /// Wert ist nicht endlich (z. B. 1e39 wird als f32 unendlich)
    UnendlicherWert { knoten: String, wert: String },
    /// "knoten.port" ohne Punkt
    Adresse(String),
    UnbekannterKnoten(String),
    UnbekannterPort(String),
    MehrfachEingang(String),
    /// nur 0 oder 1 erlaubt
    Verzoegerung(String),
    MehrereNoten,
    /// höchstens ein Knoten `eingang`
    MehrereEingaenge,
    /// ID leer oder mit '.' oder '/'
    Id(String),
    /// Wert außerhalb seines Bereichs
    Wert { knoten: String, wert: String, grund: &'static str },
    UnbekannterMakro { knoten: String, makro: String },
    /// `note`, `ausgang` oder ein Makro im Makro
    MakroInhalt { makro: String, knoten: String, art: String },
    /// Schlüssel in `regler_namen` außerhalb "1".."8"
    ReglerName(String),
    KeinAusgang,
    /// sample file of a `sampler` node unusable (S10): name rule, size, content, missing sample root
    Datei { knoten: String, grund: String },
    /// zone table of a `sampler` node unusable (sample player stage 2a): `wert` names the zone (counted from 0) and the field,
    /// e.g. `zonen[3].lo`, or just `zonen` for the table as a whole
    Zonen { knoten: String, wert: String, grund: String },
    /// die Knoten-IDs, die im Kreis hängen oder hinter ihm liegen (sortiert)
    Schleife(Vec<String>),
}

impl std::fmt::Display for Fehler {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { write!(f, "{self:?}") }
}

pub struct ArtDef {
    pub art: &'static str,
    pub ein: &'static [&'static str],
    pub aus: &'static [&'static str],
    /// Pflichtwerte
    pub werte: &'static [&'static str],
    /// freiwillige Werte mit Vorgabe. Dazu darf jeder Eingang einen gleichnamigen Wert tragen (gilt ohne Kante).
    pub frei: &'static [(&'static str, f32)],
}

pub const ARTEN: [ArtDef; 62] = [
    ArtDef { art: "note", ein: &[], aus: &["hz", "gate", "vel", "trig", "erste"], werte: &[], frei: &[] },
    ArtDef { art: "konst", ein: &[], aus: &["aus"], werte: &["wert"], frei: &[] },
    // `vorgabe`: knob position the graph starts at (0..1). `mitte`: value at knob position 0.5; its default NaN is the "absent" marker
    // (JSON cannot carry NaN, so a given value is never NaN), see `Schritt::Regler`. `rastet` (0/1, default 0): the host applies this knob
    // latched, without glide, and may set it per note (`Programm::rastende`); knobs with the same `nr` must agree.
    ArtDef { art: "regler", ein: &[], aus: &["aus"], werte: &["nr", "min", "max"], frei: &[("log", 0.0), ("vorgabe", 0.5), ("mitte", f32::NAN), ("rastet", 0.0)] },
    // `hart` (appended, hard sync slice): band-limited hard sync, input = a master's output `hart` (osz.rs)
    ArtDef { art: "saege", ein: &["hz", "sync", "hart"], aus: &["aus", "zyklus", "hart"], werte: &[], frei: &[] },
    ArtDef { art: "puls", ein: &["hz", "pwm", "sync", "hart"], aus: &["aus", "zyklus", "hart"], werte: &[], frei: &[] },
    ArtDef { art: "dreieck", ein: &["hz", "sync", "hart"], aus: &["aus", "zyklus", "hart"], werte: &[], frei: &[] },
    ArtDef { art: "sinus", ein: &["hz", "fm", "sync"], aus: &["aus", "zyklus", "hart"], werte: &[], frei: &[] },
    ArtDef { art: "rauschen", ein: &[], aus: &["aus"], werte: &[], frei: &[] },
    ArtDef { art: "lfo", ein: &["rate", "trig"], aus: &["aus"], werte: &[], frei: &[("form", 0.0), ("neustart", 0.0), ("takt", 0.0), ("versatz", 0.0), ("einmal", 0.0)] },
    ArtDef { art: "transponiere", ein: &["hz", "st", "cent"], aus: &["aus"], werte: &[], frei: &[] },
    ArtDef { art: "ladder", ein: &["x", "cutoff", "reso"], aus: &["aus"], werte: &[], frei: &[] },
    ArtDef { art: "svf", ein: &["x", "cutoff", "reso"], aus: &["tp", "bp", "hp"], werte: &[], frei: &[("pole", 2.0)] },
    ArtDef { art: "saett", ein: &["x", "antrieb"], aus: &["aus"], werte: &[], frei: &[] },
    ArtDef { art: "glatt", ein: &["x", "setzen"], aus: &["aus"], werte: &[], frei: &[("zeit", 0.01)] },
    ArtDef { art: "adsr", ein: &["gate", "trig", "a", "d", "s", "r"], aus: &["aus"], werte: &["a", "d", "s", "r"], frei: &[] },
    ArtDef { art: "mul", ein: &["a", "b"], aus: &["aus"], werte: &[], frei: &[] },
    ArtDef { art: "add", ein: &["a", "b", "c", "d"], aus: &["aus"], werte: &[], frei: &[] },
    ArtDef { art: "leitung", ein: &["x", "zeit", "hz"], aus: &["aus"], werte: &[], frei: &[("zeit", 10.0), ("hz", 0.0), ("max", 1000.0)] },
    ArtDef { art: "chorus", ein: &["x", "mix"], aus: &["l", "r"], werte: &[], frei: &[("modus", 1.0), ("mix", 1.0)] },
    ArtDef { art: "hall", ein: &["x", "l", "r", "mix"], aus: &["l", "r"], werte: &[],
             frei: &[("mix", 0.3), ("decay", 2.0), ("groesse", 60.0), ("pre", 10.0), ("frueh", 0.5), ("breite", 1.0), ("tief", 1.2), ("hoch", 0.6), ("rahmen", 2.0)] },
    ArtDef { art: "delay", ein: &["x", "l", "r", "zeit", "fb", "mix"], aus: &["l", "r"], werte: &[],
             frei: &[("zeit", 375.0), ("fb", 0.35), ("mix", 0.3), ("max", 1000.0), ("daempf", 4000.0), ("glatt", 100.0), ("pingpong", 0.0), ("takt", 0.0)] },
    ArtDef { art: "limiter", ein: &["x", "l", "r"], aus: &["l", "r"], werte: &[], frei: &[("decke", -1.0), ("vorlauf", 2.0), ("release", 60.0)] },
    ArtDef { art: "gate", ein: &["x", "l", "r", "kl", "kr"], aus: &["l", "r"], werte: &[],
             frei: &[("schwelle", -50.0), ("hyst", 6.0), ("tiefe", 80.0), ("attack", 1.0), ("release", 100.0)] },
    ArtDef { art: "komp", ein: &["x", "l", "r", "kl", "kr"], aus: &["l", "r"], werte: &[],
             frei: &[("schwelle", -18.0), ("ratio", 4.0), ("knie", 6.0), ("attack", 10.0), ("release", 120.0), ("makeup", 0.0), ("mix", 1.0), ("schp", 0.0)] },
    ArtDef { art: "eingang", ein: &[], aus: &["l", "r"], werte: &[], frei: &[] },
    ArtDef { art: "ausgang", ein: &["x", "l", "r"], aus: &[], werte: &[], frei: &[] },
    // appended, never inserted: the type numbers of the existing blocks must not move (S7, D13)
    ArtDef { art: "krume", ein: &["x", "bits", "rate"], aus: &["aus"], werte: &[], frei: &[("bits", 12.0), ("rate", 26040.0)] },
    ArtDef { art: "phaser", ein: &["x", "l", "r", "rate", "tiefe", "fb", "mix"], aus: &["l", "r"], werte: &[],
             frei: &[("rate", 0.3), ("tiefe", 1.0), ("fb", 0.5), ("mix", 0.5), ("stufen", 6.0), ("tief", 300.0), ("hoch", 4800.0), ("breite", 90.0)] },
    // S8: triode stage (Koren), per voice; type 28
    ArtDef { art: "roehre", ein: &["x", "antrieb", "bias"], aus: &["aus"], werte: &[], frei: &[("antrieb", 0.0), ("bias", -1.5), ("stufen", 1.0)] },
    // S11: channel vocoder, 11 bands; type 29 (S10 `sampler` follows as 30)
    ArtDef { art: "vocoder", ein: &["x", "l", "r", "zisch", "mix"], aus: &["l", "r"], werte: &[],
             frei: &[("attack", 5.0), ("release", 30.0), ("pole", 4.0), ("zisch", 0.3), ("mix", 1.0)] },
    // S10: sample playback, per voice; type 30. `datei` is a named field of the node, not a value. gate defaults to 1 so a
    // loop without a gate edge keeps looping (C10).
    // Sampler A1: `grenzen` (named field) is a slice table; `noten_wahl` 1 lets the played note choose the slice, `tempo`
    // and `halb` set the read speed, `ausklang` (ms) is the release when the gate falls. The new inputs sit at the end.
    // Stage 2a: `zonen` (named field) is a zone table (multisample instrument, `datei` is then a mapped pack); `vel` (0..1, read
    // at the trigger) chooses the velocity layer there.
    // Stage 2b: `loop_blende` (ms at 48 kHz, 0..500, zone mode only) is the cross-fade of the sustain loops of the zones; the outputs
    // Stage 2c (zone mode only): `taste_blende` (0..24 keys) and `vel_blende` (0..127 steps) cross-fade the edges of key and velocity
    // ranges, `frei_halte` (0..60 s) halves the level of a release sample per hold time; 0 is off.
    // `rl`, `rr` (appended after `l`, `r`) carry the release samples (zones of art 1) and are silent without zones.
    ArtDef { art: "sampler", ein: &["hz", "trig", "gate", "scheibe", "rueck", "tempo", "halb", "ausklang", "vel"], aus: &["l", "r", "rl", "rr"], werte: &[],
             frei: &[("grund", 261.6256), ("scheiben", 1.0), ("schleife", 0.0), ("gate", 1.0), ("noten_wahl", 0.0), ("tempo", 1.0), ("halb", 0.0), ("ausklang", 5.0), ("vel", 1.0), ("loop_blende", 20.0), ("taste_blende", 0.0), ("vel_blende", 0.0), ("frei_halte", 0.0)] },
    // S21: convolution with an IR file (sum point, zero latency); type 31. `datei` is a named field like sampler's.
    ArtDef { art: "faltung", ein: &["x", "l", "r", "mix"], aus: &["l", "r"], werte: &[], frei: &[("mix", 1.0), ("pre", 0.0), ("laenge_max", 1000.0)] },
    // wavetable oscillator with unison inside the voice (wavetable.rs); type 32. `aus` is the sum without pan.
    ArtDef { art: "wavetable", ein: &["hz", "trig", "pos", "verstimmung", "breite", "pm", "warp", "tiefe", "stapel"], aus: &["l", "r", "aus"], werte: &[],
             frei: &[("tabelle", 0.0), ("kopien", 1.0), ("pos", 0.0), ("verstimmung", 0.0), ("breite", 0.0), ("zufall", 1.0), ("saat", 0.0), ("glatt", 10.0), ("reserve", 0.0)] },
    // metallic oscillator bank for hats and cymbals (metall.rs); type 33 (appended in merge order after wavetable). Inputs in the order of `metall::EIN`.
    ArtDef { art: "metall", ein: &["trig", "vel", "decay", "tune", "farbe", "rauschen", "hp", "choke"], aus: &["aus", "huelle"], werte: &[],
             frei: &[("vel", 1.0), ("decay", 0.3), ("tune", 1.0), ("farbe", 0.5), ("rauschen", 0.2), ("hp", 6000.0), ("schnitt", 8.0), ("gruppe", 1.0), ("saat", 0.0)] },
    // modal resonator bank (resonator.rs); type 34 (appended in merge order after metall)
    ArtDef { art: "resonator", ein: &["hz", "trig", "staerke", "x", "material", "helligkeit", "groesse", "position", "inharmonie"], aus: &["aus"], werte: &[],
             frei: &[("satz", 0.0), ("moden", 32.0), ("anregung", 0.0), ("burst", 5.0), ("saat", 0.0), ("staerke", 1.0), ("material", 0.5),
                     ("helligkeit", 0.5), ("groesse", 1.0), ("position", 0.3), ("inharmonie", 1.0)] },
    // multi-operator FM (fm.rs); type 35 (appended in merge order after resonator). Six operators o1..o6 with ratio, fine (cent), level and ADSR each.
    ArtDef { art: "fm", ein: &["hz", "gate", "trig", "vel", "index", "rueck", "zeit"], aus: &["aus"], werte: &[],
             frei: &[("algo", 0.0), ("gate", 1.0), ("vel", 1.0), ("index", 1.0), ("rueck", 0.0), ("zeit", 1.0), ("anschlag", 0.0), ("sync", 1.0),
                   ("o1_verh", 1.0), ("o1_fein", 0.0), ("o1_pegel", 1.0), ("o1_a", 0.001), ("o1_d", 1.0), ("o1_s", 1.0), ("o1_r", 0.1),
                   ("o2_verh", 1.0), ("o2_fein", 0.0), ("o2_pegel", 0.0), ("o2_a", 0.001), ("o2_d", 1.0), ("o2_s", 1.0), ("o2_r", 0.1),
                   ("o3_verh", 1.0), ("o3_fein", 0.0), ("o3_pegel", 0.0), ("o3_a", 0.001), ("o3_d", 1.0), ("o3_s", 1.0), ("o3_r", 0.1),
                   ("o4_verh", 1.0), ("o4_fein", 0.0), ("o4_pegel", 0.0), ("o4_a", 0.001), ("o4_d", 1.0), ("o4_s", 1.0), ("o4_r", 0.1),
                   ("o5_verh", 1.0), ("o5_fein", 0.0), ("o5_pegel", 0.0), ("o5_a", 0.001), ("o5_d", 1.0), ("o5_s", 1.0), ("o5_r", 0.1),
                   ("o6_verh", 1.0), ("o6_fein", 0.0), ("o6_pegel", 0.0), ("o6_a", 0.001), ("o6_d", 1.0), ("o6_s", 1.0), ("o6_r", 0.1),
             ] },
    // granular engine on generated sources (granular.rs); type 36 (appended in merge order after fm)
    ArtDef { art: "granular", ein: &["hz", "trig", "gate", "x", "groesse", "dichte", "pos", "pos_zufall", "tonhoehe", "ton_zufall", "breite", "fenster", "frieren"],
             aus: &["l", "r"], werte: &[],
             frei: &[("quelle", 0.0), ("tabelle", 0.0), ("puffer", 2.0), ("grund", 261.6256), ("streuung", 0.0), ("saat", 0.0), ("hz", 261.6256), ("gate", 1.0),
                     ("groesse", 80.0), ("dichte", 20.0), ("pos", 0.0), ("pos_zufall", 0.0), ("tonhoehe", 0.0), ("ton_zufall", 0.0), ("breite", 0.0),
                     ("fenster", 0.0), ("frieren", 0.0)] },
    // physical string model, digital waveguide (saite.rs); type 37 (appended in merge order after granular). `x` is an external excitation, added to the internal one.
    ArtDef { art: "saite", ein: &["x", "hz", "trig", "vel", "ausklang", "daempfung", "hell", "lage", "koerper_mix"], aus: &["aus"], werte: &[],
             frei: &[("anreger", 1.0), ("koerper", 0.0), ("saat", 0.0), ("vel", 1.0), ("ausklang", 2.0), ("daempfung", 0.5), ("hell", 0.5), ("lage", 0.13), ("koerper_mix", 0.5)] },
    // sample and hold (sh.rs); `x` unconnected = own noise, `trig` connected = edge clock, else `takt` (beats) or `rate` (Hz)
    ArtDef { art: "sh", ein: &["x", "trig", "rate", "glatt"], aus: &["aus"], werte: &[], frei: &[("rate", 8.0), ("glatt", 0.0), ("takt", 0.0)] },
    // multi-stage envelope (mseg.rs): stages p1..p8 (level), t1..t8 (s), k1..k8 (curve); `halt` sustain stage, `von`..`bis` loop
    ArtDef { art: "mseg", ein: &["gate", "trig"], aus: &["aus"], werte: &[],
             frei: &[("stufen", 3.0), ("halt", 2.0), ("von", 0.0), ("bis", 0.0),
                     ("p1", 1.0), ("p2", 0.5), ("p3", 0.0), ("p4", 0.0), ("p5", 0.0), ("p6", 0.0), ("p7", 0.0), ("p8", 0.0),
                     ("t1", 0.01), ("t2", 0.1), ("t3", 0.3), ("t4", 0.1), ("t5", 0.1), ("t6", 0.1), ("t7", 0.1), ("t8", 0.1),
                     ("k1", 0.0), ("k2", 0.0), ("k3", 0.0), ("k4", 0.0), ("k5", 0.0), ("k6", 0.0), ("k7", 0.0), ("k8", 0.0)] },
    // envelope follower (folger.rs): peak detector, `an` / `ab` in ms
    ArtDef { art: "folger", ein: &["x", "an", "ab"], aus: &["aus"], werte: &[], frei: &[("an", 5.0), ("ab", 120.0)] },
    // tuned feedback comb filter (kamm.rs); type 38 (appended). `hz` is per-sample, fb < 0 gives odd harmonics at the played pitch.
    ArtDef { art: "kamm", ein: &["x", "hz", "fb", "daempf", "mix"], aus: &["aus"], werte: &[],
             frei: &[("hz", 440.0), ("fb", 0.7), ("daempf", 0.3), ("mix", 1.0)] },
    // vowel filter, five parallel band-passes (formant.rs); type 39 (appended). `vokal` 0..4 = a e i o u.
    ArtDef { art: "formant", ein: &["x", "vokal", "versatz", "q", "mix"], aus: &["aus"], werte: &[],
             frei: &[("vokal", 0.0), ("versatz", 0.0), ("q", 0.5), ("mix", 1.0)] },
    // MS-20 style filter, Korg-35 topology with saturating feedback (ms20.rs); appended at the end. `modus` 0 both outputs, 1 only tp, 2 only hp.
    ArtDef { art: "ms20", ein: &["x", "cutoff", "reso", "antrieb"], aus: &["tp", "hp"], werte: &[],
             frei: &[("cutoff", 1000.0), ("reso", 0.3), ("antrieb", 0.0), ("modus", 0.0)] },
    // SEM-style 12 dB/oct state-variable filter, low-pass -> notch -> high-pass morph plus band-pass (sem.rs); type 38 (appended after saite)
    ArtDef { art: "sem", ein: &["x", "cutoff", "reso", "form"], aus: &["aus", "bp"], werte: &[],
             frei: &[("cutoff", 1000.0), ("reso", 0.0), ("form", 0.0)] },
    // selector (multiplexer) over e1..e8, per voice (wahl.rs); type 38 (appended). `n` positions in use, `norm` 1 = wahl is a 0..1 knob split into n zones, 0 = index.
    ArtDef { art: "wahl", ein: &["e1", "e2", "e3", "e4", "e5", "e6", "e7", "e8", "wahl"], aus: &["aus"], werte: &["n"],
             frei: &[("norm", 1.0), ("blende", 5.0), ("modus", 0.0)] },
    // TB-303 diode-ladder low-pass (diode.rs); appended in merge order. `antrieb` in dB, `bass` 0..1.
    ArtDef { art: "diode", ein: &["x", "cutoff", "reso", "antrieb", "bass"], aus: &["aus"], werte: &[],
             frei: &[("cutoff", 1000.0), ("reso", 0.0), ("antrieb", 0.0), ("bass", 0.0)] },
    // drum kit, the note picks the drum (trommeln.rs); type 47 (appended). Sum point: result in voice 0. Inputs in the order of `trommeln::EIN`.
    ArtDef { art: "trommeln", ein: &["trig", "vel", "hz", "pegel", "drive", "filter", "reso", "kick_tune", "kick_decay", "kick_punch", "kick_pdecay", "kick_click", "kick_drive", "snare_tune", "snare_decay", "snare_snappy", "snare_tone", "clap_decay", "clap_tone", "clap_spread", "rim_tune", "rim_decay", "tomlo_tune", "tommid_tune", "tomhi_tune", "tom_decay", "tom_punch", "hat_tune", "hat_tone", "hat_noise", "ch_decay", "oh_decay", "crash_tune", "crash_decay", "ride_tune", "ride_decay", "cow_tune", "cow_decay", "boom_tune", "boom_decay", "clave_tune", "lv_kick", "lv_snare", "lv_clap", "lv_tom", "lv_hat", "lv_cym", "lv_perc"], aus: &["aus"], werte: &[],
             frei: &[("pegel", 1.0), ("drive", 0.5), ("filter", 0.5), ("reso", 0.3), ("kick_tune", 54.0), ("kick_decay", 380.0), ("kick_punch", 24.0), ("kick_pdecay", 14.0), ("kick_click", 0.5), ("kick_drive", 0.5), ("snare_tune", 190.0), ("snare_decay", 220.0), ("snare_snappy", 0.5), ("snare_tone", 0.5), ("clap_decay", 280.0), ("clap_tone", 0.5), ("clap_spread", 0.5), ("rim_tune", 480.0), ("rim_decay", 50.0), ("tomlo_tune", 85.0), ("tommid_tune", 128.0), ("tomhi_tune", 190.0), ("tom_decay", 420.0), ("tom_punch", 14.0), ("hat_tune", 1.0), ("hat_tone", 0.5), ("hat_noise", 0.3), ("ch_decay", 55.0), ("oh_decay", 380.0), ("crash_tune", 1.0), ("crash_decay", 1800.0), ("ride_tune", 1.0), ("ride_decay", 1300.0), ("cow_tune", 1.0), ("cow_decay", 320.0), ("boom_tune", 41.0), ("boom_decay", 2200.0), ("clave_tune", 2500.0), ("lv_kick", 0.0), ("lv_snare", 0.0), ("lv_clap", 0.0), ("lv_tom", 0.0), ("lv_hat", 0.0), ("lv_cym", 0.0), ("lv_perc", 0.0), ("modell", 0.0), ("schnitt", 8.0), ("saat", 0.0)] },
    // wavefolder (falter.rs), per voice; type 48 (appended in merge order after trommeln). `antrieb` in dB, `symmetrie` -1..1, `form` 0 triangle .. 1 sine fold, `ueber` 1 = 2x oversampled (latency).
    ArtDef { art: "falter", ein: &["x", "antrieb", "symmetrie", "form"], aus: &["aus"], werte: &[],
             frei: &[("antrieb", 0.0), ("symmetrie", 0.0), ("form", 0.0), ("ueber", 1.0)] },
    // per-voice analog drift (drift.rs); type 49 (appended after falter). Output -1..1: `fest` share of a constant per-voice offset,
    // the rest a slow random wander at `rate` Hz; `saat` seeds both (same graph, same drift).
    ArtDef { art: "drift", ein: &["rate", "fest"], aus: &["aus"], werte: &[], frei: &[("rate", 0.3), ("fest", 0.5), ("saat", 0.0)] },
    // Cypher Labor (labor.rs), a dual-channel feedback processor as one stereo sum point; type 50 (appended after drift).
    // Inputs and defaults in the order of `labor::EIN` and `labor::FREI`; `ueber` 0 base rate, 1 twice the rate with latency, 2 twice the rate without.
    ArtDef { art: "labor", ein: &crate::labor::EIN, aus: &["l", "r"], werte: &[], frei: &crate::labor::FREI },
    // Cypher Remix (remix.rs), a beat-synchronous remix station as one stereo sum point; type 51 (appended after labor).
    // Inputs and defaults in the order of `remix::EIN` and `remix::FREI`. No latency.
    ArtDef { art: "remix", ein: &crate::remix::EIN, aus: &["l", "r"], werte: &[], frei: &crate::remix::FREI },
    // Phase rotator (allpass.rs), first or second order all-pass; type 52 (appended after remix). `fc`, `fc2` in Hz; order 1 ignores `fc2`. No latency.
    ArtDef { art: "allpass", ein: &["x", "fc", "fc2"], aus: &["aus"], werte: &[], frei: &[("ordnung", 1.0)] },
    // Linkwitz-Riley crossover (kreuz.rs), 2 or 3 bands with a compensated sum; type 53 (appended after allpass). `fc1`, `fc2` in Hz; `baender` 2 leaves `mid` at 0 and ignores `fc2`. No latency.
    ArtDef { art: "kreuz", ein: &["x", "fc1", "fc2"], aus: &["lo", "mid", "hi"], werte: &[], frei: &[("baender", 2.0)] },
    // Chaos LFO (chaos.rs); type 54 (appended after kreuz). Lorenz (`form` 0) or Roessler (1) attractor per voice, `aus` and `aus2` in -1..1;
    // `rate` 0.01..50 is a speed (about swings per second), a rising edge on `trig` returns to the start state seeded by `saat`. No latency.
    ArtDef { art: "chaos", ein: &["rate", "trig"], aus: &["aus", "aus2"], werte: &[], frei: &[("rate", 1.0), ("form", 0.0), ("saat", 0.0)] },
    // Frequency shifter (schieber.rs); type 55 (appended after chaos). Hilbert pair plus quadrature oscillator: `auf` up and `ab` down by `hz` (-2000..2000 Hz). No latency.
    ArtDef { art: "schieber", ein: &["x", "hz"], aus: &["auf", "ab"], werte: &[], frei: &[("hz", 0.0)] },
    // Amiga sample voice (paula.rs); type 56 (appended after schieber). `plaetze` (named field, 1..32 slots with their own files) is the
    // bank; `platz` picks the slot (1-based, rounded, clamped), `start` 0..1 and `rueckwaerts` are read at the trigger. `quellrate` (Hz) and
    // `bits` are the chip's: the read index holds on the grid of min(quellrate, slot rate), the value is quantised to `bits`. No latency.
    ArtDef { art: "paula", ein: &["hz", "trig", "gate", "platz", "start", "rueckwaerts"], aus: &["l", "r"], werte: &[], frei: &[("quellrate", 16574.0), ("bits", 8.0)] },
    // Chip noise (lfsr.rs); type 57 (appended after paula). The 15-bit register of the NES (D19), clocked by `hz`; `kurz` 1 is the 93 step
    // period, 0 the 32767 step one. Output `aus` is -1 or 1. No latency.
    ArtDef { art: "lfsr", ein: &["hz"], aus: &["aus"], werte: &[], frei: &[("kurz", 0.0)] },
    // Dual-slope function generator (funktion.rs); type 58 (appended after lfsr). Attack-decay envelope, slew limiter, LFO and audio
    // oscillator in one: `x` is followed (up at `steigen`, down at `fallen`, seconds for a full 0..1 swing, 0.0001..60), a rising edge of
    // `trig` rises to 1 first, `halt` above 0.5 holds the top, `zyklus` above 0.5 restarts at the end of the fall, `form` -1 logarithmic
    // .. 0 linear .. +1 exponential, `tempo` (-8..8 octaves) multiplies both rates by 2^tempo per sample. `ende` is 1 for 1 ms when a
    // triggered or cycling fall has arrived, `steigt` is 1 while rising after a trigger. No latency.
    ArtDef { art: "funktion", ein: &["x", "trig", "halt", "steigen", "fallen", "form", "zyklus", "tempo"], aus: &["aus", "ende", "steigt"], werte: &[],
             frei: &[("x", 0.0), ("trig", 0.0), ("halt", 0.0), ("steigen", 0.01), ("fallen", 0.3), ("form", 0.0), ("zyklus", 0.0), ("tempo", 0.0)] },
    // Low-pass gate with a vactrol model (lpg.rs); type 59 (appended after funktion). The Buchla 292 of Parker and D'Angelo: `cv` (+ `versatz`,
    // clamped 0..1.5) drives a vactrol with a fast attack and a level-dependent slow decay (`abkling` 0.1..10 scales it), the vactrol sets
    // the resistance of the filter. `modus` 0 low-pass (with `reso` 0..1 feedback), 1 both, 2 VCA. A closed gate is exactly 0. No latency.
    ArtDef { art: "lpg", ein: &["x", "cv", "modus", "abkling", "reso", "versatz"], aus: &["aus"], werte: &[],
             frei: &[("x", 0.0), ("cv", 0.0), ("modus", 1.0), ("abkling", 1.0), ("reso", 0.0), ("versatz", 0.0)] },
    // Pin matrix (matrix.rs); type 60 (appended after lpg). 16 sources `e1`..`e16` to 16 destinations `a1`..`a16`: `a_j = sum_i w[i][j] * e_i`
    // per voice, `w = A + (B - A) * clamp(morph, 0, 1)` per sample, two weight sets A and B. The weights are not scalar values: the node
    // carries `zeilen` and `spalten` (16 labels each, required) and optional default `stifte` (`[satz, zeile, spalte, wert]`), and the
    // running program takes pin changes with `Programm::stift_setzen`. Edges into `e1`..`e16` always read the sample before (like
    // `leitung.x`), so a patch through the matrix can never be a cycle error; `a1`..`a16` feed the same sample. At most one per graph.
    // No latency.
    ArtDef { art: "matrix", ein: &["e1", "e2", "e3", "e4", "e5", "e6", "e7", "e8", "e9", "e10", "e11", "e12", "e13", "e14", "e15", "e16", "morph"],
             aus: &["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9", "a10", "a11", "a12", "a13", "a14", "a15", "a16"], werte: &[],
             frei: &[("morph", 0.0)] },
    // Note select (notenwahl.rs); type 61 (appended after matrix). `hz` of a `note` node in, the index 0..7 of the pad the note belongs to out
    // (for the `wahl` input of a selector). `n1`..`n8` are the pad notes (MIDI, -1 = not used); a note no pad owns plays the next pad below. No latency.
    ArtDef { art: "notenwahl", ein: &["hz"], aus: &["aus"], werte: &[],
             frei: &[("n1", -1.0), ("n2", -1.0), ("n3", -1.0), ("n4", -1.0), ("n5", -1.0), ("n6", -1.0), ("n7", -1.0), ("n8", -1.0)] },
];

/// Arts whose node carries a `datei` (a file in the sample root, read at translation).
const MIT_DATEI: [&str; 2] = ["sampler", "faltung"];

/// Einstellung des Bausteins `hall` ohne Knotenwerte: hall_dsp-Vorgabe, Werte aus D3 (Plan Slice 4a)
pub fn hall_vorgabe() -> hall_dsp::HallEinstellung {
    // Werte als f32 gecastet: der Bau-Arm liest die Knotenwerte als f32 (w() as f64); nur so sind Baustein und
    // Vergleichshall bitgleich (1.2f64 ≠ 1.2f32 as f64, Plan-Review gemessen)
    hall_dsp::HallEinstellung { mix: 0.3f32 as f64, decay_s: 2.0, groesse_ms: 60.0, pre_ms: 10.0, frueh: 0.5, breite: 1.0, tief_faktor: 1.2f32 as f64, hoch_faktor: 0.6f32 as f64, rahmen: 2, ..Default::default() }
}

fn ganz(w: f32, von: f32, bis: f32) -> bool { w.fract() == 0.0 && (von..=bis).contains(&w) }

/// Slot bank of a `paula` node (stage 4): 1..=32 slots with plausible values. Everything that does not need the files; the loop is
/// checked against the data length when the file is read. The error is the name of the field (`plaetze[3].grund`) and the reason.
fn pruefe_plaetze(p: &[PaulaPlatz]) -> Result<(), (String, &'static str)> {
    if !(1..=crate::paula::MAX_PLAETZE).contains(&p.len()) {
        return Err(("plaetze".to_string(), "1..32 slots"));
    }
    for (i, s) in p.iter().enumerate() {
        let f = |feld: &str, grund: &'static str| Err((format!("plaetze[{i}].{feld}"), grund));
        if let Some(n) = &s.name {
            if !(1..=22).contains(&n.chars().count()) {
                return f("name", "1..22 characters");
            }
        }
        if !(20.0..=2000.0).contains(&s.grund) {
            return f("grund", "20..2000 Hz");
        }
        if !(4000.0..=48_000.0).contains(&s.rate) {
            return f("rate", "4000..48000 Hz");
        }
        if s.schleife > 1 {
            return f("schleife", "0 or 1");
        }
        if s.schleife == 1 && s.s_laenge == 0 {
            return f("s_laenge", "a loop needs s_laenge of at least 1 frame");
        }
        if !(0.0..=1.0).contains(&s.pegel) {
            return f("pegel", "0..1");
        }
        if !(-8..=7).contains(&s.fein) {
            return f("fein", "-8..7 eighths of a semitone");
        }
    }
    Ok(())
}

/// Slice table of a `sampler` node (sampler A1, D1): 2..=65 entries, strictly rising, every slice at least 4 frames (the
/// Catmull-Rom read needs 4 points); with `frames` also the last entry at most `frames`.
fn pruefe_grenzen(g: &[u64], frames: Option<u64>) -> Result<(), &'static str> {
    if !(2..=65).contains(&g.len()) {
        return Err("2..65 entries (1..64 slices)");
    }
    if g.windows(2).any(|p| p[1] <= p[0]) {
        return Err("entries must rise strictly");
    }
    if g.windows(2).any(|p| p[1] - p[0] < 4) {
        return Err("a slice must have at least 4 frames");
    }
    if let Some(f) = frames {
        if g[g.len() - 1] > f {
            return Err("the last entry must not exceed the number of frames of the file");
        }
    }
    Ok(())
}

fn zonen_fehler(knoten: &str, e: crate::sampler::ZonenFehler) -> Fehler {
    let wert = match e.zone {
        Some(i) => format!("zonen[{i}].{}", e.feld),
        None => e.feld.to_string(),
    };
    Fehler::Zonen { knoten: knoten.to_string(), wert, grund: e.grund }
}

fn teile(adr: &str) -> Result<(&str, &str), Fehler> { adr.split_once('.').ok_or_else(|| Fehler::Adresse(adr.to_string())) }

pub fn uebersetze(json: &str, sr: f32) -> Result<Programm, Fehler> { uebersetze_mit_wurzel(json, sr, None) }

/// Like `uebersetze`, with a sample root for `sampler` nodes: the files `wurzel/<datei>` are read here, at translation, never
/// in the run (S10, D3). Without a root a sampler graph is an error (`Fehler::Datei`), there is no hidden default path.
pub fn uebersetze_mit_wurzel(json: &str, sr: f32, wurzel: Option<&Path>) -> Result<Programm, Fehler> {
    let g = Graph::lies(json).map_err(Fehler::Format)?;
    if !FORMATE.contains(&g.format.as_str()) {
        return Err(Fehler::FalschesFormat(g.format));
    }
    let g = crate::makro::aufloesen(g)?;
    let mut regler_namen = Vec::new();
    for (nr, name) in &g.regler_namen {
        match nr.parse::<usize>() {
            Ok(n) if (1..=REGLER).contains(&n) && nr == &n.to_string() => regler_namen.push((n, name.clone())),
            _ => return Err(Fehler::ReglerName(nr.clone())),
        }
    }
    if g.stimmen == 0 || g.stimmen > MAX_STIMMEN {
        return Err(Fehler::Stimmen(g.stimmen));
    }
    // Knoten: ID eindeutig, Art bekannt, Werte vollständig und ohne Fremde
    let mut art_von: BTreeMap<&str, &ArtDef> = BTreeMap::new();
    for k in &g.knoten {
        let def = ARTEN.iter().find(|a| a.art == k.art)
            .ok_or_else(|| Fehler::UnbekannteArt { knoten: k.id.clone(), art: k.art.clone() })?;
        if art_von.insert(k.id.as_str(), def).is_some() {
            return Err(Fehler::DoppelteId(k.id.clone()));
        }
        let erlaubt = |w: &str| def.werte.contains(&w) || def.ein.contains(&w) || def.frei.iter().any(|(f, _)| *f == w);
        if let Some(w) = k.werte.keys().find(|w| !erlaubt(w.as_str())) {
            return Err(Fehler::UnbekannterWert { knoten: k.id.clone(), wert: w.clone() });
        }
        if let Some((w, _)) = k.werte.iter().find(|(_, v)| !v.is_finite()) {
            return Err(Fehler::UnendlicherWert { knoten: k.id.clone(), wert: w.clone() });
        }
        if let Some(w) = def.werte.iter().find(|w| !k.werte.contains_key(**w)) {
            return Err(Fehler::FehlenderWert { knoten: k.id.clone(), wert: w.to_string() });
        }
        let w = |n: &str| k.werte.get(n).copied().or_else(|| def.frei.iter().find(|(f, _)| *f == n).map(|(_, v)| *v)).unwrap_or(0.0);
        let falsch = |wert: &str, grund| Err(Fehler::Wert { knoten: k.id.clone(), wert: wert.to_string(), grund });
        if k.datei.is_some() && !MIT_DATEI.contains(&def.art) {
            return falsch("datei", "datei is only allowed on sampler and faltung");
        }
        if MIT_DATEI.contains(&def.art) && k.datei.is_none() {
            return Err(Fehler::FehlenderWert { knoten: k.id.clone(), wert: "datei".to_string() });
        }
        if let Some(sp) = &k.spektren {
            if def.art != "wavetable" {
                return falsch("spektren", "spektren is only allowed on wavetable");
            }
            if let Err(grund) = crate::wavetable::pruefe_spektren(sp) {
                return falsch("spektren", grund);
            }
            if w("tabelle") != 0.0 {
                return falsch("spektren", "spektren replaces tabelle: tabelle must be absent or 0");
            }
        }
        if k.zeilen.is_some() && def.art != "matrix" {
            return falsch("zeilen", "zeilen is only allowed on matrix");
        }
        if k.spalten.is_some() && def.art != "matrix" {
            return falsch("spalten", "spalten is only allowed on matrix");
        }
        if k.stifte.is_some() && def.art != "matrix" {
            return falsch("stifte", "stifte is only allowed on matrix");
        }
        if def.art == "matrix" {
            match &k.zeilen {
                None => return Err(Fehler::FehlenderWert { knoten: k.id.clone(), wert: "zeilen".to_string() }),
                Some(z) => if let Err(grund) = crate::matrix::pruefe_namen(z) { return falsch("zeilen", grund); },
            }
            match &k.spalten {
                None => return Err(Fehler::FehlenderWert { knoten: k.id.clone(), wert: "spalten".to_string() }),
                Some(s) => if let Err(grund) = crate::matrix::pruefe_namen(s) { return falsch("spalten", grund); },
            }
            if let Some(st) = &k.stifte {
                if let Err(grund) = crate::matrix::pruefe_stifte(st) {
                    return falsch("stifte", grund);
                }
            }
            if g.knoten.iter().filter(|n| n.art == "matrix").count() > 1 {
                return falsch("art", "at most one matrix per graph");
            }
        }
        if k.grenzen.is_some() && def.art != "sampler" {
            return falsch("grenzen", "grenzen is only allowed on sampler");
        }
        if k.grenzen.is_some() && k.werte.contains_key("scheiben") {
            return falsch("scheiben", "grenzen replaces scheiben: scheiben must be absent");
        }
        if let Some(g) = &k.grenzen {
            if let Err(grund) = pruefe_grenzen(g, None) {
                return falsch("grenzen", grund);
            }
        }
        if let Some(z) = &k.zonen {
            if def.art != "sampler" {
                return falsch("zonen", "zonen is only allowed on sampler");
            }
            if k.grenzen.is_some() {
                return falsch("grenzen", "zonen replaces grenzen: grenzen must be absent");
            }
            if k.werte.contains_key("scheiben") {
                return falsch("scheiben", "zonen replaces scheiben: scheiben must be absent");
            }
            if w("noten_wahl") == 1.0 {
                return falsch("noten_wahl", "zonen excludes noten_wahl 1");
            }
            if w("schleife") == 1.0 {
                return falsch("schleife", "zonen excludes schleife 1");
            }
            if !(0.0..=500.0).contains(&w("loop_blende")) {
                return falsch("loop_blende", "0..500 ms");
            }
            for (feld, bis, einheit) in [("taste_blende", 24.0, "0..24 keys"), ("vel_blende", 127.0, "0..127 steps"), ("frei_halte", 60.0, "0..60 s")] {
                if !(0.0..=bis).contains(&w(feld)) {
                    return falsch(feld, einheit);
                }
            }
            if let Err(e) = ZonenTabelle::neu_mit(z, None, w("loop_blende") as f64) {
                return Err(zonen_fehler(&k.id, e));
            }
        } else {
            for feld in ["loop_blende", "taste_blende", "vel_blende", "frei_halte"] {
                if k.werte.contains_key(feld) {
                    return falsch(feld, "this value is only allowed with zonen (zone mode)");
                }
            }
        }
        if k.plaetze.is_some() && def.art != "paula" {
            return falsch("plaetze", "plaetze is only allowed on paula");
        }
        if def.art == "paula" {
            let Some(p) = &k.plaetze else {
                return Err(Fehler::FehlenderWert { knoten: k.id.clone(), wert: "plaetze".to_string() });
            };
            if let Err((wert, grund)) = pruefe_plaetze(p) {
                return Err(Fehler::Wert { knoten: k.id.clone(), wert, grund });
            }
        }
        match def.art {
            "sampler" if !(20.0..=2000.0).contains(&w("grund")) => return falsch("grund", "20..2000 Hz"),
            "sampler" if !ganz(w("scheiben"), 1.0, 64.0) => return falsch("scheiben", "integer 1..64"),
            "sampler" if !ganz(w("schleife"), 0.0, 1.0) => return falsch("schleife", "0 or 1"),
            "sampler" if !ganz(w("noten_wahl"), 0.0, 1.0) => return falsch("noten_wahl", "0 or 1"),
            "sampler" if w("noten_wahl") == 1.0 && w("schleife") == 1.0 => return falsch("schleife", "noten_wahl 1 needs schleife 0"),
            "regler" if !ganz(w("nr"), 1.0, REGLER as f32) => return falsch("nr", "1..64"),
            "regler" if !ganz(w("log"), 0.0, 1.0) => return falsch("log", "0 or 1"),
            "regler" if !ganz(w("rastet"), 0.0, 1.0) => return falsch("rastet", "0 or 1"),
            "regler" if !(0.0..=1.0).contains(&w("vorgabe")) => return falsch("vorgabe", "0..1"),
            "regler" if !w("mitte").is_nan() && w("vorgabe") != 0.5 => return falsch("mitte", "needs vorgabe 0.5"),
            "regler" if !w("mitte").is_nan() && w("log") == 1.0 && !(w("min") > 0.0) => return falsch("mitte", "with log needs min > 0"),
            "regler" if !w("mitte").is_nan() && !((w("min") < w("mitte") && w("mitte") < w("max")) || (w("max") < w("mitte") && w("mitte") < w("min"))) =>
                return falsch("mitte", "strictly between min and max"),
            "regler" if w("log") == 1.0 && !(w("min") > 0.0 && w("max") > 0.0) => return falsch("min", "log needs min > 0 and max > 0"),
            "lfo" if !ganz(w("form"), 0.0, 4.0) => return falsch("form", "0 sine, 1 triangle, 2 saw, 3 square, 4 random"),
            "lfo" if !ganz(w("neustart"), 0.0, 1.0) => return falsch("neustart", "0 or 1"),
            "lfo" if !(0.0..=256.0).contains(&w("takt")) => return falsch("takt", "0..256 beats"),
            "lfo" if !(0.0..=4096.0).contains(&w("versatz")) => return falsch("versatz", "0..4096 beats"),
            "lfo" if !ganz(w("einmal"), 0.0, 1.0) => return falsch("einmal", "0 or 1"),
            // offset and one-shot are defined against the host beat; a free-running lfo has none
            "lfo" if w("takt") == 0.0 && (w("versatz") != 0.0 || w("einmal") == 1.0) => return falsch("takt", "versatz and einmal need takt > 0"),
            "sh" if !(0.0..=256.0).contains(&w("takt")) => return falsch("takt", "0..256 beats"),
            "sh" if !(0.0..=crate::sh::GLATT_MAX_MS).contains(&w("glatt")) => return falsch("glatt", "0..10000 ms"),
            "drift" if !(0.0..=crate::drift::MAX_RATE).contains(&w("rate")) => return falsch("rate", "0..20 Hz"),
            "drift" if !(0.0..=1.0).contains(&w("fest")) => return falsch("fest", "0..1"),
            "drift" if !ganz(w("saat"), 0.0, 65_535.0) => return falsch("saat", "integer 0..65535"),
            "folger" if !(0.0..=10_000.0).contains(&w("an")) => return falsch("an", "0..10000 ms"),
            "folger" if !(0.0..=10_000.0).contains(&w("ab")) => return falsch("ab", "0..10000 ms"),
            "mseg" if !ganz(w("stufen"), 1.0, 8.0) => return falsch("stufen", "integer 1..8"),
            "mseg" if !ganz(w("halt"), 0.0, w("stufen")) => return falsch("halt", "integer 0..stufen (0 = no sustain stage)"),
            "mseg" if !ganz(w("von"), 0.0, w("stufen")) => return falsch("von", "integer 0..stufen (0 = no loop)"),
            "mseg" if !ganz(w("bis"), 0.0, w("stufen")) => return falsch("bis", "integer 0..stufen"),
            "mseg" if w("von") > 0.0 && w("bis") < w("von") => return falsch("bis", "a loop needs von <= bis"),
            "mseg" if w("von") > 0.0 && w("halt") != 0.0 => return falsch("halt", "a loop replaces the sustain stage: halt must be 0 with von > 0"),
            "mseg" if w("von") == 0.0 && w("bis") != 0.0 => return falsch("bis", "bis needs von > 0"),
            "mseg" if (1..=8).any(|i| !(0.0..=1.0).contains(&w(&format!("p{i}")))) => return falsch("p1..p8", "level 0..1"),
            "mseg" if (1..=8).any(|i| !(0.0..=60.0).contains(&w(&format!("t{i}")))) => return falsch("t1..t8", "time 0..60 s"),
            "mseg" if (1..=8).any(|i| !(-1.0..=1.0).contains(&w(&format!("k{i}")))) => return falsch("k1..k8", "curve -1..1"),
            "delay" if !(0.0..=16.0).contains(&w("takt")) => return falsch("takt", "0..16 beats"),
            "hall" if !ganz(w("rahmen"), 0.0, 4.0) => return falsch("rahmen", "0..4 (512 .. 8192)"),
            "hall" if !(w("decay") > 0.0 && w("decay") <= 30.0) => return falsch("decay", "> 0 and <= 30 seconds"),
            "hall" if !(5.0..=200.0).contains(&w("groesse")) => return falsch("groesse", "5..200 ms"),
            "hall" if !(0.0..=250.0).contains(&w("pre")) => return falsch("pre", "0..250 ms"),
            "hall" if !(0.0..=1.0).contains(&w("frueh")) => return falsch("frueh", "0..1"),
            "hall" if !(0.0..=1.0).contains(&w("breite")) => return falsch("breite", "0..1"),
            "hall" if !(0.05..=4.0).contains(&w("tief")) => return falsch("tief", "0.05..4"),
            "hall" if !(0.05..=4.0).contains(&w("hoch")) => return falsch("hoch", "0.05..4"),
            "delay" if !(10.0..=4000.0).contains(&w("max")) => return falsch("max", "10..4000 ms"),
            // nur ein ausdrücklicher Wert; mit Kante gilt die Vorgabe 375 nicht und `max` darf kleiner sein (Plan-Review)
            "delay" if k.werte.contains_key("zeit") && !(1.0..=w("max")).contains(&w("zeit")) => return falsch("zeit", "1 ms ..= max"),
            "delay" if !(0.0..=crate::echo::FB_MAX).contains(&w("fb")) => return falsch("fb", "0..0.98"),
            "delay" if !(0.0..=1.0).contains(&w("mix")) => return falsch("mix", "0..1"),
            "delay" if !(w("daempf") == 0.0 || (200.0..=20_000.0).contains(&w("daempf"))) => return falsch("daempf", "0 off or 200..20000 Hz"),
            "delay" if !(0.0..=2000.0).contains(&w("glatt")) => return falsch("glatt", "0..2000 ms"),
            "delay" if !ganz(w("pingpong"), 0.0, 1.0) => return falsch("pingpong", "0 or 1"),
            "limiter" if !(-24.0..=0.0).contains(&w("decke")) => return falsch("decke", "-24..0 dBFS"),
            "limiter" if !(0.5..=5.0).contains(&w("vorlauf")) => return falsch("vorlauf", "0.5..5 ms"),
            "limiter" if !(1.0..=1000.0).contains(&w("release")) => return falsch("release", "1..1000 ms"),
            "leitung" if !(1.0..=2000.0).contains(&w("max")) => return falsch("max", "1..2000 ms"),
            // key inputs take edges only: a value would be silently ignored (S9, D1)
            "gate" | "komp" if k.werte.contains_key("kl") || k.werte.contains_key("kr") => return falsch("kl", "key inputs take edges only"),
            "gate" if !(-90.0..=0.0).contains(&w("schwelle")) => return falsch("schwelle", "-90..0 dBFS"),
            "gate" if !(0.0..=24.0).contains(&w("hyst")) => return falsch("hyst", "0..24 dB"),
            "gate" if !(0.0..=120.0).contains(&w("tiefe")) => return falsch("tiefe", "0..120 dB"),
            "gate" if !(0.1..=100.0).contains(&w("attack")) => return falsch("attack", "0.1..100 ms"),
            "gate" if !(1.0..=5000.0).contains(&w("release")) => return falsch("release", "1..5000 ms"),
            "komp" if !(-60.0..=0.0).contains(&w("schwelle")) => return falsch("schwelle", "-60..0 dBFS"),
            "komp" if !(1.0..=20.0).contains(&w("ratio")) => return falsch("ratio", "1..20"),
            "komp" if !(0.0..=24.0).contains(&w("knie")) => return falsch("knie", "0..24 dB"),
            "komp" if !(0.1..=200.0).contains(&w("attack")) => return falsch("attack", "0.1..200 ms"),
            "komp" if !(5.0..=2000.0).contains(&w("release")) => return falsch("release", "5..2000 ms"),
            "komp" if !(-12.0..=24.0).contains(&w("makeup")) => return falsch("makeup", "-12..24 dB"),
            "komp" if !(0.0..=1.0).contains(&w("mix")) => return falsch("mix", "0..1"),
            "komp" if !(w("schp") == 0.0 || (20.0..=500.0).contains(&w("schp"))) => return falsch("schp", "0 off or 20..500 Hz"),
            "chorus" if !ganz(w("modus"), 0.0, 3.0) => return falsch("modus", "0 off, 1 = I, 2 = II, 3 = I+II"),
            "phaser" if !(ganz(w("stufen"), 2.0, 12.0) && w("stufen") % 2.0 == 0.0) => return falsch("stufen", "even integer 2..12"),
            "phaser" if !(w("tief") > 0.0 && w("tief") < w("hoch") && w("hoch") < sr * 0.5) => return falsch("tief", "0 < tief < hoch < sr/2"),
            "vocoder" if !(0.5..=100.0).contains(&w("attack")) => return falsch("attack", "0.5..100 ms"),
            "vocoder" if !(5.0..=1000.0).contains(&w("release")) => return falsch("release", "5..1000 ms"),
            "vocoder" if w("pole") != 2.0 && w("pole") != 4.0 => return falsch("pole", "2 or 4"),
            // the 6 kHz sibilance high-pass needs fc < 0.45 * sr, the top band centre is 5 kHz
            "vocoder" if sr < 13_000.0 => return falsch("sr", "sample rate >= 13 kHz"),
            "faltung" if !(0.0..=1.0).contains(&w("mix")) => return falsch("mix", "0..1"),
            "faltung" if !(0.0..=250.0).contains(&w("pre")) => return falsch("pre", "0..250 ms"),
            "faltung" if !(1.0..=2000.0).contains(&w("laenge_max")) => return falsch("laenge_max", "1..2000 ms"),
            // IR files are 48 kHz frames and are never resampled: a resampled IR would silently change the sound
            "faltung" if sr != 48_000.0 => return falsch("sr", "faltung needs 48 kHz (IR files are 48 kHz frames)"),
            "roehre" if !ganz(w("stufen"), 1.0, 2.0) => return falsch("stufen", "1 or 2"),
            "roehre" if !(BIAS_MIN as f32..=BIAS_MAX as f32).contains(&w("bias")) => return falsch("bias", "-3..-0.5 volts"),
            "diode" if !(-40.0..=60.0).contains(&w("antrieb")) => return falsch("antrieb", "-40..60 dB"),
            "diode" if !(0.0..=1.0).contains(&w("bass")) => return falsch("bass", "0..1"),
            "svf" if w("pole") != 2.0 && w("pole") != 4.0 => return falsch("pole", "2 or 4"),
            "chaos" if !(crate::chaos::MIN_RATE..=crate::chaos::MAX_RATE).contains(&w("rate")) => return falsch("rate", "0.01..50"),
            "chaos" if !ganz(w("form"), 0.0, 1.0) => return falsch("form", "0 Lorenz, 1 Roessler"),
            "chaos" if !ganz(w("saat"), 0.0, 65_535.0) => return falsch("saat", "integer 0..65535"),
            "schieber" if !(-crate::schieber::MAX_HZ..=crate::schieber::MAX_HZ).contains(&w("hz")) => return falsch("hz", "-2000..2000 Hz"),
            "allpass" if w("ordnung") != 1.0 && w("ordnung") != 2.0 => return falsch("ordnung", "1 or 2"),
            "paula" if !(4000.0..=48_000.0).contains(&w("quellrate")) => return falsch("quellrate", "4000..48000 Hz"),
            "paula" if !ganz(w("bits"), 4.0, 16.0) => return falsch("bits", "integer 4..16"),
            "lfsr" if !ganz(w("kurz"), 0.0, 1.0) => return falsch("kurz", "0 or 1"),
            "notenwahl" if !(1..=8).all(|i| ganz(w(&format!("n{i}")), -1.0, 127.0)) => return falsch("n1..n8", "integer -1..127"),
            "funktion" if !(crate::funktion::ZEIT_MIN as f32..=crate::funktion::ZEIT_MAX as f32).contains(&w("steigen")) => return falsch("steigen", "0.0001..60 s"),
            "funktion" if !(crate::funktion::ZEIT_MIN as f32..=crate::funktion::ZEIT_MAX as f32).contains(&w("fallen")) => return falsch("fallen", "0.0001..60 s"),
            "funktion" if !(-1.0..=1.0).contains(&w("form")) => return falsch("form", "-1..1"),
            "funktion" if !(-8.0..=8.0).contains(&w("tempo")) => return falsch("tempo", "-8..8 octaves"),
            "lpg" if !(0.0..=1.5).contains(&w("cv")) => return falsch("cv", "0..1.5"),
            "lpg" if !(-1.5..=1.5).contains(&w("versatz")) => return falsch("versatz", "-1.5..1.5"),
            "lpg" if !(0.0..=2.0).contains(&w("modus")) => return falsch("modus", "0 low-pass, 1 both, 2 VCA"),
            "lpg" if !(0.1..=10.0).contains(&w("abkling")) => return falsch("abkling", "0.1..10"),
            "lpg" if !(0.0..=1.0).contains(&w("reso")) => return falsch("reso", "0..1"),
            "kreuz" if w("baender") != 2.0 && w("baender") != 3.0 => return falsch("baender", "2 or 3"),
            "sem" if !(0.0..=1.0).contains(&w("reso")) => return falsch("reso", "0..1"),
            "sem" if !(0.0..=1.0).contains(&w("form")) => return falsch("form", "0 low-pass, 0.5 notch, 1 high-pass"),
            "wavetable" if !ganz(w("tabelle"), 0.0, (TABELLEN.len() - 1) as f32) => return falsch("tabelle", "0 saege, 1 rechteck, 2 dreieck, 3 sinus, 4 analog, 5 vokale, 6 orgel"),
            "wavetable" if !ganz(w("kopien"), 1.0, crate::wavetable::MAX_KOPIEN as f32) => return falsch("kopien", "integer 1..7"),
            "wavetable" if !(0.0..=1.0).contains(&w("pos")) => return falsch("pos", "0..1"),
            "wavetable" if !(0.0..=crate::wavetable::MAX_VERSTIMMUNG).contains(&w("verstimmung")) => return falsch("verstimmung", "0..50 cent"),
            "wavetable" if !(0.0..=1.0).contains(&w("breite")) => return falsch("breite", "0..1"),
            "wavetable" if !(0.0..=1.0).contains(&w("zufall")) => return falsch("zufall", "0..1"),
            "wavetable" if !ganz(w("reserve"), 0.0, 3.0) => return falsch("reserve", "integer 0..3"),
            "wavetable" if !ganz(w("saat"), 0.0, 65_535.0) => return falsch("saat", "integer 0..65535"),
            "wavetable" if !(0.0..=1000.0).contains(&w("glatt")) => return falsch("glatt", "0..1000 ms"),
            "resonator" if !ganz(w("satz"), 0.0, (SAETZE.len() - 1) as f32) => return falsch("satz", "0 stab, 1 marimba, 2 glocke, 3 glas, 4 holzblock, 5 membran, 6 platte"),
            "resonator" if !ganz(w("moden"), 1.0, crate::resonator::MAX_MODEN as f32) => return falsch("moden", "integer 1..32"),
            "resonator" if !ganz(w("anregung"), 0.0, 1.0) => return falsch("anregung", "0 impulse, 1 noise burst"),
            "resonator" if !(crate::resonator::BURST_MIN_MS..=crate::resonator::BURST_MAX_MS).contains(&w("burst")) => return falsch("burst", "0.5..50 ms"),
            "resonator" if !ganz(w("saat"), 0.0, 65_535.0) => return falsch("saat", "integer 0..65535"),
            "resonator" if !(0.0..=crate::resonator::STAERKE_MAX).contains(&w("staerke")) => return falsch("staerke", "0..10"),
            "resonator" if !(0.0..=1.0).contains(&w("material")) => return falsch("material", "0..1"),
            "resonator" if !(0.0..=1.0).contains(&w("helligkeit")) => return falsch("helligkeit", "0..1"),
            "resonator" if !(crate::resonator::GROESSE_MIN..=crate::resonator::GROESSE_MAX).contains(&w("groesse")) => return falsch("groesse", "0.25..4"),
            "resonator" if !(0.0..=1.0).contains(&w("position")) => return falsch("position", "0..1"),
            "resonator" if !(0.0..=crate::resonator::INHARMONIE_MAX).contains(&w("inharmonie")) => return falsch("inharmonie", "0..2"),
            "metall" if !(0.0..=1.0).contains(&w("vel")) => return falsch("vel", "0..1"),
            "metall" if !(crate::metall::DECAY_MIN..=crate::metall::DECAY_MAX).contains(&w("decay")) => return falsch("decay", "0.01..10 seconds to -60 dB"),
            "metall" if !(crate::metall::TUNE_MIN..=crate::metall::TUNE_MAX).contains(&w("tune")) => return falsch("tune", "0.5..2 (factor on the six frequencies)"),
            "metall" if !(0.0..=1.0).contains(&w("farbe")) => return falsch("farbe", "0..1"),
            "metall" if !(0.0..=1.0).contains(&w("rauschen")) => return falsch("rauschen", "0..1"),
            "metall" if !(crate::metall::HP_MIN..=crate::metall::HP_MAX).contains(&w("hp")) => return falsch("hp", "500..16000 Hz"),
            "metall" if !(crate::metall::SCHNITT_MIN..=crate::metall::SCHNITT_MAX).contains(&w("schnitt")) => return falsch("schnitt", "1..100 ms to -60 dB"),
            "metall" if w("gruppe") != 0.0 && w("gruppe") != 1.0 => return falsch("gruppe", "0 or 1"),
            "metall" if !ganz(w("saat"), 0.0, 65_535.0) => return falsch("saat", "integer 0..65535"),
            "granular" if !ganz(w("quelle"), 0.0, (crate::granular::QUELLEN.len() - 1) as f32) => return falsch("quelle", "0 wavetable, 1 puffer (input x), 2 rauschen"),
            "granular" if !ganz(w("tabelle"), 0.0, (TABELLEN.len() - 1) as f32) => return falsch("tabelle", "0 saege, 1 rechteck, 2 dreieck, 3 sinus, 4 analog, 5 vokale, 6 orgel"),
            "granular" if !(crate::granular::PUFFER_MIN_S..=crate::granular::PUFFER_MAX_S).contains(&w("puffer")) => return falsch("puffer", "0.05..10 seconds"),
            "granular" if !(20.0..=2000.0).contains(&w("grund")) => return falsch("grund", "20..2000 Hz"),
            "granular" if !(0.0..=1.0).contains(&w("streuung")) => return falsch("streuung", "0..1"),
            "granular" if !ganz(w("saat"), 0.0, 65_535.0) => return falsch("saat", "integer 0..65535"),
            "granular" if !(0.0..=20_000.0).contains(&w("hz")) => return falsch("hz", "0..20000 Hz"),
            "granular" if !(crate::granular::GROESSE_MIN_MS..=crate::granular::GROESSE_MAX_MS).contains(&w("groesse")) => return falsch("groesse", "1..2000 ms"),
            "granular" if !(0.0..=crate::granular::MAX_DICHTE).contains(&w("dichte")) => return falsch("dichte", "0..1000 grains per second"),
            "granular" if !(0.0..=1.0).contains(&w("pos")) => return falsch("pos", "0..1"),
            "granular" if !(0.0..=1.0).contains(&w("pos_zufall")) => return falsch("pos_zufall", "0..1"),
            "granular" if !(-crate::granular::MAX_TONHOEHE..=crate::granular::MAX_TONHOEHE).contains(&w("tonhoehe")) => return falsch("tonhoehe", "-48..48 semitones"),
            "granular" if !(0.0..=crate::granular::MAX_TON_ZUFALL).contains(&w("ton_zufall")) => return falsch("ton_zufall", "0..1200 cent"),
            "granular" if !(0.0..=1.0).contains(&w("breite")) => return falsch("breite", "0..1"),
            "granular" if !(0.0..=1.0).contains(&w("fenster")) => return falsch("fenster", "0..1"),
            "saite" if !ganz(w("anreger"), 0.0, (ANREGER.len() - 1) as f32) => return falsch("anreger", "0 rauschen, 1 zupfen, 2 hammer, 3 keiner"),
            "saite" if !ganz(w("koerper"), 0.0, (KOERPER.len() - 1) as f32) => return falsch("koerper", "0 keiner, 1 gitarre, 2 harfe, 3 klavier"),
            "saite" if !ganz(w("saat"), 0.0, 65_535.0) => return falsch("saat", "integer 0..65535"),
            "saite" if !(0.0..=1.0).contains(&w("vel")) => return falsch("vel", "0..1"),
            "saite" if !(crate::saite::AUSKLANG_MIN..=crate::saite::AUSKLANG_MAX).contains(&w("ausklang")) => return falsch("ausklang", "0.01..60 seconds"),
            "saite" if !(0.0..=1.0).contains(&w("daempfung")) => return falsch("daempfung", "0..1"),
            "saite" if !(0.0..=1.0).contains(&w("hell")) => return falsch("hell", "0..1"),
            "saite" if !(crate::saite::LAGE_MIN..=crate::saite::LAGE_MAX).contains(&w("lage")) => return falsch("lage", "0.02..0.5"),
            "saite" if !(0.0..=1.0).contains(&w("koerper_mix")) => return falsch("koerper_mix", "0..1"),
            "ms20" if !ganz(w("modus"), 0.0, 2.0) => return falsch("modus", "0 both outputs, 1 only tp, 2 only hp"),
            "saite" if k.werte.contains_key("hz") && !(crate::saite::MIN_HZ as f32..=crate::saite::MAX_HZ_ANTEIL as f32 * sr).contains(&w("hz")) => return falsch("hz", "20 Hz ..= sr / 8"),
            "kamm" if sr < 44_100.0 => return falsch("sr", "sample rate >= 44.1 kHz"),
            "kamm" if !(crate::kamm::MIN_HZ as f32..=crate::kamm::MAX_HZ_ANTEIL as f32 * 2.0 * sr).contains(&w("hz")) => return falsch("hz", "20 Hz ..= 0.4 sr"),
            "kamm" if !(-1.0..=1.0).contains(&w("fb")) => return falsch("fb", "-1..1"),
            "kamm" if !(0.0..=1.0).contains(&w("daempf")) => return falsch("daempf", "0..1"),
            "kamm" if !(0.0..=1.0).contains(&w("mix")) => return falsch("mix", "0..1"),
            "formant" if !(0.0..=4.0).contains(&w("vokal")) => return falsch("vokal", "0..4 (a e i o u)"),
            "formant" if !(-24.0..=24.0).contains(&w("versatz")) => return falsch("versatz", "-24..24 semitones"),
            "formant" if !(0.0..=1.0).contains(&w("q")) => return falsch("q", "0..1"),
            "formant" if !(0.0..=1.0).contains(&w("mix")) => return falsch("mix", "0..1"),
            "wahl" if !ganz(w("n"), 2.0, crate::wahl::MAX_EIN as f32) => return falsch("n", "integer 2..8"),
            "wahl" if !ganz(w("norm"), 0.0, 1.0) => return falsch("norm", "0 index, 1 normalised 0..1"),
            "wahl" if !ganz(w("modus"), 0.0, 1.0) => return falsch("modus", "0 switch, 1 morph"),
            "wahl" if !(0.0..=crate::wahl::BLENDE_MAX_MS).contains(&w("blende")) => return falsch("blende", "0..5000 ms (0 = hard switch)"),
            "falter" if !(0.0..=1.0).contains(&w("ueber")) || w("ueber").fract() != 0.0 => return falsch("ueber", "0 base rate (no latency) or 1 oversampled 2x"),
            "labor" if !(0.0..=2.0).contains(&w("ueber")) || w("ueber").fract() != 0.0 => return falsch("ueber", "0 base rate, 1 oversampled 2x linear phase (latency) or 2 oversampled 2x without latency"),
            "glatt" if !(w("zeit") >= 0.0) => return falsch("zeit", ">= 0 seconds"),
            "trommeln" => if let Some((wert, grund)) = crate::trommeln::pruefe(&w) { return falsch(&wert, grund); },
            "fm" => if let Some((wert, grund)) = crate::fm::pruefe(&w) { return falsch(&wert, grund); },
            // hard sync: a fixed value would reset the phase in every sample
            "saege" | "puls" | "dreieck" if k.werte.contains_key("hart") => return falsch("hart", "hart takes edges only (a master's hart output)"),
            _ => {}
        }
    }
    if g.knoten.iter().filter(|k| k.art == "note").count() > 1 {
        return Err(Fehler::MehrereNoten);
    }
    if g.knoten.iter().filter(|k| k.art == "eingang").count() > 1 {
        return Err(Fehler::MehrereEingaenge);
    }
    if !g.knoten.iter().any(|k| k.art == "ausgang") {
        return Err(Fehler::KeinAusgang);
    }
    // Kanten prüfen; je Eingang höchstens eine Kante
    let mut eingang: BTreeMap<(String, String), (String, String, bool)> = BTreeMap::new();
    for e in &g.kanten {
        let (vk, vp) = teile(&e.von)?;
        let (nk, np) = teile(&e.nach)?;
        let vdef = art_von.get(vk).ok_or_else(|| Fehler::UnbekannterKnoten(vk.to_string()))?;
        let ndef = art_von.get(nk).ok_or_else(|| Fehler::UnbekannterKnoten(nk.to_string()))?;
        if !vdef.aus.contains(&vp) {
            return Err(Fehler::UnbekannterPort(e.von.clone()));
        }
        if !ndef.ein.contains(&np) {
            return Err(Fehler::UnbekannterPort(e.nach.clone()));
        }
        if e.verzoegerung > 1 {
            return Err(Fehler::Verzoegerung(format!("{} -> {}", e.von, e.nach)));
        }
        let schluessel = (nk.to_string(), np.to_string());
        if eingang.contains_key(&schluessel) {
            return Err(Fehler::MehrfachEingang(e.nach.clone()));
        }
        // die Kante in leitung.x liest immer das Sample davor (D3): ein Kreis durch eine Leitung ist kein Fehler
        // the same holds for the inputs of a matrix (`e1`..`e16`): its outputs feed the same sample, the inputs read the sample before
        let verz = e.verzoegerung == 1 || (ndef.art == "leitung" && np == "x") || (ndef.art == "matrix" && np.starts_with('e'));
        eingang.insert(schluessel, (vk.to_string(), vp.to_string(), verz));
    }
    // Reihenfolge (Kahn), nur über Kanten ohne Verzögerung; bereit = sortierte Menge der IDs
    let mut offen: BTreeMap<&str, usize> = art_von.keys().map(|k| (*k, 0usize)).collect();
    let mut nachfolger: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    for ((nk, _), (vk, _, verz)) in &eingang {
        if !verz {
            *offen.get_mut(nk.as_str()).unwrap() += 1;
            nachfolger.entry(vk.as_str()).or_default().push(nk.as_str());
        }
    }
    let mut bereit: BTreeSet<&str> = offen.iter().filter(|(_, n)| **n == 0).map(|(k, _)| *k).collect();
    let mut reihe: Vec<&str> = Vec::new();
    while let Some(k) = bereit.pop_first() {
        reihe.push(k);
        for n in nachfolger.get(k).into_iter().flatten() {
            let z = offen.get_mut(n).unwrap();
            *z -= 1;
            if *z == 0 {
                bereit.insert(n);
            }
        }
    }
    if reihe.len() < art_von.len() {
        let im_kreis: Vec<String> = offen.iter().filter(|(_, n)| **n > 0).map(|(k, _)| k.to_string()).collect();
        return Err(Fehler::Schleife(im_kreis));
    }
    // Slots: je Ausgangsport einer, in Reihenfolge der Schritte
    let mut slot: BTreeMap<(String, String), usize> = BTreeMap::new();
    for k in &reihe {
        for p in art_von[k].aus {
            let n = slot.len();
            slot.insert((k.to_string(), p.to_string()), n);
        }
    }
    let mut verzoegert: BTreeSet<usize> = BTreeSet::new();
    let knoten: BTreeMap<&str, &crate::format::Knoten> = g.knoten.iter().map(|k| (k.id.as_str(), k)).collect();
    let quelle = |k: &str, p: &str, verzoegert: &mut BTreeSet<usize>| -> Quelle {
        match eingang.get(&(k.to_string(), p.to_string())) {
            // ohne Kante: der gleichnamige feste Wert des Knotens, sonst die Vorgabe der Art (chorus.mix 1), sonst 0
            None => Quelle::Fest(knoten[k].werte.get(p).copied()
                .or_else(|| art_von[k].frei.iter().find(|(f, _)| *f == p).map(|(_, v)| *v))
                .unwrap_or(0.0)),
            Some((vk, vp, verz)) => {
                let s = slot[&(vk.clone(), vp.clone())];
                if *verz {
                    verzoegert.insert(s);
                    Quelle::Vorher(s)
                } else {
                    Quelle::Slot(s)
                }
            }
        }
    };
    let aus = |k: &str, p: &str| slot[&(k.to_string(), p.to_string())];
    // the key is active iff at least one of kl, kr has an edge (S9, D2)
    // one connected side feeds both (S9, D2): an unconnected key side reads the other side's source
    let schluessel_quelle = |k: &str, p: &str, q: &mut dyn FnMut(&str) -> Quelle| -> Quelle {
        let andere = if p == "kl" { "kr" } else { "kl" };
        let hat = |p: &str| eingang.contains_key(&(k.to_string(), p.to_string()));
        if !hat(p) && hat(andere) { q(andere) } else { q(p) }
    };
    let schluessel_aktiv = |k: &str| ["kl", "kr"].iter().any(|p| eingang.contains_key(&(k.to_string(), p.to_string())));
    // hard sync: the `hart` input is active only with an edge; it excludes the old `sync` input
    let hart_ein = |k: &str, q: &mut dyn FnMut(&str) -> Quelle| -> Result<Option<Quelle>, Fehler> {
        let hat = |p: &str| eingang.contains_key(&(k.to_string(), p.to_string()));
        match (hat("hart"), hat("sync")) {
            (false, _) => Ok(None),
            (true, false) => Ok(Some(q("hart"))),
            (true, true) => Err(Fehler::Wert { knoten: k.to_string(), wert: "hart".to_string(), grund: "hart and sync exclude each other" }),
        }
    };
    let mut schritte = Vec::with_capacity(reihe.len());
    let mut geladen = 0usize;
    let mut lat: BTreeMap<&str, usize> = BTreeMap::new();
    for k in &reihe {
        let def = art_von[k];
        let w = |n: &str| knoten[k].werte.get(n).copied().or_else(|| def.frei.iter().find(|(f, _)| *f == n).map(|(_, v)| *v)).unwrap_or(0.0);
        // Latenz (D4): eigene plus die größte der Eingänge ohne Verzögerung; `reihe` ist topologisch, die Quellen stehen schon
        let eigen = match def.art {
            "limiter" => vorlauf(w("vorlauf"), sr) - 1,
            "faltung" => crate::faltung::LATENZ,
            "falter" if w("ueber") == 1.0 => crate::falter::LATENZ,
            "labor" => crate::labor::latenz(sr, w("ueber")),
            _ => 0,
        };
        let vor = def.ein.iter()
            .filter_map(|p| eingang.get(&(k.to_string(), p.to_string())))
            .filter(|(_, _, verz)| !*verz)
            .map(|(vk, _, _)| lat[vk.as_str()])
            .max()
            .unwrap_or(0);
        lat.insert(*k, vor + eigen);
        let mut q = |p: &str| quelle(k, p, &mut verzoegert);
        let s = match def.art {
            "note" => Schritt::Note { hz: aus(k, "hz"), gate: aus(k, "gate"), vel: aus(k, "vel"), trig: aus(k, "trig"), erste: aus(k, "erste") },
            "konst" => Schritt::Konst { aus: aus(k, "aus"), wert: w("wert") },
            "regler" => Schritt::Regler { aus: aus(k, "aus"), nr: w("nr") as usize - 1, min: w("min"), max: w("max"), log: w("log") == 1.0, mitte: Some(w("mitte")).filter(|m| !m.is_nan()) },
            "saege" => Schritt::Saege { hz: q("hz"), sync: q("sync"), aus: aus(k, "aus"), zyklus: aus(k, "zyklus"), osz: [Osz::default(); MAX_STIMMEN], hart: hart_ein(k, &mut q)?, hart_aus: aus(k, "hart") },
            "puls" => Schritt::Puls { hz: q("hz"), pwm: q("pwm"), sync: q("sync"), aus: aus(k, "aus"), zyklus: aus(k, "zyklus"), osz: [Osz::default(); MAX_STIMMEN], hart: hart_ein(k, &mut q)?, hart_aus: aus(k, "hart") },
            "dreieck" => Schritt::Dreieck { hz: q("hz"), sync: q("sync"), aus: aus(k, "aus"), zyklus: aus(k, "zyklus"), osz: [Osz::default(); MAX_STIMMEN], hart: hart_ein(k, &mut q)?, hart_aus: aus(k, "hart") },
            "sinus" => Schritt::Sinus { hz: q("hz"), fm: q("fm"), sync: q("sync"), aus: aus(k, "aus"), zyklus: aus(k, "zyklus"), osz: [Sinus::default(); MAX_STIMMEN], hart_aus: aus(k, "hart") },
            "rauschen" => Schritt::Rauschen { aus: aus(k, "aus"), r: std::array::from_fn(Rauschen::neu) },
            "lfo" => Schritt::Lfo { rate: q("rate"), trig: q("trig"), aus: aus(k, "aus"), form: w("form") as u8, neustart: w("neustart") == 1.0, takt: w("takt"), versatz: w("versatz") as f64, einmal: w("einmal") == 1.0, l: std::array::from_fn(Lfo::neu) },
            "sh" => Schritt::Sh { x: q("x"), trig: q("trig"), rate: q("rate"), glatt: q("glatt"), aus: aus(k, "aus"),
                                 x_ext: eingang.contains_key(&(k.to_string(), "x".to_string())),
                                 trig_ext: eingang.contains_key(&(k.to_string(), "trig".to_string())),
                                 takt: w("takt"), s: std::array::from_fn(Sh::neu) },
            "mseg" => {
                let n = |i: usize, p: &str| w(&format!("{p}{i}"));
                Schritt::Mseg { gate: q("gate"), trig: q("trig"), aus: aus(k, "aus"),
                                c: MsegSatz { stufen: w("stufen") as u8, halt: w("halt") as u8, von: w("von") as u8, bis: w("bis") as u8,
                                              p: std::array::from_fn(|i| n(i + 1, "p")), t: std::array::from_fn(|i| n(i + 1, "t")), k: std::array::from_fn(|i| n(i + 1, "k")) },
                                e: [Mseg::default(); MAX_STIMMEN] }
            }
            "folger" => Schritt::Folger { x: q("x"), an: q("an"), ab: q("ab"), aus: aus(k, "aus"), f: [Folger::default(); MAX_STIMMEN] },
            "transponiere" => Schritt::Transponiere { hz: q("hz"), st: q("st"), cent: q("cent"), aus: aus(k, "aus") },
            "diode" => Schritt::Diode { x: q("x"), cutoff: q("cutoff"), reso: q("reso"), antrieb: q("antrieb"), bass: q("bass"), aus: aus(k, "aus"), f: [Diode::default(); MAX_STIMMEN] },
            "svf" => Schritt::Svf { x: q("x"), cutoff: q("cutoff"), reso: q("reso"), tp: aus(k, "tp"), bp: aus(k, "bp"), hp: aus(k, "hp"), vier: w("pole") == 4.0, f: [Svf::default(); MAX_STIMMEN] },
            "allpass" => Schritt::Allpass { x: q("x"), fc: q("fc"), fc2: q("fc2"), aus: aus(k, "aus"), ordnung: w("ordnung") as u8, f: [Allpass::default(); MAX_STIMMEN] },
            "kreuz" => Schritt::Kreuz { x: q("x"), fc1: q("fc1"), fc2: q("fc2"), lo: aus(k, "lo"), mid: aus(k, "mid"), hi: aus(k, "hi"), baender: w("baender") as u8, f: [Kreuz::default(); MAX_STIMMEN] },
            "chaos" => Schritt::Chaos { rate: q("rate"), trig: q("trig"), aus: aus(k, "aus"), aus2: aus(k, "aus2"), form: w("form") as u8, saat: w("saat") as u32, betrag: Box::new([]), c: std::array::from_fn(|i| crate::chaos::Chaos::neu(i, w("saat") as u32, w("form") as u8)) },
            "schieber" => Schritt::Schieber { x: q("x"), hz: q("hz"), auf: aus(k, "auf"), ab: aus(k, "ab"), f: Box::new([crate::schieber::Schieber::default(); MAX_STIMMEN]) },
            "paula" => {
                let wz = wurzel.ok_or_else(|| Fehler::Datei { knoten: k.to_string(), grund: "no sample root".to_string() })?;
                let mut plaetze = Vec::new();
                for (i, s) in knoten[k].plaetze.as_deref().unwrap_or_default().iter().enumerate() {
                    let daten = lade_datei(wz, &s.datei, k, &mut geladen)?;
                    let frames = (daten.len() / 2) as u64;
                    let schleife = s.schleife == 1;
                    if schleife && s.s_von as u64 >= frames {
                        return Err(Fehler::Wert { knoten: k.to_string(), wert: format!("plaetze[{i}].s_von"), grund: "the loop must start inside the data" });
                    }
                    if schleife && s.s_von as u64 + s.s_laenge as u64 > frames {
                        return Err(Fehler::Wert { knoten: k.to_string(), wert: format!("plaetze[{i}].s_laenge"), grund: "the loop must end inside the data" });
                    }
                    let e = PlatzEinst { grund: s.grund, rate: s.rate, schleife, s_von: s.s_von, s_laenge: s.s_laenge, pegel: s.pegel, fein: s.fein };
                    plaetze.push(PaulaPlatz2::neu(daten, &e));
                }
                Schritt::Paula {
                    hz: q("hz"),
                    trig: q("trig"),
                    gate: q("gate"),
                    platz: q("platz"),
                    start: q("start"),
                    rueckwaerts: q("rueckwaerts"),
                    wl: aus(k, "l"),
                    wr: aus(k, "r"),
                    b: Box::new(PaulaBank::neu(plaetze, w("quellrate"), w("bits") as u8)),
                    v: Box::new([PaulaStimme::default(); MAX_STIMMEN]),
                }
            }
            "matrix" => {
                let e: [Quelle; 16] = std::array::from_fn(|i| q(&format!("e{}", i + 1)));
                let a: [usize; 16] = std::array::from_fn(|i| aus(k, &format!("a{}", i + 1)));
                Schritt::Matrix { e, morph: q("morph"), a, m: Box::new(crate::matrix::Matrix::neu(knoten[k].stifte.as_deref().unwrap_or(&[]), sr)) }
            }
            "funktion" => Schritt::Funktion {
                x: q("x"), trig: q("trig"), halt: q("halt"), steigen: q("steigen"), fallen: q("fallen"), form: q("form"), zyklus: q("zyklus"), tempo: q("tempo"),
                aus: aus(k, "aus"), ende: aus(k, "ende"), steigt: aus(k, "steigt"), f: [crate::funktion::Funktion::default(); MAX_STIMMEN],
            },
            "lpg" => Schritt::Lpg {
                x: q("x"), cv: q("cv"), modus: q("modus"), abkling: q("abkling"), reso: q("reso"), versatz: q("versatz"),
                aus: aus(k, "aus"), l: [crate::lpg::Lpg::default(); MAX_STIMMEN],
            },
            "notenwahl" => Schritt::Notenwahl { hz: q("hz"), aus: aus(k, "aus"), noten: std::array::from_fn(|i| w(&format!("n{}", i + 1)) as i32) },
            "lfsr" => Schritt::Lfsr { hz: q("hz"), aus: aus(k, "aus"), kurz: w("kurz") == 1.0, l: [Lfsr::default(); MAX_STIMMEN] },
            "sem" => Schritt::Sem { x: q("x"), cutoff: q("cutoff"), reso: q("reso"), form: q("form"), aus: aus(k, "aus"), bp: aus(k, "bp"), f: [Sem::default(); MAX_STIMMEN] },
            "saett" => Schritt::Saett { x: q("x"), antrieb: q("antrieb"), aus: aus(k, "aus"), a: [Adaa1::default(); MAX_STIMMEN] },
            "glatt" => Schritt::Glatt { x: q("x"), setzen: q("setzen"), aus: aus(k, "aus"), zeit: w("zeit"), z: [0.0; MAX_STIMMEN] },
            "ladder" => Schritt::Ladder {
                x: q("x"),
                cutoff: q("cutoff"),
                reso: q("reso"),
                aus: aus(k, "aus"),
                f: [Ladder::default(); MAX_STIMMEN],
                reso_glatt: [0.0; MAX_STIMMEN],
            },
            "adsr" => Schritt::Adsr {
                gate: q("gate"),
                trig: q("trig"),
                zeiten: [q("a"), q("d"), q("s"), q("r")],
                aus: aus(k, "aus"),
                e: [Adsr::default(); MAX_STIMMEN],
            },
            "mul" => Schritt::Mul { a: q("a"), b: q("b"), aus: aus(k, "aus") },
            "add" => Schritt::Add { a: q("a"), b: q("b"), c: q("c"), d: q("d"), aus: aus(k, "aus") },
            "wahl" => {
                let e = crate::wahl::Einstellung::neu(w("n") as usize, w("norm") == 1.0, w("modus") == 1.0, w("blende"), sr);
                Schritt::Wahl {
                    ein: [q("e1"), q("e2"), q("e3"), q("e4"), q("e5"), q("e6"), q("e7"), q("e8")],
                    wahl: q("wahl"),
                    aus: aus(k, "aus"),
                    e,
                    v: Box::new([crate::wahl::Stimme::default(); MAX_STIMMEN]),
                }
            }
            "leitung" => {
                let max = ((w("max") * sr / 1000.0).ceil() as usize).max(1);
                Schritt::Leitung { x: q("x"), zeit: q("zeit"), hz: q("hz"), aus: aus(k, "aus"), l: (0..g.stimmen).map(|_| Leitung::neu(max)).collect() }
            }
            "chorus" => Schritt::Chorus { x: q("x"), mix: q("mix"), l: aus(k, "l"), r: aus(k, "r"), c: Chorus::neu(w("modus") as u8, sr) },
            "hall" => {
                let e = hall_dsp::HallEinstellung {
                    mix: w("mix") as f64,
                    decay_s: w("decay") as f64,
                    groesse_ms: w("groesse") as f64,
                    pre_ms: w("pre") as f64,
                    frueh: w("frueh") as f64,
                    breite: w("breite") as f64,
                    tief_faktor: w("tief") as f64,
                    hoch_faktor: w("hoch") as f64,
                    rahmen: w("rahmen") as usize,
                    ..hall_vorgabe()
                };
                let mut h = Box::new(hall_dsp::Hall::neu(sr as f64));
                h.setze(e);
                h.reset(); // Glätter auf das Ziel: mix gilt ab dem ersten Sample (D5)
                Schritt::Hall { x: q("x"), l: q("l"), r: q("r"), mix: q("mix"), wl: aus(k, "l"), wr: aus(k, "r"), mix_alt: w("mix"), mix_start: w("mix"), h }
            }
            "delay" => {
                let zeit = q("zeit");
                // ohne Kante und ohne takt liegt die Zeit fest: Thiran; sonst Lagrange hinter dem Glätter (D4, S3c D9)
                let fest = match zeit {
                    Quelle::Fest(ms) if w("takt") == 0.0 => Some(ms),
                    _ => None,
                };
                let d = Echo::neu(sr, w("max"), fest, w("glatt"), w("daempf"), w("pingpong") == 1.0);
                Schritt::Delay { x: q("x"), l: q("l"), r: q("r"), zeit, fb: q("fb"), mix: q("mix"), takt: w("takt"), wl: aus(k, "l"), wr: aus(k, "r"), d }
            }
            "limiter" => Schritt::Limiter { x: q("x"), l: q("l"), r: q("r"), wl: aus(k, "l"), wr: aus(k, "r"),
                                            b: Limiter::neu(w("decke"), vorlauf(w("vorlauf"), sr), w("release"), sr) },
            "gate" => Schritt::Gate { x: q("x"), l: q("l"), r: q("r"), kl: schluessel_quelle(k, "kl", &mut q), kr: schluessel_quelle(k, "kr", &mut q), key: schluessel_aktiv(k),
                                      wl: aus(k, "l"), wr: aus(k, "r"),
                                      g: Gate::neu(w("schwelle"), w("hyst"), w("tiefe"), w("attack"), w("release"), sr) },
            "komp" => {
                let mut kp = komp_dsp::Komp::neu(sr as f64);
                kp.setze(&komp_dsp::Einstellung {
                    schwelle_db: w("schwelle") as f64,
                    ratio: w("ratio") as f64,
                    knie_db: w("knie") as f64,
                    attack_ms: w("attack") as f64,
                    release_ms: w("release") as f64,
                    makeup_db: w("makeup") as f64,
                    mix: w("mix") as f64,
                    sc_hochpass_hz: w("schp") as f64,
                });
                Schritt::Komp { x: q("x"), l: q("l"), r: q("r"), kl: schluessel_quelle(k, "kl", &mut q), kr: schluessel_quelle(k, "kr", &mut q), key: schluessel_aktiv(k), wl: aus(k, "l"), wr: aus(k, "r"), k: kp }
            }
            "phaser" => Schritt::Phaser {
                x: q("x"),
                l: q("l"),
                r: q("r"),
                rate: q("rate"),
                tiefe: q("tiefe"),
                fb: q("fb"),
                mix: q("mix"),
                wl: aus(k, "l"),
                wr: aus(k, "r"),
                voreinstellung: [w("rate"), w("tiefe"), w("fb"), w("mix")],
                p: Phaser::neu(sr, w("stufen") as usize, w("tief"), w("hoch"), w("breite")),
            },
            "vocoder" => Schritt::Vocoder {
                x: q("x"),
                l: q("l"),
                r: q("r"),
                zisch: q("zisch"),
                mix: q("mix"),
                wl: aus(k, "l"),
                wr: aus(k, "r"),
                voreinstellung: [w("zisch"), w("mix")],
                v: Vocoder::neu(sr, w("attack"), w("release"), w("pole") as usize),
            },
            "krume" => Schritt::Krume { x: q("x"), bits: q("bits"), rate: q("rate"), aus: aus(k, "aus"), bits0: w("bits"), rate0: w("rate"), k: [Krume::default(); MAX_STIMMEN] },
            "roehre" => {
                // a modulated bias selects among eleven pre-built tables, an unmodulated one needs exactly one (C5)
                let moduliert = eingang.contains_key(&(k.to_string(), "bias".to_string()));
                let satz = Box::new(if moduliert { RoehrenSatz::elf() } else { RoehrenSatz::eins(w("bias") as f64) });
                Schritt::Roehre {
                    x: q("x"),
                    antrieb: q("antrieb"),
                    bias: q("bias"),
                    aus: aus(k, "aus"),
                    antrieb0: w("antrieb"),
                    bias0: w("bias"),
                    zwei: w("stufen") == 2.0,
                    satz,
                    r1: [Roehre::default(); MAX_STIMMEN],
                    r2: [Roehre::default(); MAX_STIMMEN],
                }
            }
            "sampler" => {
                let name = knoten[k].datei.as_deref().unwrap_or_default();
                let wz = wurzel.ok_or_else(|| Fehler::Datei { knoten: k.to_string(), grund: "no sample root".to_string() })?;
                // a zone node reads a pack: mapped, not read, not counted into the graph's sample bytes
                let (d, z) = match &knoten[k].zonen {
                    Some(zt) => {
                        let karte = karte_datei(wz, name, k)?;
                        let t = ZonenTabelle::neu_mit(zt, Some(karte.frames()), w("loop_blende") as f64)
                            .map_err(|e| zonen_fehler(k, e))?
                            .mit_blenden(w("taste_blende") as f64, w("vel_blende") as f64, w("frei_halte") as f64);
                        (Daten::Karte(karte), Some(t))
                    }
                    None => (Daten::Eigen(lade_datei(wz, name, k, &mut geladen)?), None),
                };
                let scheiben = w("scheiben") as usize;
                let g: Option<Box<[usize]>> = match &knoten[k].grenzen {
                    Some(g) => {
                        pruefe_grenzen(g, Some((d.len() / 2) as u64))
                            .map_err(|grund| Fehler::Wert { knoten: k.to_string(), wert: "grenzen".to_string(), grund })?;
                        Some(g.iter().map(|v| *v as usize).collect())
                    }
                    None => {
                        if z.is_none() && d.len() / 2 / scheiben < 4 {
                            return Err(Fehler::Wert { knoten: k.to_string(), wert: "scheiben".to_string(), grund: "a slice must have at least 4 frames" });
                        }
                        None
                    }
                };
                let z_blendet = z.as_ref().is_some_and(|t| t.blendet());
                Schritt::Sampler {
                    tempo: q("tempo"),
                    halb: q("halb"),
                    ausklang: q("ausklang"),
                    vel: q("vel"),
                    g,
                    z,
                    rr: 0,
                    wahl: w("noten_wahl") == 1.0,
                    hz: q("hz"),
                    trig: q("trig"),
                    gate: q("gate"),
                    scheibe: q("scheibe"),
                    rueck: q("rueck"),
                    wl: aus(k, "l"),
                    wr: aus(k, "r"),
                    wrl: aus(k, "rl"),
                    wrr: aus(k, "rr"),
                    rr2: 0,
                    e: Einstellung { grund: w("grund"), scheiben, schleife: w("schleife") == 1.0 },
                    d,
                    s: [Sampler::default(); MAX_STIMMEN],
                    s2: if z_blendet { Some(Box::new([Sampler::default(); MAX_STIMMEN])) } else { None },
                }
            }
            "faltung" => {
                let name = knoten[k].datei.as_deref().unwrap_or_default();
                let wz = wurzel.ok_or_else(|| Fehler::Datei { knoten: k.to_string(), grund: "no sample root".to_string() })?;
                let d = lade_datei(wz, name, k, &mut geladen)?;
                let frames = d.len() / 2;
                let max = (w("laenge_max") as f64 * sr as f64 / 1000.0).floor() as usize;
                if frames > max {
                    return Err(Fehler::Datei {
                        knoten: k.to_string(),
                        grund: format!("{name}: IR has {frames} frames, laenge_max {} ms allows {max}", w("laenge_max")),
                    });
                }
                let pre = (w("pre") as f64 * sr as f64 / 1000.0).round() as usize;
                // the IR data are dropped after `neu`: only the head taps and the partition spectra stay in memory
                Schritt::Faltung { x: q("x"), l: q("l"), r: q("r"), mix: q("mix"), wl: aus(k, "l"), wr: aus(k, "r"), f: Box::new(Faltung::neu(&d, pre, w("mix"), sr)) }
            }
            "wavetable" => {
                let e = crate::wavetable::Einstellung { kopien: w("kopien") as usize, zufall: w("zufall"), glatt_ms: w("glatt"), saat: w("saat") as u32, reserve: w("reserve") as u8 };
                Schritt::Wavetable {
                    hz: q("hz"),
                    trig: q("trig"),
                    pos: q("pos"),
                    verstimmung: q("verstimmung"),
                    breite: q("breite"),
                    pm: q("pm"),
                    warp: q("warp"),
                    tiefe: q("tiefe"),
                    stapel: q("stapel"),
                    wl: aus(k, "l"),
                    wr: aus(k, "r"),
                    aus: aus(k, "aus"),
                    e,
                    t: match &knoten[k].spektren {
                        Some(sp) => crate::wavetable::tabelle_aus_spektren(sp),
                        None => crate::wavetable::tabelle_eingebaut(w("tabelle") as usize),
                    },
                    w: Box::new(std::array::from_fn(|i| WtStimme::neu(i, &e))),
                }
            }
            "resonator" => {
                let e = crate::resonator::Einstellung { moden: w("moden") as usize, anregung: w("anregung") as u8, burst_ms: w("burst"), saat: w("saat") as u32 };
                Schritt::Resonator {
                    ein: [q("hz"), q("trig"), q("staerke"), q("x"), q("material"), q("helligkeit"), q("groesse"), q("position"), q("inharmonie")],
                    aus: aus(k, "aus"),
                    e,
                    satz: Box::new(Satz::neu(w("satz") as usize)),
                    v: Box::new(std::array::from_fn(|i| RsStimme::neu(i, &e))),
                }
            }
            "metall" => {
                let e = crate::metall::Einstellung::neu(w("gruppe") == 1.0, w("schnitt"), w("saat") as u32, sr);
                Schritt::Metall {
                    ein: crate::metall::EIN.map(|p| q(p)),
                    aus: aus(k, "aus"),
                    huelle: aus(k, "huelle"),
                    e,
                    m: Box::new(std::array::from_fn(|i| crate::metall::Stimme::neu(i, &e))),
                }
            }
            "fm" => Schritt::Fm {
                hz: q("hz"),
                gate: q("gate"),
                trig: q("trig"),
                vel: q("vel"),
                index: q("index"),
                rueck: q("rueck"),
                zeit: q("zeit"),
                aus: aus(k, "aus"),
                e: crate::fm::Einstellung::aus_werten(&w),
                v: Box::new([crate::fm::Stimme::neu(); MAX_STIMMEN]),
            },
            "granular" => {
                let e = crate::granular::Einstellung { quelle: w("quelle") as usize, grund: w("grund"), streuung: w("streuung"), saat: w("saat") as u32 };
                Schritt::Granular {
                    hz: q("hz"),
                    trig: q("trig"),
                    gate: q("gate"),
                    x: q("x"),
                    groesse: q("groesse"),
                    dichte: q("dichte"),
                    pos: q("pos"),
                    pos_zufall: q("pos_zufall"),
                    tonhoehe: q("tonhoehe"),
                    ton_zufall: q("ton_zufall"),
                    breite: q("breite"),
                    fenster: q("fenster"),
                    frieren: q("frieren"),
                    wl: aus(k, "l"),
                    wr: aus(k, "r"),
                    e,
                    // the table or the ring buffer is allocated here, at translation
                    m: Box::new(crate::granular::Material::neu(&e, w("tabelle") as usize, w("puffer"), sr)),
                    g: Box::new(std::array::from_fn(|i| crate::granular::Stimme::neu(i, &e))),
                }
            }
            "saite" => {
                let e = crate::saite::Einstellung::neu(w("anreger") as usize, w("koerper") as usize, w("saat") as u32, sr);
                Schritt::Saite {
                    x: q("x"),
                    hz: q("hz"),
                    trig: q("trig"),
                    vel: q("vel"),
                    ausklang: q("ausklang"),
                    daempfung: q("daempfung"),
                    hell: q("hell"),
                    lage: q("lage"),
                    koerper_mix: q("koerper_mix"),
                    aus: aus(k, "aus"),
                    e,
                    s: Box::new(std::array::from_fn(|i| SaStimme::neu(i, &e, sr))),
                }
            }
            "kamm" => Schritt::Kamm { x: q("x"), hz: q("hz"), fb: q("fb"), daempf: q("daempf"), mix: q("mix"), aus: aus(k, "aus"), k: (0..g.stimmen).map(|_| crate::kamm::Kamm::neu(sr)).collect() },
            "formant" => Schritt::Formant { x: q("x"), vokal: q("vokal"), versatz: q("versatz"), q: q("q"), mix: q("mix"), aus: aus(k, "aus"), f: Box::new([crate::formant::Stimme::neu(); MAX_STIMMEN]) },
            "ms20" => Schritt::Ms20 { x: q("x"), cutoff: q("cutoff"), reso: q("reso"), antrieb: q("antrieb"), tp: aus(k, "tp"), hp: aus(k, "hp"), modus: w("modus") as u8, f: Box::new([crate::ms20::Ms20::default(); MAX_STIMMEN]) },
            "trommeln" => {
                let e = crate::trommeln::Einstellung::neu(w("modell") as u8, w("schnitt"), w("saat") as u32, sr);
                Schritt::Trommeln { ein: crate::trommeln::EIN.map(|p| q(p)), aus: aus(k, "aus"), e, t: Box::new(crate::trommeln::Kit::neu(&e)) }
            }
            "falter" => Schritt::Falter { x: q("x"), antrieb: q("antrieb"), symmetrie: q("symmetrie"), form: q("form"), aus: aus(k, "aus"), ueber: w("ueber") == 1.0, f: Box::new(std::array::from_fn(|_| crate::falter::Falter::default())) },
            "drift" => Schritt::Drift { rate: q("rate"), fest: q("fest"), aus: aus(k, "aus"), d: std::array::from_fn(|i| crate::drift::Drift::neu(i, w("saat") as u32)), saat: w("saat") as u32 },
            "labor" => Schritt::Labor { x: q("x"), l: q("l"), r: q("r"), st: std::array::from_fn(|i| q(crate::labor::EIN[3 + i])), wl: aus(k, "l"), wr: aus(k, "r"), b: Box::new(crate::labor::Block::neu(sr, w("ueber"))) },
            "remix" => Schritt::Remix { x: q("x"), l: q("l"), r: q("r"), st: std::array::from_fn(|i| q(crate::remix::EIN[3 + i])), wl: aus(k, "l"), wr: aus(k, "r"), b: Box::new(crate::remix::Block::neu(sr)) },
            "eingang" => Schritt::Eingang { wl: aus(k, "l"), wr: aus(k, "r") },
            "ausgang" => Schritt::Ausgang { x: q("x"), l: q("l"), r: q("r") },
            andere => unreachable!("Art {andere} ist oben geprüft"),
        };
        schritte.push(s);
    }
    let latenz = reihe.iter().filter(|k| art_von[**k].art == "ausgang").map(|k| lat[*k]).max().unwrap_or(0);
    // Start position per knob: `vorgabe` of the first `regler` node of a number in document order (as the page's `reglerBereiche` reads it)
    let mut vorgaben = [0.5f32; REGLER];
    let mut gesehen = [false; REGLER];
    // Latched knobs: bit nr-1 is set when the `regler` nodes of that number say `rastet` 1. Equal numbers must agree.
    let mut rastend = 0u64;
    for k in g.knoten.iter().filter(|k| k.art == "regler") {
        let nr = k.werte.get("nr").copied().unwrap_or(0.0) as usize;
        let rastet = k.werte.get("rastet").copied().unwrap_or(0.0) == 1.0;
        if (1..=REGLER).contains(&nr) && !gesehen[nr - 1] {
            gesehen[nr - 1] = true;
            vorgaben[nr - 1] = k.werte.get("vorgabe").copied().unwrap_or(0.5);
            rastend |= (rastet as u64) << (nr - 1);
        } else if (1..=REGLER).contains(&nr) && ((rastend >> (nr - 1)) & 1 == 1) != rastet {
            return Err(Fehler::Wert { knoten: k.id.clone(), wert: "rastet".to_string(), grund: "knobs with the same nr must agree on rastet" });
        }
    }
    Ok(Programm::neu(g.name, g.stimmen, sr, schritte, slot.len(), verzoegert.into_iter().collect(), regler_namen, latenz, vorgaben, rastend))
}
