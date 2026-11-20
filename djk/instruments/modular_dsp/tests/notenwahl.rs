//! Baukasten block `notenwahl` (type 61): the played note picks one of up to eight pads. The block turns the note frequency of
//! a `note` node into the index of the pad (0..7) for a `wahl`; with a `wahl` behind it a kit of Baukasten sounds is one graph.
use baukasten_dsp::notenwahl::{index, NOTEN_MAX};
use baukasten_dsp::{uebersetze, ARTEN};

const SR: f32 = 48_000.0;
fn hz(n: i32) -> f32 { 440.0 * 2f32.powf((n as f32 - 69.0) / 12.0) }

const KIT: [i32; NOTEN_MAX] = [36, 37, 38, 39, 41, 42, 46, 49];

#[test]
fn eigene_note_trifft_ihren_platz() {
    for (k, n) in KIT.iter().enumerate() {
        assert_eq!(index(hz(*n), &KIT), k as f32, "note {n}");
    }
}

#[test]
fn andere_note_spielt_den_naechsten_platz_darunter() {
    assert_eq!(index(hz(40), &KIT), 3.0); // between clap 39 and low tom 41
    assert_eq!(index(hz(45), &KIT), 5.0); // above the closed hat 42, below the open hat 46
    assert_eq!(index(hz(60), &KIT), 7.0); // above the last pad
    assert_eq!(index(hz(20), &KIT), 0.0); // below the first pad: the lowest
}

#[test]
fn unbelegte_plaetze_zaehlen_nicht() {
    let t = [-1, 50, -1, 40, -1, -1, -1, -1];
    assert_eq!(index(hz(40), &t), 3.0);
    assert_eq!(index(hz(50), &t), 1.0);
    assert_eq!(index(hz(45), &t), 3.0);
    assert_eq!(index(hz(10), &t), 3.0); // the lowest used entry
    assert_eq!(index(hz(60), &[-1; NOTEN_MAX]), 0.0);
}

#[test]
fn stille_oder_krumme_frequenz_gibt_null() {
    assert_eq!(index(0.0, &KIT), 0.0);
    assert_eq!(index(f32::NAN, &KIT), 0.0);
}

fn graph(n1: &str) -> String {
    format!(r#"{{"format":"baukasten/2","name":"t","stimmen":4,"knoten":[{{"id":"n","art":"note"}},
      {{"id":"p","art":"notenwahl",{n1}"n2":37,"n3":38,"n4":39,"n5":41,"n6":42,"n7":46,"n8":49}},
      {{"id":"m","art":"mul","b":0.01}},{{"id":"o","art":"ausgang"}}],
      "kanten":[{{"von":"n.hz","nach":"p.hz"}},{{"von":"p.aus","nach":"m.a"}},{{"von":"m.aus","nach":"o.x"}}]}}"#)
}

#[test]
fn art_ist_angehaengt_und_im_graph_wirksam() {
    assert_eq!(ARTEN.iter().position(|a| a.art == "notenwahl"), Some(61), "notenwahl is type 61 and must not move");
    let ton = |note: u8| {
        let mut p = uebersetze(&graph(r#""n1":36,"#), SR).unwrap_or_else(|e| panic!("{e}"));
        p.note_an(note, 0.8);
        (0..64).map(|_| p.sample_stereo().0).last().unwrap()
    };
    let (a, b) = (ton(39), ton(49));
    assert!(a > 0.0 && b > 0.0, "{a} {b}");
    assert!((b / a - 7.0 / 3.0).abs() < 1e-3, "index 7 vs 3: {a} {b}");
}

#[test]
fn falscher_wert_wird_abgelehnt() {
    assert!(uebersetze(&graph(r#""n1":200,"#), SR).is_err(), "note 200 is no MIDI note");
    assert!(uebersetze(&graph(r#""n1":36.5,"#), SR).is_err(), "notes are whole numbers");
}
