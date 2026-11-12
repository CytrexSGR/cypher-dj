//! Block `ms20` (MS-20 style filter, Korg-35 topology): measurements on synthetic signals. The filter struct is driven
//! directly (cutoff position, slope, resonance peak, self-oscillation pitch and level, stability, determinism); a few
//! tests go through the graph translation (inputs, outputs, value check, `modus`). Every `MESS` line is a measured number.
use baukasten_dsp::ms20::Ms20;
use baukasten_dsp::{uebersetze_mit_wurzel, ARTEN};

const SR: f32 = 48_000.0;

/// Amplitude (peak, via quadrature correlation over whole cycles) of the output at the end of a sine run of `f` Hz
/// with amplitude `a`, in dB relative to `a`.
fn gain_db(f: f64, fc: f32, reso: f32, antrieb: f32, a: f64, hoch: bool) -> f64 {
    let mut m = Ms20::default();
    let n_zyklen = ((f * 0.5).max(40.0)).ceil() as usize; // at least 40 cycles, or 0.5 s
    let n = (n_zyklen as f64 * SR as f64 / f) as usize;
    let (mut cs, mut sn, mut cnt) = (0.0f64, 0.0f64, 0usize);
    let sett = (SR as usize / 4).max(8_000); // settling before the measurement window
    for i in 0..(sett + n) {
        let ph = 2.0 * std::f64::consts::PI * f * i as f64 / SR as f64;
        let (t, h) = m.prozess((a * ph.sin()) as f32, fc, reso, antrieb, 0, SR);
        if i >= sett {
            let y = if hoch { h } else { t } as f64;
            cs += y * ph.cos();
            sn += y * ph.sin();
            cnt += 1;
        }
    }
    let amp = 2.0 * (cs * cs + sn * sn).sqrt() / cnt as f64;
    20.0 * (amp / a).log10()
}

/// Frequency of a signal from the zero crossings (rising, linear interpolation) over the whole run, in Hz.
fn frequenz(y: &[f32]) -> f64 {
    let mut z = Vec::new();
    for i in 1..y.len() {
        if y[i - 1] < 0.0 && y[i] >= 0.0 {
            z.push(i as f64 - 1.0 + (-(y[i - 1] as f64)) / (y[i] as f64 - y[i - 1] as f64));
        }
    }
    assert!(z.len() > 10, "too few zero crossings: {}", z.len());
    (z.len() - 1) as f64 * SR as f64 / (z[z.len() - 1] - z[0])
}

fn cent(ist: f64, soll: f64) -> f64 { 1200.0 * (ist / soll).log2() }

#[test]
fn grenzfrequenz_und_flanke_beider_ausgaenge() {
    // reso 0: H = 1/(s+1)^2, -6.02 dB at the cutoff
    for fc in [200.0f32, 1000.0, 4000.0] {
        let t = gain_db(fc as f64, fc, 0.0, 0.0, 0.01, false);
        let h = gain_db(fc as f64, fc, 0.0, 0.0, 0.01, true);
        println!("MESS ms20 fc={fc} gain at cutoff: tp {t:.2} dB, hp {h:.2} dB");
        assert!((t + 6.02).abs() < 0.3, "tp at {fc}: {t}");
        assert!((h + 6.02).abs() < 0.3, "hp at {fc}: {h}");
    }
    // slope: 12 dB/oct, measured well away from the corner (the bilinear warp bends the top, so keep the test below sr/16)
    let fc = 500.0f32;
    let (a, b) = (gain_db(4.0 * fc as f64, fc, 0.0, 0.0, 0.01, false), gain_db(8.0 * fc as f64, fc, 0.0, 0.0, 0.01, false));
    let (c, d) = (gain_db(fc as f64 / 8.0, fc, 0.0, 0.0, 0.01, true), gain_db(fc as f64 / 4.0, fc, 0.0, 0.0, 0.01, true));
    println!("MESS ms20 slope tp {:.2} dB/oct, hp {:.2} dB/oct", b - a, d - c);
    assert!((b - a + 12.0).abs() < 0.8, "tp slope {}", b - a);
    assert!((d - c - 12.0).abs() < 0.8, "hp slope {}", d - c);
    // passbands are flat with gain 1
    let (p, q) = (gain_db(20.0, 4000.0, 0.0, 0.0, 0.01, false), gain_db(15000.0, 1000.0, 0.0, 0.0, 0.01, true));
    println!("MESS ms20 passband tp(20 Hz) {p:.3} dB, hp(15 kHz) {q:.3} dB");
    assert!(p.abs() < 0.2 && q.abs() < 1.0);
}

#[test]
fn resonanzspitze_folgt_der_theorie() {
    // K = 2 reso / 0.9, peak gain at the cutoff = 1 / (2 - K) (small signal, tanh is linear)
    for reso in [0.4f32, 0.7, 0.8, 0.85] {
        let k = 2.0 * reso as f64 / 0.9;
        let soll = -20.0 * (2.0 - k).log10();
        let t = gain_db(1000.0, 1000.0, reso, 0.0, 1e-4, false);
        let h = gain_db(1000.0, 1000.0, reso, 0.0, 1e-4, true);
        println!("MESS ms20 reso {reso}: peak tp {t:.2} dB, hp {h:.2} dB, theory {soll:.2} dB");
        assert!((t - soll).abs() < 0.5, "tp reso {reso}: {t} vs {soll}");
        assert!((h - soll).abs() < 0.5, "hp reso {reso}: {h} vs {soll}");
    }
}

#[test]
fn selbstschwingung_ton_und_pegel() {
    let mut json = String::from("{");
    for (i, (fc, ausgang)) in [(110.0f32, 0), (440.0, 0), (1000.0, 1), (2500.0, 0), (6000.0, 1)].into_iter().enumerate() {
        let mut m = Ms20::default();
        let lauf = SR as usize * 3;
        let y: Vec<f32> = (0..lauf).map(|_| { let (t, h) = m.prozess(0.0, fc, 1.0, 0.0, 0, SR); if ausgang == 0 { t } else { h } }).collect();
        let ende = &y[lauf - SR as usize..];
        let f = frequenz(ende);
        let c = cent(f, fc as f64);
        let spitze = ende.iter().fold(0.0f32, |a, v| a.max(v.abs()));
        println!("MESS ms20 self-oscillation fc={fc} ({}): {f:.3} Hz, {c:+.2} cent, peak {spitze:.3}", if ausgang == 0 { "tp" } else { "hp" });
        assert!(c.abs() < 5.0, "fc {fc}: {c} cent");
        assert!(spitze > 0.2, "fc {fc}: not oscillating, peak {spitze}");
        assert!(spitze < 3.0, "fc {fc}: not bounded, peak {spitze}");
        json.push_str(&format!("{}\"osc_{fc}\":{{\"hz\":{f:.4},\"cent\":{c:.3},\"peak\":{spitze:.4}}}", if i == 0 { "" } else { "," }));
    }
    println!("JSON {json}}}");
}

#[test]
fn schwingschwelle_um_reso_0_9() {
    // below the threshold an impulse dies away, above it the oscillation stands (seeded by the tiny noise)
    let rest = |reso: f32| {
        let mut m = Ms20::default();
        let mut spitze = 0.0f32;
        for i in 0..SR as usize * 2 {
            let (t, _) = m.prozess(if i == 0 { 1.0 } else { 0.0 }, 1000.0, reso, 0.0, 1, SR);
            if i > SR as usize * 3 / 2 { spitze = spitze.max(t.abs()); }
        }
        spitze
    };
    let (unter, ueber, ueber2) = (rest(0.85), rest(0.95), rest(1.0));
    println!("MESS ms20 level after 1.5 s: reso 0.85 {unter:.2e}, 0.95 {ueber:.3}, 1.0 {ueber2:.3}");
    assert!(unter < 1e-3, "reso 0.85 still rings: {unter}");
    assert!(ueber > 0.1, "reso 0.95 does not oscillate: {ueber}");
    assert!(ueber2 > 0.1 && ueber2 < 3.0);
}

#[test]
fn bleibt_beschraenkt_bei_extremen_eingaengen_und_filter_fm() {
    let mut zufall = 0x2545_f491u32;
    let mut rausch = move || { zufall = zufall.wrapping_mul(1_664_525).wrapping_add(1_013_904_223); (zufall as i32 as f32) / 2_147_483_648.0 };
    let mut schlimmstes = 0.0f32;
    for &(reso, antrieb) in &[(1.0f32, 0.0f32), (1.0, 1.0), (0.9, 0.5), (0.7, 1.0)] {
        for modus in [0u8, 1, 2] {
            // audio-rate cutoff modulation: +-3 octaves around 1 kHz at 2 kHz and at 7.3 kHz, full-scale noise and a full-scale saw
            for fm_hz in [2000.0f64, 7300.0] {
                let mut m = Ms20::default();
                for i in 0..96_000usize {
                    let ph = 2.0 * std::f64::consts::PI * fm_hz * i as f64 / SR as f64;
                    let cutoff = (1000.0 * (3.0 * ph.sin()).exp2()) as f32;
                    let x = if i % 20_000 < 10_000 { rausch() } else { (i % 100) as f32 / 50.0 - 1.0 };
                    let (t, h) = m.prozess(x, cutoff, reso, antrieb, modus, SR);
                    assert!(t.is_finite() && h.is_finite(), "reso {reso} antrieb {antrieb} modus {modus} fm {fm_hz}: not finite at {i}");
                    schlimmstes = schlimmstes.max(t.abs()).max(h.abs());
                }
            }
        }
    }
    println!("MESS ms20 worst peak under filter FM and full-scale input (tp or hp): {schlimmstes:.2}");
    assert!(schlimmstes < 6.0, "peak {schlimmstes}");
    // extreme and non-finite values: always a finite output
    let mut m = Ms20::default();
    for x in [1e30f32, -1e30, f32::NAN, 1.0, f32::INFINITY, 0.5] {
        for (c, r, a) in [(1000.0f32, 1.0f32, 1.0f32), (f32::NAN, 0.5, 0.0), (1e9, 1e9, 1e9), (-5.0, f32::NAN, f32::NAN), (20.0, 1.0, 0.0)] {
            for _ in 0..100 {
                let (t, h) = m.prozess(x, c, r, a, 0, SR);
                assert!(t.is_finite() && h.is_finite(), "x {x} c {c} r {r} a {a}");
            }
        }
    }
}

#[test]
fn deterministisch_und_modus_aendert_den_tiefpass_nicht() {
    let eingang = |i: usize| ((i * 37 % 211) as f32 / 105.0 - 1.0) * 0.8;
    let lauf = |modus: u8| {
        let mut m = Ms20::default();
        (0..20_000).map(|i| m.prozess(eingang(i), 700.0 + (i % 5000) as f32, 0.97, 0.3, modus, SR)).collect::<Vec<_>>()
    };
    let (a, b, nur_tp, nur_hp) = (lauf(0), lauf(0), lauf(1), lauf(2));
    assert!(a.iter().zip(&b).all(|(p, q)| p.0.to_bits() == q.0.to_bits() && p.1.to_bits() == q.1.to_bits()), "two runs differ");
    assert!(a.iter().zip(&nur_tp).all(|(p, q)| p.0.to_bits() == q.0.to_bits() && q.1 == 0.0), "modus 1 changes tp or leaves hp");
    assert!(a.iter().zip(&nur_hp).all(|(p, q)| p.1.to_bits() == q.1.to_bits() && q.0 == 0.0), "modus 2 changes hp or leaves tp");
    assert!(a.iter().any(|p| p.0 != 0.0 && p.1 != 0.0));
}

#[test]
fn antrieb_saettigt_und_haelt_vollaussteuerung() {
    // reso 0: a loud low sine through the filter. Without drive linear (gain 1 in the passband), with drive the third harmonic appears
    let klirr = |antrieb: f32| {
        let mut m = Ms20::default();
        let n = 48_000;
        let (mut c1, mut s1, mut c3, mut s3) = (0.0f64, 0.0f64, 0.0f64, 0.0f64);
        for i in 0..n + 4800 {
            let ph = 2.0 * std::f64::consts::PI * 100.0 * i as f64 / SR as f64;
            let (t, _) = m.prozess((0.9 * ph.sin()) as f32, 8000.0, 0.0, antrieb, 1, SR);
            if i >= 4800 {
                c1 += t as f64 * ph.cos(); s1 += t as f64 * ph.sin();
                c3 += t as f64 * (3.0 * ph).cos(); s3 += t as f64 * (3.0 * ph).sin();
            }
        }
        ((c3 * c3 + s3 * s3).sqrt() / (c1 * c1 + s1 * s1).sqrt(), 2.0 * (c1 * c1 + s1 * s1).sqrt() / n as f64)
    };
    let (k0, p0) = klirr(0.0);
    let (k1, p1) = klirr(1.0);
    println!("MESS ms20 drive: 3rd/1st harmonic {k0:.2e} (drive 0), {k1:.3} (drive 1); fundamental {p0:.3} / {p1:.3}");
    assert!(k0 < 1e-3, "drive 0 is not linear: {k0}");
    assert!(k1 > 0.1, "drive 1 does not saturate: {k1}");
    assert!(p1 > 0.5 && p1 < 1.5, "drive 1 level {p1}");
}

fn graph(extra: &str, kanten: &str) -> String {
    format!(r#"{{"format":"baukasten/2","name":"t","stimmen":2,"knoten":[{{"id":"n","art":"note"}},{{"id":"s","art":"saege"}},{{"id":"f","art":"ms20"{extra}}},{{"id":"o","art":"ausgang"}}],"kanten":[{{"von":"n.hz","nach":"s.hz"}},{{"von":"s.aus","nach":"f.x"}}{kanten}]}}"#)
}

#[test]
fn baustein_ein_und_ausgaenge_und_wertepruefung() {
    let def = ARTEN.iter().find(|a| a.art == "ms20").expect("ms20 in ARTEN");
    assert_eq!(def.ein, &["x", "cutoff", "reso", "antrieb"]);
    assert_eq!(def.aus, &["tp", "hp"]);
    // values without edges, both outputs reach the output node
    let g = graph(r#","cutoff":900,"reso":0.6"#, r#",{"von":"f.tp","nach":"o.l"},{"von":"f.hp","nach":"o.r"}"#);
    let mut p = uebersetze_mit_wurzel(&g, SR, None).expect("translates");
    p.note_an(45, 0.8);
    let y: Vec<(f32, f32)> = (0..9_600).map(|_| p.sample_stereo()).collect();
    assert!(y.iter().any(|v| v.0.abs() > 1e-3) && y.iter().any(|v| v.1.abs() > 1e-3), "tp or hp is silent");
    assert!(y.iter().all(|v| v.0.is_finite() && v.1.is_finite()));
    // value check
    for schlecht in [r#","modus":3"#, r#","modus":0.5"#, r#","modus":-1"#] {
        let g = graph(schlecht, r#",{"von":"f.tp","nach":"o.x"}"#);
        assert!(uebersetze_mit_wurzel(&g, SR, None).is_err(), "{schlecht} accepted");
    }
    // modus 2 leaves tp silent
    let g = graph(r#","modus":2"#, r#",{"von":"f.tp","nach":"o.l"}"#);
    let mut p = uebersetze_mit_wurzel(&g, SR, None).unwrap();
    p.note_an(45, 0.8);
    assert!((0..4_800).all(|_| p.sample_stereo().0 == 0.0));
}
