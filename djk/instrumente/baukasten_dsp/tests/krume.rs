//! DSP tests for `Krume` (S7 task 1): bit-depth quantizer plus zero-order-hold sample-rate reduction.
use baukasten_dsp::krume::Krume;

const SR: f32 = 48_000.0;

/// Reference quantizer (D2): mid-tread, symmetric, clamped to +-1
fn quant(x: f32, bits: f32) -> f32 {
    let q = 2f64.powf(bits as f64 - 1.0);
    (((x.clamp(-1.0, 1.0)) as f64 * q).round() / q) as f32
}

fn sine(n: usize, hz: f32, amp: f32) -> Vec<f32> {
    (0..n).map(|i| amp * (2.0 * std::f32::consts::PI * hz * i as f32 / SR).sin()).collect()
}

fn ramp(n: usize) -> Vec<f32> { (0..n).map(|i| -1.0 + 2.0 * i as f32 / (n - 1) as f32).collect() }

#[test]
fn bits_16_rate_sr_is_transparent_within_quant_step() {
    let mut k = Krume::default();
    let x = sine(4800, 1000.0, 0.5);
    let worst = x.iter().map(|&v| (k.prozess(v, 16.0, SR, SR) - v).abs()).fold(0.0f32, f32::max);
    assert!(worst <= 2f32.powi(-16) + 1e-7, "worst error {worst}");
    assert!(worst > 1e-7, "quantizer does nothing, test would be blind ({worst})");
}

#[test]
fn bits_1_gives_three_levels() {
    let mut k = Krume::default();
    let mut set: Vec<f32> = Vec::new();
    for v in ramp(1001) {
        let y = k.prozess(v, 1.0, SR, SR);
        if !set.contains(&y) {
            set.push(y);
        }
    }
    set.sort_by(|a, b| a.partial_cmp(b).unwrap());
    assert_eq!(set, vec![-1.0, 0.0, 1.0]);
}

#[test]
fn bits_4_gives_at_most_17_levels() {
    let mut k = Krume::default();
    let mut set: Vec<f32> = Vec::new();
    for v in ramp(1001) {
        let y = k.prozess(v, 4.0, SR, SR);
        assert_eq!((y * 8.0).fract(), 0.0, "{y} is not k/8");
        if !set.contains(&y) {
            set.push(y);
        }
    }
    assert!(set.len() <= 17, "{} levels", set.len());
    assert!(set.len() >= 15, "too few levels, ramp not covered: {}", set.len());
}

#[test]
fn clamps_above_one() {
    let mut k = Krume::default();
    assert_eq!(k.prozess(3.0, 8.0, SR, SR), 1.0);
    assert_eq!(k.prozess(-3.0, 8.0, SR, SR), -1.0);
}

#[test]
fn rate_quarter_holds_four_samples() {
    // R2/R6: takes at 0, 4, 8, ...; offset 0.1 so that the first-sample flag is observable
    let mut k = Krume::default();
    let x: Vec<f32> = (0..400).map(|i| 0.1 + i as f32 / 1000.0).collect();
    let y: Vec<f32> = x.iter().map(|&v| k.prozess(v, 24.0, 12_000.0, SR)).collect();
    for b in 0..100 {
        let soll = quant(x[4 * b], 24.0);
        for j in 0..4 {
            assert_eq!(y[4 * b + j], soll, "block {b} sample {j}");
        }
    }
    assert_ne!(y[0], y[4], "ramp must change between holds, test would be blind");
}

#[test]
fn rate_non_integer_ratio_average_hold() {
    // R3: bits 24, window [26038, 26042]. Failure case: `p = 0` instead of `p -= floor(p)` gives 24000 changes.
    let mut k = Krume::default();
    let mut vor = f32::NAN;
    let mut wechsel = 0;
    for i in 0..48_000 {
        let y = k.prozess(i as f32 / 48_000.0, 24.0, 26_040.0, SR);
        if y != vor {
            wechsel += 1;
        }
        vor = y;
    }
    assert!((26_038..=26_042).contains(&wechsel), "{wechsel} value changes");
}

#[test]
fn rate_at_or_above_sr_never_holds() {
    let mut k = Krume::default();
    for (i, v) in sine(2000, 777.0, 0.9).into_iter().enumerate() {
        assert_eq!(k.prozess(v, 10.0, 96_000.0, SR), quant(v, 10.0), "sample {i}");
    }
}

#[test]
fn non_finite_becomes_zero() {
    let mut k = Krume::default();
    assert_eq!(k.prozess(f32::NAN, 8.0, SR, SR), 0.0);
    assert_eq!(k.prozess(f32::INFINITY, 8.0, SR, SR), 0.0);
    assert_eq!(k.prozess(f32::NEG_INFINITY, 8.0, SR, SR), 0.0);
    assert_eq!(k.prozess(0.3, 8.0, SR, SR), quant(0.3, 8.0));
}

#[test]
fn reset_clears_hold() {
    let mut k = Krume::default();
    for i in 0..50 {
        k.prozess(0.7 + i as f32 * 1e-3 * 0.1, 8.0, 1000.0, SR);
    }
    k.zuruecksetzen();
    assert_eq!(k.prozess(-0.4, 8.0, 1000.0, SR), quant(-0.4, 8.0));
}

#[test]
fn rate_zero_or_negative_holds_first_sample() {
    for rate in [0.0f32, -5.0] {
        let mut k = Krume::default();
        let y: Vec<f32> = (0..1000).map(|i| k.prozess(0.2 + i as f32 * 1e-3, 24.0, rate, SR)).collect();
        assert!(y.iter().all(|&v| v == quant(0.2, 24.0)), "rate {rate}: {:?}", &y[..3]);
    }
}
