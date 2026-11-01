//! Sound guardrails of slice 8 (S8 task 2): the two example graphs do what their names say, measured on the output.
//! Release build recommended: `cargo test --release -p baukasten_dsp --test leitplanken_roehre`.
use baukasten_dsp::{uebersetze, Programm};

const SR: f32 = 48_000.0;
const LEAD: &str = include_str!("../beispiele/roehre-lead.json");
const FX: &str = include_str!("../beispiele/fx-roehre.json");

fn rms(x: &[f32]) -> f64 { (x.iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / x.len() as f64).sqrt() }
fn db(v: f64) -> f64 { 20.0 * v.log10() }

/// Gaussian noise (Box-Muller from xorshift) with the given RMS
fn rauschen(n: usize, rms_soll: f32, mut s: u64) -> Vec<f32> {
    let mut gleich = move || {
        s ^= s << 13;
        s ^= s >> 7;
        s ^= s << 17;
        ((s >> 11) as f64 + 0.5) / (1u64 << 53) as f64
    };
    (0..n)
        .map(|_| {
            let (a, b) = (gleich(), gleich());
            (rms_soll as f64 * (-2.0 * a.ln()).sqrt() * (2.0 * std::f64::consts::PI * b).cos()) as f32
        })
        .collect()
}

fn effekt(regler: &[(usize, f32)], l: &[f32]) -> Vec<(f32, f32)> {
    let mut p: Programm = uebersetze(FX, SR).unwrap();
    for (nr, w) in regler { p.setze_regler(*nr, *w); }
    let y = l.iter().map(|x| { p.setze_eingang(*x, *x); p.sample_stereo() }).collect();
    assert_eq!(p.rettungen, 0);
    y
}

#[test]
fn roehre_lead_chord_peak_below_one() {
    for (a, b) in [(0.0f32, 0.0f32), (0.0, 1.0), (1.0, 0.0), (1.0, 1.0), (0.5, 0.5)] {
        let mut p = uebersetze(LEAD, SR).unwrap();
        p.setze_regler(1, a);
        p.setze_regler(2, b);
        for n in [45u8, 52, 57, 61] { p.note_an(n, 1.0); }
        let x: Vec<f32> = (0..48_000).map(|_| p.sample()).collect();
        let pk = x.iter().fold(0.0f32, |m, v| m.max(v.abs()));
        println!("MESS roehre-lead chord, knobs ({a}, {b}): peak {pk:.3}");
        assert!(pk > 0.05, "knobs ({a}, {b}): silent ({pk})");
        assert!(pk < 1.0, "knobs ({a}, {b}): peak {pk}");
    }
}

#[test]
fn fx_roehre_noise_at_max_knob_is_bounded() {
    let x = rauschen(4 * 48_000, 0.3, 77);
    assert!((rms(&x) - 0.3).abs() < 0.01, "test input rms {}", rms(&x));
    for knobs in [[(1, 1.0f32), (2, 1.0)], [(1, 1.0), (2, 0.0)], [(1, 1.0), (2, 0.6)]] {
        let y = effekt(&knobs, &x);
        let pk = y.iter().fold(0.0f32, |m, (l, r)| m.max(l.abs()).max(r.abs()));
        println!("MESS fx-roehre noise 0.3 rms, knobs {knobs:?}: peak {pk:.3}, rms {:.3}", rms(&y.iter().map(|v| v.0).collect::<Vec<_>>()));
        assert!(y.iter().all(|(l, r)| l.is_finite() && r.is_finite()));
        // S13: the level knob falls 25 dB over the drive range (it was 12 dB) so the loudness tracks the drive: the loudest
        // end stays below full scale (before: peak 2.5 at knob 1), and the positive control keeps it clearly audible
        assert!(pk < 1.0 && pk > 0.3, "knobs {knobs:?}: peak {pk}");
    }
}

#[test]
fn fx_roehre_unity_at_zero_drive() {
    // C3: 1 kHz sine, amplitude 0.3 (a small signal for the triode: 75 mV at the grid); knob 1 = 0 is antrieb 0 dB and level 1,
    // knob 2 = 0.6 is bias -1.5 V (the reference bias, where the small-signal gain is exactly 1)
    let n = 48_000;
    let x: Vec<f32> = (0..n).map(|i| 0.3 * (2.0 * std::f64::consts::PI * 1000.0 * i as f64 / SR as f64).sin() as f32).collect();
    let y: Vec<f32> = effekt(&[(1, 0.0), (2, 0.6)], &x).iter().map(|v| v.0).collect();
    let d = db(rms(&y[9600..]) / rms(&x[9600..]));
    println!("MESS fx-roehre 1 kHz amplitude 0.3, knob 1 = 0: {d:+.3} dB");
    assert!(d.abs() < 0.5, "{d} dB");
    // accepted behaviour (ADAA1 acts as (1 + z^-1) / 2 in the linear region): about -2 dB at 10 kHz
    let x10: Vec<f32> = (0..n).map(|i| 0.3 * (2.0 * std::f64::consts::PI * 10_000.0 * i as f64 / SR as f64).sin() as f32).collect();
    let y10: Vec<f32> = effekt(&[(1, 0.0), (2, 0.6)], &x10).iter().map(|v| v.0).collect();
    let d10 = db(rms(&y10[9600..]) / rms(&x10[9600..]));
    println!("MESS fx-roehre 10 kHz, knob 1 = 0: {d10:+.3} dB (expected -2.0)");
    assert!((d10 + 2.0).abs() < 0.3, "{d10} dB");
}
