//! `synth-poly` (demos/synth-poly.json): the poly synthesizer with unison. Pins the device rules with numbers:
//! the default sound (every knob at its `vorgabe`, and every knob at 0.5), the extreme settings, the build-out knobs 29..57 (second oscillator,
//! MOD ENV, LFO 2, velocity depth, glide, tuning: each one audible, each one at both corners, the beat of oscillator 2, the LFO 2 sync), the three filter types against each other, the tuning
//! of the unison stack (A4 = 440 Hz, copy spacing, copy count), the note onset and the cost. Prints the table with `--nocapture`.
//! The cost test is `#[ignore]`d (it needs a quiet machine): `cargo test --release -p baukasten_dsp --test synth_poly -- --ignored --nocapture`.
use baukasten_dsp::{uebersetze, Programm};
use realfft::RealFftPlanner;
use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;

/// Counts the allocation requests of the calling thread, for the real-time check at the end (the tests of this file run in parallel,
/// so a global counter would see the other tests).
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
const GRAPH: &str = include_str!("../demos/synth-poly.json");
const AKKORD: [u8; 4] = [45, 49, 52, 57];
/// The knobs of the build-out: 45, 52, 53 and 58..63 stay free (row 45 reserved, 52/53 dropped with the cost tier, 58..63 are the channel effects').
const NEUE: [usize; 26] = [29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 46, 47, 48, 49, 50, 51, 54, 55, 56, 57];

fn lade() -> Programm { uebersetze(GRAPH, SR).unwrap() }

fn setze(p: &mut Programm, k: &[(usize, f32)]) {
    for (nr, v) in k {
        p.setze_regler(*nr, *v);
    }
}

/// Hold `noten` for `s` seconds, stereo output.
fn halte(p: &mut Programm, noten: &[u8], vel: f32, s: f32) -> Vec<(f32, f32)> {
    for n in noten {
        p.note_an(*n, vel);
    }
    let y: Vec<(f32, f32)> = (0..(s * SR) as usize).map(|_| p.sample_stereo()).collect();
    assert!(y.iter().all(|(l, r)| l.is_finite() && r.is_finite()), "not finite");
    y
}

fn db(x: f64) -> f64 { 20.0 * x.max(1e-9).log10() }
fn rms(y: &[(f32, f32)]) -> f64 { (y.iter().map(|(l, r)| (*l as f64).powi(2) + (*r as f64).powi(2)).sum::<f64>() / (2 * y.len()) as f64).sqrt() }
fn spitze(y: &[(f32, f32)]) -> f32 { y.iter().fold(0.0, |m, (l, r)| m.max(l.abs()).max(r.abs())) }
fn dc(y: &[(f32, f32)]) -> f64 { let n = y.len() as f64; (y.iter().map(|v| v.0 as f64).sum::<f64>() / n).abs().max((y.iter().map(|v| v.1 as f64).sum::<f64>() / n).abs()) }
/// RMS of (L+R)/2 against the RMS of the two sides, in dB: 0 for identical sides, -3 for uncorrelated ones.
fn mono_gegen_stereo(y: &[(f32, f32)]) -> f64 {
    let m: Vec<(f32, f32)> = y.iter().map(|(l, r)| ((l + r) / 2.0, (l + r) / 2.0)).collect();
    db(rms(&m)) - db(rms(y))
}

/// The probe of the offline renderer: chord of A2 C#3 E3 A3 at velocity 0.8; (the last 1 s of 2.5 s, stereo output).
fn akkord(p: &mut Programm) -> Vec<(f32, f32)> {
    let y = halte(p, &AKKORD, 0.8, 2.5);
    assert_eq!(p.rettungen, 0, "rescued");
    y[(1.5 * SR) as usize..].to_vec()
}

#[test]
fn grundklang_alle_regler_auf_halb() {
    let mut p = lade();
    assert_eq!(p.regler_namen.len(), 54, "28 old knobs + 26 of the build-out (29..44, 46..51, 54..57)");
    // the default sound is the graph's own `vorgabe` start (knob 28 Drift 0.25, the build-out knobs at their off positions)
    let y = akkord(&mut p);
    let (r, s, d, m) = (db(rms(&y)), spitze(&y), dc(&y), mono_gegen_stereo(&y));
    let breite = db(rms(&y.iter().map(|(l, r)| ((l - r) / 2.0, 0.0)).collect::<Vec<_>>()) * 2f64.sqrt()) - db(rms(&y));
    println!("MESS default chord: rms {r:.1} dB, peak {s:.3}, dc {:.1} dBFS, mono/stereo {m:.1} dB, side/total {breite:.1} dB", db(d));
    assert!((-21.0..-14.0).contains(&r), "level like the recipes (lead-supersaw -17.9 dB, juno-pad -19.9 dB): {r}");
    assert!(s < 0.9, "peak {s}");
    assert!(db(d) < -50.0, "dc {} dBFS", db(d));
    assert!(m > -3.0, "mono sum falls {m} dB below the stereo level");
    assert!(breite > -20.0, "the unison is not wide: side/total {breite} dB");
}

#[test]
fn extreme_stellungen_clippen_nicht() {
    // all knobs 0, all knobs 1, and each filter type with full resonance at an open and a closed cutoff; the chord is held 4 s
    // (the whole run counts: attack and release are part of the extremes)
    let mut faelle: Vec<(String, Vec<(usize, f32)>)> = vec![
        ("all 0".into(), (1..=27).map(|n| (n, 0.0)).chain([(28, 0.0)]).collect()),   // 28 = Drift: 0 is the sound from before the knob
        ("all 1".into(), (1..=27).map(|n| (n, 1.0)).chain([(28, 0.0)]).collect()),
    ];
    for (typ, name) in [(0.0, "ladder"), (0.5, "sem"), (1.0, "diode")] {
        for (cut, c) in [(0.1, "closed"), (0.9, "open")] {
            faelle.push((format!("{name} reso 1 cutoff {c}"), vec![(8, typ), (2, 1.0), (1, cut)]));
        }
    }
    let mut schlimmster = 0.0f32;
    for (name, k) in &faelle {
        let mut p = lade();
        setze(&mut p, k);
        let y = halte(&mut p, &AKKORD, 0.8, 4.0);
        let (s, d) = (spitze(&y), dc(&y));
        println!("MESS extreme {name:28}: peak {s:.3}, dc {:.1} dBFS, rms {:.1} dB", db(d), db(rms(&y)));
        assert!(s < 1.0, "{name}: the chord clips ({s})");
        assert!(db(d) < -50.0, "{name}: dc {} dBFS", db(d));
        schlimmster = schlimmster.max(s);
    }
    println!("MESS extreme worst peak {schlimmster:.3}");
}

#[test]
fn drift_am_anschlag_bleibt_im_rahmen() {
    // Drift 1 moves the cutoff by up to 8 %, which shifts a resonance peak over the harmonics: with every other knob at 1 the
    // peak can pass 1.0 by a few percent (no limiter after the chorus). It must stay finite and under 1.25. The build-out knobs
    // (29..57) sit at their extremes too: all at 1, all at 0, and alternating. These cases may reach 1.5 (not 1.25): the soft limit of a voice
    // (`grenze`) keeps four voices below 1.6 before the chorus whatever the knobs do, and Velocity depth 2x drives them into it (0.8 * 2 on
    // the velocity term is +3.8 dB on a chord that already peaks at 1.11 with Drift and all the old knobs at 1).
    let alt: Vec<(usize, f32)> = NEUE.iter().enumerate().map(|(i, n)| (*n, (i % 2) as f32)).collect();
    for (name, neu) in [("new at 1", NEUE.iter().map(|n| (*n, 1.0)).collect::<Vec<_>>()), ("new at 0", NEUE.iter().map(|n| (*n, 0.0)).collect()), ("new alternating", alt)] {
        let mut k: Vec<(usize, f32)> = (1..=28).map(|n| (n, 1.0)).collect();
        k.extend(neu);
        let mut p = lade();
        setze(&mut p, &k);
        let y = halte(&mut p, &AKKORD, 0.8, 4.0);
        println!("MESS drift 1 and all 1, {name}: peak {:.3}, dc {:.1} dBFS", spitze(&y), db(dc(&y)));
        assert!(y.iter().all(|v| v.0.is_finite() && v.1.is_finite()) && p.rettungen == 0);
        assert!(spitze(&y) < 1.5, "{name}: peak {}", spitze(&y));
    }
    let k: Vec<(usize, f32)> = (1..=28).map(|n| (n, 1.0)).collect();
    let mut p = lade();
    setze(&mut p, &k);
    let y = halte(&mut p, &AKKORD, 0.8, 4.0);
    println!("MESS drift 1 and all 1: peak {:.3}", spitze(&y));
    assert!(y.iter().all(|v| v.0.is_finite() && v.1.is_finite()) && p.rettungen == 0);
    assert!(spitze(&y) < 1.25, "peak {}", spitze(&y));
}

#[test]
fn filtertypen_gleich_laut() {
    // the type switch must not jump more than about 3 dB at the default
    let pegel: Vec<f64> = [0.0, 0.5, 1.0].iter().map(|t| {
        let mut p = lade();
        p.setze_regler(8, *t);
        db(rms(&akkord(&mut p)))
    }).collect();
    println!("MESS type levels (ladder, SEM, diode): {:.1} {:.1} {:.1} dB", pegel[0], pegel[1], pegel[2]);
    let (lo, hi) = pegel.iter().fold((f64::MAX, f64::MIN), |(a, b), v| (a.min(*v), b.max(*v)));
    assert!(hi - lo < 3.0, "spread {} dB", hi - lo);
}

/// Power spectrum of the mono sum of `y` (Hann), bin width SR / n. Returns (frequency, dB) peaks between `von` and `bis` Hz
/// that stand within 20 dB of the strongest, refined by parabolic interpolation.
fn spitzen(y: &[(f32, f32)], von: f32, bis: f32) -> Vec<(f32, f32)> {
    let n = y.len();
    let mut ein: Vec<f32> = y.iter().enumerate().map(|(i, (l, r))| 0.5 * (l + r) * (0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / n as f32).cos())).collect();
    let fft = RealFftPlanner::<f32>::new().plan_fft_forward(n);
    let mut aus = fft.make_output_vec();
    fft.process(&mut ein, &mut aus).unwrap();
    let pw: Vec<f32> = aus.iter().map(|c| 10.0 * (c.norm_sqr() + 1e-20).log10()).collect();
    let (a, b) = ((von * n as f32 / SR) as usize, (bis * n as f32 / SR) as usize);
    let max = pw[a..b].iter().cloned().fold(f32::MIN, f32::max);
    (a + 1..b - 1).filter(|&i| pw[i] > pw[i - 1] && pw[i] >= pw[i + 1] && pw[i] > max - 20.0).map(|i| {
        let (l, m, r) = (pw[i - 1], pw[i], pw[i + 1]);
        let d = 0.5 * (l - r) / (l - 2.0 * m + r);
        ((i as f32 + d) * SR / n as f32, m)
    }).collect()
}

/// A single A4 with the filter open and everything but the saw stack off: Detune, Voices and the rest as given.
fn a4(k: &[(usize, f32)]) -> Vec<(f32, f32)> {
    let mut p = lade();
    // cutoff and HP open/low, no resonance, no envelope amount, no pulse/sub/noise, no LFO, no chorus, mix at its default
    setze(&mut p, &[(1, 1.0), (2, 0.0), (3, 0.0), (7, 0.0), (12, 0.0), (14, 0.0), (15, 0.0), (16, 0.0), (24, 0.0), (25, 0.0), (26, 0.0), (20, 1.0), (28, 0.0)]);
    setze(&mut p, k);
    let y = halte(&mut p, &[69], 0.8, 4.0);
    y[(1.0 * SR) as usize..(1.0 * SR) as usize + 131_072].to_vec()
}

fn cent(f: f32) -> f32 { 1200.0 * (f / 440.0).log2() }

#[test]
fn stimmung_a4_und_kopienabstand() {
    // Detune at 1 = outer pair at +-50 cent; the pairs sit at 1, 0.5716 and 0.1774 of it (the JP-8000 spacing)
    let soll = [-50.0, -28.58, -8.87, 0.0, 8.87, 28.58, 50.0];
    let sp = spitzen(&a4(&[(4, 1.0), (9, 1.0)]), 400.0, 480.0);
    let c: Vec<f32> = sp.iter().map(|(f, _)| cent(*f)).collect();
    println!("MESS unison peaks (cent): {c:.2?} at {:.1?} dB", sp.iter().map(|p| p.1).collect::<Vec<_>>());
    assert_eq!(c.len(), 7, "seven copies must show as seven peaks: {c:?}");
    for (ist, soll) in c.iter().zip(soll) {
        assert!((ist - soll).abs() < 1.0, "copy at {ist} cent, expected {soll}");
    }
    // the mean pitch of the stack is A4: power-weighted mean of the peaks
    let (s, w) = sp.iter().fold((0.0f32, 0.0f32), |(s, w), (f, db)| { let p = 10f32.powf(db / 10.0); (s + p * cent(*f), w + p) });
    println!("MESS mean pitch of the stack: {:.2} cent", s / w);
    assert!((s / w).abs() < 1.5, "mean pitch {} cent off A4", s / w);
    // Detune 0: one peak, exactly at 440 Hz
    let eins = spitzen(&a4(&[(4, 0.0)]), 400.0, 480.0);
    println!("MESS detune 0: {eins:.3?}");
    assert!(eins.iter().any(|(f, _)| (f - 440.0).abs() < 0.05), "no peak at 440.0 Hz: {eins:?}");
    // Voices 3 / 5 / 7 give 3 / 5 / 7 copies
    for (stellung, n) in [(0.0, 3), (0.5, 5), (1.0, 7)] {
        let k = spitzen(&a4(&[(4, 1.0), (9, stellung)]), 400.0, 480.0).len();
        assert_eq!(k, n, "Voices {stellung}: {k} peaks");
    }
}

#[test]
fn noteneinsatz_ohne_klick() {
    // shortest attack, one note: the largest sample step in the first 20 ms stays within 1.5 times the largest step after that
    let mut p = lade();
    setze(&mut p, &[(5, 0.0), (7, 0.0)]);
    let y = halte(&mut p, &[57], 0.8, 0.5);
    let schritt = |a: usize, b: usize| (a + 1..b).map(|i| (y[i].0 - y[i - 1].0).abs()).fold(0.0f32, f32::max);
    let (anfang, danach) = (schritt(0, 960), schritt(960, y.len()));
    println!("MESS onset: largest step {anfang:.4} in the first 20 ms, {danach:.4} afterwards");
    assert!(anfang < 1.5 * danach, "click at the onset: {anfang} against {danach}");
}

#[test]
fn echtzeitpfad_allokiert_nicht() {
    // notes, all 57 knobs moving, all-off and reset while playing: no allocation request (the translation does allocate: positive control)
    let vor = anforderungen();
    let mut p = lade();
    assert!(anforderungen() > vor, "positive control: the translation must allocate");
    let start = anforderungen();
    let mut summe = 0.0f32;
    for i in 0..96_000u32 {
        if i % 4000 == 0 { p.note_an(36 + (i / 4000 % 24) as u8, 0.7); }
        if i % 6000 == 0 { p.note_aus(36 + (i / 6000 % 24) as u8); }
        if i % 64 == 0 { p.setze_regler(1 + (i / 64) as usize % 57, (i % 1000) as f32 / 1000.0); }
        if i % 50_000 == 0 { p.alle_aus(); }
        if i == 90_000 { p.zuruecksetzen(); }
        let (l, r) = p.sample_stereo();
        summe += l + r;
    }
    assert_eq!(anforderungen(), start, "the real-time path asked for memory");
    assert!(summe.is_finite());
}

/// RMS of the difference of two renders in dBFS (both sides).
fn diff_db(a: &[(f32, f32)], b: &[(f32, f32)]) -> f64 {
    assert_eq!(a.len(), b.len());
    let d: Vec<(f32, f32)> = a.iter().zip(b).map(|(x, y)| (x.0 - y.0, x.1 - y.1)).collect();
    db(rms(&d))
}

/// The chord held for 1 s, released, 1.5 s of tail (so release times and envelope attacks both show), at velocity `vel`.
fn akkord_mit_ende(k: &[(usize, f32)], vel: f32) -> Vec<(f32, f32)> {
    let mut p = lade();
    setze(&mut p, k);
    let mut y = halte(&mut p, &AKKORD, vel, 1.0);
    for n in AKKORD { p.note_aus(n); }
    y.extend((0..(1.5 * SR) as usize).map(|_| p.sample_stereo()));
    assert!(y.iter().all(|(l, r)| l.is_finite() && r.is_finite()) && p.rettungen == 0);
    y
}

/// Glide needs a voice that played before: eight notes, all released, eight other notes (every voice sounds a new pitch from its old one).
fn zwei_akkorde(k: &[(usize, f32)]) -> Vec<(f32, f32)> {
    let mut p = lade();
    setze(&mut p, k);
    let erste = [33u8, 37, 40, 45, 49, 52, 57, 61];
    let zweite = [35u8, 39, 42, 47, 51, 54, 59, 63];
    let _ = halte(&mut p, &erste, 0.8, 0.6);
    p.alle_aus();
    let _ = halte(&mut p, &[], 0.8, 0.3);
    halte(&mut p, &zweite, 0.8, 0.8)
}

/// Every build-out knob with the gate that makes it audible, 0 against 1 (the other knobs at their `vorgabe`): the output differs by more than -60 dBFS RMS.
/// Knob 54 (glide) is checked by its own test with the voice reuse it needs.
const NEUE_MIT_TOR: &[(usize, &[(usize, f32)])] = &[
    (29, &[]), (30, &[]),
    (31, &[(37, 1.0)]), (32, &[(37, 1.0)]), (33, &[(37, 1.0)]), (34, &[(37, 1.0)]),
    (35, &[]), (36, &[(12, 0.8)]), (37, &[]), (38, &[(46, 1.0)]),
    (39, &[(43, 1.0)]), (40, &[(43, 1.0)]), (41, &[(43, 1.0)]), (42, &[(43, 1.0)]), (43, &[]),
    (44, &[(24, 1.0)]),
    (46, &[]), (47, &[(46, 1.0)]), (48, &[(46, 1.0)]), (49, &[(46, 1.0)]), (50, &[(46, 1.0)]), (51, &[(46, 1.0)]),
    (55, &[]), (56, &[]), (57, &[]),
];

#[test]
fn jeder_neue_regler_ist_hoerbar() {
    let mut schwach = Vec::new();
    for (nr, tor) in NEUE_MIT_TOR {
        let mit = |v: f32| { let mut k = tor.to_vec(); k.push((*nr, v)); akkord_mit_ende(&k, 0.8) };
        let d = diff_db(&mit(0.0), &mit(1.0));
        println!("MESS audible knob {nr:2}: 0 against 1 differs by {d:.1} dBFS RMS");
        if d <= -60.0 { schwach.push((*nr, d)); }
    }
    assert!(schwach.is_empty(), "knobs inaudible with their gate open: {schwach:?}");
    assert_eq!(NEUE_MIT_TOR.len() + 1, NEUE.len(), "all build-out knobs but glide are in the table");
}

#[test]
fn neue_funktionen_an_gegen_aus() {
    // each feature on against off, both with the same gates open; difference above -60 dBFS RMS
    let ein = |name: &str, aus: &[(usize, f32)], an: &[(usize, f32)]| {
        let d = diff_db(&akkord_mit_ende(aus, 0.8), &akkord_mit_ende(an, 0.8));
        println!("MESS on/off {name:34}: {d:.1} dBFS");
        assert!(d > -60.0, "{name}: on differs from off by only {d:.1} dBFS");
    };
    for (nr, name, extra) in [(35, "mod env to pitch", &[][..]), (36, "mod env to PWM", &[(12, 0.8)][..]), (37, "mod env to cutoff", &[][..]), (38, "mod env to osc 2 pitch", &[(46, 1.0)][..])] {
        let mut aus = extra.to_vec(); aus.push((nr, 0.5));
        for (v, vz) in [(1.0, "+1"), (0.0, "-1")] {
            let mut an = extra.to_vec(); an.push((nr, v));
            ein(&format!("{name} {vz}"), &aus, &an);
        }
    }
    for (t, name) in ["cutoff", "pitch", "PWM", "resonance", "amplitude"].iter().enumerate() {
        for (v, vz) in [(1.0, "+1"), (0.0, "-1")] {
            let pre = [(12, 0.8), (42, t as f32 / 4.0)];
            let mut aus = pre.to_vec(); aus.push((43, 0.5));
            let mut an = pre.to_vec(); an.push((43, v));
            ein(&format!("LFO 2 to {name} {vz}"), &aus, &an);
        }
    }
    ein("osc 2 level", &[], &[(46, 1.0)]);
    ein("velocity to cutoff", &[(56, 0.5)], &[(56, 1.0)]);
    ein("master tune", &[(57, 0.5)], &[(57, 1.0)]);
    ein("velocity depth (0 against 1x)", &[(55, 0.0)], &[(55, 0.5)]);
}

#[test]
fn glide_auf_der_stimme() {
    let aus = zwei_akkorde(&[(54, 0.0)]);
    for (k, zeit) in [(1.0 / 6.0, "10 ms"), (4.0 / 6.0, "300 ms"), (1.0, "800 ms")] {
        let d = diff_db(&aus, &zwei_akkorde(&[(54, k)]));
        println!("MESS glide {zeit}: differs from off by {d:.1} dBFS");
        assert!(d > -60.0 || zeit == "10 ms", "glide {zeit}: {d:.1} dBFS");
    }
    // Off is the old path: knob 54 at exactly 0 equals the default start
    assert_eq!(aus, zwei_akkorde(&[]));
}

#[test]
fn lfo2_sync_und_frei() {
    // Free (knob 41 = 0) ignores the tempo; 1/4 (third synced position = 3 / 6) runs at one beat: period 0.5 s at 120 bpm.
    // Target amplitude, sustain 1, a single held note: the envelope of the output repeats with the LFO period.
    let spiele = |sync: f32, bpm: f64| -> Vec<f32> {
        let mut p = lade();
        setze(&mut p, &[(41, sync), (42, 1.0), (43, 1.0), (20, 1.0), (7, 0.0), (28, 0.0), (5, 0.0), (1, 1.0), (3, 0.0), (24, 0.0), (25, 0.0), (26, 0.0), (12, 0.0), (14, 0.0), (15, 0.0)]);
        p.setze_takt(0.0, bpm / 60.0 / SR as f64);
        p.note_an(57, 0.8);
        // the pitch target would not show in the envelope: target 4 = amplitude
        p.setze_regler(42, 1.0);
        (0..(6.0 * SR) as usize).map(|_| { let (l, r) = p.sample_stereo(); 0.5 * (l + r) }).collect()
    };
    let (frei120, frei60) = (spiele(0.0, 120.0), spiele(0.0, 60.0));
    assert_eq!(frei120, frei60, "Free must ignore the host tempo");
    let sync120 = spiele(0.5, 120.0);
    assert_ne!(frei120, sync120);
    // envelope: rectified, smoothed over 10 ms, then the autocorrelation of its fluctuation
    let huelle: Vec<f32> = { let mut z = 0.0f32; sync120.iter().map(|v| { z += 0.002 * (v.abs() - z); z }).collect() };
    let x = &huelle[(1.0 * SR) as usize..];
    let m = x.iter().sum::<f32>() / x.len() as f32;
    let x: Vec<f32> = x.iter().map(|v| v - m).collect();
    // the autocorrelation peak near four periods (2 s): a trend of the envelope bends the first peak, four periods average it out
    let n = x.len() - 110_000;
    let ac = |lag: usize| (0..n).map(|i| x[i] * x[i + lag]).sum::<f32>();
    let (von, bis) = (92_000usize, 100_000usize);
    let (lag, _) = (von..bis).map(|l| (l, ac(l))).fold((0, f32::MIN), |b, c| if c.1 > b.1 { c } else { b });
    let periode = lag as f32 / SR / 4.0;
    println!("MESS lfo 2 sync 1/4 at 120 bpm: period {periode:.4} s");
    assert!((periode - 0.5).abs() < 0.005, "period {periode} s, expected 0.5 s within 1 %");
}

#[test]
fn neue_regler_an_den_anschlaegen() {
    // every build-out knob alone at 0 and at 1: finite, no DC above -50 dBFS, the chord stays below 1.0
    let mut schlimmster = 0.0f32;
    for nr in NEUE {
        for v in [0.0f32, 1.0] {
            let mut p = lade();
            p.setze_regler(nr, v);
            let y = halte(&mut p, &AKKORD, 0.8, 3.0);
            let (s, d) = (spitze(&y), dc(&y));
            println!("MESS corner knob {nr:2} = {v}: peak {s:.3}, dc {:.1} dBFS", db(d));
            assert!(s < 1.0, "knob {nr} at {v}: peak {s}");
            assert!(db(d) < -50.0, "knob {nr} at {v}: dc {} dBFS", db(d));
            schlimmster = schlimmster.max(s);
        }
    }
    println!("MESS corners worst peak {schlimmster:.3}");
}

#[test]
fn alle_regler_auf_halb() {
    // every knob 1..57 at 0.5 (the project default for a knob without a start position): finite, no DC, below 1.0 (the build-out knobs
    // that are bipolar or middle-pinned sit at their neutral points, the unipolar gates at half)
    let mut p = lade();
    setze(&mut p, &(1..=63).map(|n| (n, 0.5)).collect::<Vec<_>>());
    let y = akkord(&mut p);
    let (r, s, d) = (db(rms(&y)), spitze(&y), dc(&y));
    println!("MESS all knobs 0.5: rms {r:.1} dB, peak {s:.3}, dc {:.1} dBFS", db(d));
    assert!(s < 1.0 && db(d) < -50.0 && r > -40.0, "rms {r}, peak {s}, dc {}", db(d));
}

#[test]
fn osc2_schwebt_gegen_osc1() {
    // oscillator 2 at level 1, octave 0, detune +7 ct against the unison stack at Detune 0 (all copies on 440 Hz): two lines, 440 and 440 x 2^(7/1200)
    // = 441.78 Hz, so the beat is 1.78 Hz. Measured from the spectrum (7.0 s, Hann, parabolic peak) within 5 %.
    let mut p = lade();
    setze(&mut p, &[(1, 1.0), (2, 0.0), (3, 0.0), (7, 0.0), (12, 0.0), (14, 0.0), (15, 0.0), (16, 0.0), (24, 0.0), (25, 0.0), (26, 0.0), (20, 1.0), (28, 0.0), (4, 0.0),
                    (46, 1.0), (50, 0.5 + 7.0 / 100.0)]);
    let y = halte(&mut p, &[69], 0.8, 8.0);
    let y = &y[SR as usize..SR as usize + 262_144];
    let sp = spitzen(y, 420.0, 470.0);
    let soll = 440.0 * (7.0f32 / 1200.0).exp2() - 440.0;
    println!("MESS osc 2 beat: peaks {sp:.2?}, expected spacing {soll:.3} Hz");
    assert_eq!(sp.len(), 2, "two lines expected: {sp:?}");
    let schwebung = (sp[1].0 - sp[0].0).abs();
    assert!((schwebung - soll).abs() < 0.05 * soll, "beat {schwebung} Hz, expected {soll} Hz");
    // and with level 0 (off) a single line
    let mut q = lade();
    setze(&mut q, &[(1, 1.0), (2, 0.0), (3, 0.0), (7, 0.0), (12, 0.0), (14, 0.0), (15, 0.0), (16, 0.0), (24, 0.0), (25, 0.0), (26, 0.0), (20, 1.0), (28, 0.0), (4, 0.0), (50, 0.57)]);
    let z = halte(&mut q, &[69], 0.8, 8.0);
    assert_eq!(spitzen(&z[SR as usize..SR as usize + 262_144], 420.0, 470.0).len(), 1, "level 0: one line");
}

/// Cost with all voices sounding (the graph runs every voice all the time): blocks of 256, `wavetable-supersaw` beside it.
#[test]
#[ignore]
fn kosten_synth_poly() {
    use std::time::Instant;
    let mess = |json: &str| -> (usize, f64, f64) {
        let mut p = uebersetze(json, SR).unwrap();
        for n in 0..p.stimmen { p.note_an(40 + (3 * n as u8) % 40, 0.8); }
        let mut senke = 0.0f32;
        for _ in 0..200 * 256 { senke += p.sample(); }
        let mut t: Vec<f64> = (0..400).map(|_| {
            let z = Instant::now();
            for _ in 0..256 { senke += p.sample(); }
            z.elapsed().as_secs_f64() * 1e6
        }).collect();
        assert!(senke.is_finite());
        t.sort_by(|a, b| a.partial_cmp(b).unwrap());
        (p.stimmen, t[200], t[396])
    };
    let periode = 256.0 / SR as f64 * 1e6;
    for (name, json) in [("synth-poly", GRAPH.to_string()), ("synth-poly x2 voices", GRAPH.replace(r#""stimmen": 8"#, r#""stimmen": 16"#)),
                         ("wavetable-supersaw", include_str!("../demos/wavetable-supersaw.json").to_string())] {
        let (n, p50, p99) = mess(&json);
        println!("MESS cost {name:22} {n:2} voices: p50 {p50:6.0} us ({:4.1} % of a block), p99 {p99:6.0} us ({:4.1} %)", 100.0 * p50 / periode, 100.0 * p99 / periode);
    }
}
