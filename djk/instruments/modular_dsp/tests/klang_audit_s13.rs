//! S13: the measured fixes of the sound audit of 2026-11-01, each shown on the same case against the OLD design.
//! The old design is rebuilt from the shipped graph by string replacement ("alt" variants), so every test fails if the
//! fix is taken out again, and the printed MESS lines give the before/after numbers.
mod gemeinsam;
use baukasten_dsp::{uebersetze_mit_wurzel, Programm};

const SR: f32 = 48_000.0;
const RUECK: &str = include_str!("../demos/rueckkopplung.json");
const SAITE: &str = include_str!("../demos/saite.json");
const VOCODER: &str = include_str!("../demos/fx-vocoder-robot.json");
const PUMP: &str = include_str!("../demos/fx-takt-pump.json");
const PHASER: &str = include_str!("../demos/fx-phaser.json");
const ROEHRE: &str = include_str!("../demos/fx-roehre.json");
const SNARE: &str = include_str!("../demos/gated-hall-snare.json");
const BASS: &str = include_str!("../demos/bassmusik.json");

fn lade(j: &str) -> Programm { uebersetze_mit_wurzel(j, SR, None).unwrap_or_else(|e| panic!("{e}")) }
fn ersetze(j: &str, alt: &str, neu: &str) -> String {
    assert_eq!(j.matches(alt).count(), 1, "variant anchor {alt:?} not found exactly once");
    j.replace(alt, neu)
}
fn rms(x: &[f32]) -> f32 { (x.iter().map(|v| v * v).sum::<f32>() / x.len() as f32).sqrt() }
fn rausch(n: usize, rms_soll: f32, seed: u32) -> Vec<f32> {
    let mut s = seed;
    (0..n).map(|_| { s ^= s << 13; s ^= s >> 17; s ^= s << 5; ((s as f32 / u32::MAX as f32) * 2.0 - 1.0) * rms_soll * 3f32.sqrt() }).collect()
}
/// Power in the band [von, bis) Hz of the mean over 8192-sample frames (naive DFT of the band only).
fn band(x: &[f32], von: f64, bis: f64) -> f64 {
    let n = 8192;
    let (k0, k1) = ((von * n as f64 / SR as f64).ceil() as usize, (bis * n as f64 / SR as f64).floor() as usize);
    let w: Vec<f64> = (0..n).map(|i| 0.5 - 0.5 * (2.0 * std::f64::consts::PI * i as f64 / n as f64).cos()).collect();
    let mut summe = 0.0;
    for f in 0..x.len() / n {
        for k in k0..=k1 {
            let (mut re, mut im) = (0.0f64, 0.0f64);
            for i in 0..n {
                let ph = -2.0 * std::f64::consts::PI * k as f64 * i as f64 / n as f64;
                let v = x[f * n + i] as f64 * w[i];
                re += v * ph.cos();
                im += v * ph.sin();
            }
            summe += re * re + im * im;
        }
    }
    summe
}
/// Strongest bin (Hz) between 80 and 1500 Hz of one 8192-sample window.
fn staerkste_linie(x: &[f32]) -> f64 {
    let n = 8192;
    let w: Vec<f64> = (0..n).map(|i| 0.5 - 0.5 * (2.0 * std::f64::consts::PI * i as f64 / n as f64).cos()).collect();
    let (mut bestk, mut best) = (0, 0.0f64);
    for k in (80 * n / 48_000)..(1500 * n / 48_000) {
        let (mut re, mut im) = (0.0f64, 0.0f64);
        for i in 0..n {
            let ph = -2.0 * std::f64::consts::PI * k as f64 * i as f64 / n as f64;
            re += x[i] as f64 * w[i] * ph.cos();
            im += x[i] as f64 * w[i] * ph.sin();
        }
        if re * re + im * im > best { best = re * re + im * im; bestk = k; }
    }
    bestk as f64 * SR as f64 / n as f64
}

// ---- rueckkopplung: the loop follows the played pitch ----------------------------------------------------------

fn rueck_alt() -> String {
    let j = ersetze(RUECK, r#"{"id": "farbe", "art": "regler", "nr": 2, "min": 1, "max": 8, "log": 1},"#, r#"{"id": "farbe", "art": "regler", "nr": 2, "min": 200, "max": 1200, "log": 1},"#);
    let j = ersetze(&j, r#"{"von": "farbe.aus", "nach": "farbe_hz.a"}, {"von": "tune_hz.aus", "nach": "farbe_hz.b"}, {"von": "farbe_hz.aus", "nach": "bp.cutoff"},"#, r#"{"von": "farbe.aus", "nach": "bp.cutoff"},"#);
    // no note.hz -> schleife.hz: the line length comes from knob 1 in ms (the pre-S13 design)
    let j = ersetze(&j, r#"{"id": "tune", "art": "regler", "nr": 1, "min": 0.5, "max": 2, "log": 1},
    {"id": "tune_hz", "art": "mul"},"#, r#"{"id": "zeit", "art": "regler", "nr": 1, "min": 2, "max": 40, "log": 1},"#);
    ersetze(&j, r#"{"von": "note.hz", "nach": "tune_hz.a"}, {"von": "tune.aus", "nach": "tune_hz.b"}, {"von": "tune_hz.aus", "nach": "schleife.hz"},"#, r#"{"von": "zeit.aus", "nach": "schleife.zeit"},"#)
}

/// strongest spectral line while the note is held (0.5 .. 0.67 s after the start)
fn rueck_linie(j: &str, note: u8) -> f64 { rueck_linie_tune(j, note, 0.5) }
fn rueck_linie_tune(j: &str, note: u8, tune: f32) -> f64 {
    let mut p = lade(j);
    p.setze_regler(1, tune);
    p.note_an(note, 1.0);
    let x: Vec<f32> = (0..32_768 + 24_000).map(|_| p.sample()).collect();
    staerkste_linie(&x[24_000..24_000 + 8192])
}

#[test]
fn rueckkopplung_follows_the_pitch_of_the_note() {
    let (a2, a3) = (rueck_linie(RUECK, 45), rueck_linie(RUECK, 57));
    let (a2_alt, a3_alt) = (rueck_linie(&rueck_alt(), 45), rueck_linie(&rueck_alt(), 57));
    println!("MESS rueckkopplung strongest line: A2 {a2:.0} Hz, A3 {a3:.0} Hz (ratio {:.2}); old design A2 {a2_alt:.0} Hz, A3 {a3_alt:.0} Hz (ratio {:.2})", a3 / a2, a3_alt / a2_alt);
    assert!((1.7..=2.4).contains(&(a3 / a2)), "an octave up must move the line by about an octave: {a2} -> {a3}");
    // Fehlerfall: the old design ignored the note (fixed band-pass colour)
    assert!(a3_alt / a2_alt < 1.5, "old design: {a2_alt} -> {a3_alt}");
}

#[test]
fn rueckkopplung_tune_knob_detunes_the_voice_around_the_note() {
    // knob 1 "Tune" is a pitch ratio 0.5..2 (log) for the loop line AND its band-pass colour: the middle is exactly the
    // played note, the ends are an octave away. (The old "Zeit" knob was dead once the line followed the note, because
    // leitung.zeit is only used while hz is 0.)
    let (tief, mitte, hoch) = (rueck_linie_tune(RUECK, 45, 0.0), rueck_linie_tune(RUECK, 45, 0.5), rueck_linie(RUECK, 45));
    let hoch_knopf = rueck_linie_tune(RUECK, 45, 1.0);
    println!("MESS rueckkopplung Tune on A2: strongest line knob 0 {tief:.0} Hz, 0.5 {mitte:.0} Hz (= the default {hoch:.0} Hz), 1 {hoch_knopf:.0} Hz");
    assert_eq!(mitte, hoch, "knob 0.5 is the default");
    assert!((1.8..=2.2).contains(&(mitte / tief)) && (1.8..=2.2).contains(&(hoch_knopf / mitte)), "{tief} / {mitte} / {hoch_knopf}");
}

// ---- saite: the exciter no longer slams the limiter ------------------------------------------------------------

/// the string without its output limiter (pegel straight to the output): the true peak of the attack
fn ohne_begrenzer(j: &str) -> String {
    ersetze(j, "{\"von\": \"pegel.aus\", \"nach\": \"begr.x\"},\n    {\"von\": \"begr.l\", \"nach\": \"aus.l\"}, {\"von\": \"begr.r\", \"nach\": \"aus.r\"}", "{\"von\": \"pegel.aus\", \"nach\": \"aus.x\"}")
}
fn saite_alt() -> String { ersetze(SAITE, "{\"von\": \"exc_lp.tp\", \"nach\": \"gleichfrei.x\"}", "{\"von\": \"anreg.aus\", \"nach\": \"gleichfrei.x\"}") }

fn saite_spitze(j: &str) -> f32 {
    let mut p = lade(j);
    p.note_an(57, 1.0);
    let x: Vec<f32> = (0..24_000).map(|_| p.sample()).collect();
    x.iter().fold(0.0f32, |m, v| m.max(v.abs()))
}

#[test]
fn saite_attack_does_not_need_the_limiter() {
    let (neu, alt) = (saite_spitze(&ohne_begrenzer(SAITE)), saite_spitze(&ohne_begrenzer(&saite_alt())));
    println!("MESS saite attack peak without the limiter: filtered exciter {neu:.3}, old white exciter {alt:.3}");
    assert!(neu < 1.0, "the limiter would still have to work: {neu}");
    assert!(alt > 1.2, "Fehlerfall: the old exciter must overshoot without the limiter: {alt}");
}

// ---- vocoder: sibilance at unity ---------------------------------------------------------------------------------

fn vocoder_8k(j: &str) -> f64 {
    let x = rausch(8192 * 12, 0.1, 99);
    let mut p = lade(j);
    let y: Vec<f32> = x.iter().map(|v| { p.setze_eingang(*v, *v); p.sample_stereo().0 }).collect();
    10.0 * (band(&y[8192..], 7_000.0, 9_000.0) / band(&x[8192..], 7_000.0, 9_000.0)).log10()
}

#[test]
fn vocoder_robot_sibilance_stays_near_unity() {
    let alt = ersetze(&ersetze(VOCODER, r#""nr": 2, "min": 0, "max": 0.4}"#, r#""nr": 2, "min": 0, "max": 1}"#), r#""b": 0.15}"#, r#""b": 0.1}"#);
    let (neu, vor) = (vocoder_8k(VOCODER), vocoder_8k(&alt));
    println!("MESS vocoder 7..9 kHz band re input at the default knobs: new {neu:.1} dB, old {vor:.1} dB");
    assert!(neu.abs() < 3.0, "new: {neu:.1} dB");
    assert!(vor > 4.0, "Fehlerfall: the old default was hissy: {vor:.1} dB");
}

// ---- takt-pump: hard duck on the beat, recovery over the beat ------------------------------------------------------

/// mean gain (dB, output rms / input rms) per tenth of a beat, folded over 14 beats of noise at 120 BPM
fn pump_form(j: &str) -> Vec<f32> {
    let mut p = lade(j);
    p.setze_regler(1, 1.0);
    p.setze_takt(0.0, 2.0 / SR as f64);
    let x = rausch(8 * 48_000, 0.3, 7);
    let y: Vec<f32> = x.iter().map(|v| { p.setze_eingang(*v, *v); p.sample_stereo().0 }).collect();
    let zehntel = 2_400;
    let mut summe = vec![(0.0f32, 0.0f32); 10];
    for (i, (a, b)) in x.chunks(zehntel).zip(y.chunks(zehntel)).enumerate().skip(10 * 2 * 1) {
        if a.len() == zehntel { let e = &mut summe[i % 10]; e.0 += rms(b).powi(2); e.1 += rms(a).powi(2); }
    }
    summe.iter().map(|(o, i)| 10.0 * (o / i).log10()).collect()
}

#[test]
fn takt_pump_ducks_on_the_beat_and_recovers_over_the_beat() {
    let alt = ersetze(&ersetze(PUMP, r#""form": 2, "takt": 1}"#, r#""form": 1, "takt": 2}"#), r#"{"von": "fall1.aus", "nach": "key.a"}"#, r#"{"von": "lfo.aus", "nach": "key.a"}"#);
    let (neu, vor) = (pump_form(PUMP), pump_form(&alt));
    let fmt = |v: &[f32]| v.iter().map(|g| format!("{g:+.1}")).collect::<Vec<_>>().join(" ");
    println!("MESS pump gain by beat tenth (dB): new {} | old {}", fmt(&neu), fmt(&vor));
    // new: the lowest gain is within the first two tenths, the gain then rises monotonically (0.3 dB slack) to a clear recovery
    let (imin, _) = neu.iter().enumerate().fold((0, f32::MAX), |m, (i, g)| if *g < m.1 { (i, *g) } else { m });
    assert!(imin <= 1, "lowest gain at tenth {imin}");
    assert!(neu[2..].windows(2).all(|w| w[1] >= w[0] - 0.3), "recovery is not monotone: {neu:?}");
    assert!(neu[9] - neu[imin] > 6.0, "recovery only {:.1} dB", neu[9] - neu[imin]);
    // Fehlerfall: the old shape was a symmetric dip that ducks again before the next beat (pre-duck): its last tenth is far below its maximum
    let maxv = vor.iter().cloned().fold(f32::MIN, f32::max);
    assert!(maxv - vor[9] > 3.0, "old shape must pre-duck: max {maxv:.1}, last {:.1}", vor[9]);
}

// ---- phaser: the feedback end of the range stays below full scale ------------------------------------------------

/// pink noise (Paul Kellet's filter) scaled to the given RMS
fn rosa(n: usize, rms_soll: f32, seed: u32) -> Vec<f32> {
    let w = rausch(n, 1.0, seed);
    let (mut b0, mut b1, mut b2, mut b3, mut b4, mut b5, mut b6) = (0.0f32, 0.0f32, 0.0f32, 0.0f32, 0.0f32, 0.0f32, 0.0f32);
    let y: Vec<f32> = w.iter().map(|&x| {
        b0 = 0.99886 * b0 + x * 0.0555179; b1 = 0.99332 * b1 + x * 0.0750759; b2 = 0.96900 * b2 + x * 0.1538520;
        b3 = 0.86650 * b3 + x * 0.3104856; b4 = 0.55000 * b4 + x * 0.5329522; b5 = -0.7616 * b5 - x * 0.0168980;
        let o = b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * 0.5362; b6 = x * 0.115926; o
    }).collect();
    let g = rms_soll / rms(&y[4800..]);
    y.iter().map(|v| v * g).collect()
}

/// peak of the phaser on 6 s of pink noise (RMS -20 dB, like the audit) at the given feedback knob
fn phaser_spitze(j: &str, fb: f32) -> f32 {
    let mut p = lade(j);
    p.setze_regler(2, fb);
    let x = rosa(6 * 48_000, 0.1, 3);
    let y: Vec<f32> = x.iter().map(|v| { p.setze_eingang(*v, *v); let (l, r) = p.sample_stereo(); l.abs().max(r.abs()) }).collect();
    y.iter().fold(0.0f32, |m, v| m.max(*v))
}

#[test]
fn phaser_feedback_range_end_stays_below_full_scale() {
    let alt = ersetze(PHASER, r#""nr": 2, "min": -0.6, "max": 0.6}"#, r#""nr": 2, "min": -0.9, "max": 0.9}"#);
    let (neu_p, neu_m, alt_p, alt_m) = (phaser_spitze(PHASER, 1.0), phaser_spitze(PHASER, 0.0), phaser_spitze(&alt, 1.0), phaser_spitze(&alt, 0.0));
    println!("MESS phaser peak on pink noise at feedback knob 1 / 0: new {neu_p:.3} / {neu_m:.3}, old {alt_p:.3} / {alt_m:.3}");
    assert!(neu_p < 1.0 && neu_m < 1.0, "new range end: {neu_p} / {neu_m}");
    assert!(alt_p >= 1.0 || alt_m >= 1.0, "Fehlerfall: the old range end must overshoot on pink noise: {alt_p} / {alt_m}");
}

// ---- roehre: the loudness tracks the drive -------------------------------------------------------------------------

fn roehre_gewinn_db(j: &str, knob1: f32) -> f32 {
    let x = rausch(48_000 * 2, 0.1, 5);
    let mut p = lade(j);
    p.setze_regler(1, knob1);
    let y: Vec<f32> = x.iter().map(|v| { p.setze_eingang(*v, *v); p.sample_stereo().0 }).collect();
    20.0 * (rms(&y[4_800..]) / rms(&x[4_800..])).log10()
}

#[test]
fn fx_roehre_gain_stays_within_a_few_db_over_the_drive_range() {
    let alt = ersetze(ROEHRE, r#""nr": 1, "min": 1, "max": 0.056, "log": 1}"#, r#""nr": 1, "min": 1, "max": 0.25}"#);
    let g = |j: &str| [0.0, 0.5, 1.0].map(|k| roehre_gewinn_db(j, k));
    let (neu, vor) = (g(ROEHRE), g(&alt));
    println!("MESS fx-roehre net gain at drive knob 0 / 0.5 / 1 on noise (dB): new {:+.1} {:+.1} {:+.1}, old {:+.1} {:+.1} {:+.1}", neu[0], neu[1], neu[2], vor[0], vor[1], vor[2]);
    assert!(neu.iter().all(|g| *g <= 4.0), "new: {neu:?}");
    assert!(vor[2] > 8.0, "Fehlerfall: the old gain at full drive: {:.1}", vor[2]);
}

// ---- gated-hall-snare: no doubled dry path ----------------------------------------------------------------------------

fn snare_spitze(j: &str) -> f32 {
    // the renderer's pattern: A2 C#3 E3 A3 at 0.5 s each, then the chord for 1.5 s, then 1.5 s of tail
    let mut p = lade(j);
    let mut pk = 0.0f32;
    let mut spiele = |p: &mut Programm, s: f32| for _ in 0..(s * SR) as usize { let (l, r) = p.sample_stereo(); pk = pk.max(l.abs()).max(r.abs()); };
    for n in [45u8, 49, 52, 57] { p.note_an(n, 0.8); spiele(&mut p, 0.5); p.note_aus(n); }
    for n in [45u8, 49, 52, 57] { p.note_an(n, 0.8); }
    spiele(&mut p, 1.5);
    p.alle_aus();
    spiele(&mut p, 1.5);
    pk
}

#[test]
fn gated_hall_snare_does_not_clip() {
    let alt = ersetze(&ersetze(SNARE, r#"{"id": "level", "art": "mul", "b": 0.6}"#, r#"{"id": "level", "art": "mul", "b": 0.4}"#),
        "    {\"von\": \"key.aus\", \"nach\": \"gate.kl\"},\n", "    {\"von\": \"key.aus\", \"nach\": \"gate.kl\"},\n    {\"von\": \"level.aus\", \"nach\": \"aus.x\"},\n");
    let (neu, vor) = (snare_spitze(SNARE), snare_spitze(&alt));
    println!("MESS gated-hall-snare hit peak: new {neu:.3}, old (dry path doubled) {vor:.3}");
    assert!(neu < 0.9, "{neu}");
    assert!(vor > 1.0, "Fehlerfall: the old graph clipped: {vor}");
}

// ---- bassmusik: pwm 0 keeps the held chord free of DC ------------------------------------------------------------------

fn bass_dc(j: &str) -> f32 {
    let mut p = lade(j);
    for n in [33u8, 40, 45] { p.note_an(n, 1.0); }
    let x: Vec<f32> = (0..48_000).map(|_| p.sample()).collect();
    (x[12_000..].iter().sum::<f32>() / (x.len() - 12_000) as f32).abs()
}

#[test]
fn bassmusik_held_chord_has_no_dc() {
    let alt = ersetze(BASS, r#""pwm": 0}"#, r#""pwm": 0.3}"#);
    let (neu, vor) = (bass_dc(BASS), bass_dc(&alt));
    println!("MESS bassmusik held chord DC: new {neu:.5} ({:.1} dBFS), old pwm 0.3 {vor:.5} ({:.1} dBFS)", 20.0 * neu.max(1e-9).log10(), 20.0 * vor.log10());
    assert!(neu < 0.0032, "{neu}");
    assert!(vor > 0.01, "Fehlerfall: the old pwm left DC: {vor}");
}
