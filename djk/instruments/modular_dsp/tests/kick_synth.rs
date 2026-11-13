//! `kick-synth` (demos/kick-synth.json): a sine kick with a pitch envelope, a click and an overdrive, built for a low-end-first method:
//! the Tune knob is the pitch (the note number only triggers), the oscillator phase starts at 0 on every note so the first excursion is
//! reproducible, and the Polarity knob multiplies the output by exactly +1 or -1. Pins: tuning within 0.15 Hz (measured 0.084 Hz at most), polarity bit-exact, corners, real-time path.
use baukasten_dsp::{uebersetze, Programm, REGLER};
use realfft::RealFftPlanner;
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
const GRAPH: &str = include_str!("../demos/kick-synth.json");

// knob numbers
const TUNE: usize = 1;
const DECAY: usize = 2;
const POLARITAET: usize = 8;
/// the limit the other synth tests use for DC
const DC_GRENZE_DBFS: f64 = -50.0;

fn lade() -> Programm { uebersetze(GRAPH, SR).unwrap_or_else(|e| panic!("{e}")) }

/// knob position of a Tune value in Hz (20..130 Hz, log)
fn tune_pos(hz: f32) -> f32 { ((hz / 20.0).ln() / (130.0f32 / 20.0).ln()) as f32 }

/// one hit of `s` seconds at `note`, knobs as given on top of the graph's `vorgabe`
fn schlag(k: &[(usize, f32)], note: u8, s: f32) -> Vec<f32> {
    let mut p = lade();
    for &(n, v) in k { p.setze_regler(n, v); }
    p.note_an(note, 0.8);
    let y: Vec<f32> = (0..(s * SR) as usize).map(|_| p.sample_stereo().0).collect();
    assert!(y.iter().all(|v| v.is_finite()) && p.rettungen == 0, "not finite or rescued");
    y
}

/// the strongest line of an 8192-point Hann FFT starting at `start` samples, with its parabolic interpolation (Hz) over the dB magnitudes
fn staerkste_linie(y: &[f32], start: usize) -> f32 {
    let n = 8192;
    let mut ein: Vec<f32> = (0..n).map(|i| y[start + i] * (0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / n as f32).cos())).collect();
    let fft = RealFftPlanner::<f32>::new().plan_fft_forward(n);
    let mut aus = fft.make_output_vec();
    fft.process(&mut ein, &mut aus).unwrap();
    let pw: Vec<f32> = aus.iter().map(|c| 10.0 * (c.norm_sqr() + 1e-20).log10()).collect();
    let i = (1..pw.len() - 1).max_by(|&a, &b| pw[a].partial_cmp(&pw[b]).unwrap()).unwrap();
    let (l, m, r) = (pw[i - 1], pw[i], pw[i + 1]);
    let d = 0.5 * (l - r) / (l - 2.0 * m + r);
    (i as f32 + d) * SR / n as f32
}

fn spitze(y: &[f32]) -> f32 { y.iter().fold(0.0, |m, v| m.max(v.abs())) }
fn dc_dbfs(y: &[f32]) -> f64 { 20.0 * ((y.iter().map(|&v| v as f64).sum::<f64>() / y.len() as f64).abs()).max(1e-9).log10() }

/// the probe of the convention test: A2 C#3 E3 A3 at 0.5 s each, the chord 1.5 s, 1.5 s tail
fn probe(p: &mut Programm) -> Vec<f32> {
    let lauf = |p: &mut Programm, s: f32| (0..(s * SR) as usize).map(|_| p.sample_stereo().0).collect::<Vec<f32>>();
    let mut y = Vec::new();
    for n in [45u8, 49, 52, 57] { p.note_an(n, 0.8); y.extend(lauf(p, 0.5)); p.note_aus(n); }
    for n in [45u8, 49, 52, 57] { p.note_an(n, 0.8); }
    y.extend(lauf(p, 1.5));
    p.alle_aus();
    y.extend(lauf(p, 1.5));
    y
}

#[test]
fn vorgabe_ist_g1_mit_49_hz_und_der_regler_ist_in_0_1_hz_aufgeloest() {
    let p = lade();
    let v = p.regler_vorgaben();
    let hz = 20.0 * (130.0f64 / 20.0).powf(v[TUNE - 1] as f64);
    println!("MESS default Tune {hz:.5} Hz");
    assert!((hz - 49.0).abs() < 1e-3, "default Tune {hz}");
    // one knob step of 0.1 Hz at 49 Hz is 0.00109 of the travel: far above f32 resolution
    let (a, b) = (tune_pos(49.0), tune_pos(49.1));
    assert!(b - a > 1e-3 && b > a);
    let names: Vec<&str> = p.regler_namen.iter().map(|(_, s)| s.as_str()).collect();
    assert_eq!(names, ["Tune", "Decay", "Pitch amount", "Pitch decay", "Click", "Drive", "Level", "Polarity"]);
}

#[test]
fn stimmung_die_staerkste_linie_liegt_innerhalb_von_0_15_hz() {
    let mut schlimmster = 0.0f32;
    for soll in [24.5f32, 41.2, 49.0, 65.41] {
        // longest tail, so the 8192-point windows at 200 ms and 1000 ms are both far above the numerical floor
        let y = schlag(&[(TUNE, tune_pos(soll)), (DECAY, 1.0)], 36, 1.4);
        for start_ms in [200usize, 1000] {
            let f = staerkste_linie(&y, start_ms * 48);
            println!("MESS tuning {soll:6.2} Hz, window at {start_ms:4} ms: strongest line {f:.3} Hz (error {:+.3} Hz)", f - soll);
            assert!((f - soll).abs() < 0.15, "target {soll} Hz, measured {f} Hz at {start_ms} ms");
            schlimmster = schlimmster.max((f - soll).abs());
        }
    }
    println!("MESS tuning: largest error {schlimmster:.3} Hz");
}

#[test]
fn stimmung_gilt_auch_beim_vorgabe_klang_und_die_notennummer_loest_nur_aus() {
    // the default sound (decay 450 ms): the line at 49 Hz in the first window
    let a = schlag(&[], 36, 0.9);
    let f = staerkste_linie(&a, 9_600);
    println!("MESS default kick: strongest line {f:.3} Hz");
    assert!((f - 49.0).abs() < 0.15, "default kick {f} Hz");
    // the note number does not move the pitch: every note renders the same bits
    let b = schlag(&[], 60, 0.9);
    let c = schlag(&[], 84, 0.9);
    assert!(a == b && a == c, "the note number changed the sound");
}

#[test]
fn polaritaet_normal_beginnt_positiv_und_invertiert_ist_exakt_das_negativ() {
    let normal = schlag(&[(POLARITAET, 0.0)], 36, 1.0);
    let invers = schlag(&[(POLARITAET, 1.0)], 36, 1.0);
    let erste = |y: &[f32]| y.iter().position(|v| v.abs() > 1e-3).expect("silent");
    let (i, j) = (erste(&normal), erste(&invers));
    println!("MESS polarity: Normal first |x| > 1e-3 at sample {i}: {:+.6}; Inverted at sample {j}: {:+.6}", normal[i], invers[j]);
    assert!(normal[i] > 0.0, "Normal starts with {}", normal[i]);
    assert!(invers[j] < 0.0, "Inverted starts with {}", invers[j]);
    assert_eq!(i, j);
    assert!(normal.iter().zip(&invers).all(|(a, b)| *b == -*a), "Inverted is not exactly the negated Normal render");
    // the first excursion is a whole positive lobe: no negative sample before the first positive peak above half the maximum
    let pk = spitze(&normal);
    let halb = normal.iter().position(|v| *v > 0.5 * pk).unwrap();
    println!("MESS polarity: lowest sample before the half-peak (sample {halb}): {:+.6}", normal[..halb].iter().cloned().fold(f32::MAX, f32::min));
    assert!(normal[..halb].iter().all(|v| *v > -1e-3), "a negative excursion before the first positive peak");
    // the phase starts at 0 on every note: a second hit after the first renders the same first 5 ms
    let mut p = lade();
    p.note_an(36, 0.8);
    let _: Vec<f32> = (0..24_000).map(|_| p.sample_stereo().0).collect();
    p.note_aus(36);
    let _: Vec<f32> = (0..12_000).map(|_| p.sample_stereo().0).collect();
    p.note_an(36, 0.8);
    let zweite: Vec<f32> = (0..240).map(|_| p.sample_stereo().0).collect();
    let k = erste(&zweite);
    println!("MESS polarity: second hit on a ringing tail: first |x| > 1e-3 at sample {k}: {:+.6}", zweite[k]);
    assert!(zweite[k] > 0.0);
}

#[test]
fn ecken_der_knoepfe_bleiben_endlich_und_der_vorgabeklang_ist_sauber() {
    // default: peak below 1, no DC on the probe
    let mut p = lade();
    let y = probe(&mut p);
    let (s, d) = (spitze(&y), dc_dbfs(&y));
    println!("MESS default probe: peak {s:.3}, dc {d:.1} dBFS");
    assert!(s < 1.0, "peak {s}");
    assert!(d < DC_GRENZE_DBFS, "dc {d} dBFS");
    // all knobs 0, all knobs 1 and 24 fixed pseudo-random corner combinations
    let mut seed = 0x2545_f491_4f6c_dd1du64;
    let mut zufall = move || { seed ^= seed << 13; seed ^= seed >> 7; seed ^= seed << 17; (seed >> 40) as f32 / (1u64 << 24) as f32 };
    let mut faelle: Vec<Vec<f32>> = vec![vec![0.0; REGLER], vec![1.0; REGLER]];
    for _ in 0..24 { faelle.push((0..REGLER).map(|_| if zufall() < 0.5 { 0.0 } else { 1.0 }).collect()); }
    let mut hoechste = 0.0f32;
    for (i, kn) in faelle.iter().enumerate() {
        let mut p = lade();
        for (n, v) in kn.iter().enumerate() { p.setze_regler(n + 1, *v); }
        let y = probe(&mut p);
        assert!(y.iter().all(|v| v.is_finite()) && p.rettungen == 0, "case {i}: not finite or rescued");
        let (s, d) = (spitze(&y), dc_dbfs(&y));
        println!("MESS corner case {i:2}: peak {s:.3}, dc {d:.1} dBFS");
        hoechste = hoechste.max(s);
        if i < 2 { assert!(d < DC_GRENZE_DBFS, "case {i}: dc {d} dBFS"); }
    }
    // Level tops out at +6 dB over a tanh stage that peaks at 1 (the click adds to the body before the drive): 2.0 at most
    println!("MESS kick corners: highest peak over 26 cases {hoechste:.3}");
    assert!(hoechste < 2.05, "peak {hoechste}");
}

#[test]
fn echtzeitpfad_allokiert_nicht() {
    let vor = anforderungen();
    let mut p = lade();
    assert!(anforderungen() > vor, "positive control: the translation must allocate");
    let start = anforderungen();
    let mut summe = 0.0f32;
    for i in 0..96_000u32 {
        if i % 4000 == 0 { p.note_an(36 + (i / 4000 % 24) as u8, 0.7); }
        if i % 6000 == 0 { p.note_aus(36 + (i / 6000 % 24) as u8); }
        if i % 64 == 0 { p.setze_regler(1 + (i / 64) as usize % 8, (i % 1000) as f32 / 1000.0); }
        if i % 50_000 == 0 { p.alle_aus(); }
        if i == 90_000 { p.zuruecksetzen(); }
        let (l, r) = p.sample_stereo();
        summe += l + r;
    }
    assert_eq!(anforderungen(), start, "the real-time path asked for memory");
    assert!(summe.is_finite());
}

/// every factory preset of the graph renders a finite hit below 1.0 that starts positive and settles on its own Tune value
#[test]
fn werkspresets_sind_gestimmt_und_unter_1() {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../ui/presets/werk/baukasten");
    let mut n = 0;
    for e in std::fs::read_dir(&dir).unwrap().filter_map(|e| e.ok()) {
        let name = e.file_name().to_string_lossy().to_string();
        if !name.starts_with("kick-synth-") { continue; }
        let j: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(e.path()).unwrap()).unwrap();
        assert_eq!(j["graph"], "kick-synth");
        let w = &j["werte"];
        let k: Vec<(usize, f32)> = (1..=8).map(|i| (i, w[format!("knob{i}")].as_f64().unwrap() as f32)).collect();
        let soll = 20.0 * (130.0f32 / 20.0).powf(k[0].1);
        let y = schlag(&k, 36, 1.4);
        let f = staerkste_linie(&y, 9_600);
        let i = y.iter().position(|v| v.abs() > 1e-3).unwrap();
        println!("MESS preset {name}: Tune {soll:.2} Hz, strongest line {f:.3} Hz, peak {:.3}, first sample {:+.5}", spitze(&y), y[i]);
        assert!((f - soll).abs() < 0.15, "{name}: {f} against {soll}");
        assert!(spitze(&y) < 1.0 && y[i] > 0.0, "{name}");
        n += 1;
    }
    assert_eq!(n, 3, "three kick presets");
}
