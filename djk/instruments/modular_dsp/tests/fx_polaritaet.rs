//! `fx-polaritaet` (demos/fx-polaritaet.json): flips the polarity of both sides, the left or the right one (one 4-stop selector: L + R, Left, Off, Right).
//! Bit-exact both ways: on = -input, off = input, and the 0.5 fill of an insert stage is "Off".
use baukasten_dsp::{uebersetze, Programm, REGLER};

const SR: f32 = 48_000.0;
const GRAPH: &str = include_str!("../demos/fx-polaritaet.json");

fn lade(k: &[(usize, f32)]) -> Programm {
    let mut p = uebersetze(GRAPH, SR).unwrap_or_else(|e| panic!("{e}"));
    for &(n, v) in k { p.setze_regler(n, v); }
    p
}

/// a signal with awkward values: noise, a loud saw, denormal-small values, exact zero, +-1 and values above 1
fn signal() -> Vec<(f32, f32)> {
    let mut s: u32 = 0x9e37_79b9;
    let mut v: Vec<(f32, f32)> = (0..20_000).map(|i| {
        s ^= s << 13; s ^= s >> 17; s ^= s << 5;
        let a = 2.0 * (s as f32 / u32::MAX as f32) - 1.0;
        let b = 2.0 * (((i as f32) * 0.00731).fract()) - 1.0;
        (a, 1.7 * b)
    }).collect();
    v.extend([(0.0, 0.0), (1.0, -1.0), (1e-30, -1e-38), (3.5, -3.5), (f32::MIN_POSITIVE, 0.1)]);
    v
}

fn lauf(p: &mut Programm, x: &[(f32, f32)]) -> Vec<(f32, f32)> {
    x.iter().map(|&(l, r)| { p.setze_eingang(l, r); p.sample_stereo() }).collect()
}

#[test]
fn bitgenau_aus_ein_und_je_seite() {
    let x = signal();
    // the four stops of the selector store i/3 (both, left, Off, right); 0.5 is the insert fill and lies in the Off zone
    for (k, il, ir) in [(0.0f32, true, true), (1.0 / 3.0, true, false), (2.0 / 3.0, false, false), (1.0, false, true), (0.5, false, false)] {
        let mut p = lade(&[(1, k)]);
        let y = lauf(&mut p, &x);
        let ok_wert = x.iter().zip(&y).all(|(&(l, r), &(yl, yr))| yl == (if il { -l } else { l }) && yr == (if ir { -r } else { r }));
        // bits too, except for the sign of zero (0.0 * -1 is -0.0, which equals 0.0 in value)
        let ok_bits = x.iter().zip(&y).all(|(&(l, r), &(yl, yr))| {
            (l == 0.0 || yl.to_bits() == (if il { -l } else { l }).to_bits()) && (r == 0.0 || yr.to_bits() == (if ir { -r } else { r }).to_bits())
        });
        println!("MESS polarity knob {k:.4}: left inverted {il}, right inverted {ir}: value-exact {ok_wert}, bit-exact apart from -0.0 {ok_bits}");
        assert!(ok_wert && ok_bits, "knob {k}: not exact");
    }
}

#[test]
fn panel_und_engine_stimmen_an_den_stufen_und_bei_0_5_ueberein() {
    // the panel stores stop i of 4 as i/3 and reads it back with round(3k); the engine zone is floor(4k). Both give i at the stored values and 2 (Off) at 0.5.
    let panel_index = |k: f32| (k * 3.0).round() as usize;
    let engine_zone = |k: f32| ((k as f64) * 4.0).floor().min(3.0) as usize;
    for i in 0..4usize {
        let k = (i as f32) / 3.0;
        assert_eq!((panel_index(k), engine_zone(k)), (i, i));
    }
    assert_eq!((panel_index(0.5), engine_zone(0.5)), (2, 2));
}

#[test]
fn ohne_latenz_vorgabe_und_mit_namen() {
    let p = lade(&[]);
    assert!(p.hat_eingang());
    assert_eq!(p.latenz(), 0);
    assert_eq!(p.regler_vorgaben(), [0.5f32; REGLER], "an insert graph keeps the 0.5 fill");
    let names: Vec<&str> = p.regler_namen.iter().map(|(_, s)| s.as_str()).collect();
    assert_eq!(names, ["Polarity"]);
}

#[test]
fn umschalten_im_lauf_bleibt_endlich_und_landet_exakt() {
    let x = signal();
    let mut p = lade(&[]);
    let mut y = Vec::new();
    for (i, &(l, r)) in x.iter().enumerate() {
        if i == 5_000 { p.setze_regler(1, 0.0); }
        if i == 12_000 { p.setze_regler(1, 2.0 / 3.0); }
        p.setze_eingang(l, r);
        y.push(p.sample_stereo());
    }
    assert!(y.iter().all(|(l, r)| l.is_finite() && r.is_finite()) && p.rettungen == 0);
    // the 5 ms crossfade (240 samples) has settled 300 samples after each switch
    for i in (5_300..12_000).chain(12_300..x.len()) {
        let inv = i < 12_000;
        let (l, r) = x[i];
        assert!(y[i].0 == if inv { -l } else { l } && y[i].1 == if inv { -r } else { r }, "sample {i}");
    }
}
