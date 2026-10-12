//! Die .vstpreset-Dateien aus presets/erzeuge.py: Kopf, Klassen-ID, Chunk-Liste, und der Zustand lässt sich als
//! nih-plug-PluginState lesen; jeder Parameter existiert im Plugin und liegt in seinem Bereich.
use cypher_komp::KompParams;
use nih_plug::prelude::*;
use nih_plug::wrapper::state::{ParamValue, PluginState};
use std::process::Command;

#[test]
fn presets_passen_zum_plugin() {
    let ziel = std::env::temp_dir().join(format!("komp-presets-{}", std::process::id()));
    let st = Command::new("python3").arg("presets/erzeuge.py").arg(&ziel).status().unwrap();
    assert!(st.success());
    let params = KompParams::default();
    let karte: std::collections::HashMap<String, ParamPtr> =
        params.param_map().into_iter().map(|(id, p, _)| (id, p)).collect();
    let mut n = 0;
    for e in std::fs::read_dir(&ziel).unwrap() {
        let d = std::fs::read(e.unwrap().path()).unwrap();
        assert_eq!(&d[0..4], b"VST3");
        assert_eq!(i32::from_le_bytes(d[4..8].try_into().unwrap()), 1);
        assert_eq!(&d[8..40], hex16(b"CypherKompFFLog1").as_bytes());
        let liste = i64::from_le_bytes(d[40..48].try_into().unwrap()) as usize;
        assert_eq!(&d[liste..liste + 4], b"List");
        assert_eq!(&d[liste + 8..liste + 12], b"Comp");
        let ab = i64::from_le_bytes(d[liste + 12..liste + 20].try_into().unwrap()) as usize;
        let len = i64::from_le_bytes(d[liste + 20..liste + 28].try_into().unwrap()) as usize;
        let zustand: PluginState = serde_json::from_slice(&d[ab..ab + len]).unwrap();
        assert_eq!(zustand.params.len(), karte.len(), "alle Parameter des Plugins gesetzt");
        for (id, w) in &zustand.params {
            let p = karte.get(id).unwrap_or_else(|| panic!("unbekannter Parameter {id}"));
            let v = match w {
                ParamValue::F32(v) => *v,
                ParamValue::Bool(b) => if *b { 1.0 } else { 0.0 },
                _ => panic!("{id}: unerwarteter Typ"),
            };
            let v = &v;
            // normalisieren und zurück: liegt der Wert im Bereich, bleibt er gleich
            let zurueck = unsafe { p.preview_plain(p.preview_normalized(*v)) };
            assert!((zurueck - v).abs() < 1e-3 * v.abs().max(1.0), "{id} = {v} außerhalb des Bereichs ({zurueck})");
        }
        n += 1;
    }
    assert_eq!(n, 6);
    std::fs::remove_dir_all(&ziel).ok();
}

fn hex16(b: &[u8; 16]) -> String {
    b.iter().map(|x| format!("{x:02X}")).collect()
}
