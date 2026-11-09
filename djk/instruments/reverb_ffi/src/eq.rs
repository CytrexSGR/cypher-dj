//! C ABI around eq_dsp for the djk core (native insert module "eq", 8 bands, stereo in place). Header:
//! djk/core/include/cypherdj/cypher_eq_ffi.h. Same static library as the reverb and the compressor, because two Rust
//! static libraries in one binary collide over the Rust runtime.
//!
//! `cypher_eq_neu` is the only allocator (outside the audio callback); `_block`, `_setze_band`, `_setze_global`,
//! `_leeren` and `_latenz` allocate nothing. A panic never crosses the boundary: in the block it leaves the signal
//! unchanged. Latency is fixed by the sample rate chosen in `neu` (69 samples below 88 kHz, else 0) and does NOT depend
//! on any band setting: the crate always runs the oversampler, so "all bands off" keeps the delay (spec D10).

use eq_dsp::{BandArt, BandEinstellung, Eq, Kanal, Steilheit, BAENDER};
use std::panic::{catch_unwind, AssertUnwindSafe};

/// One band over the C boundary. Enums are u8 codes in the order of the crate (art: Glocke, LowShelf, HighShelf, LowCut,
/// HighCut, Kerbe, Bandpass; steilheit: 12, 24, 36, 48 dB; kanal: Stereo, Mid, Side); a code beyond the last is clamped
/// to the last.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct CypherEqBand {
    pub freq: f64,
    pub gain_db: f64,
    pub q: f64,
    pub an: u8,
    pub art: u8,
    pub steilheit: u8,
    pub kanal: u8,
}

impl From<CypherEqBand> for BandEinstellung {
    fn from(c: CypherEqBand) -> Self {
        const ARTEN: [BandArt; 7] = [BandArt::Glocke, BandArt::LowShelf, BandArt::HighShelf, BandArt::LowCut, BandArt::HighCut, BandArt::Kerbe, BandArt::Bandpass];
        const STEIL: [Steilheit; 4] = [Steilheit::Db12, Steilheit::Db24, Steilheit::Db36, Steilheit::Db48];
        const KAN: [Kanal; 3] = [Kanal::Stereo, Kanal::Mid, Kanal::Side];
        BandEinstellung {
            an: c.an != 0,
            art: ARTEN[(c.art as usize).min(ARTEN.len() - 1)],
            freq: c.freq,
            gain_db: c.gain_db,
            q: c.q,
            steilheit: STEIL[(c.steilheit as usize).min(STEIL.len() - 1)],
            kanal: KAN[(c.kanal as usize).min(KAN.len() - 1)],
        }
    }
}

pub struct CypherEq {
    e: Eq,
    #[cfg(feature = "fehlerinjektion")]
    gift: bool,
}

#[no_mangle]
pub extern "C" fn cypher_eq_neu(fs: f64) -> *mut CypherEq {
    if !fs.is_finite() || fs <= 0.0 {
        return std::ptr::null_mut();
    }
    match catch_unwind(|| {
        Box::into_raw(Box::new(CypherEq {
            e: Eq::neu(fs),
            #[cfg(feature = "fehlerinjektion")]
            gift: false,
        }))
    }) {
        Ok(p) => p,
        Err(_) => std::ptr::null_mut(),
    }
}

/// # Safety
/// `h` from `cypher_eq_neu` or null; not used afterwards. A panic while dropping is swallowed (the memory may leak).
#[no_mangle]
pub unsafe extern "C" fn cypher_eq_frei(h: *mut CypherEq) {
    if !h.is_null() {
        let b = Box::from_raw(h);
        let _ = catch_unwind(AssertUnwindSafe(move || {
            #[cfg(feature = "fehlerinjektion")]
            if b.gift {
                panic!("fehlerinjektion");
            }
            drop(b)
        }));
    }
}

/// Band `i` (0..8). An index out of range is ignored. A non-finite freq/gain/q is ignored for an active band (`an != 0`);
/// for a band going off (`an == 0`) the call still switches it off and keeps the old numbers.
/// # Safety
/// `h` valid or null, not concurrent with `cypher_eq_block`.
#[no_mangle]
pub unsafe extern "C" fn cypher_eq_setze_band(h: *mut CypherEq, i: u32, b: CypherEqBand) {
    // Switching a band off must always arrive, whatever the other fields hold; only an active band needs finite values.
    if i as usize >= BAENDER || (b.an != 0 && !(b.freq.is_finite() && b.gain_db.is_finite() && b.q.is_finite())) {
        return;
    }
    if let Some(h) = h.as_mut() {
        // A band that is going off keeps its current numbers when the new ones are not finite.
        let _ = catch_unwind(AssertUnwindSafe(|| {
            let mut e: BandEinstellung = b.into();
            if b.an == 0 && !(b.freq.is_finite() && b.gain_db.is_finite() && b.q.is_finite()) {
                let alt = h.e.band(i as usize);
                e.freq = alt.freq;
                e.gain_db = alt.gain_db;
                e.q = alt.q;
            }
            h.e.setze_band(i as usize, e)
        }));
    }
}

/// Global settings: proportional Q on/off and the output level in dB (the crate clamps to +-24). A non-finite level is ignored.
/// # Safety
/// `h` valid or null.
#[no_mangle]
pub unsafe extern "C" fn cypher_eq_setze_global(h: *mut CypherEq, prop_q: u8, ausgang_db: f64) {
    if let Some(h) = h.as_mut() {
        let _ = catch_unwind(AssertUnwindSafe(|| {
            h.e.setze_prop_q(prop_q != 0);
            if ausgang_db.is_finite() {
                h.e.setze_ausgang_db(ausgang_db);
            }
        }));
    }
}

/// State to zero (the core's NaN guard), settings kept, no allocation.
/// # Safety
/// `h` valid or null.
#[no_mangle]
pub unsafe extern "C" fn cypher_eq_leeren(h: *mut CypherEq) {
    if let Some(h) = h.as_mut() {
        let _ = catch_unwind(AssertUnwindSafe(|| h.e.reset()));
    }
}

/// Latency in samples (69 at 44.1/48 kHz, 0 from 88 kHz), 0 for null. `neu` returns null for a non-finite or non-positive `fs`.
/// # Safety
/// `h` valid or null.
#[no_mangle]
pub unsafe extern "C" fn cypher_eq_latenz(h: *const CypherEq) -> u32 {
    h.as_ref()
        .and_then(|h| {
            catch_unwind(AssertUnwindSafe(|| {
                #[cfg(feature = "fehlerinjektion")]
                if h.gift {
                    panic!("fehlerinjektion");
                }
                h.e.latenz() as u32
            }))
            .ok()
        })
        .unwrap_or(0)
}

/// `n` samples in place. Null handle, null buffers or a panic leave the signal unchanged.
/// # Safety
/// `l`, `r` valid for `n` f32 and not overlapping.
#[no_mangle]
pub unsafe extern "C" fn cypher_eq_block(h: *mut CypherEq, l: *mut f32, r: *mut f32, n: usize) {
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
            h.e.verarbeite_stereo(l, r)
        }));
    }
}

/// Test hook (feature `fehlerinjektion` only): the next `cypher_eq_block` panics.
/// # Safety
/// `h` valid or null.
#[cfg(feature = "fehlerinjektion")]
#[no_mangle]
pub unsafe extern "C" fn cypher_eq_vergifte(h: *mut CypherEq) {
    if let Some(h) = h.as_mut() {
        h.gift = true;
    }
}
