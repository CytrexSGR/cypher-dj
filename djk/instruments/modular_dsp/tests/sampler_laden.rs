//! S10 task 1: the sample loader (D1-D4, C7, C9) and the graph format field `datei`.
//! Step 0 (D1): serde accepts a named `datei` field next to the flattened value map.
#[path = "sampler_helpers/mod.rs"]
mod sampler_hilfe;
use baukasten_dsp::sampler::lade_datei;
use baukasten_dsp::{uebersetze, uebersetze_mit_wurzel, Fehler, Graph};
use sampler_hilfe::*;

const SR: f32 = 48_000.0;

fn ok_datei(frames: usize) -> Vec<f32> { stereo(frames, |i| (i as f32 * 0.001).sin() * 0.5) }

fn mit(w: &std::path::Path, datei: &str) -> Result<baukasten_dsp::Programm, Fehler> {
    uebersetze_mit_wurzel(&graph(datei, "", 1), SR, Some(w))
}

fn ist_datei(r: Result<baukasten_dsp::Programm, Fehler>) -> bool { matches!(r, Err(Fehler::Datei { .. })) }

#[test]
fn step0_serde_datei_is_a_named_field() {
    let g = Graph::lies(&graph("a.f32", r#","grund":300"#, 1)).unwrap();
    let s = g.knoten.iter().find(|k| k.id == "s").unwrap();
    assert_eq!(s.datei.as_deref(), Some("a.f32"));
    assert!(!s.werte.contains_key("datei"), "datei must not land in the value map");
    assert_eq!(s.werte.get("grund"), Some(&300.0));
    // without datei
    let g = Graph::lies(r#"{"format":"baukasten/2","name":"x","knoten":[{"id":"o","art":"ausgang"}]}"#).unwrap();
    assert_eq!(g.knoten[0].datei, None);
    // a number is a parse error, not a value error
    let j = graph("a.f32", "", 1).replace(r#""datei":"a.f32""#, r#""datei":3"#);
    assert!(matches!(uebersetze(&j, SR), Err(Fehler::Format(_))), "{:?}", uebersetze(&j, SR).err());
}

#[test]
fn name_rules() {
    let w = wurzel();
    schreibe(&w, "ok_1.f32", &ok_datei(100));
    schreibe(&w, "a.b.f32", &ok_datei(100));
    let lang = format!("{}.f32", "x".repeat(60)); // 64 chars
    schreibe(&w, &lang, &ok_datei(100));
    assert_eq!(lang.len(), 64);
    for n in ["ok_1.f32", "a.b.f32", lang.as_str()] {
        assert!(mit(&w, n).is_ok(), "{n}: {:?}", mit(&w, n).err());
    }
    let zu_lang = format!("{}.f32", "x".repeat(61));
    for n in ["../x.f32", "a/b.f32", "x.wav", ".f32", "a..b.f32", "..f32", "/etc/passwd", "a b.f32", "ä.f32", "x.f32\\n", "", "x.F32", zu_lang.as_str()] {
        assert!(ist_datei(mit(&w, n)), "{n:?} must be rejected: {:?}", mit(&w, n).err());
    }
    // a 4-character name `.f32` is refused by the length rule even if such a file exists
    schreibe(&w, ".f32", &ok_datei(100));
    assert!(ist_datei(mit(&w, ".f32")));
    // the rejection of `..` must not depend on the file existing: a file `a..b.f32` exists and is still refused
    std::fs::write(w.join("a..b.f32"), bytes(&ok_datei(100))).unwrap();
    assert!(ist_datei(mit(&w, "a..b.f32")));
}

#[test]
fn symlinks_are_followed_but_the_target_must_be_a_regular_file() {
    let w = wurzel();
    let fremd = wurzel();
    let d = ok_datei(100);
    schreibe(&fremd, "echt.f32", &d);
    std::os::unix::fs::symlink(fremd.join("echt.f32"), w.join("link.f32")).unwrap();
    assert!(mit(&w, "link.f32").is_ok(), "{:?}", mit(&w, "link.f32").err());
    let mut summe = 0;
    let geladen = lade_datei(&w, "link.f32", "s", &mut summe).unwrap();
    assert_eq!(&*geladen, &d[..]);
    // directory, dangling link, device, fifo
    std::fs::create_dir(fremd.join("ordner.f32")).unwrap();
    std::os::unix::fs::symlink(fremd.join("ordner.f32"), w.join("dir.f32")).unwrap();
    std::os::unix::fs::symlink(fremd.join("gibtsnicht.f32"), w.join("dangling.f32")).unwrap();
    std::os::unix::fs::symlink("/dev/zero", w.join("zero.f32")).unwrap();
    let fifo = fremd.join("fifo.f32");
    assert!(std::process::Command::new("mkfifo").arg(&fifo).status().unwrap().success());
    std::os::unix::fs::symlink(&fifo, w.join("fifo.f32")).unwrap();
    for n in ["dir.f32", "dangling.f32", "zero.f32", "fifo.f32", "fehlt.f32"] {
        assert!(ist_datei(mit(&w, n)), "{n}: {:?}", mit(&w, n).err());
    }
}

#[test]
fn size_rules() {
    let w = wurzel();
    std::fs::write(w.join("krumm.f32"), vec![0u8; 8 * 100 + 4]).unwrap();
    std::fs::write(w.join("viertel.f32"), vec![0u8; 4 * 101]).unwrap(); // 4-byte multiple, not 8
    schreibe(&w, "sieben.f32", &ok_datei(7));
    schreibe(&w, "acht.f32", &ok_datei(8));
    schreibe(&w, "voll.f32", &vec![0.1f32; 2 * 1_440_000]);
    schreibe(&w, "zuviel.f32", &vec![0.1f32; 2 * 1_440_001]);
    std::fs::write(w.join("leer.f32"), b"").unwrap();
    for n in ["krumm.f32", "viertel.f32", "sieben.f32", "zuviel.f32", "leer.f32"] {
        assert!(ist_datei(mit(&w, n)), "{n}: {:?}", mit(&w, n).err());
    }
    for n in ["acht.f32", "voll.f32"] {
        assert!(mit(&w, n).is_ok(), "{n}: {:?}", mit(&w, n).err());
    }
}

fn viele(n: usize, datei: &str) -> String {
    let knoten: String = (0..n).map(|i| format!(r#"{{"id":"s{i}","art":"sampler","datei":"{datei}"}},"#)).collect();
    format!(r#"{{"format":"baukasten/2","name":"v","stimmen":1,"knoten":[{knoten}{{"id":"o","art":"ausgang"}}]}}"#)
}

#[test]
fn graph_cap_64_mib() {
    let w = wurzel();
    schreibe(&w, "voll.f32", &vec![0.1f32; 2 * 1_440_000]); // 11.52 MB
    assert!(uebersetze_mit_wurzel(&viele(5, "voll.f32"), SR, Some(&w)).is_ok());
    let r = uebersetze_mit_wurzel(&viele(6, "voll.f32"), SR, Some(&w));
    assert!(ist_datei(r), "six files at the per-file cap exceed 64 MiB");
}

#[test]
fn datei_placement() {
    let w = wurzel();
    schreibe(&w, "a.f32", &ok_datei(100));
    // datei on a non-sampler
    let j = r#"{"format":"baukasten/2","name":"x","knoten":[{"id":"k","art":"konst","wert":1,"datei":"a.f32"},{"id":"o","art":"ausgang"}]}"#;
    assert!(matches!(uebersetze_mit_wurzel(j, SR, Some(&w)), Err(Fehler::Wert { .. })), "{:?}", uebersetze_mit_wurzel(j, SR, Some(&w)).err());
    // sampler without datei
    let j = r#"{"format":"baukasten/2","name":"x","knoten":[{"id":"s","art":"sampler"},{"id":"o","art":"ausgang"}]}"#;
    assert!(matches!(uebersetze_mit_wurzel(j, SR, Some(&w)), Err(Fehler::FehlenderWert { .. })), "{:?}", uebersetze_mit_wurzel(j, SR, Some(&w)).err());
    // inside a makro, and on a makro instance (C10)
    let j = r#"{"format":"baukasten/2","name":"x","makros":{"m":{"knoten":[{"id":"s","art":"sampler","datei":"a.f32"}]}},"knoten":[{"id":"i","art":"makro:m"},{"id":"o","art":"ausgang"}]}"#;
    assert!(matches!(uebersetze_mit_wurzel(j, SR, Some(&w)), Err(Fehler::Wert { .. })), "{:?}", uebersetze_mit_wurzel(j, SR, Some(&w)).err());
    let j = r#"{"format":"baukasten/2","name":"x","makros":{"m":{"knoten":[{"id":"k","art":"konst","wert":1}]}},"knoten":[{"id":"i","art":"makro:m","datei":"a.f32"},{"id":"o","art":"ausgang"}]}"#;
    assert!(matches!(uebersetze_mit_wurzel(j, SR, Some(&w)), Err(Fehler::Wert { .. })), "{:?}", uebersetze_mit_wurzel(j, SR, Some(&w)).err());
}

#[test]
fn no_root_is_an_error_with_a_reason() {
    let j = graph("a.f32", "", 1);
    match uebersetze(&j, SR) {
        Err(Fehler::Datei { grund, .. }) => assert!(grund.contains("no sample root"), "{grund}"),
        a => panic!("{:?}", a.err()),
    }
    assert!(matches!(uebersetze_mit_wurzel(&j, SR, None), Err(Fehler::Datei { .. })));
}

#[test]
fn loaded_data_equals_the_file_bit_for_bit() {
    let w = wurzel();
    let d: Vec<f32> = (0..2 * 5000).map(|i| f32::from_bits(0x3e00_0000 + (i as u32).wrapping_mul(2654435761) % 0x0100_0000)).collect();
    assert!(d.iter().all(|v| v.is_finite()));
    schreibe(&w, "z.f32", &d);
    let mut summe = 0;
    let g = lade_datei(&w, "z.f32", "s", &mut summe).unwrap();
    assert_eq!(g.len(), d.len());
    assert!(g.iter().zip(&d).all(|(a, b)| a.to_bits() == b.to_bits()));
    assert_eq!(summe, d.len() * 4);
}

#[test]
fn non_finite_samples_are_rejected() {
    let w = wurzel();
    for (name, v) in [("nan.f32", f32::NAN), ("inf.f32", f32::INFINITY), ("minf.f32", f32::NEG_INFINITY)] {
        let mut d = ok_datei(100);
        d[2 * 3 + 1] = v; // frame 3, right side
        schreibe(&w, name, &d);
        match mit(&w, name) {
            Err(Fehler::Datei { grund, .. }) => assert!(grund.contains("non-finite sample at frame 3"), "{grund}"),
            a => panic!("{name}: {:?}", a.err()),
        }
    }
}

#[test]
fn slices_shorter_than_four_frames_are_rejected() {
    let w = wurzel();
    schreibe(&w, "a.f32", &ok_datei(100));
    // 100 / 25 = 4 ok, 100 / 26 = 3 too short
    assert!(mit_scheiben(&w, 25).is_ok(), "{:?}", mit_scheiben(&w, 25).err());
    assert!(matches!(mit_scheiben(&w, 26), Err(Fehler::Wert { .. })), "{:?}", mit_scheiben(&w, 26).err());
}

fn mit_scheiben(w: &std::path::Path, n: usize) -> Result<baukasten_dsp::Programm, Fehler> {
    uebersetze_mit_wurzel(&graph("a.f32", &format!(r#","scheiben":{n}"#), 1), SR, Some(w))
}
