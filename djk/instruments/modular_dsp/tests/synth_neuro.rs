//! `synth-neuro` (demos/synth-neuro.json, panel paneele/synth-neuro.json): the neuro / reese bass built on the wavefolder.
//! Rules 1 to 3 of the device rules with numbers: all knobs at 0.5 sound good and sit at the level of the recipes, the pitch
//! is exact (A1 = 55 Hz), the sub stays clean and mono, every filter type at every extreme stays finite, bounded and free of
//! DC, switching the filter type jumps at most 3 dB, legato and the note onset do not click, the new blocks and the motion
//! really act. Knobs 25..45 (synth build-out): the amp envelope times, a second oscillator, LFO 2, key follow, velocity, master tune,
//! delay and reverb. Every one of them is class G (zero effect at its default), N (the old value at its default) or F (free); the
//! default-state null against the old graph is proved by `measure_null.py run synth-neuro`, this file checks that each one acts,
//! stays finite and bounded at its corners and that the real-time path does not allocate.
//! Cost: `kosten_synth_neuro` (ignored, run under the real-time lock).
use baukasten_dsp::{uebersetze, Programm, REGLER};
use realfft::RealFftPlanner;
use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;

/// Counts the allocation requests of the calling thread, for the real-time check at the end (the tests of this file run in parallel).
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
const GRAPH: &str = include_str!("../demos/synth-neuro.json");
/// Knobs 1..45 are defined (44 is free: no reverb decay knob); 7 is the filter type: i / 6 for the seven types (comb, notch, band-pass,
/// low-pass, vowel, MS-20, diode)
const KNOEPFE: usize = 45;
const FREI: usize = 44;
/// The new knobs and their `vorgabe`: class G at 0 (bipolar 0.5), N at 0.5, F at a musical value (graph and panel agree)
const NEUE: [(usize, f32); 20] = [
    (25, 0.5), (26, 0.5), (27, 0.5),                            // amp attack, decay, sustain (N, `mitte` = the old 2 ms, 300 ms, 85 %)
    (28, 0.0), (29, 2.0 / 3.0), (30, 0.5), (31, 0.5),           // osc 2 level (G), wave saw, octave 0, detune 0
    (32, 0.615_689), (33, 0.0), (34, 0.0), (35, 0.0), (36, 0.5), // LFO 2 rate 2 Hz, shape sine, sync free, target cutoff, amount 0 (G)
    (37, 0.0),                                                  // key follow (G)
    (38, 0.0), (39, 0.5), (40, 0.5),                            // velocity depth (G), velocity to cutoff (G), master tune (G)
    (41, 0.794_603), (42, 0.388_889), (43, 0.0),                // delay time 375 ms, feedback 0.35, mix (G)
    (45, 0.0),                                                  // reverb mix (G)
];
const TYP: usize = 7;
const TYPEN: [&str; 7] = ["comb", "notch", "bandpass", "lowpass", "vowel", "ms20", "diode"];
const MITTE: usize = 3;

/// Every knob at its `vorgabe` (what a fresh instance and a preset without the new knobs start from), then `knoepfe` on top
fn lade(knoepfe: &[(usize, f32)]) -> Programm {
    let mut p = uebersetze(GRAPH, SR).expect("synth-neuro translates");
    p.setze_takt(0.0, 2.0 / SR as f64); // 120 BPM
    let v = p.regler_vorgaben();
    for nr in 1..=REGLER {
        p.setze_regler(nr, v[nr - 1]);
    }
    for &(nr, w) in knoepfe {
        p.setze_regler(nr, w);
    }
    p
}

/// Every knob at 0.5, the kern default of a knob without a `vorgabe` (the corner "all at 0.5")
fn lade_halb() -> Programm {
    let mut p = uebersetze(GRAPH, SR).expect("synth-neuro translates");
    p.setze_takt(0.0, 2.0 / SR as f64);
    for nr in 1..=REGLER {
        p.setze_regler(nr, 0.5);
    }
    p
}

fn typ(i: usize) -> f32 { i as f32 / 6.0 }

/// Notes as (midi, seconds); `legato` plays the next strike before the previous release, otherwise there is `luecke` seconds
/// of silence after each note. Returns the output and the strike times in samples.
fn spiele(p: &mut Programm, noten: &[(u8, f32)], legato: bool, luecke: f32, ausklang: f32) -> (Vec<(f32, f32)>, Vec<usize>) {
    let (mut y, mut schlaege) = (Vec::new(), Vec::new());
    let mut vor: Option<u8> = None;
    for &(n, d) in noten {
        schlaege.push(y.len());
        p.note_an(n, 0.8);
        if let (true, Some(v)) = (legato, vor) { p.note_aus(v); }
        y.extend((0..(d * SR) as usize).map(|_| p.sample_stereo()));
        if !legato {
            p.note_aus(n);
            y.extend((0..(luecke * SR) as usize).map(|_| p.sample_stereo()));
        }
        vor = Some(n);
    }
    p.alle_aus();
    y.extend((0..(ausklang * SR) as usize).map(|_| p.sample_stereo()));
    (y, schlaege)
}

fn mitte(y: &[(f32, f32)]) -> Vec<f64> { y.iter().map(|(l, r)| (*l as f64 + *r as f64) * 0.5).collect() }
fn spitze(y: &[(f32, f32)]) -> f32 { y.iter().fold(0.0, |m, (l, r)| m.max(l.abs()).max(r.abs())) }
fn rms_db(x: &[f64]) -> f64 { 10.0 * (x.iter().map(|v| v * v).sum::<f64>() / x.len().max(1) as f64).max(1e-18).log10() }
/// RMS in dBFS over the 50 ms blocks above -60 dBFS (what the convention lint calls the active frames)
fn aktiv_db(x: &[f64]) -> f64 {
    let a: Vec<f64> = x.chunks(2400).filter(|c| rms_db(c) > -60.0).flatten().cloned().collect();
    rms_db(&a)
}
fn dc_db(y: &[(f32, f32)]) -> f64 {
    let n = y.len() as f64;
    let (l, r) = y.iter().fold((0.0, 0.0), |a, (l, r)| (a.0 + *l as f64, a.1 + *r as f64));
    20.0 * (l / n).abs().max((r / n).abs()).max(1e-9).log10()
}

fn spektrum(x: &[f64], faktor: usize) -> Vec<f64> {
    let n = x.len() * faktor;
    let mut a: Vec<f64> = x.iter().enumerate().map(|(i, v)| v * (0.5 - 0.5 * (2.0 * std::f64::consts::PI * i as f64 / x.len() as f64).cos())).collect();
    a.resize(n, 0.0);
    let fft = RealFftPlanner::<f64>::new().plan_fft_forward(n);
    let mut s = fft.make_output_vec();
    fft.process(&mut a, &mut s).unwrap();
    s.iter().map(|c| c.norm_sqr()).collect()
}
/// width of one bin in Hz for a window of `len` samples zero-padded by `faktor`
fn bin_hz(faktor: usize, len: usize) -> f64 { SR as f64 / (len * faktor) as f64 }

/// Frequency of the strongest partial within +-10 % of `f`, parabola on the log spectrum.
fn spitzenfrequenz(x: &[f64], f: f64) -> f64 {
    let fk = 8;
    let p = spektrum(x, fk);
    let df = bin_hz(fk, x.len());
    let (lo, hi) = ((f * 0.9 / df) as usize, (f * 1.1 / df) as usize);
    let i = (lo..hi).max_by(|&a, &b| p[a].partial_cmp(&p[b]).unwrap()).unwrap();
    let (a, b, c) = (p[i - 1].ln(), p[i].ln(), p[i + 1].ln());
    (i as f64 + 0.5 * (a - c) / (a - 2.0 * b + c)) * df
}

/// Energy (dB) of the bins in [lo, hi) Hz of a window
fn band_db(x: &[f64], lo: f64, hi: f64) -> f64 {
    let p = spektrum(x, 1);
    let df = bin_hz(1, x.len());
    10.0 * p[(lo / df) as usize..(hi / df) as usize].iter().sum::<f64>().max(1e-30).log10()
}

#[test]
fn grundklang_alle_knoepfe_auf_0_5() {
    let p = lade(&[]);
    assert_eq!(p.stimmen, 1, "a mono legato bass");
    let mut namen: Vec<usize> = p.regler_namen.iter().map(|(n, _)| *n).collect();
    namen.sort();
    assert_eq!(namen, (1..=KNOEPFE).filter(|n| *n != FREI).collect::<Vec<_>>(), "knobs 1..45 but 44 are named");
    // the start position is the graph's `vorgabe`: knobs 1..24 have none (0.5), the new ones follow NEUE (restated here, the panel repeats it)
    let v = p.regler_vorgaben();
    for nr in 1..=24 { assert_eq!(v[nr - 1], 0.5, "knob {nr}"); }
    for (nr, soll) in NEUE { assert!((v[nr - 1] - soll).abs() < 1e-5, "knob {nr}: vorgabe {} not {soll}", v[nr - 1]); }
    assert_eq!(v[FREI - 1], 0.5, "the free knob has no node");
    // the probe of the convention lint: A2 C#3 E3 A3 one after the other, then as a chord (one voice: the last strike wins)
    let mut p = lade(&[]);
    let (mut y, _) = spiele(&mut p, &[(45, 0.5), (49, 0.5), (52, 0.5), (57, 0.5)], false, 0.0, 0.0);
    for n in [45u8, 49, 52, 57] { p.note_an(n, 0.8); }
    y.extend((0..72_000).map(|_| p.sample_stereo()));
    p.alle_aus();
    y.extend((0..72_000).map(|_| p.sample_stereo()));
    assert!(y.iter().all(|(l, r)| l.is_finite() && r.is_finite()) && p.rettungen == 0);
    let (sp, aktiv, dc) = (spitze(&y), aktiv_db(&mitte(&y)), dc_db(&y));
    println!("MESS default on the lint probe: peak {sp:.3}, active rms {aktiv:.1} dBFS, dc {dc:.1} dBFS");
    assert!(sp < 0.9, "{sp}");
    // the recipes (bass-reese, bass-wobble, wavetable-reese, ms20-bass, formant-neuro-bass) sit at -17 to -20 dBFS over the whole probe,
    // somewhat higher over the active frames
    assert!((-21.0..-13.0).contains(&aktiv), "{aktiv}");
    assert!(dc < -50.0, "{dc}");
    // the corner "all knobs at 0.5" (delay mix, reverb mix, osc 2, LFO 2 amount ... all half way, LFO 2 on the fold at 0.5 = the
    // pitch target): finite, nothing rescued, below the clip bound, no DC. It is a different sound from the default, not a quiet one.
    let mut p = lade_halb();
    let (y, _) = spiele(&mut p, &[(33, 1.0), (40, 0.6), (45, 0.6)], true, 0.0, 0.5);
    assert!(y.iter().all(|(l, r)| l.is_finite() && r.is_finite()) && p.rettungen == 0, "all at 0.5: not finite or rescued");
    let (sp, dc) = (spitze(&y), dc_db(&y));
    println!("MESS all knobs at 0.5: peak {sp:.3}, dc {dc:.1} dBFS");
    assert!(sp < 0.97 && dc < -50.0, "all at 0.5: peak {sp}, dc {dc}");
}

#[test]
fn stimmung_a1_ist_55_hz_bei_jedem_glide() {
    // sub only (cutoff, depth and fold at 0, crossover at its top so the dirt path is high-passed away): the strongest partial
    // is the sub. A1 = 55 Hz must be exact; the other notes ride along.
    for (note, soll) in [(28u8, 41.203_445f64), (33, 55.0), (40, 82.406_889), (45, 110.0)] {
        for glide in [0.0f32, 0.5, 1.0] {
            let mut p = lade(&[(1, 0.0), (2, 0.0), (4, 0.0), (20, 1.0), (23, glide)]);
            let (y, _) = spiele(&mut p, &[(note, 2.0)], false, 0.0, 0.1);
            let f = spitzenfrequenz(&mitte(&y)[(1.0 * SR) as usize..(1.9 * SR) as usize], soll);
            let cent = 1200.0 * (f / soll).log2();
            println!("MESS tuning note {note} glide {glide}: {f:.4} Hz for {soll:.4} ({cent:+.3} cent)");
            assert!(cent.abs() < 1.0, "note {note} glide {glide}: {cent:+.3} cent");
        }
    }
}

#[test]
fn jeder_filtertyp_bei_allen_knoepfen_0_und_1_bleibt_endlich_ohne_gleichanteil_unter_der_decke() {
    let (mut spitze_max, mut dc_max) = (0.0f32, -200.0f64);
    for t in 0..7 {
        for w in [0.0f32, 1.0] {
            let mut k: Vec<(usize, f32)> = (1..=KNOEPFE).map(|n| (n, w)).collect();
            k[TYP - 1] = (TYP, typ(t));
            let mut p = lade(&k);
            // A1, then legato up a fifth and an octave, then release
            let (y, _) = spiele(&mut p, &[(33, 1.0), (40, 0.6), (45, 0.6)], true, 0.0, 0.4);
            assert!(y.iter().all(|(l, r)| l.is_finite() && r.is_finite()), "{} all {w}: not finite", TYPEN[t]);
            assert_eq!(p.rettungen, 0, "{} all {w}: the guard rescued", TYPEN[t]);
            let (sp, dc) = (spitze(&y), dc_db(&y));
            spitze_max = spitze_max.max(sp);
            dc_max = dc_max.max(dc);
            assert!(sp < 0.97, "{} all {w}: peak {sp}", TYPEN[t]);
            assert!(dc < -50.0, "{} all {w}: DC {dc:.1} dBFS", TYPEN[t]);
        }
    }
    println!("MESS 7 types x (all knobs 0, all knobs 1): worst peak {spitze_max:.3}, worst DC {dc_max:.1} dBFS");
}

#[test]
fn filtertyp_umschaltung_springt_hoechstens_3_db() {
    for note in [33u8, 40, 45] {
        let pegel: Vec<f64> = (0..7).map(|t| {
            let mut p = lade(&[(TYP, typ(t))]);
            let (y, _) = spiele(&mut p, &[(note, 2.0)], false, 0.0, 0.2);
            aktiv_db(&mitte(&y))
        }).collect();
        let (lo, hi) = (pegel.iter().cloned().fold(f64::MAX, f64::min), pegel.iter().cloned().fold(f64::MIN, f64::max));
        println!("MESS note {note}: active rms by type {:?} dB, spread {:.2} dB", pegel.iter().map(|v| (v * 10.0).round() / 10.0).collect::<Vec<_>>(), hi - lo);
        assert!(hi - lo <= 3.0, "note {note}: spread {:.2} dB", hi - lo);
        assert!((pegel[MITTE] - lo) <= 3.0);
    }
}

#[test]
fn sub_bleibt_sauber_und_mittig() {
    // Worst case for the sub: crossover at its top (the mid layer sits closest to the sub), every dirt knob up, width up.
    // Measured on 1.4 s of a held A1: the energy between 20 and 100 Hz that is not the 55 Hz line, and side against mid below 100 Hz.
    let schlimm = [(20usize, 1.0f32), (4, 1.0), (5, 1.0), (15, 1.0), (6, 1.0), (21, 1.0), (9, 1.0), (17, 0.6), (2, 1.0)];
    let mut worst = (-200.0f64, -200.0f64);
    for t in 0..7 {
        let mut k = schlimm.to_vec();
        k.push((TYP, typ(t)));
        let mut p = lade(&k);
        let (y, _) = spiele(&mut p, &[(33, 2.5)], false, 0.0, 0.1);
        let seg = &y[(1.0 * SR) as usize..(2.4 * SR) as usize];
        let m = mitte(seg);
        let s: Vec<f64> = seg.iter().map(|(l, r)| (*l as f64 - *r as f64) * 0.5).collect();
        let (pm, ps) = (spektrum(&m, 1), spektrum(&s, 1));
        let df = bin_hz(1, m.len());
        let (b20, b100) = ((20.0 / df) as usize, (100.0 / df) as usize);
        let linie: f64 = (b20..b100).filter(|&b| (b as f64 * df - 55.0).abs() <= 3.0).map(|b| pm[b]).sum();
        let rest: f64 = (b20..b100).filter(|&b| (b as f64 * df - 55.0).abs() > 3.0).map(|b| pm[b]).sum();
        let neben = 10.0 * (rest / linie).log10();
        let seite = 10.0 * ((b20..b100).map(|b| ps[b]).sum::<f64>() / (b20..b100).map(|b| pm[b]).sum::<f64>()).log10();
        println!("MESS sub {:9}: non-55 Hz energy {neben:6.1} dB re the line, side/mid below 100 Hz {seite:6.1} dB", TYPEN[t]);
        worst = (worst.0.max(neben), worst.1.max(seite));
    }
    assert!(worst.0 < -40.0, "non-55 energy {:.1} dB", worst.0);
    assert!(worst.1 < -40.0, "side energy {:.1} dB", worst.1);
    // positive control: the sub alone (dirt path high-passed away) is clean to -75 dB and exactly mono
    let mut p = lade(&[(20, 1.0), (1, 0.0), (2, 0.0), (4, 0.0)]);
    let (y, _) = spiele(&mut p, &[(33, 2.5)], false, 0.0, 0.1);
    let m = mitte(&y[(1.0 * SR) as usize..(2.4 * SR) as usize]);
    let pm = spektrum(&m, 1);
    let df = bin_hz(1, m.len());
    let linie: f64 = pm[(52.0 / df) as usize..(58.0 / df) as usize].iter().sum();
    let rest: f64 = pm[(20.0 / df) as usize..(52.0 / df) as usize].iter().chain(&pm[(58.0 / df) as usize..(100.0 / df) as usize]).sum();
    println!("MESS sub alone: non-55 energy {:.1} dB", 10.0 * (rest / linie).log10());
    assert!(10.0 * (rest / linie).log10() < -75.0);
    let side: Vec<f64> = y[(1.0 * SR) as usize..(2.4 * SR) as usize].iter().map(|(l, r)| (*l as f64 - *r as f64) * 0.5).collect();
    let ps = spektrum(&side, 1);
    let seite = 10.0 * (ps[(20.0 / df) as usize..(100.0 / df) as usize].iter().sum::<f64>() / pm[(20.0 / df) as usize..(100.0 / df) as usize].iter().sum::<f64>()).log10();
    println!("MESS sub alone: side/mid below 100 Hz {seite:.1} dB");
    assert!(seite < -60.0, "the sub alone is mono: {seite:.1} dB");
}

#[test]
fn legato_und_einsatz_klicken_nicht() {
    // largest sample step right after a legato change (and right after a strike out of silence) against the steady 99.9th percentile
    let steady = |m: &[f64]| { let mut d: Vec<f64> = m.windows(2).map(|w| (w[1] - w[0]).abs()).collect(); d.sort_by(|a, b| a.partial_cmp(b).unwrap()); d[(d.len() as f64 * 0.999) as usize] };
    for (label, k) in [("default", vec![]), ("dirt max", vec![(4usize, 1.0f32), (5, 1.0), (15, 1.0), (17, 0.6), (9, 1.0)]), ("glide 0", vec![(23, 0.0)]), ("glide 1", vec![(23, 1.0)])] {
        let mut p = lade(&k);
        let (y, s) = spiele(&mut p, &[(33, 1.0), (40, 1.0), (38, 1.0)], true, 0.0, 0.3);
        let m = mitte(&y);
        let st = steady(&m[(0.5 * SR) as usize..(0.9 * SR) as usize]);
        let nach = |i: usize| m[i..i + 960].windows(2).map(|w| (w[1] - w[0]).abs()).fold(0.0, f64::max);
        let (a, b) = (nach(s[1]), nach(s[2]));
        println!("MESS legato {label}: steady p99.9 {st:.4}, max step after the two changes {a:.4} {b:.4}");
        assert!(a < 2.0 * st && b < 2.0 * st, "{label}: legato click");
        // out of silence
        let mut p = lade(&k);
        let (y, s) = spiele(&mut p, &[(33, 1.0), (40, 1.0)], false, 0.5, 0.3);
        let m = mitte(&y);
        let st = steady(&m[(0.5 * SR) as usize..(0.9 * SR) as usize]);
        let erste = m[s[1]..s[1] + 480].windows(2).map(|w| (w[1] - w[0]).abs()).fold(0.0, f64::max);
        println!("MESS onset {label}: first 10 ms max step {erste:.4} (steady {st:.4})");
        assert!(erste < st, "{label}: onset click");
    }
}

#[test]
fn wavefolder_und_bewegung_wirken() {
    // Fold knob: 0 (-6 dB: the fold is idle) against 1 (+30 dB) changes the energy above 1.6 kHz by a lot
    let hoch = |k: &[(usize, f32)]| {
        let mut p = lade(k);
        let (y, _) = spiele(&mut p, &[(33, 2.0)], false, 0.0, 0.1);
        band_db(&mitte(&y)[(0.5 * SR) as usize..(0.5 * SR) as usize + 16_384], 1600.0, 12_000.0)
    };
    // open filter (cutoff up) so the fold's brightness is not removed by the low-pass; sub off to keep the window about the dirt
    let (a, b) = (hoch(&[(1, 1.0), (2, 0.0), (4, 0.0), (8, 0.0), (11, 0.0), (10, 0.0), (12, 0.0)]), hoch(&[(1, 1.0), (2, 0.0), (4, 1.0), (8, 0.0), (11, 0.0), (10, 0.0), (12, 0.0)]));
    println!("MESS fold 0 vs 1 above 1.6 kHz: {a:.1} dB vs {b:.1} dB");
    assert!(b > a + 10.0, "the wavefolder must open the spectrum");
    // motion: level swing of the 500 Hz to 4 kHz band over 50 ms blocks, p95 - p5
    let swing = |k: &[(usize, f32)]| {
        let mut p = lade(k);
        let (y, _) = spiele(&mut p, &[(33, 2.0)], false, 0.0, 0.1);
        let m = mitte(&y);
        let mut v: Vec<f64> = (4..38).map(|i| band_db(&m[i * 2400..(i + 1) * 2400], 500.0, 4000.0)).collect();
        v.sort_by(|a, b| a.partial_cmp(b).unwrap());
        v[(v.len() as f64 * 0.95) as usize] - v[(v.len() as f64 * 0.05) as usize]
    };
    let (an, aus) = (swing(&[]), swing(&[(2, 0.0)]));
    println!("MESS band swing p95-p5: default {an:.1} dB, depth 0 {aus:.1} dB");
    assert!(an > 10.0 && aus < 6.0, "motion {an:.1} dB, depth 0 {aus:.1} dB");
    // the graph really contains the new block
    assert!(GRAPH.contains(r#""art": "falter""#));
}

/// Output of the standard feature probe: A1 for a second, a gap, E2 for 0.6 s, then 0.8 s of tail (delay and reverb tails count)
fn feature_probe(k: &[(usize, f32)]) -> Vec<(f32, f32)> {
    let mut p = lade(k);
    spiele(&mut p, &[(33, 1.0), (40, 0.6)], false, 0.2, 0.8).0
}

/// RMS of the difference of two outputs, dBFS
fn diff_db(a: &[(f32, f32)], b: &[(f32, f32)]) -> f64 {
    assert_eq!(a.len(), b.len());
    let q: f64 = a.iter().zip(b).map(|(x, y)| ((x.0 - y.0) as f64).powi(2) + ((x.1 - y.1) as f64).powi(2)).sum::<f64>() / (2 * a.len()) as f64;
    10.0 * q.max(1e-18).log10()
}

#[test]
fn jedes_neue_merkmal_wirkt_gegen_aus_um_mehr_als_minus_60_db() {
    // "off" = every knob at its vorgabe. Each case moves the named knobs; the difference to off must exceed -60 dBFS RMS.
    // LFO 2 target knob = option / 4 (cutoff, fold, pitch, drive, amp), amount knob 36 at 1 and 0 = +1 and -1.
    let mut faelle: Vec<(String, Vec<(usize, f32)>)> = vec![
        ("amp attack 1".into(), vec![(25, 1.0)]), ("amp decay 0".into(), vec![(26, 0.0)]), ("amp sustain 0".into(), vec![(27, 0.0)]),
        ("osc 2 level".into(), vec![(28, 0.8)]),
        ("key follow".into(), vec![(37, 1.0)]), ("velocity depth".into(), vec![(38, 1.0)]),
        ("velocity to cutoff +1".into(), vec![(39, 1.0)]), ("velocity to cutoff -1".into(), vec![(39, 0.0)]),
        ("master tune +1".into(), vec![(40, 1.0)]), ("master tune -1".into(), vec![(40, 0.0)]),
        ("delay mix".into(), vec![(43, 0.5)]), ("reverb mix".into(), vec![(45, 0.5)]),
    ];
    for (i, z) in ["cutoff", "fold", "pitch", "drive", "amp"].iter().enumerate() {
        for (w, tag) in [(1.0f32, "+1"), (0.0, "-1")] {
            faelle.push((format!("LFO 2 {z} {tag}"), vec![(35, i as f32 / 4.0), (36, w)]));
        }
    }
    let aus = feature_probe(&[]);
    let mut schwach = Vec::new();
    for (name, k) in &faelle {
        let an = feature_probe(k);
        assert!(an.iter().all(|(l, r)| l.is_finite() && r.is_finite()), "{name}: not finite");
        let d = diff_db(&aus, &an);
        println!("MESS on/off {name:24}: difference {d:6.1} dBFS rms");
        if d <= -60.0 { schwach.push(format!("{name}: {d:.1} dB")); }
    }
    assert!(schwach.is_empty(), "features that do not differ from off by more than -60 dB: {schwach:?}");
    // the off state is itself deterministic (positive control for the comparison)
    assert_eq!(diff_db(&aus, &feature_probe(&[])), -180.0);
}

#[test]
fn jeder_neue_knopf_bei_0_und_1_bleibt_endlich_ohne_gleichanteil_unter_der_decke() {
    // every new knob alone at 0 and at 1, the rest at its vorgabe, on legato notes (a wide pitch, so key follow reaches its bands);
    // the same with the sound dirty (fold, drive, resonance up) so a knob that adds gain meets a hot signal
    let schmutzig = [(4usize, 1.0f32), (5, 1.0), (9, 0.9), (15, 0.6)];
    let mut schlimm = (0.0f32, -200.0f64);
    for (nr, _) in NEUE {
        for w in [0.0f32, 1.0] {
            for dreck in [false, true] {
                let mut k: Vec<(usize, f32)> = if dreck { schmutzig.to_vec() } else { vec![] };
                k.push((nr, w));
                let mut p = lade(&k);
                let (y, _) = spiele(&mut p, &[(24, 0.8), (33, 0.6), (45, 0.6), (57, 0.6)], true, 0.0, 0.6);
                assert!(y.iter().all(|(l, r)| l.is_finite() && r.is_finite()), "knob {nr} = {w}: not finite");
                assert_eq!(p.rettungen, 0, "knob {nr} = {w}: the guard rescued");
                let (sp, dc) = (spitze(&y), dc_db(&y));
                schlimm = (schlimm.0.max(sp), schlimm.1.max(dc));
                assert!(sp < 0.97, "knob {nr} = {w} dirt {dreck}: peak {sp}");
                assert!(dc < -50.0, "knob {nr} = {w} dirt {dreck}: DC {dc:.1} dBFS");
            }
        }
    }
    println!("MESS 20 new knobs x (0, 1) x (clean, dirty): worst peak {:.3}, worst DC {:.1} dBFS", schlimm.0, schlimm.1);
}

#[test]
fn lfo_2_takt_1_4_bei_120_bpm_hat_die_periode_0_5_s_und_frei_ignoriert_das_tempo() {
    // LFO 2 on the amp of the sub alone (filter path high-passed away), sub up: the envelope of the output follows the LFO.
    // Sync knob 34: position 3 of 7 (= 3 / 6) is the quarter note: 1 beat = 0.5 s at 120 BPM.
    let basis = [(1usize, 0.0f32), (2, 0.0), (4, 0.0), (20, 1.0), (8, 1.0), (35, 1.0), (36, 1.0), (14, 0.5)];
    let periode = |sync: f32, bpm: f64| -> f64 {
        let mut k = basis.to_vec();
        k.push((34, sync));
        let mut p = lade(&k);
        p.setze_takt(0.0, bpm / 60.0 / SR as f64);
        let (y, _) = spiele(&mut p, &[(33, 6.0)], false, 0.0, 0.1);
        // quadrature demodulation at 55 Hz (the sub) over 100 ms windows (11 cycles of the 110 Hz ripple: it cancels), 1 point per ms
        let m = mitte(&y);
        let w = 4800usize;
        let om = 2.0 * std::f64::consts::PI * 55.0 / SR as f64;
        let (ci, cq): (Vec<f64>, Vec<f64>) = m.iter().enumerate().map(|(i, v)| (v * (om * i as f64).cos(), v * (om * i as f64).sin())).unzip();
        let mut hub = Vec::new();
        let (mut si, mut sq) = (ci[..w].iter().sum::<f64>(), cq[..w].iter().sum::<f64>());
        for i in (0..m.len() - w).step_by(48) {
            hub.push((si * si + sq * sq).sqrt() / w as f64);
            for j in i..(i + 48).min(m.len() - w) { si += ci[j + w] - ci[j]; sq += cq[j + w] - cq[j]; }
        }
        let (a, b) = (1500usize, 5500usize.min(hub.len()));
        let mittel = hub[a..b].iter().sum::<f64>() / (b - a) as f64;
        let hoch: Vec<f64> = (a + 1..b).filter(|&i| hub[i - 1] < mittel && hub[i] >= mittel).map(|i| i as f64 - (hub[i] - mittel) / (hub[i] - hub[i - 1])).collect();
        assert!(hoch.len() >= 3, "sync {sync} at {bpm} bpm: only {} crossings", hoch.len());
        (hoch[hoch.len() - 1] - hoch[0]) / (hoch.len() - 1) as f64 / 1000.0
    };
    let p120 = periode(3.0 / 6.0, 120.0);
    let p60 = periode(3.0 / 6.0, 60.0);
    println!("MESS LFO 2 1/4: period {p120:.4} s at 120 BPM, {p60:.4} s at 60 BPM");
    assert!((p120 - 0.5).abs() < 0.005, "period at 120 bpm: {p120}");
    assert!((p60 - 1.0).abs() < 0.01, "period at 60 bpm: {p60}");
    // Free ignores the tempo: the same output at 120 and at 60 BPM, bit for bit (depth 0 keeps the old synced LFO out of it)
    let frei = |bpm: f64| {
        let mut k = basis.to_vec();
        k.push((34, 0.0));
        let mut p = lade(&k);
        p.setze_takt(0.0, bpm / 60.0 / SR as f64);
        spiele(&mut p, &[(33, 2.0)], false, 0.0, 0.1).0
    };
    assert_eq!(frei(120.0), frei(60.0), "Free must not follow the tempo");
}

#[test]
fn echtzeitpfad_allokiert_nicht() {
    // notes, all 45 knobs moving (also the delay time and the target knob), all-off and reset while playing: no allocation request
    // (the translation does allocate: positive control)
    let vor = anforderungen();
    let mut p = lade(&[]);
    assert!(anforderungen() > vor, "positive control: the translation must allocate");
    let start = anforderungen();
    let mut summe = 0.0f32;
    for i in 0..96_000u32 {
        if i % 4000 == 0 { p.note_an(36 + (i / 4000 % 24) as u8, 0.7); }
        if i % 6000 == 0 { p.note_aus(36 + (i / 6000 % 24) as u8); }
        if i % 64 == 0 { p.setze_regler(1 + (i / 64) as usize % KNOEPFE, (i % 1000) as f32 / 1000.0); }
        if i % 50_000 == 0 { p.alle_aus(); }
        if i == 90_000 { p.zuruecksetzen(); }
        let (l, r) = p.sample_stereo();
        summe += l + r;
    }
    assert_eq!(anforderungen(), start, "the real-time path asked for memory");
    assert!(summe.is_finite());
}

/// Cost: 256-sample blocks, one voice per graph (synth-neuro is mono), p50 / p99 / p99.9 in microseconds, next to two existing
/// graphs for scale. Run only on request and under the real-time lock (see kosten_messung.rs):
///   . djk/config/realtime_lock.sh && flock "$CYPHERDJ_ECHTZEIT_SCHLOSS" cargo test --release -p baukasten_dsp --test synth_neuro -- --ignored --nocapture
#[test]
#[ignore]
fn kosten_synth_neuro() {
    use baukasten_dsp::Kosten;
    use std::time::Instant;
    let faelle: [(&str, &str, Vec<(usize, f32)>); 6] = [
        ("falter-demo (block alone, oversampled)", include_str!("../demos/falter-demo.json"), vec![]),
        ("synth-neuro default", GRAPH, vec![]),
        ("synth-neuro dirt max", GRAPH, vec![(4, 1.0), (5, 1.0), (15, 1.0), (17, 0.6)]),
        ("synth-neuro comb", GRAPH, vec![(TYP, 0.0)]),
        ("wavetable-reese (ref)", include_str!("../demos/wavetable-reese.json"), vec![]),
        ("formant-neuro-bass (ref)", include_str!("../demos/formant-neuro-bass.json"), vec![]),
    ];
    for (label, g, k) in faelle {
        let mut p = uebersetze(g, SR).unwrap();
        p.setze_takt(0.0, 2.0 / SR as f64);
        for &(nr, w) in &k { p.setze_regler(nr, w); }
        for n in 0..p.stimmen { p.note_an(33 + 3 * n as u8, 0.8); }
        for _ in 0..200 { for _ in 0..256 { std::hint::black_box(p.sample_stereo()); } }
        let mut kosten = Kosten::default();
        for _ in 0..4000 {
            let t = Instant::now();
            for _ in 0..256 { std::hint::black_box(p.sample_stereo()); }
            kosten.buche(t.elapsed().as_secs_f64() * 1e6);
        }
        let periode = 256.0 / SR as f64 * 1e6;
        println!("KOSTEN {label} ({} voices): p50 {:.0} us ({:.1} % of {periode:.0} us), p99 {:.0} us, p99.9 {:.0} us, max {:.0} us",
                 p.stimmen, kosten.quantil_us(0.5), kosten.quantil_us(0.5) / periode * 100.0, kosten.quantil_us(0.99), kosten.quantil_us(0.999), kosten.max_us);
    }
}
