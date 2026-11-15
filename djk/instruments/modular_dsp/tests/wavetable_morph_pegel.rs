//! Level of the wavetable morph (backlog sound, task 14; card t_a87b352d item 2).
//!
//! Claim of the archivist's concept S18: blending two frames linearly in the time domain dips the level by up to 6 dB where the
//! frames are out of phase (`Tabelle::lese`, wavetable.rs, does exactly that blend). This measures it before anything is built.
//!
//! For each of the seven tables and the notes 36, 48, 60, 72: one `wavetable` node (`kopien` 1, `glatt` 0, `zufall` 0) is played
//! with `pos` from 0.00 to 1.00 in steps of 0.02 plus the exact frame positions (a frame sits at i / (frames - 1), which the grid
//! misses for 4 and 8 frames); RMS of 0.5 s per position. Per table and note:
//!   * `dip_db`: the largest dip below the mean (in dB) of the levels at the two frame endpoints of the segment the position
//!     lies in, over all positions and segments (negative = the blend is louder than its endpoints),
//!   * `dip_gesamt_db`: the largest dip below the mean level of all frames of the table.
//! A table with one frame has nothing to morph: its rows say "no morph", not a zero dip.
//!
//! `cargo test --release -p baukasten_dsp --test wavetable_morph_pegel -- --nocapture` prints `MESS table note dip_db` and writes
//! `~/messungen/2026-11-15-backlog/sound/task14/morph-pegel.json`. The numbers of the first run are regression bounds (`GRENZEN`).
use baukasten_dsp::wavetable::{Tabelle, TABELLEN};
use baukasten_dsp::{uebersetze, Programm};

const SR: f32 = 48_000.0;
const NOTEN: [u8; 4] = [36, 48, 60, 72];

fn graph(tabelle: usize) -> String {
    format!(
        r#"{{"format":"baukasten/2","name":"wt","stimmen":1,"knoten":[{{"id":"n","art":"note"}},{{"id":"w","art":"wavetable","tabelle":{tabelle},"kopien":1,"glatt":0,"zufall":0}},{{"id":"k","art":"regler","nr":1,"min":0,"max":1}},{{"id":"o","art":"ausgang"}}],"kanten":[{{"von":"n.hz","nach":"w.hz"}},{{"von":"n.trig","nach":"w.trig"}},{{"von":"k.aus","nach":"w.pos"}},{{"von":"w.l","nach":"o.l"}},{{"von":"w.r","nach":"o.r"}}]}}"#
    )
}

/// RMS in dB of 0.5 s at morph position `pos`, after 50 ms to settle
fn pegel_db(p: &mut Programm, pos: f32) -> f64 {
    p.setze_regler(1, pos);
    for _ in 0..(0.05 * SR) as usize { p.sample_stereo(); }
    let n = (0.5 * SR) as usize;
    let s: f64 = (0..n).map(|_| { let v = p.sample_stereo().0 as f64; v * v }).sum();
    10.0 * (s / n as f64).max(1e-30).log10()
}

/// positions: the grid 0.00, 0.02 .. 1.00 and the exact frame positions i / (frames - 1), sorted, without duplicates
fn positionen(frames: usize) -> Vec<f32> {
    let mut v: Vec<f32> = (0..=50).map(|i| i as f32 / 50.0).collect();
    for i in 0..frames { v.push(i as f32 / (frames - 1).max(1) as f32); }
    v.sort_by(|a, b| a.total_cmp(b));
    v.dedup_by(|a, b| (*a - *b).abs() < 1e-6);
    v
}

struct Zeile { tabelle: &'static str, note: u8, frames: usize, dip_db: Option<f64>, dip_gesamt_db: Option<f64>, segmente: Vec<f64> }

fn messe(nr: usize, note: u8) -> Zeile {
    let frames = Tabelle::neu(nr).frames;
    let mut p = uebersetze(&graph(nr), SR).unwrap_or_else(|e| panic!("{e}"));
    p.note_an(note, 1.0);
    let pos = positionen(frames);
    let db: Vec<f64> = pos.iter().map(|x| pegel_db(&mut p, *x)).collect();
    assert!(db.iter().all(|v| v.is_finite()), "{} note {note}: not finite", TABELLEN[nr]);
    assert_eq!(p.rettungen, 0);
    if frames < 2 {
        return Zeile { tabelle: TABELLEN[nr], note, frames, dip_db: None, dip_gesamt_db: None, segmente: vec![] };
    }
    let punkt = |f: usize| pos.iter().position(|x| (*x - f as f32 / (frames - 1) as f32).abs() < 1e-6).expect("frame position rendered");
    let frame_db: Vec<f64> = (0..frames).map(|f| db[punkt(f)]).collect();
    let mittel_alle = frame_db.iter().sum::<f64>() / frames as f64;
    let mut segmente = vec![];
    for s in 0..frames - 1 {
        let ref_db = 0.5 * (frame_db[s] + frame_db[s + 1]);
        let (a, b) = (punkt(s), punkt(s + 1));
        segmente.push((a..=b).map(|i| ref_db - db[i]).fold(f64::MIN, f64::max));
    }
    let dip = segmente.iter().cloned().fold(f64::MIN, f64::max);
    let gesamt = db.iter().map(|v| mittel_alle - v).fold(f64::MIN, f64::max);
    Zeile { tabelle: TABELLEN[nr], note, frames, dip_db: Some(dip), dip_gesamt_db: Some(gesamt), segmente }
}

/// `dip_db` of the first run (2026-11-15), table order of `TABELLEN`, notes 36 48 60 72; `None` = one frame, no morph.
/// A later run must stay within +-0.5 dB.
const GRENZEN: [[Option<f64>; 4]; 7] = [
    [None; 4],                                            // saege
    [Some(1.65), Some(1.69), Some(1.67), Some(1.70)],     // rechteck
    [None; 4],                                            // dreieck
    [None; 4],                                            // sinus
    [Some(2.39), Some(2.38), Some(2.39), Some(2.39)],     // analog
    [Some(1.32), Some(1.33), Some(1.35), Some(1.34)],     // vokale
    [Some(0.22), Some(0.23), Some(0.20), Some(0.21)],     // orgel
];
const TOLERANZ_DB: f64 = 0.5;

#[test]
fn morph_pegel_aller_tabellen() {
    let mut zeilen = vec![];
    for nr in 0..TABELLEN.len() {
        for note in NOTEN { zeilen.push(messe(nr, note)); }
    }
    for z in &zeilen {
        match z.dip_db {
            Some(d) => println!("MESS {} {} {d:.2}  (frames {}, overall dip {:.2} dB, per segment {:?})", z.tabelle, z.note, z.frames, z.dip_gesamt_db.unwrap(),
                                z.segmente.iter().map(|s| (s * 100.0).round() / 100.0).collect::<Vec<_>>()),
            None => println!("MESS {} {} no morph (1 frame)", z.tabelle, z.note),
        }
    }
    let json: Vec<serde_json::Value> = zeilen.iter().map(|z| serde_json::json!({
        "table": z.tabelle, "note": z.note, "frames": z.frames,
        "morph": z.dip_db.is_some(),
        "dip_db": z.dip_db, "dip_overall_db": z.dip_gesamt_db, "segment_dips_db": z.segmente,
    })).collect();
    let dir = std::path::Path::new(&std::env::var("HOME").unwrap()).join("messungen/2026-11-15-backlog/sound/task14");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("morph-pegel.json"), serde_json::to_string_pretty(&json).unwrap() + "\n").unwrap();
    assert_eq!(zeilen.len(), 7 * 4);
    for (t, zeile) in zeilen.chunks(4).enumerate() {
        for (n, z) in zeile.iter().enumerate() {
            assert_eq!(z.dip_db.is_some(), z.frames > 1, "{}: one frame means no morph", z.tabelle);
            if let (Some(d), Some(g)) = (z.dip_db, GRENZEN[t][n]) {
                assert!((d - g).abs() <= TOLERANZ_DB, "{} note {}: dip {d:.2} dB, bound {g:.2} +- {TOLERANZ_DB}", z.tabelle, z.note);
            }
        }
    }
}
