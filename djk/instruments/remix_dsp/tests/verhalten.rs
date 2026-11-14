//! Behaviour of the device on synthetic signals: what each section promises, measured.
use remix_dsp::{isolate, release, szene, Einstellung, Remix};

const SR: f64 = 48000.0;
/// 120 BPM: a beat is 24000 samples.
const BPS: f64 = 120.0 / 60.0 / SR;
const BEAT: usize = 24000;

/// Runs `n` samples of `quelle` through the device in blocks of 64 and returns left and right.
fn lauf(s: &mut Remix, start: usize, n: usize, quelle: impl Fn(usize) -> f32) -> (Vec<f32>, Vec<f32>) {
    let (mut l, mut r): (Vec<f32>, Vec<f32>) = ((start..start + n).map(&quelle).collect(), (start..start + n).map(&quelle).collect());
    let mut i = 0;
    while i < n {
        let e = (i + 64).min(n);
        s.block(&mut l[i..e], &mut r[i..e], (start + i) as f64 * BPS, BPS);
        i = e;
    }
    (l, r)
}

fn sinus(hz: f64) -> impl Fn(usize) -> f32 {
    move |i| (i as f64 * hz / SR * std::f64::consts::TAU).sin() as f32 * 0.5
}

/// A four-on-the-floor kick with a steady 3 kHz tone on top.
fn spur(i: usize) -> f32 {
    let t = (i % BEAT) as f64 / SR;
    let kick = (t * 55.0 * std::f64::consts::TAU).sin() * (-t / 0.12).exp();
    let ton = (i as f64 * 3000.0 / SR * std::f64::consts::TAU).sin() * 0.1;
    (kick * 0.6 + ton) as f32
}

fn rms(x: &[f32]) -> f64 {
    (x.iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / x.len().max(1) as f64).sqrt()
}

fn db(x: f64) -> f64 {
    20.0 * x.max(1e-12).log10()
}

#[test]
fn everything_off_passes_the_input_bit_for_bit() {
    let mut s = Remix::neu(SR);
    let (l, _) = lauf(&mut s, 0, 20000, spur);
    for (i, v) in l.iter().enumerate() {
        assert_eq!(v.to_bits(), spur(i).to_bits(), "sample {i}");
    }
    // an effect selected with its main control at rest is still the original sound
    s.setze(&Einstellung { szene_typ: szene::ECHO, szene: 0.0, ..Einstellung::default() });
    let (l, _) = lauf(&mut s, 20000, 20000, spur);
    for (i, v) in l.iter().enumerate() {
        assert_eq!(v.to_bits(), spur(20000 + i).to_bits(), "sample {i}");
    }
}

#[test]
fn every_scene_effect_changes_the_sound_and_stays_bounded() {
    for typ in 1..=szene::TYPEN {
        let mut s = Remix::neu(SR);
        s.setze(&Einstellung { szene_typ: typ, szene: 1.0, sub1: 0.5, sub2: 0.7, ..Einstellung::default() });
        let (l, r) = lauf(&mut s, 0, 8 * BEAT, spur);
        let spitze = l.iter().chain(r.iter()).fold(0f32, |a, v| a.max(v.abs()));
        assert!(l.iter().chain(r.iter()).all(|v| v.is_finite()), "type {typ} finite");
        assert!(spitze < 4.0, "type {typ} bounded, peak {spitze}");
        let abstand: f64 = rms(&l.iter().enumerate().map(|(i, v)| v - spur(i)).collect::<Vec<_>>());
        assert!(abstand > 0.01, "type {typ} audible, difference rms {abstand}");
    }
}

#[test]
fn echo_repeats_at_the_selected_beat_fraction() {
    let mut s = Remix::neu(SR);
    // sub parameter 1 in the middle is a half beat: 12000 samples at 120 BPM
    s.setze(&Einstellung { szene_typ: szene::ECHO, szene: 0.5, sub1: 0.5, ..Einstellung::default() });
    lauf(&mut s, 0, 4800, |_| 0.0);
    let (l, _) = lauf(&mut s, 4800, 2 * BEAT, |i| if i == 4800 { 1.0 } else { 0.0 });
    let (wo, wert) = l.iter().enumerate().skip(100).fold((0, 0f32), |a, (i, v)| if v.abs() > a.1 { (i, v.abs()) } else { a });
    assert!((wo as i64 - 12000).abs() <= 2, "first repeat at {wo}, expected 12000");
    assert!(wert > 0.3, "repeat level {wert}");
    assert!((szene::raster(0.0) - 1.0 / 16.0).abs() < 1e-12 && (szene::raster(1.0) - 2.0).abs() < 1e-12);
}

#[test]
fn isolator_kills_one_band_and_leaves_the_others() {
    let pegel = |hz: f64, e: Einstellung| {
        let mut s = Remix::neu(SR);
        s.setze(&e);
        let (l, _) = lauf(&mut s, 0, 48000, sinus(hz));
        db(rms(&l[24000..]) / (0.5 / 2f64.sqrt()))
    };
    let aus = Einstellung { iso_typ: isolate::ISOLATOR, ..Einstellung::default() };
    let tief_weg = Einstellung { low: -1.0, ..aus };
    assert!(pegel(80.0, aus).abs() < 0.2 && pegel(1000.0, aus).abs() < 0.2 && pegel(10000.0, aus).abs() < 0.2, "centred controls are flat");
    assert!(pegel(80.0, tief_weg) < -40.0, "low killed: {}", pegel(80.0, tief_weg));
    assert!(pegel(1000.0, tief_weg).abs() < 1.0 && pegel(10000.0, tief_weg).abs() < 0.5, "mid and high stay");
    let hoch_mehr = Einstellung { hi: 1.0, ..aus };
    assert!((pegel(10000.0, hoch_mehr) - isolate::ISOLATOR_MAX_DB).abs() < 0.5, "high boosted by the maximum");
}

#[test]
fn every_isolate_effect_stays_bounded_at_both_ends() {
    for typ in 1..=isolate::TYPEN {
        for k in [-1.0f32, 1.0] {
            let mut s = Remix::neu(SR);
            s.setze(&Einstellung { iso_typ: typ, low: k, mid: k, hi: k, ..Einstellung::default() });
            let (l, r) = lauf(&mut s, 0, 6 * BEAT, spur);
            let spitze = l.iter().chain(r.iter()).fold(0f32, |a, v| a.max(v.abs()));
            assert!(l.iter().all(|v| v.is_finite()) && spitze < 4.0, "type {typ} at {k}: peak {spitze}");
        }
    }
}

#[test]
fn trans_gates_in_the_beat_grid() {
    let mut s = Remix::neu(SR);
    // all three bands left of the centre in the first zone: one beat cycle, open for the first half
    s.setze(&Einstellung { iso_typ: isolate::TRANS_ROLL, low: -0.2, mid: -0.2, hi: -0.2, ..Einstellung::default() });
    let (l, _) = lauf(&mut s, 0, 4 * BEAT, sinus(1000.0));
    let offen = rms(&l[2 * BEAT + 2000..2 * BEAT + 10000]);
    let zu = rms(&l[2 * BEAT + 14000..2 * BEAT + 22000]);
    assert!(db(offen / (0.5 / 2f64.sqrt())).abs() < 0.5, "open half passes: {offen}");
    assert!(db(zu / offen) < -60.0, "closed half is silent: {}", db(zu / offen));
    assert_eq!(isolate::trans_zyklus(-0.9), 0.25);
}

#[test]
fn band_roll_repeats_the_first_cycle() {
    let mut s = Remix::neu(SR);
    s.setze(&Einstellung { iso_typ: isolate::TRANS_ROLL, ..Einstellung::default() });
    lauf(&mut s, 0, BEAT, spur);
    // all bands right of the centre in the last zone: an eighth of a beat = 3000 samples
    s.setze(&Einstellung { iso_typ: isolate::TRANS_ROLL, low: 1.0, mid: 1.0, hi: 1.0, ..Einstellung::default() });
    let (l, _) = lauf(&mut s, BEAT, 2 * BEAT, spur);
    // the control glides to its position in a few milliseconds, the roll starts inside the first 2 ms; compare cycles far behind that
    let a = &l[9000 + 200..9000 + 2700];
    let b = &l[12000 + 200..12000 + 2700];
    let unterschied = rms(&a.iter().zip(b).map(|(x, y)| x - y).collect::<Vec<_>>());
    assert!(rms(a) > 0.01 && unterschied < 1e-4 * rms(a).max(1e-9) + 1e-6, "cycles equal: rms {} difference {unterschied}", rms(a));
}

#[test]
fn pad_plays_the_selected_voice_on_the_grid() {
    let mut s = Remix::neu(SR);
    // switching a voice on sounds it at once
    s.setze(&Einstellung { kick: true, ..Einstellung::default() });
    let (l, _) = lauf(&mut s, 0, 2 * BEAT, |_| 0.0);
    assert!(rms(&l[..4800]) > 0.05, "one shot sounds: {}", rms(&l[..4800]));
    assert!(rms(&l[2 * BEAT - 2400..]) == 0.0, "and ends");
    // a touch in the fourth zone repeats the selected voice every beat
    s.setze(&Einstellung { hat: true, beruehrt: true, pad: 0.7, ..Einstellung::default() });
    let (l, _) = lauf(&mut s, 2 * BEAT, 4 * BEAT + 10, |_| 0.0);
    for b in 1..4 {
        let vor = rms(&l[b * BEAT - 2400..b * BEAT - 10]);
        let nach = rms(&l[b * BEAT..b * BEAT + 2400]);
        assert!(nach > 0.02 && vor < 1e-4, "hit on beat {b}: before {vor} after {nach}");
    }
}

#[test]
fn overdub_replays_a_recorded_hit_four_beats_later() {
    let mut s = Remix::neu(SR);
    s.setze(&Einstellung { overdub: true, ..Einstellung::default() });
    lauf(&mut s, 0, BEAT + 6000, |_| 0.0);
    // a snare switched on at beat 1.25 lands on step 5 of the pattern
    s.setze(&Einstellung { overdub: true, snare: true, ..Einstellung::default() });
    let (l, _) = lauf(&mut s, BEAT + 6000, 6 * BEAT, |_| 0.0);
    assert!(rms(&l[..2400]) > 0.02, "the hit itself");
    let spaeter = 4 * BEAT;
    assert!(rms(&l[spaeter - 4800..spaeter - 100]) < 1e-3, "silent before the pattern comes round");
    assert!(rms(&l[spaeter..spaeter + 2400]) > 0.02, "replayed after four beats");
    // overdub off deletes the pattern
    s.setze(&Einstellung { snare: true, ..Einstellung::default() });
    let (l, _) = lauf(&mut s, 7 * BEAT + 6000, 5 * BEAT, |_| 0.0);
    assert!(rms(&l[BEAT..]) < 1e-3, "pattern gone");
}

#[test]
fn pad_roll_loops_the_input_from_the_touch() {
    let mut s = Remix::neu(SR);
    lauf(&mut s, 0, BEAT, spur);
    // third zone: half a beat = 12000 samples, level at full so the roll replaces the track
    s.setze(&Einstellung { roll: true, beruehrt: true, pad: 0.5, pad_pegel: 1.0, ..Einstellung::default() });
    let (l, _) = lauf(&mut s, BEAT, 3 * BEAT, spur);
    let a = &l[12000 + 300..12000 + 11000];
    let b = &l[24000 + 300..24000 + 11000];
    let unterschied = rms(&a.iter().zip(b).map(|(x, y)| x - y).collect::<Vec<_>>());
    assert!(rms(a) > 0.01 && unterschied < 1e-6, "second and third cycle equal: {unterschied}");
    // the looped half beat holds the tail of a kick only, the live track would bring a new kick at the next beat
    s.setze(&Einstellung { roll: true, pad: 0.5, pad_pegel: 1.0, ..Einstellung::default() });
    let (l, _) = lauf(&mut s, 4 * BEAT, BEAT, spur);
    assert_eq!(l[BEAT - 1].to_bits(), spur(5 * BEAT - 1).to_bits(), "after the touch the track is back, exact");
}

#[test]
fn brake_stops_and_the_lever_brings_the_sound_back() {
    let mut s = Remix::neu(SR);
    lauf(&mut s, 0, 2 * BEAT, spur);
    // fully pulled: the brake takes half a beat
    s.setze(&Einstellung { rel_typ: release::VINYL_BRAKE, hebel: 1.0, ..Einstellung::default() });
    let (l, _) = lauf(&mut s, 2 * BEAT, 2 * BEAT, spur);
    assert!(rms(&l[..6000]) > 0.01, "still sounding while it slows");
    assert!(rms(&l[BEAT / 2 + 200..]) < 1e-4, "silent after the brake: {}", rms(&l[BEAT / 2 + 200..]));
    s.setze(&Einstellung::default());
    let (l, _) = lauf(&mut s, 4 * BEAT, BEAT, spur);
    assert_eq!(l[BEAT - 1].to_bits(), spur(5 * BEAT - 1).to_bits(), "original sound after the lever is back");
    assert_eq!((release::bereich(0.0), release::bereich(0.2), release::bereich(0.5), release::bereich(1.0)), (0, 1, 2, 3));
}

#[test]
fn release_echo_repeats_the_last_beat_and_fades() {
    let mut s = Remix::neu(SR);
    lauf(&mut s, 0, 2 * BEAT, spur);
    // slightly pulled: one beat, each repeat 0.72 of the one before
    s.setze(&Einstellung { rel_typ: release::ECHO, hebel: 0.2, ..Einstellung::default() });
    let (l, _) = lauf(&mut s, 2 * BEAT, 3 * BEAT, |_| 0.0);
    let (a, b, c) = (rms(&l[200..BEAT - 200]), rms(&l[BEAT + 200..2 * BEAT - 200]), rms(&l[2 * BEAT + 200..3 * BEAT - 200]));
    assert!(a > 0.01, "first repeat sounds although the input is silent: {a}");
    assert!((b / a - 0.72).abs() < 0.02 && (c / b - 0.72).abs() < 0.02, "decay per repeat: {} {}", b / a, c / b);
}

#[test]
fn back_spin_ends_silent() {
    let mut s = Remix::neu(SR);
    lauf(&mut s, 0, 6 * BEAT, spur);
    s.setze(&Einstellung { rel_typ: release::BACK_SPIN, hebel: 0.5, ..Einstellung::default() });
    let (l, _) = lauf(&mut s, 6 * BEAT, 2 * BEAT, spur);
    assert!(rms(&l[..BEAT / 2]) > 0.01, "spinning");
    assert!(rms(&l[BEAT + 200..]) < 1e-4, "silent after one beat");
}

#[test]
fn a_release_without_hold_leaves_the_scene_off_until_its_control_is_reset() {
    let echo = Einstellung { szene_typ: szene::HPF_ECHO, szene: 0.8, ..Einstellung::default() };
    let mut s = Remix::neu(SR);
    s.setze(&echo);
    lauf(&mut s, 0, 2 * BEAT, spur);
    s.setze(&Einstellung { hebel: 1.0, ..echo });
    lauf(&mut s, 2 * BEAT, BEAT, spur);
    s.setze(&echo);
    let (l, _) = lauf(&mut s, 3 * BEAT, BEAT, spur);
    assert_eq!(l[BEAT - 1].to_bits(), spur(4 * BEAT - 1).to_bits(), "scene locked: original sound");
    // back to rest and up again: the scene works again
    s.setze(&Einstellung { szene: 0.0, ..echo });
    lauf(&mut s, 4 * BEAT, 1000, spur);
    s.setze(&echo);
    let (l, _) = lauf(&mut s, 4 * BEAT + 1000, BEAT, spur);
    assert!(rms(&l.iter().enumerate().map(|(i, v)| v - spur(4 * BEAT + 1000 + i)).collect::<Vec<_>>()) > 0.01, "scene back");
    // with hold the scene simply stays
    let mut s = Remix::neu(SR);
    let halten = Einstellung { rel_halten: true, ..echo };
    s.setze(&halten);
    lauf(&mut s, 0, 2 * BEAT, spur);
    s.setze(&Einstellung { hebel: 1.0, ..halten });
    lauf(&mut s, 2 * BEAT, BEAT, spur);
    s.setze(&halten);
    let (l, _) = lauf(&mut s, 3 * BEAT, BEAT, spur);
    assert!(rms(&l.iter().enumerate().map(|(i, v)| v - spur(3 * BEAT + i)).collect::<Vec<_>>()) > 0.01, "scene held");
}

#[test]
fn a_cleared_device_repeats_itself() {
    let e = Einstellung { szene_typ: szene::NOISE, szene: 0.9, iso_typ: isolate::GATE_DRIVE, low: 0.8, kick: true, beruehrt: true, ..Einstellung::default() };
    let mut s = Remix::neu(SR);
    s.setze(&e);
    let (a, _) = lauf(&mut s, 0, 2 * BEAT, spur);
    s.setze(&Einstellung::default());
    s.leeren();
    s.setze(&e);
    let mut frisch = Remix::neu(SR);
    frisch.setze(&e);
    let (b, _) = lauf(&mut frisch, 0, 2 * BEAT, spur);
    let (c, _) = lauf(&mut s, 0, 2 * BEAT, spur);
    assert_eq!(a.len(), b.len());
    let abstand = |x: &[f32], y: &[f32]| rms(&x.iter().zip(y).map(|(p, q)| p - q).collect::<Vec<_>>());
    assert!(abstand(&a, &b) == 0.0, "two new devices are equal");
    assert!(abstand(&a, &c) == 0.0, "a cleared device equals a new one");
}
