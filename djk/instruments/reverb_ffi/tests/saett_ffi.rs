//! Saturation over the C boundary: bit-equal to saett_dsp, no panic escapes, block-split invariant, mix keeps the delay.
use hall_ffi::*;
use saett_dsp::{Einstellung, Saett};

fn rausch(n: usize, seed: u64) -> Vec<f32> {
    let mut s = seed;
    (0..n)
        .map(|_| {
            s = s.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            ((s >> 40) as f32 / (1u64 << 24) as f32 - 0.5) * 1.6
        })
        .collect()
}

#[test]
fn bit_gleich_wie_crate() {
    let x = rausch(480_000, 1);
    let y = rausch(480_000, 2);
    for fs in [48000.0, 96000.0] {
        let (mut l1, mut r1) = (x.clone(), y.clone());
        let h = cypher_saett_neu(fs);
        assert!(!h.is_null());
        unsafe {
            cypher_saett_setze(h, 17.5, -4.0, 0.7);
            for c in (0..x.len()).step_by(512) {
                let m = (c + 512).min(x.len());
                cypher_saett_block(h, l1[c..].as_mut_ptr(), r1[c..].as_mut_ptr(), m - c);
            }
            cypher_saett_frei(h);
        }
        let mut s = Saett::neu(fs);
        s.setze(&Einstellung { drive_db: 17.5, ausgang_db: -4.0, mix: 0.7 });
        let (mut l2, mut r2) = (x.clone(), y.clone());
        s.block(&mut l2, &mut r2);
        assert!(l1 == l2 && r1 == r2, "FFI and crate must agree bit for bit at {fs}");
        assert!(l1 != x, "positive control: the saturation changes the signal");
    }
}

#[test]
fn block_teilung() {
    let x = rausch(4096, 3);
    let y = rausch(4096, 4);
    let lauf = |teile: &[usize]| {
        let h = cypher_saett_neu(48000.0);
        unsafe { cypher_saett_setze(h, 6.0, -2.0, 0.3) };
        // warm up, then move every parameter so the smoothing ramps through the compared stretch
        let (mut a, mut b) = (rausch(777, 9), rausch(777, 10));
        unsafe { cypher_saett_block(h, a.as_mut_ptr(), b.as_mut_ptr(), 777) };
        unsafe { cypher_saett_setze(h, 24.0, -9.0, 1.0) };
        let (mut l, mut r) = (x.clone(), y.clone());
        let mut p = 0;
        for &t in teile {
            unsafe { cypher_saett_block(h, l[p..].as_mut_ptr(), r[p..].as_mut_ptr(), t) };
            p += t;
        }
        assert_eq!(p, 4096);
        unsafe { cypher_saett_frei(h) };
        (l, r)
    };
    let ganz = lauf(&[4096]);
    let geteilt = lauf(&[64, 1000, 3000, 32]);
    let krumm = lauf(&[1, 3, 5, 4000, 87]);
    assert!(ganz == geteilt, "64+1000+3000+32 must equal one 4096 block");
    assert!(ganz == krumm, "odd split must equal one 4096 block");
    assert!(ganz.0 != x, "positive control");
}

#[test]
fn neu_weist_unbrauchbare_abtastrate_ab() {
    for fs in [0.0, -48000.0, f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        assert!(cypher_saett_neu(fs).is_null(), "fs {fs}");
    }
    let h = cypher_saett_neu(48000.0);
    assert!(!h.is_null(), "positive control");
    unsafe { cypher_saett_frei(h) };
}

#[test]
fn null_und_nan() {
    unsafe {
        cypher_saett_frei(std::ptr::null_mut());
        cypher_saett_setze(std::ptr::null_mut(), 1.0, 1.0, 1.0);
        cypher_saett_leeren(std::ptr::null_mut());
        assert_eq!(cypher_saett_latenz(std::ptr::null()), 0);
        let (mut l, mut r) = (vec![0.5f32; 64], vec![0.25f32; 64]);
        cypher_saett_block(std::ptr::null_mut(), l.as_mut_ptr(), r.as_mut_ptr(), 64);
        assert!(l.iter().all(|&v| v == 0.5) && r.iter().all(|&v| v == 0.25), "null handle leaves the signal alone");

        let h = cypher_saett_neu(48000.0);
        cypher_saett_setze(h, f64::NAN, f64::INFINITY, f64::NAN);
        // a non-finite setting is ignored as a whole: a clean block right after it stays finite
        let (mut e1, mut e2) = (rausch(256, 11), rausch(256, 12));
        cypher_saett_block(h, e1.as_mut_ptr(), e2.as_mut_ptr(), 256);
        assert!(e1.iter().chain(e2.iter()).all(|v| v.is_finite()), "NaN setting must not reach the signal");
        cypher_saett_setze(h, 1e300, -1e300, 5.0);
        let (mut e1, mut e2) = (rausch(256, 13), rausch(256, 14));
        cypher_saett_block(h, e1.as_mut_ptr(), e2.as_mut_ptr(), 256);
        assert!(e1.iter().chain(e2.iter()).all(|v| v.is_finite()), "huge setting is clamped");
        cypher_saett_block(h, std::ptr::null_mut(), std::ptr::null_mut(), 64);
        cypher_saett_block(h, l.as_mut_ptr(), r.as_mut_ptr(), 0);
        let (mut a, mut b) = (vec![f32::NAN; 256], vec![f32::INFINITY; 256]);
        cypher_saett_block(h, a.as_mut_ptr(), b.as_mut_ptr(), 256);
        cypher_saett_leeren(h);
        cypher_saett_setze(h, 12.0, -6.0, 1.0);
        cypher_saett_leeren(h);
        let (mut c, mut d) = (rausch(256, 5), rausch(256, 6));
        cypher_saett_block(h, c.as_mut_ptr(), d.as_mut_ptr(), 256);
        assert!(c.iter().chain(d.iter()).all(|v| v.is_finite()), "leeren recovers from NaN");
        cypher_saett_frei(h);
    }
}

#[test]
fn panic_im_block_kommt_nicht_durch() {
    let h = cypher_saett_neu(48000.0);
    unsafe {
        cypher_saett_vergifte(h);
        let (mut l, mut r) = (rausch(128, 7), rausch(128, 8));
        let (l0, r0) = (l.clone(), r.clone());
        cypher_saett_block(h, l.as_mut_ptr(), r.as_mut_ptr(), 128);
        assert!(l == l0 && r == r0, "a panic leaves the signal unchanged and does not cross the boundary");
        cypher_saett_frei(h);
    }
}
