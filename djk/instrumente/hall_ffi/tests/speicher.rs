//! Misst den Speicher je Hall (für die Beat-FX-Planung: 16 Instanzen im Kern).
use hall_ffi::*;
use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering};
struct Z;
static B: AtomicUsize = AtomicUsize::new(0);
unsafe impl GlobalAlloc for Z {
    unsafe fn alloc(&self, l: Layout) -> *mut u8 { B.fetch_add(l.size(), Ordering::SeqCst); System.alloc(l) }
    unsafe fn dealloc(&self, p: *mut u8, l: Layout) { B.fetch_sub(l.size(), Ordering::SeqCst); System.dealloc(p, l) }
}
#[global_allocator]
static A: Z = Z;
#[test]
fn bytes_je_hall() {
    let vor = B.load(Ordering::SeqCst);
    let h = cypher_hall_neu(48000.0);
    let bytes = B.load(Ordering::SeqCst) - vor;
    println!("Bytes je Hall: {bytes} ({:.2} MB)", bytes as f64 / 1e6);
    unsafe { cypher_hall_frei(h) };
    assert!(bytes > 0);
}
