//! S10 task 1: the `sampler` block (type 30): io, value checks, block == DSP driven directly, several voices on one node.
#[path = "sampler_helpers/mod.rs"]
mod sampler_hilfe;
use baukasten_dsp::sampler::{Eingabe, Einstellung, Sampler};
use baukasten_dsp::{uebersetze_mit_wurzel, Fehler, ARTEN};
use sampler_hilfe::*;

const SR: f32 = 48_000.0;

#[test]
fn sampler_is_type_30_with_io() {
    let a = ARTEN.get(30).expect("ARTEN has no entry 30 (sampler)");
    assert_eq!(a.art, "sampler");
    assert_eq!(a.ein, &["hz", "trig", "gate", "scheibe", "rueck"]);
    assert_eq!(a.aus, &["l", "r"]);
    assert!(a.werte.is_empty(), "datei is a named field, not a pflichtwert");
    for f in [("grund", 261.6256), ("scheiben", 1.0), ("schleife", 0.0), ("gate", 1.0)] {
        assert!(a.frei.contains(&f), "{f:?}");
    }
    assert_eq!(a.frei.len(), 4);
    assert!(ARTEN.len() >= 31, "ARTEN only grows at the end");
    assert_eq!(ARTEN[29].art, "vocoder", "existing type numbers must not move");
}

#[test]
fn value_checks() {
    let w = wurzel();
    schreibe(&w, "a.f32", &sinus(1000.0, 2000, 0.5));
    let ok = |v: &str| uebersetze_mit_wurzel(&graph("a.f32", v, 1), SR, Some(&w));
    for v in [r#","grund":19.9"#, r#","grund":2000.1"#, r#","grund":0"#, r#","grund":-5"#, r#","scheiben":0"#, r#","scheiben":65"#,
              r#","scheiben":1.5"#, r#","scheiben":-1"#, r#","schleife":2"#, r#","schleife":0.5"#, r#","schleife":-1"#] {
        assert!(matches!(ok(v), Err(Fehler::Wert { .. })), "{v}: {:?}", ok(v).err());
    }
    for v in [r#","grund":20"#, r#","grund":2000"#, r#","scheiben":1"#, r#","scheiben":64"#, r#","schleife":0"#, r#","schleife":1"#, ""] {
        assert!(ok(v).is_ok(), "{v}: {:?}", ok(v).err());
    }
}

/// Reference: the DSP driven directly with what the block sees from a note (hz, trig for one sample, gate 1).
fn direkt(d: &[f32], hz: f32, n: usize, e: &Einstellung) -> Vec<(f32, f32)> {
    let mut s = Sampler::default();
    (0..n).map(|i| s.prozess(d, e, SR, Eingabe { hz, trig: if i == 0 { 1.0 } else { 0.0 }, gate: 1.0, scheibe: 0.0, rueck: 0.0 })).collect()
}

#[test]
fn block_equals_the_dsp_driven_directly() {
    let w = wurzel();
    let d: Vec<f32> = (0..2 * 20_000).map(|i| ((i as f32) * 0.37).sin() * 0.6 + ((i / 2) as f32 * 0.011).cos() * 0.2).collect();
    schreibe(&w, "d.f32", &d);
    for (werte, e) in [
        ("", Einstellung { grund: 261.6256, scheiben: 1, schleife: false }),
        (r#","grund":300,"scheiben":4,"schleife":1"#, Einstellung { grund: 300.0, scheiben: 4, schleife: true }),
    ] {
        let mut p = uebersetze_mit_wurzel(&graph("d.f32", werte, 1), SR, Some(&w)).unwrap();
        p.note_an(57, 0.8);
        let hz = 440.0 * 2f32.powf((57f32 - 69.0) / 12.0);
        let soll = direkt(&d, hz, 30_000, &e);
        for (i, s) in soll.iter().enumerate() {
            let (l, r) = p.sample_stereo();
            assert_eq!((l.to_bits(), r.to_bits()), (s.0.to_bits(), s.1.to_bits()), "{werte} sample {i}");
        }
        assert!(soll.iter().any(|v| v.0.abs() > 0.1), "silent comparison is blind");
    }
}

#[test]
fn four_voices_play_their_own_notes_from_the_same_data() {
    let w = wurzel();
    let d = sinus(700.0, 30_000, 0.4);
    schreibe(&w, "d.f32", &d);
    let mut p = uebersetze_mit_wurzel(&graph("d.f32", "", 4), SR, Some(&w)).unwrap();
    let noten = [48u8, 55, 60, 67];
    for n in noten { p.note_an(n, 0.8); }
    let e = Einstellung { grund: 261.6256, scheiben: 1, schleife: false };
    let refs: Vec<Vec<(f32, f32)>> = noten.iter().map(|n| direkt(&d, 440.0 * 2f32.powf((*n as f32 - 69.0) / 12.0), 20_000, &e)).collect();
    for i in 0..20_000 {
        let (l, _) = p.sample_stereo();
        let soll: f32 = refs.iter().map(|r| r[i].0).sum();
        assert!((l - soll).abs() <= 1e-5, "sample {i}: {l} vs {soll}");
    }
}

#[test]
fn reset_returns_to_silence_and_replays_identically() {
    let w = wurzel();
    schreibe(&w, "d.f32", &sinus(500.0, 30_000, 0.4));
    let mut p = uebersetze_mit_wurzel(&graph("d.f32", "", 2), SR, Some(&w)).unwrap();
    p.note_an(60, 0.8);
    let a: Vec<_> = (0..5000).map(|_| p.sample_stereo()).collect();
    p.zuruecksetzen();
    assert!((0..2000).all(|_| p.sample_stereo() == (0.0, 0.0)), "silent after reset");
    p.note_an(60, 0.8);
    let b: Vec<_> = (0..5000).map(|_| p.sample_stereo()).collect();
    assert_eq!(a, b);
}

#[test]
fn generated_probe_is_deterministic_and_has_the_documented_shape() {
    let a = baukasten_dsp::proben::orchester_schlag(48_000.0);
    assert_eq!(a, baukasten_dsp::proben::orchester_schlag(48_000.0));
    assert_eq!(a.len(), 2 * 28_800, "0.6 s stereo");
    assert!(a.iter().all(|v| v.is_finite()));
    let spitze = a.iter().fold(0f32, |m, v| m.max(v.abs()));
    assert!((spitze - 0.8).abs() < 1e-6, "peak {spitze}");
    // fast exponential decay: the last 100 ms are far below the first 100 ms
    let rms = |x: &[f32]| (x.iter().map(|v| v * v).sum::<f32>() / x.len() as f32).sqrt();
    assert!(rms(&a[a.len() - 9600..]) < 0.1 * rms(&a[..9600]));
}

/// FNV-1a 64 over the bytes of a sample.
fn fnv(d: &[f32]) -> u64 {
    baukasten_dsp::proben::bytes(d).iter().fold(0xcbf2_9ce4_8422_2325u64, |h, b| (h ^ *b as u64).wrapping_mul(0x0100_0000_01b3))
}

/// S22 negative control: splitting the generator into helpers must not move one bit of the old hit (four tests and the
/// installed `orchester-schlag.f32` rely on it). The hash is that of the file written before S22.
#[test]
fn the_old_probe_is_bit_identical_after_the_s22_refactor() {
    assert_eq!(fnv(&baukasten_dsp::proben::orchester_schlag(48_000.0)), 0x36f5_f263_8cf4_7169);
}

/// Sum of the three slices of `orchester_schlag_schichten` read at `2^(+-c/1200)` (linear interpolation) and panned as the
/// old file (1.0/0.25, 0.7/0.7, 0.25/1.0): what the graph does, in a few lines.
fn schichten_summe(d: &[f32], cent: f64, frames: usize) -> Vec<(f64, f64)> {
    let n = d.len() / 6;
    let pan = [(1.0, 0.25), (0.7, 0.7), (0.25, 1.0)];
    (0..frames)
        .map(|i| {
            let (mut l, mut r) = (0.0, 0.0);
            for k in 0..3 {
                let pos = i as f64 * 2f64.powf((k as f64 - 1.0) * cent / 1200.0);
                let (j, x) = (pos.floor() as usize, pos.fract());
                let v = d[2 * (k * n + j)] as f64 * (1.0 - x) + d[2 * (k * n + j + 1)] as f64 * x;
                l += v * pan[k].0;
                r += v * pan[k].1;
            }
            (l, r)
        })
        .collect()
}

#[test]
fn schichten_are_three_undetuned_slices_with_the_old_scale() {
    let d = baukasten_dsp::proben::orchester_schlag_schichten(48_000.0);
    assert_eq!(d, baukasten_dsp::proben::orchester_schlag_schichten(48_000.0), "deterministic");
    assert_eq!(d.len(), 3 * 28_800 * 2, "three slices of 0.6 s, stereo");
    assert!(d.chunks(2).all(|f| f[0] == f[1]), "left equals right in every slice");
    assert!(d.iter().all(|v| v.is_finite()));
    // the slices differ (their start phases do), and each one fades out at its end
    let n = 28_800;
    assert_ne!(&d[..2 * 2_000], &d[2 * n..2 * n + 2 * 2_000]);
    for k in 0..3 {
        assert!(d[2 * (k * n + n - 1)].abs() < 1e-4, "slice {k} ends silent");
    }
    // recombined without detune the slices stay below the clip level (the old mix peaks at exactly 0.8)
    let s0 = schichten_summe(&d, 0.0, n - 1);
    let spitze0 = s0.iter().fold(0.0f64, |m, (l, r)| m.max(l.abs()).max(r.abs()));
    assert!(spitze0 <= 1.0 + 1e-9, "peak at 0 cent {spitze0}");
    // at the old 9 cent the sum lands at the old level: first 0.25 s within 0.5 dB of the old file
    let alt = baukasten_dsp::proben::orchester_schlag(48_000.0);
    let rms = |x: &mut dyn Iterator<Item = f64>| { let (s, c) = x.fold((0.0, 0usize), |a, v| (a.0 + v * v, a.1 + 1)); (s / c as f64).sqrt() };
    let neu = rms(&mut schichten_summe(&d, 9.0, 12_000).iter().flat_map(|(l, r)| [*l, *r]));
    let alt_rms = rms(&mut alt[..24_000].iter().map(|v| *v as f64));
    let db = 20.0 * (neu / alt_rms).log10();
    println!("MESS schichten recombined at 9 cent vs orchester_schlag, first 0.25 s: {db:+.3} dB (rms {neu:.4} vs {alt_rms:.4})");
    assert!(db.abs() <= 0.5, "level at 9 cent differs by {db:.2} dB");
}

/// S22 T5: the centre slice (and only it) opens with a high-passed noise burst. Energy above 4 kHz in the first 10 ms of a
/// slice against 10 to 20 ms: at least 6 dB more in the centre slice, no such jump in the outer slices.
#[test]
fn only_the_centre_slice_has_a_noise_attack() {
    let d = baukasten_dsp::proben::orchester_schlag_schichten(48_000.0);
    let n = 28_800;
    let kurve = |k: usize, a: usize, b: usize| -> Vec<f32> { (a..b).map(|i| d[2 * (k * n + i)]).collect() };
    let mut db = [0.0f64; 3];
    for k in 0..3 {
        let (erst, danach) = (band_energie(&kurve(k, 0, 480), 48_000.0, 4_000.0, 24_000.0), band_energie(&kurve(k, 480, 960), 48_000.0, 4_000.0, 24_000.0));
        db[k] = 10.0 * (erst / danach).log10();
    }
    println!("MESS noise attack, >4 kHz energy first 10 ms vs 10..20 ms: slice 0 {:+.1} dB, slice 1 {:+.1} dB, slice 2 {:+.1} dB", db[0], db[1], db[2]);
    assert!(db[1] >= 6.0, "centre slice: {:+.1} dB", db[1]);
    assert!(db[0] < 3.0 && db[2] < 3.0, "outer slices: {:+.1} / {:+.1} dB", db[0], db[2]);
}

#[test]
fn unconnected_gate_reads_one_so_a_loop_keeps_looping() {
    let w = wurzel();
    schreibe(&w, "d.f32", &stereo(5000, |_| 0.25));
    let j = graph("d.f32", r#","schleife":1"#, 1).replace(r#",{"von":"n.gate","nach":"s.gate"}"#, "");
    assert!(!j.contains("s.gate"));
    let mut p = uebersetze_mit_wurzel(&j, SR, Some(&w)).unwrap();
    p.note_an(60, 0.8);
    let x: Vec<f32> = (0..96_000).map(|_| p.sample_stereo().0).collect();
    assert!(x.iter().all(|v| (v - 0.25).abs() < 1e-6), "loop stopped");
    // and the same graph as a one-shot ends after 5000 samples
    let j = graph("d.f32", "", 1).replace(r#",{"von":"n.gate","nach":"s.gate"}"#, "");
    let mut p = uebersetze_mit_wurzel(&j, SR, Some(&w)).unwrap();
    p.note_an(60, 0.8);
    let x: Vec<f32> = (0..12_000).map(|_| p.sample_stereo().0).collect();
    assert!(x[..4000].iter().all(|v| *v != 0.0) && x[6000..].iter().all(|v| *v == 0.0));
}
