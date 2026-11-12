//! `synth-mono`: the monophonic bass/lead synthesizer (demos/synth-mono.json). Pins the device rules with numbers:
//! the default sound (all knobs at their `vorgabe`) is usable and not too loud, the five filter types switch within a few dB, A4 is 440 Hz
//! at every type and at full resonance, hard sync locks osc 2 to osc 1, no click at a note start, glide only where the Mode
//! knob says, no NaN/clipping at the knob corners, and a cost figure (ignored test).
use baukasten_dsp::{uebersetze, Kosten, Programm, REGLER};
use std::time::Instant;

const SR: f32 = 48_000.0;
const GRAPH: &str = include_str!("../demos/synth-mono.json");

// knob numbers (regler_namen of the graph)
const RESO: usize = 2;
const TYP: usize = 5;
const MIX: usize = 8;
const SUB: usize = 9;
const NOISE: usize = 10;
const SEMI: usize = 13;
const SYNC: usize = 17;
const GLIDE: usize = 7;
const MODE: usize = 29;

fn lade(kn: &[(usize, f32)]) -> Programm {
    let mut p = uebersetze(GRAPH, SR).unwrap_or_else(|e| panic!("{e}"));
    for &(n, v) in kn {
        p.setze_regler(n, v);
    }
    p
}

fn lauf(p: &mut Programm, s: f32) -> Vec<f32> { (0..(s * SR) as usize).map(|_| p.sample_stereo().0).collect() }

/// The probe of the convention test: A2 C#3 E3 A3 at 0.5 s each, the chord 1.5 s, 1.5 s tail. Returns the samples.
fn probe(p: &mut Programm) -> Vec<f32> {
    let mut y = Vec::new();
    for n in [45u8, 49, 52, 57] {
        p.note_an(n, 0.8);
        y.extend(lauf(p, 0.5));
        p.note_aus(n);
    }
    for n in [45u8, 49, 52, 57] {
        p.note_an(n, 0.8);
    }
    y.extend(lauf(p, 1.5));
    p.alle_aus();
    y.extend(lauf(p, 1.5));
    y
}

fn spitze(y: &[f32]) -> f32 { y.iter().fold(0.0, |m, v| m.max(v.abs())) }

/// RMS in dB over the 50 ms frames that are not silent
fn rms_db(y: &[f32]) -> f32 {
    let a: Vec<f32> = y.chunks(2400).filter(|c| (c.iter().map(|v| v * v).sum::<f32>() / c.len() as f32).sqrt() > 1e-3).flatten().cloned().collect();
    20.0 * (a.iter().map(|v| v * v).sum::<f32>() / a.len().max(1) as f32).sqrt().max(1e-9).log10()
}

fn dc_dbfs(y: &[f32]) -> f32 { 20.0 * ((y.iter().map(|&v| v as f64).sum::<f64>() / y.len() as f64).abs() as f32).max(1e-9).log10() }

/// The stop of the Filter type knob: the selector with 5 stops stores i/4
fn typ(i: usize) -> f32 { i as f32 / 4.0 }

/// Fundamental by the autocorrelation peak at the 12th multiple of the period, parabolic interpolation (about 0.1 cent)
fn f0(y: &[f32], soll: f32) -> f32 {
    let k = 12usize;
    let l0 = SR / soll * k as f32;
    let lo = l0 as usize - 3;
    let c = |lag: usize| -> f64 { (0..y.len() - lag).map(|i| y[i] as f64 * y[i + lag] as f64).sum::<f64>() };
    let w: Vec<f64> = (lo..lo + 8).map(c).collect();
    let bi = (0..8).max_by(|&a, &b| w[a].partial_cmp(&w[b]).unwrap()).unwrap().clamp(1, 6);
    let d = 0.5 * (w[bi - 1] - w[bi + 1]) / (w[bi - 1] - 2.0 * w[bi] + w[bi + 1]);
    k as f32 * SR / ((lo + bi) as f64 + d) as f32
}

/// Coarse period estimate for a short window of a single saw: the best normalised autocorrelation between 80 and 900 Hz
fn f0_grob(y: &[f32]) -> f32 {
    let (mut best, mut bl) = (f64::MIN, 0usize);
    for lag in (SR / 900.0) as usize..(SR / 80.0) as usize {
        let (mut s, mut e) = (0.0f64, 1e-12f64);
        for i in 0..y.len() - lag {
            s += y[i] as f64 * y[i + lag] as f64;
            e += (y[i + lag] as f64).powi(2);
        }
        if s / e.sqrt() > best { best = s / e.sqrt(); bl = lag; }
    }
    SR / bl as f32
}

fn dft_db(y: &[f32], f: f32) -> f32 {
    let n = y.len();
    let w = 2.0 * std::f64::consts::PI * f as f64 / SR as f64;
    let (mut re, mut im, mut sw) = (0.0f64, 0.0f64, 0.0f64);
    for (i, &v) in y.iter().enumerate() {
        let h = 0.5 - 0.5 * (2.0 * std::f64::consts::PI * i as f64 / n as f64).cos();
        re += v as f64 * h * (w * i as f64).cos();
        im += v as f64 * h * (w * i as f64).sin();
        sw += h;
    }
    20.0 * (2.0 * (re * re + im * im).sqrt() / sw).max(1e-9).log10() as f32
}

#[test]
fn grundklang_alle_regler_auf_vorgabe() {
    // every knob at its `vorgabe` (what the page loads): the old default sound, level and DC as before the full-synth stage
    let mut p = lade(&[]);
    let y = probe(&mut p);
    let (pk, rms, dc) = (spitze(&y), rms_db(&y), dc_dbfs(&y));
    println!("MESS synth-mono default: peak {pk:.3} rms {rms:.1} dB dc {dc:.1} dBFS");
    assert!(y.iter().all(|v| v.is_finite()) && p.rettungen == 0);
    assert!(pk > 0.3 && pk < 0.7, "peak {pk}");
    assert!((-22.0..=-14.0).contains(&rms), "rms {rms} dB (existing bass/lead recipes sit between -14 and -23)");
    assert!(dc < -60.0, "dc {dc} dBFS");
    // the probe is a bass line: a lot of energy below 300 Hz and some above 1 kHz (not a sine, not a buzz)
    let seg = &y[9_600..9_600 + 8192]; // A2, 0.2 s into the first note
    // the default Drift (25 %) moves the pitch by a few cent, so the fundamental is the strongest bin within +-2 Hz (and the drifted cutoff costs 0.5 dB of the 12 dB margin: 11.5 dB measured)
    let g = (0..9).map(|i| dft_db(seg, 108.0 + i as f32 * 0.5)).fold(f32::MIN, f32::max);
    assert!(g > -30.0 && g - dft_db(seg, 880.0) > 10.0, "fundamental {g} dB, 880 Hz {} dB", dft_db(seg, 880.0));
}

#[test]
fn alle_regler_auf_halb_bleibt_endlich() {
    // an extra corner: every knob at 0.5 (a preset that carries no new knob and a project that stores 0.5 everywhere)
    let mut p = uebersetze(GRAPH, SR).unwrap();
    for n in 1..=REGLER {
        p.setze_regler(n, 0.5);
    }
    let y = probe(&mut p);
    println!("MESS synth-mono all 0.5: peak {:.3} rms {:.1} dB dc {:.1} dBFS", spitze(&y), rms_db(&y), dc_dbfs(&y));
    assert!(y.iter().all(|v| v.is_finite()) && p.rettungen == 0, "not finite or rescued");
    assert!(spitze(&y) < 0.9 && dc_dbfs(&y) < -50.0, "peak {} dc {}", spitze(&y), dc_dbfs(&y));
}

#[test]
fn filtertypen_schalten_innerhalb_weniger_db() {
    // stops 0..3 (Diode, SEM, Ladder, MS-20) are level-matched on the probe; stop 4 is a band-pass and by nature quieter
    for (reso, grenze) in [(0.5f32, 3.0f32), (0.0, 3.5), (1.0, 3.0)] {
        let pegel: Vec<f32> = (0..5).map(|i| rms_db(&probe(&mut lade(&[(TYP, typ(i)), (RESO, reso)])))).collect();
        println!("MESS synth-mono type levels at reso {reso}: {pegel:.1?}");
        let (lo, hi) = pegel[..4].iter().fold((f32::MAX, f32::MIN), |(a, b), &v| (a.min(v), b.max(v)));
        assert!(hi - lo <= grenze, "reso {reso}: types 0..3 differ by {} dB", hi - lo);
        assert!((pegel[4] - pegel[..4].iter().sum::<f32>() / 4.0).abs() <= 5.0, "reso {reso}: band-pass {:.1} against the mean", pegel[4]);
    }
    // a second cutoff: low, and the type levels still hold
    let pegel: Vec<f32> = (0..4).map(|i| rms_db(&probe(&mut lade(&[(TYP, typ(i)), (1, 0.2)])))).collect();
    let (lo, hi) = pegel.iter().fold((f32::MAX, f32::MIN), |(a, b), &v| (a.min(v), b.max(v)));
    assert!(hi - lo <= 3.0, "cutoff 0.2: {pegel:.1?}");
}

#[test]
fn stimmung_a4_440_bei_jedem_typ_auch_bei_voller_resonanz() {
    // osc 1 only, no sub, key tracking and everything else at the default
    for reso in [0.5f32, 1.0] {
        for i in 0..5 {
            let mut p = lade(&[(MIX, 0.0), (SUB, 0.0), (TYP, typ(i)), (RESO, reso)]);
            p.note_an(69, 0.8);
            let y = lauf(&mut p, 1.2);
            assert!(y.iter().all(|v| v.is_finite()) && spitze(&y) < 0.9, "type {i} reso {reso}: peak {}", spitze(&y));
            let f = f0(&y[19_200..19_200 + 32_768], 440.0);
            let ct = 1200.0 * (f / 440.0).log2();
            println!("MESS synth-mono A4 type {i} reso {reso}: {f:.2} Hz ({ct:+.2} ct)");
            assert!(ct.abs() < 3.0, "type {i} reso {reso}: {ct} cent");
        }
    }
    // osc 2 alone at the smallest detune (0.5 cent)
    let mut p = lade(&[(MIX, 1.0), (SUB, 0.0), (11, 0.0)]);
    p.note_an(69, 0.8);
    let y = lauf(&mut p, 1.2);
    let ct = 1200.0 * (f0(&y[19_200..19_200 + 32_768], 440.0) / 440.0).log2();
    assert!(ct.abs() < 3.0, "osc 2: {ct} cent");
}

#[test]
fn hartsync_sperrt_osz2_auf_osz1() {
    // osc 2 alone, a fifth up (interval 7 st). Sync stop: the fundamental stays at osc 1 (440), no 659. Off: 659, no 440.
    let semi = (7.0 + 12.0) / 24.0; // interval knob maps -12..12 st
    let mess = |sync: f32| {
        let mut p = lade(&[(MIX, 1.0), (SUB, 0.0), (SEMI, semi), (3, 0.0), (18, 0.0), (SYNC, sync)]);
        p.note_an(69, 0.8);
        let y = lauf(&mut p, 1.2);
        let s = &y[19_200..19_200 + 32_768];
        (dft_db(s, 440.0), dft_db(s, 659.26))
    };
    let (s440, s659) = mess(0.0);
    let (f440, f659) = mess(0.5);
    println!("MESS synth-mono sync: 440/659 Hz levels sync {s440:.0}/{s659:.0} dB, free {f440:.0}/{f659:.0} dB");
    assert!(s440 > s659 + 40.0, "sync: {s440} vs {s659}");
    assert!(f659 > f440 + 40.0, "free: {f440} vs {f659}");
}

#[test]
fn kein_klick_am_noteneinsatz() {
    // fresh notes from silence: the largest sample step in the first 3 ms must not exceed the largest step in the next 57 ms
    // (an envelope attack of 2 ms and a filter that opens are wanted transients; a click would be a step above both)
    let mut schlimmster = 0.0f32;
    for t in [0.0f32, 0.5, 1.0] {
        for n in [33u8, 45, 57, 69, 81] {
            let mut p = lade(&[(TYP, t)]);
            lauf(&mut p, 0.1);
            p.note_an(n, 0.8);
            let y = lauf(&mut p, 0.2);
            let schritt = |a: usize, b: usize| y[a..b].windows(2).map(|w| (w[1] - w[0]).abs()).fold(0.0f32, f32::max);
            let (erst, danach) = (schritt(0, 144), schritt(144, 2_900));
            schlimmster = schlimmster.max(erst / danach.max(1e-9));
            assert!(erst <= 1.1 * danach, "type {t} note {n}: start step {erst} against {danach}");
        }
    }
    println!("MESS synth-mono click: worst start/later step ratio over 15 notes {schlimmster:.2}");
}

#[test]
fn glide_nur_wo_der_modus_es_sagt() {
    // osc 1 only (a saw), no noise; glide knob at 1 (0.8 s); A2, released, 0.2 s silence, then C#4 detached.
    // Legato / Retrig stops: a detached note jumps to its pitch. "Glide all": it slides up from A2.
    let mess = |modus: f32| {
        let mut p = lade(&[(MIX, 0.0), (SUB, 0.0), (NOISE, 0.0), (GLIDE, 1.0), (MODE, modus), (3, 0.0)]);
        p.note_an(45, 0.8);
        lauf(&mut p, 0.4);
        p.note_aus(45);
        lauf(&mut p, 0.3);
        p.note_an(61, 0.8);
        lauf(&mut p, 0.02);
        f0_grob(&lauf(&mut p, 0.05))
    };
    let (legato, retrig, alle) = (mess(0.0), mess(0.5), mess(1.0));
    println!("MESS synth-mono glide: detached C#4, f0 20..70 ms after: legato {legato:.0} Hz, retrig {retrig:.0}, glide-all {alle:.0} (target 277.2)");
    assert!((legato / 277.2 - 1.0).abs() < 0.03 && (retrig / 277.2 - 1.0).abs() < 0.03, "{legato} {retrig}");
    assert!(alle < 200.0, "glide-all should still be on its way up: {alle}");
    // legato overlap glides in every mode: the second note is pressed while the first is down
    let mut p = lade(&[(MIX, 0.0), (SUB, 0.0), (NOISE, 0.0), (GLIDE, 1.0), (MODE, 0.0), (3, 0.0)]);
    p.note_an(45, 0.8);
    lauf(&mut p, 0.4);
    p.note_an(61, 0.8);
    lauf(&mut p, 0.02);
    let f = f0_grob(&lauf(&mut p, 0.05));
    println!("MESS synth-mono glide: overlapped C#4 in Legato mode, f0 20..70 ms after: {f:.0} Hz");
    assert!(f < 200.0, "overlapped note must glide: {f}");
}

#[test]
fn legato_startet_die_huellkurven_nicht_neu_retrig_schon() {
    // short amp decay, low sustain: after 0.5 s the level sits near the sustain. A second note pressed while the first is down
    // restarts the envelope in Retrig mode (level jumps up), not in Legato mode.
    let rms = |y: &[f32]| (y.iter().map(|v| v * v).sum::<f32>() / y.len() as f32).sqrt();
    let verhaeltnis = |modus: f32| {
        let mut p = lade(&[(MIX, 0.0), (SUB, 0.0), (NOISE, 0.0), (GLIDE, 0.0), (MODE, modus), (20, 0.2), (21, 0.15), (3, 0.0), (19, 0.0)]);
        p.note_an(45, 0.8);
        lauf(&mut p, 0.5);
        let vorher = rms(&lauf(&mut p, 0.05));
        p.note_an(52, 0.8);
        let nachher = rms(&lauf(&mut p, 0.03));
        nachher / vorher
    };
    let (legato, retrig) = (verhaeltnis(0.0), verhaeltnis(0.5));
    println!("MESS synth-mono legato: level 0..30 ms after an overlapped note / level before: legato {legato:.2}, retrig {retrig:.2}");
    assert!(legato < 1.25, "legato must not restart the envelope: {legato}");
    assert!(retrig > 2.0 * legato, "retrig must restart it: {retrig} against {legato}");
}

#[test]
fn ecken_der_knoepfe_bleiben_endlich_und_laut_genug_begrenzt() {
    // all knobs 0, all knobs 1 and 24 fixed pseudo-random corner combinations
    let mut seed = 0x2545_f491_4f6c_dd1du64;
    let mut zufall = move || { seed ^= seed << 13; seed ^= seed >> 7; seed ^= seed << 17; (seed >> 40) as f32 / (1u64 << 24) as f32 };
    let mut faelle: Vec<Vec<f32>> = vec![vec![0.0; REGLER], vec![1.0; REGLER]];
    for _ in 0..24 {
        faelle.push((0..REGLER).map(|_| if zufall() < 0.5 { 0.0 } else { 1.0 }).collect());
    }
    let (mut hoechste, mut hoechste_ohne_fx) = (0.0f32, 0.0f32);
    for (i, kn) in faelle.iter().enumerate() {
        let mut p = uebersetze(GRAPH, SR).unwrap();
        for (n, v) in kn.iter().enumerate() {
            p.setze_regler(n + 1, *v);
        }
        let y = probe(&mut p);
        assert!(y.iter().all(|v| v.is_finite()) && p.rettungen == 0, "case {i}: not finite or rescued");
        hoechste = hoechste.max(spitze(&y));
        // chorus, delay and reverb mixes (knobs 53, 57, 59) add wet signal on top of the dry one: a corner set that opens them may sum higher
        if kn[52] == 0.0 && kn[56] == 0.0 && kn[58] == 0.0 {
            hoechste_ohne_fx = hoechste_ohne_fx.max(spitze(&y));
        }
        if i < 2 {
            assert!(spitze(&y) < 0.9 && dc_dbfs(&y) < -50.0, "case {i} (all {}): peak {} dc {} dBFS", i, spitze(&y), dc_dbfs(&y));
        }
    }
    println!("MESS synth-mono corners: highest peak over 26 cases {hoechste:.3}, without effect mixes {hoechste_ohne_fx:.3}");
    assert!(hoechste_ohne_fx < 1.3, "peak without effects {hoechste_ohne_fx}");
    assert!(hoechste < 2.0, "peak {hoechste}");
}

/// The knob numbers of the graph: 1..=57 and 59, 60 (58 stays free: the reverb has one fixed decay and no decay knob)
fn alle_nummern() -> Vec<usize> { (1..=57).chain([59, 60]).collect() }

#[test]
fn jeder_knopf_ist_benannt_und_die_nummern_sind_angehaengt() {
    let p = lade(&[]);
    let mut nr: Vec<usize> = p.regler_namen.iter().map(|(n, _)| *n).collect();
    nr.sort();
    assert_eq!(nr, alle_nummern());
    let name = |n: usize| p.regler_namen.iter().find(|(k, _)| *k == n).unwrap().1.clone();
    // the eight that matter on a controller, and the first 32 never change
    assert_eq!([1, 2, 3, 4, 5, 6, 7, 8].map(name), ["Cutoff", "Resonance", "Env amount", "Decay", "Filter type", "Drive", "Glide", "Osc mix"]);
    assert_eq!(name(32), "Drift");
    let neu = [(33, "Filter attack"), (34, "Filter release"), (35, "Amp attack"), (36, "ModEnv attack"), (39, "ModEnv release"), (40, "ModEnv to pitch"),
        (41, "ModEnv to pwm"), (42, "ModEnv to cutoff"), (43, "LFO2 rate"), (45, "LFO2 sync"), (46, "LFO2 target"), (47, "LFO2 amount"),
        (48, "Velocity depth"), (49, "Velocity to cutoff"), (50, "Master tune"), (51, "Osc1 octave"), (52, "Osc1 fine"), (53, "Chorus"),
        (55, "Delay time"), (57, "Delay mix"), (59, "Reverb mix"), (60, "Ping-pong")];
    for (n, soll) in neu {
        assert!(name(n).eq_ignore_ascii_case(soll), "knob {n}: {} vs {soll}", name(n));
    }
}

/// RMS of the difference of two renders in dB (full scale 1.0)
fn diff_db(a: &[f32], b: &[f32]) -> f32 {
    let s: f64 = a.iter().zip(b).map(|(x, y)| ((x - y) as f64).powi(2)).sum::<f64>() / a.len() as f64;
    20.0 * (s.sqrt() as f32).max(1e-9).log10()
}

#[test]
fn neue_funktionen_aendern_den_klang_gegenueber_aus() {
    // each feature against the default (off): the difference is above -60 dB RMS of the probe
    let aus = probe(&mut lade(&[]));
    let faelle: Vec<(String, Vec<(usize, f32)>)> = {
        let mut f: Vec<(String, Vec<(usize, f32)>)> = vec![
            ("modenv to cutoff".into(), vec![(42, 1.0)]), ("modenv to pitch".into(), vec![(40, 1.0)]), ("modenv to pwm".into(), vec![(41, 1.0)]),
            ("velocity to cutoff".into(), vec![(49, 1.0)]), ("delay mix".into(), vec![(57, 1.0)]), ("reverb mix".into(), vec![(59, 1.0)]),
            ("chorus".into(), vec![(53, 1.0)]), ("master tune".into(), vec![(50, 1.0)]),
        ];
        for (i, t) in ["cutoff", "pitch", "pwm", "resonance", "amp"].iter().enumerate() {
            for (sz, a) in [("+1", 1.0f32), ("-1", 0.0)] {
                f.push((format!("lfo2 {t} {sz}"), vec![(46, i as f32 / 4.0), (47, a)]));
            }
        }
        f
    };
    for (name, kn) in faelle {
        let y = probe(&mut lade(&kn));
        let d = diff_db(&aus, &y);
        println!("MESS synth-mono on/off {name}: difference {d:.1} dB");
        assert!(y.iter().all(|v| v.is_finite()) && spitze(&y) < 1.0, "{name}: peak {}", spitze(&y));
        assert!(d > -60.0, "{name}: only {d} dB against off");
    }
}

#[test]
fn mono_freie_regler_wirken_ueber_ihr_tor() {
    // the class F knobs that are dead at the default (their gate sits at 0) must change the sound once the gate is open: a miswired
    // free knob would pass every other test. Each knob 0 against 1 with its gate knob open, all others at their vorgabe.
    let tore: [(usize, &[usize], &[(usize, f32)]); 12] = [
        (36, &[], &[(42, 1.0)]), (37, &[], &[(42, 1.0)]), (38, &[], &[(42, 1.0)]), (39, &[], &[(42, 1.0)]),   // MOD ENV A D S R through To cutoff
        (43, &[], &[(47, 1.0)]), (44, &[], &[(47, 1.0)]), (45, &[], &[(47, 1.0)]), (46, &[], &[(47, 1.0)]),   // LFO 2 rate, shape, sync, target through Amount
        (54, &[], &[(53, 1.0)]),                                                                              // chorus mode through Chorus
        (55, &[], &[(57, 1.0)]), (56, &[], &[(57, 1.0)]), (60, &[], &[(57, 1.0)]),                           // delay time, feedback, ping-pong through Delay mix
    ];
    for (nr, _, tor) in tore {
        let mit = |w: f32| { let mut kn = tor.to_vec(); kn.push((nr, w)); probe(&mut lade(&kn)) };
        let (a, b) = (mit(0.0), mit(1.0));
        let d = diff_db(&a, &b);
        println!("MESS synth-mono free knob {nr}: 0 against 1 with its gate open {d:.1} dB");
        assert!(a.iter().chain(&b).all(|v| v.is_finite()), "knob {nr}: not finite");
        assert!(d > -80.0, "knob {nr} does not change the sound with its gate open ({d} dB)");
    }
}

/// The graph with the output of LFO 2 (signal x amount) on the left channel instead of the sound, and a chosen host tempo
fn lfo_probe(bpm: f64, kn: &[(usize, f32)]) -> Vec<f32> {
    let mut j: serde_json::Value = serde_json::from_str(GRAPH).unwrap();
    let kanten = j["kanten"].as_array_mut().unwrap();
    kanten.retain(|k| k["nach"] != "aus.l" && k["nach"] != "aus.r");
    kanten.push(serde_json::json!({"von": "lfo2_sig.aus", "nach": "aus.l"}));
    let mut p = uebersetze(&j.to_string(), SR).unwrap();
    p.setze_takt(0.0, bpm / 60.0 / SR as f64);
    for &(n, v) in kn {
        p.setze_regler(n, v);
    }
    lauf(&mut p, 6.0)
}

/// Mean spacing in seconds of the rising zero crossings
fn periode(y: &[f32]) -> f32 {
    let z: Vec<usize> = (1..y.len()).filter(|&i| y[i - 1] < 0.0 && y[i] >= 0.0).collect();
    assert!(z.len() >= 3, "only {} crossings", z.len());
    (z[z.len() - 1] - z[0]) as f32 / (z.len() - 1) as f32 / SR
}

#[test]
fn lfo2_sync_folgt_dem_tempo_und_frei_ignoriert_es() {
    // sync stop 3 of 7 (Free, 1/16, 1/8, 1/4, ...) = 1/4 note = one beat; amount +1 (knob 1.0)
    let viertel = [(47, 1.0f32), (45, 3.0 / 6.0)];
    let (p120, p60) = (periode(&lfo_probe(120.0, &viertel)), periode(&lfo_probe(60.0, &viertel)));
    println!("MESS synth-mono lfo2 sync 1/4: period {p120:.4} s at 120 bpm, {p60:.4} s at 60 bpm");
    assert!((p120 / 0.5 - 1.0).abs() < 0.01, "120 bpm: {p120}");
    assert!((p60 / 1.0 - 1.0).abs() < 0.01, "60 bpm: {p60}");
    // Free: the rate knob decides (default 2 Hz = 0.5 s), the tempo is ignored
    let frei = [(47, 1.0f32), (45, 0.0)];
    let (f120, f60) = (periode(&lfo_probe(120.0, &frei)), periode(&lfo_probe(60.0, &frei)));
    println!("MESS synth-mono lfo2 free: period {f120:.4} s at 120 bpm, {f60:.4} s at 60 bpm");
    assert!((f120 / 0.5 - 1.0).abs() < 0.01 && (f120 - f60).abs() < 1e-6, "{f120} {f60}");
}

#[test]
fn jeder_neue_knopf_allein_an_den_ecken() {
    // every new knob alone at 0 and at 1, all others at their vorgabe: finite, no rescue, DC and peak inside the bounds
    for n in alle_nummern().into_iter().filter(|n| *n >= 33) {
        for w in [0.0f32, 1.0] {
            let mut p = lade(&[(n, w)]);
            let y = probe(&mut p);
            assert!(y.iter().all(|v| v.is_finite()) && p.rettungen == 0, "knob {n} = {w}: not finite or rescued");
            assert!(spitze(&y) < 0.9 && dc_dbfs(&y) < -50.0, "knob {n} = {w}: peak {} dc {} dBFS", spitze(&y), dc_dbfs(&y));
        }
    }
}

/// Cost: one voice (the graph is monophonic), blocks of 256, as in kosten_messung.rs. Not gated:
///   nice -n 19 cargo test --release -p baukasten_dsp --test synth_mono -- --ignored --nocapture
#[test]
#[ignore]
fn kosten_ein_stimme() {
    for (name, kn) in [("default", vec![]), ("acid", vec![(TYP, 0.0), (RESO, 0.8), (3, 0.8)]), ("ms20 screamer", vec![(TYP, 0.75), (RESO, 0.97)])] {
        let mut p = lade(&kn);
        p.note_an(40, 0.8);
        let mut senke = 0.0f32;
        for _ in 0..200 * 256 { senke += p.sample(); }
        let mut k = Kosten::default();
        for _ in 0..4000 {
            let t = Instant::now();
            for _ in 0..256 { senke += p.sample(); }
            k.buche(t.elapsed().as_secs_f64() * 1e6);
        }
        println!("{{\"graph\":\"synth-mono\",\"setting\":\"{name}\",\"stimmen\":{},\"block\":256,\"p50_us\":{},\"p99_us\":{},\"p999_us\":{},\"max_us\":{:.1},\"anteil_p999\":{:.4},\"senke\":{}}}",
            p.stimmen, k.quantil_us(0.5), k.quantil_us(0.99), k.quantil_us(0.999), k.max_us, k.quantil_us(0.999) / (256.0 / 48_000.0 * 1e6), senke.is_finite());
    }
}
