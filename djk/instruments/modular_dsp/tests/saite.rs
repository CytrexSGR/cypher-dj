//! The `saite` block (type 37): pitch, decay, damping, pick position, DC, stability, exciters, determinism and robustness.
//! Everything except the design checks goes through the public JSON API, so the numbers are what a graph plays. Every key
//! check has a mutation that turns it red; the mutations and their red output are listed in `REPORT-string.md`.
use baukasten_dsp::saite::{self, ANREGER, KOERPER};
use baukasten_dsp::{uebersetze, Fehler, Programm, ARTEN};
use std::f64::consts::TAU;

const SR: f32 = 48_000.0;

/// A graph with one string node `s` (its values appended from `werte`), a note whose trig strikes it, and extra nodes and
/// edges; `s.aus` goes to the output (mono, both sides).
fn graph(werte: &str, stimmen: usize, knoten: &str, kanten: &str) -> String {
    format!(
        r#"{{"format":"baukasten/2","name":"saite-test","stimmen":{stimmen},"knoten":[{{"id":"s","art":"saite"{werte}}},{{"id":"n","art":"note"}},{{"id":"o","art":"ausgang"}}{knoten}],"kanten":[{{"von":"s.aus","nach":"o.x"}},{{"von":"n.trig","nach":"s.trig"}}{kanten}]}}"#
    )
}

fn lade(g: &str, sr: f32) -> Programm { uebersetze(g, sr).unwrap_or_else(|e| panic!("{e}: {g}")) }

fn lauf(p: &mut Programm, n: usize) -> Vec<f32> { (0..n).map(|_| p.sample_stereo().0).collect() }

/// One strike of a string with `werte` (the pitch comes from the value `hz`), `sekunden` long.
fn anschlag(werte: &str, sr: f32, sekunden: f64) -> Vec<f32> {
    let mut p = lade(&graph(werte, 1, "", ""), sr);
    p.note_an(60, 1.0);
    lauf(&mut p, (sekunden * sr as f64) as usize)
}

#[test]
fn saite_ist_art_37_mit_ein_und_ausgaengen() {
    let p = ARTEN.iter().position(|a| a.art == "saite").expect("ARTEN has no saite");
    // type 37: types are numbered in merge order; saite was merged after granular (36).
    assert_eq!(p, 37, "saite is type 37 (merge order), index {p} of {}", ARTEN.len());
    assert_eq!(ARTEN[32].art, "wavetable", "existing type numbers must not move");
    let a = &ARTEN[p];
    assert_eq!(a.ein, &["x", "hz", "trig", "vel", "ausklang", "daempfung", "hell", "lage", "koerper_mix"]);
    assert_eq!(a.aus, &["aus"]);
    assert!(a.werte.is_empty());
    for f in [("anreger", 1.0), ("koerper", 0.0), ("saat", 0.0), ("vel", 1.0), ("ausklang", 2.0), ("daempfung", 0.5), ("hell", 0.5), ("lage", 0.13), ("koerper_mix", 0.5)] {
        assert!(a.frei.contains(&f), "{f:?}");
    }
}

#[test]
fn werte_werden_geprueft() {
    let ok = |v: &str| uebersetze(&graph(v, 1, "", ""), SR);
    for v in [r#","anreger":4"#, r#","anreger":0.5"#, r#","anreger":-1"#, r#","koerper":4"#, r#","koerper":1.5"#, r#","saat":-1"#,
              r#","saat":70000"#, r#","vel":1.1"#, r#","ausklang":0.005"#, r#","ausklang":61"#, r#","daempfung":-0.1"#,
              r#","daempfung":1.1"#, r#","hell":2"#, r#","lage":0.01"#, r#","lage":0.6"#, r#","koerper_mix":1.5"#, r#","hz":10"#, r#","hz":6001"#] {
        assert!(matches!(ok(v), Err(Fehler::Wert { .. })), "{v}: {:?}", ok(v).err());
    }
    for v in ["", r#","anreger":3"#, r#","anreger":0"#, r#","koerper":3"#, r#","saat":65535"#, r#","vel":0"#, r#","ausklang":0.01"#,
              r#","ausklang":60"#, r#","daempfung":1"#, r#","hell":0"#, r#","lage":0.02"#, r#","lage":0.5"#, r#","koerper_mix":1"#,
              r#","hz":20"#, r#","hz":6000"#] {
        assert!(ok(v).is_ok(), "{v}: {:?}", ok(v).err());
    }
    assert!(matches!(ok(r#","fremd":1"#), Err(Fehler::UnbekannterWert { .. })));
}

// ---------------------------------------------------------------------------------------------------------------------
// Measurement tools: a Hann-windowed demodulation at a given frequency

fn demod(x: &[f32], start: usize, len: usize, f: f64, sr: f64) -> (f64, f64) {
    let (mut re, mut im, mut wsum) = (0.0f64, 0.0f64, 0.0f64);
    for i in 0..len {
        let w = 0.5 - 0.5 * (TAU * (i as f64 + 0.5) / len as f64).cos();
        let ph = TAU * f * (start + i) as f64 / sr;
        let v = x[start + i] as f64 * w;
        re += v * ph.cos();
        im -= v * ph.sin();
        wsum += w;
    }
    // phase (against absolute time) and amplitude of the component at f
    (im.atan2(re), 2.0 * re.hypot(im) / wsum)
}

fn wickeln(p: f64) -> f64 { (p + std::f64::consts::PI).rem_euclid(TAU) - std::f64::consts::PI }

/// Frequency of the partial near `f_nom`, from the phase advance between two windows at growing distances (4 periods,
/// 40 periods or 0.2 s, 0.6 s). The windows are 16 periods (at least 20 ms) long. An exponential decay has the same shape
/// in both windows, so it does not bias the phase difference.
fn frequenz(x: &[f32], sr: f64, f_nom: f64, start: usize) -> f64 {
    let per = sr / f_nom;
    let lw = (16.0 * per).max(0.02 * sr) as usize;
    let mut f = f_nom;
    for t in [4.0 * per, (40.0 * per).min(0.2 * sr), 0.6 * sr] {
        let t = t.round() as usize;
        let d = wickeln(demod(x, start + t, lw, f, sr).0 - demod(x, start, lw, f, sr).0);
        f += d * sr / (TAU * t as f64);
    }
    f
}

fn cent(ist: f64, soll: f64) -> f64 { 1200.0 * (ist / soll).log2() }

/// T60 of the component at `f` whose neighbours are `abstand` Hz away: level in frames of 8 periods of `abstand` (at least
/// 4 ms; the Hann window then separates the neighbours), hop a quarter frame, straight line through the frames from 5 dB
/// to 35 dB below the peak (frames after the peak only).
fn t60(x: &[f32], sr: f64, f: f64, abstand: f64) -> f64 {
    let lw = (8.0 * sr / abstand.min(f)).max(0.004 * sr) as usize;
    let hop = (lw / 4).max(1);
    let pegel: Vec<(f64, f64)> = (0..).map(|i| i * hop).take_while(|s| s + lw <= x.len())
        .map(|s| ((s as f64 + lw as f64 / 2.0) / sr, 20.0 * demod(x, s, lw, f, sr).1.max(1e-30).log10())).collect();
    let (ispitze, spitze) = pegel.iter().enumerate().fold((0, f64::NEG_INFINITY), |m, (i, p)| if p.1 > m.1 { (i, p.1) } else { m });
    let punkte: Vec<(f64, f64)> = pegel[ispitze..].iter().filter(|p| p.1 <= spitze - 5.0 && p.1 >= spitze - 35.0).cloned().collect();
    assert!(punkte.len() >= 8, "too few frames for the decay fit at {f} Hz ({})", punkte.len());
    let n = punkte.len() as f64;
    let (mt, ml) = (punkte.iter().map(|p| p.0).sum::<f64>() / n, punkte.iter().map(|p| p.1).sum::<f64>() / n);
    let steigung = punkte.iter().map(|p| (p.0 - mt) * (p.1 - ml)).sum::<f64>() / punkte.iter().map(|p| (p.0 - mt).powi(2)).sum::<f64>();
    -60.0 / steigung
}

#[test]
fn messwerkzeuge_treffen_einen_bekannten_ton() {
    // positive control of the tools: a decaying sine of known frequency and T60
    for (sr, f, t) in [(48_000.0f64, 27.5f64, 2.0f64), (48_000.0, 4186.009, 0.5), (96_000.0, 1234.5678, 1.0)] {
        let k = 3.0 * 10f64.ln() / (t * sr);
        let x: Vec<f32> = (0..(1.5 * sr) as usize).map(|i| ((-k * i as f64).exp() * (TAU * f * i as f64 / sr + 0.3).sin()) as f32).collect();
        let c = cent(frequenz(&x, sr, f * 1.01, 4800), f);
        assert!(c.abs() < 1e-3, "{f} Hz: estimator off by {c} cent");
        let x: Vec<f32> = (0..((0.7 * t + 0.2) * sr) as usize).map(|i| ((-k * i as f64).exp() * (TAU * f * i as f64 / sr).sin()) as f32).collect();
        let m = t60(&x, sr, f, f);
        assert!((m / t - 1.0).abs() < 0.0005, "{f} Hz: T60 tool {m} vs {t}");
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Pitch

/// Largest allowed pitch error of the fundamental. The design is exact to rounding; the measured worst case and the
/// error of the textbook allpass coefficient are in the report.
const CENT_GRENZE: f64 = 0.01;

#[test]
fn tonhoehe_auf_hundertstel_cent_ueber_den_ganzen_bereich() {
    let mut schlimmst = (0.0f64, String::new());
    for sr in [44_100.0f32, 48_000.0, 96_000.0] {
        for hz in [27.5f64, 41.2034, 55.0, 110.0, 261.6256, 440.0, 1046.502, 2093.005, 3322.438, 4186.009] {
            for dmp in [0.0, 0.5, 1.0] {
                let x = anschlag(&format!(r#","hz":{hz},"ausklang":4,"daempfung":{dmp}"#), sr, 1.5);
                let c = cent(frequenz(&x, sr as f64, hz, (0.1 * sr) as usize), hz);
                println!("MESS pitch sr {sr} {hz:9.3} Hz damping {dmp}: {c:+.5} cent");
                if c.abs() > schlimmst.0 {
                    schlimmst = (c.abs(), format!("sr {sr} {hz} Hz damping {dmp}"));
                }
            }
        }
    }
    println!("MESS pitch worst: {:.5} cent ({})", schlimmst.0, schlimmst.1);
    assert!(schlimmst.0 < CENT_GRENZE, "pitch error {:.5} cent at {}, limit {CENT_GRENZE}", schlimmst.0, schlimmst.1);
}

#[test]
fn tonhoehe_folgt_kleinen_spruengen_und_vibrato() {
    // a pitch that moves by less than 2 % keeps the loss pole (cheap path): after the move the pitch is exact again
    let g = graph(r#","ausklang":4,"daempfung":0.7"#, 1, r#",{"id":"k","art":"regler","nr":1,"min":200,"max":250}"#, r#",{"von":"k.aus","nach":"s.hz"}"#);
    let mut schlimmst = 0.0f64;
    for (von, nach) in [(220.0f64, 222.0f64), (240.0, 236.5), (220.0, 220.01)] {
        let mut p = lade(&g, SR);
        p.setze_regler(1, ((von - 200.0) / 50.0) as f32);
        p.note_an(60, 1.0);
        lauf(&mut p, 4_800);
        p.setze_regler(1, ((nach - 200.0) / 50.0) as f32);
        let x = lauf(&mut p, 72_000);
        // the knob is an f32: compare against the value it really sends
        let soll = (200.0f32 + 50.0 * ((nach - 200.0) / 50.0) as f32) as f64;
        let c = cent(frequenz(&x, SR as f64, soll, 2_400), soll);
        println!("MESS pitch after a move {von} -> {nach} Hz: {c:+.5} cent");
        schlimmst = schlimmst.max(c.abs());
    }
    assert!(schlimmst < CENT_GRENZE, "pitch after a small move off by {schlimmst:.5} cent");
    // vibrato on every sample: finite, never rescued
    let g = graph(r#","ausklang":4,"anreger":2"#, 2, r#",{"id":"l","art":"lfo","rate":6},{"id":"lc","art":"mul","b":30},{"id":"t","art":"transponiere"}"#,
                  r#",{"von":"n.hz","nach":"t.hz"},{"von":"l.aus","nach":"lc.a"},{"von":"lc.aus","nach":"t.cent"},{"von":"t.aus","nach":"s.hz"}"#);
    let mut p = lade(&g, SR);
    p.note_an(45, 1.0);
    p.note_an(81, 1.0);
    assert!(lauf(&mut p, 48_000).iter().all(|v| v.is_finite()));
    assert_eq!(p.rettungen, 0);
}

// ---------------------------------------------------------------------------------------------------------------------
// Decay

/// Largest allowed relative T60 error of the fundamental against the knob. The design is exact to rounding (pole
/// placement); the tools measure a known decay to better than 0.05 %.
const T60_GRENZE: f64 = 0.002;

#[test]
fn ausklang_trifft_den_knopf_auf_zwei_promille() {
    let mut schlimmst = (0.0f64, String::new());
    let mut faelle = Vec::new();
    for hz in [55.0f64, 220.0, 880.0, 3520.0] {
        for t in [0.1f64, 0.5, 2.0, 8.0] {
            // a decay must span some periods to be a decay of a tone: at least 40 periods
            if hz * t < 40.0 { continue; }
            for dmp in [0.0, 0.5, 1.0] {
                faelle.push((48_000.0f32, hz, t, dmp));
            }
        }
    }
    faelle.extend([(96_000.0, 220.0, 2.0, 0.5), (96_000.0, 3520.0, 0.5, 1.0), (44_100.0, 110.0, 1.0, 0.7)]);
    for (sr, hz, t, dmp) in faelle {
        let x = anschlag(&format!(r#","hz":{hz},"ausklang":{t},"daempfung":{dmp}"#), sr, 0.7 * t + 0.25);
        let m = t60(&x, sr as f64, hz, hz);
        let fehler = m / t - 1.0;
        println!("MESS decay sr {sr} {hz:6.0} Hz T60 {t:4.1} s damping {dmp}: measured {m:.4} s ({:+.2} %)", 100.0 * fehler);
        if fehler.abs() > schlimmst.0 {
            schlimmst = (fehler.abs(), format!("sr {sr} {hz} Hz T60 {t} damping {dmp}"));
        }
    }
    println!("MESS decay worst: {:.2} % ({})", 100.0 * schlimmst.0, schlimmst.1);
    assert!(schlimmst.0 < T60_GRENZE, "T60 off by {:.2} % at {}, limit {} %", 100.0 * schlimmst.0, schlimmst.1, 100.0 * T60_GRENZE);
}

#[test]
fn daempfung_kuerzt_die_oberen_teiltoene_wie_entworfen() {
    // the measured T60 of partials 2, 4 and 8 follows the design (`Schleife::t60_bei`, loop gain and group delay at the
    // partial); at damping 0 every partial decays like the fundamental
    let (sr, hz, t) = (48_000.0f64, 220.0f64, 2.0f64);
    let mut schlimmst = 0.0f64;
    for dmp in [0.0, 0.3, 0.6] {
        let s = saite::entwurf(hz, sr, t, dmp);
        let x = anschlag(&format!(r#","hz":{hz},"ausklang":{t},"daempfung":{dmp},"hell":1,"lage":0.31"#), sr as f32, 0.7 * t + 0.25);
        for k in [2usize, 4, 8] {
            let fk = frequenz(&x, sr, k as f64 * hz, 2_400);
            let soll = s.t60_bei(TAU * fk / sr, sr);
            let ist = t60(&x, sr, fk, hz);
            let fehler = ist / soll - 1.0;
            println!("MESS damping {dmp} partial {k} ({fk:.2} Hz): T60 measured {ist:.4} s, designed {soll:.4} s ({:+.2} %)", 100.0 * fehler);
            schlimmst = schlimmst.max(fehler.abs());
            if dmp == 0.0 {
                assert!((ist / t - 1.0).abs() < 0.01, "damping 0: partial {k} T60 {ist} instead of {t}");
            } else {
                assert!(ist < t, "damping {dmp}: partial {k} decays no faster than the fundamental ({ist} s)");
            }
        }
    }
    assert!(schlimmst < 0.05, "partial T60 off the design by {:.2} %", 100.0 * schlimmst);
}

// ---------------------------------------------------------------------------------------------------------------------
// Pick position and exciters

/// Level of partial 2 against partial 1 in dB, 50 ms after the strike (frequencies measured).
fn h2_zu_h1(hz: f64, werte: &str) -> f64 {
    let sr = 48_000.0f64;
    let x = anschlag(&format!(r#","hz":{hz},"ausklang":3,"daempfung":0.2,"hell":1{werte}"#), sr as f32, 1.5);
    let lw = 4_800;
    let f1 = frequenz(&x, sr, hz, 2_400);
    let f2 = frequenz(&x, sr, 2.0 * hz, 2_400);
    20.0 * (demod(&x, 2_400, lw, f2, sr).1 / demod(&x, 2_400, lw, f1, sr).1).log10()
}

#[test]
fn anschlag_in_der_mitte_loescht_die_geraden_teiltoene() {
    // 1234.5 Hz: half a period is 19.44 samples, so a comb with an integer delay would miss the notch by 0.44 samples
    for hz in [220.0, 1234.5] {
        for anreger in 0..3 {
            let mitte = h2_zu_h1(hz, &format!(r#","anreger":{anreger},"lage":0.5"#));
            let rand = h2_zu_h1(hz, &format!(r#","anreger":{anreger},"lage":0.13"#));
            println!("MESS pick {hz} Hz {}: partial 2 vs 1 at lage 0.5 {mitte:.1} dB, at lage 0.13 {rand:.1} dB", ANREGER[anreger]);
            assert!(mitte < -35.0, "{hz} Hz {}: centre pluck leaves partial 2 at {mitte:.1} dB", ANREGER[anreger]);
            assert!(rand > -20.0, "{hz} Hz {}: positive control, partial 2 at lage 0.13 only {rand:.1} dB", ANREGER[anreger]);
        }
    }
}

/// Spectral centroid (Hz) of the first 100 ms after the strike, from a 4096-point DFT magnitude up to 12 kHz.
fn schwerpunkt(x: &[f32], sr: f64) -> f64 {
    let n = 4_096;
    let (mut s, mut g) = (0.0f64, 0.0f64);
    for b in 1..(12_000.0 * n as f64 / sr) as usize {
        let f = b as f64 * sr / n as f64;
        let a = demod(x, 0, n, f, sr).1;
        s += a * f;
        g += a;
    }
    s / g
}

#[test]
fn hell_macht_jeden_anreger_heller() {
    for anreger in 0..3 {
        let a = schwerpunkt(&anschlag(&format!(r#","hz":110,"anreger":{anreger},"hell":0"#), SR, 0.1), SR as f64);
        let b = schwerpunkt(&anschlag(&format!(r#","hz":110,"anreger":{anreger},"hell":1"#), SR, 0.1), SR as f64);
        println!("MESS brightness {}: centroid hell 0 {a:.0} Hz, hell 1 {b:.0} Hz", ANREGER[anreger]);
        assert!(b > 1.5 * a, "{}: hell 1 only moves the centroid from {a:.0} to {b:.0} Hz", ANREGER[anreger]);
    }
}

#[test]
fn harter_hammeranschlag_ist_lauter_und_heller() {
    // velocity from the note: the felt hammer's contact gets shorter with a harder strike (piano-like)
    let g = graph(r#","hz":110,"anreger":2,"hell":0.5"#, 1, "", r#",{"von":"n.vel","nach":"s.vel"}"#);
    let spiel = |vel: f32| {
        let mut p = lade(&g, SR);
        p.note_an(60, vel);
        lauf(&mut p, 4_800)
    };
    let (leise, laut) = (spiel(0.3), spiel(1.0));
    let pegel = |x: &[f32]| 10.0 * (x.iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / x.len() as f64).log10();
    let (sl, sh) = (schwerpunkt(&leise, SR as f64), schwerpunkt(&laut, SR as f64));
    println!("MESS hammer vel 0.3: {:.1} dB, centroid {sl:.0} Hz; vel 1: {:.1} dB, centroid {sh:.0} Hz", pegel(&leise), pegel(&laut));
    assert!(pegel(&laut) > pegel(&leise) + 6.0, "a hard strike must be louder");
    assert!(sh > 1.2 * sl, "a hard strike must be brighter ({sl:.0} -> {sh:.0} Hz)");
}

// ---------------------------------------------------------------------------------------------------------------------
// DC

#[test]
fn kein_gleichanteil_bei_jedem_anreger_und_koerper() {
    let mut schlimmst = f64::NEG_INFINITY;
    for anreger in 0..3 {
        for koerper in 0..KOERPER.len() {
            for hz in [55.0, 880.0] {
                let x = anschlag(&format!(r#","hz":{hz},"ausklang":8,"daempfung":0,"anreger":{anreger},"koerper":{koerper},"koerper_mix":1"#), SR, 4.0);
                let dc = x.iter().map(|v| *v as f64).sum::<f64>() / x.len() as f64;
                let spitze = x.iter().fold(0.0f32, |m, v| m.max(v.abs())) as f64;
                let db = 20.0 * (dc.abs() / spitze).max(1e-12).log10();
                println!("MESS dc {} body {} {hz} Hz: mean {dc:+.2e} ({db:.1} dB below the peak)", ANREGER[anreger], KOERPER[koerper]);
                schlimmst = schlimmst.max(db);
            }
        }
    }
    assert!(schlimmst < -60.0, "DC only {schlimmst:.1} dB below the peak");
}

#[test]
fn konstante_am_eingang_baut_sich_nicht_auf() {
    // a constant 0.5 on x for 20 s into the longest, least damped loop: the comb takes the DC out, the step at the start
    // rings and dies; nothing builds up
    let g = graph(r#","hz":20,"ausklang":60,"daempfung":0,"anreger":3"#, 1, r#",{"id":"k","art":"konst","wert":0.5}"#, r#",{"von":"k.aus","nach":"s.x"}"#);
    let mut p = lade(&g, SR);
    let x = lauf(&mut p, 20 * SR as usize);
    let sek = SR as usize;
    let spitze = |a: &[f32]| a.iter().fold(0.0f32, |m, v| m.max(v.abs()));
    let mittel = |a: &[f32]| a.iter().map(|v| *v as f64).sum::<f64>() / a.len() as f64;
    let (erste, letzte) = (spitze(&x[..sek]), spitze(&x[19 * sek..]));
    println!("MESS constant on x: peak first second {erste:.4}, last second {letzte:.4}, mean of the last 10 s {:+.2e}", mittel(&x[10 * sek..]));
    assert!(letzte <= erste, "the output grows under a constant input ({erste} -> {letzte})");
    assert!(mittel(&x[10 * sek..]).abs() < 1e-3, "DC on the output: {}", mittel(&x[10 * sek..]));
}

#[test]
fn tiefe_frequenzen_am_eingang_werden_nicht_verstaerkt() {
    // a 1 Hz sine on x into a strongly damped loop: the loss filter's DC gain is near 1 there, so only the DC blocker in
    // the loop keeps the loop from resonating near DC
    let g = graph(r#","hz":110,"ausklang":0.1,"daempfung":1,"anreger":3"#, 1,
                  r#",{"id":"l","art":"lfo","rate":1,"form":0},{"id":"a","art":"mul","b":0.5}"#, r#",{"von":"l.aus","nach":"a.a"},{"von":"a.aus","nach":"s.x"}"#);
    let mut p = lade(&g, SR);
    lauf(&mut p, SR as usize);
    let x = lauf(&mut p, 2 * SR as usize);
    let rms = (x.iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / x.len() as f64).sqrt();
    // without the loop: the comb alone gives 0.5 / sqrt(2) * 2 sin(pi * 1 Hz * M / sr), M = round(0.13 * sr / 110) = 57
    let kamm = 0.5 / 2f64.sqrt() * 2.0 * (std::f64::consts::PI * 57.0 / SR as f64).sin();
    println!("MESS 1 Hz on x: output rms {rms:.2e}, comb alone {kamm:.2e} (ratio {:.2})", rms / kamm);
    assert!(rms < 3.0 * kamm, "the loop amplifies 1 Hz by {:.1} over the comb alone", rms / kamm);
}

// ---------------------------------------------------------------------------------------------------------------------
// Stability

fn xorshift(z: &mut u32) -> f32 {
    *z ^= *z << 13;
    *z ^= *z >> 17;
    *z ^= *z << 5;
    *z as f32 / u32::MAX as f32
}

#[test]
fn stabil_bei_jedem_knopf_und_klingt_aus() {
    // every input on a knob over its full range; 160 random settings per exciter and body, each jumping to two more random
    // settings while it rings (pitch included), then the shortest decay: the output is finite, bounded, never rescued, and
    // has died away 0.6 s later
    let knoten = r#",{"id":"k1","art":"regler","nr":1,"min":20,"max":6000,"log":1},{"id":"k2","art":"regler","nr":2,"min":0.01,"max":60,"log":1},{"id":"k3","art":"regler","nr":3,"min":0,"max":1},{"id":"k4","art":"regler","nr":4,"min":0,"max":1},{"id":"k5","art":"regler","nr":5,"min":0.02,"max":0.5},{"id":"k6","art":"regler","nr":6,"min":0,"max":1},{"id":"k7","art":"regler","nr":7,"min":0,"max":1},{"id":"r","art":"rauschen"},{"id":"rx","art":"mul"},{"id":"k8","art":"regler","nr":8,"min":0,"max":1}"#;
    let kanten = r#",{"von":"k1.aus","nach":"s.hz"},{"von":"k2.aus","nach":"s.ausklang"},{"von":"k3.aus","nach":"s.daempfung"},{"von":"k4.aus","nach":"s.hell"},{"von":"k5.aus","nach":"s.lage"},{"von":"k6.aus","nach":"s.vel"},{"von":"k7.aus","nach":"s.koerper_mix"},{"von":"r.aus","nach":"rx.a"},{"von":"k8.aus","nach":"rx.b"},{"von":"rx.aus","nach":"s.x"}"#;
    let mut z = 0x1234_5678u32;
    let mut spitze = 0.0f32;
    let mut faelle = 0;
    for anreger in 0..ANREGER.len() {
        for koerper in 0..KOERPER.len() {
            let mut p = lade(&graph(&format!(r#","anreger":{anreger},"koerper":{koerper}"#), 1, knoten, kanten), SR);
            for _ in 0..10 {
                faelle += 1;
                let knoepfe = |p: &mut Programm, z: &mut u32| for nr in 1..=8 {
                    // edges count twice: the ends of each range are where instability would show first
                    let r = xorshift(z);
                    p.setze_regler(nr, if r < 0.1 { 0.0 } else if r > 0.9 { 1.0 } else { xorshift(z) });
                };
                knoepfe(&mut p, &mut z);
                p.note_an(60, 1.0);
                let mut x = lauf(&mut p, 6_000);
                knoepfe(&mut p, &mut z);
                p.note_an(62, 1.0);
                x.extend(lauf(&mut p, 6_000));
                knoepfe(&mut p, &mut z);
                x.extend(lauf(&mut p, 6_000));
                // shortest decay, no external excitation: everything must die away
                p.setze_regler(2, 0.0);
                p.setze_regler(8, 0.0);
                x.extend(lauf(&mut p, 28_800));
                assert!(x.iter().all(|v| v.is_finite()), "not finite");
                spitze = x.iter().fold(spitze, |m, v| m.max(v.abs()));
                let rest = x[x.len() - 2_400..].iter().fold(0.0f32, |m, v| m.max(v.abs()));
                assert!(rest < 1e-6, "{} body {}: still {rest} after 0.6 s at T60 10 ms", ANREGER[anreger], KOERPER[koerper]);
            }
            assert_eq!(p.rettungen, 0, "the guard had to rescue the graph");
        }
    }
    println!("MESS stability: {faelle} random settings, largest |output| {spitze:.3}");
    assert!(spitze <= 3.0 * saite::GRENZE, "output peak {spitze}");
}

#[test]
fn unsinnige_eingaenge_bleiben_endlich() {
    // two knobs over +-1e30 multiply to +-inf or to large finite values; times 0 the infinities become NaN. Every input of
    // the node gets one of them: the output stays finite and the guard never has to rescue the graph.
    let g = graph(r#","anreger":2,"koerper":3"#, 1,
                  r#",{"id":"k1","art":"regler","nr":1,"min":-1e30,"max":1e30},{"id":"k2","art":"regler","nr":2,"min":-1e30,"max":1e30},{"id":"g","art":"mul"},{"id":"nan","art":"mul","b":0}"#,
                  r#",{"von":"k1.aus","nach":"g.a"},{"von":"k2.aus","nach":"g.b"},{"von":"g.aus","nach":"nan.a"},{"von":"g.aus","nach":"s.hz"},{"von":"nan.aus","nach":"s.x"},{"von":"g.aus","nach":"s.vel"},{"von":"nan.aus","nach":"s.ausklang"},{"von":"g.aus","nach":"s.daempfung"},{"von":"nan.aus","nach":"s.hell"},{"von":"g.aus","nach":"s.lage"},{"von":"nan.aus","nach":"s.koerper_mix"}"#);
    let mut p = lade(&g, SR);
    for (a, b) in [(1.0, 1.0), (0.0, 1.0), (1.0, 0.5), (0.5, 0.5), (0.500_001, 0.500_001), (0.499_999, 0.500_001), (1.0, 1.0)] {
        p.setze_regler(1, a);
        p.setze_regler(2, b);
        p.note_an(60, 1.0);
        assert!(lauf(&mut p, 2_000).iter().all(|v| v.is_finite()));
    }
    assert_eq!(p.rettungen, 0, "the guard had to rescue the graph");
}

// ---------------------------------------------------------------------------------------------------------------------
// Determinism and the body

fn spiel(g: &str) -> Vec<f32> {
    let mut p = lade(g, SR);
    let mut x = Vec::new();
    for n in [45u8, 52, 57, 45] {
        p.note_an(n, 0.9);
        x.extend(lauf(&mut p, 6_000));
    }
    x
}

#[test]
fn gleicher_graph_gleicher_klang_andere_saat_anderer_klang() {
    let g = graph(r#","anreger":0"#, 4, "", r#",{"von":"n.hz","nach":"s.hz"}"#);
    let (a, b) = (spiel(&g), spiel(&g));
    assert!(a.iter().zip(&b).all(|(x, y)| x.to_bits() == y.to_bits()), "two loads of the same graph differ");
    let c = spiel(&graph(r#","anreger":0,"saat":1"#, 4, "", r#",{"von":"n.hz","nach":"s.hz"}"#));
    assert!(a.iter().zip(&c).any(|(x, y)| x != y), "another seed must give another noise burst");
}

#[test]
fn koerper_mix_null_ist_die_blanke_saite() {
    let blank = spiel(&graph(r#","koerper":0"#, 4, "", r#",{"von":"n.hz","nach":"s.hz"}"#));
    for koerper in 1..KOERPER.len() {
        let null = spiel(&graph(&format!(r#","koerper":{koerper},"koerper_mix":0"#), 4, "", r#",{"von":"n.hz","nach":"s.hz"}"#));
        assert!(blank.iter().zip(&null).all(|(x, y)| x.to_bits() == y.to_bits()), "{}: mix 0 is not the bare string", KOERPER[koerper]);
        let voll = spiel(&graph(&format!(r#","koerper":{koerper},"koerper_mix":1"#), 4, "", r#",{"von":"n.hz","nach":"s.hz"}"#));
        let d = blank.iter().zip(&voll).fold(0.0f32, |m, (x, y)| m.max((x - y).abs()));
        println!("MESS body {}: largest difference to the bare string {d:.3}", KOERPER[koerper]);
        assert!(d > 0.05, "{}: the body does not change the sound", KOERPER[koerper]);
    }
}
