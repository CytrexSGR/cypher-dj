//! Factory presets of the Labor effect (graph `fx-labor`): Ping-Pong and Spring Reverb (docs/presets/devices/GERAET-labor.md, section 4 and 7).
//! The presets are read from `djk/ui/presets/factory/modular/fx-labor-<name>.preset.json`; a click of amplitude 0.5 (one sample for the Ping-Pong, 5 ms for the
//! Spring) goes into the left input at 48 kHz, the knobs come from the file (positions 0..1). The pass/fail numbers come from the first render and are pinned with +-1 dB.
use baukasten_dsp::{uebersetze, Programm};

const SR: f32 = 48_000.0;
const GRAPH: &str = include_str!("../demos/fx-labor.json");
const KNOEPFE: usize = 29;

fn preset(name: &str) -> serde_json::Value {
    let f = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("../../ui/presets/factory/modular/fx-labor-{name}.preset.json"));
    let j: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&f).unwrap_or_else(|e| panic!("{}: {e}", f.display()))).unwrap();
    assert_eq!(j["graph"], "fx-labor");
    assert_eq!(j["geraet"], "baukasten");
    j
}

/// the value a knob position gives in the graph (min..max, linear or log, with the centre value at position 0.5), like the engine
fn wert(nr: usize, pos: f32) -> f32 {
    let g: serde_json::Value = serde_json::from_str(GRAPH).unwrap();
    let k = g["knoten"].as_array().unwrap().iter().find(|k| k["art"] == "regler" && k["nr"] == nr).unwrap();
    let (min, max, log) = (k["min"].as_f64().unwrap() as f32, k["max"].as_f64().unwrap() as f32, k["log"] == 1);
    let mitte = k["mitte"].as_f64().map(|m| m as f32);
    let lerp = |a: f32, b: f32, t: f32| if log { a * (b / a).powf(t) } else { a + (b - a) * t };
    match mitte {
        Some(m) if pos < 0.5 => lerp(min, m, pos * 2.0),
        Some(m) => lerp(m, max, (pos - 0.5) * 2.0),
        None => lerp(min, max, pos),
    }
}

/// `dauer` seconds of the effect with a click of amplitude 0.5 and `breite` samples on the left input
fn klick(name: &str, dauer: f32, breite: usize) -> (Vec<(f32, f32)>, Vec<f32>) {
    let j = preset(name);
    let mut p: Programm = uebersetze(GRAPH, SR).unwrap_or_else(|e| panic!("{e}"));
    let mut pos = vec![];
    for n in 1..=KNOEPFE {
        let w = j["werte"][format!("knob{n}")].as_f64().unwrap_or_else(|| panic!("{name}: knob{n} missing")) as f32;
        p.setze_regler(n, w);
        pos.push(w);
    }
    let mut y = Vec::with_capacity((dauer * SR) as usize);
    for i in 0..(dauer * SR) as usize {
        p.setze_eingang(if i < breite { 0.5 } else { 0.0 }, 0.0);
        y.push(p.sample_stereo());
    }
    assert!(y.iter().all(|(l, r)| l.is_finite() && r.is_finite()), "{name}: not finite");
    assert_eq!(p.rettungen, 0, "{name}: the engine had to rescue the signal");
    (y, pos)
}

fn rms_db(y: &[(f32, f32)], von: f32, bis: f32) -> f32 {
    let s = &y[(von * SR) as usize..(bis * SR) as usize];
    let q: f64 = s.iter().map(|(l, r)| (*l as f64).powi(2) + (*r as f64).powi(2)).sum::<f64>() / (2 * s.len()) as f64;
    10.0 * q.max(1e-20).log10() as f32
}
fn spitze(y: &[(f32, f32)]) -> f32 { y.iter().fold(0f32, |m, (l, r)| m.max(l.abs()).max(r.abs())) }

/// echo peaks of both sides: (time in s, side 0 = left / 1 = right, level in dB), found on the 2 ms moving RMS of each side, above `ueber` dB over `boden`,
/// at least 20 ms apart, the dry click (first 8 ms) left out; sorted by time
fn echos(y: &[(f32, f32)], boden: f32, ueber: f32) -> Vec<(f32, usize, f32)> {
    let w = (0.002 * SR) as usize;
    let mut alle: Vec<(f32, usize, f32)> = vec![];
    for seite in 0..2 {
        let v: Vec<f32> = y.iter().map(|x| if seite == 0 { x.0 } else { x.1 }).collect();
        let env: Vec<f32> = (0..v.len().saturating_sub(w)).map(|i| 10.0 * (v[i..i + w].iter().map(|a| (*a as f64).powi(2)).sum::<f64>() / w as f64).max(1e-20).log10() as f32).collect();
        let mut i = (0.008 * SR) as usize;
        while i + 1 < env.len() {
            if env[i] > boden + ueber && env[i] >= env[i - 1] && env[i] > env[i + 1] {
                // the peak of a window of 20 ms around is the local maximum
                let hi = (i + (0.02 * SR) as usize).min(env.len());
                let lo = i.saturating_sub((0.02 * SR) as usize);
                if env[lo..hi].iter().all(|e| *e <= env[i]) { alle.push(((i + w / 2) as f32 / SR, seite, env[i])); i = hi; continue; }
            }
            i += 1;
        }
    }
    alle.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
    alle
}

/// T60 from the backward-integrated energy of the mono sum (Schroeder), slope fitted between -5 and -35 dB, extrapolated to -60 dB
fn t60(y: &[(f32, f32)], von: f32) -> f32 {
    let e: Vec<f64> = y[(von * SR) as usize..].iter().map(|(l, r)| ((*l + *r) as f64 * 0.5).powi(2)).collect();
    let mut s = vec![0.0f64; e.len()];
    let mut acc = 0.0;
    for i in (0..e.len()).rev() { acc += e[i]; s[i] = acc; }
    let d: Vec<f64> = s.iter().map(|v| 10.0 * (v / s[0]).max(1e-30).log10()).collect();
    let (a, b) = (d.iter().position(|v| *v < -5.0).unwrap(), d.iter().position(|v| *v < -35.0).unwrap());
    let steigung = (d[b] - d[a]) / ((b - a) as f64 / SR as f64);   // dB per second, negative
    (-60.0 / steigung) as f32
}

/// the spring is excited by a 5 ms click: a one-sample click is slew-limited by the delta modulator of the delay (0.008 V/us) to a blip of 0.17 V
/// and leaves the tail at the idle floor of the loop
const SPRING_KLICK: usize = 240;

// pinned numbers of the first render (+-1 dB / +-5 %)
const PING_ECHO_DB: f32 = -39.4;
const SPRING_SCHWANZ_DB: f32 = -44.0;
const SPRING_T60: f32 = 1.01;

#[test]
fn fx_labor_ping_pong() {
    let (y, pos) = klick("ping-pong", 4.0, 1);
    let boden = rms_db(&y, 3.5, 4.0);
    let e = echos(&y, boden, 20.0);
    println!("MESS ping-pong: floor {boden:.1} dB, peak {:.3}, echoes {:?}", spitze(&y), e.iter().map(|x| (format!("{:.3}", x.0), x.1, format!("{:.1}", x.2))).collect::<Vec<_>>());
    assert!(e.len() >= 3, "at least three echoes, found {}", e.len());
    // the channel order alternates; the first echo is the left channel's own repeat
    for w in e.windows(2) { assert_ne!(w[0].1, w[1].1, "echoes {:?} do not alternate", e); }
    // spacing = delay time of the channel of the later echo (left: knob 4, right: knob 16)
    let t = [wert(4, pos[3]) / 1000.0, wert(16, pos[15]) / 1000.0];
    let mut zuvor = 0.0;
    for x in e.iter().take(4) {
        let abstand = x.0 - zuvor;
        let soll = t[x.1];
        println!("MESS ping-pong: echo side {} spacing {abstand:.4} s, time of that channel {soll:.4} s", x.1);
        assert!((abstand - soll).abs() <= 0.05 * soll, "spacing {abstand} against time {soll}");
        zuvor = x.0;
    }
    let pegel = e[0].2;
    assert!((pegel - PING_ECHO_DB).abs() <= 1.0, "pinned {PING_ECHO_DB}, measured {pegel}");
    assert!(spitze(&y) <= 0.98, "peak {}", spitze(&y));
}

#[test]
fn fx_labor_spring_reverb() {
    let (y, _) = klick("spring-reverb", 10.0, SPRING_KLICK);
    let boden = rms_db(&y, 9.5, 10.0);
    let schwanz = rms_db(&y, 0.3, 0.6);
    let t = t60(&y, 0.0);
    println!("MESS spring: tail RMS 0.3-0.6 s {schwanz:.1} dB, floor 9.5-10 s {boden:.1} dB, T60 {t:.2} s, peak {:.3}", spitze(&y));
    assert!(schwanz - boden >= 50.0, "tail {schwanz} over floor {boden}");
    assert!((0.3..=3.0).contains(&t), "T60 {t} s");
    assert!(rms_db(&y, 8.0, 9.0) < schwanz - 30.0, "the tail still grows");
    assert!(spitze(&y) <= 0.98, "peak {}", spitze(&y));
    assert!((schwanz - SPRING_SCHWANZ_DB).abs() <= 1.0, "pinned {SPRING_SCHWANZ_DB}, measured {schwanz}");
    assert!((t - SPRING_T60).abs() <= 0.05 * SPRING_T60.max(0.01), "pinned T60 {SPRING_T60}, measured {t}");
}
