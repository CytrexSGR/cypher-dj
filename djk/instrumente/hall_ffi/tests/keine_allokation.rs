//! Echtzeit-Gegenprobe für den Kern: block, setze und leeren fordern keinen Speicher an; neu schon (Positivkontrolle).
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
    let h = cypher_hall_neu(48000.0);
    assert!(!h.is_null());
    assert!(ANFORDERUNGEN.load(Ordering::SeqCst) > vor, "Positivkontrolle: neu muss allokieren, sonst ist der Zähler blind");
    let (mut il, mut ir, mut ol, mut or) = (vec![0f32; 256], vec![0f32; 256], vec![0f32; 256], vec![0f32; 256]);
    let mut e = cypher_hall_vorgabe();
    let start = ANFORDERUNGEN.load(Ordering::SeqCst);
    let mut z = 1u32;
    for b in 0..400 {
        for i in 0..256 {
            z = z.wrapping_mul(1664525).wrapping_add(1013904223);
            il[i] = ((z >> 9) as f32 / 8388608.0 - 1.0) * 0.3;
            ir[i] = -il[i];
        }
        if b % 50 == 25 {
            // Einstellung ändern, auch Rahmengröße (Überblendung) und Freeze
            e.decay_s = 1.0 + (b as f64) / 100.0;
            e.rahmen = (b / 50 % 5) as u32;
            e.duck = 0.5;
            e.freeze = (b / 50 % 2) as u8;
            unsafe { cypher_hall_setze(h, e) };
        }
        if b == 300 {
            unsafe { cypher_hall_leeren(h) };
        }
        unsafe { cypher_hall_block(h, il.as_ptr(), ir.as_ptr(), ol.as_mut_ptr(), or.as_mut_ptr(), 256) };
    }
    let danach = ANFORDERUNGEN.load(Ordering::SeqCst);
    unsafe { cypher_hall_frei(h) };
    assert_eq!(danach - start, 0, "Allokationen im Echtzeitpfad: {}", danach - start);
    assert!(ol.iter().any(|v| *v != 0.0), "Positivkontrolle: der Hall liefert Signal");
}
