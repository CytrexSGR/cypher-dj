//! Sample player stage 2a: zones in the sampler block (`zonen`, input `vel`, packs mapped read-only).
//! Zone choice by key and velocity, pitch against the zone root, round robin and its reset, gain and pan, silence without a
//! candidate, every refusal, big packs, non-finite pack values.
#[path = "sampler_helpers/mod.rs"]
mod sampler_hilfe;
use baukasten_dsp::sampler::{note_von_hz, Eingabe, ZonenTabelle, Sampler, FADE, MAX_PACK_FRAMEN};
use baukasten_dsp::{uebersetze_mit_wurzel, Fehler, Programm};
use sampler_hilfe::*;
use std::io::{Seek, SeekFrom, Write};

const SR: f32 = 48_000.0;

/// One zone row: a, b, grund, lo, hi, vlo, vhi, gain, pan, loop_a, loop_b, art.
fn zeile(a: u64, b: u64, grund: f64, lo: u8, hi: u8, vlo: u8, vhi: u8, gain: f64, pan: f64) -> [f64; 12] {
    [a as f64, b as f64, grund, lo as f64, hi as f64, vlo as f64, vhi as f64, gain, pan, 0.0, 0.0, 0.0]
}

/// A zone over the whole key and velocity range, root note 60, unity gain.
fn offen(a: u64, b: u64) -> [f64; 12] { zeile(a, b, 60.0, 0, 127, 1, 127, 1.0, 0.0) }

fn flach(z: &[[f64; 12]]) -> String { z.iter().flatten().map(|v| v.to_string()).collect::<Vec<_>>().join(",") }

/// Graph: note -> sampler (zones) -> ausgang, `vel` wired from the note.
fn zgraph(datei: &str, z: &[[f64; 12]], extra: &str) -> String {
    format!(
        r#"{{"format":"baukasten/2","name":"z","stimmen":4,"knoten":[{{"id":"n","art":"note"}},{{"id":"s","art":"sampler","datei":"{datei}","zonen":[{}]{extra}}},{{"id":"o","art":"ausgang"}}],"kanten":[{{"von":"n.hz","nach":"s.hz"}},{{"von":"n.trig","nach":"s.trig"}},{{"von":"n.gate","nach":"s.gate"}},{{"von":"n.vel","nach":"s.vel"}},{{"von":"s.l","nach":"o.l"}},{{"von":"s.r","nach":"o.r"}}]}}"#,
        flach(z)
    )
}

/// Pack of `n` zones of `len` frames, zone k is the constant (k+1)/10.
fn pack_konstanten(n: usize, len: usize) -> Vec<f32> { segmente(n, len) }

fn bauen(w: &std::path::Path, d: &[f32], z: &[[f64; 12]], extra: &str) -> Programm {
    schreibe(w, "p.f32", d);
    uebersetze_mit_wurzel(&zgraph("p.f32", z, extra), SR, Some(w)).unwrap_or_else(|e| panic!("{e:?}"))
}

/// Play one note (velocity 0..1) to its end: the output sample 10 frames in.
fn schlag(p: &mut Programm, note: u8, vel: f32) -> (f32, f32) {
    p.note_an(note, vel);
    let mut aus = (0.0, 0.0);
    for i in 0..1200 {
        let s = p.sample_stereo();
        if i == 10 { aus = s; }
    }
    p.note_aus(note);
    for _ in 0..300 { p.sample_stereo(); }
    aus
}

fn nahe(a: f32, b: f32) -> bool { (a - b).abs() < 1e-5 }

#[test]
fn zone_is_chosen_by_key() {
    let w = wurzel();
    let mut p = bauen(&w, &pack_konstanten(2, 400), &[zeile(0, 400, 60.0, 0, 59, 1, 127, 1.0, 0.0), zeile(400, 800, 60.0, 60, 127, 1, 127, 1.0, 0.0)], "");
    let (l, r) = schlag(&mut p, 50, 1.0);
    assert!(nahe(l, 0.1) && nahe(r, 0.1), "{l} {r}");
    let (l, _) = schlag(&mut p, 59, 1.0);
    assert!(nahe(l, 0.1), "{l}");
    let (l, _) = schlag(&mut p, 60, 1.0);
    assert!(nahe(l, 0.2), "{l}");
    let (l, _) = schlag(&mut p, 72, 1.0);
    assert!(nahe(l, 0.2), "{l}");
}

#[test]
fn zone_is_chosen_by_velocity() {
    let w = wurzel();
    let mut p = bauen(&w, &pack_konstanten(2, 400), &[zeile(0, 400, 60.0, 0, 127, 1, 64, 1.0, 0.0), zeile(400, 800, 60.0, 0, 127, 65, 127, 1.0, 0.0)], "");
    // round(0.3 * 127) = 38, round(0.8 * 127) = 102, 0 clamps to 1, 1.0 is 127, 64/127 rounds to 64, 65/127 to 65
    for (vel, soll) in [(0.3, 0.1), (0.8, 0.2), (0.0, 0.1), (1.0, 0.2), (64.0 / 127.0, 0.1), (65.0 / 127.0, 0.2)] {
        let (l, _) = schlag(&mut p, 60, vel);
        assert!(nahe(l, soll), "vel {vel}: {l} != {soll}");
    }
}

#[test]
fn unwired_vel_defaults_to_full_velocity() {
    let w = wurzel();
    schreibe(&w, "p.f32", &pack_konstanten(2, 400));
    let z = [zeile(0, 400, 60.0, 0, 127, 1, 126, 1.0, 0.0), zeile(400, 800, 60.0, 0, 127, 127, 127, 1.0, 0.0)];
    let g = zgraph("p.f32", &z, "").replace(r#"{"von":"n.vel","nach":"s.vel"},"#, "");
    let mut p = uebersetze_mit_wurzel(&g, SR, Some(&w)).unwrap();
    let (l, _) = schlag(&mut p, 60, 0.2);
    assert!(nahe(l, 0.2), "default vel 1.0 selects the layer 127: {l}");
}

#[test]
fn pitch_follows_the_zone_root() {
    let w = wurzel();
    // a zone of 440 Hz with root 69, played one octave up, one down; and a fractional root (tuning in cents)
    for (grund, daten_hz, note, soll) in [(69.0, 440.0, 81u8, 880.0), (69.0, 440.0, 57, 220.0), (69.5, 440.0 * 2f64.powf(0.5 / 12.0), 69, 440.0)] {
        let mut p = bauen(&w, &sinus(daten_hz, 40_000, 0.5), &[zeile(0, 40_000, grund, 0, 127, 1, 127, 1.0, 0.0)], r#","grund":500"#);
        p.note_an(note, 1.0);
        let aus: Vec<f32> = (0..8192).map(|_| p.sample_stereo().0).collect();
        let f = spitze_hz(&aus[100..], 48_000.0);
        assert!((f - soll).abs() < soll * 0.002, "root {grund}, note {note}: {f} Hz, wanted {soll}");
    }
}

#[test]
fn round_robin_rotates_and_resets() {
    let w = wurzel();
    let d = pack_konstanten(4, 400);
    let z = [offen(0, 400), offen(400, 800), offen(800, 1200), zeile(1200, 1600, 60.0, 0, 20, 1, 127, 1.0, 0.0)];
    let mut p = bauen(&w, &d, &z, "");
    let folge: Vec<f32> = (0..7).map(|_| schlag(&mut p, 60, 1.0).0).collect();
    for (i, (v, s)) in folge.iter().zip([0.1, 0.2, 0.3, 0.1, 0.2, 0.3, 0.1]).enumerate() {
        assert!(nahe(*v, s), "hit {i}: {v} != {s} ({folge:?})");
    }
    // a trigger without a candidate does not count (note 127 has none: zone 3 only reaches key 20, others are open, so use a graph below)
    p.zuruecksetzen();
    assert!(nahe(schlag(&mut p, 60, 1.0).0, 0.1), "zuruecksetzen restarts the rotation");
    assert!(nahe(schlag(&mut p, 60, 1.0).0, 0.2));
    p.zuruecksetzen();
    assert!(nahe(schlag(&mut p, 60, 1.0).0, 0.1));
}

#[test]
fn round_robin_counter_belongs_to_the_node_and_skips_triggers_without_candidates() {
    let w = wurzel();
    let d = pack_konstanten(5, 400);
    // keys 0..49: two takes (0.1, 0.2); keys 50..99: three takes (0.3, 0.4, 0.5); keys above: nothing
    let z = [
        zeile(0, 400, 60.0, 0, 49, 1, 127, 1.0, 0.0),
        zeile(400, 800, 60.0, 0, 49, 1, 127, 1.0, 0.0),
        zeile(800, 1200, 60.0, 50, 99, 1, 127, 1.0, 0.0),
        zeile(1200, 1600, 60.0, 50, 99, 1, 127, 1.0, 0.0),
        zeile(1600, 2000, 60.0, 50, 99, 1, 127, 1.0, 0.0),
    ];
    let mut p = bauen(&w, &d, &z, "");
    // counter 0: key 45 -> 0 % 2 = take 0 (0.1); counter 1: key 60 -> 1 % 3 = take 1 (0.4); silence does not count;
    // counter 2: key 45 -> 2 % 2 = take 0 (0.1); counter 3: key 60 -> 3 % 3 = take 0 (0.3)
    assert!(nahe(schlag(&mut p, 45, 1.0).0, 0.1));
    assert!(nahe(schlag(&mut p, 60, 1.0).0, 0.4));
    assert_eq!(schlag(&mut p, 110, 1.0), (0.0, 0.0));
    assert!(nahe(schlag(&mut p, 45, 1.0).0, 0.1));
    assert!(nahe(schlag(&mut p, 60, 1.0).0, 0.3));
}

#[test]
fn gain_and_pan() {
    let w = wurzel();
    let d = pack_konstanten(1, 400);
    let r2 = std::f32::consts::SQRT_2;
    // pan 0 is as recorded; gain scales both sides
    let mut p = bauen(&w, &d, &[zeile(0, 400, 60.0, 0, 127, 1, 127, 0.5, 0.0)], "");
    let (l, r) = schlag(&mut p, 60, 1.0);
    assert!(nahe(l, 0.05) && nahe(r, 0.05), "{l} {r}");
    // hard left / right: constant power, the far side is silent
    let mut p = bauen(&w, &d, &[zeile(0, 400, 60.0, 0, 127, 1, 127, 1.0, -1.0)], "");
    let (l, r) = schlag(&mut p, 60, 1.0);
    assert!(nahe(l, 0.1 * r2) && r.abs() < 1e-6, "{l} {r}");
    let mut p = bauen(&w, &d, &[zeile(0, 400, 60.0, 0, 127, 1, 127, 2.0, 1.0)], "");
    let (l, r) = schlag(&mut p, 60, 1.0);
    assert!(l.abs() < 1e-6 && nahe(r, 0.2 * r2), "{l} {r}");
    // in between the power is constant: l^2 + r^2 = 2 (gain v)^2
    for pan in [-0.75, -0.3, 0.2, 0.6] {
        let mut p = bauen(&w, &d, &[zeile(0, 400, 60.0, 0, 127, 1, 127, 1.0, pan)], "");
        let (l, r) = schlag(&mut p, 60, 1.0);
        assert!((l * l + r * r - 2.0 * 0.01).abs() < 1e-6, "pan {pan}: {l} {r}");
        assert_eq!(pan < 0.0, l > r, "pan {pan}: {l} {r}");
    }
}

#[test]
fn no_candidate_is_silent_and_an_old_pass_fades_out() {
    let w = wurzel();
    let mut p = bauen(&w, &pack_konstanten(1, 400), &[zeile(0, 400, 60.0, 0, 59, 1, 127, 1.0, 0.0)], "");
    assert_eq!(schlag(&mut p, 80, 1.0), (0.0, 0.0));
    p.note_an(80, 1.0);
    assert!((0..2000).all(|_| p.sample_stereo() == (0.0, 0.0)));
    // direct DSP: a pass is running, a trigger without a candidate ends it over FADE samples and nothing follows
    let z = ZonenTabelle::neu(&[zeile(0, 4000, 60.0, 0, 59, 1, 127, 1.0, 0.0)].concat(), Some(4000)).unwrap();
    let d = stereo(4000, |_| 0.5);
    let (mut s, mut rr) = (Sampler::default(), 0u64);
    let hz = |n: u8| 440.0 * 2f32.powf((n as f32 - 69.0) / 12.0);
    let x = |n: u8, trig: f32| Eingabe { hz: hz(n), trig, gate: 1.0, scheibe: 0.0, rueck: 0.0 };
    assert!(nahe(s.prozess_zonen(&d, &z, &mut rr, SR, x(50, 1.0), 1.0).0, 0.5));
    for _ in 0..50 { s.prozess_zonen(&d, &z, &mut rr, SR, x(50, 0.0), 1.0); }
    let aus: Vec<f32> = (0..FADE + 8).map(|i| s.prozess_zonen(&d, &z, &mut rr, SR, x(100, if i == 0 { 1.0 } else { 0.0 }), 1.0).0).collect();
    assert!(aus[0] > 0.4 && aus[0] <= 0.5, "starts from the old level: {}", aus[0]);
    assert!(aus.windows(2).take(FADE - 1).all(|p| p[1] <= p[0] + 1e-7), "falls monotonically");
    assert!(aus[FADE..].iter().all(|v| *v == 0.0), "silent after the fade: {:?}", &aus[FADE..]);
    assert!(!s.spielt());
    assert_eq!(rr, 1, "only the trigger with a candidate counted");
}

#[test]
fn note_is_taken_from_the_frequency() {
    assert_eq!(note_von_hz(440.0), 69);
    assert_eq!(note_von_hz(261.6256), 60);
}

fn ist_zonenfehler(r: Result<Programm, Fehler>, feld: &str) -> bool {
    match r {
        Err(Fehler::Zonen { wert, grund, .. }) => { assert!(wert.contains(feld) && !grund.is_empty(), "{wert}: {grund}"); true }
        _ => false,
    }
}

#[test]
fn every_rule_of_the_table_is_refused_with_zone_and_field() {
    let w = wurzel();
    schreibe(&w, "p.f32", &pack_konstanten(2, 400)); // 800 frames
    let ok = || zeile(0, 400, 60.0, 0, 127, 1, 127, 1.0, 0.0);
    let mit = |f: &dyn Fn(&mut [f64; 12])| {
        let mut z = ok();
        f(&mut z);
        uebersetze_mit_wurzel(&zgraph("p.f32", &[ok(), z], ""), SR, Some(&w))
    };
    assert!(mit(&|_| {}).is_ok());
    let fall: Vec<(&str, Box<dyn Fn(&mut [f64; 12])>)> = vec![
        ("a", Box::new(|z| z[0] = -1.0)),
        ("a", Box::new(|z| z[0] = 0.5)),
        ("b", Box::new(|z| { z[0] = 10.0; z[1] = 13.0 })), // a + 4 <= b
        ("b", Box::new(|z| z[1] = 801.0)),                 // b <= frames
        ("grund", Box::new(|z| z[2] = -0.5)),
        ("grund", Box::new(|z| z[2] = 127.5)),
        ("lo", Box::new(|z| z[3] = 0.5)),
        ("hi", Box::new(|z| z[4] = 128.0)),
        ("lo", Box::new(|z| { z[3] = 70.0; z[4] = 69.0 })),
        ("vlo", Box::new(|z| z[5] = 0.0)),
        ("vhi", Box::new(|z| z[6] = 128.0)),
        ("vlo", Box::new(|z| { z[5] = 90.0; z[6] = 80.0 })),
        ("gain", Box::new(|z| z[7] = 8.5)),
        ("gain", Box::new(|z| z[7] = -0.1)),
        ("pan", Box::new(|z| z[8] = 1.1)),
        ("pan", Box::new(|z| z[8] = -1.1)),
        ("loop_a", Box::new(|z| z[9] = 10.0)),
        ("loop_b", Box::new(|z| z[10] = 20.0)),
        ("art", Box::new(|z| z[11] = 2.0)),
    ];
    for (feld, f) in &fall {
        let r = mit(f.as_ref());
        // the text names zone 1 (the second row, counted from 0) and the field
        match &r {
            Err(Fehler::Zonen { wert, .. }) => assert!(wert.starts_with("zonen[1]."), "{wert}"),
            _ => {}
        }
        assert!(ist_zonenfehler(r, feld), "field {feld} must be refused");
    }
    // table shape
    let g = |z: &str| uebersetze_mit_wurzel(&zgraph("p.f32", &[], "").replace(r#""zonen":[]"#, &format!(r#""zonen":[{z}]"#)), SR, Some(&w));
    assert!(ist_zonenfehler(g(""), "zonen"), "empty table");
    assert!(ist_zonenfehler(g("0,400,60,0,127,1,127,1,0,0,0"), "zonen"), "11 numbers");
    let viele = flach(&vec![offen(0, 400); 1025]);
    assert!(ist_zonenfehler(g(&viele), "zonen"), "1025 zones");
    let genau = flach(&vec![offen(0, 400); 1024]);
    assert!(g(&genau).is_ok(), "1024 zones: {:?}", g(&genau).err());
    // the field is not a number
    assert!(matches!(uebersetze_mit_wurzel(&zgraph("p.f32", &[], "").replace(r#""zonen":[]"#, r#""zonen":["x"]"#), SR, Some(&w)), Err(Fehler::Format(_))));
}

#[test]
fn refused_beside_the_slice_fields_and_on_other_nodes() {
    let w = wurzel();
    schreibe(&w, "p.f32", &pack_konstanten(2, 400));
    let z = [offen(0, 400)];
    for (extra, feld) in [(r#","grenzen":[0,100,200]"#, "grenzen"), (r#","scheiben":2"#, "scheiben"), (r#","noten_wahl":1"#, "noten_wahl"), (r#","schleife":1"#, "schleife")] {
        match uebersetze_mit_wurzel(&zgraph("p.f32", &z, extra), SR, Some(&w)) {
            Err(Fehler::Wert { wert, .. }) | Err(Fehler::Zonen { wert, .. }) => assert!(wert.contains(feld), "{extra}: {wert}"),
            r => panic!("{extra}: {:?}", r.err()),
        }
    }
    // zero values of the refused fields are not slice use
    assert!(uebersetze_mit_wurzel(&zgraph("p.f32", &z, r#","noten_wahl":0,"schleife":0"#), SR, Some(&w)).is_ok());
    let wt = r#"{"format":"baukasten/2","name":"x","knoten":[{"id":"w","art":"wavetable","zonen":[0,400,60,0,127,1,127,1,0,0,0,0]},{"id":"o","art":"ausgang"}]}"#;
    assert!(matches!(baukasten_dsp::uebersetze(wt, SR), Err(Fehler::Wert { .. }) | Err(Fehler::Zonen { .. })));
    let mak = format!(
        r#"{{"format":"baukasten/2","name":"x","makros":{{"m":{{"knoten":[{{"id":"s","art":"sampler","datei":"p.f32","zonen":[{}]}}]}}}},"knoten":[{{"id":"i","art":"makro:m"}},{{"id":"o","art":"ausgang"}}]}}"#,
        flach(&z)
    );
    assert!(matches!(uebersetze_mit_wurzel(&mak, SR, Some(&w)), Err(Fehler::Wert { .. })));
    let mak = mak.replace(r#""makros":{"m":{"knoten":[{"id":"s","art":"sampler","datei":"p.f32","zonen":[0,400,60,0,127,1,127,1,0,0,0,0]}]}}"#, r#""makros":{"m":{"knoten":[{"id":"s","art":"sampler","datei":"p.f32"}]}}"#)
        .replace(r#"{"id":"i","art":"makro:m"}"#, r#"{"id":"i","art":"makro:m","zonen":[0,400,60,0,127,1,127,1,0,0,0,0]}"#);
    assert!(matches!(uebersetze_mit_wurzel(&mak, SR, Some(&w)), Err(Fehler::Wert { .. })));
}

#[test]
fn pack_name_and_size_rules() {
    let w = wurzel();
    let z = [offen(0, 400)];
    let probe = |name: &str| uebersetze_mit_wurzel(&zgraph(name, &z, ""), SR, Some(&w));
    schreibe(&w, "p.f32", &pack_konstanten(1, 400));
    for n in ["../p.f32", "a/p.f32", "p.wav", "a..b.f32"] {
        assert!(matches!(probe(n), Err(Fehler::Datei { .. })), "{n}");
    }
    assert!(matches!(probe("fehlt.f32"), Err(Fehler::Datei { .. })));
    std::fs::write(w.join("q.f32"), [0u8; 20]).unwrap();
    assert!(matches!(probe("q.f32"), Err(Fehler::Datei { .. })), "not a multiple of 8");
    std::fs::write(w.join("k.f32"), [0u8; 56]).unwrap();
    assert!(matches!(uebersetze_mit_wurzel(&zgraph("k.f32", &[offen(0, 7)], ""), SR, Some(&w)), Err(Fehler::Datei { .. })), "7 frames");
    std::fs::write(w.join("e.f32"), []).unwrap();
    assert!(matches!(probe("e.f32"), Err(Fehler::Datei { .. })), "empty");
    // a directory and a fifo are no packs
    std::fs::create_dir(w.join("d.f32")).unwrap();
    assert!(matches!(probe("d.f32"), Err(Fehler::Datei { .. })));
    assert!(matches!(uebersetze_mit_wurzel(&zgraph("p.f32", &z, ""), SR, None), Err(Fehler::Datei { .. })), "no sample root");
}

fn spaerlich(w: &std::path::Path, name: &str, frames: u64) -> std::fs::File {
    let f = std::fs::File::create(w.join(name)).unwrap();
    f.set_len(frames * 8).unwrap();
    f
}

#[test]
fn a_pack_over_the_old_limit_loads_and_reads_at_its_end() {
    let w = wurzel();
    let frames = 10_485_760u64; // 80 MiB, over MAX_GRAPH_BYTES (64 MiB) and over MAX_FRAMEN
    let mut f = spaerlich(&w, "gross.f32", frames);
    f.seek(SeekFrom::Start((frames - 400) * 8)).unwrap();
    f.write_all(&bytes(&stereo(400, |_| 0.5))).unwrap();
    drop(f);
    let z = [offen(frames - 400, frames), offen(0, 400)];
    let mut p = uebersetze_mit_wurzel(&zgraph("gross.f32", &z[..1], ""), SR, Some(&w)).unwrap_or_else(|e| panic!("{e:?}"));
    let (l, r) = schlag(&mut p, 60, 1.0);
    assert!(nahe(l, 0.5) && nahe(r, 0.5), "{l} {r}");
    // the sparse start of the pack reads as silence
    let mut p = uebersetze_mit_wurzel(&zgraph("gross.f32", &z[1..], ""), SR, Some(&w)).unwrap();
    assert_eq!(schlag(&mut p, 60, 1.0), (0.0, 0.0));
    // the same file as the sample of an ordinary sampler stays refused (60 s and 64 MiB limits unchanged)
    let g = graph("gross.f32", "", 1);
    assert!(matches!(uebersetze_mit_wurzel(&g, SR, Some(&w)), Err(Fehler::Datei { .. })));
    // a zone beyond the end of the pack is refused
    assert!(ist_zonenfehler(uebersetze_mit_wurzel(&zgraph("gross.f32", &[offen(frames - 400, frames + 1)], ""), SR, Some(&w)), "b"));
}

#[test]
fn a_pack_over_the_limit_is_refused() {
    let w = wurzel();
    assert_eq!(MAX_PACK_FRAMEN, 268_435_456);
    let z = [offen(0, 400)];
    drop(spaerlich(&w, "grenze.f32", MAX_PACK_FRAMEN as u64));
    assert!(uebersetze_mit_wurzel(&zgraph("grenze.f32", &z, ""), SR, Some(&w)).is_ok(), "exactly the limit loads");
    drop(spaerlich(&w, "zuviel.f32", MAX_PACK_FRAMEN as u64 + 1));
    match uebersetze_mit_wurzel(&zgraph("zuviel.f32", &z, ""), SR, Some(&w)) {
        Err(Fehler::Datei { grund, .. }) => assert!(grund.contains("268435456"), "{grund}"),
        r => panic!("{:?}", r.err()),
    }
}

#[test]
fn non_finite_pack_values_read_as_zero() {
    let w = wurzel();
    let mut d = stereo(400, |_| 0.5);
    for i in 100..140 {
        d[2 * i] = f32::NAN;
        d[2 * i + 1] = f32::INFINITY;
    }
    schreibe(&w, "p.f32", &d);
    let mut p = uebersetze_mit_wurzel(&zgraph("p.f32", &[offen(0, 400)], ""), SR, Some(&w)).unwrap_or_else(|e| panic!("a pack is not scanned at load: {e:?}"));
    p.note_an(60, 1.0);
    let aus: Vec<(f32, f32)> = (0..400).map(|_| p.sample_stereo()).collect();
    assert!(aus.iter().all(|(l, r)| l.is_finite() && r.is_finite()));
    assert_eq!(aus[120], (0.0, 0.0));
    assert!(nahe(aus[50].0, 0.5) && nahe(aus[300].1, 0.5));
}

#[test]
fn zone_table_unit() {
    let t = ZonenTabelle::neu(&flach(&[offen(0, 8)]).split(',').map(|v| v.parse().unwrap()).collect::<Vec<f64>>(), Some(8));
    assert!(t.is_ok());
    let e = ZonenTabelle::neu(&[0.0; 13], None).err().unwrap();
    assert_eq!((e.zone, e.feld), (None, "zonen"));
    let e = ZonenTabelle::neu(&offen(0, 8).iter().chain(zeile(0, 8, 60.0, 5, 4, 1, 127, 1.0, 0.0).iter()).copied().collect::<Vec<_>>(), None).err().unwrap();
    assert_eq!((e.zone, e.feld), (Some(1), "lo"));
}
