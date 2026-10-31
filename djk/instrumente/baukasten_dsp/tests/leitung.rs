//! Leitung (Slice 4f, D4–D6): ganzzahlige Verzögerung exakt, Bruchteil mit Summe und Schwerpunkt, Grenze und ungültige
//! Werte, Klemme an `max`, Zurücksetzen. Jeder Test hat eine Mutation, die ihn rot macht (mutation.py, Gruppe T1).
use baukasten_dsp::leitung::{Leitung, GRENZE};

/// Impuls 1,0 im ersten Sample, danach 0
fn impuls(l: &mut Leitung, verz: f64, n: usize) -> Vec<f32> {
    (0..n).map(|i| l.prozess(if i == 0 { 1.0 } else { 0.0 }, verz)).collect()
}

#[test]
fn ganzzahlige_verzoegerung_ist_exakt() {
    for v in [0usize, 1, 2, 6, 99, 4799] {
        let mut l = Leitung::neu(4800);
        let y = impuls(&mut l, v as f64, 6000);
        for (i, &s) in y.iter().enumerate() {
            assert_eq!(s, if i == v { 1.0 } else { 0.0 }, "verz {v}, Sample {i}");
        }
    }
}

#[test]
fn bruchteil_haelt_summe_und_schwerpunkt() {
    // Lagrange 3. Ordnung und linear geben lineare Funktionen exakt wieder: Summe 1, Schwerpunkt = verz
    for v in [0.25f64, 0.5, 0.75, 1.25, 1.5, 99.25, 99.5, 99.75] {
        let mut l = Leitung::neu(4800);
        let y = impuls(&mut l, v, 300);
        let s: f64 = y.iter().map(|&a| a as f64).sum();
        let m: f64 = y.iter().enumerate().map(|(i, &a)| i as f64 * a as f64).sum::<f64>() / s;
        assert!((s - 1.0).abs() < 1e-6 && (m - v).abs() < 1e-5, "verz {v}: Summe {s}, Schwerpunkt {m}");
    }
}

#[test]
fn unter_einem_sample_linear() {
    let mut l = Leitung::neu(100);
    let y = impuls(&mut l, 0.25, 4);
    assert_eq!(y, vec![0.75, 0.25, 0.0, 0.0]);
}

#[test]
fn grenze_und_ungueltige_werte() {
    let mut l = Leitung::neu(100);
    let y: Vec<f32> = [1e6f32, -1e6, f32::NAN, f32::INFINITY, 1e-35, 0.5].iter().map(|&x| l.prozess(x, 0.0)).collect();
    assert_eq!(y, vec![GRENZE, -GRENZE, 0.0, 0.0, 0.0, 0.5]);
}

#[test]
fn verzoegerung_ueber_max_und_nan_werden_max() {
    for verz in [10_000.0f64, f64::NAN, f64::INFINITY] {
        let mut l = Leitung::neu(480);
        let y = impuls(&mut l, verz, 1_000);
        assert_eq!(y.iter().position(|&s| s != 0.0), Some(480), "verz {verz}");
        assert_eq!(y[480], 1.0);
    }
    let mut l = Leitung::neu(480);
    assert_eq!(impuls(&mut l, -3.0, 4), vec![1.0, 0.0, 0.0, 0.0], "negativ wird 0");
}

#[test]
fn zuruecksetzen_gleich_frisch() {
    let lauf = |l: &mut Leitung| -> Vec<f32> {
        (0..20_000).map(|i| l.prozess(((i * 7919) % 101) as f32 / 50.0 - 1.0, 37.3 + (i % 500) as f64 * 0.1)).collect()
    };
    let mut frisch = Leitung::neu(960);
    let mut benutzt = Leitung::neu(960);
    lauf(&mut benutzt);
    benutzt.zuruecksetzen();
    assert_eq!(lauf(&mut frisch), lauf(&mut benutzt));
}

#[test]
fn ab_einem_sample_lagrange_nicht_linear() {
    // e = 1,5: Gewichte (-1/16, 9/16, 9/16, -1/16); lineare Fortsetzung hielte Summe und Schwerpunkt auch, hätte aber (-0,5; 1,5)
    let mut l = Leitung::neu(100);
    assert_eq!(impuls(&mut l, 1.5, 5), vec![-0.0625, 0.5625, 0.5625, -0.0625, 0.0]);
}

/// Referenz ohne `chorus::lagrange4`: Lagrange-Polynom durch die Verzögerungen n−1..n+2 um den ganzen Teil n von `e`
fn lagrange_referenz(x: &[f32], i: usize, e: f64) -> f64 {
    let n = e.floor();
    let t = [n - 1.0, n, n + 1.0, n + 2.0];
    (0..4)
        .map(|k| {
            let w: f64 = (0..4).filter(|&j| j != k).map(|j| (e - t[j]) / (t[k] - t[j])).product();
            let pos = i as isize - t[k] as isize;
            if pos < 0 { 0.0 } else { w * x[pos as usize] as f64 }
        })
        .sum()
}

#[test]
fn ringumlauf_ist_exakt() {
    // Leitung::neu(100) hat einen Ring von 128: 2000 Samples laufen ihn fünfzehnmal rund
    let x: Vec<f32> = (0..2000).map(|i| ((i * 7919) % 101) as f32 / 50.0 - 1.0).collect();
    for v in [0usize, 1, 2, 3, 50, 99, 100] {
        let mut l = Leitung::neu(100);
        for (i, &s) in x.iter().enumerate() {
            let y = l.prozess(s, v as f64);
            assert_eq!(y, if i >= v { x[i - v] } else { 0.0 }, "verz {v}, Sample {i}");
        }
    }
    for e in [0.25f64, 0.5] {
        // unter einem Sample linear zwischen den zwei jüngsten Werten, auch über den Umlauf des Rings hinweg
        let mut l = Leitung::neu(100);
        for (i, &s) in x.iter().enumerate() {
            let y = l.prozess(s, e) as f64;
            let vor = if i > 0 { x[i - 1] as f64 } else { 0.0 };
            assert!((y - (s as f64 * (1.0 - e) + vor * e)).abs() < 1e-6, "verz {e}, Sample {i}: {y}");
        }
    }
    for e in [1.25f64, 37.5, 99.75, 100.0] {
        let mut l = Leitung::neu(100);
        for (i, &s) in x.iter().enumerate() {
            let y = l.prozess(s, e) as f64;
            assert!((y - lagrange_referenz(&x, i, e)).abs() < 1e-6, "verz {e}, Sample {i}: {y}");
        }
    }
}

#[test]
fn werte_ueber_der_denormalgrenze_bleiben() {
    let mut l = Leitung::neu(100);
    let y: Vec<f32> = [1e-20f32, -1e-10, 1e-5].iter().map(|&x| l.prozess(x, 0.0)).collect();
    assert_eq!(y, vec![1e-20, -1e-10, 1e-5]);
}
