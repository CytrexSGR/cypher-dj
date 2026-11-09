//! Kompressor über die C-Grenze: bitgleich zu komp_dsp, Panic-frei bei null, Absenkung lesbar.
use hall_ffi::*;
use komp_dsp::{Einstellung, Komp};

#[test]
fn ueber_die_grenze_bitgleich_zu_komp_dsp() {
    let e = CypherKompEinstellung { schwelle_db: -20.0, ratio: 4.0, knie_db: 6.0, attack_ms: 5.0, release_ms: 100.0, makeup_db: 2.0, mix: 0.8, sc_hochpass_hz: 0.0 };
    let x: Vec<f32> = (0..9600).map(|i| ((i as f32) * 0.05).sin() * 0.9).collect();
    let (mut l1, mut r1) = (x.clone(), x.clone());
    let h = cypher_komp_neu(48000.0);
    assert!(!h.is_null());
    unsafe {
        cypher_komp_setze(h, e);
        for c in (0..x.len()).step_by(256) {
            let m = (c + 256).min(x.len());
            cypher_komp_block(h, l1[c..].as_mut_ptr(), r1[c..].as_mut_ptr(), m - c);
        }
    }
    let mut k = Komp::neu(48000.0);
    k.setze(&Einstellung::from(e));
    let (mut l2, mut r2) = (x.clone(), x.clone());
    for c in (0..x.len()).step_by(256) {
        let m = (c + 256).min(x.len());
        k.block(&mut l2[c..m], &mut r2[c..m], None);
    }
    assert_eq!(l1, l2);
    assert_eq!(r1, r2);
    let gr = unsafe { cypher_komp_gr_db(h) };
    assert!((gr - k.gr_db()).abs() < 1e-12 && gr > 1.0);
    unsafe {
        cypher_komp_leeren(h);
        assert_eq!(cypher_komp_gr_db(h), 0.0);
        cypher_komp_frei(h);
        // null ist harmlos
        cypher_komp_setze(std::ptr::null_mut(), e);
        assert_eq!(cypher_komp_gr_db(std::ptr::null()), 0.0);
    }
}

#[test]
fn sidechain_ueber_die_grenze_bitgleich() {
    let e = CypherKompEinstellung { schwelle_db: -30.0, ratio: 8.0, knie_db: 0.0, attack_ms: 1.0, release_ms: 150.0, makeup_db: 0.0, mix: 1.0, sc_hochpass_hz: 0.0 };
    let x: Vec<f32> = (0..4800).map(|i| ((i as f32) * 0.06).sin() * 0.25).collect();
    let key: Vec<f32> = (0..4800).map(|i| if i % 2400 < 400 { 0.9 } else { 0.0 }).collect();
    let (mut l1, mut r1) = (x.clone(), x.clone());
    let h = cypher_komp_neu(48000.0);
    unsafe {
        cypher_komp_setze(h, e);
        cypher_komp_block_sc(h, l1.as_mut_ptr(), r1.as_mut_ptr(), key.as_ptr(), key.as_ptr(), x.len());
        cypher_komp_frei(h);
    }
    let mut k = Komp::neu(48000.0);
    k.setze(&Einstellung::from(e));
    let (mut l2, mut r2) = (x.clone(), x.clone());
    k.block(&mut l2, &mut r2, Some((&key, &key)));
    assert_eq!(l1, l2);
    assert!(l1 != x, "Positivkontrolle: der Schlüssel drückt");
}
