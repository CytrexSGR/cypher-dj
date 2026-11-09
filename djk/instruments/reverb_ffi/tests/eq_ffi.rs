//! EQ over the C boundary: bit-equal to eq_dsp, no panic escapes, block-split invariant, bypass keeps the delay.
use eq_dsp::{BandArt, BandEinstellung, Eq, Kanal, Steilheit};
use hall_ffi::*;

fn rausch(n: usize, seed: u64) -> Vec<f32> {
    let mut s = seed;
    (0..n)
        .map(|_| {
            s = s.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            ((s >> 40) as f32 / (1u64 << 24) as f32 - 0.5) * 1.6
        })
        .collect()
}

const ARTEN: [BandArt; 7] = [BandArt::Glocke, BandArt::LowShelf, BandArt::HighShelf, BandArt::LowCut, BandArt::HighCut, BandArt::Kerbe, BandArt::Bandpass];
const STEIL: [Steilheit; 4] = [Steilheit::Db12, Steilheit::Db24, Steilheit::Db36, Steilheit::Db48];
const KAN: [Kanal; 3] = [Kanal::Stereo, Kanal::Mid, Kanal::Side];

/// Deterministic "random" band i of a set; `variante` shifts the values.
fn band(i: usize, variante: usize) -> CypherEqBand {
    let k = i + 3 * variante;
    CypherEqBand {
        freq: 60.0 * 1.9f64.powi(i as i32) + 7.0 * variante as f64,
        gain_db: ((k * 37 % 23) as f64 - 11.0) * 0.9,
        q: 0.3 + (k % 7) as f64 * 0.9,
        an: 1,
        art: (k % 7) as u8,
        steilheit: (k % 4) as u8,
        kanal: (k % 3) as u8,
    }
}

fn als_crate(b: &CypherEqBand) -> BandEinstellung {
    BandEinstellung { an: b.an != 0, art: ARTEN[b.art as usize], freq: b.freq, gain_db: b.gain_db, q: b.q, steilheit: STEIL[b.steilheit as usize], kanal: KAN[b.kanal as usize] }
}

fn setze_alle(h: *mut CypherEq, e: Option<&mut Eq>, variante: usize) {
    for i in 0..8 {
        let b = band(i, variante);
        unsafe { cypher_eq_setze_band(h, i as u32, b) };
    }
    if let Some(e) = e {
        for i in 0..8 {
            e.setze_band(i, als_crate(&band(i, variante)));
        }
    }
}

#[test]
fn bit_gleich_wie_crate() {
    let x = rausch(480_000, 1);
    let y = rausch(480_000, 2);
    let (mut l1, mut r1) = (x.clone(), y.clone());
    let h = cypher_eq_neu(48000.0);
    assert!(!h.is_null());
    let mut e = Eq::neu(48000.0);
    setze_alle(h, Some(&mut e), 0);
    unsafe {
        cypher_eq_setze_global(h, 1, -3.0);
        for c in (0..x.len()).step_by(512) {
            let m = (c + 512).min(x.len());
            cypher_eq_block(h, l1[c..].as_mut_ptr(), r1[c..].as_mut_ptr(), m - c);
        }
        cypher_eq_frei(h);
    }
    e.setze_prop_q(true);
    e.setze_ausgang_db(-3.0);
    let (mut l2, mut r2) = (x.clone(), y.clone());
    e.verarbeite_stereo(&mut l2, &mut r2);
    assert!(l1 == l2 && r1 == r2, "FFI and crate must agree bit for bit");
    assert!(l1 != x, "positive control: the EQ changes the signal");
}

#[test]
fn block_teilung() {
    let x = rausch(4096, 3);
    let y = rausch(4096, 4);
    let lauf = |teile: &[usize]| {
        let h = cypher_eq_neu(48000.0);
        setze_alle(h, None, 0);
        // warm up with a block, then move every band so the smoothing ramps through the compared stretch
        let (mut a, mut b) = (rausch(777, 9), rausch(777, 10));
        unsafe { cypher_eq_block(h, a.as_mut_ptr(), b.as_mut_ptr(), 777) };
        setze_alle(h, None, 1);
        let (mut l, mut r) = (x.clone(), y.clone());
        let mut p = 0;
        for &t in teile {
            unsafe { cypher_eq_block(h, l[p..].as_mut_ptr(), r[p..].as_mut_ptr(), t) };
            p += t;
        }
        assert_eq!(p, 4096);
        unsafe { cypher_eq_frei(h) };
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
fn null_und_nan() {
    let e = band(0, 0);
    unsafe {
        // null handle for every call
        cypher_eq_frei(std::ptr::null_mut());
        cypher_eq_setze_band(std::ptr::null_mut(), 0, e);
        cypher_eq_setze_global(std::ptr::null_mut(), 1, 0.0);
        cypher_eq_leeren(std::ptr::null_mut());
        assert_eq!(cypher_eq_latenz(std::ptr::null()), 0);
        let (mut l, mut r) = (vec![0.5f32; 64], vec![0.25f32; 64]);
        cypher_eq_block(std::ptr::null_mut(), l.as_mut_ptr(), r.as_mut_ptr(), 64);
        assert!(l.iter().all(|&v| v == 0.5) && r.iter().all(|&v| v == 0.25), "null handle leaves the signal alone");

        let h = cypher_eq_neu(48000.0);
        // band index out of range, garbage enum values: ignored or clamped, no panic
        cypher_eq_setze_band(h, 8, e);
        cypher_eq_setze_band(h, u32::MAX, e);
        cypher_eq_setze_band(h, 0, CypherEqBand { art: 200, steilheit: 99, kanal: 77, freq: f64::NAN, gain_db: f64::INFINITY, q: f64::NAN, ..e });
        cypher_eq_setze_global(h, 9, f64::NAN);
        // null buffers, zero length
        cypher_eq_block(h, std::ptr::null_mut(), std::ptr::null_mut(), 64);
        cypher_eq_block(h, l.as_mut_ptr(), r.as_mut_ptr(), 0);
        // NaN input
        let (mut a, mut b) = (vec![f32::NAN; 256], vec![f32::INFINITY; 256]);
        cypher_eq_block(h, a.as_mut_ptr(), b.as_mut_ptr(), 256);
        cypher_eq_leeren(h);
        // after leeren a clean block is clean again
        let (mut c, mut d) = (rausch(256, 5), rausch(256, 6));
        cypher_eq_block(h, c.as_mut_ptr(), d.as_mut_ptr(), 256);
        assert!(c.iter().chain(d.iter()).all(|v| v.is_finite()), "leeren recovers from NaN");
        cypher_eq_frei(h);
    }
}

#[test]
fn panic_im_block_kommt_nicht_durch() {
    let h = cypher_eq_neu(48000.0);
    unsafe {
        cypher_eq_vergifte(h);
        let (mut l, mut r) = (rausch(128, 7), rausch(128, 8));
        let (l0, r0) = (l.clone(), r.clone());
        cypher_eq_block(h, l.as_mut_ptr(), r.as_mut_ptr(), 128);
        assert!(l == l0 && r == r0, "a panic leaves the signal unchanged and does not cross the boundary");
        cypher_eq_frei(h);
    }
}

fn spitze(l: &[f32]) -> usize {
    l.iter().enumerate().max_by(|a, b| a.1.abs().partial_cmp(&b.1.abs()).unwrap()).unwrap().0
}

fn impuls(h: *mut CypherEq) -> usize {
    let mut l = vec![0f32; 512];
    let mut r = vec![0f32; 512];
    l[100] = 1.0;
    r[100] = 1.0;
    unsafe { cypher_eq_block(h, l.as_mut_ptr(), r.as_mut_ptr(), 512) };
    spitze(&l) - 100
}

#[test]
fn latenz_bypass() {
    // all bands off
    let h = cypher_eq_neu(48000.0);
    let aus = impuls(h);
    // bands on, mild boost/cut
    let h2 = cypher_eq_neu(48000.0);
    for i in 0..8 {
        let b = CypherEqBand { an: 1, art: 0, steilheit: 0, kanal: 0, freq: 200.0 * 2f64.powi(i), gain_db: if i % 2 == 0 { 3.0 } else { -3.0 }, q: 1.0 };
        unsafe { cypher_eq_setze_band(h2, i as u32, b) };
    }
    let an = impuls(h2);
    unsafe {
        assert_eq!(cypher_eq_latenz(h), 69);
        assert_eq!(cypher_eq_latenz(h2), 69);
        cypher_eq_frei(h);
        cypher_eq_frei(h2);
    }
    assert_eq!(aus, 69, "all bands off still carries the oversampler delay");
    assert_eq!(an, aus, "bands on: same peak position as bands off");
}

#[test]
fn panic_in_frei_und_latenz_kommt_nicht_durch() {
    let h = cypher_eq_neu(48000.0);
    unsafe {
        cypher_eq_vergifte(h);
        assert_eq!(cypher_eq_latenz(h), 0, "a panic in latenz yields 0 instead of unwinding");
        cypher_eq_frei(h); // must neither unwind nor abort
    }
}

#[test]
fn ausschalten_trotz_nan_felder() {
    let an = CypherEqBand { freq: 1000.0, gain_db: 12.0, q: 1.0, an: 1, art: 0, steilheit: 0, kanal: 0 };
    let sinus: Vec<f32> = (0..4096).map(|i| ((i as f32) * 2.0 * std::f32::consts::PI * 1000.0 / 48000.0).sin() * 0.3).collect();
    let rms = |h: *mut CypherEq| {
        let (mut l, mut r) = (sinus.clone(), sinus.clone());
        for _ in 0..40 {
            l.copy_from_slice(&sinus);
            r.copy_from_slice(&sinus);
            unsafe { cypher_eq_block(h, l.as_mut_ptr(), r.as_mut_ptr(), l.len()) };
        }
        (l[2048..].iter().map(|v| v * v).sum::<f32>() / 2048.0).sqrt()
    };
    let nie_an = cypher_eq_neu(48000.0);
    let soll = rms(nie_an);
    let h = cypher_eq_neu(48000.0);
    unsafe {
        cypher_eq_setze_band(h, 0, an);
        // switch off with garbage in the other fields: the off must still arrive
        cypher_eq_setze_band(h, 0, CypherEqBand { freq: f64::NAN, gain_db: f64::NAN, q: f64::NAN, an: 0, ..an });
    }
    let ist = rms(h);
    unsafe {
        cypher_eq_frei(h);
        cypher_eq_frei(nie_an);
    }
    assert!((ist - soll).abs() < 1e-4, "off band must be transparent: rms {ist} vs {soll}");
}

#[test]
fn neu_mit_unbrauchbarer_abtastrate() {
    for fs in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, 0.0, -48000.0] {
        assert!(cypher_eq_neu(fs).is_null(), "fs {fs} must give null");
    }
    let h = cypher_eq_neu(48000.0);
    assert!(!h.is_null());
    unsafe { cypher_eq_frei(h) };
}

#[test]
fn artwechsel_aus_mit_nan_dann_wieder_an() {
    let h = cypher_eq_neu(48000.0);
    let glocke = CypherEqBand { freq: 1000.0, gain_db: 12.0, q: 1.0, an: 1, art: 0, steilheit: 0, kanal: 0 };
    let mut lauf = |n_bloecke: usize| {
        let mut ok = true;
        for k in 0..n_bloecke {
            let (mut l, mut r) = (rausch(2048, 20 + k as u64), rausch(2048, 80 + k as u64));
            unsafe { cypher_eq_block(h, l.as_mut_ptr(), r.as_mut_ptr(), 2048) };
            ok &= l.iter().chain(r.iter()).all(|v| v.is_finite());
        }
        ok
    };
    unsafe {
        cypher_eq_setze_band(h, 0, glocke);
        assert!(lauf(3));
        // other band type, off, garbage numbers: the type change happens once the band has faded out
        cypher_eq_setze_band(h, 0, CypherEqBand { art: 3, an: 0, freq: f64::NAN, gain_db: f64::NAN, q: f64::NAN, ..glocke });
        assert!(lauf(40), "fade-out with a type change stays finite");
        cypher_eq_setze_band(h, 0, CypherEqBand { art: 3, an: 1, freq: 80.0, gain_db: 0.0, q: 0.7, ..glocke });
        assert!(lauf(10), "switching on again with finite values gives a finite output");
        cypher_eq_frei(h);
    }
}
