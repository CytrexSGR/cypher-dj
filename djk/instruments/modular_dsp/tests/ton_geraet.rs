//! Sampler C task 1: the generated tone device (`tonGraph` in djk/ui/sampler/tone.ts, fixture common/ton-probe.json) played at block level.
//! The graph reads the region [4800, 52800) of a 60 000 frame file in pitch mode with the root at note 57 (220 Hz).
#[path = "sampler_helpers/mod.rs"]
mod sampler_hilfe;
use baukasten_dsp::programm::Programm;
use baukasten_dsp::uebersetze_mit_wurzel;
use sampler_hilfe::*;

const SR: f32 = 48_000.0;
const VEL: f32 = 100.0 / 127.0;
const FRAMES: usize = 60_000;

/// The source: a 220 Hz sine with a slow amplitude wobble (so a wrong read position shows), right side half as loud.
fn quelle_links() -> Vec<f32> {
    (0..FRAMES).map(|i| {
        let t = i as f64 / 48_000.0;
        ((2.0 * std::f64::consts::PI * 220.0 * t).sin() * (0.5 + 0.4 * (2.0 * std::f64::consts::PI * 1.3 * t).sin())) as f32
    }).collect()
}

fn programm(l: &[f32]) -> Programm {
    let w = wurzel();
    let d: Vec<f32> = l.iter().flat_map(|v| [*v, 0.5 * *v]).collect();
    schreibe(&w, "smp-probe-0000.f32", &d);
    uebersetze_mit_wurzel(include_str!("common/ton-probe.json"), SR, Some(&w)).unwrap_or_else(|e| panic!("{e}"))
}

/// `n` frames; note `note` goes on at frame 0 (and stays held), `regler` is set before it.
fn spiele(p: &mut Programm, n: usize, note: u8, regler: Option<(usize, f32)>) -> Vec<(f32, f32)> {
    if let Some((nr, v)) = regler { p.setze_regler(nr, v); }
    (0..n).map(|i| {
        if i == 0 { p.note_an(note, VEL); }
        p.sample_stereo()
    }).collect()
}

#[test]
fn the_root_note_plays_the_region_at_original_speed() {
    let l = quelle_links();
    let mut p = programm(&l);
    let out = spiele(&mut p, 50_000, 57, None);
    for j in (1000..47_000).step_by(997) {
        assert!((out[j].0 - l[4800 + j]).abs() < 0.02, "frame {j}: {} vs {}", out[j].0, l[4800 + j]);
        assert!((out[j].1 - 0.5 * l[4800 + j]).abs() < 0.02, "right, frame {j}");
    }
    assert!(out[48_008..].iter().all(|v| v.0.abs() < 1e-3 && v.1.abs() < 1e-3), "the region has 48 000 frames");
}

#[test]
fn an_octave_up_plays_at_double_speed() {
    let l = quelle_links();
    let mut p = programm(&l);
    let out = spiele(&mut p, 26_000, 69, None);
    for j in (1000..23_000).step_by(499) {
        assert!((out[j].0 - l[4800 + 2 * j]).abs() < 0.02, "frame {j}: {} vs {}", out[j].0, l[4800 + 2 * j]);
    }
    assert!(out[24_008..].iter().all(|v| v.0.abs() < 1e-3 && v.1.abs() < 1e-3), "the region at double speed has 24 000 frames");
}

#[test]
fn tune_at_one_raises_a_semitone() {
    let l = quelle_links();
    let mut p = programm(&l);
    let out = spiele(&mut p, 50_000, 57, Some((1, 1.0)));
    let letzter = out.iter().rposition(|v| v.0.abs() > 1e-3).expect("silent output");
    assert!((letzter as i64 - 45_305).abs() <= 8, "last sounding frame {letzter}, expected 45 305 +- 8 (48 000 / 2^(1/12))");
}
