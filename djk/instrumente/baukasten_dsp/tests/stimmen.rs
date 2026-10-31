//! Stimmenverwaltung, Hüllkurve und Wächter (Plan-Review 2026-10-28, Funde 1, 3, 4): jeder Test hat eine Mutation, die
//! ihn rot macht (Plan Task 1 Step 6).
use baukasten_dsp::uebersetze;

const SR: f32 = 48_000.0;

fn graph(stimmen: usize, knoten: &str, kanten: &str) -> String {
    format!(r#"{{"format":"baukasten/1","name":"t","stimmen":{stimmen},"knoten":[{knoten}],"kanten":[{kanten}]}}"#)
}

/// Summe der Gates über die Stimmen: wie viele Stimmen halten gerade.
fn gates(stimmen: usize) -> baukasten_dsp::Programm {
    let j = graph(stimmen, r#"{"id":"n","art":"note"},{"id":"o","art":"ausgang"}"#, r#"{"von":"n.gate","nach":"o.x"}"#);
    uebersetze(&j, SR).unwrap()
}

/// Hüllkurve direkt am Ausgang, eine Stimme
fn huelle(a: f32, d: f32, s: f32, r: f32) -> baukasten_dsp::Programm {
    let j = graph(1, &format!(r#"{{"id":"n","art":"note"}},{{"id":"e","art":"adsr","a":{a},"d":{d},"s":{s},"r":{r}}},{{"id":"o","art":"ausgang"}}"#),
                  r#"{"von":"n.gate","nach":"e.gate"},{"von":"n.trig","nach":"e.trig"},{"von":"e.aus","nach":"o.x"}"#);
    uebersetze(&j, SR).unwrap()
}

fn spiele(n: usize, p: &mut baukasten_dsp::Programm) -> f32 {
    let mut x = 0.0;
    for _ in 0..n {
        x = p.sample();
    }
    x
}

#[test]
fn zwei_gehalten_eine_losgelassen() {
    let mut p = gates(4);
    p.note_an(40, 1.0);
    p.note_an(47, 1.0);
    assert_eq!(p.sample(), 2.0);
    p.note_aus(40);
    assert_eq!(p.sample(), 1.0, "nur die losgelassene Note geht aus");
    assert!((0..4).any(|v| p.stimme(v) == (47, true)));
}

#[test]
fn gleiche_note_schlaegt_dieselbe_stimme_neu_an() {
    let mut p = gates(4);
    p.note_an(40, 1.0);
    p.note_an(40, 1.0);
    assert_eq!(p.sample(), 1.0, "kein zweites Gate für dieselbe Note");
}

#[test]
fn gleiche_note_im_release_nimmt_ihre_stimme_wieder() {
    // Andreas 2026-10-28 „bei 4s stockt was“: beim Akkordwechsel mit gemeinsamen Tönen lief der alte Ton im Release
    // weiter und derselbe Ton schlug auf einer zweiten Stimme an, die beiden löschten sich gegenseitig kurz aus.
    let mut p = gates(4);
    p.note_an(45, 1.0); // Stimme 0
    p.note_an(48, 1.0); // Stimme 1
    p.note_aus(45);
    p.note_aus(48);
    p.note_an(41, 1.0);
    p.note_an(45, 1.0);
    let mit_45: Vec<usize> = (0..4).filter(|&v| p.stimme(v).0 == 45).collect();
    assert_eq!(mit_45, vec![0], "45 schlägt auf ihrer Stimme 0 neu an, keine zweite Stimme mit 45");
    assert_eq!(p.stimme(0), (45, true));
    assert_eq!(p.stimme(1), (48, false), "48 klingt unberührt aus");
}

#[test]
fn note_off_nach_neuanschlag_im_selben_sample_gilt_der_alten_note() {
    // Host schickt beim Akkordwechsel für einen gemeinsamen Ton erst Note-on, dann Note-off (Slice 2b, D5): der neue Ton
    // muss halten. Ein frischer Ton, der im selben Sample an und aus geht, geht dagegen aus.
    let mut p = gates(4);
    p.note_an(45, 1.0);
    p.sample();
    p.note_an(45, 1.0);
    p.note_aus(45);
    assert_eq!(p.sample(), 1.0, "45 hält weiter");
    p.note_aus(45);
    assert_eq!(p.sample(), 0.0, "ein späteres Note-off wirkt");
    p.note_an(50, 1.0);
    p.note_aus(50);
    assert_eq!(p.sample(), 0.0, "frischer Ton an und aus im selben Sample: aus");
}

#[test]
fn merker_haengt_nach_stimmenklau_keine_note() {
    // eine Stimme: 45 neu anschlagen (Merker), dann klaut 50 die Stimme; ihr Note-off im selben Sample muss wirken
    let mut p = gates(1);
    p.note_an(45, 1.0);
    p.sample();
    p.note_an(45, 1.0);
    p.note_an(50, 1.0);
    p.note_aus(50);
    assert_eq!(p.sample(), 0.0, "50 ist aus, kein hängendes Gate");
}

#[test]
fn merker_haengt_nach_alle_aus_keine_note() {
    let mut p = gates(1);
    p.note_an(45, 1.0);
    p.sample();
    p.note_an(45, 1.0);
    p.alle_aus();
    p.note_an(45, 1.0);
    p.note_aus(45);
    assert_eq!(p.sample(), 0.0, "45 ist aus, kein hängendes Gate");
}

#[test]
fn freie_stimme_ist_die_am_laengsten_aus() {
    let mut p = gates(2);
    p.note_an(40, 1.0); // Stimme 0
    p.note_an(41, 1.0); // Stimme 1
    p.note_aus(40); // 0 zuerst aus
    p.note_aus(41);
    p.note_an(42, 1.0);
    assert_eq!(p.stimme(0), (42, true), "Stimme 0 ist am längsten aus");
    assert_eq!(p.stimme(1), (41, false));
}

#[test]
fn klau_trifft_die_aelteste() {
    let mut p = gates(2);
    p.note_an(40, 1.0);
    p.note_an(41, 1.0);
    p.note_an(42, 1.0); // beide halten: die älteste (40, Stimme 0) wird geklaut
    assert_eq!(p.stimme(0), (42, true));
    assert_eq!(p.stimme(1), (41, true));
}

#[test]
fn unverbundener_eingang_liest_null_und_ausgang_summiert_nur_die_stimmen_des_graphen() {
    // zwei Ausgänge: o über add (1 + unverbundenes b = 0), o2 direkt an konst (konst füllt alle 16 Plätze des Slots)
    let j = graph(3, r#"{"id":"k","art":"konst","wert":1},{"id":"s","art":"add"},{"id":"o","art":"ausgang"},{"id":"o2","art":"ausgang"}"#,
                  r#"{"von":"k.aus","nach":"s.a"},{"von":"s.aus","nach":"o.x"},{"von":"k.aus","nach":"o2.x"}"#);
    let mut p = uebersetze(&j, SR).unwrap();
    assert_eq!(p.sample(), 6.0, "je Ausgang 1 je Stimme, 3 Stimmen (nicht 16 + 3, nicht 2 je Stimme)");
}

#[test]
fn neuanschlag_startet_beim_ist_wert() {
    let mut p = huelle(0.01, 0.2, 0.5, 0.5);
    p.note_an(45, 1.0);
    spiele(9600, &mut p); // 0,2 s: Sustain-Nähe
    p.note_aus(45);
    let w = spiele(2400, &mut p); // 50 ms Release
    assert!(w > 0.1, "Gegenprobe: noch nicht still ({w})");
    p.note_an(45, 1.0);
    let n = p.sample();
    assert!(n >= w && n - w < 0.01, "kein Sprung auf null und kein Sprung nach oben: {w} → {n}");
}

#[test]
fn an_und_aus_im_selben_sample_haengt_nicht() {
    // Kern und Wirt können Off direkt nach On liefern, bevor ein Sample lief (erzeuger.cpp:193, kurze dauer)
    let mut p = huelle(0.005, 0.4, 0.6, 0.3);
    p.note_an(45, 1.0);
    p.note_aus(45);
    let w = spiele(48_000, &mut p);
    assert_eq!(w, 0.0, "nach 1 s Release still, nicht auf Sustain");
    // dasselbe über einen geklauten Anschlag mit Off im selben Sample
    p.note_an(45, 1.0);
    spiele(4800, &mut p);
    p.note_an(46, 1.0);
    p.note_aus(46);
    assert_eq!(spiele(48_000, &mut p), 0.0);
}

#[test]
fn alle_aus_beendet_jede_huellkurve() {
    let mut p = huelle(0.005, 0.4, 0.6, 0.3);
    p.note_an(45, 1.0);
    spiele(4800, &mut p);
    p.alle_aus();
    assert_eq!(spiele(48_000, &mut p), 0.0);
}

#[test]
fn waechter_faengt_weglaufende_rueckkopplung() {
    // s = 2·s(vorher) + 1 läuft nach ~128 Samples auf unendlich; der Wächter setzt zurück und zählt
    let j = graph(1, r#"{"id":"k","art":"konst","wert":1},{"id":"z","art":"konst","wert":2},{"id":"m","art":"mul"},{"id":"s","art":"add"},{"id":"o","art":"ausgang"}"#,
                  r#"{"von":"s.aus","nach":"m.a","verzoegerung":1},{"von":"z.aus","nach":"m.b"},{"von":"m.aus","nach":"s.a"},{"von":"k.aus","nach":"s.b"},{"von":"s.aus","nach":"o.x"}"#);
    let mut p = uebersetze(&j, SR).unwrap();
    let x: Vec<f32> = (0..1000).map(|_| p.sample()).collect();
    assert!(x.iter().all(|v| v.is_finite()));
    assert!(p.rettungen >= 1, "Gegenprobe: der Fall läuft wirklich weg");
    assert_eq!(x[0], 1.0, "vor dem Weglaufen klingt es normal");
}

#[test]
fn harmloser_graph_braucht_keinen_waechter() {
    let mut p = uebersetze(include_str!("../beispiele/saege-ladder.json"), SR).unwrap();
    p.note_an(45, 1.0);
    spiele(48_000, &mut p);
    assert_eq!(p.rettungen, 0);
}
