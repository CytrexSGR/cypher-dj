//! Baukasten block `lpg` (type 59): low-pass gate with a vactrol model, after the Buchla 292 (Parker and D'Angelo, DAFx-13).
use baukasten_dsp::lpg::Lpg;
use baukasten_dsp::{uebersetze, Fehler, ARTEN};

mod common;

const SR: f32 = 48_000.0;

#[derive(Clone, Copy)]
struct Ein {
    x: f32,
    cv: f32,
    modus: f32,
    abkling: f32,
    reso: f32,
    versatz: f32,
}
impl Default for Ein {
    fn default() -> Self { Ein { x: 0.0, cv: 0.0, modus: 1.0, abkling: 1.0, reso: 0.0, versatz: 0.0 } }
}

fn lauf(n: usize, mut ein: impl FnMut(usize) -> Ein) -> Vec<f32> {
    let mut l = Lpg::default();
    (0..n).map(|i| {
        let e = ein(i);
        l.prozess(e.x, e.cv, e.modus, e.abkling, e.reso, e.versatz, SR)
    }).collect()
}

fn sinus(f: f32, i: usize) -> f32 { (2.0 * std::f32::consts::PI * f * i as f32 / SR).sin() }
fn saege(f: f32, i: usize) -> f32 { 2.0 * ((f * i as f32 / SR) % 1.0) - 1.0 }

fn rms(x: &[f32]) -> f64 { (x.iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / x.len() as f64).sqrt() }
fn db(v: f64) -> f64 { 20.0 * v.max(1e-12).log10() }

/// level in dB of a sine of frequency `f` (amplitude 1) through the gate at a steady `cv`
fn pegel_sinus(f: f32, cv: f32, modus: f32) -> f64 {
    let y = lauf(48_000, |i| Ein { x: sinus(f, i), cv, modus, ..Ein::default() });
    // one second in, the last quarter second, whole periods do not matter at this length
    db(rms(&y[36_000..]) * 2f64.sqrt())
}

#[test]
fn vca_modus_gain_folgt_cv_und_ist_bei_cv_eins_flach() {
    let frequenzen = [50.0f32, 100.0, 200.0, 500.0, 1000.0, 2000.0, 5000.0, 10_000.0];
    let pegel: Vec<f64> = frequenzen.iter().map(|f| pegel_sinus(*f, 1.0, 2.0)).collect();
    let (hi, lo) = (pegel.iter().cloned().fold(f64::MIN, f64::max), pegel.iter().cloned().fold(f64::MAX, f64::min));
    println!("MESS lpg VCA cv 1: {pegel:.2?} dB, spread {:.2} dB", hi - lo);
    assert!(hi - lo < 1.5, "flat within 1.5 dB, spread {}", hi - lo);
    assert!(pegel.iter().all(|p| p.abs() < 1.0), "unity gain at cv 1: {pegel:?}");
    let cvs = [1.0f32, 0.5, 0.2, 0.05, 0.01];
    let g: Vec<f64> = cvs.iter().map(|c| pegel_sinus(1000.0, *c, 2.0)).collect();
    println!("MESS lpg VCA gain at 1 kHz for cv {cvs:?}: {g:.1?} dB");
    assert!(g.windows(2).all(|w| w[1] < w[0] - 1.0), "gain falls with cv: {g:?}");
    assert!(g[1] > -6.0 && g[1] < -1.5, "cv 0.5 is about -3 dB: {}", g[1]);
    assert!(g[2] < -12.0 && g[2] > -25.0, "cv 0.2: {}", g[2]);
    assert!(g[3] < -35.0, "cv 0.05: {}", g[3]);
    // above 1 the resistance no longer drops: cv 1.5 is the same steady gain
    assert!((pegel_sinus(1000.0, 1.5, 2.0) - g[0]).abs() < 0.1);
}

#[test]
fn tiefpass_modus_nimmt_hoehen_vor_dem_pegel() {
    let hoch_offen = pegel_sinus(5000.0, 1.0, 0.0);
    let hoch_zu = pegel_sinus(5000.0, 0.05, 0.0);
    let tief_offen = pegel_sinus(100.0, 1.0, 0.0);
    let tief_zu = pegel_sinus(100.0, 0.05, 0.0);
    let (verlust_hoch, verlust_tief) = (hoch_offen - hoch_zu, tief_offen - tief_zu);
    println!("MESS lpg low-pass: 5 kHz loses {verlust_hoch:.1} dB, 100 Hz loses {verlust_tief:.1} dB from cv 1 to 0.05");
    assert!(verlust_hoch >= 30.0, "5 kHz loses {verlust_hoch} dB");
    assert!(verlust_tief < verlust_hoch / 2.0, "100 Hz loses {verlust_tief} dB");
    assert!(verlust_tief > 0.0);
}

fn schwerpunkt_saege(cv: f32, modus: f32) -> f64 {
    let y = lauf(48_000, |i| Ein { x: 0.5 * saege(220.0, i), cv, modus, ..Ein::default() });
    let s: Vec<(f32, f32)> = y[30_000..30_000 + 8192].iter().map(|v| (*v, *v)).collect();
    common::schwerpunkt(&s)
}

#[test]
fn beide_modus_pegel_und_helligkeit_fallen_zusammen() {
    let cvs = [1.0f32, 0.5, 0.2, 0.05];
    let c: Vec<f64> = cvs.iter().map(|v| schwerpunkt_saege(*v, 1.0)).collect();
    let p: Vec<f64> = cvs.iter().map(|v| {
        let y = lauf(48_000, |i| Ein { x: 0.5 * saege(220.0, i), cv: *v, modus: 1.0, ..Ein::default() });
        db(rms(&y[36_000..]))
    }).collect();
    println!("MESS lpg both: centroid {c:.0?} Hz, level {p:.1?} dB for cv {cvs:?}");
    assert!(c.windows(2).all(|w| w[1] < w[0]), "centroid falls monotonically: {c:?}");
    assert!(p.windows(2).all(|w| w[1] < w[0]), "level falls monotonically: {p:?}");
}

/// per-period peak envelope of `y` (sliding maximum of |y| over `fenster` samples)
fn huellkurve(y: &[f32], fenster: usize) -> Vec<f32> {
    (0..y.len()).map(|i| y[i.saturating_sub(fenster - 1)..=i].iter().fold(0.0f32, |m, v| m.max(v.abs()))).collect()
}

/// a 5 ms cv pulse of 1 on a steady 220 Hz saw, `n` samples
fn puls(abkling: f32, modus: f32, n: usize) -> Vec<f32> {
    lauf(n, |i| Ein { x: 0.5 * saege(220.0, i), cv: if (4800..4800 + 240).contains(&i) { 1.0 } else { 0.0 }, abkling, modus, ..Ein::default() })
}

fn abfall_20db_ms(y: &[f32]) -> f64 {
    let h = huellkurve(y, 218);
    let (ip, spitze) = h.iter().cloned().enumerate().fold((0, 0.0f32), |m, (i, v)| if v > m.1 { (i, v) } else { m });
    let ziel = spitze * 0.1;
    let i = (ip..h.len()).find(|&i| h[i] <= ziel).expect("reaches -20 dB");
    (i - ip) as f64 / SR as f64 * 1000.0
}

#[test]
fn vactrol_schnell_rein_langsam_raus_und_abkling_skaliert() {
    let mut ergebnis = Vec::new();
    for modus in [0.0f32, 1.0, 2.0] {
        let a1 = abfall_20db_ms(&puls(1.0, modus, 96_000));
        let a4 = abfall_20db_ms(&puls(4.0, modus, 3 * 96_000));
        println!("MESS lpg modus {modus}: -20 dB after {a1:.1} ms at abkling 1, {a4:.1} ms at abkling 4 (x{:.2})", a4 / a1);
        ergebnis.push((modus, a1, a4));
    }
    for (modus, a1, a4) in ergebnis {
        assert!(a1 > 30.0 && a1 < 300.0, "modus {modus}: -20 dB after {a1} ms");
        assert!(a4 >= 2.5 * a1, "modus {modus}: abkling 4 gives {a4} ms against {a1} ms");
    }
    // rise 10..90 % of the peak envelope
    for modus in [0.0f32, 1.0, 2.0] {
        let y = puls(1.0, modus, 48_000);
        let h = huellkurve(&y, 218);
        let spitze = h.iter().cloned().fold(0.0f32, f32::max);
        let t10 = (4800..h.len()).find(|&i| h[i] >= 0.1 * spitze).unwrap();
        let t90 = (4800..h.len()).find(|&i| h[i] >= 0.9 * spitze).unwrap();
        let ms = (t90 - t10) as f64 / SR as f64 * 1000.0;
        println!("MESS lpg modus {modus}: 10..90 % rise {ms:.2} ms");
        assert!(ms < 10.0, "modus {modus}: rise {ms} ms");
    }
}

#[test]
fn abgeklungen_cv_null_nach_zwei_sekunden_unter_minus_80_dbfs() {
    for modus in [0.0f32, 1.0, 2.0] {
        // cold start
        let y = lauf(96_000, |i| Ein { x: saege(220.0, i), cv: 0.0, modus, ..Ein::default() });
        assert!(y.iter().all(|v| v.abs() < 1e-4), "modus {modus}: closed from the start");
        // after a pulse, full-scale saw: 2 s later at most -80 dBFS
        let y = lauf(4 * 48_000, |i| Ein { x: saege(220.0, i), cv: if i < 240 { 1.0 } else { 0.0 }, modus, ..Ein::default() });
        let spitze = y[96_000..].iter().fold(0.0f32, |m, v| m.max(v.abs()));
        println!("MESS lpg modus {modus}: peak {:.1} dBFS from 2 s after the pulse", db(spitze as f64));
        assert!(db(spitze as f64) <= -80.0, "modus {modus}: {} dBFS", db(spitze as f64));
    }
}

#[test]
fn stille_nach_dem_ausklang_ist_exakt_null() {
    for modus in [0.0f32, 1.0, 2.0] {
        // a hit, then silence on x and cv 0; abkling 1: closed long before 20 s
        let y = lauf(20 * 48_000, |i| Ein { x: if i < 4800 { saege(330.0, i) } else { 0.0 }, cv: if i < 2400 { 1.0 } else { 0.0 }, modus, reso: 0.5, ..Ein::default() });
        assert!(y[19 * 48_000..].iter().all(|v| *v == 0.0), "modus {modus}: exact zeros after the tail");
        assert!(y.iter().all(|v| *v == 0.0 || v.is_normal()), "modus {modus}: no denormal in the run");
    }
    // silence in with the gate held open: the filter drains to exact zero too
    let y = lauf(10 * 48_000, |i| Ein { x: if i < 480 { 1.0 } else { 0.0 }, cv: 1.0, modus: 0.0, ..Ein::default() });
    assert!(y[9 * 48_000..].iter().all(|v| *v == 0.0 || v.is_normal()));
    assert!(y.last().unwrap().abs() < 1e-20);
}

fn rauschen(zustand: &mut u32) -> f32 {
    *zustand = zustand.wrapping_mul(1664525).wrapping_add(1013904223);
    (*zustand >> 8) as f32 / 8_388_608.0 - 1.0
}

#[test]
fn stabil_bei_vollaussteuerung_mit_cv_im_audiobereich() {
    for modus in [0.0f32, 1.0, 2.0] {
        for reso in [0.0f32, 1.0] {
            let mut z = 7u32;
            let y = lauf(5 * 48_000, |i| Ein { x: rauschen(&mut z), cv: 0.5 + 0.5 * sinus(3000.0, i), modus, reso, ..Ein::default() });
            let m = y.iter().fold(0.0f32, |m, v| m.max(v.abs()));
            println!("MESS lpg noise + audio-rate cv, modus {modus} reso {reso}: peak {m:.2}");
            assert!(y.iter().all(|v| v.is_finite()), "modus {modus}: finite");
            assert!(m < 30.0, "modus {modus} reso {reso}: peak {m}");
        }
    }
    // square-wave cv at audio rate, full scale
    let mut z = 3u32;
    let y = lauf(5 * 48_000, |i| Ein { x: rauschen(&mut z), cv: if (i / 20) % 2 == 0 { 1.5 } else { 0.0 }, modus: 0.0, reso: 1.0, ..Ein::default() });
    assert!(y.iter().all(|v| v.is_finite() && v.abs() < 30.0));
}

#[test]
fn modus_wechsel_im_klang_bleibt_endlich() {
    let mut z = 11u32;
    let mut wahl = 5u32;
    let y = lauf(4 * 48_000, |i| {
        if i % 997 == 0 { wahl = wahl.wrapping_mul(1103515245).wrapping_add(12345); }
        Ein { x: rauschen(&mut z), cv: 1.0, modus: ((wahl >> 16) % 3) as f32, reso: 0.9, ..Ein::default() }
    });
    assert!(y.iter().all(|v| v.is_finite() && v.abs() < 50.0));
    // and sample by sample, every sample a different mode
    let y = lauf(48_000, |i| Ein { x: saege(110.0, i), cv: 0.7, modus: (i % 3) as f32, reso: 1.0, ..Ein::default() });
    assert!(y.iter().all(|v| v.is_finite() && v.abs() < 50.0));
    // non-finite inputs read their defaults
    let y = lauf(5000, |_| Ein { x: f32::NAN, cv: f32::INFINITY, modus: f32::NAN, abkling: f32::NAN, reso: f32::NEG_INFINITY, versatz: f32::NAN });
    assert!(y.iter().all(|v| v.is_finite()));
}

#[test]
fn versatz_wird_zu_cv_addiert_und_ist_deterministisch() {
    let a = lauf(48_000, |i| Ein { x: saege(220.0, i), cv: 0.25, versatz: 0.5, modus: 2.0, ..Ein::default() });
    let b = lauf(48_000, |i| Ein { x: saege(220.0, i), cv: 0.75, modus: 2.0, ..Ein::default() });
    assert_eq!(a.iter().map(|v| v.to_bits()).collect::<Vec<_>>(), b.iter().map(|v| v.to_bits()).collect::<Vec<_>>());
    let c = lauf(48_000, |i| Ein { x: saege(220.0, i), cv: 0.25, versatz: 0.5, modus: 2.0, ..Ein::default() });
    assert_eq!(a.iter().map(|v| v.to_bits()).collect::<Vec<_>>(), c.iter().map(|v| v.to_bits()).collect::<Vec<_>>());
    // versatz lifts a closed gate open: cv 0 plus versatz 1 sounds
    let o = lauf(48_000, |i| Ein { x: saege(220.0, i), versatz: 1.0, modus: 2.0, ..Ein::default() });
    assert!(rms(&o[24_000..]) > 0.3);
}

#[test]
fn resonanz_hebt_den_tiefpass_nahe_der_grenze() {
    // low-pass mode, steady cv: the response near the corner rises with reso, and 100 Hz stays about where it was
    let spitze = |reso: f32| -> f64 {
        [200.0f32, 300.0, 450.0, 700.0, 1000.0, 1500.0, 2200.0].iter().map(|f| {
            let y = lauf(48_000, |i| Ein { x: sinus(*f, i), cv: 0.1, modus: 0.0, reso, ..Ein::default() });
            db(rms(&y[36_000..]) * 2f64.sqrt())
        }).fold(f64::MIN, f64::max)
    };
    let (r0, r1) = (spitze(0.0), spitze(1.0));
    println!("MESS lpg low-pass cv 0.1: highest response {r0:.1} dB at reso 0, {r1:.1} dB at reso 1");
    assert!(r1 > r0 + 3.0, "reso adds a peak: {r0} -> {r1}");
}

#[test]
fn als_baustein_im_graphen() {
    let g = r#"{"format":"baukasten/2","name":"l","stimmen":2,"knoten":[{"id":"n","art":"note"},{"id":"s","art":"saege"},{"id":"f","art":"funktion","steigen":0.001,"fallen":0.05},{"id":"l","art":"lpg","modus":2},{"id":"o","art":"ausgang"}],
        "kanten":[{"von":"n.hz","nach":"s.hz"},{"von":"n.trig","nach":"f.trig"},{"von":"s.aus","nach":"l.x"},{"von":"f.aus","nach":"l.cv"},{"von":"l.aus","nach":"o.x"}]}"#;
    let mut p = uebersetze(g, SR).unwrap();
    assert_eq!(p.latenz(), 0);
    p.note_an(57, 1.0);
    let y: Vec<f32> = (0..48_000).map(|_| p.sample()).collect();
    assert!(y[..4800].iter().fold(0.0f32, |m, v| m.max(v.abs())) > 0.2, "sounds on the trigger");
    assert!(y[40_000..].iter().all(|v| v.abs() < 1e-3), "and dies away");
    let d = ARTEN.iter().find(|a| a.art == "lpg").unwrap();
    assert_eq!(d.ein, &["x", "cv", "modus", "abkling", "reso", "versatz"]);
    assert_eq!(d.aus, &["aus"]);
    assert_eq!(ARTEN.iter().position(|a| a.art == "lpg"), Some(59));
}

#[test]
fn werte_ausser_bereich_werden_abgelehnt() {
    let mit = |werte: &str| format!(r#"{{"format":"baukasten/2","name":"f","stimmen":1,"knoten":[{{"id":"l","art":"lpg",{werte}}},{{"id":"o","art":"ausgang"}}],"kanten":[{{"von":"l.aus","nach":"o.x"}}]}}"#);
    for (w, name) in [(r#""cv":1.6"#, "cv"), (r#""cv":-0.1"#, "cv"), (r#""modus":3"#, "modus"), (r#""abkling":0.05"#, "abkling"), (r#""abkling":11"#, "abkling"), (r#""reso":1.2"#, "reso"), (r#""versatz":2"#, "versatz")] {
        match uebersetze(&mit(w), SR) {
            Err(Fehler::Wert { wert, .. }) => assert_eq!(wert, name, "{w}"),
            Err(e) => panic!("{w}: wrong error {e:?}"),
            Ok(_) => panic!("{w}: accepted"),
        }
    }
    assert!(uebersetze(&mit(r#""cv":1.5,"modus":0,"abkling":10,"reso":1,"versatz":-1.5"#), SR).is_ok());
}
