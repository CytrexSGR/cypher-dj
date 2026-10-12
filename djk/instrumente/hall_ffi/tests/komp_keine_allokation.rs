//! Echtzeit: cypher_komp_block, _setze, _leeren, _gr_db fordern keinen Speicher an; _neu schon (Positivkontrolle).
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
    let h = cypher_komp_neu(48000.0);
    assert!(ANFORDERUNGEN.load(Ordering::SeqCst) > vor, "Positivkontrolle: neu muss allokieren");
    let (mut l, mut r) = (vec![0f32; 256], vec![0f32; 256]);
    let start = ANFORDERUNGEN.load(Ordering::SeqCst);
    for b in 0..500 {
        for i in 0..256 {
            l[i] = (((b * 256 + i) as f32) * 0.03).sin();
            r[i] = l[i];
        }
        unsafe {
            if b % 50 == 0 {
                cypher_komp_setze(h, CypherKompEinstellung { schwelle_db: -10.0 - b as f64 / 50.0, ratio: 4.0, knie_db: 6.0, attack_ms: 10.0, release_ms: 120.0, makeup_db: 0.0, mix: 1.0, sc_hochpass_hz: 0.0 });
            }
            cypher_komp_block(h, l.as_mut_ptr(), r.as_mut_ptr(), 256);
            let _ = cypher_komp_gr_db(h);
            if b == 400 {
                cypher_komp_leeren(h);
            }
        }
    }
    assert_eq!(ANFORDERUNGEN.load(Ordering::SeqCst), start);
    unsafe { cypher_komp_frei(h) };
}
