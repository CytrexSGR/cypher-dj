//! Die Beispielgraphen aus Slice 2: laden, klingen, still ohne Note, endlich an allen Reglerenden, Regler wirken.
#[path = "sampler_helpers/mod.rs"]
mod sampler_hilfe;
use baukasten_dsp::{uebersetze, Programm, REGLER};

const SR: f32 = 48_000.0;
const PAD: &str = include_str!("../demos/juno-pad.json");
const PAD_HALL: &str = include_str!("../demos/juno-pad-hall.json");
const PAD_ECHO: &str = include_str!("../demos/juno-pad-echo.json");
const PAD_DYN: &str = include_str!("../demos/juno-pad-dyn.json");
const LEAD: &str = include_str!("../demos/lead.json");

fn lade(j: &str) -> Programm { uebersetze(j, SR).unwrap_or_else(|e| panic!("{e}")) }
fn rms(x: &[f32]) -> f32 { (x.iter().map(|v| v * v).sum::<f32>() / x.len() as f32).sqrt() }
/// Helligkeit: rms der ersten Differenz relativ zum rms (steigt mit dem Anteil hoher Frequenzen)
fn hell(x: &[f32]) -> f32 { rms(&x.windows(2).map(|w| w[1] - w[0]).collect::<Vec<_>>()) / rms(x).max(1e-9) }

fn akkord(j: &str, regler: &[(usize, f32)]) -> Vec<f32> {
    let mut p = lade(j);
    for (n, w) in regler { p.setze_regler(*n, *w); }
    for n in [45u8, 52, 57, 61] { p.note_an(n, 0.8); }
    (0..48_000).map(|_| p.sample()).collect()
}

#[test]
fn beide_laden_mit_namen_fuer_alle_regler() {
    for j in [PAD, PAD_HALL, PAD_ECHO, PAD_DYN, LEAD] {
        let p = lade(j);
        assert_eq!(p.regler_namen.iter().map(|(n, _)| *n).collect::<Vec<_>>(), (1..=8).collect::<Vec<_>>(), "{}", p.name);
    }
    assert_eq!(lade(PAD).stimmen, 8);
    assert_eq!(lade(LEAD).stimmen, 1);
}

#[test]
fn still_ohne_note_hoerbar_mit_note() {
    for j in [PAD, PAD_HALL, PAD_ECHO, PAD_DYN, LEAD] {
        let mut p = lade(j);
        assert!((0..48_000).all(|_| p.sample() == 0.0), "ohne Note still: {}", p.name);
        let x = akkord(j, &[]);
        let r = 20.0 * rms(&x[24_000..]).log10();
        assert!(r > -40.0 && r < -6.0, "{}: {r:.1} dB", p.name);
    }
}

#[test]
fn endlich_an_allen_reglerenden_ohne_rettung() {
    for j in [PAD, PAD_HALL, PAD_ECHO, PAD_DYN, LEAD] {
        for weg in [0.0f32, 1.0] {
            let mut p = lade(j);
            for n in 1..=REGLER { p.setze_regler(n, weg); }
            for n in [36u8, 48, 60, 72, 84, 96] { p.note_an(n, 1.0); }
            let x: Vec<f32> = (0..48_000).map(|_| p.sample()).collect();
            assert!(x.iter().all(|v| v.is_finite() && v.abs() < 4.0), "{} Regler {weg}", p.name);
            assert_eq!(p.rettungen, 0, "{} Regler {weg}", p.name);
        }
        // jeden Block alle Regler umwerfen
        let mut p = lade(j);
        for n in [40u8, 47, 52] { p.note_an(n, 1.0); }
        for b in 0..400 {
            for n in 1..=REGLER { p.setze_regler(n, if (b + n) % 2 == 0 { 0.0 } else { 1.0 }); }
            for _ in 0..256 { assert!(p.sample().is_finite()); }
        }
        assert_eq!(p.rettungen, 0);
    }
}

#[test]
fn regler_1_macht_heller() {
    for j in [PAD, LEAD] {
        let (zu, auf) = (hell(&akkord(j, &[(1, 0.1)])[24_000..]), hell(&akkord(j, &[(1, 0.9)])[24_000..]));
        assert!(auf > 1.5 * zu, "{}: zu {zu:.3}, auf {auf:.3}", lade(j).name);
    }
}

#[test]
fn lead_ist_einstimmig_mit_glide() {
    // Mittlere Grundfrequenz der ersten 100 ms nach dem Sprung A3 → A4: mit Glide (τ 40 ms) rechnerisch 359 Hz, ohne 440
    let mittel = |j: &str| {
        let mut p = lade(j);
        p.setze_regler(3, 0.0); // Sync-Oszillator auf den Grundton, sonst zählt der Nulldurchgang dessen Obertöne
        p.note_an(57, 1.0);
        for _ in 0..9600 { p.sample(); }
        p.note_an(69, 1.0);
        assert_eq!(p.stimme(0), (69, true));
        let x: Vec<f32> = (0..4800).map(|_| p.sample()).collect();
        let null = x.windows(2).filter(|w| w[0] < 0.0 && w[1] >= 0.0).count();
        null as f32 * 10.0
    };
    let mit = mittel(LEAD);
    let ohne = mittel(&LEAD.replace(r#""zeit": 0.04"#, r#""zeit": 0"#));
    assert!((300.0..420.0).contains(&mit), "mit Glide {mit} Hz");
    assert!(ohne >= 430.0, "ohne Glide {ohne} Hz");
}

#[test]
fn lead_erste_note_nach_dem_laden_ohne_glide() {
    // Grundfrequenz der ersten 20 ms nach dem Laden, Ziel A3 = 220 Hz; ohne die Kante note.erste → glide.setzen gleitet
    // der Lead aus 0 Hz hoch (Plan-Review F4: 50 Hz im ersten Fenster)
    let erstes_fenster = |j: &str| {
        let mut p = lade(j);
        p.setze_regler(3, 0.0);
        p.note_an(57, 1.0);
        let x: Vec<f32> = (0..960).map(|_| p.sample()).collect();
        x.windows(2).filter(|w| w[0] < 0.0 && w[1] >= 0.0).count() as f32 * 50.0
    };
    let mit = erstes_fenster(LEAD);
    let ohne = erstes_fenster(&LEAD.replace("    {\"von\": \"note.erste\", \"nach\": \"glide.setzen\"},\n", ""));
    assert!(mit >= 150.0, "erste Note {mit} Hz");
    assert!(ohne <= 100.0, "Gegenprobe ohne setzen {ohne} Hz");
}

#[test]
fn zuruecksetzen_klingt_wie_frisch_geladen() {
    // juno-pad-hall fehlt hier mit Absicht (D6): hall_dsp::Hall::reset setzt Zufallszustand und Phasen der Fahnen nicht
    // zurück, der Hall ist nach zuruecksetzen still, nicht gleich frisch (gemessen 4,1e-2). Geprüft in tests/arten.rs.
    // jeder Zustand (Oszillatoren, Rauschen, LFO, Filter, Sättigung, Glätter, Hüllkurven, Stimmen) muss zurück
    let lauf = |p: &mut Programm| {
        let mut x = Vec::new();
        for n in [45u8, 52, 57] { p.note_an(n, 0.8); }
        for _ in 0..24_000 { x.push(p.sample()); }
        p.alle_aus();
        for _ in 0..12_000 { x.push(p.sample()); }
        x
    };
    for j in [PAD, LEAD] {
        let frisch = lauf(&mut lade(j));
        let mut p = lade(j);
        lauf(&mut p);
        p.zuruecksetzen();
        assert!(lauf(&mut p) == frisch, "{}", p.name);
    }
}

/// S7: the three new effect examples translate, name their knobs and stay finite on 2 s of noise at every knob extreme
#[test]
fn s7_effect_examples_run_finite_on_noise() {
    for j in [include_str!("../demos/fx-phaser.json"), include_str!("../demos/fx-flanger.json"), include_str!("../demos/fx-lofi-sp1200.json")] {
        for weg in [0.0f32, 0.5, 1.0] {
            let mut p = lade(j);
            assert!(p.hat_eingang() && p.regler_namen.len() >= 2, "{}", p.name);
            for n in 1..=REGLER { p.setze_regler(n, weg); }
            let mut s = 0x9E37_79B9_7F4A_7C15u64;
            let mut peak = 0.0f32;
            for _ in 0..96_000 {
                s ^= s << 13; s ^= s >> 7; s ^= s << 17;
                let x = 0.5 * ((s >> 11) as f64 / (1u64 << 52) as f64 - 1.0) as f32;
                p.setze_eingang(x, -x);
                let (l, r) = p.sample_stereo();
                assert!(l.is_finite() && r.is_finite());
                peak = peak.max(l.abs()).max(r.abs());
            }
            assert_eq!(p.rettungen, 0, "{} knobs {weg}", p.name);
            assert!(peak > 0.01 && peak < 8.0, "{} knobs {weg}: peak {peak}", p.name);
        }
    }
}

const ROEHRE_LEAD: &str = include_str!("../demos/roehre-lead.json");
const FX_ROEHRE: &str = include_str!("../demos/fx-roehre.json");

/// S8: roehre-lead loads, names its knobs, is silent without a note, and at every knob end the chord has an RMS between
/// -40 and -6 dB and |v| < 4 (C2: the level node of the patch carries the large-signal level of the triode)
#[test]
fn s8_roehre_lead_bounds_at_knob_ends() {
    let p = lade(ROEHRE_LEAD);
    assert_eq!(p.stimmen, 4);
    assert_eq!(p.regler_namen.iter().map(|(n, _)| *n).collect::<Vec<_>>(), vec![1, 2]);
    let mut leer = lade(ROEHRE_LEAD);
    assert!((0..48_000).all(|_| leer.sample() == 0.0), "silent without a note");
    for (a, b) in [(0.0f32, 0.0f32), (0.0, 1.0), (1.0, 0.0), (1.0, 1.0), (0.5, 0.5)] {
        let x = akkord(ROEHRE_LEAD, &[(1, a), (2, b)]);
        let r = 20.0 * rms(&x[24_000..]).log10();
        let pk = x.iter().fold(0.0f32, |m, v| m.max(v.abs()));
        println!("MESS roehre-lead knobs ({a}, {b}): rms {r:.1} dB, peak {pk:.3}");
        assert!(r > -40.0 && r < -6.0, "knobs ({a}, {b}): {r:.1} dB");
        assert!(x.iter().all(|v| v.is_finite() && v.abs() < 4.0), "knobs ({a}, {b})");
    }
    // the drive knob compresses the waveform: the crest factor (peak / rms) of the chord falls
    let crest = |w: f32| { let x = akkord(ROEHRE_LEAD, &[(1, w), (2, 0.6)]); let x = &x[24_000..]; x.iter().fold(0.0f32, |m, v| m.max(v.abs())) / rms(x) };
    let (zu, auf) = (crest(0.0), crest(1.0));
    println!("MESS roehre-lead crest factor drive 0 {zu:.3}, drive 1 {auf:.3}");
    assert!(auf < 0.85 * zu, "drive 0: {zu:.3}, drive 1: {auf:.3}");
}

/// S8: fx-roehre on 2 s of noise at the knob ends: finite, no rescue, not silent, |v| < 4
#[test]
fn s8_fx_roehre_finite_on_noise() {
    for (a, b) in [(0.0f32, 0.0f32), (0.0, 1.0), (1.0, 0.0), (1.0, 1.0), (0.5, 0.5)] {
        let mut p = lade(FX_ROEHRE);
        assert!(p.hat_eingang() && p.regler_namen.len() == 2, "{}", p.name);
        p.setze_regler(1, a);
        p.setze_regler(2, b);
        let mut s = 0x9E37_79B9_7F4A_7C15u64;
        let mut peak = 0.0f32;
        for _ in 0..96_000 {
            s ^= s << 13; s ^= s >> 7; s ^= s << 17;
            let x = 0.5 * ((s >> 11) as f64 / (1u64 << 52) as f64 - 1.0) as f32;
            p.setze_eingang(x, -x);
            let (l, r) = p.sample_stereo();
            assert!(l.is_finite() && r.is_finite());
            peak = peak.max(l.abs()).max(r.abs());
        }
        println!("MESS fx-roehre knobs ({a}, {b}): peak {peak:.3}");
        assert_eq!(p.rettungen, 0, "knobs ({a}, {b})");
        assert!(peak > 0.01 && peak < 4.0, "knobs ({a}, {b}): peak {peak}");
    }
}

#[test]
fn fx_bandecho_ist_ein_effekt_mit_latenz_null_und_endlich() {
    // S6: send graph for fx/3, fx/4 (100 % wet, tape-like echo with wow); must have an input, no latency, finite output
    let mut p = lade(include_str!("../demos/fx-bandecho.json"));
    assert!(p.hat_eingang());
    assert_eq!(p.latenz(), 0);
    let mut z = 12345u32;
    let mut rausch = || { z = z.wrapping_mul(1664525).wrapping_add(1013904223); (z >> 8) as f32 / 8_388_608.0 - 1.0 };
    let mut spitze = 0.0f32;
    for _ in 0..96_000 {
        p.setze_eingang(0.5 * rausch(), 0.5 * rausch());
        let (l, r) = p.sample_stereo();
        assert!(l.is_finite() && r.is_finite());
        spitze = spitze.max(l.abs()).max(r.abs());
    }
    assert!(spitze > 0.05 && spitze < 8.0, "peak {spitze}");   // positive control: it sounds, and stays bounded
}

#[test]
fn fx_bandecho_gibt_nur_nass_zurueck() {
    // S6 send convention (D13): a return graph outputs wet only. The delay node itself outputs dry + mix * wet, so the
    // example must remove the dry part; measured before the fix: the impulse came out at ~1.0 in the first samples.
    let mut p = lade(include_str!("../demos/fx-bandecho.json"));
    let mut aus = Vec::new();
    for i in 0..24_000 {
        let x = if i == 0 { 0.5 } else { 0.0 };
        p.setze_eingang(x, x);
        aus.push(p.sample_stereo().0);
    }
    let trocken = aus[..1000].iter().fold(0.0f32, |m, v| m.max(v.abs()));
    let echo = aus[16_000..17_700].iter().fold(0.0f32, |m, v| m.max(v.abs()));   // 350 ms = 16 800 samples, wow +-72
    assert!(trocken < 1e-4, "dry part leaks: {trocken}");
    assert!(echo > 0.1, "first echo missing: {echo}");   // positive control: the wet path sounds
}

// ---- S9: key inputs ----------------------------------------------------------------------------------------------

const SNARE: &str = include_str!("../demos/gated-hall-snare.json");
const PUMP: &str = include_str!("../demos/fx-takt-pump.json");

fn db_of(x: &[f32]) -> f32 { 20.0 * rms(x).max(1e-9).log10() }

/// One snare hit (note held 0.5 s, as in the renderer), 2.5 s of output, left side, with the given knobs
fn snare_hit(knobs: &[(usize, f32)]) -> Vec<f32> {
    let mut p = lade(SNARE);
    for (n, w) in knobs { p.setze_regler(*n, *w); }
    p.note_an(45, 1.0);
    let mut x = Vec::new();
    for i in 0..120_000 {
        if i == 24_000 { p.note_aus(45); }
        x.push(p.sample_stereo().0);
    }
    assert_eq!(p.rettungen, 0);
    x
}

#[test]
fn s9_gated_hall_snare_loads_is_silent_without_note_and_bounded_at_knob_ends() {
    let mut p = lade(SNARE);
    assert_eq!(p.regler_namen.len(), 2);
    assert!((0..48_000).all(|_| p.sample() == 0.0), "silent without a note");
    for k1 in [0.0f32, 1.0] {
        for k2 in [0.0f32, 1.0] {
            let x = snare_hit(&[(1, k1), (2, k2)]);
            assert!(x.iter().all(|v| v.is_finite() && v.abs() < 4.0), "knobs {k1} {k2}");
            let hit = db_of(&x[0..9_600]);
            assert!(hit > -30.0 && hit < -3.0, "knobs {k1} {k2}: hit RMS {hit:.1} dB");
        }
    }
}

#[test]
fn s9_gated_hall_snare_key_gain_sets_the_tail_length() {
    // the gate is keyed by the dry snare: a higher key gain keeps it open longer, so more of the hall tail is heard
    let (kurz, lang) = (snare_hit(&[(1, 0.2), (2, 1.0)]), snare_hit(&[(1, 0.8), (2, 1.0)]));
    let w = |x: &[f32]| db_of(&x[7_200..16_800]); // 0.15 .. 0.35 s after the hit
    println!("MESS snare tail 0.15-0.35 s: knob 0.2 {:.1} dB, knob 0.8 {:.1} dB", w(&kurz), w(&lang));
    assert!(w(&lang) > w(&kurz) + 6.0, "long {:.1} dB vs short {:.1} dB", w(&lang), w(&kurz));
    // control: the hit itself (first 50 ms) is the same, the gain only changes the tail
    assert!((db_of(&kurz[0..2_400]) - db_of(&lang[0..2_400])).abs() < 1.0);
}

/// deterministic white noise of RMS 0.3 (xorshift, uniform scaled)
fn rauschen(n: usize) -> Vec<f32> {
    let mut s = 0x2545F491u32;
    (0..n).map(|_| { s ^= s << 13; s ^= s >> 17; s ^= s << 5; ((s as f32 / u32::MAX as f32) * 2.0 - 1.0) * 0.3 * 3f32.sqrt() }).collect()
}

/// pump gain per 10 ms window (output RMS / input RMS, linear) on 8 s of noise at 120 BPM
fn pump_gain(knob: f32) -> Vec<f32> {
    let mut p = lade(PUMP);
    p.setze_regler(1, knob);
    p.setze_takt(0.0, 2.0 / 48_000.0); // 120 BPM: 2 beats per second
    let x = rauschen(8 * 48_000);
    let y: Vec<f32> = x.iter().map(|v| { p.setze_eingang(*v, *v); p.sample_stereo().0 }).collect();
    assert_eq!(p.rettungen, 0);
    x.chunks(480).zip(y.chunks(480)).map(|(a, b)| rms(b) / rms(a)).collect()
}

#[test]
fn s9_takt_pump_ducks_once_per_beat() {
    let g = pump_gain(1.0);
    let g = &g[100..]; // skip the first second
    let m = g.iter().sum::<f32>() / g.len() as f32;
    let ac = |lag: usize| g[..g.len() - lag].iter().zip(&g[lag..]).map(|(a, b)| (a - m) * (b - m)).sum::<f32>();
    let (best, _) = (20..=150).map(|l| (l, ac(l))).fold((0, f32::MIN), |b, c| if c.1 > b.1 { c } else { b });
    // per-beat depth: max/min of the 10 ms gain inside each 0.5 s beat, median
    let mut tiefen: Vec<f32> = g.chunks_exact(50).map(|b| {
        let (hi, lo) = (b.iter().cloned().fold(f32::MIN, f32::max), b.iter().cloned().fold(f32::MAX, f32::min));
        20.0 * (hi / lo).log10()
    }).collect();
    tiefen.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let tiefe = tiefen[tiefen.len() / 2];
    println!("MESS pump: autocorrelation maximum at {} ms, median depth {tiefe:.1} dB", best * 10);
    assert!((480..=520).contains(&(best * 10)), "autocorrelation maximum at {} ms", best * 10);
    assert!(tiefe >= 6.0, "depth {tiefe:.1} dB");
}

#[test]
fn s9_takt_pump_depth_knob_zero_is_flat() {
    let g = pump_gain(0.0);
    let g = &g[100..];
    let (hi, lo) = (g.iter().cloned().fold(f32::MIN, f32::max), g.iter().cloned().fold(f32::MAX, f32::min));
    let tiefe = 20.0 * (hi / lo).log10();
    println!("MESS pump knob 0: gain spread {tiefe:.3} dB");
    assert!(tiefe < 0.5, "knob 0 must not pump: {tiefe:.3} dB");
}

#[test]
fn s9_takt_pump_is_bounded_and_named() {
    for k in [0.0f32, 0.5, 1.0] {
        let g = pump_gain(k);
        // knob 1 also drives the make-up gain 1..4 after the compressor (level compensation for the ducking)
        assert!(g.iter().all(|v| v.is_finite() && *v <= 1.0001 * (1.0 + 3.0 * k) && *v > 0.0), "knob {k}");
    }
    assert_eq!(lade(PUMP).regler_namen.len(), 1);
}

const FX_VOCODER: &str = include_str!("../demos/fx-vocoder-robot.json");

/// S11: fx-vocoder-robot on 2 s of noise (mono, `(x, x)`: `(x, -x)` would cancel the mono modulator) at the knob ends:
/// finite, no rescue, not silent, peak between 0.01 and 8 (the file's bound, C10)
#[test]
fn s11_fx_vocoder_robot_finite_on_noise() {
    for (a, b) in [(0.0f32, 0.0f32), (0.0, 1.0), (1.0, 0.0), (1.0, 1.0), (0.5, 0.5)] {
        let mut p = lade(FX_VOCODER);
        assert!(p.hat_eingang() && p.regler_namen.iter().map(|(n, _)| *n).collect::<Vec<_>>() == vec![1, 2], "{}", p.name);
        p.setze_regler(1, a);
        p.setze_regler(2, b);
        let mut s = 0x9E37_79B9_7F4A_7C15u64;
        let mut peak = 0.0f32;
        for _ in 0..96_000 {
            s ^= s << 13; s ^= s >> 7; s ^= s << 17;
            let x = 0.5 * ((s >> 11) as f64 / (1u64 << 52) as f64 - 1.0) as f32;
            p.setze_eingang(x, x);
            let (l, r) = p.sample_stereo();
            assert!(l.is_finite() && r.is_finite());
            peak = peak.max(l.abs()).max(r.abs());
        }
        println!("MESS fx-vocoder-robot knobs ({a}, {b}): peak {peak:.3}");
        assert_eq!(p.rettungen, 0, "knobs ({a}, {b})");
        assert!(peak > 0.01 && peak < 8.0, "knobs ({a}, {b}): peak {peak}");
    }
}

/// S11: the root knob moves the carrier: the pitch of the vocoded noise changes (zero crossings of the low-passed output are
/// not meaningful for a vocoder, so compare the spectra: the two knob ends must give different outputs)
#[test]
fn s11_fx_vocoder_robot_root_knob_acts() {
    let lauf = |w: f32| {
        let mut p = lade(FX_VOCODER);
        p.setze_regler(1, w);
        p.setze_regler(2, 0.0); // the sibilance path is the same for both roots and would hide the carrier
        let mut s = 0x1234_5678_9ABC_DEF1u64;
        (0..48_000).map(|_| {
            s ^= s << 13; s ^= s >> 7; s ^= s << 17;
            let x = 0.5 * ((s >> 11) as f64 / (1u64 << 52) as f64 - 1.0) as f32;
            p.setze_eingang(x, x);
            p.sample_stereo().0
        }).collect::<Vec<f32>>()
    };
    let (a, b) = (lauf(0.2), lauf(0.8));
    let d: f32 = a.iter().zip(&b).map(|(x, y)| (x - y).abs()).sum::<f32>() / a.len() as f32;
    assert!(d > 0.2 * rms(&a), "knob 1 changes nothing: mean difference {d}, rms {}", rms(&a));
}

/// S11: the patch is what its description says: root knob 55..220 Hz (log), saws at root, x1.5 and x2, all three summed into the carrier
#[test]
fn s11_fx_vocoder_robot_structure() {
    let j: serde_json::Value = serde_json::from_str(FX_VOCODER).unwrap();
    let knoten = |id: &str| j["knoten"].as_array().unwrap().iter().find(|k| k["id"] == id).unwrap_or_else(|| panic!("node {id}")).clone();
    let root = knoten("root");
    assert_eq!((root["min"].as_f64(), root["max"].as_f64(), root["log"].as_f64()), (Some(55.0), Some(220.0), Some(1.0)));
    assert_eq!(knoten("quinte")["b"].as_f64(), Some(1.5));
    assert_eq!(knoten("oktave")["b"].as_f64(), Some(2.0));
    let kanten: Vec<(String, String)> = j["kanten"].as_array().unwrap().iter().map(|k| (k["von"].as_str().unwrap().to_string(), k["nach"].as_str().unwrap().to_string())).collect();
    for (von, nach) in [("s1.aus", "traeger.a"), ("s2.aus", "traeger.b"), ("s3.aus", "traeger.c"), ("quinte.aus", "s2.hz"), ("oktave.aus", "s3.hz"), ("root.aus", "s1.hz"), ("traeger.aus", "voc.x"), ("zisch.aus", "voc.zisch")] {
        assert!(kanten.contains(&(von.to_string(), nach.to_string())), "edge {von} -> {nach}");
    }
}

// ---- S10: sampler-fairlight ----
const SAMPLER_FAIRLIGHT: &str = include_str!("../demos/sampler-fairlight.json");

/// A sample root holding the generated probe (nothing is stored in the repo, S10 C1).
fn probe_wurzel() -> std::path::PathBuf {
    // written once: the tests of this binary run in parallel and must not read a half-written file
    static W: std::sync::OnceLock<std::path::PathBuf> = std::sync::OnceLock::new();
    W.get_or_init(|| {
        let w = std::env::temp_dir().join(format!("bk-s10-bsp-{}", std::process::id()));
        std::fs::create_dir_all(&w).unwrap();
        std::fs::write(w.join("orchester-schlag.f32"), baukasten_dsp::proben::bytes(&baukasten_dsp::proben::orchester_schlag(48_000.0))).unwrap();
        // S22: sampler-fairlight reads the hit as three detune slices.
        std::fs::write(w.join("orchester-schlag-schichten.f32"), baukasten_dsp::proben::bytes(&baukasten_dsp::proben::orchester_schlag_schichten(48_000.0))).unwrap();
        w
    }).clone()
}

fn lade_sampler() -> Programm {
    baukasten_dsp::uebersetze_mit_wurzel(SAMPLER_FAIRLIGHT, SR, Some(&probe_wurzel())).unwrap_or_else(|e| panic!("{e}"))
}

fn sampler_akkord(regler: &[(usize, f32)]) -> Vec<(f32, f32)> {
    let mut p = lade_sampler();
    for (n, w) in regler { p.setze_regler(*n, *w); }
    for n in [45u8, 52, 57, 61] { p.note_an(n, 0.8); }
    (0..48_000).map(|_| p.sample_stereo()).collect()
}

fn rms_l(x: &[(f32, f32)]) -> f32 { rms(&x.iter().map(|v| v.0).collect::<Vec<_>>()) }

#[test]
fn s10_sampler_fairlight_loads_names_knobs_and_needs_a_root() {
    let p = lade_sampler();
    assert_eq!(p.stimmen, 4);
    assert_eq!(p.regler_namen.iter().map(|(n, _)| *n).collect::<Vec<_>>(), vec![1, 2, 3]);
    assert!(matches!(uebersetze(SAMPLER_FAIRLIGHT, SR), Err(baukasten_dsp::Fehler::Datei { .. })), "no root, no file access");
    let mut leer = lade_sampler();
    assert!((0..48_000).all(|_| leer.sample() == 0.0), "silent without a note");
}

#[test]
fn s10_sampler_fairlight_bounded_at_knob_ends_and_not_silent() {
    for (a, b) in [(0.0f32, 0.0f32), (0.0, 1.0), (1.0, 0.0), (1.0, 1.0), (0.5, 0.5), (0.5, 0.66), (0.5, 0.67)] {
        let x = sampler_akkord(&[(1, a), (2, b)]);
        // the hit decays fast: measure the first 0.25 s
        let r = 20.0 * rms_l(&x[..12_000]).log10();
        let pk = x.iter().fold(0.0f32, |m, v| m.max(v.0.abs()).max(v.1.abs()));
        println!("MESS sampler-fairlight knobs ({a}, {b}): rms {r:.1} dB, peak {pk:.3}");
        assert!(x.iter().all(|v| v.0.is_finite() && v.1.is_finite() && v.0.abs() < 4.0 && v.1.abs() < 4.0), "knobs ({a}, {b})");
        // knob 2 is a switch in its top third (rueck = -0.5 + 1.5 k >= 0.5 from k = 2/3), so the centre position plays forward;
        // reverse plays the quiet tail first: only the forward hit is held to the loudness band over the first 0.25 s
        if b < 0.6667 {
            assert!(r > -30.0 && r < -6.0, "knobs ({a}, {b}): {r:.1} dB");
            let rr = 20.0 * rms(&x[..12_000].iter().map(|v| v.1).collect::<Vec<_>>()).log10();
            assert!(rr > -30.0 && rr < -6.0, "knobs ({a}, {b}) right side: {rr:.1} dB");
        } else {
            assert!(r > -80.0, "knobs ({a}, {b}) silent: {r:.1} dB");
        }
        assert!(pk > 0.01, "knobs ({a}, {b}): peak {pk}");
    }
}

/// S22 (T4): the new knob 3 at both ends keeps the S10 loudness band, finite and not clipped to nothing.
#[test]
fn s22_sampler_fairlight_detune_ends_stay_in_the_loudness_band() {
    for k3 in [0.0f32, 1.0] {
        let x = sampler_akkord(&[(1, 0.5), (2, 0.5), (3, k3)]);
        let r = 20.0 * rms_l(&x[..12_000]).log10();
        let pk = x.iter().fold(0.0f32, |m, v| m.max(v.0.abs()).max(v.1.abs()));
        println!("MESS sampler-fairlight knob 3 = {k3}: rms {r:.1} dB, peak {pk:.3}");
        assert!(x.iter().all(|v| v.0.is_finite() && v.1.is_finite() && v.0.abs() < 4.0 && v.1.abs() < 4.0), "knob 3 = {k3}");
        assert!(r > -30.0 && r < -6.0, "knob 3 = {k3}: {r:.1} dB");
    }
}

#[test]
fn s10_sampler_fairlight_knobs_act() {
    // knob 2: reverse. Forward has its energy at the onset, reverse in the tail
    let vor = sampler_akkord(&[(1, 0.5), (2, 0.0)]);
    let rueck = sampler_akkord(&[(1, 0.5), (2, 1.0)]);
    let (v0, r0) = (rms_l(&vor[..960]), rms_l(&rueck[..960]));
    println!("MESS sampler-fairlight first 20 ms rms: forward {v0:.4}, reverse {r0:.4}");
    assert!(r0 < 0.25 * v0, "reverse must start quiet: forward {v0}, reverse {r0}");
    // knob 1: the hold rate. Low rate = more steps = more energy in the first difference relative to the level
    let niedrig = sampler_akkord(&[(1, 0.0), (2, 0.0)]);
    let hoch = sampler_akkord(&[(1, 1.0), (2, 0.0)]);
    let diff = niedrig.iter().zip(&hoch).map(|(a, b)| ((a.0 - b.0) as f64).powi(2)).sum::<f64>().sqrt() / (hoch.iter().map(|b| (b.0 as f64).powi(2)).sum::<f64>().sqrt());
    println!("MESS sampler-fairlight relative difference knob 1 low vs high: {diff:.3}");
    assert!(diff > 0.05, "rate knob changes the sound by only {diff}");
}

#[test]
fn s10_sampler_fairlight_reset_sounds_like_fresh() {
    let lauf = |p: &mut Programm| {
        for n in [45u8, 52] { p.note_an(n, 0.8); }
        let mut x: Vec<(f32, f32)> = (0..12_000).map(|_| p.sample_stereo()).collect();
        p.alle_aus();
        x.extend((0..12_000).map(|_| p.sample_stereo()));
        x
    };
    let frisch = lauf(&mut lade_sampler());
    let mut p = lade_sampler();
    lauf(&mut p);
    p.zuruecksetzen();
    assert!(lauf(&mut p) == frisch);
}

// ---- S22: knob 3 of sampler-fairlight makes the detune of the layers playable ----

/// C6 (MIDI 84) in Hz: the carrier of the side signal.
const C6_HZ: f64 = 1046.502_261_202_394_8;

/// Sample root for the detune measurement: a constant-level sine at the sampler's root frequency in three slices of 10 s
/// (30 s = `MAX_FRAMEN`), written under the old and the new file name so that one test runs against both graphs.
fn detune_wurzel() -> std::path::PathBuf {
    static W: std::sync::OnceLock<std::path::PathBuf> = std::sync::OnceLock::new();
    W.get_or_init(|| {
        let w = std::env::temp_dir().join(format!("bk-s22-detune-{}", std::process::id()));
        std::fs::create_dir_all(&w).unwrap();
        let sinus = sampler_hilfe::sinus(261.6256, 1_440_000, 0.5);
        sampler_hilfe::schreibe(&w, "orchester-schlag.f32", &sinus);
        sampler_hilfe::schreibe(&w, "orchester-schlag-schichten.f32", &sinus);
        w
    }).clone()
}

/// Side signal `L - R` of the sampler-fairlight graph with knob 1 at 1 (32 kHz hold, least imaging) and knob 3 at `k3`:
/// C6 held for 2.5 s (read step 4: one 10 s slice lasts exactly 2.5 s), analysed from 0.1 s to 2.3 s.
fn detune_seite(k3: f32) -> Vec<f64> {
    let mut p = baukasten_dsp::uebersetze_mit_wurzel(SAMPLER_FAIRLIGHT, SR, Some(&detune_wurzel())).unwrap_or_else(|e| panic!("{e}"));
    p.setze_regler(1, 1.0);
    p.setze_regler(3, k3);
    p.note_an(84, 0.8);
    let x: Vec<(f32, f32)> = (0..120_000).map(|_| p.sample_stereo()).collect();
    x[4_800..110_400].iter().map(|(l, r)| (*l - *r) as f64).collect()
}

/// The estimator negative control: synthetic two-tone sums with a known 1 / 3 / 9 cent detune must be hit within 0.1 cent
/// before any graph is judged by it. Same window length as the graph measurement.
fn detune_schaetzer_kontrolle() {
    for c in [1.0, 3.0, 9.0] {
        let m = sampler_hilfe::kontrolle_cent(C6_HZ, c, 105_600);
        println!("MESS estimator control: synthetic {c} cent -> {m:.4} cent");
        assert!((m - c).abs() <= 0.1, "estimator control: synthetic {c} cent measured as {m:.4}");
    }
}

#[test]
fn s22_detune_estimator_hits_synthetic_two_tones_within_a_tenth_of_a_cent() {
    detune_schaetzer_kontrolle();
    // the formula pair is its own inverse
    let d = sampler_hilfe::schwebung_hz(C6_HZ, 3.0);
    assert!((d - 3.63).abs() < 0.01, "3 cent at C6 is {d} Hz");
    assert!((sampler_hilfe::cent_aus_schwebung(C6_HZ, d) - 3.0).abs() < 1e-9);
}

#[test]
fn s22_sampler_fairlight_detune_knob_spreads_the_layers() {
    detune_schaetzer_kontrolle();
    for (k3, soll) in [(0.0f32, 1.0f64), (0.5, 3.0), (1.0, 9.0)] {
        let s = detune_seite(k3);
        let rms = (s.iter().map(|v| v * v).sum::<f64>() / s.len() as f64).sqrt();
        println!("MESS sampler-fairlight knob 3 = {k3}: side rms {rms:.5}");
        assert!(rms > 1e-3, "no side signal: the graph does not detune (knob 3 = {k3}, side rms {rms:e})");
        let hz = sampler_hilfe::schwebung_schaetzen(&s, C6_HZ, 48_000.0);
        let c = sampler_hilfe::cent_aus_schwebung(C6_HZ, hz);
        println!("MESS sampler-fairlight knob 3 = {k3}: beat {hz:.4} Hz = {c:.4} cent (target {soll})");
        assert!((c - soll).abs() <= 0.25, "knob 3 = {k3}: {c:.3} cent, wanted {soll} +-0.25");
    }
}

/// The graph of S10 to S13 (one sampler, the detune baked into `orchester-schlag.f32`), kept as a fixture to compare levels.
const SAMPLER_FAIRLIGHT_ALT: &str = include_str!("common/sampler-fairlight-s10.json");

/// Knob 3 at its top is the old sound (+-9 cent): a single A2 for 0.25 s has the level of the old graph with the old
/// file, within 0.5 dB. (Not bit-equal: the layers are resampled slices, not detuned oscillators.)
#[test]
fn s22_sampler_fairlight_detune_at_the_top_keeps_the_old_level() {
    let pegel = |p: &mut Programm| {
        p.note_an(45, 0.8);
        let x: Vec<(f32, f32)> = (0..12_000).map(|_| p.sample_stereo()).collect();
        let q = x.iter().map(|(l, r)| (*l as f64).powi(2) + (*r as f64).powi(2)).sum::<f64>() / (2 * x.len()) as f64;
        10.0 * q.log10()
    };
    let alt = pegel(&mut baukasten_dsp::uebersetze_mit_wurzel(SAMPLER_FAIRLIGHT_ALT, SR, Some(&probe_wurzel())).unwrap());
    let mut neu = lade_sampler();
    neu.setze_regler(3, 1.0);
    let neu = pegel(&mut neu);
    println!("MESS sampler-fairlight A2 first 0.25 s: old graph {alt:.2} dB, knob 3 = 1 {neu:.2} dB, difference {:+.2} dB", neu - alt);
    assert!((neu - alt).abs() <= 0.5, "difference {:+.2} dB", neu - alt);
}

/// S22 negative control for the slice wiring: the detune test above uses three equal sines, so it cannot tell whether
/// the three samplers read three different slices. Here the file holds the constants 0.1 / 0.2 / 0.3 (down / centre /
/// up); with the old pan gains the plateau is L = (1.0 * 0.1 + 0.7 * 0.2 + 0.25 * 0.3) * 0.475 and
/// R = (0.25 * 0.1 + 0.7 * 0.2 + 1.0 * 0.3) * 0.475 (the 8 bit crusher and the 4-pole filter pass a constant; 0.475 is
/// the output trim of the graph). If all three samplers read slice 0 the plateau would be 0.0926 on both sides.
#[test]
fn s22_sampler_fairlight_reads_three_different_slices() {
    let w = std::env::temp_dir().join(format!("bk-s22-schichten-{}", std::process::id()));
    std::fs::create_dir_all(&w).unwrap();
    sampler_hilfe::schreibe(&w, "orchester-schlag-schichten.f32", &sampler_hilfe::segmente(3, 12_000));
    let mut p = baukasten_dsp::uebersetze_mit_wurzel(SAMPLER_FAIRLIGHT, SR, Some(&w)).unwrap_or_else(|e| panic!("{e}"));
    p.setze_regler(1, 1.0);
    p.note_an(60, 0.8); // C4 = the root pitch: read step 1 (+-3 cent for the outer layers)
    let x: Vec<(f32, f32)> = (0..8_000).map(|_| p.sample_stereo()).collect();
    let mitte = &x[3_000..7_000];
    let (l, r) = (mitte.iter().map(|v| v.0 as f64).sum::<f64>() / 4_000.0, mitte.iter().map(|v| v.1 as f64).sum::<f64>() / 4_000.0);
    println!("MESS slice wiring plateau: L {l:.4} (want 0.1496), R {r:.4} (want 0.2209)");
    assert!((l - 0.1496).abs() < 0.012, "left plateau {l}");
    assert!((r - 0.2209).abs() < 0.012, "right plateau {r}");
}

// ---- S21: fx-federhall (spring reverb through faltung) and fx-filter-fahrt (32-bar filter ride) ----
const FEDERHALL: &str = include_str!("../demos/fx-federhall.json");
const FILTER_FAHRT: &str = include_str!("../demos/fx-filter-fahrt.json");
/// 120 BPM = 2 beats per second
const BPS_120: f64 = 2.0 / 48_000.0;

/// A sample root holding the generated spring IR (nothing is stored in the repo).
fn feder_wurzel() -> std::path::PathBuf {
    static W: std::sync::OnceLock<std::path::PathBuf> = std::sync::OnceLock::new();
    W.get_or_init(|| {
        let w = std::env::temp_dir().join(format!("bk-s21-bsp-{}", std::process::id()));
        std::fs::create_dir_all(&w).unwrap();
        std::fs::write(w.join("feder-ir.f32"), baukasten_dsp::proben::bytes(&baukasten_dsp::proben::feder_ir(48_000.0))).unwrap();
        w
    }).clone()
}

fn lade_s21(j: &str) -> Programm {
    baukasten_dsp::uebersetze_mit_wurzel(j, SR, Some(&feder_wurzel())).unwrap_or_else(|e| panic!("{e:?}"))
}

fn durch(p: &mut Programm, x: &[f32]) -> Vec<(f32, f32)> {
    x.iter().map(|v| { p.setze_eingang(*v, *v); p.sample_stereo() }).collect()
}

fn spitze_von(y: &[(f32, f32)]) -> f32 { y.iter().fold(0.0f32, |m, (l, r)| m.max(l.abs()).max(r.abs())) }

fn namen(p: &Programm) -> Vec<(usize, String)> { p.regler_namen.clone() }

#[test]
fn s21_federhall_structure_and_bounds() {
    let p = lade_s21(FEDERHALL);
    assert!(p.hat_eingang());
    assert_eq!(p.latenz(), 0, "faltung adds no latency, so the effect may sit as a deck insert");
    assert_eq!(namen(&p), vec![(1, "Spring".to_string()), (2, "Dwell".to_string()), (3, "Tone".to_string())]);
    let x = rauschen(2 * 48_000);
    for k in [0.0f32, 0.5, 1.0] {
        let mut p = lade_s21(FEDERHALL);
        for n in 1..=3 { p.setze_regler(n, k); }
        let y = durch(&mut p, &x);
        assert!(y.iter().all(|(l, r)| l.is_finite() && r.is_finite()), "knobs at {k}");
        assert_eq!(p.rettungen, 0, "knobs at {k}");
        let sp = spitze_von(&y);
        println!("MESS s21 federhall knobs {k}: peak {sp:.3}");
        if k == 0.5 { assert!(sp < 0.9, "peak {sp} at the default knobs"); }
    }
}

#[test]
fn s21_federhall_knob1_zero_is_dry() {
    let x = rauschen(24_000);
    let mut p = lade_s21(FEDERHALL);
    p.setze_regler(1, 0.0);
    let y = durch(&mut p, &x);
    assert!(y.iter().zip(&x).all(|(a, b)| a.0.to_bits() == b.to_bits() && a.1.to_bits() == b.to_bits()), "Spring 0 must pass the dry input bit for bit");
    // negative control: at Spring 1 the same input is changed
    let mut q = lade_s21(FEDERHALL);
    q.setze_regler(1, 1.0);
    let z = durch(&mut q, &x);
    assert!(z.iter().zip(&x).any(|(a, b)| (a.0 - b).abs() > 1e-3), "Spring 1 must add the tank");
}

#[test]
fn s21_federhall_wet_tail() {
    let impuls: Vec<f32> = (0..72_000).map(|i| if i == 0 { 0.5 } else { 0.0 }).collect();
    // energy of one side 0.5..1.0 s after the impulse
    let seite = |y: &[(f32, f32)], l: bool| y[24_000..48_000].iter().map(|(a, b)| (if l { *a } else { *b } as f64).powi(2)).sum::<f64>();
    let mut p = lade_s21(FEDERHALL);
    p.setze_regler(1, 1.0);
    let y = durch(&mut p, &impuls);
    for (name, l) in [("left", true), ("right", false)] {
        let db = 10.0 * (seite(&y, l) / 0.25).log10();
        println!("MESS s21 federhall {name} energy 0.5..1.0 s after the impulse: {db:.1} dB re the impulse");
        assert!(db > -60.0, "{name}: no tail: {db} dB");
    }
    let mut q = lade_s21(FEDERHALL);
    q.setze_regler(1, 0.0);
    let z = durch(&mut q, &impuls);
    assert_eq!((seite(&z, true), seite(&z, false)), (0.0, 0.0), "Spring 0: nothing may remain after the dry impulse");
}

/// The wet part alone: output minus the dry input (the example adds the dry signal unprocessed).
fn feder_nass(spring: f32, dwell: f32, tone: f32) -> Vec<f32> {
    let x = rauschen(48_000);
    let mut p = lade_s21(FEDERHALL);
    p.setze_regler(1, spring);
    p.setze_regler(2, dwell);
    p.setze_regler(3, tone);
    durch(&mut p, &x).iter().zip(&x).map(|(y, d)| y.0 - d).collect()
}

#[test]
fn s21_federhall_dwell_and_tone_act() {
    let energie = |w: &[f32]| w.iter().map(|v| (*v as f64).powi(2)).sum::<f64>();
    let (leise, laut) = (energie(&feder_nass(1.0, 0.0, 0.5)), energie(&feder_nass(1.0, 1.0, 0.5)));
    let db = 10.0 * (laut / leise).log10();
    println!("MESS s21 federhall wet energy Dwell 1 vs 0: {db:.1} dB");
    assert!(db > 3.0, "Dwell changes the wet level by only {db:.1} dB");
    let (dunkel, hell) = (schwerpunkt(&feder_nass(1.0, 0.5, 0.0)), schwerpunkt(&feder_nass(1.0, 0.5, 1.0)));
    println!("MESS s21 federhall wet centroid Tone 0: {dunkel:.0} Hz, Tone 1: {hell:.0} Hz");
    assert!(hell >= 1.5 * dunkel, "Tone moves the wet centroid only from {dunkel:.0} to {hell:.0} Hz");
}

fn schwerpunkt(w: &[f32]) -> f64 { sampler_hilfe::schwerpunkt_hz(&w[4_800..], 48_000.0) }

#[test]
fn s21_filter_fahrt_structure() {
    let p = lade_s21(FILTER_FAHRT);
    assert!(p.hat_eingang());
    assert_eq!(p.latenz(), 0);
    assert_eq!(namen(&p), vec![(1, "HP kill".to_string()), (2, "Cutoff start".to_string()), (3, "Ride depth".to_string()), (4, "Resonance".to_string())]);
    let x = rauschen(2 * 48_000);
    for k in [0.0f32, 0.5, 1.0] {
        let mut p = lade_s21(FILTER_FAHRT);
        for n in 1..=4 { p.setze_regler(n, k); }
        p.setze_takt(0.0, BPS_120);
        let y = durch(&mut p, &x);
        assert!(y.iter().all(|(l, r)| l.is_finite() && r.is_finite() && l.abs() < 4.0), "knobs at {k}");
        assert_eq!(p.rettungen, 0, "knobs at {k}");
    }
}

/// Spectral centroid of 0.5 s of noise through the ride, started at host beat `beat` (the first 0.1 s are skipped).
fn fahrt_schwerpunkt(beat: f64, tiefe: f32) -> f64 {
    let mut p = lade_s21(FILTER_FAHRT);
    p.setze_regler(3, tiefe);
    p.setze_takt(beat, BPS_120);
    let y = durch(&mut p, &rauschen(24_000));
    sampler_hilfe::schwerpunkt_hz(&y[4_800..].iter().map(|v| v.0).collect::<Vec<_>>(), 48_000.0)
}

#[test]
fn s21_filter_fahrt_opens_over_32_bars() {
    let (a, b, c) = (fahrt_schwerpunkt(0.0, 1.0), fahrt_schwerpunkt(127.0, 1.0), fahrt_schwerpunkt(200.0, 1.0));
    println!("MESS s21 filter-fahrt centroid (ride depth 1): beat 0 {a:.0} Hz, beat 127 {b:.0} Hz, beat 200 {c:.0} Hz");
    assert!(b >= 4.0 * a, "the ride opens only {:.2}x", b / a);
    assert!((c - b).abs() <= 0.02 * b, "after the ride the filter holds: {b:.0} vs {c:.0}");
    // the ride takes 32 bars: halfway (beat 64) the filter is clearly open and clearly not yet arrived
    let m = fahrt_schwerpunkt(64.0, 1.0);
    println!("MESS s21 filter-fahrt centroid at beat 64 (halfway): {m:.0} Hz");
    assert!(m > 2.0 * a && m < 0.9 * b, "beat 64 must lie between start and end: {a:.0} < {m:.0} < {b:.0}");
    // negative control: depth 0 is the manual filter, the ride has no effect
    let (a0, b0) = (fahrt_schwerpunkt(0.0, 0.0), fahrt_schwerpunkt(127.0, 0.0));
    println!("MESS s21 filter-fahrt centroid (ride depth 0): beat 0 {a0:.0} Hz, beat 127 {b0:.0} Hz");
    assert!((a0 - b0).abs() <= 0.05 * a0, "depth 0 must not move the filter: {a0:.0} vs {b0:.0}");
}

#[test]
fn s21_filter_fahrt_hp_kill() {
    let tief = |hp: f32| {
        let mut p = lade_s21(FILTER_FAHRT);
        p.setze_regler(1, hp);
        p.setze_regler(3, 0.0);
        p.setze_takt(0.0, BPS_120);
        let y = durch(&mut p, &rauschen(48_000));
        sampler_hilfe::band_energie(&y[4_800..].iter().map(|v| v.0).collect::<Vec<_>>(), 48_000.0, 20.0, 100.0)
    };
    let (offen, zu) = (tief(0.0), tief(1.0));
    let db = 10.0 * (zu / offen).log10();
    println!("MESS s21 filter-fahrt energy 20..100 Hz: HP kill 400 Hz vs 20 Hz {db:.1} dB");
    assert!(db <= -20.0, "the high-pass cuts the lows by only {db:.1} dB");
}
