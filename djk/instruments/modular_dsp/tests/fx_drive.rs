//! `fx-drive` (demos/fx-drive.json, built by build_drive.py): six saturation curves (Tape, Tube, Soft, Hard, Fold, Crush) behind one selector,
//! drive, character, tone, output and a dry/wet mix. Every branch and the dry path carry 69 samples (the latency of `falter` with `ueber` 1).
//! Pins: reported latency, the 0.5 fill, a bounded peak in every curve at full drive, the hard-clip ceiling, Mix 0 returns the delayed input,
//! finite corners, a stereo mirror, and no allocation in the real-time path.
#[path = "common/mod.rs"]
#[allow(dead_code)]
mod gemeinsam;
use baukasten_dsp::{uebersetze, Programm, REGLER};
use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;

struct Zaehler;
thread_local! { static ANFORDERUNGEN: Cell<usize> = const { Cell::new(0) }; }
fn anforderungen() -> usize { ANFORDERUNGEN.with(|c| c.get()) }
unsafe impl GlobalAlloc for Zaehler {
    unsafe fn alloc(&self, l: Layout) -> *mut u8 {
        ANFORDERUNGEN.with(|c| c.set(c.get() + 1));
        System.alloc(l)
    }
    unsafe fn dealloc(&self, p: *mut u8, l: Layout) { System.dealloc(p, l) }
    unsafe fn realloc(&self, p: *mut u8, l: Layout, n: usize) -> *mut u8 {
        ANFORDERUNGEN.with(|c| c.set(c.get() + 1));
        System.realloc(p, l, n)
    }
}
#[global_allocator]
static A: Zaehler = Zaehler;

const SR: f32 = 48_000.0;
const GRAPH: &str = include_str!("../demos/fx-drive.json");
/// `falter` with `ueber` 1: the longest branch, every other branch and the dry path are delayed to match
const LATENZ: usize = 69;
const KURVEN: [&str; 6] = ["Tape", "Tube", "Soft", "Hard", "Fold", "Crush"];

fn lade(k: &[(usize, f32)]) -> Programm {
    let mut p = uebersetze(GRAPH, SR).unwrap_or_else(|e| panic!("{e}"));
    for &(n, v) in k { p.setze_regler(n, v); }
    p
}

/// knob position of curve `i` (the selector splits 0..1 into six zones)
fn kurve(i: usize) -> f32 { (i as f32 + 0.5) / 6.0 }

fn rauschen(n: usize, amp: f32) -> Vec<f32> {
    let mut s: u32 = 0x1234_5678;
    (0..n).map(|_| { s ^= s << 13; s ^= s >> 17; s ^= s << 5; amp * 2.0 * ((s as f32 / u32::MAX as f32) - 0.5) }).collect()
}

/// saw at `hz`, peak `amp`
fn saege(n: usize, hz: f32, amp: f32) -> Vec<f32> {
    (0..n).map(|i| { let ph = (i as f32 * hz / SR).fract(); amp * (2.0 * ph - 1.0) }).collect()
}

fn lauf(p: &mut Programm, x: &[f32]) -> Vec<(f32, f32)> {
    let y: Vec<(f32, f32)> = x.iter().map(|&v| { p.setze_eingang(v, -v); p.sample_stereo() }).collect();
    assert!(y.iter().all(|(l, r)| l.is_finite() && r.is_finite()) && p.rettungen == 0, "not finite or rescued");
    y
}

fn spitze(y: &[(f32, f32)]) -> f32 { y.iter().fold(0.0, |m, (l, r)| m.max(l.abs()).max(r.abs())) }

fn rms(y: &[(f32, f32)]) -> f32 { (y.iter().map(|(l, _)| l * l).sum::<f32>() / y.len() as f32).sqrt() }

#[test]
fn laedt_als_stereo_effekt_mit_der_bekannten_latenz_und_ohne_vorgabe() {
    let p = lade(&[]);
    assert!(p.hat_eingang());
    println!("MESS fx-drive latency {} samples ({:.3} ms at 48 kHz)", p.latenz(), p.latenz() as f32 / 48.0);
    assert_eq!(p.latenz(), LATENZ);
    assert!(p.latenz() <= 128, "the insert loader accepts at most 128 samples");
    assert_eq!(p.regler_vorgaben(), [0.5f32; REGLER], "an insert graph keeps the 0.5 fill");
    let mut paare: Vec<(usize, &str)> = p.regler_namen.iter().map(|(n, s)| (*n as usize, s.as_str())).collect();
    paare.sort();
    let names: Vec<&str> = paare.iter().map(|(_, s)| *s).collect();
    assert_eq!(names, ["Curve", "Drive", "Character", "Tone", "Output", "Mix", "Crush rate", "Input", "Bands", "Low/Mid", "Mid/High", "Low drive", "High drive"]);
}

#[test]
fn jede_kurve_bleibt_bei_voller_aussteuerung_unter_eins_und_klingt() {
    // the 10 Hz high-pass of Tone (flat at the 0.5 fill) droops a plateau and overshoots the next edge: a clipped 55 Hz wave (half period 9 ms)
    // reaches 2.2 to 2.7 times the plateau before Output (Soft is the worst: its asymmetry puts a DC share on the plateau), so the bound there is 1.4 after Output (-6 dB); 110 Hz and noise stay below 1.0
    let proben: [(&str, Vec<f32>, f32); 3] = [
        ("saw 110 Hz peak 0.9", saege(48_000, 110.0, 0.9), 1.0),
        ("noise peak 1.0", rauschen(24_000, 1.0), 1.0),
        ("saw 55 Hz peak 0.3", saege(48_000, 55.0, 0.3), 1.4),
    ];
    for (i, name) in KURVEN.iter().enumerate() {
        for (pn, x, grenze) in &proben {
            // Drive 36 dB (knob 2 = 1), Output at its 0.5 fill (-6 dB), Mix at the 0.5 fill (wet)
            let mut p = lade(&[(1, kurve(i)), (2, 1.0)]);
            let y = lauf(&mut p, x);
            let s = spitze(&y);
            println!("MESS curve {name:5} {pn:20}: peak {s:.4}, rms {:.4}", rms(&y));
            assert!(s < *grenze, "{name} on {pn}: peak {s}");
            assert!(rms(&y[2_000..]) > 10f32.powf(-60.0 / 20.0), "{name} on {pn}: silent");
        }
    }
}

#[test]
fn die_harte_kurve_haelt_ihre_decke() {
    // Hard: the ceiling c (1.0 at Character 0, 0.25 at Character 1) is scaled by 1/c, so the plateau sits at 1.0 before Output (knob 5 = 0.5: 0.5007)
    // whatever Character is. Tone sits behind the clipper (a 19.9 kHz low-pass at the 0.5 fill): it rings on the edges of a clipped wave
    // (measured up to 1.4 of the plateau), so the peak bound is 1.45 and the plateau is read as the median of |y|.
    let ausgang = 0.063f32 * (3.98f32 / 0.063).sqrt();
    for zeichen in [0.0f32, 0.5, 1.0] {
        let mut p = lade(&[(1, kurve(3)), (2, 1.0), (3, zeichen)]);
        let y = lauf(&mut p, &saege(48_000, 1_000.0, 0.9));
        let s = spitze(&y[4_800..]) / ausgang;
        let mut betraege: Vec<f32> = y[4_800..].iter().map(|v| v.0.abs() / ausgang).collect();
        betraege.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let plateau = betraege[betraege.len() / 2];
        println!("MESS hard clip Character {zeichen}: plateau {plateau:.3}, peak {s:.3} of the ceiling 1.0 (before Output)");
        assert!((plateau - 1.0).abs() < 0.05, "Character {zeichen}: plateau {plateau}");
        assert!(s <= 1.45, "Character {zeichen}: peak {s}");
    }
    // moderate drive (0 dB): the signal below the ceiling passes unchanged, scaled by 1/c: c = 0.5 at Character 0.5, so x 2
    let mut p = lade(&[(1, kurve(3)), (2, 0.0), (3, 0.5), (4, 0.5)]);
    let x = saege(48_000, 1_000.0, 0.2);
    let y = lauf(&mut p, &x);
    let k = y[10_000 + LATENZ].0 / (x[10_000] * 2.0 * ausgang);
    println!("MESS hard clip below the ceiling: gain ratio {k:.3} (1.0 expected)");
    assert!((k - 1.0).abs() < 0.1, "{k}");
}

#[test]
fn mix_null_gibt_das_eingangssignal_um_die_latenz_verzoegert_zurueck() {
    let x = rauschen(24_000, 0.7);
    for i in 0..6 {
        let mut p = lade(&[(6, 0.0), (1, kurve(i)), (2, 1.0)]);
        let y = lauf(&mut p, &x);
        let mut fehler = 0.0f32;
        for k in 0..x.len() - LATENZ {
            fehler = fehler.max((y[k + LATENZ].0 - x[k]).abs()).max((y[k + LATENZ].1 + x[k]).abs());
        }
        println!("MESS mix 0 ({}): largest deviation from the delayed input {fehler:e}", KURVEN[i]);
        assert!(fehler < 1e-6, "{}: deviation {fehler}", KURVEN[i]);
        assert!(y[..LATENZ].iter().all(|v| v.0.abs() < 1e-6 && v.1.abs() < 1e-6), "output before the latency is silent");
    }
    // positive control: Mix at its fill is not the dry signal
    let mut q = lade(&[(2, 1.0)]);
    let w = lauf(&mut q, &x);
    let diff = (0..x.len() - LATENZ).fold(0.0f32, |m, i| m.max((w[i + LATENZ].0 - x[i]).abs()));
    assert!(diff > 0.05, "the wet path equals the dry signal ({diff})");
}

#[test]
fn alle_zweige_haben_dieselbe_latenz() {
    // an impulse through every curve at Mix 100 % and at Mix 0: the wet peak sits within a few samples of the dry one (+69)
    let mut x = vec![0.0f32; 2_000];
    x[100] = 0.1;
    for i in 0..6 {
        let mut p = lade(&[(1, kurve(i)), (4, 0.5)]);
        let y = lauf(&mut p, &x);
        let (pos, _) = y.iter().enumerate().fold((0, 0.0f32), |m, (k, v)| if v.0.abs() > m.1 { (k, v.0.abs()) } else { m });
        println!("MESS impulse peak ({}) at +{} samples", KURVEN[i], pos as i64 - 100);
        assert!((pos as i64 - 100 - LATENZ as i64).abs() <= 8, "{}: peak at +{}", KURVEN[i], pos as i64 - 100);
    }
}

#[test]
fn stereo_beide_seiten_laufen_getrennt_und_gleich() {
    // the same signal on both sides gives the same output on both sides (no cross-talk, no side-dependent state); the Tube and Soft curves
    // are asymmetric by design, so a mirrored input is not a mirrored output there
    for i in 0..6 {
        let mut p = lade(&[(1, kurve(i)), (2, 0.8)]);
        let x = saege(24_000, 82.0, 0.6);
        let y: Vec<(f32, f32)> = x.iter().map(|&v| { p.setze_eingang(v, v); p.sample_stereo() }).collect();
        assert!(y.iter().all(|(l, r)| l == r && l.is_finite()), "{}: the two sides differ", KURVEN[i]);
        assert!(spitze(&y) > 0.05, "{}: silent", KURVEN[i]);
    }
    // the sides do not talk to each other: silence on the right stays free of the left signal
    let mut p = lade(&[(1, kurve(0)), (2, 0.8), (6, 1.0)]);
    let mut maxr = 0.0f32;
    for (i, &v) in saege(24_000, 82.0, 0.6).iter().enumerate() { p.setze_eingang(v, 0.0); let (_, r) = p.sample_stereo(); if i > 2_000 { maxr = maxr.max(r.abs()); } }
    assert!(maxr < 1e-3, "left signal leaks into the right side: {maxr}");
}

#[test]
fn ecken_der_knoepfe_bleiben_endlich() {
    let x: Vec<f32> = saege(24_000, 70.0, 1.0).into_iter().zip(rauschen(24_000, 0.2)).map(|(a, b)| a + b).collect();
    let mut seed = 0x2545_f491_4f6c_dd1du64;
    let mut zufall = move || { seed ^= seed << 13; seed ^= seed >> 7; seed ^= seed << 17; (seed >> 40) as f32 / (1u64 << 24) as f32 };
    let mut faelle: Vec<Vec<f32>> = vec![vec![0.0; REGLER], vec![1.0; REGLER]];
    for _ in 0..24 { faelle.push((0..REGLER).map(|_| if zufall() < 0.5 { 0.0 } else { 1.0 }).collect()); }
    let mut hoechste = 0.0f32;
    for (i, kn) in faelle.iter().enumerate() {
        let mut p = lade(&[]);
        for (n, v) in kn.iter().enumerate() { p.setze_regler(n + 1, *v); }
        let y = lauf(&mut p, &x);
        hoechste = hoechste.max(spitze(&y));
        assert!(spitze(&y) < 24.0, "case {i}: peak {}", spitze(&y));
    }
    // silence stays silent and finite
    let mut p = lade(&[(2, 1.0)]);
    let y = lauf(&mut p, &vec![0.0; 4_800]);
    assert!(spitze(&y) < 1e-3, "silence in, {} out", spitze(&y));
    println!("MESS fx-drive corners: highest peak over 26 cases {hoechste:.3}");
}

#[test]
fn echtzeitpfad_allokiert_nicht() {
    let x = rauschen(96_000, 0.5);
    let vor = anforderungen();
    let mut p = lade(&[]);
    assert!(anforderungen() > vor, "positive control: the translation must allocate");
    let start = anforderungen();
    let mut summe = 0.0f32;
    for (i, v) in x.iter().enumerate() {
        let i = i as u32;
        if i % 64 == 0 { p.setze_regler(1 + (i / 64) as usize % 13, (i % 1000) as f32 / 1000.0); }
        if i == 90_000 { p.zuruecksetzen(); }
        p.setze_eingang(*v, *v);
        let (l, r) = p.sample_stereo();
        summe += l + r;
    }
    assert_eq!(anforderungen(), start, "the real-time path asked for memory");
    assert!(summe.is_finite());
}

/// the probe of `beispiele_konvention` (a 120 BPM loop at -6 dBFS plus a tail) through the graph at the given knobs
fn probe(k: &[(usize, f32)]) -> Vec<(f32, f32)> { probe_lang(k, usize::MAX) }

/// the same, cut to the first `n` samples of the loop (the sweeps need no tail)
fn probe_lang(k: &[(usize, f32)], n: usize) -> Vec<(f32, f32)> {
    let mut p = lade(k);
    let y: Vec<(f32, f32)> = gemeinsam::musik_probe().into_iter().take(n).chain(std::iter::repeat(0.0).take(if n == usize::MAX { 72_000 } else { 0 }))
        .map(|v| { p.setze_eingang(v, v); p.sample_stereo() }).collect();
    assert!(y.iter().all(|(l, r)| l.is_finite() && r.is_finite()) && p.rettungen == 0);
    y
}

#[test]
fn die_probe_der_beispielkonvention_bleibt_unter_0_9_ohne_gleichanteil_und_jeder_regler_wirkt() {
    // what `beispiele_konvention` demands of every example graph, at the 0.5 fill (Hard curve, Full): peak <= 0.9, DC below -50 dBFS, not silent
    let y = probe(&[]);
    let s = spitze(&y);
    let dc = (y.iter().map(|v| v.0 as f64).sum::<f64>() / y.len() as f64).abs().max((y.iter().map(|v| v.1 as f64).sum::<f64>() / y.len() as f64).abs());
    println!("MESS probe at the fill: peak {s:.3}, DC {:.1} dBFS, rms {:.3}", 20.0 * dc.log10(), rms(&y));
    assert!(s <= 0.9, "peak {s}");
    assert!(dc < 10f64.powf(-50.0 / 20.0), "DC {dc}");
    assert!(rms(&y[..300_000]) > 0.001, "silent");
    // every knob swept 0 against 1 (others at 0.5) changes the output, except the Crush rate: at the 0.5 fill the curve is Hard, which does not read it
    for nr in 1..=13 {
        let (a, b) = (probe_lang(&[(nr, 0.0)], 96_000), probe_lang(&[(nr, 1.0)], 96_000));
        let d = a.iter().zip(&b).fold(0.0f32, |m, (x, y)| m.max((x.0 - y.0).abs()).max((x.1 - y.1).abs()));
        println!("MESS sweep knob {nr}: max |0 - 1| {d:.5}");
        // dead at the fill by design: the Crush rate (the fill is Hard) and the four band knobs (the fill is Full)
        if nr == 7 || nr >= 10 { assert_eq!(d, 0.0, "knob {nr} acts at the fill, so it needs no allow-list entry"); } else { assert!(d > 0.0, "knob {nr} is dead on the probe"); }
    }
    // the band knobs act once Bands is on Three bands (knob 9 at 1)
    for nr in 10..=13 {
        let (a, b) = (probe_lang(&[(9, 1.0), (nr, 0.0)], 96_000), probe_lang(&[(9, 1.0), (nr, 1.0)], 96_000));
        assert!(a.iter().zip(&b).any(|(x, y)| x.0 != y.0), "knob {nr} is dead in three-band mode");
    }
    // and the Crush rate does act while the Crush curve is selected
    let (a, b) = (probe_lang(&[(1, kurve(5)), (7, 0.0)], 96_000), probe_lang(&[(1, kurve(5)), (7, 1.0)], 96_000));
    assert!(a.iter().zip(&b).any(|(x, y)| x.0 != y.0), "the Crush rate is dead in the Crush curve");
}

#[test]
fn drei_baender_mit_nulloffsets_bleiben_nahe_am_vollband() {
    // Soft at Character 0, Drive 0 dB, both band offsets 0: a gentle tanh. The kreuz sum is an all-pass, so the band sum matches Full in level.
    let x = saege(48_000, 110.0, 0.3);
    let werte = [(1, kurve(2)), (2, 0.0), (3, 0.0)];
    let mut voll = lade(&werte);
    let mut drei = lade(&[werte[0], werte[1], werte[2], (9, 1.0)]);
    assert_eq!(drei.latenz(), LATENZ, "latency in three-band mode");
    let (a, b) = (lauf(&mut voll, &x), lauf(&mut drei, &x));
    let (ra, rb) = (rms(&a[10_000..]), rms(&b[10_000..]));
    let db = 20.0 * (rb / ra).log10();
    println!("MESS three bands against Full (Soft, 0 dB drive): rms {rb:.4} against {ra:.4} = {db:+.3} dB");
    assert!(db.abs() < 0.5, "{db} dB");
    // the offsets act: Low drive at its top raises the low band, High drive at its top the high band
    let mut lo = lade(&[werte[0], werte[1], werte[2], (9, 1.0), (12, 1.0)]);
    let c = lauf(&mut lo, &x);
    assert!((0..x.len()).any(|i| (c[i].0 - b[i].0).abs() > 1e-3), "Low drive does not act");
    // the three bands carry the same 69 samples as Full: an impulse peaks at the same place
    let mut imp = vec![0.0f32; 2_000];
    imp[100] = 0.1;
    for modus in [0.0f32, 1.0] {
        let mut p = lade(&[(1, kurve(2)), (2, 0.0), (3, 0.0), (9, modus)]);
        let y = lauf(&mut p, &imp);
        let (pos, _) = y.iter().enumerate().fold((0, 0.0f32), |m, (k, v)| if v.0.abs() > m.1 { (k, v.0.abs()) } else { m });
        println!("MESS impulse peak, Bands {modus}: +{} samples", pos as i64 - 100);
        assert!((pos as i64 - 100 - LATENZ as i64).abs() <= 8);
    }
    // Mix 0 in three-band mode still returns the delayed input
    let n = rauschen(24_000, 0.7);
    let mut p = lade(&[(6, 0.0), (9, 1.0), (2, 1.0)]);
    let y = lauf(&mut p, &n);
    let f = (0..n.len() - LATENZ).fold(0.0f32, |m, i| m.max((y[i + LATENZ].0 - n[i]).abs()));
    assert!(f < 1e-6, "{f}");
}
