//! Task 5 of the synth build-out: knob 1..64 in the engine. `REGLER` is 64, knob 64 reaches the sound, 65 is refused.
use baukasten_dsp::{uebersetze, REGLER};

fn graph(nr: usize, vorgabe: &str) -> String {
    format!(r#"{{"format":"baukasten/2","name":"k","stimmen":1,"knoten":[{{"id":"r","art":"regler","nr":{nr},"min":0,"max":1{vorgabe}}},{{"id":"a","art":"ausgang"}}],"kanten":[{{"von":"r.aus","nach":"a.x"}}]}}"#)
}

#[test]
fn regler_64_wirkt_in_der_engine() {
    assert_eq!(REGLER, 64);
    let mut p = uebersetze(&graph(64, ""), 48_000.0).unwrap();
    p.setze_regler(64, 1.0);
    assert_eq!(p.sample_stereo().0, 1.0, "knob 64 -> 1: signal");
    p.setze_regler(64, 0.0);
    assert_eq!(p.sample_stereo().0, 0.0, "knob 64 -> 0: silence");
    p.setze_regler(65, 1.0); // ignored, no panic
    p.setze_regler(0, 1.0);
    p.setze_regler(usize::MAX, 1.0);
    assert_eq!(p.sample_stereo().0, 0.0);
}

#[test]
fn regler_nummern_1_bis_64_gueltig_65_nicht() {
    for nr in [1, 32, 33, 63, 64] {
        assert!(uebersetze(&graph(nr, ""), 48_000.0).is_ok(), "nr {nr}");
    }
    for nr in [0usize, 65, 100] {
        match uebersetze(&graph(nr, ""), 48_000.0) {
            Err(_) => {}
            Ok(_) => panic!("nr {nr} must be refused"),
        }
    }
    let e = format!("{:?}", uebersetze(&graph(65, ""), 48_000.0).err().unwrap());
    assert!(e.contains("1..64"), "{e}");
}

#[test]
fn vorgabe_von_knopf_64_kommt_aus_dem_graphen() {
    let p = uebersetze(&graph(64, r#","vorgabe":0.25"#), 48_000.0).unwrap();
    assert_eq!(p.regler_vorgaben()[63], 0.25);
    assert_eq!(p.regler_vorgaben()[0], 0.5);
    assert_eq!(p.regler_vorgaben().len(), 64);
}
