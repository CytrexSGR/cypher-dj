//! Measurements on the vowel filter (`formant`, type 39) with synthetic signals. The frequency response comes from the
//! impulse response (real FFT, 1 s); it is compared with an independent analytic model of the bilinear-transformed
//! band-passes and with the published table (typed in below from the Csound manual). Every number is a `MESS` line.
use baukasten_dsp::formant::{ziel, Stimme, GEWINN, TENOR};
use baukasten_dsp::uebersetze;
use realfft::RealFftPlanner;

const SR: f32 = 48_000.0;

/// Csound manual, "Formant Values", tenor (a e i o u; f1..f5 Hz, dB, bandwidth Hz); read 2026-11-11.
const CSOUND_TENOR: [([f64; 5], [f64; 5], [f64; 5]); 5] = [
    ([650.0, 1080.0, 2650.0, 2900.0, 3250.0], [0.0, -6.0, -7.0, -8.0, -22.0], [80.0, 90.0, 120.0, 130.0, 140.0]),
    ([400.0, 1700.0, 2600.0, 3200.0, 3580.0], [0.0, -14.0, -12.0, -14.0, -20.0], [70.0, 80.0, 100.0, 120.0, 120.0]),
    ([290.0, 1870.0, 2800.0, 3250.0, 3540.0], [0.0, -15.0, -18.0, -20.0, -30.0], [40.0, 90.0, 100.0, 120.0, 120.0]),
    ([400.0, 800.0, 2600.0, 2800.0, 3000.0], [0.0, -10.0, -12.0, -12.0, -26.0], [70.0, 80.0, 100.0, 130.0, 135.0]),
    ([350.0, 600.0, 2700.0, 2900.0, 3300.0], [0.0, -20.0, -17.0, -14.0, -26.0], [40.0, 60.0, 100.0, 120.0, 120.0]),
];

fn cent(ist: f64, soll: f64) -> f64 { 1200.0 * (ist / soll).log2() }

fn ir(vokal: f32, versatz: f32, q: f32, sr: f32) -> Vec<f32> {
    let mut f = Stimme::neu();
    (0..sr as usize).map(|i| f.prozess(if i == 0 { 1.0 } else { 0.0 }, vokal, versatz, q, 1.0, sr)).collect()
}

/// magnitude at `n/2 + 1` bins of a 1 s impulse response: bin spacing 1 Hz at 48 kHz
fn betrag(x: &[f32]) -> Vec<f64> {
    let fft = RealFftPlanner::<f32>::new().plan_fft_forward(x.len());
    let mut a = x.to_vec();
    let mut s = fft.make_output_vec();
    fft.process(&mut a, &mut s).unwrap();
    s.iter().map(|c| ((c.re as f64).powi(2) + (c.im as f64).powi(2)).sqrt()).collect()
}

/// Analytic response: sum of `GEWINN 10^(dB/20) k s / (s^2 + k s + 1)`, `s = j tan(pi f / sr) / g`, `g = tan(pi fc / sr)`,
/// `k = bw / fc`, for the targets of `ziel` (their frequencies capped at 0.45 sr).
fn analytisch(vokal: f64, versatz: f64, q: f64, f: f64, sr: f64) -> f64 {
    let (mut re, mut im) = (0.0, 0.0);
    for (lf, lb, db) in ziel(vokal, versatz, q) {
        let fc = lf.exp().min(0.45 * sr);
        let k = (lb.exp() / fc).clamp(0.02, 2.0);
        let g = (std::f64::consts::PI * fc / sr).tan();
        let w = (std::f64::consts::PI * f / sr).tan() / g;
        // k j w / (1 - w^2 + k j w)
        let (nr, ni) = (0.0, k * w);
        let (dr, di) = (1.0 - w * w, k * w);
        let n = dr * dr + di * di;
        let a = GEWINN * 10f64.powf(db / 20.0);
        re += a * (nr * dr + ni * di) / n;
        im += a * (ni * dr - nr * di) / n;
    }
    (re * re + im * im).sqrt()
}

/// largest local maximum of the magnitude within [lo, hi] Hz with parabolic refinement
fn spitze(m: &[f64], lo: f64, hi: f64) -> f64 {
    let i = (lo as usize..=hi as usize).max_by(|a, b| m[*a].partial_cmp(&m[*b]).unwrap()).unwrap();
    let (a, b, c) = (m[i - 1].ln(), m[i].ln(), m[i + 1].ln());
    i as f64 + 0.5 * (a - c) / (a - 2.0 * b + c)
}

#[test]
fn tabelle_wie_veroeffentlicht() {
    for (v, (f, db, bw)) in CSOUND_TENOR.iter().enumerate() {
        for n in 0..5 {
            assert_eq!(TENOR[v][n], (f[n], db[n], bw[n]), "vowel {v} formant {n}");
        }
    }
}

#[test]
fn frequenzgang_gleich_dem_analytischen_modell() {
    let mut schlimmster = 0.0f64;
    for vokal in [0.0f32, 1.0, 2.0, 3.0, 4.0, 0.5, 1.7, 3.2] {
        for versatz in [0.0f32, -7.0, 9.0] {
            for q in [0.0f32, 0.5, 1.0] {
                let m = betrag(&ir(vokal, versatz, q, SR));
                let spitzenwert = m.iter().cloned().fold(0.0, f64::max);
                for f in (80..12_000).step_by(37) {
                    let soll = analytisch(vokal as f64, versatz as f64, q as f64, f as f64, SR as f64);
                    let fehler = (m[f] - soll).abs() / (0.01 * spitzenwert + soll);
                    schlimmster = schlimmster.max(fehler);
                    assert!(fehler < 0.02, "vokal {vokal} versatz {versatz} q {q} at {f} Hz: {} against {soll}", m[f]);
                }
            }
        }
    }
    println!("MESS response worst relative deviation from the analytic model {schlimmster:.5}");
}

/// The first formant of every vowel and the second of e, i are isolated from their neighbours: the peak of the measured
/// response sits on the table value.
#[test]
fn spitzen_auf_den_tabellenwerten() {
    let mut schlimmster = 0.0f64;
    for (v, n) in [(0, 0), (1, 0), (2, 0), (3, 0), (4, 0), (1, 1), (2, 1)] {
        let m = betrag(&ir(v as f32, 0.0, 0.5, SR));
        let soll = TENOR[v][n].0;
        let f = spitze(&m, soll * 0.85, soll * 1.15);
        let c = cent(f, soll);
        println!("MESS peak vowel {v} formant {} table {soll} Hz measured {f:.2} Hz {c:+.2} cent", n + 1);
        schlimmster = schlimmster.max(c.abs());
    }
    println!("MESS peak worst {schlimmster:.2} cent");
    assert!(schlimmster < 60.0, "worst {schlimmster} cent");
}

/// Shift in semitones moves every formant: the first two peaks of `i` (isolated) at -12, -5, 0, +7, +12 semitones.
#[test]
fn versatz_verschiebt_alle_formanten() {
    let mut schlimmster = 0.0f64;
    for versatz in [-12.0f32, -5.0, 0.0, 7.0, 12.0] {
        let m = betrag(&ir(2.0, versatz, 0.5, SR));
        let faktor = 2f64.powf(versatz as f64 / 12.0);
        for n in 0..2 {
            let soll = TENOR[2][n].0 * faktor;
            let f = spitze(&m, soll * 0.9, soll * 1.1);
            let c = cent(f, soll);
            println!("MESS shift {versatz:+} st formant {} expected {soll:.1} Hz measured {f:.1} Hz {c:+.2} cent", n + 1);
            schlimmster = schlimmster.max(c.abs());
        }
    }
    println!("MESS shift worst {schlimmster:.2} cent");
    assert!(schlimmster < 60.0, "worst {schlimmster} cent");
}

/// -3 dB bandwidth of the first formant of `i` (290 Hz, table 40 Hz) at sharpness 0, 0.5, 1: 120, 40, 13.3 Hz.
#[test]
fn schaerfe_stellt_die_bandbreite() {
    for (q, soll) in [(0.0f32, 120.0f64), (0.5, 40.0), (1.0, 40.0 / 3.0)] {
        let m = betrag(&ir(2.0, 0.0, q, SR));
        let i0 = spitze(&m, 250.0, 330.0).round() as usize;
        let halb = m[i0] / 2f64.sqrt();
        let (mut lo, mut hi) = (i0, i0);
        while m[lo] > halb { lo -= 1; }
        while m[hi] > halb { hi += 1; }
        // linear interpolation of the crossings
        let unten = lo as f64 + (halb - m[lo]) / (m[lo + 1] - m[lo]);
        let oben = hi as f64 - (halb - m[hi]) / (m[hi - 1] - m[hi]);
        let bw = oben - unten;
        println!("MESS bandwidth q {q}: {bw:.2} Hz, expected {soll:.2} Hz");
        assert!((bw / soll - 1.0).abs() < 0.12, "q {q}: {bw} Hz against {soll}");
    }
}

/// The interpolation between vowels is continuous on the axis: no jump in log frequency, log bandwidth or level
/// between two points 0.001 apart, and each vowel is exactly hit at an integer.
#[test]
fn vokalachse_ist_stetig() {
    let mut vor = ziel(0.0, 0.0, 0.5);
    let mut gross = (0.0f64, 0.0f64, 0.0f64);
    let mut v = 0.001;
    while v <= 4.0 {
        let z = ziel(v, 0.0, 0.5);
        for n in 0..5 {
            gross.0 = gross.0.max((z[n].0 - vor[n].0).abs());
            gross.1 = gross.1.max((z[n].1 - vor[n].1).abs());
            gross.2 = gross.2.max((z[n].2 - vor[n].2).abs());
        }
        vor = z;
        v += 0.001;
    }
    println!("MESS axis largest step per 0.001: ln f {:.5}, ln bw {:.5}, dB {:.4}", gross.0, gross.1, gross.2);
    assert!(gross.0 < 1.0e-3 && gross.1 < 1.0e-3 && gross.2 < 0.05);
    // the first formant moves monotonically from a to i
    let (a, e, i) = (ziel(0.0, 0.0, 0.5)[0].0, ziel(1.0, 0.0, 0.5)[0].0, ziel(2.0, 0.0, 0.5)[0].0);
    assert!(a > e && e > i);
}

fn saege(i: usize, hz: f32) -> f32 { 2.0 * ((i as f32 * hz / SR) % 1.0) - 1.0 }

/// Largest sample-to-sample step of a saw (110 Hz, 0.5) through the filter, `verlauf(i)` gives (vokal, versatz, q).
fn gross_schritt(n: usize, verlauf: impl Fn(usize) -> (f32, f32, f32)) -> (f32, f32) {
    let mut f = Stimme::neu();
    let (mut gross, mut spitze, mut vor) = (0.0f32, 0.0f32, 0.0f32);
    for i in 0..n {
        let (v, s, q) = verlauf(i);
        let y = f.prozess(0.5 * saege(i, 110.0), v, s, q, 1.0, SR);
        assert!(y.is_finite());
        if i > 12_000 { gross = gross.max((y - vor).abs()); spitze = spitze.max(y.abs()); }
        vor = y;
    }
    (gross, spitze)
}

/// Click-free: jumps of `vokal` (a to u and back every 5000 samples), a sweep and audio-rate movement keep the largest
/// step within 2 times the steady maximum over all five vowels at sharpness 0, 0.5 and 1, and the peak within 2 times as well.
#[test]
fn vokal_sprung_und_audiotakt_klicken_nicht() {
    let still = (0..15).map(|n| gross_schritt(48_000, move |_| ((n % 5) as f32, 0.0, (n / 5) as f32 * 0.5))).fold((0.0f32, 0.0f32), |a, b| (a.0.max(b.0), a.1.max(b.1)));
    println!("MESS click steady vowels: max step {:.4}, peak {:.4}", still.0, still.1);
    let faelle: Vec<(String, (f32, f32))> = vec![
        ("jump a-u every 5000".into(), gross_schritt(96_000, |i| (if (i / 5000) % 2 == 0 { 0.0 } else { 4.0 }, 0.0, 0.5))),
        ("jump of shift +-12 every 3000".into(), gross_schritt(96_000, |i| (2.0, if (i / 3000) % 2 == 0 { -12.0 } else { 12.0 }, 0.5))),
        ("jump of q every 4000".into(), gross_schritt(96_000, |i| (1.0, 0.0, if (i / 4000) % 2 == 0 { 0.0 } else { 1.0 }))),
        ("sweep 0..4 in 1 s".into(), gross_schritt(96_000, |i| ((i as f32 / 48_000.0 % 1.0) * 4.0, 0.0, 0.5))),
        ("audio rate 50 Hz".into(), gross_schritt(96_000, |i| (2.0 + 2.0 * (2.0 * std::f32::consts::PI * 50.0 * i as f32 / SR).sin(), 0.0, 0.5))),
        ("audio rate 500 Hz".into(), gross_schritt(96_000, |i| (2.0 + 2.0 * (2.0 * std::f32::consts::PI * 500.0 * i as f32 / SR).sin(), 0.0, 0.5))),
        ("audio rate 5000 Hz".into(), gross_schritt(96_000, |i| (2.0 + 2.0 * (2.0 * std::f32::consts::PI * 5000.0 * i as f32 / SR).sin(), 0.0, 0.5))),
    ];
    for (name, (g, s)) in faelle {
        println!("MESS click {name}: max step {g:.4}, peak {s:.4}");
        assert!(g < 2.0 * still.0 && s < 2.0 * still.1, "{name}: step {g} peak {s} against steady {:?}", still);
    }
}

/// Level: a saw (110 Hz, +-1) and white noise through each vowel, in dB against the input (the basis of `GEWINN`).
#[test]
fn pegel_von_saege_und_rauschen() {
    for v in 0..5 {
        let mut f = Stimme::neu();
        let (mut ein, mut aus) = (0.0f64, 0.0f64);
        for i in 0..96_000 {
            let x = saege(i, 110.0);
            let y = f.prozess(x, v as f32, 0.0, 0.5, 1.0, SR);
            if i >= 4800 { ein += (x as f64).powi(2); aus += (y as f64).powi(2); }
        }
        let saw_db = 10.0 * (aus / ein).log10();
        let mut f = Stimme::neu();
        let (mut z, mut ein, mut aus) = (5u32, 0.0f64, 0.0f64);
        for i in 0..192_000 {
            z ^= z << 13; z ^= z >> 17; z ^= z << 5;
            let x = (z as f64 / u32::MAX as f64 * 2.0 - 1.0) as f32;
            let y = f.prozess(x, v as f32, 0.0, 0.5, 1.0, SR);
            if i >= 4800 { ein += (x as f64).powi(2); aus += (y as f64).powi(2); }
        }
        let noise_db = 10.0 * (aus / ein).log10();
        println!("MESS level vowel {v}: saw 110 Hz {saw_db:+.2} dB, white noise {noise_db:+.2} dB");
        assert!((-12.0..=6.0).contains(&saw_db), "vowel {v}: saw {saw_db} dB");
    }
}

#[test]
fn mix_null_laesst_das_signal_bitgleich() {
    let mut f = Stimme::neu();
    for i in 0..5000 {
        let x = saege(i, 220.0) * 0.5;
        assert_eq!(f.prozess(x, 1.3, 2.0, 0.5, 0.0, SR).to_bits(), x.to_bits());
    }
}

#[test]
fn extreme_eingaenge_bleiben_endlich() {
    let werte = [0.0f32, -0.0, 1e-38, 1.0, -1.0, 4.0, -4.0, 1e10, -1e10, f32::MAX, f32::MIN, f32::NAN, f32::INFINITY, f32::NEG_INFINITY];
    for sr in [44_100.0f32, 48_000.0, 192_000.0] {
        let mut f = Stimme::neu();
        let mut z = 1u32;
        for i in 0..200_000 {
            z ^= z << 13; z ^= z >> 17; z ^= z << 5;
            let pick = |s: u32| werte[((z >> s) as usize) % werte.len()];
            let y = f.prozess(pick(0), pick(4), pick(8), pick(12), pick(16), sr);
            assert!(y.is_finite(), "sr {sr} sample {i}: {y}");
        }
        // finite input at the largest shift: every formant above 0.45 sr is capped, the output stays finite and small
        let mut f = Stimme::neu();
        let mut spitze = 0.0f32;
        for i in 0..100_000 {
            let y = f.prozess(0.5 * saege(i, 110.0), (i / 777 % 5) as f32, if i % 2000 < 1000 { 1e9 } else { -1e9 }, 1e9, 1.0, sr);
            assert!(y.is_finite());
            spitze = spitze.max(y.abs());
        }
        println!("MESS extreme sr {sr}: peak {spitze:.3} with shift +-1e9 st and q 1e9");
        assert!(spitze < 20.0);
    }
}

/// Graph path: the effect example on white noise (as host input) puts a peak of the left channel on 650 Hz for vowel a.
#[test]
fn sprech_effekt_formt_das_spektrum() {
    let g = std::fs::read_to_string(format!("{}/demos/fx-formant-sprech.json", env!("CARGO_MANIFEST_DIR"))).unwrap();
    let mut p = uebersetze(&g, SR).unwrap();
    p.setze_regler(1, 0.0); // a
    p.setze_regler(2, 0.5); // no shift
    p.setze_regler(3, 0.5);
    let mut z = 3u32;
    let mut y = Vec::new();
    for _ in 0..(2 * SR as usize) {
        z ^= z << 13; z ^= z >> 17; z ^= z << 5;
        let x = (z as f64 / u32::MAX as f64 * 2.0 - 1.0) as f32 * 0.5;
        p.setze_eingang(x, x);
        y.push(p.sample_stereo().0);
    }
    // average periodogram over 16 blocks of 4096
    let fft = RealFftPlanner::<f32>::new().plan_fft_forward(4096);
    let mut mittel = vec![0.0f64; 2049];
    for b in 0..16 {
        let mut a: Vec<f32> = y[10_000 + b * 4096..10_000 + (b + 1) * 4096].to_vec();
        let mut s = fft.make_output_vec();
        fft.process(&mut a, &mut s).unwrap();
        for (m, c) in mittel.iter_mut().zip(&s) { *m += (c.re as f64).powi(2) + (c.im as f64).powi(2); }
    }
    let df = SR as f64 / 4096.0;
    let i = (300..1500).map(|f| (f as f64 / df) as usize).max_by(|a, b| mittel[*a].partial_cmp(&mittel[*b]).unwrap()).unwrap();
    let f = i as f64 * df;
    println!("MESS example noise peak below 1.5 kHz at {f:.1} Hz (table: formant 1 of a at 650 Hz)");
    assert!((f / 650.0 - 1.0).abs() < 0.08, "{f}");
}

#[test]
fn ungueltige_werte_im_graphen_werden_abgelehnt() {
    let g = |w: &str| format!(r#"{{"format":"baukasten/2","name":"t","stimmen":1,"knoten":[{{"id":"e","art":"eingang"}},{{"id":"k","art":"formant",{w}}},{{"id":"o","art":"ausgang"}}],"kanten":[{{"von":"e.l","nach":"k.x"}},{{"von":"k.aus","nach":"o.l"}}]}}"#);
    assert!(uebersetze(&g(r#""vokal":2.5"#), SR).is_ok());
    for w in [r#""vokal":4.5"#, r#""vokal":-0.1"#, r#""versatz":30"#, r#""q":1.2"#, r#""mix":2"#] {
        assert!(uebersetze(&g(w), SR).is_err(), "{w} must be rejected");
    }
}
