//! Sampler (S10): plays a sample file. Pitch is the read rate relative to a root frequency, equal slices are chosen by an
//! input, one-shot or loop, forward or reverse. The data are raw 48 kHz stereo float32 frames, interleaved (the kit format
//! of the kern). Read head in f64, Catmull-Rom interpolation (the house kernel of `deck.cpp`).
//!
//! Two additions of sampler A1: a slice table (`grenzen`, slices of any length instead of equal ones) and the note mode
//! (`noten_wahl`): the played note chooses the slice and its direction, speed comes from the inputs `tempo` and `halb`, and
//! the gate ends the hit with an exponential release instead of the pitch deciding the read rate.
//!
//! The DSP (`Sampler`) never allocates and does no I/O. `lade_datei` reads a file at translation time (never in the audio
//! callback) with the path rules of the kit loader (D4, C7, C9).
use crate::uebersetzen::Fehler;
use std::io::Read;
use std::path::Path;

/// Length of every click-protection ramp in output samples (2 ms at 48 kHz, C5).
pub const FADE: usize = 96;
/// Frames per file (60 s at 48 kHz; was 30 s until sampler A1). A convolution is still bounded by its own `laenge_max`.
pub const MAX_FRAMEN: usize = 2_880_000;
/// Sample data per graph in bytes (D4).
pub const MAX_GRAPH_BYTES: usize = 64 * 1024 * 1024;

const MIN_SCHRITT: f64 = 1.0 / 16.0;
const MAX_SCHRITT: f64 = 8.0;
/// Release of a hit in the note mode: level at the end of `ausklang` (-60 dB), and the clamp of `ausklang` in ms.
const AUSKLANG_ENDE: f64 = -3.0;
const AUSKLANG_MIN_MS: f32 = 1.0;
const AUSKLANG_MAX_MS: f32 = 2000.0;

/// Live inputs of the note mode (`noten_wahl` 1) at one sample: read speed factor, pitch shift in semitones, release time.
/// Speed and pitch are latched at the trigger, the release time at the gate fall.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct NotenWahl {
    pub tempo: f32,
    pub halb: f32,
    pub ausklang_ms: f32,
}

/// The MIDI note of a frequency: `round(69 + 12 log2(hz / 440))` clamped to 0..=127. A frequency that is not finite or not
/// positive gives 0.
pub fn note_von_hz(hz: f32) -> u8 {
    if !(hz.is_finite() && hz > 0.0) {
        return 0;
    }
    (69.0 + 12.0 * (hz as f64 / 440.0).log2()).round().clamp(0.0, 127.0) as u8
}

/// Fixed values of a sampler node.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Einstellung {
    /// Root frequency in Hz: `hz == grund` plays at original speed.
    pub grund: f32,
    /// Number of equal slices (1..=64).
    pub scheiben: usize,
    /// Loop inside the slice instead of one-shot.
    pub schleife: bool,
}

/// Inputs of one sample.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Eingabe {
    pub hz: f32,
    pub trig: f32,
    pub gate: f32,
    pub scheibe: f32,
    pub rueck: f32,
}

/// One pass over a slice: slice bounds in frames, head, direction.
#[derive(Clone, Copy, Debug, Default)]
struct Durchlauf {
    a: usize,
    b: usize,
    kopf: f64,
    rueck: bool,
    aktiv: bool,
    /// loop mode: the gate fell, this is the last pass
    halt: bool,
    /// note mode: the read rate latched at the trigger; 0 = follow the pitch input (old behaviour)
    fest: f64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
enum Phase {
    #[default]
    Still,
    Spielt,
    /// retrigger: the old position fades out over `FADE` samples from gain `g0`, `i` samples done
    Aus { i: usize, g0: f32 },
    /// the restarted head fades in, `j` samples done
    Ein { j: usize },
}

/// One voice.
#[derive(Clone, Copy, Debug, Default)]
pub struct Sampler {
    phase: Phase,
    lauf: Durchlauf,
    /// the pass that starts after a retrigger fade-out
    neu: Durchlauf,
    trig_hoch: bool,
    /// note mode: a release is running; level now, factor per sample, samples left
    frei: bool,
    frei_g: f32,
    frei_f: f32,
    frei_n: u32,
}

#[inline]
fn catmull(y0: f32, y1: f32, y2: f32, y3: f32, x: f32) -> f32 {
    y1 + 0.5 * x * (y2 - y0 + x * (2.0 * y0 - 5.0 * y1 + 4.0 * y2 - y3 + x * (3.0 * (y1 - y2) + y3 - y0)))
}

impl Durchlauf {
    fn start(frames: usize, e: &Einstellung, grenzen: Option<&[usize]>, scheibe: f32, rueck: f32, halt: bool) -> Durchlauf {
        let s = if scheibe.is_finite() { scheibe.round() as i64 } else { 0 };
        Durchlauf::scheibe_nr(frames, e, grenzen, s, rueck >= 0.5, halt, 0.0)
    }

    /// Pass over slice `s` (taken modulo the slice count) of the table, or of `e.scheiben` equal slices without one.
    fn scheibe_nr(frames: usize, e: &Einstellung, grenzen: Option<&[usize]>, s: i64, rev: bool, halt: bool, fest: f64) -> Durchlauf {
        let (a, b) = match grenzen {
            Some(g) if g.len() >= 2 => {
                let idx = s.rem_euclid(g.len() as i64 - 1) as usize;
                (g[idx], g[idx + 1])
            }
            _ => {
                let n = e.scheiben.max(1);
                let l = frames / n;
                let idx = s.rem_euclid(n as i64) as usize;
                (idx * l, idx * l + l)
            }
        };
        let l = b - a;
        Durchlauf { a, b, kopf: if rev { b as f64 - 1.0 } else { a as f64 }, rueck: rev, aktiv: l > 0, halt, fest }
    }

    /// Read at the head, advance, and mark the pass ended when the head leaves the slice (one-shot) or wrap it (loop).
    #[inline]
    fn lese(&mut self, d: &[f32], e: &Einstellung, schritt: f64) -> (f32, f32) {
        let l = self.b - self.a;
        let halt = !e.schleife || self.halt;
        // fade out over the last FADE output samples before the head leaves the slice: remaining length / step
        let rest = if self.rueck { (self.kopf - self.a as f64 + 1.0) / schritt } else { (self.b as f64 - self.kopf) / schritt };
        let g = if halt && rest < FADE as f64 { (rest / FADE as f64) as f32 } else { 1.0 };
        let i1 = self.kopf.floor();
        let x = (self.kopf - i1) as f32;
        let i1 = i1 as i64;
        let (a, li) = (self.a as i64, l as i64);
        let idx = |j: i64| -> usize {
            let p = i1 + j;
            let p = if e.schleife { a + (p - a).rem_euclid(li) } else { p.clamp(a, a + li - 1) };
            p as usize
        };
        let (p0, p1, p2, p3) = (idx(-1), idx(0), idx(1), idx(2));
        let (mut ol, mut or) = (
            catmull(d[2 * p0], d[2 * p1], d[2 * p2], d[2 * p3], x),
            catmull(d[2 * p0 + 1], d[2 * p1 + 1], d[2 * p2 + 1], d[2 * p3 + 1], x),
        );
        if g != 1.0 {
            ol *= g;
            or *= g;
        }
        self.kopf += if self.rueck { -schritt } else { schritt };
        let (lo, hi) = (self.a as f64, self.b as f64);
        if self.rueck && self.kopf <= lo - 1.0 {
            if halt { self.aktiv = false } else { self.kopf = (hi - 1.0) - ((hi - 1.0) - self.kopf).rem_euclid(l as f64) }
        } else if !self.rueck && self.kopf >= hi {
            if halt { self.aktiv = false } else { self.kopf = lo + (self.kopf - lo).rem_euclid(l as f64) }
        }
        (ol, or)
    }
}

/// Read rate in frames per output sample (D6): `hz / grund`, corrected for the output rate, clamped to 1/16..8. A pitch that
/// is not finite or not positive plays at the root frequency, that is at original speed.
#[inline]
fn schritt(hz: f32, grund: f32, sr: f32) -> f64 {
    let hz = if hz.is_finite() && hz > 0.0 { hz } else { grund };
    ((hz as f64 / grund as f64) * (48_000.0 / sr as f64)).clamp(MIN_SCHRITT, MAX_SCHRITT)
}

impl Sampler {
    /// True from the first trigger until the voice has stopped (one-shot end, loop stop after the gate fell).
    pub fn spielt(&self) -> bool { self.phase != Phase::Still }

    pub fn zuruecksetzen(&mut self) { *self = Sampler::default(); }

    /// One output sample of the old block: equal slices, pitch sets the read rate. Same as `prozess_mit` without a table
    /// and without the note mode.
    #[inline]
    pub fn prozess(&mut self, daten: &[f32], e: &Einstellung, sr: f32, x: Eingabe) -> (f32, f32) {
        self.prozess_mit(daten, e, None, None, sr, x)
    }

    /// One output sample. `daten` is interleaved stereo with at least `scheiben * 4` frames (the translation guarantees it;
    /// a shorter file plays nothing). Allocation free.
    ///
    /// `grenzen` is the slice table (frame bounds, `grenzen.len() - 1` slices) or `None` for `e.scheiben` equal slices.
    /// `wahl` is `Some` in the note mode: the note (from `x.hz`) chooses the slice `(n mod 64) mod count`, reversed from
    /// note 64 on; `x.scheibe` and `x.rueck` are ignored; the read rate comes from `tempo` and `halb` (latched at the
    /// trigger); the gate ends the hit with an exponential release to -60 dB over `ausklang_ms` (latched at the fall).
    #[inline]
    pub fn prozess_mit(&mut self, daten: &[f32], e: &Einstellung, grenzen: Option<&[usize]>, wahl: Option<NotenWahl>, sr: f32, x: Eingabe) -> (f32, f32) {
        let hoch = x.trig >= 0.5;
        let steigend = hoch && !self.trig_hoch;
        self.trig_hoch = hoch;
        let gate_tief = x.gate < 0.5;
        if steigend {
            let frames = daten.len() / 2;
            let neu = match wahl {
                None => Durchlauf::start(frames, e, grenzen, x.scheibe, x.rueck, gate_tief),
                Some(w) => {
                    let n = note_von_hz(x.hz) as i64;
                    Durchlauf::scheibe_nr(frames, e, grenzen, n % 64, n >= 64, gate_tief, wahl_schritt(&w, sr))
                }
            };
            // a running release is folded into the level the old pass fades out from, then it ends: the new hit is a new gate
            let rg = if self.frei { self.frei_g } else { 1.0 };
            match self.phase {
                Phase::Still => {
                    self.lauf = neu;
                    self.phase = Phase::Spielt;
                }
                Phase::Spielt => {
                    self.neu = neu;
                    self.phase = Phase::Aus { i: 0, g0: rg };
                }
                Phase::Ein { j } => {
                    self.neu = neu;
                    self.phase = Phase::Aus { i: 0, g0: rg * (j as f32 / FADE as f32) };
                }
                Phase::Aus { i, g0 } => {
                    self.neu = neu;
                    self.phase = Phase::Aus { i, g0: g0 * rg };
                }
            }
            self.frei = false;
        }
        if gate_tief && e.schleife {
            self.lauf.halt = true;
            self.neu.halt = true;
        }
        if let Some(w) = wahl {
            if gate_tief && !self.frei && self.phase != Phase::Still {
                let ms = if w.ausklang_ms.is_finite() { w.ausklang_ms.clamp(AUSKLANG_MIN_MS, AUSKLANG_MAX_MS) } else { 5.0 };
                let n = ((ms as f64 * sr as f64 / 1000.0).round() as u32).max(1);
                self.frei = true;
                self.frei_g = 1.0;
                self.frei_f = 10f64.powf(AUSKLANG_ENDE / n as f64) as f32;
                self.frei_n = n;
            }
        }
        let g = match self.phase {
            Phase::Still => return (0.0, 0.0),
            Phase::Spielt => 1.0,
            Phase::Ein { j } => j as f32 / FADE as f32,
            Phase::Aus { i, g0 } => g0 * ((FADE - i) as f32 / FADE as f32),
        };
        let (mut l, mut r) = if self.lauf.aktiv {
            let st = if self.lauf.fest > 0.0 { self.lauf.fest } else { schritt(x.hz, e.grund, sr) };
            self.lauf.lese(daten, e, st)
        } else {
            (0.0, 0.0)
        };
        let g = if self.frei { g * self.frei_g } else { g };
        if g != 1.0 {
            l *= g;
            r *= g;
        }
        match self.phase {
            Phase::Still => {}
            Phase::Spielt => {
                if !self.lauf.aktiv { self.phase = Phase::Still }
            }
            Phase::Ein { j } => {
                self.phase = if !self.lauf.aktiv { Phase::Still } else if j + 1 >= FADE { Phase::Spielt } else { Phase::Ein { j: j + 1 } };
            }
            Phase::Aus { i, g0 } => {
                if i + 1 >= FADE {
                    self.lauf = self.neu;
                    self.phase = Phase::Ein { j: 0 };
                } else {
                    self.phase = Phase::Aus { i: i + 1, g0 };
                }
            }
        }
        if self.frei {
            self.frei_g *= self.frei_f;
            self.frei_n -= 1;
            if self.frei_n == 0 || self.phase == Phase::Still {
                // the release is over (or the hit ended by itself): stop the voice
                self.frei = false;
                self.phase = Phase::Still;
                self.lauf.aktiv = false;
            }
        }
        (l, r)
    }
}

/// Read rate of the note mode: `tempo * 2^(halb / 12)` corrected for the output rate, clamped to 1/16..8. A `tempo` that is
/// not finite or not positive counts as 1, a `halb` that is not finite as 0.
fn wahl_schritt(w: &NotenWahl, sr: f32) -> f64 {
    let tempo = if w.tempo.is_finite() && w.tempo > 0.0 { w.tempo as f64 } else { 1.0 };
    let halb = if w.halb.is_finite() { w.halb as f64 } else { 0.0 };
    (tempo * 2f64.powf(halb / 12.0) * (48_000.0 / sr as f64)).clamp(MIN_SCHRITT, MAX_SCHRITT)
}

/// Name rule of the kit (`kit.cpp:11-12`: `[A-Za-z0-9_.-]`, no `/`, suffix `.f32`, length 5..64 including the suffix) plus
/// the explicit rejection of any `..` substring (C9).
fn name_pruefen(name: &str) -> Result<(), &'static str> {
    if !(5..=64).contains(&name.len()) {
        return Err("name length must be 5..64 including .f32");
    }
    if !name.ends_with(".f32") {
        return Err("name must end in .f32");
    }
    if name.contains("..") {
        return Err("name must not contain ..");
    }
    if !name.bytes().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'.' | b'-')) {
        return Err("name may only contain A-Z a-z 0-9 _ . -");
    }
    Ok(())
}

/// Read `wurzel/name` as raw stereo float32 frames. `summe` counts the bytes loaded so far for this graph (cap
/// `MAX_GRAPH_BYTES`) and is advanced on success. Symlinks are followed (the files are the owner's, C9); the target must be
/// a regular file. The file is opened once and its size is read from the open handle, so size and content come from the
/// same file.
pub fn lade_datei(wurzel: &Path, name: &str, knoten: &str, summe: &mut usize) -> Result<Box<[f32]>, Fehler> {
    let fehler = |g: String| Fehler::Datei { knoten: knoten.to_string(), grund: format!("{name}: {g}") };
    name_pruefen(name).map_err(|g| fehler(g.to_string()))?;
    let pfad = wurzel.join(name);
    // `metadata` follows links: a fifo or device behind a link is refused before `open` could block on it
    let vorab = std::fs::metadata(&pfad).map_err(|e| fehler(format!("not readable: {e}")))?;
    if !vorab.is_file() {
        return Err(fehler("not a regular file".to_string()));
    }
    let mut f = std::fs::File::open(&pfad).map_err(|e| fehler(format!("not readable: {e}")))?;
    let meta = f.metadata().map_err(|e| fehler(format!("not readable: {e}")))?;
    if !meta.is_file() {
        return Err(fehler("not a regular file".to_string()));
    }
    let laenge = meta.len();
    if laenge == 0 || laenge % 8 != 0 {
        return Err(fehler(format!("size {laenge} bytes is not a multiple of 8 (stereo float32 frames)")));
    }
    let frames = laenge / 8;
    if frames < 8 {
        return Err(fehler(format!("{frames} frames, at least 8 required")));
    }
    if frames > MAX_FRAMEN as u64 {
        return Err(fehler(format!("{frames} frames, at most {MAX_FRAMEN} (60 s) allowed")));
    }
    let laenge = laenge as usize;
    if *summe + laenge > MAX_GRAPH_BYTES {
        return Err(fehler(format!("sample data of this graph would exceed {} MiB", MAX_GRAPH_BYTES >> 20)));
    }
    let mut daten: Vec<f32> = Vec::with_capacity(laenge / 4);
    let mut puffer = vec![0u8; 65_536];
    let mut offen = laenge;
    while offen > 0 {
        let n = offen.min(puffer.len());
        f.read_exact(&mut puffer[..n]).map_err(|e| fehler(format!("file changed while reading: {e}")))?;
        for c in puffer[..n].chunks_exact(4) {
            let v = f32::from_le_bytes([c[0], c[1], c[2], c[3]]);
            if !v.is_finite() {
                return Err(fehler(format!("non-finite sample at frame {}", daten.len() / 2)));
            }
            daten.push(v);
        }
        offen -= n;
    }
    let mut mehr = [0u8; 1];
    if f.read(&mut mehr).map_err(|e| fehler(format!("file changed while reading: {e}")))? != 0 {
        return Err(fehler("file grew while reading".to_string()));
    }
    *summe += laenge;
    Ok(daten.into_boxed_slice())
}
