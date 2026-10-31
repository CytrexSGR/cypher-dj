//! Klang des Beispielgraphen und Semantik der Verzögerungskante. Jede Messung hat eine Gegenprobe.
use baukasten_dsp::uebersetze;

const SR: f32 = 48_000.0;
const BEISPIEL: &str = include_str!("../beispiele/saege-ladder.json");

fn rms_db(x: &[f32]) -> f32 {
    let r = (x.iter().map(|v| v * v).sum::<f32>() / x.len() as f32).sqrt();
    20.0 * r.max(1e-9).log10()
}

/// Grundfrequenz über steigende Nulldurchgänge (wie rb_dsp/tests/messen.rs).
fn grundfrequenz(x: &[f32]) -> f32 {
    let mittel = x.iter().sum::<f32>() / x.len() as f32;
    let (mut erste, mut letzte, mut n) = (None, 0usize, 0usize);
    for i in 1..x.len() {
        if x[i - 1] - mittel < 0.0 && x[i] - mittel >= 0.0 {
            if erste.is_none() { erste = Some(i); } else { n += 1; letzte = i; }
        }
    }
    match erste { Some(e) if n > 0 => n as f32 * SR / (letzte - e) as f32, _ => 0.0 }
}

fn spiele(n: usize, p: &mut baukasten_dsp::Programm) -> Vec<f32> { (0..n).map(|_| p.sample()).collect() }

#[test]
fn ohne_note_exakt_still() {
    let mut p = uebersetze(BEISPIEL, SR).unwrap();
    assert!(spiele(48_000, &mut p).iter().all(|v| *v == 0.0));
}

#[test]
fn note_45_klingt_mit_110_hz() {
    let mut p = uebersetze(BEISPIEL, SR).unwrap();
    p.note_an(45, 0.8);
    let x = spiele(48_000, &mut p);
    let f = grundfrequenz(&x[4800..]);
    assert!((f - 110.0).abs() < 1.0, "f0 {f}");
    assert!(rms_db(&x[4800..]) > -40.0, "pegel {}", rms_db(&x[4800..]));
}

#[test]
fn note_aus_klingt_ab() {
    let mut p = uebersetze(BEISPIEL, SR).unwrap();
    p.note_an(45, 0.8);
    spiele(24_000, &mut p);
    p.note_aus(45);
    let x = spiele(48_000, &mut p);
    assert!(rms_db(&x[..4800]) > -50.0, "Gegenprobe: direkt nach note_aus klingt es noch");
    assert!(rms_db(&x[38_400..]) < -100.0, "nach 0,8 s (r = 0,3 s bis −60 dB) still: {}", rms_db(&x[38_400..]));
}

#[test]
fn bitgleich_bei_zweimal_uebersetzen() {
    let lauf = || {
        let mut p = uebersetze(BEISPIEL, SR).unwrap();
        let mut x = Vec::new();
        for (i, note) in [45u8, 52, 57, 60].iter().enumerate() {
            p.note_an(*note, 0.5 + i as f32 * 0.1);
            x.extend(spiele(6000, &mut p));
        }
        p.alle_aus();
        x.extend(spiele(6000, &mut p));
        x
    };
    let (a, b) = (lauf(), lauf());
    assert!(a.iter().zip(&b).all(|(x, y)| x.to_bits() == y.to_bits()));
}

#[test]
fn stimmenklau_bleibt_endlich_und_klingt() {
    let mut p = uebersetze(BEISPIEL, SR).unwrap();
    for note in 40..52u8 { p.note_an(note, 0.9); } // 12 Noten auf 8 Stimmen
    let x = spiele(24_000, &mut p);
    assert!(x.iter().all(|v| v.is_finite()));
    assert!(rms_db(&x) > -40.0);
}

#[test]
fn zuruecksetzen_macht_still() {
    let mut p = uebersetze(BEISPIEL, SR).unwrap();
    p.note_an(45, 0.8);
    spiele(4800, &mut p);
    p.zuruecksetzen();
    assert!(spiele(4800, &mut p).iter().all(|v| *v == 0.0));
}

#[test]
fn verzoegerungskante_liest_das_vorige_sample() {
    // Zähler: s = 1 + s(vorher) → 1, 2, 3, …; ohne Verzögerung wäre es ein Kreis (tests/pruefung.rs)
    let j = r#"{"format":"baukasten/1","name":"zaehler","stimmen":1,
        "knoten":[{"id":"k","art":"konst","wert":1},{"id":"s","art":"add"},{"id":"o","art":"ausgang"}],
        "kanten":[{"von":"k.aus","nach":"s.a"},{"von":"s.aus","nach":"s.b","verzoegerung":1},{"von":"s.aus","nach":"o.x"}]}"#;
    let mut p = uebersetze(j, SR).unwrap();
    assert_eq!(spiele(5, &mut p), vec![1.0, 2.0, 3.0, 4.0, 5.0]);
}

#[test]
fn resonanz_jedes_sample_umgeschaltet_bleibt_beschraenkt() {
    // McClellan, DAFx26: k[n] = 0, 2,89, 0, 2,89 … lässt eine Ladder ohne Glättung wachsen. Hier kommt die Resonanz
    // über einen Kreis mit Verzögerung, der jedes Sample zwischen 0 und 0,75 (k = 3) kippt; die Glättung (5 ms) fängt das.
    let j = r#"{"format":"baukasten/1","name":"kipp","stimmen":1,
        "knoten":[{"id":"note","art":"note"},{"id":"osz","art":"saege"},{"id":"eins","art":"konst","wert":0.75},
                  {"id":"minus","art":"konst","wert":-1},{"id":"neg","art":"mul"},{"id":"kipp","art":"add"},
                  {"id":"cut","art":"konst","wert":2000},{"id":"f","art":"ladder"},{"id":"o","art":"ausgang"}],
        "kanten":[{"von":"note.hz","nach":"osz.hz"},{"von":"osz.aus","nach":"f.x"},{"von":"cut.aus","nach":"f.cutoff"},
                  {"von":"kipp.aus","nach":"neg.a","verzoegerung":1},{"von":"minus.aus","nach":"neg.b"},
                  {"von":"neg.aus","nach":"kipp.a"},{"von":"eins.aus","nach":"kipp.b"},
                  {"von":"kipp.aus","nach":"f.reso"},{"von":"f.aus","nach":"o.x"}]}"#;
    // kipp(n) = 0,75 − kipp(n−1): 0,75, 0, 0,75, 0, … (Gegenprobe unten)
    let mut p = uebersetze(j, SR).unwrap();
    p.note_an(45, 1.0);
    let x = spiele(96_000, &mut p);
    assert!(x.iter().all(|v| v.is_finite() && v.abs() < 4.0), "max {}", x.iter().fold(0f32, |m, v| m.max(v.abs())));
    // Die Glättung macht aus dem Kippen den Mittelwert 0,375: gleicher Klang wie feste Resonanz 0,375.
    // (Gemessen 2026-10-28: mit Glättung 0,0 dB / −96 dB; ohne Glättung bleibt sie beschränkt, liegt hier aber bei 0,5 dB / −24 dB.)
    let fest = j.replace(r#"{"von":"kipp.aus","nach":"f.reso"}"#, r#"{"von":"mitte.aus","nach":"f.reso"}"#)
        .replace(r#"{"id":"o","art":"ausgang"}"#, r#"{"id":"o","art":"ausgang"},{"id":"mitte","art":"konst","wert":0.375}"#);
    let mut r = uebersetze(&fest, SR).unwrap();
    r.note_an(45, 1.0);
    let y = spiele(96_000, &mut r);
    let abw = (rms_db(&x[48_000..]) - rms_db(&y[48_000..])).abs();
    let diff: Vec<f32> = x[48_000..].iter().zip(&y[48_000..]).map(|(a, b)| a - b).collect();
    let rest = rms_db(&diff) - rms_db(&y[48_000..]);
    assert!(abw < 0.1 && rest < -60.0, "Pegelabweichung {abw} dB, Differenzsignal {rest} dB unter dem Signal");
    let gegen = j.replace(r#"{"von":"kipp.aus","nach":"f.reso"},{"von":"f.aus","nach":"o.x"}"#, r#"{"von":"kipp.aus","nach":"o.x"}"#);
    let mut q = uebersetze(&gegen, SR).unwrap();
    assert_eq!(spiele(4, &mut q), vec![0.75, 0.0, 0.75, 0.0], "Gegenprobe: das Signal kippt wirklich jedes Sample");
}
