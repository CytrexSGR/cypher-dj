//! Jede Art aus ARTEN hat hier einen Minimalgraphen (Slice 4a, D8). Für jede gilt: laufen lassen, `zuruecksetzen`, dieselbe
//! Eingabe noch einmal = bitgleich mit einem frisch geladenen Programm. Eine neue Art ohne Eintrag macht
//! `jede_art_hat_einen_minimalgraphen` rot; ein vergessener Reset-Arm macht `zuruecksetzen_gleich_frisch` rot.
use baukasten_dsp::{uebersetze_mit_wurzel, Programm, ARTEN};
use std::path::PathBuf;
use std::sync::OnceLock;

const SR: f32 = 48_000.0;

/// Sample root with the generated probe `probe.f32` (S10, C11): the sampler graph needs a file, the other graphs ignore it.
fn wurzel() -> &'static PathBuf {
    static W: OnceLock<PathBuf> = OnceLock::new();
    W.get_or_init(|| {
        let w = std::env::temp_dir().join(format!("bk-s10-arten-{}", std::process::id()));
        std::fs::create_dir_all(&w).unwrap();
        std::fs::write(w.join("probe.f32"), baukasten_dsp::proben::bytes(&baukasten_dsp::proben::orchester_schlag(48_000.0))).unwrap();
        // S21: 700 frames of a decaying sine pair (head plus two tail partitions) for the `faltung` minimal graph
        let ir: Vec<f32> = (0..700).flat_map(|i| {
            let e = (-(i as f64) / 150.0).exp();
            [(e * (i as f64 * 0.31).sin()) as f32, (e * (i as f64 * 0.23).sin()) as f32]
        }).collect();
        std::fs::write(w.join("ir.f32"), baukasten_dsp::proben::bytes(&ir)).unwrap();
        w
    })
}

fn uebersetze(g: &str, sr: f32) -> Result<Programm, baukasten_dsp::Fehler> { uebersetze_mit_wurzel(g, sr, Some(wurzel())) }

/// Knoten und Kanten um den Prüfling `p`. Jeder Graph hat Note, Sägezahn (Quelle mit Zustand) und Ausgang.
fn um(knoten: &str, kanten: &str) -> String {
    format!(
        r#"{{"format":"baukasten/2","name":"t","stimmen":2,"knoten":[{{"id":"n","art":"note"}},{{"id":"s","art":"saege"}},{{"id":"o","art":"ausgang"}}{knoten}],"kanten":[{{"von":"n.hz","nach":"s.hz"}}{kanten}]}}"#
    )
}

/// (Art, Graph). Der Prüfling heißt `p` und liegt zwischen Sägezahn und Ausgang, soweit er Ein- und Ausgänge hat.
fn minimalgraph(art: &str) -> Option<String> {
    let durch = |def: &str, ein: &str, aus: &str| {
        um(&format!(r#",{{"id":"p",{def}}}"#), &format!(r#",{{"von":"s.aus","nach":"p.{ein}"}},{{"von":"p.{aus}","nach":"o.x"}}"#))
    };
    Some(match art {
        "note" | "saege" | "ausgang" => um("", r#",{"von":"s.aus","nach":"o.x"}"#),
        "konst" => um(r#",{"id":"p","art":"konst","wert":0.25}"#, r#",{"von":"p.aus","nach":"o.x"},{"von":"s.aus","nach":"o.l"}"#),
        "regler" => um(r#",{"id":"p","art":"regler","nr":1,"min":0.5,"max":1},{"id":"m","art":"mul"}"#,
                       r#",{"von":"s.aus","nach":"m.a"},{"von":"p.aus","nach":"m.b"},{"von":"m.aus","nach":"o.x"}"#),
        "puls" => durch(r#""art":"puls""#, "hz", "aus").replace(r#"{"von":"s.aus","nach":"p.hz"}"#, r#"{"von":"n.hz","nach":"p.hz"}"#),
        "dreieck" => durch(r#""art":"dreieck""#, "hz", "aus").replace(r#"{"von":"s.aus","nach":"p.hz"}"#, r#"{"von":"n.hz","nach":"p.hz"}"#),
        "sinus" => durch(r#""art":"sinus""#, "hz", "aus").replace(r#"{"von":"s.aus","nach":"p.hz"}"#, r#"{"von":"n.hz","nach":"p.hz"}"#),
        "rauschen" => um(r#",{"id":"p","art":"rauschen"}"#, r#",{"von":"p.aus","nach":"o.x"}"#),
        "lfo" => um(r#",{"id":"p","art":"lfo","rate":3,"form":4},{"id":"m","art":"mul"}"#,
                    r#",{"von":"s.aus","nach":"m.a"},{"von":"p.aus","nach":"m.b"},{"von":"m.aus","nach":"o.x"}"#),
        "transponiere" => um(r#",{"id":"p","art":"transponiere","st":7},{"id":"q","art":"saege"}"#,
                             r#",{"von":"n.hz","nach":"p.hz"},{"von":"p.aus","nach":"q.hz"},{"von":"q.aus","nach":"o.x"}"#),
        "ladder" => durch(r#""art":"ladder","cutoff":800,"reso":0.5"#, "x", "aus"),
        "svf" => durch(r#""art":"svf","cutoff":800,"reso":0.5,"pole":4"#, "x", "tp"),
        "saett" => durch(r#""art":"saett","antrieb":12"#, "x", "aus"),
        "glatt" => durch(r#""art":"glatt","zeit":0.05"#, "x", "aus"),
        "adsr" => um(r#",{"id":"p","art":"adsr","a":0.05,"d":0.1,"s":0.5,"r":0.2},{"id":"m","art":"mul"}"#,
                     r#",{"von":"n.gate","nach":"p.gate"},{"von":"n.trig","nach":"p.trig"},{"von":"s.aus","nach":"m.a"},{"von":"p.aus","nach":"m.b"},{"von":"m.aus","nach":"o.x"}"#),
        "mul" => durch(r#""art":"mul","b":0.5"#, "a", "aus"),
        "add" => durch(r#""art":"add","b":0.1"#, "a", "aus"),
        "chorus" => um(r#",{"id":"p","art":"chorus","modus":2}"#, r#",{"von":"s.aus","nach":"p.x"},{"von":"p.l","nach":"o.l"},{"von":"p.r","nach":"o.r"}"#),
        "hall" => um(r#",{"id":"e","art":"adsr","a":0.01,"d":0.1,"s":1,"r":0.05},{"id":"v","art":"mul"},{"id":"p","art":"hall","mix":0.5,"rahmen":0}"#,
                     r#",{"von":"n.gate","nach":"e.gate"},{"von":"n.trig","nach":"e.trig"},{"von":"s.aus","nach":"v.a"},{"von":"e.aus","nach":"v.b"},{"von":"v.aus","nach":"p.x"},{"von":"p.l","nach":"o.l"},{"von":"p.r","nach":"o.r"}"#),
        "delay" => um(r#",{"id":"p","art":"delay","zeit":30,"fb":0.5,"mix":0.7,"pingpong":1}"#, r#",{"von":"s.aus","nach":"p.x"},{"von":"p.l","nach":"o.l"},{"von":"p.r","nach":"o.r"}"#),
        "limiter" => um(r#",{"id":"p","art":"limiter","decke":-12,"vorlauf":1}"#, r#",{"von":"s.aus","nach":"p.x"},{"von":"p.l","nach":"o.l"},{"von":"p.r","nach":"o.r"}"#),
        "gate" => um(r#",{"id":"p","art":"gate","schwelle":-20,"release":20}"#, r#",{"von":"s.aus","nach":"p.x"},{"von":"p.l","nach":"o.l"},{"von":"p.r","nach":"o.r"}"#),
        "komp" => um(r#",{"id":"p","art":"komp","schwelle":-30,"ratio":6,"schp":100}"#, r#",{"von":"s.aus","nach":"p.x"},{"von":"p.l","nach":"o.l"},{"von":"p.r","nach":"o.r"}"#),
        "leitung" => um(r#",{"id":"p","art":"leitung","zeit":3},{"id":"a","art":"add"},{"id":"m","art":"mul","b":0.7}"#,
                        r#",{"von":"s.aus","nach":"a.a"},{"von":"a.aus","nach":"p.x"},{"von":"p.aus","nach":"m.a"},{"von":"m.aus","nach":"a.b"},{"von":"a.aus","nach":"o.x"}"#),
        // rate 12345: the run is 24000 samples, so the hold phase ends at 0.5 (with 12000 or 13000 it ends aligned and a missing reset goes unseen)
        "krume" => durch(r#""art":"krume","bits":6,"rate":12345"#, "x", "aus"),
        "phaser" => um(r#",{"id":"p","art":"phaser","rate":2,"fb":0.6,"stufen":4}"#, r#",{"von":"s.aus","nach":"p.x"},{"von":"p.l","nach":"o.l"},{"von":"p.r","nach":"o.r"}"#),
        // S11: an internal saw feeds carrier and modulator, so the output is not silent (the eingang is silent in this harness)
        "vocoder" => um(r#",{"id":"p","art":"vocoder","zisch":0.5,"attack":2,"release":50}"#,
                        r#",{"von":"s.aus","nach":"p.x"},{"von":"s.aus","nach":"p.l"},{"von":"s.aus","nach":"p.r"},{"von":"p.l","nach":"o.l"},{"von":"p.r","nach":"o.r"}"#),
        "roehre" => durch(r#""art":"roehre","antrieb":18,"stufen":2"#, "x", "aus"),
        // S10: the sampler plays the generated probe as a one-shot; at the low notes it is still running when the run ends, so a missing reset shows
        "sampler" => um(r#",{"id":"p","art":"sampler","datei":"probe.f32"}"#,
                        r#",{"von":"n.hz","nach":"p.hz"},{"von":"n.trig","nach":"p.trig"},{"von":"n.gate","nach":"p.gate"},{"von":"p.l","nach":"o.l"},{"von":"p.r","nach":"o.r"}"#),
        // S21: the saw is convolved with a 700 frame IR; mix 0.7 keeps the dry share audible next to the tail
        "faltung" => um(r#",{"id":"p","art":"faltung","datei":"ir.f32","mix":0.7}"#, r#",{"von":"s.aus","nach":"p.x"},{"von":"p.l","nach":"o.l"},{"von":"p.r","nach":"o.r"}"#),
        // type 32: three detuned copies on the morph table, start phases from a trig; a forgotten reset of the random
        // generator or of the phases shows as a different second run
        "wavetable" => um(r#",{"id":"p","art":"wavetable","tabelle":4,"pos":0.4,"kopien":3,"verstimmung":12,"breite":0.8}"#,
                          r#",{"von":"n.hz","nach":"p.hz"},{"von":"n.trig","nach":"p.trig"},{"von":"p.l","nach":"o.l"},{"von":"p.r","nach":"o.r"}"#),
        // type 34: a membrane struck by a noise burst (random generator state) with the saw on the audio input; a forgotten
        // reset of the mode states, the burst or the trig edge shows as a different second run
        "resonator" => um(r#",{"id":"p","art":"resonator","satz":5,"anregung":1,"material":0.7}"#,
                          r#",{"von":"n.hz","nach":"p.hz"},{"von":"n.trig","nach":"p.trig"},{"von":"s.aus","nach":"p.x"},{"von":"p.aus","nach":"o.x"}"#),
        // type 33: two hits in one sample (group choke idle), decay 0.4 s so both still ring at the release; a forgotten
        // reset of phases, noise generator, filters or envelope shows as a different second run
        "metall" => um(r#",{"id":"p","art":"metall","decay":0.4,"rauschen":0.4}"#,
                       r#",{"von":"n.trig","nach":"p.trig"},{"von":"n.vel","nach":"p.vel"},{"von":"p.aus","nach":"o.l"},{"von":"p.huelle","nach":"o.r"}"#),
        // type 35: a 2>1 pair plus a fed-back 4>3 pair with decaying modulators, free-running phases (sync 0); a forgotten
        // reset of phases, feedback memory, envelopes or the guard's cache shows as a different second run
        "fm" => um(r#",{"id":"p","art":"fm","algo":3,"sync":0,"rueck":0.6,"o2_pegel":0.2,"o2_d":0.2,"o2_s":0,"o3_pegel":0.7,"o3_verh":2,"o4_pegel":0.1,"o4_verh":3}"#,
                   r#",{"von":"n.hz","nach":"p.hz"},{"von":"n.gate","nach":"p.gate"},{"von":"n.trig","nach":"p.trig"},{"von":"p.aus","nach":"o.x"}"#),
        // type 36: the recording source on the saw, jittered grains; a forgotten reset of the ring buffer, the write head,
        // the start clock or the grain pool shows as a different second run (tests/granular.rs covers the other sources)
        "granular" => um(r#",{"id":"p","art":"granular","quelle":1,"puffer":0.2,"groesse":30,"dichte":120,"pos":0.5,"pos_zufall":1,"ton_zufall":100,"breite":1,"streuung":1}"#,
                         r#",{"von":"s.aus","nach":"p.x"},{"von":"n.hz","nach":"p.hz"},{"von":"n.trig","nach":"p.trig"},{"von":"n.gate","nach":"p.gate"},{"von":"p.l","nach":"o.l"},{"von":"p.r","nach":"o.r"}"#),
        "eingang" => um(r#",{"id":"p","art":"eingang"}"#, r#",{"von":"p.l","nach":"o.l"},{"von":"p.r","nach":"o.r"},{"von":"s.aus","nach":"o.x"}"#),
        // type 37: noise burst (random generator), guitar body, and the saw on x through the comb; a forgotten reset of the
        // delay lines, the comb, the filters or the generator shows as a different second run
        "saite" => um(r#",{"id":"p","art":"saite","anreger":0,"koerper":1,"ausklang":3}"#,
                      r#",{"von":"n.hz","nach":"p.hz"},{"von":"n.trig","nach":"p.trig"},{"von":"s.aus","nach":"p.x"},{"von":"p.aus","nach":"o.x"}"#),
        _ => return None,
    })
}

/// 0,3 s mit zwei Noten, 0,2 s nach dem Loslassen
fn lauf(p: &mut Programm) -> Vec<(f32, f32)> {
    p.note_an(45, 0.8);
    p.note_an(52, 0.8);
    let mut x: Vec<(f32, f32)> = (0..14_400).map(|_| p.sample_stereo()).collect();
    p.alle_aus();
    x.extend((0..9_600).map(|_| p.sample_stereo()));
    x
}

#[test]
fn jede_art_hat_einen_minimalgraphen() {
    let fehlt: Vec<&str> = ARTEN.iter().map(|a| a.art).filter(|a| minimalgraph(a).is_none()).collect();
    assert!(fehlt.is_empty(), "ohne Minimalgraph: {fehlt:?}");
}

#[test]
fn zuruecksetzen_gleich_frisch() {
    for a in ARTEN.iter().map(|a| a.art) {
        let g = minimalgraph(a).unwrap();
        if a == "hall" {
            hall_still_nach_zuruecksetzen(&g);
            continue;
        }
        let mut frisch = uebersetze(&g, SR).unwrap_or_else(|e| panic!("{a}: {e}"));
        let mut benutzt = uebersetze(&g, SR).unwrap();
        lauf(&mut benutzt);
        benutzt.zuruecksetzen();
        let (soll, ist) = (lauf(&mut frisch), lauf(&mut benutzt));
        let abweichend = soll.iter().zip(&ist).filter(|(s, i)| s.0.to_bits() != i.0.to_bits() || s.1.to_bits() != i.1.to_bits()).count();
        assert_eq!(abweichend, 0, "Art {a}: {abweichend} Samples weichen nach zuruecksetzen ab");
        assert!(soll.iter().any(|v| v.0 != 0.0), "Art {a}: Graph ist still, der Vergleich wäre blind");
    }
}

/// D6: `hall_dsp::Hall::reset` setzt Zufallszustand und Phasen der Fahnen nicht zurück, "gleich frisch" gilt für `hall`
/// nicht. Es gilt "still": nach `zuruecksetzen` ist der Rest im ersten 2048er-Fenster < 1e-4 × Energie des Schwanzes davor.
/// Plan-Review gemessen: Rest 7,5e-60 gegen Schwanz 146, ohne Reset-Arm Rest 91.
fn hall_still_nach_zuruecksetzen(g: &str) {
    let mut p = uebersetze(g, SR).unwrap();
    let x = lauf(&mut p);
    let energie = |v: &[(f32, f32)]| -> f64 { v.iter().map(|s| (s.0 as f64).powi(2) + (s.1 as f64).powi(2)).sum() };
    let schwanz = energie(&x[x.len() - 2048..]);
    p.zuruecksetzen();
    let still: Vec<(f32, f32)> = (0..2048).map(|_| p.sample_stereo()).collect();
    let rest = energie(&still);
    println!("MESS arten hall: Schwanz {schwanz:.3e}, Rest nach zuruecksetzen {rest:.3e}, Verhältnis {:.2e}", rest / schwanz);
    assert!(schwanz > 1e-3, "Art hall: Schwanz zu leise, die Prüfung wäre blind ({schwanz})");
    assert!(rest < 1e-4 * schwanz, "Art hall: nach zuruecksetzen klingt der Hall weiter: {rest} gegen Schwanz {schwanz}");
}

/// S21: the type numbers are part of the stored projects, so ARTEN may only grow at the end. This list pins the order of
/// the first 32 entries; a later slice appends its names to a new list of its own, never edits this one.
#[test]
fn arten_nur_angehaengt() {
    const ERSTE: [&str; 32] = [
        "note", "konst", "regler", "saege", "puls", "dreieck", "sinus", "rauschen", "lfo", "transponiere", "ladder", "svf", "saett",
        "glatt", "adsr", "mul", "add", "leitung", "chorus", "hall", "delay", "limiter", "gate", "komp", "eingang", "ausgang", "krume",
        "phaser", "roehre", "vocoder", "sampler", "faltung",
    ];
    assert!(ARTEN.len() >= ERSTE.len(), "ARTEN has {} entries, at least {} expected", ARTEN.len(), ERSTE.len());
    let ist: Vec<&str> = ARTEN.iter().take(ERSTE.len()).map(|a| a.art).collect();
    assert_eq!(ist, ERSTE, "the first entries of ARTEN moved");
}

/// Wavetable slice: type 32 is appended after the first 32 (their order is pinned above).
#[test]
fn arten_nur_angehaengt_wavetable() {
    assert_eq!(ARTEN.get(32).map(|a| a.art), Some("wavetable"), "the wavetable block must be type 32");
}

/// Resonator slice: type 34, appended after metall; types are numbered in merge order and never move.
#[test]
fn arten_nur_angehaengt_resonator() {
    let i = ARTEN.iter().position(|a| a.art == "resonator");
    assert_eq!(i, Some(34), "the resonator block is type 34 (merge order) and must not move");
}

/// Metall slice: type 33, appended after wavetable; types are numbered in merge order and never move.
#[test]
fn arten_nur_angehaengt_metall() {
    let nr = ARTEN.iter().position(|a| a.art == "metall");
    assert_eq!(nr, Some(33), "metall is type 33 (merge order) and must not move");
}
/// FM slice: type 35, appended after resonator; types are numbered in merge order and never move.
#[test]
fn arten_nur_angehaengt_fm() {
    assert_eq!(ARTEN.get(35).map(|a| a.art), Some("fm"), "the fm block is type 35 (merge order) and must not move");
}
/// Granular slice: type 36, appended after fm; types are numbered in merge order and never move.
#[test]
fn arten_nur_angehaengt_granular() {
    let i = ARTEN.iter().position(|a| a.art == "granular");
    assert_eq!(i, Some(36), "the granular block is type 36 (merge order) and must not move");
}
/// String slice: type 37, appended after granular; types are numbered in merge order and never move.
#[test]
fn arten_nur_angehaengt_saite() {
    let p = ARTEN.iter().position(|a| a.art == "saite");
    assert_eq!(p, Some(37), "the string block is type 37 (merge order) and must not move");
}
/// Hard sync slice: the slaves keep state across samples (the post-halves of the reset). Saw, pulse and triangle slaves
/// on a saw master, run, `zuruecksetzen`, run again = bit for bit a fresh program.
#[test]
fn zuruecksetzen_gleich_frisch_hartsync() {
    let g = um(r#",{"id":"t","art":"transponiere","st":7.3},{"id":"f1","art":"saege"},{"id":"f2","art":"puls","pwm":-0.5},{"id":"f3","art":"dreieck"},{"id":"a","art":"add"}"#,
               r#",{"von":"n.hz","nach":"t.hz"},{"von":"t.aus","nach":"f1.hz"},{"von":"t.aus","nach":"f2.hz"},{"von":"t.aus","nach":"f3.hz"},{"von":"s.hart","nach":"f1.hart"},{"von":"s.hart","nach":"f2.hart"},{"von":"s.hart","nach":"f3.hart"},{"von":"f1.aus","nach":"a.a"},{"von":"f2.aus","nach":"a.b"},{"von":"f3.aus","nach":"a.c"},{"von":"a.aus","nach":"o.x"}"#);
    let mut frisch = uebersetze(&g, SR).unwrap();
    let mut benutzt = uebersetze(&g, SR).unwrap();
    lauf(&mut benutzt);
    benutzt.zuruecksetzen();
    let (soll, ist) = (lauf(&mut frisch), lauf(&mut benutzt));
    let abweichend = soll.iter().zip(&ist).filter(|(s, i)| s.0.to_bits() != i.0.to_bits() || s.1.to_bits() != i.1.to_bits()).count();
    assert_eq!(abweichend, 0, "hard sync: {abweichend} samples differ after zuruecksetzen");
    assert!(soll.iter().any(|v| v.0 != 0.0), "the graph is silent, the comparison would be blind");
}
