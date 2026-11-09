//! S21: `lfo` with `versatz` (start offset in beats), `einmal` (ramp once and hold) and `takt` up to 256 beats: the
//! arrangement-length filter ride. The output is a pure function of the host beat.
use baukasten_dsp::{uebersetze, Fehler, Programm};

const SR: f32 = 48_000.0;
/// 120 BPM = 2 beats per second
const BPS_120: f64 = 2.0 / 48_000.0;

/// lfo -> ausgang.x, one voice; `werte` is appended to the lfo node (e.g. `,"form":2,"takt":4`).
fn graph(werte: &str) -> String {
    format!(
        r#"{{"format":"baukasten/2","name":"l","stimmen":1,"knoten":[{{"id":"l","art":"lfo"{werte}}},{{"id":"o","art":"ausgang"}}],"kanten":[{{"von":"l.aus","nach":"o.x"}}]}}"#
    )
}

fn lade(werte: &str) -> Programm { uebersetze(&graph(werte), SR).unwrap_or_else(|e| panic!("{werte}: {e:?}")) }

/// The value at host beat `beat` (the first sample after `setze_takt`).
fn bei(p: &mut Programm, beat: f64) -> f32 {
    p.setze_takt(beat, BPS_120);
    p.sample_stereo().0
}

fn wert_fehler(werte: &str, name: &str) -> String {
    match uebersetze(&graph(werte), SR) {
        Err(Fehler::Wert { wert, grund, .. }) => {
            assert_eq!(wert, name, "{werte}");
            grund.to_string()
        }
        Err(e) => panic!("{werte}: expected Fehler::Wert {name}, got {e:?}"),
        Ok(_) => panic!("{werte}: expected Fehler::Wert {name}, got Ok"),
    }
}

#[test]
fn value_checks() {
    for ok in [r#","takt":256"#, r#","takt":128,"versatz":64"#, r#","takt":4,"versatz":4096"#, r#","takt":4,"einmal":0"#,
               r#","takt":4,"einmal":1"#, r#","takt":64,"form":2"#, r#","rate":2"#] {
        uebersetze(&graph(ok), SR).unwrap_or_else(|e| panic!("{ok}: {e:?}"));
    }
    wert_fehler(r#","takt":256.5"#, "takt");
    wert_fehler(r#","takt":257"#, "takt");
    wert_fehler(r#","takt":4,"versatz":-1"#, "versatz");
    wert_fehler(r#","takt":4,"versatz":4096.5"#, "versatz");
    wert_fehler(r#","takt":4,"einmal":2"#, "einmal");
    wert_fehler(r#","takt":4,"einmal":0.5"#, "einmal");
    assert!(wert_fehler(r#","einmal":1"#, "takt").contains("need takt > 0"));
    assert!(wert_fehler(r#","versatz":4"#, "takt").contains("need takt > 0"));
}

#[test]
fn versatz_moves_the_phase_origin() {
    // versatz 32 of takt 128: a quarter period, so that adding instead of subtracting the offset would be visible
    let mut p = lade(r#","form":2,"takt":128,"versatz":32"#);
    let a = bei(&mut p, 32.0);
    assert!((a + 1.0).abs() <= 1e-6, "beat 32 = start of the ride: {a}");
    let b = bei(&mut p, 96.0);
    assert!(b.abs() <= 1e-3, "beat 96 = halfway: {b}");
    let c = bei(&mut p, 31.75);
    let soll = 2.0 * ((-0.25f64 / 128.0).rem_euclid(1.0) as f32) - 1.0;
    println!("MESS lfo versatz beat 31.75: {c} (expected {soll})");
    assert!((c - soll).abs() <= 1e-5, "before the origin the phase wraps: {c} vs {soll}");
    assert!(c > 0.99, "negative control: just before the origin a looping saw is at its top, got {c}");
    // negative control: without versatz the same beat 32 is a quarter into the ride
    let d = bei(&mut lade(r#","form":2,"takt":128"#), 32.0);
    assert!((d + 0.5).abs() <= 1e-6, "no versatz: beat 32 is at -0.5, got {d}");
}

#[test]
fn einmal_ramps_once_and_holds() {
    let mut p = lade(r#","form":2,"takt":4,"versatz":2,"einmal":1"#);
    assert_eq!(bei(&mut p, 0.0), -1.0, "before versatz: start value");
    assert_eq!(bei(&mut p, 2.0), -1.0, "at versatz");
    let m = bei(&mut p, 4.0);
    assert!(m.abs() <= 1e-6, "halfway: {m}");
    assert_eq!(bei(&mut p, 6.0), 1.0, "at versatz + takt");
    assert_eq!(bei(&mut p, 6.5), 1.0, "after the end: held");
    assert_eq!(bei(&mut p, 1000.0), 1.0, "long after the end: held");
    // negative control: without einmal the same graph wraps, so the hold above is visible
    let mut q = lade(r#","form":2,"takt":4,"versatz":2"#);
    let w = bei(&mut q, 6.5);
    assert!((w + 0.75).abs() <= 1e-6, "einmal 0 at beat 6.5 wraps to -0.75, got {w}");
}

#[test]
fn output_is_a_function_of_the_beat() {
    for form in 0..4 {
        let werte = format!(r#","form":{form},"takt":128,"einmal":1"#);
        let mut p = lade(&werte);
        for b in [3.0, 50.0, 100.0] { bei(&mut p, b); }
        let nach = bei(&mut p, 100.0);
        let frisch = bei(&mut lade(&werte), 100.0);
        assert_eq!(nach.to_bits(), frisch.to_bits(), "form {form}: history changed the value at beat 100");
    }
    // random form: constant once the ride is over
    let mut p = lade(r#","form":4,"takt":4,"einmal":1"#);
    p.setze_takt(10.0, BPS_120);
    let x: Vec<f32> = (0..10_000).map(|_| p.sample_stereo().0).collect();
    assert!(x.iter().all(|v| v.to_bits() == x[0].to_bits()), "form 4 after the end must hold one value");
    // negative control: without einmal the random form draws a new value at every period
    let mut q = lade(r#","form":4,"takt":0.1"#);
    q.setze_takt(10.0, BPS_120);
    let y: Vec<f32> = (0..10_000).map(|_| q.sample_stereo().0).collect();
    assert!(y.iter().any(|v| v.to_bits() != y[0].to_bits()), "form 4 looping must change");
}

#[test]
fn old_parameters_bit_identical() {
    for form in 0..5 {
        let mut alt = lade(&format!(r#","form":{form},"takt":2"#));
        let mut neu = lade(&format!(r#","form":{form},"takt":2,"versatz":0,"einmal":0"#));
        alt.setze_takt(7.3, BPS_120);
        neu.setze_takt(7.3, BPS_120);
        let (a, n): (Vec<f32>, Vec<f32>) = (0..48_000).map(|_| (alt.sample_stereo().0, neu.sample_stereo().0)).unzip();
        let ungleich = a.iter().zip(&n).filter(|(x, y)| x.to_bits() != y.to_bits()).count();
        assert_eq!(ungleich, 0, "form {form}: explicit defaults must equal omitted values");
        assert!(a.iter().any(|v| v.to_bits() != a[0].to_bits()), "form {form}: constant output, the comparison would be blind");
    }
    // and both equal the old arithmetic (beat / takt).rem_euclid(1), computed independently here
    let mut p = lade(r#","form":2,"takt":2"#);
    p.setze_takt(7.3, BPS_120);
    let mut beat = 7.3f64;
    for i in 0..48_000 {
        let ph = (beat / 2.0f32 as f64).rem_euclid(1.0) as f32;
        let soll = 2.0 * ph - 1.0;
        let ist = p.sample_stereo().0;
        assert_eq!(ist.to_bits(), soll.to_bits(), "sample {i}: differs from the old formula");
        beat += BPS_120;
    }
}

/// 32 bars of 4/4 at 120 BPM = 128 beats = 64 s = 3 072 000 samples (debug build: about a second per million samples).
#[test]
fn ride_32_bars_at_120_bpm() {
    let mut p = lade(r#","form":2,"takt":128,"einmal":1"#);
    p.setze_takt(0.0, BPS_120);
    let mut x = |p: &mut Programm, n: usize| (0..n).map(|_| p.sample_stereo().0).last().unwrap();
    // sample index 0
    let erster = p.sample_stereo().0;
    assert_eq!(erster, -1.0, "start of the ride");
    let halb = x(&mut p, 1_536_000);
    println!("MESS lfo ride index 1536000 (64 beats): {halb}");
    assert!(halb.abs() <= 1e-4, "halfway through the ride at 64 beats: {halb}");
    let ende = x(&mut p, 1_536_000);
    assert_eq!(ende, 1.0, "128 beats: the ride has arrived");
    let danach = x(&mut p, 128_000);
    assert_eq!(danach, 1.0, "after the ride: held open");
}
