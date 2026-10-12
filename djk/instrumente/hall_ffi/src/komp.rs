//! C-ABI um komp_dsp für den djk-Kern (Kompressor je Quellkanal, vor dem Fader). Kopf:
//! djk/kern/include/cypherdj/cypher_komp_ffi.h. In derselben Staticlib wie der Hall, weil zwei Rust-Staticlibs im selben
//! Binary über die Rust-Laufzeit kollidieren.
//!
//! `cypher_komp_neu` allokiert (außerhalb des Callbacks); `_block`, `_setze`, `_leeren` und `_gr_db` allokieren nicht.
//! Ein Panic im Block lässt das Signal unverändert durch.

use komp_dsp::{Einstellung, Komp};
use std::panic::{catch_unwind, AssertUnwindSafe};

#[repr(C)]
#[derive(Clone, Copy)]
pub struct CypherKompEinstellung {
    pub schwelle_db: f64,
    pub ratio: f64,
    pub knie_db: f64,
    pub attack_ms: f64,
    pub release_ms: f64,
    pub makeup_db: f64,
    pub mix: f64,
    pub sc_hochpass_hz: f64,
}

impl From<CypherKompEinstellung> for Einstellung {
    fn from(c: CypherKompEinstellung) -> Self {
        Einstellung {
            schwelle_db: c.schwelle_db,
            ratio: c.ratio,
            knie_db: c.knie_db,
            attack_ms: c.attack_ms,
            release_ms: c.release_ms,
            makeup_db: c.makeup_db,
            mix: c.mix,
            sc_hochpass_hz: c.sc_hochpass_hz,
        }
    }
}

pub struct CypherKomp {
    k: Komp,
}

#[no_mangle]
pub extern "C" fn cypher_komp_neu(fs: f64) -> *mut CypherKomp {
    match catch_unwind(|| Box::into_raw(Box::new(CypherKomp { k: Komp::neu(fs) }))) {
        Ok(p) => p,
        Err(_) => std::ptr::null_mut(),
    }
}

/// # Safety
/// `h` aus `cypher_komp_neu`, danach nicht mehr benutzen.
#[no_mangle]
pub unsafe extern "C" fn cypher_komp_frei(h: *mut CypherKomp) {
    if !h.is_null() {
        drop(Box::from_raw(h));
    }
}

/// # Safety
/// `h` gültig, nicht nebenläufig mit `cypher_komp_block`.
#[no_mangle]
pub unsafe extern "C" fn cypher_komp_setze(h: *mut CypherKomp, e: CypherKompEinstellung) {
    if let Some(h) = h.as_mut() {
        let _ = catch_unwind(AssertUnwindSafe(|| h.k.setze(&e.into())));
    }
}

/// # Safety
/// `h` gültig.
#[no_mangle]
pub unsafe extern "C" fn cypher_komp_leeren(h: *mut CypherKomp) {
    if let Some(h) = h.as_mut() {
        let _ = catch_unwind(AssertUnwindSafe(|| h.k.leeren()));
    }
}

/// Absenkung in dB (≥ 0) nach dem letzten Block.
/// # Safety
/// `h` gültig oder null (dann 0).
#[no_mangle]
pub unsafe extern "C" fn cypher_komp_gr_db(h: *const CypherKomp) -> f64 {
    h.as_ref().map(|h| h.k.gr_db()).unwrap_or(0.0)
}

/// `n` Samples in place; der Detektor hört auf den Schlüssel `kl`, `kr` (externer Sidechain, etwa die Kick eines anderen
/// Kanals).
/// # Safety
/// `l`, `r`, `kl`, `kr` gültig für `n` f32.
#[no_mangle]
pub unsafe extern "C" fn cypher_komp_block_sc(h: *mut CypherKomp, l: *mut f32, r: *mut f32, kl: *const f32, kr: *const f32, n: usize) {
    let (l, r) = (std::slice::from_raw_parts_mut(l, n), std::slice::from_raw_parts_mut(r, n));
    let (kl, kr) = (std::slice::from_raw_parts(kl, n), std::slice::from_raw_parts(kr, n));
    if let Some(h) = h.as_mut() {
        let _ = catch_unwind(AssertUnwindSafe(|| h.k.block(l, r, Some((kl, kr)))));
    }
}

/// `n` Samples in place, das Signal selbst als Detektor.
/// # Safety
/// `l`, `r` gültig für `n` f32.
#[no_mangle]
pub unsafe extern "C" fn cypher_komp_block(h: *mut CypherKomp, l: *mut f32, r: *mut f32, n: usize) {
    let (l, r) = (std::slice::from_raw_parts_mut(l, n), std::slice::from_raw_parts_mut(r, n));
    if let Some(h) = h.as_mut() {
        let _ = catch_unwind(AssertUnwindSafe(|| h.k.block(l, r, None)));
    }
}
