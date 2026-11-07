//! Reported latency: 69 with oversampling (below 88 kHz), 0 without; mix does not change it (spec D10), and the
//! measured impulse peak sits where the report says.
use hall_ffi::*;
use saett_dsp::OHNE_UEBERABTASTUNG_AB;

fn spitze(l: &[f32]) -> usize {
    l.iter().enumerate().max_by(|a, b| a.1.abs().partial_cmp(&b.1.abs()).unwrap()).unwrap().0
}

const START: usize = 9700;
const LAENGE: usize = 10200;

/// Peak offset and peak value of a small impulse (near-linear range of tanh) at drive 0 dB, output 0 dB. The 10 ms
/// parameter smoothing (one pole, tau = 0.01 s = 480 samples at 48 kHz, 960 at 96 kHz) needs time to reach the target, so the
/// impulse comes after a run-in of 9700 samples: 20.2 tau at 48 kHz, 10.1 tau at 96 kHz. Right after `setze` the response
/// would be a blend of dry and wet.
fn impuls(fs: f64, mix: f64) -> (usize, u32, f32) {
    let h = cypher_saett_neu(fs);
    unsafe { cypher_saett_setze(h, 0.0, 0.0, mix) };
    let mut l = vec![0f32; LAENGE];
    let mut r = vec![0f32; LAENGE];
    l[START] = 0.01;
    r[START] = 0.01;
    let lat = unsafe {
        cypher_saett_block(h, l.as_mut_ptr(), r.as_mut_ptr(), LAENGE);
        let lat = cypher_saett_latenz(h);
        cypher_saett_frei(h);
        lat
    };
    let p = spitze(&l[START - 50..]) - 50;
    (p, lat, l[START + p].abs())
}

#[test]
fn latenz_je_abtastrate() {
    for (fs, soll) in [(44100.0, 69), (48000.0, 69), (88200.0, 0), (96000.0, 0)] {
        let h = cypher_saett_neu(fs);
        assert_eq!(unsafe { cypher_saett_latenz(h) }, soll, "fs {fs}");
        unsafe { cypher_saett_frei(h) };
    }
}

#[test]
fn mix_aendert_die_latenz_nicht() {
    for (fs, soll) in [(48000.0, 69usize), (96000.0, 0)] {
        let (p0, l0, v0) = impuls(fs, 0.0);
        let (p1, l1, v1) = impuls(fs, 1.0);
        let (ph, lh, _) = impuls(fs, 0.5);
        assert_eq!((l0, l1, lh), (soll as u32, soll as u32, soll as u32), "reported latency at {fs}");
        assert_eq!(p0, soll, "mix 0 (dry line) peak at {fs}");
        // Values, not only positions: mix 0 is the dry impulse (0.01, measured 0.01 at 48 kHz, 0.0099998 at 96 kHz; the bound
        // 1e-5 covers the smoothing remainder), mix 1 is clearly wet (measured 0.0081 at 48 kHz, 0.0050 at 96 kHz; drive 0 dB
        // on a 0.01 impulse is the near-linear range, where ADAA1 and the half-band filters change the peak by far more than 0.001).
        assert!((v0 - 0.01).abs() < 1e-5, "mix 0 must be the dry impulse at {fs}: {v0}");
        assert!((v1 - 0.01).abs() > 0.001, "mix 1 must be wet at {fs}: {v1}");
        // ADAA1 is a one-sample averager: the wet impulse response sits 0.5 base samples after the dry one. With oversampling
        // the ADAA runs at 2x, so the offset is 0.25 base samples and the peak stays on `soll` (48 kHz: exact). Without
        // oversampling (96 kHz) the offset is 0.5 and the response splits evenly over two samples (measured 0.0050004 on
        // the peak, the neighbour equal within rounding), so the peak may land on soll or soll + 1. The crate reports no fraction.
        let erlaubt: &[usize] = if fs < OHNE_UEBERABTASTUNG_AB { &[soll] } else { &[soll, soll + 1] };
        assert!(erlaubt.contains(&p1), "mix 1 (wet) peak at {fs}: {p1}");
        assert!(erlaubt.contains(&ph), "mix 0.5 peak at {fs}: {ph}");
    }
}
