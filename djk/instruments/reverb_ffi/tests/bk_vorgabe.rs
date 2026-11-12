//! Task 3 of the synth build-out: `cypher_bk_regler_vorgabe` and the FFI instance's start values from the graph's `vorgabe`.
use baukasten_dsp::{uebersetze, REGLER};
use hall_ffi::baukasten::*;
use std::ffi::CString;

/// saw at the note, scaled by knob 3 (`vorgabe` 0.25)
const G: &str = r#"{"format":"baukasten/2","name":"v","stimmen":2,"knoten":[{"id":"n","art":"note"},{"id":"s","art":"saege"},{"id":"k","art":"regler","nr":3,"min":0,"max":1,"vorgabe":0.25},{"id":"m","art":"mul"},{"id":"o","art":"ausgang"}],"kanten":[{"von":"n.hz","nach":"s.hz"},{"von":"s.aus","nach":"m.a"},{"von":"k.aus","nach":"m.b"},{"von":"m.aus","nach":"o.x"}]}"#;

fn neu(json: &str) -> *mut CypherBk {
    let c = CString::new(json).unwrap();
    let mut fehler = [0 as std::ffi::c_char; 256];
    cypher_bk_neu(c.as_ptr(), 48_000.0, fehler.as_mut_ptr(), fehler.len())
}

#[test]
fn vorgabe_je_knopf_und_grenzen() {
    let h = neu(G);
    assert!(!h.is_null());
    assert_eq!(cypher_bk_regler_vorgabe(h, 3), 0.25);
    assert_eq!(cypher_bk_regler_vorgabe(h, 4), 0.5, "a knob the graph does not define");
    assert_eq!(cypher_bk_regler_vorgabe(h, 1), 0.5);
    assert_eq!(cypher_bk_regler_vorgabe(h, REGLER as u32), 0.5);
    assert_eq!(REGLER, 64);
    assert_eq!(cypher_bk_regler_vorgabe(h, 64), 0.5, "64 is valid");
    assert_eq!(cypher_bk_regler_vorgabe(h, 65), -1.0);
    assert_eq!(cypher_bk_regler_vorgabe(h, 0), -1.0);
    assert_eq!(cypher_bk_regler_vorgabe(h, REGLER as u32 + 1), -1.0);
    assert_eq!(cypher_bk_regler_vorgabe(h, u32::MAX), -1.0);
    assert_eq!(cypher_bk_regler_vorgabe(std::ptr::null_mut(), 3), -1.0);
    cypher_bk_frei(h);
}

#[test]
fn frische_instanz_beginnt_ohne_gleiten_bei_der_vorgabe() {
    let n = 256usize;
    let mut p = uebersetze(G, 48_000.0).unwrap();
    p.zuruecksetzen();
    p.note_an(57, 0.8);
    let soll: Vec<(f32, f32)> = (0..n).map(|_| p.sample_stereo()).collect();
    let h = neu(G);
    cypher_bk_note_an(h, 0, 57, 0.8);
    let (mut l, mut r) = (vec![9.0f32; n], vec![9.0f32; n]);
    assert_eq!(cypher_bk_block(h, l.as_mut_ptr(), r.as_mut_ptr(), n), 0);
    cypher_bk_frei(h);
    for i in 0..n {
        assert_eq!((l[i].to_bits(), r[i].to_bits()), (soll[i].0.to_bits(), soll[i].1.to_bits()), "sample {i}");
    }
    assert!(l.iter().any(|&x| x != 0.0), "positive control: the block is not silent");
}
