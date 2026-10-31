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
    let h = neu(include_str!("../../baukasten_dsp/beispiele/juno-pad.json"));
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
    for (name, g) in [("fx-echo-achtel", include_str!("../../baukasten_dsp/beispiele/fx-echo-achtel.json")),
                      ("fx-filter-wobble", include_str!("../../baukasten_dsp/beispiele/fx-filter-wobble.json"))] {
        let h = neu(g);
        assert!(!h.is_null(), "{name}");
        assert_eq!(cypher_bk_hat_eingang(h), 1, "{name}");
        assert_eq!(cypher_bk_latenz(h), 0, "{name}");
        cypher_bk_frei(h);
    }
}
