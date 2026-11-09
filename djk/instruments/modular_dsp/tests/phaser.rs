//! DSP tests for `Phaser` (S7 task 2): stereo all-pass phaser, shared coefficient per channel, feedback from the last stage.
use baukasten_dsp::phaser::Phaser;

const SR: f32 = 48_000.0;

/// xorshift noise in -1..1, deterministic
fn rausch(n: usize, amp: f32, mut s: u64) -> Vec<f32> {
    (0..n)
        .map(|_| {
            s ^= s << 13;
            s ^= s >> 7;
            s ^= s << 17;
            amp * ((s >> 11) as f64 / (1u64 << 52) as f64 - 1.0) as f32
        })
        .collect()
}

fn rms(x: &[f32]) -> f64 { (x.iter().map(|&v| (v as f64).powi(2)).sum::<f64>() / x.len() as f64).sqrt() }

fn neu(stufen: usize) -> Phaser { Phaser::neu(SR, stufen, 300.0, 4800.0, 0.0) }

#[test]
fn mix_zero_is_dry_bitexact() {
    for (stufen, fb, tiefe) in [(6usize, 0.5f32, 1.0f32), (2, -0.9, 0.3), (12, 0.95, 0.0)] {
        let mut p = Phaser::neu(SR, stufen, 300.0, 4800.0, 90.0);
        let (x, y) = (rausch(10_000, 0.8, 1), rausch(10_000, 0.8, 2));
        for i in 0..x.len() {
            let (l, r) = p.prozess(x[i], y[i], 0.7, tiefe, fb, 0.0);
            assert!(l == x[i] && r == y[i], "sample {i}: {l} vs {}", x[i]);
        }
    }
}

#[test]
fn matches_beatfx_reference() {
    // Literal copy of djk/core/src/beatfx.cpp:127-140 (case PHASER) with param_ * 0.9 = 0.45 (fb), 6 stages, ein_ = 1 and
    // the effect value 0.5 * (ein + u) (not nachhall(...)). beatfx dreieck(p) = p < 0.5 ? 2p : 2 - 2p. D6's triangle equals
    // dreieck(phi + 0.25), so the reference phase starts at 0.25 where the block's LFO phase starts at 0 (R4).
    let n = 96_000;
    let x = rausch(n, 0.7, 7);
    let (rate, mut p_ref) = (0.5f64, 0.25f64);
    let (mut z, mut rueck) = ([0.0f32; 6], 0.0f32);
    let mut b = neu(6);
    let (mut worst, mut wirkung) = (0.0f32, 0.0f32);
    for i in 0..n {
        let dreieck = if p_ref < 0.5 { 2.0 * p_ref } else { 2.0 - 2.0 * p_ref };
        let fc = 300.0 * (4.0 * dreieck).exp2();
        let tn = (std::f64::consts::PI * fc / SR as f64).tan();
        let c = ((tn - 1.0) / (tn + 1.0)) as f32;
        let ein = x[i];
        let mut u = ein + 0.45 * rueck;
        for s in 0..6 {
            let y = c * u + z[s];
            z[s] = u - c * y;
            u = y;
        }
        rueck = u;
        let soll = 0.5 * (ein + u);
        p_ref += rate / SR as f64;
        if p_ref >= 1.0 {
            p_ref -= 1.0;
        }
        let (l, _) = b.prozess(x[i], 0.0, rate as f32, 1.0, 0.45, 0.5);
        worst = worst.max((l - soll).abs());
        wirkung = wirkung.max((soll - ein).abs());
        assert!((l - soll).abs() <= 1e-5, "sample {i}: block {l} reference {soll}");
    }
    println!("MESS beatfx parity: largest deviation {worst:.3e} over {n} samples (effect depth {wirkung:.3})");
    assert!(wirkung > 0.2, "the phaser changes nothing, parity would be blind ({wirkung})");
}

#[test]
fn allpass_chain_is_allpass_when_frozen() {
    // rate 0: LFO frozen at t = 0.5, fc = 1200 Hz
    let x = rausch(1 << 16, 0.5, 3);
    let mut p = neu(6);
    let y: Vec<f32> = x.iter().map(|&v| p.prozess(v, v, 0.0, 1.0, 0.0, 1.0).0).collect();
    let db = 20.0 * (rms(&y) / rms(&x)).log10();
    assert!(db.abs() <= 0.1, "level change {db} dB");
    assert!(y.iter().zip(&x).any(|(a, b)| (a - b).abs() > 0.05), "output equals input, the chain does nothing");
}

#[test]
fn notch_at_expected_frequency() {
    // rate 0, tiefe 0: fc = sqrt(300 * 4800) = 1200 Hz; two first-order stages give exactly 180 degrees at fc, mix 0.5 cancels
    let amp_bei = |hz: f32| {
        let mut p = neu(2);
        let mut m = 0.0f32;
        for i in 0..24_000 {
            let v = (2.0 * std::f32::consts::PI * hz * i as f32 / SR).sin();
            let (l, _) = p.prozess(v, v, 0.0, 0.0, 0.0, 0.5);
            if i >= 19_200 {
                m = m.max(l.abs());
            }
        }
        m
    };
    let (kerb, tief) = (amp_bei(1200.0), amp_bei(100.0));
    assert!(kerb < 0.01, "notch depth {kerb}");
    assert!(tief > 0.9, "100 Hz passes with {tief}");
}

#[test]
fn breite_90_offsets_right_lfo() {
    // 1 Hz, breite 90: R = f(phi + 0.25), so R(t) = L(t + 0.25 s). The circular correlation over one period peaks at the
    // lag tau with R[(t + tau) mod N] = L[t], i.e. tau = -0.25 s = +0.75 s (modulo the 1 s period). Both are accepted.
    let n = 48_000;
    let mut p = Phaser::neu(SR, 6, 300.0, 4800.0, 90.0);
    let (mut fl, mut fr) = (Vec::new(), Vec::new());
    for _ in 0..n {
        p.prozess(0.0, 0.0, 1.0, 1.0, 0.0, 0.5);
        let (a, b) = p.fc_lr();
        fl.push(a as f64);
        fr.push(b as f64);
    }
    // every 8th sample (the true shift of 12000 samples is a multiple of 8, resolution 0.17 ms)
    let (fl, fr): (Vec<f64>, Vec<f64>) = (fl.iter().step_by(8).copied().collect(), fr.iter().step_by(8).copied().collect());
    let m = fl.len();
    let (ml, mr) = (fl.iter().sum::<f64>() / m as f64, fr.iter().sum::<f64>() / m as f64);
    let korr = |tau: usize| (0..m).map(|t| (fl[t] - ml) * (fr[(t + tau) % m] - mr)).sum::<f64>();
    let (mut beste, mut wert) = (0usize, f64::MIN);
    for tau in 0..m {
        let c = korr(tau);
        if c > wert {
            (beste, wert) = (tau, c);
        }
    }
    let beste = beste * 8;
    let ms = (beste as f64 / SR as f64 * 1000.0 + 250.0).rem_euclid(1000.0); // 0 when tau = 0.75 s
    assert!(ms <= 1.0 || ms >= 999.0, "lag {} samples = {} s", beste, beste as f64 / SR as f64);
    assert!((fl[0] - fr[0]).abs() > 100.0, "L and R start at the same fc, test would be blind");
}

#[test]
fn fb_clamped() {
    let x = rausch(10_000, 0.5, 11);
    let (mut a, mut b) = (neu(6), neu(6));
    for i in 0..x.len() {
        let (ya, yb) = (a.prozess(x[i], x[i], 0.4, 1.0, 5.0, 0.5), b.prozess(x[i], x[i], 0.4, 1.0, 0.95, 0.5));
        assert_eq!((ya.0.to_bits(), ya.1.to_bits()), (yb.0.to_bits(), yb.1.to_bits()), "sample {i}");
    }
    let (mut a, mut b) = (neu(6), neu(6));
    for i in 0..x.len() {
        let (ya, yb) = (a.prozess(x[i], x[i], 0.4, 1.0, -5.0, 0.5), b.prozess(x[i], x[i], 0.4, 1.0, -0.95, 0.5));
        assert_eq!((ya.0.to_bits(), ya.1.to_bits()), (yb.0.to_bits(), yb.1.to_bits()), "negative, sample {i}");
    }
}

#[test]
fn stable_with_max_feedback() {
    for fb in [0.95f32, -0.95] {
        let x = rausch(480_000, 0.5 * 3f32.sqrt(), 5); // uniform noise, rms 0.5
        assert!((rms(&x) - 0.5).abs() < 0.01);
        let mut p = neu(6);
        let mut peak = 0.0f32;
        for &v in &x {
            let (l, r) = p.prozess(v, v, 0.3, 1.0, fb, 0.5);
            assert!(l.is_finite() && r.is_finite());
            peak = peak.max(l.abs()).max(r.abs());
        }
        assert!(peak < 8.0, "fb {fb}: peak {peak}");
        assert!(peak > 0.5, "output is silent, test would be blind ({peak})");
    }
}

#[test]
fn denormal_and_nan_guard() {
    let mut p = neu(6);
    let (l, r) = p.prozess(f32::NAN, f32::INFINITY, 0.3, 1.0, 0.9, 0.5);
    assert!(l.is_finite() && r.is_finite());
    for v in rausch(1000, 0.5, 9) {
        let (l, r) = p.prozess(v, v, 0.3, 1.0, 0.9, 0.5);
        assert!(l.is_finite() && r.is_finite());
    }
    assert!(p.zustand_betrag() > 0.01, "no state built up, test would be blind");
    for _ in 0..(5 * 48_000) {
        p.prozess(0.0, 0.0, 0.3, 1.0, 0.9, 0.5);
    }
    assert_eq!(p.zustand_betrag(), 0.0, "state must be flushed to exactly 0 after silence");
}

#[test]
fn reset_clears_state() {
    let mut used = Phaser::neu(SR, 6, 300.0, 4800.0, 90.0);
    for v in rausch(5000, 0.5, 4) {
        used.prozess(v, v, 0.8, 1.0, 0.7, 0.5);
    }
    used.zuruecksetzen();
    let mut fresh = Phaser::neu(SR, 6, 300.0, 4800.0, 90.0);
    for i in 0..4000 {
        let imp = if i == 0 { 1.0 } else { 0.0 };
        let (a, b) = (used.prozess(imp, imp, 0.8, 1.0, 0.7, 0.5), fresh.prozess(imp, imp, 0.8, 1.0, 0.7, 0.5));
        assert_eq!((a.0.to_bits(), a.1.to_bits()), (b.0.to_bits(), b.1.to_bits()), "sample {i}");
    }
}
