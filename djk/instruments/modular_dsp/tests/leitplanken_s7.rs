//! Sound guardrails of slice 7 (S7 task 3): the three example effect graphs do what their names say, measured on the
//! output. Release build recommended (FFTs): `cargo test --release -p baukasten_dsp --test leitplanken_s7`.
use baukasten_dsp::{uebersetze, Programm};

const SR: f32 = 48_000.0;
const PHASER: &str = include_str!("../demos/fx-phaser.json");
const FLANGER: &str = include_str!("../demos/fx-flanger.json");
const LOFI: &str = include_str!("../demos/fx-lofi-sp1200.json");

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

/// in-place radix-2 FFT
fn fft(x: &mut [(f64, f64)]) {
    let n = x.len();
    let mut j = 0;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j |= bit;
        if i < j {
            x.swap(i, j);
        }
    }
    let mut len = 2;
    while len <= n {
        let w = -2.0 * std::f64::consts::PI / len as f64;
        for s in (0..n).step_by(len) {
            for k in 0..len / 2 {
                let (c, sn) = ((w * k as f64).cos(), (w * k as f64).sin());
                let (a, b) = (x[s + k], x[s + k + len / 2]);
                let t = (b.0 * c - b.1 * sn, b.0 * sn + b.1 * c);
                x[s + k] = (a.0 + t.0, a.1 + t.1);
                x[s + k + len / 2] = (a.0 - t.0, a.1 - t.1);
            }
        }
        len <<= 1;
    }
}

/// Hann-windowed power spectrum (bins 0..n/2) of `x[..n]`
fn leistung(x: &[f32], n: usize) -> Vec<f64> {
    let mut b: Vec<(f64, f64)> = (0..n)
        .map(|i| (x[i] as f64 * (0.5 - 0.5 * (2.0 * std::f64::consts::PI * i as f64 / n as f64).cos()), 0.0))
        .collect();
    fft(&mut b);
    b[..n / 2].iter().map(|(r, i)| r * r + i * i).collect()
}

fn effekt(j: &str, regler: &[(usize, f32)], l: &[f32], r: &[f32]) -> Vec<(f32, f32)> {
    let mut p: Programm = uebersetze(j, SR).unwrap();
    for (nr, w) in regler {
        p.setze_regler(*nr, *w);
    }
    let y = (0..l.len()).map(|i| { p.setze_eingang(l[i], r[i]); p.sample_stereo() }).collect();
    assert_eq!(p.rettungen, 0);
    y
}

#[test]
fn phaser_example_notch_moves() {
    // knob 1 = 0.3673 gives rate 0.05 * 80^0.3673 = 0.25 Hz (one period in 4 s), the other knobs stay at 0.5 (fb 0, mix 0.5)
    let x = rausch(4 * 48_000, 0.3, 21);
    let y = effekt(PHASER, &[(1, 0.3673)], &x, &x);
    let yl: Vec<f32> = y.iter().map(|v| v.0).collect();
    // 1/3-octave bands 200 Hz .. 8 kHz (edges 200 * 2^(k/3 - 1/6))
    let n = 8192;
    let mitten: Vec<f64> = (0..16).map(|k| 200.0 * 2f64.powf(k as f64 / 3.0)).collect();
    let mut tiefste = Vec::new();
    for fr in 0..16 {
        let von = fr * 12_000 + 12_000 - n; // the last 8192 samples of each 0.25 s frame
        let p = leistung(&yl[von..], n);
        let pegel: Vec<f64> = mitten
            .iter()
            .map(|&c| {
                let (lo, hi) = (c * 2f64.powf(-1.0 / 6.0), c * 2f64.powf(1.0 / 6.0));
                let bins: Vec<f64> = (0..n / 2).filter(|&k| (k as f64 * SR as f64 / n as f64) >= lo && (k as f64 * SR as f64 / n as f64) < hi).map(|k| p[k]).collect();
                bins.iter().sum::<f64>() / bins.len().max(1) as f64
            })
            .collect();
        let (i, _) = pegel.iter().enumerate().fold((0, f64::MAX), |m, (i, &v)| if v < m.1 { (i, v) } else { m });
        tiefste.push(mitten[i]);
    }
    let (lo, hi) = (tiefste.iter().cloned().fold(f64::MAX, f64::min), tiefste.iter().cloned().fold(0.0, f64::max));
    println!("MESS phaser notch band centres per 0.25 s frame: {tiefste:.0?}; range {lo:.0}..{hi:.0} Hz = {:.2} octaves", (hi / lo).log2());
    assert!(hi / lo >= 2.0, "the spectral minimum moves only {:.2} octaves", (hi / lo).log2());
}

/// spectral minimum (bin frequency) of the averaged power of `y` between `von` and `bis` Hz
fn kerbe(y: &[f32], von: f64, bis: f64) -> f64 {
    let n = 8192;
    let mut sum = vec![0.0f64; n / 2];
    for f in 0..(y.len() / n) {
        for (s, v) in sum.iter_mut().zip(leistung(&y[f * n..], n)) {
            *s += v;
        }
    }
    let bin = |k: usize| k as f64 * SR as f64 / n as f64;
    let (k, _) = (0..n / 2).filter(|&k| bin(k) >= von && bin(k) <= bis).fold((0, f64::MAX), |m, k| if sum[k] < m.1 { (k, sum[k]) } else { m });
    bin(k)
}

#[test]
fn flanger_example_comb_spacing() {
    // Topology check on a constant-delay variant (no LFO, R9): the `lfo` node becomes konst -0.7647059, so the left line runs at
    // 3.6 + 3.4 * (-0.7647059) = 1 ms and the right line (inverted) at 6.2 ms, feedback knob 0. A feed-forward comb 0.5 * (x + x(t - d))
    // has its first notch at 1 / (2 d): 500 Hz left, 80.6 Hz right (+-5 %).
    let fest = FLANGER
        .replace(r#"{"id": "lfo", "art": "lfo", "form": 0}"#, r#"{"id": "lfo", "art": "konst", "wert": -0.7647059}"#)
        .replace("    {\"von\": \"rate.aus\", \"nach\": \"lfo.rate\"},\n", "");
    assert!(fest.contains("konst") && !fest.contains("lfo.rate"), "variant was not built");
    let x = rausch(8192 * 40, 0.3, 31);
    let y = effekt(&fest, &[(2, 0.0)], &x, &x);
    let (yl, yr): (Vec<f32>, Vec<f32>) = y.iter().cloned().unzip();
    let (fl, fr) = (kerbe(&yl, 250.0, 1000.0), kerbe(&yr, 50.0, 200.0));
    println!("MESS flanger comb: left first notch {fl:.1} Hz (expected 500), right {fr:.1} Hz (expected 80.6)");
    assert!((fl - 500.0).abs() <= 25.0, "left notch at {fl} Hz");
    assert!((fr - 80.6).abs() <= 4.0, "right notch at {fr} Hz");
    // negative control: the unmodified example (moving LFO, rate knob 0.5) smears the notch, so the depth of the
    // averaged minimum between 250 Hz and 1 kHz is far smaller than in the constant-delay variant
    let z = effekt(FLANGER, &[(1, 0.5), (2, 0.0)], &x, &x);
    let zl: Vec<f32> = z.iter().map(|v| v.0).collect();
    let (t_fest, t_lfo) = (kerbentiefe(&yl, 250.0, 1000.0), kerbentiefe(&zl, 250.0, 1000.0));
    println!("MESS flanger notch depth (min / mean power, 250..1000 Hz): constant delay {t_fest:.2e}, moving {t_lfo:.2e}");
    assert!(t_fest < 0.01 * t_lfo, "control: constant {t_fest:.2e} vs moving {t_lfo:.2e}");
}

/// min / mean of the averaged power between `von` and `bis` Hz
fn kerbentiefe(y: &[f32], von: f64, bis: f64) -> f64 {
    let n = 8192;
    let mut sum = vec![0.0f64; n / 2];
    for f in 0..(y.len() / n) {
        for (s, v) in sum.iter_mut().zip(leistung(&y[f * n..], n)) {
            *s += v;
        }
    }
    let k: Vec<f64> = (0..n / 2).filter(|&k| (von..=bis).contains(&(k as f64 * SR as f64 / n as f64))).map(|k| sum[k]).collect();
    k.iter().cloned().fold(f64::MAX, f64::min) / (k.iter().sum::<f64>() / k.len() as f64)
}

#[test]
fn lofi_example_bandlimited_and_crushed() {
    // the default knob position IS the SP-1200 setting (S13): bits 12 (knob 1 = 0.5 of 8..16) and rate 26040 (knob 2 = 0.5 of 14130..48000, log)
    let regler = [(1, 0.5), (2, 0.5)];
    let n = 32_768;
    let sinus: Vec<f32> = (0..96_000).map(|i| 0.5 * (2.0 * std::f32::consts::PI * 1000.0 * i as f32 / SR).sin()).collect();
    let y = effekt(LOFI, &regler, &sinus, &sinus);
    let yl: Vec<f32> = y.iter().map(|v| v.0).collect();
    let (pein, paus) = (leistung(&sinus[48_000..], n), leistung(&yl[48_000..], n));
    let ueber = |p: &[f64]| (0..n / 2).filter(|&k| k as f64 * SR as f64 / n as f64 > 13_020.0).map(|k| p[k]).sum::<f64>();
    let db = 10.0 * (ueber(&paus) / pein.iter().sum::<f64>()).log10();
    println!("MESS lofi: energy above 13.02 kHz is {db:.1} dB relative to the input sine");
    assert!(db < -45.0, "alias/image energy above 13.02 kHz only {db:.1} dB below the input"); // S13: measured -52.6 (the 2-pole 12 kHz filter before: about -36)
    // control: without the svf (krume straight to the output) the images are clearly there
    let roh = format!(
        r#"{{"format":"baukasten/2","name":"t","stimmen":1,"knoten":[{{"id":"e","art":"eingang"}},{{"id":"k","art":"krume","bits":12,"rate":26040}},{{"id":"o","art":"ausgang"}}],"kanten":[{{"von":"e.l","nach":"k.x"}},{{"von":"k.aus","nach":"o.l"}}]}}"#
    );
    let r = effekt(&roh, &[], &sinus, &sinus);
    let rl: Vec<f32> = r.iter().map(|v| v.0).collect();
    let db_roh = 10.0 * (ueber(&leistung(&rl[48_000..], n)) / pein.iter().sum::<f64>()).log10();
    println!("MESS lofi control: krume alone, energy above 13.02 kHz is {db_roh:.1} dB");
    assert!(db_roh > db + 6.0, "the control must show clearly more energy ({db_roh:.1} vs {db:.1})");
    // distinct values at the krume output (graph variant eingang -> krume -> ausgang)
    let distinkt = |bits: u32| {
        let g = roh.replace(r#""bits":12"#, &format!(r#""bits":{bits}"#));
        let s: Vec<f32> = (0..48_000).map(|i| (2.0 * std::f32::consts::PI * 1234.5 * i as f32 / SR).sin()).collect();
        let mut v: Vec<u32> = effekt(&g, &[], &s, &s).iter().map(|v| v.0.to_bits()).collect();
        v.sort();
        v.dedup();
        v.len()
    };
    let (d12, d4) = (distinkt(12), distinkt(4));
    println!("MESS lofi: distinct values per 1 s at the krume output: bits 12 -> {d12}, bits 4 -> {d4}");
    assert!(d12 <= 4097 && d12 > 1000, "bits 12: {d12}");
    assert!(d4 <= 17 && d4 >= 15, "bits 4: {d4}");
}

/// Predicted time (s) until the output of the 6-stage phaser at mix 0.5 reaches `thr` for a 1200 Hz sine, from the closed
/// form: fc(phi) = 1200 * 2^(8 phi) for phi < 0.25, stage phase -2 atan(tan(w0) / tan(pi fc / sr)), amplitude |cos(total / 2)|.
fn anstieg_soll(rate: f64, thr: f64) -> f64 {
    let t0 = (std::f64::consts::PI * 1200.0 / SR as f64).tan();
    let amp = |phi: f64| {
        let fc = 1200.0 * (8.0 * phi).exp2();
        let stufe = -2.0 * (t0 / (std::f64::consts::PI * fc / SR as f64).tan()).atan();
        (6.0 * stufe / 2.0).cos().abs()
    };
    let (mut lo, mut hi) = (0.0f64, 0.25);
    for _ in 0..60 {
        let m = 0.5 * (lo + hi);
        if amp(m) < thr { lo = m } else { hi = m }
    }
    hi / rate
}

#[test]
fn phaser_example_rate_knob_maps_to_hz() {
    // A 1200 Hz sine sits exactly in the first notch at LFO phase 0 (fc = 1200 Hz, 6 stages, mix 0.5). The time until the
    // output rises above 0.25 depends only on the sweep rate. Predicted in closed form from the documented knob law
    // rate = 0.05 * 80^knob Hz; measured on the example. Knob 2 = 0.5 (fb 0) and knob 3 = 0.5 (mix 0.5) as shipped.
    let x: Vec<f32> = (0..3 * 48_000).map(|i| (2.0 * std::f32::consts::PI * 1200.0 * i as f32 / SR).sin()).collect();
    for knob in [0.0f32, 0.5, 0.9] {
        let rate = 0.05 * 80f64.powf(knob as f64);
        let y = effekt(PHASER, &[(1, knob)], &x, &x);
        // the search starts at 150 samples (3 ms): the sine's onset transient through the all-pass chain is gone by then
        let hoch = (150..y.len()).find(|&i| y[i - 40..i].iter().fold(0.0f32, |m, v| m.max(v.0.abs())) > 0.25).expect("never rose");
        let (ist, soll) = (hoch as f64 / SR as f64, anstieg_soll(rate, 0.25));
        println!("MESS phaser rate knob {knob}: rate {rate:.3} Hz, rise time {:.2} ms measured, {:.2} ms predicted", ist * 1000.0, soll * 1000.0);
        assert!((ist / soll - 1.0).abs() < 0.15, "knob {knob}: measured {ist} s, predicted {soll} s");
    }
}

#[test]
fn flanger_example_feedback_knob_gain() {
    // constant-delay variant (see flanger_example_comb_spacing), left line 1 ms: with feedback f the gain at 1 / d = 1000 Hz
    // is 0.5 * (1 + 1 / (1 - f)); knob 2 = 1.0 gives f = 0.75 (S13: was 0.9, which overshot 0 dBFS) -> 2.5 (7.96 dB), knob 2 = 0 gives 1.0 (0 dB)
    let fest = FLANGER
        .replace(r#"{"id": "lfo", "art": "lfo", "form": 0}"#, r#"{"id": "lfo", "art": "konst", "wert": -0.7647059}"#)
        .replace("    {\"von\": \"rate.aus\", \"nach\": \"lfo.rate\"},\n", "");
    let x = rausch(8192 * 40, 0.1, 41);
    let gain_db = |knob: f32| {
        let y = effekt(&fest, &[(2, knob)], &x, &x);
        let yl: Vec<f32> = y.iter().map(|v| v.0).collect();
        let (mut py, mut px) = (0.0f64, 0.0f64);
        for f in 0..(x.len() / 8192) {
            let (a, b) = (leistung(&yl[f * 8192..], 8192), leistung(&x[f * 8192..], 8192));
            let k = (1000.0 * 8192.0 / SR as f64).round() as usize;
            for j in k - 2..=k + 2 {
                py += a[j];
                px += b[j];
            }
        }
        10.0 * (py / px).log10()
    };
    let (null, voll) = (gain_db(0.0), gain_db(1.0));
    println!("MESS flanger gain at 1000 Hz: feedback knob 0 -> {null:.2} dB, knob 1 -> {voll:.2} dB (expected 0 and 7.96)");
    assert!(null.abs() < 1.0, "{null}");
    assert!((voll - 7.96).abs() < 1.0, "{voll}");
}

#[test]
fn lofi_example_rate_and_bits_knobs() {
    // Rate: the strongest line between 20.5 and 23.5 kHz is the ZOH image of the 1 kHz sine folded at Nyquist, 48000 - (26040
    // +- 1000) = 20960 or 22960 Hz. Bits: see the error energy below.
    let regler = [(1, 0.5), (2, 0.5)];
    let n = 32_768;
    let sinus: Vec<f32> = (0..96_000).map(|i| 0.5 * (2.0 * std::f32::consts::PI * 1000.0 * i as f32 / SR).sin()).collect();
    let y = effekt(LOFI, &regler, &sinus, &sinus);
    let yl: Vec<f32> = y.iter().map(|v| v.0).collect();
    let paus = leistung(&yl[48_000..], n);
    let bin_hz = |k: usize| k as f64 * SR as f64 / n as f64;
    let (kmax, _) = (0..n / 2).filter(|&k| (20_500.0..=23_500.0).contains(&bin_hz(k))).fold((0, 0.0f64), |m, k| if paus[k] > m.1 { (k, paus[k]) } else { m });
    println!("MESS lofi image line at {:.0} Hz (expected 20960 or 22960)", bin_hz(kmax));
    assert!([20_960.0, 22_960.0].iter().any(|f| (bin_hz(kmax) - f).abs() < 40.0), "image line at {} Hz", bin_hz(kmax));
    // Bits: the saturator behind the filter makes harmonics at -26 dB for a normal level, which hide the quantization error.
    // A quiet sine (amplitude 0.003, 6 LSB at 12 bits) keeps the saturator linear: there the error energy between 2 and
    // 11 kHz, relative to the sine's energy, is the quantizer's and falls 6 dB per bit (12 bits about -28 dB, 16 bits -52 dB).
    let leise: Vec<f32> = sinus.iter().map(|v| v * 0.006).collect();
    let fehler = |knob: f32| {
        let o = effekt(LOFI, &[(1, knob), (2, 1.0)], &leise, &leise); // rate knob 1.0 = 48 kHz: no hold, the hold at 26040 Hz adds jitter noise
        let ol: Vec<f32> = o.iter().map(|v| v.0).collect();
        let p = leistung(&ol[48_000..], n);
        let e: f64 = (0..n / 2).filter(|&k| (2_000.0..=11_000.0).contains(&bin_hz(k))).map(|k| p[k]).sum();
        10.0 * (e / leistung(&leise[48_000..], n).iter().sum::<f64>()).log10()
    };
    let (b12, b16) = (fehler(0.5), fehler(1.0));
    println!("MESS lofi quantization error 2..11 kHz on a quiet sine: bits 12 -> {b12:.1} dB, bits 16 -> {b16:.1} dB");
    assert!((-34.0..=-22.0).contains(&b12), "bits 12: {b12} dB");
    assert!(b12 - b16 > 18.0 && b12 - b16 < 30.0, "16 bits should be about 24 dB lower: {b16} dB");
}

#[test]
fn lofi_example_filter_corner() {
    // S13: the post filter is no longer a fixed 12 kHz corner: its cutoff is 0.45 x the rate knob (4 poles). At rate knob 1.0
    // (48 kHz, no hold) the corner sits at 21.6 kHz, so the passband must stay flat: quiet white noise (the saturator stays
    // linear), bits knob 1.0. Expected 12 kHz band against 2.5 kHz band: only the saturator's first-order ADAA averager,
    // 20 log10(cos(pi/4) / cos(pi 2500 / 48000)) = -2.9 dB; the 4-pole Butterworth at 21.6 kHz adds -0.04 dB at 12 kHz.
    // A fixed 12 kHz 2-pole filter (the old design) would give -5.9.
    let x = rausch(8192 * 20, 0.005, 51);
    let y = effekt(LOFI, &[(1, 1.0), (2, 1.0)], &x, &x);
    let yl: Vec<f32> = y.iter().map(|v| v.0).collect();
    let band = |von: f64, bis: f64, sig: &[f32]| -> f64 {
        let mut e = 0.0;
        for f in 0..(sig.len() / 8192) {
            let p = leistung(&sig[f * 8192..], 8192);
            e += (0..4096).filter(|&k| (von..bis).contains(&(k as f64 * SR as f64 / 8192.0))).map(|k| p[k]).sum::<f64>();
        }
        e
    };
    let db = 10.0 * ((band(11_500.0, 12_500.0, &yl) / band(2_000.0, 3_000.0, &yl)) / (band(11_500.0, 12_500.0, &x) / band(2_000.0, 3_000.0, &x))).log10();
    println!("MESS lofi filter: 12 kHz band relative to 2.5 kHz band, input-normalised: {db:.2} dB (expected about -2.9)");
    assert!((-3.4..=-2.4).contains(&db), "passband {db} dB");
}

/// The old fixed filter (2 poles, 12 kHz) in place of the rate-tracking one, everything else unchanged.
fn lofi_alt() -> String {
    let alt = LOFI
        .replace("\"pole\": 4", "\"pole\": 2")
        .replace("    {\"von\": \"rate.aus\", \"nach\": \"cut.a\"},\n", "")
        .replace("    {\"von\": \"cut.aus\", \"nach\": \"fl.cutoff\"},\n", "")
        .replace("    {\"von\": \"cut.aus\", \"nach\": \"fr.cutoff\"},\n", "");
    assert!(!alt.contains("cut.a") && !alt.contains("cut.aus") && alt != LOFI, "variant was not built");
    alt
}

#[test]
fn lofi_filter_tracks_the_rate_and_removes_the_images() {
    // S13 Fehlerfall: the old fixed 12 kHz 2-pole filter left the images of the sample-and-hold nearly untouched (audit on
    // music: -4.5 dB re input above the held Nyquist). Same case, both designs: white noise (RMS 0.1, the saturator stays
    // nearly linear), energy above the held Nyquist (rate / 2) relative to the input's energy in the same band's width.
    let x = rausch(8192 * 20, 0.1, 61);
    let ueber = |g: &str, knob2: f32, ab: f64| {
        let y = effekt(g, &[(1, 1.0), (2, knob2)], &x, &x);
        let yl: Vec<f32> = y.iter().map(|v| v.0).collect();
        let band = |sig: &[f32]| -> f64 {
            (0..sig.len() / 8192).map(|f| leistung(&sig[f * 8192..], 8192)).map(|p| (0..4096).filter(|&k| k as f64 * SR as f64 / 8192.0 > ab).map(|k| p[k]).sum::<f64>()).sum()
        };
        10.0 * (band(&yl) / band(&x)).log10()
    };
    // rate knob 0.5 = 26040 Hz: held Nyquist 13.02 kHz
    let (neu, alt) = (ueber(LOFI, 0.5, 13_020.0), ueber(&lofi_alt(), 0.5, 13_020.0));
    println!("MESS lofi noise energy above 13.02 kHz re input, rate knob 0.5: tracking 4-pole {neu:.1} dB, old fixed 12 kHz 2-pole {alt:.1} dB");
    assert!(neu < alt - 3.0, "new {neu:.1} dB vs old {alt:.1} dB");
    // rate knob 0 = 14130 Hz: the old filter is far above the held Nyquist (7.07 kHz), the new corner is at 6.4 kHz
    let (neu0, alt0) = (ueber(LOFI, 0.0, 7_065.0), ueber(&lofi_alt(), 0.0, 7_065.0));
    println!("MESS lofi noise energy above 7.07 kHz re input, rate knob 0: tracking {neu0:.1} dB, fixed {alt0:.1} dB");
    assert!(neu0 < alt0 - 3.0, "rate knob 0: new {neu0:.1} dB vs old {alt0:.1} dB");
}
