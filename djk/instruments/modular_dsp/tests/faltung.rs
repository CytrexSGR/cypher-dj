//! S21: the `faltung` block (type 31): zero-latency partitioned convolution with an impulse response file.
//! Everything goes through the public JSON API and `ARTEN`, so this file compiles on the old code and fails at runtime.
#[path = "sampler_helpers/mod.rs"]
mod sampler_hilfe;
use baukasten_dsp::limiter::vorlauf;
use baukasten_dsp::{uebersetze_mit_wurzel, Fehler, Programm, ARTEN};
use sampler_hilfe::{schreibe, wurzel};
use std::path::Path;

const SR: f32 = 48_000.0;

fn xorshift(s: &mut u32) -> f32 {
    *s ^= *s << 13;
    *s ^= *s >> 17;
    *s ^= *s << 5;
    (*s as f64 / u32::MAX as f64 * 2.0 - 1.0) as f32
}

/// Interleaved stereo IR of `n` frames: decaying noise, L differs from R, all values <= 0.5.
fn ir(n: usize, seed: u32) -> Vec<f32> {
    let mut s = seed.max(1);
    let mut t = seed.wrapping_mul(2_654_435_761).max(1);
    (0..n).flat_map(|i| {
        let env = (-(i as f64) / (n as f64 / 4.0)).exp() as f32;
        [0.5 * env * xorshift(&mut s), 0.5 * env * xorshift(&mut t)]
    }).collect()
}

fn bild(d: &[f32]) -> (Vec<f32>, Vec<f32>) { (d.iter().step_by(2).copied().collect(), d.iter().skip(1).step_by(2).copied().collect()) }

/// Noise input, amplitude 0.5, L and R different.
fn rauschen(n: usize, seed: u32) -> Vec<(f32, f32)> {
    let mut s = seed.max(1);
    let mut t = seed.wrapping_mul(40_503).max(1);
    (0..n).map(|_| (0.5 * xorshift(&mut s), 0.5 * xorshift(&mut t))).collect()
}

/// eingang.l/r -> faltung.l/r -> ausgang.l/r. `werte` is appended to the faltung node (e.g. `,"mix":0.5`).
fn fx(datei: &str, werte: &str) -> String {
    format!(
        r#"{{"format":"baukasten/2","name":"f","stimmen":1,"knoten":[{{"id":"e","art":"eingang"}},{{"id":"p","art":"faltung","datei":"{datei}"{werte}}},{{"id":"o","art":"ausgang"}}],"kanten":[{{"von":"e.l","nach":"p.l"}},{{"von":"e.r","nach":"p.r"}},{{"von":"p.l","nach":"o.l"}},{{"von":"p.r","nach":"o.r"}}]}}"#
    )
}

fn lade(g: &str, w: &Path) -> Result<Programm, Fehler> { uebersetze_mit_wurzel(g, SR, Some(w)) }

fn lauf(p: &mut Programm, x: &[(f32, f32)]) -> Vec<(f32, f32)> {
    x.iter().map(|&(l, r)| { p.setze_eingang(l, r); p.sample_stereo() }).collect()
}

fn impuls(n: usize, bei: usize) -> Vec<(f32, f32)> { (0..n).map(|i| if i == bei { (1.0, 1.0) } else { (0.0, 0.0) }).collect() }

/// Direct f64 linear convolution per side, output as long as the input.
fn direkt(ir: &[f32], x: &[(f32, f32)]) -> Vec<(f64, f64)> {
    let (hl, hr) = bild(ir);
    (0..x.len()).map(|n| {
        let (mut a, mut b) = (0.0f64, 0.0f64);
        for k in 0..hl.len().min(n + 1) {
            a += hl[k] as f64 * x[n - k].0 as f64;
            b += hr[k] as f64 * x[n - k].1 as f64;
        }
        (a, b)
    }).collect()
}

fn bits_gleich(a: &[(f32, f32)], b: &[(f32, f32)]) -> usize {
    a.iter().zip(b).filter(|(x, y)| x.0.to_bits() != y.0.to_bits() || x.1.to_bits() != y.1.to_bits()).count()
}

#[test]
fn faltung_is_type_31_with_io() {
    let a = ARTEN.get(31).expect("ARTEN has no entry 31");
    assert_eq!(a.art, "faltung");
    assert_eq!(a.ein, &["x", "l", "r", "mix"]);
    assert_eq!(a.aus, &["l", "r"]);
    assert!(a.werte.is_empty());
    assert_eq!(a.frei, &[("mix", 1.0), ("pre", 0.0), ("laenge_max", 1000.0)]);
    assert_eq!(ARTEN[30].art, "sampler", "existing type numbers must not move");
}

#[test]
fn value_checks() {
    let w = wurzel();
    schreibe(&w, "ir.f32", &ir(600, 1));
    let wert = |g: Result<Programm, Fehler>, name: &str| match g {
        Err(Fehler::Wert { wert, .. }) => assert_eq!(wert, name),
        Err(e) => panic!("expected Fehler::Wert {name}, got {e:?}"),
        Ok(_) => panic!("expected Fehler::Wert {name}, got Ok"),
    };
    for v in ["-0.1", "1.1"] { wert(lade(&fx("ir.f32", &format!(r#","mix":{v}"#)), &w), "mix"); }
    for v in ["-1", "250.5"] { wert(lade(&fx("ir.f32", &format!(r#","pre":{v}"#)), &w), "pre"); }
    for v in ["0.5", "2000.5"] { wert(lade(&fx("ir.f32", &format!(r#","laenge_max":{v}"#)), &w), "laenge_max"); }
    wert(uebersetze_mit_wurzel(&fx("ir.f32", ""), 44_100.0, Some(&w)), "sr");
    match lade(r#"{"format":"baukasten/2","name":"f","stimmen":1,"knoten":[{"id":"e","art":"eingang"},{"id":"p","art":"faltung"},{"id":"o","art":"ausgang"}],"kanten":[{"von":"e.l","nach":"p.l"},{"von":"p.l","nach":"o.l"}]}"#, &w) {
        Err(Fehler::FehlenderWert { wert, .. }) => assert_eq!(wert, "datei"),
        other => panic!("expected FehlenderWert datei, got {:?}", other.err()),
    }
    assert!(matches!(uebersetze_mit_wurzel(&fx("ir.f32", ""), SR, None), Err(Fehler::Datei { .. })), "no root");
    assert!(matches!(lade(&fx("../a.f32", ""), &w), Err(Fehler::Datei { .. })), "path escape");
    assert!(matches!(lade(&fx("fehlt.f32", ""), &w), Err(Fehler::Datei { .. })), "missing file");
    // the allow-list for `datei` stays closed for every other art
    let lfo = r#"{"format":"baukasten/2","name":"f","stimmen":1,"knoten":[{"id":"l","art":"lfo","datei":"ir.f32"},{"id":"o","art":"ausgang"}],"kanten":[{"von":"l.aus","nach":"o.x"}]}"#;
    wert(lade(lfo, &w), "datei");
    for g in [r#","mix":0"#, r#","mix":1"#, r#","pre":0"#, r#","pre":250"#, r#","laenge_max":1"#, r#","laenge_max":2000"#] {
        // laenge_max 1 ms = 48 frames: use a short IR for that case
        let datei = if g.contains(r#""laenge_max":1"#) && !g.contains("2000") { schreibe(&w, "kurz.f32", &ir(48, 2)); "kurz.f32" } else { "ir.f32" };
        lade(&fx(datei, g), &w).unwrap_or_else(|e| panic!("boundary {g}: {e:?}"));
    }
}

#[test]
fn ir_over_laenge_max_is_refused() {
    let w = wurzel();
    schreibe(&w, "lang.f32", &ir(48_001, 3));
    schreibe(&w, "genau.f32", &ir(48_000, 3));
    match lade(&fx("lang.f32", r#","laenge_max":1000"#), &w) {
        Err(Fehler::Datei { grund, .. }) => assert!(grund.contains("48001 frames"), "{grund}"),
        other => panic!("expected Fehler::Datei, got {:?}", other.err()),
    }
    lade(&fx("genau.f32", r#","laenge_max":1000"#), &w).expect("48000 frames at laenge_max 1000 is the exact boundary");
}

fn impuls_antwort(ir_frames: usize, bei: usize, werte: &str) -> (Vec<f32>, Vec<(f32, f32)>) {
    let w = wurzel();
    let d = ir(ir_frames, 10 + ir_frames as u32);
    schreibe(&w, "ir.f32", &d);
    let mut p = lade(&fx("ir.f32", werte), &w).unwrap_or_else(|e| panic!("L={ir_frames}: {e:?}"));
    let y = lauf(&mut p, &impuls(bei + ir_frames + 600, bei));
    (d, y)
}

#[test]
fn unit_impulse_gives_the_ir() {
    for l in [8usize, 255, 256, 257, 511, 512, 513, 1000, 4097] {
        let (d, y) = impuls_antwort(l, 0, "");
        let (hl, hr) = bild(&d);
        let mut fehler = 0.0f32;
        for i in 0..l {
            fehler = fehler.max((y[i].0 - hl[i]).abs()).max((y[i].1 - hr[i]).abs());
        }
        let mut rest = 0.0f32;
        for v in &y[l..l + 600] { rest = rest.max(v.0.abs()).max(v.1.abs()); }
        println!("MESS faltung impulse L={l} max_err={fehler:.3e} tail_after_ir={rest:.3e}");
        assert!(fehler <= 1e-5, "L={l}: IR error {fehler}");
        assert!(rest <= 1e-5, "L={l}: output after the IR {rest}");
    }
}

#[test]
fn impulse_mid_block_is_shifted_exactly() {
    for bei in [100usize, 300] {
        let l = 1000;
        let (d, y) = impuls_antwort(l, bei, "");
        let (hl, hr) = bild(&d);
        assert!(y[..bei].iter().all(|v| v.0 == 0.0 && v.1 == 0.0), "output before the impulse must be exactly 0");
        let mut fehler = 0.0f32;
        for i in 0..l {
            fehler = fehler.max((y[bei + i].0 - hl[i]).abs()).max((y[bei + i].1 - hr[i]).abs());
        }
        println!("MESS faltung impulse at {bei} max_err={fehler:.3e}");
        assert!(fehler <= 1e-5, "impulse at {bei}: error {fehler}");
        let rest = y[bei + l..].iter().fold(0.0f32, |m, v| m.max(v.0.abs()).max(v.1.abs()));
        assert!(rest <= 1e-5, "impulse at {bei}: output after the IR {rest}");
    }
}

#[test]
fn matches_direct_convolution() {
    let w = wurzel();
    let d = ir(3000, 77);
    schreibe(&w, "ir.f32", &d);
    let x = rauschen(20_000, 5);
    let mut p = lade(&fx("ir.f32", ""), &w).unwrap();
    let y = lauf(&mut p, &x);
    let soll = direkt(&d, &x);
    let fehler = y.iter().zip(&soll).fold(0.0f64, |m, (a, b)| m.max((a.0 as f64 - b.0).abs()).max((a.1 as f64 - b.1).abs()));
    let pegel = soll.iter().fold(0.0f64, |m, b| m.max(b.0.abs()).max(b.1.abs()));
    println!("MESS faltung noise 3000 taps max_err={fehler:.3e} (peak of the reference {pegel:.3})");
    assert!(pegel > 0.1, "reference too quiet, the comparison would be blind");
    assert!(fehler <= 1e-5, "error against direct convolution {fehler}");
}

#[test]
fn identity_ir_is_bit_exact() {
    let w = wurzel();
    let mut d = vec![0.0f32; 16];
    d[0] = 1.0;
    d[1] = 1.0;
    schreibe(&w, "id.f32", &d);
    let x = rauschen(5000, 9);
    let mut p = lade(&fx("id.f32", ""), &w).unwrap();
    let y = lauf(&mut p, &x);
    assert_eq!(bits_gleich(&x, &y), 0, "identity IR must pass the input bit for bit");
}

#[test]
fn mix_zero_is_dry_and_half_is_linear() {
    let w = wurzel();
    schreibe(&w, "ir.f32", &ir(1000, 21));
    let x = rauschen(6000, 11);
    let y0 = lauf(&mut lade(&fx("ir.f32", r#","mix":0"#), &w).unwrap(), &x);
    assert_eq!(bits_gleich(&x, &y0), 0, "mix 0 must be bit-identical to the dry input");
    assert!(lauf(&mut lade(&fx("ir.f32", r#","mix":1"#), &w).unwrap(), &x).iter().zip(&x).any(|(a, b)| a.0 != b.0), "mix 1 must differ from dry");
    let nass = lauf(&mut lade(&fx("ir.f32", r#","mix":1"#), &w).unwrap(), &x);
    let halb = lauf(&mut lade(&fx("ir.f32", r#","mix":0.5"#), &w).unwrap(), &x);
    let fehler = (0..x.len()).fold(0.0f32, |m, i| {
        m.max((halb[i].0 - (0.5 * x[i].0 + 0.5 * nass[i].0)).abs()).max((halb[i].1 - (0.5 * x[i].1 + 0.5 * nass[i].1)).abs())
    });
    println!("MESS faltung mix 0.5 linearity max_err={fehler:.3e}");
    assert!(fehler <= 1e-6, "mix 0.5 is not the linear blend: {fehler}");
}

#[test]
fn pre_delays_the_wet_path_only() {
    let w = wurzel();
    let d = ir(1000, 31);
    schreibe(&w, "ir.f32", &d);
    let (hl, hr) = bild(&d);
    let y = lauf(&mut lade(&fx("ir.f32", r#","pre":10"#), &w).unwrap(), &impuls(480 + 1000 + 300, 0));
    let erste = y.iter().position(|v| v.0.abs() > 1e-6 || v.1.abs() > 1e-6).expect("silent output");
    assert_eq!(erste, 480, "10 ms predelay = exactly 480 samples");
    let fehler = (0..1000).fold(0.0f32, |m, i| m.max((y[480 + i].0 - hl[i]).abs()).max((y[480 + i].1 - hr[i]).abs()));
    assert!(fehler <= 1e-5, "predelayed IR error {fehler}");
    let ym = lauf(&mut lade(&fx("ir.f32", r#","pre":10,"mix":0.5"#), &w).unwrap(), &impuls(2000, 0));
    assert!((ym[0].0 - (0.5 + 0.5 * 0.0)).abs() < 1e-6, "the dry impulse must appear at sample 0 with mix 0.5, got {}", ym[0].0);
}

#[test]
fn latency_is_zero() {
    let w = wurzel();
    schreibe(&w, "ir.f32", &ir(4097, 41));
    assert_eq!(lade(&fx("ir.f32", ""), &w).unwrap().latenz(), 0, "faltung adds no latency");
    let g = r#"{"format":"baukasten/2","name":"f","stimmen":1,"knoten":[{"id":"e","art":"eingang"},{"id":"p","art":"faltung","datei":"ir.f32"},{"id":"g","art":"limiter","vorlauf":2},{"id":"o","art":"ausgang"}],"kanten":[{"von":"e.l","nach":"p.l"},{"von":"e.r","nach":"p.r"},{"von":"p.l","nach":"g.l"},{"von":"p.r","nach":"g.r"},{"von":"g.l","nach":"o.l"},{"von":"g.r","nach":"o.r"}]}"#;
    assert_eq!(lade(g, &w).unwrap().latenz(), vorlauf(2.0, SR) - 1, "the limiter's own latency still counts");
    assert!(vorlauf(2.0, SR) > 1, "negative control: the limiter latency is not trivially zero");
}

#[test]
fn x_feeds_both_sides() {
    let w = wurzel();
    let d = ir(700, 51);
    schreibe(&w, "ir.f32", &d);
    let (hl, hr) = bild(&d);
    let g = r#"{"format":"baukasten/2","name":"f","stimmen":1,"knoten":[{"id":"e","art":"eingang"},{"id":"p","art":"faltung","datei":"ir.f32"},{"id":"o","art":"ausgang"}],"kanten":[{"von":"e.l","nach":"p.x"},{"von":"p.l","nach":"o.l"},{"von":"p.r","nach":"o.r"}]}"#;
    let y = lauf(&mut lade(g, &w).unwrap(), &impuls(1500, 0));
    let fehler = (0..700).fold(0.0f32, |m, i| m.max((y[i].0 - hl[i]).abs()).max((y[i].1 - hr[i]).abs()));
    assert!(fehler <= 1e-5, "x must feed left with IR_L and right with IR_R: {fehler}");
    assert!(hl.iter().zip(&hr).any(|(a, b)| (a - b).abs() > 1e-3), "the test IR must differ between sides");
}

#[test]
fn reset_equals_fresh() {
    let w = wurzel();
    schreibe(&w, "ir.f32", &ir(4097, 61));
    let g = fx("ir.f32", r#","pre":5"#);
    let soll = lauf(&mut lade(&g, &w).unwrap(), &impuls(6000, 0));
    let mut p = lade(&g, &w).unwrap();
    lauf(&mut p, &rauschen(10_000, 13));
    p.zuruecksetzen();
    let ist = lauf(&mut p, &impuls(6000, 0));
    assert_eq!(bits_gleich(&soll, &ist), 0, "after zuruecksetzen the impulse response must equal a fresh instance's");
    assert!(soll.iter().any(|v| v.0 != 0.0), "silent reference, the comparison would be blind");
}

/// The reset can arrive in the middle of a block, when the distributed tail accumulator holds partial sums. 10 112 samples
/// leave the block position at 128, where about seven of the 14 partitions of a 4097 tap IR are already accumulated.
#[test]
fn reset_in_the_middle_of_a_block_equals_fresh() {
    let w = wurzel();
    schreibe(&w, "ir.f32", &ir(4097, 61));
    let g = fx("ir.f32", "");
    let soll = lauf(&mut lade(&g, &w).unwrap(), &impuls(6000, 0));
    let mut p = lade(&g, &w).unwrap();
    lauf(&mut p, &rauschen(10_112, 13));
    p.zuruecksetzen();
    let ist = lauf(&mut p, &impuls(6000, 0));
    assert_eq!(bits_gleich(&soll, &ist), 0, "after a mid-block zuruecksetzen the impulse response must equal a fresh instance's");
    assert!(soll.iter().any(|v| v.0 != 0.0), "silent reference, the comparison would be blind");
}

#[test]
fn silence_stays_silent() {
    let w = wurzel();
    schreibe(&w, "ir.f32", &ir(4097, 71));
    let y = lauf(&mut lade(&fx("ir.f32", ""), &w).unwrap(), &vec![(0.0, 0.0); 4096]);
    assert!(y.iter().all(|v| v.0 == 0.0 && v.1 == 0.0), "silence in must give exactly 0.0 out");
}

#[test]
fn mix_input_acts_from_a_knob() {
    let w = wurzel();
    schreibe(&w, "ir.f32", &ir(1000, 81));
    let g = r#"{"format":"baukasten/2","name":"f","stimmen":1,"knoten":[{"id":"e","art":"eingang"},{"id":"p","art":"faltung","datei":"ir.f32"},{"id":"k","art":"regler","nr":1,"min":0,"max":1},{"id":"o","art":"ausgang"}],"kanten":[{"von":"e.l","nach":"p.l"},{"von":"e.r","nach":"p.r"},{"von":"k.aus","nach":"p.mix"},{"von":"p.l","nach":"o.l"},{"von":"p.r","nach":"o.r"}]}"#;
    let x = rauschen(12_000, 17);
    let nass = lauf(&mut lade(&fx("ir.f32", ""), &w).unwrap(), &x);
    let mut aus = lade(g, &w).unwrap();
    aus.setze_regler(1, 0.0);
    let y0 = lauf(&mut aus, &x);
    // the smoother starts at the node value 1 and settles to the knob (5 ms): dry after 100 ms, wet before
    let rest = (6000..x.len()).fold(0.0f32, |m, i| m.max((y0[i].0 - x[i].0).abs()).max((y0[i].1 - x[i].1).abs()));
    println!("MESS faltung mix knob 0: max deviation from dry after 125 ms {rest:.3e}");
    assert!(rest <= 1e-6, "knob at 0: the mix input must settle on the dry signal ({rest})");
    assert!((0..100).any(|i| (y0[i].0 - x[i].0).abs() > 1e-3), "negative control: the first samples still carry the wet start value");
    let mut an = lade(g, &w).unwrap();
    an.setze_regler(1, 1.0);
    // the node value is 1 (default), the knob reads 1: the smoother starts at the node value, so the wet signal is exact
    let y1 = lauf(&mut an, &x);
    assert_eq!(bits_gleich(&nass, &y1), 0, "knob at 1: the mix input must give the wet signal bit for bit");
}
