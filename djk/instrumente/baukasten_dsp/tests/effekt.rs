//! Baukasten S3c: Effekt-Graphen. `eingang` reicht Host-Audio in den Graphen (nur Stimme 0), der Takt kommt vom Host.
use baukasten_dsp::{uebersetze, Fehler};

const SR: f32 = 48_000.0;

fn durch(stimmen: usize) -> String {
    format!(
        r#"{{"format":"baukasten/2","name":"durch","stimmen":{stimmen},"knoten":[{{"id":"e","art":"eingang"}},{{"id":"o","art":"ausgang"}}],"kanten":[{{"von":"e.l","nach":"o.l"}},{{"von":"e.r","nach":"o.r"}}]}}"#
    )
}

fn signal(i: usize) -> (f32, f32) {
    (((i as f32) * 0.01).sin() * 0.5, ((i as f32) * 0.013).cos() * 0.25)
}

#[test]
fn eingang_reicht_bitgleich_durch() {
    let mut p = uebersetze(&durch(1), SR).unwrap();
    assert!(p.hat_eingang());
    for i in 0..1000 {
        let (l, r) = signal(i);
        p.setze_eingang(l, r);
        assert_eq!(p.sample_stereo(), (l, r), "Sample {i}");
    }
}

#[test]
fn eingang_zaehlt_einmal_bei_acht_stimmen() {
    let mut p = uebersetze(&durch(8), SR).unwrap();
    for i in 0..1000 {
        let (l, r) = signal(i);
        p.setze_eingang(l, r);
        assert_eq!(p.sample_stereo(), (l, r), "Sample {i}: Eingang darf nur in Stimme 0 stehen");
    }
}

#[test]
fn eingang_klemmt_nan_und_spitzen() {
    let mut p = uebersetze(&durch(1), SR).unwrap();
    p.setze_eingang(f32::NAN, 100.0);
    assert_eq!(p.sample_stereo(), (0.0, 8.0));
    p.setze_eingang(f32::NEG_INFINITY, -100.0);
    assert_eq!(p.sample_stereo(), (0.0, -8.0));
    assert_eq!(p.rettungen, 0);
}

#[test]
fn instrument_hat_keinen_eingang() {
    let p = uebersetze(include_str!("../beispiele/juno-pad.json"), SR).unwrap();
    assert!(!p.hat_eingang());
}

#[test]
fn zwei_eingaenge_abgelehnt() {
    let g = r#"{"format":"baukasten/2","name":"zwei","stimmen":1,"knoten":[{"id":"a","art":"eingang"},{"id":"b","art":"eingang"},{"id":"o","art":"ausgang"}],"kanten":[{"von":"a.l","nach":"o.l"},{"von":"b.r","nach":"o.r"}]}"#;
    assert!(matches!(uebersetze(g, SR), Err(Fehler::MehrereEingaenge)));
}

/// 120 BPM: 2 Beats je Sekunde
const BPS_120: f64 = 2.0 / 48_000.0;

fn lfo_saege(takt: f32) -> String {
    format!(
        r#"{{"format":"baukasten/2","name":"lfo","stimmen":1,"knoten":[{{"id":"l","art":"lfo","form":2,"takt":{takt}}},{{"id":"o","art":"ausgang"}}],"kanten":[{{"von":"l.aus","nach":"o.x"}}]}}"#
    )
}

#[test]
fn lfo_takt_folgt_dem_beat() {
    let mut p = uebersetze(&lfo_saege(1.0), SR).unwrap();
    p.setze_takt(0.0, BPS_120);
    let x: Vec<f32> = (0..24_000).map(|_| p.sample_stereo().0).collect();
    assert!((x[0] + 1.0).abs() < 1e-6, "Beat 0: Säge bei -1, ist {}", x[0]);
    assert!(x[12_000].abs() < 1e-3, "Beat 0,5: Säge bei 0, ist {}", x[12_000]);
    assert!(x[23_999] > 0.999, "kurz vor Beat 1: Säge bei 1, ist {}", x[23_999]);
}

#[test]
fn lfo_takt_springt_mit_dem_host_beat() {
    let mut p = uebersetze(&lfo_saege(1.0), SR).unwrap();
    p.setze_takt(3.25, BPS_120);
    assert!((p.sample_stereo().0 + 0.5).abs() < 1e-6, "Beat 3,25: Säge bei -0,5");
}

#[test]
fn lfo_takt_ohne_host_laeuft_mit_128_bpm() {
    let mut p = uebersetze(&lfo_saege(1.0), SR).unwrap();
    let x: Vec<f32> = (0..22_500).map(|_| p.sample_stereo().0).collect();
    // 128 BPM: Periode 22 500 Samples. Nicht genau am Umlauf prüfen: f64-Beat 0,99999… rundet als f32 auf 1,0
    assert!((x[0] + 1.0).abs() < 1e-6);
    assert!(x[11_250].abs() < 1e-3, "halbe Periode: Säge bei 0, ist {}", x[11_250]);
    assert!(x[22_499] > 0.999, "kurz vor dem Umlauf: Säge bei 1, ist {}", x[22_499]);
}

#[test]
fn lfo_ohne_takt_bitgleich_zum_freien_lfo() {
    let frei = r#"{"format":"baukasten/2","name":"f","stimmen":1,"knoten":[{"id":"l","art":"lfo","rate":3,"form":0},{"id":"o","art":"ausgang"}],"kanten":[{"von":"l.aus","nach":"o.x"}]}"#;
    let null = frei.replace(r#""form":0"#, r#""form":0,"takt":0"#);
    let (mut a, mut b) = (uebersetze(frei, SR).unwrap(), uebersetze(&null, SR).unwrap());
    b.setze_takt(7.0, BPS_120);
    for i in 0..10_000 {
        assert_eq!(a.sample_stereo(), b.sample_stereo(), "Sample {i}");
    }
}

fn echo(takt: f32) -> String {
    format!(
        r#"{{"format":"baukasten/2","name":"echo","stimmen":1,"knoten":[{{"id":"e","art":"eingang"}},{{"id":"d","art":"delay","takt":{takt},"fb":0,"mix":1,"max":2000}},{{"id":"o","art":"ausgang"}}],"kanten":[{{"von":"e.l","nach":"d.l"}},{{"von":"e.r","nach":"d.r"}},{{"von":"d.l","nach":"o.l"}},{{"von":"d.r","nach":"o.r"}}]}}"#
    )
}

/// Index des größten Betrags links nach einem Impuls bei Sample 0. `delay` gibt trocken + mix·nass aus (echo.rs:94):
/// der Impuls selbst steht bei Index 0 und wird übersprungen, gesucht ist das Echo.
fn spitze(p: &mut baukasten_dsp::Programm, n: usize) -> usize {
    let mut best = (0usize, 0.0f32);
    for i in 0..n {
        p.setze_eingang(if i == 0 { 1.0 } else { 0.0 }, 0.0);
        let a = p.sample_stereo().0.abs();
        if i >= 100 && a > best.1 {
            best = (i, a);
        }
    }
    assert!(best.1 > 0.5, "kein Echo gefunden (Spitze {})", best.1);
    best.0
}

#[test]
fn delay_takt_halber_beat_bei_120_bpm() {
    let mut p = uebersetze(&echo(0.5), SR).unwrap();
    p.setze_takt(0.0, BPS_120);
    let i = spitze(&mut p, 20_000);
    assert!((11_998..=12_002).contains(&i), "Echo nach 0,5 Beat = 12 000 Samples, ist {i}");
}

#[test]
fn delay_takt_folgt_dem_tempo() {
    let mut p = uebersetze(&echo(0.5), SR).unwrap();
    p.setze_takt(0.0, BPS_120 / 2.0);  // 60 BPM
    let i = spitze(&mut p, 30_000);
    assert!((23_998..=24_002).contains(&i), "Echo nach 0,5 Beat bei 60 BPM = 24 000 Samples, ist {i}");
}

#[test]
fn takt_werte_ausserhalb_abgelehnt() {
    assert!(uebersetze(&lfo_saege(65.0), SR).is_err());
    assert!(uebersetze(&echo(17.0), SR).is_err());
    assert!(uebersetze(&echo(-1.0), SR).is_err());
}
