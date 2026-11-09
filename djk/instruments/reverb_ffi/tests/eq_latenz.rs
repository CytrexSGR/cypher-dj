//! The reported latency follows the crate: 69 samples below 88 kHz, 0 above (no oversampling).
use hall_ffi::*;

#[test]
fn latenz_je_abtastrate() {
    for (fs, soll) in [(44100.0, 69), (48000.0, 69), (96000.0, 0)] {
        let h = cypher_eq_neu(fs);
        assert_eq!(unsafe { cypher_eq_latenz(h) }, soll, "fs {fs}");
        unsafe { cypher_eq_frei(h) };
    }
}
