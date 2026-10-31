//! Jede Art aus ARTEN hat hier einen Minimalgraphen (Slice 4a, D8). Für jede gilt: laufen lassen, `zuruecksetzen`, dieselbe
//! Eingabe noch einmal = bitgleich mit einem frisch geladenen Programm. Eine neue Art ohne Eintrag macht
//! `jede_art_hat_einen_minimalgraphen` rot; ein vergessener Reset-Arm macht `zuruecksetzen_gleich_frisch` rot.
use baukasten_dsp::{uebersetze, Programm, ARTEN};

const SR: f32 = 48_000.0;

/// Knoten und Kanten um den Prüfling `p`. Jeder Graph hat Note, Sägezahn (Quelle mit Zustand) und Ausgang.
fn um(knoten: &str, kanten: &str) -> String {
    format!(
        r#"{{"format":"baukasten/2","name":"t","stimmen":2,"knoten":[{{"id":"n","art":"note"}},{{"id":"s","art":"saege"}},{{"id":"o","art":"ausgang"}}{knoten}],"kanten":[{{"von":"n.hz","nach":"s.hz"}}{kanten}]}}"#
    )
}

/// (Art, Graph). Der Prüfling heißt `p` und liegt zwischen Sägezahn und Ausgang, soweit er Ein- und Ausgänge hat.
fn minimalgraph(art: &str) -> Option<String> {
    let durch = |def: &str, ein: &str, aus: &str| {
        um(&format!(r#",{{"id":"p",{def}}}"#), &format!(r#",{{"von":"s.aus","nach":"p.{ein}"}},{{"von":"p.{aus}","nach":"o.x"}}"#))
    };
    Some(match art {
        "note" | "saege" | "ausgang" => um("", r#",{"von":"s.aus","nach":"o.x"}"#),
        "konst" => um(r#",{"id":"p","art":"konst","wert":0.25}"#, r#",{"von":"p.aus","nach":"o.x"},{"von":"s.aus","nach":"o.l"}"#),
        "regler" => um(r#",{"id":"p","art":"regler","nr":1,"min":0.5,"max":1},{"id":"m","art":"mul"}"#,
                       r#",{"von":"s.aus","nach":"m.a"},{"von":"p.aus","nach":"m.b"},{"von":"m.aus","nach":"o.x"}"#),
        "puls" => durch(r#""art":"puls""#, "hz", "aus").replace(r#"{"von":"s.aus","nach":"p.hz"}"#, r#"{"von":"n.hz","nach":"p.hz"}"#),
        "dreieck" => durch(r#""art":"dreieck""#, "hz", "aus").replace(r#"{"von":"s.aus","nach":"p.hz"}"#, r#"{"von":"n.hz","nach":"p.hz"}"#),
        "sinus" => durch(r#""art":"sinus""#, "hz", "aus").replace(r#"{"von":"s.aus","nach":"p.hz"}"#, r#"{"von":"n.hz","nach":"p.hz"}"#),
        "rauschen" => um(r#",{"id":"p","art":"rauschen"}"#, r#",{"von":"p.aus","nach":"o.x"}"#),
        "lfo" => um(r#",{"id":"p","art":"lfo","rate":3,"form":4},{"id":"m","art":"mul"}"#,
                    r#",{"von":"s.aus","nach":"m.a"},{"von":"p.aus","nach":"m.b"},{"von":"m.aus","nach":"o.x"}"#),
        "transponiere" => um(r#",{"id":"p","art":"transponiere","st":7},{"id":"q","art":"saege"}"#,
                             r#",{"von":"n.hz","nach":"p.hz"},{"von":"p.aus","nach":"q.hz"},{"von":"q.aus","nach":"o.x"}"#),
        "ladder" => durch(r#""art":"ladder","cutoff":800,"reso":0.5"#, "x", "aus"),
        "svf" => durch(r#""art":"svf","cutoff":800,"reso":0.5,"pole":4"#, "x", "tp"),
        "saett" => durch(r#""art":"saett","antrieb":12"#, "x", "aus"),
        "glatt" => durch(r#""art":"glatt","zeit":0.05"#, "x", "aus"),
        "adsr" => um(r#",{"id":"p","art":"adsr","a":0.05,"d":0.1,"s":0.5,"r":0.2},{"id":"m","art":"mul"}"#,
                     r#",{"von":"n.gate","nach":"p.gate"},{"von":"n.trig","nach":"p.trig"},{"von":"s.aus","nach":"m.a"},{"von":"p.aus","nach":"m.b"},{"von":"m.aus","nach":"o.x"}"#),
        "mul" => durch(r#""art":"mul","b":0.5"#, "a", "aus"),
        "add" => durch(r#""art":"add","b":0.1"#, "a", "aus"),
        "chorus" => um(r#",{"id":"p","art":"chorus","modus":2}"#, r#",{"von":"s.aus","nach":"p.x"},{"von":"p.l","nach":"o.l"},{"von":"p.r","nach":"o.r"}"#),
        "hall" => um(r#",{"id":"e","art":"adsr","a":0.01,"d":0.1,"s":1,"r":0.05},{"id":"v","art":"mul"},{"id":"p","art":"hall","mix":0.5,"rahmen":0}"#,
                     r#",{"von":"n.gate","nach":"e.gate"},{"von":"n.trig","nach":"e.trig"},{"von":"s.aus","nach":"v.a"},{"von":"e.aus","nach":"v.b"},{"von":"v.aus","nach":"p.x"},{"von":"p.l","nach":"o.l"},{"von":"p.r","nach":"o.r"}"#),
        "delay" => um(r#",{"id":"p","art":"delay","zeit":30,"fb":0.5,"mix":0.7,"pingpong":1}"#, r#",{"von":"s.aus","nach":"p.x"},{"von":"p.l","nach":"o.l"},{"von":"p.r","nach":"o.r"}"#),
        "limiter" => um(r#",{"id":"p","art":"limiter","decke":-12,"vorlauf":1}"#, r#",{"von":"s.aus","nach":"p.x"},{"von":"p.l","nach":"o.l"},{"von":"p.r","nach":"o.r"}"#),
        "gate" => um(r#",{"id":"p","art":"gate","schwelle":-20,"release":20}"#, r#",{"von":"s.aus","nach":"p.x"},{"von":"p.l","nach":"o.l"},{"von":"p.r","nach":"o.r"}"#),
        "komp" => um(r#",{"id":"p","art":"komp","schwelle":-30,"ratio":6,"schp":100}"#, r#",{"von":"s.aus","nach":"p.x"},{"von":"p.l","nach":"o.l"},{"von":"p.r","nach":"o.r"}"#),
        "leitung" => um(r#",{"id":"p","art":"leitung","zeit":3},{"id":"a","art":"add"},{"id":"m","art":"mul","b":0.7}"#,
                        r#",{"von":"s.aus","nach":"a.a"},{"von":"a.aus","nach":"p.x"},{"von":"p.aus","nach":"m.a"},{"von":"m.aus","nach":"a.b"},{"von":"a.aus","nach":"o.x"}"#),
        "eingang" => um(r#",{"id":"p","art":"eingang"}"#, r#",{"von":"p.l","nach":"o.l"},{"von":"p.r","nach":"o.r"},{"von":"s.aus","nach":"o.x"}"#),
        _ => return None,
    })
}

/// 0,3 s mit zwei Noten, 0,2 s nach dem Loslassen
fn lauf(p: &mut Programm) -> Vec<(f32, f32)> {
    p.note_an(45, 0.8);
    p.note_an(52, 0.8);
    let mut x: Vec<(f32, f32)> = (0..14_400).map(|_| p.sample_stereo()).collect();
    p.alle_aus();
    x.extend((0..9_600).map(|_| p.sample_stereo()));
    x
}

#[test]
fn jede_art_hat_einen_minimalgraphen() {
    let fehlt: Vec<&str> = ARTEN.iter().map(|a| a.art).filter(|a| minimalgraph(a).is_none()).collect();
    assert!(fehlt.is_empty(), "ohne Minimalgraph: {fehlt:?}");
}

#[test]
fn zuruecksetzen_gleich_frisch() {
    for a in ARTEN.iter().map(|a| a.art) {
        let g = minimalgraph(a).unwrap();
        if a == "hall" {
            hall_still_nach_zuruecksetzen(&g);
            continue;
        }
        let mut frisch = uebersetze(&g, SR).unwrap_or_else(|e| panic!("{a}: {e}"));
        let mut benutzt = uebersetze(&g, SR).unwrap();
        lauf(&mut benutzt);
        benutzt.zuruecksetzen();
        let (soll, ist) = (lauf(&mut frisch), lauf(&mut benutzt));
        let abweichend = soll.iter().zip(&ist).filter(|(s, i)| s.0.to_bits() != i.0.to_bits() || s.1.to_bits() != i.1.to_bits()).count();
        assert_eq!(abweichend, 0, "Art {a}: {abweichend} Samples weichen nach zuruecksetzen ab");
        assert!(soll.iter().any(|v| v.0 != 0.0), "Art {a}: Graph ist still, der Vergleich wäre blind");
    }
}

/// D6: `hall_dsp::Hall::reset` setzt Zufallszustand und Phasen der Fahnen nicht zurück, "gleich frisch" gilt für `hall`
/// nicht. Es gilt "still": nach `zuruecksetzen` ist der Rest im ersten 2048er-Fenster < 1e-4 × Energie des Schwanzes davor.
/// Plan-Review gemessen: Rest 7,5e-60 gegen Schwanz 146, ohne Reset-Arm Rest 91.
fn hall_still_nach_zuruecksetzen(g: &str) {
    let mut p = uebersetze(g, SR).unwrap();
    let x = lauf(&mut p);
    let energie = |v: &[(f32, f32)]| -> f64 { v.iter().map(|s| (s.0 as f64).powi(2) + (s.1 as f64).powi(2)).sum() };
    let schwanz = energie(&x[x.len() - 2048..]);
    p.zuruecksetzen();
    let still: Vec<(f32, f32)> = (0..2048).map(|_| p.sample_stereo()).collect();
    let rest = energie(&still);
    println!("MESS arten hall: Schwanz {schwanz:.3e}, Rest nach zuruecksetzen {rest:.3e}, Verhältnis {:.2e}", rest / schwanz);
    assert!(schwanz > 1e-3, "Art hall: Schwanz zu leise, die Prüfung wäre blind ({schwanz})");
    assert!(rest < 1e-4 * schwanz, "Art hall: nach zuruecksetzen klingt der Hall weiter: {rest} gegen Schwanz {schwanz}");
}
