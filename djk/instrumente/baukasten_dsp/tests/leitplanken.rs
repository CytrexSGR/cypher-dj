//! Klang-Leitplanken für das Pad (Slice 2b, D6). Sie ersetzen kein Ohr, sie fangen die drei Fehlerklassen aus Andreas'
//! Hörrunden am 2026-10-28 vor dem Hören: „die pads sind kaum hörbar“ (Pegel), „pad auf wirkt eher wie rauschen“
//! (Spektral-Flachheit bei offenem Filter) und Übersteuern an den Reglerenden (jeder Knob an beiden Enden, die übrigen
//! auf 0,5, dazu der ungünstigste Fall).
use baukasten_dsp::{uebersetze, Programm, REGLER};
mod gemeinsam;
use gemeinsam::*;

const SR: f32 = 48_000.0;
const PAD: &str = include_str!("../beispiele/juno-pad.json");

fn spiele(noten: &[u8], regler: &[(usize, f32)]) -> Vec<(f32, f32)> { spiele_graph(PAD, noten, regler) }

fn akkord(regler: &[(usize, f32)]) -> Vec<(f32, f32)> { spiele(&[45, 49, 52, 57], regler) }

#[test]
fn grundstellung_ist_hoerbar() {
    // Lead in derselben Messung: −13,8 dBFS; das S2-Pad lag bei −18,1 erst nach der Pegel-Korrektur
    let x = akkord(&[]);
    let (d, s) = (db(&x), spitze(&x));
    println!("MESS Pad Grundstellung: {d:.1} dBFS, Spitze {s:.3}");
    assert!((-26.0..=-16.0).contains(&d), "Pegel {d:.1} dBFS");
}

#[test]
fn offen_klingt_nach_toenen_nicht_nach_rauschen() {
    // Einzelton A3, Filter ganz offen: geeicht sauber 0,002, mit Rauschquelle 0,02 dazu 0,019, mit 0,06 dazu 0,07
    let f = flachheit(&spiele(&[57], &[(1, 1.0)]));
    println!("MESS Pad offen, Flachheit 1–8 kHz {f:.4}");
    assert!(f < 0.006, "Flachheit {f:.4}");
}

#[test]
fn jeder_knob_an_beiden_enden_bleibt_im_rahmen() {
    let mut fehler = Vec::new();
    for nr in 1..=REGLER {
        for weg in [0.0, 1.0] {
            let x = akkord(&[(nr, weg)]);
            let (d, s) = (db(&x), spitze(&x));
            println!("MESS Knob {nr} = {weg}: {d:.1} dBFS, Spitze {s:.3}");
            // Knob 4 (Attack) auf 1 = 5 s: in der zweiten Sekunde noch im Anstieg, deshalb tiefer erlaubt
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
    // acht Stimmen im selben Sample angeschlagen (die Oszillatoren starten phasengleich, ihre Spitzen addieren sich),
    // alle Knobs auf 1 außer Attack, Resonanz an beiden Enden, Velocity 1. Die weiche Begrenzung am Ende (saett je
    // Seite, D6) hält das unter 1; ohne sie gemessen 4,11 (Resonanz 0) und 1,52 (Resonanz 1) bei Hochpass 40 Hz und Pegel 0,4 (Hochpass 90 Hz, Pegel 0,5: 3,18 und 1,20).
    for reso in [0.0, 1.0] {
        let mut p = uebersetze(PAD, SR).unwrap();
        for nr in 1..=REGLER {
            p.setze_regler(nr, match nr { 2 => reso, 4 => 0.0, _ => 1.0 });
        }
        for n in [33u8, 40, 45, 49, 52, 57, 61, 64] {
            p.note_an(n, 1.0);
        }
        let x: Vec<(f32, f32)> = (0..4 * 48_000).map(|_| p.sample_stereo()).collect();
        let s = spitze(&x);
        println!("MESS Pad ungünstigster Fall, Resonanz {reso}: Spitze {s:.3}");
        assert!(s < 1.0, "Spitze {s:.3}");
    }
}

#[test]
fn begrenzung_greift_in_grundstellung_kaum() {
    // Spitze im Fenster 1–2 s (so misst `akkord`) unter 0,5; die Spitze der ganzen Note liegt in der ersten Sekunde bei
    // 0,458 (Ausgang hinter tanh, Eingang gerechnet ~0,495). Dort staucht tanh real um etwa 0,7 dB, der Effektivwert bleibt
    // praktisch linear.
    let s = spitze(&akkord(&[]));
    println!("MESS Pad Grundstellung Spitze (Fenster 1-2 s) {s:.3}");
    assert!(s < 0.5, "Spitze {s:.3}");
}

#[test]
fn pad_ist_breit_und_chorus_regler_wirkt() {
    // Ist (Hochpass 40 Hz): Korrelation 0,665 in Grundstellung (vorher mit 90 Hz 0,596, Render über 5 s 0,621); ohne Chorus
    // (Knob 8 = 0) sind beide Seiten gleich, 1,0000.
    // Fängt Modus 0 im Pad und eine tote Kante k_chorus -> chorus.mix.
    let breit = korrelation(&akkord(&[]));
    let mono = korrelation(&akkord(&[(8, 0.0)]));
    println!("MESS Pad Korrelation L/R Grundstellung {breit:.3}, Chorus (Knob 8) = 0: {mono:.4}");
    assert!(breit < 0.98, "Korrelation {breit:.3}");
    assert!(mono > 0.999, "Korrelation ohne Chorus {mono:.4}");
}

#[test]
fn sub_regler_wirkt() {
    // Knob 7 (Sub) 0 gegen 1 am Akkord: Ist −24,7 gegen −15,4 dBFS, also 9,2 dB (Hochpass 90 Hz, Pegel 0,5: 6,7 dB). Schwelle 3 dB.
    let (aus, an) = (db(&akkord(&[(7, 0.0)])), db(&akkord(&[(7, 1.0)])));
    println!("MESS Pad Sub: Knob 7 = 0 {aus:.1} dBFS, = 1 {an:.1} dBFS, Abstand {:.1} dB", an - aus);
    assert!(an - aus >= 3.0, "Sub-Abstand {:.1} dB", an - aus);
}

#[test]
fn filterhuellkurve_und_cutoff_machen_heller() {
    // Spektraler Schwerpunkt des Akkords (zweite Sekunde). Cutoff und Hüllkurve verschieben die Obertöne kaum im
    // Pegel (≤ 0,1 dB), wohl aber den Schwerpunkt: Ist (Hochpass 40 Hz): Env amount 0 → 1 bei Cutoff 0: 89 → 244 Hz (Faktor 2,7); Cutoff 0 → 1: 200 → 297 Hz (Faktor 1,5).
    // Schwellen: Faktor 1,3. Mit Hochpass 90 Hz waren es 103 → 376 und 301 → 471 Hz.
    let c = |regler: &[(usize, f32)]| schwerpunkt(&akkord(regler));
    let (env0, env1) = (c(&[(1, 0.0), (3, 0.0)]), c(&[(1, 0.0), (3, 1.0)]));
    let (cut0, cut1) = (c(&[(1, 0.0)]), c(&[(1, 1.0)]));
    println!("MESS Schwerpunkt: Env amount 0 {env0:.0} Hz, 1 {env1:.0} Hz (Cutoff 0); Cutoff 0 {cut0:.0} Hz, 1 {cut1:.0} Hz");
    assert!(env1 > env0 * 1.3, "Env amount: {env0:.0} -> {env1:.0} Hz");
    assert!(cut1 > cut0 * 1.3, "Cutoff: {cut0:.0} -> {cut1:.0} Hz");
}

#[test]
fn release_regler_wirkt() {
    // Akkord 1 s halten, alle Noten aus, Pegel im Fenster 0,3–0,8 s danach: Knob 5 = 0 (0,3 s) gegen 1 (8 s).
    // Ist: −92,6 gegen −23,2 dBFS, Abstand 69,4 dB (Knob 5 = 0 ist nach 0,3 s praktisch still). Schwelle 10 dB.
    let nach_ende = |w: f32| {
        let mut p: Programm = uebersetze(PAD, SR).unwrap();
        for nr in 1..=REGLER {
            p.setze_regler(nr, 0.5);
        }
        p.setze_regler(5, w);
        for n in [45u8, 49, 52, 57] {
            p.note_an(n, 0.8);
        }
        for _ in 0..48_000 {
            p.sample_stereo();
        }
        for n in [45u8, 49, 52, 57] {
            p.note_aus(n);
        }
        let x: Vec<(f32, f32)> = (0..(0.8 * 48_000.0) as usize).map(|_| p.sample_stereo()).collect();
        db(&x[(0.3 * 48_000.0) as usize..])
    };
    let (kurz, lang) = (nach_ende(0.0), nach_ende(1.0));
    println!("MESS Pad Release: Knob 5 = 0 {kurz:.1} dBFS, = 1 {lang:.1} dBFS, Abstand {:.1} dB", lang - kurz);
    assert!(lang - kurz >= 10.0, "Release-Abstand {:.1} dB", lang - kurz);
}

#[test]
fn pwm_regler_wirkt() {
    // Einzelton A3, zweite Sekunde: Knob 6 (PWM depth) 0 gegen 1. Maß: Effektivwert der Differenz beider Ausgänge im
    // Verhältnis zum Effektivwert von Knob 6 = 0. Fängt die Kanten lfo -> pwm.a und pwm -> puls.pwm (jede für sich).
    let (a, b) = (spiele(&[57], &[(6, 0.0)]), spiele(&[57], &[(6, 1.0)]));
    let eff = |v: &[f64]| (v.iter().map(|x| x * x).sum::<f64>() / v.len() as f64).sqrt();
    let diff: Vec<f64> = a.iter().zip(&b).flat_map(|(x, y)| [(x.0 - y.0) as f64, (x.1 - y.1) as f64]).collect();
    let ref0: Vec<f64> = a.iter().flat_map(|x| [x.0 as f64, x.1 as f64]).collect();
    let m = eff(&diff) / eff(&ref0);
    println!("MESS Pad PWM: Differenz Knob 6 = 0 gegen 1, relativ {m:.3}");
    // Ist 1,031; ohne eine der beiden Kanten 0,000 (gemessen). Schwelle 0,8.
    assert!(m > 0.8, "PWM-Differenz {m:.3}");
}

#[test]
fn attack_regler_wirkt() {
    // Akkord, Pegel der ersten 0,5 s: Knob 4 (Attack) 0 (0,05 s) gegen 1 (5 s)
    let erste = |w: f32| {
        let mut p: Programm = uebersetze(PAD, SR).unwrap();
        for nr in 1..=REGLER {
            p.setze_regler(nr, 0.5);
        }
        p.setze_regler(4, w);
        for n in [45u8, 49, 52, 57] {
            p.note_an(n, 0.8);
        }
        let x: Vec<(f32, f32)> = (0..24_000).map(|_| p.sample_stereo()).collect();
        db(&x)
    };
    let (kurz, lang) = (erste(0.0), erste(1.0));
    println!("MESS Pad Attack: Knob 4 = 0 {kurz:.1} dBFS, = 1 {lang:.1} dBFS in den ersten 0,5 s, Abstand {:.1} dB", kurz - lang);
    assert!(kurz - lang >= 10.0, "Attack-Abstand {:.1} dB", kurz - lang);
}
