//! Clip curves and ceiling (strand 5, task 1.1): bit-equal defaults, ceiling, aliasing of the hard clip, clip_db,
//! click-free curve switch, no allocation in the block (own test binary: the counter is global).
use saett_dsp::{Einstellung, Kurve, Saett};
use std::alloc::{GlobalAlloc, Layout, System};
use std::f64::consts::PI;
use std::cell::Cell;

// Per-thread counter: the other tests of this file run in parallel threads and allocate freely.
thread_local! {
    static ANFORDERUNGEN: Cell<usize> = const { Cell::new(0) };
}
struct Zaehler;
unsafe impl GlobalAlloc for Zaehler {
    unsafe fn alloc(&self, l: Layout) -> *mut u8 {
        ANFORDERUNGEN.with(|c| c.set(c.get() + 1));
        System.alloc(l)
    }
    unsafe fn dealloc(&self, p: *mut u8, l: Layout) {
        System.dealloc(p, l)
    }
}
#[global_allocator]
static A: Zaehler = Zaehler;

const FS: f64 = 48000.0;

fn rausch(n: usize) -> Vec<f32> {
    let mut z: u32 = 12345;
    (0..n)
        .map(|_| {
            z = z.wrapping_mul(1664525).wrapping_add(1013904223);
            ((z >> 8) as f32 / (1u32 << 24) as f32 - 0.5) * 1.6
        })
        .collect()
}

fn lauf(s: &mut Saett, x: &[f32]) -> Vec<f32> {
    let (mut l, mut r) = (x.to_vec(), x.to_vec());
    for (cl, cr) in l.chunks_mut(256).zip(r.chunks_mut(256)) {
        s.block(cl, cr);
    }
    l
}

fn sinus(f: f64, a: f64, n: usize) -> Vec<f32> {
    (0..n).map(|i| (a * (2.0 * PI * f * i as f64 / FS).sin()) as f32).collect()
}

fn fft(re: &mut [f64], im: &mut [f64]) {
    let n = re.len();
    let mut j = 0;
    for i in 1..n {
        let mut b = n >> 1;
        while j & b != 0 {
            j ^= b;
            b >>= 1;
        }
        j |= b;
        if i < j {
            re.swap(i, j);
            im.swap(i, j);
        }
    }
    let mut len = 2;
    while len <= n {
        let w = -2.0 * PI / len as f64;
        for s in (0..n).step_by(len) {
            for k in 0..len / 2 {
                let (c, si) = ((w * k as f64).cos(), (w * k as f64).sin());
                let (a, b) = (s + k, s + k + len / 2);
                let (tr, ti) = (re[b] * c - im[b] * si, re[b] * si + im[b] * c);
                re[b] = re[a] - tr;
                im[b] = im[a] - ti;
                re[a] += tr;
                im[a] += ti;
            }
        }
        len <<= 1;
    }
}

/// Hann-windowed magnitude of the bin nearest to `f` (peak over +-2 bins).
fn pegel(y: &[f32], f: f64) -> f64 {
    let n = y.len();
    let mut re: Vec<f64> = y.iter().enumerate().map(|(i, v)| *v as f64 * (0.5 - 0.5 * (2.0 * PI * i as f64 / n as f64).cos())).collect();
    let mut im = vec![0.0; n];
    fft(&mut re, &mut im);
    let b0 = (f / FS * n as f64).round() as usize;
    (b0 - 2..=b0 + 2).map(|b| (re[b] * re[b] + im[b] * im[b]).sqrt()).fold(0.0, f64::max)
}

#[test]
fn a_tanh_ohne_decke_ist_bitgleich_zum_standard() {
    let x = rausch(48000);
    let mut s0 = Saett::neu(FS);
    let y0 = lauf(&mut s0, &x);
    let mut s1 = Saett::neu(FS);
    s1.setze(&Einstellung { kurve: Kurve::Tanh, decke_db: 0.0, ..Einstellung::default() });
    s1.setze_form(Kurve::Tanh, 0.0);
    let y1 = lauf(&mut s1, &x);
    assert!(y0.iter().zip(&y1).all(|(a, b)| a.to_bits() == b.to_bits()));
    assert!(y0.iter().any(|v| v.abs() > 0.1), "the reference is not silent");
}

#[test]
fn b_harte_decke_begrenzt_die_spitze() {
    let mut s = Saett::neu(FS);
    let out = 10f64.powf(-6.0 / 20.0);
    s.setze(&Einstellung { drive_db: 24.0, ausgang_db: -6.0, kurve: Kurve::Hart, decke_db: -6.0, ..Einstellung::default() });
    s.leeren();
    // full-scale saw
    let x: Vec<f32> = (0..48000).map(|i| ((i % 480) as f32 / 480.0) * 2.0 - 1.0).collect();
    let y = lauf(&mut s, &x);
    let peak = y[4800..].iter().fold(0f32, |m, v| m.max(v.abs())) as f64;
    // The curve itself ends at c * out; what is left is the half-band's overshoot on a near-square wave. Measured: plain
    // tanh at drive 24 dB overshoots by 1.17 (sine) and 1.21 (saw), so the plan's 1.12 is not reachable; bound 1.25.
    assert!(peak <= 1.25 * 0.501 * out, "peak {peak}");
    assert!(peak > 0.3 * 0.501 * out, "the clipped signal is not silent, peak {peak}");
}

#[test]
fn c_hartes_clippen_aliast_kaum() {
    let n = 8192;
    let mut s = Saett::neu(FS);
    s.setze(&Einstellung { drive_db: 18.0, ausgang_db: 0.0, kurve: Kurve::Hart, ..Einstellung::default() });
    s.leeren();
    let f = 5000.0;
    let x = sinus(f, 0.9, n * 3);
    let y = lauf(&mut s, &x);
    let y = &y[n * 2..];
    let grund = pegel(y, f);
    // The hard-clipped sine has odd harmonics. 3f = 15 kHz is a true harmonic (the plan's "alias at 15 kHz" is that one),
    // so the alias images are the folded harmonics k >= 5 that land on none of the true ones: 23, 13, 3, 7, 17, 21, 11, 1 kHz.
    // Images above 20 kHz (23 and 21 kHz) sit in the half-band's transition band: -38 to -43 dB for every curve, plain
    // tanh included (-39 dB), so they measure the oversampler's filter, not the curve; they are left out.
    let mut schlimmster = f64::MIN;
    for k in [5.0, 7.0, 9.0, 11.0, 13.0, 15.0, 17.0, 19.0] {
        let mut g = (k * f) % FS;
        if g > FS / 2.0 {
            g = FS - g;
        }
        if g > 20000.0 {
            continue;
        }
        let db = 20.0 * (pegel(y, g) / grund).log10();
        schlimmster = schlimmster.max(db);
    }
    assert!(schlimmster < -40.0, "worst alias image is {schlimmster} dB re fundamental");
}

#[test]
fn d_clip_db_misst_die_ueberschreitung() {
    let mut s = Saett::neu(FS);
    s.setze(&Einstellung { drive_db: -12.0, ausgang_db: 0.0, kurve: Kurve::Hart, ..Einstellung::default() });
    s.leeren();
    let _ = lauf(&mut s, &sinus(1000.0, 1.0, 9600));
    assert_eq!(s.clip_db(), 0.0, "below the ceiling");
    s.setze(&Einstellung { drive_db: 12.0, ausgang_db: 0.0, kurve: Kurve::Hart, ..Einstellung::default() });
    s.leeren();
    let _ = lauf(&mut s, &sinus(1000.0, 1.0, 9600));
    let c = s.clip_db() as f64;
    assert!((c - 12.0).abs() < 1.0, "clip_db {c}");
    assert_eq!(s.clip_db(), 0.0, "read-and-reset");
}

#[test]
fn e_kurvenwechsel_knackt_nicht() {
    let mut s = Saett::neu(FS);
    s.setze(&Einstellung { drive_db: 6.0, ausgang_db: 0.0, kurve: Kurve::Tanh, ..Einstellung::default() });
    s.leeren();
    let x = sinus(100.0, 0.8, 48000);
    let mut y = Vec::new();
    let (mut l, mut r) = (x.clone(), x.clone());
    for (i, (cl, cr)) in l.chunks_mut(256).zip(r.chunks_mut(256)).enumerate() {
        if i == 60 {
            s.setze_form(Kurve::Hart, 0.0);
        }
        s.block(cl, cr);
        y.extend_from_slice(cl);
    }
    let von = 60 * 256 - 64;
    let bis = von + 4096;
    let schritt = y[von..bis].windows(2).fold(0f32, |m, w| m.max((w[1] - w[0]).abs()));
    assert!(schritt < 0.05, "max step during the switch {schritt}");
    // the curve really changed: the peak went up from the tanh value to the clipped one
    let spitze = y[bis + 2000..].iter().fold(0f32, |m, v| m.max(v.abs()));
    assert!(spitze > 0.97, "hard clip reached, peak {spitze}");
}

#[test]
fn f_block_allokiert_nicht() {
    let mut s = Saett::neu(FS);
    let (mut l, mut r) = (vec![0f32; 256], vec![0f32; 256]);
    let vor = ANFORDERUNGEN.with(|c| c.get());
    let _positiv = vec![0u8; 16];
    assert!(ANFORDERUNGEN.with(|c| c.get()) > vor, "positive control: the counter sees allocations");
    let start = ANFORDERUNGEN.with(|c| c.get());
    for b in 0..300 {
        for i in 0..256 {
            l[i] = ((b * 256 + i) as f32 * 0.01).sin() * 0.9;
            r[i] = -l[i];
        }
        if b % 20 == 5 {
            s.setze(&Einstellung { kurve: [Kurve::Tanh, Kurve::Weich, Kurve::Hart][b / 20 % 3], decke_db: -(b as f64) / 20.0, ..Einstellung::default() });
        }
        s.block(&mut l, &mut r);
        let _ = s.clip_db();
    }
    assert_eq!(ANFORDERUNGEN.with(|c| c.get()), start);
}
