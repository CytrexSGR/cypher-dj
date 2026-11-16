//! Baukasten block `schieber` (type 55): frequency shifter, Hilbert pair of two all-pass chains and a quadrature oscillator.
//! Spectra are read with a single-frequency DTFT in f64 over whole periods of a Hann window, never at an FFT bin.
use baukasten_dsp::schieber::Schieber;
use baukasten_dsp::{uebersetze, Fehler, ARTEN};
use std::f64::consts::PI;

const SR: f32 = 48_000.0;
const SETTLE: usize = 48_000;
const N: usize = 1 << 16;

/// run `n` samples of a sine at `f` with shift `hz`; returns (auf, ab) after the settle time
fn lauf(f: f64, hz: f32, n: usize) -> (Vec<f64>, Vec<f64>) {
    let mut s = Schieber::default();
    let (mut u, mut d) = (Vec::with_capacity(n), Vec::with_capacity(n));
    for i in 0..SETTLE + n {
        let x = (2.0 * PI * f * i as f64 / SR as f64).sin() as f32;
        let (a, b) = s.prozess(x, hz, SR);
        if i >= SETTLE {
            u.push(a as f64);
            d.push(b as f64);
        }
    }
    (u, d)
}

/// amplitude of the component at `f` Hz (Hann window, so a nearby line leaks at most a few dB below -90)
fn betrag(x: &[f64], f: f64) -> f64 {
    let n = x.len();
    let (mut re, mut im, mut w2) = (0.0, 0.0, 0.0);
    for (i, v) in x.iter().enumerate() {
        let w = 0.5 - 0.5 * (2.0 * PI * i as f64 / n as f64).cos();
        let (s, c) = (2.0 * PI * f * (SETTLE + i) as f64 / SR as f64).sin_cos();
        re += v * w * c;
        im += v * w * s;
        w2 += w;
    }
    2.0 * re.hypot(im) / w2
}

fn db(v: f64) -> f64 { 20.0 * v.max(1e-12).log10() }

/// 1 kHz sine, hz 100: a clean line at 1100 Hz on `auf` and at 900 Hz on `ab`, the other sideband far down
#[test]
fn tausend_hertz_plus_hundert() {
    let (u, d) = lauf(1000.0, 100.0, N);
    let (u_gut, u_schlecht) = (betrag(&u, 1100.0), betrag(&u, 900.0));
    let (d_gut, d_schlecht) = (betrag(&d, 900.0), betrag(&d, 1100.0));
    println!("MESS schieber 1 kHz hz 100: auf {:.3} (1100 Hz) / {:.1} dB (900 Hz); ab {:.3} (900 Hz) / {:.1} dB (1100 Hz)",
        u_gut, db(u_schlecht / u_gut), d_gut, db(d_schlecht / d_gut));
    assert!((u_gut - 1.0).abs() < 0.06 && (d_gut - 1.0).abs() < 0.06, "wanted lines near unit amplitude: {u_gut} / {d_gut}");
    assert!(db(u_schlecht / u_gut) <= -40.0, "auf: unwanted sideband {:.1} dB", db(u_schlecht / u_gut));
    assert!(db(d_schlecht / d_gut) <= -40.0, "ab: unwanted sideband {:.1} dB", db(d_schlecht / d_gut));
    // the carrier itself does not come through either
    assert!(db(betrag(&u, 1000.0) / u_gut) <= -40.0 && db(betrag(&d, 1000.0) / d_gut) <= -40.0, "the input line leaks through");
}

/// Sideband suppression over the band. The plan asked for 100 Hz..10 kHz at hz 100. At 100 Hz a shift of 100 puts the
/// wanted `ab` line on DC and the unwanted `auf` line on DC too, so the low inputs use hz 30 (and the unwanted line sits at
/// |f - hz|, resp. f - hz).
#[test]
fn seitenband_ueber_das_band() {
    let freqs = [100.0f64, 200.0, 440.0, 1000.0, 2500.0, 5000.0, 8000.0, 10_000.0];
    let mut schlechtester = f64::NEG_INFINITY;
    for f in freqs {
        let hz = if f < 300.0 { 30.0f32 } else { 100.0 };
        let (u, d) = lauf(f, hz, N);
        let (hzf, a_gut, a_schlecht) = (hz as f64, f + hz as f64, (f - hz as f64).abs());
        let (u_gut, u_schlecht) = (betrag(&u, a_gut), betrag(&u, a_schlecht));
        let (d_gut, d_schlecht) = (betrag(&d, (f - hzf).abs()), betrag(&d, a_gut));
        let (ru, rd) = (db(u_schlecht / u_gut), db(d_schlecht / d_gut));
        println!("MESS schieber f {f:>7.0} hz {hz}: auf wanted {u_gut:.3}, unwanted {ru:.1} dB; ab wanted {d_gut:.3}, unwanted {rd:.1} dB");
        schlechtester = schlechtester.max(ru).max(rd);
        assert!(ru <= -40.0, "auf f {f}: {ru:.1} dB");
        assert!(rd <= -40.0, "ab f {f}: {rd:.1} dB");
    }
    println!("MESS schieber worst unwanted sideband {schlechtester:.1} dB");
}

/// negative `hz` swaps the roles of the two outputs
#[test]
fn negatives_hz_vertauscht() {
    let (u, d) = lauf(1000.0, -100.0, N);
    assert!(db(betrag(&u, 900.0) / betrag(&u, 1100.0)) > 30.0, "auf with hz -100 is the lower sideband");
    assert!(db(betrag(&d, 1100.0) / betrag(&d, 900.0)) > 30.0, "ab with hz -100 is the upper sideband");
}

#[test]
fn hz_null_laesst_den_betrag_durch() {
    for f in [100.0f64, 300.0, 1000.0, 3000.0, 6000.0, 10_000.0] {
        let (u, d) = lauf(f, 0.0, N);
        let (a, b) = (betrag(&u, f), betrag(&d, f));
        println!("MESS schieber hz 0 f {f}: auf {:.3} dB, ab {:.3} dB", db(a), db(b));
        assert!(db(a).abs() <= 0.5 && db(b).abs() <= 0.5, "f {f}: {:.3} / {:.3} dB", db(a), db(b));
    }
}

#[test]
fn stille_rein_stille_raus() {
    let mut s = Schieber::default();
    for i in 0..5000 { s.prozess((i as f32 * 0.07).sin(), 120.0, SR); }
    let mut letzte = (1.0, 1.0);
    for _ in 0..(10 * 48_000) { letzte = s.prozess(0.0, 120.0, SR); }
    assert_eq!(letzte, (0.0, 0.0), "output after 10 s of silence");
    for v in s.zustand() {
        assert!(v == 0.0 || v.is_normal(), "state after silence is {v:e}");
    }
    let (mut max, mut sub) = (0.0f32, false);
    let mut s = Schieber::default();
    for _ in 0..48_000 {
        let (a, b) = s.prozess(0.0, 500.0, SR);
        max = max.max(a.abs()).max(b.abs());
        sub |= (a != 0.0 && !a.is_normal()) || (b != 0.0 && !b.is_normal());
    }
    assert!(max == 0.0 && !sub, "silence from the start must stay exactly 0");
}

#[test]
fn nan_und_extremwerte() {
    let mut s = Schieber::default();
    for i in 0..1000 { s.prozess((i as f32 * 0.1).sin(), 100.0, SR); }
    assert_eq!(s.prozess(f32::NAN, 100.0, SR), (0.0, 0.0));
    assert_eq!(s.prozess(f32::INFINITY, 100.0, SR), (0.0, 0.0));
    for (i, hz) in [f32::NAN, f32::INFINITY, -1e9, 1e9, 0.0, 77.0].iter().cycle().take(20_000).enumerate() {
        let (a, b) = s.prozess((i as f32 * 0.3).sin(), *hz, SR);
        assert!(a.is_finite() && b.is_finite() && a.abs() < 4.0 && b.abs() < 4.0, "sample {i}: {a} / {b}");
    }
}

#[test]
fn art_im_graphen_ohne_latenz() {
    assert_eq!(ARTEN.iter().position(|a| a.art == "schieber"), Some(55));
    let g = |wert: &str| format!(r#"{{"format":"baukasten/2","name":"t","stimmen":1,"knoten":[{{"id":"e","art":"eingang"}},{{"id":"p","art":"schieber"{wert}}},{{"id":"o","art":"ausgang"}}],"kanten":[{{"von":"e.l","nach":"p.x"}},{{"von":"p.auf","nach":"o.l"}},{{"von":"p.ab","nach":"o.r"}}]}}"#);
    let mut p = uebersetze(&g(r#","hz":100"#), SR).unwrap_or_else(|e| panic!("{e:?}"));
    assert_eq!(p.latenz(), 0, "the shifter has no latency");
    // through the graph: 1 kHz in, hz 100: the same lines as the bare block
    let (mut u, mut d) = (Vec::new(), Vec::new());
    for i in 0..SETTLE + N {
        p.setze_eingang((2.0 * PI * 1000.0 * i as f64 / SR as f64).sin() as f32, 0.0);
        let (a, b) = p.sample_stereo();
        if i >= SETTLE { u.push(a as f64); d.push(b as f64); }
    }
    assert!(betrag(&u, 1100.0) > 0.9 && betrag(&d, 900.0) > 0.9, "graph: {} / {}", betrag(&u, 1100.0), betrag(&d, 900.0));
    for wert in [r#","hz":2001"#, r#","hz":-2001"#] {
        match uebersetze(&g(wert), SR) {
            Err(Fehler::Wert { wert: w, .. }) => assert_eq!(w, "hz", "{wert}"),
            other => panic!("{wert} must be refused, got {:?}", other.err()),
        }
    }
    assert!(uebersetze(&g(r#","hz":-2000"#), SR).is_ok() && uebersetze(&g(r#","hz":2000"#), SR).is_ok());
}
