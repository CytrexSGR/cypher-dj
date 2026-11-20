//! Table cache of the wavetable node: a translation with unchanged tables computes nothing, and the sound stays the same.
//! `messe_tabellen` (ignored) prints the numbers (lines start with `MESS`):
//! `cargo test --release --test wavetable_cache messe_tabellen -- --ignored --nocapture`.
use baukasten_dsp::uebersetze;
use baukasten_dsp::wavetable::{Tabelle, TABELLEN_GEBAUT};
use std::sync::atomic::Ordering;
use std::time::Instant;

const SR: f32 = 48_000.0;

fn spektren(frames: usize, saat: usize) -> String {
    let f: Vec<Vec<f32>> = (0..frames)
        .map(|i| (1..=256).map(|h| (((i + saat) as f32) * 0.37 * h as f32).sin() / h as f32).collect())
        .collect();
    serde_json::to_string(&f).unwrap()
}

/// `n` wavetable nodes with their own `frames` frame table each (table of node j: seed `saat0 + j`), played from one note.
fn graph(n: usize, frames: usize, saat0: usize) -> String {
    let mut k = vec![r#"{"id":"note","art":"note"}"#.to_string(), r#"{"id":"aus","art":"ausgang"}"#.to_string()];
    let mut e = vec![];
    for i in 0..n {
        k.push(format!(r#"{{"id":"w{i}","art":"wavetable","kopien":3,"saat":{i},"spektren":{}}}"#, spektren(frames, saat0 + i)));
        e.push(format!(r#"{{"von":"note.hz","nach":"w{i}.hz"}}"#));
        e.push(format!(r#"{{"von":"note.trig","nach":"w{i}.trig"}}"#));
    }
    e.push(r#"{"von":"w0.l","nach":"aus.l"}"#.into());
    e.push(r#"{"von":"w0.r","nach":"aus.r"}"#.into());
    format!(r#"{{"format":"baukasten/2","name":"wt-cache","stimmen":8,"knoten":[{}],"kanten":[{}]}}"#, k.join(","), e.join(","))
}

#[test]
fn neubau_mit_gleichen_tabellen_rechnet_nichts() {
    let g = graph(4, 256, 1000);
    let vor = TABELLEN_GEBAUT.load(Ordering::Relaxed);
    let mut p = uebersetze(&g, SR).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(TABELLEN_GEBAUT.load(Ordering::Relaxed) - vor, 4);
    p.note_an(60, 0.8);
    let a: Vec<_> = (0..4800).map(|_| p.sample_stereo()).collect();
    // playback build again, tables unchanged: nothing is computed, and the sound is the same
    let mut q = uebersetze(&g, SR).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(TABELLEN_GEBAUT.load(Ordering::Relaxed) - vor, 4, "rebuild recomputed a table");
    q.note_an(60, 0.8);
    let b: Vec<_> = (0..4800).map(|_| q.sample_stereo()).collect();
    assert!(a.iter().zip(&b).all(|(x, y)| x.0.to_bits() == y.0.to_bits() && x.1.to_bits() == y.1.to_bits()));
    assert!(a.iter().any(|x| x.0 != 0.0), "silent");
    // seeds 1001..1004: three of the four tables are the old nodes 1..3, one is new
    let _ = uebersetze(&graph(4, 256, 1001), SR).unwrap();
    assert_eq!(TABELLEN_GEBAUT.load(Ordering::Relaxed) - vor, 5);
}

fn rss_kb() -> usize {
    std::fs::read_to_string("/proc/self/status").unwrap().lines()
        .find(|l| l.starts_with("VmRSS:")).and_then(|l| l.split_whitespace().nth(1)?.parse().ok()).unwrap()
}

#[test]
#[ignore]
fn messe_tabellen() {
    let sp: Vec<Vec<f32>> = serde_json::from_str(&spektren(256, 77)).unwrap();
    let t0 = Instant::now();
    let alt = Tabelle::aus_spektren_ohne_teilen(&sp);
    let t_alt = t0.elapsed();
    let t0 = Instant::now();
    let neu = Tabelle::aus_spektren(&sp);
    let t_neu = t0.elapsed();
    println!("MESS 256 frames, one table: before (every level stored) {:.1} MB, build {:.0} ms; now {:.1} MB, build {:.0} ms",
        alt.bytes() as f64 / 1e6, t_alt.as_secs_f64() * 1e3, neu.bytes() as f64 / 1e6, t_neu.as_secs_f64() * 1e3);
    drop((alt, neu));
    let g = graph(4, 256, 5000);
    let r0 = rss_kb();
    let t0 = Instant::now();
    let p = uebersetze(&g, SR).unwrap();
    let t1 = t0.elapsed();
    let r1 = rss_kb();
    let t0 = Instant::now();
    let q = uebersetze(&g, SR).unwrap();
    let t2 = t0.elapsed();
    let r2 = rss_kb();
    println!("MESS translate, 4 nodes x 256 frames: first {:.0} ms (+{:.1} MB RSS), second {:.0} ms (+{:.1} MB RSS)",
        t1.as_secs_f64() * 1e3, (r1 as f64 - r0 as f64) / 1e3, t2.as_secs_f64() * 1e3, (r2 as f64 - r1 as f64) / 1e3);
    drop((p, q));
    let mut p = uebersetze(&graph(4, 256, 5000), SR).unwrap();
    for n in [48, 52, 55, 59] { p.note_an(n, 0.8); }
    let n = (10.0 * SR) as usize;
    let t0 = Instant::now();
    let mut s = 0.0f32;
    for _ in 0..n { s += p.sample_stereo().0; }
    println!("MESS callback: {:.0} ns per sample (sum {s:.3})", t0.elapsed().as_secs_f64() * 1e9 / n as f64);
}
