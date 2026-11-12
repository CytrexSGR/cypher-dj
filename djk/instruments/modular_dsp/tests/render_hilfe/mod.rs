//! Shared by `render_hash.rs` and `zweige.rs`: every example graph, a sample root for the graphs that name files, and the fixed
//! play script that both tests render.
#![allow(dead_code)]
use baukasten_dsp::{uebersetze_mit_wurzel, Programm, REGLER};
use std::path::{Path, PathBuf};

pub const SR: f32 = 48_000.0;

/// every graph file: `beispiele/*.json` and `demos/recipes/*.json` (without the manifest), sorted by relative path
pub fn graphen() -> Vec<(String, String)> {
    let basis = Path::new(env!("CARGO_MANIFEST_DIR")).join("demos");
    let mut v = Vec::new();
    for dir in [basis.clone(), basis.join("recipes")] {
        let mut dateien: Vec<PathBuf> = std::fs::read_dir(&dir).unwrap().map(|e| e.unwrap().path())
            .filter(|p| p.extension().map_or(false, |e| e == "json") && p.file_name().unwrap() != "MANIFEST.json").collect();
        dateien.sort();
        for p in dateien {
            let rel = p.strip_prefix(&basis).unwrap().to_string_lossy().to_string();
            v.push((rel, std::fs::read_to_string(&p).unwrap()));
        }
    }
    v
}

/// sample root with the files the example graphs name (generated, deterministic)
pub fn wurzel() -> PathBuf {
    static W: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();
    W.get_or_init(|| {
        let w = std::env::temp_dir().join(format!("bk-render-hash-{}", std::process::id()));
        std::fs::create_dir_all(&w).unwrap();
        let bytes = |d: &[f32]| d.iter().flat_map(|v| v.to_le_bytes()).collect::<Vec<u8>>();
        std::fs::write(w.join("feder-ir.f32"), bytes(&baukasten_dsp::proben::feder_ir(48_000.0))).unwrap();
        let sch: Vec<f32> = (0..96_000usize).flat_map(|i| { let v = 0.3 * (i as f32 * 0.05).sin() * (-(i as f32) / 20_000.0).exp(); [v, v] }).collect();
        std::fs::write(w.join("orchester-schlag-schichten.f32"), bytes(&sch)).unwrap();
        w
    }).clone()
}

pub fn lade(json: &str) -> Result<Programm, String> {
    uebersetze_mit_wurzel(json, SR, Some(&wurzel())).map_err(|e| format!("{e}"))
}

fn fnv(h: &mut u64, x: f32) {
    for b in x.to_bits().to_le_bytes() {
        *h ^= b as u64;
        *h = h.wrapping_mul(0x100_0000_01b3);
    }
}

/// `None` = the graph's own start position of every knob
pub const EINSTELLUNGEN: [Option<f32>; 6] = [None, Some(0.0), Some(0.2), Some(0.5), Some(0.8), Some(1.0)];

/// The fixed script: a chord, two note-offs, a new note, all-off; an effect graph gets a sine as input. The knobs are set
/// once before the first sample (`knopf`) and never moved, so no `wahl` changes its position. Returns the interleaved stereo output.
pub fn spiele(p: &mut Programm, knopf: Option<f32>) -> Vec<f32> {
    p.setze_takt(0.0, 2.0 / SR as f64);
    if let Some(k) = knopf {
        for nr in 1..=REGLER { p.setze_regler(nr, k); }
    }
    let mut aus = Vec::with_capacity(2 * 26_000);
    let mut zaehler = 0usize;
    let mut block = |p: &mut Programm, n: usize, aus: &mut Vec<f32>| {
        for _ in 0..n {
            if p.hat_eingang() {
                let x = ((zaehler as f32) * 0.05).sin() * 0.5;
                p.setze_eingang(x, x);
                zaehler += 1;
            }
            let (l, r) = p.sample_stereo();
            aus.push(l);
            aus.push(r);
        }
    };
    for n in [45u8, 52, 57, 61] { p.note_an(n, 0.8); }
    block(p, 8_000, &mut aus);
    p.note_aus(52);
    p.note_aus(61);
    block(p, 6_000, &mut aus);
    p.note_an(66, 1.0);
    block(p, 8_000, &mut aus);
    p.alle_aus();
    block(p, 4_000, &mut aus);
    aus
}

pub fn fingerabdruck(x: &[f32]) -> u64 {
    let mut h = 0xcbf2_9ce4_8422_2325u64;
    x.iter().for_each(|v| fnv(&mut h, *v));
    h
}
