//! Sampler A1 task 1: slice table (`grenzen`), note-chosen slices (`noten_wahl`), gate release, 60 s files.
#[path = "sampler_helpers/mod.rs"]
mod sampler_hilfe;
use baukasten_dsp::programm::Programm;
use baukasten_dsp::sampler::note_von_hz;
use baukasten_dsp::{uebersetze_mit_wurzel, Fehler};
use sampler_hilfe::*;

const SR: f32 = 48_000.0;

/// FNV-1a 64 over the bit patterns of every output sample.
fn fnv_bits(d: &[(f32, f32)]) -> u64 {
    let mut h = 0xcbf2_9ce4_8422_2325u64;
    for (l, r) in d {
        for b in l.to_bits().to_le_bytes().into_iter().chain(r.to_bits().to_le_bytes()) {
            h = (h ^ b as u64).wrapping_mul(0x0100_0000_01b3);
        }
    }
    h
}

/// Fingerprint of an old sampler graph (before this task): notes 60, 64, 67 on, offs, 72, a reverse hit and a quick
/// retrigger, 48 000 frames.
#[test]
fn old_graph_renders_bit_equal() {
    let w = wurzel();
    schreibe(&w, "orchester-schlag.f32", &baukasten_dsp::proben::orchester_schlag(48_000.0));
    let json = include_str!("common/sampler-fairlight-s10.json");
    let mut p = uebersetze_mit_wurzel(json, SR, Some(&w)).unwrap_or_else(|e| panic!("{e}"));
    let mut out = Vec::new();
    for i in 0..48_000usize {
        match i {
            0 => p.note_an(60, 0.8),
            4_000 => p.note_an(64, 0.7),
            6_000 => p.note_aus(60),
            9_000 => p.note_an(67, 0.9),
            12_000 => p.note_aus(64),
            14_000 => p.note_aus(67),
            15_000 => p.note_an(72, 0.8),
            20_000 => p.setze_regler(2, 1.0),
            21_000 => p.note_an(60, 0.8),
            21_500 => p.note_an(60, 0.6),
            30_000 => p.note_aus(60),
            _ => {}
        }
        out.push(p.sample_stereo());
    }
    assert!(out.iter().any(|v| v.0.abs() > 0.05), "silent fingerprint is blind");
    let h = fnv_bits(&out);
    println!("FINGERPRINT {h:#018x}");
    assert_eq!(h, 0xd275_506a_7005_c24a, "fingerprint");
}

/// Same for a looping graph with four equal slices and a slice chosen by a knob (the `scheibe` path).
#[test]
fn old_loop_slices_render_bit_equal() {
    let w = wurzel();
    let d: Vec<f32> = (0..2 * 20_000).map(|i| ((i as f32) * 0.37).sin() * 0.6 + ((i / 2) as f32 * 0.011).cos() * 0.2).collect();
    schreibe(&w, "d.f32", &d);
    let json = r#"{"format":"baukasten/2","name":"s","stimmen":2,"knoten":[{"id":"n","art":"note"},{"id":"k","art":"regler","nr":1,"min":0,"max":3},{"id":"s","art":"sampler","datei":"d.f32","scheiben":4,"schleife":1,"grund":300},{"id":"o","art":"ausgang"}],"kanten":[{"von":"n.hz","nach":"s.hz"},{"von":"n.trig","nach":"s.trig"},{"von":"n.gate","nach":"s.gate"},{"von":"k.aus","nach":"s.scheibe"},{"von":"s.l","nach":"o.l"},{"von":"s.r","nach":"o.r"}]}"#;
    let mut p = uebersetze_mit_wurzel(json, SR, Some(&w)).unwrap_or_else(|e| panic!("{e}"));
    let mut out = Vec::new();
    for i in 0..30_000usize {
        match i {
            0 => p.note_an(57, 0.8),
            3_000 => p.setze_regler(1, 0.7),
            3_500 => p.note_an(62, 0.8),
            9_000 => p.note_aus(57),
            12_000 => p.note_aus(62),
            14_000 => p.setze_regler(1, 1.0),
            14_500 => p.note_an(57, 0.8),
            20_000 => p.note_aus(57),
            _ => {}
        }
        out.push(p.sample_stereo());
    }
    assert!(out.iter().any(|v| v.0.abs() > 0.05), "silent fingerprint is blind");
    let h = fnv_bits(&out);
    println!("FINGERPRINT {h:#018x}");
    assert_eq!(h, 0xd875_4698_f27c_05f6, "fingerprint");
}

// ---- the slice table and the note-chosen slices ----

const SL: usize = 5625;

/// 90 000 frames of deterministic noise-like material, 16 slices of 5625 frames.
fn quelle() -> Vec<f32> { stereo(90_000, |i| ((i * 7919) % 1000) as f32 / 1000.0 - 0.5) }

fn gleiche_grenzen(n: usize, laenge: usize) -> Vec<u64> { (0..=n).map(|k| (k * laenge) as u64).collect() }

fn liste(g: &[u64]) -> String { g.iter().map(|v| v.to_string()).collect::<Vec<_>>().join(",") }

/// note -> sampler (`noten_wahl` 1, `grenzen`) -> out. `extra` is added to the sampler node.
fn wahl_graph(g: &[u64], extra: &str, stimmen: usize) -> String {
    graph("q.f32", &format!(r#","noten_wahl":1{extra},"grenzen":[{}]"#, liste(g)), stimmen)
}

fn programm(json: &str, daten: &[f32]) -> Programm {
    let w = wurzel();
    schreibe(&w, "q.f32", daten);
    uebersetze_mit_wurzel(json, SR, Some(&w)).unwrap_or_else(|e| panic!("{e}"))
}

#[derive(Clone, Copy)]
enum Ev { An(u8), Aus(u8), Regler(usize, f32) }

/// Render `n` frames; the events of one frame are applied in the order given, before the frame is computed.
fn spiele(p: &mut Programm, n: usize, ev: &[(usize, Ev)]) -> Vec<(f32, f32)> {
    (0..n).map(|i| {
        for (f, e) in ev {
            if *f == i {
                match *e {
                    Ev::An(k) => p.note_an(k, 0.8),
                    Ev::Aus(k) => p.note_aus(k),
                    Ev::Regler(nr, v) => p.setze_regler(nr, v),
                }
            }
        }
        p.sample_stereo()
    }).collect()
}

fn bits(v: (f32, f32)) -> (u32, u32) { (v.0.to_bits(), v.1.to_bits()) }

#[test]
fn note_von_hz_inverts_every_note() {
    for n in 0..=127u8 {
        assert_eq!(note_von_hz(440.0 * 2f32.powf((n as f32 - 69.0) / 12.0)), n);
    }
    assert_eq!(note_von_hz(1.0), 0, "below the range clamps to 0");
    assert_eq!(note_von_hz(20_000.0), 127, "above the range clamps to 127");
}

#[test]
fn original_order_reproduces_the_source_outside_the_end_fades() {
    let q = quelle();
    let mut p = programm(&wahl_graph(&gleiche_grenzen(16, SL), "", 4), &q);
    let mut ev = Vec::new();
    for k in 0..16usize {
        ev.push((SL * k, Ev::An(k as u8)));
        ev.push((SL * (k + 1), Ev::Aus(k as u8)));
    }
    ev.sort_by_key(|e| e.0); // stable: at one frame the off of slice k stays before the on of slice k + 1
    let out = spiele(&mut p, 16 * SL + 100, &ev);
    for i in 0..16 * SL {
        if i % SL < SL - 96 {
            assert_eq!(bits(out[i]), (q[2 * i].to_bits(), q[2 * i + 1].to_bits()), "frame {i}");
        } else {
            assert!(out[i].0.abs() <= q[2 * i].abs() + 1e-6, "frame {i}: the end fade only lowers the level");
        }
    }
    assert!(out[16 * SL..].iter().all(|v| *v == (0.0, 0.0)), "silent after the last slice");
}

#[test]
fn uneven_slices_play_their_own_length() {
    let q = quelle();
    let g = [0u64, 1000, 1010, 30_000, 90_000];
    let mut p = programm(&wahl_graph(&g, "", 2), &q);
    let out = spiele(&mut p, 40_000, &[(0, Ev::An(2)), (35_000, Ev::An(1))]);
    for i in 0..(28_990 - 96) {
        assert_eq!(bits(out[i]), (q[2 * (1010 + i)].to_bits(), q[2 * (1010 + i) + 1].to_bits()), "frame {i}");
    }
    assert!(out[28_990..35_000].iter().all(|v| *v == (0.0, 0.0)), "slice 2 ends at its table entry");
    // a 10-frame slice is inside the 96-frame end fade from its first frame: level 10/96 of the source
    assert!((out[35_000].0 - q[2 * 1000] * (10.0 / 96.0)).abs() < 1e-6, "{} vs {}", out[35_000].0, q[2 * 1000] * (10.0 / 96.0));
    assert!(out[35_010..].iter().all(|v| *v == (0.0, 0.0)), "slice 1 has 10 frames");
}

#[test]
fn note_64_plus_i_plays_slice_i_backwards() {
    let q = quelle();
    let mut p = programm(&wahl_graph(&gleiche_grenzen(16, SL), "", 2), &q);
    let out = spiele(&mut p, SL + 100, &[(0, Ev::An(64 + 3))]);
    for j in 0..SL - 96 {
        let i = SL * 4 - 1 - j;
        assert_eq!(bits(out[j]), (q[2 * i].to_bits(), q[2 * i + 1].to_bits()), "frame {j}");
    }
    assert!(out[SL..].iter().all(|v| *v == (0.0, 0.0)), "the reversed hit ends at the slice start");
    // the slice index wraps: note 64 + 3 + 16 is slice (3 + 16) mod 64 mod 16 = 3 again, forward
    let mut p = programm(&wahl_graph(&gleiche_grenzen(16, SL), "", 2), &q);
    let out = spiele(&mut p, 100, &[(0, Ev::An(19))]);
    assert_eq!(bits(out[0]), (q[2 * SL * 3].to_bits(), q[2 * SL * 3 + 1].to_bits()), "note 19: slice 3 forward");
}

#[test]
fn the_gate_ends_the_hit_and_hold_plays_to_the_slice_end() {
    let q = quelle();
    let mut p = programm(&wahl_graph(&gleiche_grenzen(16, SL), "", 2), &q);
    let out = spiele(&mut p, 3 * SL, &[(0, Ev::An(0)), (1000, Ev::Aus(0))]);
    // the release is exponential to -60 dB over 5 ms (240 frames): half way it is -30 dB
    let i = (1100..1140).find(|i| q[2 * i].abs() > 0.3).unwrap();
    let soll = q[2 * i] * 10f32.powf(-3.0 * (i - 1000) as f32 / 240.0);
    assert!((out[i].0 - soll).abs() <= 1e-3 * soll.abs(), "frame {i}: {} vs {soll}", out[i].0);
    assert!(out[1000].0 == q[2000], "the release starts at the level of the last frame");
    for j in 1241..3 * SL {
        assert!(out[j].0.abs() < 0.001 && out[j].1.abs() < 0.001, "frame {j}: {:?}", out[j]);
    }
    // gate held: the slice plays to its end (end fade over the last 96 frames), then silence
    let mut p = programm(&wahl_graph(&gleiche_grenzen(16, SL), "", 2), &q);
    let out = spiele(&mut p, 3 * SL, &[(0, Ev::An(0))]);
    for i in 0..SL - 96 {
        assert_eq!(out[i].0.to_bits(), q[2 * i].to_bits(), "frame {i}");
    }
    assert!(out[SL..].iter().all(|v| *v == (0.0, 0.0)));
    // a longer `ausklang` stretches the release
    let mut p = programm(&wahl_graph(&gleiche_grenzen(16, SL), r#","ausklang":50"#, 2), &q);
    let out = spiele(&mut p, 3 * SL, &[(0, Ev::An(0)), (1000, Ev::Aus(0))]);
    assert!(out[1300..1400].iter().any(|v| v.0.abs() > 0.01), "still audible after 6 ms");
    assert!(out[1000 + 2400 + 1..].iter().all(|v| v.0.abs() < 0.001), "silent 50 ms after the fall");
}

#[test]
fn tempo_and_halb_set_the_rate_latched_at_the_trigger() {
    let q = quelle();
    // fixed tempo 2: the slice is read at twice the speed and ends after 5625 / 2 frames
    let mut p = programm(&wahl_graph(&gleiche_grenzen(16, SL), r#","tempo":2"#, 2), &q);
    let out = spiele(&mut p, SL, &[(0, Ev::An(0))]);
    for j in 0..2700 {
        assert_eq!(bits(out[j]), (q[4 * j].to_bits(), q[4 * j + 1].to_bits()), "frame {j}");
    }
    assert!(out[2813..].iter().all(|v| *v == (0.0, 0.0)), "the slice ends after 2813 frames");
    assert!(out[2800].0 != 0.0 || out[2790].0 != 0.0);
    // halb 12 is the same rate
    let mut p = programm(&wahl_graph(&gleiche_grenzen(16, SL), r#","halb":12"#, 2), &q);
    let out2 = spiele(&mut p, SL, &[(0, Ev::An(0))]);
    assert!(out2 == out);
    // tempo from a knob (0 -> 1, 0.5 -> 2.5 with min 1 max 4): changing it after the trigger changes nothing
    let json = r#"{"format":"baukasten/2","name":"s","stimmen":2,"knoten":[{"id":"n","art":"note"},{"id":"k","art":"regler","nr":1,"min":1,"max":3},{"id":"s","art":"sampler","datei":"q.f32","noten_wahl":1,"grenzen":[0,5625,11250]},{"id":"o","art":"ausgang"}],"kanten":[{"von":"n.hz","nach":"s.hz"},{"von":"n.trig","nach":"s.trig"},{"von":"n.gate","nach":"s.gate"},{"von":"k.aus","nach":"s.tempo"},{"von":"s.l","nach":"o.l"},{"von":"s.r","nach":"o.r"}]}"#;
    let mut p = programm(json, &q);
    let a = spiele(&mut p, 3000, &[(0, Ev::Regler(1, 0.0)), (1, Ev::An(0)), (500, Ev::Regler(1, 1.0))]);
    let mut p = programm(json, &q);
    let b = spiele(&mut p, 3000, &[(0, Ev::Regler(1, 0.0)), (1, Ev::An(0))]);
    assert!(a == b, "a knob change after the trigger must not change the running hit");
    let mut p = programm(json, &q);
    let c = spiele(&mut p, 3000, &[(0, Ev::Regler(1, 1.0)), (1, Ev::An(0))]);
    assert!(c != b, "the knob value at the trigger sets the rate");
    assert_eq!(bits(c[1 + 100]), (q[2 * 300].to_bits(), q[2 * 300 + 1].to_bits()), "tempo 3 reads frame 3 * j");
}

#[test]
fn scheibe_and_rueck_are_ignored_in_the_note_mode() {
    let q = quelle();
    let mut p = programm(&wahl_graph(&gleiche_grenzen(16, SL), r#","scheibe":5,"rueck":1"#, 2), &q);
    let out = spiele(&mut p, 200, &[(0, Ev::An(2))]);
    assert_eq!(bits(out[0]), (q[2 * SL * 2].to_bits(), q[2 * SL * 2 + 1].to_bits()));
    assert_eq!(bits(out[1]), (q[2 * (SL * 2 + 1)].to_bits(), q[2 * (SL * 2 + 1) + 1].to_bits()));
}

#[test]
fn a_table_without_the_note_mode_picks_the_slice_by_scheibe() {
    let q = quelle();
    let g = [0u64, 1000, 5000, 90_000];
    // pitch mode over a table: `scheibe` 1 plays the region 1000..5000 at the pitch of the note (note 60 is the root, ~1x)
    let json = graph("q.f32", &format!(r#","scheibe":1,"grenzen":[{}]"#, liste(&g)), 2);
    let mut p = programm(&json, &q);
    let out = spiele(&mut p, 5000, &[(0, Ev::An(60))]);
    for j in [0usize, 10, 500, 3000] {
        assert!((out[j].0 - q[2 * (1000 + j)]).abs() < 1e-2, "frame {j}: {} vs {}", out[j].0, q[2 * (1000 + j)]);
    }
    assert!(out[4200..].iter().all(|v| v.0.abs() < 1e-3), "the region has 4000 frames");
}

#[test]
fn grenzen_checks() {
    let w = wurzel();
    schreibe(&w, "q.f32", &quelle());
    let frames = 90_000u64;
    let wert_ist = |extra: String, soll: &str| {
        let r = uebersetze_mit_wurzel(&graph("q.f32", &extra, 1), SR, Some(&w));
        match r {
            Err(Fehler::Wert { wert, .. }) => assert_eq!(wert, soll, "{extra}"),
            other => panic!("{extra}: expected Fehler::Wert {{ {soll} }}, got {:?}", other.err()),
        }
    };
    let mit = |g: &str| format!(r#","grenzen":[{g}]"#);
    let viele = |n: usize, laenge: usize| liste(&gleiche_grenzen(n, laenge));
    wert_ist(mit("0"), "grenzen");
    wert_ist(mit(""), "grenzen");
    wert_ist(mit(&viele(65, 100)), "grenzen"); // 66 entries
    wert_ist(mit("0,100,100,200"), "grenzen"); // not strictly rising
    wert_ist(mit("0,300,200,400"), "grenzen");
    wert_ist(mit(&format!("0,{}", frames + 1)), "grenzen"); // last > frames
    wert_ist(mit("0,3,1000"), "grenzen"); // a slice of 3 frames
    wert_ist(mit("0,1000,1003"), "grenzen");
    wert_ist(format!(r#","scheiben":4{}"#, mit("0,1000")), "scheiben");
    wert_ist(format!(r#","scheiben":1{}"#, mit("0,1000")), "scheiben"); // present at all
    wert_ist(r#","noten_wahl":2"#.to_string(), "noten_wahl");
    wert_ist(r#","noten_wahl":0.5"#.to_string(), "noten_wahl");
    wert_ist(r#","noten_wahl":1,"schleife":1"#.to_string(), "schleife");
    // grenzen on another block
    let svf = r#"{"format":"baukasten/2","name":"s","knoten":[{"id":"f","art":"svf","grenzen":[0,100]},{"id":"o","art":"ausgang"}]}"#;
    match uebersetze_mit_wurzel(svf, SR, Some(&w)) {
        Err(Fehler::Wert { wert, .. }) => assert_eq!(wert, "grenzen"),
        other => panic!("svf with grenzen: {:?}", other.err()),
    }
    // accepted
    for g in [format!("0,{frames}"), viele(64, 1000), "0,4,8".to_string(), format!("100,{frames}")] {
        let r = uebersetze_mit_wurzel(&graph("q.f32", &mit(&g), 1), SR, Some(&w));
        assert!(r.is_ok(), "{g}: {:?}", r.err());
        let r = uebersetze_mit_wurzel(&graph("q.f32", &format!(r#","noten_wahl":1{}"#, mit(&g)), 1), SR, Some(&w));
        assert!(r.is_ok(), "{g} with noten_wahl: {:?}", r.err());
    }
}

#[test]
fn sixty_seconds_load_and_one_frame_more_is_refused() {
    let w = wurzel();
    schreibe(&w, "voll.f32", &vec![0.1f32; 2 * 2_880_000]);
    schreibe(&w, "zuviel.f32", &vec![0.1f32; 2 * 2_880_001]);
    assert!(uebersetze_mit_wurzel(&graph("voll.f32", "", 1), SR, Some(&w)).is_ok());
    let r = uebersetze_mit_wurzel(&graph("zuviel.f32", "", 1), SR, Some(&w));
    assert!(matches!(r, Err(Fehler::Datei { .. })), "{:?}", r.err());
    // a convolution stays bounded by its own `laenge_max`, not by the file limit
    let fa = r#"{"format":"baukasten/2","name":"f","knoten":[{"id":"f","art":"faltung","datei":"voll.f32"},{"id":"o","art":"ausgang"}]}"#;
    let r = uebersetze_mit_wurzel(fa, SR, Some(&w));
    assert!(matches!(r, Err(Fehler::Datei { .. })), "a 60 s IR is refused by laenge_max: {:?}", r.err());
}

/// A step that feeds `smp.tempo` and also sits in a candidate branch of a `wahl` must not be skipped: `tempo`, `halb` and
/// `ausklang` are inputs of the sampler for the branch rule (`zweige::eingaenge`).
#[test]
fn a_tempo_source_shared_with_a_wahl_candidate_is_not_skipped() {
    let q = quelle();
    // t (knob 2, 1..3) -> m -> smp.tempo and m -> w.e1; smp.l -> w.e2; t -> c -> w.e3 gives a branch that is really skipped; the knob 1 selects candidate 2
    let json = r#"{"format":"baukasten/2","name":"s","stimmen":1,"knoten":[{"id":"n","art":"note"},{"id":"k","art":"regler","nr":1,"min":0,"max":1},{"id":"t","art":"regler","nr":2,"min":1,"max":3},{"id":"m","art":"mul","b":1},{"id":"s","art":"sampler","datei":"q.f32","noten_wahl":1,"grenzen":[0,5625,11250]},{"id":"c","art":"mul","b":0.5},{"id":"w","art":"wahl","n":3,"norm":1,"blende":0},{"id":"o","art":"ausgang"}],"kanten":[{"von":"t.aus","nach":"c.a"},{"von":"c.aus","nach":"w.e3"},{"von":"n.hz","nach":"s.hz"},{"von":"n.trig","nach":"s.trig"},{"von":"n.gate","nach":"s.gate"},{"von":"t.aus","nach":"m.a"},{"von":"m.aus","nach":"s.tempo"},{"von":"m.aus","nach":"w.e1"},{"von":"s.l","nach":"w.e2"},{"von":"k.aus","nach":"w.wahl"},{"von":"w.aus","nach":"o.x"}]}"#;
    let lauf = |zweige: bool| {
        let mut p = programm(json, &q);
        p.setze_zweige(zweige);
        let out = spiele(&mut p, 3000, &[(0, Ev::Regler(1, 0.5)), (0, Ev::Regler(2, 1.0)), (1, Ev::An(0))]);
        (out, p.uebersprungen())
    };
    let (mit, uebersprungen) = lauf(true);
    let (ohne, _) = lauf(false);
    assert!(mit.iter().any(|v| v.0.abs() > 0.05), "silent comparison is blind");
    assert_eq!(bits(ohne[1 + 100]), (q[2 * 300].to_bits(), q[2 * 300].to_bits()), "tempo 3 reads every third frame");
    assert!(uebersprungen > 0, "the other candidate is skipped, otherwise the test checks nothing");
    assert!(mit == ohne, "branch skipping must not change the output");
}

// ---- sampler A2 task 5: `rastet` on a `regler` ----

#[test]
fn rastet_checks_and_the_mask() {
    let graph_mit = |knoten: &str| format!(r#"{{"format":"baukasten/2","name":"r","stimmen":1,"knoten":[{knoten},{{"id":"o","art":"ausgang"}}],"kanten":[{{"von":"a.aus","nach":"o.x"}}]}}"#);
    let wert_ist = |knoten: &str, soll: &str| {
        match uebersetze_mit_wurzel(&graph_mit(knoten), SR, None) {
            Err(Fehler::Wert { wert, .. }) => assert_eq!(wert, soll, "{knoten}"),
            other => panic!("{knoten}: expected Fehler::Wert {{ {soll} }}, got {:?}", other.err()),
        }
    };
    wert_ist(r#"{"id":"a","art":"regler","nr":3,"min":0,"max":1,"rastet":2}"#, "rastet");
    wert_ist(r#"{"id":"a","art":"regler","nr":3,"min":0,"max":1,"rastet":0.5}"#, "rastet");
    wert_ist(r#"{"id":"a","art":"regler","nr":3,"min":0,"max":1,"rastet":-1}"#, "rastet");
    // knobs with the same nr must agree, in either order
    wert_ist(r#"{"id":"a","art":"regler","nr":3,"min":0,"max":1,"rastet":1},{"id":"b","art":"regler","nr":3,"min":0,"max":1}"#, "rastet");
    wert_ist(r#"{"id":"a","art":"regler","nr":3,"min":0,"max":1},{"id":"b","art":"regler","nr":3,"min":0,"max":1,"rastet":1}"#, "rastet");
    let maske = |knoten: &str| uebersetze_mit_wurzel(&graph_mit(knoten), SR, None).unwrap_or_else(|e| panic!("{knoten}: {e}")).rastende();
    assert_eq!(maske(r#"{"id":"a","art":"regler","nr":3,"min":0,"max":1}"#), 0, "absent is 0");
    assert_eq!(maske(r#"{"id":"a","art":"regler","nr":3,"min":0,"max":1,"rastet":0}"#), 0);
    assert_eq!(maske(r#"{"id":"a","art":"regler","nr":3,"min":0,"max":1,"rastet":1}"#), 0b100);
    // equal nr agreeing, and different nr independent: knobs 2, 3 and 64
    assert_eq!(maske(r#"{"id":"a","art":"regler","nr":3,"min":0,"max":1,"rastet":1},{"id":"b","art":"regler","nr":3,"min":0,"max":2,"rastet":1},{"id":"c","art":"regler","nr":2,"min":0,"max":1,"rastet":1},{"id":"d","art":"regler","nr":4,"min":0,"max":1},{"id":"e","art":"regler","nr":64,"min":0,"max":1,"rastet":1}"#),
               (1u64 << 63) | 0b110);
}
