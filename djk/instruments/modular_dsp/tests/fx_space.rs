//! `fx-space` (Cypher Space): four graphs, each with ONE `faltung` block (Hall in `fx-space`, Room, Plate, Chamber in `space-*`), identical except
//! for name and impulse response file; pre-delay, low and high cut, width, a blend with one algorithmic `hall` block (decay 4 s) and a linear dry/wet mix.
//! Knobs: 1 Mix, 2 Pre-delay, 3 Low cut, 4 High cut, 5 Width, 6 Algo blend. Pins, for all four graphs: loads as a stereo effect with
//! latency 0 and the 0.5 fill, the same knobs, the rooms play at similar loudness and differ from each other, Mix 0 returns the input, peak bounds,
//! finite corners, no allocation in the real-time path.
use baukasten_dsp::{uebersetze_mit_wurzel, Programm, REGLER};
use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;
use std::path::PathBuf;

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
/// (graph name, room, graph text); the room is chosen by the graph, not by a knob
const GRAPHEN: [(&str, &str); 4] = [
    ("fx-space", include_str!("../demos/fx-space.json")),
    ("space-raum", include_str!("../demos/space-raum.json")),
    ("space-platte", include_str!("../demos/space-platte.json")),
    ("space-kammer", include_str!("../demos/space-kammer.json")),
];
const KNOEPFE: usize = 6;

fn wurzel() -> PathBuf {
    static W: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();
    W.get_or_init(|| {
        let w = std::env::temp_dir().join(format!("fx-space-wurzel-{}", std::process::id()));
        std::fs::create_dir_all(&w).unwrap();
        baukasten_dsp::proben::schreibe_space_werk(&w);
        w
    }).clone()
}

fn lade_graph(i: usize, k: &[(usize, f32)]) -> Programm {
    let mut p = uebersetze_mit_wurzel(GRAPHEN[i].1, SR, Some(&wurzel())).unwrap_or_else(|e| panic!("{e}"));
    for &(n, v) in k { p.setze_regler(n, v); }
    p
}

/// the Hall graph (the device the browser shows)
fn lade(k: &[(usize, f32)]) -> Programm { lade_graph(0, k) }

fn rauschen(n: usize, amp: f32) -> Vec<f32> {
    let mut s: u32 = 0x1234_5678;
    (0..n).map(|_| { s ^= s << 13; s ^= s >> 17; s ^= s << 5; amp * 2.0 * ((s as f32 / u32::MAX as f32) - 0.5) }).collect()
}

fn saege(n: usize, hz: f32, amp: f32) -> Vec<f32> {
    (0..n).map(|i| { let ph = (i as f32 * hz / SR).fract(); amp * (2.0 * ph - 1.0) }).collect()
}

/// stereo input l = v, r = -v (the probe of the other effect tests)
fn lauf(p: &mut Programm, x: &[f32]) -> Vec<(f32, f32)> {
    let y: Vec<(f32, f32)> = x.iter().map(|&v| { p.setze_eingang(v, -v); p.sample_stereo() }).collect();
    assert!(y.iter().all(|(l, r)| l.is_finite() && r.is_finite()) && p.rettungen == 0, "not finite or rescued");
    y
}

fn spitze(y: &[(f32, f32)]) -> f32 { y.iter().fold(0.0, |m, (l, r)| m.max(l.abs()).max(r.abs())) }

#[test]
fn all_four_load_as_stereo_effects_with_latency_zero_the_half_fill_and_the_same_knobs() {
    for (i, (name, text)) in GRAPHEN.iter().enumerate() {
        let p = lade_graph(i, &[]);
        assert!(p.hat_eingang(), "{name}");
        println!("MESS {name} latency {} samples", p.latenz());
        assert_eq!(p.latenz(), 0, "{name}");
        assert_eq!(p.regler_vorgaben(), [0.5f32; REGLER], "{name}: an insert graph keeps the 0.5 fill");
        let names: Vec<&str> = p.regler_namen.iter().map(|(_, s)| s.as_str()).collect();
        assert_eq!(names, ["Mix", "Pre-delay", "Low cut", "High cut", "Width", "Algo blend"], "{name}");
        // one convolution per graph, and the graphs differ only in name and impulse response file
        let j: serde_json::Value = serde_json::from_str(text).unwrap();
        let faltungen = j["knoten"].as_array().unwrap().iter().filter(|n| n["art"] == "faltung").count();
        assert_eq!(faltungen, 1, "{name}");
        assert_eq!(j["name"], *name);
    }
    let mut a: serde_json::Value = serde_json::from_str(GRAPHEN[0].1).unwrap();
    for (i, (name, text)) in GRAPHEN.iter().enumerate().skip(1) {
        let mut b: serde_json::Value = serde_json::from_str(text).unwrap();
        let (na, nb) = (a.clone(), b.clone());
        for g in [&mut a, &mut b] { g["name"] = "x".into(); for n in g["knoten"].as_array_mut().unwrap() { if n["id"] == "raum" { n["datei"] = "x".into(); } } }
        assert_eq!(a, b, "{name} differs from fx-space in more than name and datei");
        a = na; let _ = (nb, i);
    }
}

/// energy of both sides over 2 s after an impulse (l = r = 1), Mix 100 %, no pre-delay, filters open, no algorithmic share
fn impuls_antwort(i: usize) -> Vec<(f32, f32)> {
    let mut p = lade_graph(i, &[(1, 1.0), (2, 0.0), (3, 0.0), (4, 1.0), (6, 0.0)]);
    (0..96_000).map(|n| { let v = if n == 0 { 1.0 } else { 0.0 }; p.setze_eingang(v, v); p.sample_stereo() }).collect()
}

fn energie(y: &[(f32, f32)]) -> f64 { y.iter().map(|&(l, r)| (l as f64).powi(2) + (r as f64).powi(2)).sum() }

#[test]
fn the_four_rooms_play_at_similar_loudness_and_differ_from_each_other() {
    let antworten: Vec<Vec<(f32, f32)>> = (0..4).map(impuls_antwort).collect();
    let db: Vec<f64> = antworten.iter().map(|y| 10.0 * energie(y).log10()).collect();
    println!("MESS fx-space impulse energy (Hall, Room, Plate, Chamber): {db:.2?} dB");
    for (i, d) in db.iter().enumerate() {
        assert!((d - db[0]).abs() < 3.0, "{}: {d:.2} dB against Hall {:.2} dB", GRAPHEN[i].0, db[0]);
    }
    for i in 0..4 {
        for j in i + 1..4 {
            let abstand: f64 = antworten[i].iter().zip(&antworten[j]).map(|(a, b)| ((a.0 - b.0) as f64).powi(2) + ((a.1 - b.1) as f64).powi(2)).sum();
            println!("MESS {} against {}: difference energy {abstand:e} (own energy {:e})", GRAPHEN[i].0, GRAPHEN[j].0, energie(&antworten[i]));
            assert!(abstand > 0.1 * energie(&antworten[i]), "{} and {} sound alike", GRAPHEN[i].0, GRAPHEN[j].0);
        }
    }
}

#[test]
fn mix_zero_returns_the_input() {
    let x = rauschen(24_000, 0.7);
    for i in 0..4 {
        let mut p = lade_graph(i, &[(1, 0.0)]);
        let y = lauf(&mut p, &x);
        let mut fehler = 0.0f32;
        for n in 0..x.len() { fehler = fehler.max((y[n].0 - x[n]).abs()).max((y[n].1 + x[n]).abs()); }
        println!("MESS {} mix 0: largest deviation from the input {fehler:e}", GRAPHEN[i].0);
        assert!(fehler < 1e-6, "{}: deviation {fehler}", GRAPHEN[i].0);
        // positive control: the default Mix is not the dry signal
        let mut q = lade_graph(i, &[]);
        let w = lauf(&mut q, &x);
        assert!((0..x.len()).fold(0.0f32, |m, n| m.max((w[n].0 - x[n]).abs())) > 0.05);
    }
}

#[test]
fn peak_stays_below_the_bounds() {
    // -6 dBFS saw at the 0.5 fill
    let x = saege(96_000, 110.0, 0.5);
    let mut hoechste = 0.0f32;
    for i in 0..4 {
        let s = spitze(&lauf(&mut lade_graph(i, &[]), &x));
        println!("MESS {} peak at all knobs 0.5: {s:.4}", GRAPHEN[i].0);
        assert!(s < 0.9, "{}: peak {s}", GRAPHEN[i].0);
        assert!(s > 0.1, "{} plays ({s})", GRAPHEN[i].0);
        // loudest corner: Mix 100 %, widest, filters open, a full algorithmic blend
        for blend in [0.0, 1.0] {
            let mut p = lade_graph(i, &[(1, 1.0), (3, 0.0), (4, 1.0), (5, 1.0), (6, blend)]);
            let s = spitze(&lauf(&mut p, &x));
            println!("MESS {} corner blend {blend}: peak {s:.4}", GRAPHEN[i].0);
            hoechste = hoechste.max(s);
        }
    }
    println!("MESS fx-space loudest corner peak {hoechste:.4}");
    assert!(hoechste < 1.5, "corner peak {hoechste}");
}

#[test]
fn corners_stay_finite() {
    let x: Vec<f32> = saege(24_000, 70.0, 0.8).into_iter().zip(rauschen(24_000, 0.2)).map(|(a, b)| a + b).collect();
    let mut seed = 0x2545_f491_4f6c_dd1du64;
    let mut zufall = move || { seed ^= seed << 13; seed ^= seed >> 7; seed ^= seed << 17; (seed >> 40) as f32 / (1u64 << 24) as f32 };
    let mut faelle: Vec<Vec<f32>> = vec![vec![0.0; REGLER], vec![1.0; REGLER]];
    for _ in 0..6 { faelle.push((0..REGLER).map(|_| if zufall() < 0.5 { 0.0 } else { 1.0 }).collect()); }
    for g in 0..4 {
        for (i, kn) in faelle.iter().enumerate() {
            let mut p = lade_graph(g, &[]);
            for (n, v) in kn.iter().enumerate() { p.setze_regler(n + 1, *v); }
            let y = lauf(&mut p, &x);
            assert!(spitze(&y) < 4.0, "{} case {i}: peak {}", GRAPHEN[g].0, spitze(&y));
        }
    }
}

#[test]
fn real_time_path_does_not_allocate() {
    let x = rauschen(96_000, 0.5);
    let vor = anforderungen();
    let mut p = lade(&[]);
    assert!(anforderungen() > vor, "positive control: the translation must allocate");
    for g in 0..4 {
        let mut p = lade_graph(g, &[]);
        // warm-up with a blend, so every branch has run once
        p.setze_regler(6, 0.5);
        for v in x[..6_000].iter() { p.setze_eingang(*v, *v); p.sample_stereo(); }
        let start = anforderungen();
        let mut summe = 0.0f32;
        for (i, v) in x.iter().enumerate() {
            let i = i as u32;
            if i % 64 == 0 { p.setze_regler(1 + (i / 64) as usize % KNOEPFE, (i % 1000) as f32 / 1000.0); }
            if i == 90_000 { p.zuruecksetzen(); }
            p.setze_eingang(*v, *v);
            let (l, r) = p.sample_stereo();
            summe += l + r;
        }
        assert_eq!(anforderungen(), start, "{}: the real-time path asked for memory", GRAPHEN[g].0);
        assert!(summe.is_finite());
    }
    let _ = &mut p;
}
