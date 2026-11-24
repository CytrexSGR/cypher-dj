//! `drum-synth` (demos/drum-synth.json): a kit of eight pads, each pad a Baukasten drum recipe, one graph. Pins: every pad is audible and
//! its own sound (the pads differ), the eight pads together stay below -3 dBFS at the default knobs, the note map (a note no pad owns plays
//! the pad below), a pad knob changes only its own pad, and the real-time path allocates nothing.
use baukasten_dsp::{uebersetze, Programm};
use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;

/// Counts the allocation requests of the calling thread (the tests of this file run in parallel).
struct Zaehler;
thread_local! { static ANFORDERUNGEN: Cell<usize> = const { Cell::new(0) }; }
fn anforderungen() -> usize { ANFORDERUNGEN.with(|c| c.get()) }
unsafe impl GlobalAlloc for Zaehler {
    unsafe fn alloc(&self, l: Layout) -> *mut u8 {
        ANFORDERUNGEN.with(|c| c.set(c.get() + 1));
        System.alloc(l)
    }
    unsafe fn dealloc(&self, p: *mut u8, l: Layout) { System.dealloc(p, l) }
    unsafe fn realloc(&self, p: *mut u8, l: Layout, n: usize) -> *mut u8 {
        ANFORDERUNGEN.with(|c| c.set(c.get() + 1));
        System.realloc(p, l, n)
    }
}
#[global_allocator]
static A: Zaehler = Zaehler;

const SR: f32 = 48_000.0;
const GRAPH: &str = include_str!("../demos/drum-synth.json");
/// (name, note) of the pads in kit order
const PADS: [(&str, u8); 8] = [("kick", 36), ("rim", 37), ("snare", 38), ("clap", 39), ("low tom", 41), ("closed hat", 42), ("open hat", 46), ("cymbal", 49)];

fn lade() -> Programm { uebersetze(GRAPH, SR).unwrap_or_else(|e| panic!("{e}")) }

fn spiele(p: &mut Programm, noten: &[u8], sek: f32) -> Vec<f32> {
    for n in noten { p.note_an(*n, 0.8); }
    let y: Vec<f32> = (0..(sek * SR) as usize).map(|_| p.sample_stereo().0).collect();
    assert!(y.iter().all(|v| v.is_finite()) && p.rettungen == 0, "not finite or rescued");
    y
}
fn spitze(y: &[f32]) -> f32 { y.iter().fold(0.0, |m, v| m.max(v.abs())) }
fn db(x: f32) -> f32 { 20.0 * x.max(1e-9).log10() }

#[test]
fn jeder_platz_ist_hoerbar_und_eigen() {
    let mut aus = vec![];
    for (name, note) in PADS {
        let y = spiele(&mut lade(), &[note], 2.0);
        let s = spitze(&y);
        eprintln!("{name:11} note {note}: peak {:.1} dBFS", db(s));
        assert!(db(s) > -30.0, "{name} too quiet: {:.1} dBFS", db(s));
        assert!(db(s) < -6.0, "{name} too loud: {:.1} dBFS", db(s));
        aus.push(y);
    }
    for a in 0..8 {
        for b in a + 1..8 {
            let d: f32 = aus[a].iter().zip(&aus[b]).take(4800).map(|(x, y)| (x - y).abs()).sum();
            assert!(d > 1.0, "{} and {} sound the same", PADS[a].0, PADS[b].0);
        }
    }
}

#[test]
fn alle_plaetze_zusammen_unter_minus_3_dbfs() {
    let noten: Vec<u8> = PADS.iter().map(|p| p.1).collect();
    let y = spiele(&mut lade(), &noten, 2.0);
    let s = spitze(&y);
    eprintln!("all eight together: peak {:.1} dBFS", db(s));
    assert!(db(s) < -3.0, "{:.1} dBFS", db(s));
    assert!(db(s) > -20.0, "{:.1} dBFS", db(s));
}

#[test]
fn fremde_note_spielt_den_platz_darunter() {
    // 40 is no pad: it plays the clap (39); 60 plays the cymbal (49)
    let a = spiele(&mut lade(), &[39], 0.5);
    let b = spiele(&mut lade(), &[40], 0.5);
    assert_eq!(a, b);
    let c = spiele(&mut lade(), &[49], 0.5);
    let d = spiele(&mut lade(), &[60], 0.5);
    assert_eq!(c, d);
}

#[test]
fn ein_platz_knopf_aendert_nur_seinen_platz() {
    // the Level knob of the kick (first pad: its knobs come first, the Level is the last of them) at 0 silences the kick, the snare stays bit-equal
    let g: serde_json::Value = serde_json::from_str(GRAPH).unwrap();
    let nr = g["knoten"].as_array().unwrap().iter().find(|k| k["id"] == "kick_k_level").unwrap()["nr"].as_u64().unwrap() as usize;
    let mut p = lade();
    p.setze_regler(nr, 0.0);
    let kick = spiele(&mut p, &[36], 0.5);
    assert!(spitze(&kick) < 1e-6, "kick level 0 still sounds: {}", spitze(&kick));
    let mut p = lade();
    p.setze_regler(nr, 0.0);
    let sn = spiele(&mut p, &[38], 0.5);
    let ref_sn = spiele(&mut lade(), &[38], 0.5);
    assert_eq!(sn, ref_sn);
}

#[test]
fn jeder_knopf_aendert_seinen_platz() {
    // every knob, swept from 0 to 1 on the note of its own pad, changes the sound (the pad of a knob is the prefix of its regler node)
    let g: serde_json::Value = serde_json::from_str(GRAPH).unwrap();
    let pad_note = |id: &str| -> u8 {
        let pid = id.split('_').next().unwrap();
        match pid { "kick" => 36, "rim" => 37, "snare" => 38, "clap" => 39, "tom" => 41, "chat" => 42, "ohat" => 46, "cym" => 49, _ => 36 }
    };
    let mut tot = vec![];
    for k in g["knoten"].as_array().unwrap().iter().filter(|k| k["art"] == "regler") {
        let (nr, id) = (k["nr"].as_u64().unwrap() as usize, k["id"].as_str().unwrap());
        if id == "k_master" { continue; }
        let hoere = |v: f32| { let mut p = lade(); p.setze_regler(nr, v); spiele(&mut p, &[pad_note(id)], 1.0) };
        let (a, b) = (hoere(0.0), hoere(1.0));
        if a == b { tot.push(id.to_string()); }
    }
    assert!(tot.is_empty(), "dead knobs: {tot:?}");
}

#[test]
fn echtzeitpfad_ohne_allokation() {
    let mut p = lade();
    let noten: Vec<u8> = PADS.iter().map(|p| p.1).collect();
    for n in &noten { p.note_an(*n, 0.8); }
    let vor = anforderungen();
    for _ in 0..48_000 { p.sample_stereo(); }
    for n in &noten { p.note_an(*n, 0.8); }
    for _ in 0..48_000 { p.sample_stereo(); }
    assert_eq!(anforderungen(), vor, "allocation in the audio path");
}

/// Cost: nanoseconds per sample with nothing sounding, with one pad and with all eight, with and without the skipping of the unplayed pads.
#[test]
fn kosten_je_stimme() {
    let mess_graph = |graph: &str, noten: &[u8], zweige: bool| {
        let mut p = uebersetze(graph, SR).unwrap();
        p.setze_zweige(zweige);
        for _ in 0..4800 { p.sample_stereo(); }
        let t = std::time::Instant::now();
        let mut n = 0usize;
        for _ in 0..20 {
            for no in noten { p.note_an(*no, 0.8); }
            for _ in 0..24_000 { p.sample_stereo(); n += 1; }
        }
        t.elapsed().as_nanos() as f64 / n as f64
    };
    let mess = |noten: &[u8], zweige: bool| mess_graph(GRAPH, noten, zweige);
    let alle_noten: Vec<u8> = PADS.iter().map(|p| p.1).collect();
    // The best of three runs: a busy machine only ever adds time, so the minimum is the cost of the code (the test profile is optimized, see Cargo.toml)
    let beste = |noten: &[u8]| (0..3).map(|_| mess(noten, true)).fold(f64::MAX, f64::min);
    let (leer, eins, alle) = (beste(&[]), mess(&[36], true), beste(&alle_noten));
    let ohne = mess(&alle_noten, false);
    let p909 = mess_graph(include_str!("../demos/drums-909.json"), &alle_noten, true);
    eprintln!("for comparison drums-909 with the same eight notes: {p909:.0} ns per sample");
    let budget = 1e9 / SR as f64;
    eprintln!("branches: {:?}", lade().zweige_info());
    eprintln!("cost per sample: idle {leer:.0} ns, one pad {eins:.0} ns, eight pads {alle:.0} ns, eight pads without skipping {ohne:.0} ns (budget {budget:.0} ns at 48 kHz)");
    eprintln!("per sounding voice: {:.0} ns = {:.2} % of the callback", (alle - leer) / 8.0, (alle - leer) / 8.0 / budget * 100.0);
    assert!(alle < budget * 0.6, "eight pads cost more than 60 % of the callback: {alle:.0} ns");
}
