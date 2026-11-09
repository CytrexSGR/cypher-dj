//! Cypher Komp Slice 2: Zeitkonstanten am Sprung (Giannoulis Gl. 7 und 17), kaputte Eingänge.
use komp_dsp::{Einstellung, Komp};

const FS: f64 = 48000.0;

/// Absenkung je Sample für einen Pegelverlauf (Gleichspannung: der Pegel ist in jedem Sample derselbe, keine Welligkeit)
fn verlauf(k: &mut Komp, pegel: &[f32]) -> Vec<f64> {
    pegel.iter().map(|&p| {
        let (mut l, mut r) = ([p], [p]);
        k.block(&mut l, &mut r, None);
        k.gr_db()
    }).collect()
}
fn hart(att: f64, rel: f64) -> Einstellung {
    // T −20, Ratio sehr hoch, hartes Knie: bei 0 dBFS beträgt die Absenkung (fast) genau 20 dB
    Einstellung { schwelle_db: -20.0, ratio: 1000.0, knie_db: 0.0, attack_ms: att, release_ms: rel, makeup_db: 0.0, mix: 1.0, sc_hochpass_hz: 0.0 }
}

#[test]
fn attack_erreicht_63_prozent_nach_tau() {
    for att in [1.0, 10.0, 30.0] {
        let mut k = Komp::neu(FS);
        k.setze(&hart(att, 200.0));
        let gr = verlauf(&mut k, &vec![1.0f32; (FS * 0.3) as usize]);
        let ende = *gr.last().unwrap();
        let n_tau = (att * 1e-3 * FS) as usize;
        let anteil = gr[n_tau - 1] / ende;
        assert!((anteil - 0.632).abs() < 0.05 * 0.632, "attack {att} ms: {anteil:.3} nach τ");
    }
}

#[test]
fn release_faellt_auf_37_prozent_nach_tau() {
    for rel in [50.0, 200.0] {
        let mut k = Komp::neu(FS);
        k.setze(&hart(1.0, rel));
        verlauf(&mut k, &vec![1.0f32; (FS * 0.1) as usize]);
        let start = k.gr_db();
        let gr = verlauf(&mut k, &vec![0.01f32; (FS * 1.5) as usize]); // −40 dBFS: unter der Schwelle
        let n_tau = (rel * 1e-3 * FS) as usize;
        let anteil = gr[n_tau - 1] / start;
        assert!((anteil - 0.368).abs() < 0.05 * 0.368 + 0.01, "release {rel} ms: {anteil:.3} nach τ");
    }
}

#[test]
fn nan_und_inf_vergiften_den_zustand_nicht() {
    let mut k = Komp::neu(FS);
    k.setze(&hart(5.0, 100.0));
    let mut l = vec![0.5f32; 256];
    l[10] = f32::NAN;
    l[20] = f32::INFINITY;
    l[30] = f32::NEG_INFINITY;
    let mut r = l.clone();
    k.block(&mut l, &mut r, None);
    assert!(k.gr_db().is_finite(), "Zustand nach NaN/Inf: {}", k.gr_db());
    let (mut l2, mut r2) = (vec![0.5f32; 4800], vec![0.5f32; 4800]);
    k.block(&mut l2, &mut r2, None);
    assert!(l2.iter().all(|v| v.is_finite()) && k.gr_db().is_finite());
}
