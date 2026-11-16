//! Baukasten block `chaos` (type 54): Lorenz and Roessler attractor as a modulation source with two outputs.
use baukasten_dsp::chaos::Chaos;
use baukasten_dsp::{uebersetze, Fehler, ARTEN};

const SR: f32 = 48_000.0;

fn lauf(stimme: usize, saat: u32, form: u8, rate: f32, n: usize) -> Vec<(f32, f32)> {
    let mut c = Chaos::neu(stimme, saat, form);
    (0..n).map(|_| c.prozess(rate, 0.0, form, SR)).collect()
}

#[test]
fn begrenzt_und_lebendig() {
    for form in [0u8, 1] {
        for rate in [1.0f32, 50.0] {
            let y = lauf(0, 0, form, rate, 60 * 48_000);
            let (mut m1, mut m2) = (0.0f32, 0.0f32);
            for (a, b) in &y {
                assert!(a.is_finite() && b.is_finite(), "form {form} rate {rate}: not finite");
                m1 = m1.max(a.abs());
                m2 = m2.max(b.abs());
            }
            assert!(m1 <= 1.0 && m2 <= 1.0, "form {form} rate {rate}: peak {m1} / {m2}");
            let streuung = |f: &dyn Fn(&(f32, f32)) -> f32| {
                let mw = y.iter().map(f).sum::<f32>() / y.len() as f32;
                (y.iter().map(|v| (f(v) - mw).powi(2)).sum::<f32>() / y.len() as f32).sqrt()
            };
            let (s1, s2) = (streuung(&|v| v.0), streuung(&|v| v.1));
            println!("MESS chaos form {form} rate {rate}: peak {m1:.3} / {m2:.3}, std {s1:.3} / {s2:.3}");
            assert!(s1 > 0.1 && s2 > 0.1, "form {form} rate {rate}: the path hardly moves ({s1} / {s2})");
        }
    }
}

/// largest normalised autocorrelation of `x` (sampled at `fs`) over the lags `von..bis` seconds
fn autokorrelation_max(x: &[f32], fs: f32, von: f32, bis: f32) -> f32 {
    let mw = x.iter().sum::<f32>() / x.len() as f32;
    let x: Vec<f64> = x.iter().map(|v| (*v - mw) as f64).collect();
    let r0: f64 = x.iter().map(|v| v * v).sum();
    let mut m = f64::MIN;
    for lag in (von * fs) as usize..=(bis * fs) as usize {
        let r: f64 = x[..x.len() - lag].iter().zip(&x[lag..]).map(|(a, b)| a * b).sum();
        m = m.max(r / r0);
    }
    m as f32
}

#[test]
fn nicht_periodisch() {
    for form in [0u8, 1] {
        for rate in [1.0f32, 50.0] {
            let y = lauf(0, 0, form, rate, 60 * 48_000);
            // 400 Hz is far above the swing rate of both attractors at rate 50 (about 50 swings per second)
            let x: Vec<f32> = y.iter().step_by(120).map(|v| v.0).collect();
            let r = autokorrelation_max(&x, 400.0, 0.5, 10.0);
            println!("MESS chaos form {form} rate {rate}: autocorrelation peak {r:.3} over lags 0.5..10 s");
            assert!(r < 0.9, "form {form} rate {rate}: autocorrelation peak {r}");
        }
    }
}

#[test]
fn deterministisch_und_saat_zaehlt() {
    for form in [0u8, 1] {
        let a = lauf(2, 9, form, 7.0, 30_000);
        let b = lauf(2, 9, form, 7.0, 30_000);
        assert!(a.iter().zip(&b).all(|(x, y)| x.0.to_bits() == y.0.to_bits() && x.1.to_bits() == y.1.to_bits()), "form {form}: two runs differ");
        let c = lauf(2, 10, form, 7.0, 30_000);
        let d = lauf(3, 9, form, 7.0, 30_000);
        assert!(a.iter().zip(&c).any(|(x, y)| (x.0 - y.0).abs() > 0.05), "form {form}: another seed gives the same path");
        assert!(a.iter().zip(&d).any(|(x, y)| (x.0 - y.0).abs() > 0.05), "form {form}: another voice gives the same path");
    }
}

#[test]
fn trig_setzt_zurueck_nur_bei_steigender_flanke() {
    for form in [0u8, 1] {
        let mut c = Chaos::neu(1, 4, form);
        let erste = c.prozess(5.0, 0.0, form, SR);
        for _ in 0..20_000 { c.prozess(5.0, 0.0, form, SR); }
        let weit = c.prozess(5.0, 0.0, form, SR);
        assert!((weit.0 - erste.0).abs() > 0.01 || (weit.1 - erste.1).abs() > 0.01, "form {form}: the path did not move");
        // rising edge: back at the start, the same value as the very first sample
        let neu = c.prozess(5.0, 1.0, form, SR);
        assert_eq!(neu.0.to_bits(), erste.0.to_bits(), "form {form}: reset value");
        assert_eq!(neu.1.to_bits(), erste.1.to_bits(), "form {form}: reset value");
        // held high: no new reset, the path continues
        let mut fortlauf = Chaos::neu(1, 4, form);
        fortlauf.prozess(5.0, 0.0, form, SR);
        let zweite = fortlauf.prozess(5.0, 0.0, form, SR);
        let gehalten = c.prozess(5.0, 1.0, form, SR);
        assert_eq!(gehalten.0.to_bits(), zweite.0.to_bits(), "form {form}: a held trigger must not reset again");
        // falling then rising again resets again
        c.prozess(5.0, 0.0, form, SR);
        let wieder = c.prozess(5.0, 1.0, form, SR);
        assert_eq!(wieder.0.to_bits(), erste.0.to_bits(), "form {form}: second edge");
    }
}

#[test]
fn unsinnige_eingaben_bleiben_endlich() {
    for form in [0u8, 1] {
        let mut c = Chaos::neu(0, 0, form);
        for (i, rate) in [f32::NAN, f32::INFINITY, -5.0, 0.0, 1e9, 3.0].iter().cycle().take(60_000).enumerate() {
            let (a, b) = c.prozess(*rate, f32::NAN, form, SR);
            assert!(a.is_finite() && b.is_finite() && a.abs() <= 1.0 && b.abs() <= 1.0, "form {form} sample {i}");
        }
    }
}

#[test]
fn art_im_graphen() {
    assert_eq!(ARTEN.iter().position(|a| a.art == "chaos"), Some(54));
    let g = |knoten: &str| format!(r#"{{"format":"baukasten/2","name":"t","stimmen":2,"knoten":[{{"id":"p","art":"chaos"{knoten}}},{{"id":"o","art":"ausgang"}}],"kanten":[{{"von":"p.aus","nach":"o.l"}},{{"von":"p.aus2","nach":"o.r"}}]}}"#);
    let mut p = uebersetze(&g(r#","rate":20,"saat":3"#), SR).unwrap_or_else(|e| panic!("{e:?}"));
    assert_eq!(p.latenz(), 0, "the chaos LFO has no latency");
    let (mut l, mut r) = (0.0f32, 0.0f32);
    for _ in 0..48_000 {
        let (a, b) = p.sample_stereo();
        l = l.max(a.abs());
        r = r.max(b.abs());
    }
    assert!(l > 0.1 && r > 0.1, "both outputs reach the graph: {l} / {r}");
    for (wert, wort) in [(r#","rate":0"#, "rate"), (r#","rate":51"#, "rate"), (r#","form":2"#, "form"), (r#","form":0.5"#, "form"), (r#","saat":-1"#, "saat"), (r#","saat":70000"#, "saat")] {
        match uebersetze(&g(wert), SR) {
            Err(Fehler::Wert { wert: w, .. }) => assert_eq!(w, wort, "{wert}"),
            other => panic!("{wert} must be refused, got {:?}", other.err()),
        }
    }
}
