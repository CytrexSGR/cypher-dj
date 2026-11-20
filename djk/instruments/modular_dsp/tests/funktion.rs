//! Baukasten block `funktion` (type 58): dual-slope function generator (envelope, slew limiter, LFO, audio oscillator).
use baukasten_dsp::funktion::Funktion;
use baukasten_dsp::{uebersetze, Fehler, ARTEN};

const SR: f32 = 48_000.0;

/// All inputs of one sample; the defaults of the block.
#[derive(Clone, Copy)]
struct Ein {
    x: f32,
    trig: f32,
    halt: f32,
    steigen: f32,
    fallen: f32,
    form: f32,
    zyklus: f32,
    tempo: f32,
}
impl Default for Ein {
    fn default() -> Self { Ein { x: 0.0, trig: 0.0, halt: 0.0, steigen: 0.01, fallen: 0.3, form: 0.0, zyklus: 0.0, tempo: 0.0 } }
}

/// `n` samples, the inputs from `ein(i)`; returns (aus, ende, steigt) per sample
fn lauf(n: usize, ein: impl Fn(usize) -> Ein) -> Vec<(f32, f32, f32)> {
    let mut f = Funktion::default();
    (0..n).map(|i| {
        let e = ein(i);
        f.prozess(e.x, e.trig, e.halt, e.steigen, e.fallen, e.form, e.zyklus, e.tempo, SR)
    }).collect()
}

/// first index at which `y >= pegel` (rising) from `von`
fn erster_ueber(y: &[(f32, f32, f32)], von: usize, pegel: f32) -> usize { (von..y.len()).find(|&i| y[i].0 >= pegel).expect("level reached") }
fn erster_unter(y: &[(f32, f32, f32)], von: usize, pegel: f32) -> usize { (von..y.len()).find(|&i| y[i].0 <= pegel).expect("level reached") }

/// trigger at sample 100 (one sample high)
fn trig_bei_100(i: usize) -> f32 { if (100..110).contains(&i) { 1.0 } else { 0.0 } }

#[test]
fn linear_anstieg_und_abfall_dauern_die_eingestellte_zeit() {
    for (st, fa) in [(0.01f32, 0.3f32), (0.05, 0.02), (0.002, 1.0)] {
        let n = 100 + ((st + fa) * SR) as usize + 2000;
        let y = lauf(n, |i| Ein { trig: trig_bei_100(i), steigen: st, fallen: fa, ..Ein::default() });
        let spitze = erster_ueber(&y, 0, 0.999_999);
        let dauer_hoch = (spitze - 100 + 1) as f32 / SR;
        assert!((dauer_hoch - st).abs() / st < 0.01, "rise {dauer_hoch} s, set {st} s");
        let unten = erster_unter(&y, spitze + 1, 1e-6);
        let dauer_runter = (unten - spitze + 1) as f32 / SR;
        assert!((dauer_runter - fa).abs() / fa < 0.01, "fall {dauer_runter} s, set {fa} s");
        println!("MESS funktion linear steigen {st}: {dauer_hoch:.5} s, fallen {fa}: {dauer_runter:.5} s");
    }
}

#[test]
fn huellkurve_aus_trigger_spitze_eins_ende_einmal_steigt_passt() {
    let (st, fa) = (0.01f32, 0.05f32);
    let y = lauf(48_000, |i| Ein { trig: trig_bei_100(i), steigen: st, fallen: fa, ..Ein::default() });
    let spitze = y.iter().fold(0.0f32, |m, v| m.max(v.0));
    assert!((spitze - 1.0).abs() < 1e-6, "peak {spitze}");
    // `ende`: one pulse of 1 ms = 48 samples, right after the output has arrived at 0
    let hoch: Vec<usize> = (0..y.len()).filter(|&i| y[i].1 > 0.5).collect();
    assert_eq!(hoch.len(), 48, "the end pulse is 1 ms long");
    assert!(hoch.windows(2).all(|w| w[1] == w[0] + 1), "one pulse");
    let null = erster_unter(&y, 100 + (st * SR) as usize + 10, 0.0);
    assert!(hoch[0].abs_diff(null) <= 1, "pulse starts when the fall arrives: pulse {} arrival {null}", hoch[0]);
    // `steigt` is 1 exactly while rising after the trigger
    let steigt: Vec<usize> = (0..y.len()).filter(|&i| y[i].2 > 0.5).collect();
    assert_eq!(steigt.first().copied(), Some(100));
    let top = erster_ueber(&y, 0, 0.999_999);
    assert!(steigt.last().unwrap().abs_diff(top) <= 1, "steigt ends at the top: {} vs {top}", steigt.last().unwrap());
    assert!(steigt.windows(2).all(|w| w[1] == w[0] + 1));
    // with the output at rest and no trigger nothing happens
    assert!(y[..100].iter().all(|v| *v == (0.0, 0.0, 0.0)));
}

#[test]
fn halt_haelt_die_spitze_bis_er_faellt() {
    // halt high from sample 50 to 20000: the output rises (10 ms) and stays at 1 until 20000, then falls in 0.1 s
    let y = lauf(48_000, |i| Ein { trig: trig_bei_100(i), halt: if (50..20_000).contains(&i) { 1.0 } else { 0.0 }, steigen: 0.01, fallen: 0.1, ..Ein::default() });
    assert!(y[1000..20_000].iter().all(|v| v.0 == 1.0), "held at the top");
    assert!(y[20_000].0 > 0.99 && y[20_100].0 < y[20_000].0, "falls after halt ends");
    let unten = erster_unter(&y, 20_000, 1e-6);
    let dauer = (unten - 20_000) as f32 / SR;
    assert!((dauer - 0.1).abs() < 0.002, "fall after the hold takes {dauer} s");
    assert!(y[1000].2 == 0.0, "steigt is 0 while holding");
}

#[test]
fn slew_eines_rechtecks_mit_verschiedenen_zeiten() {
    // square 0/1, period 2 s, rise 0.1 s, fall 0.4 s: the output is a trapezoid with those slopes
    let n = 4 * 48_000;
    let y = lauf(n, |i| Ein { x: if (i / 48_000) % 2 == 0 { 1.0 } else { 0.0 }, steigen: 0.1, fallen: 0.4, ..Ein::default() });
    let hoch = erster_ueber(&y, 0, 0.999_999);
    assert!((hoch as f32 / SR - 0.1).abs() < 0.001, "up in {} s", hoch as f32 / SR);
    let runter = erster_unter(&y, 48_000, 1e-6);
    assert!(((runter - 48_000) as f32 / SR - 0.4).abs() < 0.004, "down in {} s", (runter - 48_000) as f32 / SR);
    // half way up is half the time, linear
    assert!((y[2400].0 - 0.5).abs() < 0.01);
    // x fixed at 0.3: the output settles at 0.3 from below (rising) and from above (falling)
    let y = lauf(48_000, |i| Ein { x: if i < 24_000 { 0.3 } else { 0.0 }, ..Ein::default() });
    assert!((y[23_999].0 - 0.3).abs() < 1e-6);
    assert_eq!(y[47_999].0, 0.0);
}

fn periode_aus_nulldurchgaengen(y: &[(f32, f32, f32)], von: usize) -> f64 {
    // upward crossings of 0.5, average distance
    let mut p = Vec::new();
    for i in von + 1..y.len() {
        if y[i - 1].0 < 0.5 && y[i].0 >= 0.5 {
            let a = (0.5 - y[i - 1].0 as f64) / (y[i].0 - y[i - 1].0) as f64;
            p.push(i as f64 - 1.0 + a);
        }
    }
    assert!(p.len() > 5, "found only {} cycles", p.len());
    (p[p.len() - 1] - p[0]) / (p.len() - 1) as f64
}

#[test]
fn zyklus_laeuft_frei_mit_eins_durch_steigen_plus_fallen() {
    for (st, fa) in [(0.05f32, 0.15f32), (0.013, 0.007), (0.2, 0.3)] {
        let y = lauf(10 * ((st + fa) * SR) as usize + 5000, |_| Ein { steigen: st, fallen: fa, zyklus: 1.0, ..Ein::default() });
        let f = SR as f64 / periode_aus_nulldurchgaengen(&y, 0);
        let soll = 1.0 / (st + fa) as f64;
        assert!((f - soll).abs() / soll < 0.01, "cycle {f} Hz, expected {soll} Hz");
    }
}

#[test]
fn zyklus_im_audiobereich_und_mit_tempo() {
    let y = lauf(48_000, |_| Ein { steigen: 0.0005, fallen: 0.0005, zyklus: 1.0, ..Ein::default() });
    let f = SR as f64 / periode_aus_nulldurchgaengen(&y, 0);
    assert!((f - 1000.0).abs() < 10.0, "audio-rate cycle {f} Hz");
    println!("MESS funktion audio cycle 0.5 ms + 0.5 ms: {f:.3} Hz");
    // an awkward time that is not a whole number of samples: the carried-over fraction keeps the mean frequency
    let y = lauf(96_000, |_| Ein { steigen: 0.0003, fallen: 0.00041, zyklus: 1.0, ..Ein::default() });
    let f = SR as f64 / periode_aus_nulldurchgaengen(&y, 0);
    let soll = 1.0 / 0.00071;
    assert!((f - soll).abs() / soll < 0.01, "odd cycle {f} Hz, expected {soll} Hz");
    // tempo +1 doubles the frequency, -1 halves it
    for (t, faktor) in [(1.0f32, 2.0f64), (-1.0, 0.5), (2.0, 4.0)] {
        let y = lauf(96_000, |_| Ein { steigen: 0.004, fallen: 0.006, zyklus: 1.0, tempo: t, ..Ein::default() });
        let f = SR as f64 / periode_aus_nulldurchgaengen(&y, 0);
        let soll = 100.0 * faktor;
        assert!((f - soll).abs() / soll < 0.01, "tempo {t}: {f} Hz, expected {soll} Hz");
    }
    // tempo is read per sample: a ramp from 0 to 1 octave inside one run changes the rate while running
    let y = lauf(96_000, |i| Ein { steigen: 0.004, fallen: 0.006, zyklus: 1.0, tempo: if i < 48_000 { 0.0 } else { 1.0 }, ..Ein::default() });
    let a = periode_aus_nulldurchgaengen(&y[..48_000], 0);
    let b = periode_aus_nulldurchgaengen(&y[48_000..], 0);
    assert!((a / b - 2.0).abs() < 0.03, "periods {a} and {b}");
}

/// time from 0 to `pegel` and the whole swing, in seconds, for a rise with `form`
fn anstieg(form: f32, st: f32) -> (Vec<f32>, f32) {
    let n = (st * SR * 4.0) as usize + 200;
    let y = lauf(n, |i| Ein { trig: trig_bei_100(i), steigen: st, form, ..Ein::default() });
    let aus: Vec<f32> = y.iter().map(|v| v.0).collect();
    let top = erster_ueber(&y, 0, 0.999_999);
    (aus[100..=top].to_vec(), (top - 100) as f32 / SR)
}

#[test]
fn form_minus_eins_und_plus_eins_gegen_die_vorgaben() {
    let st = 0.5f32;
    for form in [-1.0f32, -0.5, 0.0, 0.5, 1.0] {
        let (kurve, dauer) = anstieg(form, st);
        assert!(kurve.windows(2).all(|w| w[1] >= w[0]), "form {form}: monotone");
        assert!(dauer > 0.3 * st && dauer < 3.0 * st, "form {form}: swing {dauer} s against {st} s");
        let halbzeit = kurve[kurve.len() / 2];
        println!("MESS funktion form {form}: swing {dauer:.4} s, level at half time {halbzeit:.3}");
        if form < 0.0 { assert!(halbzeit > 0.55, "form {form}: fast first, level at half time {halbzeit}"); }
        if form > 0.0 { assert!(halbzeit < 0.45, "form {form}: slow first, level at half time {halbzeit}"); }
        if form == 0.0 { assert!((dauer - st).abs() / st < 0.01); }
    }
    // -1: the slope at the end is smaller than at the start (RC-like), +1 the other way round
    let slope = |k: &[f32], a: usize, b: usize| (k[b] - k[a]) / (b - a) as f32;
    let (log, _) = anstieg(-1.0, st);
    let (exp, _) = anstieg(1.0, st);
    let m = log.len();
    assert!(slope(&log, 0, 100) > 4.0 * slope(&log, m - 101, m - 1), "log: fast start, slow end");
    let m = exp.len();
    assert!(slope(&exp, m - 101, m - 1) > 4.0 * slope(&exp, 0, 100), "exp: slow start, fast end");
    // the fall has the same shape: with -1 the level after half the fall time is below 0.45
    let y = lauf(100_000, |i| Ein { trig: trig_bei_100(i), steigen: 0.001, fallen: 0.5, form: -1.0, ..Ein::default() });
    let top = erster_ueber(&y, 0, 0.999_999);
    let halb = y[top + (0.25 * SR) as usize].0;
    assert!(halb < 0.45, "log fall: level at half time {halb}");
    let unten = erster_unter(&y, top, 0.0);
    assert!(((unten - top) as f32 / SR) < 1.5, "the log fall arrives in finite time");
}

#[test]
fn neuer_trigger_waehrend_des_falls_springt_nicht() {
    let y = lauf(30_000, |i| Ein { trig: if i == 100 || i == 4000 { 1.0 } else { 0.0 }, steigen: 0.02, fallen: 0.2, ..Ein::default() });
    // trigger at 4000 hits the middle of the fall
    assert!(y[3999].0 > 0.3 && y[3999].0 < 0.99);
    let grosser_sprung = y.windows(2).map(|w| (w[1].0 - w[0].0).abs()).fold(0.0f32, f32::max);
    assert!(grosser_sprung < 0.05, "largest step between samples {grosser_sprung}");
    assert!(y[4001].0 > y[3999].0, "it rises from where it was");
    assert!(y[4001].2 > 0.5, "steigt");
    // only one end pulse: the abandoned fall does not produce one
    let pulse = y.windows(2).filter(|w| w[0].1 < 0.5 && w[1].1 > 0.5).count();
    assert_eq!(pulse, 1);
}

#[test]
fn deterministisch_und_nicht_endliche_eingaenge_lesen_ihre_vorgabe() {
    let ein = |i: usize| Ein { x: (i as f32 * 0.001).sin(), trig: trig_bei_100(i), steigen: 0.003, fallen: 0.01, form: 0.4, zyklus: if i > 3000 { 1.0 } else { 0.0 }, ..Ein::default() };
    assert_eq!(lauf(20_000, ein).iter().map(|v| v.0.to_bits()).collect::<Vec<_>>(), lauf(20_000, ein).iter().map(|v| v.0.to_bits()).collect::<Vec<_>>());
    // every input NaN or infinite: finite output, no panic
    let bos = [f32::NAN, f32::INFINITY, f32::NEG_INFINITY];
    for b in bos {
        let y = lauf(5000, |i| Ein { x: b, trig: if i % 700 == 0 { b } else { 1.0 }, halt: b, steigen: b, fallen: b, form: b, zyklus: b, tempo: b });
        assert!(y.iter().all(|v| v.0.is_finite() && v.1.is_finite() && v.2.is_finite()), "non-finite output for {b}");
    }
    // out-of-range values are clamped: the shortest time is 0.1 ms, tempo +8 does not blow up
    let y = lauf(20_000, |_| Ein { steigen: 0.0, fallen: -5.0, zyklus: 1.0, tempo: 100.0, form: 9.0, ..Ein::default() });
    assert!(y.iter().all(|v| v.0.is_finite() && (0.0..=1.0).contains(&v.0)));
}

#[test]
fn stille_bleibt_exakt_null_ohne_denormale() {
    let y = lauf(200_000, |_| Ein::default());
    assert!(y.iter().all(|v| v.0 == 0.0 && v.1 == 0.0 && v.2 == 0.0));
    // after a trigger the output returns to exactly 0 and stays there; no denormal drift
    let y = lauf(500_000, |i| Ein { trig: trig_bei_100(i), steigen: 0.001, fallen: 0.01, form: -1.0, ..Ein::default() });
    assert!(y[100_000..].iter().all(|v| v.0 == 0.0 && v.1 == 0.0 && v.2 == 0.0));
    assert!(y.iter().all(|v| v.0 == 0.0 || v.0.is_normal()));
}

#[test]
fn als_baustein_im_graphen() {
    let g = r#"{"format":"baukasten/2","name":"f","stimmen":2,"knoten":[{"id":"n","art":"note"},{"id":"f","art":"funktion","steigen":0.005,"fallen":0.05},{"id":"o","art":"ausgang"}],
        "kanten":[{"von":"n.trig","nach":"f.trig"},{"von":"f.aus","nach":"o.x"}]}"#;
    let mut p = uebersetze(g, SR).unwrap();
    p.note_an(60, 1.0);
    let y: Vec<f32> = (0..4800).map(|_| p.sample()).collect();
    let spitze = y.iter().fold(0.0f32, |m, v| m.max(*v));
    assert!(spitze > 0.9, "the envelope rises on the note trigger, peak {spitze}");
    // all three outputs are named, in this order
    let d = ARTEN.iter().find(|a| a.art == "funktion").unwrap();
    assert_eq!(d.ein, &["x", "trig", "halt", "steigen", "fallen", "form", "zyklus", "tempo"]);
    assert_eq!(d.aus, &["aus", "ende", "steigt"]);
    assert_eq!(ARTEN.iter().position(|a| a.art == "funktion"), Some(58));
}

#[test]
fn werte_ausser_bereich_werden_abgelehnt() {
    let mit = |werte: &str| format!(r#"{{"format":"baukasten/2","name":"f","stimmen":1,"knoten":[{{"id":"f","art":"funktion",{werte}}},{{"id":"o","art":"ausgang"}}],"kanten":[{{"von":"f.aus","nach":"o.x"}}]}}"#);
    for (w, name) in [(r#""steigen":0.00001"#, "steigen"), (r#""steigen":61"#, "steigen"), (r#""fallen":0"#, "fallen"), (r#""form":1.5"#, "form"), (r#""tempo":9"#, "tempo")] {
        match uebersetze(&mit(w), SR) {
            Err(Fehler::Wert { wert, .. }) => assert_eq!(wert, name, "{w}"),
            Err(e) => panic!("{w}: wrong error {e:?}"),
            Ok(_) => panic!("{w}: accepted"),
        }
    }
    assert!(uebersetze(&mit(r#""steigen":0.0001,"fallen":60,"form":-1,"tempo":-8"#), SR).is_ok());
}
