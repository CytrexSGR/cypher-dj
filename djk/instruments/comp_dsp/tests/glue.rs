//! Cypher Glue: stepped ratio/attack/release (D3), auto release (D4), no change when both are off.
use komp_dsp::{Einstellung, Komp};

const FS: f64 = 48000.0;

fn rauschen(n: usize) -> Vec<f32> {
    let mut z: u32 = 12345;
    (0..n)
        .map(|_| {
            z = z.wrapping_mul(1664525).wrapping_add(1013904223);
            ((z >> 8) as f32 / 8388608.0 - 1.0) * 0.5
        })
        .collect()
}

#[test]
fn ohne_charakter_bitgleich() {
    let e = Einstellung { schwelle_db: -24.0, ratio: 3.3, knie_db: 4.0, attack_ms: 7.0, release_ms: 150.0, makeup_db: 2.0, mix: 0.8, sc_hochpass_hz: 80.0 };
    let x = rauschen(48000);
    let (mut a_l, mut a_r) = (x.clone(), x.iter().rev().copied().collect::<Vec<_>>());
    let (mut b_l, mut b_r) = (a_l.clone(), a_r.clone());
    let mut a = Komp::neu(FS);
    a.setze(&e);
    let mut b = Komp::neu(FS);
    b.setze_charakter(false, false);
    b.setze(&e);
    b.setze_charakter(false, false);
    a.block(&mut a_l, &mut a_r, None);
    b.block(&mut b_l, &mut b_r, None);
    assert!(a_l.iter().zip(&b_l).all(|(p, q)| p.to_bits() == q.to_bits()));
    assert!(a_r.iter().zip(&b_r).all(|(p, q)| p.to_bits() == q.to_bits()));
}

fn wirksam_fuer(ratio: f64, attack: f64, release: f64) -> (f64, f64, f64) {
    let mut k = Komp::neu(FS);
    k.setze(&Einstellung { ratio, attack_ms: attack, release_ms: release, ..Einstellung::default() });
    k.setze_charakter(true, false);
    k.wirksam()
}

#[test]
fn glue_rastet_ein() {
    assert_eq!(wirksam_fuer(3.0, 2.0, 600.0), (4.0, 3.0, 800.0));
    assert_eq!(wirksam_fuer(1.2, 0.05, 90.0), (1.5, 0.1, 100.0));
    assert_eq!(wirksam_fuer(50.0, 100.0, 5000.0), (10.0, 30.0, 1200.0));
    // exact steps stay; a tie in the log domain (geometric mean of 2 and 4 is 2.828..) goes to the lower step
    assert_eq!(wirksam_fuer(2.0, 10.0, 200.0), (2.0, 10.0, 200.0));
    assert_eq!(wirksam_fuer((2.0f64 * 4.0).sqrt(), 1.0, 100.0).0, 2.0);
    // glue off: values as given
    let mut k = Komp::neu(FS);
    k.setze(&Einstellung { ratio: 3.0, attack_ms: 2.0, release_ms: 600.0, ..Einstellung::default() });
    assert_eq!(k.wirksam(), (3.0, 2.0, 600.0));
    // switching glue off again restores the raw values; auto zeroes the release in the readout
    k.setze_charakter(true, false);
    k.setze_charakter(false, true);
    assert_eq!(k.wirksam(), (3.0, 2.0, 0.0));
}

/// constant-envelope signal: alternating sign each sample, so |x| is the level at all times
fn pegelblock(db: f64, n: usize) -> (Vec<f32>, Vec<f32>) {
    let a = 10f64.powf(db / 20.0) as f32;
    let x: Vec<f32> = (0..n).map(|i| if i % 2 == 0 { a } else { -a }).collect();
    (x.clone(), x)
}

fn lauf(k: &mut Komp, db: f64, sek: f64) {
    let (mut l, mut r) = pegelblock(db, (sek * FS) as usize);
    k.block(&mut l, &mut r, None);
}

fn auto_komp() -> Komp {
    let mut k = Komp::neu(FS);
    k.setze(&Einstellung { schwelle_db: -20.0, ratio: 4.0, knie_db: 0.0, attack_ms: 1.0, release_ms: 100.0, makeup_db: 0.0, mix: 1.0, sc_hochpass_hz: 0.0 });
    k.setze_charakter(false, true);
    k
}

#[test]
fn auto_release_schnell_nach_transiente() {
    let mut k = auto_komp();
    lauf(&mut k, -17.0, 3.0);
    let stetig = k.gr_db(); // 3 dB over threshold, 4:1: 2.25 dB
    assert!((stetig - 2.25).abs() < 0.2, "steady {stetig}");
    lauf(&mut k, 3.0, 0.02); // 20 ms burst, 20 dB above the steady tone
    assert!(k.gr_db() > stetig + 3.0, "burst must pull down: {}", k.gr_db());
    lauf(&mut k, -17.0, 0.25);
    assert!((k.gr_db() - stetig).abs() < 1.5, "after 250 ms (within 10% of the 15 dB excursion; tau 100 ms) {} vs steady {stetig}", k.gr_db());
}

#[test]
fn auto_release_langsam_nach_anhaltender_absenkung() {
    let mut k = auto_komp();
    lauf(&mut k, 0.0, 2.0); // 2 s at 0 dB: 15 dB of x_l (20 dB over, 4:1)
    let tief = k.gr_db();
    assert!(tief > 8.0, "deep reduction {tief}");
    lauf(&mut k, -20.0, 0.4); // drop to the threshold
    assert!(k.gr_db() > 0.3 * tief, "slow release: {} of {tief}", k.gr_db());
    // control: without auto the same release (100 ms) is far lower after 400 ms
    let mut f = auto_komp();
    f.setze_charakter(false, false);
    lauf(&mut f, 0.0, 2.0);
    lauf(&mut f, -20.0, 0.4);
    assert!(f.gr_db() < 0.3 * tief, "fixed release {}", f.gr_db());
}

#[test]
fn glue_umschalten_ohne_sprung() {
    let mut k = Komp::neu(FS);
    k.setze(&Einstellung { schwelle_db: -20.0, ratio: 3.0, knie_db: 4.0, attack_ms: 2.0, release_ms: 600.0, ..Einstellung::default() });
    lauf(&mut k, -5.0, 1.0);
    let vor = k.gr_db();
    k.setze_charakter(true, true);
    lauf(&mut k, -5.0, 0.001);
    assert!((k.gr_db() - vor).abs() < 1.0, "{} -> {}", vor, k.gr_db());
}
