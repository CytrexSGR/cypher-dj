//! Makros (Spec E24): Auflösung beim Laden, bitgleich mit dem von Hand flach geschriebenen Graphen, und die Prüfungen.
use baukasten_dsp::{uebersetze, Fehler};

const SR: f32 = 48_000.0;

/// Zwei verstimmte Sägen als Makro `paar`, zweimal eingesetzt (Grundton und Quinte), Werte innen und am Eingang gesetzt.
const MIT_MAKRO: &str = r#"{"format":"baukasten/2","name":"m","stimmen":2,
 "makros":{"paar":{
   "ein":{"hz":["o1.hz","t.hz"],"verstimmung":"t.cent"},
   "aus":{"aus":"mix.aus"},
   "knoten":[{"id":"o1","art":"saege"},{"id":"t","art":"transponiere"},{"id":"o2","art":"saege"},{"id":"mix","art":"add"}],
   "kanten":[{"von":"t.aus","nach":"o2.hz"},{"von":"o1.aus","nach":"mix.a"},{"von":"o2.aus","nach":"mix.b"}]}},
 "knoten":[{"id":"n","art":"note"},{"id":"q","art":"transponiere","st":7},
   {"id":"grund","art":"makro:paar","verstimmung":9},{"id":"quinte","art":"makro:paar","t.cent":-5},
   {"id":"s","art":"add"},{"id":"a","art":"ausgang"}],
 "kanten":[{"von":"n.hz","nach":"grund.hz"},{"von":"n.hz","nach":"q.hz"},{"von":"q.aus","nach":"quinte.hz"},
   {"von":"grund.aus","nach":"s.a"},{"von":"quinte.aus","nach":"s.b"},{"von":"s.aus","nach":"a.x"}]}"#;

/// Derselbe Klang von Hand flach geschrieben, andere IDs.
const FLACH: &str = r#"{"format":"baukasten/2","name":"f","stimmen":2,
 "knoten":[{"id":"n","art":"note"},{"id":"q","art":"transponiere","st":7},
   {"id":"g1","art":"saege"},{"id":"gt","art":"transponiere","cent":9},{"id":"g2","art":"saege"},{"id":"gm","art":"add"},
   {"id":"q1","art":"saege"},{"id":"qt","art":"transponiere","cent":-5},{"id":"q2","art":"saege"},{"id":"qm","art":"add"},
   {"id":"s","art":"add"},{"id":"a","art":"ausgang"}],
 "kanten":[{"von":"n.hz","nach":"g1.hz"},{"von":"n.hz","nach":"gt.hz"},{"von":"gt.aus","nach":"g2.hz"},
   {"von":"g1.aus","nach":"gm.a"},{"von":"g2.aus","nach":"gm.b"},
   {"von":"n.hz","nach":"q.hz"},{"von":"q.aus","nach":"q1.hz"},{"von":"q.aus","nach":"qt.hz"},{"von":"qt.aus","nach":"q2.hz"},
   {"von":"q1.aus","nach":"qm.a"},{"von":"q2.aus","nach":"qm.b"},
   {"von":"gm.aus","nach":"s.a"},{"von":"qm.aus","nach":"s.b"},{"von":"s.aus","nach":"a.x"}]}"#;

fn klang(j: &str) -> Vec<f32> {
    let mut p = uebersetze(j, SR).unwrap_or_else(|e| panic!("{e}"));
    p.note_an(45, 1.0);
    p.note_an(52, 1.0);
    (0..24_000).map(|_| p.sample()).collect()
}

#[test]
fn makro_bitgleich_mit_flach() {
    let (m, f) = (klang(MIT_MAKRO), klang(FLACH));
    assert!(m.iter().any(|v| *v != 0.0));
    assert_eq!(m, f);
    // Gegenprobe: ein anderer Wert am Makro-Eingang ändert den Klang
    assert_ne!(klang(&MIT_MAKRO.replace(r#""verstimmung":9"#, r#""verstimmung":3"#)), f);
}

fn fehler(j: &str) -> Fehler { uebersetze(j, SR).err().expect("muss abgewiesen werden") }

#[test]
fn makro_pruefungen() {
    let unbekannt = MIT_MAKRO.replace(r#""art":"makro:paar","verstimmung""#, r#""art":"makro:trio","verstimmung""#);
    assert!(matches!(fehler(&unbekannt), Fehler::UnbekannterMakro { ref makro, .. } if makro == "trio"));
    let note_innen = MIT_MAKRO.replace(r#"{"id":"o1","art":"saege"}"#, r#"{"id":"o1","art":"note"}"#);
    assert!(matches!(fehler(&note_innen), Fehler::MakroInhalt { ref art, .. } if art == "note"));
    let verschachtelt = MIT_MAKRO.replace(r#"{"id":"o1","art":"saege"}"#, r#"{"id":"o1","art":"makro:paar"}"#);
    assert!(matches!(fehler(&verschachtelt), Fehler::MakroInhalt { .. }));
    let falscher_eingang = MIT_MAKRO.replace(r#""nach":"grund.hz""#, r#""nach":"grund.tonhoehe""#);
    assert!(matches!(fehler(&falscher_eingang), Fehler::UnbekannterPort(p) if p == "grund.tonhoehe"));
    let falscher_ausgang = MIT_MAKRO.replace(r#""von":"grund.aus""#, r#""von":"grund.links""#);
    assert!(matches!(fehler(&falscher_ausgang), Fehler::UnbekannterPort(p) if p == "grund.links"));
    let falsches_innenziel = MIT_MAKRO.replace(r#""aus":{"aus":"mix.aus"}"#, r#""aus":{"aus":"mixer.aus"}"#);
    assert!(matches!(fehler(&falsches_innenziel), Fehler::UnbekannterKnoten(_)));
    let ausgang_innen = MIT_MAKRO.replace(r#"{"id":"o1","art":"saege"}"#, r#"{"id":"o1","art":"ausgang"}"#);
    assert!(matches!(fehler(&ausgang_innen), Fehler::MakroInhalt { ref art, .. } if art == "ausgang"));
    let eingang_innen = MIT_MAKRO.replace(r#"{"id":"o1","art":"saege"}"#, r#"{"id":"o1","art":"eingang"}"#);
    assert!(matches!(fehler(&eingang_innen), Fehler::MakroInhalt { ref art, .. } if art == "eingang"));
    let id_innen = MIT_MAKRO.replace(r#"{"id":"o1","art":"saege"}"#, r#"{"id":"o/1","art":"saege"}"#);
    assert!(matches!(fehler(&id_innen), Fehler::Id(ref i) if i.contains("o/1")));
    // ein- und aus-Ports, die keine Kante benutzt, werden trotzdem geprüft
    let ein_leer = MIT_MAKRO.replace(r#""verstimmung":"t.cent"}"#, r#""verstimmung":"t.cent","leer":"nix.hz"}"#);
    assert!(matches!(fehler(&ein_leer), Fehler::UnbekannterKnoten(ref k) if k.contains("nix")));
    let aus_leer = MIT_MAKRO.replace(r#""aus":{"aus":"mix.aus"}"#, r#""aus":{"aus":"mix.aus","leer":"nix.aus"}"#);
    assert!(matches!(fehler(&aus_leer), Fehler::UnbekannterKnoten(ref k) if k.contains("nix")));
    let falscher_wert = MIT_MAKRO.replace(r#""t.cent":-5"#, r#""tt.cent":-5"#);
    assert!(matches!(fehler(&falscher_wert), Fehler::UnbekannterWert { .. }));
    // ein Kreis durch das Makro ohne Verzögerung meldet die inneren IDs
    let kreis = MIT_MAKRO.replace(r#"{"von":"n.hz","nach":"grund.hz"},"#, r#"{"von":"grund.aus","nach":"grund.hz"},"#);
    assert!(matches!(fehler(&kreis), Fehler::Schleife(ids) if ids.contains(&"grund/o1".to_string())));
    // mit Verzögerung geht derselbe Kreis
    let mit_verz = MIT_MAKRO.replace(r#"{"von":"n.hz","nach":"grund.hz"},"#, r#"{"von":"grund.aus","nach":"grund.hz","verzoegerung":1},"#);
    assert!(uebersetze(&mit_verz, SR).is_ok());
}

#[test]
fn slice_1_format_geht_weiter() {
    let alt = include_str!("../beispiele/saege-ladder.json");
    assert!(alt.contains("baukasten/1"));
    assert!(uebersetze(alt, SR).is_ok());
}
