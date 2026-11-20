//! The knob analyser (src/regler_analyse.rs): a knob wired to nothing is "wirkt nicht", a gain knob changes the level by what it
//! says, a filter knob brightens, a stepper is tried at every step.
use baukasten_dsp::regler_analyse::*;

/// Saw voice into a filter and a gain; knob 1 = gain, knob 2 = wired to nothing, knob 3 = cutoff, knob 4 = unwired stepper.
fn graph() -> String {
    r#"{"format":"baukasten/2","name":"t","stimmen":4,
"regler_namen":{"1":"Level","2":"Dead","3":"Cutoff","4":"Mode"},
"knoten":[{"id":"note","art":"note"},{"id":"o","art":"saege"},
{"id":"g","art":"regler","nr":1,"min":0.05,"max":0.5,"vorgabe":0.5},
{"id":"c","art":"regler","nr":3,"min":300,"max":8000,"log":1,"vorgabe":0.5},
{"id":"d","art":"regler","nr":2,"min":0,"max":1},
{"id":"m","art":"regler","nr":4,"min":0,"max":2},
{"id":"f","art":"svf"},{"id":"v","art":"mul"},{"id":"a","art":"ausgang"}],
"kanten":[{"von":"note.hz","nach":"o.hz"},{"von":"o.aus","nach":"f.x"},{"von":"c.aus","nach":"f.cutoff"},{"von":"f.tp","nach":"v.a"},{"von":"g.aus","nach":"v.b"},{"von":"v.aus","nach":"a.x"}]}"#.to_string()
}

fn lauf(knoepfe: &[usize]) -> Bericht {
    analysiere(&graph(), "t", &Optionen { noten: Noten::C2, knoepfe: Some(knoepfe.to_vec()), threads: 1, basis: vec![], stellungen: None }).unwrap()
}

#[test]
fn unverdrahteter_regler_wirkt_nicht() {
    let b = lauf(&[2]);
    assert_eq!(b.regler[0].klasse, "wirkt nicht", "{:?}", b.regler[0].d_max);
    assert!(b.regler[0].d_max < 0.05, "d {}", b.regler[0].d_max);
    assert_eq!(b.grundrauschen_d, 0.0, "render must be reproducible");
}

#[test]
fn pegelregler_aendert_den_pegel_wie_gemessen() {
    let b = lauf(&[1]);
    let r = &b.regler[0];
    // travel 0 = gain 0.05; the default travel 0.5 is gain 0.05 + 0.5 * 0.45 = 0.275
    let p0 = r.positionen.iter().find(|p| p.wert == 0.0).unwrap();
    let erwartet = 20.0 * (0.05f64 / 0.275).log10();
    assert!((p0.unterschied.pegel_db - erwartet).abs() < 0.3, "{} vs {erwartet}", p0.unterschied.pegel_db);
    assert!(p0.beschreibung.contains("leiser um 15 dB"), "{}", p0.beschreibung);
    assert_eq!(r.klasse, "stark");
    // the timbre itself does not change
    assert!(p0.unterschied.d_klang < 0.6, "{}", p0.unterschied.d_klang);
}

#[test]
fn filterregler_macht_heller() {
    let b = lauf(&[3]);
    let r = &b.regler[0];
    let hell = |w: f32| r.positionen.iter().find(|p| p.wert == w).unwrap().unterschied.hell_st;
    assert!(hell(1.0) > hell(0.5) && hell(0.5) > hell(0.0), "{} {} {}", hell(0.0), hell(0.5), hell(1.0));
    assert!(hell(1.0) - hell(0.0) > 3.0, "{} {}", hell(0.0), hell(1.0));
    let auf = r.positionen.iter().find(|p| p.wert == 1.0).unwrap();
    assert_ne!(r.klasse, "wirkt nicht");
}

#[test]
fn stufenregler_wird_an_jeder_stufe_probiert() {
    assert_eq!(positionen(Some(3)), vec![0.0, 0.5, 1.0]);
    assert_eq!(positionen(None).len(), 5);
    let info = regler_info(&graph()).unwrap();
    assert_eq!(info.iter().find(|r| r.nr == 4).unwrap().stufen, Some(3));
    assert_eq!(info.iter().find(|r| r.nr == 3).unwrap().stufen, None);
}

#[test]
fn regler_ohne_knoten_ist_gemeldet() {
    let j = graph().replace(r#""4":"Mode""#, r#""4":"Mode","9":"Ghost""#);
    let b = analysiere(&j, "t", &Optionen { noten: Noten::C2, knoepfe: Some(vec![9]), threads: 1, basis: vec![], stellungen: None }).unwrap();
    assert_eq!(b.regler[0].klasse, "wirkt nicht");
    assert!(b.regler[0].beschreibung.contains("kein Regler-Knoten"));
}

#[test]
fn stille_variante_ist_der_staerkste_unterschied() {
    let a = messe(&rendere(&graph(), Noten::C2, &[]).unwrap());
    let still = messe(&vec![(0.0f32, 0.0f32); 1000]);
    let u = vergleiche(&a, &still);
    assert!(u.d >= 10.0 && klasse(u.d) == "stark");
}

#[test]
fn konstanten_wie_klang_runde() {
    let t = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../../ui/project/sound_runde_contract.ts")).unwrap();
    assert!(t.contains("export const HOER = { alpha: 0.3, boden: 60, s_spek: 6, s_fuelle: 1.5, s_pegel: 6, k: 0.34 }"), "HOER changed");
    assert!(t.contains("export const SKALA: Merkmale = { hell: 0.15, sub: 2, hoehen: 3, bewegung: 2, fuelle: 1, breite: 3, punch: 2, pegel: 1.5 }"), "SKALA changed");
    assert_eq!((HOER_ALPHA, HOER_BODEN, HOER_S_SPEK, HOER_S_FUELLE, HOER_K), (0.3, 60.0, 6.0, 1.5, 0.34));
}

/// Voice plus a pulse layer: the layer is `p * k5 * k6`, k6 (Layer, default 0) opens it, k5 (Layer level) acts only behind it.
fn graph_gated() -> String {
    r#"{"format":"baukasten/2","name":"t","stimmen":4,
"regler_namen":{"5":"Layer level","6":"Layer"},
"knoten":[{"id":"note","art":"note"},{"id":"o","art":"saege"},{"id":"p","art":"puls"},
{"id":"k5","art":"regler","nr":5,"min":0,"max":1,"vorgabe":0.5},
{"id":"k6","art":"regler","nr":6,"min":0,"max":1,"vorgabe":0},
{"id":"m1","art":"mul"},{"id":"m2","art":"mul"},{"id":"s","art":"add"},{"id":"a","art":"ausgang"}],
"kanten":[{"von":"note.hz","nach":"o.hz"},{"von":"note.hz","nach":"p.hz"},{"von":"p.aus","nach":"m1.a"},{"von":"k5.aus","nach":"m1.b"},
{"von":"m1.aus","nach":"m2.a"},{"von":"k6.aus","nach":"m2.b"},{"von":"o.aus","nach":"s.a"},{"von":"m2.aus","nach":"s.b"},{"von":"s.aus","nach":"a.x"}]}"#.to_string()
}

#[test]
fn regler_hinter_einem_anderen_wird_als_bedingt_gefunden() {
    let b = analysiere(&graph_gated(), "g", &Optionen { noten: Noten::C2, knoepfe: Some(vec![5, 6]), threads: 1, basis: vec![], stellungen: None }).unwrap();
    let k5 = b.regler.iter().find(|r| r.nr == 5).unwrap();
    let k6 = b.regler.iter().find(|r| r.nr == 6).unwrap();
    assert_eq!(k5.klasse, "wirkt nicht", "alone at the defaults k5 does nothing: {}", k5.d_max);
    assert_ne!(k6.klasse, "wirkt nicht");
    let c = k5.bedingt.as_ref().expect("k5 acts behind k6");
    assert_ne!(c.klasse, "wirkt nicht");
    assert_eq!(c.oeffner.map(|o| o.0), Some(6), "{:?}", c.oeffner);
    assert!(text_tabelle(&b).contains("nur bedingt"), "{}", text_tabelle(&b));
}

#[test]
fn a_gewicht_unterdrueckt_sub_im_pegel() {
    assert!(a_gewicht_db(65.0) < -23.0 && a_gewicht_db(65.0) > -27.0);
    assert!(a_gewicht_db(1000.0).abs() < 0.1);
}

/// Saw voice whose pitch goes through a cent knob (k7, +-100 ct, centre = default).
fn graph_tune() -> String {
    r#"{"format":"baukasten/2","name":"t","stimmen":4,
"regler_namen":{"7":"Tune"},
"knoten":[{"id":"note","art":"note"},{"id":"k","art":"regler","nr":7,"min":-100,"max":100,"vorgabe":0.5},{"id":"t","art":"transponiere"},
{"id":"o","art":"saege"},{"id":"v","art":"mul","b":0.3},{"id":"a","art":"ausgang"}],
"kanten":[{"von":"note.hz","nach":"t.hz"},{"von":"k.aus","nach":"t.cent"},{"von":"t.aus","nach":"o.hz"},{"von":"o.aus","nach":"v.a"},{"von":"v.aus","nach":"a.x"}]}"#.to_string()
}

#[test]
fn stimmregler_wird_in_cent_gemessen() {
    // the loudness picture cannot see 100 cent at 65 Hz; the fine picture does
    let b = analysiere(&graph_tune(), "t", &Optionen { noten: Noten::C2, knoepfe: Some(vec![7]), threads: 1, basis: vec![], stellungen: Some(vec![0.0, 0.6, 1.0]) }).unwrap();
    let r = &b.regler[0];
    let ct = |w: f32| r.positionen.iter().find(|p| p.wert == w).unwrap().unterschied.ton_ct;
    assert!((ct(1.0) - 100.0).abs() < 12.0, "{}", ct(1.0));
    assert!((ct(0.0) + 100.0).abs() < 12.0, "{}", ct(0.0));
    assert!((ct(0.6) - 20.0).abs() < 12.0, "{}", ct(0.6));
    assert_eq!(r.klasse, "deutlich", "{} {}", r.d_max, r.beschreibung);
    assert!(r.beschreibung.contains("ct"), "{}", r.beschreibung);
    // a render against itself is no shift
    let a = messe(&rendere(&graph_tune(), Noten::C2, &[]).unwrap());
    assert_eq!(tonhoehe_ct(&a.fein, &a.fein), 0.0);
}

/// Voice plus a sine one octave below, behind knob 5 (default 0): energy at 33 Hz, which the A-weighted D does not see.
fn graph_sub() -> String {
    r#"{"format":"baukasten/2","name":"t","stimmen":4,
"regler_namen":{"5":"Clean sub"},
"knoten":[{"id":"note","art":"note"},{"id":"o","art":"saege"},{"id":"m1","art":"mul","b":0.2},
{"id":"h","art":"mul","b":0.5},{"id":"sn","art":"sinus"},{"id":"k","art":"regler","nr":5,"min":0,"max":1,"vorgabe":0},{"id":"m2","art":"mul"},{"id":"m3","art":"mul","b":0.5},
{"id":"s","art":"add"},{"id":"a","art":"ausgang"}],
"kanten":[{"von":"note.hz","nach":"o.hz"},{"von":"o.aus","nach":"m1.a"},{"von":"note.hz","nach":"h.a"},{"von":"h.aus","nach":"sn.hz"},
{"von":"sn.aus","nach":"m2.a"},{"von":"k.aus","nach":"m2.b"},{"von":"m2.aus","nach":"m3.a"},{"von":"m1.aus","nach":"s.a"},{"von":"m3.aus","nach":"s.b"},{"von":"s.aus","nach":"a.x"}]}"#.to_string()
}

#[test]
fn sub_schicht_ist_nur_sub_und_nicht_wirkt_nicht() {
    let b = analysiere(&graph_sub(), "t", &Optionen { noten: Noten::C2, knoepfe: Some(vec![5]), threads: 1, basis: vec![], stellungen: None }).unwrap();
    let r = &b.regler[0];
    assert!(r.d_max < GRENZE_LEISE, "A-weighted D should not see the sub: {}", r.d_max);
    assert_eq!(r.klasse, KLASSE_SUB, "{}", r.beschreibung);
    assert!(text_tabelle(&b).contains("nur Sub 1"), "{}", text_tabelle(&b));
}

#[test]
fn basis_haelt_einen_regler_in_jedem_render() {
    // knob 6 (Layer) of the gated graph is held open: k5 (behind it) now acts directly, and the default render already contains the layer
    let o = Optionen { noten: Noten::C2, knoepfe: Some(vec![5]), threads: 1, basis: vec![(6, 1.0)], stellungen: Some(vec![1.0]) };
    let b = analysiere(&graph_gated(), "g", &o).unwrap();
    assert_ne!(b.regler[0].klasse, "wirkt nicht", "{}", b.regler[0].d_max);
    assert!(b.regler[0].bedingt.is_none());
    let ohne = messe(&rendere(&graph_gated(), Noten::C2, &[]).unwrap());
    assert!((b.grundzustand.rms_db - ohne.rms_db).abs() > 0.1, "the base render must differ from the plain default");
}

#[test]
fn phrasen_fuer_legato_und_glide() {
    let n: Vec<_> = Noten::C2.ereignisse();
    let l: Vec<_> = Noten::C2Legato.ereignisse();
    assert_eq!(n.len(), l.len());
    // every note whose successor has another pitch is held into it; same-pitch repeats and the last note are unchanged
    let mut ueberlappt = 0;
    for i in 0..n.len() - 1 {
        if n[i + 1].0 != n[i].0 { assert!(l[i].1 + l[i].2 > l[i + 1].1, "note {i} does not overlap"); ueberlappt += 1; } else { assert_eq!(l[i].2, n[i].2); }
    }
    assert!(ueberlappt >= 6);
    assert_eq!(l[n.len() - 1].2, n[n.len() - 1].2);
    let g = Noten::Gleiten.ereignisse();
    let mut t: Vec<u8> = g.iter().map(|e| e.0).collect();
    t.sort();
    t.dedup();
    assert_eq!(t.len(), 16, "all pitches distinct, so no voice is reused for the same note");
    assert_eq!(Noten::parse("glide"), Some(Noten::Gleiten));
    assert_eq!(Noten::parse("C2legato"), Some(Noten::C2Legato));
}

/// The gated graph plus a mute knob (k8: gain 1 at travel 0, gain 0 at travel 1). The mute is the strongest knob, so the all-knobs
/// context is silent and k5 cannot act in it: its opener k6 is only found with each effective knob alone as the context.
fn graph_gated_mit_stumm() -> String {
    graph_gated()
        .replace(r#""regler_namen":{"5":"Layer level","6":"Layer"}"#, r#""regler_namen":{"5":"Layer level","6":"Layer","8":"Mute"}"#)
        .replace(r#"{"id":"m1","art":"mul"}"#, r#"{"id":"k8","art":"regler","nr":8,"min":1,"max":0,"vorgabe":0},{"id":"mt","art":"mul"},{"id":"m1","art":"mul"}"#)
        .replace(r#"{"von":"s.aus","nach":"a.x"}"#, r#"{"von":"s.aus","nach":"mt.a"},{"von":"k8.aus","nach":"mt.b"},{"von":"mt.aus","nach":"a.x"}"#)
}

#[test]
fn oeffner_wird_auch_gefunden_wenn_ein_starker_regler_den_gesamtkontext_verdeckt() {
    let b = analysiere(&graph_gated_mit_stumm(), "g", &Optionen { noten: Noten::C2, knoepfe: Some(vec![5, 6, 8]), threads: 1, basis: vec![], stellungen: None }).unwrap();
    let k5 = b.regler.iter().find(|r| r.nr == 5).unwrap();
    assert_eq!(k5.klasse, "wirkt nicht", "{}", k5.d_max);
    let c = k5.bedingt.as_ref().expect("k5 acts behind k6 although the mute silences the all-knobs context");
    assert_eq!(c.oeffner.map(|o| o.0), Some(6), "{:?}", c.oeffner);
}
