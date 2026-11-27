//! `fx-echo` (demos/fx-echo.json, built by build_echo.py): a character delay of existing blocks. Pins: seven beat divisions come back on the
//! grid (division + the 3 ms wow line), the feedback loop (high-pass, low-pass, saturation, ping-pong) stays below full scale at maximum
//! feedback and drive, ping-pong bounces the repeats left, right, ducking pulls the wet down while the input plays, Mix 0 returns the input,
//! every knob but Free time moves the sound while Time sits on a division, latency 0, real-time path.
use baukasten_dsp::{uebersetze, Programm, REGLER};
use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;

mod common;

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
const GRAPH: &str = include_str!("../demos/fx-echo.json");
/// the wow line at Wow 0: 3 ms
const WOW_SAMPLES: usize = 144;
/// beats per second at 120 BPM, as beats per sample
const BPS_120: f64 = 2.0 / 48_000.0;

// knob numbers
const ZEIT: usize = 1;
const FREI: usize = 2;
const FB: usize = 3;
const TIEF: usize = 4;
const HOCH: usize = 5;
const DRIVE: usize = 6;
const PINGPONG: usize = 7;
const WOW: usize = 8;
const DUCK: usize = 9;
const DUCK_REL: usize = 10;
const MIX: usize = 11;

/// knob value that selects position `i` of the eight Time positions (zone centre)
fn zeit_pos(i: usize) -> f32 { (i as f32 + 0.5) / 8.0 }
/// division in beats of the positions 0..=6
const TAKTE: [f64; 7] = [0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 4.0];

fn lade(k: &[(usize, f32)]) -> Programm {
    let mut p = uebersetze(GRAPH, SR).unwrap_or_else(|e| panic!("{e}"));
    p.setze_takt(0.0, BPS_120);
    for &(n, v) in k { p.setze_regler(n, v); }
    p
}

fn rauschen(n: usize, amp: f32) -> Vec<f32> {
    let mut s: u32 = 0x1234_5678;
    (0..n).map(|_| { s ^= s << 13; s ^= s >> 17; s ^= s << 5; amp * 2.0 * ((s as f32 / u32::MAX as f32) - 0.5) }).collect()
}

fn lauf(p: &mut Programm, x: &[(f32, f32)]) -> Vec<(f32, f32)> {
    let y: Vec<(f32, f32)> = x.iter().map(|&(l, r)| { p.setze_eingang(l, r); p.sample_stereo() }).collect();
    assert!(y.iter().all(|(l, r)| l.is_finite() && r.is_finite()) && p.rettungen == 0, "not finite or rescued");
    y
}

fn mono(x: &[f32]) -> Vec<(f32, f32)> { x.iter().map(|&v| (v, v)).collect() }
fn spitze(y: &[(f32, f32)]) -> f32 { y.iter().fold(0.0, |m, (l, r)| m.max(l.abs()).max(r.abs())) }
fn rms(y: &[f32]) -> f32 { (y.iter().map(|v| v * v).sum::<f32>() / y.len().max(1) as f32).sqrt() }

/// an impulse of amplitude `a` at sample 0 on the given sides, then `n - 1` zeros
fn impuls(n: usize, l: f32, r: f32) -> Vec<(f32, f32)> {
    let mut x = vec![(0.0, 0.0); n];
    x[0] = (l, r);
    x
}

fn spitze_in(y: &[f32], von: usize, bis: usize) -> f32 { y[von..bis].iter().fold(0.0, |m, v| m.max(v.abs())) }

#[test]
fn laedt_als_stereo_effekt_mit_latenz_null_und_ohne_vorgabe() {
    let p = lade(&[]);
    assert!(p.hat_eingang());
    println!("MESS fx-echo latency {} samples", p.latenz());
    assert_eq!(p.latenz(), 0);
    assert_eq!(p.regler_vorgaben(), [0.5f32; REGLER], "an insert graph keeps the 0.5 fill");
    let mut benannt: Vec<(usize, &str)> = p.regler_namen.iter().map(|(n, s)| (*n, s.as_str())).collect();
    benannt.sort();
    let names: Vec<&str> = benannt.into_iter().map(|(_, s)| s).collect();
    assert_eq!(names, ["Time", "Free time", "Feedback", "Low cut", "High cut", "Drive", "Ping-pong", "Wow", "Duck", "Duck release", "Mix"]);
}

#[test]
fn die_sieben_teilungen_kommen_auf_dem_raster_zurueck() {
    for (i, beats) in TAKTE.iter().enumerate() {
        let soll = (beats * 24_000.0) as usize + WOW_SAMPLES;
        let mut p = lade(&[(ZEIT, zeit_pos(i)), (FB, 0.0), (WOW, 0.0), (MIX, 1.0), (PINGPONG, 0.0)]);
        let y = lauf(&mut p, &impuls(soll + 2_000, 1.0, 0.0));
        let l: Vec<f32> = y.iter().map(|v| v.0).collect();
        let (pos, hoechst) = l.iter().enumerate().fold((0, 0.0f32), |m, (i, v)| if v.abs() > m.1 { (i, v.abs()) } else { m });
        println!("MESS division {beats} beats: repeat at {pos} (expected {soll}), amplitude {hoechst:.3}");
        assert!((pos as i64 - soll as i64).abs() <= 2, "position {i}: repeat at {pos}, expected {soll}");
        assert!(hoechst > 0.9, "position {i}: amplitude {hoechst}");
        assert!(y.iter().all(|v| v.1.abs() < 1e-6), "position {i}: nothing on the right with Ping-pong Off");
    }
}

#[test]
fn die_freie_zeit_folgt_dem_knopf() {
    // Free = position 7; Free time 0.5 reads 375 ms (the centre value): 18000 samples + the wow line
    let mut p = lade(&[(ZEIT, zeit_pos(7)), (FB, 0.0), (WOW, 0.0), (MIX, 1.0), (PINGPONG, 0.0)]);
    let y = lauf(&mut p, &impuls(20_000, 1.0, 0.0));
    let l: Vec<f32> = y.iter().map(|v| v.0).collect();
    let pos = l.iter().enumerate().fold((0, 0.0f32), |m, (i, v)| if v.abs() > m.1 { (i, v.abs()) } else { m }).0;
    println!("MESS free time 375 ms: repeat at {pos}");
    assert!((pos as i64 - (18_000 + WOW_SAMPLES) as i64).abs() <= 2, "repeat at {pos}");
}

#[test]
fn feedback_bleibt_bei_maximum_unter_voller_aussteuerung() {
    let burst = rauschen(48_000, 0.5);
    let mut x = mono(&burst);
    x.extend(std::iter::repeat((0.0, 0.0)).take(20 * 48_000));
    let mut hoechster = 0.0f32;
    for pp in [0.0, 1.0] {
        let mut p = lade(&[(ZEIT, zeit_pos(0)), (FB, 1.0), (DRIVE, 1.0), (HOCH, 1.0), (TIEF, 0.0), (WOW, 0.0), (MIX, 1.0), (PINGPONG, pp)]);
        let y = lauf(&mut p, &x);
        let waehrend = spitze(&y[..48_000]);
        // the input's last samples still circulate for a few rounds (input + feedback); one second after the burst only the loop is left
        let danach = spitze(&y[2 * 48_000..]);
        let spaet = spitze(&y[x.len() - 48_000..]);
        println!("MESS max feedback 0.95, drive 18 dB, ping-pong {pp}: peak during the burst {waehrend:.3}, from 1 s after it {danach:.3}, last second {spaet:.3}");
        assert!(danach < 1.0, "ping-pong {pp}: peak from 1 s after the burst {danach}");
        assert!(waehrend < 0.5 + 0.95 + 0.01, "ping-pong {pp}: peak during the burst {waehrend}");
        hoechster = hoechster.max(danach);
    }
    println!("MESS max feedback: highest peak from 1 s after the burst {hoechster:.4}");
}

#[test]
fn ping_pong_springt_von_links_nach_rechts() {
    let mut p = lade(&[(ZEIT, zeit_pos(3)), (FB, 0.7), (DRIVE, 0.0), (WOW, 0.0), (MIX, 1.0), (PINGPONG, 1.0)]);
    let y = lauf(&mut p, &impuls(80_000, 1.0, 0.0));
    let (l, r): (Vec<f32>, Vec<f32>) = y.iter().cloned().unzip();
    let erste = 24_000 + WOW_SAMPLES;
    let (e1l, e1r) = (spitze_in(&l, erste - 300, erste + 300), spitze_in(&r, erste - 300, erste + 300));
    let (e2l, e2r) = (spitze_in(&l, 2 * 24_000 + 100, 2 * 24_000 + 800), spitze_in(&r, 2 * 24_000 + 100, 2 * 24_000 + 800));
    println!("MESS ping-pong: repeat 1 L {e1l:.3} R {e1r:.3}, repeat 2 L {e2l:.3} R {e2r:.3}");
    assert!(e1l > 0.2 && e1r < 0.01, "first repeat on the left");
    assert!(e2r > 0.05 && e2l < 0.01, "second repeat on the right");
}

#[test]
fn jede_wiederholung_wird_leiser_und_dunkler() {
    // Off, 1/4, feedback 0.5, high cut at its lowest: repeat 2 is quieter than repeat 1 and the high cut smooths the impulse
    let mut p = lade(&[(ZEIT, zeit_pos(3)), (FB, 0.5), (DRIVE, 0.0), (HOCH, 0.0), (WOW, 0.0), (MIX, 1.0), (PINGPONG, 0.0)]);
    let y = lauf(&mut p, &impuls(60_000, 1.0, 0.0));
    let l: Vec<f32> = y.iter().map(|v| v.0).collect();
    let (a, b) = (spitze_in(&l, 24_000, 24_600), spitze_in(&l, 48_000, 48_800));
    println!("MESS repeats: first {a:.3}, second {b:.3}");
    assert!(a > 0.9 && b > 0.01 && b < 0.5 * a, "repeat 1 {a}, repeat 2 {b}");
}

#[test]
fn ducking_senkt_die_wiederholungen_waehrend_der_eingang_spielt() {
    let sinus: Vec<(f32, f32)> = (0..96_000).map(|i| { let v = 0.5 * (std::f32::consts::TAU * 440.0 * i as f32 / SR).sin(); (v, v) }).collect();
    let mass = |duck: f32| {
        let mut p = lade(&[(ZEIT, zeit_pos(0)), (FB, 0.0), (WOW, 0.0), (MIX, 1.0), (DUCK, duck), (DUCK_REL, 0.5)]);
        let y = lauf(&mut p, &sinus);
        rms(&y[48_000..].iter().map(|v| v.0).collect::<Vec<_>>())
    };
    let (offen, zu) = (mass(0.0), mass(1.0));
    let db = 20.0 * (zu / offen).log10();
    println!("MESS duck: wet RMS {offen:.4} at Duck 0, {zu:.5} at Duck 1 = {db:.1} dB");
    assert!(offen > 0.2, "the wet plays at Duck 0 ({offen})");
    assert!(db <= -12.0, "wet only {db} dB lower");
}

#[test]
fn mix_null_gibt_das_eingangssignal_unverzoegert_zurueck() {
    let x: Vec<(f32, f32)> = rauschen(24_000, 0.7).into_iter().zip(rauschen(24_000, 0.4).into_iter().rev()).collect();
    let mut p = lade(&[(MIX, 0.0), (FB, 1.0), (DRIVE, 1.0)]);
    let y = lauf(&mut p, &x);
    let fehler = x.iter().zip(&y).fold(0.0f32, |m, (a, b)| m.max((a.0 - b.0).abs()).max((a.1 - b.1).abs()));
    println!("MESS mix 0: largest deviation from the input {fehler:e}");
    assert!(fehler < 1e-6, "deviation {fehler}");
    // positive control: Mix 1 is not the dry signal
    let mut q = lade(&[(MIX, 1.0)]);
    let w = lauf(&mut q, &x);
    let diff = x.iter().zip(&w).fold(0.0f32, |m, (a, b)| m.max((a.0 - b.0).abs()));
    assert!(diff > 0.05, "Mix 1 equals the dry signal ({diff})");
}

#[test]
fn bei_halber_stellung_ist_der_ausgang_endlich_und_nicht_still_und_unter_der_grenze() {
    let burst: Vec<f32> = rauschen(24_000, 0.4).into_iter().chain(std::iter::repeat(0.0).take(72_000)).collect();
    let mut p = lade(&[]);
    let y = lauf(&mut p, &mono(&burst));
    let m: Vec<f32> = y.iter().map(|(l, r)| (l + r) / 2.0).collect();
    let db = 20.0 * rms(&m[..24_000]).max(1e-9).log10();
    println!("MESS fill: peak {:.3}, RMS of the burst {db:.1} dB", spitze(&y));
    assert!(db > -60.0, "silent ({db} dB)");
    assert!(spitze(&y) <= 0.9, "peak {}", spitze(&y));
}

#[test]
fn auf_der_musikprobe_bei_halber_stellung_unter_0_9_und_ohne_gleichanteil() {
    // the probe of beispiele_konvention.rs (mono music, 6 s, then 1.5 s of silence) at 120 BPM
    let x: Vec<f32> = common::musik_probe().into_iter().chain(std::iter::repeat(0.0).take(72_000)).collect();
    let y = lauf(&mut lade(&[]), &mono(&x));
    let (sl, sr) = y.iter().fold((0.0f64, 0.0f64), |a, (l, r)| (a.0 + *l as f64, a.1 + *r as f64));
    let dc = (sl / y.len() as f64).abs().max((sr / y.len() as f64).abs());
    println!("MESS convention probe at the fill: peak {:.3}, DC {:.1} dBFS", spitze(&y), 20.0 * dc.max(1e-12).log10());
    assert!(spitze(&y) <= 0.9);
    assert!(dc < 10f64.powf(-50.0 / 20.0));
}

#[test]
fn jeder_knopf_ausser_freier_zeit_bewegt_den_klang_auf_der_probe() {
    // 0 against 1 with the others at 0.5, 120 BPM, a noise burst and 1.5 s of silence (the convention probe's shape)
    let burst: Vec<f32> = rauschen(24_000, 0.4).into_iter().chain(std::iter::repeat(0.0).take(72_000)).collect();
    let x = mono(&burst);
    for nr in 1..=11usize {
        let a = lauf(&mut lade(&[(nr, 0.0)]), &x);
        let b = lauf(&mut lade(&[(nr, 1.0)]), &x);
        let diff = a.iter().zip(&b).fold(0.0f32, |m, (p, q)| m.max((p.0 - q.0).abs()).max((p.1 - q.1).abs()));
        println!("MESS knob {nr}: largest difference {diff:e}");
        if nr == FREI { assert_eq!(diff, 0.0, "Free time acts only in Time = Free"); } else { assert!(diff > 0.0, "knob {nr} is dead on the probe"); }
    }
}

#[test]
fn ecken_der_knoepfe_bleiben_endlich_und_beschraenkt() {
    let x = mono(&rauschen(48_000, 0.8));
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
    println!("MESS fx-echo corners: highest peak over 26 cases {hoechste:.3}");
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
        if i % 64 == 0 { p.setze_regler(1 + (i / 64) as usize % 11, (i % 1000) as f32 / 1000.0); }
        if i == 90_000 { p.zuruecksetzen(); }
        p.setze_eingang(*v, *v);
        let (l, r) = p.sample_stereo();
        summe += l + r;
    }
    assert_eq!(anforderungen(), start, "the real-time path asked for memory");
    assert!(summe.is_finite());
}
