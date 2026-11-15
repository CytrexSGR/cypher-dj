//! Baukasten block `allpass` (type 52): first and second order phase rotator, H(z) = (c + z^-1)/(1 + c z^-1) with
//! c = (t - 1)/(t + 1), t = tan(pi fc/fs). Frequency responses come from the impulse response of `Allpass::prozess`,
//! evaluated at the exact test frequency by a single-frequency DTFT in f64 (never at an FFT bin).
use baukasten_dsp::allpass::Allpass;
use baukasten_dsp::{uebersetze, Programm, ARTEN};
use std::f64::consts::PI;

const SR: f64 = 48_000.0;
const N: usize = 1 << 18;

fn impuls(fc: f32, fc2: f32, ordnung: u8) -> Vec<f64> {
    let mut a = Allpass::default();
    (0..N).map(|n| a.prozess(if n == 0 { 1.0 } else { 0.0 }, fc, fc2, ordnung, SR as f32) as f64).collect()
}

/// H(f) = sum h[n] e^(-j 2 pi f n / fs) as (re, im)
fn dtft(h: &[f64], f: f64) -> (f64, f64) {
    let (mut re, mut im) = (0.0, 0.0);
    let w = 2.0 * PI * f / SR;
    for (n, v) in h.iter().enumerate() {
        let (s, c) = (w * n as f64).sin_cos();
        re += v * c;
        im -= v * s;
    }
    (re, im)
}

fn betrag_db(h: (f64, f64)) -> f64 { 20.0 * (h.0.hypot(h.1)).log10() }

/// angle(H * conj(Href)) in degrees, no unwrapping needed
fn abweichung_grad(h: (f64, f64), ref_phase: f64) -> f64 {
    let (rr, ri) = (ref_phase.cos(), ref_phase.sin());
    // H * conj(Href)
    let (re, im) = (h.0 * rr + h.1 * ri, h.1 * rr - h.0 * ri);
    im.atan2(re).to_degrees()
}

fn ref_phase1(f: f64, fc: f64) -> f64 { -2.0 * ((PI * f / SR).tan() / (PI * fc / SR).tan()).atan() }

fn raster() -> Vec<f64> { (0..41).map(|i| 20.0 * (1000.0f64).powf(i as f64 / 40.0)).collect() }

#[test]
fn betrag_ist_eins() {
    for ordnung in [1u8, 2] {
        for fc in [20.0f32, 100.0, 1000.0, 2000.0] {
            let h = impuls(fc, fc * 3.0, ordnung);
            for f in raster() {
                let db = betrag_db(dtft(&h, f));
                assert!(db.abs() <= 0.01, "order {ordnung} fc {fc} f {f:.1}: {db:.5} dB");
            }
        }
    }
}

#[test]
fn phase_entspricht_der_formel() {
    let fcs = [20.0f64, 100.0, 1000.0, 2000.0];
    let freqs = [20.0f64, 100.0, 1000.0, 20_000.0];
    let tafel: [[f64; 4]; 4] = [
        [-90.000, -22.620, -2.288, -1.139],
        [-157.380, -90.000, -11.405, -5.692],
        [-177.712, -168.595, -90.000, -52.933],
        [-179.960, -179.799, -177.988, -175.959],
    ];
    for (j, fc) in fcs.iter().enumerate() {
        let h = impuls(*fc as f32, 0.0, 1);
        for (i, f) in freqs.iter().enumerate() {
            let hf = dtft(&h, *f);
            let d = abweichung_grad(hf, ref_phase1(*f, *fc));
            assert!(d.abs() <= 0.02, "f {f} fc {fc}: {d:.4} degrees off the formula");
            // the literal table value, compared through the complex ratio
            let d2 = abweichung_grad(hf, tafel[i][j].to_radians());
            assert!(d2.abs() <= 0.02, "f {f} fc {fc}: {d2:.4} degrees off the pinned {}", tafel[i][j]);
        }
        let d = abweichung_grad(dtft(&h, *fc), -90f64.to_radians());
        assert!(d.abs() <= 0.02, "fc {fc}: phase at fc is {d:.4} degrees off -90");
    }
}

#[test]
fn phase_zweiter_ordnung() {
    let h = impuls(1000.0, 1000.0, 2);
    for (f, grad) in [(20.0, -4.576), (1000.0, -180.000), (20_000.0, -355.976)] {
        let d = abweichung_grad(dtft(&h, f), (grad as f64).to_radians());
        assert!(d.abs() <= 0.03, "order 2, fc2 = fc, f {f}: {d:.4} degrees off {grad}");
    }
    let h = impuls(1000.0, 100.0, 2);
    let d = abweichung_grad(dtft(&h, 1000.0), (-90.000f64 - 168.595).to_radians());
    assert!(d.abs() <= 0.03, "fc 1000, fc2 100 at 1000 Hz: {d:.4} degrees off -258.595");
}

#[test]
fn eichpunkt_fs_viertel() {
    let mut a = Allpass::default();
    let mut z = 0x1234_5678u32;
    let mut vorher = 0.0f32;
    let mut m = 0.0f32;
    for _ in 0..10_000 {
        z ^= z << 13;
        z ^= z >> 17;
        z ^= z << 5;
        let x = (z as f64 / u32::MAX as f64 * 2.0 - 1.0) as f32;
        let y = a.prozess(x, 12_000.0, 0.0, 1, SR as f32);
        m = m.max((y - vorher).abs());
        vorher = x;
    }
    assert!(m < 1e-6, "fc = fs/4 must be a one sample delay, max deviation {m}");
}

#[test]
fn gruppenlaufzeit() {
    for fc in [100.0f64, 1000.0] {
        let h = impuls(fc as f32, 0.0, 1);
        let t = (PI * fc / SR).tan();
        let tau = |f: f64| {
            let big_t = (PI * f / SR).tan();
            t * (1.0 + big_t * big_t) / (t * t + big_t * big_t)
        };
        let mut vorher = f64::INFINITY;
        for f in raster() {
            let (f1, f2) = (f * 0.999, f * 1.001);
            let (a, b) = (dtft(&h, f1), dtft(&h, f2));
            // phase(f2) - phase(f1) = angle(H2 conj(H1)); delay = -dphi/domega
            let dphi = (b.1 * a.0 - b.0 * a.1).atan2(b.0 * a.0 + b.1 * a.1);
            let mess = -dphi / (2.0 * PI * (f2 - f1) / SR);
            let soll = tau(f);
            assert!((mess / soll - 1.0).abs() < 0.01, "fc {fc} f {f:.1}: {mess:.4} against {soll:.4} samples");
            assert!(mess <= vorher * 1.001, "group delay must not rise: fc {fc} f {f:.1}");
            vorher = mess;
        }
        let mess = |f: f64| {
            let (a, b) = (dtft(&h, f * 0.999), dtft(&h, f * 1.001));
            -(b.1 * a.0 - b.0 * a.1).atan2(b.0 * a.0 + b.1 * a.1) / (2.0 * PI * f * 0.002 / SR)
        };
        println!("MESS allpass gruppenlaufzeit fc {fc}: 20 Hz {:.3} samples, at fc {:.3} samples, DC value {:.3}", mess(20.0), mess(fc), 1.0 / t);
    }
}

fn effekt(art: &str) -> Programm {
    let g = format!(
        r#"{{"format":"baukasten/2","name":"t","stimmen":1,"knoten":[{{"id":"e","art":"eingang"}}{art},{{"id":"o","art":"ausgang"}}],"kanten":[{{"von":"e.l","nach":"a.x"}},{{"von":"a.aus","nach":"o.x"}}]}}"#
    );
    uebersetze(&g, SR as f32).unwrap_or_else(|e| panic!("{e:?}"))
}

/// summed 30..100 Hz band RMS of the last 2^15 samples (Hann FFT)
fn band_rms(x: &[f32]) -> f64 {
    use realfft::RealFftPlanner;
    let n = 1 << 15;
    let x = &x[x.len() - n..];
    let f = RealFftPlanner::<f64>::new().plan_fft_forward(n);
    let mut ein: Vec<f64> = x.iter().enumerate().map(|(i, v)| *v as f64 * (0.5 - 0.5 * (2.0 * PI * i as f64 / n as f64).cos())).collect();
    let mut aus = f.make_output_vec();
    f.process(&mut ein, &mut aus).unwrap();
    let w2: f64 = (0..n).map(|i| (0.5 - 0.5 * (2.0 * PI * i as f64 / n as f64).cos()).powi(2)).sum();
    let mut p = 0.0;
    for (k, c) in aus.iter().enumerate() {
        let hz = k as f64 * SR / n as f64;
        if (30.0..=100.0).contains(&hz) { p += 2.0 * (c.re * c.re + c.im * c.im) / (n as f64 * w2); }
    }
    p.sqrt()
}

/// kick (sine) + bass (cosine = +90 degrees) at 50 Hz; the bass goes through the graph `g` (input `e.l`, output `o.x`)
fn summe_50hz(g: &str) -> f64 {
    let mut p = uebersetze(g, SR as f32).unwrap_or_else(|e| panic!("{e:?}"));
    let n = 48_000 + (1 << 15);
    let mut y = Vec::with_capacity(n);
    for i in 0..n {
        let ph = 2.0 * PI * 50.0 * i as f64 / SR;
        p.setze_eingang(ph.cos() as f32, 0.0);
        let bass = p.sample_stereo().0;
        y.push(ph.sin() as f32 * 0.5 + bass * 0.5);
    }
    band_rms(&y)
}

fn bass_graph(mitte: &str, kanten: &str) -> String {
    format!(r#"{{"format":"baukasten/2","name":"t","stimmen":1,"knoten":[{{"id":"e","art":"eingang"}},{{"id":"o","art":"ausgang"}}{mitte}],"kanten":[{kanten}]}}"#)
}

#[test]
fn kick_bass_phase() {
    let draht = summe_50hz(&bass_graph("", r#"{"von":"e.l","nach":"o.x"}"#));
    let mit = summe_50hz(&bass_graph(r#",{"id":"a","art":"allpass","fc":50}"#, r#"{"von":"e.l","nach":"a.x"},{"von":"a.aus","nach":"o.x"}"#));
    let invers = summe_50hz(&bass_graph(r#",{"id":"a","art":"allpass","fc":50},{"id":"i","art":"mul","b":-1}"#,
        r#"{"von":"e.l","nach":"a.x"},{"von":"a.aus","nach":"i.a"},{"von":"i.aus","nach":"o.x"}"#));
    let db = |a: f64, b: f64| 20.0 * (a / b).log10();
    println!("MESS allpass kick_bass_phase: aligned {:.2} dB, inverted behind the all-pass {:.2} dB, both against a wire", db(mit, draht), db(invers, draht));
    assert!(db(mit, draht) >= 2.5, "all-pass at fc 50 must align the bass with the kick: {:.2} dB", db(mit, draht));
    assert!(db(invers, draht) <= -10.0, "inverted bass after the all-pass must cancel: {:.2} dB", db(invers, draht));
}

#[test]
fn nan_und_stille() {
    let mut a = Allpass::default();
    for i in 0..100 { a.prozess((i as f32 * 0.1).sin(), 300.0, 0.0, 1, SR as f32); }
    assert_eq!(a.prozess(f32::NAN, 300.0, 0.0, 1, SR as f32), 0.0);
    for i in 0..1000 { assert!(a.prozess((i as f32 * 0.1).sin(), 300.0, 0.0, 1, SR as f32).is_finite()); }
    let mut a = Allpass::default();
    for ordnung in [1u8, 2] {
        for i in 0..100 { a.prozess((i as f32 * 0.3).sin(), 20.0, 25.0, ordnung, SR as f32); }
        for _ in 0..(5 * 48_000) { a.prozess(0.0, 20.0, 25.0, ordnung, SR as f32); }
        for s in a.zustand() {
            assert!(s == 0.0 || s.is_normal(), "state after 5 s of silence is {s:e}");
        }
    }
}

/// Plan deviation: the plan asked for "peak at most 1.5 times the input peak". An all-pass conserves energy, not the peak: a
/// static all-pass already reaches 1.8 (order 1, fc 1000) and 1.97 (order 2) times the peak of uniform white noise (measured
/// with the unmodulated block), so that bound fails for any correct implementation. What a blow-up would break is the energy, so
/// the test pins the RMS ratio (within 1 % of 1) and bounds the peak by 2.5, above every static value.
#[test]
fn modulation_stabil() {
    for ordnung in [1u8, 2] {
        let mut a = Allpass::default();
        let mut z = 0x2545_f491u32;
        let n = 2 * 48_000;
        let (mut ein_max, mut aus_max, mut e_ein, mut e_aus) = (0.0f32, 0.0f32, 0.0f64, 0.0f64);
        for i in 0..n {
            z ^= z << 13;
            z ^= z >> 17;
            z ^= z << 5;
            let x = (z as f64 / u32::MAX as f64 * 2.0 - 1.0) as f32;
            let fc = 20.0 * (100.0f64).powf(i as f64 / n as f64) as f32;
            let y = a.prozess(x, fc, 2020.0 - fc, ordnung, SR as f32);
            assert!(y.is_finite(), "order {ordnung}: sample {i} not finite");
            ein_max = ein_max.max(x.abs());
            aus_max = aus_max.max(y.abs());
            e_ein += (x * x) as f64;
            e_aus += (y * y) as f64;
        }
        let rms = (e_aus / e_ein).sqrt();
        println!("MESS allpass modulation_stabil order {ordnung}: peak ratio {:.3}, rms ratio {rms:.4}", aus_max / ein_max);
        assert!((rms - 1.0).abs() < 0.01, "order {ordnung}: energy not conserved, rms ratio {rms}");
        assert!(aus_max <= 2.5 * ein_max, "order {ordnung}: peak {aus_max} against input peak {ein_max}");
    }
}

#[test]
fn art_im_graphen_ohne_latenz() {
    let i = ARTEN.iter().position(|a| a.art == "allpass").expect("allpass in ARTEN");
    assert_eq!(i, 52);
    let p = effekt(r#",{"id":"a","art":"allpass","fc":300,"ordnung":2,"fc2":3000}"#);
    assert_eq!(p.latenz(), 0, "the all-pass has no latency");
    for (wert, wort) in [("0", "ordnung"), ("3", "ordnung"), ("1.5", "ordnung")] {
        let g = format!(r#"{{"format":"baukasten/2","name":"t","stimmen":1,"knoten":[{{"id":"e","art":"eingang"}},{{"id":"a","art":"allpass","ordnung":{wert}}},{{"id":"o","art":"ausgang"}}],"kanten":[{{"von":"e.l","nach":"a.x"}},{{"von":"a.aus","nach":"o.x"}}]}}"#);
        let e = match uebersetze(&g, SR as f32) { Err(e) => format!("{e:?} {e}"), Ok(_) => panic!("ordnung {wert} must be refused") };
        assert!(e.contains(wort) && e.contains("1 or 2"), "message must name {wort} and \"1 or 2\": {e}");
    }
}
