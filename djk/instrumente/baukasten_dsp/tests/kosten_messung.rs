//! Kostenmessung je Graph (Spec E20), nur auf Zuruf und unter dem Echtzeit-Schloss (Absprache mit der Warp-Welle):
//!   . djk/konfig/echtzeit_schloss.sh && flock "$CYPHERDJ_ECHTZEIT_SCHLOSS" \
//!     cargo test --release -p baukasten_dsp --test kosten_messung -- --ignored --nocapture
//! Druckt je Beispielgraph eine JSON-Zeile: Blöcke à 256 Samples, alle Stimmen klingen, p50/p99/p99,9 in µs und Anteil
//! an 5,33 ms.
use baukasten_dsp::{uebersetze_mit_wurzel, Kosten};
use std::time::Instant;

#[test]
#[ignore]
fn kosten_beispielgraph_alle_stimmen() {
    for g in [include_str!("../beispiele/saege-ladder.json"), include_str!("../beispiele/juno-pad.json"), include_str!("../beispiele/juno-pad-hall.json"), include_str!("../beispiele/juno-pad-echo.json"), include_str!("../beispiele/juno-pad-dyn.json"), include_str!("../beispiele/lead.json"), include_str!("../beispiele/saite.json"), include_str!("../beispiele/fx-echo-achtel.json"), include_str!("../beispiele/fx-filter-wobble.json"), include_str!("../beispiele/fx-filter-regler.json"), include_str!("../beispiele/bassmusik.json"), include_str!("../beispiele/fx-phaser.json"), include_str!("../beispiele/fx-flanger.json"), include_str!("../beispiele/fx-lofi-sp1200.json"), include_str!("../beispiele/roehre-lead.json"), include_str!("../beispiele/fx-roehre.json"), include_str!("../beispiele/fx-vocoder-robot.json")] {
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

fn miss(g: &str, block: usize) { miss_w(g, block, None) }

/// Convolution cost (S21): the spring example, a worst case with the longest allowed IR (2.0 s = 374 tail partitions,
/// `laenge_max` 2000) and the filter ride, at blocks of 64, 128 and 256. Since the feder-ir slice the tail partitions are
/// spread over the block (a slice per sample), so max and p99.9 sit close to p50; before it, the whole tail was computed
/// in the one sample that completed a block (S21 D7) and max was 7 to 8 times p50 at block 64. Not gated.
#[test]
#[ignore]
fn kosten_faltung() {
    let w = std::env::temp_dir().join(format!("bk-s21-kosten-{}", std::process::id()));
    std::fs::create_dir_all(&w).unwrap();
    let ir = baukasten_dsp::proben::feder_ir(48_000.0);
    std::fs::write(w.join("feder-ir.f32"), baukasten_dsp::proben::bytes(&ir)).unwrap();
    let mut lang = ir.clone();
    lang.resize(2 * 96_000, 0.0);
    std::fs::write(w.join("feder-ir-2s.f32"), baukasten_dsp::proben::bytes(&lang)).unwrap();
    let feder = include_str!("../beispiele/fx-federhall.json");
    let feder_2s = feder.replace(r#""datei": "feder-ir.f32", "laenge_max": 1500"#, r#""datei": "feder-ir-2s.f32", "laenge_max": 2000"#)
        .replace(r#""name": "fx-federhall""#, r#""name": "fx-federhall-2s""#);
    assert_ne!(feder, feder_2s, "the 2 s variant must differ from the example");
    for g in [feder, feder_2s.as_str(), include_str!("../beispiele/fx-filter-fahrt.json")] {
        for block in [64, 128, 256] {
            miss_w(g, block, Some(&w));
        }
    }
}

/// Sampler cost (S22): `sampler-fairlight` went from one to three sampler reads per voice (the detune layers). The graph of
/// S10 to S13 (one sampler) against the new one, four voices, blocks of 64, 128 and 256. Not gated.
#[test]
#[ignore]
fn kosten_sampler_fairlight() {
    let w = std::env::temp_dir().join(format!("bk-s22-kosten-{}", std::process::id()));
    std::fs::create_dir_all(&w).unwrap();
    let schlag = baukasten_dsp::proben::orchester_schlag(48_000.0);
    std::fs::write(w.join("orchester-schlag.f32"), baukasten_dsp::proben::bytes(&schlag)).unwrap();
    let schichten = baukasten_dsp::proben::orchester_schlag_schichten(48_000.0);
    std::fs::write(w.join("orchester-schlag-schichten.f32"), baukasten_dsp::proben::bytes(&schichten)).unwrap();
    let alt = include_str!("gemeinsam/sampler-fairlight-s10.json").replace(r#""name":"sampler-fairlight""#, r#""name":"sampler-fairlight-s10""#);
    for g in [alt.as_str(), include_str!("../beispiele/sampler-fairlight.json")] {
        for block in [64, 128, 256] {
            miss_n(g, block, Some(&w), 14_400);
        }
    }
}

fn miss_w(g: &str, block: usize, wurzel: Option<&std::path::Path>) { miss_n(g, block, wurzel, 0) }

/// Like `miss_w`; `neu` > 0 plays the notes again every `neu` samples (a one-shot sample would otherwise end and the run
/// would measure silence).
fn miss_n(g: &str, block: usize, wurzel: Option<&std::path::Path>, neu: usize) {
    let mut p = uebersetze_mit_wurzel(g, 48_000.0, wurzel).unwrap();
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
    let mut vergangen = 0usize;
    let mut wieder = |p: &mut baukasten_dsp::Programm, n: usize| {
        vergangen += n;
        if neu > 0 && vergangen >= neu {
            vergangen = 0;
            for v in 0..p.stimmen { p.note_an(40 + v as u8, 0.8); }
        }
    };
    for _ in 0..200 { wieder(&mut p, block); for _ in 0..block { senke += sample(&mut p); } } // aufwärmen
    for _ in 0..4000 {
        wieder(&mut p, block);
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
