//! Baukasten block `kreuz` (type 53): Linkwitz-Riley crossover, 2 or 3 bands, compensated sum. Magnitudes and phases come from
//! impulse responses of `Kreuz::prozess`, evaluated at the exact test frequency by a single-frequency DTFT in f64 (never at
//! an FFT bin).
use baukasten_dsp::kreuz::Kreuz;
use baukasten_dsp::{uebersetze, ARTEN};
use std::f64::consts::PI;

const SR: f64 = 48_000.0;
const N: usize = 1 << 18;

/// impulse responses (lo, mid, hi) over `n` samples
fn impulse(fc1: f32, fc2: f32, baender: u8, n: usize) -> [Vec<f64>; 3] {
    let mut k = Kreuz::default();
    let mut aus = [Vec::with_capacity(n), Vec::with_capacity(n), Vec::with_capacity(n)];
    for i in 0..n {
        let (l, m, h) = k.prozess(if i == 0 { 1.0 } else { 0.0 }, fc1, fc2, baender, SR as f32);
        aus[0].push(l as f64);
        aus[1].push(m as f64);
        aus[2].push(h as f64);
    }
    aus
}

fn summe(h: &[Vec<f64>; 3]) -> Vec<f64> { (0..h[0].len()).map(|i| h[0][i] + h[1][i] + h[2][i]).collect() }

fn dtft(h: &[f64], f: f64) -> (f64, f64) {
    let (mut re, mut im) = (0.0, 0.0);
    let w = 2.0 * PI * f / SR;
    for (n, v) in h.iter().enumerate() {
        let (s, c) = (w * n as f64).sin_cos();
        re += v * c;
        im -= v * s;
    }
    (re, im)
}

fn db(h: (f64, f64)) -> f64 { 20.0 * h.0.hypot(h.1).max(1e-30).log10() }

fn raster(n: usize) -> Vec<f64> { (0..n).map(|i| 20.0 * (1000.0f64).powf(i as f64 / (n - 1) as f64)).collect() }

const ZWEI: [f32; 4] = [60.0, 80.0, 120.0, 250.0];
const DREI: [(f32, f32); 6] = [(120.0, 2500.0), (250.0, 2500.0), (60.0, 8000.0), (100.0, 300.0), (250.0, 600.0), (250.0, 400.0)];

#[test]
fn summe_ist_flach() {
    let mut faelle: Vec<(f32, f32, u8)> = ZWEI.iter().map(|f| (*f, 0.0, 2)).collect();
    faelle.extend(DREI.iter().map(|(a, b)| (*a, *b, 3)));
    for (fc1, fc2, baender) in faelle {
        let h = impulse(fc1, fc2, baender, N);
        let s = summe(&h);
        let mut schlechtest = 0.0f64;
        for f in raster(41) {
            schlechtest = schlechtest.max(db(dtft(&s, f)).abs());
        }
        println!("MESS kreuz summe_ist_flach {baender} bands ({fc1}, {fc2}): worst deviation {schlechtest:.5} dB");
        assert!(schlechtest <= 0.02, "{baender} bands ({fc1}, {fc2}): sum deviates {schlechtest:.4} dB");
        // the phase of the sum never rises over frequency (400 point grid; 2^16 samples hold the whole response for fc >= 60)
        let kurz = &s[..1 << 16];
        let mut vorher = dtft(kurz, raster(400)[0]);
        for f in &raster(400)[1..] {
            let jetzt = dtft(kurz, *f);
            // angle(H[i+1] * conj(H[i]))
            let winkel = (jetzt.1 * vorher.0 - jetzt.0 * vorher.1).atan2(jetzt.0 * vorher.0 + jetzt.1 * vorher.1);
            assert!(winkel <= 0.0, "{baender} bands ({fc1}, {fc2}): phase rises at {f:.1} Hz ({winkel:e})");
            vorher = jetzt;
        }
    }
}

#[test]
fn jedes_band_minus_6_db_bei_fc() {
    for fc1 in ZWEI {
        let h = impulse(fc1, 0.0, 2, N);
        for (name, band) in [("lo", &h[0]), ("hi", &h[2])] {
            let d = db(dtft(band, fc1 as f64));
            assert!((d + 6.02).abs() <= 0.1, "2 bands fc1 {fc1} {name}: {d:.3} dB at the corner");
        }
    }
    for (fc1, fc2) in [(120.0f32, 2500.0f32), (60.0, 8000.0)] {
        let h = impulse(fc1, fc2, 3, N);
        for f in [fc1, fc2] {
            let d = db(dtft(&h[1], f as f64));
            assert!((d + 6.02).abs() <= 0.1, "3 bands ({fc1}, {fc2}) mid: {d:.3} dB at {f} Hz");
        }
    }
}

#[test]
fn flanken_24_db() {
    for fc1 in ZWEI {
        let h = impulse(fc1, 0.0, 2, N);
        let f = fc1 as f64;
        let lo = db(dtft(&h[0], 4.0 * f)) - db(dtft(&h[0], 8.0 * f));
        let hi = db(dtft(&h[2], f / 4.0)) - db(dtft(&h[2], f / 8.0));
        println!("MESS kreuz flanken_24_db fc1 {fc1}: lo falls {lo:.2} dB, hi rises {hi:.2} dB per octave");
        assert!((23.0..=24.5).contains(&lo), "fc1 {fc1}: lo falls {lo:.2} dB between 4 fc and 8 fc");
        assert!((23.0..=24.5).contains(&hi), "fc1 {fc1}: hi rises {hi:.2} dB between fc/8 and fc/4");
    }
}

fn rauschen(n: usize) -> Vec<f32> {
    let mut z = 0x2545_f491u32;
    (0..n).map(|_| {
        z ^= z << 13;
        z ^= z >> 17;
        z ^= z << 5;
        (z as f64 / u32::MAX as f64 * 2.0 - 1.0) as f32
    }).collect()
}

#[test]
fn gleich_wie_zwei_svf() {
    let x = rauschen(48_000);
    for fc1 in ZWEI {
        // two svf nodes in series: tp into tp (left) and hp into hp (right), the first stage shared as in the block
        let g = format!(
            r#"{{"format":"baukasten/2","name":"t","stimmen":1,"knoten":[{{"id":"e","art":"eingang"}},{{"id":"a","art":"svf","pole":2,"reso":0,"cutoff":{fc1}}},{{"id":"b","art":"svf","pole":2,"reso":0,"cutoff":{fc1}}},{{"id":"c","art":"svf","pole":2,"reso":0,"cutoff":{fc1}}},{{"id":"o","art":"ausgang"}}],"kanten":[{{"von":"e.l","nach":"a.x"}},{{"von":"a.tp","nach":"b.x"}},{{"von":"a.hp","nach":"c.x"}},{{"von":"b.tp","nach":"o.l"}},{{"von":"c.hp","nach":"o.r"}}]}}"#
        );
        let mut p = uebersetze(&g, SR as f32).unwrap_or_else(|e| panic!("{e:?}"));
        let mut k = Kreuz::default();
        let (mut fehler, mut energie) = (0.0f64, 0.0f64);
        for v in &x {
            p.setze_eingang(*v, *v);
            let (l, r) = p.sample_stereo();
            let (lo, _, hi) = k.prozess(*v, fc1, 0.0, 2, SR as f32);
            fehler += ((l - lo) as f64).powi(2) + ((r - hi) as f64).powi(2);
            energie += 2.0 * (*v as f64).powi(2);
        }
        let rel = 10.0 * (fehler / energie).max(1e-30).log10();
        println!("MESS kreuz gleich_wie_zwei_svf fc1 {fc1}: difference {rel:.1} dB of the input RMS");
        assert!(rel < -120.0, "fc1 {fc1}: {rel:.1} dB");
    }
}

#[test]
fn keine_ueberhoehung() {
    for fc1 in ZWEI {
        let mut hoechst = 0.0f32;
        for f in raster(41) {
            let mut k = Kreuz::default();
            let mut spitze = 0.0f32;
            for i in 0..96_000usize {
                let x = (2.0 * PI * f * i as f64 / SR).sin() as f32;
                let (l, m, h) = k.prozess(x, fc1, 0.0, 2, SR as f32);
                if i >= 48_000 { spitze = spitze.max((l + m + h).abs()); }
            }
            hoechst = hoechst.max(spitze);
        }
        println!("MESS kreuz keine_ueberhoehung fc1 {fc1}: highest sum amplitude {hoechst:.5}");
        assert!(hoechst <= 1.0023, "fc1 {fc1}: sum amplitude {hoechst}");
    }
}

#[test]
fn zwei_baender_mitte_stumm() {
    let mut k = Kreuz::default();
    for v in rauschen(20_000) {
        let (_, m, _) = k.prozess(v, 250.0, 3000.0, 2, SR as f32);
        assert_eq!(m, 0.0);
    }
}

#[test]
fn fc2_unter_fc1() {
    let h = impulse(250.0, 100.0, 3, N);
    let s = summe(&h);
    for f in raster(41) {
        let d = db(dtft(&s, f));
        assert!(d.abs() <= 0.02, "sum deviates {d:.4} dB at {f:.1} Hz");
    }
    let spitze = db(dtft(&h[1], 250.0));
    assert!((spitze + 12.04).abs() <= 0.1, "mid at 250 Hz: {spitze:.3} dB, expected -12.04");
    // 250 Hz is the maximum on a fine grid around it
    for f in raster(2000) {
        assert!(db(dtft(&h[1][..1 << 16], f)) <= spitze + 0.01, "mid is louder than at 250 Hz at {f:.1} Hz");
    }
    for f in [125.0, 500.0] {
        let d = spitze - db(dtft(&h[1], f));
        println!("MESS kreuz fc2_unter_fc1: mid is {d:.2} dB below its peak at {f} Hz");
        assert!(d >= 10.0, "mid only {d:.2} dB below the peak at {f} Hz");
    }
}

#[test]
fn nan_und_stimmen() {
    let mut k = Kreuz::default();
    for i in 0..200 { k.prozess((i as f32 * 0.1).sin(), 200.0, 2000.0, 3, SR as f32); }
    assert_eq!(k.prozess(f32::NAN, 200.0, 2000.0, 3, SR as f32), (0.0, 0.0, 0.0));
    for i in 0..1000 {
        let (l, m, h) = k.prozess((i as f32 * 0.1).sin(), 200.0, 2000.0, 3, SR as f32);
        assert!(l.is_finite() && m.is_finite() && h.is_finite());
    }
    // five seconds of silence leave no subnormal float in any state
    let mut k = Kreuz::default();
    for i in 0..200 { k.prozess((i as f32 * 0.3).sin(), 60.0, 80.0, 3, SR as f32); }
    for _ in 0..(5 * 48_000) { k.prozess(0.0, 60.0, 80.0, 3, SR as f32); }
    for s in k.zustaende() { assert!(s == 0.0 || s.is_normal(), "state after silence is {s:e}"); }

    // two voices with different notes equal the sum of two single-voice runs
    let graph = |stimmen: usize| format!(
        r#"{{"format":"baukasten/2","name":"t","stimmen":{stimmen},"knoten":[{{"id":"n","art":"note"}},{{"id":"s","art":"saege"}},{{"id":"k","art":"kreuz","fc1":200,"fc2":2000,"baender":3}},{{"id":"a","art":"add"}},{{"id":"o","art":"ausgang"}}],"kanten":[{{"von":"n.hz","nach":"s.hz"}},{{"von":"s.aus","nach":"k.x"}},{{"von":"k.lo","nach":"a.a"}},{{"von":"k.mid","nach":"a.b"}},{{"von":"k.hi","nach":"a.c"}},{{"von":"a.aus","nach":"o.x"}}]}}"#
    );
    let lauf = |stimmen: usize, noten: &[u8]| {
        let mut p = uebersetze(&graph(stimmen), SR as f32).unwrap_or_else(|e| panic!("{e:?}"));
        for n in noten { p.note_an(*n, 0.8); }
        (0..20_000).map(|_| p.sample_stereo().0).collect::<Vec<f32>>()
    };
    let (a, b, ab) = (lauf(1, &[45]), lauf(1, &[52]), lauf(2, &[45, 52]));
    let abw = (0..a.len()).map(|i| (ab[i] - (a[i] + b[i])).abs()).fold(0.0f32, f32::max);
    let pegel = ab.iter().fold(0.0f32, |m, v| m.max(v.abs()));
    println!("MESS kreuz nan_und_stimmen: two voices against two single runs, largest difference {abw:e} (peak {pegel})");
    assert!(pegel > 0.05, "the run is silent, the test would prove nothing");
    assert!(abw < 1e-4, "two voices differ from two single runs by {abw}");
}

#[test]
fn art_im_graphen_ohne_latenz() {
    assert_eq!(ARTEN.iter().position(|a| a.art == "kreuz"), Some(53));
    let g = |b: &str| format!(r#"{{"format":"baukasten/2","name":"t","stimmen":1,"knoten":[{{"id":"e","art":"eingang"}},{{"id":"k","art":"kreuz","baender":{b}}},{{"id":"o","art":"ausgang"}}],"kanten":[{{"von":"e.l","nach":"k.x"}},{{"von":"k.lo","nach":"o.l"}},{{"von":"k.hi","nach":"o.r"}}]}}"#);
    for b in ["2", "3"] {
        assert_eq!(uebersetze(&g(b), SR as f32).unwrap().latenz(), 0, "kreuz has no latency");
    }
    for b in ["1", "4", "2.5"] {
        let e = match uebersetze(&g(b), SR as f32) { Err(e) => format!("{e:?} {e}"), Ok(_) => panic!("baender {b} must be refused") };
        assert!(e.contains("baender") && e.contains("2 or 3"), "message must name baender: {e}");
    }
}
