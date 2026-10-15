//! Echtzeit: block und setze fordern keinen Speicher an (eigene Datei: der Zähler ist global).
use saett_dsp::{Einstellung, Saett};
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
}
#[global_allocator]
static A: Zaehler = Zaehler;

#[test]
fn block_allokiert_nicht() {
    let mut s = Saett::neu(48000.0);
    let (mut l, mut r) = (vec![0f32; 256], vec![0f32; 256]);
    let vor = ANFORDERUNGEN.load(Ordering::SeqCst);
    let _positiv = vec![0u8; 16];
    assert!(ANFORDERUNGEN.load(Ordering::SeqCst) > vor, "Positivkontrolle: der Zähler sieht Allokationen");
    let start = ANFORDERUNGEN.load(Ordering::SeqCst);
    for b in 0..500 {
        for i in 0..256 {
            l[i] = ((b * 256 + i) as f32 * 0.01).sin() * 0.8;
            r[i] = -l[i];
        }
        if b % 50 == 25 {
            s.setze(&Einstellung { drive_db: b as f64 / 20.0, ..Einstellung::default() });
        }
        s.block(&mut l, &mut r);
    }
    assert_eq!(ANFORDERUNGEN.load(Ordering::SeqCst), start);
}
