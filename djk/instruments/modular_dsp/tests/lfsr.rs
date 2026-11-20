//! Baukasten block `lfsr` (type 57): the 15-bit noise register of the NES (D19). Long mode feeds back bit 0 xor bit 1 (period
//! 32767), short mode bit 0 xor bit 6 (period 93). The periods are counted on the output sequence itself.
use baukasten_dsp::lfsr::Lfsr;
use baukasten_dsp::{uebersetze, Fehler, ARTEN};

const SR: f32 = 48_000.0;

/// the output at one clock step per sample (hz = sr)
fn folge(kurz: bool, n: usize) -> Vec<f32> {
    let mut l = Lfsr::default();
    (0..n).map(|_| l.prozess(SR, kurz, SR)).collect()
}

/// smallest p > 0 such that the sequence repeats with period p over its whole length
fn periode(x: &[f32]) -> Option<usize> {
    (1..x.len() / 2).find(|&p| x[..x.len() - p].iter().zip(&x[p..]).all(|(a, b)| a == b))
}

#[test]
fn lange_periode_32767() {
    let x = folge(false, 3 * 32_767);
    assert!(x.iter().all(|v| *v == 1.0 || *v == -1.0), "the output is -1 or 1");
    assert_eq!(periode(&x), Some(32_767));
}

#[test]
fn kurze_periode_93() {
    let x = folge(true, 20 * 93);
    assert_eq!(periode(&x), Some(93));
}

#[test]
fn start_wert_eins_ist_deterministisch() {
    // the register starts at 1: the first values are fixed, two fresh blocks agree bit for bit
    let (a, b) = (folge(false, 4000), folge(false, 4000));
    assert_eq!(a, b);
    // first step from 1: feedback 1 xor 0 = 1, register 0x4000, bit 0 = 0 -> output +1; then 0x2000 ... until the 1 arrives at bit 0
    assert_eq!(&a[..3], &[1.0, 1.0, 1.0]);
}

#[test]
fn takt_ist_der_eingang_hz() {
    // hz = sr / 4: one step every fourth sample, so the sequence is the full-rate one, each value held four samples
    let ganz = folge(false, 2000);
    let mut l = Lfsr::default();
    let langsam: Vec<f32> = (0..8000).map(|_| l.prozess(SR / 4.0, false, SR)).collect();
    for (k, v) in langsam.iter().enumerate() {
        // the step happens on samples 3, 7, 11 ... (the accumulator reaches 1 after four additions) and the output follows it
        let schritte = (k + 1) / 4;
        let soll = if schritte == 0 { -1.0 } else { ganz[schritte - 1] };
        assert_eq!(*v, soll, "sample {k}");
    }
}

#[test]
fn hz_null_haelt_das_register() {
    let mut l = Lfsr::default();
    let x: Vec<f32> = (0..100).map(|_| l.prozess(0.0, false, SR)).collect();
    assert!(x.iter().all(|v| *v == x[0]));
}

#[test]
fn zurueckgesetzt_gleich_neu() {
    let mut a = Lfsr::default();
    for _ in 0..777 {
        a.prozess(9_000.0, true, SR);
    }
    a = Lfsr::default();
    let mut b = Lfsr::default();
    for _ in 0..500 {
        assert_eq!(a.prozess(5_000.0, false, SR).to_bits(), b.prozess(5_000.0, false, SR).to_bits());
    }
}

#[test]
fn registriert_als_typ_57() {
    assert_eq!(ARTEN.iter().position(|a| a.art == "lfsr"), Some(57), "lfsr is type 57 and must not move");
    let d = &ARTEN[57];
    assert_eq!(d.ein, &["hz"]);
    assert_eq!(d.aus, &["aus"]);
    assert_eq!(d.frei, &[("kurz", 0.0)]);
}

fn graph(kurz: &str) -> String {
    format!(r#"{{"format":"baukasten/2","name":"lfsr-t","stimmen":1,"knoten":[{{"id":"n","art":"note"}},{{"id":"p","art":"lfsr"{kurz}}},{{"id":"o","art":"ausgang"}}],"kanten":[{{"von":"n.hz","nach":"p.hz"}},{{"von":"p.aus","nach":"o.x"}}]}}"#)
}

#[test]
fn graph_laeuft_und_prueft_kurz() {
    let mut p = uebersetze(&graph(""), SR).unwrap();
    p.note_an(69, 1.0);
    let x: Vec<f32> = (0..4000).map(|_| p.sample_stereo().0).collect();
    // one voice; the output stage scales the mono signal into both channels, so the magnitude is constant and both signs occur
    let m = x[0].abs();
    assert!(m > 0.0 && x.iter().all(|v| v.abs() == m), "the output is -1 or 1 times a constant");
    assert!(x.iter().any(|v| *v > 0.0) && x.iter().any(|v| *v < 0.0));
    for ok in [r#","kurz":0"#, r#","kurz":1"#] {
        assert!(uebersetze(&graph(ok), SR).is_ok(), "{ok}");
    }
    for schlecht in [r#","kurz":2"#, r#","kurz":0.5"#, r#","kurz":-1"#] {
        match uebersetze(&graph(schlecht), SR) {
            Err(Fehler::Wert { wert, .. }) => assert_eq!(wert, "kurz", "{schlecht}"),
            Err(e) => panic!("{schlecht}: {e:?}"),
            Ok(_) => panic!("{schlecht} was accepted"),
        }
    }
}
