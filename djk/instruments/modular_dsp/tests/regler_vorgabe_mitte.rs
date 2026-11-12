//! Task 3 of the synth build-out: the `regler` node carries an optional start position (`vorgabe`, default 0.5) and an
//! optional centre value (`mitte`, pinned to knob position 0.5). Graphs that use neither behave bit for bit as before.
//!
//! The test also writes the golden table `tests/regler_mitte_tafel.json` that `djk/ui/tests/panel_skala_mitte.test.mjs`
//! reads, so the page scaling is pinned to the engine: `REGLER_TAFEL_SCHREIBEN=1 cargo test --release --test regler_vorgabe_mitte`
//! rewrites it; without the variable the test only checks that the committed table equals the engine's values.
use baukasten_dsp::{uebersetze, uebersetze_mit_wurzel, Fehler, Programm, REGLER};
use std::path::{Path, PathBuf};

const SR: f32 = 48_000.0;

/// `regler` node -> output: l = r = the node value (one voice, so the output sum is the value itself).
fn mini(extra: &str) -> String {
    format!(
        r#"{{"format":"baukasten/2","name":"mini","stimmen":1,"knoten":[{{"id":"n","art":"note"}},{{"id":"k","art":"regler","nr":1{extra}}},{{"id":"o","art":"ausgang"}}],"kanten":[{{"von":"k.aus","nach":"o.l"}},{{"von":"k.aus","nach":"o.r"}}]}}"#
    )
}

fn wert_bei(p: &mut Programm, k: f32) -> f32 {
    p.setze_regler(1, k);
    p.sample_stereo().0
}

/// The engine formula before `mitte` existed (programm.rs, `Schritt::Regler`).
fn alt(min: f32, max: f32, log: bool, k: f32) -> f32 { if log { min * (max / min).powf(k) } else { min + (max - min) * k } }

fn wurzel() -> PathBuf {
    static W: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();
    W.get_or_init(|| {
        let w = std::env::temp_dir().join(format!("bk-vorgabe-mitte-{}", std::process::id()));
        std::fs::create_dir_all(&w).unwrap();
        let p = |n: &str, d: Vec<f32>| std::fs::write(w.join(n), baukasten_dsp::proben::bytes(&d)).unwrap();
        p("orchester-schlag.f32", baukasten_dsp::proben::orchester_schlag(SR));
        p("orchester-schlag-schichten.f32", baukasten_dsp::proben::orchester_schlag_schichten(SR));
        p("feder-ir.f32", baukasten_dsp::proben::feder_ir(SR));
        w
    }).clone()
}

fn beispiele() -> Vec<(String, String)> {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let kat: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(dir.join("kategorien.json")).unwrap()).unwrap();
    let mut namen: Vec<String> = kat.as_object().unwrap().keys().cloned().collect();
    namen.sort();
    namen.into_iter().map(|n| {
        let t = std::fs::read_to_string(dir.join("demos").join(format!("{n}.json"))).unwrap_or_else(|e| panic!("{n}: {e}"));
        (n, t)
    }).collect()
}

fn fehlertext(e: Fehler) -> String { format!("{e:?}") }

#[test]
fn a_alle_beispiele_unveraendert() {
    let graphen = beispiele();
    assert_eq!(graphen.len(), 53, "kategorien.json lists 53 graphs");
    let mut bereiche: Vec<(u32, u32, bool)> = Vec::new();
    for (name, text) in &graphen {
        let p = uebersetze_mit_wurzel(text, SR, Some(&wurzel())).unwrap_or_else(|e| panic!("{name}: {e}"));
        // Drift (Task 8) and the synth build-out (Tasks 11-13) gave synth-mono, synth-poly and synth-neuro real vorgaben, and kick-synth
        // carries its start sound (Tune 49 Hz, Level -3 dB, ...); every other graph still starts all knobs at 0.5.
        if !["synth-mono", "synth-poly", "synth-neuro", "kick-synth"].contains(&name.as_str()) {
            assert_eq!(p.regler_vorgaben(), [0.5f32; REGLER], "{name}: only the three synths and kick-synth carry a vorgabe");
        }
        let g: serde_json::Value = serde_json::from_str(text).unwrap();
        for k in g["knoten"].as_array().unwrap() {
            if k["art"] == "regler" {
                let f = |s: &str| k[s].as_f64().unwrap() as f32;
                let b = (f("min").to_bits(), f("max").to_bits(), k["log"] == 1);
                if !bereiche.contains(&b) { bereiche.push(b); }
            }
        }
    }
    assert!(bereiche.len() > 20, "enough distinct ranges are covered: {}", bereiche.len());
    for (min, max, log) in bereiche {
        let (min, max) = (f32::from_bits(min), f32::from_bits(max));
        let mut p = uebersetze(&mini(&format!(r#","min":{min:?},"max":{max:?},"log":{}"#, log as u8)), SR).unwrap();
        for i in 0..=1000 {
            let k = i as f32 / 1000.0;
            assert_eq!(wert_bei(&mut p, k).to_bits(), alt(min, max, log, k).to_bits(), "min {min} max {max} log {log} k {k}");
        }
    }
}

/// A small synth: saw at the note, scaled by knob 3 (0..1). Output = saw * knob.
fn synth(vorgabe_k3: &str, zweiter: &str) -> String {
    format!(
        r#"{{"format":"baukasten/2","name":"v","stimmen":2,"knoten":[{{"id":"n","art":"note"}},{{"id":"s","art":"saege"}},{{"id":"k","art":"regler","nr":3,"min":0,"max":1{vorgabe_k3}}}{zweiter},{{"id":"m","art":"mul"}},{{"id":"o","art":"ausgang"}}],"kanten":[{{"von":"n.hz","nach":"s.hz"}},{{"von":"s.aus","nach":"m.a"}},{{"von":"k.aus","nach":"m.b"}},{{"von":"m.aus","nach":"o.x"}}]}}"#
    )
}

fn spiele(p: &mut Programm) -> Vec<(f32, f32)> {
    p.note_an(57, 0.8);
    (0..4800).map(|_| p.sample_stereo()).collect()
}

#[test]
fn b_vorgabe_ist_die_startstellung() {
    let mut mit = uebersetze(&synth(r#","vorgabe":0.25"#, ""), SR).unwrap();
    assert_eq!(mit.regler_vorgaben()[2], 0.25);
    assert_eq!(mit.regler_vorgaben()[0], 0.5);
    assert_eq!(mit.regler_vorgaben()[31], 0.5);
    let a = spiele(&mut mit);
    let mut ohne = uebersetze(&synth("", ""), SR).unwrap();
    ohne.setze_regler(3, 0.25);
    let b = spiele(&mut ohne);
    assert!(a == b, "vorgabe 0.25 equals the same graph with the knob set to 0.25, bit for bit");
    let mut halb = uebersetze(&synth("", ""), SR).unwrap();
    assert!(spiele(&mut halb) != a, "positive control: the default 0.5 sounds different");

    // vorgabe 0 and 1 are valid edges
    assert_eq!(uebersetze(&synth(r#","vorgabe":0"#, ""), SR).unwrap().regler_vorgaben()[2], 0.0);
    assert_eq!(uebersetze(&synth(r#","vorgabe":1"#, ""), SR).unwrap().regler_vorgaben()[2], 1.0);

    // the first node of a number decides (document order), also when it has no vorgabe
    let zweiter = |v: &str| format!(r#",{{"id":"k2","art":"regler","nr":3,"min":0,"max":1{v}}}"#);
    let p = uebersetze(&synth(r#","vorgabe":0.25"#, &zweiter(r#","vorgabe":0.75"#)), SR).unwrap();
    assert_eq!(p.regler_vorgaben()[2], 0.25);
    let p = uebersetze(&synth("", &zweiter(r#","vorgabe":0.75"#)), SR).unwrap();
    assert_eq!(p.regler_vorgaben()[2], 0.5, "the first node has no vorgabe: 0.5 wins, the second is ignored");
}

#[test]
fn b_vorgabe_ausserhalb_wird_abgelehnt() {
    for v in ["1.5", "-0.1"] {
        let e = uebersetze(&synth(&format!(r#","vorgabe":{v}"#), ""), SR).err().unwrap_or_else(|| panic!("vorgabe {v} must be refused"));
        let t = fehlertext(e);
        assert!(t.contains("vorgabe") && t.contains("0..1"), "{t}");
    }
}

/// Twelve parameter sets (linear, log, bipolar, two inverted): (min, max, log, mitte)
const SAETZE: [(f32, f32, bool, f32); 12] = [
    (0.0, 1.0, false, 0.3),
    (0.0, 10.0, false, 2.0),
    (-1.0, 1.0, false, 0.0),
    (-12.0, 12.0, false, 0.0),
    (-1.0, 3.0, false, 0.5),
    (20.0, 20_000.0, true, 1000.0),
    (0.001, 10.0, true, 0.05),
    (1.0, 2.0, true, 1.5),
    (0.0005, 5.0, true, 0.001),
    (0.001, 2.0, true, 0.002),
    // inverted ranges (max < mitte < min): the knob runs downwards
    (3.0, -1.0, false, 0.5),
    (20_000.0, 20.0, true, 1000.0),
];

fn mit_mitte(min: f32, max: f32, log: bool, mitte: f32) -> Programm {
    uebersetze(&mini(&format!(r#","min":{min:?},"max":{max:?},"log":{},"mitte":{mitte:?}"#, log as u8)), SR).unwrap()
}

#[test]
fn c_mitte_liegt_bei_halb_und_ist_monoton() {
    for (min, max, log, mitte) in SAETZE {
        let mut p = mit_mitte(min, max, log, mitte);
        assert_eq!(wert_bei(&mut p, 0.5).to_bits(), mitte.to_bits(), "{min}..{max} log {log}: knob 0.5 returns mitte bit-exact");
        assert_eq!(wert_bei(&mut p, 0.0).to_bits(), min.to_bits(), "{min}..{max} log {log}: knob 0 returns min");
        assert_eq!(wert_bei(&mut p, 1.0).to_bits(), max.to_bits(), "{min}..{max} log {log}: knob 1 returns max");
        let steigend = max >= min;
        let mut vorher = wert_bei(&mut p, 0.0);
        for i in 1..=1000 {
            let w = wert_bei(&mut p, i as f32 / 1000.0);
            assert!(((steigend && w >= vorher) || (!steigend && w <= vorher)) && w.is_finite(), "{min}..{max} log {log}: not monotone at {i}: {vorher} then {w}");
            vorher = w;
        }
        assert!(wert_bei(&mut p, 0.0).min(wert_bei(&mut p, 1.0)) >= min.min(max) && (0..=1000).all(|i| { let w = wert_bei(&mut p, i as f32 / 1000.0); w >= min.min(max) && w <= min.max(max) }), "{min}..{max}: stays inside the range");
        // each half is linear (or log) between its ends: the quarter points
        let (lo, hi) = (wert_bei(&mut p, 0.25), wert_bei(&mut p, 0.75));
        let (elo, ehi) = if log { ((min * mitte).sqrt(), (mitte * max).sqrt()) } else { ((min + mitte) / 2.0, (mitte + max) / 2.0) };
        assert!((lo - elo).abs() <= 1e-5 * elo.abs().max(1e-3), "{min}..{max} log {log}: lower quarter {lo} vs {elo}");
        assert!((hi - ehi).abs() <= 1e-5 * ehi.abs().max(1e-3), "{min}..{max} log {log}: upper quarter {hi} vs {ehi}");
    }
}

#[test]
fn c_mitte_ohne_feld_ist_die_alte_formel_und_ungueltiges_wird_abgelehnt() {
    // no `mitte`: a graph with min 0.001 max 2 log has 0.5 at the geometric middle, not at a constant
    let mut p = uebersetze(&mini(r#","min":0.001,"max":2,"log":1"#), SR).unwrap();
    assert_eq!(wert_bei(&mut p, 0.5).to_bits(), alt(0.001, 2.0, true, 0.5).to_bits());

    let refuse = |extra: &str, enthaelt: &[&str]| {
        let e = uebersetze(&mini(extra), SR).err().unwrap_or_else(|| panic!("{extra} must be refused"));
        let t = fehlertext(e);
        for s in enthaelt { assert!(t.contains(s), "{extra}: {t} lacks {s}"); }
    };
    refuse(r#","min":0,"max":1,"mitte":1"#, &["mitte", "between"]);
    refuse(r#","min":0,"max":1,"mitte":0"#, &["mitte", "between"]);
    refuse(r#","min":0,"max":1,"mitte":2"#, &["mitte", "between"]);
    refuse(r#","min":0,"max":1,"mitte":-0.5"#, &["mitte", "between"]);
    refuse(r#","min":0,"max":10,"log":1,"mitte":1"#, &["mitte", "min > 0"]);
    refuse(r#","min":0,"max":1,"mitte":0.5,"vorgabe":0.25"#, &["mitte", "vorgabe 0.5"]);
    // positive controls: vorgabe 0.5 written out is fine, as is a mitte next to it
    assert!(uebersetze(&mini(r#","min":0,"max":1,"mitte":0.25,"vorgabe":0.5"#), SR).is_ok());
}

/// The golden table: for every parameter set 13 knob positions with the engine's value. Written by this test, read by the JS test.
fn tafel() -> serde_json::Value {
    let ks = [0.0f32, 0.05, 0.1, 0.25, 0.4, 0.49, 0.5, 0.51, 0.6, 0.75, 0.9, 0.95, 1.0];
    let mut zeilen = Vec::new();
    for (min, max, log, mitte) in SAETZE {
        let mut p = mit_mitte(min, max, log, mitte);
        let punkte: Vec<_> = ks.iter().map(|&k| serde_json::json!({ "k": k as f64, "wert": wert_bei(&mut p, k) as f64 })).collect();
        zeilen.push(serde_json::json!({ "min": min as f64, "max": max as f64, "log": log, "mitte": mitte as f64, "punkte": punkte }));
    }
    serde_json::json!({ "kommentar": "written by tests/regler_vorgabe_mitte.rs (REGLER_TAFEL_SCHREIBEN=1); read by djk/ui/tests/panel_skala_mitte.test.mjs", "saetze": zeilen })
}

#[test]
fn c_goldene_tafel_stimmt_mit_der_engine() {
    let pfad = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests").join("regler_mitte_tafel.json");
    // through the text form, so both sides were parsed the same way
    let soll: serde_json::Value = serde_json::from_str(&serde_json::to_string_pretty(&tafel()).unwrap()).unwrap();
    if std::env::var("REGLER_TAFEL_SCHREIBEN").is_ok() {
        std::fs::write(&pfad, serde_json::to_string_pretty(&tafel()).unwrap() + "\n").unwrap();
    }
    let ist: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&pfad).expect("golden table missing: run with REGLER_TAFEL_SCHREIBEN=1")).unwrap();
    assert_eq!(ist, soll, "the committed golden table differs from the engine");
}
