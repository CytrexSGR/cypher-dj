//! Prüfung des JSON beim Übersetzen: jeder Fehlerfall wird abgewiesen, der passende gültige Fall geht durch.
use baukasten_dsp::{uebersetze, Fehler};

const SR: f32 = 48_000.0;
const BEISPIEL: &str = include_str!("../beispiele/saege-ladder.json");

fn graph(knoten: &str, kanten: &str) -> String {
    format!(r#"{{"format":"baukasten/1","name":"t","stimmen":1,"knoten":[{knoten}],"kanten":[{kanten}]}}"#)
}
fn fehler(j: &str) -> Fehler { uebersetze(j, SR).err().expect("muss abgewiesen werden") }

#[test]
fn beispiel_geht_durch() { assert!(uebersetze(BEISPIEL, SR).is_ok()); }

#[test]
fn falsches_format() {
    let j = BEISPIEL.replace("baukasten/1", "baukasten/9");
    assert_eq!(fehler(&j), Fehler::FalschesFormat("baukasten/9".into()));
}

#[test]
fn kaputtes_json() { assert!(matches!(fehler("{"), Fehler::Format(_))); }

#[test]
fn stimmen_null_und_zu_viele() {
    assert_eq!(fehler(&BEISPIEL.replace("\"stimmen\": 8", "\"stimmen\": 0")), Fehler::Stimmen(0));
    assert_eq!(fehler(&BEISPIEL.replace("\"stimmen\": 8", "\"stimmen\": 17")), Fehler::Stimmen(17));
    assert!(uebersetze(&BEISPIEL.replace("\"stimmen\": 8", "\"stimmen\": 16"), SR).is_ok());
}

#[test]
fn doppelte_id() {
    let j = graph(r#"{"id":"a","art":"ausgang"},{"id":"a","art":"ausgang"}"#, "");
    assert_eq!(fehler(&j), Fehler::DoppelteId("a".into()));
}

#[test]
fn unbekannte_art_und_werte() {
    assert_eq!(fehler(&graph(r#"{"id":"x","art":"zauber"}"#, "")), Fehler::UnbekannteArt { knoten: "x".into(), art: "zauber".into() });
    assert_eq!(fehler(&graph(r#"{"id":"k","art":"konst"},{"id":"o","art":"ausgang"}"#, "")),
               Fehler::FehlenderWert { knoten: "k".into(), wert: "wert".into() });
    assert_eq!(fehler(&graph(r#"{"id":"k","art":"konst","wert":1,"farbe":2},{"id":"o","art":"ausgang"}"#, "")),
               Fehler::UnbekannterWert { knoten: "k".into(), wert: "farbe".into() });
}

#[test]
fn ohne_ausgang_und_zwei_noten() {
    assert_eq!(fehler(&graph(r#"{"id":"k","art":"konst","wert":1}"#, "")), Fehler::KeinAusgang);
    assert_eq!(fehler(&graph(r#"{"id":"n1","art":"note"},{"id":"n2","art":"note"},{"id":"o","art":"ausgang"}"#, "")), Fehler::MehrereNoten);
}

#[test]
fn kanten_adressen_und_ports() {
    let kn = r#"{"id":"k","art":"konst","wert":1},{"id":"o","art":"ausgang"}"#;
    assert_eq!(fehler(&graph(kn, r#"{"von":"k","nach":"o.x"}"#)), Fehler::Adresse("k".into()));
    assert_eq!(fehler(&graph(kn, r#"{"von":"q.aus","nach":"o.x"}"#)), Fehler::UnbekannterKnoten("q".into()));
    assert_eq!(fehler(&graph(kn, r#"{"von":"k.hz","nach":"o.x"}"#)), Fehler::UnbekannterPort("k.hz".into()));
    assert_eq!(fehler(&graph(kn, r#"{"von":"k.aus","nach":"o.y"}"#)), Fehler::UnbekannterPort("o.y".into()));
    assert!(uebersetze(&graph(kn, r#"{"von":"k.aus","nach":"o.x"}"#), SR).is_ok());
}

#[test]
fn mehrfach_eingang() {
    let kn = r#"{"id":"k","art":"konst","wert":1},{"id":"l","art":"konst","wert":2},{"id":"o","art":"ausgang"}"#;
    let j = graph(kn, r#"{"von":"k.aus","nach":"o.x"},{"von":"l.aus","nach":"o.x"}"#);
    assert_eq!(fehler(&j), Fehler::MehrfachEingang("o.x".into()));
}

#[test]
fn kreis_ohne_verzoegerung_ist_fehler_mit_verzoegerung_nicht() {
    let kn = r#"{"id":"k","art":"konst","wert":1},{"id":"s","art":"add"},{"id":"o","art":"ausgang"}"#;
    let ohne = graph(kn, r#"{"von":"k.aus","nach":"s.a"},{"von":"s.aus","nach":"s.b"},{"von":"s.aus","nach":"o.x"}"#);
    assert_eq!(fehler(&ohne), Fehler::Schleife(vec!["o".into(), "s".into()]));
    let mit = graph(kn, r#"{"von":"k.aus","nach":"s.a"},{"von":"s.aus","nach":"s.b","verzoegerung":1},{"von":"s.aus","nach":"o.x"}"#);
    assert!(uebersetze(&mit, SR).is_ok());
    let zwei = graph(kn, r#"{"von":"k.aus","nach":"s.a"},{"von":"s.aus","nach":"s.b","verzoegerung":2},{"von":"s.aus","nach":"o.x"}"#);
    assert_eq!(fehler(&zwei), Fehler::Verzoegerung("s.aus -> s.b".into()));
}

#[test]
fn unendlicher_wert_wird_abgewiesen() {
    // 1e39 passt nicht in f32 und würde unendlich; inf·0 im mul machte die Oszillatorphase dauerhaft NaN (Plan-Review F4)
    let j = graph(r#"{"id":"k","art":"konst","wert":1e39},{"id":"o","art":"ausgang"}"#, r#"{"von":"k.aus","nach":"o.x"}"#);
    assert_eq!(fehler(&j), Fehler::UnendlicherWert { knoten: "k".into(), wert: "wert".into() });
    assert!(uebersetze(&j.replace("1e39", "1e38"), SR).is_ok(), "Gegenprobe: größter endlicher Bereich geht durch");
}

#[test]
fn kreis_ueber_leitung_ist_erlaubt_auch_mit_verzoegerungsangabe() {
    // die Kante in leitung.x ist immer verzögert; eine ausdrückliche "verzoegerung":1 dort ändert nichts
    let kn = r#"{"id":"k","art":"konst","wert":1},{"id":"s","art":"add"},{"id":"d","art":"leitung","zeit":1},{"id":"o","art":"ausgang"}"#;
    let ohne = graph(kn, r#"{"von":"k.aus","nach":"s.a"},{"von":"s.aus","nach":"d.x"},{"von":"d.aus","nach":"s.b"},{"von":"s.aus","nach":"o.x"}"#);
    let mit = ohne.replace(r#""nach":"d.x"}"#, r#""nach":"d.x","verzoegerung":1}"#);
    let (mut a, mut b) = (uebersetze(&ohne, SR).unwrap(), uebersetze(&mit, SR).unwrap());
    let (x, y): (Vec<f32>, Vec<f32>) = (0..500).map(|_| (a.sample(), b.sample())).unzip();
    assert_eq!(x, y);
}
