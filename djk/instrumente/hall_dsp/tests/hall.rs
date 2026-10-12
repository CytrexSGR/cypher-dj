//! Abnahme des Cypher Hall an den Messgrößen aus MATHE.md §9. Jedes Maß wird erst an einem Fall
//! geeicht, dessen Ergebnis unabhängig bekannt ist.
use hall_dsp::*;
use realfft::num_complex::Complex;
use realfft::RealFftPlanner;

const FS: f64 = 48000.0;

fn grund() -> HallEinstellung {
    HallEinstellung { mix: 1.0, frueh: 0.0, lowcut_hz: 1.0, highcut_hz: 1e6, ..Default::default() }
}

/// Impulsantwort (nur nass), Impuls auf beiden Kanälen.
fn ir(e: HallEinstellung, sek: f64) -> (Vec<f32>, Vec<f32>) {
    let n = (sek * FS) as usize;
    let mut h = Hall::neu(FS);
    h.setze(e);
    let mut l = vec![0.0f32; n];
    let mut r = vec![0.0f32; n];
    l[0] = 1.0;
    r[0] = 1.0;
    for (a, b) in l.chunks_mut(256).zip(r.chunks_mut(256)) {
        h.nur_nass(a, b);
    }
    (l, r)
}

fn energie(x: &[f32]) -> f64 {
    x.iter().map(|&v| (v as f64).powi(2)).sum()
}

/// Oktavband um fc per FFT-Maske.
fn oktavband(x: &[f32], fc: f64) -> Vec<f64> {
    let n = (2 * x.len()).next_power_of_two(); // 2× Polster: sonst wickelt die zyklische Faltung Energie ans Ende
    let mut p = RealFftPlanner::<f64>::new();
    let (f, i) = (p.plan_fft_forward(n), p.plan_fft_inverse(n));
    let mut a: Vec<f64> = x.iter().map(|&v| v as f64).chain(std::iter::repeat(0.0)).take(n).collect();
    let mut s = f.make_output_vec();
    f.process(&mut a, &mut s).unwrap();
    for (k, v) in s.iter_mut().enumerate() {
        let fr = k as f64 * FS / n as f64;
        if fr < fc / 2f64.sqrt() || fr > fc * 2f64.sqrt() {
            *v = Complex::new(0.0, 0.0);
        }
    }
    let mut y = i.make_output_vec();
    i.process(&mut s, &mut y).unwrap();
    y.truncate(x.len());
    y.iter().map(|v| v / n as f64).collect()
}

/// T30 nach Schroeder: EDC rückwärts integriert, Gerade durch −5 … −35 dB, auf 60 dB hochgerechnet.
fn t60_schroeder(h: &[f64]) -> f64 {
    let mut edc = vec![0.0; h.len()];
    let mut s = 0.0;
    for i in (0..h.len()).rev() {
        s += h[i] * h[i];
        edc[i] = s;
    }
    let db: Vec<f64> = edc.iter().map(|&e| 10.0 * (e / edc[0]).log10()).collect();
    let a = db.iter().position(|&d| d <= -5.0).unwrap();
    let b = db.iter().position(|&d| d <= -35.0).expect("EDC erreicht −35 dB nicht: Messdauer zu kurz");
    // Ausgleichsgerade
    let (mut sx, mut sy, mut sxx, mut sxy) = (0.0, 0.0, 0.0, 0.0);
    let n = (b - a) as f64;
    for i in a..b {
        let t = i as f64 / FS;
        sx += t;
        sy += db[i];
        sxx += t * t;
        sxy += t * db[i];
    }
    let steigung = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    -60.0 / steigung
}

/// Normiertes Echodichte-Profil (Abel & Huang): Anteil über der lokalen Standardabweichung in einem
/// 20-ms-Fenster, geteilt durch erfc(1/√2). Mittel über [von, bis) Sekunden.
fn echodichte(h: &[f32], von: f64, bis: f64) -> f64 {
    let w = (0.020 * FS) as usize;
    let erfc = 0.317_310_507_862_914_1;
    let mut summe = 0.0;
    let mut anzahl = 0;
    let mut t = (von * FS) as usize;
    while t + w <= (bis * FS) as usize {
        let f = &h[t..t + w];
        let sigma = (f.iter().map(|&v| (v as f64).powi(2)).sum::<f64>() / w as f64).sqrt();
        let ueber = f.iter().filter(|&&v| (v as f64).abs() > sigma).count() as f64 / w as f64;
        summe += ueber / erfc;
        anzahl += 1;
        t += w / 2;
    }
    summe / anzahl as f64
}

#[test]
fn echodichte_mass_ist_geeicht() {
    // Gauß-Rauschen ⇒ ≈ 1; dünner Impulszug (50/s) ⇒ deutlich < 1
    let mut z = 1u64;
    let mut g = || {
        z ^= z << 13;
        z ^= z >> 7;
        z ^= z << 17;
        (z >> 11) as f64 / (1u64 << 53) as f64
    };
    let rauschen: Vec<f32> = (0..48000)
        .map(|_| ((-2.0 * g().max(1e-12).ln()).sqrt() * (2.0 * std::f64::consts::PI * g()).cos()) as f32)
        .collect();
    let mut duenn = vec![0.0f32; 48000];
    for i in (0..48000).step_by(960) {
        duenn[i] = 1.0;
    }
    let (er, ed) = (echodichte(&rauschen, 0.0, 1.0), echodichte(&duenn, 0.0, 1.0));
    println!("Eichung Echodichte: Rauschen {er:.3}, Impulszug {ed:.3}");
    assert!((er - 1.0).abs() < 0.05, "Rauschen ergibt {er}");
    assert!(ed < 0.3, "Impulszug ergibt {ed}");
}

#[test]
fn t60_mass_ist_geeicht() {
    // Exponentiell abklingendes Rauschen mit bekanntem T60 = 1,7 s
    let mut z = 7u64;
    let h: Vec<f64> = (0..(4.0 * FS) as usize)
        .map(|i| {
            z ^= z << 13;
            z ^= z >> 7;
            z ^= z << 17;
            let r = (z >> 11) as f64 / (1u64 << 53) as f64 - 0.5;
            r * 10f64.powf(-3.0 * i as f64 / FS / 1.7)
        })
        .collect();
    let t = t60_schroeder(&h);
    println!("Eichung T60: Soll 1,70 s, gemessen {t:.3} s");
    assert!((t - 1.7).abs() < 0.05);
}

#[test]
fn impuls_energie_gleich_pegel() {
    for (i, &n) in RAHMEN.iter().enumerate() {
        for decay in [0.5, 2.0, 6.0] {
            let e = HallEinstellung { rahmen: i, decay_s: decay, tief_faktor: 1.0, hoch_faktor: 1.0, ..grund() };
            let (l, r) = ir(e, decay * 2.5 + 0.5);
            let (dl, dr) = (10.0 * energie(&l).log10(), 10.0 * energie(&r).log10());
            println!("N {n:5} T60 {decay}: Energie L {dl:+.2} dB, R {dr:+.2} dB");
            assert!(dl.abs() < 0.5 && dr.abs() < 0.5, "N {n} T60 {decay}: {dl:.2}/{dr:.2} dB");
        }
    }
}

#[test]
fn t60_je_band_folgt_der_kurve() {
    let e = HallEinstellung { decay_s: 2.0, tief_faktor: 1.5, hoch_faktor: 0.5, ..grund() };
    let (l, _) = ir(e, 7.0);
    let start = (e.pre_ms + 0.5 * e.groesse_ms) / 1000.0 + 0.1;
    for fc in [125.0, 250.0, 1000.0, 4000.0, 8000.0] {
        let b = oktavband(&l, fc);
        let gemessen = t60_schroeder(&b[(start * FS) as usize..]);
        let soll = t60_kurve(&e, fc);
        println!("Oktave {fc:5} Hz: T60 Soll {soll:.2} s, gemessen {gemessen:.2} s");
        assert!((gemessen / soll - 1.0).abs() < 0.15, "{fc} Hz: {gemessen:.2} statt {soll:.2}");
    }
}

#[test]
fn fahne_ist_dicht() {
    let e = HallEinstellung { decay_s: 3.0, ..grund() };
    let (l, _) = ir(e, 1.0);
    let s = e.pre_ms / 1000.0 + 0.5 * e.groesse_ms / 1000.0;
    let dicht = echodichte(&l, s + 0.1, s + 0.6);
    // Gegenprobe: ohne Diffusion
    let (l0, _) = ir(HallEinstellung { diffusion: 0.0, ..e }, 1.0);
    let dicht0 = echodichte(&l0, s + 0.1, s + 0.6);
    println!("Echodichte Fahne 100–600 ms: Diffusion 1 → {dicht:.3}, Diffusion 0 → {dicht0:.3}");
    assert!(dicht > 0.9, "Fahne zu dünn: {dicht:.3}");
}

#[test]
fn trocken_bei_mix_null() {
    let mut h = Hall::neu(FS);
    h.setze(HallEinstellung { mix: 0.0, ..Default::default() });
    // Glättung abwarten
    let mut s1 = vec![0.0f32; 48000];
    let mut s2 = s1.clone();
    h.verarbeite_stereo(&mut s1, &mut s2);
    let x: Vec<f32> = (0..4800).map(|i| (i as f32 * 0.05).sin() * 0.5).collect();
    let (mut l, mut r) = (x.clone(), x.clone());
    h.verarbeite_stereo(&mut l, &mut r);
    let fehler = l.iter().zip(&x).map(|(a, b)| (a - b).abs()).fold(0.0f32, f32::max);
    assert!(fehler < 1e-6, "Mix 0 ist nicht trocken: {fehler}");
}

fn band_db(x: &[f32], fc: f64) -> f64 {
    10.0 * oktavband(x, fc).iter().map(|v| v * v).sum::<f64>().log10()
}

#[test]
fn ducking_raeumt_nur_die_belegten_frequenzen() {
    // 0,5 s Rauschen füllt den Hall, danach 2 s Sinus 1 kHz. Gemessen wird der nasse Ausgang im
    // Sinus-Fenster: 1-kHz-Oktave (belegt) und 4-kHz-Oktave (frei).
    let mut z = 3u64;
    let mut rnd = || {
        z ^= z << 13;
        z ^= z >> 7;
        z ^= z << 17;
        (z >> 11) as f64 / (1u64 << 53) as f64 - 0.5
    };
    let n = (2.5 * FS) as usize;
    let x: Vec<f32> = (0..n)
        .map(|i| if i < (0.5 * FS) as usize { rnd() as f32 } else { 0.3 * (2.0 * std::f32::consts::PI * 1000.0 * i as f32 / FS as f32).sin() })
        .collect();
    let lauf = |duck: f64| {
        let mut h = Hall::neu(FS);
        h.setze(HallEinstellung { decay_s: 4.0, duck, ..grund() });
        let (mut l, mut r) = (x.clone(), x.clone());
        h.nur_nass(&mut l, &mut r);
        l[(1.0 * FS) as usize..].to_vec()
    };
    let (ohne, mit) = (lauf(0.0), lauf(1.0));
    let (b1o, b1m) = (band_db(&ohne, 1000.0), band_db(&mit, 1000.0));
    let (b4o, b4m) = (band_db(&ohne, 4000.0), band_db(&mit, 4000.0));
    println!("Ducking: 1 kHz {:+.1} dB, 4 kHz {:+.1} dB", b1m - b1o, b4m - b4o);
    assert!(b1m - b1o < -10.0, "belegtes Band nicht geräumt: {:.1} dB", b1m - b1o);
    assert!((b4m - b4o).abs() < 1.5, "freies Band verändert: {:.1} dB", b4m - b4o);
}

#[test]
fn freeze_haelt_und_kill_beendet() {
    let mut z = 5u64;
    let mut rnd = || {
        z ^= z << 13;
        z ^= z >> 7;
        z ^= z << 17;
        ((z >> 11) as f64 / (1u64 << 53) as f64 - 0.5) as f32
    };
    let mut h = Hall::neu(FS);
    let e = HallEinstellung { decay_s: 1.0, ..grund() };
    h.setze(e);
    let mut blk = |h: &mut Hall, sek: f64, quelle: &mut dyn FnMut() -> f32| {
        let n = (sek * FS) as usize;
        let (mut l, mut r): (Vec<f32>, Vec<f32>) = (0..n).map(|_| { let v = quelle(); (v, v) }).unzip();
        for (a, b) in l.chunks_mut(256).zip(r.chunks_mut(256)) {
            h.nur_nass(a, b);
        }
        l
    };
    blk(&mut h, 0.5, &mut rnd);
    h.setze(HallEinstellung { freeze: true, ..e });
    let mut still = || 0.0f32;
    let a = blk(&mut h, 1.0, &mut still);
    let _ = blk(&mut h, 2.0, &mut still);
    let b = blk(&mut h, 1.0, &mut still);
    let (ea, eb) = (10.0 * energie(&a).log10(), 10.0 * energie(&b).log10());
    println!("Freeze: Sekunde 1 {ea:.1} dB, Sekunde 4 {eb:.1} dB (T60 wäre 1 s)");
    assert!((ea - eb).abs() < 1.0, "Freeze hält nicht: {ea:.1} → {eb:.1}");
    h.kill();
    let c = blk(&mut h, 0.5, &mut still);
    let rest = 10.0 * energie(&c[(0.3 * FS) as usize..]).max(1e-30).log10();
    println!("nach Kill: {rest:.1} dB");
    assert!(rest < -100.0, "Kill beendet nicht: {rest:.1} dB");
}

#[test]
fn stabil_bei_zufaelligen_einstellungen() {
    let mut z = 11u64;
    let mut rnd = || {
        z ^= z << 13;
        z ^= z >> 7;
        z ^= z << 17;
        (z >> 11) as f64 / (1u64 << 53) as f64
    };
    let mut h = Hall::neu(44100.0);
    let mut spitze = 0.0f32;
    for _ in 0..300 {
        h.setze(HallEinstellung {
            mix: rnd(),
            frueh: rnd(),
            fahne_db: -12.0 + 18.0 * rnd(),
            pre_ms: 250.0 * rnd(),
            groesse_ms: 5.0 + 195.0 * rnd(),
            decay_s: 0.1 + 30.0 * rnd(),
            tief_faktor: 0.25 + 3.75 * rnd(),
            hoch_faktor: 0.1 + 1.9 * rnd(),
            lowcut_hz: 20.0 + 480.0 * rnd(),
            highcut_hz: 1000.0 + 19000.0 * rnd(),
            diffusion: rnd(),
            breite: rnd(),
            duck: rnd(),
            freeze: rnd() < 0.1,
            rahmen: (rnd() * 5.0) as usize % 5,
        });
        let (mut l, mut r): (Vec<f32>, Vec<f32>) = (0..512).map(|_| ((rnd() - 0.5) as f32, (rnd() - 0.5) as f32)).unzip();
        h.verarbeite_stereo(&mut l, &mut r);
        for v in l.iter().chain(&r) {
            assert!(v.is_finite());
            spitze = spitze.max(v.abs());
        }
    }
    println!("Spitze: {spitze:.2}");
    assert!(spitze < 100.0);
}

#[test]
fn nur_rechts_gespeist_hallt_beidseitig() {
    // später Nachhall ist diffus: ein hart rechts liegender Impuls erzeugt links etwa gleich viel Fahne
    let n = (2.0 * FS) as usize;
    let mut h = Hall::neu(FS);
    h.setze(grund());
    let (mut l, mut r) = (vec![0.0f32; n], vec![0.0f32; n]);
    r[0] = 1.0;
    for (a, b) in l.chunks_mut(256).zip(r.chunks_mut(256)) {
        h.nur_nass(a, b);
    }
    let (el, er) = (energie(&l), energie(&r));
    let db = 10.0 * (el / er).log10();
    println!("nur rechts: Energie links {el:.4}, rechts {er:.4}, Differenz {db:.2} dB");
    assert!(er > 0.1, "Positivkontrolle: rechts hallt");
    assert!(db.abs() < 1.0, "links {db:.2} dB gegen rechts");
}
