//! Faltung (S21): convolution with an impulse response file, zero added latency. Head: the first B taps as a direct
//! FIR. Tail: uniform-partitioned overlap-save (B = 256, N = 512); the tail of output block j+1 is computed when input
//! block j completes, from complete input blocks only. Everything is allocated in `neu`; `prozess` and
//! `zuruecksetzen` never allocate (realfft `process_with_scratch` only, `process` allocates).
//!
//! Why the head is exactly one partition long: the output sample n = jB + i needs the tail taps h[m], m >= B, which
//! read the input at n - m <= (j-1)B + i, i.e. only blocks <= j-1. Those are complete when block j-1 ends, so the whole
//! tail of block j can be computed then. The taps m < B read the current block and run sample by sample (the head).
//!
//! Tail scheme: input spectra `X_u = FFT([block u-1, block u])` sit in a frequency-domain delay line (FDL) of P slots.
//! Partition q (taps (q+1)B .. (q+2)B) is stored as `H_q = FFT(taps, zero padded to N) / N`. At the end of input block
//! j: `Y = sum_q X_{j-q} * H_q`, `y = IFFT(Y)`, the tail of block j+1 is `y[B..2B]`.
//!
//! Work distribution: the terms q >= 1 of that sum only read `X_{j-1}` and older, which are all in the FDL one block
//! earlier. So during block j they are multiply-accumulated a few partitions per sample into a per-side accumulator
//! (`Seite::naechst`, `Seite::verteilt`); the sample that completes the block does only the forward FFT, the q = 0 term
//! `X_j H_0`, and the inverse FFT. Same sum in a different order, zero latency kept, no allocation.
//!
//! Left input convolves with the left IR, right with the right IR (no true-stereo 4-channel IR). The impulse response
//! is read from the kit sample format (48 kHz stereo f32) by `sampler::lade_datei`; only the head taps and the spectra
//! stay in memory.
use realfft::num_complex::Complex;
use realfft::{ComplexToReal, RealFftPlanner, RealToComplex};
use std::sync::Arc;

/// Partition size and head length in taps.
pub const B: usize = 256;
/// FFT size.
const N: usize = 2 * B;
/// Spectrum bins of a real FFT of size N.
const NB: usize = B + 1;
/// Latency in samples that `faltung` reports through the `eigen` account (translator): none, head plus tail add nothing.
pub const LATENZ: usize = 0;

type C = Complex<f32>;

/// Per-side state.
struct Seite {
    /// First B taps reversed (`kopf[B - 1 - k] = h[k]`), zero padded when the IR is shorter than B.
    kopf: Box<[f32]>,
    /// Doubled ring of the last B inputs (2B): sample at ring position `pos` is stored at `pos` and `pos + B`, so the
    /// B newest samples are always one contiguous slice `hist[pos + 1 ..= pos + B]`.
    hist: Box<[f32]>,
    /// P partitions of NB bins: `H_q`, scaling 1/N folded in.
    h: Box<[C]>,
    /// P slots of NB bins: ring of input spectra.
    fdl: Box<[C]>,
    /// Accumulator of `sum_{q>=1} X_{j+1-q} H_q` for the tail after the next block boundary: filled a few partitions per
    /// sample during block j+1, consumed (and cleared) at its boundary.
    naechst: Box<[C]>,
    /// [previous input block, current input block].
    block: Box<[f32]>,
    /// Tail contribution to the running output block.
    schwanz: Box<[f32]>,
    /// Predelay ring (empty when the predelay is 0).
    vor: Box<[f32]>,
    /// Test only: complex multiply-accumulates of tail partitions done so far (work counter).
    #[cfg(test)]
    macs: usize,
}

/// Transform plans and scratch buffers shared by both sides.
struct Arbeit {
    fwd: Arc<dyn RealToComplex<f32>>,
    inv: Arc<dyn ComplexToReal<f32>>,
    puffer: Box<[f32]>,
    spek: Box<[C]>,
    akk: Box<[C]>,
    kratz_f: Box<[C]>,
    kratz_i: Box<[C]>,
}

pub struct Faltung {
    l: Seite,
    r: Seite,
    /// Number of tail partitions (0 when the IR has at most B taps).
    p: usize,
    /// Position inside the current block, 0..B.
    pos: usize,
    /// FDL slot that receives the next input spectrum.
    fdl_pos: usize,
    vor_pos: usize,
    a: Arbeit,
    mix: f32,
    mix0: f32,
    k_mix: f32,
}

/// Dot product with eight independent accumulators (vectorisable, fixed summation order).
#[inline]
fn punkt(a: &[f32], b: &[f32]) -> f32 {
    let mut acc = [0.0f32; 8];
    for (x, y) in a.chunks_exact(8).zip(b.chunks_exact(8)) {
        for i in 0..8 {
            acc[i] += x[i] * y[i];
        }
    }
    ((acc[0] + acc[1]) + (acc[2] + acc[3])) + ((acc[4] + acc[5]) + (acc[6] + acc[7]))
}

impl Seite {
    fn neu(h: &[f32], pre: usize, p: usize, a: &mut Arbeit) -> Seite {
        let mut kopf = vec![0.0f32; B];
        for k in 0..h.len().min(B) {
            kopf[B - 1 - k] = h[k];
        }
        let mut teile = vec![C::new(0.0, 0.0); p * NB];
        for q in 0..p {
            let von = (q + 1) * B;
            let bis = (von + B).min(h.len());
            a.puffer.fill(0.0);
            a.puffer[..bis - von].copy_from_slice(&h[von..bis]);
            a.fwd.process_with_scratch(&mut a.puffer, &mut a.spek, &mut a.kratz_f).expect("fixed sizes");
            for (z, s) in teile[q * NB..(q + 1) * NB].iter_mut().zip(a.spek.iter()) {
                *z = *s * (1.0 / N as f32);
            }
        }
        Seite {
            kopf: kopf.into_boxed_slice(),
            hist: vec![0.0; 2 * B].into_boxed_slice(),
            h: teile.into_boxed_slice(),
            fdl: vec![C::new(0.0, 0.0); p * NB].into_boxed_slice(),
            naechst: vec![C::new(0.0, 0.0); NB].into_boxed_slice(),
            block: vec![0.0; N].into_boxed_slice(),
            schwanz: vec![0.0; B].into_boxed_slice(),
            vor: vec![0.0; pre].into_boxed_slice(),
            #[cfg(test)]
            macs: 0,
        }
    }

    /// One sample: predelay, head FIR, tail of the running block. `pos` is the position in the block, `vor_pos` the
    /// predelay ring position.
    #[inline]
    fn schritt(&mut self, x: f32, pos: usize, vor_pos: usize) -> f32 {
        let w = if self.vor.is_empty() {
            x
        } else {
            let alt = self.vor[vor_pos];
            self.vor[vor_pos] = x;
            alt
        };
        self.hist[pos] = w;
        self.hist[pos + B] = w;
        self.block[B + pos] = w;
        punkt(&self.kopf, &self.hist[pos + 1..pos + 1 + B]) + self.schwanz[pos]
    }

    /// Partitions `von..bis` (all >= 1) of the tail after the next boundary, into `naechst`. `fdl_pos` is the slot that
    /// receives the next spectrum, so `fdl_pos - 1` holds `X_j`, the input of partition 1; partition `q` reads
    /// `X_{j+1-q}` from the slot `fdl_pos - q`. These blocks are complete already, so the work can run a slice per
    /// sample instead of all in the sample that completes the block. Slot `fdl_pos` itself (the oldest spectrum) is never
    /// read: the largest `q` is `p - 1`.
    #[inline]
    fn verteilt(&mut self, p: usize, fdl_pos: usize, von: usize, bis: usize) {
        for q in von..bis {
            let s = (fdl_pos + p - q) % p;
            let x = &self.fdl[s * NB..(s + 1) * NB];
            let h = &self.h[q * NB..(q + 1) * NB];
            #[cfg(test)]
            {
                self.macs += 1;
            }
            for ((y, x), h) in self.naechst.iter_mut().zip(x).zip(h) {
                y.re += x.re * h.re - x.im * h.im;
                y.im += x.re * h.im + x.im * h.re;
            }
        }
    }

    /// End of an input block: transform it, add the newest partition (`X_{j+1} H_0`) to the accumulator that the block
    /// just played filled, store the tail of the block after next.
    fn rand(&mut self, a: &mut Arbeit, slot: usize) {
        a.puffer.copy_from_slice(&self.block);
        // the results only report wrong buffer sizes, which are fixed in `neu`
        let ok = a.fwd.process_with_scratch(&mut a.puffer, &mut a.spek, &mut a.kratz_f);
        debug_assert!(ok.is_ok());
        self.fdl[slot * NB..(slot + 1) * NB].copy_from_slice(&a.spek);
        #[cfg(test)]
        {
            self.macs += 1;
        }
        for (((y, n), x), h) in a.akk.iter_mut().zip(self.naechst.iter()).zip(a.spek.iter()).zip(&self.h[..NB]) {
            y.re = n.re + (x.re * h.re - x.im * h.im);
            y.im = n.im + (x.re * h.im + x.im * h.re);
        }
        self.naechst.fill(C::new(0.0, 0.0));
        // the inverse of a real signal has real DC and Nyquist bins
        a.akk[0].im = 0.0;
        a.akk[B].im = 0.0;
        let ok = a.inv.process_with_scratch(&mut a.akk, &mut a.puffer, &mut a.kratz_i);
        debug_assert!(ok.is_ok());
        self.schwanz.copy_from_slice(&a.puffer[B..]);
        self.block.copy_within(B.., 0);
    }

    fn leeren(&mut self) {
        self.hist.fill(0.0);
        self.fdl.fill(C::new(0.0, 0.0));
        self.naechst.fill(C::new(0.0, 0.0));
        self.block.fill(0.0);
        self.schwanz.fill(0.0);
        self.vor.fill(0.0);
    }
}

impl Faltung {
    /// `ir` interleaved stereo frames (checked by the caller: at least 8 frames, finite), `pre` the predelay of the wet
    /// path in samples, `mix0` the node's own mix value (start value of the smoother and fallback for a non-finite mix).
    pub fn neu(ir: &[f32], pre: usize, mix0: f32, sr: f32) -> Faltung {
        let frames = ir.len() / 2;
        let hl: Vec<f32> = ir.iter().step_by(2).copied().collect();
        let hr: Vec<f32> = ir.iter().skip(1).step_by(2).copied().collect();
        let p = if frames > B { (frames - B + B - 1) / B } else { 0 };
        let mut planer = RealFftPlanner::<f32>::new();
        let fwd = planer.plan_fft_forward(N);
        let inv = planer.plan_fft_inverse(N);
        let mut a = Arbeit {
            kratz_f: vec![C::new(0.0, 0.0); fwd.get_scratch_len()].into_boxed_slice(),
            kratz_i: vec![C::new(0.0, 0.0); inv.get_scratch_len()].into_boxed_slice(),
            puffer: vec![0.0; N].into_boxed_slice(),
            spek: vec![C::new(0.0, 0.0); NB].into_boxed_slice(),
            akk: vec![C::new(0.0, 0.0); NB].into_boxed_slice(),
            fwd,
            inv,
        };
        let l = Seite::neu(&hl, pre, p, &mut a);
        let r = Seite::neu(&hr, pre, p, &mut a);
        Faltung {
            l,
            r,
            p,
            pos: 0,
            fdl_pos: 0,
            vor_pos: 0,
            a,
            mix: mix0,
            mix0,
            k_mix: 1.0 - (-1.0 / (0.005 * sr)).exp(),
        }
    }

    /// One stereo sample: dry in, mixed out. `mix` is the current mix input (non-finite reads the node's own value),
    /// clamped to 0..1 and smoothed with 5 ms; with a fixed mix the smoother never moves, so mix 1 is exactly the wet
    /// signal and mix 0 exactly the dry one.
    #[inline]
    pub fn prozess(&mut self, l: f32, r: f32, mix: f32) -> (f32, f32) {
        let ziel = if mix.is_finite() { mix.clamp(0.0, 1.0) } else { self.mix0 };
        self.mix += (ziel - self.mix) * self.k_mix;
        let (nl, nr) = (self.l.schritt(l, self.pos, self.vor_pos), self.r.schritt(r, self.pos, self.vor_pos));
        if !self.l.vor.is_empty() {
            self.vor_pos += 1;
            if self.vor_pos == self.l.vor.len() {
                self.vor_pos = 0;
            }
        }
        if self.p > 1 {
            // partitions 1..p of the tail after the next boundary, a slice per sample: over one block exactly once each
            // (`von` is 1 at pos 0 and `bis` is p at pos B - 1)
            let (p, pos) = (self.p, self.pos);
            let (von, bis) = (1 + pos * (p - 1) / B, 1 + (pos + 1) * (p - 1) / B);
            self.l.verteilt(p, self.fdl_pos, von, bis);
            self.r.verteilt(p, self.fdl_pos, von, bis);
        }
        self.pos += 1;
        if self.pos == B {
            self.pos = 0;
            if self.p > 0 {
                self.l.rand(&mut self.a, self.fdl_pos);
                self.r.rand(&mut self.a, self.fdl_pos);
                self.fdl_pos = if self.fdl_pos + 1 == self.p { 0 } else { self.fdl_pos + 1 };
            }
        }
        let m = self.mix;
        (nl * m + l * (1.0 - m), nr * m + r * (1.0 - m))
    }

    /// Back to the state after `neu`: no history, no tail, block position 0, mix at the node value. Does not allocate.
    pub fn zuruecksetzen(&mut self) {
        self.l.leeren();
        self.r.leeren();
        self.pos = 0;
        self.fdl_pos = 0;
        self.vor_pos = 0;
        self.mix = self.mix0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 2.0 s stereo decaying cosines (96 000 frames, P = 374), no file.
    fn lange_ir() -> Vec<f32> {
        (0..96_000usize)
            .flat_map(|i| {
                let t = i as f32 / 48_000.0;
                let e = (-3.0 * t).exp();
                [e * (t * 2.0 * std::f32::consts::PI * 440.0).cos(), e * (t * 2.0 * std::f32::consts::PI * 660.0).cos()]
            })
            .collect()
    }

    /// The boundary sample must not carry the whole tail: the partition multiply-accumulates are spread over the block.
    #[test]
    fn boundary_work_is_spread() {
        let mut f = Faltung::neu(&lange_ir(), 0, 1.0, 48_000.0);
        let p = f.p;
        assert_eq!(p, 374, "partitions of the 2.0 s IR");
        let mut z = 12345u32;
        let mut groesste = 0usize;
        for i in 0..4 * B {
            z = z.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            let x = if i == 0 { 1.0 } else { (z >> 8) as f32 / (1u32 << 24) as f32 - 0.5 };
            let vorher = f.l.macs + f.r.macs;
            f.prozess(x, -x, 1.0);
            groesste = groesste.max(f.l.macs + f.r.macs - vorher);
        }
        let grenze = 2 * ((p - 1 + B - 1) / B + 1);
        println!("MESS faltung work: largest MACs in one sample {groesste} (limit {grenze}), total {}", f.l.macs + f.r.macs);
        // negative control: the work is moved, not dropped (green on the old and the new code)
        assert_eq!(f.l.macs + f.r.macs, 4 * 2 * p, "total partition MACs over 4 blocks");
        assert!(groesste <= grenze, "one sample did {groesste} partition MACs (limit {grenze})");
    }
}
