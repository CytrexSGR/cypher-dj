//! Klang-Leitplanken für den Pad mit Echo (Slice 4b): Pegel, Übersteuern an den Enden und im ungünstigsten Fall, dazu
//! die Lage des Echos (bis zur Delay-Zeit bitgleich mit dem Pad mit Hall, danach verschieden) und die Breite.
mod gemeinsam;
use baukasten_dsp::{uebersetze, REGLER};
use gemeinsam::*;

const SR: f32 = 48_000.0;
const PAD_HALL: &str = include_str!("../beispiele/juno-pad-hall.json");
const PAD_ECHO: &str = include_str!("../beispiele/juno-pad-echo.json");

fn akkord(regler: &[(usize, f32)]) -> Vec<(f32, f32)> { spiele_graph(PAD_ECHO, &[45, 49, 52, 57], regler) }

#[test]
fn grundstellung_ist_hoerbar() {
    let x = akkord(&[]);
    let (d, s) = (db(&x), spitze(&x));
    println!("MESS Pad+Echo Grundstellung: {d:.1} dBFS, Spitze {s:.3}");
    assert!((-26.0..=-16.0).contains(&d), "Pegel {d:.1} dBFS");
    assert!(s < 0.5, "Spitze {s:.3}");
}

#[test]
fn jeder_knob_an_beiden_enden_bleibt_im_rahmen() {
    let mut fehler = Vec::new();
    for nr in 1..=REGLER {
        for weg in [0.0, 1.0] {
            let x = akkord(&[(nr, weg)]);
            let (d, s) = (db(&x), spitze(&x));
            println!("MESS Pad+Echo Knob {nr} = {weg}: {d:.1} dBFS, Spitze {s:.3}");
            let unten = if nr == 4 && weg == 1.0 { -40.0 } else { -32.0 };
            if !(unten..=-12.0).contains(&d) || s >= 0.9 {
                fehler.push(format!("Knob {nr} = {weg}: {d:.1} dBFS, Spitze {s:.3}"));
            }
        }
    }
    assert!(fehler.is_empty(), "{fehler:#?}");
}

#[test]
fn unguenstigster_fall_bleibt_unter_vollaussteuerung() {
    for reso in [0.0, 1.0] {
        let mut p = uebersetze(PAD_ECHO, SR).unwrap();
        for nr in 1..=REGLER {
            p.setze_regler(nr, match nr { 2 => reso, 4 => 0.0, _ => 1.0 });
        }
        for n in [33u8, 40, 45, 49, 52, 57, 61, 64] {
            p.note_an(n, 1.0);
        }
        let x: Vec<(f32, f32)> = (0..4 * 48_000).map(|_| p.sample_stereo()).collect();
        let s = spitze(&x);
        println!("MESS Pad+Echo ungünstigster Fall, Resonanz {reso}: Spitze {s:.3}");
        assert!(s < 1.0, "Spitze {s:.3}");
        assert_eq!(p.rettungen, 0);
    }
}

#[test]
fn echo_setzt_genau_nach_der_delay_zeit_ein() {
    // gleiche Noten, gleiche Knobs: bis 375 ms = 18 000 Samples ist der nasse Weg leer (Hall dahinter ist linear),
    // danach weicht der Pad mit Echo deutlich ab. Das erste abweichende Sample liegt bei 18 000 oder kurz danach: sind
    // die ersten Samples des Pads exakt 0 (Attack ab 0), beginnt auch das Echo später; erlaubt sind 10 ms
    let lauf = |g: &str| {
        let mut p = uebersetze(g, SR).unwrap();
        for nr in 1..=REGLER {
            p.setze_regler(nr, 0.5);
        }
        for n in [45u8, 49, 52, 57] {
            p.note_an(n, 0.8);
        }
        (0..36_000).map(|_| p.sample_stereo()).collect::<Vec<_>>()
    };
    let (ohne, mit) = (lauf(PAD_HALL), lauf(PAD_ECHO));
    let erst = ohne.iter().zip(&mit).position(|(a, b)| a != b).unwrap_or(usize::MAX);
    let abw = ohne[18_000..].iter().zip(&mit[18_000..]).map(|(a, b)| (a.0 - b.0).abs().max((a.1 - b.1).abs())).fold(0.0f32, f32::max);
    println!("MESS erstes abweichendes Sample {erst} (Delay 18000), größte Abweichung danach {abw:.3}");
    assert!((18_000..18_480).contains(&erst), "das Echo setzt bei Sample {erst} ein statt bei 18000");
    assert!(abw > 0.01, "das Echo ist kaum hörbar: {abw}");
}

#[test]
fn echo_macht_breiter_aber_monotauglich() {
    // Ping-Pong legt Wiederholungen abwechselnd links und rechts: dasselbe Echo ohne Ping-Pong ist stärker korreliert.
    // Gegen den Pad mit Hall ist der Pad mit Echo NICHT tiefer korreliert (Plan-Review gemessen 0,611 gegen 0,601): ein
    // anhaltender Akkord legt beide Seiten der Wiederholungen übereinander. Monotauglich: Korrelation über 0,3.
    let k = |g: &str| korrelation(&spiele_graph(g, &[45, 49, 52, 57], &[]));
    let (ohne_pp, mit) = (k(&PAD_ECHO.replace(r#""pingpong": 1"#, r#""pingpong": 0"#)), k(PAD_ECHO));
    println!("MESS Korrelation L/R: Pad+Echo ohne Ping-Pong {ohne_pp:.3}, mit Ping-Pong {mit:.3} (Pad+Hall {:.3})", k(PAD_HALL));
    assert!(mit < ohne_pp && mit > 0.3, "Korrelation {mit} gegen {ohne_pp}");
}
