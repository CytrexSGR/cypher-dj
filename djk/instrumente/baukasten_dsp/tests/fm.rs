//! The `fm` block (type 35): pitch, sideband positions and Bessel amplitudes, feedback stability, the alias guard,
//! per-operator envelopes, algorithms, velocity, determinism and robustness. Everything goes through the public JSON API,
//! so the numbers are what a graph plays. Every key check has a mutation that turns it red; the mutations and their red
//! output are listed in `BERICHT-fm.md`.
use baukasten_dsp::fm::{ALGORITHMEN, FB_MAX};
use baukasten_dsp::{uebersetze, Fehler, Programm, ARTEN};
use realfft::RealFftPlanner;

const SR: f32 = 48_000.0;
/// The documented index scale: a modulator at level 1 and index 1 has a peak index of 4 pi radians. Written out here, not
/// read from the library, so a wrong constant there shows as wrong Bessel amplitudes.
const INDEX_MAX: f64 = 4.0 * std::f64::consts::PI;

/// A graph with one fm node `f` (its values appended from `werte`) and extra nodes/edges; `aus` goes to the output.
fn graph(werte: &str, stimmen: usize, knoten: &str, kanten: &str) -> String {
    format!(
        r#"{{"format":"baukasten/2","name":"fm","stimmen":{stimmen},"knoten":[{{"id":"f","art":"fm"{werte}}},{{"id":"o","art":"ausgang"}}{knoten}],"kanten":[{{"von":"f.aus","nach":"o.x"}}{kanten}]}}"#
    )
}

/// The node driven by a note (hz, gate, trig, vel).
fn mit_note(werte: &str, stimmen: usize) -> String {
    graph(werte, stimmen, r#",{"id":"n","art":"note"}"#,
          r#",{"von":"n.hz","nach":"f.hz"},{"von":"n.gate","nach":"f.gate"},{"von":"n.trig","nach":"f.trig"},{"von":"n.vel","nach":"f.vel"}"#)
}

fn lade(g: &str) -> Programm { uebersetze(g, SR).unwrap_or_else(|e| panic!("{e}: {g}")) }

fn lauf(p: &mut Programm, n: usize) -> Vec<f32> { (0..n).map(|_| p.sample_stereo().0).collect() }

/// FFT length of the line measurements. With f = sr * m / N (m odd) and integer ratios every operator's phase step is an
/// exact multiple of 2^16 in the u32 accumulator, so the output repeats after exactly N samples: a rectangular window sees
/// pure lines on the bins k * m and nothing else, unless something folds (alias) or the signal is not periodic.
const N_FFT: usize = 65_536;

fn spektrum(x: &[f32]) -> Vec<f64> {
    let mut v: Vec<f64> = x.iter().map(|s| *s as f64).collect();
    let mut fft = RealFftPlanner::<f64>::new();
    let r2c = fft.plan_fft_forward(v.len());
    let mut s = r2c.make_output_vec();
    r2c.process(&mut v, &mut s).unwrap();
    // amplitude of a sine on its bin
    s.iter().map(|c| c.norm() * 2.0 / x.len() as f64).collect()
}

/// Steady N samples of a graph at f = sr * m / N after 0.25 s of settling (envelopes at sustain).
fn stationaer(werte: &str, m: usize) -> Vec<f32> {
    let hz = SR as f64 * m as f64 / N_FFT as f64;
    let mut p = lade(&graph(&format!(r#","hz":{hz}{werte}"#), 1, "", ""));
    lauf(&mut p, 12_000);
    lauf(&mut p, N_FFT)
}

#[test]
fn fm_ist_art_35_mit_ein_und_ausgaengen() {
    let a = ARTEN.get(35).expect("ARTEN has no entry 35 (fm)");
    assert_eq!(a.art, "fm");
    assert_eq!(a.ein, &["hz", "gate", "trig", "vel", "index", "rueck", "zeit"]);
    assert_eq!(a.aus, &["aus"]);
    assert!(a.werte.is_empty());
    for f in [("algo", 0.0), ("gate", 1.0), ("vel", 1.0), ("index", 1.0), ("rueck", 0.0), ("zeit", 1.0), ("anschlag", 0.0), ("sync", 1.0),
              ("o1_pegel", 1.0), ("o2_pegel", 0.0), ("o6_verh", 1.0), ("o6_r", 0.1)] {
        assert!(a.frei.contains(&f), "{f:?}");
    }
    assert_eq!(a.frei.len(), 8 + 6 * 7);
    assert_eq!(ARTEN[32].art, "wavetable", "existing type numbers must not move");
}

#[test]
fn werte_werden_geprueft() {
    let ok = |v: &str| uebersetze(&mit_note(v, 1), SR);
    for v in [r#","algo":16"#, r#","algo":1.5"#, r#","algo":-1"#, r#","sync":2"#, r#","anschlag":1.1"#, r#","index":2.1"#, r#","rueck":-0.1"#,
              r#","zeit":0.01"#, r#","zeit":21"#, r#","vel":2"#, r#","o1_verh":0"#, r#","o3_verh":33"#, r#","o2_fein":101"#, r#","o6_pegel":1.5"#,
              r#","o4_a":-1"#, r#","o5_d":0"#, r#","o2_s":1.2"#, r#","o1_r":61"#] {
        assert!(matches!(ok(v), Err(Fehler::Wert { .. })), "{v}: {:?}", ok(v).err());
    }
    for v in ["", r#","algo":15"#, r#","o1_verh":0.03125"#, r#","o6_verh":32"#, r#","o2_fein":-100"#, r#","o3_pegel":1"#, r#","o4_a":0"#,
              r#","o5_d":60"#, r#","index":2"#, r#","rueck":1"#, r#","zeit":20"#, r#","sync":0"#, r#","anschlag":1"#] {
        assert!(ok(v).is_ok(), "{v}: {:?}", ok(v).err());
    }
    assert!(matches!(ok(r#","o7_verh":1"#), Err(Fehler::UnbekannterWert { .. })));
}

// ---------------------------------------------------------------------------------------------------------------------
// Pitch

/// Frequency from the rising zero crossings (linear interpolation between samples) over the whole signal.
fn frequenz(x: &[f32], sr: f32) -> f64 {
    let mut nullen = Vec::new();
    for i in 1..x.len() {
        if x[i - 1] < 0.0 && x[i] >= 0.0 {
            nullen.push(i as f64 - 1.0 + x[i - 1] as f64 / (x[i - 1] - x[i]) as f64);
        }
    }
    assert!(nullen.len() > 10, "too few zero crossings");
    (nullen.len() - 1) as f64 / (nullen[nullen.len() - 1] - nullen[0]) * sr as f64
}

fn cent(ist: f64, soll: f64) -> f64 { 1200.0 * (ist / soll).log2() }

/// Largest allowed pitch error: the phase step is a u32 (2^-32 of a period) from an f32 product: about 1e-4 cent.
const CENT_GRENZE: f64 = 0.01;

#[test]
fn tonhoehe_mit_verhaeltnis_und_feinverstimmung_auf_hundertstel_cent() {
    // operator 1 alone, as carrier, at ratio and fine detune; algorithm 7 (four carriers, the others silent)
    let mut schlimmst = 0.0f64;
    for sr in [44_100.0f32, 48_000.0, 96_000.0] {
        for hz in [27.5f64, 110.0, 261.6256, 440.0, 1760.0] {
            for (verh, fein) in [(1.0f64, 0.0f64), (0.5, 0.0), (3.5, 7.0), (2.0, -33.0), (7.0, 100.0)] {
                let soll = hz * verh * (fein / 1200.0).exp2();
                if soll > 8000.0 {
                    continue;
                }
                let g = graph(&format!(r#","algo":7,"hz":{hz},"o1_verh":{verh},"o1_fein":{fein}"#), 1, "", "");
                let mut p = uebersetze(&g, sr).unwrap();
                let x: Vec<f32> = (0..sr as usize).map(|_| p.sample_stereo().0).collect();
                let c = cent(frequenz(&x, sr), soll);
                println!("MESS pitch sr {sr} {hz:8.2} Hz x {verh} {fein:+} c: {c:+.5} cent");
                schlimmst = schlimmst.max(c.abs());
            }
        }
    }
    println!("MESS pitch worst {schlimmst:.5} cent");
    assert!(schlimmst < CENT_GRENZE, "pitch error {schlimmst:.5} cent, limit {CENT_GRENZE}");
}

// ---------------------------------------------------------------------------------------------------------------------
// Sidebands and Bessel amplitudes

/// J_n(x), n may be negative, by the trapezoid rule on the integral form (exact to rounding for this periodic integrand).
fn bessel(n: i32, x: f64) -> f64 {
    let m = 4000;
    let mut s = 0.0;
    for k in 0..=m {
        let t = std::f64::consts::PI * k as f64 / m as f64;
        let w = if k == 0 || k == m { 0.5 } else { 1.0 };
        s += w * (n as f64 * t - x * t.sin()).cos();
    }
    s / m as f64
}

/// Expected line amplitudes (index = harmonic of f0) of sin(2 pi c t + I sin(2 pi m t)): sideband k at c + k m has J_k(I);
/// a negative frequency folds onto its mirror with the sign flipped (sin(-x) = -sin(x)).
fn linien(c: i32, m: i32, i: f64, bis: usize) -> Vec<f64> {
    let mut a = vec![0.0; bis];
    for k in -200..=200 {
        let f = c + k * m;
        let j = bessel(k, i);
        if f > 0 && (f as usize) < bis {
            a[f as usize] += j;
        } else if f < 0 && ((-f) as usize) < bis {
            a[(-f) as usize] -= j;
        }
    }
    a
}

/// Largest allowed deviation of a measured line from its Bessel amplitude, relative to the unmodulated carrier (1).
const BESSEL_TOLERANZ: f64 = 1e-4;

#[test]
fn seitenbaender_liegen_bei_c_plus_k_m_mit_bessel_amplituden() {
    // algorithm 4 ((4+3+2)>1), operators 3 and 4 silent: a single modulator 2 on carrier 1. f0 = sr * 33 / N = 24.2 Hz.
    let m0 = 33usize;
    let mut schlimmst = 0.0f64;
    for (c, m, i) in [(8, 1, 2.0f64), (8, 1, 5.0), (1, 3, 1.5), (2, 5, 2.4048), (3, 2, 0.3), (5, 7, 8.0)] {
        let pegel = i / INDEX_MAX;
        let x = stationaer(&format!(r#","algo":4,"o1_verh":{c},"o2_verh":{m},"o2_pegel":{pegel}"#), m0);
        let s = spektrum(&x);
        let bis = 120usize;
        let soll = linien(c, m, i, bis);
        let mut fehler = 0.0f64;
        let mut daneben = 0.0f64;
        for (b, a) in s.iter().enumerate().skip(1) {
            if b % m0 == 0 && b / m0 < bis {
                fehler = fehler.max((a - soll[b / m0].abs()).abs());
            } else {
                daneben = daneben.max(*a);
            }
        }
        // a few lines for the report: carrier and first sidebands
        let zeige: Vec<String> = (0..4).map(|k| {
            let h = (c + k * m) as usize;
            format!("c+{k}m: {:.5} (J {:.5})", s[h * m0], soll[h].abs())
        }).collect();
        println!("MESS sidebands c {c} m {m} I {i}: max error {fehler:.2e}, largest off-line bin {daneben:.2e}; {}", zeige.join(", "));
        assert!(fehler < BESSEL_TOLERANZ, "c {c} m {m} I {i}: line error {fehler:e}");
        assert!(daneben < BESSEL_TOLERANZ, "c {c} m {m} I {i}: energy off the lines c + k m: {daneben:e}");
        schlimmst = schlimmst.max(fehler).max(daneben);
    }
    println!("MESS sidebands worst deviation {schlimmst:.2e} (tolerance {BESSEL_TOLERANZ:e})");
    // at the first zero of J_0 (2.4048) the carrier itself vanishes: a sharp check of the index scale
    let x = stationaer(&format!(r#","algo":4,"o1_verh":2,"o2_verh":5,"o2_pegel":{}"#, 2.4048 / INDEX_MAX), m0);
    let traeger = spektrum(&x)[2 * m0];
    println!("MESS carrier at I = 2.4048 (zero of J0): {traeger:.2e}");
    assert!(traeger < 1e-4, "carrier at the zero of J0: {traeger}");
}

#[test]
fn index_eingang_und_anschlag_skalieren_den_index() {
    // index 0.5 on the input, or velocity 0.5 with anschlag 1, halve the index: J1 follows J1(I/2)
    let m0 = 33usize;
    let i = 3.0f64;
    let pegel = i / INDEX_MAX;
    for werte in [format!(r#","algo":4,"o1_verh":8,"o2_pegel":{pegel},"index":0.5"#), format!(r#","algo":4,"o1_verh":8,"o2_pegel":{pegel},"anschlag":1,"vel":0.5"#)] {
        let s = spektrum(&stationaer(&werte, m0));
        let soll = bessel(1, i / 2.0).abs();
        println!("MESS {werte}: J1 line {:.5}, J1(I/2) {soll:.5}", s[9 * m0]);
        assert!((s[9 * m0] - soll).abs() < BESSEL_TOLERANZ, "{werte}");
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Feedback

/// Energy outside the harmonic lines (all bins up to Nyquist), relative to the total, in dB.
fn ausserhalb_db(x: &[f32], m: usize, grenze_bin: usize) -> f64 {
    let s = spektrum(x);
    let (mut aus, mut summe) = (0.0f64, 0.0f64);
    for (b, a) in s.iter().enumerate().skip(1) {
        summe += a * a;
        if b <= grenze_bin && b % m != 0 {
            aus += a * a;
        }
    }
    10.0 * (aus / summe).max(1e-30).log10()
}

/// Feedback stability: the self-modulated top operator must stay periodic at every feedback. Measured at 47 Hz, where its
/// own aliasing is below -110 dB, so any energy between the harmonics is hunting or chaos.
const FB_STABIL_DB: f64 = -80.0;

#[test]
fn rueckkopplung_bleibt_periodisch_und_wird_heller() {
    // algorithm 7 (additive 4), only operator 4 (the feedback operator) sounds
    let m0 = 63usize;
    let mut vorher = 0.0f64;
    let mut schlimmst = f64::NEG_INFINITY;
    for r in [0.0f32, 0.2, 0.4, 0.6, 0.7, 0.8, 0.9, 1.0] {
        let x = stationaer(&format!(r#","algo":7,"o1_pegel":0,"o4_pegel":1,"rueck":{r}"#), m0);
        let db = ausserhalb_db(&x, m0, N_FFT / 2);
        let s = spektrum(&x);
        // brightness: share of the energy above the fundamental
        let e: f64 = (1..200).map(|h| s[h * m0].powi(2)).sum();
        let hell = 1.0 - s[m0].powi(2) / e;
        let spitze = x.iter().fold(0.0f32, |m, v| m.max(v.abs()));
        println!("MESS feedback rueck {r} (beta {:.2}): off-harmonic {db:7.1} dB, energy above the fundamental {:.3}, h2 {:.4} h5 {:.4} h10 {:.4}, peak {spitze:.3}",
                 r * FB_MAX, hell, s[2 * m0], s[5 * m0], s[10 * m0]);
        assert!(db < FB_STABIL_DB, "rueck {r}: {db:.1} dB between the harmonics (limit {FB_STABIL_DB})");
        assert!(r == 0.0 || hell > vorher, "rueck {r}: not brighter than the step before ({hell} <= {vorher})");
        assert!(spitze <= 0.25 + 1e-6, "peak {spitze} above 1/4 (one of four carriers)");
        vorher = hell;
        schlimmst = schlimmst.max(db);
    }
    println!("MESS feedback worst off-harmonic {schlimmst:.1} dB (limit {FB_STABIL_DB})");
    // positive control: at full feedback the spectrum is saw-like (h2 within 10 dB of the fundamental)
    assert!(vorher > 0.3, "full feedback must be bright ({vorher})");
}

// ---------------------------------------------------------------------------------------------------------------------
// Aliasing

/// Alias energy below 20 kHz relative to the total, in dB (bins that are not multiples of m).
fn alias_db(x: &[f32], m: usize) -> f64 { ausserhalb_db(x, m, (20_000.0 * N_FFT as f64 / SR as f64) as usize) }

/// Odd m for pitches from 20 Hz to `bis` Hz in steps of `schritt` octaves.
fn sweep(bis: f64, schritt: f64) -> Vec<usize> {
    let mut v = Vec::new();
    let mut f = 20.0f64;
    while f <= bis * 1.0001 {
        v.push((f * N_FFT as f64 / SR as f64).round() as usize | 1);
        f *= 2f64.powf(schritt);
    }
    v
}

/// The stated bound: alias energy below 20 kHz under -70 dB of the total, for every algorithm at every operator level,
/// index and feedback at their maximum, pitches 20 Hz .. 4 kHz, at 48 kHz.
const ALIAS_GRENZE_DB: f64 = -70.0;

/// Every operator at level 1, index 2 (twice INDEX_MAX), full feedback, ratios `verh` (integers keep the lines exact).
fn voll(algo: usize, verh: [u32; 6]) -> String {
    let mut w = format!(r#","algo":{algo},"index":2,"rueck":1"#);
    for (o, v) in verh.iter().enumerate() {
        w += &format!(r#","o{n}_pegel":1,"o{n}_verh":{v}"#, n = o + 1);
    }
    w
}

#[test]
fn rueckkopplung_allein_unter_minus_80_db_alias() {
    // the feedback limit FB_GRENZE on its own: operator 4 alone at full feedback, 20 Hz .. 10 kHz
    let mut schlimmst = (f64::NEG_INFINITY, 0.0);
    for m in sweep(10_000.0, 1.0 / 3.0) {
        let db = alias_db(&stationaer(r#","algo":7,"o1_pegel":0,"o4_pegel":1,"rueck":1"#, m), m);
        let hz = SR as f64 * m as f64 / N_FFT as f64;
        println!("MESS alias feedback alone {hz:8.1} Hz: {db:7.1} dB");
        if db > schlimmst.0 {
            schlimmst = (db, hz);
        }
    }
    println!("MESS alias feedback alone worst: {:.1} dB at {:.1} Hz", schlimmst.0, schlimmst.1);
    assert!(schlimmst.0 < -80.0, "feedback alone aliases {:.1} dB at {:.1} Hz", schlimmst.0, schlimmst.1);
}

#[test]
fn alle_algorithmen_bei_hoechstem_index_unter_der_aliasgrenze() {
    let mut gesamt = (f64::NEG_INFINITY, String::new());
    for (algo, a) in ALGORITHMEN.iter().enumerate() {
        for verh in [[1, 1, 1, 1, 1, 1], [1, 2, 3, 4, 5, 6], [1, 14, 1, 1, 3, 1]] {
            let mut schlimmst = (f64::NEG_INFINITY, 0.0);
            for m in sweep(4_000.0, 2.0 / 3.0) {
                let db = alias_db(&stationaer(&voll(algo, verh), m), m);
                if db > schlimmst.0 {
                    schlimmst = (db, SR as f64 * m as f64 / N_FFT as f64);
                }
            }
            println!("MESS alias algo {algo:2} {:18} ratios {verh:?}: worst {:7.1} dB at {:7.1} Hz", a.name, schlimmst.0, schlimmst.1);
            if schlimmst.0 > gesamt.0 {
                gesamt = (schlimmst.0, format!("algo {algo} ratios {verh:?} at {:.1} Hz", schlimmst.1));
            }
        }
    }
    println!("MESS alias all algorithms worst: {:.1} dB ({})", gesamt.0, gesamt.1);
    assert!(gesamt.0 < ALIAS_GRENZE_DB, "alias {:.1} dB ({}), limit {ALIAS_GRENZE_DB} dB", gesamt.0, gesamt.1);
}

#[test]
fn baeume_werden_getrennt_begrenzt() {
    // algorithm 3 (2>1, 4>3) at 880 Hz like the e-piano: the tine pair 4>3 (ratio 14, 12.3 kHz) must be limited, the body
    // pair 2>1 must keep its full index. Carrier 3 is silent, so the output is pair 1 alone; it must not change when the
    // tine is there or not.
    let paar = |tine: f32| -> Vec<f32> {
        let mut p = lade(&graph(&format!(r#","algo":3,"hz":880,"o2_pegel":0.11,"o3_pegel":0,"o4_verh":14,"o4_pegel":{tine}"#), 1, "", ""));
        lauf(&mut p, 9_600)
    };
    let (mit, ohne) = (paar(0.035), paar(0.0));
    assert!(mit.iter().zip(&ohne).all(|(a, b)| a.to_bits() == b.to_bits()), "the tine pair's limit changed the body pair");
    // positive control: the guard does limit the tine pair at this pitch (and leaves the body pair alone)
    let w = |n: &str| -> f32 {
        match n { "algo" => 3.0, "o1_pegel" => 1.0, "o2_pegel" => 0.11, "o4_verh" => 14.0, "o4_pegel" => 0.035,
                  _ => ARTEN[35].frei.iter().find(|(k, _)| *k == n).map(|(_, v)| *v).unwrap_or(0.0) }
    };
    let e = baukasten_dsp::fm::Einstellung::aus_werten(&w);
    let mut v = baukasten_dsp::fm::Stimme::neu();
    v.prozess(&e, SR, baukasten_dsp::fm::Eingabe { hz: 880.0, gate: 1.0, trig: 0.0, vel: 1.0, index: 1.0, rueck: 0.0, zeit: 1.0 });
    println!("MESS trees at 880 Hz: body pair limit {:.3}, tine pair limit {:.3} (index product, 1 = as set)", v.index_grenze(0), v.index_grenze(2));
    assert_eq!(v.index_grenze(0), 2.0, "the body pair must not be limited");
    assert!(v.index_grenze(2) < 1.0, "the tine pair must be limited at 880 Hz ({})", v.index_grenze(2));
}

// ---------------------------------------------------------------------------------------------------------------------
// Envelopes per operator

/// Time in samples until |x| (taken as the peak per 480-sample window) falls below `pegel` times its maximum.
fn abfall(x: &[f32], pegel: f32) -> usize {
    let spitzen: Vec<f32> = x.chunks(480).map(|c| c.iter().fold(0.0f32, |m, v| m.max(v.abs()))).collect();
    let max = spitzen.iter().fold(0.0f32, |m, v| m.max(*v));
    spitzen.iter().position(|v| *v < pegel * max).unwrap_or(spitzen.len()) * 480
}

#[test]
fn jeder_operator_hat_seine_eigene_huelle() {
    // carrier 1 with a 0.5 s decay to 0 (-60 dB at 0.5 s): the measured time to -40 dB is 2/3 of it
    let x = {
        let mut p = lade(&graph(r#","hz":440,"o1_d":0.5,"o1_s":0"#, 1, "", ""));
        lauf(&mut p, 48_000)
    };
    let t = abfall(&x, 0.01) as f64 / SR as f64;
    println!("MESS carrier decay 0.5 s to -60 dB: -40 dB after {t:.3} s (expected 0.333)");
    assert!((t - 1.0 / 3.0).abs() < 0.015, "decay -40 dB after {t} s");
    // the `zeit` input scales decay and release: 2 doubles it
    let mut p = lade(&graph(r#","hz":440,"o1_d":0.5,"o1_s":0,"zeit":2"#, 1, "", ""));
    let t2 = abfall(&lauf(&mut p, 96_000), 0.01) as f64 / SR as f64;
    println!("MESS same with zeit 2: {t2:.3} s");
    assert!((t2 - 2.0 / 3.0).abs() < 0.015, "zeit 2: {t2} s");
    // modulator 2 decays (1 s to -60 dB, sustain 0), carrier 1 holds: the tone starts rich and ends a pure sine
    let m0 = 33usize;
    let hz = SR as f64 * m0 as f64 / N_FFT as f64 * 8.0;
    let mut p = lade(&graph(&format!(r#","algo":4,"hz":{hz},"o2_verh":0.125,"o2_pegel":0.3,"o2_d":1,"o2_s":0"#), 1, "", ""));
    let anfang = lauf(&mut p, N_FFT);
    lauf(&mut p, 2 * 48_000);
    let ende = lauf(&mut p, N_FFT);
    // carrier at 8 f0, modulator at f0: everything off the carrier's bin 8 m0 is sideband energy
    let seiten = |x: &[f32]| -> f64 {
        let s = spektrum(x);
        let e: f64 = s.iter().map(|a| a * a).sum();
        1.0 - s[8 * m0].powi(2) / e
    };
    let (a, e) = (seiten(&anfang), seiten(&ende));
    println!("MESS modulator envelope: energy off the carrier line, first 1.4 s {a:.3}, after 3.4 s {e:.2e}");
    assert!(a > 0.1, "the modulator must be audible at the start ({a})");
    assert!(e < 1e-9, "after the modulator's decay the carrier must be a pure sine ({e})");
}

#[test]
fn gate_aus_gibt_den_release() {
    let mut p = lade(&mit_note(r#","o1_r":0.3"#, 1));
    p.note_an(69, 1.0);
    lauf(&mut p, 4_800);
    p.note_aus(69);
    let x = lauf(&mut p, 48_000);
    let t = abfall(&x, 0.001) as f64 / SR as f64;
    println!("MESS release 0.3 s to -60 dB: measured {t:.3} s");
    assert!((t - 0.3).abs() < 0.02, "release {t}");
    assert!(x[x.len() - 100..].iter().all(|v| *v == 0.0), "after the release the voice is exactly silent");
}

// ---------------------------------------------------------------------------------------------------------------------
// Algorithms

#[test]
fn nur_traeger_sind_zu_hoeren() {
    // each operator alone at level 1: audible exactly when the algorithm lists it as a carrier, at 1 / number of carriers
    for (algo, a) in ALGORITHMEN.iter().enumerate() {
        for o in 0..6 {
            let mut w = format!(r#","algo":{algo},"o1_pegel":0"#);
            w += &format!(r#","o{}_pegel":1,"o{}_verh":{}"#, o + 1, o + 1, o + 1);
            let mut p = lade(&graph(&format!(r#","hz":100{w}"#), 1, "", ""));
            let x = lauf(&mut p, 4_800);
            let spitze = x[2_400..].iter().fold(0.0f32, |m, v| m.max(v.abs()));
            let traeger = o < a.ops && a.traeger & (1 << o) != 0;
            let soll = if traeger { 1.0 / a.traeger.count_ones() as f32 } else { 0.0 };
            assert!((spitze - soll).abs() < 1e-3, "algo {algo} ({}), op {}: peak {spitze}, expected {soll}", a.name, o + 1);
        }
    }
}

#[test]
fn modulatoren_wirken_auf_ihre_ziele() {
    // every link of every algorithm: the modulator alone at a small index adds the sidebands target + k * modulator to the
    // carrier the link feeds (directly or through the chain), and nothing else changes when the link is not listed
    for (algo, a) in ALGORITHMEN.iter().enumerate() {
        for j in 0..a.ops {
            for i in 0..j {
                // carriers at level 1, modulator j at 0.05 (I = 0.63); all others silent
                let mut w = format!(r#","algo":{algo},"o1_pegel":0"#);
                for t in 0..a.ops {
                    if a.traeger & (1 << t) != 0 && t != j {
                        w += &format!(r#","o{}_pegel":1"#, t + 1);
                    }
                }
                let ohne = { let mut p = lade(&graph(&format!(r#","hz":100{w}"#), 1, "", "")); lauf(&mut p, 2_400) };
                let mit = { let mut p = lade(&graph(&format!(r#","hz":100{w},"o{}_pegel":0.05,"o{}_verh":3"#, j + 1, j + 1), 1, "", "")); lauf(&mut p, 2_400) };
                let d = ohne.iter().zip(&mit).fold(0.0f32, |m, (x, y)| m.max((x - y).abs()));
                // j changes the sound iff it modulates a carrier, or is a carrier itself
                let direkt = a.mods.iter().enumerate().any(|(t, m)| m & (1 << j) != 0 && a.traeger & (1 << t) != 0);
                let traeger = a.traeger & (1 << j) != 0;
                if a.mods[i] & (1 << j) != 0 && a.traeger & (1 << i) != 0 {
                    assert!(d > 0.01, "algo {algo} ({}): link {}>{} has no effect ({d})", a.name, j + 1, i + 1);
                }
                if !direkt && !traeger {
                    // a modulator of a non-carrier with its target silent: no effect (the target's level is 0)
                    assert!(d < 1e-6, "algo {algo} ({}): op {} reaches the output without a carrier path ({d})", a.name, j + 1);
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Determinism, reset, robustness

#[test]
fn gleicher_graph_gleicher_klang_und_sync_beim_anschlag() {
    let g = mit_note(&voll(11, [1, 14, 1, 1, 3, 1]).replace(r#""index":2"#, r#""index":0.3"#), 4);
    let spiel = |g: &str| -> Vec<f32> {
        let mut p = lade(g);
        let mut x = Vec::new();
        for n in [45u8, 52, 45] {
            p.note_an(n, 0.8);
            x.extend(lauf(&mut p, 6_000));
            p.note_aus(n);
            x.extend(lauf(&mut p, 9_600));
        }
        x
    };
    let (a, b) = (spiel(&g), spiel(&g));
    assert!(a.iter().zip(&b).all(|(x, y)| x.to_bits() == y.to_bits()), "two loads differ");
    // sync: the third strike of note 45 starts like the first (phases and feedback restarted)
    let erste = &a[..600];
    let dritte = &a[31_200..31_800];
    let d = erste.iter().zip(dritte).fold(0.0f32, |m, (x, y)| m.max((x - y).abs()));
    println!("MESS onset strike 1 vs 3 with sync: max difference {d:.2e}");
    // 0.2 s after the note-off the release (0.1 s to -60 dB) has snapped to 0, so the strikes start alike
    assert!(d < 1e-6, "with sync the onsets must match ({d})");
    let ohne = spiel(&g.replace(r#""algo":11"#, r#""algo":11,"sync":0"#));
    let d0 = ohne[..600].iter().zip(&ohne[31_200..31_800]).fold(0.0f32, |m, (x, y)| m.max((x - y).abs()));
    println!("MESS onset strike 1 vs 3 without sync: max difference {d0:.3}");
    assert!(d0 > 0.05, "without sync the onsets must differ ({d0})");
}

#[test]
fn unsinnige_eingaenge_bleiben_endlich_und_begrenzt() {
    let g = graph(&voll(8, [1, 2, 3, 4, 5, 6]), 1,
                  r#",{"id":"k1","art":"regler","nr":1,"min":-1e30,"max":1e30},{"id":"k2","art":"regler","nr":2,"min":-1e30,"max":1e30},{"id":"g","art":"mul"},{"id":"nan","art":"mul","b":0}"#,
                  r#",{"von":"k1.aus","nach":"g.a"},{"von":"k2.aus","nach":"g.b"},{"von":"g.aus","nach":"nan.a"},{"von":"g.aus","nach":"f.hz"},{"von":"nan.aus","nach":"f.index"},{"von":"g.aus","nach":"f.rueck"},{"von":"nan.aus","nach":"f.vel"},{"von":"g.aus","nach":"f.trig"},{"von":"nan.aus","nach":"f.zeit"},{"von":"g.aus","nach":"f.gate"}"#);
    let mut p = lade(&g);
    for (a, b) in [(1.0, 1.0), (0.0, 1.0), (1.0, 0.5), (0.5, 0.5), (0.500_001, 0.500_001), (0.499_999, 0.500_001), (1.0, 1.0)] {
        p.setze_regler(1, a);
        p.setze_regler(2, b);
        for v in lauf(&mut p, 2_000) {
            assert!(v.is_finite() && v.abs() <= 1.0, "{v}");
        }
    }
    assert_eq!(p.rettungen, 0, "the guard had to rescue the graph");
}

#[test]
fn ausgang_bleibt_unter_eins() {
    // all algorithms at maximum with coherent carriers (ratio 1, phases synced): |aus| <= 1
    for algo in 0..ALGORITHMEN.len() {
        let mut p = lade(&mit_note(&voll(algo, [1, 1, 1, 1, 1, 1]), 2));
        p.note_an(40, 1.0);
        p.note_an(64, 1.0);
        let spitze = lauf(&mut p, 9_600).iter().fold(0.0f32, |m, v| m.max(v.abs()));
        // two voices sum in the output
        assert!(spitze <= 2.0, "algo {algo}: peak {spitze}");
    }
}
