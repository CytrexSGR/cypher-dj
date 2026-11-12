//! The `trommeln` block (type 47) and the graphs `drums-909` / `drums-808`: input list, note map, kick and tom tuning,
//! level, DC and clipping at the knob extremes, hat choke, click safety on a retrigger, velocity, clap bursts, determinism and cost
//! of 16 simultaneous hits. Everything goes through the public JSON API, so the numbers are what a graph plays.
use baukasten_dsp::trommeln::{EIN, PARAMETER};
use baukasten_dsp::{uebersetze, Programm, ARTEN};
use realfft::RealFftPlanner;

const SR: f32 = 48_000.0;
const G909: &str = include_str!("../demos/drums-909.json");
const G808: &str = include_str!("../demos/drums-808.json");

fn lade(g: &str) -> Programm { uebersetze(g, SR).unwrap_or_else(|e| panic!("{e}")) }

/// Plays `hits` (second, note, velocity), each released 0.125 s later, for `dauer` seconds; knobs at 0.5 unless `knoepfe` says otherwise.
fn spiele(g: &str, hits: &[(f32, u8, f32)], dauer: f32, knoepfe: &[(usize, f32)]) -> Vec<f32> {
    let mut p = lade(g);
    for (n, w) in knoepfe {
        p.setze_regler(*n, *w);
    }
    let mut ereignisse: Vec<(usize, bool, u8, f32)> = vec![];
    for (t, n, v) in hits {
        ereignisse.push(((t * SR) as usize, true, *n, *v));
        ereignisse.push((((t + 0.125) * SR) as usize, false, *n, 0.0));
    }
    ereignisse.sort_by_key(|e| (e.0, e.1));
    let mut ei = 0;
    let mut y = Vec::new();
    for i in 0..(dauer * SR) as usize {
        while ei < ereignisse.len() && ereignisse[ei].0 <= i {
            let (_, an, n, v) = ereignisse[ei];
            if an { p.note_an(n, v) } else { p.note_aus(n) }
            ei += 1;
        }
        let (l, r) = p.sample_stereo();
        assert!(l.is_finite() && r.is_finite());
        y.push(0.5 * (l + r));
    }
    assert_eq!(p.rettungen, 0);
    y
}

fn spitze(x: &[f32]) -> f32 { x.iter().fold(0.0f32, |m, v| m.max(v.abs())) }

fn rms_db(x: &[f32]) -> f64 { 10.0 * (x.iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / x.len().max(1) as f64).max(1e-30).log10() }

/// Frequency of the strongest spectral line in `x[a..b]` (seconds), Hann window, zero-padded to 2^18.
fn grundton(x: &[f32], a: f32, b: f32) -> f64 {
    let seg: Vec<f64> = x[(a * SR) as usize..(b * SR) as usize].iter().enumerate().map(|(i, v)| {
        let n = (b * SR) as usize - (a * SR) as usize;
        *v as f64 * (0.5 - 0.5 * (2.0 * std::f64::consts::PI * i as f64 / n as f64).cos())
    }).collect();
    let n = 1 << 18;
    let mut puffer = vec![0.0f64; n];
    puffer[..seg.len()].copy_from_slice(&seg);
    let mut fft = RealFftPlanner::<f64>::new();
    let r2c = fft.plan_fft_forward(n);
    let mut s = r2c.make_output_vec();
    r2c.process(&mut puffer, &mut s).unwrap();
    let (i, _) = s.iter().enumerate().max_by(|a, b| a.1.norm_sqr().partial_cmp(&b.1.norm_sqr()).unwrap()).unwrap();
    i as f64 * SR as f64 / n as f64
}

#[test]
fn trommeln_ist_art_47_und_die_tabelle_stimmt_mit_arten_ueberein() {
    let nr = ARTEN.iter().position(|a| a.art == "trommeln").expect("ARTEN has no entry trommeln");
    assert!(nr >= 47, "trommeln is appended after the 47 earlier blocks, found at {nr}");
    let a = &ARTEN[nr];
    assert_eq!(a.ein, &EIN, "the run arm reads the inputs in the order of trommeln::EIN");
    assert_eq!(a.aus, &["aus"]);
    assert!(a.werte.is_empty());
    for (name, vorgabe, _, _) in PARAMETER.iter() {
        assert!(a.frei.contains(&(*name, *vorgabe)), "{name} default {vorgabe} missing in ARTEN.frei");
    }
    for f in [("modell", 0.0), ("schnitt", 8.0), ("saat", 0.0)] {
        assert!(a.frei.contains(&f), "{f:?}");
    }
    assert_eq!(a.frei.len(), PARAMETER.len() + 3);
}

#[test]
fn falsche_werte_werden_abgelehnt() {
    let mit = |w: &str| format!(r#"{{"format":"baukasten/2","name":"t","stimmen":4,"knoten":[{{"id":"n","art":"note"}},{{"id":"k","art":"trommeln"{w}}},{{"id":"o","art":"ausgang"}}],"kanten":[{{"von":"n.trig","nach":"k.trig"}},{{"von":"n.hz","nach":"k.hz"}},{{"von":"k.aus","nach":"o.x"}}]}}"#);
    assert!(uebersetze(&mit(""), SR).is_ok());
    for w in [r#","modell":2"#, r#","schnitt":0"#, r#","saat":1.5"#, r#","kick_tune":10"#, r#","oh_decay":9000"#, r#","hat_tone":1.5"#] {
        assert!(uebersetze(&mit(w), SR).is_err(), "{w} must be refused");
    }
}

#[test]
fn kick_und_toms_sind_gestimmt() {
    // knob 0.5 = the node default of the graph; FFT line of the settled part (0.2..0.5 s), within 1.5 %
    for (g, name, soll_kick, tom) in [(G909, "909", 54.0, [85.0, 127.3, 190.9]), (G808, "808", 50.2, [80.0, 120.0, 165.4])] {
        let k = spiele(g, &[(0.0, 36, 0.9)], 0.8, &[]);
        let f = grundton(&k, 0.2, 0.5);
        println!("MESS {name} kick fundamental {f:.2} Hz (target {soll_kick})");
        assert!((f / soll_kick - 1.0).abs() < 0.015, "{name} kick {f}");
        for (note, soll) in [41u8, 45, 48].into_iter().zip(tom) {
            let t = spiele(g, &[(0.0, note, 0.9)], 0.8, &[]);
            let f = grundton(&t, 0.15, 0.4);
            println!("MESS {name} tom {note} fundamental {f:.2} Hz (target {soll})");
            assert!((f / soll - 1.0).abs() < 0.02, "{name} tom {note}: {f}");
        }
    }
    // the tune knob moves the fundamental: 909 knob 1 = 36 .. 81 Hz
    for (w, soll) in [(0.0, 36.0), (1.0, 81.0)] {
        let f = grundton(&spiele(G909, &[(0.0, 36, 0.9)], 0.8, &[(1, w)]), 0.2, 0.5);
        println!("MESS 909 kick tune knob {w}: {f:.2} Hz (target {soll})");
        assert!((f / soll - 1.0).abs() < 0.02, "knob {w}: {f}");
    }
}

#[test]
fn kick_hat_jede_trommel_hoerbar_und_unter_der_grenze() {
    // every drum alone at the default knobs: audible (peak above 0.2) and clear of clipping (below 0.9)
    for (g, name, noten) in [(G909, "909", vec![36u8, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 53, 55, 57, 59]),
                             (G808, "808", vec![35, 36, 37, 38, 39, 41, 42, 44, 45, 46, 48, 49, 51, 56, 75])] {
        for n in noten {
            let x = spiele(g, &[(0.0, n, 0.9)], 3.0, &[]);
            let (p, r) = (spitze(&x), rms_db(&x[..14_400]));
            println!("MESS {name} note {n:3}: peak {p:.3}  rms(0.3 s) {r:6.1} dB");
            assert!(p > 0.2 && p < 0.9, "{name} note {n}: peak {p}");
        }
    }
    // the 909 has no cowbell and no clave: note 75 is silent, 56 plays the splash
    assert_eq!(spitze(&spiele(G909, &[(0.0, 75, 0.9)], 0.5, &[])), 0.0);
    assert_eq!(spitze(&spiele(G909, &[(0.0, 100, 0.9)], 0.5, &[])), 0.0);
    assert!(spitze(&spiele(G909, &[(0.0, 56, 0.9)], 0.5, &[])) > 0.1);
    // every note up to 74 plays on both kits (the next listed note below it)
    for n in 0..=74u8 {
        for g in [G909, G808] {
            assert!(spitze(&spiele(g, &[(0.0, n, 0.9)], 0.3, &[])) > 0.05, "note {n}");
        }
    }
}

#[test]
fn knopfextreme_ohne_clipping_nan_und_gleichanteil() {
    let alle = [36u8, 38, 39, 37, 41, 45, 48, 42, 46, 44, 49, 51, 56, 75, 35];
    for (g, name) in [(G909, "909"), (G808, "808")] {
        for w in [0.0f32, 1.0] {
            // the Level knob (silence at 0) stays at its middle for the extremes of everything else; the level extreme comes after
            let level = if name == "909" { 31 } else { 30 };
            let knoepfe: Vec<(usize, f32)> = (1..=32).map(|n| (n, if n == level { 0.5 } else { w })).collect();
            // the whole kit in a row, then a stack of everything at once for the worst peak
            let mut hits: Vec<(f32, u8, f32)> = alle.iter().enumerate().map(|(i, n)| (i as f32 * 0.4, *n, 1.0)).collect();
            hits.extend(alle.iter().map(|n| (7.0, *n, 1.0)));
            let x = spiele(g, &hits, 12.0, &knoepfe);
            let mittel = x.iter().map(|v| *v as f64).sum::<f64>() / x.len() as f64;
            let p = spitze(&x);
            println!("MESS {name} all knobs {w}: peak {p:.3}, mean {mittel:.5} ({:.1} dBFS)", 20.0 * mittel.abs().max(1e-9).log10());
            assert!(p > 0.1, "positive control: the kit plays at knobs {w} (peak {p})");
            assert!(p < 1.0, "{name} knobs {w}: peak {p} clips");
            assert!(mittel.abs() < 10f64.powf(-50.0 / 20.0), "{name} knobs {w}: DC {mittel}");
        }
    }
}

#[test]
fn offene_hihat_wird_von_der_geschlossenen_abgewuergt() {
    for (g, name) in [(G909, "909"), (G808, "808")] {
        // open hat at 0, closed hat at 0.1 s; the closed hat itself is gone by 0.2 s (decay 55 ms), so what is left is the open hat
        let mit = spiele(g, &[(0.0, 46, 0.9), (0.1, 42, 0.9)], 1.0, &[]);
        let ohne = spiele(g, &[(0.0, 46, 0.9)], 1.0, &[]);
        let fenster = |x: &[f32]| rms_db(&x[(0.2 * SR) as usize..(0.3 * SR) as usize]);
        println!("MESS {name} open hat 0.2..0.3 s: with choke {:.1} dB, without {:.1} dB", fenster(&mit), fenster(&ohne));
        assert!(fenster(&ohne) > -60.0, "positive control: the open hat still rings at 0.42 s");
        assert!(fenster(&mit) < fenster(&ohne) - 25.0, "{name}: the open hat must be cut");
        // no step: the cut is an exponential fall within 8 ms, so the largest sample difference at the cut stays below the strike's own
        let schritt = |x: &[f32], a: f32, b: f32| x[(a * SR) as usize..(b * SR) as usize].windows(2).fold(0.0f32, |m, w| m.max((w[1] - w[0]).abs()));
        assert!(schritt(&mit, 0.1, 0.15) <= schritt(&mit, 0.0, 0.05) * 1.5 + 0.02);
    }
}

#[test]
fn wiederholter_schlag_macht_keinen_sprung() {
    // the same kick twice, the second strike while the first still rings (the carried residual fades over 1 ms)
    for (g, name) in [(G909, "909"), (G808, "808")] {
        let x = spiele(g, &[(0.0, 36, 0.9), (0.2, 36, 0.9)], 0.6, &[(2, 1.0), (7, 0.0)]);
        let schritt = |a: f32, b: f32| x[(a * SR) as usize..(b * SR) as usize].windows(2).fold(0.0f32, |m, w| m.max((w[1] - w[0]).abs()));
        let (erster, zweiter) = (schritt(0.0, 0.02), schritt(0.2, 0.22));
        println!("MESS {name} largest sample step: first strike {erster:.4}, retrigger {zweiter:.4}");
        assert!(zweiter < erster * 1.3 + 0.01, "{name}: retrigger step {zweiter} against {erster}");
        // and a stolen voice: a snare right after a ringing crash on the same voice would be a step without the carry; sixteen
        // voices make that rare, the same note is the common case, so only the kick is checked here
    }
}

#[test]
fn anschlag_der_tonalen_trommeln_beginnt_bei_null() {
    // the kick body ramps up over 0.5 ms; the click (knob 10) is the wanted transient and is switched off here
    for g in [G909, G808] {
        let x = spiele(g, &[(0.0, 36, 0.9)], 0.05, &[(7, 0.0), (10, 0.0)]);
        assert!(x[0] == 0.0 && x[..3].iter().all(|v| v.abs() < 0.02), "first samples {:?}", &x[..4]);
        // 1 ms later the body is audible: the ramp is a ramp, not a mute
        assert!(x[48..96].iter().any(|v| v.abs() > 0.05));
    }
}

#[test]
fn geschwindigkeit_skaliert_den_pegel() {
    for g in [G909, G808] {
        for n in [36u8, 38, 42] {
            let laut = spitze(&spiele(g, &[(0.0, n, 0.8)], 1.0, &[(7, 0.0)]));
            let leise = spitze(&spiele(g, &[(0.0, n, 0.4)], 1.0, &[(7, 0.0)]));
            println!("MESS note {n}: vel 0.8 peak {laut:.3}, vel 0.4 peak {leise:.3}, ratio {:.2}", leise / laut);
            assert!(leise / laut > 0.4 && leise / laut < 0.65, "note {n}: ratio {}", leise / laut);
        }
    }
}

#[test]
fn klatsche_hat_vier_einsaetze() {
    // three bursts `clap_spread` apart and the tail: the 1 ms envelope has a peak near 0, D, 2D and 3D with dips between
    for (g, name) in [(G909, "909"), (G808, "808")] {
        let x = spiele(g, &[(0.0, 39, 0.9)], 0.3, &[(7, 0.0)]);
        let hue: Vec<f32> = (0..(0.06 * SR) as usize / 48).map(|i| x[i * 48..i * 48 + 48].iter().map(|v| v.abs()).fold(0.0, f32::max)).collect();
        let anstiege = hue.windows(2).filter(|w| w[1] > w[0] * 2.0 && w[1] > 0.05).count();
        println!("MESS {name} clap: {anstiege} envelope rises above x2 in the first 60 ms");
        assert!(anstiege >= 3, "{name}: {anstiege} rises");
    }
}

#[test]
fn bit_gleich_bei_zweiter_instanz() {
    for g in [G909, G808] {
        let hits: Vec<(f32, u8, f32)> = [36u8, 38, 42, 46, 49, 51, 39, 41].iter().enumerate().map(|(i, n)| (i as f32 * 0.2, *n, 0.8)).collect();
        let (a, b) = (spiele(g, &hits, 2.5, &[]), spiele(g, &hits, 2.5, &[]));
        assert!(a.iter().zip(&b).all(|(x, y)| x.to_bits() == y.to_bits()));
    }
}

#[test]
fn filter_knopf_schliesst_und_oeffnet() {
    // knob 8 at 0 closes a low-pass (80 Hz): a hat nearly vanishes; at 1 a high-pass at 6 kHz removes a kick
    let hat = |w: f32| rms_db(&spiele(G909, &[(0.0, 46, 0.9)], 0.5, &[(8, w)]));
    let kick = |w: f32| rms_db(&spiele(G909, &[(0.0, 36, 0.9)], 0.5, &[(8, w)]));
    println!("MESS filter: hat {:.1} dB open, {:.1} dB at knob 0; kick {:.1} dB open, {:.1} dB at knob 1", hat(0.5), hat(0.0), kick(0.5), kick(1.0));
    assert!(hat(0.0) < hat(0.5) - 25.0);
    assert!(kick(1.0) < kick(0.5) - 25.0);
    // neutral position: bit-identical to a graph without the filter stage (bypassed), i.e. knob 0.49 and 0.51 stay in the dead zone
    assert_eq!(spiele(G909, &[(0.0, 38, 0.9)], 0.3, &[(8, 0.49)]), spiele(G909, &[(0.0, 38, 0.9)], 0.3, &[(8, 0.51)]));
}

#[test]
fn sechzehn_treffer_gleichzeitig_weit_unter_echtzeit() {
    // all 16 voices ringing, a new hit on every voice every 80 ms; blocks of 256 samples like the core
    for (g, name) in [(G909, "909"), (G808, "808")] {
        let mut p = lade(g);
        let noten: [u8; 16] = [36, 37, 38, 39, 41, 42, 43, 45, 46, 47, 48, 49, 51, 53, 56, 59];
        let mut summe = 0.0f32;
        let (mut gesamt, mut bloecke, mut schlimmster) = (0.0f64, 0u32, 0.0f64);
        for b in 0..(5 * 48_000 / 256) {
            if b % 15 == 0 {
                for n in noten { p.note_an(n, 0.9); }
            }
            if b % 15 == 3 {
                for n in noten { p.note_aus(n); }
            }
            let t = std::time::Instant::now();
            for _ in 0..256 {
                let (l, r) = p.sample_stereo();
                summe += l + r;
            }
            let d = t.elapsed().as_secs_f64();
            gesamt += d;
            bloecke += 1;
            schlimmster = schlimmster.max(d);
        }
        let anteil = gesamt / bloecke as f64 / (256.0 / 48_000.0);
        println!("MESS {name} 16 voices struck every 80 ms: mean {:.1} us per block of 256 = {:.1} % of real time, worst block {:.1} % ", gesamt / bloecke as f64 * 1e6, anteil * 100.0, schlimmster / (256.0 / 48_000.0) * 100.0);
        assert!(summe.is_finite());
        assert!(anteil < 0.25, "{name}: {:.1} % of real time", anteil * 100.0);
    }
}
