//! Baukasten block `matrix` (type 60): 16 x 16 pin matrix with two sets A/B and a morph between them.
use baukasten_dsp::{uebersetze, Fehler, Programm, ARTEN};

const SR: f32 = 48_000.0;

fn namen(praefix: &str) -> String {
    let l: Vec<String> = (0..16).map(|i| format!("\"{praefix}{i}\"")).collect();
    format!("[{}]", l.join(","))
}

/// A `matrix` node `m` with the given extra JSON fields (`,"stifte":[...]`, ...).
fn matrix_knoten(extra: &str) -> String {
    format!(r#"{{"id":"m","art":"matrix","zeilen":{},"spalten":{}{extra}}}"#, namen("z"), namen("s"))
}

/// Sine `s` (440 Hz, one voice) -> m.e1 (no `verzoegerung`: the translator delays the matrix inputs itself), m.a1 -> output.
fn graph(matrix: &str) -> String {
    format!(
        r#"{{"format":"baukasten/2","name":"t","stimmen":1,"knoten":[{{"id":"s","art":"sinus","hz":440}},{matrix},{{"id":"o","art":"ausgang"}}],"kanten":[{{"von":"s.aus","nach":"m.e1"}},{{"von":"m.a1","nach":"o.x"}}]}}"#
    )
}

fn sinus_ref() -> String {
    r#"{"format":"baukasten/2","name":"r","stimmen":1,"knoten":[{"id":"s","art":"sinus","hz":440},{"id":"o","art":"ausgang"}],"kanten":[{"von":"s.aus","nach":"o.x"}]}"#.to_string()
}

fn lauf(p: &mut Programm, n: usize) -> Vec<f32> { (0..n).map(|_| p.sample_stereo().0).collect() }

fn rms(x: &[f32]) -> f32 { (x.iter().map(|v| v * v).sum::<f32>() / x.len() as f32).sqrt() }

fn groesster_schritt(x: &[f32]) -> f32 { x.windows(2).map(|w| (w[1] - w[0]).abs()).fold(0.0, f32::max) }

#[test]
fn arten_eintrag_ist_typ_60() {
    assert_eq!(ARTEN.iter().position(|a| a.art == "matrix"), Some(60), "matrix is type 60 and must not move");
    assert!(ARTEN.len() >= 61, "ARTEN only grows at the end");
    let d = ARTEN.iter().find(|a| a.art == "matrix").unwrap();
    assert_eq!(d.ein.len(), 17);
    assert_eq!(d.aus.len(), 16);
    assert_eq!((d.ein[0], d.ein[15], d.ein[16]), ("e1", "e16", "morph"));
    assert_eq!((d.aus[0], d.aus[15]), ("a1", "a16"));
    assert_eq!(d.frei, &[("morph", 0.0)]);
}

#[test]
fn ohne_stift_still() {
    let mut p = uebersetze(&graph(&matrix_knoten("")), SR).unwrap();
    assert!(p.hat_matrix());
    let y = lauf(&mut p, 4800);
    assert!(y.iter().all(|v| *v == 0.0), "no pin: silence");
    assert_eq!(p.aktive_stifte(), 0);
}

#[test]
fn stift_leitet() {
    let mut p = uebersetze(&graph(&matrix_knoten("")), SR).unwrap();
    let mut r = uebersetze(&sinus_ref(), SR).unwrap();
    assert!(p.stift_sofort(0, 0, 0, 1.0));
    let y = lauf(&mut p, 4800);
    let x = lauf(&mut r, 4800);
    assert!(x.iter().any(|v| v.abs() > 0.5), "reference sine runs");
    for i in 1..4800 {
        assert!((y[i] - x[i - 1]).abs() < 1e-6, "sample {i}: {} vs {}", y[i], x[i - 1]);
    }
    assert_eq!(p.stift(0, 0, 0), Some(1.0));
}

#[test]
fn morph_mischt() {
    let g = format!(
        r#"{{"format":"baukasten/2","name":"t","stimmen":1,"knoten":[{{"id":"s","art":"sinus","hz":440}},{{"id":"c","art":"konst","wert":0.5}},{},{{"id":"o","art":"ausgang"}}],"kanten":[{{"von":"s.aus","nach":"m.e1"}},{{"von":"c.aus","nach":"m.morph"}},{{"von":"m.a1","nach":"o.x"}}]}}"#,
        matrix_knoten("")
    );
    let mut p = uebersetze(&g, SR).unwrap();
    let mut r = uebersetze(&sinus_ref(), SR).unwrap();
    assert!(p.stift_sofort(0, 0, 0, 1.0));
    assert!(p.stift_sofort(1, 0, 0, 0.5));
    let y = lauf(&mut p, 4800);
    let x = lauf(&mut r, 4800);
    for i in 1..4800 {
        assert!((y[i] - 0.75 * x[i - 1]).abs() < 1e-4, "sample {i}: {} vs {}", y[i], 0.75 * x[i - 1]);
    }
}

#[test]
fn stift_ohne_klick() {
    // reference: the steady sine at the end gain 1.0
    let mut ref_p = uebersetze(&graph(&matrix_knoten("")), SR).unwrap();
    assert!(ref_p.stift_sofort(0, 0, 0, 1.0));
    lauf(&mut ref_p, 4800);
    let stetig = lauf(&mut ref_p, 9600);
    let (stetig_schritt, stetig_rms) = (groesster_schritt(&stetig), rms(&stetig));
    // pin from 0.5 to 1.0 while the sine plays
    let mut p = uebersetze(&graph(&matrix_knoten("")), SR).unwrap();
    assert!(p.stift_sofort(0, 0, 0, 0.5));
    lauf(&mut p, 4800);
    assert!(p.stift_setzen(0, 0, 0, 1.0));
    let wechsel = lauf(&mut p, 2400);
    assert!(groesster_schritt(&wechsel) <= 1.1 * stetig_schritt, "step {} vs steady {}", groesster_schritt(&wechsel), stetig_schritt);
    let nach = lauf(&mut p, 2400); // 50 ms to 100 ms after the change
    let db = 20.0 * (rms(&nach) / stetig_rms).log10();
    assert!(db.abs() < 1.0, "RMS 50 ms later is {db} dB from the steady level");
    println!("MESS stift_ohne_klick: max step {} (steady {}), RMS {db:.3} dB", groesster_schritt(&wechsel), stetig_schritt);
}

#[test]
fn selbstpatch_kein_kreisfehler() {
    // a1 -> sinus.hz (same sample), sinus.aus -> e1 (delayed by the translator)
    let g = format!(
        r#"{{"format":"baukasten/2","name":"t","stimmen":1,"knoten":[{{"id":"s","art":"sinus","hz":440}},{},{{"id":"o","art":"ausgang"}}],"kanten":[{{"von":"s.aus","nach":"m.e1"}},{{"von":"m.a1","nach":"s.hz"}},{{"von":"s.aus","nach":"o.x"}}]}}"#,
        matrix_knoten(r#","stifte":[[0,0,0,0.5]]"#)
    );
    let mut p = uebersetze(&g, SR).expect("no cycle error");
    let y = lauf(&mut p, 48_000);
    assert!(y.iter().all(|v| v.is_finite()));
    assert_eq!(p.rettungen, 0);
}

fn fehler(g: &str) -> String {
    match uebersetze(g, SR) {
        Err(Fehler::Wert { wert, grund, .. }) => format!("{wert}: {grund}"),
        Err(Fehler::FehlenderWert { wert, .. }) => format!("{wert}: missing"),
        Err(e) => format!("other error {e:?}"),
        Ok(_) => "accepted".to_string(),
    }
}

fn mit_labels(z: &str, s: &str, extra: &str) -> String {
    graph(&format!(r#"{{"id":"m","art":"matrix","zeilen":{z},"spalten":{s}{extra}}}"#))
}

fn liste(f: impl Fn(usize) -> String) -> String { format!("[{}]", (0..16).map(|i| format!("\"{}\"", f(i))).collect::<Vec<_>>().join(",")) }

#[test]
fn pruefung() {
    assert!(uebersetze(&graph(&matrix_knoten(r#","stifte":[[0,0,0,0.5],[1,15,15,-1]]"#)), SR).is_ok());
    // labels
    let z17 = format!("[{}]", (0..17).map(|i| format!("\"l{i}\"")).collect::<Vec<_>>().join(","));
    assert!(fehler(&mit_labels(&z17, &namen("s"), "")).starts_with("zeilen"), "17 labels");
    assert!(fehler(&mit_labels(&liste(|i| if i == 3 { String::new() } else { format!("l{i}") }), &namen("s"), "")).starts_with("zeilen"), "empty label");
    assert!(fehler(&mit_labels(&namen("z"), &liste(|i| if i == 3 { "12345678901234567".into() } else { format!("l{i}") }), "")).starts_with("spalten"), "17 characters");
    assert!(fehler(&mit_labels(&liste(|i| if i == 5 { "l2".into() } else { format!("l{i}") }), &namen("s"), "")).starts_with("zeilen"), "duplicate label");
    assert!(fehler(&mit_labels(&namen("z"), &liste(|i| if i == 1 { "a\\u0007b".into() } else { format!("l{i}") }), "")).starts_with("spalten"), "control character");
    // required labels
    let ohne = r#"{"format":"baukasten/2","name":"t","stimmen":1,"knoten":[{"id":"m","art":"matrix"},{"id":"o","art":"ausgang"}],"kanten":[]}"#;
    assert!(fehler(ohne).starts_with("zeilen"), "zeilen is required: {}", fehler(ohne));
    // pins
    for (stifte, name) in [
        (r#"[[2,0,0,0.5]]"#, "satz 2"),
        (r#"[[0,16,0,0.5]]"#, "zeile 16"),
        (r#"[[0,0,16,0.5]]"#, "spalte 16"),
        (r#"[[0,0,0,1.5]]"#, "wert 1.5"),
        (r#"[[0,0,0,-1.5]]"#, "wert -1.5"),
        (r#"[[0,0,0,1e30]]"#, "huge wert"),
        (r#"[[0,0,0,0.5],[0,0,0,0.25]]"#, "duplicate position"),
        (r#"[[0,0,0]]"#, "short entry"),
        (r#"[[0,0.5,0,0.5]]"#, "fractional index"),
        (r#"[[-1,0,0,0.5]]"#, "negative satz"),
    ] {
        let f = fehler(&graph(&matrix_knoten(&format!(r#","stifte":{stifte}"#))));
        // a malformed entry is already refused when the JSON is read (serde), every other one by the pin rules
        assert!(f.starts_with("stifte") || (name == "short entry" && f.contains("Format")), "{name}: {f}");
    }
    // more than 512 entries
    let viele: Vec<String> = (0..513).map(|i| format!("[{},{},{},0.5]", (i / 256) % 2, (i / 16) % 16, i % 16)).collect();
    assert!(fehler(&graph(&matrix_knoten(&format!(r#","stifte":[{}]"#, viele.join(","))))).starts_with("stifte"));
    // fields on another art
    let saege = r#"{"format":"baukasten/2","name":"t","stimmen":1,"knoten":[{"id":"s","art":"saege","zeilen":["a"]},{"id":"o","art":"ausgang"}],"kanten":[]}"#;
    assert!(fehler(saege).starts_with("zeilen"), "{}", fehler(saege));
    let saege = r#"{"format":"baukasten/2","name":"t","stimmen":1,"knoten":[{"id":"s","art":"saege","stifte":[[0,0,0,1]]},{"id":"o","art":"ausgang"}],"kanten":[]}"#;
    assert!(fehler(saege).starts_with("stifte"));
    let saege = r#"{"format":"baukasten/2","name":"t","stimmen":1,"knoten":[{"id":"s","art":"saege","spalten":["a"]},{"id":"o","art":"ausgang"}],"kanten":[]}"#;
    assert!(fehler(saege).starts_with("spalten"));
    // two matrix nodes
    let zwei = format!(
        r#"{{"format":"baukasten/2","name":"t","stimmen":1,"knoten":[{},{},{{"id":"o","art":"ausgang"}}],"kanten":[]}}"#,
        matrix_knoten(""),
        matrix_knoten("").replace("\"m\"", "\"m2\"")
    );
    assert!(fehler(&zwei).starts_with("art"), "{}", fehler(&zwei));
    // matrix fields in a macro: on an instance and inside the definition
    let inst = r#"{"format":"baukasten/2","name":"t","stimmen":1,"makros":{"mk":{"knoten":[{"id":"k","art":"konst","wert":1}],"aus":{"x":"k.aus"}}},"knoten":[{"id":"i","art":"makro:mk","stifte":[[0,0,0,1]]},{"id":"o","art":"ausgang"}],"kanten":[{"von":"i.x","nach":"o.x"}]}"#;
    assert!(fehler(inst).starts_with("stifte"), "{}", fehler(inst));
    let inst = r#"{"format":"baukasten/2","name":"t","stimmen":1,"makros":{"mk":{"knoten":[{"id":"k","art":"konst","wert":1}],"aus":{"x":"k.aus"}}},"knoten":[{"id":"i","art":"makro:mk","zeilen":["a"]},{"id":"o","art":"ausgang"}],"kanten":[{"von":"i.x","nach":"o.x"}]}"#;
    assert!(fehler(inst).starts_with("zeilen"), "{}", fehler(inst));
    let innen = format!(
        r#"{{"format":"baukasten/2","name":"t","stimmen":1,"makros":{{"mk":{{"knoten":[{}]}}}},"knoten":[{{"id":"i","art":"makro:mk"}},{{"id":"o","art":"ausgang"}}],"kanten":[]}}"#,
        matrix_knoten("")
    );
    assert!(fehler(&innen).starts_with("zeilen"), "{}", fehler(&innen));
    let innen = r#"{"format":"baukasten/2","name":"t","stimmen":1,"makros":{"mk":{"knoten":[{"id":"k","art":"konst","wert":1,"stifte":[[0,0,0,1]]}]}},"knoten":[{"id":"i","art":"makro:mk"},{"id":"o","art":"ausgang"}],"kanten":[]}"#;
    assert!(fehler(innen).starts_with("stifte"), "{}", fehler(innen));
}

#[test]
fn zuruecksetzen_behaelt_stifte() {
    let mut p = uebersetze(&graph(&matrix_knoten(r#","stifte":[[0,0,0,0.25]]"#)), SR).unwrap();
    assert_eq!(p.stift(0, 0, 0), Some(0.25));
    assert!(p.stift_setzen(0, 0, 0, 0.9));
    assert!(p.stift_setzen(0, 3, 4, -0.5));
    lauf(&mut p, 100); // a glide is running
    p.zuruecksetzen();
    assert_eq!(p.stift(0, 0, 0), Some(0.9));
    assert_eq!(p.stift(0, 3, 4), Some(-0.5));
    // the state jumped to the target: from the first sample the gain is the full 0.9
    let mut r = uebersetze(&sinus_ref(), SR).unwrap();
    let y = lauf(&mut p, 2000);
    let x = lauf(&mut r, 2000);
    for i in 1..2000 {
        assert!((y[i] - 0.9 * x[i - 1]).abs() < 1e-5, "sample {i}: {} vs {}", y[i], 0.9 * x[i - 1]);
    }
}

#[test]
fn grund_und_grenzen_der_api() {
    let mut p = uebersetze(&graph(&matrix_knoten(r#","stifte":[[0,2,3,0.5],[1,0,0,-0.25]]"#)), SR).unwrap();
    assert_eq!(p.stift(0, 2, 3), Some(0.5));
    assert_eq!(p.stift(1, 0, 0), Some(-0.25));
    assert_eq!(p.stift(0, 0, 0), Some(0.0));
    assert_eq!(p.stift(2, 0, 0), None);
    assert_eq!(p.stift(0, 16, 0), None);
    assert_eq!(p.stift(0, 0, 16), None);
    assert!(!p.stift_setzen(2, 0, 0, 0.5));
    assert!(!p.stift_setzen(0, 16, 0, 0.5));
    assert!(!p.stift_setzen(0, 0, 16, 0.5));
    assert!(!p.stift_setzen(0, 0, 0, f32::NAN));
    assert!(!p.stift_sofort(0, 0, 0, f32::NAN));
    assert!(p.stift_sofort(0, 0, 0, 7.0));
    assert_eq!(p.stift(0, 0, 0), Some(1.0), "clamped");
    assert!(p.stift_sofort(0, 0, 0, -7.0));
    assert_eq!(p.stift(0, 0, 0), Some(-1.0));
    // all weights to zero, then back to the graph's pins
    assert!(p.stifte_grund(false, true));
    assert_eq!(p.stift(0, 2, 3), Some(0.0));
    assert_eq!(p.stift(0, 0, 0), Some(0.0));
    assert_eq!(p.aktive_stifte(), 0);
    assert!(p.stifte_grund(true, true));
    assert_eq!(p.stift(0, 2, 3), Some(0.5));
    assert_eq!(p.stift(1, 0, 0), Some(-0.25));
    assert_eq!(p.aktive_stifte(), 2);
    // smoothed: back to zero leaves the list only after the glide
    assert!(p.stifte_grund(false, false));
    assert_eq!(p.stift(0, 2, 3), Some(0.0));
    lauf(&mut p, 48_000);
    assert_eq!(p.aktive_stifte(), 0);
    // a graph without a matrix
    let mut r = uebersetze(&sinus_ref(), SR).unwrap();
    assert!(!r.hat_matrix());
    assert!(!r.stift_setzen(0, 0, 0, 0.5));
    assert!(!r.stift_sofort(0, 0, 0, 0.5));
    assert!(!r.stifte_grund(true, true));
    assert_eq!(r.stift(0, 0, 0), None);
    assert_eq!(r.aktive_stifte(), 0);
}

#[test]
fn entfernte_stifte_verlassen_liste() {
    let mut p = uebersetze(&graph(&matrix_knoten("")), SR).unwrap();
    let positionen: Vec<(usize, usize, usize)> = (0..24).map(|z| (z % 2, z / 6, z % 6)).collect();
    for (z, &(satz, zeile, spalte)) in positionen.iter().enumerate() {
        assert!(p.stift_setzen(satz, zeile, spalte, 0.1 + 0.03 * z as f32));
    }
    lauf(&mut p, 4800);
    assert!(p.aktive_stifte() >= 12, "pins listed: {}", p.aktive_stifte());
    for &(satz, zeile, spalte) in &positionen {
        assert!(p.stift_setzen(satz, zeile, spalte, 0.0));
    }
    lauf(&mut p, 48_000);
    assert_eq!(p.aktive_stifte(), 0, "the active list is empty after the glide");
    // the state is exactly 0: the output is exactly silent
    assert!(lauf(&mut p, 1000).iter().all(|v| *v == 0.0));
}

/// Cost in us per 256-sample block at 4 voices: 0 pins, 24 pins, 24 pins set and removed. Run with `--ignored --nocapture`.
#[test]
#[ignore]
fn kosten_folgt_stiften() {
    let g = |extra: &str| {
        let z: Vec<String> = (1..=16).map(|i| format!(r#"{{"von":"s.aus","nach":"m.e{i}"}}"#)).collect();
        format!(
            r#"{{"format":"baukasten/2","name":"t","stimmen":4,"knoten":[{{"id":"s","art":"sinus","hz":220}},{},{{"id":"o","art":"ausgang"}}],"kanten":[{},{{"von":"m.a1","nach":"o.x"}}]}}"#,
            matrix_knoten(extra),
            z.join(",")
        )
    };
    let mess = |p: &mut Programm| -> f64 {
        for _ in 0..200 * 256 { p.sample_stereo(); }
        let mut t: Vec<f64> = (0..400).map(|_| {
            let t0 = std::time::Instant::now();
            for _ in 0..256 { std::hint::black_box(p.sample_stereo()); }
            t0.elapsed().as_secs_f64() * 1e6
        }).collect();
        t.sort_by(|a, b| a.partial_cmp(b).unwrap());
        // the fastest block: the machine is shared, the median moves by more than the 5 % this test looks for
        t[0]
    };
    let mut leer = uebersetze(&g(""), SR).unwrap();
    let positionen: Vec<(usize, usize, usize)> = (0..24).map(|i| (i % 2, (i / 2) % 12, i % 16)).collect();
    let pins: Vec<String> = positionen.iter().enumerate().map(|(i, p)| format!("[{},{},{},{}]", p.0, p.1, p.2, 0.2 + 0.02 * i as f32)).collect();
    let mut voll = uebersetze(&g(&format!(r#","stifte":[{}]"#, pins.join(","))), SR).unwrap();
    let mut weg = uebersetze(&g(&format!(r#","stifte":[{}]"#, pins.join(","))), SR).unwrap();
    for &(a, b, c) in &positionen { weg.stift_setzen(a, b, c, 0.0); }
    let (a, b) = (mess(&mut leer), mess(&mut voll));
    let c = mess(&mut weg);
    println!("MESS matrix 4 voices, us per 256-sample block (fastest of 400): 0 pins {a:.2}, 24 pins {b:.2}, 24 pins set then removed {c:.2}");
    assert_eq!(weg.aktive_stifte(), 0);
    assert!((c - a).abs() <= 0.05 * a.max(1.0) + 0.3, "removed case {c} vs 0 pins {a}");
}
