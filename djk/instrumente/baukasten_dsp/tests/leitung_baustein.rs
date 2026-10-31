//! Baustein `leitung` (Slice 4f, D1–D3): Kreis durch eine Leitung erlaubt, Gesamtverzögerung genau d, gestimmte
//! Schleife (Karplus-Strong) auf 0,1 Cent, Rückkopplung unter 1 klingt ab, über 1 mit Sättigung schwingt sie weiter,
//! ohne Sättigung bleibt sie beschränkt.
use baukasten_dsp::leitung::GRENZE;
use baukasten_dsp::{uebersetze, Fehler};

const SR: f32 = 48_000.0;

fn graph(stimmen: usize, knoten: &str, kanten: &str) -> String {
    format!(r#"{{"format":"baukasten/2","name":"t","stimmen":{stimmen},"knoten":[{knoten}],"kanten":[{kanten}]}}"#)
}

/// Note an (A4 = 69), dann `n` Samples links
fn spiele(j: &str, note: u8, n: usize) -> (Vec<f32>, u32) {
    let mut p = uebersetze(j, SR).unwrap_or_else(|e| panic!("{e}"));
    p.note_an(note, 1.0);
    let x = (0..n).map(|_| p.sample_stereo().0).collect();
    (x, p.rettungen)
}

fn rms(x: &[f32]) -> f32 {
    (x.iter().map(|v| v * v).sum::<f32>() / x.len() as f32).sqrt()
}

#[test]
fn kreis_durch_eine_leitung_ist_erlaubt_durch_mul_nicht() {
    let mit = graph(1, r#"{"id":"n","art":"note"},{"id":"a","art":"add"},{"id":"d","art":"leitung","zeit":5},{"id":"o","art":"ausgang"}"#,
                    r#"{"von":"n.trig","nach":"a.a"},{"von":"a.aus","nach":"d.x"},{"von":"d.aus","nach":"a.b"},{"von":"a.aus","nach":"o.x"}"#);
    assert!(uebersetze(&mit, SR).is_ok());
    let ohne = mit.replace(r#""art":"leitung","zeit":5"#, r#""art":"mul","b":1"#).replace(r#""nach":"d.x""#, r#""nach":"d.a""#);
    assert!(matches!(uebersetze(&ohne, SR), Err(Fehler::Schleife(_))), "{:?}", uebersetze(&ohne, SR).err());
}

#[test]
fn gesamtverzoegerung_ist_genau_d() {
    // Bezug: wann kommt der Trigger ohne Leitung am Ausgang an; mit Leitung genau d Samples später
    let bezug = graph(1, r#"{"id":"n","art":"note"},{"id":"o","art":"ausgang"}"#, r#"{"von":"n.trig","nach":"o.x"}"#);
    let t0 = spiele(&bezug, 69, 100).0.iter().position(|&v| v != 0.0).expect("Trigger am Ausgang");
    for (wert, d) in [(r#""hz":48000"#, 1usize), (r#""hz":480"#, 100), (r#""zeit":10"#, 480), (r#""hz":24"#, 2000)] {
        let j = graph(1, &format!(r#"{{"id":"n","art":"note"}},{{"id":"d","art":"leitung",{wert}}},{{"id":"o","art":"ausgang"}}"#),
                      r#"{"von":"n.trig","nach":"d.x"},{"von":"d.aus","nach":"o.x"}"#);
        let x = spiele(&j, 69, 3_000).0;
        assert_eq!(x.iter().position(|&v| v != 0.0), Some(t0 + d), "{wert}");
        assert_eq!(x[t0 + d], 1.0, "{wert}");
    }
}

/// Schwerpunkt der Samples in `mitte ± halb`
fn schwerpunkt(x: &[f32], mitte: f64, halb: isize) -> f64 {
    let c = mitte.round() as isize;
    let (mut s, mut m) = (0.0f64, 0.0f64);
    for i in (c - halb)..=(c + halb) {
        s += x[i as usize] as f64;
        m += i as f64 * x[i as usize] as f64;
    }
    m / s
}

#[test]
fn gestimmte_schleife_trifft_die_note() {
    // Trigger in eine Schleife Leitung → mul 0,999 → zurück; hz von der Note: Periode sr/hz. Das k-te Echo ist k-mal durch
    // die Leitung gelaufen, ihr Schwerpunkt-Erhalt (Task 1) legt es auf k·d. Gemessen wird der Schwerpunkt des 20. Echos:
    // die parabolische Autokorrelations-Spitze einer geglätteten Impulsfolge liegt je nach Note 0,1 bis 2 Cent daneben,
    // der Baustein nicht (gemessen, Plan-Review).
    let j = graph(1, r#"{"id":"n","art":"note"},{"id":"a","art":"add"},{"id":"d","art":"leitung"},{"id":"g","art":"mul","b":0.999},{"id":"o","art":"ausgang"}"#,
                  r#"{"von":"n.trig","nach":"a.a"},{"von":"a.aus","nach":"d.x"},{"von":"n.hz","nach":"d.hz"},{"von":"d.aus","nach":"g.a"},{"von":"g.aus","nach":"a.b"},{"von":"a.aus","nach":"o.x"}"#);
    for note in [45u8, 57, 69, 81, 93] {
        let hz = 440.0 * 2f64.powf((note as f64 - 69.0) / 12.0);
        let x = spiele(&j, note, 48_000).0;
        let soll = SR as f64 / hz;
        let ist = schwerpunkt(&x, 20.0 * soll, (soll / 2.0).floor() as isize - 1) / 20.0;
        let cent = 1200.0 * (soll / ist).log2();
        println!("MESS Schleife Note {note}: Periode {ist:.5} statt {soll:.5} Samples, {cent:+.4} Cent");
        assert!(cent.abs() < 0.1, "Note {note}: {cent} Cent");
    }
}

/// Rückkopplung: Trigger → add → Leitung 5 ms → [saett 0 dB] → mul g → add
fn rueckkopplung(g: f32, saett: bool) -> String {
    let (k, e) = if saett {
        (r#",{"id":"s","art":"saett","antrieb":0}"#, r#"{"von":"d.aus","nach":"s.x"},{"von":"s.aus","nach":"m.a"}"#)
    } else {
        ("", r#"{"von":"d.aus","nach":"m.a"}"#)
    };
    graph(1, &format!(r#"{{"id":"n","art":"note"}},{{"id":"r","art":"rauschen"}},{{"id":"h","art":"adsr","a":0.001,"d":0.005,"s":0,"r":0.001}},{{"id":"b","art":"mul"}},{{"id":"a","art":"add"}},{{"id":"d","art":"leitung","zeit":5}},{{"id":"m","art":"mul","b":{g}}},{{"id":"o","art":"ausgang"}}{k}"#),
          &format!(r#"{{"von":"n.gate","nach":"h.gate"}},{{"von":"n.trig","nach":"h.trig"}},{{"von":"r.aus","nach":"b.a"}},{{"von":"h.aus","nach":"b.b"}},{{"von":"b.aus","nach":"a.a"}},{{"von":"a.aus","nach":"d.x"}},{e},{{"von":"m.aus","nach":"a.b"}},{{"von":"a.aus","nach":"o.x"}}"#))
}

#[test]
fn rueckkopplung_unter_eins_klingt_ab_ueber_eins_schwingt_weiter() {
    let (ab, r1) = spiele(&rueckkopplung(0.5, true), 69, 4 * 48_000);
    let (weiter, r2) = spiele(&rueckkopplung(1.5, true), 69, 4 * 48_000);
    let (e_ab, e_weiter) = (rms(&ab[3 * 48_000..]), rms(&weiter[3 * 48_000..]));
    let spitze = weiter.iter().fold(0.0f32, |m, v| m.max(v.abs()));
    println!("MESS Rückkopplung: g 0,5 RMS {e_ab:.3e}, g 1,5 RMS {e_weiter:.3e}, Spitze {spitze:.3}");
    assert_eq!((r1, r2), (0, 0));
    assert!(e_ab < 1e-6, "g 0,5 muss abklingen: {e_ab}");
    assert!(e_weiter > 0.05, "g 1,5 mit Sättigung muss weiterschwingen: {e_weiter}");
    assert!(spitze <= 2.5, "tanh ≤ 1, mal 1,5, plus Anregung: {spitze}");
}

#[test]
fn rueckkopplung_ueber_eins_ohne_saettigung_bleibt_beschraenkt() {
    // g 2 ohne tanh: die Leitung klemmt bei ±4, der Ausgang (add = Anregung + 2 · Leitung) bleibt unter 9
    let (x, r) = spiele(&rueckkopplung(2.0, false), 69, 2 * 48_000);
    let spitze = x.iter().fold(0.0f32, |m, v| m.max(v.abs()));
    println!("MESS Rückkopplung g 2 ohne Sättigung: Spitze {spitze:.3}");
    assert_eq!(r, 0, "kein Wächter-Eingriff");
    assert!(x.iter().all(|v| v.is_finite()), "nicht endlich");
    assert_eq!(GRENZE, 4.0, "D5: ±4");
    assert!((spitze - 2.0 * GRENZE).abs() < 0.01, "Spitze {spitze} statt {}", 2.0 * GRENZE);
}

#[test]
fn falsche_werte_werden_abgewiesen() {
    for (wert, ok) in [(r#""max":1"#, true), (r#""max":0.9"#, false), (r#""max":2000"#, true), (r#""max":2001"#, false)] {
        let j = graph(1, &format!(r#"{{"id":"n","art":"note"}},{{"id":"d","art":"leitung",{wert}}},{{"id":"o","art":"ausgang"}}"#), r#"{"von":"d.aus","nach":"o.x"}"#);
        assert_eq!(uebersetze(&j, SR).is_ok(), ok, "{wert}");
    }
}

#[test]
fn kreis_ueber_zeit_oder_hz_bleibt_fehler() {
    // nur die Kante in leitung.x gilt als verzögert (D3); läuft die Rückführung in zeit oder hz, ist der Kreis unverzögert
    for port in ["zeit", "hz"] {
        let j = graph(1, r#"{"id":"n","art":"note"},{"id":"d","art":"leitung"},{"id":"m","art":"mul","b":1},{"id":"o","art":"ausgang"}"#,
                      &format!(r#"{{"von":"n.trig","nach":"d.x"}},{{"von":"d.aus","nach":"m.a"}},{{"von":"m.aus","nach":"d.{port}"}},{{"von":"d.aus","nach":"o.x"}}"#));
        assert!(matches!(uebersetze(&j, SR), Err(Fehler::Schleife(_))), "{port}: {:?}", uebersetze(&j, SR).err());
    }
}

#[test]
fn max_begrenzt_die_gesamtverzoegerung_auf_max_plus_eins() {
    // max = 10 ms = 480 Samples ist der Ring für den Rest d − 1; die Kante in x bringt ein Sample dazu
    let j = graph(1, r#"{"id":"n","art":"note"},{"id":"d","art":"leitung","zeit":1000,"max":10},{"id":"o","art":"ausgang"}"#,
                  r#"{"von":"n.trig","nach":"d.x"},{"von":"d.aus","nach":"o.x"}"#);
    let x = spiele(&j, 69, 2_000).0;
    assert_eq!(x.iter().position(|&v| v != 0.0), Some(481));
}

#[test]
fn jede_stimme_hat_ihre_eigene_leitung() {
    // zwei Noten gleichzeitig durch die gestimmte Leitung (kein Kreis): Stimme für Stimme sr/hz später, je Schwerpunkt exakt
    let j = graph(2, r#"{"id":"n","art":"note"},{"id":"d","art":"leitung"},{"id":"o","art":"ausgang"}"#,
                  r#"{"von":"n.trig","nach":"d.x"},{"von":"n.hz","nach":"d.hz"},{"von":"d.aus","nach":"o.x"}"#);
    let mut p = uebersetze(&j, SR).unwrap();
    p.note_an(57, 1.0);
    p.note_an(69, 1.0);
    let x: Vec<f32> = (0..400).map(|_| p.sample_stereo().0).collect();
    for (note, mitte) in [(69u8, 109.0), (57, 218.0)] {
        let soll = SR as f64 / (440.0 * 2f64.powf((note as f64 - 69.0) / 12.0)) ;
        let (mut s, mut m) = (0.0f64, 0.0f64);
        for i in (mitte as usize - 40)..=(mitte as usize + 40) {
            s += x[i] as f64;
            m += i as f64 * x[i] as f64;
        }
        assert!((s - 1.0).abs() < 1e-6 && (m / s - soll).abs() < 1e-4, "Note {note}: Masse {s}, Schwerpunkt {} statt {soll}", m / s);
    }
}
