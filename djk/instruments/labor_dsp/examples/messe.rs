//! Quick measurements of the model against the target values (prints numbers, no assertions).
use labor_dsp::{Einstellung, Labor};

fn lauf(e: &Einstellung, sek: f64, ein: impl Fn(usize) -> (f32, f32), vor: impl FnOnce(&mut Labor)) -> (Vec<f32>, Vec<f32>) {
    let fs = 48000.0;
    let mut lab = Labor::neu(fs);
    lab.setze(e);
    lab.leeren();
    vor(&mut lab);
    let n = (sek * fs) as usize;
    let (mut l, mut r): (Vec<f32>, Vec<f32>) = ((0..n).map(|i| ein(i).0).collect(), (0..n).map(|i| ein(i).1).collect());
    for (a, b) in l.chunks_mut(64).zip(r.chunks_mut(64)) {
        lab.block(a, b);
    }
    (l, r)
}

fn spitze(x: &[f32]) -> f32 {
    x.iter().fold(0.0, |m, v| m.max(v.abs()))
}

/// Frequency from zero crossings over the slice.
fn frequenz(x: &[f32], fs: f64) -> f64 {
    let mut erste = None;
    let mut letzte = 0.0;
    let mut zahl = 0;
    for i in 1..x.len() {
        if x[i - 1] <= 0.0 && x[i] > 0.0 {
            let t = (i - 1) as f64 + (-x[i - 1] / (x[i] - x[i - 1])) as f64;
            if erste.is_none() { erste = Some(t); } else { zahl += 1; }
            letzte = t;
        }
    }
    match erste { Some(e) if zahl > 0 => zahl as f64 * fs / (letzte - e), _ => 0.0 }
}

fn main() {
    let fs = 48000.0;
    let mut e = Einstellung::default();
    for k in 0..2 { e.kanal[k].feedback = 0.0; e.kanal[k].delay_an = false; e.kanal[k].resonanz = 1.0; }
    println!("self-oscillation, delay off, no input:");
    for fc in [60.0, 261.63, 1000.0, 3000.0, 6000.0] {
        for res in [0.82, 0.9, 1.0] {
            e.kanal[0].cutoff_hz = fc; e.kanal[1].cutoff_hz = fc;
            e.kanal[0].resonanz = res; e.kanal[1].resonanz = res;
            e.lautstaerke_db = 0.0;
            let (l, _) = lauf(&e, 6.0, |_| (0.0, 0.0), |_| {});
            let ende = &l[l.len() - 48000..];
            let mitte = &l[l.len() - 96000..l.len() - 48000];
            println!("  fc {fc:7.1} res {res:.2}: f {:8.2} Hz  peak {:.4} FS ({:.3} V)  peak 1 s earlier {:.4}", frequenz(ende, fs), spitze(ende), spitze(ende) as f64 * labor_dsp::VOLT_PRO_FS, spitze(mitte));
        }
    }
    println!("delay time (impulse, feedback 0, cutoff 6 kHz, no resonance):");
    for zeit in [46.0, 150.0, 340.0, 1000.0, 1500.0] {
        let mut e = Einstellung::default();
        e.lautstaerke_db = 0.0;
        for k in 0..2 { e.kanal[k].feedback = 0.0; e.kanal[k].zeit_ms = zeit; e.kanal[k].cutoff_hz = 6000.0; e.kanal[k].resonanz = 0.0; }
        let (l, _) = lauf(&e, 2.5, |i| if (4800..4848).contains(&i) { (0.25, 0.25) } else { (0.0, 0.0) }, |_| {});
        let (mut imax, mut vmax) = (0, 0.0f32);
        for (i, v) in l.iter().enumerate() { if v.abs() > vmax { vmax = v.abs(); imax = i; } }
        let lat = Labor::neu(fs).latenz();
        println!("  set {zeit:6.0} ms: peak at {:7.2} ms after the pulse centre, peak {:.4}", (imax as f64 - 4824.0 - lat as f64) / 48.0, vmax);
    }
    println!("sine through the delay only (level -12 dBFS): gain and distortion by delay time");
    for zeit in [46.0, 150.0, 340.0, 1000.0, 1500.0] {
        for f in [100.0, 1000.0, 5000.0] {
            let mut e = Einstellung::default();
            e.lautstaerke_db = 0.0;
            for k in 0..2 { e.kanal[k].feedback = 0.0; e.kanal[k].zeit_ms = zeit; e.kanal[k].cutoff_hz = 6000.0; e.kanal[k].resonanz = 0.0; }
            let (l, _) = lauf(&e, 4.0, |i| { let v = 0.25 * (2.0 * std::f64::consts::PI * f * i as f64 / 48000.0).sin() as f32; (v, v) }, |_| {});
            let x = &l[l.len() - 48000..];
            // project onto the fundamental
            let (mut s, mut c, mut p) = (0.0f64, 0.0f64, 0.0f64);
            for (i, v) in x.iter().enumerate() {
                let w = 2.0 * std::f64::consts::PI * f * i as f64 / 48000.0;
                s += *v as f64 * w.sin(); c += *v as f64 * w.cos(); p += (*v as f64).powi(2);
            }
            let n = x.len() as f64;
            let grund = 2.0 * (s * s + c * c).sqrt() / n;
            let rest = (p / n - grund * grund / 2.0).max(0.0).sqrt();
            println!("  {zeit:6.0} ms {f:6.0} Hz: fundamental {:6.2} dB re input, rest (THD+N) {:6.2} %", 20.0 * (grund / 0.25).log10(), 100.0 * rest / (grund / 2f64.sqrt()));
        }
    }
    println!("extreme feedback stays bounded (20 s):");
    for delay in [false, true] {
        for hp in [false, true] {
            let mut e = Einstellung::default();
            e.lautstaerke_db = 0.0;
            for k in 0..2 { let ka = &mut e.kanal[k]; ka.feedback = 1.0; ka.kreuz = 1.0; ka.delay_an = delay; ka.hp = hp; ka.resonanz = 1.0; ka.gain_db = 40.0; ka.zeit_ms = 46.0 + 300.0 * k as f64; }
            let (l, r) = lauf(&e, 20.0, |i| { let v = ((i * 7919) % 1000) as f32 / 1000.0 - 0.5; (v, -v) }, |_| {});
            let ok = l.iter().chain(r.iter()).all(|v| v.is_finite());
            println!("  delay {delay} hp {hp}: finite {ok} peak L {:.3} R {:.3}", spitze(&l), spitze(&r));
        }
    }
    println!("modulator cycle (via gain CV on a DC-free tone is awkward: measured in the unit test)");
    let t0 = std::time::Instant::now();
    let mut e = Einstellung::default();
    for k in 0..2 { e.kanal[k].zeit_ms = 46.0; e.kanal[k].feedback = 0.6; e.kanal[k].kreuz = 0.3; }
    let _ = lauf(&e, 20.0, |i| { let v = ((i * 7919) % 1000) as f32 / 2000.0; (v, v) }, |_| {});
    println!("cost: 20 s of audio at the shortest delay in {:.2} s", t0.elapsed().as_secs_f64());
}
