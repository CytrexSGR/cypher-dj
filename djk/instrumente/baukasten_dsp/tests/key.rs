//! Key (sidechain) inputs `kl`, `kr` of `komp` and `gate` (S9). The key replaces the detector input only; it is never heard.
//! Without a key edge both blocks must be bit-identical to the S8 path.
use baukasten_dsp::gate::Gate;
use baukasten_dsp::{uebersetze, Fehler};
use std::f64::consts::PI;

const SR: f32 = 48_000.0;

fn sinus(hz: f64, amp: f64, n: usize) -> Vec<f32> {
    (0..n).map(|i| (amp * (2.0 * PI * hz * i as f64 / SR as f64).sin()) as f32).collect()
}

fn db(x: &[f32]) -> f64 {
    let q: f64 = x.iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / x.len() as f64;
    10.0 * q.max(1e-20).log10()
}

/// `[a, b)` in seconds
fn fenster(x: &[f32], a: f64, b: f64) -> &[f32] {
    &x[(a * SR as f64) as usize..(b * SR as f64) as usize]
}

/// Graph: eingang -> block `p` -> ausgang. `werte` are the block's JSON values, `kanten` the extra edges.
fn graph(art: &str, werte: &str, kanten: &str) -> String {
    format!(
        r#"{{"format":"baukasten/2","name":"key","stimmen":1,"knoten":[{{"id":"e","art":"eingang"}},{{"id":"z","art":"konst","wert":0}},{{"id":"p","art":"{art}"{werte}}},{{"id":"o","art":"ausgang"}}],"kanten":[{{"von":"e.l","nach":"p.l"}},{{"von":"p.l","nach":"o.l"}},{{"von":"p.r","nach":"o.r"}}{kanten}]}}"#
    )
}

/// Feeds (audio, key) into eingang.l / eingang.r and returns the stereo output.
fn lauf(json: &str, audio: &[f32], key: &[f32]) -> Vec<(f32, f32)> {
    let mut p = uebersetze(json, SR).unwrap_or_else(|e| panic!("{e}"));
    audio.iter().zip(key).map(|(a, k)| { p.setze_eingang(*a, *k); p.sample_stereo() }).collect()
}

fn links(x: &[(f32, f32)]) -> Vec<f32> { x.iter().map(|v| v.0).collect() }

const GATE_W: &str = r#","schwelle":-30,"hyst":6,"tiefe":80,"attack":1,"release":50"#;
const KEY_E: &str = r#",{"von":"e.r","nach":"p.kl"}"#;

/// sine `amp` at `hz` in [a, b) seconds, silence elsewhere
fn burst(hz: f64, amp: f64, n: usize, a: f64, b: f64) -> Vec<f32> {
    let s = sinus(hz, amp, n);
    (0..n).map(|i| if (i as f64) >= a * SR as f64 && (i as f64) < b * SR as f64 { s[i] } else { 0.0 }).collect()
}

#[test]
fn unkeyed_bit_identical() {
    let n = 48_000;
    let (xl, xr) = (sinus(440.0, 0.5, n), sinus(660.0, 0.3, n));
    // gate
    let json = graph("gate", r#","schwelle":-30,"release":50"#, r#",{"von":"e.r","nach":"p.r"}"#);
    let mut p = uebersetze(&json, SR).unwrap();
    let mut g = Gate::neu(-30.0, 6.0, 80.0, 1.0, 50.0, SR);
    let mut oeffnete = false;
    for i in 0..n {
        p.setze_eingang(xl[i], xr[i]);
        let (a, b) = p.sample_stereo();
        let (c, d) = g.prozess(xl[i], xr[i]);
        oeffnete |= g.offen();
        assert_eq!((a.to_bits(), b.to_bits()), (c.to_bits(), d.to_bits()), "gate sample {i}");
    }
    assert!(oeffnete, "positive control: the gate opened");
    // komp
    let json = graph("komp", "", r#",{"von":"e.r","nach":"p.r"}"#);
    let mut p = uebersetze(&json, SR).unwrap();
    let mut k = komp_dsp::Komp::neu(SR as f64);
    k.setze(&komp_dsp::Einstellung { schwelle_db: -18.0, ratio: 4.0, knie_db: 6.0, attack_ms: 10.0, release_ms: 120.0,
                                    makeup_db: 0.0, mix: 1.0, sc_hochpass_hz: 0.0 });
    let mut reduzierte = false;
    for i in 0..n {
        p.setze_eingang(xl[i], xr[i]);
        let (a, b) = p.sample_stereo();
        let (mut l, mut r) = ([xl[i]], [xr[i]]);
        k.block(&mut l, &mut r, None);
        reduzierte |= k.gr_db() > 1.0;
        assert_eq!((a.to_bits(), b.to_bits()), (l[0].to_bits(), r[0].to_bits()), "komp sample {i}");
    }
    assert!(reduzierte, "positive control: the compressor reduced");
}

#[test]
fn gate_silent_key_closes() {
    let n = 48_000;
    let json = graph("gate", GATE_W, r#",{"von":"z.aus","nach":"p.kl"}"#);
    let x = sinus(1000.0, 0.5, n);
    let y = links(&lauf(&json, &x, &vec![0.0; n]));
    let r = db(fenster(&y, 0.5, 1.0));
    println!("MESS gate silent key: {r:.2} dBFS (model -89.0)");
    assert!(r < -80.0, "silent key must close the gate: {r:.2} dBFS");
    // negative control: the same gate without a key edge hears the input and opens
    let y = links(&lauf(&graph("gate", GATE_W, ""), &x, &vec![0.0; n]));
    assert!(db(fenster(&y, 0.5, 1.0)) > -12.0, "without key the gate opens on its own input");
}

#[test]
fn gate_key_bursts() {
    let n = (2.2 * SR as f64) as usize;
    let w = r#","schwelle":-30,"hyst":6,"tiefe":80,"attack":1,"release":15"#;
    let json = graph("gate", w, KEY_E);
    let x = sinus(1000.0, 0.5, n);
    let mut key = vec![0.0f32; n];
    let ks = sinus(1000.0, 0.5, n);
    for k in 0..4 {
        let (a, b) = (((0.1 + 0.5 * k as f64) * SR as f64) as usize, ((0.15 + 0.5 * k as f64) * SR as f64) as usize);
        key[a..b].copy_from_slice(&ks[a..b]);
    }
    let y = links(&lauf(&json, &x, &key));
    for k in 0..4 {
        let s = 0.1 + 0.5 * k as f64;
        let (yi, xi) = (db(fenster(&y, s + 0.005, s + 0.05)), db(fenster(&x, s + 0.005, s + 0.05)));
        let tail = db(fenster(&y, s + 0.05 + 0.2, s + 0.05 + 0.45));
        println!("MESS burst {k}: in-burst delta {:.3} dB, tail {tail:.1} dBFS", yi - xi);
        assert!((yi - xi).abs() <= 1.0, "burst {k}: output {yi:.2} vs input {xi:.2} dB");
        assert!(tail < -60.0, "burst {k}: tail {tail:.1} dBFS");
    }
}

#[test]
fn gate_unkeyed_open() {
    let n = 48_000;
    let x = sinus(1000.0, 0.5, n);
    let y = links(&lauf(&graph("gate", GATE_W, ""), &x, &vec![0.0; n]));
    let d = db(fenster(&y, 0.05, 1.0)) - db(fenster(&x, 0.05, 1.0));
    assert!(d.abs() < 0.1, "unkeyed gate on a loud sine stays open: {d:.3} dB");
}

fn komp_w(schp: u32) -> String {
    format!(r#","schwelle":-30,"ratio":10,"knie":0,"attack":1,"release":100,"makeup":0,"mix":1,"schp":{schp}"#)
}

/// gain reduction in dB over [a, b)
fn reduktion(x: &[f32], y: &[f32], a: f64, b: f64) -> f64 { db(fenster(x, a, b)) - db(fenster(y, a, b)) }

#[test]
fn komp_keyed_ducks() {
    let n = (2.6 * SR as f64) as usize;
    let x = sinus(1000.0, 0.1, n);
    let key = burst(1000.0, 1.0, n, 1.0, 1.5);
    let y = links(&lauf(&graph("komp", &komp_w(0), KEY_E), &x, &key));
    let (r1, r2) = (reduktion(&x, &y, 1.3, 1.5), reduktion(&x, &y, 2.4, 2.5));
    println!("MESS komp keyed: reduction {r1:.2} dB (model 26.97), after release {r2:.3} dB");
    assert!(r1 >= 20.0, "keyed reduction {r1:.2} dB");
    assert!(r2 < 0.5, "recovered {r2:.3} dB");
    // negative control: without a key edge the loud key is ignored, the detector reads the quiet audio only
    let y0 = links(&lauf(&graph("komp", &komp_w(0), ""), &x, &key));
    let r0 = reduktion(&x, &y0, 1.3, 1.5);
    println!("MESS komp unkeyed: reduction {r0:.2} dB");
    assert!(r0 < r1 - 10.0, "unkeyed run ignores the loud key: {r0:.2} dB vs keyed {r1:.2} dB");
}

#[test]
fn komp_key_hochpass() {
    let n = (2.6 * SR as f64) as usize;
    let x = sinus(1000.0, 0.1, n);
    let key = burst(50.0, 1.0, n, 1.0, 1.5);
    let red = |schp| {
        let y = links(&lauf(&graph("komp", &komp_w(schp), KEY_E), &x, &key));
        reduktion(&x, &y, 1.3, 1.5)
    };
    let (r0, r200) = (red(0), red(200));
    println!("MESS komp 50 Hz key: schp 0 {r0:.2} dB, schp 200 {r200:.2} dB, difference {:.2} (model 21.6)", r0 - r200);
    assert!(r0 - r200 >= 10.0, "schp 200 must cut the 50 Hz key: {r0:.2} vs {r200:.2} dB");
}

#[test]
fn one_side_is_mono_key() {
    let n = 48_000;
    let x = sinus(1000.0, 0.3, n);
    let key = burst(1000.0, 0.5, n, 0.2, 0.3);
    for (art, w) in [("gate", GATE_W.to_string()), ("komp", komp_w(0))] {
        let mit = |kanten: &str| {
            // audio on both sides so that the difference between kl-only and kl+kr could show on either
            lauf(&graph(art, &w, &format!(r#",{{"von":"e.l","nach":"p.r"}}{kanten}"#)), &x, &key)
        };
        let a = mit(KEY_E);
        let b = mit(&format!(r#"{KEY_E},{{"von":"e.r","nach":"p.kr"}}"#));
        let c = mit(r#",{"von":"e.r","nach":"p.kr"}"#);
        assert!(a.iter().zip(&b).all(|(p, q)| p.0.to_bits() == q.0.to_bits() && p.1.to_bits() == q.1.to_bits()), "{art}: kl only == kl+kr");
        assert!(a.iter().zip(&c).all(|(p, q)| p.0.to_bits() == q.0.to_bits() && p.1.to_bits() == q.1.to_bits()), "{art}: kr only == kl+kr");
        // positive control: the key is in effect (not the unkeyed path)
        let u = mit("");
        assert!(a.iter().zip(&u).any(|(p, q)| p.0.to_bits() != q.0.to_bits()), "{art}: keyed differs from unkeyed");
    }
}

#[test]
fn key_inf_guard() {
    let mut g = Gate::neu(-30.0, 6.0, 80.0, 1.0, 50.0, SR);
    let a = 0.5f32;
    for _ in 0..4_800 {
        g.prozess_key(a, a, a, a);
    }
    assert!(g.offen() && g.verstaerkung() > 0.99, "opened");
    for (name, bad, len) in [("+Inf", f32::INFINITY, 200usize), ("NaN", f32::NAN, 2_400)] {
        let mut g = Gate::neu(-30.0, 6.0, 80.0, 1.0, 50.0, SR);
        for _ in 0..4_800 {
            g.prozess_key(a, a, a, a);
        }
        for _ in 0..len {
            let (l, r) = g.prozess_key(a, a, bad, bad);
            assert!(l.is_finite() && r.is_finite(), "{name}: output finite");
        }
        let mut zu = None;
        for i in 0..14_400 {
            let (l, r) = g.prozess_key(a, a, 0.0, 0.0);
            assert!(l.is_finite() && r.is_finite(), "{name}: output finite after");
            if zu.is_none() && g.verstaerkung() < 0.01 {
                zu = Some(i);
            }
        }
        println!("MESS {name} key: gain < 0.01 after {zu:?} samples (limit 14400)");
        assert!(zu.is_some(), "{name}: the gate must close within 300 ms after the bad key stops");
    }
}

#[test]
fn key_value_rejected() {
    for (art, port) in [("gate", "kl"), ("gate", "kr"), ("komp", "kl"), ("komp", "kr")] {
        let j = format!(
            r#"{{"format":"baukasten/2","name":"k","stimmen":1,"knoten":[{{"id":"e","art":"eingang"}},{{"id":"p","art":"{art}","{port}":0.3}},{{"id":"o","art":"ausgang"}}],"kanten":[{{"von":"e.l","nach":"p.l"}},{{"von":"p.l","nach":"o.l"}}]}}"#
        );
        assert!(matches!(uebersetze(&j, SR), Err(Fehler::Wert { .. })), "{art}.{port} value must be rejected");
    }
    // control: a harmless value is still accepted
    let j = r#"{"format":"baukasten/2","name":"k","stimmen":1,"knoten":[{"id":"e","art":"eingang"},{"id":"p","art":"gate","schwelle":-30},{"id":"o","art":"ausgang"}],"kanten":[{"von":"e.l","nach":"p.l"},{"von":"p.l","nach":"o.l"}]}"#;
    assert!(uebersetze(j, SR).is_ok());
}

#[test]
fn key_is_not_heard() {
    let n = 48_000;
    let x = sinus(1000.0, 0.3, n);
    let key = sinus(300.0, 1.0, n);
    let w = |ratio: u32| format!(r#","schwelle":-30,"ratio":{ratio},"knie":0,"attack":1,"release":100,"makeup":0,"mix":1"#);
    let y = links(&lauf(&graph("komp", &w(1), KEY_E), &x, &key));
    assert!(x.iter().zip(&y).all(|(p, q)| p.to_bits() == q.to_bits()), "ratio 1: output == input bit for bit");
    // control: with ratio 10 the same loud key does act on the gain
    let y = links(&lauf(&graph("komp", &w(10), KEY_E), &x, &key));
    assert!(reduktion(&x, &y, 0.5, 1.0) > 6.0, "control: the key is loud enough to duck at ratio 10");
}

#[test]
fn key_level_is_max_of_both_sides() {
    let n = 48_000;
    let x = sinus(1000.0, 0.5, n);
    let key = sinus(1000.0, 0.5, n);
    for kanten in [r#",{"von":"z.aus","nach":"p.kl"},{"von":"e.r","nach":"p.kr"}"#, r#",{"von":"e.r","nach":"p.kl"},{"von":"z.aus","nach":"p.kr"}"#] {
        let y = links(&lauf(&graph("gate", GATE_W, kanten), &x, &key));
        let d = db(fenster(&y, 0.5, 1.0)) - db(fenster(&x, 0.5, 1.0));
        assert!(d.abs() < 1.0, "the louder key side opens the gate ({kanten}): {d:.2} dB");
    }
}

#[test]
fn key_is_summed_over_voices_like_the_audio() {
    // two voices, each konst 0.1 (-20 dBFS) on kl: one voice stays below the threshold -17 dBFS, the sum 0.2 (-14 dBFS) opens
    let json = r#"{"format":"baukasten/2","name":"k","stimmen":2,"knoten":[{"id":"e","art":"eingang"},{"id":"c","art":"konst","wert":0.1},{"id":"p","art":"gate","schwelle":-17,"hyst":6,"tiefe":80,"attack":1,"release":50},{"id":"o","art":"ausgang"}],"kanten":[{"von":"e.l","nach":"p.l"},{"von":"c.aus","nach":"p.kl"},{"von":"p.l","nach":"o.l"}]}"#;
    let x = sinus(1000.0, 0.5, 48_000);
    let y = links(&lauf(json, &x, &x));
    let d = db(fenster(&y, 0.5, 1.0)) - db(fenster(&x, 0.5, 1.0));
    assert!(d.abs() < 1.0, "summed key opens the gate: {d:.2} dB");
    let eine = json.replace(r#""stimmen":2"#, r#""stimmen":1"#);
    let y = links(&lauf(&eine, &x, &x));
    assert!(db(fenster(&y, 0.5, 1.0)) < -60.0, "control: one voice (0.1) stays closed");
}
