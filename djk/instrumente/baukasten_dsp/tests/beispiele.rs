//! Die Beispielgraphen aus Slice 2: laden, klingen, still ohne Note, endlich an allen Reglerenden, Regler wirken.
use baukasten_dsp::{uebersetze, Programm, REGLER};

const SR: f32 = 48_000.0;
const PAD: &str = include_str!("../beispiele/juno-pad.json");
const PAD_HALL: &str = include_str!("../beispiele/juno-pad-hall.json");
const PAD_ECHO: &str = include_str!("../beispiele/juno-pad-echo.json");
const PAD_DYN: &str = include_str!("../beispiele/juno-pad-dyn.json");
const LEAD: &str = include_str!("../beispiele/lead.json");

fn lade(j: &str) -> Programm { uebersetze(j, SR).unwrap_or_else(|e| panic!("{e}")) }
fn rms(x: &[f32]) -> f32 { (x.iter().map(|v| v * v).sum::<f32>() / x.len() as f32).sqrt() }
/// Helligkeit: rms der ersten Differenz relativ zum rms (steigt mit dem Anteil hoher Frequenzen)
fn hell(x: &[f32]) -> f32 { rms(&x.windows(2).map(|w| w[1] - w[0]).collect::<Vec<_>>()) / rms(x).max(1e-9) }

fn akkord(j: &str, regler: &[(usize, f32)]) -> Vec<f32> {
    let mut p = lade(j);
    for (n, w) in regler { p.setze_regler(*n, *w); }
    for n in [45u8, 52, 57, 61] { p.note_an(n, 0.8); }
    (0..48_000).map(|_| p.sample()).collect()
}

#[test]
fn beide_laden_mit_namen_fuer_alle_regler() {
    for j in [PAD, PAD_HALL, PAD_ECHO, PAD_DYN, LEAD] {
        let p = lade(j);
        assert_eq!(p.regler_namen.iter().map(|(n, _)| *n).collect::<Vec<_>>(), (1..=REGLER).collect::<Vec<_>>(), "{}", p.name);
    }
    assert_eq!(lade(PAD).stimmen, 8);
    assert_eq!(lade(LEAD).stimmen, 1);
}

#[test]
fn still_ohne_note_hoerbar_mit_note() {
    for j in [PAD, PAD_HALL, PAD_ECHO, PAD_DYN, LEAD] {
        let mut p = lade(j);
        assert!((0..48_000).all(|_| p.sample() == 0.0), "ohne Note still: {}", p.name);
        let x = akkord(j, &[]);
        let r = 20.0 * rms(&x[24_000..]).log10();
        assert!(r > -40.0 && r < -6.0, "{}: {r:.1} dB", p.name);
    }
}

#[test]
fn endlich_an_allen_reglerenden_ohne_rettung() {
    for j in [PAD, PAD_HALL, PAD_ECHO, PAD_DYN, LEAD] {
        for weg in [0.0f32, 1.0] {
            let mut p = lade(j);
            for n in 1..=REGLER { p.setze_regler(n, weg); }
            for n in [36u8, 48, 60, 72, 84, 96] { p.note_an(n, 1.0); }
            let x: Vec<f32> = (0..48_000).map(|_| p.sample()).collect();
            assert!(x.iter().all(|v| v.is_finite() && v.abs() < 4.0), "{} Regler {weg}", p.name);
            assert_eq!(p.rettungen, 0, "{} Regler {weg}", p.name);
        }
        // jeden Block alle Regler umwerfen
        let mut p = lade(j);
        for n in [40u8, 47, 52] { p.note_an(n, 1.0); }
        for b in 0..400 {
            for n in 1..=REGLER { p.setze_regler(n, if (b + n) % 2 == 0 { 0.0 } else { 1.0 }); }
            for _ in 0..256 { assert!(p.sample().is_finite()); }
        }
        assert_eq!(p.rettungen, 0);
    }
}

#[test]
fn regler_1_macht_heller() {
    for j in [PAD, LEAD] {
        let (zu, auf) = (hell(&akkord(j, &[(1, 0.1)])[24_000..]), hell(&akkord(j, &[(1, 0.9)])[24_000..]));
        assert!(auf > 1.5 * zu, "{}: zu {zu:.3}, auf {auf:.3}", lade(j).name);
    }
}

#[test]
fn lead_ist_einstimmig_mit_glide() {
    // Mittlere Grundfrequenz der ersten 100 ms nach dem Sprung A3 → A4: mit Glide (τ 40 ms) rechnerisch 359 Hz, ohne 440
    let mittel = |j: &str| {
        let mut p = lade(j);
        p.setze_regler(3, 0.0); // Sync-Oszillator auf den Grundton, sonst zählt der Nulldurchgang dessen Obertöne
        p.note_an(57, 1.0);
        for _ in 0..9600 { p.sample(); }
        p.note_an(69, 1.0);
        assert_eq!(p.stimme(0), (69, true));
        let x: Vec<f32> = (0..4800).map(|_| p.sample()).collect();
        let null = x.windows(2).filter(|w| w[0] < 0.0 && w[1] >= 0.0).count();
        null as f32 * 10.0
    };
    let mit = mittel(LEAD);
    let ohne = mittel(&LEAD.replace(r#""zeit": 0.04"#, r#""zeit": 0"#));
    assert!((300.0..420.0).contains(&mit), "mit Glide {mit} Hz");
    assert!(ohne >= 430.0, "ohne Glide {ohne} Hz");
}

#[test]
fn lead_erste_note_nach_dem_laden_ohne_glide() {
    // Grundfrequenz der ersten 20 ms nach dem Laden, Ziel A3 = 220 Hz; ohne die Kante note.erste → glide.setzen gleitet
    // der Lead aus 0 Hz hoch (Plan-Review F4: 50 Hz im ersten Fenster)
    let erstes_fenster = |j: &str| {
        let mut p = lade(j);
        p.setze_regler(3, 0.0);
        p.note_an(57, 1.0);
        let x: Vec<f32> = (0..960).map(|_| p.sample()).collect();
        x.windows(2).filter(|w| w[0] < 0.0 && w[1] >= 0.0).count() as f32 * 50.0
    };
    let mit = erstes_fenster(LEAD);
    let ohne = erstes_fenster(&LEAD.replace("    {\"von\": \"note.erste\", \"nach\": \"glide.setzen\"},\n", ""));
    assert!(mit >= 150.0, "erste Note {mit} Hz");
    assert!(ohne <= 100.0, "Gegenprobe ohne setzen {ohne} Hz");
}

#[test]
fn zuruecksetzen_klingt_wie_frisch_geladen() {
    // juno-pad-hall fehlt hier mit Absicht (D6): hall_dsp::Hall::reset setzt Zufallszustand und Phasen der Fahnen nicht
    // zurück, der Hall ist nach zuruecksetzen still, nicht gleich frisch (gemessen 4,1e-2). Geprüft in tests/arten.rs.
    // jeder Zustand (Oszillatoren, Rauschen, LFO, Filter, Sättigung, Glätter, Hüllkurven, Stimmen) muss zurück
    let lauf = |p: &mut Programm| {
        let mut x = Vec::new();
        for n in [45u8, 52, 57] { p.note_an(n, 0.8); }
        for _ in 0..24_000 { x.push(p.sample()); }
        p.alle_aus();
        for _ in 0..12_000 { x.push(p.sample()); }
        x
    };
    for j in [PAD, LEAD] {
        let frisch = lauf(&mut lade(j));
        let mut p = lade(j);
        lauf(&mut p);
        p.zuruecksetzen();
        assert!(lauf(&mut p) == frisch, "{}", p.name);
    }
}
