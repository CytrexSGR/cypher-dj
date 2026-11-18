//! audit U39: the drum bus runs linear at drive 0 and feeds its first-order ADAA tanh only when the drive is above 0. The ADAA state
//! (previous input and its antiderivative) was not updated on the linear path, so the first driven sample, when the drive knob left 0,
//! took the mean slope over [stale input, current input] instead of the slope of one real step: a one-sample error (a tick).
//!
//! A constant input makes the expectation exact: filter open, pegel 1, so the output is the DC blocker applied to the drive stage,
//! `ausgang_n = y_n - y_(n-1) + c * ausgang_(n-1)`, c = 1 - 2 pi 10 / sr. Linear up to the switch (y = x), then the ADAA output of a
//! steady input, `X0 tanh(a x) / tanh(a X0)` with a = 1 for a drive this small.
use baukasten_dsp::trommeln::{Bus, Einstellung};

const SR: f32 = 48_000.0;
const X: f32 = 0.7;
const X0: f64 = 0.5;
const AB: usize = 400; // the drive target leaves 0 here

#[test]
fn first_driven_sample_after_drive_leaves_zero_has_no_spike() {
    let e = Einstellung::neu(0, 80.0, 1, SR);
    let mut b = Bus::neu();
    let mut aus = Vec::new();
    for i in 0..AB + 3 {
        let drive = if i < AB { 0.0 } else { 1e-3 };
        aus.push(b.prozess(X, &e, SR, drive, 0.5, 0.3, 1.0) as f64);
    }
    let c = 1.0 - 2.0 * std::f64::consts::PI * 10.0 / SR as f64;
    let y_ss = X0 * (X as f64).tanh() / X0.tanh();
    let erwartet = y_ss - X as f64 + X as f64 * c.powi(AB as i32);
    let stale = (((X as f64).cosh()).ln() / X as f64) / X0.tanh() * X0 - X as f64 + X as f64 * c.powi(AB as i32);
    println!("first driven sample {:.5}, expected {:.5} (the stale ADAA state gives {:.5})", aus[AB], erwartet, stale);
    // the samples before the switch follow the linear path exactly (the DC blocker of a constant)
    assert!((aus[AB - 1] - X as f64 * c.powi(AB as i32 - 1)).abs() < 1e-5, "linear path changed: {}", aus[AB - 1]);
    assert!((aus[AB] - erwartet).abs() < 2e-3, "first driven sample {} instead of {erwartet}", aus[AB]);
}
