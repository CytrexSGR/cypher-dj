//! Leitplanken für den Bassmusik-Graphen (Wobble + Growl, Plan 2026-10-30-bassmusik-dubstep-dnb). Sie ersetzen kein
//! Ohr; sie fangen Pegel, Übersteuern an den Reglerenden, einen LFO, der nicht wirkt, und einen LFO, der beim Anschlag
//! nicht neu startet (im VST3 gibt es keinen Host-Takt, der Wobble hängt am Anschlag).
use baukasten_dsp::{uebersetze, REGLER};
mod gemeinsam;
use gemeinsam::*;

const SR: f32 = 48_000.0;
const BASS: &str = include_str!("../beispiele/bassmusik.json");

/// Helligkeit je 50-ms-Fenster: Effektivwert der ersten Differenz (Muster `hell()` in tests/beispiele.rs:15). Der
/// Wobble bewegt die Helligkeit, kaum den Pegel; ein Pegel-RMS in kurzen Fenstern tastet nur die 55-Hz-Welle ab
/// (Plan-Review 30.10., Nachbildung: Tiefe 0 → 10,4 dB „Schwankung" ohne LFO).
fn huellkurve(x: &[(f32, f32)]) -> Vec<f32> {
    let d: Vec<f32> = x.windows(2).map(|w| w[1].0 - w[0].0).collect();
    d.chunks_exact(2400).map(|c| (c.iter().map(|v| v * v).sum::<f32>() / 2400.0).sqrt()).collect()
}

#[test]
fn grundstellung_ist_hoerbar() {
    let x = spiele_graph(BASS, &[33], &[]);
    let (d, s) = (db(&x), spitze(&x));
    println!("MESS Bassmusik Grundstellung A1: {d:.1} dBFS, Spitze {s:.3}");
    assert!((-26.0..=-12.0).contains(&d), "Pegel {d:.1} dBFS");
}

#[test]
fn jeder_knob_an_beiden_enden_bleibt_im_rahmen() {
    let mut fehler = Vec::new();
    for nr in 1..=REGLER {
        for weg in [0.0, 1.0] {
            let x = spiele_graph(BASS, &[33], &[(nr, weg)]);
            let (d, s) = (db(&x), spitze(&x));
            println!("MESS Knob {nr} = {weg}: {d:.1} dBFS, Spitze {s:.3}");
            // Cutoff 0 (80 Hz) bei Wobble-Mitte darf leise sein, ein Bass ist dort fast nur Sub
            let unten = if nr == 1 && weg == 0.0 { -40.0 } else { -32.0 };
            if !(unten..=-9.0).contains(&d) || s >= 0.95 {
                fehler.push(format!("Knob {nr} = {weg}: {d:.1} dBFS, Spitze {s:.3}"));
            }
        }
    }
    assert!(fehler.is_empty(), "{fehler:#?}");
}

#[test]
fn unguenstigster_fall_bleibt_unter_vollaussteuerung() {
    for reso in [0.0, 1.0] {
        let mut p = uebersetze(BASS, SR).unwrap();
        for nr in 1..=REGLER {
            p.setze_regler(nr, if nr == 4 { reso } else { 1.0 });
        }
        for n in [28u8, 33, 40, 45, 52, 57, 64, 69] {
            p.note_an(n, 1.0);
        }
        let x: Vec<(f32, f32)> = (0..4 * 48_000).map(|_| p.sample_stereo()).collect();
        let s = spitze(&x);
        println!("MESS Bassmusik ungünstigster Fall, Resonanz {reso}: Spitze {s:.3}");
        assert!(s < 1.0, "Spitze {s:.3}");
        assert_eq!(p.rettungen, 0);
    }
}

#[test]
fn wobble_tiefe_bewegt_die_huellkurve() {
    // Tiefe 0: Helligkeit nach dem Anschlag ruhig. Tiefe 1 bei Rate-Mitte (2,83 Hz): deutliche Schwankung
    // (Nachbildung im Review: 1,0 dB gegen 10,4 dB).
    let schwankung = |tiefe: f32| {
        let h = huellkurve(&spiele_graph(BASS, &[33], &[(2, tiefe)]));
        let (lo, hi) = h.iter().fold((f32::MAX, 0f32), |(a, b), &v| (a.min(v), b.max(v)));
        20.0 * (hi / lo.max(1e-6)).log10()
    };
    let (ruhig, bewegt) = (schwankung(0.0), schwankung(1.0));
    println!("MESS Wobble Hüllkurven-Hub: Tiefe 0 {ruhig:.1} dB, Tiefe 1 {bewegt:.1} dB");
    assert!(ruhig < 3.0, "ohne Tiefe schwankt es {ruhig:.1} dB");
    assert!(bewegt > 6.0, "mit Tiefe nur {bewegt:.1} dB");
}

#[test]
fn wobble_startet_bei_jedem_anschlag_neu() {
    // Zwei Anschläge derselben Note im Abstand 115_200 Samples = 132 A1- und 66 Sub-Perioden: die frei laufenden
    // Oszillatoren (osz.rs:78-85) stehen wieder in Phase, der LFO (2,83 Hz) läge frei bei 6,79 Perioden. Startet er
    // beim Anschlag neu, sind die ersten 150 ms sampleweise fast gleich; läuft er frei, weichen sie ab.
    // Nachbildung im Review: neustart 1 → 0,017, neustart 0 → 0,258 bei Spitze ~0,25.
    let mut p = uebersetze(BASS, SR).unwrap();
    for nr in 1..=REGLER {
        p.setze_regler(nr, 0.5);
    }
    p.setze_regler(2, 1.0);
    p.setze_regler(5, 0.0); // Growl aus: der Ring-Oszillator (Task 4, 82,4 Hz) ist im Abstand nicht kohärent
    let n = 7_200; // 150 ms
    p.note_an(33, 0.8);
    let a: Vec<(f32, f32)> = (0..n).map(|_| p.sample_stereo()).collect();
    let _: Vec<(f32, f32)> = (0..(19_200 - n)).map(|_| p.sample_stereo()).collect();
    p.note_aus(33);
    let _: Vec<(f32, f32)> = (0..96_000).map(|_| p.sample_stereo()).collect();
    p.note_an(33, 0.8);
    let b: Vec<(f32, f32)> = (0..n).map(|_| p.sample_stereo()).collect();
    let abw = a.iter().zip(&b).map(|(x, y)| (x.0 - y.0).abs()).fold(0f32, f32::max);
    println!("MESS Wobble Neustart: größte Abweichung {abw:.3} bei Spitze {:.3}", spitze(&a));
    assert!(abw < 0.15 * spitze(&a), "LFO startet nicht neu: {abw:.3}");
}

#[test]
fn still_ohne_note() {
    let mut p = uebersetze(BASS, SR).unwrap();
    assert!((0..48_000).all(|_| p.sample_stereo() == (0.0, 0.0)));
}

#[test]
fn growl_veraendert_den_klang_und_bleibt_im_rahmen() {
    // Growl 0 und 1 bei sonst Mitte: der spektrale Schwerpunkt muss sich deutlich verschieben, der Pegel im Rahmen bleiben
    let ohne = spiele_graph(BASS, &[33], &[(5, 0.0)]);
    let mit = spiele_graph(BASS, &[33], &[(5, 1.0)]);
    let (so, sm) = (schwerpunkt(&ohne), schwerpunkt(&mit));
    println!("MESS Growl Schwerpunkt: 0 → {so:.0} Hz, 1 → {sm:.0} Hz; Pegel {:.1} / {:.1} dBFS", db(&ohne), db(&mit));
    assert!((sm - so).abs() > 150.0, "Growl bewegt den Schwerpunkt nur {:.0} Hz", (sm - so).abs());
    // Richtung: Ringmodulation + Bandpass macht heller; ein falsch verdrahteter Überblend-Regler (Probe 30.10.: 213 → 50 Hz) fällt hier auf
    assert!(sm > so, "Growl macht dunkler: {so:.0} → {sm:.0} Hz");
    assert!((-30.0..=-9.0).contains(&db(&mit)));
}
