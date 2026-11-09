//! Echo (Slice 4b): Laufzeit, Bruchteil, Allpass, Rückkopplung, Dämpfung, Ping-Pong, Gleiten, Denormal-Schwanz,
//! Zurücksetzen. Jeder Test hat eine Mutation, die ihn rot macht (mutation.py, Gruppe T1).
use baukasten_dsp::echo::{thiran, Echo, FB_MAX};

const SR: f32 = 48_000.0;

/// Echo mit fester Zeit (Thiran) oder moduliert (Lagrange, Zeit kommt je Sample über `prozess`)
fn echo(fest: bool, zeit_ms: f32, glatt_ms: f32, daempf_hz: f32, pingpong: bool) -> Echo {
    Echo::neu(SR, 1000.0, if fest { Some(zeit_ms) } else { None }, glatt_ms, daempf_hz, pingpong)
}

/// Dirac links und rechts, dann Stille; `zeit_ms` geht auch an das feste Echo (dort ohne Wirkung)
fn impuls(e: &mut Echo, zeit_ms: f32, fb: f32, n: usize) -> Vec<(f32, f32)> {
    (0..n).map(|i| { let x = if i == 0 { 1.0 } else { 0.0 }; e.prozess(x, x, zeit_ms, fb, 1.0) }).collect()
}

#[test]
fn impuls_kommt_genau_nach_t_samples() {
    for fest in [true, false] {
        let mut e = echo(fest, 100.0, 0.0, 0.0, false);
        let y = impuls(&mut e, 100.0, 0.0, 10_000);
        assert_eq!(y[0], (1.0, 1.0), "fest {fest}: trocken im ersten Sample");
        assert_eq!(y[4800], (1.0, 1.0), "fest {fest}: Echo bei 100 ms = 4800 Samples");
        let rest: f32 = y.iter().enumerate().filter(|(i, _)| *i != 0 && *i != 4800).map(|(_, v)| v.0.abs() + v.1.abs()).sum();
        assert_eq!(rest, 0.0, "fest {fest}: außer Sample 0 und 4800 ist alles still");
    }
}

#[test]
fn bruchteil_trifft_die_laufzeit_auf_ein_hundertstel_sample() {
    // T = 1000,37 Samples; 100 Hz, Amplitude 0,5: ein Fehler von 0,01 Sample gäbe höchstens 0,5·ω·0,01
    let zeit_ms = 1000.37f32 / 48.0;
    let t = (zeit_ms * (SR / 1000.0)) as f64;
    let w = 2.0 * std::f64::consts::PI * 100.0 / SR as f64;
    let schranke = 0.5 * w * 0.01;
    for fest in [true, false] {
        let mut e = echo(fest, zeit_ms, 0.0, 0.0, false);
        let mut fehler: f64 = 0.0;
        for n in 0..20_000 {
            let x = (0.5 * (w * n as f64).sin()) as f32;
            let (l, _) = e.prozess(x, x, zeit_ms, 0.0, 1.0);
            if n > 4_000 {
                let soll = 0.5 * (w * (n as f64 - t)).sin();
                fehler = fehler.max(((l - x) as f64 - soll).abs());
            }
        }
        println!("MESS Bruchteil fest {fest}: größter Fehler {fehler:.2e}, Schranke {schranke:.2e}");
        assert!(fehler < schranke, "fest {fest}: Fehler {fehler:.2e} über {schranke:.2e}");
    }
}

#[test]
fn thiran_ist_stabil_und_allpass() {
    // für jeden Bruchteil: Pol |a| < 1/3 + Rand, und ein 8-kHz-Sinus kommt mit Betrag 1 heraus
    for k in 0..20 {
        let t = 480.0 + k as f64 * 0.05;
        let (n, a) = thiran(t);
        assert!((n as f64 + 0.5..n as f64 + 1.5).contains(&t), "T {t}: N {n}");
        assert!(a.abs() <= 1.0 / 3.0 + 1e-12, "T {t}: Pol {a}");
    }
    let zeit_ms = 480.37f32 / 48.0;
    let mut e = echo(true, zeit_ms, 0.0, 0.0, false);
    let w = 2.0 * std::f64::consts::PI * 8_000.0 / SR as f64;
    let (mut ein, mut aus) = (0.0f64, 0.0f64);
    for n in 0..48_000 {
        let x = (w * n as f64).sin() as f32;
        let (l, _) = e.prozess(x, x, zeit_ms, 0.0, 1.0);
        if n >= 24_000 {
            ein += (x as f64).powi(2);
            aus += ((l - x) as f64).powi(2);
        }
    }
    let db = 10.0 * (aus / ein).log10();
    println!("MESS Thiran 8 kHz: Betrag {db:.2e} dB");
    assert!(db.abs() < 1e-3, "Thiran ist kein Allpass: {db} dB");
}

#[test]
fn rueckkopplung_faellt_je_wiederholung_um_fb() {
    let mut e = echo(true, 10.0, 0.0, 0.0, false);
    let y = impuls(&mut e, 10.0, 0.5, 480 * 9);
    for k in 1..=8 {
        let soll = 0.5f32.powi(k as i32 - 1);
        assert!((y[480 * k].0 - soll).abs() < 1e-6, "Wiederholung {k}: {} statt {soll}", y[480 * k].0);
    }
}

#[test]
fn rueckkopplung_ueber_der_grenze_wird_geklemmt() {
    let mut e = echo(true, 10.0, 0.0, 0.0, false);
    let y = impuls(&mut e, 10.0, 1.5, 48_000 * 10);
    let spitze = y[1..].iter().map(|v| v.0.abs()).fold(0.0f32, f32::max);
    // Wiederholung k liegt bei 480·k mit fb^(k−1): die 50. also bei FB_MAX^49 = 0,372 (eine Klemme auf 0,9 gäbe 0,006)
    let w50 = y[480 * 50].0;
    println!("MESS fb 1,5: Spitze {spitze}, 50. Wiederholung {w50:.4} (soll {:.4})", FB_MAX.powi(49));
    assert!(spitze <= 1.0, "Spitze {spitze}");
    assert!((w50 - FB_MAX.powi(49)).abs() < 1e-5, "geklemmt auf {FB_MAX}: 50. Wiederholung {w50}");
}

#[test]
fn daempfung_macht_die_wiederholungen_dunkler() {
    // vierte Wiederholung eines Dirac: mit Tiefpass 2 kHz im Rückweg deutlich weniger Energie als ohne
    let energie = |daempf: f32| {
        let mut e = echo(true, 10.0, 0.0, daempf, false);
        let y = impuls(&mut e, 10.0, 0.7, 480 * 5);
        y[480 * 4 - 10..480 * 4 + 200].iter().map(|v| (v.0 as f64).powi(2)).sum::<f64>()
    };
    let (ohne, mit) = (energie(0.0), energie(2_000.0));
    println!("MESS vierte Wiederholung: ohne Dämpfung {ohne:.3e}, mit 2 kHz {mit:.3e}");
    assert!(mit < 0.5 * ohne, "Dämpfung wirkt nicht: {mit} gegen {ohne}");
}

#[test]
fn pingpong_wechselt_die_seiten() {
    let mut e = echo(true, 10.0, 0.0, 0.0, true);
    let y = impuls(&mut e, 10.0, 0.5, 480 * 4);
    assert_eq!(y[0], (1.0, 1.0), "trocken beidseitig");
    assert_eq!(y[480], (1.0, 0.0), "erste Wiederholung nur links");
    assert_eq!(y[960], (0.0, 0.5), "zweite nur rechts");
    assert_eq!(y[1440], (0.25, 0.0), "dritte wieder links");
}

#[test]
fn zeit_gleitet_ohne_knacken() {
    // 220 Hz, Zeit springt bei Sample 48 068 von 300 auf 471 ms: geglättet bleibt jeder Schritt klein, ungeglättet springt
    // der nasse Weg — der zweite Lauf zeigt, dass der Test nicht blind ist. Die Sprungstelle ist so gewählt, dass die Phase
    // vor und nach dem Sprung weit auseinander liegt (Plan-Review gemessen: ungeglättet 0,935, bei Sample 48 000 nur 0,357)
    let groesster_schritt = |glatt: f32| {
        let mut e = echo(false, 300.0, glatt, 0.0, false);
        let w = 2.0 * std::f64::consts::PI * 220.0 / SR as f64;
        let (mut alt, mut groesst) = (0.0f32, 0.0f32);
        for n in 0..96_000 {
            let x = (0.5 * (w * n as f64).sin()) as f32;
            let zeit = if n < 48_068 { 300.0 } else { 471.0 };
            let (l, _) = e.prozess(x, x, zeit, 0.0, 1.0);
            let nass = l - x;
            if n > 47_000 {
                groesst = groesst.max((nass - alt).abs());
            }
            alt = nass;
        }
        groesst
    };
    let (mit, ohne) = (groesster_schritt(100.0), groesster_schritt(0.0));
    println!("MESS größter Schritt im nassen Weg: geglättet {mit:.3}, ungeglättet {ohne:.3}");
    assert!(mit < 0.2, "Knacken beim Gleiten: {mit}");
    assert!(ohne > 0.5, "Gegenprobe ohne Glättung springt nicht, der Test wäre blind: {ohne}");
}

#[test]
fn kein_denormal_im_schwanz() {
    // fb 0,98: nach ~4300 Wiederholungen läge der Schwanz unter f32::MIN_POSITIVE. Drei Fälle: ganzzahlig ohne Filter
    // (Thiran a = 0), mit Bruchteil (a ≠ 0, Plan-Review: 234 Denormal-Werte ohne Nullen) und mit Tiefpass im Rückweg
    // (Zustand `tp` blieb ohne Nullen denormal, Stille kostete 10,4 statt 4,4 ns je Sample)
    for (ms, daempf) in [(1.0f32, 0.0f32), (1.01, 0.0), (1.01, 3_000.0)] {
        let mut e = echo(true, ms, 0.0, daempf, false);
        let y = impuls(&mut e, ms, 0.98, 48_000 * 12);
        let denormal = y.iter().filter(|v| (v.0 != 0.0 && v.0.abs() < f32::MIN_POSITIVE) || (v.1 != 0.0 && v.1.abs() < f32::MIN_POSITIVE)).count();
        assert_eq!(denormal, 0, "{ms} ms, daempf {daempf}: {denormal} Denormal-Werte im Schwanz");
        assert_eq!(*y.last().unwrap(), (0.0, 0.0), "{ms} ms, daempf {daempf}: der Schwanz endet in exakt 0");
        assert!(!e.zustand_denormal(), "{ms} ms, daempf {daempf}: innerer Zustand (tp/ap) bleibt denormal");
    }
}

#[test]
fn zuruecksetzen_gleich_frisch() {
    for (fest, pp) in [(true, false), (false, false), (true, true)] {
        let mut frisch = echo(fest, 37.3, 50.0, 3_000.0, pp);
        let mut benutzt = echo(fest, 37.3, 50.0, 3_000.0, pp);
        let lauf = |e: &mut Echo| -> Vec<(f32, f32)> {
            (0..20_000).map(|i| { let x = ((i * 7919) % 101) as f32 / 101.0 - 0.5; e.prozess(x, -x, 37.3 + (i / 5000) as f32, 0.6, 0.7) }).collect()
        };
        lauf(&mut benutzt);
        benutzt.zuruecksetzen();
        assert_eq!(lauf(&mut frisch), lauf(&mut benutzt), "fest {fest}, pingpong {pp}");
    }
}

#[test]
fn erster_wert_gilt_sofort() {
    // moduliert mit Glättung 100 ms, Zeit von Anfang an 100 ms: ohne `erst` glitte die Zeit von 0 her, das Echo käme verschmiert
    let mut e = echo(false, 100.0, 100.0, 0.0, false);
    let y = impuls(&mut e, 100.0, 0.0, 10_000);
    assert_eq!(y[4800], (1.0, 1.0), "Echo bei 100 ms = 4800 Samples");
    let rest: f32 = y.iter().enumerate().filter(|(i, _)| *i != 0 && *i != 4800).map(|(_, v)| v.0.abs() + v.1.abs()).sum();
    assert_eq!(rest, 0.0, "außer Sample 0 und 4800 ist alles still");
}

#[test]
fn zeit_wird_geklemmt() {
    // moduliert: 0 und −5 ms gelten als 1 ms (48 Samples), 1e9 ms als max (1000 ms = 48 000 Samples); fest: 5000 ms bei max 1000
    for zeit in [0.0f32, -5.0] {
        let mut e = echo(false, 100.0, 0.0, 0.0, false);
        let y = impuls(&mut e, zeit, 0.0, 1_000);
        assert_eq!(y[48], (1.0, 1.0), "Zeit {zeit}: Echo bei 1 ms = 48 Samples");
    }
    let mut e = echo(false, 100.0, 0.0, 0.0, false);
    let y = impuls(&mut e, 1e9, 0.0, 48_100);
    assert_eq!(y[48_000], (1.0, 1.0), "Zeit 1e9: Echo bei max = 48 000 Samples");
    let mut e = echo(true, 5000.0, 0.0, 0.0, false);
    let y = impuls(&mut e, 5000.0, 0.0, 48_100);
    assert_eq!(y[48_000], (1.0, 1.0), "fest 5000 ms: Echo bei max = 48 000 Samples");
}

#[test]
fn nan_vergiftet_nichts() {
    // NaN an zeit und fb: Ausgabe bleibt endlich, der innere Zustand auch (fest 10 ms: die Leitung taucht alle 480 Samples auf)
    for fest in [true, false] {
        let mut e = echo(fest, 10.0, 100.0, 3_000.0, false);
        for i in 0..10_000 {
            let x = ((i * 7919) % 101) as f32 / 101.0 - 0.5;
            let (l, r) = e.prozess(x, -x, f32::NAN, f32::NAN, 1.0);
            assert!(l.is_finite() && r.is_finite(), "fest {fest}: Sample {i}: {l} {r}");
        }
        assert!(!e.zustand_denormal(), "fest {fest}: Zustand denormal");
    }
}

#[test]
fn pingpong_mischt_beide_seiten_in_die_leitung() {
    // Dirac nur links: die erste Wiederholung (links) trägt (l + r)/2 = 0,5, rechts bleibt es still
    let mut e = echo(true, 10.0, 0.0, 0.0, true);
    let y: Vec<(f32, f32)> = (0..481).map(|i| e.prozess(if i == 0 { 1.0 } else { 0.0 }, 0.0, 10.0, 0.5, 1.0)).collect();
    assert_eq!(y[0], (1.0, 0.0));
    assert_eq!(y[480], (0.5, 0.0), "erste Wiederholung links 0,5");
}
