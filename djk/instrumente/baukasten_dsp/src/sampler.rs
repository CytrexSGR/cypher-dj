//! Sampler (S10): plays a sample file. Pitch is the read rate relative to a root frequency, equal slices are chosen by an
//! input, one-shot or loop, forward or reverse. The data are raw 48 kHz stereo float32 frames, interleaved (the kit format
//! of the kern). Read head in f64, Catmull-Rom interpolation (the house kernel of `deck.cpp`).
//!
//! The DSP (`Sampler`) never allocates and does no I/O. `lade_datei` reads a file at translation time (never in the audio
//! callback) with the path rules of the kit loader (D4, C7, C9).
use crate::uebersetzen::Fehler;
use std::io::Read;
use std::path::Path;

/// Length of every click-protection ramp in output samples (2 ms at 48 kHz, C5).
pub const FADE: usize = 96;
/// Frames per file (30 s at 48 kHz, D4).
pub const MAX_FRAMEN: usize = 1_440_000;
/// Sample data per graph in bytes (D4).
pub const MAX_GRAPH_BYTES: usize = 64 * 1024 * 1024;

const MIN_SCHRITT: f64 = 1.0 / 16.0;
const MAX_SCHRITT: f64 = 8.0;

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
}

#[inline]
fn catmull(y0: f32, y1: f32, y2: f32, y3: f32, x: f32) -> f32 {
    y1 + 0.5 * x * (y2 - y0 + x * (2.0 * y0 - 5.0 * y1 + 4.0 * y2 - y3 + x * (3.0 * (y1 - y2) + y3 - y0)))
}

impl Durchlauf {
    fn start(frames: usize, e: &Einstellung, scheibe: f32, rueck: f32, halt: bool) -> Durchlauf {
        let n = e.scheiben.max(1);
        let l = frames / n;
        let s = if scheibe.is_finite() { scheibe.round() as i64 } else { 0 };
        let idx = s.rem_euclid(n as i64) as usize;
        let (a, b) = (idx * l, idx * l + l);
        let rev = rueck >= 0.5;
        Durchlauf { a, b, kopf: if rev { b as f64 - 1.0 } else { a as f64 }, rueck: rev, aktiv: l > 0, halt }
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

    /// One output sample. `daten` is interleaved stereo with at least `scheiben * 4` frames (the translation guarantees it;
    /// a shorter file plays nothing). Allocation free.
    #[inline]
    pub fn prozess(&mut self, daten: &[f32], e: &Einstellung, sr: f32, x: Eingabe) -> (f32, f32) {
        let hoch = x.trig >= 0.5;
        let steigend = hoch && !self.trig_hoch;
        self.trig_hoch = hoch;
        let gate_tief = x.gate < 0.5;
        if steigend {
            let neu = Durchlauf::start(daten.len() / 2, e, x.scheibe, x.rueck, gate_tief);
            match self.phase {
                Phase::Still => {
                    self.lauf = neu;
                    self.phase = Phase::Spielt;
                }
                Phase::Spielt => {
                    self.neu = neu;
                    self.phase = Phase::Aus { i: 0, g0: 1.0 };
                }
                Phase::Ein { j } => {
                    self.neu = neu;
                    self.phase = Phase::Aus { i: 0, g0: j as f32 / FADE as f32 };
                }
                Phase::Aus { .. } => self.neu = neu,
            }
        }
        if gate_tief && e.schleife {
            self.lauf.halt = true;
            self.neu.halt = true;
        }
        let g = match self.phase {
            Phase::Still => return (0.0, 0.0),
            Phase::Spielt => 1.0,
            Phase::Ein { j } => j as f32 / FADE as f32,
            Phase::Aus { i, g0 } => g0 * ((FADE - i) as f32 / FADE as f32),
        };
        let (mut l, mut r) = if self.lauf.aktiv { self.lauf.lese(daten, e, schritt(x.hz, e.grund, sr)) } else { (0.0, 0.0) };
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
        (l, r)
    }
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
        return Err(fehler(format!("{frames} frames, at most {MAX_FRAMEN} (30 s) allowed")));
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
