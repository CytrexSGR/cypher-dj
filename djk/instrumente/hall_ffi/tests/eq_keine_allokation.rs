//! Real time: cypher_eq_block, _setze_band, _setze_global, _leeren allocate nothing; _neu does (positive control).
use hall_ffi::*;
use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering};

struct Zaehler;
static ANFORDERUNGEN: AtomicUsize = AtomicUsize::new(0);
unsafe impl GlobalAlloc for Zaehler {
    unsafe fn alloc(&self, l: Layout) -> *mut u8 {
        ANFORDERUNGEN.fetch_add(1, Ordering::SeqCst);
        System.alloc(l)
    }
    unsafe fn dealloc(&self, p: *mut u8, l: Layout) {
        System.dealloc(p, l)
    }
    unsafe fn realloc(&self, p: *mut u8, l: Layout, n: usize) -> *mut u8 {
        ANFORDERUNGEN.fetch_add(1, Ordering::SeqCst);
        System.realloc(p, l, n)
    }
}
#[global_allocator]
static A: Zaehler = Zaehler;

#[test]
fn echtzeitpfad_allokiert_nicht() {
    let vor = ANFORDERUNGEN.load(Ordering::SeqCst);
    let h = cypher_eq_neu(48000.0);
    assert!(ANFORDERUNGEN.load(Ordering::SeqCst) > vor, "positive control: neu must allocate");
    let (mut l, mut r) = (vec![0f32; 256], vec![0f32; 256]);
    let start = ANFORDERUNGEN.load(Ordering::SeqCst);
    for b in 0..500 {
        for i in 0..256 {
            l[i] = (((b * 256 + i) as f32) * 0.03).sin();
            r[i] = l[i];
        }
        unsafe {
            if b % 25 == 0 {
                for k in 0..8u32 {
                    cypher_eq_setze_band(h, k, CypherEqBand { freq: 100.0 * (k + 1) as f64 + b as f64, gain_db: (k as f64) - 3.0, q: 1.0, an: 1, art: (k % 7) as u8, steilheit: (k % 4) as u8, kanal: (k % 3) as u8 });
                }
                cypher_eq_setze_global(h, (b % 2) as u8, -(b as f64) / 100.0);
            }
            cypher_eq_block(h, l.as_mut_ptr(), r.as_mut_ptr(), 256);
            let _ = cypher_eq_latenz(h);
            if b == 400 {
                cypher_eq_leeren(h);
            }
        }
    }
    assert_eq!(ANFORDERUNGEN.load(Ordering::SeqCst), start);
    unsafe { cypher_eq_frei(h) };
}
