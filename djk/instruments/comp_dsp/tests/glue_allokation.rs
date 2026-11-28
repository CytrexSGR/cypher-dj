//! Glue: block, setze, setze_charakter, wirksam and leeren do not allocate (own file: the counter is global).
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
fn glue_allokiert_nicht() {
    let mut k = Komp::neu(FS);
    let (mut l, mut r) = (vec![0f32; 256], vec![0f32; 256]);
    let vor = ANFORDERUNGEN.load(Ordering::SeqCst);
    let _positiv = vec![0u8; 16];
    assert!(ANFORDERUNGEN.load(Ordering::SeqCst) > vor, "positive control: the counter sees allocations");
    let start = ANFORDERUNGEN.load(Ordering::SeqCst);
    for b in 0..1000 {
        for i in 0..256 {
            l[i] = ((b * 256 + i) as f32 * 0.01).sin() * 0.8;
            r[i] = -l[i];
        }
        if b % 50 == 10 {
            k.setze(&Einstellung { ratio: 1.0 + (b % 7) as f64, attack_ms: 1.0 + b as f64 / 100.0, ..Einstellung::default() });
            k.setze_charakter(b % 100 == 10, b % 3 == 0);
            let _ = k.wirksam();
        }
        k.block(&mut l, &mut r, None);
    }
    k.leeren();
    assert_eq!(ANFORDERUNGEN.load(Ordering::SeqCst), start);
}
