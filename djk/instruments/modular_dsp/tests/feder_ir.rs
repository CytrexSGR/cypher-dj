//! S21: the synthetic spring-tank impulse response `proben::feder_ir` (no third-party IR file): deterministic, level,
//! the typical up-chirp of a dispersive spring, decay, and a full-length pass through the `faltung` block.
#[path = "sampler_helpers/mod.rs"]
mod sampler_hilfe;
use baukasten_dsp::proben::feder_ir;
use baukasten_dsp::uebersetze_mit_wurzel;
use sampler_hilfe::{schreibe, schwerpunkt_hz, wurzel};

const SR: f32 = 48_000.0;
const FRAMES: usize = 72_000;

fn seiten(d: &[f32]) -> (Vec<f32>, Vec<f32>) { (d.iter().step_by(2).copied().collect(), d.iter().skip(1).step_by(2).copied().collect()) }

fn norm(x: &[f32]) -> f64 { x.iter().map(|v| (*v as f64).powi(2)).sum::<f64>().sqrt() }

fn energie(x: &[f32]) -> f64 { x.iter().map(|v| (*v as f64).powi(2)).sum::<f64>() }

#[test]
fn deterministic_and_finite() {
    let (a, b) = (feder_ir(SR), feder_ir(SR));
    assert_eq!(a.len(), 2 * FRAMES, "1.5 s of stereo frames");
    assert!(a.iter().zip(&b).all(|(x, y)| x.to_bits() == y.to_bits()), "two calls must agree bit for bit");
    assert!(a.iter().all(|v| v.is_finite()));
    let (l, r) = seiten(&a);
    assert!(l.iter().zip(&r).any(|(x, y)| (x - y).abs() > 1e-6), "the two sides must differ");
}

#[test]
fn level() {
    let (l, r) = seiten(&feder_ir(SR));
    let n = norm(&l).max(norm(&r));
    println!("MESS feder_ir L2 norms {:.5} {:.5}, peaks {:.4} {:.4}", norm(&l), norm(&r), l.iter().fold(0.0f32, |m, v| m.max(v.abs())), r.iter().fold(0.0f32, |m, v| m.max(v.abs())));
    assert!((n - 0.35).abs() <= 1e-4, "max side L2 norm {n}");
    for s in [&l, &r] {
        assert!(s.iter().all(|v| v.abs() <= 0.35), "peak above 0.35");
    }
}

#[test]
fn up_chirp() {
    let d = feder_ir(SR);
    let (l, r) = seiten(&d);
    let ms = |t: f64| (t * 48.0) as usize;
    for (name, s) in [("L", &l), ("R", &r)] {
        let spitze = s.iter().fold(0.0f32, |m, v| m.max(v.abs()));
        let t0 = s.iter().position(|v| v.abs() > 1e-3 * spitze).expect("silent IR");
        let frueh = schwerpunkt_hz(&s[t0 + ms(5.0)..t0 + ms(25.0)], 48_000.0);
        let spaet = schwerpunkt_hz(&s[t0 + ms(35.0)..t0 + ms(55.0)], 48_000.0);
        println!("MESS feder_ir {name}: t0 {t0}, centroid early {frueh:.0} Hz, late {spaet:.0} Hz, ratio {:.2}", spaet / frueh);
        assert!(spaet >= 1.3 * frueh, "{name}: no up-chirp, early {frueh:.0} Hz late {spaet:.0} Hz");
    }
}

/// Autocorrelation of the envelope (|x| through a 1 ms one-pole, mean removed) at the lags `lo_ms..=hi_ms`.
fn huellkurve_akf(x: &[f32], lo_ms: usize, hi_ms: usize) -> Vec<f64> {
    let c = 1.0 - (-1.0 / 48.0f64).exp();
    let mut z = 0.0f64;
    let mut e: Vec<f64> = x.iter().map(|v| { z += c * ((*v as f64).abs() - z); z }).collect();
    let mittel = e.iter().sum::<f64>() / e.len() as f64;
    e.iter_mut().for_each(|v| *v -= mittel);
    (lo_ms * 48..=hi_ms * 48).map(|lag| e.iter().zip(&e[lag..]).map(|(a, b)| a * b).sum()).collect()
}

/// Echo period in ms and the harmonic ratio. The period is the lag of the maximum of the envelope autocorrelation
/// over 60..120 ms. A true period below 60 ms shows up there as its multiple, so the autocorrelation is also read
/// over 20..120 ms: the harmonic ratio is the highest value within 2 ms of half the found lag, divided by the value
/// at the found lag. About 0 or below means the found lag is the fundamental; 1 or more means a shorter period hides
/// behind it.
fn echo_periode_ms(x: &[f32]) -> (f64, f64) {
    let r = huellkurve_akf(x, 20, 120);
    let off = 20 * 48;
    let (lo, hi) = (60 * 48, 120 * 48);
    let lag = (lo..=hi).max_by(|a, b| r[a - off].total_cmp(&r[b - off])).unwrap();
    let halb = lag / 2;
    let h = (halb - 96..=halb + 96).map(|l| r[l - off]).fold(f64::MIN, f64::max);
    (lag as f64 / 48.0, h / r[lag - off])
}

fn pulszug(periode_ms: f64) -> Vec<f32> {
    let mut zug = vec![0.0f32; FRAMES];
    let mut k = 0;
    while (k as f64 * periode_ms * 48.0) < (FRAMES - 1) as f64 {
        zug[(k as f64 * periode_ms * 48.0).round() as usize] = 0.8f32.powi(k);
        k += 1;
    }
    zug
}

#[test]
fn echo_period() {
    // negative control: a pulse train with a known period inside the lag window must come back at that period,
    // and its harmonic ratio must be low
    let (kontrolle, kh) = echo_periode_ms(&pulszug(90.0));
    println!("MESS feder_ir control: pulse train 90.0 ms -> {kontrolle:.1} ms, harmonic ratio {kh:.2}");
    assert!((kontrolle - 90.0).abs() <= 0.1, "estimator returns {kontrolle:.2} ms for a 90.0 ms pulse train");
    assert!(kh <= 0.5, "harmonic ratio {kh:.2} for a 90.0 ms pulse train");
    // positive control for the harmonic check: a 45.0 ms train is reported at 90.0 ms, and the ratio must say so
    let (k45, kh45) = echo_periode_ms(&pulszug(45.0));
    println!("MESS feder_ir control: pulse train 45.0 ms -> {k45:.1} ms, harmonic ratio {kh45:.2}");
    assert!(kh45 >= 1.0, "a 45.0 ms train must show a harmonic ratio of at least 1, got {kh45:.2}");
    let (l, r) = seiten(&feder_ir(SR));
    let ((pl, hl), (pr, hr)) = (echo_periode_ms(&l), echo_periode_ms(&r));
    println!("MESS feder_ir L: echo period {pl:.1} ms, harmonic ratio {hl:.2}");
    println!("MESS feder_ir R: echo period {pr:.1} ms, harmonic ratio {hr:.2}");
    // loop delay T (71.3 / 83.7 ms) plus the low-frequency cascade delay of about 10.7 ms: 82.0 / 94.4 ms
    assert!((80.5..=83.5).contains(&pl), "L period {pl:.1} ms");
    assert!((93.0..=96.0).contains(&pr), "R period {pr:.1} ms");
    assert!(pr - pl >= 10.0, "the two sides must not share a period: L {pl:.1} ms, R {pr:.1} ms");
    // the found lag must be the fundamental, not the second harmonic of a period below 60 ms
    assert!(hl <= 0.5, "L: a period of about {:.1} ms hides behind {pl:.1} ms (harmonic ratio {hl:.2})", pl / 2.0);
    assert!(hr <= 0.5, "R: a period of about {:.1} ms hides behind {pr:.1} ms (harmonic ratio {hr:.2})", pr / 2.0);
}

#[test]
fn decays() {
    let (l, r) = seiten(&feder_ir(SR));
    for (name, s) in [("L", &l), ("R", &r)] {
        let (vorn, hinten) = (energie(&s[..4800]), energie(&s[FRAMES - 4800..]));
        let db = 10.0 * (hinten / vorn).log10();
        println!("MESS feder_ir {name}: last 100 ms vs first 100 ms {db:.1} dB");
        assert!(db <= -50.0, "{name}: tail only {db:.1} dB below the start");
        assert_eq!(s[FRAMES - 1], 0.0, "{name}: the fade must end at exactly 0");
    }
}

#[test]
fn feder_ir_through_faltung_is_the_ir() {
    let w = wurzel();
    let d = feder_ir(SR);
    schreibe(&w, "feder-ir.f32", &d);
    let g = r#"{"format":"baukasten/2","name":"f","stimmen":1,"knoten":[{"id":"e","art":"eingang"},{"id":"p","art":"faltung","datei":"feder-ir.f32","laenge_max":1500,"mix":1},{"id":"o","art":"ausgang"}],"kanten":[{"von":"e.l","nach":"p.l"},{"von":"e.r","nach":"p.r"},{"von":"p.l","nach":"o.l"},{"von":"p.r","nach":"o.r"}]}"#;
    let mut p = uebersetze_mit_wurzel(g, SR, Some(&w)).unwrap();
    assert_eq!(p.latenz(), 0);
    let (hl, hr) = seiten(&d);
    let mut fehler = 0.0f32;
    for i in 0..FRAMES + 2000 {
        p.setze_eingang(if i == 0 { 1.0 } else { 0.0 }, if i == 0 { 1.0 } else { 0.0 });
        let (l, r) = p.sample_stereo();
        let (el, er) = if i < FRAMES { (hl[i], hr[i]) } else { (0.0, 0.0) };
        fehler = fehler.max((l - el).abs()).max((r - er).abs());
    }
    println!("MESS feder_ir through faltung: {FRAMES} frames, max_err {fehler:.3e}");
    assert!(fehler <= 1e-5, "max error {fehler}");
}
