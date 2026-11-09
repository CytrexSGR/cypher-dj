//! The `resonator` block (type 34): mode ratios against the published physics, mode frequencies in the sound, decay per
//! mode, stability at every setting, strike position, brightness, excitation types, determinism and robustness. The sound
//! checks go through the public JSON API; the coefficient checks drive `resonator::Stimme` directly over a grid of
//! settings. Every key check has a mutation that turns it red (`mutation_resonator.py`, results in `REPORT-resonator.md`).
use baukasten_dsp::resonator::{self, Eingabe, Einstellung, Satz, Stimme, MAX_MODEN, SAETZE, T60_KONST, T60_MAX};
use baukasten_dsp::{uebersetze, Fehler, Programm, ARTEN};
use std::f64::consts::PI;

const SR: f32 = 48_000.0;

/// A graph with one resonator `r` (values from `werte`) on the output, struck by a note's trig, and extra nodes/edges.
fn graph(werte: &str, stimmen: usize, knoten: &str, kanten: &str) -> String {
    format!(
        r#"{{"format":"baukasten/2","name":"rs","stimmen":{stimmen},"knoten":[{{"id":"r","art":"resonator"{werte}}},{{"id":"o","art":"ausgang"}},{{"id":"n","art":"note"}}{knoten}],"kanten":[{{"von":"r.aus","nach":"o.x"}},{{"von":"n.trig","nach":"r.trig"}}{kanten}]}}"#
    )
}

fn lade(g: &str) -> Programm { uebersetze(g, SR).unwrap_or_else(|e| panic!("{e}: {g}")) }

fn lauf(p: &mut Programm, n: usize) -> Vec<f32> { (0..n).map(|_| p.sample()).collect() }

/// One strike (note on, `n` samples) of a node with fixed pitch `hz` and `werte`.
fn anschlag(werte: &str, hz: f64, n: usize) -> Vec<f32> {
    let mut p = lade(&graph(&format!(r#","hz":{hz}{werte}"#), 1, "", ""));
    p.note_an(60, 1.0);
    lauf(&mut p, n)
}

// ---------------------------------------------------------------------------------------------------------------------
// Spectral measures

/// 4-term Blackman-Harris window (sidelobes -92 dB).
fn bh(n: usize, len: usize) -> f64 {
    let x = 2.0 * PI * n as f64 / len as f64;
    0.35875 - 0.48829 * x.cos() + 0.14128 * (2.0 * x).cos() - 0.01168 * (3.0 * x).cos()
}

/// Windowed DFT of x[start .. start + len] at frequency f (Hz): (re, im).
fn dft(x: &[f32], start: usize, len: usize, f: f64) -> (f64, f64) {
    let w = 2.0 * PI * f / SR as f64;
    let (mut re, mut im) = (0.0, 0.0);
    for n in 0..len {
        let v = x[start + n] as f64 * bh(n, len);
        re += v * (w * n as f64).cos();
        im -= v * (w * n as f64).sin();
    }
    (re, im)
}

/// Frequency of the partial near `f0` from the phase advance of the windowed DFT between two windows `hop` apart. For
/// one exponentially decaying sinusoid the advance is exactly 2 pi f hop / sr (the decay scales both windows alike).
fn frequenz(x: &[f32], start: usize, len: usize, hop: usize, f0: f64) -> f64 {
    let (a, b) = (dft(x, start, len, f0), dft(x, start + hop, len, f0));
    let d = b.1.atan2(b.0) - a.1.atan2(a.0) - 2.0 * PI * f0 * hop as f64 / SR as f64;
    let d = d - 2.0 * PI * (d / (2.0 * PI)).round();
    f0 + d * SR as f64 / (2.0 * PI * hop as f64)
}

/// T60 of the partial at f from its level in two windows `abstand` samples apart (shift-invariant for an exponential).
fn t60(x: &[f32], start: usize, len: usize, abstand: usize, f: f64) -> f64 {
    let pegel = |s| { let (re, im) = dft(x, s, len, f); 10.0 * (re * re + im * im).log10() };
    let abfall = pegel(start) - pegel(start + abstand);
    60.0 * abstand as f64 / SR as f64 / abfall
}

fn cent(ist: f64, soll: f64) -> f64 { 1200.0 * (ist / soll).log2() }

// ---------------------------------------------------------------------------------------------------------------------
// The block

#[test]
fn resonator_ist_art_34_mit_ein_und_ausgaengen() {
    // type 34: types are numbered in merge order; the resonator was merged right after metall (33).
    let i = ARTEN.iter().position(|a| a.art == "resonator").expect("ARTEN has no resonator");
    assert_eq!(i, 34, "resonator is type 34 (merge order), index {i} of {}", ARTEN.len());
    assert_eq!(ARTEN[32].art, "wavetable", "existing type numbers must not move");
    let a = &ARTEN[i];
    assert_eq!(a.ein, &["hz", "trig", "staerke", "x", "material", "helligkeit", "groesse", "position", "inharmonie"]);
    assert_eq!(a.aus, &["aus"]);
    assert!(a.werte.is_empty());
    for f in [("satz", 0.0), ("moden", 32.0), ("anregung", 0.0), ("burst", 5.0), ("saat", 0.0), ("staerke", 1.0), ("material", 0.5),
              ("helligkeit", 0.5), ("groesse", 1.0), ("position", 0.3), ("inharmonie", 1.0)] {
        assert!(a.frei.contains(&f), "{f:?}");
    }
}

#[test]
fn werte_werden_geprueft() {
    let ok = |v: &str| uebersetze(&graph(v, 1, "", ""), SR);
    for v in [r#","satz":7"#, r#","satz":1.5"#, r#","satz":-1"#, r#","moden":0"#, r#","moden":33"#, r#","moden":2.5"#, r#","anregung":2"#,
              r#","burst":0.4"#, r#","burst":51"#, r#","saat":-1"#, r#","saat":70000"#, r#","staerke":-0.1"#, r#","staerke":11"#,
              r#","material":1.1"#, r#","material":-0.1"#, r#","helligkeit":2"#, r#","groesse":0.2"#, r#","groesse":4.1"#,
              r#","position":1.01"#, r#","inharmonie":-0.1"#, r#","inharmonie":2.1"#] {
        assert!(matches!(ok(v), Err(Fehler::Wert { .. })), "{v}: {:?}", ok(v).err());
    }
    for v in ["", r#","satz":6"#, r#","moden":1"#, r#","moden":32"#, r#","anregung":1"#, r#","burst":0.5"#, r#","burst":50"#,
              r#","saat":65535"#, r#","staerke":10"#, r#","material":0"#, r#","material":1"#, r#","groesse":0.25"#, r#","groesse":4"#,
              r#","position":1"#, r#","inharmonie":0"#, r#","inharmonie":2"#] {
        assert!(ok(v).is_ok(), "{v}: {:?}", ok(v).err());
    }
    assert!(matches!(ok(r#","fremd":1"#), Err(Fehler::UnbekannterWert { .. })));
}

// ---------------------------------------------------------------------------------------------------------------------
// Ratios against the published values

/// beta_n L of the free-free bar, n = 1..5 (Fletcher & Rossing 1998, section 2.15); above, (2n + 1) pi / 2 to 1e-7.
fn stab_beta(n: usize) -> f64 {
    [4.730_040_7, 7.853_204_6, 10.995_607_8, 14.137_165_5, 17.278_759_6].get(n - 1).copied().unwrap_or((2.0 * n as f64 + 1.0) * PI / 2.0)
}

/// Published ratios of every set (independent of the module's computation), at most 32.
fn veroeffentlicht(satz: usize) -> Vec<f64> {
    match satz {
        0 => (1..=32).map(|n| (stab_beta(n) / stab_beta(1)).powi(2)).collect(),
        1 => (1..=32).map(|n| if n <= 3 { [1.0, 4.0, 10.0][n - 1] } else { 10.0 * (stab_beta(n) / stab_beta(3)).powi(2) }).collect(),
        2 => vec![0.5, 1.0, 1.183, 1.506, 2.0, 2.514, 2.662, 3.011, 4.166, 5.433, 6.796, 8.215],
        3 => (2..=33).map(|n: usize| { let n = n as f64; n * (n * n - 1.0) / (n * n + 1.0).sqrt() / (6.0 / 5f64.sqrt()) }).collect(),
        4 => {
            let rho2 = 0.25f64.powi(2) / 12.0;
            let f = |b: f64| b * b / (1.0 + b * b * rho2 * (1.0 + 9.0 / (5.0 / 6.0))).sqrt();
            (1..=32).map(|n| f(stab_beta(n)) / f(stab_beta(1))).collect()
        }
        // Abramowitz & Stegun table 9.5: the ten lowest zeros of J_0 .. J_5, ascending
        5 => [2.404_825_6, 3.831_706_0, 5.135_622_3, 5.520_078_1, 6.380_161_9, 7.015_586_7, 7.588_342_4, 8.417_244_1, 8.653_727_9, 8.771_483_8]
            .iter().map(|j| j / 2.404_825_6).collect(),
        _ => {
            let mut v: Vec<f64> = (1..=12).flat_map(|m| (1..=12).map(move |n| (m * m) as f64 + (1.3 * n as f64).powi(2))).collect();
            v.sort_by(|a, b| a.total_cmp(b));
            v.iter().take(32).map(|f| f / v[0]).collect()
        }
    }
}

#[test]
fn verhaeltnisse_wie_veroeffentlicht() {
    for nr in 0..SAETZE.len() {
        let s = Satz::neu(nr);
        let soll = veroeffentlicht(nr);
        assert_eq!(s.n, if nr == 2 { 12 } else { 32 }, "{}", s.name);
        let mut schlimmst = 0.0f64;
        for (m, v) in soll.iter().enumerate() {
            let c = cent(s.verhaeltnis(m, 1.0), *v).abs();
            schlimmst = schlimmst.max(c);
            assert!(c < 0.01, "{} mode {m}: ratio {} vs published {v}", s.name, s.verhaeltnis(m, 1.0));
        }
        println!("MESS ratios {}: {} modes checked, worst {schlimmst:.2e} cent", s.name, soll.len());
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Coefficients over the whole grid of settings

fn einstellung() -> Einstellung { Einstellung { moden: 32, anregung: 0, burst_ms: 5.0, saat: 0 } }

fn eingabe(hz: f32, material: f32, hell: f32, groesse: f32, position: f32, inh: f32) -> Eingabe {
    Eingabe { hz, trig: 1.0, staerke: 1.0, x: 0.0, material, helligkeit: hell, groesse, position, inharmonie: inh }
}

/// Builds a fresh voice's coefficients for `x` (one strike sample).
fn gebaut(s: &Satz, sr: f32, x: Eingabe) -> Stimme {
    let e = einstellung();
    let mut v = Stimme::neu(0, &e);
    v.prozess(s, &e, sr, x);
    v
}

/// Mode frequency error bound of the coefficients: angle of the f32-rounded `r e^(iw)`.
const CENT_KOEFF: f64 = 0.001;
/// T60 bound of the coefficients: |z| is rounded to f32, 1 - r is 4.8e-6 at 30 s and 48 kHz.
const T60_KOEFF: f64 = 0.02;

#[test]
fn koeffizienten_treffen_frequenz_und_abklingzeit() {
    let (mut cent_max, mut t60_max, mut geprueft) = (0.0f64, 0.0f64, 0usize);
    for nr in 0..SAETZE.len() {
        let s = Satz::neu(nr);
        for sr in [44_100.0f32, 48_000.0, 96_000.0] {
            for hz in [27.5f32, 110.0, 440.0, 1760.0, 7040.0] {
                for (groesse, inh) in [(1.0f32, 1.0f32), (0.25, 0.0), (4.0, 2.0), (1.7, 0.5)] {
                    for material in [0.0f32, 0.5, 1.0] {
                        let v = gebaut(&s, sr, eingabe(hz, material, 0.5, groesse, 0.3, inh));
                        let eta = 0.1 * 10f64.powf(-4.0 * material as f64);
                        for m in 0..s.n {
                            let f = hz as f64 / groesse as f64 * s.verhaeltnis(m, inh as f64);
                            let (fi, ti, _) = v.modus(m, sr);
                            if !(f >= 10.0 && f < 0.45 * sr as f64) {
                                assert_eq!(fi, 0.0, "{} mode {m} at {f} Hz must be off", s.name);
                                continue;
                            }
                            let t_soll = (T60_KONST / (eta * f)).clamp(0.001, T60_MAX).max(10.0 / sr as f64);
                            let c = cent(fi, f).abs();
                            let t = (ti / t_soll - 1.0).abs();
                            assert!(c < CENT_KOEFF, "{} sr {sr} mode {m}: {fi} Hz vs {f} Hz ({c} cent)", s.name);
                            assert!(t < T60_KOEFF, "{} sr {sr} mode {m} {f} Hz: T60 {ti} vs {t_soll}", s.name);
                            cent_max = cent_max.max(c);
                            t60_max = t60_max.max(t);
                            geprueft += 1;
                        }
                    }
                }
            }
        }
    }
    println!("MESS coefficients: {geprueft} modes, worst {cent_max:.2e} cent (bound {CENT_KOEFF}), worst T60 {:.3} % (bound {} %)", 100.0 * t60_max, 100.0 * T60_KOEFF);
}

#[test]
fn inharmonie_null_ist_harmonisch_zwei_doppelt() {
    for nr in 0..SAETZE.len() {
        let s = Satz::neu(nr);
        for m in 0..s.n {
            let (r0, r1, r2) = (s.verhaeltnis(m, 0.0), s.verhaeltnis(m, 1.0), s.verhaeltnis(m, 2.0));
            // anchor: nearest harmonic, or subharmonic 1/k below 1
            let a = if r1 >= 1.0 { r1.round() } else { 1.0 / (1.0 / r1).round() };
            assert!((r0 - a).abs() < 1e-12, "{} mode {m}: inharmonie 0 gives {r0}, not {a}", s.name);
            assert!((cent(r2, a) - 2.0 * cent(r1, a)).abs() < 1e-6, "{} mode {m}: deviation not doubled", s.name);
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Mode frequencies and decays in the sound

/// Mode frequency bound measured in the output (phase advance of a Blackman-Harris DFT, neighbours more than 40 Hz away).
const CENT_KLANG: f64 = 0.05;

#[test]
fn modenfrequenzen_im_klang_auf_cent() {
    let (len, hop) = (16_384, 8_192);
    for (nr, hz) in [(0usize, 110.0f64), (1, 110.0), (2, 440.0), (3, 300.0), (4, 220.0), (5, 300.0), (6, 150.0)] {
        let x = anschlag(&format!(r#","satz":{nr},"material":0.9,"helligkeit":1,"position":0.37"#), hz, 480 + len + hop);
        let soll: Vec<f64> = veroeffentlicht(nr).iter().map(|r| r * hz).filter(|f| *f < 0.4 * SR as f64).collect();
        let (mut schlimmst, mut gemessen) = (0.0f64, 0);
        for (m, f) in soll.iter().enumerate() {
            if soll.iter().enumerate().any(|(k, g)| k != m && (g - f).abs() < 40.0) { continue; }
            let (re, im) = dft(&x, 480, len, *f);
            if (re * re + im * im).sqrt() < 1e-3 { continue; } // a node at this strike position
            let c = cent(frequenz(&x, 480, len, hop, *f), *f);
            assert!(c.abs() < CENT_KLANG, "{} mode {m}: {c:+.4} cent at {f:.1} Hz", SAETZE[nr]);
            schlimmst = schlimmst.max(c.abs());
            gemessen += 1;
        }
        println!("MESS frequencies {}: {gemessen} of {} modes measured, worst {schlimmst:.4} cent (bound {CENT_KLANG})", SAETZE[nr], soll.len());
        assert!(gemessen >= soll.len().min(6), "{}: only {gemessen} modes measurable", SAETZE[nr]);
    }
}

/// Decay bound measured in the output.
const T60_KLANG: f64 = 0.03;

#[test]
fn abklingzeit_je_mode_wie_vorgegeben() {
    for (nr, hz, material) in [(2usize, 440.0f64, 0.6f32), (0, 220.0, 0.6), (4, 330.0, 0.25), (5, 600.0, 0.2), (3, 500.0, 0.5)] {
        let eta = 0.1 * 10f64.powf(-4.0 * material as f64);
        let len = 8_192;
        let x = anschlag(&format!(r#","satz":{nr},"material":{material},"helligkeit":1,"position":0.37"#), hz, 3 * 48_000);
        let soll: Vec<f64> = veroeffentlicht(nr).iter().map(|r| r * hz).filter(|f| *f < 0.4 * SR as f64).collect();
        let (mut schlimmst, mut gemessen) = (0.0f64, 0);
        for (m, f) in soll.iter().enumerate() {
            if soll.iter().enumerate().any(|(k, g)| k != m && (g - f).abs() < 30.0) { continue; }
            let t_soll = (T60_KONST / (eta * f)).clamp(0.001, T60_MAX);
            // two windows 20 dB of the mode's decay apart (at most 2 s), the first after 10 ms
            let abstand = ((t_soll / 3.0 * SR as f64) as usize).clamp(len / 4, 96_000);
            let (re, im) = dft(&x, 480 + abstand, len, *f);
            if (re * re + im * im).sqrt() < 1e-4 { continue; } // node, or gone before the second window
            let t = t60(&x, 480, len, abstand, *f);
            let d = t / t_soll - 1.0;
            assert!(d.abs() < T60_KLANG, "{} mode {m} at {f:.1} Hz: T60 {t:.4} s vs {t_soll:.4} s ({:+.2} %)", SAETZE[nr], 100.0 * d);
            schlimmst = schlimmst.max(d.abs());
            gemessen += 1;
        }
        println!("MESS decay {} material {material}: {gemessen} modes measured, worst {:.2} % (bound {} %)", SAETZE[nr], 100.0 * schlimmst, 100.0 * T60_KLANG);
        assert!(gemessen >= 4, "{}: only {gemessen} modes measurable", SAETZE[nr]);
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Stability

#[test]
fn stabil_bei_allen_einstellungen() {
    // every pole inside the unit circle and no decay above 30 s over a grid of all knobs, sets and sample rates
    let mut groesster = 0.0f64;
    let mut laengste = 0.0f64;
    let mut faelle = 0usize;
    for nr in 0..SAETZE.len() {
        let s = Satz::neu(nr);
        for sr in [22_050.0f32, 44_100.0, 48_000.0, 96_000.0, 192_000.0] {
            for hz in [0.0f32, 5.0, 20.0, 1000.0, 20_000.0, 1e6] {
                for material in [0.0f32, 0.5, 1.0] {
                    for hell in [0.0f32, 1.0] {
                        for (groesse, inh) in [(0.25f32, 0.0f32), (4.0, 2.0), (1.0, 1.0)] {
                            for position in [0.0f32, 0.5, 1.0] {
                                let v = gebaut(&s, sr, eingabe(hz, material, hell, groesse, position, inh));
                                groesster = groesster.max(v.groesster_pol());
                                for m in 0..MAX_MODEN {
                                    laengste = laengste.max(v.modus(m, sr).1);
                                }
                                faelle += 1;
                            }
                        }
                    }
                }
            }
        }
    }
    println!("MESS stability: {faelle} settings, largest |z| {groesster:.9}, longest T60 {laengste:.2} s");
    assert!(groesster < 1.0, "pole on or outside the unit circle: |z| = {groesster}");
    // f32 rounding of |z| moves T60 by up to 3e-8 / (1 - r): 2.5 % at 30 s and 192 kHz
    assert!(laengste <= T60_MAX * 1.05, "T60 {laengste} s above the 30 s limit");
}

#[test]
fn laute_dauerlast_bleibt_begrenzt() {
    // every knob on a regler swept between its ends every 64 samples while a noise input at full scale drives the bank
    // and notes strike 16 voices: the output stays finite and below the bound sqrt(32) * strikes + input gain
    let g = graph(r#","satz":5,"anregung":1,"saat":3"#, 16,
                  r#",{"id":"k1","art":"regler","nr":1,"min":0,"max":1},{"id":"k2","art":"regler","nr":2,"min":0,"max":1},{"id":"k3","art":"regler","nr":3,"min":0.25,"max":4},{"id":"k4","art":"regler","nr":4,"min":0,"max":1},{"id":"k5","art":"regler","nr":5,"min":0,"max":2},{"id":"z","art":"rauschen"}"#,
                  r#",{"von":"n.hz","nach":"r.hz"},{"von":"n.vel","nach":"r.staerke"},{"von":"k1.aus","nach":"r.material"},{"von":"k2.aus","nach":"r.helligkeit"},{"von":"k3.aus","nach":"r.groesse"},{"von":"k4.aus","nach":"r.position"},{"von":"k5.aus","nach":"r.inharmonie"},{"von":"z.aus","nach":"r.x"}"#);
    let mut p = lade(&g);
    let mut spitze = 0.0f32;
    for i in 0..4 * 48_000usize {
        if i % 3_000 == 0 { p.note_an(24 + (i / 3_000 % 90) as u8, 1.0); }
        if i % 64 == 0 {
            for k in 1..=5 { p.setze_regler(k, if (i / 64 + k) % 3 == 0 { 0.0 } else if (i / 64 + k) % 3 == 1 { 1.0 } else { 0.5 }); }
        }
        let y = p.sample();
        assert!(y.is_finite(), "sample {i} not finite");
        spitze = spitze.max(y.abs());
    }
    println!("MESS sweep under load: peak {spitze:.3}");
    assert_eq!(p.rettungen, 0, "the guard had to rescue the graph");
    assert!(spitze < 200.0, "peak {spitze}");
}

#[test]
fn unsinnige_eingaenge_bleiben_endlich() {
    // two knobs over +-1e30 multiply to +-inf or large values; times 0 the infinities become NaN. Every input gets one.
    let g = graph(r#","satz":2,"anregung":1"#, 1,
                  r#",{"id":"k1","art":"regler","nr":1,"min":-1e30,"max":1e30},{"id":"k2","art":"regler","nr":2,"min":-1e30,"max":1e30},{"id":"g","art":"mul"},{"id":"nan","art":"mul","b":0}"#,
                  r#",{"von":"k1.aus","nach":"g.a"},{"von":"k2.aus","nach":"g.b"},{"von":"g.aus","nach":"nan.a"},{"von":"g.aus","nach":"r.hz"},{"von":"nan.aus","nach":"r.material"},{"von":"g.aus","nach":"r.helligkeit"},{"von":"nan.aus","nach":"r.groesse"},{"von":"g.aus","nach":"r.position"},{"von":"nan.aus","nach":"r.inharmonie"},{"von":"g.aus","nach":"r.staerke"},{"von":"g.aus","nach":"r.x"}"#);
    let mut p = lade(&g);
    for (a, b) in [(1.0, 1.0), (0.0, 1.0), (1.0, 0.5), (0.5, 0.5), (0.500_001, 0.500_001), (0.499_999, 0.500_001), (1.0, 1.0)] {
        p.setze_regler(1, a);
        p.setze_regler(2, b);
        p.note_an(60, 1.0);
        assert!(lauf(&mut p, 2_000).iter().all(|v| v.is_finite()));
    }
    assert_eq!(p.rettungen, 0, "the guard had to rescue the graph");
}

// ---------------------------------------------------------------------------------------------------------------------
// Strike position, brightness, excitation

fn pegel_db(x: &[f32], f: f64) -> f64 {
    let (re, im) = dft(x, 240, 8_192, f);
    10.0 * (re * re + im * im).max(1e-30).log10()
}

#[test]
fn anschlagposition_folgt_den_knotenlinien() {
    // bar struck at the centre (p = 1): the antisymmetric modes 2 and 4 have a node there and stay silent; off centre they
    // sound. Membrane struck at the centre: only the (0, n) modes, the (1, 1) mode (ratio 1.593) is silent.
    let fall = |satz: usize, hz: f64, pos: f32, verh: f64| {
        let x = anschlag(&format!(r#","satz":{satz},"material":0.8,"helligkeit":1,"position":{pos}"#), hz, 9_000);
        pegel_db(&x, hz * verh) - pegel_db(&x, hz)
    };
    let stab2 = (stab_beta(2) / stab_beta(1)).powi(2);
    let stab4 = (stab_beta(4) / stab_beta(1)).powi(2);
    let membran11 = 3.831_706 / 2.404_826;
    for (name, satz, hz, verh) in [("stab mode 2", 0usize, 200.0, stab2), ("stab mode 4", 0, 200.0, stab4), ("membran (1,1)", 5, 200.0, membran11)] {
        let (mitte, aussen) = (fall(satz, hz, 1.0, verh), fall(satz, hz, 0.6, verh));
        println!("MESS position {name}: centre {mitte:+.1} dB, p 0.6 {aussen:+.1} dB against the fundamental");
        assert!(mitte < -60.0, "{name}: {mitte:+.1} dB at the centre, a node expects < -60 dB");
        assert!(aussen > -30.0, "{name}: {aussen:+.1} dB off centre, the mode must sound");
    }
}

#[test]
fn helligkeit_macht_heller() {
    // free end of the bar (all modes at full shape): the level of mode 4 (2.6 kHz) against mode 1 (200 Hz) rises with the
    // brightness as the mallet roll-off 1 / (1 + (f / fc)^2), fc = 50 Hz * 2^(9 b), predicts (-37.5 dB at b = 0, 0 dB at 1)
    let mode4 = 200.0 * (stab_beta(4) / stab_beta(1)).powi(2);
    let mut werte = Vec::new();
    for b in [0.0, 0.25, 0.5, 0.75, 1.0] {
        let x = anschlag(&format!(r#","satz":0,"position":0,"material":0.8,"helligkeit":{b}"#), 200.0, 9_000);
        let d = pegel_db(&x, mode4) - pegel_db(&x, 200.0);
        let fc = 50.0 * 2f64.powf(9.0 * b);
        let soll = 20.0 * ((1.0 + (200.0 / fc).powi(2)) / (1.0 + (mode4 / fc).powi(2))).log10();
        println!("MESS brightness {b}: mode 4 against mode 1 {d:+.2} dB, predicted {soll:+.2} dB");
        assert!((d - soll).abs() < 0.5, "brightness {b}: {d:+.2} dB, predicted {soll:+.2} dB");
        werte.push(d);
    }
    assert!(werte[4] - werte[0] > 30.0, "brightness range too small: {werte:?}");
}

fn energie(x: &[f32]) -> f64 { x.iter().map(|v| (*v as f64).powi(2)).sum() }

#[test]
fn rauschanregung_so_laut_wie_der_impuls() {
    // unit-energy burst: averaged over seeds, the struck energy matches the impulse within 2 dB
    let imp = energie(&anschlag(r#","satz":0,"material":0.6"#, 220.0, 48_000));
    let mut summe = 0.0;
    for saat in 0..8 {
        summe += energie(&anschlag(&format!(r#","satz":0,"material":0.6,"anregung":1,"burst":3,"saat":{saat}"#), 220.0, 48_000));
    }
    let db = 10.0 * (summe / 8.0 / imp).log10();
    println!("MESS noise burst against impulse: {db:+.2} dB");
    assert!(db.abs() < 2.0, "burst energy {db:+.2} dB against the impulse");
}

/// Steady output level (dB) for a sine of `f` Hz at amplitude 0.5 on the audio input.
fn sinus_pegel(material: f32, f: f64) -> f64 {
    let g = graph(&format!(r#","satz":2,"hz":440,"material":{material},"helligkeit":1,"position":0"#), 1,
                  &format!(r#",{{"id":"s","art":"sinus","hz":{f}}},{{"id":"m","art":"mul","b":0.5}}"#),
                  r#",{"von":"s.aus","nach":"m.a"},{"von":"m.aus","nach":"r.x"}"#);
    let mut p = lade(&g);
    lauf(&mut p, 5 * 48_000); // the slowest mode (hum at 220 Hz, material 0.5: T60 10 s, tau 1.4 s) settles to 3e-2 dB
    let x = lauf(&mut p, 48_000);
    10.0 * (energie(&x) / x.len() as f64).log10()
}

#[test]
fn audioeingang_resoniert_mit_gleichem_pegel_bei_jedem_material() {
    // the input gain 2 (1 - r) makes the peak gain of a mode independent of its decay: a sine on the prime (440 Hz) comes
    // out at the same level for a damped and a ringing material; between two modes it is far below
    let (kurz, lang) = (sinus_pegel(0.2, 440.0), sinus_pegel(0.5, 440.0));
    let daneben = sinus_pegel(0.5, 480.0);
    println!("MESS audio input: on the prime {kurz:.1} dB (material 0.2), {lang:.1} dB (0.5); between modes {daneben:.1} dB");
    assert!((kurz - lang).abs() < 1.0, "peak gain depends on the decay: {kurz:.1} vs {lang:.1} dB");
    assert!(lang - daneben > 20.0, "no resonance: {lang:.1} on the mode vs {daneben:.1} dB beside it");
    assert!(lang > -40.0 && lang < 0.0, "level {lang:.1} dB");
}

// ---------------------------------------------------------------------------------------------------------------------
// Determinism and silence

fn spiel(g: &str) -> Vec<f32> {
    let mut p = lade(g);
    let mut x = Vec::new();
    for n in [57u8, 60, 64, 57] {
        p.note_an(n, 0.9);
        x.extend(lauf(&mut p, 6_000));
    }
    x
}

#[test]
fn gleicher_graph_gleicher_klang_andere_saat_anderer_klang() {
    let g = graph(r#","satz":5,"anregung":1"#, 4, "", r#",{"von":"n.hz","nach":"r.hz"}"#);
    let (a, b) = (spiel(&g), spiel(&g));
    assert!(a.iter().zip(&b).all(|(x, y)| x.to_bits() == y.to_bits()), "two loads of the same graph differ");
    let c = spiel(&graph(r#","satz":5,"anregung":1,"saat":1"#, 4, "", r#",{"von":"n.hz","nach":"r.hz"}"#));
    assert!(a.iter().zip(&c).any(|(x, y)| x != y), "another seed must give another burst");
}

#[test]
fn still_ohne_anschlag() {
    let mut p = lade(&graph(r#","hz":440"#, 2, "", ""));
    assert!(lauf(&mut p, 48_000).iter().all(|v| *v == 0.0));
}

#[test]
fn nur_steigende_flanke_schlaegt_an() {
    // a trig held high strikes once, not every sample
    let g = graph(r#","hz":440,"material":0"#, 1, r#",{"id":"k","art":"konst","wert":1}"#, "").replace(r#"{"von":"n.trig","nach":"r.trig"}"#, r#"{"von":"k.aus","nach":"r.trig"}"#);
    let mut p = lade(&g);
    let x = lauf(&mut p, 48_000);
    let spitze = x.iter().fold(0.0f32, |m, v| m.max(v.abs()));
    assert!(spitze > 0.05 && spitze < (MAX_MODEN as f32).sqrt(), "peak {spitze}");
    assert!(x[40_000..].iter().all(|v| v.abs() < 1e-6), "the bank must ring out (one strike only)");
}

#[test]
fn modenzahl_begrenzt_die_bank() {
    // moden 1 leaves only the lowest mode: a pure decaying sine at the pitch
    let x = anschlag(r#","satz":0,"moden":1,"helligkeit":1"#, 300.0, 16_384);
    let haupt = pegel_db(&x, 300.0);
    let zweite = pegel_db(&x, 300.0 * (stab_beta(2) / stab_beta(1)).powi(2));
    assert!(haupt - zweite > 80.0, "mode 2 present with moden 1: {haupt:.1} vs {zweite:.1} dB");
    let _ = resonator::STEUER;
}

#[test]
fn neuer_anschlag_baut_sofort_die_neue_tonhoehe() {
    // the coefficients are rebuilt at once on a strike, not at the next control step: a voice that rang out at 220 Hz and
    // is struck at 440 Hz between two control steps plays exactly what a fresh voice struck at 440 Hz plays
    let g = graph(r#","material":0"#, 1, "", r#",{"von":"n.hz","nach":"r.hz"}"#);
    let mut alt = lade(&g);
    alt.note_an(57, 1.0);
    lauf(&mut alt, 20_005); // rung out (T60 0.1 s), 20005 is not a multiple of the 32-sample control step
    alt.note_aus(57);
    alt.note_an(69, 1.0);
    let a = lauf(&mut alt, 256);
    let mut frisch = lade(&g);
    frisch.note_an(69, 1.0);
    let b = lauf(&mut frisch, 256);
    let d = a.iter().zip(&b).fold(0.0f32, |m, (x, y)| m.max((x - y).abs()));
    assert!(d < 1e-6, "the new note starts on the old coefficients (difference {d})");
    assert!(b.iter().any(|v| v.abs() > 0.01), "positive control: the strike sounds");
}
