//! Dynamic EQ bands: threshold, range, above/below, attack, key, static bit-identity, no allocation.
use eq_dsp::*;
use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;
use std::f64::consts::PI;

struct Zaehler;
thread_local! {
    static ALLOKS: Cell<usize> = const { Cell::new(0) };
}
unsafe impl GlobalAlloc for Zaehler {
    unsafe fn alloc(&self, l: Layout) -> *mut u8 {
        let _ = ALLOKS.try_with(|c| c.set(c.get() + 1));
        System.alloc(l)
    }
    unsafe fn dealloc(&self, p: *mut u8, l: Layout) {
        System.dealloc(p, l)
    }
}
#[global_allocator]
static A: Zaehler = Zaehler;

const FS: f64 = 48000.0;

fn sinus(f: f64, db: f64, n: usize, start: usize) -> Vec<f32> {
    let a = 10f64.powf(db / 20.0);
    (0..n).map(|i| (a * (2.0 * PI * f * (start + i) as f64 / FS).sin()) as f32).collect()
}

fn rms_db(x: &[f32]) -> f64 {
    let s: f64 = x.iter().map(|&v| (v as f64) * (v as f64)).sum::<f64>() / x.len() as f64;
    10.0 * s.log10()
}

fn glocke(f: f64, g: f64, q: f64) -> BandEinstellung {
    BandEinstellung { an: true, art: BandArt::Glocke, freq: f, gain_db: g, q, ..Default::default() }
}

/// Runs `x` through `eq` in blocks of 256, returns the output (left).
fn lauf(eq: &mut Eq, x: &[f32], key: Option<&[f32]>) -> Vec<f32> {
    let mut out = Vec::with_capacity(x.len());
    for (ci, c) in x.chunks(256).enumerate() {
        let mut l = c.to_vec();
        let mut r = c.to_vec();
        let k = key.map(|k| &k[ci * 256..ci * 256 + c.len()]);
        eq.verarbeite_stereo_mit_schluessel(&mut l, &mut r, k, k);
        out.extend_from_slice(&l);
    }
    out
}

fn mit_dyn(modus: DynModus, schwelle: f64, bereich: f64) -> Dynamik {
    Dynamik { modus, schwelle_db: schwelle, bereich_db: bereich }
}

fn steady_gain_db(eq: &mut Eq, f: f64, pegel: f64) -> f64 {
    let n = 48000;
    let x = sinus(f, pegel, n, 0);
    let y = lauf(eq, &x, None);
    // skip the latency and the settling
    let a = 24000;
    rms_db(&y[a + 69..n]) - rms_db(&x[a..n - 69])
}

#[test]
fn a_static_eq_is_bit_identical_with_dynamics_off() {
    let x: Vec<f32> = (0..9600).map(|i| 0.3 * (0.05 * i as f32).sin() + 0.1 * ((i * 7919 % 1000) as f32 / 1000.0 - 0.5)).collect();
    let mut a = Eq::neu(FS);
    let mut b = Eq::neu(FS);
    for e in [&mut a, &mut b] {
        e.setze_band(0, glocke(3000.0, -6.0, 2.0));
        e.setze_band(1, BandEinstellung { an: true, art: BandArt::HighShelf, freq: 8000.0, gain_db: 3.0, q: 0.7, ..Default::default() });
    }
    // b gets explicit "off" dynamics and an attack/release change; a never hears of dynamics
    b.setze_dyn(0, Dynamik::default());
    b.setze_dyn_zeiten(1.0, 30.0);
    let ya = lauf(&mut a, &x, None);
    let yb = lauf(&mut b, &x, None);
    assert_eq!(ya, yb);
    // range 0 with dynamics on: no change either
    let mut c = Eq::neu(FS);
    c.setze_band(0, glocke(3000.0, -6.0, 2.0));
    c.setze_band(1, BandEinstellung { an: true, art: BandArt::HighShelf, freq: 8000.0, gain_db: 3.0, q: 0.7, ..Default::default() });
    c.setze_dyn(0, mit_dyn(DynModus::Ueber, -60.0, 0.0));
    let yc = lauf(&mut c, &x, None);
    assert_eq!(ya, yc);
    assert_eq!(c.latenz(), 69);
}

#[test]
fn b_above_threshold_cuts_loud_leaves_quiet() {
    let mut eq = Eq::neu(FS);
    eq.setze_band(0, glocke(3000.0, 0.0, 2.0));
    eq.setze_dyn(0, mit_dyn(DynModus::Ueber, -30.0, -12.0));
    let g = steady_gain_db(&mut eq, 3000.0, -10.0);
    assert!((g + 12.0).abs() < 1.0, "loud: {g}");
    assert!(eq.dyn_db(0) < -11.0);
    let mut eq = Eq::neu(FS);
    eq.setze_band(0, glocke(3000.0, 0.0, 2.0));
    eq.setze_dyn(0, mit_dyn(DynModus::Ueber, -30.0, -12.0));
    let g = steady_gain_db(&mut eq, 3000.0, -40.0);
    assert!(g.abs() < 0.2, "quiet: {g}");
    assert!(eq.dyn_db(0).abs() < 1e-9);
    assert!(eq.dyn_max_db().abs() < 1e-6);
}

#[test]
fn c_below_threshold_boosts_quiet() {
    let mut eq = Eq::neu(FS);
    eq.setze_band(0, glocke(3000.0, 0.0, 2.0));
    eq.setze_dyn(0, mit_dyn(DynModus::Unter, -30.0, 6.0));
    let g = steady_gain_db(&mut eq, 3000.0, -40.0);
    assert!((g - 6.0).abs() < 1.0, "boost: {g}");
    assert!(eq.dyn_max_db() > 5.0);
    assert_eq!(eq.dyn_max_db(), 0.0, "read and reset");
}

#[test]
fn d_attack_reaches_ninety_percent_within_ten_ms() {
    let mut eq = Eq::neu(FS);
    eq.setze_band(0, glocke(3000.0, 0.0, 2.0));
    eq.setze_dyn(0, mit_dyn(DynModus::Ueber, -30.0, -12.0));
    eq.setze_dyn_zeiten(1.0, 80.0);
    // quiet, then a loud step at sample 4800
    let n = 9600;
    let mut x = sinus(3000.0, -50.0, n, 0);
    let loud = sinus(3000.0, -10.0, n - 4800, 4800);
    x[4800..].copy_from_slice(&loud);
    let y = lauf(&mut eq, &x, None);
    // per-cycle gain after the step (1 ms = 48 samples, 3 cycles of 3 kHz)
    let fenster = |von: usize| {
        let a = von + 69;
        rms_db(&y[a..a + 48]) - rms_db(&x[von..von + 48])
    };
    let ziel = -12.0;
    let g = fenster(4800 + 480); // 10 ms after the step
    assert!(g < 0.9 * ziel, "after 10 ms: {g}");
    let g0 = fenster(4800 - 96);
    assert!(g0.abs() < 0.3, "before: {g0}");
}

#[test]
fn e_key_burst_cuts_low_shelf_only_with_key() {
    let n = 48000;
    let steady = sinus(50.0, -40.0, n, 0);
    let key = sinus(60.0, -10.0, n, 0);
    let einrichten = || {
        let mut eq = Eq::neu(FS);
        eq.setze_band(0, BandEinstellung { an: true, art: BandArt::LowShelf, freq: 150.0, gain_db: 0.0, q: 0.707, ..Default::default() });
        eq.setze_dyn(0, mit_dyn(DynModus::UeberSchluessel, -30.0, -12.0));
        eq
    };
    let mut eq = einrichten();
    let y = lauf(&mut eq, &steady, Some(&key));
    let mit = rms_db(&y[30000..n]) - rms_db(&steady[30000 - 69..n - 69]);
    assert!(mit < -8.0, "with key: {mit}");
    // no key: acts as mode 1; the steady input at -40 dB is below the threshold, nothing happens
    let mut eq = einrichten();
    let y = lauf(&mut eq, &steady, None);
    let ohne = rms_db(&y[30000..n]) - rms_db(&steady[30000 - 69..n - 69]);
    assert!(ohne.abs() < 0.5, "without key: {ohne}");
}

#[test]
fn ignored_for_other_band_types() {
    let mut eq = Eq::neu(FS);
    eq.setze_band(0, BandEinstellung { an: true, art: BandArt::Kerbe, freq: 3000.0, gain_db: 0.0, q: 2.0, ..Default::default() });
    eq.setze_dyn(0, mit_dyn(DynModus::Ueber, -60.0, -12.0));
    let x = sinus(1000.0, -10.0, 9600, 0);
    let y = lauf(&mut eq, &x, None);
    assert_eq!(eq.dyn_db(0), 0.0);
    assert!((rms_db(&y[4800 + 69..9600]) - rms_db(&x[4800..9600 - 69])).abs() < 0.2);
}

#[test]
fn f_no_allocation_in_the_block() {
    let mut eq = Eq::neu(FS);
    eq.setze_band(0, glocke(3000.0, 0.0, 2.0));
    eq.setze_band(1, BandEinstellung { an: true, art: BandArt::HighShelf, freq: 6000.0, gain_db: 0.0, q: 0.707, ..Default::default() });
    eq.setze_dyn(0, mit_dyn(DynModus::Ueber, -30.0, -12.0));
    eq.setze_dyn(1, mit_dyn(DynModus::UnterSchluessel, -30.0, 6.0));
    let mut l = sinus(3000.0, -10.0, 256, 0);
    let mut r = l.clone();
    let key = sinus(60.0, -10.0, 256, 0);
    eq.verarbeite_stereo_mit_schluessel(&mut l, &mut r, Some(&key), Some(&key)); // first call may design filters
    let vor = ALLOKS.with(|c| c.get());
    for _ in 0..50 {
        eq.verarbeite_stereo_mit_schluessel(&mut l, &mut r, Some(&key), Some(&key));
        eq.verarbeite_stereo(&mut l, &mut r);
        let _ = eq.dyn_max_db();
    }
    assert_eq!(ALLOKS.with(|c| c.get()), vor);
}
