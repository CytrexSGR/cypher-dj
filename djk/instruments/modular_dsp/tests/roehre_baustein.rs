//! Block `roehre` (S8 task 2): type number, I/O, value checks, stages, bias tables, NaN rule, bit-equality with the DSP.
use baukasten_dsp::roehre::{Roehre, RoehrenSatz};
use baukasten_dsp::{uebersetze, Fehler, Programm, ARTEN};

const SR: f32 = 48_000.0;

fn graph(knoten: &str, kanten: &str) -> String {
    format!(r#"{{"format":"baukasten/2","name":"t","stimmen":1,"knoten":[{{"id":"e","art":"eingang"}},{{"id":"o","art":"ausgang"}}{knoten}],"kanten":[{kanten}]}}"#)
}

/// eingang.l -> roehre -> ausgang.x, `werte` on the roehre node, `extra_knoten` / `extra_kanten` for modulation
fn fx(werte: &str, extra_knoten: &str, extra_kanten: &str) -> String {
    graph(
        &format!(r#",{{"id":"r","art":"roehre"{werte}}}{extra_knoten}"#),
        &format!(r#"{{"von":"e.l","nach":"r.x"}},{{"von":"r.aus","nach":"o.x"}}{extra_kanten}"#),
    )
}

/// konst `wert` on the `bias` input
fn mit_bias(werte: &str, bias: f32) -> String {
    fx(werte, &format!(r#",{{"id":"b","art":"konst","wert":{bias}}}"#), r#",{"von":"b.aus","nach":"r.bias"}"#)
}

fn bin_amp(x: &[f32], k: usize) -> f64 {
    let n = x.len();
    let w = 2.0 * std::f64::consts::PI * k as f64 / n as f64;
    let c = 2.0 * w.cos();
    let (mut s1, mut s2) = (0.0f64, 0.0f64);
    for v in x {
        let s = *v as f64 + c * s1 - s2;
        s2 = s1;
        s1 = s;
    }
    ((s1 * s1 + s2 * s2 - c * s1 * s2).max(0.0)).sqrt() * 2.0 / n as f64
}

fn sinus(f: f64, amp: f32, n: usize) -> Vec<f32> {
    (0..n).map(|i| amp * (2.0 * std::f64::consts::PI * f * i as f64 / SR as f64).sin() as f32).collect()
}

fn lauf(p: &mut Programm, l: &[f32]) -> Vec<f32> {
    l.iter().map(|x| { p.setze_eingang(*x, 0.0); p.sample_stereo().0 }).collect()
}

/// 2nd harmonic in dB re the fundamental of 200 Hz, amplitude 1, one second, 40 periods skipped, 160 measured (coherent)
fn h2(json: &str) -> f64 {
    let mut p = uebersetze(json, SR).unwrap();
    let y = lauf(&mut p, &sinus(200.0, 1.0, 48_000));
    let y = &y[9600..];
    20.0 * (bin_amp(y, 320) / bin_amp(y, 160)).log10()
}

#[test]
fn roehre_is_type_28_with_io() {
    let a = &ARTEN[28];
    assert_eq!(a.art, "roehre");
    assert_eq!(a.ein, &["x", "antrieb", "bias"]);
    assert_eq!(a.aus, &["aus"]);
    for f in [("antrieb", 0.0), ("bias", -1.5), ("stufen", 1.0)] {
        assert!(a.frei.contains(&f), "{f:?}");
    }
    assert!(ARTEN.len() >= 31, "ARTEN only grows at the end");
}

#[test]
fn value_checks() {
    for stufen in ["3", "0", "1.5", "-1"] {
        assert!(matches!(uebersetze(&fx(&format!(r#","stufen":{stufen}"#), "", ""), SR), Err(Fehler::Wert { .. })), "stufen {stufen}");
    }
    assert!(uebersetze(&fx(r#","stufen":2"#, "", ""), SR).is_ok());
    for bias in ["-3.2", "-0.4", "0", "-10"] {
        assert!(matches!(uebersetze(&fx(&format!(r#","bias":{bias}"#), "", ""), SR), Err(Fehler::Wert { .. })), "bias {bias}");
    }
    for bias in ["-3", "-0.5", "-1.3"] {
        assert!(uebersetze(&fx(&format!(r#","bias":{bias}"#), "", ""), SR).is_ok(), "bias {bias}");
    }
}

#[test]
fn two_stages_differ_from_one() {
    // C6: 200 Hz, amplitude 1.0, +24 dB; stufen 2 against stufen 1 differ in the 2nd harmonic by >= 3 dB (model 4.4)
    let (a, b) = (h2(&fx(r#","antrieb":24"#, "", "")), h2(&fx(r#","antrieb":24,"stufen":2"#, "", "")));
    println!("MESS +24 dB: H2 stufen 1 {a:.1} dB, stufen 2 {b:.1} dB, difference {:.1} dB (model 4.4)", (a - b).abs());
    assert!((a - b).abs() >= 3.0, "{a} {b}");
}

#[test]
fn block_equals_the_dsp_bit_for_bit() {
    // free values only, one table; stufen 2: the second stage runs at 0 dB with the same bias
    let json = fx(r#","antrieb":18,"bias":-1.8,"stufen":2"#, "", "");
    let mut p = uebersetze(&json, SR).unwrap();
    let satz = RoehrenSatz::eins(-1.8f32 as f64);
    let (mut r1, mut r2) = (Roehre::default(), Roehre::default());
    let x = sinus(330.0, 0.9, 5000);
    let y = lauf(&mut p, &x);
    for i in 0..x.len() {
        let soll = r2.prozess_satz(&satz, -1.8f32 as f64, r1.prozess_satz(&satz, -1.8f32 as f64, x[i], 18.0, SR), 0.0, SR);
        assert_eq!(y[i].to_bits(), soll.to_bits(), "sample {i}");
    }
    assert!(y.iter().any(|v| v.abs() > 0.5));
}

#[test]
fn bias_input_selects_tables() {
    // C6: +20 dB, 200 Hz amplitude 1.0: bias -3 against -0.5 differ in the 2nd harmonic by >= 6 dB (model 10.9)
    let a = h2(&mit_bias(r#","antrieb":20"#, -3.0));
    let b = h2(&mit_bias(r#","antrieb":20"#, -0.5));
    println!("MESS +20 dB: H2 bias -3 {a:.1} dB, bias -0.5 {b:.1} dB, difference {:.1} dB (model 10.9)", (a - b).abs());
    assert!((a - b).abs() >= 6.0, "{a} {b}");
    // an input at the free value gives exactly what the free value gives (table k = 0 and k = 1 are exact)
    for bias in [-3.0f32, -2.75, -1.5, -0.5] {
        let (mut m, mut f) = (uebersetze(&mit_bias(r#","antrieb":20"#, bias), SR).unwrap(), uebersetze(&fx(&format!(r#","antrieb":20,"bias":{bias}"#), "", ""), SR).unwrap());
        let x = sinus(200.0, 1.0, 3000);
        assert_eq!(lauf(&mut m, &x).iter().map(|v| v.to_bits()).collect::<Vec<_>>(), lauf(&mut f, &x).iter().map(|v| v.to_bits()).collect::<Vec<_>>(), "bias {bias}");
    }
}

#[test]
fn bias_is_clamped() {
    // -3.4 acts like -3, -0.1 like -0.5, bit-identical
    for (aussen, rand) in [(-3.4f32, -3.0f32), (-9.0, -3.0), (-0.1, -0.5), (4.0, -0.5)] {
        let (mut a, mut b) = (uebersetze(&mit_bias(r#","antrieb":20"#, aussen), SR).unwrap(), uebersetze(&mit_bias(r#","antrieb":20"#, rand), SR).unwrap());
        let x = sinus(200.0, 1.0, 3000);
        let (ya, yb) = (lauf(&mut a, &x), lauf(&mut b, &x));
        assert_eq!(ya.iter().map(|v| v.to_bits()).collect::<Vec<_>>(), yb.iter().map(|v| v.to_bits()).collect::<Vec<_>>(), "bias {aussen}");
        assert!(ya.iter().any(|v| v.abs() > 0.5));
    }
}

#[test]
fn bias_between_tables_is_interpolated() {
    // C6: bias -1.3 lies strictly between the 2nd harmonics of the -1.25 and the -1.5 tables ...
    let w = r#","antrieb":20"#;
    let (h25, h13, h15) = (h2(&mit_bias(w, -1.25)), h2(&mit_bias(w, -1.3)), h2(&mit_bias(w, -1.5)));
    println!("MESS H2 at +20 dB: bias -1.25 {h25:.3}, -1.3 {h13:.3}, -1.5 {h15:.3}");
    assert!(h13 > h25.min(h15) && h13 < h25.max(h15), "{h25} {h13} {h15}");
    // ... and the table choice itself (the level of the plate quiescent point, visible in the transient before the
    // high-pass has removed it) follows the weights: input -1.3 against an exact table at -1.3 stays close, a nearest or
    // floor choice would be off by the table step
    let mut m = uebersetze(&mit_bias(w, -1.3), SR).unwrap();
    let mut f = uebersetze(&fx(r#","antrieb":20,"bias":-1.3"#, "", ""), SR).unwrap();
    let x = vec![0.0f32; 400];
    let (ym, yf) = (lauf(&mut m, &x), lauf(&mut f, &x));
    let abw = ym.iter().zip(&yf).map(|(a, b)| (a - b).abs()).fold(0.0f32, f32::max);
    println!("MESS interpolated vs exact table at -1.3 (silence, first 400 samples): max deviation {abw:.4}");
    assert!(abw < 0.05, "deviation {abw}");
}

#[test]
fn no_allocation_tables_in_the_translation_not_the_run() {
    // the table sets exist after translation: the run reads them only (tests/keine_allokation.rs counts the allocations)
    let p = uebersetze(&mit_bias("", -2.0), SR).unwrap();
    assert_eq!(p.latenz(), 0);
    assert_eq!(RoehrenSatz::elf().anzahl(), 11);
    assert_eq!(RoehrenSatz::eins(-1.5).anzahl(), 1);
}

/// NaN for exactly the sample with `r = 1`: (3e38 * r)^2 = inf * 0 = NaN there, 0 elsewhere (r = 0)
const NAN_KNOTEN: &str = r#",{"id":"big","art":"konst","wert":3e38},{"id":"s","art":"mul"},{"id":"q","art":"mul"},{"id":"z","art":"konst","wert":0},{"id":"t","art":"mul"}"#;
const NAN_KANTEN: &str = r#",{"von":"e.r","nach":"s.a"},{"von":"big.aus","nach":"s.b"},{"von":"s.aus","nach":"q.a"},{"von":"s.aus","nach":"q.b"},{"von":"q.aus","nach":"t.a"},{"von":"z.aus","nach":"t.b"}"#;

#[test]
fn nan_inputs_no_reset() {
    // C7: one NaN sample on each input; the output stays finite, the program is not reset, and the run is bit-identical
    // to a run in which the NaN sample carries the replacement (x: 0; antrieb and bias: the node's own value)
    let n = 3000usize;
    let at = 1500usize;
    let x = sinus(220.0, 0.8, n);
    let r_nan: Vec<f32> = (0..n).map(|i| if i == at { 1.0 } else { 0.0 }).collect();
    let werte = r#","antrieb":15,"bias":-1.8"#;
    // (graph, x for the NaN run, x for the reference run)
    let faelle: Vec<(&str, String, Vec<f32>)> = vec![
        ("x", graph(&format!(r#",{{"id":"r","art":"roehre"{werte}}},{{"id":"a","art":"add"}}{NAN_KNOTEN}"#),
                    &format!(r#"{{"von":"e.l","nach":"a.a"}},{{"von":"t.aus","nach":"a.b"}},{{"von":"a.aus","nach":"r.x"}},{{"von":"r.aus","nach":"o.x"}}{NAN_KANTEN}"#)),
            x.iter().enumerate().map(|(i, v)| if i == at { 0.0 } else { *v }).collect()),
        ("antrieb", graph(&format!(r#",{{"id":"r","art":"roehre"{werte}}},{{"id":"a","art":"add","b":15}}{NAN_KNOTEN}"#),
                    &format!(r#"{{"von":"e.l","nach":"r.x"}},{{"von":"t.aus","nach":"a.a"}},{{"von":"a.aus","nach":"r.antrieb"}},{{"von":"r.aus","nach":"o.x"}}{NAN_KANTEN}"#)), x.clone()),
        ("bias", graph(&format!(r#",{{"id":"r","art":"roehre"{werte}}},{{"id":"a","art":"add","b":-1.8}}{NAN_KNOTEN}"#),
                    &format!(r#"{{"von":"e.l","nach":"r.x"}},{{"von":"t.aus","nach":"a.a"}},{{"von":"a.aus","nach":"r.bias"}},{{"von":"r.aus","nach":"o.x"}}{NAN_KANTEN}"#)), x.clone()),
    ];
    for (port, g, x_ref) in faelle {
        let (mut a, mut b) = (uebersetze(&g, SR).unwrap(), uebersetze(&g, SR).unwrap());
        let ya: Vec<f32> = (0..n).map(|i| { a.setze_eingang(x[i], r_nan[i]); a.sample_stereo().0 }).collect();
        let yb: Vec<f32> = (0..n).map(|i| { b.setze_eingang(x_ref[i], 0.0); b.sample_stereo().0 }).collect();
        assert_eq!(a.rettungen, 0, "{port}: program was reset");
        assert!(ya.iter().all(|v| v.is_finite()), "{port}");
        assert_eq!(ya.iter().map(|v| v.to_bits()).collect::<Vec<_>>(), yb.iter().map(|v| v.to_bits()).collect::<Vec<_>>(), "NaN on {port} must act like the replacement");
        // positive control: the tail before the NaN is not silent and the graph really receives the NaN (the NaN run with
        // the NaN replaced by a real value would differ)
        assert!(ya[..at].iter().any(|v| v.abs() > 0.1), "{port}: silent");
    }
}

/// Translation time (C5 budget: <= 300 ms per node with a bias edge, <= 40 ms without), only at 1-min loadavg <= 2:
/// `cargo test --release -p baukasten_dsp --test roehre_baustein translation_time -- --ignored --nocapture`
#[test]
#[ignore]
fn translation_time() {
    let last: f64 = std::fs::read_to_string("/proc/loadavg").unwrap().split(' ').next().unwrap().parse().unwrap();
    if last > 2.0 {
        println!("MESS translation time: not measured, loadavg {last}");
        return;
    }
    let zeit = |json: &str| {
        let mut t: Vec<f64> = (0..9).map(|_| { let s = std::time::Instant::now(); let p = uebersetze(json, SR).unwrap(); let d = s.elapsed().as_secs_f64() * 1e3; drop(p); d }).collect();
        t.sort_by(|a, b| a.partial_cmp(b).unwrap());
        t[4]
    };
    let (mit, ohne) = (zeit(&mit_bias("", -2.0)), zeit(&fx("", "", "")));
    println!("MESS translation time (median of 9, loadavg {last}): with bias edge {mit:.1} ms (budget 300), without {ohne:.1} ms (budget 40)");
    assert!(mit <= 300.0 && ohne <= 40.0);
}
