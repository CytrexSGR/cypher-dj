//! Real time: block, setze and the note calls request no memory (own file: the counter is global).
use labor_dsp::{Einstellung, Labor};
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
fn block_does_not_allocate() {
    let mut s = Labor::neu(48000.0);
    let (mut l, mut r) = (vec![0f32; 256], vec![0f32; 256]);
    let vor = ANFORDERUNGEN.load(Ordering::SeqCst);
    let _positiv = vec![0u8; 16];
    assert!(ANFORDERUNGEN.load(Ordering::SeqCst) > vor, "positive control: the counter sees allocations");
    let start = ANFORDERUNGEN.load(Ordering::SeqCst);
    for b in 0..400 {
        for i in 0..256 {
            l[i] = ((b * 256 + i) as f32 * 0.01).sin() * 0.8;
            r[i] = -l[i];
        }
        if b % 50 == 25 {
            let mut e = Einstellung::default();
            e.kanal[0].zeit_ms = 46.0 + b as f64;
            e.kanal[1].delay_an = b % 100 == 25;
            e.zyklus = true;
            s.setze(&e);
            s.note_an(60, 0.8);
        }
        if b % 50 == 40 {
            s.note_aus();
        }
        s.block(&mut l, &mut r);
    }
    assert_eq!(ANFORDERUNGEN.load(Ordering::SeqCst), start);
}
