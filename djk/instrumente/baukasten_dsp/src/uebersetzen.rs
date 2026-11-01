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
use crate::format::{Graph, FORMATE};
use crate::gate::Gate;
use crate::krume::Krume;
use crate::leitung::Leitung;
use crate::lfo::Lfo;
use crate::limiter::{vorlauf, Limiter};
use crate::osz::{Osz, Rauschen, Sinus};
use crate::phaser::Phaser;
use crate::programm::{Programm, Quelle, Schritt, MAX_STIMMEN, REGLER};
use crate::sampler::{lade_datei, Einstellung, Sampler};
use crate::roehre::{Roehre, RoehrenSatz, BIAS_MAX, BIAS_MIN};
use crate::svf::Svf;
use crate::vocoder::Vocoder;
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

pub const ARTEN: [ArtDef; 32] = [
    ArtDef { art: "note", ein: &[], aus: &["hz", "gate", "vel", "trig", "erste"], werte: &[], frei: &[] },
    ArtDef { art: "konst", ein: &[], aus: &["aus"], werte: &["wert"], frei: &[] },
    ArtDef { art: "regler", ein: &[], aus: &["aus"], werte: &["nr", "min", "max"], frei: &[("log", 0.0)] },
    ArtDef { art: "saege", ein: &["hz", "sync"], aus: &["aus", "zyklus"], werte: &[], frei: &[] },
    ArtDef { art: "puls", ein: &["hz", "pwm", "sync"], aus: &["aus", "zyklus"], werte: &[], frei: &[] },
    ArtDef { art: "dreieck", ein: &["hz", "sync"], aus: &["aus", "zyklus"], werte: &[], frei: &[] },
    ArtDef { art: "sinus", ein: &["hz", "fm", "sync"], aus: &["aus", "zyklus"], werte: &[], frei: &[] },
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
    ArtDef { art: "sampler", ein: &["hz", "trig", "gate", "scheibe", "rueck"], aus: &["l", "r"], werte: &[],
             frei: &[("grund", 261.6256), ("scheiben", 1.0), ("schleife", 0.0), ("gate", 1.0)] },
    // S21: convolution with an IR file (sum point, zero latency); type 31. `datei` is a named field like sampler's.
    ArtDef { art: "faltung", ein: &["x", "l", "r", "mix"], aus: &["l", "r"], werte: &[], frei: &[("mix", 1.0), ("pre", 0.0), ("laenge_max", 1000.0)] },
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
        match def.art {
            "sampler" if !(20.0..=2000.0).contains(&w("grund")) => return falsch("grund", "20..2000 Hz"),
            "sampler" if !ganz(w("scheiben"), 1.0, 64.0) => return falsch("scheiben", "integer 1..64"),
            "sampler" if !ganz(w("schleife"), 0.0, 1.0) => return falsch("schleife", "0 or 1"),
            "regler" if !ganz(w("nr"), 1.0, REGLER as f32) => return falsch("nr", "1..8"),
            "regler" if !ganz(w("log"), 0.0, 1.0) => return falsch("log", "0 or 1"),
            "regler" if w("log") == 1.0 && !(w("min") > 0.0 && w("max") > 0.0) => return falsch("min", "log needs min > 0 and max > 0"),
            "lfo" if !ganz(w("form"), 0.0, 4.0) => return falsch("form", "0 sine, 1 triangle, 2 saw, 3 square, 4 random"),
            "lfo" if !ganz(w("neustart"), 0.0, 1.0) => return falsch("neustart", "0 or 1"),
            "lfo" if !(0.0..=256.0).contains(&w("takt")) => return falsch("takt", "0..256 beats"),
            "lfo" if !(0.0..=4096.0).contains(&w("versatz")) => return falsch("versatz", "0..4096 beats"),
            "lfo" if !ganz(w("einmal"), 0.0, 1.0) => return falsch("einmal", "0 or 1"),
            // offset and one-shot are defined against the host beat; a free-running lfo has none
            "lfo" if w("takt") == 0.0 && (w("versatz") != 0.0 || w("einmal") == 1.0) => return falsch("takt", "versatz and einmal need takt > 0"),
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
            "svf" if w("pole") != 2.0 && w("pole") != 4.0 => return falsch("pole", "2 or 4"),
            "glatt" if !(w("zeit") >= 0.0) => return falsch("zeit", ">= 0 seconds"),
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
        let verz = e.verzoegerung == 1 || (ndef.art == "leitung" && np == "x");
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
            "regler" => Schritt::Regler { aus: aus(k, "aus"), nr: w("nr") as usize - 1, min: w("min"), max: w("max"), log: w("log") == 1.0 },
            "saege" => Schritt::Saege { hz: q("hz"), sync: q("sync"), aus: aus(k, "aus"), zyklus: aus(k, "zyklus"), osz: [Osz::default(); MAX_STIMMEN] },
            "puls" => Schritt::Puls { hz: q("hz"), pwm: q("pwm"), sync: q("sync"), aus: aus(k, "aus"), zyklus: aus(k, "zyklus"), osz: [Osz::default(); MAX_STIMMEN] },
            "dreieck" => Schritt::Dreieck { hz: q("hz"), sync: q("sync"), aus: aus(k, "aus"), zyklus: aus(k, "zyklus"), osz: [Osz::default(); MAX_STIMMEN] },
            "sinus" => Schritt::Sinus { hz: q("hz"), fm: q("fm"), sync: q("sync"), aus: aus(k, "aus"), zyklus: aus(k, "zyklus"), osz: [Sinus::default(); MAX_STIMMEN] },
            "rauschen" => Schritt::Rauschen { aus: aus(k, "aus"), r: std::array::from_fn(Rauschen::neu) },
            "lfo" => Schritt::Lfo { rate: q("rate"), trig: q("trig"), aus: aus(k, "aus"), form: w("form") as u8, neustart: w("neustart") == 1.0, takt: w("takt"), versatz: w("versatz") as f64, einmal: w("einmal") == 1.0, l: std::array::from_fn(Lfo::neu) },
            "transponiere" => Schritt::Transponiere { hz: q("hz"), st: q("st"), cent: q("cent"), aus: aus(k, "aus") },
            "svf" => Schritt::Svf { x: q("x"), cutoff: q("cutoff"), reso: q("reso"), tp: aus(k, "tp"), bp: aus(k, "bp"), hp: aus(k, "hp"), vier: w("pole") == 4.0, f: [Svf::default(); MAX_STIMMEN] },
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
                let d = lade_datei(wz, name, k, &mut geladen)?;
                let scheiben = w("scheiben") as usize;
                if d.len() / 2 / scheiben < 4 {
                    return Err(Fehler::Wert { knoten: k.to_string(), wert: "scheiben".to_string(), grund: "a slice must have at least 4 frames" });
                }
                Schritt::Sampler {
                    hz: q("hz"),
                    trig: q("trig"),
                    gate: q("gate"),
                    scheibe: q("scheibe"),
                    rueck: q("rueck"),
                    wl: aus(k, "l"),
                    wr: aus(k, "r"),
                    e: Einstellung { grund: w("grund"), scheiben, schleife: w("schleife") == 1.0 },
                    d,
                    s: [Sampler::default(); MAX_STIMMEN],
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
            "eingang" => Schritt::Eingang { wl: aus(k, "l"), wr: aus(k, "r") },
            "ausgang" => Schritt::Ausgang { x: q("x"), l: q("l"), r: q("r") },
            andere => unreachable!("Art {andere} ist oben geprüft"),
        };
        schritte.push(s);
    }
    let latenz = reihe.iter().filter(|k| art_von[**k].art == "ausgang").map(|k| lat[*k]).max().unwrap_or(0);
    Ok(Programm::neu(g.name, g.stimmen, sr, schritte, slot.len(), verzoegert.into_iter().collect(), regler_namen, latenz))
}
