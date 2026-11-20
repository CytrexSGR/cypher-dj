//! Sample player stage 2c: key and velocity cross-fades between zones (`taste_blende`, `vel_blende`) and the release level
//! by hold time (`frei_halte`).
#[path = "sampler_helpers/mod.rs"]
mod sampler_hilfe;
use baukasten_dsp::{uebersetze_mit_wurzel, Fehler, Programm};
use sampler_hilfe::*;

const SR: f32 = 48_000.0;

fn zeile(a: u64, b: u64, lo: u8, hi: u8, vlo: u8, vhi: u8, art: u8) -> [f64; 12] {
    [a as f64, b as f64, 60.0, lo as f64, hi as f64, vlo as f64, vhi as f64, 1.0, 0.0, 0.0, 0.0, art as f64]
}
fn flach(z: &[[f64; 12]]) -> String { z.iter().flatten().map(|v| v.to_string()).collect::<Vec<_>>().join(",") }

fn graph(z: &[[f64; 12]], extra: &str) -> String {
    format!(
        r#"{{"format":"baukasten/2","name":"z","stimmen":4,"knoten":[{{"id":"n","art":"note"}},{{"id":"s","art":"sampler","datei":"p.f32","zonen":[{}]{extra}}},{{"id":"o","art":"ausgang"}}],"kanten":[{{"von":"n.hz","nach":"s.hz"}},{{"von":"n.trig","nach":"s.trig"}},{{"von":"n.gate","nach":"s.gate"}},{{"von":"n.vel","nach":"s.vel"}},{{"von":"s.l","nach":"o.l"}},{{"von":"s.rl","nach":"o.r"}}]}}"#,
        flach(z)
    )
}

fn bauen(d: &[f32], z: &[[f64; 12]], extra: &str) -> Result<Programm, Fehler> {
    let w = wurzel();
    schreibe(&w, "p.f32", d);
    uebersetze_mit_wurzel(&graph(z, extra), SR, Some(&w))
}

fn nahe(a: f32, b: f32) -> bool { (a - b).abs() < 1e-4 }

/// (left, right) at sample 100 250 samples after a note on (past the retrigger fades).
fn ton(p: &mut Programm, note: u8, vel: f32) -> (f32, f32) {
    p.note_an(note, vel);
    let v: Vec<(f32, f32)> = (0..300).map(|_| p.sample_stereo()).collect();
    v[250]
}

/// Key layout: zone A (0.1) keys 0..59, zone B (0.2) keys 60..127.
fn tasten() -> (Vec<f32>, [[f64; 12]; 2]) {
    (segmente(2, 4000), [zeile(0, 4000, 0, 59, 1, 127, 0), zeile(4000, 8000, 60, 127, 1, 127, 0)])
}

#[test]
fn key_cross_fade_blends_the_two_zones_at_a_seam_with_equal_power() {
    let (d, z) = tasten();
    // width 4 keys: key 59 is 0.5 key inside A (weight 0.5 + 0.5 / 4) and 0.5 key outside B
    let mut p = bauen(&d, &z, r#","taste_blende":4"#).unwrap();
    let soll = (0.625f32).sqrt() * 0.1 + (0.375f32).sqrt() * 0.2;
    let (l, _) = ton(&mut p, 59, 1.0);
    assert!(nahe(l, soll), "{l} != {soll}");
    let mut p = bauen(&d, &z, r#","taste_blende":4"#).unwrap();
    let soll = (0.625f32).sqrt() * 0.2 + (0.375f32).sqrt() * 0.1;
    let (l, _) = ton(&mut p, 60, 1.0);
    assert!(nahe(l, soll), "{l} != {soll}");
}

#[test]
fn key_cross_fade_leaves_notes_away_from_the_seam_alone() {
    let (d, z) = tasten();
    let mut p = bauen(&d, &z, r#","taste_blende":4"#).unwrap();
    assert!(nahe(ton(&mut p, 40, 1.0).0, 0.1));
    let mut p = bauen(&d, &z, r#","taste_blende":4"#).unwrap();
    assert!(nahe(ton(&mut p, 90, 1.0).0, 0.2));
}

#[test]
fn without_a_cross_fade_the_seam_is_hard() {
    let (d, z) = tasten();
    let mut p = bauen(&d, &z, "").unwrap();
    assert!(nahe(ton(&mut p, 59, 1.0).0, 0.1));
    let mut p = bauen(&d, &z, r#","taste_blende":0"#).unwrap();
    assert!(nahe(ton(&mut p, 60, 1.0).0, 0.2));
}

#[test]
fn the_edges_of_the_keyboard_do_not_fade() {
    let (d, z) = tasten();
    let mut p = bauen(&d, &z, r#","taste_blende":4"#).unwrap();
    assert!(nahe(ton(&mut p, 0, 1.0).0, 0.1), "zone A reaches key 0");
    let mut p = bauen(&d, &z, r#","taste_blende":4"#).unwrap();
    assert!(nahe(ton(&mut p, 127, 1.0).0, 0.2), "zone B reaches key 127");
}

#[test]
fn velocity_cross_fade_blends_the_layers() {
    let d = segmente(2, 4000);
    let z = [zeile(0, 4000, 0, 127, 1, 63, 0), zeile(4000, 8000, 0, 127, 64, 127, 0)];
    // velocity 64: the loud layer is 0.5 inside its edge, the soft layer 0.5 outside; width 8 steps
    let mut p = bauen(&d, &z, r#","vel_blende":8"#).unwrap();
    let soll = (0.5625f32).sqrt() * 0.2 + (0.4375f32).sqrt() * 0.1;
    let (l, _) = ton(&mut p, 60, 64.0 / 127.0);
    assert!(nahe(l, soll), "{l} != {soll}");
    let mut p = bauen(&d, &z, r#","vel_blende":8"#).unwrap();
    assert!(nahe(ton(&mut p, 60, 1.0).0, 0.2), "full velocity: only the loud layer");
    let mut p = bauen(&d, &z, "").unwrap();
    assert!(nahe(ton(&mut p, 60, 64.0 / 127.0).0, 0.2), "no cross-fade: the hard split");
}

#[test]
fn round_robin_picks_one_take_per_cell() {
    // two takes in the lower cell (0.1, 0.3), one in the upper (0.2)
    let d = segmente(3, 4000);
    let z = [zeile(0, 4000, 0, 59, 1, 127, 0), zeile(4000, 8000, 60, 127, 1, 127, 0), zeile(8000, 12000, 0, 59, 1, 127, 0)];
    let mut p = bauen(&d, &z, r#","taste_blende":4"#).unwrap();
    let w = (0.625f32).sqrt();
    let v = (0.375f32).sqrt();
    let a = ton(&mut p, 59, 1.0).0;
    assert!(nahe(a, w * 0.1 + v * 0.2), "first take: {a}");
    p.note_aus(59);
    for _ in 0..200 { p.sample_stereo(); }
    let b = ton(&mut p, 59, 1.0).0;
    assert!(nahe(b, w * 0.3 + v * 0.2), "second take: {b}");
}

#[test]
fn release_level_halves_with_every_hold_time() {
    // main zone 0.1, release zone 0.5: the right output carries the release
    let d = [segmente(1, 4000), stereo(2000, |_| 0.5)].concat();
    let z = [zeile(0, 4000, 0, 127, 1, 127, 0), zeile(4000, 6000, 0, 127, 1, 127, 1)];
    let pegel = |extra: &str, halten: usize| -> f32 {
        let mut p = bauen(&d, &z, extra).unwrap();
        p.note_an(60, 1.0);
        for _ in 0..halten { p.sample_stereo(); }
        p.note_aus(60);
        let v: Vec<(f32, f32)> = (0..50).map(|_| p.sample_stereo()).collect();
        v[20].1
    };
    let ohne = pegel("", 24_000);
    assert!(nahe(ohne, 0.5), "{ohne}");
    // half life 1 s: held 0.5 s -> 2^-0.5, held 1 s -> 0.5
    let a = pegel(r#","frei_halte":1"#, 24_000);
    assert!((a - 0.5 * 0.5f32.sqrt()).abs() < 2e-3, "{a}");
    let b = pegel(r#","frei_halte":1"#, 48_000);
    assert!((b - 0.25).abs() < 2e-3, "{b}");
    let kurz = pegel(r#","frei_halte":1"#, 10);
    assert!(kurz > 0.499, "{kurz}");
}

#[test]
fn the_new_values_are_checked_and_belong_to_zone_mode() {
    let (d, z) = tasten();
    for extra in [r#","taste_blende":25"#, r#","taste_blende":-1"#, r#","vel_blende":128"#, r#","frei_halte":61"#, r#","frei_halte":-1"#] {
        assert!(matches!(bauen(&d, &z, extra), Err(Fehler::Wert { .. })), "{extra}");
    }
    let w = wurzel();
    schreibe(&w, "p.f32", &segmente(2, 400));
    for wert in ["taste_blende", "vel_blende", "frei_halte"] {
        let g = format!(r#"{{"format":"baukasten/2","name":"z","stimmen":1,"knoten":[{{"id":"n","art":"note"}},{{"id":"s","art":"sampler","datei":"p.f32","{wert}":2}},{{"id":"o","art":"ausgang"}}],"kanten":[{{"von":"n.hz","nach":"s.hz"}},{{"von":"n.trig","nach":"s.trig"}},{{"von":"s.l","nach":"o.l"}}]}}"#);
        assert!(matches!(uebersetze_mit_wurzel(&g, SR, Some(&w)), Err(Fehler::Wert { .. })), "{wert} outside zone mode");
    }
}
