//! Baukasten S3a Task 1: C-ABI cypher_bk_* gegen baukasten_dsp direkt. Eine Note bei Versatz k ist bitgleich die um k
//! verschobene Note bei Versatz 0; der FFI-Lauf ist bitgleich derselbe Lauf über Programm; am selben Sample gilt
//! alle_aus vor aus vor an; Fehler kommen als Text zurück; Zeiger null ist harmlos.
use baukasten_dsp::uebersetze;
use hall_ffi::baukasten::*;
use std::ffi::CString;

const G: &str = r#"{"format":"baukasten/2","name":"t","stimmen":2,"knoten":[{"id":"n","art":"note"},{"id":"s","art":"saege"},{"id":"v","art":"mul"},{"id":"o","art":"ausgang"}],"kanten":[{"von":"n.hz","nach":"s.hz"},{"von":"s.aus","nach":"v.a"},{"von":"n.gate","nach":"v.b"},{"von":"v.aus","nach":"o.x"}]}"#;

fn neu(json: &str) -> *mut CypherBk {
    let c = CString::new(json).unwrap();
    let mut fehler = [0 as std::ffi::c_char; 256];
    cypher_bk_neu(c.as_ptr(), 48_000.0, fehler.as_mut_ptr(), fehler.len())
}

fn bloecke(h: *mut CypherBk, n: usize, anzahl: usize) -> Vec<f32> {
    let mut aus = Vec::new();
    for _ in 0..anzahl {
        let (mut l, mut r) = (vec![9.0f32; n], vec![9.0f32; n]);
        assert_eq!(cypher_bk_block(h, l.as_mut_ptr(), r.as_mut_ptr(), n), 0);
        aus.extend(l.iter().zip(&r).flat_map(|(a, b)| [*a, *b]));
    }
    aus
}

#[test]
fn versatz_verschiebt_bitgleich() {
    let lauf = |k: u32| {
        let h = neu(G);
        assert!(!h.is_null());
        assert_eq!(cypher_bk_note_an(h, k, 57, 1.0), 0);
        assert_eq!(cypher_bk_note_aus(h, k + 3000, 57), 0);
        let x = bloecke(h, 256, 30);
        cypher_bk_frei(h);
        x
    };
    let null = lauf(0);
    for k in [1u32, 255, 256, 700] {
        let x = lauf(k);
        let v = 2 * k as usize;
        assert!(x[..v].iter().all(|&s| s == 0.0), "vor dem Versatz {k} still");
        assert_eq!(&x[v..], &null[..null.len() - v], "Versatz {k}");
    }
    assert_ne!(lauf(1)[..200], null[..200], "Gegenprobe: unverschoben verglichen ist k = 1 anders");
}

#[test]
fn ffi_gleich_programm() {
    let mut p = uebersetze(G, 48_000.0).unwrap();
    p.zuruecksetzen();
    let mut soll = Vec::new();
    for i in 0..4096 {
        if i == 100 { p.note_an(60, 0.8); }
        if i == 2100 { p.note_aus(60); }
        let (a, b) = p.sample_stereo();
        soll.extend([a, b]);
    }
    let h = neu(G);
    cypher_bk_note_an(h, 100, 60, 0.8);
    cypher_bk_note_aus(h, 2100, 60);
    let ist = bloecke(h, 512, 8);
    cypher_bk_frei(h);
    assert_eq!(ist, soll);
}

#[test]
fn am_selben_sample_erst_aus_dann_an() {
    // alle_aus vor an am selben Sample; die Reihenfolge aus/an derselben Note regelt Programm (wieder-Merker), nicht die Sortierung
    let h = neu(G);
    cypher_bk_note_an(h, 0, 60, 1.0);
    cypher_bk_note_an(h, 1000, 60, 1.0);   // zuerst gemeldet
    cypher_bk_note_aus(h, 1000, 60);       // danach gemeldet, wird trotzdem vorher ausgeführt
    let x = bloecke(h, 256, 12);
    let spaet = x[2 * 2500..2 * 2600].iter().fold(0.0f32, |m, v| m.max(v.abs()));
    assert!(spaet > 0.05, "Note muss nach 1000 weiterklingen: {spaet}");
    cypher_bk_alle_aus(h, 0);
    cypher_bk_note_an(h, 0, 62, 1.0);      // alle_aus vor an am selben Sample: 62 klingt
    let y = bloecke(h, 256, 4);
    assert!(y[400..].iter().any(|v| v.abs() > 0.05));
    cypher_bk_frei(h);
}

#[test]
fn fehler_und_grenzen() {
    let c = CString::new(r#"{"format":"baukasten/2","name":"t","stimmen":1,"knoten":[{"id":"x","art":"gibtsnicht"}],"kanten":[]}"#).unwrap();
    let mut fehler = [0 as std::ffi::c_char; 256];
    let h = cypher_bk_neu(c.as_ptr(), 48_000.0, fehler.as_mut_ptr(), fehler.len());
    assert!(h.is_null());
    let text = unsafe { std::ffi::CStr::from_ptr(fehler.as_ptr()) }.to_string_lossy().into_owned();
    assert!(text.contains("gibtsnicht"), "Fehlertext: {text}");
    assert!(neu("kein json").is_null());
    let g = CString::new(G).unwrap();
    assert!(cypher_bk_neu(g.as_ptr(), 0.0, std::ptr::null_mut(), 0).is_null());
    assert!(cypher_bk_neu(std::ptr::null(), 48_000.0, std::ptr::null_mut(), 0).is_null());
    // Zeiger null: harmlos, block liefert Stille
    let (mut l, mut r) = ([1.0f32; 64], [1.0f32; 64]);
    assert_eq!(cypher_bk_block(std::ptr::null_mut(), l.as_mut_ptr(), r.as_mut_ptr(), 64), 0);
    assert!(l.iter().chain(&r).all(|&v| v == 0.0));
    assert_eq!(cypher_bk_note_an(std::ptr::null_mut(), 0, 60, 1.0), -1);
    cypher_bk_frei(std::ptr::null_mut());
    // Ton über 127: -2; volle Warteschlange: -1 und verloren zählt
    let h = neu(G);
    assert_eq!(cypher_bk_note_an(h, 0, 128, 1.0), -2);
    for i in 0..BK_MAX_EREIGNISSE as u32 { assert_eq!(cypher_bk_note_aus(h, i, 60), 0); }
    assert_eq!(cypher_bk_note_aus(h, 0, 60), -1);
    assert_eq!(cypher_bk_verloren(h), 1);
    assert_eq!(cypher_bk_panik(h), 0);
    assert_eq!(cypher_bk_latenz(h), 0);
    cypher_bk_frei(h);
}

#[test]
fn meldereihenfolge_egal() {
    // Der Erzeuger meldet erst alle An des Blocks, danach die fälligen Aus (Erzeuger::block, noten_aus): ein spätes An
    // vor einem frühen Aus darf das Aus nicht verzögern.
    let lauf = |umgekehrt: bool, aus_t: u32| {
        let h = neu(G);
        cypher_bk_note_an(h, 0, 57, 1.0);
        if umgekehrt {
            cypher_bk_note_an(h, 300, 60, 1.0);
            cypher_bk_note_aus(h, aus_t, 57);
        } else {
            cypher_bk_note_aus(h, aus_t, 57);
            cypher_bk_note_an(h, 300, 60, 1.0);
        }
        let x = bloecke(h, 512, 1);
        cypher_bk_frei(h);
        x
    };
    assert_eq!(lauf(true, 100), lauf(false, 100), "Meldereihenfolge darf nichts ändern");
    assert_ne!(lauf(true, 100), lauf(true, 400), "Gegenprobe: Aus bei 100 klingt anders als Aus bei 400");
}

#[test]
fn versatz_hinter_dem_block_wandert() {
    let h = neu(G);
    cypher_bk_note_an(h, 300, 60, 1.0);
    let x = bloecke(h, 256, 2);
    assert!(x[..2 * 300].iter().all(|&v| v == 0.0), "vor Sample 300 still");
    assert!(x[2 * 300..].iter().any(|v| v.abs() > 0.0), "ab Sample 300 klingt es (im zweiten Block)");
    cypher_bk_frei(h);
}

const DURCH: &str = r#"{"format":"baukasten/2","name":"durch","stimmen":1,"knoten":[{"id":"e","art":"eingang"},{"id":"o","art":"ausgang"}],"kanten":[{"von":"e.l","nach":"o.l"},{"von":"e.r","nach":"o.r"}]}"#;

#[test]
fn effekt_reicht_durch_und_meldet_eingang() {
    let h = neu(DURCH);
    assert_eq!(cypher_bk_hat_eingang(h), 1);
    let ein_l: Vec<f32> = (0..256).map(|i| (i as f32 * 0.01).sin()).collect();
    let ein_r: Vec<f32> = (0..256).map(|i| (i as f32 * 0.02).cos() * 0.5).collect();
    let (mut l, mut r) = (vec![9.0f32; 256], vec![9.0f32; 256]);
    assert_eq!(cypher_bk_effekt(h, ein_l.as_ptr(), ein_r.as_ptr(), l.as_mut_ptr(), r.as_mut_ptr(), 256), 0);
    assert_eq!(l, ein_l);
    assert_eq!(r, ein_r);
    cypher_bk_frei(h);
}

#[test]
fn instrument_meldet_keinen_eingang_und_effekt_null_ist_still() {
    let h = neu(include_str!("../../modular_dsp/demos/juno-pad.json"));
    assert_eq!(cypher_bk_hat_eingang(h), 0);
    cypher_bk_frei(h);
    assert_eq!(cypher_bk_hat_eingang(std::ptr::null()), 0);
    let ein = vec![0.5f32; 64];
    let (mut l, mut r) = (vec![9.0f32; 64], vec![9.0f32; 64]);
    assert_eq!(cypher_bk_effekt(std::ptr::null_mut(), ein.as_ptr(), ein.as_ptr(), l.as_mut_ptr(), r.as_mut_ptr(), 64), 0);
    assert!(l.iter().chain(r.iter()).all(|&x| x == 0.0));
}

#[test]
fn takt_kommt_durch_die_ffi() {
    let g = r#"{"format":"baukasten/2","name":"lfo","stimmen":1,"knoten":[{"id":"l","art":"lfo","form":2,"takt":1},{"id":"o","art":"ausgang"}],"kanten":[{"von":"l.aus","nach":"o.x"}]}"#;
    let h = neu(g);
    cypher_bk_takt(h, 3.25, 2.0 / 48_000.0);
    let (mut l, mut r) = (vec![0.0f32; 4], vec![0.0f32; 4]);
    cypher_bk_block(h, l.as_mut_ptr(), r.as_mut_ptr(), 4);
    assert!((l[0] + 0.5).abs() < 1e-6, "Beat 3,25 → Säge -0,5, ist {}", l[0]);
    cypher_bk_frei(h);
}

#[test]
fn beispiel_effekte_laden() {
    for (name, g) in [("fx-echo-achtel", include_str!("../../modular_dsp/demos/fx-echo-achtel.json")),
                      ("fx-filter-wobble", include_str!("../../modular_dsp/demos/fx-filter-wobble.json"))] {
        let h = neu(g);
        assert!(!h.is_null(), "{name}");
        assert_eq!(cypher_bk_hat_eingang(h), 1, "{name}");
        assert_eq!(cypher_bk_latenz(h), 0, "{name}");
        cypher_bk_frei(h);
    }
}

// ---- S5r Task 1: cypher_bk_regler, 20 ms einpolig geglättet ----

/// Säge × Gate × Regler 1 (0..1): der Reglerwert skaliert den Pegel einer Note
const GR: &str = r#"{"format":"baukasten/2","name":"r","stimmen":1,"knoten":[{"id":"n","art":"note"},{"id":"s","art":"saege"},{"id":"v","art":"mul"},{"id":"r","art":"regler","nr":1,"min":0,"max":1},{"id":"w","art":"mul"},{"id":"o","art":"ausgang"}],"kanten":[{"von":"n.hz","nach":"s.hz"},{"von":"s.aus","nach":"v.a"},{"von":"n.gate","nach":"v.b"},{"von":"v.aus","nach":"w.a"},{"von":"r.aus","nach":"w.b"},{"von":"w.aus","nach":"o.x"}]}"#;
/// Regler 1 direkt auf den Ausgang: die Ausgabe ist der Reglerwert selbst
const RD: &str = r#"{"format":"baukasten/2","name":"rd","stimmen":1,"knoten":[{"id":"r","art":"regler","nr":1,"min":0,"max":1},{"id":"o","art":"ausgang"}],"kanten":[{"von":"r.aus","nach":"o.x"}]}"#;

#[test]
fn regler_ffi_gleich_programm_nach_einschwingen() {
    let n = 48_000usize;
    let mut p = uebersetze(GR, 48_000.0).unwrap();
    p.zuruecksetzen();
    p.setze_regler(1, 0.9);
    p.note_an(57, 1.0);
    let mut soll = Vec::new();
    for _ in 0..n {
        let (a, _) = p.sample_stereo();
        soll.push(a);
    }
    let h = neu(GR);
    assert_eq!(cypher_bk_regler(h, 1, 0.9), 0);
    cypher_bk_note_an(h, 0, 57, 1.0);
    let ist: Vec<f32> = bloecke(h, 480, n / 480).chunks(2).map(|c| c[0]).collect();
    cypher_bk_frei(h);
    assert_eq!(ist.len(), n);
    for i in n - 4800..n {
        assert!((ist[i] - soll[i]).abs() < 1e-4, "Sample {i}: ffi {} programm {}", ist[i], soll[i]);
    }
    let abw = (0..480).fold(0.0f32, |m, i| m.max((ist[i] - soll[i]).abs()));
    assert!(abw > 0.05, "Gegenprobe: in den ersten 480 Samples wirkt die Glättung, max. Abweichung {abw}");
}

#[test]
fn regler_glaettet_20ms() {
    let h = neu(RD);
    assert_eq!(bloecke(h, 64, 1)[0], 0.5, "Start 0,5 (D8)");
    assert_eq!(cypher_bk_regler(h, 1, 1.0), 0);
    let x: Vec<f32> = bloecke(h, 960, 50).chunks(2).map(|c| c[0]).collect();
    cypher_bk_frei(h);
    // Sprung 0,5 -> 1,0 ab Sample 0: nach 960 Samples (20 ms) 63 % des Wegs, also 0,5 + 0,5 * 0,632
    let weg = (x[959] - 0.5) / 0.5;
    assert!((weg - 0.632).abs() < 0.03, "Weg nach 20 ms: {weg}");
    assert!(x[0] < 0.51, "erstes Sample springt nicht: {}", x[0]);
    assert!((x[x.len() - 1] - 1.0).abs() < 1e-3, "am Ende angekommen: {}", x[x.len() - 1]);
}

#[test]
fn regler_klemmt_und_prueft() {
    let h = neu(RD);
    assert_eq!(cypher_bk_regler(h, 0, 0.7), -1);
    assert_eq!(cypher_bk_regler(h, 9, 0.7), -1);
    assert_eq!(cypher_bk_regler(std::ptr::null_mut(), 1, 0.7), -1);
    cypher_bk_frei(h);
    let lauf = |wert: Option<f32>| {
        let h = neu(RD);
        if let Some(w) = wert {
            assert_eq!(cypher_bk_regler(h, 1, w), 0);
        }
        let x = bloecke(h, 480, 20);
        cypher_bk_frei(h);
        x
    };
    assert_eq!(lauf(Some(2.0)), lauf(Some(1.0)), "2,0 wirkt wie 1,0");
    assert_eq!(lauf(Some(-3.0)), lauf(Some(0.0)), "negativ wirkt wie 0");
    assert_eq!(lauf(Some(f32::NAN)), lauf(None), "NaN ändert nichts");
    assert_eq!(lauf(Some(f32::INFINITY)), lauf(Some(1.0)), "unendlich wird geklemmt");
    assert_ne!(lauf(Some(1.0)), lauf(None), "Gegenprobe: ein echter Wert ändert die Ausgabe");
}

/// S5r K4: die Glättung rastet ein. Nach einer Sekunde Ruhe liegt der Reglerwert bitgleich am Ziel (in float32 käme
/// das Einpol-Filter sonst nur auf ~3e-5 heran und riefe `setze_regler` mit einem Wert knapp daneben jedes Sample).
#[test]
fn regler_rastet_am_ziel_ein() {
    for ziel in [0.9f32, 0.37, 0.0, 1.0] {
        let h = neu(RD);
        assert_eq!(cypher_bk_regler(h, 1, ziel), 0);
        let x: Vec<f32> = bloecke(h, 960, 50).chunks(2).map(|c| c[0]).collect();
        cypher_bk_frei(h);
        let letzte = &x[x.len() - 4800..];
        assert!(
            letzte.iter().all(|v| v.to_bits() == ziel.to_bits()),
            "Ziel {ziel}: letzte Werte {:?} nicht bitgleich",
            &letzte[..3]
        );
    }
    // Negativkontrolle: ein Ziel ändert sich später erneut, die Glättung läuft wieder an und rastet wieder ein
    let h = neu(RD);
    assert_eq!(cypher_bk_regler(h, 1, 0.9), 0);
    bloecke(h, 960, 50);
    assert_eq!(cypher_bk_regler(h, 1, 0.2), 0);
    let y: Vec<f32> = bloecke(h, 960, 50).chunks(2).map(|c| c[0]).collect();
    cypher_bk_frei(h);
    assert!(y[0] > 0.8, "neues Ziel wirkt erst geglättet: {}", y[0]);
    assert_eq!(y[y.len() - 1].to_bits(), 0.2f32.to_bits());
}

// ---- S10 task 3: cypher_bk_neu_wurzel ----

const SAMPLER_G: &str = r#"{"format":"baukasten/2","name":"s","stimmen":2,"knoten":[{"id":"n","art":"note"},{"id":"s","art":"sampler","datei":"d.f32"},{"id":"o","art":"ausgang"}],"kanten":[{"von":"n.hz","nach":"s.hz"},{"von":"n.trig","nach":"s.trig"},{"von":"n.gate","nach":"s.gate"},{"von":"s.l","nach":"o.l"},{"von":"s.r","nach":"o.r"}]}"#;

fn wurzel_mit_probe(name: &str) -> std::path::PathBuf {
    let w = std::env::temp_dir().join(format!("bk-s10-ffi-{}-{name}", std::process::id()));
    std::fs::create_dir_all(&w).unwrap();
    let d: Vec<f32> = (0..2 * 20_000).map(|i| ((i / 2) as f32 * 0.05).sin() * 0.5).collect();
    std::fs::write(w.join("d.f32"), d.iter().flat_map(|v| v.to_le_bytes()).collect::<Vec<u8>>()).unwrap();
    w
}

fn neu_wurzel(json: &str, wurzel: Option<&std::path::Path>) -> (*mut CypherBk, String) {
    let c = CString::new(json).unwrap();
    let w = wurzel.map(|p| CString::new(p.to_str().unwrap()).unwrap());
    let mut fehler = [0 as std::ffi::c_char; 256];
    let h = cypher_bk_neu_wurzel(c.as_ptr(), 48_000.0, w.as_ref().map_or(std::ptr::null(), |c| c.as_ptr()), fehler.as_mut_ptr(), fehler.len());
    let text = unsafe { std::ffi::CStr::from_ptr(fehler.as_ptr()) }.to_string_lossy().into_owned();
    (h, text)
}

#[test]
fn wurzel_spielt_den_sampler_graphen_bitgleich_wie_programm() {
    let w = wurzel_mit_probe("spielt");
    let (h, fehler) = neu_wurzel(SAMPLER_G, Some(&w));
    assert!(!h.is_null(), "{fehler}");
    cypher_bk_note_an(h, 100, 60, 0.8);
    let ist = bloecke(h, 512, 8);
    cypher_bk_frei(h);
    assert!(ist[2 * 100..].iter().any(|v| v.abs() > 0.1), "silent after a note");
    assert!(ist[..2 * 100].iter().all(|v| *v == 0.0));
    let mut p = baukasten_dsp::uebersetze_mit_wurzel(SAMPLER_G, 48_000.0, Some(&w)).unwrap();
    p.zuruecksetzen();
    let mut soll = Vec::new();
    for i in 0..4096 {
        if i == 100 { p.note_an(60, 0.8); }
        let (a, b) = p.sample_stereo();
        soll.extend([a, b]);
    }
    assert_eq!(ist, soll);
}

#[test]
fn ohne_wurzel_ist_ein_sampler_graph_ein_fehler() {
    let (h, fehler) = neu_wurzel(SAMPLER_G, None);
    assert!(h.is_null());
    assert!(fehler.contains("no sample root"), "{fehler}");
    // the old entry point behaves the same
    let c = CString::new(SAMPLER_G).unwrap();
    let mut f = [0 as std::ffi::c_char; 256];
    assert!(cypher_bk_neu(c.as_ptr(), 48_000.0, f.as_mut_ptr(), f.len()).is_null());
    let text = unsafe { std::ffi::CStr::from_ptr(f.as_ptr()) }.to_string_lossy().into_owned();
    assert!(text.contains("no sample root"), "{text}");
}

#[test]
fn wurzel_pfad_und_dateifehler_kommen_als_text() {
    let w = wurzel_mit_probe("fehler");
    for (name, grund) in [("../d.f32", "must not contain .."), ("a/b.f32", "may only contain"), ("fehlt.f32", "not readable")] {
        let (h, fehler) = neu_wurzel(&SAMPLER_G.replace("d.f32", name), Some(&w));
        assert!(h.is_null(), "{name}");
        assert!(fehler.contains(grund), "{name}: {fehler}");
    }
}

#[test]
fn neu_ist_fuer_alle_vorhandenen_beispiele_unveraendert() {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../modular_dsp/demos");
    let mut n = 0;
    for e in std::fs::read_dir(&dir).unwrap() {
        let p = e.unwrap().path();
        if p.extension().map_or(true, |x| x != "json") { continue; }
        let text = std::fs::read_to_string(&p).unwrap();
        let h = neu(&text);
        // sampler (S10) and faltung (S21) read files from the graph folder, so they need a root
        let datei = ["sampler", "faltung"].iter().any(|a| text.contains(&format!(r#""art": "{a}""#)) || text.contains(&format!(r#""art":"{a}""#)));
        if datei {
            assert!(h.is_null(), "{p:?}: a graph with a file node needs a root");
            let w = wurzel_mit_probe("beispiel");
            std::fs::write(w.join("orchester-schlag.f32"), std::fs::read(w.join("d.f32")).unwrap()).unwrap();
            // S22: sampler-fairlight reads the hit as three detune slices
            std::fs::write(w.join("orchester-schlag-schichten.f32"), std::fs::read(w.join("d.f32")).unwrap()).unwrap();
            std::fs::write(w.join("feder-ir.f32"), baukasten_dsp::proben::bytes(&baukasten_dsp::proben::feder_ir(48_000.0))).unwrap();
            let (h2, f) = neu_wurzel(&text, Some(&w));
            assert!(!h2.is_null(), "{p:?}: {f}");
            cypher_bk_frei(h2);
        } else {
            assert!(!h.is_null(), "{p:?}");
            n += 1;
        }
        cypher_bk_frei(h);
    }
    assert!(n >= 20, "only {n} examples compared");
}

// ---- S20 task 1: cypher_bk_zuruecksetzen ----

/// saw x gate x knob 1 (0..1) plus free-running noise: noise and the oscillator phase are state that only a reset clears
const G_RAUSCH: &str = r#"{"format":"baukasten/2","name":"t","stimmen":2,"knoten":[{"id":"n","art":"note"},{"id":"s","art":"saege"},{"id":"v","art":"mul"},{"id":"k","art":"regler","nr":1,"min":0,"max":1},{"id":"vk","art":"mul"},{"id":"r","art":"rauschen"},{"id":"rv","art":"mul","b":0.2},{"id":"m","art":"add"},{"id":"o","art":"ausgang"}],"kanten":[{"von":"n.hz","nach":"s.hz"},{"von":"s.aus","nach":"v.a"},{"von":"n.gate","nach":"v.b"},{"von":"v.aus","nach":"vk.a"},{"von":"k.aus","nach":"vk.b"},{"von":"r.aus","nach":"rv.a"},{"von":"vk.aus","nach":"m.a"},{"von":"rv.aus","nach":"m.b"},{"von":"m.aus","nach":"o.x"}]}"#;

/// one fixed run: note 57 for 4800 samples in blocks of 256 (the note ends at 3000)
fn lauf_noten(h: *mut CypherBk) -> Vec<f32> {
    assert_eq!(cypher_bk_note_an(h, 10, 57, 1.0), 0);
    assert_eq!(cypher_bk_note_aus(h, 3000, 57), 0);
    bloecke(h, 256, 19)
}

#[test]
fn zuruecksetzen_wie_frisch() {
    let frisch = {
        let h = neu(G_RAUSCH);
        assert!(!h.is_null());
        let x = lauf_noten(h);
        cypher_bk_frei(h);
        x
    };
    assert!(frisch.iter().any(|v| v.abs() > 0.05), "positive control: the graph sounds");
    let h = neu(G_RAUSCH);
    let erster = lauf_noten(h);
    assert_eq!(erster, frisch, "the same run on a fresh instance is deterministic");
    // negative control: without the reset the second run differs (free-running noise and phase have moved on)
    let ohne = lauf_noten(h);
    assert_ne!(ohne, frisch, "without a reset the second run is not the first");
    cypher_bk_zuruecksetzen(h);
    let zweiter = lauf_noten(h);
    assert_eq!(zweiter, frisch, "after the reset the run equals a fresh instance");
    cypher_bk_frei(h);
}

/// saw x gate x knob 1, no free-running state: a settled knob is the only thing that differs from "fresh"
const G_KNOPF: &str = r#"{"format":"baukasten/2","name":"t","stimmen":2,"knoten":[{"id":"n","art":"note"},{"id":"s","art":"saege"},{"id":"v","art":"mul"},{"id":"k","art":"regler","nr":1,"min":0,"max":1},{"id":"vk","art":"mul"},{"id":"o","art":"ausgang"}],"kanten":[{"von":"n.hz","nach":"s.hz"},{"von":"s.aus","nach":"v.a"},{"von":"n.gate","nach":"v.b"},{"von":"v.aus","nach":"vk.a"},{"von":"k.aus","nach":"vk.b"},{"von":"vk.aus","nach":"o.x"}]}"#;

#[test]
fn zuruecksetzen_behaelt_regler() {
    let spitze = |x: &[f32]| x.iter().fold(0.0f32, |m, v| m.max(v.abs()));
    // reference: fresh instance, knob 0.9 settled (40 blocks = 10240 samples >> 20 ms), no reset
    let soll = {
        let h = neu(G_KNOPF);
        assert_eq!(cypher_bk_regler(h, 1, 0.9), 0);
        bloecke(h, 256, 40);
        let x = lauf_noten(h);
        cypher_bk_frei(h);
        x
    };
    // the reset after a note and the settled knob: the knob value still applies afterwards
    let ist = {
        let h = neu(G_KNOPF);
        assert_eq!(cypher_bk_regler(h, 1, 0.9), 0);
        cypher_bk_note_an(h, 0, 50, 1.0);
        bloecke(h, 256, 40);
        cypher_bk_zuruecksetzen(h);
        let x = lauf_noten(h);
        cypher_bk_frei(h);
        x
    };
    assert_eq!(ist, soll, "the knob path survives the reset");
    // negative control: the default knob 0.5 is clearly quieter than the kept 0.9
    let h = neu(G_KNOPF);
    let niedrig = lauf_noten(h);
    cypher_bk_frei(h);
    assert!(spitze(&ist) > spitze(&niedrig) * 1.3, "0.9 louder than 0.5: {} vs {}", spitze(&ist), spitze(&niedrig));
}

#[test]
fn zuruecksetzen_leert_die_warteschlange() {
    let h = neu(G_RAUSCH);
    assert_eq!(cypher_bk_note_an(h, 0, 57, 1.0), 0);   // queued, not yet rendered
    cypher_bk_zuruecksetzen(h);
    let x = bloecke(h, 256, 4);
    // only the free-running noise may be present; the queued note must not sound: compare against an instance that never got it
    let g = neu(G_RAUSCH);
    let y = bloecke(g, 256, 4);
    assert_eq!(x, y, "a note queued before the reset does not survive it");
    cypher_bk_frei(h);
    cypher_bk_frei(g);
}

#[test]
fn zuruecksetzen_null_handle_ist_harmlos() {
    cypher_bk_zuruecksetzen(std::ptr::null_mut());
}

#[test]
fn regler_sofort_springt_ohne_rampe() {
    // reference: knob 0.9 settled over 40 blocks, then the fixed run
    let soll = {
        let h = neu(G_KNOPF);
        assert_eq!(cypher_bk_regler(h, 1, 0.9), 0);
        bloecke(h, 256, 40);
        let x = lauf_noten(h);
        cypher_bk_frei(h);
        x
    };
    // sofort: the same values from the first block on, no settling blocks
    let h = neu(G_KNOPF);
    assert_eq!(cypher_bk_regler_sofort(h, 1, 0.9), 0);
    let sofort = lauf_noten(h);
    cypher_bk_frei(h);
    assert_eq!(sofort, soll, "regler_sofort starts on the settled value");
    // negative control: the smoothed call from the same start differs in the first blocks (the ramp is audible)
    let h = neu(G_KNOPF);
    assert_eq!(cypher_bk_regler(h, 1, 0.9), 0);
    let geglaettet = lauf_noten(h);
    cypher_bk_frei(h);
    assert_ne!(geglaettet, soll, "the smoothed call ramps over 20 ms");
    // bounds as regler: nr outside 1..8 and null are refused, NaN ignored, values clamped
    let h = neu(G_KNOPF);
    assert_eq!(cypher_bk_regler_sofort(h, 0, 0.5), -1);
    assert_eq!(cypher_bk_regler_sofort(h, 9, 0.5), -1);
    assert_eq!(cypher_bk_regler_sofort(std::ptr::null_mut(), 1, 0.5), -1);
    assert_eq!(cypher_bk_regler_sofort(h, 1, f32::NAN), 0);
    assert_eq!(cypher_bk_regler_sofort(h, 1, 7.0), 0);   // clamped to 1.0
    let eins = lauf_noten(h);
    cypher_bk_frei(h);
    let h = neu(G_KNOPF);
    assert_eq!(cypher_bk_regler_sofort(h, 1, 1.0), 0);
    assert_eq!(lauf_noten(h), eins, "7.0 is clamped to 1.0");
    cypher_bk_frei(h);
}
