//! Sample and hold (`sh`): hold between clocks, clock rate, edge triggering, slew time, noise determinism, beat clock.
//! `x` and `trig` are driven sample by sample through two knobs (regler 1 = x in -1..1, regler 2 = trig 0..1), so the
//! input of every sample is known exactly; a second program `x -> ausgang` gives the reference series.
use baukasten_dsp::{sh::Sh, uebersetze, Fehler, Programm};

const SR: f32 = 48_000.0;

fn lade(json: &str) -> Programm { uebersetze(json, SR).unwrap_or_else(|e| panic!("{e:?}")) }

/// knob 1 -> sh.x, knob 2 -> sh.trig (when `mit_trig`), sh.aus -> ausgang
fn graph(werte: &str, mit_trig: bool) -> String {
    let trig = if mit_trig { r#",{"von":"k2.aus","nach":"s.trig"}"# } else { "" };
    format!(
        r#"{{"format":"baukasten/2","name":"sh","stimmen":1,"knoten":[{{"id":"k1","art":"regler","nr":1,"min":-1,"max":1}},{{"id":"k2","art":"regler","nr":2,"min":0,"max":1}},{{"id":"s","art":"sh"{werte}}},{{"id":"o","art":"ausgang"}}],"kanten":[{{"von":"k1.aus","nach":"s.x"}}{trig},{{"von":"s.aus","nach":"o.x"}}]}}"#
    )
}

fn referenz() -> Programm {
    lade(r#"{"format":"baukasten/2","name":"ref","stimmen":1,"knoten":[{"id":"k1","art":"regler","nr":1,"min":-1,"max":1},{"id":"o","art":"ausgang"}],"kanten":[{"von":"k1.aus","nach":"o.x"}]}"#)
}

/// a changing but deterministic x in 0..1 (knob value) for sample i
fn xk(i: usize) -> f32 { ((i * 7919 + 13) % 9973) as f32 / 9973.0 }

/// (output, reference) for `n` samples with x = xk(i) and trig = `trig(i)`
fn lauf(werte: &str, mit_trig: bool, n: usize, trig: impl Fn(usize) -> f32) -> Vec<(f32, f32)> {
    let (mut p, mut r) = (lade(&graph(werte, mit_trig)), referenz());
    (0..n).map(|i| {
        p.setze_regler(1, xk(i));
        p.setze_regler(2, trig(i));
        r.setze_regler(1, xk(i));
        (p.sample_stereo().0, r.sample_stereo().0)
    }).collect()
}

#[test]
fn holds_between_clocks_and_runs_at_the_clock_rate() {
    // 100 Hz = every 480 samples; 10 s
    let y = lauf(r#","rate":100"#, false, 480_000, |_| 0.0);
    let ticks: Vec<usize> = (0..y.len()).filter(|&i| i == 0 || y[i].0 != y[i - 1].0).collect();
    // x changes every sample, so every change of the output is a tick
    assert!((1000..=1001).contains(&ticks.len()), "{} ticks in 10 s at 100 Hz", ticks.len());
    for &t in &ticks {
        assert_eq!(y[t].0, y[t].1, "tick at sample {t} must take x of that sample");
    }
    for w in ticks.windows(2) {
        let d = w[1] - w[0];
        assert!((479..=481).contains(&d), "tick spacing {d}");
        // held: every sample between two ticks equals the sampled value
        assert!(y[w[0]..w[1]].iter().all(|s| s.0 == y[w[0]].0), "output moved between ticks at {}", w[0]);
    }
    let mittel = (ticks[ticks.len() - 1] - ticks[0]) as f64 / (ticks.len() - 1) as f64;
    println!("MESS sh rate 100 Hz: {} ticks in 10 s, mean spacing {mittel:.4} samples (480 expected)", ticks.len());
    assert!((mittel - 480.0).abs() < 0.05);
}

#[test]
fn rate_input_and_other_rates() {
    for (rate, soll) in [(1.0f32, 48_000.0f64), (7.3, 48_000.0 / 7.3), (1000.0, 48.0)] {
        let n = 480_000;
        let y = lauf(&format!(r#","rate":{rate}"#), false, n, |_| 0.0);
        let ticks = (1..y.len()).filter(|&i| y[i].0 != y[i - 1].0).count() + 1;
        let erwartet = n as f64 / soll;
        assert!((ticks as f64 - erwartet).abs() <= 1.5, "rate {rate}: {ticks} ticks, expected {erwartet:.2}");
    }
}

#[test]
fn rate_zero_samples_once_and_holds() {
    let y = lauf(r#","rate":0"#, false, 20_000, |_| 0.0);
    assert_eq!(y[0].0, y[0].1);
    assert!(y.iter().all(|s| s.0 == y[0].0), "rate 0 must hold the first value");
}

#[test]
fn trig_edge_samples_only_on_the_rising_edge() {
    // trig: high 0..300, low, high again from 1000 for 50 samples, low, high from 2000 (level exactly 0.5 does not count)
    let t = |i: usize| match i { 100..=399 => 1.0, 1000..=1049 => 1.0, 1500..=1999 => 0.5, 2000..=2100 => 1.0, _ => 0.0 };
    let y = lauf(r#","rate":1000"#, true, 3000, t);
    // before the first edge: the initial 0
    assert!(y[..100].iter().all(|s| s.0 == 0.0), "no sample before the first edge");
    let k1 = y[100].1;
    assert_eq!(y[100].0, k1, "edge at 100 samples x of that sample");
    assert!(y[100..1000].iter().all(|s| s.0 == k1), "held while trig is high and after the falling edge (x keeps changing)");
    assert_eq!(y[1000].0, y[1000].1, "second edge");
    assert!(y[1000..2000].iter().all(|s| s.0 == y[1000].0), "0.5 is not an edge, and rate is ignored when trig is connected");
    assert_eq!(y[2000].0, y[2000].1, "third edge");
    assert!(y[2000..].iter().all(|s| s.0 == y[2000].0));
    // internal rate 1000 Hz would have ticked every 48 samples: the output changed exactly three times
    let aenderungen = (1..y.len()).filter(|&i| y[i].0 != y[i - 1].0).count();
    assert_eq!(aenderungen, 3);
}

#[test]
fn slew_takes_the_time_and_ends_on_the_target() {
    // 10 ms = 480 samples, one edge at sample 1000 from 0 to the sampled x
    let t = |i: usize| if (1000..1100).contains(&i) { 1.0 } else { 0.0 };
    let y = lauf(r#","glatt":10"#, true, 3000, t);
    let ziel = y[1000].1;
    assert!(ziel.abs() > 0.3, "pick a start with a real step: {ziel}");
    assert!(y[..1000].iter().all(|s| s.0 == 0.0));
    // linear: sample 1000 + j (j = 0..479) is ziel * (j + 1) / 480; at j = 479 exactly the target
    for j in 0..480 {
        let soll = ziel * (j + 1) as f32 / 480.0;
        assert!((y[1000 + j].0 - soll).abs() < 1e-5, "j {j}: {} vs {soll}", y[1000 + j].0);
    }
    assert_eq!(y[1479].0, ziel, "ends exactly on the target after 480 samples");
    assert!(y[1479..2000].iter().all(|s| s.0 == ziel), "no overshoot afterwards");
    let max_schritt = (1..y.len()).map(|i| (y[i].0 - y[i - 1].0).abs()).fold(0.0f32, f32::max);
    println!("MESS sh slew 10 ms: step {ziel:.4}, largest sample-to-sample change {max_schritt:.6} (step / 480 = {:.6})", ziel.abs() / 480.0);
    assert!(max_schritt <= ziel.abs() / 480.0 + 1e-5, "f32 rounding of the last step only");
}

#[test]
fn slew_restarts_from_the_current_value() {
    // second edge in the middle of the first ramp: continues from the current value, no jump
    let t = |i: usize| if (100..110).contains(&i) || (340..350).contains(&i) { 1.0 } else { 0.0 };
    let y = lauf(r#","glatt":10"#, true, 1500, t);
    let max_schritt = (1..y.len()).map(|i| (y[i].0 - y[i - 1].0).abs()).fold(0.0f32, f32::max);
    // both steps are below 1, over 480 samples: a jump would show as a change far above 2/480
    assert!(max_schritt < 2.0 / 480.0 + 1e-6, "jump of {max_schritt}");
    assert_eq!(y[340 + 479].0, y[340].1, "ends on the second target");
}

#[test]
fn noise_source_is_deterministic_bounded_and_unbiased() {
    let g = graph(r#","rate":1000"#, false).replace(r#"{"von":"k1.aus","nach":"s.x"},"#, "");
    let (mut a, mut b) = (lade(&g), lade(&g));
    let ya: Vec<f32> = (0..480_000).map(|_| a.sample_stereo().0).collect();
    let yb: Vec<f32> = (0..480_000).map(|_| b.sample_stereo().0).collect();
    assert_eq!(ya.iter().map(|v| v.to_bits()).collect::<Vec<_>>(), yb.iter().map(|v| v.to_bits()).collect::<Vec<_>>(), "same graph, same noise");
    // after zuruecksetzen the same sequence again
    a.zuruecksetzen();
    let yc: Vec<f32> = (0..480_000).map(|_| a.sample_stereo().0).collect();
    assert_eq!(ya.iter().map(|v| v.to_bits()).collect::<Vec<_>>(), yc.iter().map(|v| v.to_bits()).collect::<Vec<_>>());
    let mut werte: Vec<f32> = Vec::new();
    for (i, v) in ya.iter().enumerate() {
        if i == 0 || *v != ya[i - 1] { werte.push(*v); }
    }
    let mittel = werte.iter().map(|v| *v as f64).sum::<f64>() / werte.len() as f64;
    let spitze = werte.iter().fold(0.0f32, |m, v| m.max(v.abs()));
    println!("MESS sh noise: {} values, mean {mittel:.4}, peak {spitze:.4}", werte.len());
    assert!(werte.len() >= 1000);
    assert!(spitze <= 1.0 && spitze > 0.95, "peak {spitze}");
    assert!(mittel.abs() < 0.05, "mean {mittel}");
    // two voices draw different noise: the two-voice sum is not twice the one-voice series
    let g2 = g.replace(r#""stimmen":1"#, r#""stimmen":2"#);
    let mut c = lade(&g2);
    let y2: Vec<f32> = (0..48_000).map(|_| c.sample_stereo().0).collect();
    assert!(y2.iter().zip(&ya).any(|(s, e)| (s - 2.0 * e).abs() > 1e-3), "voices must not share one noise sequence");
}

#[test]
fn beat_clock_ticks_on_the_wraps() {
    // takt 0.25 beat at 120 BPM (2 beats/s) = 6000 samples; ticks at beat multiples of 0.25 and at the start
    let g = graph(r#","takt":0.25,"rate":1000"#, false);
    let mut p = lade(&g);
    p.setze_takt(0.0, 2.0 / SR as f64);
    let mut y = Vec::new();
    for i in 0..48_000 {
        p.setze_regler(1, xk(i));
        y.push(p.sample_stereo().0);
    }
    let ticks: Vec<usize> = (0..y.len()).filter(|&i| i == 0 || y[i] != y[i - 1]).collect();
    println!("MESS sh beat clock takt 0.25 @120 BPM: ticks at {ticks:?}");
    assert_eq!(ticks.len(), 8, "{ticks:?}");
    for w in ticks.windows(2) {
        assert!((5999..=6001).contains(&(w[1] - w[0])), "spacing {}", w[1] - w[0]);
    }
}

#[test]
fn non_finite_input_never_reaches_the_output() {
    let mut s = Sh::neu(0);
    for x in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
        let y = s.prozess(true, x, true, 5.0, SR);
        assert!(y.is_finite());
        for _ in 0..1000 {
            assert!(s.prozess(false, x, true, 5.0, SR).is_finite());
        }
    }
    // a non-finite rate counts as 0, a non-finite slew as stepped
    let mut s = Sh::neu(1);
    for _ in 0..100 {
        let t = s.takt_rate(f32::NAN, SR);
        assert!(s.prozess(t, 0.3, true, f32::NAN, SR).is_finite());
    }
}

#[test]
fn value_checks() {
    let fehler = |w: &str| match uebersetze(&graph(w, false), SR) {
        Err(Fehler::Wert { wert, .. }) => wert,
        r => panic!("{w}: {:?}", r.map(|_| ())),
    };
    assert_eq!(fehler(r#","takt":257"#), "takt");
    assert_eq!(fehler(r#","glatt":-1"#), "glatt");
    assert_eq!(fehler(r#","glatt":10001"#), "glatt");
    for ok in [r#","takt":256"#, r#","glatt":10000"#, r#","rate":0"#] {
        uebersetze(&graph(ok, false), SR).unwrap_or_else(|e| panic!("{ok}: {e:?}"));
    }
}
