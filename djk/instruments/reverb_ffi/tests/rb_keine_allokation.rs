//! Echtzeit-Gegenprobe für die RB-FFI: block, note_an, note_aus, alle_aus, setze und zuruecksetzen fordern keinen
//! Speicher an; neu schon (Positivkontrolle, sonst wäre der Zähler blind).
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
    let h = cypher_rb_neu(48000.0);
    assert!(!h.is_null());
    assert!(ANFORDERUNGEN.load(Ordering::SeqCst) > vor, "Positivkontrolle: neu muss allokieren, sonst ist der Zähler blind");
    let (mut l, mut r) = (vec![0f32; 256], vec![0f32; 256]);
    let ids = [c"lautstaerke", c"wellenform", c"cutoff", c"resonanz", c"env_mod", c"decay", c"accent", c"gibtsnicht"];
    let mut klang = false;
    let start = ANFORDERUNGEN.load(Ordering::SeqCst);
    for b in 0..2000u32 {
        unsafe {
            if b % 3 == 0 { cypher_rb_note_an(h, b % 256, (30 + b % 30) as u8, if b % 7 == 0 { 127 } else { 100 }); }
            if b % 5 == 0 { cypher_rb_note_aus(h, (b * 13) % 300, (30 + (b / 3) % 30) as u8); }
            if b % 97 == 0 { cypher_rb_alle_aus(h, 40); }
            if b % 11 == 0 { cypher_rb_setze(h, ids[(b / 11) as usize % ids.len()].as_ptr(), (b % 100) as f32 / 100.0); }
            if b % 400 == 399 { cypher_rb_vorgaben(h); cypher_rb_zuruecksetzen(h); }
            if b % 500 == 0 { for i in 0..300 { cypher_rb_note_an(h, i, 40, 90); } } // über die Warteschlange hinaus
            cypher_rb_block(h, l.as_mut_ptr(), r.as_mut_ptr(), 256);
        }
        klang |= l.iter().any(|v| *v != 0.0);
    }
    let danach = ANFORDERUNGEN.load(Ordering::SeqCst);
    unsafe { cypher_rb_frei(h) };
    assert_eq!(danach - start, 0, "Allokationen im Echtzeitpfad: {}", danach - start);
    assert!(klang, "Positivkontrolle: die Stimme klingt");
}
