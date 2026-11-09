//! Vocoder DSP (S11 task 1): band centres, unity and separation of the band-pass bank, formant tracking, follower times,
//! level make-up, sibilance path, dry mix, NaN rule, reset. Numbers are the binding ones of the S11 plan (with the review
//! corrections C1 to C9); the reviewer's Python model gives the expected values in the comments.
use baukasten_dsp::vocoder::Vocoder;

const SR: f32 = 48_000.0;

/// seeded Gaussian white noise, scaled to exactly `rms` (same recipe as the review model)
fn rauschen(n: usize, seed: u64, rms: f64) -> Vec<f32> {
    let mut s = seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1;
    let mut u = || {
        s ^= s << 13;
        s ^= s >> 7;
        s ^= s << 17;
        ((s >> 11) as f64 + 0.5) / (1u64 << 53) as f64
    };
    let mut x: Vec<f64> = Vec::with_capacity(n);
    while x.len() < n {
        let (a, b) = (u(), u());
        let r = (-2.0 * a.ln()).sqrt();
        x.push(r * (2.0 * std::f64::consts::PI * b).cos());
        x.push(r * (2.0 * std::f64::consts::PI * b).sin());
    }
    x.truncate(n);
    let m = (x.iter().map(|v| v * v).sum::<f64>() / n as f64).sqrt();
    x.iter().map(|v| (v * rms / m) as f32).collect()
}

fn sinus(f: f64, amp: f64, n: usize, sr: f32) -> Vec<f32> {
    (0..n).map(|i| (amp * (2.0 * std::f64::consts::PI * f * i as f64 / sr as f64).sin()) as f32).collect()
}

fn rms(x: &[f32]) -> f64 { (x.iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / x.len() as f64).sqrt() }
fn db(v: f64) -> f64 { 20.0 * v.max(1e-300).log10() }

/// per-band RMS of a 11-vector series from `skip` on
fn band_rms(reihe: &[[f64; 11]], skip: usize) -> [f64; 11] {
    let mut e = [0.0f64; 11];
    for z in &reihe[skip..] {
        for i in 0..11 { e[i] += z[i] * z[i]; }
    }
    for v in e.iter_mut() { *v = (*v / (reihe.len() - skip) as f64).sqrt(); }
    e
}

/// run with mono modulator `m` (l = r = m), zisch 0, mix 1; returns the output and the series of `band_signale`
fn lauf_baender(v: &mut Vocoder, c: &[f32], m: &[f32]) -> (Vec<f32>, Vec<[f64; 11]>) {
    let mut y = Vec::with_capacity(c.len());
    let mut b = Vec::with_capacity(c.len());
    for i in 0..c.len() {
        y.push(v.prozess(c[i], m[i], m[i], 0.0, 1.0));
        b.push(v.band_signale());
    }
    (y, b)
}

fn lauf(v: &mut Vocoder, c: &[f32], l: &[f32], r: &[f32], zisch: f32, mix: f32) -> Vec<f32> {
    (0..c.len()).map(|i| v.prozess(c[i], l[i], r[i], zisch, mix)).collect()
}

// 1
#[test]
fn centres() {
    let m = Vocoder::mitten();
    for i in 0..11 {
        let soll = 200.0 * 25f64.powf(i as f64 / 10.0);
        assert!((m[i] - soll).abs() < 0.01, "band {i}: {} vs {soll}", m[i]);
    }
    assert!((m[0] - 200.0).abs() < 0.01 && (m[10] - 5000.0).abs() < 0.01);
}

// 2
#[test]
fn unity_at_centre() {
    for pole in [2usize, 4] {
        let v = Vocoder::neu(SR, 5.0, 30.0, pole);
        let m = Vocoder::mitten();
        for i in 0..11 {
            let g = v.band_gain(i, m[i]);
            assert!((g - 1.0).abs() < 0.01, "pole {pole} band {i}: {g}");
        }
    }
}

// 3
#[test]
fn neighbour_separation() {
    let m = Vocoder::mitten();
    for (pole, grenze) in [(4usize, -12.0f64), (2, -6.0)] {
        let v = Vocoder::neu(SR, 5.0, 30.0, pole);
        let mut schlimmster = f64::MIN;
        for i in 0..10 {
            let d = db(v.band_gain(i, m[i + 1]));
            let d2 = db(v.band_gain(i + 1, m[i]));
            println!("MESS pole {pole} band {i} at fc_{}: {d:.2} dB, band {} at fc_{i}: {d2:.2} dB", i + 1, i + 1);
            schlimmster = schlimmster.max(d).max(d2);
        }
        println!("MESS pole {pole} worst neighbour {schlimmster:.2} dB (limit {grenze})");
        assert!(schlimmster <= grenze, "pole {pole}: {schlimmster:.2} dB");
    }
}

// C6: the analytic gain equals the measured sine response of the carrier band through `prozess`
#[test]
fn band_gain_matches_signal_path() {
    let m = Vocoder::mitten();
    for pole in [2usize, 4] {
        for i in 0..11 {
            let mut fs = vec![m[i]];
            if i < 10 { fs.push(m[i + 1]); }
            if i > 0 { fs.push(m[i - 1]); }
            for f in fs {
                let mut v = Vocoder::neu(SR, 5.0, 30.0, pole);
                let c = sinus(f, 0.5, 48_000, SR);
                let mut reihe = Vec::new();
                for k in 0..c.len() {
                    v.prozess(c[k], 0.0, 0.0, 0.0, 1.0);
                    reihe.push(v.band_traeger()[i]);
                }
                let gemessen = (reihe[24_000..].iter().map(|x| x * x).sum::<f64>() / 24_000.0).sqrt() / (0.5 / 2f64.sqrt());
                let soll = v.band_gain(i, f);
                let abw = (db(gemessen) - db(soll)).abs();
                assert!(abw < 0.05, "pole {pole} band {i} f {f:.0}: measured {:.3} dB, analytic {:.3} dB", db(gemessen), db(soll));
            }
        }
    }
}

// 4 (C1)
#[test]
fn formant_tracking() {
    for sr in [48_000.0f32, 44_100.0, 96_000.0] {
        let n = 2 * sr as usize;
        for seed in 1..=3u64 {
            let mut v = Vocoder::neu(sr, 5.0, 30.0, 4);
            let c = rauschen(n, seed, 0.3);
            let m = sinus(Vocoder::mitten()[4], 0.5, n, sr);
            let (_, b) = lauf_baender(&mut v, &c, &m);
            let e = band_rms(&b, n / 4);
            let mut kleinster = f64::MAX;
            for j in 0..11 {
                if (j as i32 - 4).abs() >= 2 { kleinster = kleinster.min(db(e[4] / e[j])); }
            }
            println!("MESS sr {sr} seed {seed}: band 4 exceeds every band >= 2 away by {kleinster:.1} dB");
            assert!(kleinster >= 20.0, "sr {sr} seed {seed}: {kleinster:.1} dB");
        }
    }
}

// 5 (C1)
#[test]
fn two_formants() {
    for seed in 1..=3u64 {
        let n = 96_000;
        let mut v = Vocoder::neu(SR, 5.0, 30.0, 4);
        let c = rauschen(n, seed, 0.3);
        let m: Vec<f32> = sinus(Vocoder::mitten()[4], 0.3, n, SR).iter().zip(sinus(Vocoder::mitten()[7], 0.3, n, SR)).map(|(a, b)| a + b).collect();
        let (_, b) = lauf_baender(&mut v, &c, &m);
        let e = band_rms(&b, n / 4);
        let mut ord: Vec<usize> = (0..11).collect();
        ord.sort_by(|a, b| e[*b].partial_cmp(&e[*a]).unwrap());
        println!("MESS two formants seed {seed}: top bands {:?}", &ord[..3]);
        let mut zwei = [ord[0], ord[1]];
        zwei.sort();
        assert_eq!(zwei, [4, 7], "seed {seed}: {:?}", &ord[..3]);
    }
}

// 6 (C5)
#[test]
fn silent_modulator() {
    let n = 96_000;
    let c = rauschen(n, 3, 0.3);
    let mut m = rauschen(n, 4, 0.3);
    for v in m[48_000..].iter_mut() { *v = 0.0; }
    let pegel = |release: f32| {
        let mut v = Vocoder::neu(SR, 5.0, release, 4);
        let y = lauf(&mut v, &c, &m, &m, 0.0, 1.0);
        db(rms(&y[72_000..96_000]))
    };
    let p = pegel(30.0);
    println!("MESS silent modulator, release 30: {p:.1} dBFS");
    assert!(p < -100.0, "{p:.1} dBFS");
    // negative control: a follower that releases slowly does not fall silent in the window (model -12 dBFS)
    let langsam = pegel(1000.0);
    println!("MESS silent modulator, release 1000: {langsam:.1} dBFS");
    assert!(langsam > -100.0, "{langsam:.1} dBFS");
}

// 7 (C4)
#[test]
fn silent_carrier_and_sibilance() {
    let n = 48_000;
    let c = vec![0.0f32; n];
    let mut v = Vocoder::neu(SR, 5.0, 30.0, 4);
    let rausch = rauschen(n, 7, 0.3);
    let y = lauf(&mut v, &c, &rausch, &rausch, 0.0, 1.0);
    let p = db(rms(&y[24_000..]));
    println!("MESS silent carrier, zisch 0: {p:.1} dBFS");
    assert!(p < -100.0, "{p:.1} dBFS");
    // zisch 1, carrier 0: only the high-passed modulator remains; 4 kHz sits 8.3 +- 1 dB below 9 kHz of equal amplitude
    let pegel = |f: f64| {
        let mut v = Vocoder::neu(SR, 5.0, 30.0, 4);
        let m = sinus(f, 0.5, n, SR);
        let y = lauf(&mut v, &c, &m, &m, 1.0, 1.0);
        db(rms(&y[24_000..]))
    };
    let (p4, p9) = (pegel(4000.0), pegel(9000.0));
    println!("MESS sibilance path: 4 kHz {p4:.2} dBFS, 9 kHz {p9:.2} dBFS, difference {:.2} dB", p9 - p4);
    assert!((p9 - p4 - 8.3).abs() <= 1.0, "difference {:.2} dB", p9 - p4);
    // The model's 8.3 dB is the 4 kHz attenuation re the input (-8.27 dB; the 9 kHz sine sits at -0.60 dB, so the literal
    // difference is 7.67 dB and is nearly blind to the filter Q: k = 1 gives 7.53). Re the input, k = 1 gives -6.36 and
    // cutoff 3 kHz gives -13.0, both outside 8.3 +- 1. The input level is known: voc = K * HP(mod).
    let in_rms = 0.5 / 2f64.sqrt();
    let k = baukasten_dsp::vocoder::AUSGLEICH_4;
    let re_eingang = p4 - db(k * in_rms);
    println!("MESS sibilance path: 4 kHz re input {re_eingang:.2} dB");
    assert!((re_eingang + 8.3).abs() <= 1.0, "4 kHz re input {re_eingang:.2} dB");
}

// 8 (C2)
#[test]
fn envelope_times() {
    for (attack, release) in [(5.0f32, 30.0f32), (2.0, 30.0)] {
        let n = (0.6 * SR) as usize;
        let (i0, i1) = ((0.05 * SR) as usize, (0.25 * SR) as usize);
        let mut m = vec![0.0f32; n];
        let burst = sinus(1000.0, 0.5, i1 - i0, SR);
        m[i0..i1].copy_from_slice(&burst);
        let mut v = Vocoder::neu(SR, attack, release, 4);
        let mut e5 = Vec::with_capacity(n);
        for k in 0..n {
            v.prozess(0.0, m[k], m[k], 0.0, 1.0);
            e5.push(v.huellen()[5]);
        }
        let ss = e5[i1 - (0.1 * SR) as usize..i1].iter().sum::<f64>() / (0.1 * SR as f64);
        let auf = e5[i0..].iter().position(|e| *e >= 0.9 * ss).unwrap() as f64 / SR as f64 * 1000.0;
        let ab = e5[i1..].iter().position(|e| *e <= 0.1 * ss).unwrap() as f64 / SR as f64 * 1000.0;
        let (g_auf, g_ab) = (4.5 * attack as f64 + 4.0, 3.0 * release as f64 + 5.0);
        println!("MESS attack {attack} release {release}: steady {ss:.4}, rise to 90 % {auf:.2} ms (limit {g_auf}), fall to 10 % {ab:.2} ms (limit {g_ab})");
        assert!(auf <= g_auf, "rise {auf:.2} ms > {g_auf}");
        assert!(ab <= g_ab, "fall {ab:.2} ms > {g_ab}");
        // sanity: the follower really follows (steady value is neither zero nor the instantaneous 0)
        assert!(ss > 0.01);
    }
}

// 9 (C3, C9)
/// output level re 0.3 in dB for noise carrier and noise modulator of the given RMS
fn makeup_abw(sr: f32, pole: usize, s: u64, rms_ein: f64) -> f64 {
    let n = 2 * sr as usize;
    let mut v = Vocoder::neu(sr, 5.0, 30.0, pole);
    let c = rauschen(n, 1000 + s, rms_ein);
    let m = rauschen(n, 5000 + s, rms_ein);
    let y = lauf(&mut v, &c, &m, &m, 0.0, 1.0);
    db(rms(&y[n / 4..]) / 0.3)
}

#[test]
fn level_makeup() {
    for (sr, seeds) in [(48_000.0f32, 101..=108u64), (44_100.0, 101..=103)] {
        for pole in [2usize, 4] {
            for s in seeds.clone() {
                let abw = makeup_abw(sr, pole, s, 0.3);
                println!("MESS makeup sr {sr} pole {pole} seed {s}: {abw:+.2} dB");
                assert!(abw.abs() <= 1.0, "sr {sr} pole {pole} seed {s}: {abw:+.2} dB");
            }
        }
    }
}

/// C9 "K independent of sr": white noise of a fixed RMS has a power density that falls with the sample rate, and the output
/// level is carrier-band times envelope, so it falls with it (measured at 96 kHz: -5.1 dB, predicted -6 dB, see
/// `level_makeup_fixed_rms_96k_as_written`). K is independent of sr when the stimulus has the same density: RMS 0.3 * sqrt(sr / 48 kHz).
#[test]
fn level_makeup_equal_density() {
    for sr in [44_100.0f32, 96_000.0] {
        for pole in [2usize, 4] {
            for s in 101..=103u64 {
                let abw = makeup_abw(sr, pole, s, 0.3 * (sr as f64 / 48_000.0).sqrt());
                println!("MESS makeup equal density sr {sr} pole {pole} seed {s}: {abw:+.2} dB");
                assert!(abw.abs() <= 1.0, "sr {sr} pole {pole} seed {s}: {abw:+.2} dB");
            }
        }
    }
}

/// The plan's wording taken literally (RMS 0.3 at 96 kHz, +-1 dB): does NOT hold, by the density argument above. Kept as an
/// ignored test so the evidence reproduces: `cargo test --release level_makeup_fixed_rms_96k -- --ignored`.
#[test]
#[ignore]
fn level_makeup_fixed_rms_96k_as_written() {
    let abw = makeup_abw(96_000.0, 4, 101, 0.3);
    println!("MESS makeup fixed RMS 0.3, sr 96000, pole 4: {abw:+.2} dB");
    assert!(abw.abs() <= 1.0, "{abw:+.2} dB");
}

/// derives AUSGLEICH_2 / AUSGLEICH_4 (C3): `cargo test --release derive_makeup -- --ignored --nocapture`
#[test]
#[ignore]
fn derive_makeup() {
    for pole in [2usize, 4] {
        let n = 96_000;
        let mut summe = 0.0f64;
        for s in 0..32u64 {
            let mut v = Vocoder::neu_mit_ausgleich(SR, 5.0, 30.0, pole, 1.0);
            let c = rauschen(n, 1000 + s, 0.3);
            let m = rauschen(n, 5000 + s, 0.3);
            let y = lauf(&mut v, &c, &m, &m, 0.0, 1.0);
            summe += rms(&y[24_000..]);
        }
        let k = 0.3 / (summe / 32.0);
        println!("DERIVED AUSGLEICH_{pole} = {k:.6} -> {:.3e} (3 significant digits)", k);
    }
}

// 10, C9
#[test]
fn mix_dry() {
    let n = 4800;
    let (c, l, r) = (rauschen(n, 1, 0.3), rauschen(n, 2, 0.4), rauschen(n, 3, 0.2));
    let mut v = Vocoder::neu(SR, 5.0, 30.0, 4);
    let y = lauf(&mut v, &c, &l, &r, 0.7, 0.0);
    for i in 0..n {
        let soll = ((l[i] as f64 + r[i] as f64) * 0.5) as f32;
        assert_eq!(y[i].to_bits(), soll.to_bits(), "sample {i}");
    }
}

#[test]
fn mix_half() {
    let n = 9600;
    let (c, l, r) = (rauschen(n, 1, 0.3), rauschen(n, 2, 0.4), rauschen(n, 3, 0.2));
    let voll = lauf(&mut Vocoder::neu(SR, 5.0, 30.0, 4), &c, &l, &r, 0.4, 1.0);
    let halb = lauf(&mut Vocoder::neu(SR, 5.0, 30.0, 4), &c, &l, &r, 0.4, 0.5);
    for i in 0..n {
        let soll = 0.5 * voll[i] as f64 + 0.5 * ((l[i] as f64 + r[i] as f64) * 0.5);
        assert!((halb[i] as f64 - soll).abs() < 1e-6, "sample {i}: {} vs {soll}", halb[i]);
    }
    assert!(rms(&voll) > 0.05, "the wet path must be audible for the test to see anything");
}

#[test]
fn mod_is_mean() {
    let n = 9600;
    let (c, l, r) = (rauschen(n, 1, 0.3), rauschen(n, 2, 0.4), rauschen(n, 3, 0.2));
    let mitte: Vec<f32> = (0..n).map(|i| ((l[i] as f64 + r[i] as f64) * 0.5) as f32).collect();
    for (zisch, mix) in [(0.3f32, 0.6f32), (1.0, 1.0)] {
        let a = lauf(&mut Vocoder::neu(SR, 5.0, 30.0, 4), &c, &l, &r, zisch, mix);
        let b = lauf(&mut Vocoder::neu(SR, 5.0, 30.0, 4), &c, &mitte, &mitte, zisch, mix);
        let d = a.iter().zip(&b).map(|(x, y)| (x - y).abs()).fold(0.0f32, f32::max);
        assert!(d < 1e-5, "zisch {zisch} mix {mix}: max difference {d}");
    }
    // l alone is not the modulator
    let a = lauf(&mut Vocoder::neu(SR, 5.0, 30.0, 4), &c, &l, &vec![0.0; n], 0.3, 1.0);
    let b = lauf(&mut Vocoder::neu(SR, 5.0, 30.0, 4), &c, &l, &l, 0.3, 1.0);
    let d = a.iter().zip(&b).map(|(x, y)| (x - y).abs()).fold(0.0f32, f32::max);
    assert!(d > 1e-3, "the right channel must count: {d}");
}

// 11 (C8)
#[test]
fn nan_guards() {
    let n = 1010 + 48_000 + 2000;
    let (c0, l0, r0) = (rauschen(n, 2, 0.3), rauschen(n, 3, 0.3), rauschen(n, 4, 0.3));
    let frisch = {
        let mut v = Vocoder::neu(SR, 5.0, 30.0, 4);
        lauf(&mut v, &c0[1010..], &l0[1010..], &r0[1010..], 0.3, 1.0)
    };
    for bad in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
        for kanal in 0..3 {
            let (mut c, mut l, mut r) = (c0.clone(), l0.clone(), r0.clone());
            for i in 1000..1010 {
                match kanal { 0 => c[i] = bad, 1 => l[i] = bad, _ => r[i] = bad }
            }
            let mut v = Vocoder::neu(SR, 5.0, 30.0, 4);
            let y = lauf(&mut v, &c, &l, &r, 0.3, 1.0);
            assert!(y.iter().all(|x| x.is_finite()), "{bad} on channel {kanal}: non-finite output");
            let d = (1010 + 48_000..n).map(|i| (y[i] - frisch[i - 1010]).abs()).fold(0.0f32, f32::max);
            assert!(d <= 1e-6, "{bad} on channel {kanal}: differs from a fresh instance by {d:e} after 1 s");
        }
    }
    // zisch / mix non-finite: the defaults (0.3 and 1)
    let m = rauschen(9600, 9, 0.3);
    let c = rauschen(9600, 8, 0.3);
    let soll = lauf(&mut Vocoder::neu(SR, 5.0, 30.0, 4), &c, &m, &m, 0.3, 1.0);
    for bad in [f32::NAN, f32::INFINITY] {
        let a = lauf(&mut Vocoder::neu(SR, 5.0, 30.0, 4), &c, &m, &m, bad, bad);
        assert!(a.iter().zip(&soll).all(|(x, y)| x.to_bits() == y.to_bits()), "{bad} on zisch/mix must read the defaults");
    }
    assert!(rms(&soll) > 0.05);
}

// 12 (C9)
#[test]
fn reset() {
    let n = 48_000;
    let mut v = Vocoder::neu(SR, 5.0, 30.0, 4);
    let (c, l, r) = (rauschen(n, 11, 0.3), rauschen(n, 12, 0.3), rauschen(n, 13, 0.3));
    lauf(&mut v, &c, &l, &r, 0.5, 1.0);
    v.zuruecksetzen();
    let mut imp = vec![0.0f32; 3000];
    imp[0] = 1.0;
    let a = lauf(&mut v, &imp, &imp, &imp, 0.5, 1.0);
    let b = lauf(&mut Vocoder::neu(SR, 5.0, 30.0, 4), &imp, &imp, &imp, 0.5, 1.0);
    assert!(a.iter().zip(&b).all(|(x, y)| x.to_bits() == y.to_bits()));
    assert!(b.iter().any(|x| x.abs() > 1e-4), "the impulse must excite the instance");
}
