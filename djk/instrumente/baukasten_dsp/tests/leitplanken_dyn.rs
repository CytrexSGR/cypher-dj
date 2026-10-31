//! Klang-Leitplanken für den Pad mit Komp und Limiter (Slice 4c): Pegel, Knob-Enden, ungünstigster Fall unter der Decke
//! des Limiters (vor dem tanh-Begrenzer), gemeldete Latenz und stille erste Samples.
mod gemeinsam;
use baukasten_dsp::{uebersetze, REGLER};
use gemeinsam::*;

const SR: f32 = 48_000.0;
const PAD_ECHO: &str = include_str!("../beispiele/juno-pad-echo.json");
const PAD_DYN: &str = include_str!("../beispiele/juno-pad-dyn.json");

fn akkord(g: &str, regler: &[(usize, f32)]) -> Vec<(f32, f32)> { spiele_graph(g, &[45, 49, 52, 57], regler) }

#[test]
fn grundstellung_ist_hoerbar() {
    let x = akkord(PAD_DYN, &[]);
    let (d, s) = (db(&x), spitze(&x));
    let e = akkord(PAD_ECHO, &[]);
    println!("MESS Pad+Dyn Grundstellung: {d:.1} dBFS, Spitze {s:.3}, Scheitelfaktor {:.2} (Pad+Echo {:.2})",
             s / 10f32.powf(d / 20.0), spitze(&e) / 10f32.powf(db(&e) / 20.0));
    assert!((-26.0..=-16.0).contains(&d), "Pegel {d:.1} dBFS");
    assert!(s < 0.5, "Spitze {s:.3}");
}

#[test]
fn jeder_knob_an_beiden_enden_bleibt_im_rahmen() {
    let mut fehler = Vec::new();
    for nr in 1..=REGLER {
        for weg in [0.0, 1.0] {
            let x = akkord(PAD_DYN, &[(nr, weg)]);
            let (d, s) = (db(&x), spitze(&x));
            println!("MESS Pad+Dyn Knob {nr} = {weg}: {d:.1} dBFS, Spitze {s:.3}");
            let unten = if nr == 4 && weg == 1.0 { -40.0 } else { -32.0 };
            if !(unten..=-12.0).contains(&d) || s >= 0.9 {
                fehler.push(format!("Knob {nr} = {weg}: {d:.1} dBFS, Spitze {s:.3}"));
            }
        }
    }
    assert!(fehler.is_empty(), "{fehler:#?}");
}

#[test]
fn unguenstigster_fall_bleibt_unter_der_decke() {
    // Limiter −1 dBFS vor dem tanh-Begrenzer: am Ausgang höchstens tanh(10^(−1/20)) = 0,7120 (ADAA mittelt tanh über
    // das Segment, bleibt also darunter); ohne Limiter läge die Spitze bei 0,996 (leitplanken_echo)
    let grenze = (10f64.powf(-1.0 / 20.0)).tanh() as f32;
    for reso in [0.0, 1.0] {
        let mut p = uebersetze(PAD_DYN, SR).unwrap();
        for nr in 1..=REGLER {
            p.setze_regler(nr, match nr { 2 => reso, 4 => 0.0, _ => 1.0 });
        }
        for n in [33u8, 40, 45, 49, 52, 57, 61, 64] {
            p.note_an(n, 1.0);
        }
        let x: Vec<(f32, f32)> = (0..4 * 48_000).map(|_| p.sample_stereo()).collect();
        let s = spitze(&x);
        println!("MESS Pad+Dyn ungünstigster Fall, Resonanz {reso}: Spitze {s:.4} (Grenze {grenze:.4})");
        assert!(s <= grenze + 1e-4, "Spitze {s:.4} über {grenze:.4}");
        assert_eq!(p.rettungen, 0);
    }
}

#[test]
fn latenz_wird_gemeldet_und_die_ersten_samples_sind_still() {
    let mut p = uebersetze(PAD_DYN, SR).unwrap();
    assert_eq!(p.latenz(), 95, "Limiter 2 ms bei 48 kHz");
    assert_eq!(uebersetze(PAD_ECHO, SR).unwrap().latenz(), 0);
    for n in [45u8, 49, 52, 57] {
        p.note_an(n, 1.0);
    }
    let x: Vec<(f32, f32)> = (0..200).map(|_| p.sample_stereo()).collect();
    assert!(x[..95].iter().all(|v| *v == (0.0, 0.0)), "vor der Latenz kommt nichts");
}
