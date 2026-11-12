//! Cost of one arbitrary graph, taken from the environment (plan synth-ausbau, Task 1). Driven by `measure_cost.py`, which
//! waits for a quiet machine and takes the real-time lock; the measuring test is ignored and prints one JSON line:
//!   BK_KOSTEN_GRAPH=<path> [BK_KOSTEN_STIMMEN=<n>] [BK_KOSTEN_BLOCK=256] \
//!     cargo test --release -p baukasten_dsp --test kosten_graph -- --ignored --nocapture kosten_graph
//! The graph is read from disk at run time, so the binary is built once and runs any graph.
use baukasten_dsp::uebersetze_mit_wurzel;
use std::time::Instant;

/// Reads the graph at `pfad`; `stimmen` replaces the `"stimmen"` field. Returns the JSON text and the voice count it carries.
fn lade_graph(pfad: &str, stimmen: Option<&str>) -> (String, usize) {
    let text = std::fs::read_to_string(pfad).unwrap_or_else(|e| panic!("graph file not readable: {pfad}: {e}"));
    let mut wert: serde_json::Value = serde_json::from_str(&text).unwrap_or_else(|e| panic!("graph is not JSON: {pfad}: {e}"));
    if let Some(s) = stimmen {
        let n: u64 = s.parse().unwrap_or_else(|_| panic!("BK_KOSTEN_STIMMEN is not a number: {s}"));
        wert["stimmen"] = serde_json::json!(n);
    }
    let n = wert["stimmen"].as_u64().unwrap_or_else(|| panic!("graph has no \"stimmen\" field: {pfad}")) as usize;
    (serde_json::to_string(&wert).unwrap(), n)
}

fn aus_umgebung() -> (String, usize) {
    let pfad = std::env::var("BK_KOSTEN_GRAPH").expect("BK_KOSTEN_GRAPH is not set (path of the graph JSON)");
    lade_graph(&pfad, std::env::var("BK_KOSTEN_STIMMEN").ok().as_deref())
}

#[test]
fn harness_liest_graph_aus_umgebung() {
    // one test body: the environment is process-wide, so the cases run one after the other
    let poly = concat!(env!("CARGO_MANIFEST_DIR"), "/demos/synth-poly.json");
    std::env::set_var("BK_KOSTEN_GRAPH", poly);
    std::env::remove_var("BK_KOSTEN_STIMMEN");
    let (json, n) = aus_umgebung();
    assert_eq!(n, 8, "synth-poly ships with 8 voices");
    assert_eq!(uebersetze_mit_wurzel(&json, 48_000.0, None).unwrap().stimmen, 8);
    std::env::set_var("BK_KOSTEN_STIMMEN", "16");
    let (json, n) = aus_umgebung();
    assert_eq!(n, 16, "BK_KOSTEN_STIMMEN replaces the field");
    assert_eq!(uebersetze_mit_wurzel(&json, 48_000.0, None).unwrap().stimmen, 16);
    std::env::remove_var("BK_KOSTEN_STIMMEN");
}

#[test]
#[should_panic(expected = "/gibt/es/nicht.json")]
fn harness_meldet_fehlenden_pfad() {
    lade_graph("/gibt/es/nicht.json", None);
}

/// All voices sounding, 200 warm-up blocks, 4000 measured blocks, as `miss_n` in `kosten_messung.rs`.
#[test]
#[ignore]
fn kosten_graph() {
    let (json, _) = aus_umgebung();
    let block: usize = std::env::var("BK_KOSTEN_BLOCK").ok().map(|s| s.parse().expect("BK_KOSTEN_BLOCK")).unwrap_or(256);
    let mut p = uebersetze_mit_wurzel(&json, 48_000.0, None).unwrap();
    // BK_KOSTEN_ZWEIGE=0 runs every unselected `wahl` branch, as the engine did before branches existed
    if std::env::var("BK_KOSTEN_ZWEIGE").as_deref() == Ok("0") { p.setze_zweige(false); }
    for n in 0..p.stimmen { p.note_an(40 + n as u8, 0.8); }
    // exact quantiles from the sorted block times: the `Kosten` histogram stops at 1280 us and poly at 8 voices is above that
    let mut zeiten: Vec<f64> = Vec::with_capacity(4000);
    let mut senke = 0.0f32;
    let mut zaehler = 0usize;
    // effect graphs get a sine as input, else the run measures silence
    let mut sample = |p: &mut baukasten_dsp::Programm| {
        if p.hat_eingang() {
            let x = ((zaehler as f32) * 0.05).sin() * 0.5;
            p.setze_eingang(x, x);
            zaehler += 1;
        }
        p.sample()
    };
    for _ in 0..200 { for _ in 0..block { senke += sample(&mut p); } }
    for _ in 0..4000 {
        let t = Instant::now();
        for _ in 0..block { senke += sample(&mut p); }
        zeiten.push(t.elapsed().as_secs_f64() * 1e6);
    }
    zeiten.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let q = |q: f64| zeiten[(((q * zeiten.len() as f64).ceil() as usize).max(1) - 1).min(zeiten.len() - 1)];
    println!(
        "{{\"graph\":\"{}\",\"stimmen\":{},\"block\":{},\"p50_us\":{:.1},\"p99_us\":{:.1},\"p999_us\":{:.1},\"max_us\":{:.1},\"senke\":{},\"uebersprungen\":{}}}",
        p.name, p.stimmen, block, q(0.5), q(0.99), q(0.999), zeiten[zeiten.len() - 1], senke.is_finite(), p.uebersprungen()
    );
}
