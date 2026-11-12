//! Kostenmessung je Graph (Spec E20), nur auf Zuruf und unter dem Echtzeit-Schloss (Absprache mit der Warp-Welle):
//!   . djk/config/realtime_lock.sh && flock "$CYPHERDJ_ECHTZEIT_SCHLOSS" \
//!     cargo test --release -p baukasten_dsp --test kosten_messung -- --ignored --nocapture
//! Druckt je Beispielgraph eine JSON-Zeile: Blöcke à 256 Samples, alle Stimmen klingen, p50/p99/p99,9 in µs und Anteil
//! an 5,33 ms.
use baukasten_dsp::{uebersetze_mit_wurzel, Kosten};
use std::time::Instant;

#[test]
#[ignore]
fn kosten_beispielgraph_alle_stimmen() {
    for g in [include_str!("../demos/saege-ladder.json"), include_str!("../demos/juno-pad.json"), include_str!("../demos/juno-pad-hall.json"), include_str!("../demos/juno-pad-echo.json"), include_str!("../demos/juno-pad-dyn.json"), include_str!("../demos/lead.json"), include_str!("../demos/saite.json"), include_str!("../demos/fx-echo-achtel.json"), include_str!("../demos/fx-filter-wobble.json"), include_str!("../demos/fx-filter-regler.json"), include_str!("../demos/bassmusik.json"), include_str!("../demos/fx-phaser.json"), include_str!("../demos/fx-flanger.json"), include_str!("../demos/fx-lofi-sp1200.json"), include_str!("../demos/roehre-lead.json"), include_str!("../demos/fx-roehre.json"), include_str!("../demos/fx-vocoder-robot.json"), include_str!("../demos/wavetable-supersaw.json"), include_str!("../demos/wavetable-reese.json"), include_str!("../demos/wavetable-chor.json"), include_str!("../demos/fm-bass.json"), include_str!("../demos/fm-epiano.json"), include_str!("../demos/fm-glocke.json"), include_str!("../demos/fm-lead.json"), include_str!("../demos/granular-pad.json"), include_str!("../demos/granular-textur.json"), include_str!("../demos/granular-drone.json")] {
        miss(g, 256);
    }
}

/// Kleine Blöcke (Slice 4a): der Hall rechnet je Sample, kleinere Blöcke verteilen die Arbeit auf mehr Perioden
#[test]
#[ignore]
fn kosten_kleine_bloecke() {
    for g in [include_str!("../demos/juno-pad.json"), include_str!("../demos/juno-pad-hall.json"), include_str!("../demos/juno-pad-echo.json"), include_str!("../demos/juno-pad-dyn.json")] {
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
    let feder = include_str!("../demos/fx-federhall.json");
    let feder_2s = feder.replace(r#""datei": "feder-ir.f32", "laenge_max": 1500"#, r#""datei": "feder-ir-2s.f32", "laenge_max": 2000"#)
        .replace(r#""name": "fx-federhall""#, r#""name": "fx-federhall-2s""#);
    assert_ne!(feder, feder_2s, "the 2 s variant must differ from the example");
    for g in [feder, feder_2s.as_str(), include_str!("../demos/fx-filter-fahrt.json")] {
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
    let alt = include_str!("common/sampler-fairlight-s10.json").replace(r#""name":"sampler-fairlight""#, r#""name":"sampler-fairlight-s10""#);
    for g in [alt.as_str(), include_str!("../demos/sampler-fairlight.json")] {
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

/// Wavetable cost: `wavetable-supersaw` at its 16 voices with 1, 2 and 7 copies, against the same sound built the old way
/// (seven `saege` nodes per voice, each behind a `transponiere`, summed by `add` nodes, then the same filter and envelope,
/// mono). Blocks of 64, 128 and 256. Not gated.
#[test]
#[ignore]
fn kosten_wavetable() {
    let supersaw = include_str!("../demos/wavetable-supersaw.json");
    let mut graphen: Vec<String> = [1, 2, 7].iter().map(|k| {
        supersaw.replace(r#""kopien": 7"#, &format!(r#""kopien": {k}"#)).replace(r#""name": "wavetable-supersaw""#, &format!(r#""name": "wavetable-supersaw-x{k}""#))
    }).collect();
    graphen.push(sieben_saegen(16));
    for g in &graphen {
        for block in [64, 128, 256] {
            miss(g, block);
        }
    }
}

/// The supersaw without the wavetable block: seven saws at -25 .. +25 cent per voice.
fn sieben_saegen(stimmen: usize) -> String {
    let mut k = vec![r#"{"id":"n","art":"note"}"#.to_string()];
    let mut e = Vec::new();
    for i in 0..7 {
        let c = (i as f32 / 3.0 - 1.0) * 25.0;
        k.push(format!(r#"{{"id":"t{i}","art":"transponiere","cent":{c}}},{{"id":"s{i}","art":"saege"}}"#));
        e.push(format!(r#"{{"von":"n.hz","nach":"t{i}.hz"}},{{"von":"t{i}.aus","nach":"s{i}.hz"}}"#));
    }
    k.push(r#"{"id":"a0","art":"add"},{"id":"a1","art":"add"},{"id":"a2","art":"add"},{"id":"f","art":"svf","cutoff":5000,"reso":0.3},{"id":"env","art":"adsr","a":0.05,"d":0.4,"s":0.85,"r":0.4},{"id":"v","art":"mul"},{"id":"g","art":"mul","b":0.06},{"id":"o","art":"ausgang"}"#.to_string());
    e.push(r#"{"von":"s0.aus","nach":"a0.a"},{"von":"s1.aus","nach":"a0.b"},{"von":"s2.aus","nach":"a0.c"},{"von":"s3.aus","nach":"a0.d"},{"von":"s4.aus","nach":"a1.a"},{"von":"s5.aus","nach":"a1.b"},{"von":"s6.aus","nach":"a1.c"},{"von":"a0.aus","nach":"a2.a"},{"von":"a1.aus","nach":"a2.b"},{"von":"a2.aus","nach":"f.x"},{"von":"n.gate","nach":"env.gate"},{"von":"n.trig","nach":"env.trig"},{"von":"f.tp","nach":"v.a"},{"von":"env.aus","nach":"v.b"},{"von":"v.aus","nach":"g.a"},{"von":"g.aus","nach":"o.x"}"#.to_string());
    format!(r#"{{"format":"baukasten/2","name":"sieben-saegen-x7","stimmen":{stimmen},"knoten":[{}],"kanten":[{}]}}"#, k.join(","), e.join(","))
}

/// MS-20 filter cost: 16 voices of saw through one `ms20`, reso 0.5 and 0.97 (self-oscillating, the worst case for the
/// feedback solver) with both outputs (modus 0) and with one (modus 1), and the three examples at 16 voices. Blocks of 64,
/// 128 and 256. Not gated.
#[test]
#[ignore]
fn kosten_ms20() {
    let g = |reso: f32, modus: u8| format!(
        r#"{{"format":"baukasten/2","name":"ms20-16x-reso{reso}-modus{modus}","stimmen":16,"knoten":[{{"id":"n","art":"note"}},{{"id":"s","art":"saege"}},{{"id":"f","art":"ms20","cutoff":1500,"reso":{reso},"antrieb":0.5,"modus":{modus}}},{{"id":"o","art":"ausgang"}}],"kanten":[{{"von":"n.hz","nach":"s.hz"}},{{"von":"s.aus","nach":"f.x"}},{{"von":"f.tp","nach":"o.x"}}]}}"#);
    for (reso, modus) in [(0.5, 0), (0.97, 0), (0.5, 1), (0.97, 1)] {
        for block in [64, 128, 256] {
            miss(&g(reso, modus), block);
        }
    }
    for g in [include_str!("../demos/ms20-bass.json"), include_str!("../demos/ms20-goa-lead.json"), include_str!("../demos/fx-ms20-schrei.json")] {
        let g = g.replace(r#""stimmen": 4"#, r#""stimmen": 16"#).replace(r#""stimmen": 8"#, r#""stimmen": 16"#);
        miss(&g, 256);
    }
}

/// Resonator cost: 32 modes x 16 voices, every voice struck again every 4800 samples (so no voice goes idle), with 8, 16
/// and 32 modes and the five examples at their own sizes. Blocks of 64, 128 and 256. Not gated.
#[test]
#[ignore]
fn kosten_resonator() {
    let voll = |moden: usize| format!(
        r#"{{"format":"baukasten/2","name":"resonator-16x{moden}","stimmen":16,"knoten":[{{"id":"n","art":"note"}},{{"id":"r","art":"resonator","satz":0,"moden":{moden},"material":1,"helligkeit":1}},{{"id":"g","art":"mul","b":0.05}},{{"id":"o","art":"ausgang"}}],"kanten":[{{"von":"n.hz","nach":"r.hz"}},{{"von":"n.trig","nach":"r.trig"}},{{"von":"r.aus","nach":"g.a"}},{{"von":"g.aus","nach":"o.x"}}]}}"#);
    for g in [voll(8), voll(16), voll(32)] {
        for block in [64, 128, 256] {
            miss_n(&g, block, None, 4_800);
        }
    }
    for g in [include_str!("../demos/resonator-glocke.json"), include_str!("../demos/resonator-marimba.json"), include_str!("../demos/resonator-conga.json"), include_str!("../demos/resonator-metall.json"), include_str!("../demos/fx-resonator.json")] {
        miss_n(g, 256, None, 4_800);
    }
}

/// Metall cost: 16 voices of one `metall` node (group choke off, decay 2 s, noise 0.3), all 16 struck again every
/// 0.25 s so every voice computes all the time (an idle voice computes nothing); against the same graph with 1 and 4
/// voices, and the three examples at their own voice counts. Blocks of 64, 128 and 256. Not gated.
#[test]
#[ignore]
fn kosten_metall() {
    let g = |stimmen: usize| format!(r#"{{"format":"baukasten/2","name":"metall-x{stimmen}","stimmen":{stimmen},"knoten":[{{"id":"n","art":"note"}},{{"id":"m","art":"metall","gruppe":0,"decay":2,"rauschen":0.3}},{{"id":"g","art":"mul","b":0.1}},{{"id":"o","art":"ausgang"}}],"kanten":[{{"von":"n.trig","nach":"m.trig"}},{{"von":"n.vel","nach":"m.vel"}},{{"von":"m.aus","nach":"g.a"}},{{"von":"g.aus","nach":"o.x"}}]}}"#);
    for s in [1, 4, 16] {
        for block in [64, 128, 256] {
            miss_n(&g(s), block, None, 12_000);
        }
    }
    for b in [include_str!("../demos/metall-hihat.json"), include_str!("../demos/metall-ride.json"), include_str!("../demos/metall-crash.json")] {
        miss_n(b, 256, None, 12_000);
    }
}
/// FM cost: one fm node at 16 voices, all sounding, for a 4-operator and a 6-operator algorithm with every operator at
/// work (levels 0.3, feedback 0.5), the node alone with a gain and the output; plus the 6-operator case built the old way from `sinus` nodes (phase modulation through the `fm` input is linear FM there,
/// so this compares the cost, not the sound). Blocks of 64, 128 and 256. Not gated.
#[test]
#[ignore]
fn kosten_fm() {
    let fm = |algo: usize, name: &str| format!(
        r#"{{"format":"baukasten/2","name":"{name}","stimmen":16,"knoten":[{{"id":"n","art":"note"}},{{"id":"f","art":"fm","algo":{algo},"rueck":0.5,"o2_pegel":0.3,"o3_pegel":0.3,"o4_pegel":0.3,"o5_pegel":0.3,"o6_pegel":0.3,"o2_verh":2,"o3_verh":3,"o4_verh":1,"o5_verh":2,"o6_verh":1}},{{"id":"g","art":"mul","b":0.05}},{{"id":"o","art":"ausgang"}}],"kanten":[{{"von":"n.hz","nach":"f.hz"}},{{"von":"n.gate","nach":"f.gate"}},{{"von":"n.trig","nach":"f.trig"}},{{"von":"f.aus","nach":"g.a"}},{{"von":"g.aus","nach":"o.x"}}]}}"#);
    let mut graphen = vec![fm(0, "fm-4op-x16"), fm(8, "fm-6op-x16"), fm(10, "fm-6op-paare-x16")];
    graphen.push(sechs_sinus(16));
    for g in &graphen {
        for block in [64, 128, 256] {
            miss(g, block);
        }
    }
}

/// String cost: the four string examples at their own voice counts and all at 16 voices, plus the piano with vibrato on
/// the pitch (the loop is designed again every sample) and the old `saite.json` (a `leitung` loop built from blocks).
/// Blocks of 64, 128 and 256. Not gated.
#[test]
#[ignore]
fn kosten_saite() {
    let beispiele = [include_str!("../demos/saite-gitarre.json"), include_str!("../demos/saite-harfe.json"),
                     include_str!("../demos/saite-klavier.json"), include_str!("../demos/saite-karplus.json")];
    let mut graphen: Vec<String> = beispiele.iter().map(|g| g.to_string()).collect();
    for g in beispiele {
        let name = g.split("\"name\": \"").nth(1).unwrap().split('"').next().unwrap();
        let stimmen = g.split("\"stimmen\": ").nth(1).unwrap().split(',').next().unwrap();
        if stimmen != "16" {
            graphen.push(g.replace(&format!("\"stimmen\": {stimmen},"), "\"stimmen\": 16,").replace(&format!("\"name\": \"{name}\""), &format!("\"name\": \"{name}-x16\"")));
        }
    }
    // vibrato: 5 Hz, +-20 cent on every voice, so hz changes every sample
    let klavier = include_str!("../demos/saite-klavier.json");
    let vibrato = klavier
        .replace(r#"{"id": "aus", "art": "ausgang"}"#, r#"{"id": "aus", "art": "ausgang"}, {"id": "vib", "art": "lfo", "rate": 5}, {"id": "vib_c", "art": "mul", "b": 20}, {"id": "vib_t", "art": "transponiere"}"#)
        .replace(r#"{"von": "note.hz", "nach": "saite.hz"}"#, r#"{"von": "note.hz", "nach": "vib_t.hz"}, {"von": "vib.aus", "nach": "vib_c.a"}, {"von": "vib_c.aus", "nach": "vib_t.cent"}, {"von": "vib_t.aus", "nach": "saite.hz"}"#)
        .replace(r#""name": "saite-klavier""#, r#""name": "saite-klavier-vibrato""#);
    assert_ne!(vibrato, klavier, "the vibrato variant must differ from the example");
    graphen.push(vibrato);
    graphen.push(include_str!("../demos/saite.json").to_string());
    for g in &graphen {
        for block in [64, 128, 256] {
            miss(g, block);
        }
    }
}
/// Comb and vowel filter cost: 16 voices each. The comb is tuned by the note with a 5 Hz vibrato on `hz` (the delay target moves
/// every sample), once with positive and once with negative feedback, plus the pluck example at 16 voices; the vowel filter
/// has `vokal` on a 3 Hz LFO (the targets are redesigned every 8 samples) and the neuro bass example at 16 voices.
/// Blocks of 64, 128 and 256. Not gated.
#[test]
#[ignore]
fn kosten_kamm_formant() {
    let kamm = |name: &str, fb: f32| format!(r#"{{"format":"baukasten/2","name":"{name}","stimmen":16,"knoten":[{{"id":"n","art":"note"}},{{"id":"r","art":"rauschen"}},{{"id":"rx","art":"mul","b":0.1}},{{"id":"v","art":"lfo","rate":5}},{{"id":"vc","art":"mul","b":20}},{{"id":"t","art":"transponiere"}},{{"id":"k","art":"kamm","fb":{fb},"daempf":0.4}},{{"id":"o","art":"ausgang"}}],"kanten":[{{"von":"r.aus","nach":"rx.a"}},{{"von":"rx.aus","nach":"k.x"}},{{"von":"n.hz","nach":"t.hz"}},{{"von":"v.aus","nach":"vc.a"}},{{"von":"vc.aus","nach":"t.cent"}},{{"von":"t.aus","nach":"k.hz"}},{{"von":"k.aus","nach":"o.x"}}]}}"#);
    let formant = r#"{"format":"baukasten/2","name":"formant-16x-lfo","stimmen":16,"knoten":[{"id":"n","art":"note"},{"id":"s","art":"saege"},{"id":"v","art":"lfo","rate":3},{"id":"vb","art":"mul","b":2},{"id":"va","art":"add","b":2},{"id":"f","art":"formant"},{"id":"o","art":"ausgang"}],"kanten":[{"von":"n.hz","nach":"s.hz"},{"von":"s.aus","nach":"f.x"},{"von":"v.aus","nach":"vb.a"},{"von":"vb.aus","nach":"va.a"},{"von":"va.aus","nach":"f.vokal"},{"von":"f.aus","nach":"o.x"}]}"#;
    let zupf = include_str!("../demos/kamm-goa-zupf.json").replace(r#""stimmen": 8,"#, r#""stimmen": 16,"#).replace(r#""name": "kamm-goa-zupf""#, r#""name": "kamm-goa-zupf-x16""#);
    let bass = include_str!("../demos/formant-neuro-bass.json").replace(r#""stimmen": 4,"#, r#""stimmen": 16,"#).replace(r#""name": "formant-neuro-bass""#, r#""name": "formant-neuro-bass-x16""#);
    assert_ne!(zupf, include_str!("../demos/kamm-goa-zupf.json"));
    assert_ne!(bass, include_str!("../demos/formant-neuro-bass.json"));
    let graphen = [kamm("kamm-16x-vibrato-pos", 0.9), kamm("kamm-16x-vibrato-neg", -0.9), formant.to_string(), zupf, bass,
                   include_str!("../demos/fx-kamm-metall.json").to_string(), include_str!("../demos/fx-formant-sprech.json").to_string()];
    for g in &graphen {
        for block in [64, 128, 256] {
            miss(g, block);
        }
    }
}
/// Granular cost: 16 voices, every voice with a full pool (dichte 400 x 100 ms wants 40 grains, 16 sound), for each source,
/// against the same graph at an overlap of about 4 (dichte 40). Blocks of 64, 128 and 256. Not gated.
#[test]
#[ignore]
fn kosten_granular() {
    for (quelle, name) in [(0, "wavetable"), (1, "puffer"), (2, "rauschen")] {
        for dichte in [400, 40] {
            let g = format!(r#"{{"format":"baukasten/2","name":"granular-{name}-16x-dichte{dichte}","stimmen":16,"knoten":[{{"id":"n","art":"note"}},{{"id":"s","art":"saege"}},{{"id":"g","art":"granular","quelle":{quelle},"tabelle":5,"pos":0.3,"pos_zufall":0.3,"ton_zufall":20,"breite":1,"groesse":100,"dichte":{dichte}}},{{"id":"o","art":"ausgang"}}],"kanten":[{{"von":"n.hz","nach":"s.hz"}},{{"von":"s.aus","nach":"g.x"}},{{"von":"n.hz","nach":"g.hz"}},{{"von":"n.trig","nach":"g.trig"}},{{"von":"g.l","nach":"o.l"}},{{"von":"g.r","nach":"o.r"}}]}}"#);
            for block in [64, 128, 256] {
                miss(&g, block);
            }
        }
    }
}

/// Six `sinus` nodes per voice chained through their `fm` inputs, each behind a `transponiere` and a `mul` (level), with
/// six `adsr` and six `mul` for the envelopes: the parts an fm node replaces.
fn sechs_sinus(stimmen: usize) -> String {
    let mut k = vec![r#"{"id":"n","art":"note"}"#.to_string()];
    let mut e = Vec::new();
    for i in 0..6 {
        k.push(format!(r#"{{"id":"t{i}","art":"transponiere","st":{}}},{{"id":"s{i}","art":"sinus"}},{{"id":"h{i}","art":"adsr","a":0.001,"d":1,"s":1,"r":0.1}},{{"id":"v{i}","art":"mul"}},{{"id":"p{i}","art":"mul","b":300}}"#, i % 3 * 12));
        e.push(format!(r#"{{"von":"n.hz","nach":"t{i}.hz"}},{{"von":"t{i}.aus","nach":"s{i}.hz"}},{{"von":"n.gate","nach":"h{i}.gate"}},{{"von":"n.trig","nach":"h{i}.trig"}},{{"von":"s{i}.aus","nach":"v{i}.a"}},{{"von":"h{i}.aus","nach":"v{i}.b"}},{{"von":"v{i}.aus","nach":"p{i}.a"}}"#));
        if i > 0 {
            e.push(format!(r#"{{"von":"p{i}.aus","nach":"s{}.fm"}}"#, i - 1));
        }
    }
    k.push(r#"{"id":"g","art":"mul","b":0.05},{"id":"o","art":"ausgang"}"#.to_string());
    e.push(r#"{"von":"v0.aus","nach":"g.a"},{"von":"g.aus","nach":"o.x"}"#.to_string());
    format!(r#"{{"format":"baukasten/2","name":"sechs-sinus-x6","stimmen":{stimmen},"knoten":[{}],"kanten":[{}]}}"#, k.join(","), e.join(","))
}
/// Hard sync cost: 16 voices of one saw master and one slave each (no filter, no envelope), the slave a saw on the new
/// `hart` input, on the old `sync` input, and free running (no sync), plus the `hartsync-lead` example at 16 voices
/// (also with the old sync edge and without sync) and the old `lead` example at 16 voices.
/// The slave runs a fifth and a bit above the master, so about every second sample of the slave sees a reset or its
/// aftermath. Blocks of 64, 128 and 256. Not gated.
#[test]
#[ignore]
fn kosten_hartsync() {
    // `hoch`: the master 60 semitones up (2.6 to 6.4 kHz), so a reset or its aftermath falls on every second to fifth sample
    let paar = |name: &str, kante: &str, hoch: f32| format!(
        r#"{{"format":"baukasten/2","name":"{name}","stimmen":16,"knoten":[{{"id":"n","art":"note"}},{{"id":"h","art":"transponiere","st":{hoch}}},{{"id":"m","art":"saege"}},{{"id":"t","art":"transponiere","st":7.31}},{{"id":"s","art":"saege"}},{{"id":"o","art":"ausgang"}}],"kanten":[{{"von":"n.hz","nach":"h.hz"}},{{"von":"h.aus","nach":"m.hz"}},{{"von":"h.aus","nach":"t.hz"}},{{"von":"t.aus","nach":"s.hz"}},{{"von":"s.aus","nach":"o.x"}}{kante}]}}"#);
    let (k_hart, k_alt) = (r#",{"von":"m.hart","nach":"s.hart"}"#, r#",{"von":"m.zyklus","nach":"s.sync"}"#);
    let mut graphen = vec![paar("hart-x16", k_hart, 0.0), paar("sync-alt-x16", k_alt, 0.0), paar("frei-x16", "", 0.0)];
    graphen.push(include_str!("../demos/hartsync-lead.json").replace(r#""stimmen": 1"#, r#""stimmen": 16"#).replace(r#""name": "hartsync-lead""#, r#""name": "hartsync-lead-x16""#));
    // the same example with the old sync edge and without sync: what of its cost is the hard sync
    let lead = &graphen[3];
    let alt = lead.replace(r#"{"von": "leiter.hart", "nach": "folger.hart"}"#, r#"{"von": "leiter.zyklus", "nach": "folger.sync"}"#).replace("hartsync-lead-x16", "hartsync-lead-alter-sync-x16");
    let ohne = lead.replace(r#"{"von": "leiter.hart", "nach": "folger.hart"},"#, "").replace("hartsync-lead-x16", "hartsync-lead-ohne-sync-x16");
    assert!(alt != *lead && ohne != *lead);
    graphen.push(alt);
    graphen.push(ohne);
    graphen.push(include_str!("../demos/lead.json").replace(r#""stimmen": 1"#, r#""stimmen": 16"#).replace(r#""name": "sync-lead""#, r#""name": "lead-alter-sync-x16""#));
    for g in &graphen {
        for block in [64, 128, 256] {
            miss(g, block);
        }
    }
    // the 5 us histogram bins are coarse for the bare pairs: also the best of 7 runs of 1 s each, in ns per voice and sample
    let paare = [graphen[0].clone(), graphen[1].clone(), graphen[2].clone(), paar("hart-hoch-x16", k_hart, 60.0), paar("sync-alt-hoch-x16", k_alt, 60.0), paar("frei-hoch-x16", "", 60.0)];
    for g in &paare {
        let mut p = uebersetze_mit_wurzel(g, 48_000.0, None).unwrap();
        for n in 0..p.stimmen { p.note_an(40 + n as u8, 0.8); }
        let mut senke = 0.0f32;
        let mut best = f64::INFINITY;
        for _ in 0..7 {
            let t = Instant::now();
            for _ in 0..48_000 { senke += p.sample(); }
            best = best.min(t.elapsed().as_secs_f64());
        }
        println!("{{\"graph\":\"{}\",\"ns_je_stimme_und_sample\":{:.2},\"senke\":{}}}", p.name, best * 1e9 / (48_000.0 * p.stimmen as f64), senke.is_finite());
    }
}


/// Modulator cost: 16 voices of one `sh`, `mseg` and `folger` node each, a saw behind it and the modulator on the amplitude
/// (the saw alone as baseline), every voice struck again every 4800 samples. Blocks of 256. Not gated.
#[test]
#[ignore]
fn kosten_modulatoren() {
    let g = |name: &str, knoten: &str, kanten: &str| format!(
        r#"{{"format":"baukasten/2","name":"{name}-x16","stimmen":16,"knoten":[{{"id":"n","art":"note"}},{{"id":"s","art":"saege"}},{{"id":"m","art":"mul"}}{knoten},{{"id":"o","art":"ausgang"}}],"kanten":[{{"von":"n.hz","nach":"s.hz"}},{{"von":"s.aus","nach":"m.a"}}{kanten},{{"von":"m.aus","nach":"o.x"}}]}}"#);
    for gr in [
        g("basis", "", r#",{"von":"n.vel","nach":"m.b"}"#),
        g("sh", r#",{"id":"p","art":"sh","rate":12,"glatt":5}"#, r#",{"von":"p.aus","nach":"m.b"}"#),
        g("mseg", r#",{"id":"p","art":"mseg","stufen":4,"halt":0,"von":2,"bis":3,"p1":1,"t1":0.01,"p2":0.1,"t2":0.05,"k2":-0.6,"p3":0.9,"t3":0.04,"k3":0.5,"p4":0,"t4":0.1}"#, r#",{"von":"n.gate","nach":"p.gate"},{"von":"n.trig","nach":"p.trig"},{"von":"p.aus","nach":"m.b"}"#),
        g("folger", r#",{"id":"p","art":"folger"}"#, r#",{"von":"s.aus","nach":"p.x"},{"von":"p.aus","nach":"m.b"}"#),
    ] {
        miss_n(&gr, 256, None, 4_800);
    }
}
/// SEM filter cost: 16 voices of one `sem` node behind a saw, all sounding, with cutoff on an audio-rate sine (the worst
/// case: tan and the form smoother every sample), against the same graph with an `svf` (4 poles) and with no filter, and the
/// three examples at their own voice counts. Blocks of 64, 128 and 256. Not gated.
#[test]
#[ignore]
fn kosten_sem() {
    let g = |art: &str, name: &str, extra: &str| format!(
        r#"{{"format":"baukasten/2","name":"{name}","stimmen":16,"knoten":[{{"id":"n","art":"note"}},{{"id":"s","art":"saege"}},{{"id":"m","art":"sinus","hz":2300}},{{"id":"mm","art":"mul","b":1500}},{{"id":"ma","art":"add","b":2000}},{{"id":"f","art":"{art}","reso":0.7{extra}}},{{"id":"g","art":"mul","b":0.05}},{{"id":"o","art":"ausgang"}}],"kanten":[{{"von":"n.hz","nach":"s.hz"}},{{"von":"s.aus","nach":"f.x"}},{{"von":"m.aus","nach":"mm.a"}},{{"von":"mm.aus","nach":"ma.a"}},{{"von":"ma.aus","nach":"f.cutoff"}},{{"von":"f.{}","nach":"g.a"}},{{"von":"g.aus","nach":"o.x"}}]}}"#,
        if art == "sem" { "aus" } else { "tp" });
    for gr in [g("sem", "sem-16", r#","form":0.4"#), g("svf", "svf4-16", r#","pole":4"#), g("svf", "svf2-16", "")] {
        for block in [64, 128, 256] {
            miss(&gr, block);
        }
    }
    for b in [include_str!("../demos/fx-sem-fahrt.json"), include_str!("../demos/sem-house-akkord.json"), include_str!("../demos/sem-pad.json")] {
        miss(b, 256);
    }
}
/// Selector cost: 16 voices, 8 candidates (saw, svf low-, band- and high-pass, noise, three sines) with an LFO sweeping the
/// selection through all zones (so fades run), against the same candidates summed by three `add` nodes (the cost of the
/// candidates alone), and the effect example. Blocks of 64, 128 and 256. Not gated.
#[test]
#[ignore]
fn kosten_wahl() {
    let kandidaten = r#"{"id":"n","art":"note"},{"id":"s","art":"saege"},{"id":"f","art":"svf","cutoff":900,"reso":0.3},{"id":"r","art":"rauschen"},{"id":"a","art":"sinus"},{"id":"b","art":"sinus","hz":330},{"id":"c","art":"sinus","hz":550},{"id":"l","art":"lfo","rate":2},{"id":"k","art":"mul","b":0.5},{"id":"kk","art":"add","b":0.5},{"id":"o","art":"ausgang"}"#;
    let ein = r#"{"von":"n.hz","nach":"s.hz"},{"von":"n.hz","nach":"a.hz"},{"von":"s.aus","nach":"f.x"},{"von":"l.aus","nach":"k.a"},{"von":"k.aus","nach":"kk.a"}"#;
    let wahl = format!(
        r#"{{"format":"baukasten/2","name":"wahl-16x8","stimmen":16,"knoten":[{kandidaten},{{"id":"w","art":"wahl","n":8,"blende":5}}],"kanten":[{ein},{{"von":"s.aus","nach":"w.e1"}},{{"von":"f.tp","nach":"w.e2"}},{{"von":"f.bp","nach":"w.e3"}},{{"von":"f.hp","nach":"w.e4"}},{{"von":"r.aus","nach":"w.e5"}},{{"von":"a.aus","nach":"w.e6"}},{{"von":"b.aus","nach":"w.e7"}},{{"von":"c.aus","nach":"w.e8"}},{{"von":"kk.aus","nach":"w.wahl"}},{{"von":"w.aus","nach":"o.x"}}]}}"#
    );
    let summe = format!(
        r#"{{"format":"baukasten/2","name":"summe-16x8","stimmen":16,"knoten":[{kandidaten},{{"id":"p","art":"add"}},{{"id":"q","art":"add"}},{{"id":"z","art":"add"}}],"kanten":[{ein},{{"von":"s.aus","nach":"p.a"}},{{"von":"f.tp","nach":"p.b"}},{{"von":"f.bp","nach":"p.c"}},{{"von":"f.hp","nach":"p.d"}},{{"von":"r.aus","nach":"q.a"}},{{"von":"a.aus","nach":"q.b"}},{{"von":"b.aus","nach":"q.c"}},{{"von":"c.aus","nach":"q.d"}},{{"von":"p.aus","nach":"z.a"}},{{"von":"q.aus","nach":"z.b"}},{{"von":"z.aus","nach":"o.x"}}]}}"#
    );
    for g in [wahl.as_str(), summe.as_str(), include_str!("../demos/fx-wahl-filter.json")] {
        for block in [64, 128, 256] {
            miss(g, block);
        }
    }
}

/// Diode cost: 16 voices of saw through one `diode` node (cutoff on an audio-rate sinus plus a constant, reso 0.9), against
/// the same graph with `ladder`, and the three examples. Blocks of 64, 128 and 256. Not gated.
#[test]
#[ignore]
fn kosten_diode() {
    let paar = |art: &str| format!(
        r#"{{"format":"baukasten/2","name":"{art}-16","stimmen":16,"knoten":[{{"id":"n","art":"note"}},{{"id":"s","art":"saege"}},{{"id":"m","art":"sinus"}},{{"id":"mm","art":"mul","b":300}},{{"id":"c","art":"add","b":800}},{{"id":"d","art":"{art}","reso":0.9}},{{"id":"g","art":"mul","b":0.1}},{{"id":"o","art":"ausgang"}}],"kanten":[{{"von":"n.hz","nach":"s.hz"}},{{"von":"n.hz","nach":"m.hz"}},{{"von":"m.aus","nach":"mm.a"}},{{"von":"mm.aus","nach":"c.a"}},{{"von":"s.aus","nach":"d.x"}},{{"von":"c.aus","nach":"d.cutoff"}},{{"von":"d.aus","nach":"g.a"}},{{"von":"g.aus","nach":"o.x"}}]}}"#);
    for g in [paar("diode"), paar("ladder")] {
        for block in [64, 128, 256] {
            miss_n(&g, block, None, 0);
        }
    }
    for g in [include_str!("../demos/fx-diode-acid.json"), include_str!("../demos/diode-acid-bass.json"), include_str!("../demos/diode-goa-linie.json")] {
        miss(g, 256);
    }
}
