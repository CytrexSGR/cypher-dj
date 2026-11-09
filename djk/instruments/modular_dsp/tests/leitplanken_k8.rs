//! S13: the knob convention K8 for the pad family. Knobs 1..5 are Cutoff, Resonance, Env amount, Attack, Release in every
//! variant; knobs 6..8 are per variant: hall = Hall mix, Sub, Chorus; echo and dyn = Echo mix, Echo time, Hall mix.
//! At the default position (0.5) every range lands on the value the graph had before (C3), so the sound is unchanged.
use baukasten_dsp::{uebersetze, Programm, REGLER};

const SR: f32 = 48_000.0;
const PAD_HALL: &str = include_str!("../demos/juno-pad-hall.json");
const PAD_ECHO: &str = include_str!("../demos/juno-pad-echo.json");
const PAD_DYN: &str = include_str!("../demos/juno-pad-dyn.json");

fn lade(g: &str, regler: &[(usize, f32)]) -> Programm {
    let mut p = uebersetze(g, SR).unwrap();
    for nr in 1..=REGLER { p.setze_regler(nr, 0.5); }
    for (nr, w) in regler { p.setze_regler(*nr, *w); }
    p
}
/// the chord A2 C#3 E3 A3 held for `halten` samples, released, `danach` more samples
fn akkord(g: &str, regler: &[(usize, f32)], halten: usize, danach: usize) -> Vec<(f32, f32)> {
    let mut p = lade(g, regler);
    for n in [45u8, 49, 52, 57] { p.note_an(n, 0.8); }
    let mut x: Vec<(f32, f32)> = (0..halten).map(|_| p.sample_stereo()).collect();
    p.alle_aus();
    x.extend((0..danach).map(|_| p.sample_stereo()));
    assert_eq!(p.rettungen, 0);
    x
}
fn db(x: &[(f32, f32)]) -> f32 {
    let q: f64 = x.iter().map(|(l, r)| (*l as f64).powi(2) + (*r as f64).powi(2)).sum::<f64>() / (2 * x.len()) as f64;
    10.0 * q.max(1e-20).log10() as f32
}
fn erste_abweichung(a: &[(f32, f32)], b: &[(f32, f32)]) -> usize { a.iter().zip(b).position(|(x, y)| x != y).unwrap_or(usize::MAX) }
fn abweichung_nach(a: &[(f32, f32)], b: &[(f32, f32)], von: usize) -> f32 {
    a[von..].iter().zip(&b[von..]).map(|(x, y)| (x.0 - y.0).abs().max((x.1 - y.1).abs())).fold(0.0, f32::max)
}

#[test]
fn knob_names_follow_the_convention() {
    let namen = |g: &str| -> Vec<String> { uebersetze(g, SR).unwrap().regler_namen.iter().map(|(_, s)| s.clone()).collect() };
    let kopf = ["Cutoff", "Resonance", "Env amount", "Attack", "Release"];
    assert_eq!(namen(PAD_HALL), [&kopf[..], &["Hall mix", "Sub", "Chorus"]].concat());
    assert_eq!(namen(PAD_ECHO), [&kopf[..], &["Echo mix", "Echo time", "Hall mix"]].concat());
    assert_eq!(namen(PAD_DYN), [&kopf[..], &["Echo mix", "Echo time", "Hall mix"]].concat());
}

/// The graph with the regler node `id` replaced by a constant range (min = max = `wert`), i.e. what the node sat at before the knob existed.
fn mit_konstante(g: &str, id: &str, wert: f64) -> String {
    let mut j: serde_json::Value = serde_json::from_str(g).unwrap();
    let k = j["knoten"].as_array_mut().unwrap().iter_mut().find(|k| k["id"] == id && k["art"] == "regler").unwrap_or_else(|| panic!("no regler {id}"));
    k["min"] = serde_json::json!(wert);
    k["max"] = serde_json::json!(wert);
    j.to_string()
}

#[test]
fn pad_variants_default_echo_and_hall_mix_are_the_old_constants() {
    // C3 pinned absolutely: at knob 0.5 the echo mix is 0.3 (range 0..0.6) and the hall mix 0.25 (range 0..0.5), bit-equal to
    // the same graph with those mixes as constants (a changed range maximum moves the default and turns this red)
    let gleich = |g: &str, id: &str, wert: f64| {
        let (knopf, konst) = (akkord(g, &[], 36_000, 12_000), akkord(&mit_konstante(g, id, wert), &[], 36_000, 12_000));
        assert_eq!(erste_abweichung(&knopf, &konst), usize::MAX, "{id} at the default must equal the constant {wert}");
        // negative control: a different constant must differ, so the comparison can fail
        let falsch = akkord(&mit_konstante(g, id, wert * 1.5), &[], 36_000, 12_000);
        assert_ne!(erste_abweichung(&knopf, &falsch), usize::MAX, "{id}: control constant {} must differ", wert * 1.5);
    };
    gleich(PAD_HALL, "k_hall_mix", 0.25);
    for g in [PAD_ECHO, PAD_DYN] {
        gleich(g, "k_echo_mix", 0.3);
        gleich(g, "k_hall_mix", 0.25);
    }
}

#[test]
fn echo_mix_knob_acts_and_zero_is_the_dry_pad() {
    for g in [PAD_ECHO, PAD_DYN] {
        let (aus, an) = (akkord(g, &[(6, 0.0)], 36_000, 12_000), akkord(g, &[(6, 1.0)], 36_000, 12_000));
        let abw = abweichung_nach(&aus, &an, 18_000);
        println!("MESS {} echo mix knob 0 vs 1: largest deviation after 375 ms {abw:.3}", uebersetze(g, SR).unwrap().name);
        assert!(abw > 0.01, "echo mix knob does nothing: {abw}");
    }
    // negative control and equality: with the echo mix at 0 the echo variant is bit-equal to the hall variant at the same
    // positions (hall variant knob 6 = Hall mix 0.5 -> 0.25, knobs 7 and 8 = Sub and Chorus at their baked 0.5 positions)
    let (hall, echo) = (akkord(PAD_HALL, &[], 36_000, 12_000), akkord(PAD_ECHO, &[(6, 0.0)], 36_000, 12_000));
    assert_eq!(erste_abweichung(&hall, &echo), usize::MAX, "echo mix 0 must be the hall variant");
    // and at the default position the echo is there (not accidentally off)
    assert!(abweichung_nach(&hall, &akkord(PAD_ECHO, &[], 36_000, 12_000), 18_000) > 0.01);
}

#[test]
fn echo_time_knob_moves_the_onset() {
    // log law 93.75 .. 1500 ms: knob 0 / 0.25 / 0.5 give 93.75 / 187.5 / 375 ms = 4500 / 9000 / 18000 samples. The first
    // sample that differs between echo mix 0 and echo mix 1 is where the first repeat arrives
    for g in [PAD_ECHO, PAD_DYN] {
        for (knob, soll) in [(0.0f32, 4_500usize), (0.25, 9_000), (0.5, 18_000)] {
            let (aus, an) = (akkord(g, &[(6, 0.0), (7, knob)], 24_000, 0), akkord(g, &[(6, 1.0), (7, knob)], 24_000, 0));
            let erst = erste_abweichung(&aus, &an);
            println!("MESS {} echo time knob {knob}: first repeat at sample {erst} (expected {soll})", uebersetze(g, SR).unwrap().name);
            assert!((soll..soll + 600).contains(&erst), "knob {knob}: onset at {erst}, expected {soll}");
        }
    }
}

#[test]
fn hall_mix_knob_lengthens_the_tail() {
    // 1.5 .. 2.0 s after the release (the release is about 0.3 s at the default, so the dry tail is gone by then)
    for (g, knob) in [(PAD_HALL, 6), (PAD_ECHO, 8), (PAD_DYN, 8)] {
        let ende = |w: f32| { let x = akkord(g, &[(knob, w)], 48_000, 96_000); db(&x[48_000 + 72_000..]) };
        let (aus, an) = (ende(0.0), ende(1.0));
        println!("MESS {} hall mix knob {knob}: tail {aus:.1} dBFS at 0, {an:.1} dBFS at 1", uebersetze(g, SR).unwrap().name);
        assert!(an > aus + 6.0, "hall mix knob: {aus:.1} -> {an:.1} dBFS");
    }
}

#[test]
fn attack_and_release_defaults_suit_short_notes() {
    // the sound audit: with 0.5 s notes the old defaults (attack 0.5 s, release 1.55 s at knob 0.5) smeared the chord.
    // Measured on one A2 note held 0.5 s (old -> new level in dBFS per 50 ms: 0.1..0.3 s -36 -> -30 against -26 at the end;
    // 0.1..0.3 s after the release -33 -> -42). Now (attack 0.25 s, release 0.31 s): at 0.1..0.3 s the note is within 6 dB of
    // its level at 0.45..0.5 s, and 0.1..0.3 s after the release it is at least 10 dB below that level (the echo repeats fill part of the gap)
    for g in [PAD_HALL, PAD_ECHO, PAD_DYN] {
        let name = uebersetze(g, SR).unwrap().name;
        let mut p = lade(g, &[]);
        p.note_an(45, 0.8);
        let halten: Vec<(f32, f32)> = (0..24_000).map(|_| p.sample_stereo()).collect();
        p.note_aus(45);
        let nach: Vec<(f32, f32)> = (0..24_000).map(|_| p.sample_stereo()).collect();
        let (anstieg, ziel, ende) = (db(&halten[4_800..14_400]), db(&halten[21_600..]), db(&nach[4_800..14_400]));
        println!("MESS {name} one A2 note: 0.1..0.3 s {anstieg:.1} dBFS, 0.45..0.5 s {ziel:.1}, 0.1..0.3 s after release {ende:.1}");
        assert!(anstieg > ziel - 6.0, "{name}: attack too slow: {anstieg:.1} vs {ziel:.1}");
        assert!(ende < ziel - 10.0, "{name}: release too long: {ende:.1} vs {ziel:.1}");
    }
}

// ---- Tier 2: the insert effects get their echo and filter knobs ------------------------------------------------------

const ECHO_ACHTEL: &str = include_str!("../demos/fx-echo-achtel.json");
const WOBBLE: &str = include_str!("../demos/fx-filter-wobble.json");

fn effekt(g: &str, regler: &[(usize, f32)], x: &[f32]) -> Vec<(f32, f32)> {
    let mut p = uebersetze(g, SR).unwrap();
    p.setze_takt(0.0, 2.0 / SR as f64); // 120 BPM
    for (nr, w) in regler { p.setze_regler(*nr, *w); }
    let y = x.iter().map(|v| { p.setze_eingang(*v, *v); p.sample_stereo() }).collect();
    assert_eq!(p.rettungen, 0);
    y
}
fn spitze_in(y: &[(f32, f32)], von: usize, bis: usize) -> f32 { y[von..bis].iter().fold(0.0, |m, (l, r)| m.max(l.abs()).max(r.abs())) }
fn rauschen(n: usize, rms_soll: f32, seed: u32) -> Vec<f32> {
    let mut s = seed;
    (0..n).map(|_| { s ^= s << 13; s ^= s >> 17; s ^= s << 5; ((s as f32 / u32::MAX as f32) * 2.0 - 1.0) * rms_soll * 3f32.sqrt() }).collect()
}
/// power in [von, bis) Hz of the mean over 8192-sample frames, naive DFT
fn band(x: &[f32], von: f64, bis: f64) -> f64 {
    let n = 8192;
    let (k0, k1) = ((von * n as f64 / SR as f64).ceil() as usize, (bis * n as f64 / SR as f64).floor() as usize);
    let mut summe = 0.0;
    for f in 0..x.len() / n {
        for k in k0..=k1 {
            let (mut re, mut im) = (0.0f64, 0.0f64);
            for i in 0..n {
                let w = 0.5 - 0.5 * (2.0 * std::f64::consts::PI * i as f64 / n as f64).cos();
                let ph = -2.0 * std::f64::consts::PI * k as f64 * i as f64 / n as f64;
                re += x[f * n + i] as f64 * w * ph.cos();
                im += x[f * n + i] as f64 * w * ph.sin();
            }
            summe += re * re + im * im;
        }
    }
    summe
}
fn links(y: &[(f32, f32)]) -> Vec<f32> { y.iter().map(|v| v.0).collect() }

#[test]
fn echo_achtel_mix_and_feedback_knobs_act() {
    // an impulse at sample 0; takt 0.5 beat at 120 BPM = 250 ms = 12000 samples; ping-pong puts the first repeat on one side
    let mut x = vec![0.0f32; 60_000];
    x[0] = 0.5;
    let erst = |m: f32, f: f32| { let y = effekt(ECHO_ACHTEL, &[(1, m), (2, f)], &x); (spitze_in(&y, 11_000, 13_000), spitze_in(&y, 23_000, 25_000)) };
    let (a0, _) = erst(0.0, 0.5);
    let (a5, b5) = erst(0.5, 0.5);
    let (a10, _) = erst(1.0, 0.5);
    println!("MESS echo-achtel first repeat peak: mix knob 0 {a0:.4}, 0.5 {a5:.4}, 1 {a10:.4}; second repeat at the default {b5:.4}");
    assert!(a0 < 1e-4, "mix 0 must have no repeat: {a0}");
    // absolute default (C3): the first repeat is the input 0.5 times the mix 0.35 (range 0..0.7 at the middle)
    assert!((a5 - 0.5 * 0.35).abs() < 2e-3, "default echo mix must be 0.35: first repeat peak {a5}, expected {}", 0.5 * 0.35);
    assert!((1.8..2.2).contains(&(a10 / a5)), "mix 0.7 against 0.35: {a10} / {a5}");
    let (_, b0) = erst(0.5, 0.0);
    let (_, b10) = erst(0.5, 1.0);
    println!("MESS echo-achtel second repeat peak: feedback knob 0 {b0:.4}, 0.5 {b5:.4}, 1 {b10:.4}");
    assert!(b0 < 1e-4 && b5 > 0.01 && b10 > 1.5 * b5, "feedback law: {b0} {b5} {b10}");
}

#[test]
fn filter_wobble_knobs_act_and_stay_finite() {
    let x = rauschen(8192 * 12, 0.2, 21);
    // depth 0 pins the filter at the centre: brighter centre = more energy above 4 kHz
    let hoch = |c: f32| { let y = links(&effekt(WOBBLE, &[(1, c), (2, 0.0), (3, 0.5)], &x)); band(&y[8192..], 4_000.0, 8_000.0) };
    let (tief, hell) = (hoch(0.2), hoch(0.8));
    println!("MESS wobble 4..8 kHz energy at depth 0: centre knob 0.2 {tief:.3e}, 0.8 {hell:.3e} ({:.1} dB)", 10.0 * (hell / tief).log10());
    assert!(hell > 10.0 * tief, "centre knob: {tief} vs {hell}");
    // depth moves the cutoff over time: the 4..8 kHz energy per frame varies with depth 1 and hardly with depth 0
    let streuung = |d: f32| {
        let y = links(&effekt(WOBBLE, &[(1, 0.5), (2, d), (3, 0.5)], &x));
        let e: Vec<f64> = (1..12).map(|f| band(&y[f * 8192..(f + 1) * 8192], 3_000.0, 8_000.0)).collect();
        let m = e.iter().sum::<f64>() / e.len() as f64;
        (e.iter().map(|v| (v - m).powi(2)).sum::<f64>() / e.len() as f64).sqrt() / m
    };
    let (flach, wobbel) = (streuung(0.0), streuung(1.0));
    println!("MESS wobble frame-to-frame variation of the 3..8 kHz energy: depth 0 {flach:.3}, depth 1 {wobbel:.3}");
    assert!(wobbel > 5.0 * flach.max(0.02), "depth knob: {flach} vs {wobbel}");
    // resonance: more energy around the centre (1.8 kHz) at depth 0
    let um = |r: f32| { let y = links(&effekt(WOBBLE, &[(1, 0.5), (2, 0.0), (3, r)], &x)); band(&y[8192..], 1_500.0, 2_100.0) };
    let (leise, laut) = (um(0.0), um(1.0));
    println!("MESS wobble 1.5..2.1 kHz energy at depth 0: resonance knob 0 {leise:.3e}, 1 {laut:.3e}");
    assert!(laut > 1.5 * leise, "resonance knob: {leise} vs {laut}");
    // every knob end is finite and never rescued
    for w in [0.0f32, 1.0] {
        let y = effekt(WOBBLE, &[(1, w), (2, w), (3, w)], &x);
        assert!(y.iter().all(|(l, r)| l.is_finite() && r.is_finite() && l.abs() < 8.0 && r.abs() < 8.0), "knobs {w}");
    }
}
