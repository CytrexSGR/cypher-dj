//! S10 task 1: the sampler DSP (D6-D10, C4, C5). API: `Sampler::prozess(daten, &Einstellung, sr, Eingabe)` per sample.
#[path = "sampler_helpers/mod.rs"]
mod sampler_hilfe;
use baukasten_dsp::sampler::{Eingabe, Einstellung, Sampler, FADE};
use sampler_hilfe::*;

const SR: f32 = 48_000.0;
const GRUND: f32 = 261.6256;

fn e(scheiben: usize, schleife: bool) -> Einstellung { Einstellung { grund: GRUND, scheiben, schleife } }

fn ein(hz: f32, trig: bool) -> Eingabe { Eingabe { hz, trig: if trig { 1.0 } else { 0.0 }, gate: 1.0, scheibe: 0.0, rueck: 0.0 } }

/// Run `n` samples; `f(i)` gives the inputs.
fn lauf(d: &[f32], e: &Einstellung, sr: f32, n: usize, f: impl Fn(usize) -> Eingabe) -> Vec<(f32, f32)> {
    let mut s = Sampler::default();
    (0..n).map(|i| s.prozess(d, e, sr, f(i))).collect()
}

fn links(x: &[(f32, f32)]) -> Vec<f32> { x.iter().map(|v| v.0).collect() }

/// Number of samples until the voice reports it stopped (None if it still plays after `max`).
fn laenge(d: &[f32], e: &Einstellung, sr: f32, max: usize, f: impl Fn(usize) -> Eingabe) -> Option<usize> {
    let mut s = Sampler::default();
    for i in 0..max {
        s.prozess(d, e, sr, f(i));
        if !s.spielt() { return Some(i + 1); }
    }
    None
}

fn schlag(hz: f32) -> impl Fn(usize) -> Eingabe { move |i| ein(hz, i == 0) }

#[test]
fn original_speed_is_bit_identical_from_sample_zero() {
    let d = sinus(1000.0, 48_000, 0.9);
    let o = links(&lauf(&d, &e(1, false), SR, 47_000, schlag(GRUND)));
    for (i, v) in o.iter().enumerate() {
        assert_eq!(v.to_bits(), d[2 * i].to_bits(), "sample {i}");
    }
}

#[test]
fn octave_up_down() {
    let d = sinus(1000.0, 48_000, 0.9);
    let o = links(&lauf(&d, &e(1, false), SR, 30_000, schlag(2.0 * GRUND)));
    let f = spitze_hz(&o, 48_000.0);
    assert!((f - 2000.0).abs() <= 0.733, "up: {f}");
    let n = laenge(&d, &e(1, false), SR, 200_000, schlag(2.0 * GRUND)).unwrap();
    assert!((n as i64 - 24_000).abs() <= 2, "up length {n}");
    let o = links(&lauf(&d, &e(1, false), SR, 100_000, schlag(GRUND / 2.0)));
    let f = spitze_hz(&o[..65_536], 48_000.0);
    assert!((f - 500.0).abs() <= 0.733, "down: {f}");
    let n = laenge(&d, &e(1, false), SR, 200_000, schlag(GRUND / 2.0)).unwrap();
    assert!((n as i64 - 96_000).abs() <= 2, "down length {n}");
}

#[test]
fn sr_compensation() {
    let d = sinus(1000.0, 48_000, 0.9);
    let o = links(&lauf(&d, &e(1, false), 44_100.0, 44_000, schlag(GRUND)));
    let f = spitze_hz(&o, 44_100.0);
    assert!((f - 1000.0).abs() <= 0.5, "{f}");
}

fn scheibe(i: usize, s: f32) -> Eingabe { Eingabe { scheibe: s, ..ein(GRUND, i == 0) } }

#[test]
fn slices_pick_the_segment_and_stop_after_one_slice() {
    let l = 1000;
    let d = segmente(8, l);
    for (s, soll) in [(5.0, 0.6f32), (-1.0, 0.8), (8.0, 0.1), (0.0, 0.1), (7.0, 0.8), (15.0, 0.8), (5.4, 0.6), (5.6, 0.7), (-9.0, 0.8)] {
        let o = links(&lauf(&d, &e(8, false), SR, 1200, |i| scheibe(i, s)));
        // no fade-in on the first trigger (C5): from sample 0 on the value is exact; the last FADE samples fade out
        for (i, v) in o.iter().enumerate().take(l - FADE) {
            assert!((v - soll).abs() <= 1e-6, "scheibe {s} sample {i}: {v} vs {soll}");
        }
        assert!(o[l..].iter().all(|v| *v == 0.0), "scheibe {s}: output after the slice");
        assert_eq!(laenge(&d, &e(8, false), SR, 5000, |i| scheibe(i, s)), Some(l), "scheibe {s}");
        // the fade-out over the last FADE samples: strictly decreasing
        for i in l - FADE + 1..l {
            assert!(o[i] < o[i - 1], "fade not decreasing at {i}: {} {}", o[i - 1], o[i]);
        }
        assert!(o[l - 1] > 0.0 && o[l - 1] < soll * 0.02, "last sample {}", o[l - 1]);
    }
}

#[test]
fn slice_index_is_read_at_trigger_time_only() {
    let d = segmente(8, 1000);
    let o = links(&lauf(&d, &e(8, false), SR, 800, |i| Eingabe { scheibe: if i < 10 { 2.0 } else { 6.0 }, ..ein(GRUND, i == 0) }));
    assert!(o.iter().all(|v| (v - 0.3).abs() < 1e-6));
}

#[test]
fn reverse_plays_the_ramp_backwards() {
    let d = stereo(48_000, |i| i as f32 / 48_000.0);
    let o = links(&lauf(&d, &e(1, false), SR, 48_100, |i| Eingabe { rueck: 1.0, ..ein(GRUND, i == 0) }));
    assert!(o[0] > 0.999, "{}", o[0]);
    let n = 48_000;
    for i in 1..n {
        assert!(o[i] < o[i - 1], "not falling at {i}: {} {}", o[i - 1], o[i]);
    }
    let letzter = o.iter().rev().find(|v| **v != 0.0).copied().unwrap();
    assert!(letzter > 0.0 && letzter < 0.01, "last nonzero {letzter}");
    assert!(o[n..].iter().all(|v| *v == 0.0));
    assert_eq!(laenge(&d, &e(1, false), SR, 60_000, |i| Eingabe { rueck: 1.0, ..ein(GRUND, i == 0) }), Some(n));
}

fn tor(i: usize, hoch_bis: usize, rueck: f32, s: f32) -> Eingabe {
    Eingabe { gate: if i < hoch_bis { 1.0 } else { 0.0 }, rueck, scheibe: s, ..ein(GRUND, i == 0) }
}

#[test]
fn loop_mode_keeps_playing_and_stops_after_the_gate_falls() {
    let l = 2000;
    let d = segmente(4, l);
    let el = e(4, true);
    let o = links(&lauf(&d, &el, SR, 150_000, |i| tor(i, 144_000, 0.0, 2.0)));
    // gate high for 3 s: no silence at all, always inside segment 2 (value 0.3)
    for (i, v) in o.iter().enumerate().take(144_000) {
        assert!((v - 0.3).abs() <= 1e-6, "sample {i}: {v}");
    }
    // gate low: the pass finishes and stops within one slice length plus FADE
    let n = laenge(&d, &el, SR, 150_000, |i| tor(i, 144_000, 0.0, 2.0)).unwrap();
    assert!(n >= 144_000 && n <= 144_000 + l + 96, "{n}");
    assert!(o[n..].iter().all(|v| *v == 0.0));
    // gate low from the start: exactly one pass
    let n = laenge(&d, &el, SR, 150_000, |i| tor(i, 0, 0.0, 2.0)).unwrap();
    assert_eq!(n, l);
    // no gate edge at all (default gate 1): loops for ever
    assert_eq!(laenge(&d, &el, SR, 100_000, |i| scheibe(i, 2.0)), None);
    // one-shot ignores the gate: stops at the slice end, with the gate high or low
    for hoch in [0, 100_000] {
        let n = laenge(&d, &e(4, false), SR, 150_000, |i| tor(i, hoch, 0.0, 2.0)).unwrap();
        assert_eq!(n, l, "gate high until {hoch}");
    }
}

#[test]
fn head_stays_inside_the_slice_in_loop_and_reverse() {
    let d = segmente(8, 1000);
    for rueck in [0.0, 1.0] {
        for sr_hz in [GRUND, GRUND * 1.37, GRUND * 0.61, GRUND * 5.3] {
            let o = links(&lauf(&d, &e(8, true), SR, 48_000, |i| Eingabe { rueck, scheibe: 5.0, ..ein(sr_hz, i == 0) }));
            for (i, v) in o.iter().enumerate() {
                assert!((v - 0.6).abs() <= 1e-6, "rueck {rueck} hz {sr_hz} sample {i}: {v}");
            }
        }
    }
}

#[test]
fn retrigger_is_click_free() {
    let d = sinus(1000.0, 48_000, 0.8);
    let eigen = d.chunks(2).map(|c| c[0]).collect::<Vec<_>>().windows(2).map(|w| (w[1] - w[0]).abs()).fold(0.0f32, f32::max);
    let tr = [1000usize, 1007, 3333, 3340, 9000];
    let o = links(&lauf(&d, &e(1, false), SR, 20_000, |i| ein(GRUND, i == 0 || tr.contains(&i))));
    let m = o.windows(2).map(|w| (w[1] - w[0]).abs()).fold(0.0f32, f32::max);
    assert!(m <= 2.0 * eigen, "max jump {m} vs file {eigen}");
}

#[test]
fn retrigger_fade_ramps() {
    let d = stereo(48_000, |_| 0.5);
    let t0 = 500;
    let o = links(&lauf(&d, &e(1, false), SR, 1500, |i| ein(GRUND, i == 0 || i == t0)));
    assert!(o[..t0].iter().all(|v| *v == 0.5), "before the retrigger");
    for i in t0 + 1..t0 + FADE {
        assert!(o[i] < o[i - 1], "fade-out not decreasing at +{}: {} {}", i - t0, o[i - 1], o[i]);
    }
    assert_eq!(o[t0], 0.5);
    for i in t0 + FADE + 1..t0 + 2 * FADE {
        assert!(o[i] > o[i - 1], "fade-in not increasing at +{}: {} {}", i - t0, o[i - 1], o[i]);
    }
    assert!(o[t0 + FADE] < o[t0 + FADE + 1]);
    assert!(o[t0 + 2 * FADE..].iter().all(|v| *v == 0.5), "after the fade");
}

#[test]
fn half_positions_follow_the_sine_for_a_slow_file() {
    // C4(a) as written (6 kHz, 1e-3) cannot hold for Catmull-Rom (measured 7.8e-3, see 1/c4a_catmull_6khz.txt);
    // this is the 1 kHz version of the same idea: every interpolated sample within 1e-4 of the analytic sine (nearest: ~0.06)
    let d = sinus(1000.0, 48_000, 1.0);
    let o = links(&lauf(&d, &e(1, false), SR, 40_000, schlag(GRUND / 2.0)));
    for (i, v) in o.iter().enumerate().skip(4) {
        let soll = (2.0 * std::f64::consts::PI * 1000.0 * 0.5 * i as f64 / 48_000.0).sin();
        assert!((*v as f64 - soll).abs() < 1e-4, "sample {i}: {v} vs {soll}");
    }
}

#[test]
fn rate_clamps() {
    let d = sinus(1000.0, 48_000, 0.9);
    // upper clamp: step 8 -> 8 kHz
    let o = links(&lauf(&d, &e(1, false), SR, 5_000, schlag(1000.0 * GRUND)));
    let f = spitze_hz(&o[..4_000], 48_000.0);
    assert!((f - 8000.0).abs() <= 2.0, "{f}");
    // lower clamp: step 1/16 -> 62.5 Hz
    let o = links(&lauf(&d, &e(1, false), SR, 70_000, schlag(GRUND / 100.0)));
    let f = spitze_hz(&o[..65_536], 48_000.0);
    assert!((f - 62.5).abs() <= 0.5, "{f}");
    // not usable pitch -> original speed
    for hz in [0.0, f32::NAN, -5.0, f32::INFINITY, f32::NEG_INFINITY] {
        let o = links(&lauf(&d, &e(1, false), SR, 1000, schlag(hz)));
        for (i, v) in o.iter().enumerate() {
            assert_eq!(v.to_bits(), d[2 * i].to_bits(), "hz {hz} sample {i}");
        }
    }
}

#[test]
fn silent_before_trigger_and_reset() {
    let d = sinus(1000.0, 48_000, 0.9);
    let o = lauf(&d, &e(1, false), SR, 2000, |_| ein(GRUND, false));
    assert!(o.iter().all(|v| *v == (0.0, 0.0)));
    let mut s = Sampler::default();
    assert!(!s.spielt());
    for i in 0..500 { s.prozess(&d, &e(1, false), SR, ein(GRUND, i == 0)); }
    assert!(s.spielt());
    s.zuruecksetzen();
    assert!(!s.spielt());
    let a: Vec<_> = (0..300).map(|i| s.prozess(&d, &e(1, false), SR, ein(GRUND, i == 5))).collect();
    let b: Vec<_> = { let mut f = Sampler::default(); (0..300).map(|i| f.prozess(&d, &e(1, false), SR, ein(GRUND, i == 5))).collect() };
    assert_eq!(a, b);
    assert!(a[..5].iter().all(|v| *v == (0.0, 0.0)));
}

#[test]
fn trigger_is_an_edge_not_a_level() {
    let d = sinus(1000.0, 48_000, 0.9);
    // trig held high from the start: one start only, same as a single pulse
    let a = lauf(&d, &e(1, false), SR, 3000, |_| ein(GRUND, true));
    let b = lauf(&d, &e(1, false), SR, 3000, schlag(GRUND));
    assert_eq!(a, b);
    // falling then rising retriggers
    let o = links(&lauf(&d, &e(1, false), SR, 3000, |i| ein(GRUND, i == 0 || (2000..2002).contains(&i))));
    assert!(o[2000 + FADE + 1].abs() > 0.0 && o[2000 + FADE + 2] != 0.0);
    // exactly 0.5 counts as high, just below does not
    let mut s = Sampler::default();
    s.prozess(&d, &e(1, false), SR, Eingabe { trig: 0.4999, ..ein(GRUND, false) });
    assert!(!s.spielt());
    s.prozess(&d, &e(1, false), SR, Eingabe { trig: 0.5, ..ein(GRUND, false) });
    assert!(s.spielt());
}

#[test]
fn stereo_sides_are_independent() {
    let d: Vec<f32> = (0..2000).flat_map(|i| [i as f32 / 4000.0, -(i as f32) / 4000.0]).collect();
    let o = lauf(&d, &e(1, false), SR, 500, schlag(GRUND));
    for (i, (l, r)) in o.iter().enumerate() {
        assert_eq!(l.to_bits(), d[2 * i].to_bits());
        assert_eq!(r.to_bits(), d[2 * i + 1].to_bits());
    }
}

#[test]
fn non_finite_selectors_read_as_zero() {
    let d = segmente(4, 1000);
    for (s, r) in [(f32::NAN, 0.0), (f32::INFINITY, 0.0), (0.0, f32::NAN)] {
        let o = lauf(&d, &e(4, false), SR, 500, |i| Eingabe { scheibe: s, rueck: r, ..ein(GRUND, i == 0) });
        assert!((o[0].0 - 0.1).abs() < 1e-6 && o.iter().all(|v| v.0.is_finite()), "{s} {r}");
    }
}

#[test]
fn loop_wrap_keeps_the_fractional_position() {
    // one slice, ramp 0..1: away from the seam the output is the analytic position / L, for any step, forward and reverse
    let l = 1000usize;
    let d = stereo(l, |i| i as f32 / l as f32);
    for step in [1.37f64, 0.61, 3.3] {
        for rueck in [0.0f32, 1.0] {
            let hz = (step * GRUND as f64) as f32;
            let step = hz as f64 / GRUND as f64;
            let o = links(&lauf(&d, &e(1, true), SR, 20_000, |i| Eingabe { rueck, ..ein(hz, i == 0) }));
            let mut geprueft = 0;
            for (n, v) in o.iter().enumerate() {
                let m = (n as f64 * step).rem_euclid(l as f64);
                let pos = if rueck == 0.0 { m } else { (l as f64 - 1.0) - m };
                if pos < 3.0 || pos > l as f64 - 4.0 { continue; }
                assert!((*v as f64 - pos / l as f64).abs() < 2e-5, "step {step} rueck {rueck} sample {n}: {v} vs {}", pos / l as f64);
                geprueft += 1;
            }
            assert!(geprueft > 15_000, "only {geprueft} samples compared");
        }
    }
}

#[test]
fn gate_that_falls_during_a_retrigger_fade_still_ends_the_new_pass() {
    let d = stereo(8000, |_| 0.5);
    let el = e(4, true);
    // the gate dips low for a few samples inside the fade-out and is high again when the new pass starts
    let f = |i: usize| Eingabe { gate: if (505..510).contains(&i) { 0.0 } else { 1.0 }, ..ein(GRUND, i == 0 || i == 500) };
    let n = laenge(&d, &el, SR, 20_000, f).expect("the new pass must end after one pass (gate low)");
    assert!(n >= 500 + FADE + 1000 && n <= 500 + FADE + 2000 + FADE, "{n}");
}

#[test]
fn reverse_threshold_is_one_half() {
    let d = stereo(4000, |i| i as f32 / 4000.0);
    let erster = |r: f32| lauf(&d, &e(1, false), SR, 3, |i| Eingabe { rueck: r, ..ein(GRUND, i == 0) })[0].0;
    assert!(erster(0.4999) < 0.01);
    assert!(erster(0.5) > 0.99);
}
