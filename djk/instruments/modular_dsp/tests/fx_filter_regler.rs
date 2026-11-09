//! Baukasten S5r: example effect graph `fx-filter-regler` (knob 1 cutoff, knob 2 resonance).
use baukasten_dsp::{uebersetze, Programm};

const SR: f32 = 48_000.0;
const FX: &str = include_str!("../demos/fx-filter-regler.json");

fn lade() -> Programm { uebersetze(FX, SR).unwrap_or_else(|e| panic!("{e}")) }
fn rms(x: &[f32]) -> f32 { (x.iter().map(|v| v * v).sum::<f32>() / x.len() as f32).sqrt() }
// brightness: rms of the first difference relative to rms
fn hell(x: &[f32]) -> f32 { rms(&x.windows(2).map(|w| w[1] - w[0]).collect::<Vec<_>>()) / rms(x).max(1e-9) }

// deterministic white noise in -0.5..0.5
fn rauschen(n: usize) -> Vec<f32> {
    let mut s: u32 = 0x1234_5678;
    (0..n).map(|_| { s ^= s << 13; s ^= s >> 17; s ^= s << 5; (s as f32 / u32::MAX as f32) - 0.5 }).collect()
}

fn filtere(regler: &[(usize, f32)]) -> Vec<f32> {
    let mut p = lade();
    for &(nr, w) in regler { p.setze_regler(nr, w); }
    let ein = rauschen(24_000);
    let aus: Vec<f32> = ein.iter().map(|&x| { p.setze_eingang(x, x); p.sample_stereo().0 }).collect();
    aus[4_800..].to_vec()
}

#[test]
fn laedt_als_effekt_ohne_latenz_mit_namen() {
    let p = lade();
    assert!(p.hat_eingang());
    assert_eq!(p.latenz(), 0);
    let namen: Vec<usize> = p.regler_namen.iter().map(|(n, _)| *n).collect();
    assert_eq!(namen, vec![1, 2]);
}

#[test]
fn regler_1_oeffnet_das_filter_monoton() {
    let stufen = [0.0, 0.25, 0.5, 0.75, 1.0];
    let h: Vec<f32> = stufen.iter().map(|&w| hell(&filtere(&[(1, w), (2, 0.0)]))).collect();
    for i in 1..h.len() { assert!(h[i] > h[i - 1] * 1.05, "brightness not rising at step {i}: {h:?}"); }
}

#[test]
fn endlich_an_allen_reglerenden() {
    for c in [0.0, 1.0] {
        for r in [0.0, 1.0] {
            let y = filtere(&[(1, c), (2, r)]);
            assert!(y.iter().all(|v| v.is_finite()), "non-finite at cutoff {c} reso {r}");
            let spitze = y.iter().fold(0.0f32, |m, v| m.max(v.abs()));
            assert!(spitze < 4.0, "peak {spitze} at cutoff {c} reso {r}");
            assert!(rms(&y) > 1e-4, "silent at cutoff {c} reso {r}");
        }
    }
}
