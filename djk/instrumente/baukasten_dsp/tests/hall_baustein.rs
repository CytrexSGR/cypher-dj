//! Baustein `hall` (Slice 4a): Cypher Hall auf der Summe aller Stimmen, Ergebnis in Stimme 0 (D1, D2). Die Klangeigenschaften
//! (T60, Echodichte, Impulsenergie) sind in hall_dsp geeicht; hier wird gezeigt, dass der Baustein genau diesen Hall rechnet.
use baukasten_dsp::uebersetze;
use hall_dsp::{Hall, HallEinstellung};

const SR: f32 = 48_000.0;

fn graph(stimmen: usize, knoten: &str, kanten: &str) -> String {
    format!(r#"{{"format":"baukasten/2","name":"t","stimmen":{stimmen},"knoten":[{knoten}],"kanten":[{kanten}]}}"#)
}

/// Vier Sägezahnstimmen hinter einer Hüllkurve; `knoten`/`kanten` hängen den Rest an
fn saegen(knoten: &str, kanten: &str) -> baukasten_dsp::Programm {
    let k = format!(r#"{{"id":"n","art":"note"}},{{"id":"s","art":"saege"}},{{"id":"e","art":"adsr","a":0.01,"d":0.1,"s":1,"r":0.2}},{{"id":"vca","art":"mul"}},{{"id":"o","art":"ausgang"}}{knoten}"#);
    let e = format!(r#"{{"von":"n.hz","nach":"s.hz"}},{{"von":"n.gate","nach":"e.gate"}},{{"von":"n.trig","nach":"e.trig"}},{{"von":"s.aus","nach":"vca.a"}},{{"von":"e.aus","nach":"vca.b"}}{kanten}"#);
    uebersetze(&graph(4, &k, &e), SR).unwrap_or_else(|e| panic!("{e}"))
}

fn akkord(p: &mut baukasten_dsp::Programm) {
    for n in [45u8, 52, 57, 61] {
        p.note_an(n, 1.0);
    }
}

const MIT_HALL: &str = r#",{"von":"vca.aus","nach":"h.x"},{"von":"h.l","nach":"o.l"},{"von":"h.r","nach":"o.r"}"#;

#[test]
fn hall_rechnet_auf_der_summe_wie_hall_dsp() {
    // gleiche Summe in einen eigenen Hall mit denselben Werten: Sample für Sample bitgleich
    let mut ohne = saegen("", r#",{"von":"vca.aus","nach":"o.x"}"#);
    let mut mit = saegen(r#",{"id":"h","art":"hall","decay":1.5,"mix":0.4,"rahmen":1,"pre":25,"groesse":90,"breite":0.7,"frueh":0.8,"tief":0.9,"hoch":1.3}"#, MIT_HALL);
    akkord(&mut ohne);
    akkord(&mut mit);
    let mut h = Hall::neu(SR as f64);
    // alle Werte weichen von der Vorgabe ab, damit ein fest verdrahteter Wert im Bau-Arm auffällt; f32-Casts wie dort
    h.setze(HallEinstellung {
        decay_s: 1.5,
        mix: 0.4f32 as f64,
        rahmen: 1,
        pre_ms: 25.0,
        groesse_ms: 90.0,
        breite: 0.7f32 as f64,
        frueh: 0.8f32 as f64,
        tief_faktor: 0.9f32 as f64,
        hoch_faktor: 1.3f32 as f64,
        ..baukasten_dsp::hall_vorgabe()
    });
    h.reset();
    let mut nass = 0.0f64;
    for i in 0..24_000 {
        let s = ohne.sample();
        let (mut l, mut r) = ([s], [s]);
        h.verarbeite_stereo(&mut l, &mut r);
        let ist = mit.sample_stereo();
        assert_eq!((ist.0.to_bits(), ist.1.to_bits()), (l[0].to_bits(), r[0].to_bits()), "Sample {i}");
        nass += ((ist.0 - s) as f64).abs();
    }
    assert!(nass > 1.0, "der Hall verändert nichts, Vergleich wäre blind ({nass})");
}

#[test]
fn hall_mit_mix_null_ist_die_trockene_summe() {
    let mut ohne = saegen("", r#",{"von":"vca.aus","nach":"o.x"}"#);
    let mut mit = saegen(r#",{"id":"h","art":"hall","mix":0}"#, MIT_HALL);
    akkord(&mut ohne);
    akkord(&mut mit);
    for i in 0..9_600 {
        let s = ohne.sample();
        assert_eq!(mit.sample_stereo(), (s, s), "Sample {i}");
    }
}

#[test]
fn mix_am_eingang_wirkt() {
    // mix über eine Konstante an der Kante. Der Knoten startet auf seiner Vorgabe 0,3 und gleitet mit dem hall_dsp-Glätter
    // zum Kantenwert; nach 0,5 s ist mix 0 praktisch trocken, mix 1 deutlich nass.
    let mit = |wert: f32| {
        let mut p = saegen(&format!(r#",{{"id":"h","art":"hall"}},{{"id":"m","art":"konst","wert":{wert}}}"#), &format!(r#"{MIT_HALL},{{"von":"m.aus","nach":"h.mix"}}"#));
        akkord(&mut p);
        p
    };
    let (mut null, mut eins) = (mit(0.0), mit(1.0));
    let mut q = saegen("", r#",{"von":"vca.aus","nach":"o.x"}"#);
    akkord(&mut q);
    let (mut d0, mut d1) = (0.0f64, 0.0f64);
    for i in 0..48_000 {
        let s = q.sample();
        let (a, b) = (null.sample_stereo().0, eins.sample_stereo().0);
        if i >= 24_000 {
            d0 = d0.max((a - s).abs() as f64);
            d1 = d1.max((b - s).abs() as f64);
        }
    }
    println!("MESS mix 0: größte Abweichung von trocken {d0:.2e}, mix 1: {d1:.3}");
    assert!(d0 < 1e-3, "mix 0 an der Kante ist nicht trocken: {d0}");
    assert!(d1 > 0.1, "mix 1 an der Kante wirkt nicht: {d1}");
}

#[test]
fn links_und_rechts_gehen_getrennt_in_den_hall() {
    // nur links gespeist: die frühen Reflexionen bleiben je Seite, rechts kommt nur die diffuse Fahne an (hall_dsp nass())
    let j = graph(1, r#"{"id":"n","art":"note"},{"id":"s","art":"saege"},{"id":"h","art":"hall","mix":1,"frueh":1},{"id":"o","art":"ausgang"}"#,
                  r#"{"von":"n.hz","nach":"s.hz"},{"von":"s.aus","nach":"h.l"},{"von":"h.l","nach":"o.l"},{"von":"h.r","nach":"o.r"}"#);
    let mut p = uebersetze(&j, SR).unwrap();
    p.note_an(57, 1.0);
    let mut h = Hall::neu(SR as f64);
    h.setze(HallEinstellung { mix: 1.0, frueh: 1.0, ..baukasten_dsp::hall_vorgabe() });
    h.reset();
    let mut q = uebersetze(&graph(1, r#"{"id":"n","art":"note"},{"id":"s","art":"saege"},{"id":"o","art":"ausgang"}"#, r#"{"von":"n.hz","nach":"s.hz"},{"von":"s.aus","nach":"o.l"}"#), SR).unwrap();
    q.note_an(57, 1.0);
    for i in 0..9_600 {
        let (sl, _) = q.sample_stereo();
        let (mut l, mut r) = ([sl], [0.0f32]);
        h.verarbeite_stereo(&mut l, &mut r);
        assert_eq!(p.sample_stereo(), (l[0], r[0]), "Sample {i}");
    }
}

#[test]
fn nur_rechts_gespeist_geht_getrennt_in_den_hall() {
    // Spiegel zu links_und_rechts_gehen_getrennt_in_den_hall: Eingang `r` allein, gegen einen direkten Hall
    let j = graph(1, r#"{"id":"n","art":"note"},{"id":"s","art":"saege"},{"id":"h","art":"hall","mix":1,"frueh":1},{"id":"o","art":"ausgang"}"#,
                  r#"{"von":"n.hz","nach":"s.hz"},{"von":"s.aus","nach":"h.r"},{"von":"h.l","nach":"o.l"},{"von":"h.r","nach":"o.r"}"#);
    let mut p = uebersetze(&j, SR).unwrap();
    p.note_an(57, 1.0);
    let mut h = Hall::neu(SR as f64);
    h.setze(HallEinstellung { mix: 1.0, frueh: 1.0, ..baukasten_dsp::hall_vorgabe() });
    h.reset();
    let mut q = uebersetze(&graph(1, r#"{"id":"n","art":"note"},{"id":"s","art":"saege"},{"id":"o","art":"ausgang"}"#, r#"{"von":"n.hz","nach":"s.hz"},{"von":"s.aus","nach":"o.r"}"#), SR).unwrap();
    q.note_an(57, 1.0);
    let mut nass = 0.0f64;
    for i in 0..9_600 {
        let (_, sr) = q.sample_stereo();
        let (mut l, mut r) = ([0.0f32], [sr]);
        h.verarbeite_stereo(&mut l, &mut r);
        let ist = p.sample_stereo();
        assert_eq!(ist, (l[0], r[0]), "Sample {i}");
        nass += (ist.1 as f64).abs();
    }
    assert!(nass > 1.0, "nur rechts gespeist, aber rechts kommt nichts an ({nass})");
}

#[test]
fn schwanz_klingt_nach_alle_aus_und_ist_nach_zuruecksetzen_still() {
    let mut p = saegen(r#",{"id":"h","art":"hall","mix":1,"decay":3}"#, MIT_HALL);
    akkord(&mut p);
    for _ in 0..24_000 {
        p.sample_stereo();
    }
    p.alle_aus();
    for _ in 0..12_000 {
        p.sample_stereo(); // Hüllkurve klingt aus (r 0,2 s)
    }
    let schwanz: f64 = (0..4_800).map(|_| p.sample_stereo().0 as f64).map(|v| v * v).sum();
    assert!(schwanz > 1e-3, "nach dem Loslassen hallt nichts nach: {schwanz}");
    p.zuruecksetzen();
    // D6: hall_dsp::Hall::reset lässt einen Rest in den EinPol-Filtern. Gemessen mit Rauschen 0,3: Rest 2,4e-5 gegen
    // Schwanz ~6,9 je Fenster, Verhältnis 3,5e-6. Geprüft wird relativ zum Schwanz davor, Schwelle 1e-4.
    let rest: f64 = (0..2_048).map(|_| p.sample_stereo().0 as f64).map(|v| v * v).sum();
    println!("MESS Schwanz {schwanz:.3e}, Rest nach zuruecksetzen {rest:.3e}, Verhältnis {:.2e}", rest / schwanz);
    assert!(rest < 1e-4 * schwanz, "nach zuruecksetzen klingt der Hall weiter: {rest} gegen Schwanz {schwanz}");
}

#[test]
fn falsche_werte_werden_abgewiesen() {
    for (wert, ok) in [(r#""rahmen":5"#, false), (r#""rahmen":1.5"#, false), (r#""rahmen":4"#, true), (r#""decay":0"#, false), (r#""decay":30"#, true),
                       (r#""decay":31"#, false), (r#""groesse":4"#, false), (r#""pre":251"#, false), (r#""frueh":1.1"#, false), (r#""breite":-0.1"#, false),
                       (r#""tief":0.04"#, false), (r#""hoch":4.1"#, false),
                       // Ränder gelten
                       (r#""pre":250"#, true), (r#""groesse":200"#, true), (r#""groesse":5"#, true), (r#""hoch":4"#, true), (r#""tief":0.05"#, true)] {
        let j = graph(1, &format!(r#"{{"id":"n","art":"note"}},{{"id":"h","art":"hall",{wert}}},{{"id":"o","art":"ausgang"}}"#), r#"{"von":"h.l","nach":"o.l"}"#);
        assert_eq!(uebersetze(&j, SR).is_ok(), ok, "{wert}");
    }
}
