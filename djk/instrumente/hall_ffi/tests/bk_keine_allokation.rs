//! Echtzeit-Gegenprobe für die Baukasten-FFI (Baukasten S3a): block, note_an, note_aus, alle_aus fordern keinen Speicher
//! an; neu schon (Positivkontrolle, sonst wäre der Zähler blind).
use hall_ffi::baukasten::*;
use std::alloc::{GlobalAlloc, Layout, System};
use std::ffi::CString;
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
fn bk_block_allokiert_nicht() {
    let json = CString::new(include_str!("../../baukasten_dsp/beispiele/juno-pad.json")).unwrap();
    let mut fehler = [0 as std::ffi::c_char; 256];
    let vor = ANFORDERUNGEN.load(Ordering::SeqCst);
    let h = cypher_bk_neu(json.as_ptr(), 48_000.0, fehler.as_mut_ptr(), fehler.len());
    assert!(!h.is_null());
    assert!(ANFORDERUNGEN.load(Ordering::SeqCst) > vor, "Positivkontrolle: neu muss allokieren, sonst ist der Zähler blind");
    let (mut l, mut r) = (vec![0f32; 256], vec![0f32; 256]);
    let mut klang = false;
    let start = ANFORDERUNGEN.load(Ordering::SeqCst);
    for b in 0..200u32 {
        if b % 2 == 0 { cypher_bk_note_an(h, (b * 7) % 256, (40 + b % 30) as u8, 0.8); }
        if b % 3 == 0 { cypher_bk_note_aus(h, (b * 13) % 300, (40 + (b / 3) % 30) as u8); }
        if b % 50 == 49 { cypher_bk_alle_aus(h, 40); }
        if b == 100 { for i in 0..300 { cypher_bk_note_an(h, i, 50, 0.9); } } // über die Warteschlange hinaus
        assert!(cypher_bk_block(h, l.as_mut_ptr(), r.as_mut_ptr(), 256) == 0);
        klang |= l.iter().any(|v| *v != 0.0);
    }
    let danach = ANFORDERUNGEN.load(Ordering::SeqCst);
    let verloren = cypher_bk_verloren(h);
    cypher_bk_frei(h);
    assert_eq!(danach - start, 0, "Allokationen im Echtzeitpfad: {}", danach - start);
    assert!(klang, "Positivkontrolle: der Graph klingt");
    assert!(verloren > 0, "Positivkontrolle: die volle Warteschlange wurde erreicht");

    // Effekt und Takt (S3c): zweite Schleife im selben Test, der Zähler ist prozessweit
    {
    for g in [include_str!("../../baukasten_dsp/beispiele/fx-echo-achtel.json"), include_str!("../../baukasten_dsp/beispiele/fx-filter-wobble.json")] {
        let json = CString::new(g).unwrap();
        let mut fehler = [0 as std::ffi::c_char; 256];
        let h = cypher_bk_neu(json.as_ptr(), 48_000.0, fehler.as_mut_ptr(), fehler.len());
        assert!(!h.is_null());
        let ein: Vec<f32> = (0..256).map(|i| (i as f32 * 0.05).sin() * 0.5).collect();
        let (mut l, mut r) = (vec![0f32; 256], vec![0f32; 256]);
        let mut klang = false;
        let start = ANFORDERUNGEN.load(Ordering::SeqCst);
        for b in 0..200u32 {
            cypher_bk_takt(h, b as f64 * 256.0 * 2.0 / 48_000.0, 2.0 / 48_000.0);
            assert!(cypher_bk_effekt(h, ein.as_ptr(), ein.as_ptr(), l.as_mut_ptr(), r.as_mut_ptr(), 256) == 0);
            klang |= l.iter().any(|v| *v != 0.0);
        }
        let danach = ANFORDERUNGEN.load(Ordering::SeqCst);
        cypher_bk_frei(h);
        assert_eq!(danach - start, 0, "Allokationen im Echtzeitpfad: {}", danach - start);
        assert!(klang, "Positivkontrolle: der Effekt gibt Signal");
    }
}
}
