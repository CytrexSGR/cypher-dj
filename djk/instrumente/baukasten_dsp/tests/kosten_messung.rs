//! Kostenmessung je Graph (Spec E20), nur auf Zuruf und unter dem Echtzeit-Schloss (Absprache mit der Warp-Welle):
//!   . djk/konfig/echtzeit_schloss.sh && flock "$CYPHERDJ_ECHTZEIT_SCHLOSS" \
//!     cargo test --release -p baukasten_dsp --test kosten_messung -- --ignored --nocapture
//! Druckt je Beispielgraph eine JSON-Zeile: Blöcke à 256 Samples, alle Stimmen klingen, p50/p99/p99,9 in µs und Anteil
//! an 5,33 ms.
use baukasten_dsp::{uebersetze, Kosten};
use std::time::Instant;

#[test]
#[ignore]
fn kosten_beispielgraph_alle_stimmen() {
    for g in [include_str!("../beispiele/saege-ladder.json"), include_str!("../beispiele/juno-pad.json"), include_str!("../beispiele/juno-pad-hall.json"), include_str!("../beispiele/juno-pad-echo.json"), include_str!("../beispiele/juno-pad-dyn.json"), include_str!("../beispiele/lead.json"), include_str!("../beispiele/saite.json"), include_str!("../beispiele/fx-echo-achtel.json"), include_str!("../beispiele/fx-filter-wobble.json"), include_str!("../beispiele/bassmusik.json")] {
        miss(g, 256);
    }
}

/// Kleine Blöcke (Slice 4a): der Hall rechnet je Sample, kleinere Blöcke verteilen die Arbeit auf mehr Perioden
#[test]
#[ignore]
fn kosten_kleine_bloecke() {
    for g in [include_str!("../beispiele/juno-pad.json"), include_str!("../beispiele/juno-pad-hall.json"), include_str!("../beispiele/juno-pad-echo.json"), include_str!("../beispiele/juno-pad-dyn.json")] {
        for block in [64, 128, 256] {
            miss(g, block);
        }
    }
}

fn miss(g: &str, block: usize) {
    let mut p = uebersetze(g, 48_000.0).unwrap();
    for n in 0..p.stimmen { p.note_an(40 + n as u8, 0.8); }
    let mut k = Kosten::default();
    let mut senke = 0.0f32;
    let mut zaehler = 0usize;
    // Effekt-Graphen (S3c) bekommen einen Sinus als Eingang, sonst misst der Lauf Stille
    let mut sample = |p: &mut baukasten_dsp::Programm| {
        if p.hat_eingang() {
            let x = ((zaehler as f32) * 0.05).sin() * 0.5;
            p.setze_eingang(x, x);
            zaehler += 1;
        }
        p.sample()
    };
    for _ in 0..200 { for _ in 0..block { senke += sample(&mut p); } } // aufwärmen
    for _ in 0..4000 {
        let t = Instant::now();
        for _ in 0..block { senke += sample(&mut p); }
        k.buche(t.elapsed().as_secs_f64() * 1e6);
    }
    let periode_us = block as f64 / 48_000.0 * 1e6;
    println!(
        "{{\"graph\":\"{}\",\"stimmen\":{},\"block\":{},\"bloecke\":{},\"p50_us\":{},\"p99_us\":{},\"p999_us\":{},\"max_us\":{:.1},\"anteil_p999\":{:.4},\"senke\":{}}}",
        p.name, p.stimmen, block, k.bloecke, k.quantil_us(0.5), k.quantil_us(0.99), k.quantil_us(0.999), k.max_us,
        k.quantil_us(0.999) / periode_us, senke.is_finite()
    );
}
