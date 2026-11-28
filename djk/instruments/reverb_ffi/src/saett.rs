//! C ABI around saett_dsp for the djk core (native insert module "saett", stereo in place). Header:
//! djk/core/include/cypherdj/cypher_saett_ffi.h. Same static library as the reverb, compressor and EQ.
//!
//! `cypher_saett_neu` and `cypher_saett_neu_pool` are the only allocators (outside the audio callback); `_block`, `_setze`,
//! `_leeren` and `_latenz` allocate nothing. A panic never crosses the boundary: in the block it is caught; the signal is untouched only if the
//! panic comes before the first sample is processed (a panic mid-block can leave the processed head of the block in
//! place). Latency is fixed by the constructor and the sample rate (`neu`: 69 samples below 88 kHz, `neu_pool`:
//! `saett_dsp::LATENZ_POOL` = 80 for every curve, Soft and Hard clip at 8x; 0 from 88 kHz) and does NOT depend on `mix`: the crate keeps a dry line delayed by the same amount, so mix 0 and mix 1 line up (spec D10,
//! sat_dsp/src/lib.rs).

use saett_dsp::{Einstellung, Kurve, Saett};
use std::panic::{catch_unwind, AssertUnwindSafe};

pub struct CypherSaett {
    s: Saett,
    // Last settings: `setze` and `setze_form` each change their part and re-apply the whole.
    e: Einstellung,
    #[cfg(feature = "fehlerinjektion")]
    gift: bool,
}

/// New instance for sample rate `fs` (Hz). `fs` <= 0 or not finite: null. Allocates (not in the callback). Defaults without
/// `cypher_saett_setze`: drive +12 dB, output -6 dB, mix 1 (it saturates at once).
#[no_mangle]
pub extern "C" fn cypher_saett_neu(fs: f64) -> *mut CypherSaett {
    if !(fs.is_finite() && fs > 0.0) {
        return std::ptr::null_mut();
    }
    match catch_unwind(|| {
        Box::into_raw(Box::new(CypherSaett {
            s: Saett::neu(fs),
            e: Einstellung::default(),
            #[cfg(feature = "fehlerinjektion")]
            gift: false,
        }))
    }) {
        Ok(p) => p,
        Err(_) => std::ptr::null_mut(),
    }
}

/// The pool object of the arrangement (strand 13, D7): Soft and Hard clip at 8x, Tanh as in `cypher_saett_neu` delayed, one
/// latency for every curve (`saett_dsp::LATENZ_POOL`, 0 from 88 kHz). Otherwise as `cypher_saett_neu`.
#[no_mangle]
pub extern "C" fn cypher_saett_neu_pool(fs: f64) -> *mut CypherSaett {
    if !(fs.is_finite() && fs > 0.0) {
        return std::ptr::null_mut();
    }
    match catch_unwind(|| {
        Box::into_raw(Box::new(CypherSaett {
            s: Saett::neu_pool(fs),
            e: Einstellung::default(),
            #[cfg(feature = "fehlerinjektion")]
            gift: false,
        }))
    }) {
        Ok(p) => p,
        Err(_) => std::ptr::null_mut(),
    }
}

/// # Safety
/// `h` from `cypher_saett_neu` / `cypher_saett_neu_pool` or null; not used afterwards.
#[no_mangle]
pub unsafe extern "C" fn cypher_saett_frei(h: *mut CypherSaett) {
    if !h.is_null() {
        drop(Box::from_raw(h));
    }
}

/// Drive and output level in dB, mix 0..1 (the crate clamps mix). The whole call is ignored if any value is non-finite;
/// drive and output are limited to +-60 dB so a wild value cannot overflow the gain.
/// # Safety
/// `h` valid or null, not concurrent with `cypher_saett_block`.
#[no_mangle]
pub unsafe extern "C" fn cypher_saett_setze(h: *mut CypherSaett, drive_db: f64, ausgang_db: f64, mix: f64) {
    if !(drive_db.is_finite() && ausgang_db.is_finite() && mix.is_finite()) {
        return;
    }
    if let Some(h) = h.as_mut() {
        let _ = catch_unwind(AssertUnwindSafe(|| {
            h.e = Einstellung { drive_db: drive_db.clamp(-60.0, 60.0), ausgang_db: ausgang_db.clamp(-60.0, 60.0), mix, ..h.e };
            h.s.setze(&h.e)
        }));
    }
}

/// Clip curve (0 tanh, 1 soft clip, 2 hard clip) and ceiling in dBFS (clamped to -24..0). A non-finite ceiling or a curve
/// above 2 is ignored (the call changes nothing). A new curve is cross-faded over 10 ms. Defaults: tanh, 0 dB (bit-equal
/// to the plain saturation). Drive, output and mix are kept.
/// # Safety
/// `h` valid or null, not concurrent with `cypher_saett_block`.
#[no_mangle]
pub unsafe extern "C" fn cypher_saett_setze_form(h: *mut CypherSaett, kurve: u8, decke_db: f64) {
    let kurve = match kurve {
        0 => Kurve::Tanh,
        1 => Kurve::Weich,
        2 => Kurve::Hart,
        _ => return,
    };
    if !decke_db.is_finite() {
        return;
    }
    if let Some(h) = h.as_mut() {
        let _ = catch_unwind(AssertUnwindSafe(|| {
            h.e = Einstellung { kurve, decke_db, ..h.e };
            h.s.setze(&h.e)
        }));
    }
}

/// Knee of the hard curve in dB (clamped to 0..12, smoothed; 0 = the plain hard clip, the default). A non-finite value is
/// ignored. Only the hard curve uses it. Drive, output, mix, curve and ceiling are kept.
/// # Safety
/// `h` valid or null, not concurrent with `cypher_saett_block`.
#[no_mangle]
pub unsafe extern "C" fn cypher_saett_setze_knie(h: *mut CypherSaett, knie_db: f64) {
    if !knie_db.is_finite() {
        return;
    }
    if let Some(h) = h.as_mut() {
        let _ = catch_unwind(AssertUnwindSafe(|| {
            h.e = Einstellung { knie_db, ..h.e };
            h.s.setze(&h.e)
        }));
    }
}

/// How far the driven signal went over the ceiling since the last call, in dB (0 if never); reads and resets. 0 for null.
/// # Safety
/// `h` valid or null, not concurrent with `cypher_saett_block`.
#[no_mangle]
pub unsafe extern "C" fn cypher_saett_clip_db(h: *mut CypherSaett) -> f32 {
    h.as_mut().map(|h| catch_unwind(AssertUnwindSafe(|| h.s.clip_db())).unwrap_or(0.0)).unwrap_or(0.0)
}

/// State to zero (the core's NaN guard), settings kept, no allocation.
/// # Safety
/// `h` valid or null.
#[no_mangle]
pub unsafe extern "C" fn cypher_saett_leeren(h: *mut CypherSaett) {
    if let Some(h) = h.as_mut() {
        let _ = catch_unwind(AssertUnwindSafe(|| h.s.leeren()));
    }
}

/// Latency in samples (44.1/48 kHz: 69 from `neu`, `LATENZ_POOL` = 80 from `neu_pool`; 0 from 88 kHz), 0 for null.
/// # Safety
/// `h` valid or null.
#[no_mangle]
pub unsafe extern "C" fn cypher_saett_latenz(h: *const CypherSaett) -> u32 {
    h.as_ref().map(|h| h.s.latenz() as u32).unwrap_or(0)
}

/// `n` samples in place. A null handle, null buffers or `n` = 0 leave the signal unchanged; a caught panic does so only if
/// it comes before the first sample (mid-block, the already processed head of the block stays processed).
/// # Safety
/// `l`, `r` valid for `n` f32 and not overlapping.
#[no_mangle]
pub unsafe extern "C" fn cypher_saett_block(h: *mut CypherSaett, l: *mut f32, r: *mut f32, n: usize) {
    if l.is_null() || r.is_null() || n == 0 {
        return;
    }
    let (l, r) = (std::slice::from_raw_parts_mut(l, n), std::slice::from_raw_parts_mut(r, n));
    if let Some(h) = h.as_mut() {
        let _ = catch_unwind(AssertUnwindSafe(|| {
            #[cfg(feature = "fehlerinjektion")]
            if h.gift {
                panic!("fehlerinjektion");
            }
            h.s.block(l, r)
        }));
    }
}

/// Test hook (feature `fehlerinjektion` only): the next `cypher_saett_block` panics.
/// # Safety
/// `h` valid or null.
#[cfg(feature = "fehlerinjektion")]
#[no_mangle]
pub unsafe extern "C" fn cypher_saett_vergifte(h: *mut CypherSaett) {
    if let Some(h) = h.as_mut() {
        h.gift = true;
    }
}
