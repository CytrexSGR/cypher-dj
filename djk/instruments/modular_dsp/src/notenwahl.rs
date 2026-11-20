//! Note select (type 61, `notenwahl`): the note a voice plays picks one of up to eight pads. The input `hz` comes from a `note`
//! node; the output `aus` is the index 0..7 of the pad, per voice, to feed the `wahl` input of a selector. With one pad sound per
//! candidate of the `wahl`, a kit of Baukasten sounds is a single graph, and the exclusive branches of the pads that no voice
//! plays are skipped (zweige.rs).
//!
//! The pad notes are the fields `n1`..`n8` (MIDI note numbers, -1 = pad not used). A played note that no pad owns plays the pad
//! with the next lower note (like the `trommeln` map); a note below the lowest pad plays the lowest one. Silence or a non-finite
//! `hz` gives 0. No state, no latency, no allocation.

pub const NOTEN_MAX: usize = 8;

/// MIDI note number of a frequency (inverse of `programm::hz`); None for silent or odd values.
fn note_aus_hz(hz: f32) -> Option<i32> {
    if hz.is_finite() && hz > 1.0 { Some((69.0 + 12.0 * (hz as f64 / 440.0).log2()).round() as i32) } else { None }
}

/// Index of the pad for the frequency `hz`: the used entry with the largest note not above the played one, else the used
/// entry with the lowest note, else 0.
pub fn index(hz: f32, noten: &[i32; NOTEN_MAX]) -> f32 {
    let Some(n) = note_aus_hz(hz) else { return 0.0 };
    let mut unter: Option<usize> = None;
    let mut tiefste: Option<usize> = None;
    for (k, &p) in noten.iter().enumerate() {
        if p < 0 { continue; }
        if tiefste.map_or(true, |t| p < noten[t]) { tiefste = Some(k); }
        if p <= n && unter.map_or(true, |u| p > noten[u]) { unter = Some(k); }
    }
    unter.or(tiefste).unwrap_or(0) as f32
}
