//! Band-limited hard sync (`hart`): ports and rules, the master's announcement, bit identity while no reset happens, the
//! exact sub-sample reset position, aliasing of a sync sweep, robustness. Everything goes through the public JSON API.
//! Every key check has a mutation that turns it red (`mutation_hartsync.py`, results in `BERICHT-hartsync.md`).
use baukasten_dsp::{uebersetze, Fehler, Programm, ARTEN};
use realfft::RealFftPlanner;

const SR: f32 = 48_000.0;

fn graph(stimmen: usize, knoten: &str, kanten: &str) -> String {
    format!(r#"{{"format":"baukasten/2","name":"hart","stimmen":{stimmen},"knoten":[{{"id":"o","art":"ausgang"}}{knoten}],"kanten":[{kanten}]}}"#)
}

fn lade(g: &str) -> Programm { uebersetze(g, SR).unwrap_or_else(|e| panic!("{e}: {g}")) }

fn lauf(p: &mut Programm, n: usize) -> Vec<(f32, f32)> { (0..n).map(|_| p.sample_stereo()).collect() }

// ---------------------------------------------------------------------------------------------------------------------
// Ports and rules

#[test]
fn hart_ist_angehaengt_und_die_alten_ports_bleiben() {
    let def = |a: &str| ARTEN.iter().find(|d| d.art == a).unwrap();
    assert_eq!(def("saege").ein, &["hz", "sync", "hart"]);
    assert_eq!(def("puls").ein, &["hz", "pwm", "sync", "hart"]);
    assert_eq!(def("dreieck").ein, &["hz", "sync", "hart"]);
    assert_eq!(def("sinus").ein, &["hz", "fm", "sync"], "the sine is a master only");
    for a in ["saege", "puls", "dreieck", "sinus"] {
        assert_eq!(def(a).aus, &["aus", "zyklus", "hart"], "{a}");
        assert!(def(a).werte.is_empty() && def(a).frei.is_empty(), "{a}: no new value");
    }
    // no new type number: the oscillators keep 3..6 and the list did not grow for this slice
    assert_eq!(ARTEN[3].art, "saege");
    assert_eq!(ARTEN[6].art, "sinus");
    assert!(!ARTEN.iter().any(|a| a.art.contains("hart")), "hard sync is not a new type");
}

#[test]
fn hart_nimmt_nur_kanten_und_schliesst_sync_aus() {
    let m = r#",{"id":"m","art":"saege","hz":220},{"id":"s","art":"saege","hz":500}"#;
    let ok = graph(1, m, r#"{"von":"m.hart","nach":"s.hart"},{"von":"s.aus","nach":"o.x"}"#);
    assert!(uebersetze(&ok, SR).is_ok());
    let fest = graph(1, r#",{"id":"s","art":"saege","hz":500,"hart":1.5}"#, r#"{"von":"s.aus","nach":"o.x"}"#);
    assert!(matches!(uebersetze(&fest, SR), Err(Fehler::Wert { ref wert, .. }) if wert == "hart"), "{:?}", uebersetze(&fest, SR).err());
    let beide = graph(1, m, r#"{"von":"m.hart","nach":"s.hart"},{"von":"m.zyklus","nach":"s.sync"},{"von":"s.aus","nach":"o.x"}"#);
    assert!(matches!(uebersetze(&beide, SR), Err(Fehler::Wert { ref wert, .. }) if wert == "hart"));
    let sinus_folger = graph(1, r#",{"id":"m","art":"saege","hz":220},{"id":"s","art":"sinus","hz":500}"#, r#"{"von":"m.hart","nach":"s.hart"},{"von":"s.aus","nach":"o.x"}"#);
    assert!(matches!(uebersetze(&sinus_folger, SR), Err(Fehler::UnbekannterPort(_))));
}

// ---------------------------------------------------------------------------------------------------------------------
// The master's announcement

#[test]
fn hart_kuendigt_den_umlauf_ein_sample_vor_zyklus_an() {
    // l = hart, r = zyklus of the same master. hart(n) = 1 + τ  <=>  zyklus(n + 1) = 1 + (1 − τ): the same wrap, once ahead
    // and once behind. Saw, pulse, triangle and sine share the phase, so all four must announce identically.
    let mut alle = Vec::new();
    for art in ["saege", "puls", "dreieck", "sinus"] {
        let mut p = lade(&graph(1, &format!(r#",{{"id":"m","art":"{art}","hz":1234.567}}"#), r#"{"von":"m.hart","nach":"o.l"},{"von":"m.zyklus","nach":"o.r"}"#));
        let x = lauf(&mut p, 48_000);
        let mut n_wraps = 0;
        let mut schlimmst = 0.0f32;
        for i in 0..x.len() - 1 {
            let (h, z) = (x[i].0, x[i + 1].1);
            assert_eq!(h >= 1.0, z >= 1.0, "{art} sample {i}: hart {h}, zyklus after {z}");
            if h >= 1.0 {
                n_wraps += 1;
                assert!(h > 1.0 && h <= 2.0, "{art}: hart {h} outside (1, 2]");
                schlimmst = schlimmst.max(((h - 1.0) - (1.0 - (z - 1.0))).abs());
            }
        }
        println!("MESS {art} announcement: {n_wraps} wraps, largest |τ_hart − (1 − d_zyklus)| {schlimmst:.2e} samples");
        assert!((1233..=1235).contains(&n_wraps), "{art}: {n_wraps} wraps in 1 s");
        assert!(schlimmst < 1e-5, "{art}: announcement and zyklus disagree by {schlimmst} samples");
        alle.push(x.iter().map(|v| v.0).collect::<Vec<f32>>());
    }
    assert!(alle.iter().all(|a| *a == alle[0]), "the four oscillators announce differently");
}

// ---------------------------------------------------------------------------------------------------------------------
// Bit identity while no reset happens (the fingerprints of all old graphs are in `hartsync_bitgleich.rs`)

#[test]
fn ohne_umlauf_des_leiters_bitgleich_wie_ohne_kante() {
    // the master stands (hz 0), so it never announces a reset: a slave with a hart edge must play bit for bit like the
    // same slave without the edge, with pitch from notes and pwm moving
    for (art, extra) in [("saege", ""), ("puls", r#",{"von":"lfo.aus","nach":"s.pwm"}"#), ("dreieck", "")] {
        let k = format!(r#",{{"id":"n","art":"note"}},{{"id":"lfo","art":"lfo","rate":2.3}},{{"id":"m","art":"saege","hz":0}},{{"id":"s","art":"{art}"}}"#);
        let mit = graph(3, &k, &format!(r#"{{"von":"n.hz","nach":"s.hz"}},{{"von":"m.hart","nach":"s.hart"}},{{"von":"s.aus","nach":"o.x"}},{{"von":"s.zyklus","nach":"o.l"}},{{"von":"s.hart","nach":"o.r"}}{extra}"#));
        let ohne = graph(3, &k, &format!(r#"{{"von":"n.hz","nach":"s.hz"}},{{"von":"s.aus","nach":"o.x"}},{{"von":"s.zyklus","nach":"o.l"}},{{"von":"s.hart","nach":"o.r"}}{extra}"#));
        let spiele = |g: &str| {
            let mut p = lade(g);
            let mut x = Vec::new();
            for n in [40u8, 76, 100, 112] {
                p.note_an(n, 1.0);
                x.extend(lauf(&mut p, 6_000));
            }
            x
        };
        let (a, b) = (spiele(&mit), spiele(&ohne));
        let abweichend = a.iter().zip(&b).filter(|(x, y)| x.0.to_bits() != y.0.to_bits() || x.1.to_bits() != y.1.to_bits()).count();
        assert_eq!(abweichend, 0, "{art}: {abweichend} samples differ with a quiet hart edge");
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Exact sub-sample reset position

/// Master saw at `fm`, slave saw at `fs` with hard sync. Returns (largest error, number of resets checked) between the
/// master's wrap time and the slave's reset time, both read back from the OUTPUT samples: a saw sample further than one
/// sample from any jump carries no correction, so its phase is (y + 1) / 2 and the jump time follows from the phase step.
fn rueckgesetzt_an_der_stelle(fm: f64, fs_von: f64, fs_bis: f64) -> (f64, usize) {
    let g = graph(1, &format!(r#",{{"id":"m","art":"saege","hz":{fm}}},{{"id":"k","art":"regler","nr":1,"min":{fs_von},"max":{fs_bis},"log":1}},{{"id":"s","art":"saege"}}"#),
                  r#"{"von":"k.aus","nach":"s.hz"},{"von":"m.hart","nach":"s.hart"},{"von":"m.aus","nach":"o.l"},{"von":"s.aus","nach":"o.r"}"#);
    let mut p = lade(&g);
    let n = 96_000;
    let mut x = Vec::with_capacity(n);
    let mut fs = Vec::with_capacity(n);
    for i in 0..n {
        let k = i as f32 / n as f32;
        p.setze_regler(1, k);
        fs.push((fs_von * (fs_bis / fs_von).powf(k as f64)) as f32);
        x.push(p.sample_stereo());
    }
    let inc_m = (fm as f32 / SR) as f64;
    let (mut schlimmst, mut geprueft) = (0.0f64, 0usize);
    for i in 3..n - 3 {
        // the master's jump lies in (i, i + 1] when the drop from i to i + 1 is the big one (PolyBLEP spreads the drop of 2
        // over three steps; the middle one is always at least 1, the outer ones at most 1). Its sample i − 1 is clean.
        if !(x[i].0 - x[i + 1].0 > 1.0) {
            continue;
        }
        let pm0 = (x[i - 1].0 as f64 + 1.0) / 2.0;
        let t_master = (i - 1) as f64 + (1.0 - pm0) / inc_m;
        // slave: the sample i + 2 is more than one sample after the reset (which lies in (i, i + 1])
        let inc_s = (fs[i] / SR) as f64;
        let inc_s2 = (fs[i + 1] / SR) as f64;
        let ps = (x[i + 2].1 as f64 + 1.0) / 2.0;
        // phase at i + 2 = (i + 1 − t)·inc_s(i) + inc_s(i + 1): the step of sample i covers the reset, i + 1 the rest
        let t_folger = (i + 1) as f64 - (ps - inc_s2) / inc_s;
        if ps + inc_s2 >= 1.0 || ps < inc_s2 {
            continue; // the slave's own wrap sits next to sample i + 2
        }
        schlimmst = schlimmst.max((t_folger - t_master).abs());
        geprueft += 1;
    }
    (schlimmst, geprueft)
}

/// Largest allowed distance between the master's wrap and the slave's reset, in samples. f32 phases near 1 resolve
/// 6e-8 of a period; divided by a phase step of 0.009 that is 7e-6 samples. Stated bound 1e-4 samples.
const STELLE_GRENZE: f64 = 1e-4;

#[test]
fn ruecksetzen_an_der_genauen_unterabtast_stelle() {
    for (fm, von, bis) in [(441.3, 450.0, 2_000.0), (97.1, 120.0, 430.0), (1_501.7, 1_600.0, 4_300.0)] {
        let (e, n) = rueckgesetzt_an_der_stelle(fm, von, bis);
        println!("MESS reset position master {fm} Hz, slave {von}..{bis} Hz: {n} resets, largest error {e:.2e} samples");
        assert!(n > fm as usize, "only {n} resets checked");
        assert!(e < STELLE_GRENZE, "reset {e} samples away from the master's wrap, limit {STELLE_GRENZE}");
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Aliasing of a sync sweep

/// FFT frame of the alias measurement (0.68 s at 48 kHz), hop half a frame, 4-term Blackman-Harris window (sidelobes
/// -92 dB, main lobe +-4 bins).
const N_FFT: usize = 32_768;
/// Bins next to a harmonic that count as harmonic (+-17.6 Hz): main lobe plus the slow change of the waveform in a sweep.
const NEBEN: usize = 12;

/// Master frequency near `ungefaehr` with sr / f0 = n + 0.382: the first three folds of every harmonic land 0.382, 0.236
/// and 0.146 of f0 away from the nearest harmonic, never on one.
fn leiter_hz(ungefaehr: f64) -> f64 { SR as f64 / ((SR as f64 / ungefaehr).floor() + 0.382) }

/// Per frame: energy below `bis` Hz outside the bins next to multiples of f0 (DC counts as harmonic 0), over the total
/// energy of the frame; in dB. Returns the worst frame.
fn alias_db(x: &[f32], f0: f64, bis: f64) -> f64 {
    let fenster: Vec<f64> = (0..N_FFT).map(|i| {
        let a = 2.0 * std::f64::consts::PI * i as f64 / N_FFT as f64;
        0.35875 - 0.48829 * a.cos() + 0.14128 * (2.0 * a).cos() - 0.01168 * (3.0 * a).cos()
    }).collect();
    let mut fft = RealFftPlanner::<f64>::new();
    let r2c = fft.plan_fft_forward(N_FFT);
    let mut spek = r2c.make_output_vec();
    let bin_hz = SR as f64 / N_FFT as f64;
    let mut schlimmst = f64::NEG_INFINITY;
    let mut start = 0;
    while start + N_FFT <= x.len() {
        let mut rahmen: Vec<f64> = (0..N_FFT).map(|i| x[start + i] as f64 * fenster[i]).collect();
        r2c.process(&mut rahmen, &mut spek).unwrap();
        let (mut alias, mut summe) = (0.0f64, 0.0f64);
        for (b, c) in spek.iter().enumerate() {
            let e = c.norm_sqr();
            summe += e;
            let f = b as f64 * bin_hz;
            if f <= bis && (f - (f / f0).round() * f0).abs() > NEBEN as f64 * bin_hz {
                alias += e;
            }
        }
        schlimmst = schlimmst.max(10.0 * (alias / summe).max(1e-30).log10());
        start += N_FFT / 2;
    }
    schlimmst
}

/// Sync edge of a slave `s` from a master `m`: "hart" (band-limited) or "sync" (the old input on zyklus).
fn sync_kante(weise: &str) -> &'static str {
    match weise {
        "hart" => r#"{"von":"m.hart","nach":"s.hart"}"#,
        _ => r#"{"von":"m.zyklus","nach":"s.sync"}"#,
    }
}

/// The slave `art` (with `extra` values) swept exponentially and continuously from 1x to 8x the master over `sekunden`.
fn sync_fahrt(f0: f64, art: &str, extra: &str, weise: &str, sekunden: f64) -> Vec<f32> {
    let g = graph(1, &format!(r#",{{"id":"m","art":"saege","hz":{f0}}},{{"id":"k","art":"regler","nr":1,"min":{f0},"max":{},"log":1}},{{"id":"s","art":"{art}"{extra}}}"#, 8.0 * f0),
                  &format!(r#"{{"von":"k.aus","nach":"s.hz"}},{},{{"von":"s.aus","nach":"o.x"}}"#, sync_kante(weise)));
    let mut p = lade(&g);
    let n = (sekunden * SR as f64) as usize;
    (0..n).map(|i| {
        p.setze_regler(1, i as f32 / n as f32);
        p.sample()
    }).collect()
}

/// The same sweep without any band limit (saw slave, phases in f64): how much a naive sync aliases.
fn naiv_fahrt(f0: f64, sekunden: f64) -> Vec<f32> {
    let n = (sekunden * SR as f64) as usize;
    let inc_m = f0 / SR as f64;
    let (mut pm, mut ps) = (0.0f64, 0.0f64);
    (0..n).map(|i| {
        let inc_s = inc_m * 8f64.powf(i as f64 / n as f64);
        let y = 2.0 * ps - 1.0;
        pm += inc_m;
        ps += inc_s;
        if pm >= 1.0 {
            pm -= 1.0;
            ps = pm / inc_m * inc_s;
        }
        ps -= ps.floor();
        y as f32
    }).collect()
}

/// Band of the sweep bounds: aliases that fold below 5 kHz are the audible, inharmonic "birdies" of a sync sweep. The
/// full band is printed as well; there the two-point PolyBLEP of the oscillator itself sets the floor (report).
const BAND_HZ: f64 = 5_000.0;

/// The slave at fixed ratios: a sweep 1x .. 8x in 1/24-octave steps (73 ratios), each settled for 2000 samples and then
/// measured over one frame. Returns the worst ratio for (below 5 kHz, full band) as (dB, ratio).
fn stufen_fahrt(f0: f64, art: &str, extra: &str, weise: &str) -> ((f64, f64), (f64, f64)) {
    let g = graph(1, &format!(r#",{{"id":"m","art":"saege","hz":{f0}}},{{"id":"k","art":"regler","nr":1,"min":{f0},"max":{},"log":1}},{{"id":"s","art":"{art}"{extra}}}"#, 8.0 * f0),
                  &format!(r#"{{"von":"k.aus","nach":"s.hz"}},{},{{"von":"s.aus","nach":"o.x"}}"#, sync_kante(weise)));
    let mut p = lade(&g);
    let (mut band, mut voll) = ((f64::NEG_INFINITY, 0.0), (f64::NEG_INFINITY, 0.0));
    for q in 0..=72 {
        p.setze_regler(1, q as f32 / 72.0);
        lauf(&mut p, 2_000);
        let x: Vec<f32> = lauf(&mut p, N_FFT).iter().map(|v| v.0).collect();
        let ratio = 2f64.powf(q as f64 / 24.0);
        let (b, v) = (alias_db(&x, f0, BAND_HZ), alias_db(&x, f0, 24_000.0));
        if b > band.0 {
            band = (b, ratio);
        }
        if v > voll.0 {
            voll = (v, ratio);
        }
    }
    (band, voll)
}

/// Stated bounds of the stepped sync sweep, worst ratio, alias energy below 5 kHz over the total (dB). A master at
/// 1.75 kHz drives the slave up to 14 kHz, so more of its harmonics fold.
fn stufen_grenze(art: &str, f0_ungefaehr: f64) -> f64 {
    match (art, f0_ungefaehr < 1000.0) {
        ("dreieck", true) => -70.0,
        ("dreieck", false) => -62.0,
        (_, true) => -58.0,
        (_, false) => -50.0,
    }
}

#[test]
fn sync_fahrt_in_stufen_aliasing_unter_der_grenze() {
    let mut fehler = Vec::new();
    for f0u in [110.0, 440.0, 1760.0] {
        let f0 = leiter_hz(f0u);
        for (art, extra) in [("saege", ""), ("puls", r#","pwm":-0.6"#), ("dreieck", "")] {
            let (hb, hv) = stufen_fahrt(f0, art, extra, "hart");
            let (ab, av) = stufen_fahrt(f0, art, extra, "sync");
            let g = stufen_grenze(art, f0u);
            println!("MESS steps {art:7} master {f0:7.2} Hz, below 5 kHz: hart {:6.1} dB (ratio {:.2}), old sync {:6.1} (ratio {:.2}), limit {g} | full band: hart {:6.1} (ratio {:.2}), old {:6.1}",
                     hb.0, hb.1, ab.0, ab.1, hv.0, hv.1, av.0);
            if hb.0 > g {
                fehler.push(format!("{art} at {f0:.1} Hz: {:.1} dB at ratio {:.2} above {g}", hb.0, hb.1));
            }
            if hb.0 > ab.0 - 10.0 {
                fehler.push(format!("{art} at {f0:.1} Hz: {:.1} dB is not 10 dB below the old sync ({:.1})", hb.0, ab.0));
            }
        }
    }
    assert!(fehler.is_empty(), "{}", fehler.join("\n"));
}

/// The continuous sweep: 16 s, so that a harmonic below 5 kHz moves by little more than the +-17.6 Hz of `NEBEN` while
/// the sync jumps travel. The waveform still changes within a frame, which smears the lines (a floor of the measurement,
/// not of the oscillator), so the bound is looser than for the steps.
const FAHRT_SEKUNDEN: f64 = 16.0;

fn fahrt_grenze(art: &str) -> f64 {
    match art {
        "dreieck" => -60.0,
        _ => -48.0,
    }
}

#[test]
fn sync_fahrt_aliasing_unter_der_grenze() {
    let mut fehler = Vec::new();
    for f0u in [110.0, 440.0, 1760.0] {
        let f0 = leiter_hz(f0u);
        let naiv = naiv_fahrt(f0, FAHRT_SEKUNDEN);
        let (n5, nv) = (alias_db(&naiv, f0, BAND_HZ), alias_db(&naiv, f0, 24_000.0));
        for (art, extra) in [("saege", ""), ("puls", r#","pwm":-0.6"#), ("dreieck", "")] {
            let neu = sync_fahrt(f0, art, extra, "hart", FAHRT_SEKUNDEN);
            let alt = sync_fahrt(f0, art, extra, "sync", FAHRT_SEKUNDEN);
            let (h5, a5) = (alias_db(&neu, f0, BAND_HZ), alias_db(&alt, f0, BAND_HZ));
            let (hv, av) = (alias_db(&neu, f0, 24_000.0), alias_db(&alt, f0, 24_000.0));
            let g = fahrt_grenze(art);
            println!("MESS sweep {art:7} master {f0:7.2} Hz, below 5 kHz: hart {h5:6.1} dB, old sync {a5:6.1}, naive saw {n5:6.1} (limit {g}) | full band: hart {hv:6.1}, old {av:6.1}, naive {nv:6.1}");
            if h5 > g {
                fehler.push(format!("{art} at {f0:.1} Hz: {h5:.1} dB above {g}"));
            }
            if h5 > a5 - 10.0 {
                fehler.push(format!("{art} at {f0:.1} Hz: {h5:.1} dB is not 10 dB below the old sync ({a5:.1})"));
            }
        }
    }
    assert!(fehler.is_empty(), "{}", fehler.join("\n"));
}

#[test]
fn schmaler_puls_kreuzt_die_flanke_nach_dem_ruecksetzen() {
    // pwm -1 = 5 % duty: right after a reset the phase can pass the falling edge within the same sample; that edge
    // needs its own correction in the interval of the reset
    let f0 = leiter_hz(1760.0);
    let neu = alias_db(&sync_fahrt(f0, "puls", r#","pwm":-1"#, "hart", FAHRT_SEKUNDEN), f0, BAND_HZ);
    let alt = alias_db(&sync_fahrt(f0, "puls", r#","pwm":-1"#, "sync", FAHRT_SEKUNDEN), f0, BAND_HZ);
    println!("MESS narrow pulse sweep master {f0:.2} Hz, below 5 kHz: hart {neu:.1} dB, old sync {alt:.1} dB");
    assert!(neu < fahrt_grenze("puls") && neu < alt - 10.0, "narrow pulse: hart {neu:.1} dB, old {alt:.1} dB");
}

// ---------------------------------------------------------------------------------------------------------------------
// Against an independent reference

fn naiv_wert(art: &str, b: f64, t: f64) -> f64 {
    match art {
        "saege" => 2.0 * t - 1.0,
        "puls" => if t < b { 1.0 } else { -1.0 },
        _ => 4.0 * (t - 0.5).abs() - 1.0,
    }
}

/// Slope per unit of phase right of t.
fn naiv_steigung(art: &str, t: f64) -> f64 {
    match art {
        "saege" => 2.0,
        "puls" => 0.0,
        _ => if t < 0.5 { -4.0 } else { 4.0 },
    }
}

/// The slave in continuous time, in f64, written from the definition and not from osz.rs: per interval the phase is
/// walked to the reset the master announces (if any) and on; every discontinuity met on the way (the edges of the
/// waveform, the reset) gets its height and slope change from the naive waveform left and right of it and is smoothed by
/// the two-point PolyBLEP / PolyBLAMP on the samples on both sides.
fn referenz(art: &str, b: f64, inc: &[f64], hart: &[f32]) -> Vec<f64> {
    let n = inc.len();
    let mut y = vec![0.0f64; n + 1];
    let mut p = 0.0f64;
    let kanten: Vec<f64> = match art {
        "saege" => vec![1.0],
        "puls" => vec![b, 1.0, 1.0 + b],
        _ => vec![0.5, 1.0, 1.5],
    };
    let sprung = |e: f64| {
        let (l, r) = ((e - 1e-12).rem_euclid(1.0), e.rem_euclid(1.0));
        (naiv_wert(art, b, r) - naiv_wert(art, b, l), naiv_steigung(art, r) - naiv_steigung(art, l))
    };
    for i in 0..n {
        y[i] += naiv_wert(art, b, p);
        let d = inc[i];
        let mut ereignis = |tau: f64, h: f64, ds: f64| {
            y[i] += 0.5 * h * (1.0 - tau).powi(2) + ds * d / 6.0 * (1.0 - tau).powi(3);
            y[i + 1] += -0.5 * h * tau * tau + ds * d / 6.0 * tau.powi(3);
        };
        let reset = if hart[i] >= 1.0 { Some((hart[i] as f64 - 1.0).min(1.0)) } else { None };
        let bis = p + reset.unwrap_or(1.0) * d;
        for &e in &kanten {
            if p < e && e <= bis {
                let (h, ds) = sprung(e);
                ereignis((e - p) / d, h, ds);
            }
        }
        match reset {
            Some(tau) => {
                let pr = bis.rem_euclid(1.0);
                ereignis(tau, naiv_wert(art, b, 0.0) - naiv_wert(art, b, pr), naiv_steigung(art, 0.0) - naiv_steigung(art, pr));
                p = (1.0 - tau) * d;
                for &e in &kanten {
                    if e <= p {
                        let (h, ds) = sprung(e);
                        ereignis(tau + e / d, h, ds);
                    }
                }
            }
            None => p = bis.rem_euclid(1.0),
        }
    }
    y.truncate(n);
    y
}

/// Largest allowed difference to the reference. Both apply the same corrections; the slave's f32 phase differs from the
/// f64 one by a few ulp (1e-7 of a period), and the jump heights by as much. Stated bound 2e-4.
const REFERENZ_GRENZE: f64 = 2e-4;

#[test]
fn folger_trifft_die_unabhaengige_referenz() {
    let f0 = 441.3f32;
    for (art, pwm) in [("saege", 0.0f32), ("puls", -0.6), ("puls", -1.0), ("dreieck", 0.0)] {
        let g = graph(1, &format!(r#",{{"id":"m","art":"saege","hz":{f0}}},{{"id":"k","art":"regler","nr":1,"min":{f0},"max":{},"log":1}},{{"id":"s","art":"{art}"{}}}"#, 9.0 * f0,
                               if art == "puls" { format!(r#","pwm":{pwm}"#) } else { String::new() }),
                      r#"{"von":"k.aus","nach":"s.hz"},{"von":"m.hart","nach":"s.hart"},{"von":"m.hart","nach":"o.l"},{"von":"s.aus","nach":"o.r"}"#);
        let mut p = lade(&g);
        let n = 48_000;
        let (mut hart, mut aus, mut inc) = (Vec::new(), Vec::new(), Vec::new());
        for i in 0..n {
            let k = i as f32 / n as f32;
            p.setze_regler(1, k);
            let (l, r) = p.sample_stereo();
            hart.push(l);
            aus.push(r as f64);
            // the knob in the graph: min * (max / min)^k in f32, then hz / sr clamped
            inc.push(((f0 * ((9.0 * f0) / f0).powf(k)) / SR).clamp(0.0, 0.5) as f64);
        }
        let b = (0.5 + 0.45 * pwm).clamp(0.02, 0.98) as f64;
        let soll = referenz(art, b, &inc, &hart);
        // sample 0 is left out: the oscillators start at phase 0, which the old code reads as a wrap exactly on the sample
        let (abw, bei) = aus.iter().zip(&soll).enumerate().skip(1).fold((0.0f64, 0), |m, (i, (a, s))| if (a - s).abs() > m.0 { ((a - s).abs(), i) } else { m });
        let resets = hart.iter().filter(|h| **h >= 1.0).count();
        println!("MESS reference {art} pwm {pwm}: {resets} resets, largest difference {abw:.2e} (sample {bei})");
        assert!(resets > 400, "{art}: only {resets} resets");
        assert!(abw < REFERENZ_GRENZE, "{art} pwm {pwm}: {abw} at sample {bei}, limit {REFERENZ_GRENZE}");
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Robustness

#[test]
fn unsinnige_eingaenge_bleiben_endlich() {
    // two knobs over +-1e30 multiply to +-inf or large finite values, times 0 to NaN; they drive both pitches, the pwm and
    // the hart input directly (any signal may feed it)
    let g = graph(2, r#",{"id":"k1","art":"regler","nr":1,"min":-1e30,"max":1e30},{"id":"k2","art":"regler","nr":2,"min":-1e30,"max":1e30},{"id":"g","art":"mul"},{"id":"nan","art":"mul","b":0},{"id":"m","art":"puls"},{"id":"s","art":"saege"},{"id":"p","art":"puls"},{"id":"d","art":"dreieck","hz":300}"#,
                     r#"{"von":"k1.aus","nach":"g.a"},{"von":"k2.aus","nach":"g.b"},{"von":"g.aus","nach":"nan.a"},{"von":"g.aus","nach":"m.hz"},{"von":"nan.aus","nach":"m.pwm"},{"von":"m.hart","nach":"s.hart"},{"von":"g.aus","nach":"s.hz"},{"von":"nan.aus","nach":"p.hart"},{"von":"g.aus","nach":"p.hz"},{"von":"g.aus","nach":"d.hart"},{"von":"s.aus","nach":"o.l"},{"von":"p.aus","nach":"o.r"},{"von":"d.aus","nach":"o.x"}"#);
    let mut p = lade(&g);
    for (a, b) in [(1.0, 1.0), (0.0, 1.0), (1.0, 0.5), (0.5, 0.5), (0.500_001, 0.500_001), (0.499_999, 0.500_001), (1.0, 1.0)] {
        p.setze_regler(1, a);
        p.setze_regler(2, b);
        for (l, r) in lauf(&mut p, 2_000) {
            assert!(l.is_finite() && r.is_finite(), "knobs {a} {b}: {l} {r}");
        }
    }
    assert_eq!(p.rettungen, 0, "the guard had to rescue the graph");
}

#[test]
fn folger_bleibt_im_wertebereich() {
    // PolyBLEP overshoots by at most a fraction of the step; 1.5 is far above it and far below a broken correction
    for (art, extra) in [("saege", ""), ("puls", r#","pwm":0.7"#), ("dreieck", "")] {
        let f0 = leiter_hz(1760.0);
        let x = sync_fahrt(f0, art, extra, "hart", 4.0);
        let spitze = x.iter().fold(0.0f32, |m, v| m.max(v.abs()));
        println!("MESS {art} sync sweep peak {spitze:.3}");
        assert!(spitze < 1.5, "{art}: peak {spitze}");
    }
}


// ---------------------------------------------------------------------------------------------------------------------
// Examples

const BEISPIELE: [(&str, &str); 3] = [
    ("hartsync-lead", include_str!("../beispiele/hartsync-lead.json")),
    ("hartsync-pad", include_str!("../beispiele/hartsync-pad.json")),
    ("hartsync-bass", include_str!("../beispiele/hartsync-bass.json")),
];

#[test]
fn beispiele_nutzen_hart_und_bleiben_an_den_reglerenden_endlich() {
    for (name, json) in BEISPIELE {
        let j: serde_json::Value = serde_json::from_str(json).unwrap();
        let hart = j["kanten"].as_array().unwrap().iter().filter(|k| k["von"].as_str().unwrap().ends_with(".hart") && k["nach"].as_str().unwrap().ends_with(".hart")).count();
        assert_eq!(hart, 1, "{name}: one hard sync edge expected");
        for stellung in [[0.0f32; 8], [1.0; 8], [0.0, 1.0, 0.0, 1.0, 0.0, 1.0, 0.0, 1.0], [1.0, 0.0, 1.0, 0.0, 1.0, 0.0, 1.0, 0.0]] {
            let mut p = lade(json);
            for (i, w) in stellung.iter().enumerate() {
                p.setze_regler(i + 1, *w);
            }
            let mut x = Vec::new();
            for n in [28u8, 45, 69, 93] {
                p.note_an(n, 1.0);
                x.extend(lauf(&mut p, 12_000));
                p.note_aus(n);
            }
            for n in [45u8, 52, 57, 64] {
                p.note_an(n, 1.0);
            }
            x.extend(lauf(&mut p, 24_000));
            p.alle_aus();
            x.extend(lauf(&mut p, 48_000));
            let spitze = x.iter().fold(0.0f32, |m, v| m.max(v.0.abs()).max(v.1.abs()));
            println!("MESS {name} knobs {stellung:?}: peak {spitze:.3}");
            assert!(x.iter().all(|v| v.0.is_finite() && v.1.is_finite()) && p.rettungen == 0, "{name} {stellung:?}: not finite");
            assert!(spitze < 1.0 && spitze > 0.01, "{name} {stellung:?}: peak {spitze}");
        }
    }
}
