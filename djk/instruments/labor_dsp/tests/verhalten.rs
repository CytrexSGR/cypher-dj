//! Behaviour of the whole device against the documented target values.
use labor_dsp::modulator::Modulator;
use labor_dsp::{Einstellung, Labor, Ueber};

const FS: f64 = 48000.0;

fn lauf(e: &Einstellung, sek: f64, ein: impl Fn(usize) -> (f32, f32), vor: impl FnOnce(&mut Labor)) -> (Vec<f32>, Vec<f32>) {
    let mut lab = Labor::neu(FS);
    lab.setze(e);
    lab.leeren();
    vor(&mut lab);
    let n = (sek * FS) as usize;
    let (mut l, mut r): (Vec<f32>, Vec<f32>) = ((0..n).map(|i| ein(i).0).collect(), (0..n).map(|i| ein(i).1).collect());
    for (a, b) in l.chunks_mut(64).zip(r.chunks_mut(64)) {
        lab.block(a, b);
    }
    (l, r)
}

fn spitze(x: &[f32]) -> f32 {
    x.iter().fold(0.0, |m, v| m.max(v.abs()))
}

fn frequenz(x: &[f32]) -> f64 {
    let (mut erste, mut letzte, mut zahl) = (None, 0.0, 0);
    for i in 1..x.len() {
        if x[i - 1] <= 0.0 && x[i] > 0.0 {
            let t = (i - 1) as f64 + (-x[i - 1] / (x[i] - x[i - 1])) as f64;
            if erste.is_none() { erste = Some(t) } else { zahl += 1 }
            letzte = t;
        }
    }
    match erste {
        Some(e) if zahl > 0 => zahl as f64 * FS / (letzte - e),
        _ => 0.0,
    }
}

fn nur_filter(fc: f64, resonanz: f64) -> Einstellung {
    let mut e = Einstellung::default();
    e.lautstaerke_db = 0.0;
    for k in 0..2 {
        e.kanal[k].delay_an = false;
        e.kanal[k].feedback = 0.0;
        e.kanal[k].cutoff_hz = fc;
        e.kanal[k].resonanz = resonanz;
    }
    e
}

fn impuls(i: usize) -> (f32, f32) {
    if (4800..4848).contains(&i) { (0.25, 0.25) } else { (0.0, 0.0) }
}

#[test]
fn self_oscillation_is_a_stable_tone_at_the_cutoff() {
    for fc in [60.0, 1000.0, 6000.0] {
        let (l, _) = lauf(&nur_filter(fc, 0.9), 8.0, |_| (0.0, 0.0), |_| {});
        let (frueh, spaet) = (&l[5 * 48000..6 * 48000], &l[7 * 48000..]);
        let f = frequenz(spaet);
        assert!((f / fc - 1.0).abs() < 0.01, "cutoff {fc}: oscillates at {f}");
        let (a, b) = (spitze(frueh), spitze(spaet));
        assert!(b > 0.2 && b < 0.8, "cutoff {fc}: amplitude {b}");
        assert!((a / b - 1.0).abs() < 0.01, "cutoff {fc}: amplitude drifts from {a} to {b}");
    }
}

#[test]
fn below_the_threshold_the_filter_stays_silent_without_input() {
    let (l, _) = lauf(&nur_filter(1000.0, 0.7), 3.0, |_| (0.0, 0.0), |_| {});
    assert!(spitze(&l[48000..]) < 0.001, "resonance 0.7 must not oscillate: {}", spitze(&l[48000..]));
}

#[test]
fn loud_input_pushes_the_resonance_away() {
    // resonance peak of a sine at the cutoff, relative to the input level, quiet against loud
    let anhebung = |pegel: f32| {
        let (l, _) = lauf(&nur_filter(1000.0, 0.75), 2.0, |i| {
            let v = pegel * (2.0 * std::f64::consts::PI * 1000.0 * i as f64 / FS).sin() as f32;
            (v, v)
        }, |_| {});
        spitze(&l[48000..]) / pegel
    };
    let (leise, laut) = (anhebung(0.003), anhebung(0.3));
    assert!(leise > 3.0, "a quiet tone at the cutoff is lifted by the resonance: {leise}");
    assert!(laut < 0.5 * leise, "a loud tone gets less resonance: quiet {leise}, loud {laut}");
}

#[test]
fn delay_time_follows_the_setting() {
    for zeit in [46.0, 340.0, 1500.0] {
        let mut e = Einstellung::default();
        e.lautstaerke_db = 0.0;
        for k in 0..2 {
            e.kanal[k].feedback = 0.0;
            e.kanal[k].zeit_ms = zeit;
            e.kanal[k].cutoff_hz = 6000.0;
            e.kanal[k].resonanz = 0.0;
        }
        let (l, _) = lauf(&e, 2.5, impuls, |_| {});
        let imax = (0..l.len()).max_by(|a, b| l[*a].abs().total_cmp(&l[*b].abs())).unwrap();
        let ms = (imax as f64 - 4824.0 - Labor::neu(FS).latenz() as f64) / 48.0;
        assert!((ms / zeit - 1.0).abs() < 0.02, "set {zeit} ms, measured {ms} ms");
    }
}

#[test]
fn full_feedback_everywhere_stays_bounded() {
    for (delay, hp) in [(false, false), (false, true), (true, false), (true, true)] {
        let mut e = Einstellung::default();
        e.lautstaerke_db = 0.0;
        for k in 0..2 {
            let ka = &mut e.kanal[k];
            ka.feedback = 1.0;
            ka.kreuz = 1.0;
            ka.delay_an = delay;
            ka.hp = hp;
            ka.resonanz = 1.0;
            ka.gain_db = 40.0;
            ka.zeit_ms = 46.0 + 300.0 * k as f64;
        }
        let (l, r) = lauf(&e, 10.0, |i| { let v = ((i * 7919) % 1000) as f32 / 1000.0 - 0.5; (v, -v) }, |_| {});
        assert!(l.iter().chain(r.iter()).all(|v| v.is_finite()), "delay {delay} hp {hp}: not finite");
        // the processed signal is clipped at 1.46 V = full scale (plus the filter ripple of the downsampler)
        assert!(spitze(&l) < 1.25 && spitze(&r) < 1.25, "delay {delay} hp {hp}: peak {} {}", spitze(&l), spitze(&r));
        assert!(spitze(&l[9 * 48000..]) > 0.05, "delay {delay} hp {hp}: the loop sounds");
    }
}

#[test]
fn feedback_above_unity_makes_an_oscillator_without_input() {
    for delay in [false, true] {
        let mut e = nur_filter(800.0, 0.3);
        for k in 0..2 {
            e.kanal[k].delay_an = delay;
            e.kanal[k].zeit_ms = 46.0;
            e.kanal[k].feedback = 0.9;
        }
        let (l, _) = lauf(&e, 6.0, |_| (0.0, 0.0), |_| {});
        assert!(spitze(&l[5 * 48000..]) > 0.05, "delay {delay}: feedback 0.9 oscillates from the noise floor");
        e.kanal[0].feedback = 0.3;
        e.kanal[1].feedback = 0.3;
        let (l, _) = lauf(&e, 6.0, |_| (0.0, 0.0), |_| {});
        assert!(spitze(&l[5 * 48000..]) < 0.001, "delay {delay}: feedback 0.3 only attenuates");
    }
}

#[test]
fn ping_pong_recipe_first_repeat_left_second_right() {
    // manual recipe: channel feedback off, both cross feedbacks up, input gain of channel 2 at minimum
    let mut e = Einstellung::default();
    e.lautstaerke_db = 0.0;
    e.mono_ein = true;
    for k in 0..2 {
        let ka = &mut e.kanal[k];
        ka.feedback = 0.0;
        ka.kreuz = 0.45;
        ka.zeit_ms = 200.0;
        ka.cutoff_hz = 6000.0;
        ka.resonanz = 0.0;
        ka.mix = 1.0;
    }
    e.kanal[1].gain_db = -38.0;
    let (l, r) = lauf(&e, 1.5, impuls, |_| {});
    let fenster = |x: &[f32], ms: f64| spitze(&x[((100.0 + ms - 40.0) * 48.0) as usize..((100.0 + ms + 60.0) * 48.0) as usize]);
    let (l1, r1, l2, r2) = (fenster(&l, 200.0), fenster(&r, 200.0), fenster(&l, 400.0), fenster(&r, 400.0));
    assert!(l1 > 0.1 && r1 < 0.1 * l1, "first repeat on the left only: L {l1} R {r1}");
    assert!(r2 > 0.02 && l2 < 0.2 * r2, "second repeat on the right only: L {l2} R {r2}");
}

#[test]
fn modulator_cycle_lasts_attack_plus_decay() {
    for (a, d) in [(0.005, 0.005), (0.1, 0.4), (5.0, 5.0)] {
        let mut m = Modulator::neu(FS);
        m.zyklus(true);
        let n = ((a + d) * FS * 3.2) as usize;
        let (mut vor, mut gipfel, mut sprung) = (0.0, Vec::new(), 0.0f64);
        for i in 0..n {
            let w = m.schritt(a, d);
            assert!((0.0..=1.0).contains(&w));
            if w == 1.0 && vor < 1.0 { gipfel.push(i) }
            sprung = sprung.max((w - vor).abs());
            vor = w;
        }
        assert!(gipfel.len() >= 3, "{a}+{d}: {} cycles", gipfel.len());
        let periode = (gipfel[2] - gipfel[1]) as f64 / FS;
        assert!((periode / (a + d) - 1.0).abs() < 0.02, "{a}+{d}: period {periode}");
        // no step at the turning points: the largest step is the first sample of the attack curve
        assert!(sprung < 1.05 * 4.0 / (a * FS) / (1.0 - (-4.0f64).exp()) + 1e-9, "{a}+{d}: step {sprung}");
    }
}

#[test]
fn envelope_runs_once_per_trigger_and_moves_the_cutoff() {
    // kick recipe: self-oscillating filter at the lowest cutoff, the envelope sweeps the pitch down
    let mut e = nur_filter(60.0, 0.9);
    e.decay_s = 0.2;
    e.kanal[0].mod_cutoff = 0.8;
    let (l, _) = lauf(&e, 3.0, |_| (0.0, 0.0), |_| {});
    let ruhe = frequenz(&l[2 * 48000..]);
    assert!((ruhe / 60.0 - 1.0).abs() < 0.02, "without a trigger the pitch rests at the cutoff: {ruhe}");
    let mut lab = Labor::neu(FS);
    lab.setze(&e);
    lab.leeren();
    let (mut l, mut r) = (vec![0f32; 3 * 48000], vec![0f32; 3 * 48000]);
    lab.block(&mut l, &mut r);
    lab.trigger(1.0);
    let (mut l, mut r) = (vec![0f32; 48000], vec![0f32; 48000]);
    lab.block(&mut l, &mut r);
    let (oben, unten) = (frequenz(&l[240..2400]), frequenz(&l[24000..]));
    assert!(oben > 3.0 * 60.0, "right after the trigger the pitch is up: {oben}");
    assert!((unten / 60.0 - 1.0).abs() < 0.03, "after the decay it is back: {unten}");
}

#[test]
fn a_note_moves_the_pitch_and_the_gate_closes_the_output() {
    let mut e = nur_filter(261.63, 0.9);
    e.key_track = 1.0;
    e.gate = true;
    let mut lab = Labor::neu(FS);
    lab.setze(&e);
    lab.leeren();
    let stueck = |lab: &mut Labor, sek: f64| {
        let (mut l, mut r) = (vec![0f32; (sek * FS) as usize], vec![0f32; (sek * FS) as usize]);
        lab.block(&mut l, &mut r);
        l
    };
    assert!(spitze(&stueck(&mut lab, 2.0)[48000..]) < 1e-4, "no note held: closed");
    lab.note_an(72, 1.0);
    let l = stueck(&mut lab, 2.0);
    let f = frequenz(&l[48000..]);
    assert!((f / 523.25 - 1.0).abs() < 0.01, "note 72 sounds an octave above the knob: {f}");
    lab.note_aus();
    assert!(spitze(&stueck(&mut lab, 1.0)[24000..]) < 1e-4, "note released: closed again");
}

#[test]
fn the_mode_without_latency_sounds_like_the_linear_one() {
    // a self-oscillating filter in both oversampled modes: same pitch, same level, and no latency reported
    let e = nur_filter(1000.0, 0.9);
    let lauf_art = |art: Ueber| {
        let mut lab = Labor::mit_art(FS, art);
        lab.setze(&e);
        lab.leeren();
        let (mut l, mut r) = (vec![0f32; 4 * 48000], vec![0f32; 4 * 48000]);
        lab.block(&mut l, &mut r);
        (frequenz(&l[3 * 48000..]), spitze(&l[3 * 48000..]), lab.latenz())
    };
    let (fl, al, ll) = lauf_art(Ueber::Linear);
    let (fm, am, lm) = lauf_art(Ueber::Minimal);
    assert!(ll > 0 && lm == 0, "latency linear {ll}, minimal {lm}");
    assert!((fm / fl - 1.0).abs() < 1e-3, "pitch {fl} against {fm}");
    assert!((am / al - 1.0).abs() < 0.02, "level {al} against {am}");
}
