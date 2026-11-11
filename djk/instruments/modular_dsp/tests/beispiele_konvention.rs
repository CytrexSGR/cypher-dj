//! S13: convention lint over every shipped example graph (`beispiele/*.json`).
//!
//! The rules are the mechanical form of the knob convention K8 and of the sound audit of 2026-11-01:
//!  * every `regler` node has a name in `regler_namen`, and every name belongs to a `regler` node,
//!  * every `regler` node feeds something (no dead knob),
//!  * the pad family (`juno-pad*`) keeps knobs 1..5 as Cutoff, Resonance, Env amount, Attack, Release,
//!  * every `delay` and `hall` node has its `mix` input fed by an edge (a knob), except the allow-listed wet-only send,
//!  * on a fixed probe, no graph has DC above -50 dBFS and none peaks above 0.9 (pre-clamp, both sides).
//!
//! The probe is the one of the offline renderer (`examples/render.rs`): instruments play A2 C#3 E3 A3 at 0.5 s each, then
//! the chord for 1.5 s, then 1.5 s of tail; effect graphs get a synthetic 120 BPM loop (kick, hats, saw bass, chord
//! stab, peak -6 dBFS) of 6 s plus 1.5 s of tail. All knobs sit at the kern default 0.5.
//!
//! `BEISPIELE_DIR=/path` points the lint at another directory (used to show the lint red on the old graphs). Without it the
//! lint also covers the recipe patches in `demos/recipes/` (named `rezepte/<file>`).
mod gemeinsam;
use baukasten_dsp::{uebersetze_mit_wurzel, Programm, REGLER};
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

const SR: f32 = 48_000.0;
const DC_GRENZE_DBFS: f32 = -50.0;
const SPITZE_GRENZE: f32 = 0.9;

/// Graphs whose delay/hall mix is deliberately not a knob, each with its reason.
const MIX_OHNE_KNOB: &[(&str, &str)] = &[
    ("fx-bandecho", "wet-only send return for fx/3, fx/4: the wet level is the send level, and those channels have no kern knobs yet"),
    ("fx-delay-sync", "wet-only effect return (arr-bk slice 4): the delay's own mix stays at 1 and the dry is subtracted; the wet level is the Level knob and the send level"),
];

fn beispiele_dir() -> PathBuf {
    match std::env::var_os("BEISPIELE_DIR") {
        Some(d) => PathBuf::from(d),
        None => Path::new(env!("CARGO_MANIFEST_DIR")).join("demos"),
    }
}

fn graphen_in(dir: &Path, praefix: &str) -> Vec<(String, String)> {
    std::fs::read_dir(dir).expect("beispiele dir")
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().map_or(false, |x| x == "json") && p.file_name().map_or(false, |n| n != "MANIFEST.json"))
        .map(|p| (format!("{praefix}{}", p.file_stem().unwrap().to_string_lossy()), std::fs::read_to_string(&p).unwrap()))
        .collect()
}

fn alle_graphen() -> Vec<(String, String)> {
    let mut v = graphen_in(&beispiele_dir(), "");
    assert!(v.len() >= 22, "found only {} example graphs", v.len());
    if std::env::var_os("BEISPIELE_DIR").is_none() {
        let r = graphen_in(&beispiele_dir().join("recipes"), "rezepte/");
        assert_eq!(r.len(), 46, "recipe patches");
        v.extend(r);
    }
    v.sort();
    v
}

/// run `f` over `items` on all cores, results in order
fn parallel<T: Sync, R: Send>(items: &[T], f: impl Fn(&T) -> R + Sync) -> Vec<R> {
    let n = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).min(items.len().max(1));
    let teile: Vec<&[T]> = items.chunks(items.len().div_ceil(n).max(1)).collect();
    std::thread::scope(|s| {
        let h: Vec<_> = teile.iter().map(|t| s.spawn(|| t.iter().map(&f).collect::<Vec<R>>())).collect();
        h.into_iter().flat_map(|h| h.join().unwrap()).collect()
    })
}

/// A sample root holding the generated probe, for the sampler example (nothing is stored in the repo).
fn probe_wurzel() -> PathBuf {
    static W: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();
    W.get_or_init(|| {
        let w = std::env::temp_dir().join(format!("bk-s13-konvention-{}", std::process::id()));
        std::fs::create_dir_all(&w).unwrap();
        std::fs::write(w.join("orchester-schlag.f32"), baukasten_dsp::proben::bytes(&baukasten_dsp::proben::orchester_schlag(48_000.0))).unwrap();
        // S22: sampler-fairlight reads the hit as three detune slices.
        std::fs::write(w.join("orchester-schlag-schichten.f32"), baukasten_dsp::proben::bytes(&baukasten_dsp::proben::orchester_schlag_schichten(48_000.0))).unwrap();
        // S21 fx-federhall reads its spring IR from the graph folder (merge S13 + S21).
        std::fs::write(w.join("feder-ir.f32"), baukasten_dsp::proben::bytes(&baukasten_dsp::proben::feder_ir(48_000.0))).unwrap();
        w
    }).clone()
}

fn lade(name: &str, json: &str) -> Programm {
    uebersetze_mit_wurzel(json, SR, Some(&probe_wurzel())).unwrap_or_else(|e| panic!("{name}: {e}"))
}

fn knoten(j: &serde_json::Value) -> &Vec<serde_json::Value> { j["knoten"].as_array().unwrap() }
fn kanten(j: &serde_json::Value) -> Vec<(String, String)> {
    j["kanten"].as_array().unwrap().iter().map(|k| (k["von"].as_str().unwrap().to_string(), k["nach"].as_str().unwrap().to_string())).collect()
}

struct Mass { spitze: f32, rms_db: f32, dc: f32 }

/// Play the probe through `p` (knobs as set by the caller) and return the stereo output.
fn spiele_probe(p: &mut Programm) -> Vec<(f32, f32)> {
    p.setze_takt(0.0, 2.0 / SR as f64);
    let mut y: Vec<(f32, f32)> = Vec::new();
    if p.hat_eingang() {
        for v in gemeinsam::musik_probe().into_iter().chain(std::iter::repeat(0.0).take(72_000)) {
            p.setze_eingang(v, v);
            y.push(p.sample_stereo());
        }
    } else {
        let mut spiele = |p: &mut Programm, s: f32| for _ in 0..(s * SR) as usize { y.push(p.sample_stereo()); };
        for n in [45u8, 49, 52, 57] { p.note_an(n, 0.8); spiele(p, 0.5); p.note_aus(n); }
        for n in [45u8, 49, 52, 57] { p.note_an(n, 0.8); }
        spiele(p, 1.5);
        p.alle_aus();
        spiele(p, 1.5);
    }
    y
}

/// Render the probe at the default knobs and measure peak (pre-clamp), RMS over the active frames and DC (largest side).
fn messe(name: &str, json: &str) -> Mass {
    let mut p = lade(name, json);
    let y = spiele_probe(&mut p);
    assert!(y.iter().all(|(l, r)| l.is_finite() && r.is_finite()), "{name}: not finite");
    assert_eq!(p.rettungen, 0, "{name}: rescued");
    let spitze = y.iter().fold(0.0f32, |m, (l, r)| m.max(l.abs()).max(r.abs()));
    let (sl, sr) = y.iter().fold((0.0f64, 0.0f64), |a, (l, r)| (a.0 + *l as f64, a.1 + *r as f64));
    let dc = (sl / y.len() as f64).abs().max((sr / y.len() as f64).abs()) as f32;
    let m: Vec<f32> = y.iter().map(|(l, r)| (l + r) / 2.0).collect();
    let aktiv: Vec<f32> = m.chunks(2_400).filter(|c| (c.iter().map(|v| v * v).sum::<f32>() / c.len() as f32).sqrt() > 1e-3).flatten().cloned().collect();
    let rms = (aktiv.iter().map(|v| v * v).sum::<f32>() / aktiv.len().max(1) as f32).sqrt();
    Mass { spitze, rms_db: 20.0 * rms.max(1e-9).log10(), dc }
}

#[test]
fn jeder_regler_hat_einen_namen_und_einen_abnehmer() {
    for (name, json) in alle_graphen() {
        let j: serde_json::Value = serde_json::from_str(&json).unwrap();
        let p = lade(&name, &json);
        let regler: BTreeSet<usize> = knoten(&j).iter().filter(|k| k["art"] == "regler").map(|k| k["nr"].as_u64().unwrap() as usize).collect();
        let benannt: BTreeSet<usize> = p.regler_namen.iter().map(|(n, _)| *n).collect();
        assert!(regler.is_subset(&benannt), "{name}: knobs without a name in regler_namen: {:?}", regler.difference(&benannt).collect::<Vec<_>>());
        assert!(benannt.is_subset(&regler), "{name}: names without a regler node: {:?}", benannt.difference(&regler).collect::<Vec<_>>());
        assert!(p.regler_namen.iter().all(|(n, s)| (1..=REGLER).contains(n) && !s.trim().is_empty()), "{name}: empty name");
        let k = kanten(&j);
        for r in knoten(&j).iter().filter(|k| k["art"] == "regler") {
            let id = r["id"].as_str().unwrap();
            assert!(k.iter().any(|(von, _)| von.split('.').next() == Some(id)), "{name}: regler {id} feeds nothing (dead knob)");
        }
    }
}

#[test]
fn pad_familie_haelt_die_knopfnummern_1_bis_5() {
    let soll = ["Cutoff", "Resonance", "Env amount", "Attack", "Release"];
    let mut gesehen = 0;
    for (name, json) in alle_graphen() {
        if !name.starts_with("juno-pad") { continue; }
        gesehen += 1;
        let p = lade(&name, &json);
        for (i, s) in soll.iter().enumerate() {
            assert_eq!(p.regler_namen.iter().find(|(n, _)| *n == i + 1).map(|(_, s)| s.as_str()), Some(*s), "{name}: knob {}", i + 1);
        }
        assert_eq!(p.regler_namen.len(), REGLER, "{name}: all {REGLER} knobs named");
    }
    assert_eq!(gesehen, 4, "juno-pad, -hall, -echo, -dyn");
}

#[test]
fn delay_und_hall_mix_haengen_an_einem_knopf() {
    let mut geprueft = 0;
    for (name, json) in alle_graphen() {
        if MIX_OHNE_KNOB.iter().any(|(n, grund)| { assert!(!grund.is_empty()); *n == name }) { continue; }
        let j: serde_json::Value = serde_json::from_str(&json).unwrap();
        let k = kanten(&j);
        for n in knoten(&j).iter().filter(|n| n["art"] == "delay" || n["art"] == "hall") {
            let id = n["id"].as_str().unwrap();
            let ziel = format!("{id}.mix");
            let speisende: Vec<&String> = k.iter().filter(|(_, nach)| *nach == ziel).map(|(von, _)| von).collect();
            assert!(!speisende.is_empty(), "{name}: {} node {id} has a fixed mix, wire a regler to {ziel}", n["art"]);
            let von_regler = speisende.iter().any(|v| {
                let q = v.split('.').next().unwrap();
                knoten(&j).iter().any(|r| r["id"] == q && r["art"] == "regler")
            });
            assert!(von_regler, "{name}: {ziel} is fed by {speisende:?}, not by a regler");
            geprueft += 1;
        }
    }
    assert!(geprueft >= 5, "positive control: expected at least 5 delay/hall nodes, saw {geprueft}");
}

#[test]
fn sondergrund_liste_ist_ehrlich() {
    // the allow-list may only name graphs that exist, and each of them really has a fixed delay/hall mix (else the entry is stale)
    let alle = alle_graphen();
    for (n, _) in MIX_OHNE_KNOB {
        let (_, json) = alle.iter().find(|(name, _)| name == n).unwrap_or_else(|| panic!("allow-list names unknown graph {n}"));
        let j: serde_json::Value = serde_json::from_str(json).unwrap();
        let k = kanten(&j);
        assert!(knoten(&j).iter().any(|x| (x["art"] == "delay" || x["art"] == "hall") && !k.iter().any(|(_, nach)| *nach == format!("{}.mix", x["id"].as_str().unwrap()))), "{n}: stale allow-list entry");
    }
}

#[test]
fn kein_gleichanteil_und_keine_uebersteuerung_auf_der_probe() {
    let dc_grenze = 10f32.powf(DC_GRENZE_DBFS / 20.0);
    let fehler: Vec<String> = parallel(&alle_graphen(), |(name, json)| {
        let mut fehler = Vec::new();
        let m = messe(name, json);
        println!("MESS {name:20} peak {:.3} ({:5.1} dB)  rms {:6.1} dB  dc {:.5} ({:6.1} dBFS)", m.spitze, 20.0 * m.spitze.log10(), m.rms_db, m.dc, 20.0 * m.dc.max(1e-9).log10());
        if m.dc > dc_grenze { fehler.push(format!("{name}: DC {:.1} dBFS above {DC_GRENZE_DBFS}", 20.0 * m.dc.log10())); }
        if m.spitze >= SPITZE_GRENZE { fehler.push(format!("{name}: peak {:.3} not below {SPITZE_GRENZE}", m.spitze)); }
        // positive control: the probe really plays (a silent graph would pass both limits trivially)
        if m.rms_db < -60.0 { fehler.push(format!("{name}: silent on the probe ({:.1} dB)", m.rms_db)); }
        fehler
    }).into_iter().flatten().collect();
    assert!(fehler.is_empty(), "convention violations:\n  {}", fehler.join("\n  "));
}

/// Knobs that legitimately do nothing on the probe, each with its reason. Everything else must change the sound.
const REGLER_OHNE_WIRKUNG_AUF_DER_PROBE: &[(&str, usize, &str)] = &[];

fn probe_mit_regler(name: &str, json: &str, nr: usize, wert: f32) -> Vec<(f32, f32)> {
    let mut p = lade(name, json);
    p.setze_regler(nr, wert);
    spiele_probe(&mut p)
}

#[test]
fn jeder_regler_aendert_den_klang_auf_der_probe() {
    // The "feeds something" check of the first test passes vacuously when the consumer ignores the input (S13:
    // rueckkopplung "Zeit" fed leitung.zeit, which is bypassed once leitung.hz is wired). Sweep every knob 0 against 1
    // (others at 0.5) and require a different output.
    let mut faelle = Vec::new();
    for (name, json) in alle_graphen() {
        let j: serde_json::Value = serde_json::from_str(&json).unwrap();
        let regler: BTreeSet<usize> = knoten(&j).iter().filter(|k| k["art"] == "regler").map(|k| k["nr"].as_u64().unwrap() as usize).collect();
        faelle.extend(regler.into_iter().map(|nr| (name.clone(), json.clone(), nr)));
    }
    let gesehen = faelle.len();
    let tot: Vec<String> = parallel(&faelle, |(name, json, nr)| {
        let nr = *nr;
        let (a, b) = (probe_mit_regler(name, json, nr, 0.0), probe_mit_regler(name, json, nr, 1.0));
        let diff = a.iter().zip(&b).fold(0.0f32, |m, (x, y)| m.max((x.0 - y.0).abs()).max((x.1 - y.1).abs()));
        println!("MESS sweep {name:20} knob {nr}: max |0 - 1| {diff:.5}");
        let erlaubt = REGLER_OHNE_WIRKUNG_AUF_DER_PROBE.iter().any(|(n, k, grund)| { assert!(!grund.is_empty()); *n == name && *k == nr });
        if diff == 0.0 && !erlaubt { Some(format!("{name}: knob {nr} is dead on the probe (output bit-identical at 0 and 1)")) }
        else if diff != 0.0 && erlaubt { Some(format!("{name}: knob {nr} is allow-listed as dead but changes the sound (stale entry)")) }
        else { None }
    }).into_iter().flatten().collect();
    assert!(gesehen >= 70, "positive control: expected at least 70 knobs in the sweep, saw {gesehen}");
    assert!(tot.is_empty(), "dead knobs:\n  {}", tot.join("\n  "));
}
