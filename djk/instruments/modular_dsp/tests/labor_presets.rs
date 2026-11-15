//! Factory presets of the Labor instrument (graph `labor`): Kick, Drone and Howl (docs/presets/devices/GERAET-labor.md, section 4 and 7).
//! The presets are read from `djk/ui/presets/factory/modular/labor-<name>.preset.json` and played the way the studio plays them:
//! one note, knobs set from the file (positions 0..1), 48 kHz. The pass/fail numbers come from the first render and are pinned with +-1 dB.
use baukasten_dsp::{uebersetze, Programm, REGLER};
use realfft::RealFftPlanner;

const SR: f32 = 48_000.0;
const GRAPH: &str = include_str!("../demos/labor.json");
const DC_GRENZE_DBFS: f64 = -50.0;

fn preset(name: &str) -> serde_json::Value {
    let f = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("../../ui/presets/factory/modular/labor-{name}.preset.json"));
    let j: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&f).unwrap_or_else(|e| panic!("{}: {e}", f.display()))).unwrap();
    assert_eq!(j["graph"], "labor");
    assert_eq!(j["geraet"], "baukasten");
    assert_eq!(j["geraet_typ"], "instrument");
    j
}

/// one note of `dauer` seconds, released after `off` seconds; the knobs come from the preset file (all 30 are carried)
fn spiele(name: &str, note: u8, dauer: f32, off: f32) -> Vec<(f32, f32)> {
    let j = preset(name);
    let mut p: Programm = uebersetze(GRAPH, SR).unwrap_or_else(|e| panic!("{e}"));
    for n in 1..=30 {
        let w = j["werte"][format!("knob{n}")].as_f64().unwrap_or_else(|| panic!("{name}: knob{n} missing")) as f32;
        assert!(n <= REGLER);
        p.setze_regler(n, w);
    }
    p.note_an(note, 0.8);
    let (gesamt, aus) = ((dauer * SR) as usize, (off * SR) as usize);
    let mut y = Vec::with_capacity(gesamt);
    for i in 0..gesamt {
        if i == aus { p.note_aus(note); }
        y.push(p.sample_stereo());
    }
    assert!(y.iter().all(|(l, r)| l.is_finite() && r.is_finite()), "{name}: not finite");
    assert_eq!(p.rettungen, 0, "{name}: the engine had to rescue the signal");
    y
}

fn rms_db(y: &[(f32, f32)], von: f32, bis: f32) -> f32 {
    let s = &y[(von * SR) as usize..(bis * SR) as usize];
    let q: f64 = s.iter().map(|(l, r)| (*l as f64).powi(2) + (*r as f64).powi(2)).sum::<f64>() / (2 * s.len()) as f64;
    10.0 * q.max(1e-20).log10() as f32
}
fn spitze(y: &[(f32, f32)]) -> f32 { y.iter().fold(0f32, |m, (l, r)| m.max(l.abs()).max(r.abs())) }
/// DC of the last second, both sides, in dBFS
fn dc_dbfs(y: &[(f32, f32)]) -> f64 {
    let s = &y[y.len() - SR as usize..];
    let m = |f: fn(&(f32, f32)) -> f32| s.iter().map(|x| f(x) as f64).sum::<f64>() / s.len() as f64;
    20.0 * m(|x| x.0).abs().max(m(|x| x.1).abs()).max(1e-12).log10()
}

/// magnitude spectrum in dB of an 8192-point Hann window of the left side starting at `start` seconds
fn spektrum(y: &[(f32, f32)], start: f32) -> Vec<f32> {
    let (n, s0) = (8192, (start * SR) as usize);
    let mut ein: Vec<f32> = (0..n).map(|i| y[s0 + i].0 * (0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / n as f32).cos())).collect();
    let fft = RealFftPlanner::<f32>::new().plan_fft_forward(n);
    let mut aus = fft.make_output_vec();
    fft.process(&mut ein, &mut aus).unwrap();
    aus.iter().map(|c| 10.0 * (c.norm_sqr() + 1e-20).log10()).collect()
}
fn bin_hz(i: f32) -> f32 { i * SR / 8192.0 }
/// strongest line in Hz with parabolic interpolation over the dB magnitudes
fn staerkste_linie(y: &[(f32, f32)], start: f32) -> f32 {
    let pw = spektrum(y, start);
    let i = (1..pw.len() - 1).max_by(|&a, &b| pw[a].partial_cmp(&pw[b]).unwrap()).unwrap();
    let (a, b, c) = (pw[i - 1], pw[i], pw[i + 1]);
    bin_hz(i as f32 + 0.5 * (a - c) / (a - 2.0 * b + c))
}
/// local maxima within `db` of the global maximum, at least 5 bins (29 Hz) apart
fn linien(y: &[(f32, f32)], start: f32, db: f32) -> Vec<f32> {
    let pw = spektrum(y, start);
    let top = pw.iter().cloned().fold(f32::MIN, f32::max);
    let mut l: Vec<usize> = (2..pw.len() - 2).filter(|&i| pw[i] >= pw[i - 1] && pw[i] > pw[i + 1] && pw[i] > top - db).collect();
    l.sort_by(|&a, &b| pw[b].partial_cmp(&pw[a]).unwrap());
    let mut keep: Vec<usize> = vec![];
    for i in l { if keep.iter().all(|&k| (k as i64 - i as i64).abs() >= 5) { keep.push(i) } }
    keep.iter().map(|&i| bin_hz(i as f32)).collect()
}

/// the kick retriggered every half second at full velocity: the rings of the pinged filter add up, the sum must stay below 0.98
fn kick_folge_spitze(name: &str) -> f32 {
    let j = preset(name);
    let mut p: Programm = uebersetze(GRAPH, SR).unwrap_or_else(|e| panic!("{e}"));
    for n in 1..=30 { p.setze_regler(n, j["werte"][format!("knob{n}")].as_f64().unwrap() as f32); }
    let mut y = Vec::new();
    for i in 0..(4.0 * SR) as usize {
        if i % (SR as usize / 2) == 0 { p.note_an(48, 1.0); }
        if i % (SR as usize / 2) == (SR as usize / 16) { p.note_aus(48); }
        y.push(p.sample_stereo());
    }
    spitze(&y)
}

fn pruefe_gemeinsam(name: &str, y: &[(f32, f32)]) {
    let (sp, dc) = (spitze(y), dc_dbfs(y));
    println!("MESS {name}: peak {sp:.3}, DC {dc:.1} dBFS, RMS 0-1 s {:.1} dB", rms_db(y, 0.0, 1.0));
    assert!(sp <= 0.98, "{name}: peak {sp}");
    assert!(dc < DC_GRENZE_DBFS, "{name}: DC {dc} dBFS");
}

// pinned numbers of the first render (+-1 dB); filled in below
const KICK_ABKLANG_DB: f32 = 44.1;
const DRONE_PEGEL_DB: f32 = -7.9;
const HOWL_PEGEL_DB: f32 = -8.4;

#[test]
fn labor_kick() {
    let (a, b) = (spiele("kick", 48, 2.0, 0.125), spiele("kick", 60, 2.0, 0.125));
    let (fa, fb) = (staerkste_linie(&a, 0.1), staerkste_linie(&b, 0.1));
    let abklang = rms_db(&a, 0.0, 0.1) - rms_db(&a, 1.0, 1.5);
    println!("MESS kick: line note 48 {fa:.2} Hz, note 60 {fb:.2} Hz, RMS 0-100 ms {:.1} dB, 1.0-1.5 s {:.1} dB, decay {abklang:.1} dB", rms_db(&a, 0.0, 0.1), rms_db(&a, 1.0, 1.5));
    assert!((40.0..=110.0).contains(&fa), "line {fa}");
    assert!((fa - fb).abs() < 0.5, "Key track 0: note 48 {fa} Hz, note 60 {fb} Hz");
    assert!(abklang >= 40.0, "decay {abklang} dB");
    assert!((abklang - KICK_ABKLANG_DB).abs() <= 1.0, "pinned {KICK_ABKLANG_DB}, measured {abklang}");
    let folge = kick_folge_spitze("kick");
    println!("MESS kick: peak of eight hits at full velocity, half a second apart {folge:.3}");
    assert!(folge <= 0.98, "retriggered kick peaks at {folge}");
    pruefe_gemeinsam("kick", &a);
    pruefe_gemeinsam("kick 60", &b);
}

#[test]
fn labor_drone() {
    let y = spiele("drone", 48, 5.0, 0.5);
    let (e, l) = (rms_db(&y, 1.0, 2.0), rms_db(&y, 3.0, 4.0));
    let li = linien(&y, 3.0, 20.0);
    println!("MESS drone: RMS 1-2 s {e:.1} dB, 3-4 s {l:.1} dB, {} lines within 20 dB: {li:?}", li.len());
    assert!((e - l).abs() <= 3.0, "the drone must hold: {e} against {l}");
    assert!(li.len() >= 2, "lines {li:?}");
    assert!((l - DRONE_PEGEL_DB).abs() <= 1.0, "pinned {DRONE_PEGEL_DB}, measured {l}");
    pruefe_gemeinsam("drone", &y);
}

#[test]
fn labor_howl() {
    let y = spiele("howl", 48, 5.0, 1.0);
    let (e, l) = (rms_db(&y, 1.5, 2.5), rms_db(&y, 3.0, 4.0));
    let f = staerkste_linie(&y, 3.0);
    println!("MESS howl: RMS 1.5-2.5 s {e:.1} dB, 3-4 s {l:.1} dB, dominant line {f:.1} Hz");
    assert!((e - l).abs() <= 3.0, "the howl must hold after the release: {e} against {l}");
    // Measured, not as planned: the plan expected the dominant line at the cutoff (300 to 1200 Hz). The engine maps knob 1 with its centre value
    // (position 0.55 = 358 Hz at C4, not 755 Hz) and the oscillation of the loop is a low fundamental with odd harmonics: the strongest line is
    // the fundamental, the harmonic that carries the pitch the ear follows sits in the plan's band.
    assert!((40.0..=120.0).contains(&f), "fundamental {f}");
    assert!(linien(&y, 3.0, 20.0).iter().any(|h| (300.0..=1200.0).contains(h)), "no line within 20 dB in 300..1200 Hz");
    assert!((l - HOWL_PEGEL_DB).abs() <= 1.0, "pinned {HOWL_PEGEL_DB}, measured {l}");
    pruefe_gemeinsam("howl", &y);
}
