//! Per-group level knobs of the `trommeln` block (knobs 33 to 39 of `drums-909` / `drums-808`): 0 dB is byte for byte the old sound,
//! each knob moves only its group, +6 dB is +6 dB, the level is read at the strike.
use baukasten_dsp::{uebersetze, Programm};

const SR: f32 = 48_000.0;
const G909: &str = include_str!("../demos/drums-909.json");
const G808: &str = include_str!("../demos/drums-808.json");

fn lade(g: &str) -> Programm { uebersetze(g, SR).unwrap_or_else(|e| panic!("{e}")) }

/// Every drum of the model, velocity 0.9, one every half second.
const NOTEN_909: [u8; 12] = [36, 37, 38, 39, 41, 45, 48, 42, 44, 46, 49, 51];
const NOTEN_808_EXTRA: [u8; 3] = [35, 56, 75];

fn alle_hits(m808: bool) -> Vec<(f32, u8, f32)> {
    let mut n: Vec<u8> = NOTEN_909.to_vec();
    if m808 {
        n.extend(NOTEN_808_EXTRA);
    }
    n.iter().enumerate().map(|(i, k)| (i as f32 * 0.5, *k, 0.9)).collect()
}

/// Plays `hits` (second, note, velocity), each released 0.125 s later, for `dauer` seconds; `knoepfe` are set before playing.
fn spiele(g: &str, hits: &[(f32, u8, f32)], dauer: f32, knoepfe: &[(usize, f32)]) -> Vec<(f32, f32)> {
    let mut p = lade(g);
    for (n, w) in knoepfe {
        p.setze_regler(*n, *w);
    }
    let mut ereignisse: Vec<(usize, bool, u8, f32)> = vec![];
    for (t, n, v) in hits {
        ereignisse.push(((t * SR) as usize, true, *n, *v));
        ereignisse.push((((t + 0.125) * SR) as usize, false, *n, 0.0));
    }
    ereignisse.sort_by_key(|e| (e.0, e.1));
    let mut ei = 0;
    let mut y = Vec::new();
    for i in 0..(dauer * SR) as usize {
        while ei < ereignisse.len() && ereignisse[ei].0 <= i {
            let (_, an, n, v) = ereignisse[ei];
            if an { p.note_an(n, v) } else { p.note_aus(n) }
            ei += 1;
        }
        let (l, r) = p.sample_stereo();
        assert!(l.is_finite() && r.is_finite());
        y.push((l, r));
    }
    assert_eq!(p.rettungen, 0);
    y
}

/// 64-bit FNV-1a over the little-endian bit patterns of the interleaved stereo output.
fn hash(x: &[(f32, f32)]) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for (l, r) in x {
        for v in [l, r] {
            for b in v.to_bits().to_le_bytes() {
                h ^= b as u64;
                h = h.wrapping_mul(0x0000_0100_0000_01B3);
            }
        }
    }
    h
}

fn render_hash(g: &str, hits: &[(f32, u8, f32)], knoepfe: &[(usize, f32)]) -> u64 { hash(&spiele(g, hits, 8.0, knoepfe)) }

// Hashes of the unchanged tree (base commit b69e82be4ce5a9e6d2c7c031fa673c986bcc874a), also in
// ~/messungen/2026-11-15-backlog/sound/task1/vorher-hashes.json
const VORHER_909: u64 = 0x5cc883e58fa60a8d;
const VORHER_808: u64 = 0x8a76b68248fc7541;

/// Knobs 33 to 39: kick, snare, clap, tom, hat, cymbal, perc.
const LV: [usize; 7] = [33, 34, 35, 36, 37, 38, 39];
/// A note of each group (clap group: 39, rim 37 checked separately; perc: cowbell, 808 only).
const GRUPPEN_NOTEN: [u8; 7] = [36, 38, 39, 41, 42, 49, 56];

fn peak(x: &[(f32, f32)]) -> f32 { x.iter().fold(0.0f32, |m, (l, r)| m.max(l.abs()).max(r.abs())) }

fn db(a: f32, b: f32) -> f32 { 20.0 * (a / b).log10() }

fn ein_hit(n: u8, v: f32) -> Vec<(f32, u8, f32)> { vec![(0.0, n, v)] }

/// The graph with `edit` applied to its JSON (nodes, edges).
fn mit(g: &str, edit: impl Fn(&mut serde_json::Value)) -> String {
    let mut v: serde_json::Value = serde_json::from_str(g).unwrap();
    edit(&mut v);
    v.to_string()
}

fn modelle() -> [(&'static str, &'static str, bool); 2] { [("909", G909, false), ("808", G808, true)] }

#[test]
fn null_bei_null_db() {
    let alle: Vec<(usize, f32)> = LV.iter().map(|n| (*n, 0.5)).collect();
    assert_eq!(render_hash(G909, &alle_hits(false), &alle), VORHER_909, "909 at 0 dB is not the old sound");
    assert_eq!(render_hash(G808, &alle_hits(true), &alle), VORHER_808, "808 at 0 dB is not the old sound");
    // and with the knobs untouched (their start value)
    assert_eq!(render_hash(G909, &alle_hits(false), &[]), VORHER_909);
    assert_eq!(render_hash(G808, &alle_hits(true), &[]), VORHER_808);
}

#[test]
fn gruppe_ist_isoliert() {
    for (name, g, m808) in modelle() {
        let mut noten: Vec<u8> = GRUPPEN_NOTEN.to_vec();
        noten.push(37);
        if m808 {
            noten.extend([35, 75]);
        }
        noten.extend([44, 46, 45, 48, 51]);
        for (k, kn) in LV.iter().enumerate() {
            for n in &noten {
                let eigene = (GRUPPEN_NOTEN[k] == *n)
                    || (k == 0 && *n == 35 && m808)
                    || (k == 2 && *n == 37)
                    || (k == 3 && [45, 48].contains(n))
                    || (k == 4 && [44, 46].contains(n))
                    || (k == 5 && *n == 51)
                    || (k == 6 && *n == 75 && m808)
                    || (k == 5 && *n == 56 && !m808);
                if eigene {
                    continue;
                }
                let a = spiele(g, &ein_hit(*n, 0.9), 2.5, &[]);
                let b = spiele(g, &ein_hit(*n, 0.9), 2.5, &[(*kn, 1.0)]);
                assert_eq!(hash(&a), hash(&b), "{name}: knob {kn} leaks into note {n}");
            }
        }
    }
}

#[test]
fn plus_6_db_trifft_nur_die_gruppe() {
    for (name, g, m808) in modelle() {
        for (k, kn) in LV.iter().enumerate() {
            if k == 6 && !m808 {
                // no 909 drum belongs to lv_perc: note 56 is a crash there and does not move
                let a = spiele(g, &ein_hit(56, 0.3), 2.5, &[(7, 0.0)]);
                let b = spiele(g, &ein_hit(56, 0.3), 2.5, &[(7, 0.0), (*kn, 0.75)]);
                assert_eq!(hash(&a), hash(&b), "909: knob 39 moves note 56");
                continue;
            }
            let mut noten = vec![GRUPPEN_NOTEN[k]];
            match k {
                0 if m808 => noten.push(35),
                2 => noten.push(37),
                4 => noten.extend([44, 46]),
                3 => noten.extend([45, 48]),
                5 => noten.push(51),
                6 => noten.push(75),
                _ => {}
            }
            for n in noten {
                let p0 = peak(&spiele(g, &ein_hit(n, 0.3), 3.5, &[(7, 0.0)]));
                let p1 = peak(&spiele(g, &ein_hit(n, 0.3), 3.5, &[(7, 0.0), (*kn, 0.75)]));
                let d = db(p1, p0);
                println!("MESS {name} knob {kn} note {n}: +6 dB knob gives {d:.2} dB");
                assert!((d - 6.0).abs() <= 0.3, "{name} knob {kn} note {n}: {d} dB");
            }
        }
    }
}

#[test]
fn minus_12_db_und_stumm() {
    for (name, g, m808) in modelle() {
        for (k, kn) in LV.iter().enumerate() {
            if k == 6 && !m808 {
                continue;
            }
            let n = GRUPPEN_NOTEN[k];
            let p0 = peak(&spiele(g, &ein_hit(n, 0.3), 3.5, &[(7, 0.0)]));
            let p1 = peak(&spiele(g, &ein_hit(n, 0.3), 3.5, &[(7, 0.0), (*kn, 0.0)]));
            let d = db(p1, p0);
            println!("MESS {name} knob {kn} note {n}: knob at 0 gives {d:.2} dB");
            assert!((d + 12.0).abs() <= 0.3, "{name} knob {kn}: {d} dB");
            // the engine floor of -24 dB, as a fixed value on the node instead of the knob
            let name_in = ["lv_kick", "lv_snare", "lv_clap", "lv_tom", "lv_hat", "lv_cym", "lv_perc"][k];
            let fest = mit(g, |v| {
                v["kanten"].as_array_mut().unwrap().retain(|e| e["nach"] != format!("kit.{name_in}"));
                for kn in v["knoten"].as_array_mut().unwrap() {
                    if kn["id"] == "kit" {
                        kn[name_in] = serde_json::json!(-24.0);
                    }
                }
            });
            let p2 = peak(&spiele(&fest, &ein_hit(n, 0.3), 3.5, &[(7, 0.0)]));
            let d2 = db(p2, p0);
            println!("MESS {name} {name_in} fixed -24 dB: {d2:.2} dB");
            assert!((d2 + 24.0).abs() <= 0.3, "{name} {name_in}: {d2} dB");
        }
    }
}

#[test]
fn pegel_wird_beim_anschlag_gelesen() {
    let g = G909;
    let hits = [(0.0, 38u8, 0.3f32), (1.0, 38, 0.3)];
    let statisch = spiele(g, &hits, 2.0, &[(7, 0.0)]);
    // the same run, the snare knob moved between the strikes
    let mut p = lade(g);
    p.setze_regler(7, 0.0);
    let mut y = Vec::new();
    for i in 0..(2.0 * SR) as usize {
        if i == 0 { p.note_an(38, 0.3) }
        if i == (0.125 * SR) as usize { p.note_aus(38) }
        if i == (0.5 * SR) as usize { p.setze_regler(34, 0.75) }
        if i == SR as usize { p.note_an(38, 0.3) }
        if i == (1.125 * SR) as usize { p.note_aus(38) }
        y.push(p.sample_stereo());
    }
    let bis = (0.95 * SR) as usize;
    assert_eq!(hash(&statisch[..bis]), hash(&y[..bis]), "the ringing hit must keep its level");
    let (a, b) = ((1.0 * SR) as usize, (1.9 * SR) as usize);
    let d = db(peak(&y[a..b]), peak(&statisch[a..b]));
    println!("MESS second hit after the knob move: {d:.2} dB");
    assert!((d - 6.0).abs() <= 0.3, "second hit {d} dB");
}

#[test]
fn extreme_ohne_clipping() {
    for (name, g, m808) in modelle() {
        let knoepfe: Vec<(usize, f32)> = (1..=39).map(|n| (n, 1.0)).collect();
        let mut noten: Vec<u8> = NOTEN_909.to_vec();
        if m808 {
            noten.extend(NOTEN_808_EXTRA);
        }
        let hits: Vec<(f32, u8, f32)> = noten.iter().enumerate().map(|(i, n)| (i as f32 * 0.4, *n, 1.0)).collect();
        let x = spiele(g, &hits, 9.0, &knoepfe);
        let m: Vec<f32> = x.iter().map(|(l, r)| 0.5 * (l + r)).collect();
        let dc = m.iter().map(|v| *v as f64).sum::<f64>() / m.len() as f64;
        let p = peak(&x);
        println!("MESS {name} every knob at 1.0: peak {p:.3}, mean {dc:.5}");
        assert!(p > 0.1 && p <= 0.98, "{name}: peak {p}");
        assert!(dc.abs() < 1e-3, "{name}: DC {dc}");
    }
}

#[test]
fn nan_pegel_faellt_auf_vorgabe() {
    for (name, g, _) in modelle() {
        let nan = mit(g, |v| {
            v["kanten"].as_array_mut().unwrap().retain(|e| e["nach"] != "kit.lv_kick");
            let kn = v["knoten"].as_array_mut().unwrap();
            kn.push(serde_json::json!({"id": "c_gross_a", "art": "konst", "wert": 1e30}));
            kn.push(serde_json::json!({"id": "c_gross_b", "art": "konst", "wert": 1e30}));
            kn.push(serde_json::json!({"id": "c_null", "art": "konst", "wert": 0.0}));
            kn.push(serde_json::json!({"id": "m_inf", "art": "mul"}));
            kn.push(serde_json::json!({"id": "m_nan", "art": "mul"}));
            let ka = v["kanten"].as_array_mut().unwrap();
            for (von, nach) in [("c_gross_a.aus", "m_inf.a"), ("c_gross_b.aus", "m_inf.b"), ("m_inf.aus", "m_nan.a"), ("c_null.aus", "m_nan.b"), ("m_nan.aus", "kit.lv_kick")] {
                ka.push(serde_json::json!({"von": von, "nach": nach}));
            }
        });
        let a = spiele(g, &ein_hit(36, 0.9), 2.0, &[]);
        let b = spiele(&nan, &ein_hit(36, 0.9), 2.0, &[]);
        assert_eq!(hash(&a), hash(&b), "{name}: a NaN level must act as 0 dB");
        assert!(peak(&b) > 0.1);
    }
}

#[test]
#[ignore]
fn print_reference_hashes() {
    println!("VORHER_909 = {:#018x}", render_hash(G909, &alle_hits(false), &[]));
    println!("VORHER_808 = {:#018x}", render_hash(G808, &alle_hits(true), &[]));
}
