//! Cypher Komp Slice 3: externer Sidechain, Hochpass im Detektor, Mix als Parallelkompression.
use komp_dsp::{Einstellung, Komp};

const FS: f64 = 48000.0;

fn ton(db: f64, f: f64, n: usize) -> Vec<f32> {
    let a = 10f64.powf(db / 20.0);
    (0..n).map(|i| (a * (2.0 * std::f64::consts::PI * f * i as f64 / FS).sin()) as f32).collect()
}
/// Kick-Impulse 4/4 bei 120 BPM: 60-Hz-Burst, 80 ms, abklingend
fn kicks(db: f64, n: usize) -> Vec<f32> {
    let a = 10f64.powf(db / 20.0);
    let schlag = (FS * 0.5) as usize;
    (0..n).map(|i| {
        let t = (i % schlag) as f64 / FS;
        if t < 0.08 { (a * (-t / 0.03).exp() * (2.0 * std::f64::consts::PI * 60.0 * t).sin()) as f32 } else { 0.0 }
    }).collect()
}
fn spitze_db(x: &[f32]) -> f64 {
    20.0 * (x.iter().fold(0f32, |m, v| m.max(v.abs())).max(1e-9) as f64).log10()
}
fn duck() -> Einstellung {
    Einstellung { schwelle_db: -24.0, ratio: 8.0, knie_db: 0.0, attack_ms: 1.0, release_ms: 150.0, ..Einstellung::default() }
}

#[test]
fn kick_im_sidechain_drueckt_den_bass() {
    let n = (FS * 4.0) as usize;
    let haupt = ton(-12.0, 440.0, n);
    let kette = kicks(-6.0, n);
    let mut k = Komp::neu(FS);
    k.setze(&Einstellung { makeup_db: 0.0, mix: 1.0, ..duck() });
    let (mut l, mut r) = (haupt.clone(), haupt.clone());
    k.block(&mut l, &mut r, Some((&kette, &kette)));
    let schlag = (FS * 0.5) as usize;
    // dritter Schlag: kurz nach der Kick tief, kurz vor der nächsten Zählzeit fast wieder oben
    let s0 = 2 * schlag;
    let tief = spitze_db(&l[s0 + 480..s0 + 1440]);
    let erholt = spitze_db(&l[s0 + schlag - 960..s0 + schlag]);
    assert!(tief < -12.0 - 6.0, "Absenkung unter der Kick nur bis {tief:.1} dBFS");
    assert!(erholt > -12.0 - 1.0, "vor der nächsten Kick erst bei {erholt:.1} dBFS");
}

#[test]
fn ohne_sidechain_kein_pumpen_am_dauerton() {
    let n = (FS * 2.0) as usize;
    let haupt = ton(-12.0, 440.0, n);
    let mut k = Komp::neu(FS);
    k.setze(&duck());
    let (mut l, mut r) = (haupt.clone(), haupt.clone());
    k.block(&mut l, &mut r, None);
    let a = spitze_db(&l[(FS * 1.0) as usize..(FS * 1.25) as usize]);
    let b = spitze_db(&l[(FS * 1.5) as usize..(FS * 1.75) as usize]);
    assert!((a - b).abs() < 0.1, "{a} gegen {b}");
}

#[test]
fn hochpass_im_detektor_ueberhoert_den_bass() {
    let n = (FS * 1.0) as usize;
    let bass = ton(-6.0, 60.0, n);
    let gr = |hp: f64| {
        let mut k = Komp::neu(FS);
        k.setze(&Einstellung { sc_hochpass_hz: hp, ..duck() });
        let (mut l, mut r) = (bass.clone(), bass.clone());
        k.block(&mut l, &mut r, None);
        k.gr_db()
    };
    let ohne = gr(0.0);
    let mit = gr(150.0);
    assert!(ohne - mit >= 10.0, "Absenkung ohne Hochpass {ohne:.1} dB, mit {mit:.1} dB");
}

#[test]
fn mix_halb_ist_der_mittelwert_aus_trocken_und_komprimiert() {
    let x = ton(-6.0, 1000.0, 9600);
    let e = Einstellung { schwelle_db: -30.0, ratio: 20.0, ..Einstellung::default() };
    let mut voll = Komp::neu(FS);
    voll.setze(&Einstellung { mix: 1.0, ..e });
    let (mut lv, mut rv) = (x.clone(), x.clone());
    voll.block(&mut lv, &mut rv, None);
    let mut halb = Komp::neu(FS);
    halb.setze(&Einstellung { mix: 0.5, ..e });
    let (mut lh, mut rh) = (x.clone(), x.clone());
    halb.block(&mut lh, &mut rh, None);
    for i in 0..x.len() {
        assert!((lh[i] - 0.5 * (x[i] + lv[i])).abs() < 1e-6, "Sample {i}");
    }
}
