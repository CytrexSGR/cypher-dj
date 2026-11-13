//! Correlation between the two channels when both self-oscillate with the same settings.
use labor_dsp::{Einstellung, Labor};
fn main() {
    for (fc, res, hp) in [(261.63, 0.9, false), (1000.0, 0.85, false), (80.0, 1.0, false), (500.0, 0.9, true)] {
        let mut e = Einstellung::default();
        for k in 0..2 { e.kanal[k].delay_an = false; e.kanal[k].feedback = 0.0; e.kanal[k].resonanz = res; e.kanal[k].cutoff_hz = fc; e.kanal[k].hp = hp; }
        let mut lab = Labor::neu(48000.0);
        lab.setze(&e); lab.leeren();
        let n = 48000 * 8;
        let (mut l, mut r) = (vec![0f32; n], vec![0f32; n]);
        lab.block(&mut l, &mut r);
        print!("fc {fc} res {res} hp {hp}: correlation per 100 ms over the last 2 s:");
        for w in 0..20 {
            let von = n - 96000 + w * 4800;
            let (a, b) = (&l[von..von + 4800], &r[von..von + 4800]);
            let (mut ab, mut aa, mut bb) = (0f64, 0f64, 0f64);
            for i in 0..a.len() { ab += (a[i] * b[i]) as f64; aa += (a[i] * a[i]) as f64; bb += (b[i] * b[i]) as f64; }
            print!(" {:+.1}", ab / (aa * bb).sqrt());
        }
        println!();
    }
}
