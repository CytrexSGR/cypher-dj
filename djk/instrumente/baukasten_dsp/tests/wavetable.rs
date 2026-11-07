//! The `wavetable` block (type 32): band limit, pitch, morph, unison loudness, determinism and robustness. Everything goes
//! through the public JSON API, so the numbers are what a graph plays. Every key check has a mutation that turns it red;
//! the mutations and their red output are listed in `BERICHT-wavetable.md`.
use baukasten_dsp::{uebersetze, Fehler, Programm, ARTEN};
use realfft::RealFftPlanner;

const SR: f32 = 48_000.0;

/// A graph with one wavetable node `w` (its values appended from `werte`) and extra nodes/edges; `l`/`r` go to the output.
fn graph(werte: &str, stimmen: usize, knoten: &str, kanten: &str) -> String {
    format!(
        r#"{{"format":"baukasten/2","name":"wt","stimmen":{stimmen},"knoten":[{{"id":"w","art":"wavetable"{werte}}},{{"id":"o","art":"ausgang"}}{knoten}],"kanten":[{{"von":"w.l","nach":"o.l"}},{{"von":"w.r","nach":"o.r"}}{kanten}]}}"#
    )
}

/// The node driven by a note (hz and trig).
fn mit_note(werte: &str, stimmen: usize) -> String {
    graph(werte, stimmen, r#",{"id":"n","art":"note"}"#, r#",{"von":"n.hz","nach":"w.hz"},{"von":"n.trig","nach":"w.trig"}"#)
}

fn lade(g: &str) -> Programm { uebersetze(g, SR).unwrap_or_else(|e| panic!("{e}: {g}")) }

fn lauf(p: &mut Programm, n: usize) -> Vec<(f32, f32)> { (0..n).map(|_| p.sample_stereo()).collect() }

#[test]
fn wavetable_ist_art_32_mit_ein_und_ausgaengen() {
    let a = ARTEN.get(32).expect("ARTEN has no entry 32 (wavetable)");
    assert_eq!(a.art, "wavetable");
    assert_eq!(a.ein, &["hz", "trig", "pos", "verstimmung", "breite"]);
    assert_eq!(a.aus, &["l", "r", "aus"]);
    assert!(a.werte.is_empty());
    for f in [("tabelle", 0.0), ("kopien", 1.0), ("pos", 0.0), ("verstimmung", 0.0), ("breite", 0.0), ("zufall", 1.0), ("saat", 0.0), ("glatt", 10.0)] {
        assert!(a.frei.contains(&f), "{f:?}");
    }
    assert_eq!(ARTEN[31].art, "faltung", "existing type numbers must not move");
}

#[test]
fn werte_werden_geprueft() {
    let ok = |v: &str| uebersetze(&mit_note(v, 1), SR);
    for v in [r#","tabelle":7"#, r#","tabelle":1.5"#, r#","tabelle":-1"#, r#","kopien":0"#, r#","kopien":8"#, r#","kopien":2.5"#,
              r#","pos":1.1"#, r#","pos":-0.1"#, r#","verstimmung":50.5"#, r#","verstimmung":-1"#, r#","breite":1.01"#,
              r#","zufall":2"#, r#","saat":-1"#, r#","saat":0.5"#, r#","saat":70000"#, r#","glatt":-1"#, r#","glatt":1001"#] {
        assert!(matches!(ok(v), Err(Fehler::Wert { .. })), "{v}: {:?}", ok(v).err());
    }
    for v in ["", r#","tabelle":6"#, r#","kopien":7"#, r#","kopien":1"#, r#","pos":1"#, r#","verstimmung":50"#, r#","breite":1"#,
              r#","zufall":0"#, r#","saat":65535"#, r#","glatt":0"#, r#","glatt":1000"#] {
        assert!(ok(v).is_ok(), "{v}: {:?}", ok(v).err());
    }
    assert!(matches!(ok(r#","fremd":1"#), Err(Fehler::UnbekannterWert { .. })));
}

// ---------------------------------------------------------------------------------------------------------------------
// Aliasing

/// FFT length of the alias measurement. With f = sr * m / N (m odd) the phase step is exactly m * 2^16 in the u32
/// accumulator, so the output repeats after exactly N samples: a rectangular window sees pure lines, no leakage, and every
/// bin that is not a multiple of m is alias (or interpolation image) energy.
const N_FFT: usize = 65_536;

/// Alias energy below 20 kHz relative to the total energy, in dB, for a node with `werte` at f = sr * m / N.
fn alias_db(werte: &str, m: usize) -> f64 {
    let hz = SR as f64 * m as f64 / N_FFT as f64;
    let g = graph(&format!(r#","hz":{hz}{werte}"#), 1, "", "");
    let mut p = lade(&g);
    lauf(&mut p, 4_800); // the position smoother settles, the phase is anywhere
    let mut x: Vec<f64> = lauf(&mut p, N_FFT).iter().map(|v| v.0 as f64).collect();
    let mut fft = RealFftPlanner::<f64>::new();
    let r2c = fft.plan_fft_forward(N_FFT);
    let mut spek = r2c.make_output_vec();
    r2c.process(&mut x, &mut spek).unwrap();
    let grenze = (20_000.0 * N_FFT as f64 / SR as f64) as usize;
    let (mut alias, mut summe) = (0.0f64, 0.0f64);
    for (b, c) in spek.iter().enumerate().skip(1) {
        let e = c.norm_sqr();
        summe += e;
        if b <= grenze && b % m != 0 {
            alias += e;
        }
    }
    10.0 * (alias / summe).max(1e-30).log10()
}

/// Odd m for frequencies from 20 Hz to 10 kHz in sixth-octave steps (54 frequencies).
fn sweep() -> Vec<usize> {
    let mut v = Vec::new();
    let mut f = 20.0f64;
    while f <= 10_000.0 * 1.0001 {
        let m = (f * N_FFT as f64 / SR as f64).round() as usize | 1;
        v.push(m);
        f *= 2f64.powf(1.0 / 6.0);
    }
    v
}

const ALIAS_GRENZE_DB: f64 = -80.0;

#[test]
fn saege_aliasing_unter_minus_80_db_von_20_hz_bis_10_khz() {
    let mut schlimmst = (f64::NEG_INFINITY, 0.0);
    for m in sweep() {
        let db = alias_db(r#","tabelle":0"#, m);
        let hz = SR as f64 * m as f64 / N_FFT as f64;
        println!("MESS alias saege {hz:8.1} Hz: {db:7.1} dB");
        if db > schlimmst.0 {
            schlimmst = (db, hz);
        }
    }
    println!("MESS alias saege worst: {:.1} dB at {:.1} Hz", schlimmst.0, schlimmst.1);
    assert!(schlimmst.0 < ALIAS_GRENZE_DB, "alias energy {:.1} dB at {:.1} Hz, limit {ALIAS_GRENZE_DB} dB", schlimmst.0, schlimmst.1);
}

#[test]
fn andere_tabellen_und_unison_bleiben_unter_der_aliasgrenze() {
    // the hardest other spectra (narrowest pulse, square, vowels) and a seven-copy stack, on a coarser sweep. The stack
    // has no detune here: only then is every copy N-periodic and on the lines; detuned copies use the same level choice
    // per copy (their own frequency), which the saw sweep covers.
    for werte in [r#","tabelle":1,"pos":1"#, r#","tabelle":4,"pos":1"#, r#","tabelle":5,"pos":0.5"#, r#","tabelle":0,"kopien":7"#] {
        let mut schlimmst = (f64::NEG_INFINITY, 0.0);
        for m in sweep().into_iter().step_by(3) {
            let db = alias_db(werte, m);
            if db > schlimmst.0 {
                schlimmst = (db, SR as f64 * m as f64 / N_FFT as f64);
            }
        }
        println!("MESS alias {werte} worst: {:.1} dB at {:.1} Hz", schlimmst.0, schlimmst.1);
        assert!(schlimmst.0 < ALIAS_GRENZE_DB, "{werte}: {:.1} dB at {:.1} Hz", schlimmst.0, schlimmst.1);
    }
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

/// Largest allowed pitch error. The phase step is a u32 (2^-32 of a period), its f32 source has 24 bits: about 1e-4 cent.
const CENT_GRENZE: f64 = 0.01;

#[test]
fn tonhoehe_auf_hundertstel_cent() {
    let mut schlimmst = 0.0f64;
    for sr in [44_100.0f32, 48_000.0, 96_000.0] {
        for hz in [27.5f64, 55.0, 110.0, 261.6256, 440.0, 1760.0, 4186.0, 7040.0] {
            let mut p = uebersetze(&graph(&format!(r#","tabelle":3,"hz":{hz}"#), 1, "", ""), sr).unwrap();
            let x: Vec<f32> = (0..sr as usize).map(|_| p.sample_stereo().0).collect();
            let c = cent(frequenz(&x, sr), hz);
            println!("MESS pitch sr {sr} {hz:8.2} Hz: {c:+.5} cent");
            schlimmst = schlimmst.max(c.abs());
        }
    }
    assert!(schlimmst < CENT_GRENZE, "pitch error {schlimmst:.5} cent, limit {CENT_GRENZE}");
}

#[test]
fn unison_kopien_liegen_auf_ihrer_verstimmung() {
    // two copies, full width: the left side holds only copy 0 (-d cent), the right side only copy 1 (+d cent)
    for d in [5.0f64, 17.0, 50.0] {
        let mut p = lade(&graph(&format!(r#","tabelle":3,"hz":440,"kopien":2,"breite":1,"verstimmung":{d}"#), 1, "", ""));
        let x = lauf(&mut p, 96_000);
        let (l, r): (Vec<f32>, Vec<f32>) = x.into_iter().unzip();
        let (cl, cr) = (cent(frequenz(&l, SR), 440.0), cent(frequenz(&r, SR), 440.0));
        println!("MESS unison detune {d}: left {cl:+.4} cent, right {cr:+.4} cent");
        assert!((cl + d).abs() < CENT_GRENZE && (cr - d).abs() < CENT_GRENZE, "detune {d}: left {cl}, right {cr}");
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Morph

/// Largest step between neighbouring samples caused by a full position jump 0 -> 1 on the knob, phase frozen (hz 0), so
/// every step is the morph's own. Bound: smoothing 10 ms gives k = 1 - e^(-1/480) = 0.0021 of the remaining way per
/// sample; the way is at most 3 frames of the `analog` table, whose neighbouring frames differ by at most ~1.2, summed over
/// three copies with gain 1/sqrt(3): 0.0021 * 3 * 1.2 * sqrt(3) = 0.013. Stated bound 0.02.
const MORPH_SCHRITT_GRENZE: f32 = 0.02;

fn morph_schritt(werte: &str) -> (f32, f32) {
    let g = graph(&format!(r#","tabelle":4,"kopien":3{werte}"#), 4, r#",{"id":"k","art":"regler","nr":1,"min":0,"max":1}"#, r#",{"von":"k.aus","nach":"w.pos"}"#);
    let mut p = lade(&g);
    p.setze_regler(1, 0.0);
    let vor = lauf(&mut p, 2_000);
    p.setze_regler(1, 1.0);
    let x = [vor, lauf(&mut p, 48_000)].concat();
    let schritt = x.windows(2).fold(0.0f32, |m, w| m.max((w[1].0 - w[0].0).abs()).max((w[1].1 - w[0].1).abs()));
    // the morph really happened: the frozen value at the end differs from the start
    let weg = (x[x.len() - 1].0 - x[0].0).abs() + (x[x.len() - 1].1 - x[0].1).abs();
    (schritt, weg)
}

#[test]
fn morph_ohne_sprung() {
    let (schritt, weg) = morph_schritt("");
    println!("MESS morph: largest step {schritt:.5} (bound {MORPH_SCHRITT_GRENZE}), total change {weg:.3}");
    assert!(weg > 0.2, "positive control: the jump must move the output ({weg})");
    assert!(schritt < MORPH_SCHRITT_GRENZE, "step {schritt} above {MORPH_SCHRITT_GRENZE}");
    // control: without smoothing the same jump is one large step (the bound is not trivially met)
    let (roh, _) = morph_schritt(r#","glatt":0"#);
    println!("MESS morph unsmoothed (glatt 0): largest step {roh:.5}");
    assert!(roh > 10.0 * MORPH_SCHRITT_GRENZE, "unsmoothed step only {roh}");
}

#[test]
fn neue_note_beginnt_an_der_position_ohne_nachlauf() {
    // a trig puts the smoother on the target: a note started after the knob moved plays the new frame at once
    let g = graph(r#","tabelle":4,"glatt":500"#, 1, r#",{"id":"n","art":"note"},{"id":"k","art":"regler","nr":1,"min":0,"max":1}"#,
                  r#",{"von":"n.hz","nach":"w.hz"},{"von":"n.trig","nach":"w.trig"},{"von":"k.aus","nach":"w.pos"}"#);
    let mut a = lade(&g);
    a.setze_regler(1, 0.0);
    lauf(&mut a, 1_000);
    a.setze_regler(1, 1.0);
    a.note_an(57, 1.0);
    let mut b = lade(&g);
    b.setze_regler(1, 1.0);
    b.note_an(57, 1.0);
    // same seed, same voice, one trig each: the onset depends on the random numbers drawn so far, so compare levels only
    let ea = lauf(&mut a, 2_400).iter().map(|v| v.0 * v.0).sum::<f32>();
    let eb = lauf(&mut b, 2_400).iter().map(|v| v.0 * v.0).sum::<f32>();
    let db = 10.0 * (ea / eb).log10();
    println!("MESS onset after knob move vs fresh at the same position: {db:+.2} dB");
    // frame 0 (sine) is 3 dB below frame 3 (square) in energy: a 500 ms glide from 0 would show here
    assert!(db.abs() < 1.0, "the note started away from the knob position ({db:+.2} dB)");
}

// ---------------------------------------------------------------------------------------------------------------------
// Unison loudness

fn pegel_db(x: &[(f32, f32)]) -> f64 {
    let q: f64 = x.iter().map(|(l, r)| (*l as f64).powi(2) + (*r as f64).powi(2)).sum::<f64>() / (2 * x.len()) as f64;
    10.0 * q.log10()
}

/// Mean level over four seeds of a held A4 (2 s after a 0.25 s settle) with `kopien` copies.
fn unison_pegel(kopien: usize, verstimmung: f32, breite: f32) -> f64 {
    let mut summe = 0.0;
    for saat in 0..4 {
        let mut p = lade(&mit_note(&format!(r#","kopien":{kopien},"verstimmung":{verstimmung},"breite":{breite},"saat":{saat}"#), 1));
        p.note_an(69, 1.0);
        lauf(&mut p, 12_000);
        summe += pegel_db(&lauf(&mut p, 96_000));
    }
    summe / 4.0
}

const LAUTHEIT_GRENZE_DB: f64 = 1.0;

#[test]
fn unison_lautheit_bleibt_gleich() {
    let eins = unison_pegel(1, 20.0, 0.5);
    let mut schlimmst = 0.0f64;
    for n in 2..=7 {
        let d = unison_pegel(n, 20.0, 0.5) - eins;
        println!("MESS unison loudness {n} copies: {d:+.2} dB against one copy");
        schlimmst = schlimmst.max(d.abs());
    }
    for (n, b) in [(2, 1.0f32), (7, 1.0), (7, 0.0)] {
        let d = unison_pegel(n, 20.0, b) - eins;
        println!("MESS unison loudness {n} copies, width {b}: {d:+.2} dB");
        schlimmst = schlimmst.max(d.abs());
    }
    assert!(schlimmst < LAUTHEIT_GRENZE_DB, "loudness moves {schlimmst:.2} dB across copies and widths, limit {LAUTHEIT_GRENZE_DB}");
}

// ---------------------------------------------------------------------------------------------------------------------
// Determinism and random start phase

fn spiel(g: &str) -> Vec<(f32, f32)> {
    let mut p = lade(g);
    let mut x = Vec::new();
    for (i, n) in [57u8, 60, 64, 57].iter().enumerate() {
        p.note_an(*n, 0.9);
        x.extend(lauf(&mut p, 6_000));
        if i % 2 == 1 {
            p.note_aus(*n);
        }
    }
    x
}

#[test]
fn gleicher_graph_gleicher_klang_andere_saat_anderer_klang() {
    let g = mit_note(r#","kopien":5,"verstimmung":15,"breite":0.7"#, 4);
    let (a, b) = (spiel(&g), spiel(&g));
    let ungleich = a.iter().zip(&b).filter(|(x, y)| x.0.to_bits() != y.0.to_bits() || x.1.to_bits() != y.1.to_bits()).count();
    assert_eq!(ungleich, 0, "{ungleich} samples differ between two loads of the same graph");
    let c = spiel(&mit_note(r#","kopien":5,"verstimmung":15,"breite":0.7,"saat":1"#, 4));
    assert!(a.iter().zip(&c).any(|(x, y)| x.0 != y.0), "another seed must give other start phases");
}

/// Onsets (first 1000 samples) of the same note struck three times on one voice.
fn anschlaege(werte: &str) -> Vec<Vec<f32>> {
    let mut p = lade(&mit_note(werte, 1));
    (0..3).map(|_| {
        p.note_an(57, 0.9);
        let x: Vec<f32> = lauf(&mut p, 1_000).iter().map(|v| v.0).collect();
        lauf(&mut p, 3_000);
        x
    }).collect()
}

#[test]
fn jede_note_hat_eigene_startphasen() {
    let a = anschlaege(r#","kopien":3,"verstimmung":10"#);
    for i in 1..3 {
        let d = a[0].iter().zip(&a[i]).fold(0.0f32, |m, (x, y)| m.max((x - y).abs()));
        println!("MESS onset 0 vs {i}, zufall 1: max difference {d:.4}");
        assert!(d > 0.1, "strike {i} starts like strike 0 (difference {d}): the start phases are not random per note");
    }
    // zufall 0: every strike resets all copies to phase 0, so the onsets are the same (positive control of the measure)
    let b = anschlaege(r#","kopien":3,"verstimmung":10,"zufall":0"#);
    for i in 1..3 {
        let d = b[0].iter().zip(&b[i]).fold(0.0f32, |m, (x, y)| m.max((x - y).abs()));
        assert!(d < 1e-6, "zufall 0: strike {i} differs by {d}");
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Robustness

#[test]
fn unsinnige_eingaenge_bleiben_endlich() {
    // two knobs over +-1e30 multiply to +-inf or to large finite values; times 0 the infinities become NaN. Every input of
    // the node gets one of them: the output stays finite and the guard never has to rescue the graph.
    let g = graph(r#","kopien":7,"tabelle":5"#, 1,
                  r#",{"id":"k1","art":"regler","nr":1,"min":-1e30,"max":1e30},{"id":"k2","art":"regler","nr":2,"min":-1e30,"max":1e30},{"id":"g","art":"mul"},{"id":"nan","art":"mul","b":0}"#,
                  r#",{"von":"k1.aus","nach":"g.a"},{"von":"k2.aus","nach":"g.b"},{"von":"g.aus","nach":"nan.a"},{"von":"g.aus","nach":"w.hz"},{"von":"nan.aus","nach":"w.pos"},{"von":"g.aus","nach":"w.verstimmung"},{"von":"nan.aus","nach":"w.breite"},{"von":"g.aus","nach":"w.trig"}"#);
    let mut p = lade(&g);
    for (a, b) in [(1.0, 1.0), (0.0, 1.0), (1.0, 0.5), (0.5, 0.5), (0.500_001, 0.500_001), (0.499_999, 0.500_001), (1.0, 1.0)] {
        p.setze_regler(1, a);
        p.setze_regler(2, b);
        for (l, r) in lauf(&mut p, 2_000) {
            assert!(l.is_finite() && r.is_finite());
        }
    }
    assert_eq!(p.rettungen, 0, "the guard had to rescue the graph");
}

#[test]
fn mono_ausgang_ist_die_summe_ohne_panorama() {
    // with width 0 the pan gains are 1 on both sides, so l, r and aus are the same signal
    let g = format!(
        r#"{{"format":"baukasten/2","name":"wt","stimmen":1,"knoten":[{{"id":"w","art":"wavetable","hz":110,"kopien":5,"verstimmung":20}},{{"id":"o","art":"ausgang"}},{{"id":"m","art":"mul","b":-1}}],"kanten":[{{"von":"w.l","nach":"o.l"}},{{"von":"w.aus","nach":"m.a"}},{{"von":"m.aus","nach":"o.x"}}]}}"#
    );
    let mut p = lade(&g);
    let x = lauf(&mut p, 4_800);
    // left = l - aus = 0, right = -aus
    assert!(x.iter().all(|v| v.0.abs() < 1e-6), "l differs from aus at width 0");
    assert!(x.iter().any(|v| v.1.abs() > 0.1), "aus is silent");
}
