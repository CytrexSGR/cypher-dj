//! C-ABI um hall_dsp für den djk-Kern (Rückweg fx/2). Kopf: djk/kern/include/cypherdj/cypher_hall_ffi.h.
//! Daneben Cypher Komp (komp.rs) und die RB-338 für das Arrangement (rb.rs, D1 K2a), je mit eigenem Kopf.
//!
//! `cypher_hall_neu` allokiert (außerhalb des Callbacks); `cypher_hall_block`, `_setze` und `_leeren` allokieren nicht.
//! Der Block liefert nur den nassen Anteil (der Kern mischt über `fx/2/rueckweg`). Panics werden nicht über die
//! Grenze getragen: ein Panic im Block liefert Stille.

mod komp;
pub use komp::*;
mod rb;
pub use rb::*;
pub mod baukasten;

use hall_dsp::{Hall, HallEinstellung};
use std::panic::{catch_unwind, AssertUnwindSafe};

/// Einstellung über die C-Grenze; Felder wie `HallEinstellung`, Wahrheitswert als u8.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct CypherHallEinstellung {
    pub frueh: f64,
    pub fahne_db: f64,
    pub pre_ms: f64,
    pub groesse_ms: f64,
    pub decay_s: f64,
    pub tief_faktor: f64,
    pub hoch_faktor: f64,
    pub lowcut_hz: f64,
    pub highcut_hz: f64,
    pub diffusion: f64,
    pub breite: f64,
    pub duck: f64,
    pub freeze: u8,
    pub rahmen: u32,
}

impl From<CypherHallEinstellung> for HallEinstellung {
    fn from(c: CypherHallEinstellung) -> Self {
        HallEinstellung {
            mix: 1.0,
            frueh: c.frueh,
            fahne_db: c.fahne_db,
            pre_ms: c.pre_ms,
            groesse_ms: c.groesse_ms,
            decay_s: c.decay_s,
            tief_faktor: c.tief_faktor,
            hoch_faktor: c.hoch_faktor,
            lowcut_hz: c.lowcut_hz,
            highcut_hz: c.highcut_hz,
            diffusion: c.diffusion,
            breite: c.breite,
            duck: c.duck,
            freeze: c.freeze != 0,
            rahmen: c.rahmen as usize,
        }
    }
}

/// Vorgabe für den Kern: wie der bisherige Zita-Hall (20 ms vor, Mitte 2 s, tief 3 s), N=2048.
#[no_mangle]
pub extern "C" fn cypher_hall_vorgabe() -> CypherHallEinstellung {
    let d = HallEinstellung::default();
    CypherHallEinstellung {
        frueh: d.frueh,
        fahne_db: d.fahne_db,
        pre_ms: 20.0,
        groesse_ms: d.groesse_ms,
        decay_s: 2.0,
        tief_faktor: 1.5,
        hoch_faktor: d.hoch_faktor,
        lowcut_hz: d.lowcut_hz,
        highcut_hz: d.highcut_hz,
        diffusion: d.diffusion,
        breite: d.breite,
        duck: d.duck,
        freeze: 0,
        rahmen: 2,
    }
}

pub struct CypherHall {
    h: Hall,
}

#[no_mangle]
pub extern "C" fn cypher_hall_neu(fs: f64) -> *mut CypherHall {
    match catch_unwind(|| {
        let mut h = Hall::neu(fs);
        h.setze(cypher_hall_vorgabe().into());
        h.reset();
        Box::into_raw(Box::new(CypherHall { h }))
    }) {
        Ok(p) => p,
        Err(_) => std::ptr::null_mut(),
    }
}

/// # Safety
/// `h` aus `cypher_hall_neu`, danach nicht mehr benutzen.
#[no_mangle]
pub unsafe extern "C" fn cypher_hall_frei(h: *mut CypherHall) {
    if !h.is_null() {
        drop(Box::from_raw(h));
    }
}

/// # Safety
/// `h` gültig, nicht nebenläufig mit `cypher_hall_block`.
#[no_mangle]
pub unsafe extern "C" fn cypher_hall_setze(h: *mut CypherHall, e: CypherHallEinstellung) {
    if let Some(h) = h.as_mut() {
        let _ = catch_unwind(AssertUnwindSafe(|| h.h.setze(e.into())));
    }
}

/// Zustand auf null (NaN-Riegel des Kerns), ohne Allokation.
/// # Safety
/// `h` gültig.
#[no_mangle]
pub unsafe extern "C" fn cypher_hall_leeren(h: *mut CypherHall) {
    if let Some(h) = h.as_mut() {
        let _ = catch_unwind(AssertUnwindSafe(|| h.h.reset()));
    }
}

/// Nasser Anteil von `n` Samples. Ein- und Ausgang dürfen nicht überlappen.
/// # Safety
/// Alle Zeiger gültig für `n` f32.
#[no_mangle]
pub unsafe extern "C" fn cypher_hall_block(
    h: *mut CypherHall,
    ein_l: *const f32,
    ein_r: *const f32,
    aus_l: *mut f32,
    aus_r: *mut f32,
    n: usize,
) {
    let (al, ar) = (std::slice::from_raw_parts_mut(aus_l, n), std::slice::from_raw_parts_mut(aus_r, n));
    al.copy_from_slice(std::slice::from_raw_parts(ein_l, n));
    ar.copy_from_slice(std::slice::from_raw_parts(ein_r, n));
    let ok = match h.as_mut() {
        Some(h) => catch_unwind(AssertUnwindSafe(|| h.h.nur_nass(al, ar))).is_ok(),
        None => false,
    };
    if !ok {
        al.fill(0.0);
        ar.fill(0.0);
    }
}
