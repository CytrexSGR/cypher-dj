//! S20 review round 2 (bk20 MAJOR): `cypher_bk_zuruecksetzen` must make the program exactly as after `cypher_bk_neu`, for EVERY
//! shipped example graph (instruments and effects). Live (an instance that already played) and the offline render (a fresh
//! instance) are then the same sound. Per graph: play noise, reset, render a fixed run, compare bit for bit with a fresh instance.
//! The reset itself must not allocate (counting allocator, same as bk_keine_allokation).
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

const FS: f64 = 48_000.0;
const BLOCK: usize = 256;

fn rausch(zustand: &mut u64) -> f32 {
    *zustand ^= *zustand << 13;
    *zustand ^= *zustand >> 7;
    *zustand ^= *zustand << 17;
    ((*zustand >> 40) as f32 / (1u64 << 24) as f32) * 2.0 - 1.0
}

fn wurzel() -> std::path::PathBuf {
    let w = std::env::temp_dir().join(format!("bk-s20-zr-{}", std::process::id()));
    std::fs::create_dir_all(&w).unwrap();
    let d: Vec<f32> = (0..2 * 20_000).map(|i| ((i / 2) as f32 * 0.05).sin() * 0.5).collect();
    let b: Vec<u8> = d.iter().flat_map(|v| v.to_le_bytes()).collect();
    std::fs::write(w.join("d.f32"), &b).unwrap();
    // the sampler example names its own file
    let bsp = baukasten_dsp::proben::bytes(&baukasten_dsp::proben::orchester_schlag(48_000.0));
    std::fs::write(w.join("orchester-schlag.f32"), bsp).unwrap();
    // S22: sampler-fairlight reads the hit as three detune slices
    std::fs::write(w.join("orchester-schlag-schichten.f32"), baukasten_dsp::proben::bytes(&baukasten_dsp::proben::orchester_schlag_schichten(48_000.0))).unwrap();
    // and the S21 spring example reads its IR (merge S20 + S21)
    std::fs::write(w.join("feder-ir.f32"), baukasten_dsp::proben::bytes(&baukasten_dsp::proben::feder_ir(48_000.0))).unwrap();
    w
}

fn neu(json: &str, w: &std::path::Path) -> *mut CypherBk {
    let c = CString::new(json).unwrap();
    let wc = CString::new(w.to_str().unwrap()).unwrap();
    let mut fehler = [0 as std::ffi::c_char; 256];
    let h = cypher_bk_neu_wurzel(c.as_ptr(), FS, wc.as_ptr(), fehler.as_mut_ptr(), fehler.len());
    let text = unsafe { std::ffi::CStr::from_ptr(fehler.as_ptr()) }.to_string_lossy().into_owned();
    assert!(!h.is_null(), "{text}");
    h
}

/// `bloecke` blocks; instruments get a note pattern, effects get `ein` noise (same seed for every call).
fn lauf(h: *mut CypherBk, bloecke: usize, samen: u64, takt0: f64) -> Vec<f32> {
    let eff = cypher_bk_hat_eingang(h) != 0;
    let mut z = samen;
    let mut aus = Vec::new();
    for b in 0..bloecke {
        cypher_bk_takt(h, takt0 + b as f64 * BLOCK as f64 * 2.0 / FS, 2.0 / FS);
        let (mut l, mut r) = (vec![0f32; BLOCK], vec![0f32; BLOCK]);
        if eff {
            let el: Vec<f32> = (0..BLOCK).map(|_| 0.5 * rausch(&mut z)).collect();
            let er: Vec<f32> = (0..BLOCK).map(|_| 0.5 * rausch(&mut z)).collect();
            assert_eq!(cypher_bk_effekt(h, el.as_ptr(), er.as_ptr(), l.as_mut_ptr(), r.as_mut_ptr(), BLOCK), 0);
        } else {
            if b % 20 == 0 {
                for (i, n) in [48u8, 55, 60].iter().enumerate() {
                    cypher_bk_note_an(h, 10 + 30 * i as u32, *n + (b as u8 / 20) % 5, 0.4 + 0.2 * i as f32);
                }
            }
            if b % 20 == 14 {
                cypher_bk_alle_aus(h, 5);
            }
            assert_eq!(cypher_bk_block(h, l.as_mut_ptr(), r.as_mut_ptr(), BLOCK), 0);
        }
        aus.extend(l.iter().zip(&r).flat_map(|(a, b)| [*a, *b]));
    }
    aus
}

fn bit_gleich(a: &[f32], b: &[f32]) -> Option<(usize, f32, f32)> {
    a.iter().zip(b).position(|(x, y)| x.to_bits() != y.to_bits()).map(|i| (i, a[i], b[i]))
}

#[test]
fn zuruecksetzen_wie_frisch_fuer_jeden_beispielgraphen() {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../modular_dsp/demos");
    let mut namen: Vec<_> = std::fs::read_dir(&dir).unwrap().map(|e| e.unwrap().path()).filter(|p| p.extension().map_or(false, |e| e == "json")).collect();
    namen.sort();
    assert!(namen.len() >= 22, "positive control: all shipped example graphs found, not {}", namen.len());
    let w = wurzel();
    let mut fehlgeschlagen = Vec::new();
    let (mut mit_hall, mut mit_hall_ohne_reset_anders, mut instrumente) = (0, 0, 0);
    for p in &namen {
        let name = p.file_stem().unwrap().to_string_lossy().into_owned();
        let json = std::fs::read_to_string(p).unwrap();
        let hat_hall = json.contains("\"art\":\"hall\"") || json.contains("\"art\": \"hall\"");
        // 600 blocks of 256 = 3.2 s: more than enough for several hall frames, echo repeats, LFO periods
        let frisch = { let h = neu(&json, &w); let x = lauf(h, 100, 7, 0.0); cypher_bk_frei(h); x };
        // played with other material (other noise seed, other beat), then reset
        let h = neu(&json, &w);
        if cypher_bk_hat_eingang(h) == 0 { instrumente += 1; }
        let _ = lauf(h, 150, 99, 13.37);
        // control: without reset the same run is NOT the fresh one (else the play left no state and the test would be blind)
        let ohne = lauf(h, 100, 7, 0.0);
        let h2 = neu(&json, &w);
        let _ = lauf(h2, 150, 99, 13.37);
        let vor = ANFORDERUNGEN.load(Ordering::SeqCst);
        cypher_bk_zuruecksetzen(h2);
        let allok = ANFORDERUNGEN.load(Ordering::SeqCst) - vor;
        let nach = lauf(h2, 100, 7, 0.0);
        cypher_bk_frei(h);
        cypher_bk_frei(h2);
        if allok != 0 { fehlgeschlagen.push(format!("{name}: reset allocated {allok}")); }
        if let Some((i, a, b)) = bit_gleich(&frisch, &nach) {
            fehlgeschlagen.push(format!("{name}: sample {i}: fresh {a}, after play+reset {b}"));
        }
        assert!(frisch.iter().any(|v| *v != 0.0), "{name}: positive control: the graph sounds");
        if hat_hall {
            mit_hall += 1;
            if bit_gleich(&frisch, &ohne).is_some() { mit_hall_ohne_reset_anders += 1; }
        }
    }
    assert!(instrumente >= 11, "positive control: instrument graphs {instrumente}");
    assert!(mit_hall >= 4, "positive control: graphs with a hall node: {mit_hall}");
    assert_eq!(mit_hall, mit_hall_ohne_reset_anders, "control: without reset every hall graph differs from fresh");
    assert!(fehlgeschlagen.is_empty(), "reset != fresh:\n{}", fehlgeschlagen.join("\n"));
}
