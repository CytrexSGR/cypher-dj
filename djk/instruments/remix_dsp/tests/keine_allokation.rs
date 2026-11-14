//! Real time: block, setze and leeren request no memory (own file: the counter is global).
use remix_dsp::{Einstellung, Remix};
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
    let mut s = Remix::neu(48000.0);
    let (mut l, mut r) = (vec![0f32; 256], vec![0f32; 256]);
    let vor = ANFORDERUNGEN.load(Ordering::SeqCst);
    let _positiv = vec![0u8; 16];
    assert!(ANFORDERUNGEN.load(Ordering::SeqCst) > vor, "positive control: the counter sees allocations");
    let start = ANFORDERUNGEN.load(Ordering::SeqCst);
    let bps = 128.0 / 60.0 / 48000.0;
    for b in 0..1200usize {
        for i in 0..256 {
            l[i] = ((b * 256 + i) as f32 * 0.01).sin() * 0.8;
            r[i] = -l[i];
        }
        // walk through every effect of every section, with touches, a pattern and the lever
        let e = Einstellung {
            szene_typ: ((b / 60) % 11) as u8,
            szene: 0.8,
            sub2: 0.6,
            iso_typ: ((b / 45) % 5) as u8,
            low: if b % 90 < 45 { -0.9 } else { 0.9 },
            mid: 0.5,
            hi: -0.5,
            roll: b % 200 > 100,
            kick: b % 40 > 20,
            snare: b % 60 > 30,
            clap: b % 80 > 40,
            hat: b % 20 > 10,
            beruehrt: b % 150 > 75,
            overdub: b % 600 > 300,
            pitch: 5.0,
            rel_typ: ((b / 200) % 3) as u8,
            hebel: if b % 200 > 160 { 0.9 } else { 0.0 },
            pumpen: 0.5,
            ..Einstellung::default()
        };
        s.setze(&e);
        if b == 700 {
            s.leeren();
        }
        s.block(&mut l, &mut r, b as f64 * 256.0 * bps, bps);
    }
    assert_eq!(ANFORDERUNGEN.load(Ordering::SeqCst), start);
}
