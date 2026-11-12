//! `fx-crunch` (demos/fx-crunch.json): band-limit (high-pass with resonance, low-pass), saturation 1, limiter, Output 1, saturation 2,
//! limiter, Output 2, then a dry/wet mix with the dry path delayed by the limiters' latency. Pins: the peak never passes the limiter ceiling
//! (-1 dBFS) + 0.1 dB at full drive on the wet path (Mix 100 %; at lower Mix the dry path passes unlimited), Mix 0 returns the dry input (delayed by the reported latency), corners stay finite, the latency
//! the insert loader reads (`cypher_bk_latenz` = `Programm::latenz`), real-time path.
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
const GRAPH: &str = include_str!("../demos/fx-crunch.json");
/// ceiling of both limiters in dBFS (fixed in the graph) and the allowed excess
const DECKE_DB: f32 = -1.0;
const TOLERANZ_DB: f32 = 0.1;
/// two limiters of 0.5 ms (24 samples at 48 kHz) each delay by 23 samples
const LATENZ: usize = 46;

fn lade(k: &[(usize, f32)]) -> Programm {
    let mut p = uebersetze(GRAPH, SR).unwrap_or_else(|e| panic!("{e}"));
    for &(n, v) in k { p.setze_regler(n, v); }
    p
}

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

#[test]
fn laedt_als_stereo_effekt_mit_der_bekannten_latenz_und_ohne_vorgabe() {
    let p = lade(&[]);
    assert!(p.hat_eingang());
    println!("MESS fx-crunch latency {} samples ({:.3} ms at 48 kHz)", p.latenz(), p.latenz() as f32 / 48.0);
    assert_eq!(p.latenz(), LATENZ);
    assert!(p.latenz() <= 128, "the insert loader accepts at most 128 samples");
    assert_eq!(p.regler_vorgaben(), [0.5f32; REGLER], "an insert graph keeps the 0.5 fill");
    let names: Vec<&str> = p.regler_namen.iter().map(|(_, s)| s.as_str()).collect();
    assert_eq!(names, ["HP freq", "HP reso", "LP freq", "Drive 1", "Output 1", "Drive 2", "Output 2", "Mix"]);
}

#[test]
fn der_nasse_pfad_bei_mix_100_prozent_bleibt_unter_der_limiterdecke() {
    let decke = 10f32.powf((DECKE_DB + TOLERANZ_DB) / 20.0);
    let mut schlimmster = 0.0f32;
    let proben: [(&str, Vec<f32>); 3] = [
        ("saw 110 Hz peak 0.9", saege(48_000, 110.0, 0.9)),
        ("noise burst peak 1.0", rauschen(24_000, 1.0).into_iter().chain(std::iter::repeat(0.0).take(9_600)).collect()),
        ("saw 55 Hz peak 0.3", saege(48_000, 55.0, 0.3)),
    ];
    // Drive 1 and 2 at maximum, Output 1 and 2 at maximum (0 dB), Mix 100 % (the wet path alone: a dry share would pass the limiters); HP and LP open, mid and closed
    for (hp, lp) in [(0.0, 1.0), (0.5, 0.5), (0.8, 0.2)] {
        for (name, x) in &proben {
            let mut p = lade(&[(1, hp), (3, lp), (4, 1.0), (5, 1.0), (6, 1.0), (7, 1.0), (8, 1.0)]);
            let y = lauf(&mut p, x);
            let s = spitze(&y);
            println!("MESS ceiling {name:22} hp {hp} lp {lp}: peak {s:.4} = {:.2} dBFS (ceiling {DECKE_DB} dBFS)", 20.0 * s.log10());
            assert!(s <= decke, "{name}: peak {s} above {decke}");
            assert!(s > 0.3, "{name}: the probe really plays ({s})");
            schlimmster = schlimmster.max(s);
        }
    }
    println!("MESS ceiling: highest peak {schlimmster:.4} = {:.3} dBFS", 20.0 * schlimmster.log10());
}

#[test]
fn mix_null_gibt_das_eingangssignal_um_die_latenz_verzoegert_zurueck() {
    let x = rauschen(24_000, 0.7);
    let mut p = lade(&[(8, 0.0), (4, 1.0), (6, 1.0)]);
    let y = lauf(&mut p, &x);
    let mut fehler = 0.0f32;
    for i in 0..x.len() - LATENZ {
        fehler = fehler.max((y[i + LATENZ].0 - x[i]).abs()).max((y[i + LATENZ].1 + x[i]).abs());
    }
    println!("MESS mix 0: largest deviation from the delayed input {fehler:e}");
    assert!(fehler < 1e-5, "deviation {fehler}");
    assert!(y[..LATENZ].iter().all(|v| v.0.abs() < 1e-5 && v.1.abs() < 1e-5), "output before the latency is silent");
    // positive control: Mix 1 is not the dry signal
    let mut q = lade(&[(8, 1.0), (4, 1.0), (6, 1.0)]);
    let w = lauf(&mut q, &x);
    let diff = (0..x.len() - LATENZ).fold(0.0f32, |m, i| m.max((w[i + LATENZ].0 - x[i]).abs()));
    assert!(diff > 0.05, "Mix 1 equals the dry signal ({diff})");
}

#[test]
fn stereo_beide_seiten_laufen_getrennt() {
    // the probe feeds l = v, r = -v: the output sides are exact mirrors (no cross-talk, no side-dependent state)
    let mut p = lade(&[(4, 0.8), (6, 0.8)]);
    let y = lauf(&mut p, &saege(24_000, 82.0, 0.6));
    assert!(y.iter().all(|(l, r)| *l == -*r), "the two sides are not mirrors");
}

#[test]
fn ecken_der_knoepfe_bleiben_endlich() {
    let x: Vec<f32> = saege(24_000, 70.0, 0.8).into_iter().zip(rauschen(24_000, 0.2)).map(|(a, b)| a + b).collect();
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
        assert!(spitze(&y) < 4.0, "case {i}: peak {}", spitze(&y));
    }
    println!("MESS fx-crunch corners: highest peak over 26 cases {hoechste:.3}");
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
        if i % 64 == 0 { p.setze_regler(1 + (i / 64) as usize % 8, (i % 1000) as f32 / 1000.0); }
        if i == 90_000 { p.zuruecksetzen(); }
        p.setze_eingang(*v, *v);
        let (l, r) = p.sample_stereo();
        summe += l + r;
    }
    assert_eq!(anforderungen(), start, "the real-time path asked for memory");
    assert!(summe.is_finite());
}
