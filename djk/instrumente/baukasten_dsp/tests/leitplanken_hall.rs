//! Klang-Leitplanken für den Pad mit Hall (Slice 4a). Dieselben Fehlerklassen wie leitplanken.rs (Pegel, Rauschen,
//! Übersteuern an den Enden), dazu: der Hall wirkt (Nachklang), und mit mix 0 ist der Pad bitgleich mit Pad v2. Rauschen (Flachheit) siehe Kommentar unten.
mod gemeinsam;
use baukasten_dsp::{uebersetze, REGLER};
use gemeinsam::*;

const SR: f32 = 48_000.0;
const PAD: &str = include_str!("../beispiele/juno-pad.json");
const PAD_HALL: &str = include_str!("../beispiele/juno-pad-hall.json");

fn akkord(regler: &[(usize, f32)]) -> Vec<(f32, f32)> { spiele_graph(PAD_HALL, &[45, 49, 52, 57], regler) }

#[test]
fn grundstellung_ist_hoerbar() {
    let x = akkord(&[]);
    let (d, s) = (db(&x), spitze(&x));
    println!("MESS Pad+Hall Grundstellung: {d:.1} dBFS, Spitze {s:.3}");
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
            println!("MESS Pad+Hall Knob {nr} = {weg}: {d:.1} dBFS, Spitze {s:.3}");
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
        let mut p = uebersetze(PAD_HALL, SR).unwrap();
        for nr in 1..=REGLER {
            p.setze_regler(nr, match nr { 2 => reso, 4 => 0.0, _ => 1.0 });
        }
        for n in [33u8, 40, 45, 49, 52, 57, 61, 64] {
            p.note_an(n, 1.0);
        }
        let x: Vec<(f32, f32)> = (0..4 * 48_000).map(|_| p.sample_stereo()).collect();
        let s = spitze(&x);
        println!("MESS Pad+Hall ungünstigster Fall, Resonanz {reso}: Spitze {s:.3}");
        assert!(s < 1.0, "Spitze {s:.3}");
        assert_eq!(p.rettungen, 0);
    }
}

// Kein Flachheits-Test: ein diffuser Hallschwanz füllt die Obertonlücken absichtlich (Plan-Review gemessen 0,041 gegen
// 0,002 ohne Hall), die Spektral-Flachheit trennt hier nicht mehr Ton von Rauschen. Rauschen in der Stimmkette fängt
// leitplanken.rs am Pad v2; mit_mix_null_bitgleich_mit_pad_v2 zeigt, dass die Kette vor dem Hall dieselbe ist.

#[test]
fn hall_klingt_nach_dem_loslassen_nach() {
    // Akkord 1 s, loslassen, Fenster 1,5–2,0 s nach dem Loslassen: mit Hall deutlich lauter als ohne (Release 1,5 s
    // in Grundstellung; ohne Hall ist der Pad dort im Ausklang)
    let nach = |g: &str| {
        let mut p = uebersetze(g, SR).unwrap();
        for nr in 1..=REGLER {
            p.setze_regler(nr, 0.5);
        }
        for n in [45u8, 49, 52, 57] {
            p.note_an(n, 0.8);
        }
        for _ in 0..48_000 {
            p.sample_stereo();
        }
        p.alle_aus();
        let x: Vec<(f32, f32)> = (0..96_000).map(|_| p.sample_stereo()).collect();
        db(&x[72_000..])
    };
    let (ohne, mit) = (nach(PAD), nach(PAD_HALL));
    println!("MESS Nachklang 1,5–2,0 s nach dem Loslassen: ohne Hall {ohne:.1} dBFS, mit Hall {mit:.1} dBFS");
    assert!(mit > ohne + 6.0, "der Hall verlängert den Ausklang nicht: {ohne:.1} gegen {mit:.1}");
}

#[test]
fn mit_mix_null_bitgleich_mit_pad_v2() {
    let j = PAD_HALL.replace(r#""mix": 0.25"#, r#""mix": 0"#);
    assert_ne!(j, PAD_HALL, "Muster nicht gefunden");
    let (mut a, mut b) = (uebersetze(PAD, SR).unwrap(), uebersetze(&j, SR).unwrap());
    for p in [&mut a, &mut b] {
        for nr in 1..=REGLER {
            p.setze_regler(nr, 0.5);
        }
        for n in [45u8, 49, 52, 57] {
            p.note_an(n, 0.8);
        }
    }
    for i in 0..48_000 {
        assert_eq!(a.sample_stereo(), b.sample_stereo(), "Sample {i}");
    }
}

#[test]
fn hall_macht_breiter_aber_monotauglich() {
    // Korrelation L/R des Akkords: mit Hall niedriger als ohne (der Hall verbreitert), aber über 0,3 (Monosumme bleibt
    // tragfähig). `"breite": 0` im Hall würde die Seiten angleichen (Gegenprobe als Mutation in mutation.py).
    let (ohne, mit) = (korrelation(&spiele_graph(PAD, &[45, 49, 52, 57], &[])), korrelation(&akkord(&[])));
    println!("MESS Pad Korrelation L/R: ohne Hall {ohne:.3}, mit Hall {mit:.3}");
    assert!(mit < ohne, "der Hall macht nicht breiter: {mit:.3} gegen {ohne:.3}");
    assert!(mit > 0.3, "zu wenig Mono-Anteil: {mit:.3}");
}
