//! Tracker task 15: `cypher_bk_bend_bei` and `cypher_bk_pegel_bei`, sample exact pitch bend and output level of an instance.
//! A held sine (note 69 = 440 Hz, no envelope) makes frequency and peak measurable.
use hall_ffi::baukasten::*;
use std::ffi::CString;

const FS: f64 = 48_000.0;
const SINUS: &str = r#"{"format":"baukasten/2","name":"bend-probe","stimmen":1,"knoten":[{"id":"n","art":"note"},{"id":"o","art":"sinus"},{"id":"a","art":"ausgang"}],"kanten":[{"von":"n.hz","nach":"o.hz"},{"von":"o.aus","nach":"a.x"}]}"#;

fn neu() -> *mut CypherBk {
    let c = CString::new(SINUS).unwrap();
    let mut fehler = [0 as std::ffi::c_char; 256];
    let h = cypher_bk_neu(c.as_ptr(), FS, fehler.as_mut_ptr(), fehler.len());
    assert!(!h.is_null());
    h
}

/// Renders `n` samples in blocks of `block`; `vor(h, i)` runs before the block starting at sample `i`.
fn rechne(h: *mut CypherBk, n: usize, block: usize, mut vor: impl FnMut(*mut CypherBk, usize)) -> Vec<f32> {
    let mut aus = Vec::with_capacity(n);
    let (mut l, mut r) = (vec![0f32; block], vec![0f32; block]);
    let mut i = 0;
    while i < n {
        let m = block.min(n - i);
        vor(h, i);
        assert_eq!(cypher_bk_block(h, l.as_mut_ptr(), r.as_mut_ptr(), m), 0);
        assert!(l[..m] == r[..m]);
        aus.extend_from_slice(&l[..m]);
        i += m;
    }
    aus
}

/// Positions (in samples, linearly interpolated) of the rising zero crossings.
fn nulldurchgaenge(x: &[f32]) -> Vec<f64> {
    (1..x.len()).filter(|&i| x[i - 1] < 0.0 && x[i] >= 0.0).map(|i| (i - 1) as f64 + (-x[i - 1] / (x[i] - x[i - 1])) as f64).collect()
}

fn frequenz(x: &[f32]) -> f64 {
    let z = nulldurchgaenge(x);
    (z.len() - 1) as f64 * FS / (z[z.len() - 1] - z[0])
}

fn spitze(x: &[f32]) -> f32 {
    x.iter().fold(0.0, |m, v| m.max(v.abs()))
}

#[test]
fn bend_plus_twelve_doubles_the_frequency() {
    let h = neu();
    let ohne = rechne(h, 24_000, 256, |h, i| if i == 0 { cypher_bk_note_an(h, 0, 69, 1.0); });
    cypher_bk_frei(h);
    let h = neu();
    let mit = rechne(h, 24_000, 256, |h, i| if i == 0 { cypher_bk_note_an(h, 0, 69, 1.0); assert_eq!(cypher_bk_bend_bei(h, 0, 12.0, 0), 0); });
    cypher_bk_frei(h);
    let (f0, f1) = (frequenz(&ohne), frequenz(&mit));
    assert!((f0 - 440.0).abs() < 0.5, "f0 {f0}");
    assert!((f1 - 880.0).abs() < 1.0, "f1 {f1}");
    // clamp: +100 acts as +48 (four octaves), -100 as -48
    let h = neu();
    let hoch = rechne(h, 24_000, 256, |h, i| if i == 0 { cypher_bk_note_an(h, 0, 33, 1.0); cypher_bk_bend_bei(h, 0, 100.0, 0); });
    cypher_bk_frei(h);
    assert!((frequenz(&hoch) - 55.0 * 16.0).abs() < 2.0, "{}", frequenz(&hoch));
}

#[test]
fn bend_at_a_sample_inside_the_block_and_across_blocks() {
    // bend +12 at sample 1000 of the first block, reported with offset; audible exactly from there
    let h = neu();
    let x = rechne(h, 9_600, 256, |h, i| {
        if i == 0 { cypher_bk_note_an(h, 0, 69, 1.0); cypher_bk_bend_bei(h, 1000, 12.0, 0); }
    });
    cypher_bk_frei(h);
    assert!((frequenz(&x[100..900]) - 440.0).abs() < 2.0);
    assert!((frequenz(&x[1100..9000]) - 880.0).abs() < 1.0);
}

#[test]
fn glide_reaches_the_target_at_the_last_sample_and_not_before() {
    let h = neu();
    let x = rechne(h, 24_000, 256, |h, i| if i == 0 { cypher_bk_note_an(h, 0, 69, 1.0); cypher_bk_bend_bei(h, 0, 12.0, 4800); });
    cypher_bk_frei(h);
    let z = nulldurchgaenge(&x);
    let periode = |a: usize, b: usize| -> f64 {
        let w: Vec<f64> = z.windows(2).filter(|w| w[0] >= a as f64 && w[1] < b as f64).map(|w| w[1] - w[0]).collect();
        w.iter().sum::<f64>() / w.len() as f64
    };
    let ziel = FS / 880.0;
    // halfway (2400 samples) the pitch is +6 semitones = 622.25 Hz
    assert!((FS / periode(2300, 2500) - 622.25).abs() < 6.0, "{}", FS / periode(2300, 2500));
    // short before the end it is still below the target, afterwards on it
    let vor = periode(4600, 4780);
    assert!(vor > ziel * 1.004, "before the end the period {vor} is still longer than {ziel}");
    let nach = periode(4850, 9000);
    assert!((nach - ziel).abs() < 0.01, "after the end the period {nach} is {ziel}");
}

#[test]
fn glide_state_hits_the_target_at_sample_4800_exactly() {
    // in-module checks need the struct; here through the sound: a jump to +12 and a glide of 4800 end on the same pitch
    let h = neu();
    let a = rechne(h, 12_000, 64, |h, i| if i == 0 { cypher_bk_note_an(h, 0, 69, 1.0); cypher_bk_bend_bei(h, 0, 12.0, 4800); });
    cypher_bk_frei(h);
    // the sample after the glide: frequency over the following 1000 samples equals the target to a tenth of a percent
    assert!((frequenz(&a[4800..5800]) - 880.0).abs() < 0.9);
}

#[test]
fn pegel_half_halves_the_peak() {
    let h = neu();
    let voll = rechne(h, 4800, 256, |h, i| if i == 0 { cypher_bk_note_an(h, 0, 69, 1.0); });
    cypher_bk_frei(h);
    let h = neu();
    let halb = rechne(h, 4800, 256, |h, i| if i == 0 { cypher_bk_note_an(h, 0, 69, 1.0); assert_eq!(cypher_bk_pegel_bei(h, 0, 0.5, 0), 0); });
    cypher_bk_frei(h);
    assert!(spitze(&voll) > 0.5);
    assert!((spitze(&halb) / spitze(&voll) - 0.5).abs() < 1e-6, "{} {}", spitze(&halb), spitze(&voll));
    // clamp to 0..1: 3.0 changes nothing, -1 is silence
    let h = neu();
    let drei = rechne(h, 4800, 256, |h, i| if i == 0 { cypher_bk_note_an(h, 0, 69, 1.0); cypher_bk_pegel_bei(h, 0, 3.0, 0); });
    let null = rechne(h, 4800, 256, |h, _| { cypher_bk_pegel_bei(h, 0, -1.0, 0); });
    cypher_bk_frei(h);
    assert!(drei == voll);
    assert_eq!(spitze(&null), 0.0);
}

#[test]
fn pegel_glide_is_linear_in_the_factor() {
    let h = neu();
    let x = rechne(h, 4800, 256, |h, i| if i == 0 { cypher_bk_note_an(h, 0, 69, 1.0); cypher_bk_pegel_bei(h, 0, 0.0, 480); });
    cypher_bk_frei(h);
    let h = neu();
    let voll = rechne(h, 4800, 256, |h, i| if i == 0 { cypher_bk_note_an(h, 0, 69, 1.0); });
    cypher_bk_frei(h);
    for k in [0usize, 100, 240, 479] {
        let g = 1.0 - k as f32 / 480.0;
        assert!((x[k] - voll[k] * g).abs() < 1e-5, "sample {k}: {} vs {}", x[k], voll[k] * g);
    }
    assert!(x[480..].iter().all(|v| *v == 0.0));
}

#[test]
fn nan_is_ignored_and_a_null_handle_reports_minus_one() {
    let h = neu();
    assert_eq!(cypher_bk_bend_bei(h, 0, f32::NAN, 0), 0);
    assert_eq!(cypher_bk_pegel_bei(h, 0, f32::NAN, 0), 0);
    let x = rechne(h, 9_600, 256, |h, i| if i == 0 { cypher_bk_note_an(h, 0, 69, 1.0); });
    assert!((frequenz(&x) - 440.0).abs() < 0.5 && spitze(&x) > 0.9);
    cypher_bk_frei(h);
    assert_eq!(cypher_bk_bend_bei(std::ptr::null_mut(), 0, 1.0, 0), -1);
    assert_eq!(cypher_bk_pegel_bei(std::ptr::null_mut(), 0, 1.0, 0), -1);
}

#[test]
fn full_queue_returns_minus_one_and_counts() {
    let h = neu();
    for _ in 0..BK_MAX_EREIGNISSE { assert_eq!(cypher_bk_bend_bei(h, 0, 1.0, 0), 0); }
    assert_eq!(cypher_bk_pegel_bei(h, 0, 0.5, 0), -1);
    assert_eq!(cypher_bk_verloren(h), 1);
    cypher_bk_frei(h);
}

#[test]
fn zero_events_and_neutral_events_leave_the_output_bit_identical() {
    let lauf = |ereignisse: bool| {
        let h = neu();
        let x = rechne(h, 20_000, 256, |h, i| {
            if i == 0 { cypher_bk_note_an(h, 0, 60, 0.8); }
            if i == 5120 { cypher_bk_note_an(h, 10, 67, 0.6); cypher_bk_note_aus(h, 200, 60); }
            if ereignisse && i == 1024 {
                // neutral values, glides to the neutral value: the sound stays the same bit for bit
                cypher_bk_bend_bei(h, 3, 0.0, 0);
                cypher_bk_pegel_bei(h, 3, 1.0, 0);
                cypher_bk_bend_bei(h, 100, 0.0, 500);
                cypher_bk_pegel_bei(h, 100, 1.0, 500);
            }
        });
        cypher_bk_frei(h);
        x
    };
    let (a, b) = (lauf(false), lauf(true));
    assert!(a.iter().any(|v| *v != 0.0));
    assert!(a == b, "neutral bend and level events changed the output");
}

#[test]
fn alle_aus_and_zuruecksetzen_return_both_to_neutral() {
    for weg in 0..2 {
        let h = neu();
        let x = rechne(h, 14_400, 256, |h, i| {
            if i == 0 { cypher_bk_note_an(h, 0, 69, 1.0); cypher_bk_bend_bei(h, 0, 12.0, 0); cypher_bk_pegel_bei(h, 0, 0.25, 0); }
            if i == 4_608 {
                if weg == 0 { cypher_bk_alle_aus(h, 0); } else { cypher_bk_zuruecksetzen(h); }
            }
            if i == 5_120 { cypher_bk_note_an(h, 0, 69, 1.0); }
        });
        cypher_bk_frei(h);
        assert!((frequenz(&x[1000..4000]) - 880.0).abs() < 2.0, "bend active before");
        assert!((spitze(&x[1000..4000]) - 0.25).abs() < 0.01 || spitze(&x[1000..4000]) < 0.3);
        // after the reset the new note sounds at 440 Hz and full level
        let n = &x[6000..14_000];
        assert!((frequenz(n) - 440.0).abs() < 0.5, "weg {weg}: {}", frequenz(n));
        assert!(spitze(n) > 0.9, "weg {weg}: {}", spitze(n));
    }
}

#[test]
fn reset_at_the_same_sample_runs_before_a_new_bend() {
    // alle_aus rank 0 runs before bend rank 2 of the same sample, whatever the order of reporting
    let h = neu();
    let x = rechne(h, 9_600, 256, |h, i| {
        if i == 0 {
            cypher_bk_note_an(h, 0, 69, 1.0);
            cypher_bk_bend_bei(h, 512, 12.0, 0);
            cypher_bk_alle_aus(h, 512);
            cypher_bk_note_an(h, 520, 69, 1.0);
        }
    });
    cypher_bk_frei(h);
    assert!((frequenz(&x[1000..9000]) - 880.0).abs() < 1.0, "{}", frequenz(&x[1000..9000]));
}
