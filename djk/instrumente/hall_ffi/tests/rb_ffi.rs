//! RB-338 über die C-Grenze (D1 K2a, Spec 2.4 und A3): Noten sample-genau (Verschiebungs-Invarianz), Zurücksetzen macht Läufe bitgleich,
//! Parameter über die IDs aus rb338, harmlos bei null.
use hall_ffi::*;
use std::ffi::CStr;

const N: usize = 256;

fn neu() -> *mut CypherRb {
    let h = cypher_rb_neu(48000.0);
    assert!(!h.is_null());
    h
}

fn block(h: *mut CypherRb, n: usize) -> Vec<f32> {
    let (mut l, mut r) = (vec![9.0f32; n], vec![9.0f32; n]);
    unsafe { cypher_rb_block(h, l.as_mut_ptr(), r.as_mut_ptr(), n) };
    assert_eq!(l, r, "die Stimme ist mono, beide Kanäle gleich");
    l
}

fn setze(h: *mut CypherRb, id: &CStr, wert: f32) -> i32 { unsafe { cypher_rb_setze(h, id.as_ptr(), wert) } }

fn erstes_nicht_null(x: &[f32]) -> Option<usize> { x.iter().position(|v| *v != 0.0) }

// Ersetzt in der Fix-Runde (Spec 1, A3 Fassung 2.1: das erste Nicht-Null-Sample ist kein Maß):
// note_ein_beim_versatz_k_ist_das_erste_nicht_null_sample und frisch_bei_versatz_null_beginnt_der_saegezahn_bei_null
// durch a3_verschiebungs_invarianz_bitgleich (unten).

#[test]
fn versatz_hinter_dem_block_wirkt_im_folgeblock() {
    let h = neu();
    unsafe { cypher_rb_note_an(h, (N + 10) as u32, 36, 100) };
    let erster = block(h, N);
    assert_eq!(erstes_nicht_null(&erster), None, "im ersten Block noch nichts");
    let mut a = erster;
    a.extend(block(h, N));
    a.extend(block(h, N));
    assert!(a[..N + 10].iter().all(|v| *v == 0.0), "vor dem Versatz still");
    assert!(a[N + 10..].iter().any(|v| *v != 0.0), "danach klingt sie");
    // Gegenprobe: eine zweite Instanz bekommt die Note erst vor dem zweiten Block, mit Versatz 10: bitgleich
    let g = neu();
    let mut b = block(g, N);
    unsafe { cypher_rb_note_an(g, 10, 36, 100) };
    b.extend(block(g, N));
    b.extend(block(g, N));
    assert_eq!(a, b);
    unsafe { cypher_rb_frei(h); cypher_rb_frei(g) };
}

#[test]
fn reihenfolge_der_meldungen_egal_nur_der_versatz_zaehlt() {
    let (h, g) = (neu(), neu());
    unsafe {
        cypher_rb_note_an(h, 10, 36, 100);
        cypher_rb_note_an(h, 60, 43, 127);
        cypher_rb_note_aus(h, 200, 36);
        cypher_rb_note_aus(h, 90, 43);
        // dieselben Ereignisse rückwärts gemeldet
        cypher_rb_note_aus(g, 90, 43);
        cypher_rb_note_aus(g, 200, 36);
        cypher_rb_note_an(g, 60, 43, 127);
        cypher_rb_note_an(g, 10, 36, 100);
    }
    let (a, b) = ([block(h, N), block(h, N)].concat(), [block(g, N), block(g, N)].concat());
    assert_eq!(a, b);
    unsafe { cypher_rb_frei(h); cypher_rb_frei(g) };
}

/// Ein Lauf, wie ihn der Kern beim Transport-Start fährt: Parameter des Snapshots setzen, zurücksetzen, dann Noten mit
/// Versatz über mehrere Blöcke, mittendrin ein Parameterwechsel (Glätter läuft), Slide, Akzent, Note über die Blockgrenze.
fn lauf(h: *mut CypherRb, zuruecksetzen: bool) -> Vec<f32> {
    setze(h, c"cutoff", 0.35);
    setze(h, c"resonanz", 0.7);
    setze(h, c"env_mod", 0.6);
    if zuruecksetzen {
        unsafe { cypher_rb_zuruecksetzen(h) };
    }
    let mut aus = Vec::new();
    for b in 0..40u32 {
        unsafe {
            match b {
                0 => { cypher_rb_note_an(h, 5, 36, 100); cypher_rb_note_aus(h, 200, 36); }
                2 => { cypher_rb_note_an(h, 100, 38, 127); }
                3 => { cypher_rb_note_an(h, 0, 41, 100); cypher_rb_note_aus(h, 3, 38); } // Slide 38 → 41
                4 => { cypher_rb_note_aus(h, 300, 41); } // über die Blockgrenze
                6 => { setze(h, c"cutoff", 0.8); cypher_rb_note_an(h, 17, 48, 90); }
                9 => { cypher_rb_alle_aus(h, 33); }
                _ => {}
            }
        }
        aus.extend(block(h, N));
    }
    aus
}

#[test]
fn zuruecksetzen_macht_gleiche_noten_bitgleich() {
    let h = neu();
    // den Zustand verschmutzen: Phase, Filter, Hüllkurven, Glide, Glätter mitten im Lauf
    unsafe {
        cypher_rb_note_an(h, 3, 30, 127);
        cypher_rb_note_an(h, 70, 55, 100);
    }
    setze(h, c"cutoff", 0.1);
    setze(h, c"lautstaerke", 0.9);
    block(h, 100);
    let a = lauf(h, true);
    let b = lauf(h, true);
    assert!(a.iter().any(|v| *v != 0.0), "Positivkontrolle: der Lauf klingt");
    assert_eq!(a, b, "zweimal gleiche Noten nach zuruecksetzen");
    // frische Instanz mit derselben Lautstärke: derselbe Lauf, also kein Rest des Vorlebens
    let g = neu();
    setze(g, c"lautstaerke", 0.9);
    let c = lauf(g, true);
    assert_eq!(a, c, "frische Instanz gleich der benutzten nach zuruecksetzen");
    // Negativ-Kontrolle: ohne zuruecksetzen läuft der Zustand weiter, der Test sieht das
    let d = lauf(h, false);
    assert_ne!(a, d, "ohne zuruecksetzen darf der Lauf nicht zufällig gleich sein");
    unsafe { cypher_rb_frei(h); cypher_rb_frei(g) };
}

#[test]
fn vorgaben_vor_dem_lauf_machen_teil_parameter_bitgleich_zur_frischen_instanz() {
    // Eine Wiedergabe nennt nur einen Teil der Parameter (Spec 3.2). Der Kern-Lauf: vorgaben, setze (was genannt ist),
    // zuruecksetzen. Dann ist es egal, was ein früherer Lauf gesetzt hat: gleich einer frischen Instanz (= Render).
    let teil = |h: *mut CypherRb| {
        unsafe { cypher_rb_vorgaben(h) };
        setze(h, c"cutoff", 0.3);
        unsafe { cypher_rb_zuruecksetzen(h); cypher_rb_note_an(h, 9, 36, 127); cypher_rb_note_aus(h, 900, 36) };
        (0..20).flat_map(|_| block(h, N)).collect::<Vec<f32>>()
    };
    let h = neu();
    for (id, w) in [(c"wellenform", 1.0), (c"resonanz", 0.9), (c"env_mod", 0.1), (c"decay", 0.0), (c"accent", 1.0), (c"lautstaerke", 1.0)] {
        setze(h, id, w);
    }
    unsafe { cypher_rb_note_an(h, 0, 40, 100) };
    block(h, N);
    let a = teil(h);
    let b = teil(neu());
    assert!(a.iter().any(|v| *v != 0.0));
    assert_eq!(a, b);
    // Gegenprobe: ohne vorgaben trägt der Lauf die alten Werte
    let g = neu();
    setze(g, c"resonanz", 0.9);
    setze(g, c"cutoff", 0.3);
    unsafe { cypher_rb_zuruecksetzen(g); cypher_rb_note_an(g, 9, 36, 127); cypher_rb_note_aus(g, 900, 36) };
    let c: Vec<f32> = (0..20).flat_map(|_| block(g, N)).collect();
    assert_ne!(c, b);
    unsafe { cypher_rb_vorgaben(std::ptr::null_mut()); cypher_rb_frei(h); cypher_rb_frei(g) };
}

#[test]
fn zuruecksetzen_verwirft_gemeldete_noten_des_alten_laufs() {
    let h = neu();
    unsafe {
        cypher_rb_note_an(h, 300, 36, 100); // gehört in den nächsten Block, kommt aber nicht mehr dran
        cypher_rb_zuruecksetzen(h);
    }
    assert_eq!(erstes_nicht_null(&[block(h, N), block(h, N)].concat()), None);
    unsafe { cypher_rb_frei(h) };
}

#[test]
fn alle_aus_leert_den_notenstapel() {
    // 36 gehalten, 48 gleitet darüber, alle aus; das spätere Aus der 48 darf NICHT zur 36 zurückgleiten
    let mit = |alle: bool| {
        let h = neu();
        unsafe {
            cypher_rb_note_an(h, 0, 36, 100);
            cypher_rb_note_an(h, 50, 48, 100);
            if alle { cypher_rb_alle_aus(h, 100); }
            cypher_rb_note_aus(h, 150, 48);
        }
        let x: Vec<f32> = (0..60).flat_map(|_| block(h, N)).collect();
        unsafe { cypher_rb_frei(h) };
        x
    };
    let (mit_aus, ohne) = (mit(true), mit(false));
    let spaet = 150 + 48 * 200; // 200 ms nach dem Aus: das Gate (8 ms) ist zu
    assert!(mit_aus[spaet..].iter().all(|v| *v == 0.0), "nach alle_aus bleibt es still");
    assert!(ohne[spaet..].iter().any(|v| *v != 0.0), "Gegenprobe: ohne alle_aus klingt die 36 weiter");
}

#[test]
fn alle_aus_am_versatz_wie_note_aus_bei_einer_note() {
    let (h, g) = (neu(), neu());
    unsafe {
        cypher_rb_note_an(h, 0, 36, 100);
        cypher_rb_alle_aus(h, 77);
        cypher_rb_note_an(g, 0, 36, 100);
        cypher_rb_note_aus(g, 77, 36);
    }
    let (a, b) = ([block(h, N), block(h, N)].concat(), [block(g, N), block(g, N)].concat());
    assert_eq!(a, b);
    unsafe { cypher_rb_frei(h); cypher_rb_frei(g) };
}

#[test]
fn velocity_null_ist_note_aus() {
    let (h, g) = (neu(), neu());
    unsafe {
        cypher_rb_note_an(h, 0, 36, 100);
        cypher_rb_note_an(h, 90, 36, 0);
        cypher_rb_note_an(g, 0, 36, 100);
        cypher_rb_note_aus(g, 90, 36);
    }
    assert_eq!([block(h, N), block(h, N)].concat(), [block(g, N), block(g, N)].concat());
    unsafe { cypher_rb_frei(h); cypher_rb_frei(g) };
}

#[test]
fn parameter_ueber_die_ids_aus_rb338() {
    let h = neu();
    for id in [c"lautstaerke", c"wellenform", c"cutoff", c"resonanz", c"env_mod", c"decay", c"accent"] {
        assert_eq!(setze(h, id, 0.5), 0, "{id:?}");
    }
    assert_eq!(setze(h, c"volume", 0.5), -1, "Spec-Name statt ID: unbekannt");
    assert_eq!(setze(h, c"Cutoff", 0.5), -1, "Anzeigename statt ID: unbekannt");
    assert_eq!(setze(h, c"cutoff", f32::NAN), -2);
    assert_eq!(unsafe { cypher_rb_setze(h, std::ptr::null(), 0.5) }, -1);
    unsafe { cypher_rb_frei(h) };
}

#[test]
fn parameter_wirken_am_ausgang() {
    let klang = |id: &CStr, wert: f32| {
        let h = neu();
        setze(h, id, wert);
        unsafe {
            cypher_rb_zuruecksetzen(h);
            cypher_rb_note_an(h, 0, 36, 100);
        }
        let x: Vec<f32> = (0..20).flat_map(|_| block(h, N)).collect();
        unsafe { cypher_rb_frei(h) };
        x
    };
    let energie = |x: &[f32]| x.iter().map(|v| (*v as f64).powi(2)).sum::<f64>();
    for id in [c"wellenform", c"cutoff", c"resonanz", c"env_mod", c"decay"] {
        assert_ne!(klang(id, 0.0), klang(id, 1.0), "{id:?} wirkt nicht");
    }
    // Lautstärke: 0 dB gegen −48 dB, 48 dB Abstand in der Energie (Faktor 10^4,8)
    let verh = energie(&klang(c"lautstaerke", 1.0)) / energie(&klang(c"lautstaerke", 0.0));
    let db = 10.0 * verh.log10();
    assert!((db - 48.0).abs() < 0.01, "Lautstärke-Abstand {db} dB");
}

#[test]
fn vorgabe_lautstaerke_minus_12_db() {
    let pegel = |vorher: Option<f32>| {
        let h = neu();
        if let Some(w) = vorher { setze(h, c"lautstaerke", w); }
        unsafe { cypher_rb_zuruecksetzen(h); cypher_rb_note_an(h, 0, 36, 100); }
        let x: Vec<f32> = (0..20).flat_map(|_| block(h, N)).collect();
        unsafe { cypher_rb_frei(h) };
        x.iter().map(|v| (*v as f64).powi(2)).sum::<f64>()
    };
    let db = 10.0 * (pegel(None) / pegel(Some(1.0))).log10();
    assert!((db + 12.0).abs() < 1e-3, "Vorgabe {db} dB unter 0 dB");
}

#[test]
fn warteschlange_voll_meldet_statt_zu_wachsen() {
    let h = neu();
    for i in 0..256 { assert_eq!(unsafe { cypher_rb_note_an(h, i, 36, 100) }, 0, "Ereignis {i}"); }
    assert_eq!(unsafe { cypher_rb_note_an(h, 0, 36, 100) }, -1);
    assert_eq!(unsafe { cypher_rb_note_aus(h, 0, 36) }, -1);
    assert_eq!(unsafe { cypher_rb_alle_aus(h, 0) }, -1);
    block(h, N);
    assert_eq!(unsafe { cypher_rb_note_an(h, 0, 36, 100) }, 0, "nach dem Block ist wieder Platz");
    assert_eq!(unsafe { cypher_rb_note_an(h, 0, 128, 100) }, -2, "Ton außerhalb 0..127");
    unsafe { cypher_rb_frei(h) };
}

#[test]
fn null_zeiger_sind_harmlos() {
    let (mut l, mut r) = (vec![1.0f32; N], vec![1.0f32; N]);
    unsafe {
        cypher_rb_block(std::ptr::null_mut(), l.as_mut_ptr(), r.as_mut_ptr(), N);
        assert_eq!(cypher_rb_note_an(std::ptr::null_mut(), 0, 36, 100), -1);
        assert_eq!(cypher_rb_note_aus(std::ptr::null_mut(), 0, 36), -1);
        assert_eq!(cypher_rb_alle_aus(std::ptr::null_mut(), 0), -1);
        assert_eq!(cypher_rb_setze(std::ptr::null_mut(), c"cutoff".as_ptr(), 0.5), -1);
        cypher_rb_zuruecksetzen(std::ptr::null_mut());
        cypher_rb_frei(std::ptr::null_mut());
        // leerer Block mit Nullzeigern (der Kern ruft nie so, aber die Grenze hält es aus)
        let h = cypher_rb_neu(48000.0);
        cypher_rb_block(h, std::ptr::null_mut(), std::ptr::null_mut(), 0);
        cypher_rb_block(std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut(), 0);
        cypher_rb_frei(h);
    }
    assert!(l.iter().chain(r.iter()).all(|v| *v == 0.0), "null liefert Stille");
}

// ---------------------------------------------------------------- Fix-Runde K2a (Spec 2.4 und 6, Fassung 2.1)

fn energie(x: &[f32]) -> f64 { x.iter().map(|v| (*v as f64).powi(2)).sum() }

/// A3 (Spec 1): eine Note bei Versatz k ergibt nach `zuruecksetzen` bitgleich dieselbe Ausgabe wie bei Versatz 0, um k
/// Samples verschoben. `vorab`: alle Noten vor dem ersten Block melden (Versatz wandert über die Blöcke), sonst je Block
/// mit dem Versatz im Block (wie der Kern es aus dem Snapshot tut).
fn a3_lauf(k: usize, vorab: bool, bloecke: usize) -> Vec<f32> {
    let h = neu();
    unsafe { cypher_rb_vorgaben(h) };
    setze(h, c"cutoff", 0.4);
    setze(h, c"resonanz", 0.8);
    setze(h, c"env_mod", 0.7);
    // den Zustand vorher verschmutzen: die Note eines früheren Laufs, Filter und Phase in Bewegung
    unsafe { cypher_rb_note_an(h, 0, 30, 127) };
    block(h, 300);
    unsafe { cypher_rb_zuruecksetzen(h) };
    // Note 36 bei k, Slide auf 43 bei k+700 (überlappt), beide aus bei k+1500 bzw. k+2100
    let ereignisse = [(k, 36u8, 100u8), (k + 700, 43, 127), (k + 1500, 36, 0), (k + 2100, 43, 0)];
    let melde = |h: *mut CypherRb, t: usize, ton: u8, vel: u8| unsafe {
        assert_eq!(cypher_rb_note_an(h, t as u32, ton, vel), 0);
    };
    if vorab {
        for &(t, ton, vel) in &ereignisse { melde(h, t, ton, vel); }
    }
    let mut aus = Vec::new();
    for b in 0..bloecke {
        if !vorab {
            for &(t, ton, vel) in ereignisse.iter().filter(|(t, _, _)| t / N == b) { melde(h, t % N, ton, vel); }
        }
        aus.extend(block(h, N));
    }
    unsafe { cypher_rb_frei(h) };
    aus
}

#[test]
fn a3_verschiebungs_invarianz_bitgleich() {
    let bloecke = 24;
    let referenz = a3_lauf(0, true, bloecke);
    assert!(energie(&referenz) > 1e-3, "Positivkontrolle: die Referenz klingt");
    for vorab in [true, false] {
        assert_eq!(a3_lauf(0, vorab, bloecke), referenz, "k = 0, vorab {vorab}");
        for k in [1usize, 2, 37, 255, 256, 257, 511, 512, 513, 1000] {
            let x = a3_lauf(k, vorab, bloecke);
            assert!(x[..k].iter().all(|v| *v == 0.0), "k = {k}, vorab {vorab}: vor der Note still");
            let gleich = x[k..] == referenz[..x.len() - k];
            assert!(gleich, "k = {k}, vorab {vorab}: nicht die um k verschobene Referenz");
        }
    }
    // Negativ-Kontrolle: unverschoben verglichen sieht der Test den Versatz
    let x = a3_lauf(1, true, bloecke);
    assert_ne!(x, referenz);
}

/// Ein Block mit Note 36, darüber gleitet 40 (Stapel 36, 40); im zweiten Block bei Versatz 10 `zweiter(h)`; 48 aus bei
/// 3000 (wandert in den Folgeblock), insgesamt 61 Blöcke.
fn nach_zwei_gehaltenen(zweiter: &dyn Fn(*mut CypherRb)) -> Vec<f32> {
    let h = neu();
    unsafe {
        cypher_rb_note_an(h, 0, 36, 100);
        cypher_rb_note_an(h, 100, 40, 100);
    }
    let mut x = block(h, N);
    zweiter(h);
    unsafe { cypher_rb_note_aus(h, 3000, 48) };
    for _ in 0..60 { x.extend(block(h, N)); }
    unsafe { cypher_rb_frei(h) };
    x
}

#[test]
fn alle_aus_wirkt_vor_note_ein_am_selben_sample_in_beiden_meldereihenfolgen() {
    // Referenz: dieselbe Lage ausdrücklich geräumt (beide aus, 48 an am selben Sample): 48 schlägt frisch an, kein Slide
    let referenz = nach_zwei_gehaltenen(&|h| unsafe {
        cypher_rb_note_aus(h, 10, 36);
        cypher_rb_note_aus(h, 10, 40);
        cypher_rb_note_an(h, 10, 48, 100);
    });
    let alle_zuerst = nach_zwei_gehaltenen(&|h| unsafe {
        cypher_rb_alle_aus(h, 10);
        cypher_rb_note_an(h, 10, 48, 100);
    });
    let note_zuerst = nach_zwei_gehaltenen(&|h| unsafe {
        cypher_rb_note_an(h, 10, 48, 100);
        cypher_rb_alle_aus(h, 10);
    });
    // Positivkontrolle: die 48 klingt nach dem All-Off (zwischen Sample 10 und 3000 des zweiten Blocks)
    let neu_an = &referenz[N + 10..N + 3000];
    assert!(energie(neu_an) > 1e-3, "Referenz: die 48 klingt");
    assert!(energie(&alle_zuerst[N + 10..N + 3000]) > 1e-3, "All-Off zuerst gemeldet: die 48 klingt");
    assert!(energie(&note_zuerst[N + 10..N + 3000]) > 1e-3, "Note zuerst gemeldet: die 48 klingt");
    assert_eq!(alle_zuerst, referenz, "All-Off zuerst gemeldet: frischer Anschlag wie die Referenz");
    assert_eq!(note_zuerst, referenz, "Note zuerst gemeldet: All-Off wirkt trotzdem vorher");
    // nach dem Aus der 48 bleibt es still (der Stapel ist leer, nichts gleitet zu 36 oder 40 zurück)
    let spaet = N + 3000 + 48 * 200;
    assert!(alle_zuerst[spaet..].iter().all(|v| *v == 0.0));
    // Negativ-Kontrolle: ohne All-Off gleitet die 48 über den gehaltenen Stapel, das ist ein anderes Signal
    let ohne = nach_zwei_gehaltenen(&|h| unsafe { cypher_rb_note_an(h, 10, 48, 100); });
    assert_ne!(ohne, referenz);
}

#[test]
fn mehrere_note_ein_am_selben_sample_die_zuletzt_gemeldete_gewinnt() {
    let lauf = |noten: &[u8]| {
        let h = neu();
        for &n in noten { assert_eq!(unsafe { cypher_rb_note_an(h, 50, n, 100) }, 0); }
        let x: Vec<f32> = (0..8).flat_map(|_| block(h, N)).collect();
        unsafe { cypher_rb_frei(h) };
        x
    };
    let (nur_36, nur_40) = (lauf(&[36]), lauf(&[40]));
    assert_ne!(nur_36, nur_40, "Negativ-Kontrolle: 36 und 40 klingen verschieden");
    assert_eq!(lauf(&[36, 40]), nur_40, "36 dann 40 gemeldet: 40 gewinnt");
    assert_eq!(lauf(&[40, 36]), nur_36, "40 dann 36 gemeldet: 36 gewinnt");
    // auch neben einem anderen Ereignis davor (Einfügesortierung über mehr als zwei Einträge)
    let h = neu();
    unsafe {
        cypher_rb_note_an(h, 50, 36, 100);
        cypher_rb_note_aus(h, 20, 30);
        cypher_rb_note_an(h, 50, 40, 100);
    }
    let x: Vec<f32> = (0..8).flat_map(|_| block(h, N)).collect();
    unsafe { cypher_rb_frei(h) };
    assert_eq!(x, nur_40);
}

fn klang_mit_velocity(vel: u8) -> Vec<f32> {
    let h = neu();
    unsafe {
        cypher_rb_zuruecksetzen(h);
        assert_eq!(cypher_rb_note_an(h, 0, 36, vel), 0);
        cypher_rb_note_aus(h, 4000, 36);
    }
    let x: Vec<f32> = (0..30).flat_map(|_| block(h, N)).collect();
    unsafe { cypher_rb_frei(h) };
    x
}

#[test]
fn velocity_vel_durch_127_akzent_ab_120() {
    // Die Stimme nutzt die Velocity nur für die Akzent-Schwelle (rb_dsp ACCENT_AB = 120/127): 120 klingt wie 127, 119 wie 1
    let (v1, v119, v120, v127) = (klang_mit_velocity(1), klang_mit_velocity(119), klang_mit_velocity(120), klang_mit_velocity(127));
    assert_eq!(v120, v127, "vel 120 hat den Akzent");
    assert_eq!(v119, v1, "vel 119 hat keinen Akzent");
    assert_ne!(v119, v120, "Negativ-Kontrolle: die Grenze ist hörbar");
}

#[test]
fn velocity_ueber_127_klingt_wie_127() {
    // Am Ausgang nicht von einer ungeklemmten Velocity unterscheidbar (nur die Akzent-Schwelle zählt); die Klemme selbst
    // prüft der Modultest rb::tests::velocity_ueber_127_wird_geklemmt an der Warteschlange.
    assert_eq!(klang_mit_velocity(200), klang_mit_velocity(127));
    assert_eq!(klang_mit_velocity(255), klang_mit_velocity(127));
}

#[test]
fn neu_mit_ungueltiger_abtastrate_ist_null() {
    for fs in [0.0, -48000.0, f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        let h = cypher_rb_neu(fs);
        assert!(h.is_null(), "fs {fs}");
        unsafe { cypher_rb_frei(h) };
    }
    // Gegenprobe: gültige Raten geben eine Instanz
    for fs in [8000.0, 44100.0, 48000.0, 96000.0] {
        let h = cypher_rb_neu(fs);
        assert!(!h.is_null(), "fs {fs}");
        unsafe { cypher_rb_frei(h) };
    }
}
