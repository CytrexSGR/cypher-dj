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
    let json = CString::new(include_str!("../../modular_dsp/demos/juno-pad.json")).unwrap();
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
        // S5r: Regler laufend umstellen, die Glättung bewegt sich in fast jedem Block
        assert_eq!(cypher_bk_regler(h, 1 + b % 8, ((b * 37) % 100) as f32 / 100.0), 0);
        if b == 100 { for i in 0..300 { cypher_bk_note_an(h, i, 50, 0.9); } } // über die Warteschlange hinaus
        if b % 60 == 59 { cypher_bk_zuruecksetzen(h); }   // S20: the reset allocates nothing either
        if b % 45 == 44 { cypher_bk_regler_sofort(h, 1 + b % 8, 0.3); }   // S20: neither does the immediate knob
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
    for g in [include_str!("../../modular_dsp/demos/fx-echo-achtel.json"), include_str!("../../modular_dsp/demos/fx-filter-wobble.json")] {
        let json = CString::new(g).unwrap();
        let mut fehler = [0 as std::ffi::c_char; 256];
        let h = cypher_bk_neu(json.as_ptr(), 48_000.0, fehler.as_mut_ptr(), fehler.len());
        assert!(!h.is_null());
        let ein: Vec<f32> = (0..256).map(|i| (i as f32 * 0.05).sin() * 0.5).collect();
        let (mut l, mut r) = (vec![0f32; 256], vec![0f32; 256]);
        let mut klang = false;
        let start = ANFORDERUNGEN.load(Ordering::SeqCst);
        for b in 0..200u32 {
            assert_eq!(cypher_bk_regler(h, 1 + b % 8, ((b * 53) % 100) as f32 / 100.0), 0);
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
    // sampler A2 task 5: latched knobs, `regler_bei` and notes for 2000 blocks allocate nothing (same process-wide counter)
    {
        let w = std::env::temp_dir().join(format!("bk-a2t5-alloc-{}", std::process::id()));
        std::fs::create_dir_all(&w).unwrap();
        let d: Vec<f32> = (0..90_000).flat_map(|i| { let v = (0.5 * (2.0 * std::f32::consts::PI * 480.0 * i as f32 / 48_000.0).sin()) as f32; [v, v] }).collect();
        std::fs::write(w.join("sinus.f32"), d.iter().flat_map(|v| v.to_le_bytes()).collect::<Vec<u8>>()).unwrap();
        let g = format!(r#"{{"format":"baukasten/2","name":"p","stimmen":4,"knoten":[{{"id":"n","art":"note"}},{{"id":"k","art":"regler","nr":3,"min":-12,"max":12,"rastet":1}},{{"id":"l","art":"regler","nr":1,"min":0,"max":1}},{{"id":"s","art":"sampler","datei":"sinus.f32","noten_wahl":1,"grenzen":[{}]}},{{"id":"m","art":"mul"}},{{"id":"o","art":"ausgang"}}],"kanten":[{{"von":"n.hz","nach":"s.hz"}},{{"von":"n.trig","nach":"s.trig"}},{{"von":"n.gate","nach":"s.gate"}},{{"von":"k.aus","nach":"s.halb"}},{{"von":"s.l","nach":"m.a"}},{{"von":"l.aus","nach":"m.b"}},{{"von":"m.aus","nach":"o.l"}},{{"von":"m.aus","nach":"o.r"}}]}}"#,
                        (0..=16).map(|k| (k * 5625).to_string()).collect::<Vec<_>>().join(","));
        let json = CString::new(g).unwrap();
        let wc = CString::new(w.to_str().unwrap()).unwrap();
        let mut fehler = [0 as std::ffi::c_char; 256];
        let h = cypher_bk_neu_wurzel(json.as_ptr(), 48_000.0, wc.as_ptr(), fehler.as_mut_ptr(), fehler.len());
        assert!(!h.is_null());
        assert_ne!(cypher_bk_rastende(h), 0);
        let (mut l, mut r) = (vec![0f32; 256], vec![0f32; 256]);
        let mut klang = false;
        let (mut abgewiesen, mut verloren_vorher) = (0, 0);
        let start = ANFORDERUNGEN.load(Ordering::SeqCst);
        for b in 0..2000u32 {
            assert_eq!(cypher_bk_regler_bei(h, (b * 11) % 256, 3, ((b * 37) % 100) as f32 / 100.0), 0);
            cypher_bk_note_an(h, (b * 11) % 256, (b % 16) as u8, 0.8);
            if b % 3 == 0 { cypher_bk_note_aus(h, (b * 29) % 256, (b % 16) as u8); }
            assert_eq!(cypher_bk_regler_bei(h, 5, 1, 0.5), -2); // a gliding knob is refused without allocating
            abgewiesen += 1;
            if b % 7 == 0 { assert_eq!(cypher_bk_regler(h, 3, ((b * 13) % 100) as f32 / 100.0), 0); }
            if b == 1000 { for i in 0..300 { cypher_bk_regler_bei(h, i, 3, 0.5); } } // over the queue
            if b % 500 == 499 { cypher_bk_zuruecksetzen(h); }
            assert!(cypher_bk_block(h, l.as_mut_ptr(), r.as_mut_ptr(), 256) == 0);
            klang |= l.iter().any(|v| *v != 0.0);
            if b == 1000 { verloren_vorher = cypher_bk_verloren(h); }
        }
        let danach = ANFORDERUNGEN.load(Ordering::SeqCst);
        let verloren = cypher_bk_verloren(h);
        cypher_bk_frei(h);
        assert_eq!(danach - start, 0, "Allokationen im Echtzeitpfad mit regler_bei: {}", danach - start);
        assert!(klang, "Positivkontrolle: der Sampler klingt");
        assert!(abgewiesen > 0 && verloren > 0 && verloren_vorher > 0, "Positivkontrolle: die volle Warteschlange wurde erreicht");
    }
}
