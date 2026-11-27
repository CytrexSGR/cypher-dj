//! Cypher Modulation devices (demos/fx-tremolo.json, fx-chorus.json, fx-flanger-sync.json, fx-phaser-sync.json), built by `build_modulation.py`
//! from existing blocks. Pins per device: loads as a stereo effect with the known latency (0) and the 0.5 fill, finite and not silent at the
//! default knobs, Mix 0 returns the input, the device-specific behaviour, and no allocation in the real-time path after the load.
//! All four share the rate section: knob 1 `Rate mode` (index 0 Free, 1..7 note values 1/16 .. 4 bars), knob 2 `Rate` (Hz, Free only).
use baukasten_dsp::{uebersetze, Programm, REGLER};
use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;

mod common;

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
/// host tempo of the tests: 120 BPM = 2 beats per second
const BPS: f64 = 2.0 / SR as f64;
const TREMOLO: &str = include_str!("../demos/fx-tremolo.json");
const CHORUS: &str = include_str!("../demos/fx-chorus.json");
const FLANGER: &str = include_str!("../demos/fx-flanger-sync.json");
const PHASER: &str = include_str!("../demos/fx-phaser-sync.json");

/// knob value that selects Rate mode index `i` of 8 (a selector control writes i / (n - 1))
fn modus(i: usize) -> f32 { i as f32 / 7.0 }

fn lade(json: &str, k: &[(usize, f32)]) -> Programm {
    let mut p = uebersetze(json, SR).unwrap_or_else(|e| panic!("{e}"));
    p.setze_takt(0.0, BPS);
    for &(n, v) in k { p.setze_regler(n, v); }
    p
}

fn rauschen(n: usize, amp: f32) -> Vec<f32> {
    let mut s: u32 = 0x1234_5678;
    (0..n).map(|_| { s ^= s << 13; s ^= s >> 17; s ^= s << 5; amp * 2.0 * ((s as f32 / u32::MAX as f32) - 0.5) }).collect()
}

fn lauf(p: &mut Programm, x: &[f32]) -> Vec<(f32, f32)> {
    let y: Vec<(f32, f32)> = x.iter().map(|&v| { p.setze_eingang(v, -v); p.sample_stereo() }).collect();
    assert!(y.iter().all(|(l, r)| l.is_finite() && r.is_finite()) && p.rettungen == 0, "not finite or rescued");
    y
}

fn spitze(y: &[(f32, f32)]) -> f32 { y.iter().fold(0.0, |m, (l, r)| m.max(l.abs()).max(r.abs())) }

fn rms(y: &[(f32, f32)]) -> f32 { (y.iter().map(|(l, r)| l * l + r * r).sum::<f32>() / (2 * y.len()) as f32).sqrt() }

/// the shared checks of a device: load, 0.5 fill, names, latency, finite and audible at the defaults, Mix 0 returns the input, no allocation
fn grundpruefung(json: &str, name: &str, namen: &[&str], mix_nr: usize, latenz: usize) {
    let p = lade(json, &[]);
    assert!(p.hat_eingang(), "{name}: an effect graph");
    println!("MESS {name} latency {} samples", p.latenz());
    assert_eq!(p.latenz(), latenz);
    assert_eq!(p.regler_vorgaben(), [0.5f32; REGLER], "{name}: an insert graph keeps the 0.5 fill");
    let n: Vec<&str> = p.regler_namen.iter().map(|(_, s)| s.as_str()).collect();
    assert_eq!(n, namen);
    // default knobs on the shared music probe: audible, bounded, no DC
    let x = common::musik_probe();
    let mut q = lade(json, &[]);
    let y: Vec<(f32, f32)> = x.iter().map(|&v| { q.setze_eingang(v, v); q.sample_stereo() }).collect();
    assert!(y.iter().all(|(l, r)| l.is_finite() && r.is_finite()) && q.rettungen == 0);
    let db = 20.0 * rms(&y).max(1e-9).log10();
    println!("MESS {name} defaults: peak {:.3}, rms {db:.1} dB", spitze(&y));
    assert!(db > -60.0, "{name}: silent at the defaults ({db} dB)");
    assert!(spitze(&y) <= 0.9, "{name}: peak {} above 0.9 on the probe", spitze(&y));
    // Mix 0 returns the input, the sides separate (probe feeds l = v, r = -v)
    let x = rauschen(24_000, 0.7);
    let mut m = lade(json, &[(mix_nr, 0.0), (3, 1.0), (4, 1.0), (5, 1.0)]);
    let y = lauf(&mut m, &x);
    let fehler = (latenz..x.len()).fold(0.0f32, |f, i| f.max((y[i].0 - x[i - latenz]).abs()).max((y[i].1 + x[i - latenz]).abs()));
    println!("MESS {name} mix 0: largest deviation {fehler:e}");
    assert!(fehler < 1e-6, "{name}: mix 0 deviates by {fehler}");
    // positive control: with the Mix up the output is not the input
    let mut w = lade(json, &[(mix_nr, 1.0), (3, 1.0), (4, 1.0), (5, 1.0)]);
    let z = lauf(&mut w, &x);
    assert!((latenz..x.len()).fold(0.0f32, |f, i| f.max((z[i].0 - x[i - latenz]).abs())) > 0.05, "{name}: Mix 1 equals the input");
}

fn ohne_allokation(json: &str, name: &str) {
    let x = rauschen(96_000, 0.5);
    let vor = anforderungen();
    let mut p = lade(json, &[]);
    assert!(anforderungen() > vor, "positive control: the translation must allocate");
    let start = anforderungen();
    let mut summe = 0.0f32;
    for (i, v) in x.iter().enumerate() {
        let i = i as u32;
        if i % 64 == 0 { p.setze_regler(1 + (i / 64) as usize % 7, (i % 1000) as f32 / 1000.0); }
        if i == 90_000 { p.zuruecksetzen(); }
        p.setze_eingang(*v, *v);
        let (l, r) = p.sample_stereo();
        summe += l + r;
    }
    assert_eq!(anforderungen(), start, "{name}: the real-time path asked for memory");
    assert!(summe.is_finite());
}

// ------------------------------------------------------------------------------------------------------------------------ fx-tremolo
#[test]
fn tremolo_grundpruefung() {
    grundpruefung(TREMOLO, "fx-tremolo", &["Rate mode", "Rate", "Depth", "Shape", "Mode", "Mix"], 6, 0);
}

/// the gain per sample on a constant 0.5 input (both sides fed with +0.5)
fn tremolo_gewinne(k: &[(usize, f32)], n: usize) -> Vec<(f32, f32)> {
    let mut p = lade(TREMOLO, k);
    (0..n).map(|_| { p.setze_eingang(0.5, 0.5); let (l, r) = p.sample_stereo(); (l / 0.5, r / 0.5) }).collect()
}

#[test]
fn tremolo_minimum_alle_halbe_sekunde_bei_120_bpm_und_viertel() {
    // Rate mode 1/4 = one beat = 0.5 s = 24000 samples; Depth 1, Mix 1, Shape 0 (round), Tremolo mode
    let g = tremolo_gewinne(&[(1, modus(3)), (3, 1.0), (4, 0.0), (5, 0.0), (6, 1.0)], 5 * 24_000);
    let mut orte = Vec::new();
    for fenster in 0..4 {
        let a = 6_000 + fenster * 24_000;
        let (i, v) = g[a..a + 24_000].iter().enumerate().fold((0, f32::MAX), |m, (i, (l, _))| if *l < m.1 { (i, *l) } else { m });
        orte.push(a + i);
        assert!(v < 0.12, "window {fenster}: deepest gain {v}");
    }
    println!("MESS tremolo minima at samples {orte:?}");
    for w in orte.windows(2) {
        let abstand = (w[1] - w[0]) as f32;
        assert!((abstand - 24_000.0).abs() <= 240.0, "minimum spacing {abstand} (24000 +- 1 %)");
    }
    let hoch = g[..24_000].iter().fold(0.0f32, |m, (l, _)| m.max(*l));
    assert!(hoch > 0.9 && hoch <= 1.0 + 1e-6, "the gain peaks at {hoch}");
}

#[test]
fn tremolo_pan_laeuft_links_und_rechts_gegenphasig() {
    for (modus_wert, soll_gegen) in [(1.0f32, true), (0.0, false)] {
        let g = tremolo_gewinne(&[(1, modus(3)), (3, 1.0), (4, 0.5), (5, modus_wert), (6, 1.0)], 48_000);
        let n = g.len() as f32;
        let (ml, mr) = (g.iter().map(|v| v.0).sum::<f32>() / n, g.iter().map(|v| v.1).sum::<f32>() / n);
        let (mut sl, mut sr, mut sx) = (0.0f32, 0.0f32, 0.0f32);
        for (l, r) in &g { sl += (l - ml) * (l - ml); sr += (r - mr) * (r - mr); sx += (l - ml) * (r - mr); }
        let korr = sx / (sl * sr).sqrt();
        println!("MESS tremolo mode {modus_wert}: L/R gain correlation {korr:.4}");
        if soll_gegen { assert!(korr < -0.9, "pan: correlation {korr}"); } else { assert!(korr > 0.99, "tremolo: sides move together ({korr})"); }
    }
}

#[test]
fn tremolo_shape_macht_das_rechteck_und_depth_null_laesst_alles_durch() {
    let rund = tremolo_gewinne(&[(1, modus(3)), (3, 1.0), (4, 0.0), (5, 0.0), (6, 1.0)], 24_000);
    let eckig = tremolo_gewinne(&[(1, modus(3)), (3, 1.0), (4, 1.0), (5, 0.0), (6, 1.0)], 24_000);
    // share of samples within 0.05 of the top or bottom value: a square-ish wave spends most of its time on the two levels
    let rand = |g: &[(f32, f32)]| { let (lo, hi) = g.iter().fold((f32::MAX, f32::MIN), |m, (l, _)| (m.0.min(*l), m.1.max(*l))); g.iter().filter(|(l, _)| *l < lo + 0.05 || *l > hi - 0.05).count() as f32 / g.len() as f32 };
    println!("MESS tremolo shape: edge share round {:.2}, square {:.2}", rand(&rund), rand(&eckig));
    assert!(rand(&eckig) > 0.8 && rand(&rund) < 0.5);
    let still = tremolo_gewinne(&[(1, modus(3)), (3, 0.0), (6, 1.0)], 24_000);
    assert!(still.iter().all(|(l, r)| *l == 1.0 && *r == 1.0), "Depth 0 passes the input unchanged");
}

#[test]
fn tremolo_ohne_allokation() { ohne_allokation(TREMOLO, "fx-tremolo"); }

// ------------------------------------------------------------------------------------------------------------------------- fx-chorus
#[test]
fn chorus_grundpruefung() {
    grundpruefung(CHORUS, "fx-chorus", &["Rate mode", "Rate", "Depth", "Delay", "Width", "Mix"], 6, 0);
}

#[test]
fn chorus_ohne_tiefe_ist_der_eingang_um_genau_delay_verzoegert() {
    // Depth 0, Mix 1, Width 1: the output is the input delayed by Delay; knob 0.5 = 12 ms = 576 samples
    let x = rauschen(24_000, 0.6);
    let mut p = lade(CHORUS, &[(3, 0.0), (5, 1.0), (6, 1.0)]);
    let y = lauf(&mut p, &x);
    let beste = (0..1_000usize).map(|lag| (lag, (lag..x.len()).map(|i| y[i].0 * x[i - lag]).sum::<f32>())).fold((0, f32::MIN), |m, v| if v.1 > m.1 { v } else { m });
    println!("MESS chorus: cross-correlation peak at {} samples ({:.3} ms)", beste.0, beste.0 as f32 / 48.0);
    assert!((beste.0 as i64 - 576).abs() <= 1);
    let fehler = (576..x.len()).fold(0.0f32, |f, i| f.max((y[i].0 - x[i - 576]).abs()).max((y[i].1 + x[i - 576]).abs()));
    assert!(fehler < 1e-6, "not an exact delay: {fehler}");
    // Delay at both ends: 5 ms and 30 ms
    for (kn, ms) in [(0.0f32, 5usize), (1.0, 30)] {
        let mut q = lade(CHORUS, &[(3, 0.0), (4, kn), (5, 1.0), (6, 1.0)]);
        let z = lauf(&mut q, &x);
        let lag = ms * 48;
        let f = (lag..x.len()).fold(0.0f32, |f, i| f.max((z[i].0 - x[i - lag]).abs()));
        assert!(f < 1e-6, "Delay {ms} ms: {f}");
    }
}

#[test]
fn chorus_tiefe_und_breite_wirken() {
    let x = rauschen(48_000, 0.5);
    let nur = |k: &[(usize, f32)]| { let mut p = lade(CHORUS, k); lauf(&mut p, &x) };
    // Depth moves the delay: the output differs from the static one
    let (still, bewegt) = (nur(&[(3, 0.0), (5, 1.0), (6, 1.0)]), nur(&[(3, 0.5), (5, 1.0), (6, 1.0)]));
    assert!(still.iter().zip(&bewegt).any(|(a, b)| (a.0 - b.0).abs() > 0.05));
    // Width 0: both wet sides are the same signal. Feed the same signal on both sides (l = r = v): the sides still differ at Width 1
    // because the right modulator runs a quarter period behind
    let gleich = |k: &[(usize, f32)]| { let mut p = lade(CHORUS, k); x.iter().map(|&v| { p.setze_eingang(v, v); p.sample_stereo() }).collect::<Vec<_>>() };
    let mono = gleich(&[(3, 0.5), (5, 0.0), (6, 1.0)]);
    assert!(mono.iter().all(|(l, r)| (l - r).abs() < 1e-6) && rms(&mono) > 0.05, "Width 0 is not mono");
    let breit = gleich(&[(3, 0.5), (5, 1.0), (6, 1.0)]);
    let unterschied = breit.iter().fold(0.0f32, |m, (l, r)| m.max((l - r).abs()));
    println!("MESS chorus width 1: largest L-R difference {unterschied:.3}");
    assert!(unterschied > 0.05, "Width 1 should differ between the sides");
}

#[test]
fn chorus_ohne_allokation() { ohne_allokation(CHORUS, "fx-chorus"); }

// ------------------------------------------------------------------------------------------------------------------- fx-flanger-sync
#[test]
fn flanger_grundpruefung() {
    grundpruefung(FLANGER, "fx-flanger-sync", &["Rate mode", "Rate", "Depth", "Manual", "Feedback", "Mix"], 6, 0);
}

#[test]
fn flanger_bleibt_bei_voller_rueckkopplung_unter_der_decke() {
    // -6 dBFS noise, Mix 0.5: Feedback at both ends (+0.9 and -0.9), several Manual and Depth settings, free and synced
    let x = rauschen(96_000, 0.5);
    let mut hoechste = 0.0f32;
    for fb in [1.0f32, 0.0] {
        for (tiefe, hand, modus_wert) in [(0.0f32, 0.0f32, 0.0f32), (0.4, 0.1, modus(3)), (1.0, 0.5, modus(2)), (0.0, 1.0, modus(0))] {
            let mut p = lade(FLANGER, &[(1, modus_wert), (3, tiefe), (4, hand), (5, fb), (6, 0.5)]);
            let y = lauf(&mut p, &x);
            let s = spitze(&y);
            hoechste = hoechste.max(s);
            assert!(s < 0.9, "feedback {fb} depth {tiefe} manual {hand}: peak {s}");
            assert!(rms(&y) > 0.05, "silent");
        }
    }
    println!("MESS flanger-sync: highest peak over the corners {hoechste:.3}");
}

#[test]
fn flanger_manual_stellt_den_kamm_ein() {
    // Depth 0, Feedback 0, Mix 1: a pure delay of Manual; knob 0.5 = 1 ms = 48 samples. Feedback 0 sits at knob 0.9 / 1.4 * 0.5 (the lower half
    // of the knob runs -0.9 .. 0.5 through `mitte`), so the tolerance covers the float mapping
    let x = rauschen(24_000, 0.6);
    let mut p = lade(FLANGER, &[(3, 0.0), (5, 0.9 / 1.4 * 0.5), (6, 1.0)]);
    let y = lauf(&mut p, &x);
    let fehler = (48..x.len()).fold(0.0f32, |f, i| f.max((y[i].0 - x[i - 48]).abs()));
    println!("MESS flanger-sync manual 0.5: deviation from a 48 sample delay {fehler:e}");
    assert!(fehler < 1e-4, "Manual {fehler}");
}

#[test]
fn flanger_ohne_allokation() { ohne_allokation(FLANGER, "fx-flanger-sync"); }

// --------------------------------------------------------------------------------------------------------------------- fx-phaser-sync
#[test]
fn phaser_grundpruefung() {
    grundpruefung(PHASER, "fx-phaser-sync", &["Rate mode", "Rate", "Low", "Range", "Feedback", "Mix", "Stereo"], 6, 0);
}

/// power spectrum of 24000 samples (Hann window), smoothed over 15 bins (30 Hz); index = bin = 2 Hz
fn leistung(x: &[f32]) -> Vec<f32> {
    use realfft::RealFftPlanner;
    let n = x.len();
    let mut ein: Vec<f32> = x.iter().enumerate().map(|(i, v)| v * (0.5 - 0.5 * (std::f32::consts::TAU * i as f32 / n as f32).cos())).collect();
    let fft = RealFftPlanner::<f32>::new().plan_fft_forward(n);
    let mut aus = fft.make_output_vec();
    fft.process(&mut ein, &mut aus).unwrap();
    let p: Vec<f32> = aus.iter().map(|c| c.norm_sqr()).collect();
    (0..p.len()).map(|i| { let (a, b) = (i.saturating_sub(7), (i + 8).min(p.len())); p[a..b].iter().sum::<f32>() / (b - a) as f32 }).collect()
}

#[test]
fn phaser_kerbe_zwischen_low_und_dem_ende_des_hubs() {
    // Mix 0.5, Feedback 0, Rate mode Free at 0.05 Hz (period 20 s): after 5 s the sine sits on its top, so the sweep stands at Low * 2^(Range / 12)
    // for the 0.5 s that are measured. Low 300 Hz (knob 0.5), Range 36 st (knob 0.5): the sweep ends at 2400 Hz. Eight poles at 2400 Hz put the notches
    // at 2400 * tan(11.25, 33.75, 56.25, 78.75 degrees) = 478, 1603, 3593 and 12072 Hz; two of them lie between 300 and 2400 Hz.
    let mut p = lade(PHASER, &[(1, 0.0), (2, 0.0), (3, 0.5), (4, 0.5), (5, 0.0), (6, 0.5)]);
    let x = rauschen(240_000 + 24_000, 0.5);
    let y: Vec<f32> = x.iter().map(|&v| { p.setze_eingang(v, v); p.sample_stereo().0 }).collect();
    let (ein, aus) = (leistung(&x[240_000..]), leistung(&y[240_000..]));
    let bin = |hz: f32| (hz / 2.0) as usize;
    let db: Vec<f32> = (0..ein.len()).map(|i| 10.0 * (aus[i] / ein[i].max(1e-20)).max(1e-12).log10()).collect();
    let (tief, ort) = (bin(300.0)..bin(2400.0)).fold((0.0f32, 0usize), |m, i| if db[i] < m.0 { (db[i], i) } else { m });
    let hoch = (bin(300.0)..bin(2400.0)).fold(f32::MIN, |m, i| m.max(db[i]));
    println!("MESS phaser-sync: deepest notch {tief:.1} dB at {} Hz, passband peak {hoch:.1} dB", ort * 2);
    assert!(tief <= -15.0, "notch only {tief} dB deep");
    assert!(hoch > -3.0, "the passband is attenuated everywhere ({hoch} dB)");
    assert!(ort * 2 >= 300 && ort * 2 <= 2400);
}

#[test]
fn phaser_ecken_bleiben_endlich_und_unter_der_decke() {
    let x = rauschen(96_000, 0.5);
    let mut hoechste = 0.0f32;
    for fb in [0.0f32, 1.0] {
        for (low, range) in [(0.0f32, 1.0f32), (1.0, 1.0), (0.5, 0.0)] {
            let mut p = lade(PHASER, &[(1, modus(3)), (3, low), (4, range), (5, fb), (6, 0.5)]);
            let y = lauf(&mut p, &x);
            hoechste = hoechste.max(spitze(&y));
            assert!(rms(&y) > 0.05);
        }
    }
    println!("MESS phaser-sync: highest peak over the corners at Mix 0.5 on a -6 dBFS input {hoechste:.3}");
    assert!(hoechste < 1.0, "corner peak {hoechste}");
}

#[test]
fn phaser_stereo_waehlt_den_rechten_hub() {
    let x = rauschen(48_000, 0.4);
    let gleich = |st: f32| { let mut p = lade(PHASER, &[(1, modus(3)), (5, 0.0), (6, 0.5), (7, st)]); x.iter().map(|&v| { p.setze_eingang(v, v); p.sample_stereo() }).collect::<Vec<_>>() };
    let (same, quarter) = (gleich(0.0), gleich(1.0));
    assert!(same.iter().all(|(l, r)| l == r), "Stereo Same: the sides are identical");
    assert!(quarter.iter().any(|(l, r)| (l - r).abs() > 0.02), "Stereo Quarter: the sides differ");
}

#[test]
fn phaser_ohne_allokation() { ohne_allokation(PHASER, "fx-phaser-sync"); }

// ---------------------------------------------------------------------------------------------------------------------- all four
#[test]
fn jeder_regler_aendert_die_probe_ausser_der_freien_rate() {
    // the mechanical form of the sweep in beispiele_konvention.rs: knob 0 against 1, the others at the 0.5 fill, on the shared music probe.
    // Knob 2 (free Rate) is dead by design while Rate mode sits on the 0.5 fill (a synced position); with Rate mode Free it must act.
    let x = common::musik_probe();
    let probe = |json: &str, k: &[(usize, f32)]| { let mut p = lade(json, k); x.iter().map(|&v| { p.setze_eingang(v, v); p.sample_stereo() }).collect::<Vec<_>>() };
    for (name, json, knoepfe) in [("fx-tremolo", TREMOLO, 6), ("fx-chorus", CHORUS, 6), ("fx-flanger-sync", FLANGER, 6), ("fx-phaser-sync", PHASER, 7)] {
        for nr in 1..=knoepfe {
            let (a, b) = (probe(json, &[(nr, 0.0)]), probe(json, &[(nr, 1.0)]));
            let d = a.iter().zip(&b).fold(0.0f32, |m, (p, q)| m.max((p.0 - q.0).abs()).max((p.1 - q.1).abs()));
            println!("MESS sweep {name} knob {nr}: {d:.4}");
            if nr == 2 { assert_eq!(d, 0.0, "{name}: the free Rate is not read in a synced mode"); } else { assert!(d > 0.0, "{name}: knob {nr} is dead"); }
        }
        let (a, b) = (probe(json, &[(1, 0.0), (2, 0.0)]), probe(json, &[(1, 0.0), (2, 1.0)]));
        assert!(a.iter().zip(&b).any(|(p, q)| (p.0 - q.0).abs() > 1e-3), "{name}: Rate does nothing in Free");
    }
}
