//! Cypher Komp Slice 2: Echtzeit: block, setze und leeren fordern keinen Speicher an (eigene Datei: der Zähler ist global, parallele Tests würden mitzählen).
use komp_dsp::{Einstellung, Komp};
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

const FS: f64 = 48000.0;

#[test]
fn block_allokiert_nicht() {
    let mut k = Komp::neu(FS);
    let (mut l, mut r, sl, sr) = (vec![0f32; 256], vec![0f32; 256], vec![0.5f32; 256], vec![0.5f32; 256]);
    let vor = ANFORDERUNGEN.load(Ordering::SeqCst);
    let _positiv = vec![0u8; 16];
    assert!(ANFORDERUNGEN.load(Ordering::SeqCst) > vor, "Positivkontrolle: der Zähler sieht Allokationen");
    let start = ANFORDERUNGEN.load(Ordering::SeqCst);
    for b in 0..1000 {
        for i in 0..256 {
            l[i] = ((b * 256 + i) as f32 * 0.01).sin() * 0.8;
            r[i] = -l[i];
        }
        if b % 100 == 50 {
            k.setze(&Einstellung { attack_ms: 1.0 + b as f64 / 100.0, ..Einstellung::default() });
        }
        if b % 2 == 0 { k.block(&mut l, &mut r, None) } else { k.block(&mut l, &mut r, Some((&sl, &sr))) }
    }
    k.leeren();
    assert_eq!(ANFORDERUNGEN.load(Ordering::SeqCst), start);
}

