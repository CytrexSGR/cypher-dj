//! Baukasten block `paula` (type 56): the Amiga sample voice. Slot bank, hold on the grid of min(quellrate, rate), bit
//! quantisation, loop, reverse, trigger cut. The expected output is computed here from the rule of the plan, from the raw ramp.
use baukasten_dsp::paula::{Bank, Platz, PlatzEinst, Stimme};
use baukasten_dsp::proben::bytes;
use baukasten_dsp::{uebersetze_mit_wurzel, Fehler, ARTEN};
use std::path::PathBuf;
use std::sync::OnceLock;

const SR: f32 = 48_000.0;
const N: usize = 2000;

/// stereo ramp: l rises from -1 to 1, r is its negative
fn rampe(n: usize) -> Vec<f32> {
    (0..n).flat_map(|i| {
        let v = i as f32 / n as f32 * 2.0 - 1.0;
        [v, -v]
    }).collect()
}

fn einst(grund: f32, rate: f32) -> PlatzEinst {
    PlatzEinst { grund, rate, schleife: false, s_von: 0, s_laenge: 0, pegel: 1.0, fein: 0 }
}

fn bank(plaetze: Vec<(Vec<f32>, PlatzEinst)>, quellrate: f32, bits: u8) -> Bank {
    Bank::neu(plaetze.into_iter().map(|(d, e)| Platz::neu(d.into_boxed_slice(), &e)).collect(), quellrate, bits)
}

/// the plan's quantiser: round(x * 2^(bits-1)) / 2^(bits-1), clamped to the signed range
fn quant(x: f32, bits: u8, pegel: f32) -> f32 {
    let s = (1u32 << (bits - 1)) as f32;
    (x * s).round().clamp(-s, s - 1.0) / s * pegel
}

/// play `n` samples from a trigger at sample 0 (trig stays high), constant pitch
fn spiele(b: &Bank, n: usize, hz: f32, platz: f32, start: f32, rueck: f32) -> Vec<(f32, f32)> {
    let mut v = Stimme::default();
    (0..n).map(|_| v.prozess(b, hz, 1.0, platz, start, rueck, SR)).collect()
}

/// the read index of the plan: floor(floor(pos * g / rate) * rate / g)
fn raster(pos: f64, g: f64, rate: f64) -> usize { ((pos * g / rate).floor() * rate / g).floor() as usize }

#[test]
fn gleich_der_referenz_auf_dem_raster_drei_tonhoehen() {
    let daten = rampe(N);
    for (hz, quellrate, bits) in [(100.0f32, 8000.0f32, 8u8), (200.0, 8000.0, 8), (75.0, 8000.0, 8), (100.0, 48_000.0, 4), (150.0, 16_574.0, 8)] {
        let b = bank(vec![(daten.clone(), einst(100.0, 48_000.0))], quellrate, bits);
        let x = spiele(&b, 1500, hz, 1.0, 0.0, 0.0);
        let g = (quellrate as f64).min(48_000.0);
        let mut pos = 0.0f64;
        for (k, (l, r)) in x.iter().enumerate() {
            // after the data end the voice is silent
            let i = if g >= 48_000.0 { pos.floor() as usize } else { raster(pos, g, 48_000.0) };
            let (el, er) = if pos < N as f64 { (quant(daten[2 * i], bits, 1.0), quant(daten[2 * i + 1], bits, 1.0)) } else { (0.0, 0.0) };
            assert_eq!((l.to_bits(), r.to_bits()), (el.to_bits(), er.to_bits()), "hz {hz} quellrate {quellrate} bits {bits} sample {k}");
            pos += hz as f64 / 100.0 * 48_000.0 / SR as f64;
        }
    }
}

#[test]
fn halten_folgt_der_quellrate() {
    // quellrate 8000 against a 48 kHz file at the original pitch: every value is held 6 samples
    let b = bank(vec![(rampe(N), einst(100.0, 48_000.0))], 8000.0, 16);
    let x = spiele(&b, 60, 100.0, 1.0, 0.0, 0.0);
    for blk in x.chunks(6) {
        assert!(blk.iter().all(|v| v.0 == blk[0].0), "6 equal samples per held value");
    }
    assert!(x[5].0 != x[6].0 && x[11].0 != x[12].0, "the value changes on the grid");
}

#[test]
fn schleife_umbrechen() {
    let daten = rampe(N);
    let mut e = einst(100.0, 48_000.0);
    e.schleife = true;
    e.s_von = 100;
    e.s_laenge = 50;
    let b = bank(vec![(daten.clone(), e)], 48_000.0, 16);
    let x = spiele(&b, 1000, 100.0, 1.0, 0.0, 0.0);
    for (k, (l, _)) in x.iter().enumerate() {
        let i = if k < 150 { k } else { 100 + (k - 100) % 50 };
        assert_eq!(l.to_bits(), quant(daten[2 * i], 16, 1.0).to_bits(), "sample {k} reads frame {i}");
    }
    // without a loop the same pitch runs to the data end and stops
    let b = bank(vec![(daten, einst(100.0, 48_000.0))], 48_000.0, 16);
    let x = spiele(&b, N + 10, 100.0, 1.0, 0.0, 0.0);
    assert!(x[N - 1].0 != 0.0 && x[N..].iter().all(|v| *v == (0.0, 0.0)), "stops at the data end");
}

#[test]
fn rueckwaerts() {
    let daten = rampe(N);
    let b = bank(vec![(daten.clone(), einst(100.0, 48_000.0))], 48_000.0, 16);
    let x = spiele(&b, N + 5, 100.0, 1.0, 0.0, 1.0);
    for k in 0..N {
        assert_eq!(x[k].0.to_bits(), quant(daten[2 * (N - 1 - k)], 16, 1.0).to_bits(), "sample {k}");
    }
    assert!(x[N..].iter().all(|v| *v == (0.0, 0.0)), "stops at the data start");
    // start counts from the beginning of the playing direction: 0.5 reverse plays the first half backwards
    let x = spiele(&b, 20, 100.0, 1.0, 0.5, 1.0);
    assert_eq!(x[0].0.to_bits(), quant(daten[2 * (N / 2 - 1)], 16, 1.0).to_bits());
    // forward start 0.25
    let x = spiele(&b, 20, 100.0, 1.0, 0.25, 0.0);
    assert_eq!(x[0].0.to_bits(), quant(daten[2 * (N / 4)], 16, 1.0).to_bits());
}

#[test]
fn neuer_ausloeser_schneidet_ohne_blende() {
    let a = rampe(N);
    let c: Vec<f32> = a.iter().map(|v| 0.5 * v).collect();
    let b = bank(vec![(a.clone(), einst(100.0, 48_000.0)), (c.clone(), einst(100.0, 48_000.0))], 48_000.0, 16);
    let mut v = Stimme::default();
    let mut x = Vec::new();
    for k in 0..600 {
        // trigger high at 0, low at 200, high again at 300 (a new trigger, slot 2)
        let trig = if k < 200 || k >= 300 { 1.0 } else { 0.0 };
        let platz = if k < 300 { 1.0 } else { 2.0 };
        x.push(v.prozess(&b, 100.0, trig, platz, 0.0, 0.0, SR));
    }
    // trig low does nothing: the sound runs on
    assert_eq!(x[250].0.to_bits(), quant(a[2 * 250], 16, 1.0).to_bits());
    // the new trigger cuts at once: the very sample of the edge is the first frame of slot 2, no fade
    assert_eq!(x[300].0.to_bits(), quant(c[0], 16, 1.0).to_bits());
    assert_eq!(x[301].0.to_bits(), quant(c[2], 16, 1.0).to_bits());
}

#[test]
fn pegel_platz_klemmen_und_fein() {
    let daten = rampe(N);
    let mut e2 = einst(100.0, 48_000.0);
    e2.pegel = 0.5;
    let b = bank(vec![(daten.clone(), einst(100.0, 48_000.0)), (daten.clone(), e2)], 48_000.0, 16);
    // platz is rounded and clamped to 1..len
    assert_eq!(spiele(&b, 3, 100.0, 9.0, 0.5, 0.0), spiele(&b, 3, 100.0, 2.0, 0.5, 0.0));
    assert_eq!(spiele(&b, 3, 100.0, -4.0, 0.5, 0.0), spiele(&b, 3, 100.0, 1.0, 0.5, 0.0));
    assert_eq!(spiele(&b, 3, 100.0, 1.6, 0.5, 0.0), spiele(&b, 3, 100.0, 2.0, 0.5, 0.0));
    let x = spiele(&b, 3, 100.0, 2.0, 0.5, 0.0);
    assert_eq!(x[0].0.to_bits(), quant(daten[2 * 1000], 16, 0.5).to_bits(), "pegel multiplies after the quantiser");
    // fein +4 eighths of a semitone = 2^(4/96): the head advances 1.0293 frames per sample
    let mut ef = einst(100.0, 48_000.0);
    ef.fein = 4;
    let bf = bank(vec![(daten.clone(), ef)], 48_000.0, 16);
    let x = spiele(&bf, 1000, 100.0, 1.0, 0.0, 0.0);
    let soll = (999.0f64 * (4.0f64 / 96.0).exp2()).floor() as usize;
    assert_eq!(x[999].0.to_bits(), quant(daten[2 * soll], 16, 1.0).to_bits());
}

#[test]
fn ohne_ausloeser_still() {
    let b = bank(vec![(rampe(N), einst(100.0, 48_000.0))], 48_000.0, 8);
    let mut v = Stimme::default();
    assert!((0..100).all(|_| v.prozess(&b, 100.0, 0.0, 1.0, 0.0, 0.0, SR) == (0.0, 0.0)));
}

// ----- the graph: registration, translation, value checks -----

fn wurzel() -> &'static PathBuf {
    static W: OnceLock<PathBuf> = OnceLock::new();
    W.get_or_init(|| {
        let w = std::env::temp_dir().join(format!("bk-paula-{}", std::process::id()));
        std::fs::create_dir_all(&w).unwrap();
        std::fs::write(w.join("rampe.f32"), bytes(&rampe(N))).unwrap();
        w
    })
}

fn platz_json(extra: &str) -> String { format!(r#"{{"datei":"rampe.f32","grund":440,"rate":48000{extra}}}"#) }

fn graph(werte: &str, plaetze: &str) -> String {
    format!(r#"{{"format":"baukasten/2","name":"paula-t","stimmen":2,"knoten":[{{"id":"n","art":"note"}},{{"id":"p","art":"paula"{werte},"plaetze":[{plaetze}]}},{{"id":"o","art":"ausgang"}}],"kanten":[{{"von":"n.hz","nach":"p.hz"}},{{"von":"n.trig","nach":"p.trig"}},{{"von":"p.l","nach":"o.l"}},{{"von":"p.r","nach":"o.r"}}]}}"#)
}

fn wert_fehler(g: &str) -> String {
    match uebersetze_mit_wurzel(g, SR, Some(wurzel())) {
        Err(Fehler::Wert { wert, .. }) => wert,
        Err(e) => panic!("{e:?}"),
        Ok(_) => panic!("accepted: {g}"),
    }
}

#[test]
fn registriert_als_typ_56() {
    assert_eq!(ARTEN.iter().position(|a| a.art == "paula"), Some(56), "paula is type 56 and must not move");
    let d = &ARTEN[56];
    assert_eq!(d.ein, &["hz", "trig", "gate", "platz", "start", "rueckwaerts"]);
    assert_eq!(d.aus, &["l", "r"]);
    assert_eq!(d.frei, &[("quellrate", 16574.0), ("bits", 8.0)]);
}

#[test]
fn graph_spielt_die_rampe_im_takt_der_note() {
    let mut p = uebersetze_mit_wurzel(&graph("", &platz_json("")), SR, Some(wurzel())).unwrap();
    let daten = rampe(N);
    p.note_an(69, 1.0); // 440 Hz = the slot's root: original speed
    let x: Vec<(f32, f32)> = (0..300).map(|_| p.sample_stereo()).collect();
    // quellrate 16574 holds 2.9 frames; compare the hold of the plan with the same arithmetic
    for (k, (l, r)) in x.iter().enumerate() {
        let i = raster(k as f64, 16_574.0, 48_000.0);
        assert_eq!((l.to_bits(), r.to_bits()), (quant(daten[2 * i], 8, 1.0).to_bits(), quant(daten[2 * i + 1], 8, 1.0).to_bits()), "sample {k}");
    }
}

#[test]
fn fehlende_datei_nennt_den_namen() {
    let g = graph("", r#"{"datei":"gibt-es-nicht.f32","grund":440,"rate":48000}"#);
    match uebersetze_mit_wurzel(&g, SR, Some(wurzel())) {
        Err(Fehler::Datei { knoten, grund }) => {
            assert_eq!(knoten, "p");
            assert!(grund.contains("gibt-es-nicht.f32"), "{grund}");
        }
        Err(e) => panic!("{e:?}"),
        Ok(_) => panic!("accepted"),
    }
    assert!(matches!(uebersetze_mit_wurzel(&graph("", &platz_json("")), SR, None), Err(Fehler::Datei { .. })), "no sample root");
}

/// one slot object with one field replaced
fn platz_mit(feld: &str, v: serde_json::Value) -> String {
    let mut o = serde_json::json!({"datei": "rampe.f32", "grund": 440, "rate": 48000});
    o[feld] = v;
    o.to_string()
}

#[test]
fn wertepruefungen() {
    let ok = platz_json("");
    for (werte, wert) in [(r#","quellrate":3999"#, "quellrate"), (r#","quellrate":48001"#, "quellrate"), (r#","bits":3"#, "bits"), (r#","bits":17"#, "bits"), (r#","bits":8.5"#, "bits")] {
        assert_eq!(wert_fehler(&graph(werte, &ok)), wert, "{werte}");
    }
    for g in [r#","quellrate":4000"#, r#","quellrate":48000"#, r#","bits":4"#, r#","bits":16"#] {
        assert!(uebersetze_mit_wurzel(&graph(g, &ok), SR, Some(wurzel())).is_ok(), "{g}");
    }
    use serde_json::json;
    let schlecht = [
        ("grund", json!(19), "plaetze[0].grund"),
        ("grund", json!(2001), "plaetze[0].grund"),
        ("rate", json!(3999), "plaetze[0].rate"),
        ("rate", json!(48001), "plaetze[0].rate"),
        ("schleife", json!(2), "plaetze[0].schleife"),
        ("pegel", json!(1.5), "plaetze[0].pegel"),
        ("pegel", json!(-0.1), "plaetze[0].pegel"),
        ("fein", json!(8), "plaetze[0].fein"),
        ("fein", json!(-9), "plaetze[0].fein"),
        ("name", json!(""), "plaetze[0].name"),
        ("name", json!("a".repeat(23)), "plaetze[0].name"),
    ];
    for (feld, v, wert) in schlecht {
        assert_eq!(wert_fehler(&graph("", &platz_mit(feld, v.clone()))), wert, "{feld} {v}");
    }
    for (feld, v) in [("grund", json!(20)), ("grund", json!(2000)), ("rate", json!(4000)), ("fein", json!(-8)), ("fein", json!(7)), ("pegel", json!(0)), ("pegel", json!(1)), ("name", json!("a".repeat(22))), ("name", json!("x"))] {
        assert!(uebersetze_mit_wurzel(&graph("", &platz_mit(feld, v.clone())), SR, Some(wurzel())).is_ok(), "{feld} {v}");
    }
    // the loop: needs a length, must lie inside the data, may touch the data end exactly
    for (extra, wert) in [(r#","schleife":1,"s_von":10,"s_laenge":0"#, "plaetze[0].s_laenge"), (r#","schleife":1,"s_von":1990,"s_laenge":11"#, "plaetze[0].s_laenge"), (r#","schleife":1,"s_von":2000,"s_laenge":1"#, "plaetze[0].s_von")] {
        assert_eq!(wert_fehler(&graph("", &platz_json(extra))), wert, "{extra}");
    }
    assert!(uebersetze_mit_wurzel(&graph("", &platz_json(r#","schleife":1,"s_von":1990,"s_laenge":10"#)), SR, Some(wurzel())).is_ok());
    // without a loop the loop fields are not looked at
    assert!(uebersetze_mit_wurzel(&graph("", &platz_json(r#","s_von":5000,"s_laenge":9"#)), SR, Some(wurzel())).is_ok());
}

#[test]
fn plaetze_anzahl_und_nur_an_paula() {
    let ein = platz_json("");
    assert_eq!(wert_fehler(&graph("", "")), "plaetze");
    let viele = vec![ein.as_str(); 33].join(",");
    assert_eq!(wert_fehler(&graph("", &viele)), "plaetze");
    let zweiunddreissig = vec![ein.as_str(); 32].join(",");
    assert!(uebersetze_mit_wurzel(&graph("", &zweiunddreissig), SR, Some(wurzel())).is_ok());
    // a paula node without the field, a field on another block, a node-level file on paula
    let ohne = r#"{"format":"baukasten/2","name":"t","stimmen":1,"knoten":[{"id":"p","art":"paula"},{"id":"o","art":"ausgang"}],"kanten":[]}"#;
    assert!(matches!(uebersetze_mit_wurzel(ohne, SR, Some(wurzel())), Err(Fehler::FehlenderWert { wert, .. }) if wert == "plaetze"));
    let fremd = format!(r#"{{"format":"baukasten/2","name":"t","stimmen":1,"knoten":[{{"id":"p","art":"saege","plaetze":[{ein}]}},{{"id":"o","art":"ausgang"}}],"kanten":[]}}"#);
    assert_eq!(wert_fehler(&fremd), "plaetze");
    let mit_datei = graph(r#","datei":"rampe.f32""#, &ein);
    assert_eq!(wert_fehler(&mit_datei), "datei");
}
