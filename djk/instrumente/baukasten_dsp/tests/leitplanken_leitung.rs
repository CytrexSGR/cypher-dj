//! Leitplanken für die zwei Leitungs-Beispiele (Slice 4f): die Saite ist hörbar, klingt aus und trifft ihre Note; die
//! Rückkopplung klingt bei Regler 4 unten aus und schwingt oben selbst weiter, ohne über die Sättigung hinauszugehen.
use baukasten_dsp::{uebersetze, Programm, REGLER};

const SR: f32 = 48_000.0;
const SAITE: &str = include_str!("../beispiele/saite.json");
const RUECK: &str = include_str!("../beispiele/rueckkopplung.json");

fn lade(j: &str, regler: &[(usize, f32)]) -> Programm {
    let mut p = uebersetze(j, SR).unwrap_or_else(|e| panic!("{e}"));
    for nr in 1..=REGLER {
        p.setze_regler(nr, 0.5);
    }
    for (nr, w) in regler {
        p.setze_regler(*nr, *w);
    }
    p
}

fn db(x: &[f32]) -> f32 {
    10.0 * (x.iter().map(|v| v * v).sum::<f32>() / x.len() as f32).max(1e-20).log10()
}

#[test]
fn saite_ist_hoerbar_und_klingt_aus() {
    let mut p = lade(SAITE, &[]);
    p.note_an(57, 1.0);
    let x: Vec<f32> = (0..4 * 48_000).map(|_| p.sample_stereo().0).collect();
    let (anfang, ende) = (db(&x[..24_000]), db(&x[3 * 48_000 + 24_000..]));
    let spitze = x.iter().fold(0.0f32, |m, v| m.max(v.abs()));
    println!("MESS Saite A3: erste 0,5 s {anfang:.1} dBFS, letzte 0,5 s {ende:.1} dBFS, Spitze {spitze:.3}");
    assert!((-36.0..=-10.0).contains(&anfang), "Pegel {anfang}");
    assert!(anfang - ende > 20.0, "klingt nicht aus: {anfang} → {ende}");
    assert!(spitze < 0.9);
    // Gleichanteil im Ausklang (1 bis 2 s): der Hochpass vor der Schleife nimmt dem Stoß den Mittelwert, sonst kreist er mit
    let mitte = &x[48_000..96_000];
    let (mw, lw) = (mitte.iter().sum::<f32>() / mitte.len() as f32, mitte.iter().map(|v| v * v).sum::<f32>() / mitte.len() as f32);
    println!("MESS Saite A3: Gleichanteil 1..2 s {:.2} % der Leistung", 100.0 * mw * mw / lw);
    assert!(mw * mw < 0.02 * lw, "Gleichanteil {} % der Leistung", 100.0 * mw * mw / lw);
    assert_eq!(p.rettungen, 0);
}

#[test]
fn saite_trifft_ihre_note() {
    // Grenzfrequenz des Tiefpasses und Stimmung hängen an der Note: bei jeder Helligkeit liegt die Saite innerhalb 10 Cent
    for helligkeit in [0.0f32, 0.5, 1.0] {
        let mut p = lade(SAITE, &[(1, helligkeit)]);
        p.note_an(57, 1.0);
        let x: Vec<f32> = (0..48_000).map(|_| p.sample_stereo().0).collect();
        let soll = SR as f64 / 220.0;
        let ak = |lag: usize| -> f64 { x[2_000..40_000].iter().zip(&x[2_000 + lag..]).map(|(a, b)| *a as f64 * *b as f64).sum() };
        let (von, bis) = ((soll * 0.9) as usize, (soll * 1.1) as usize + 2);
        let werte: Vec<f64> = (von..=bis).map(ak).collect();
        let i = (1..werte.len() - 1).max_by(|&a, &b| werte[a].partial_cmp(&werte[b]).unwrap()).unwrap();
        let (a, b, c) = (werte[i - 1], werte[i], werte[i + 1]);
        let ist = (von + i) as f64 + 0.5 * (a - c) / (a - 2.0 * b + c);
        let cent = 1200.0 * (soll / ist).log2();
        println!("MESS Saite A3 Helligkeit {helligkeit}: Periode {ist:.3} statt {soll:.3} Samples, {cent:+.2} Cent");
        assert!(cent.abs() < 10.0, "Helligkeit {helligkeit}: {cent} Cent");
    }
}

#[test]
fn rueckkopplung_unten_klingt_aus_oben_singt_solange_gehalten() {
    // Regler 4 unten: Anschlag klingt noch im Halten aus. Oben: die Schleife singt, solange die Note gehalten wird. Beides
    // verstummt nach Note aus (Hüllkurve halt auf der Rückkopplung), statt endlos weiterzusingen (Hörprobe 2026-10-29)
    let lauf = |rk: f32| -> (f32, f32, f32, u32) {
        let mut p = lade(RUECK, &[(4, rk)]);
        p.note_an(60, 1.0);
        let mut x: Vec<f32> = (0..24_000).map(|_| p.sample_stereo().0).collect();
        let gehalten = db(&x[x.len() - 2_400..]);
        p.note_aus(60);
        x.extend((0..3 * 48_000).map(|_| p.sample_stereo().0));
        (gehalten, db(&x[x.len() - 24_000..]), x.iter().fold(0.0f32, |m, v| m.max(v.abs())), p.rettungen)
    };
    let (g1, unten, s1, r1) = lauf(0.0);
    let (g2, oben, s2, r2) = lauf(1.0);
    println!("MESS Rückkopplung Ende Halten {g1:.1} / {g2:.1} dBFS, 3 s nach Note aus {unten:.1} / {oben:.1} dBFS, Spitzen {s1:.3} / {s2:.3}");
    assert_eq!((r1, r2), (0, 0));
    assert!(g1 < -90.0, "Regler 4 unten muss im Halten ausklingen: {g1}");
    assert!(g2 > -40.0, "Regler 4 oben muss im Halten selbst weiterschwingen: {g2}");
    assert!(unten < -90.0 && oben < -90.0, "nach Note aus muss die Schleife verstummen: {unten} / {oben}");
    assert!(s2 <= 0.3 * 1.0001, "hinter tanh und Pegel 0,3: {s2}");
}

#[test]
fn saite_akkord_uebersteuert_nicht() {
    // vier Stimmen gleichzeitig, Helligkeit und Ausklang oben: der Begrenzer (-2 dBFS) hält die Summe
    let mut p = lade(SAITE, &[(1, 1.0), (2, 1.0)]);
    for n in [45u8, 52, 57, 61] {
        p.note_an(n, 1.0);
    }
    let x: Vec<(f32, f32)> = (0..2 * 48_000).map(|_| p.sample_stereo()).collect();
    let spitze = x.iter().fold(0.0f32, |m, v| m.max(v.0.abs()).max(v.1.abs()));
    println!("MESS Saite Akkord: Spitze {spitze:.3}");
    assert!(spitze <= 0.7944 + 1e-3, "Spitze {spitze} über -2 dBFS");
    assert_eq!(p.rettungen, 0);
}
