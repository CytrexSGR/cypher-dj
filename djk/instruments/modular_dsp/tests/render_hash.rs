//! Render fingerprints of every graph in `beispiele/` and `demos/recipes/`, for proving that an engine change keeps the
//! output bit-identical.
//!
//! Every graph is played with the fixed script of `render_hilfe` (a chord, two note-offs, a new note, all-off, an effect input
//! sine for effect graphs) under several CONSTANT knob settings (the graph's own start position, every knob at 0, 0.2, 0.5,
//! 0.8, 1). The knobs never move after the first sample, so no `wahl` ever changes its position at run time: this is the
//! steady state. The ignored test prints one line per (graph, setting):
//!
//!   HASH <graph file> <setting> <fnv64 of all output samples (l and r as f32 bits)> rescues=<n>
//!
//! Run it on two commits and diff the lines to compare engines:
//!   cargo test --release -p baukasten_dsp --test render_hash -- --ignored --nocapture render_hash | grep '^HASH'
//! The non-ignored test only checks that the graphs load and that the fingerprint is stable between two runs.
mod render_hilfe;
use render_hilfe::*;

#[test]
fn graphen_laden_und_abdruck_ist_stabil() {
    let alle = graphen();
    assert!(alle.len() >= 100, "found {} graphs", alle.len());
    let (mut geladen, mut nicht) = (0, Vec::new());
    for (name, json) in &alle {
        match lade(json) {
            Ok(mut p) => {
                geladen += 1;
                // only the first setting here: the full sweep is the ignored test
                let a = fingerabdruck(&spiele(&mut p, None));
                let mut q = lade(json).unwrap();
                assert_eq!(a, fingerabdruck(&spiele(&mut q, None)), "{name}: render is not deterministic");
            }
            Err(e) => nicht.push(format!("{name}: {e}")),
        }
    }
    assert!(nicht.is_empty(), "graphs that do not load: {nicht:?}");
    assert_eq!(geladen, alle.len());
}

#[test]
#[ignore]
fn render_hash() {
    for (name, json) in graphen() {
        for e in EINSTELLUNGEN {
            let mut p = lade(&json).unwrap_or_else(|f| panic!("{name}: {f}"));
            let x = spiele(&mut p, e);
            let nf = x.iter().filter(|v| !v.is_finite()).count();
            println!("HASH {name} {} {:016x} rescues={} nonfinite={nf}", e.map_or("start".to_string(), |k| format!("{k}")), fingerabdruck(&x), p.rettungen);
        }
    }
}
