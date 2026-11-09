//! S10 task 1: memory at translation. One `Box<[f32]>` per sampler node, shared by all voices (D5). This binary has exactly
//! one test: the counting allocator is global and parallel tests would disturb it.
mod sampler_hilfe;
use baukasten_dsp::uebersetze_mit_wurzel;
use sampler_hilfe::*;
use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering};

struct Zaehler;
static BYTES: AtomicUsize = AtomicUsize::new(0);
unsafe impl GlobalAlloc for Zaehler {
    unsafe fn alloc(&self, l: Layout) -> *mut u8 {
        BYTES.fetch_add(l.size(), Ordering::SeqCst);
        System.alloc(l)
    }
    unsafe fn dealloc(&self, p: *mut u8, l: Layout) { System.dealloc(p, l) }
    unsafe fn realloc(&self, p: *mut u8, l: Layout, n: usize) -> *mut u8 {
        BYTES.fetch_add(n, Ordering::SeqCst);
        System.realloc(p, l, n)
    }
}
#[global_allocator]
static A: Zaehler = Zaehler;

fn angefordert(json: &str, w: &std::path::Path) -> usize {
    let vor = BYTES.load(Ordering::SeqCst);
    let p = uebersetze_mit_wurzel(json, 48_000.0, Some(w)).unwrap();
    let n = BYTES.load(Ordering::SeqCst) - vor;
    drop(p);
    n
}

#[test]
fn one_copy_of_the_data_per_node_whatever_the_voice_count() {
    let w = wurzel();
    let frames = 100_000;
    schreibe(&w, "d.f32", &sinus(300.0, frames, 0.5));
    let datei = frames * 8;
    let eins = angefordert(&graph("d.f32", "", 1), &w);
    let vier = angefordert(&graph("d.f32", "", 4), &w);
    let sechzehn = angefordert(&graph("d.f32", "", 16), &w);
    println!("MESS speicher: Datei {datei} B, 1 Stimme {eins} B, 4 Stimmen {vier} B, 16 Stimmen {sechzehn} B");
    assert!(eins >= datei && eins <= datei + 200_000, "one voice: {eins} vs file {datei}");
    assert!(vier.abs_diff(eins) < 2_000, "4 voices {vier} vs 1 voice {eins}");
    assert!(sechzehn.abs_diff(eins) < 2_000, "16 voices {sechzehn} vs 1 voice {eins}");
}
