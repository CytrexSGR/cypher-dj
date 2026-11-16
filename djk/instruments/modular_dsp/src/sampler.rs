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
//!
//! Stage 2a (zones): a node with a zone table (`ZonenTabelle`) plays multisample instruments. At a trigger the note and the
//! velocity choose one zone (key range, velocity range, round robin), the zone's frames `[a, b)` play once at the read rate
//! `hz / root of the zone`, with the zone's gain and pan. The sample data of such a node is a pack: one big file, mapped
//! read-only (`Daten::Karte`) instead of read into memory.
use crate::uebersetzen::Fehler;
use std::io::Read;
use std::ops::Deref;
use std::path::Path;

#[cfg(target_endian = "big")]
compile_error!("sample packs are little-endian float32 and are read in place");

/// Length of every click-protection ramp in output samples (2 ms at 48 kHz, C5).
pub const FADE: usize = 96;
/// Frames per file (60 s at 48 kHz; was 30 s until sampler A1). A convolution is still bounded by its own `laenge_max`.
pub const MAX_FRAMEN: usize = 2_880_000;
/// Sample data per graph in bytes (D4).
pub const MAX_GRAPH_BYTES: usize = 64 * 1024 * 1024;
/// Frames per pack of a zone node (2 GiB at 8 bytes per frame). A pack is mapped, not read, and is not counted into
/// `MAX_GRAPH_BYTES`.
pub const MAX_PACK_FRAMEN: usize = 268_435_456;
/// Numbers per zone in the flat table `zonen`.
pub const ZONE_BREITE: usize = 12;
/// Zones per node.
pub const MAX_ZONEN: usize = 1024;

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
    /// zone mode: this pass plays a zone; root frequency in Hz and gains left and right of that zone
    zone: bool,
    zgrund: f32,
    zl: f32,
    zr: f32,
    /// zone loop (stage 2b): loop bounds in frames (`lb == 0`: no loop), cross-fade length in source frames, the loop was
    /// left (plays on to `b`), output samples since the gate fell
    la: usize,
    lb: usize,
    xb: usize,
    verlassen: bool,
    tief_n: u32,
    /// the end-fade factor of the last read (stage 2b: a release pass fades out from it)
    g_letzt: f32,
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
    /// zone mode, release samples (stage 2b): trigger edge of the release logic, a release may start at the next gate fall,
    /// the gate at the last sample, note and velocity of the last trigger, the release pass and its fade-out (`rel_aus`)
    f_trig: bool,
    z_arm: bool,
    g_hoch: bool,
    z_note: u8,
    z_vel: u8,
    rel: Durchlauf,
    rel_aus: bool,
    rel_i: usize,
    rel_g0: f32,
}

/// The settings of a release pass: a one-shot.
const EINMAL: Einstellung = Einstellung { grund: 261.6256, scheiben: 1, schleife: false };
/// A zone loop ends this many seconds after the gate fell.
const SCHLEIFE_NACH_S: f64 = 10.0;

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
        Durchlauf { a, b, kopf: if rev { b as f64 - 1.0 } else { a as f64 }, rueck: rev, aktiv: l > 0, halt, fest, ..Durchlauf::default() }
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
        self.g_letzt = g;
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

impl Durchlauf {
    /// Read at the head of a zone pass with a sustain loop (stage 2b). Loops while `!verlassen`: over the last `xb` source frames
    /// before `lb` the material of the `xb` frames before `la` fades in (equal gain, linear), then the head wraps to `la`. Once
    /// `abgelaufen` (10 s after the gate fell) the loop is left outside the cross-fade zone, or at the next wrap, and the pass
    /// plays on to `b` with the usual end fade. While looping there is no end fade.
    #[inline]
    fn lese_schleife(&mut self, d: &[f32], schritt: f64, abgelaufen: bool) -> (f32, f32) {
        let (la, lb, xb) = (self.la as f64, self.lb as f64, self.xb as f64);
        if !self.verlassen && abgelaufen && self.kopf < lb - xb {
            self.verlassen = true;
        }
        let rest = (self.b as f64 - self.kopf) / schritt;
        let g = if self.verlassen && rest < FADE as f64 { (rest / FADE as f64) as f32 } else { 1.0 };
        self.g_letzt = g;
        let i1 = self.kopf.floor();
        let x = (self.kopf - i1) as f32;
        let i1 = i1 as i64;
        let (lo, hi) = (self.a as i64, self.b as i64 - 1);
        let lesen = |i1: i64| -> (f32, f32) {
            let ix = |j: i64| (i1 + j).clamp(lo, hi) as usize;
            let (p0, p1, p2, p3) = (ix(-1), ix(0), ix(1), ix(2));
            (
                catmull(d[2 * p0], d[2 * p1], d[2 * p2], d[2 * p3], x),
                catmull(d[2 * p0 + 1], d[2 * p1 + 1], d[2 * p2 + 1], d[2 * p3 + 1], x),
            )
        };
        let (mut ol, mut or) = lesen(i1);
        if !self.verlassen && self.xb > 0 && self.kopf >= lb - xb {
            let t = ((self.kopf - (lb - xb)) / xb) as f32;
            let (l2, r2) = lesen(i1 - (self.lb - self.la) as i64);
            ol += t * (l2 - ol);
            or += t * (r2 - or);
        }
        if g != 1.0 {
            ol *= g;
            or *= g;
        }
        self.kopf += schritt;
        if !self.verlassen && self.kopf >= lb {
            self.kopf = la + (self.kopf - lb).rem_euclid(lb - la);
            if abgelaufen {
                self.verlassen = true;
            }
        } else if self.kopf >= self.b as f64 {
            self.aktiv = false;
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
    pub fn spielt(&self) -> bool { self.phase != Phase::Still || self.rel.aktiv }

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
        self.kern(daten, e, grenzen, wahl, sr, x, None)
    }

    /// One output sample of a zone node (stage 2a). `rr` is the round-robin counter of the node. `vel` is the velocity 0..1 of
    /// the note, read at the trigger sample. The pass of a zone is a one-shot over `[a, b)`; the gate does not stop it.
    #[inline]
    pub fn prozess_zonen(&mut self, daten: &[f32], tab: &ZonenTabelle, rr: &mut u64, sr: f32, x: Eingabe, vel: f32) -> (f32, f32) {
        let e = Einstellung { grund: 261.6256, scheiben: 1, schleife: false };
        self.kern(daten, &e, None, None, sr, x, Some((tab, rr, vel)))
    }

    /// Like `prozess_zonen`, plus the release samples (stage 2b): returns `(l, r, rl, rr)`. `rr_frei` is the second round-robin
    /// counter of the node. A release starts at a high-to-low gate edge after a trigger, once per trigger, from the release
    /// zones (art 1) that hold the note and the velocity of that trigger.
    #[inline]
    pub fn prozess_zonen_frei(&mut self, daten: &[f32], tab: &ZonenTabelle, rr: &mut u64, rr_frei: &mut u64, sr: f32, x: Eingabe, vel: f32) -> (f32, f32, f32, f32) {
        let (l, r) = self.kern(daten, &EINMAL, None, None, sr, x, Some((tab, rr, vel)));
        let (rl, rr2) = self.frei_zone(daten, tab, rr_frei, sr, x, vel);
        (l, r, rl, rr2)
    }

    /// The release pass of a voice (stage 2b), independent of the main pass.
    #[inline]
    fn frei_zone(&mut self, daten: &[f32], tab: &ZonenTabelle, rr: &mut u64, sr: f32, x: Eingabe, vel: f32) -> (f32, f32) {
        let hoch = x.trig >= 0.5;
        let steigend = hoch && !self.f_trig;
        self.f_trig = hoch;
        let gate_hoch = x.gate >= 0.5;
        if steigend {
            let (n, v) = tab.note_vel(x.hz, vel);
            self.z_note = n;
            self.z_vel = v;
            self.z_arm = true;
            if self.rel.aktiv && !self.rel_aus {
                self.rel_aus = true;
                self.rel_i = 0;
                self.rel_g0 = self.rel.g_letzt;
            }
        } else if self.z_arm && self.g_hoch && !gate_hoch {
            self.z_arm = false;
            let neu = tab.waehle_frei(self.z_note, self.z_vel, x.hz, rr, sr);
            if neu.aktiv {
                self.rel = neu;
                self.rel_aus = false;
            }
        }
        self.g_hoch = gate_hoch;
        if !self.rel.aktiv {
            self.rel_aus = false;
            return (0.0, 0.0);
        }
        let (mut l, mut r) = self.rel.lese(daten, &EINMAL, self.rel.fest);
        l = if l.is_finite() { l * self.rel.zl } else { 0.0 };
        r = if r.is_finite() { r * self.rel.zr } else { 0.0 };
        if self.rel_aus {
            let g = self.rel_g0 * ((FADE - self.rel_i) as f32 / FADE as f32);
            l *= g;
            r *= g;
            self.rel_i += 1;
            if self.rel_i >= FADE {
                self.rel.aktiv = false;
                self.rel_aus = false;
            }
        }
        (l, r)
    }

    #[inline]
    fn kern(&mut self, daten: &[f32], e: &Einstellung, grenzen: Option<&[usize]>, wahl: Option<NotenWahl>, sr: f32, x: Eingabe, mut zonen: Option<(&ZonenTabelle, &mut u64, f32)>) -> (f32, f32) {
        let hoch = x.trig >= 0.5;
        let steigend = hoch && !self.trig_hoch;
        self.trig_hoch = hoch;
        let gate_tief = x.gate < 0.5;
        if steigend {
            let frames = daten.len() / 2;
            let neu = if let Some((tab, rr, vel)) = zonen.as_mut() {
                tab.waehle(x.hz, *vel, rr)
            } else {
                match wahl {
                None => Durchlauf::start(frames, e, grenzen, x.scheibe, x.rueck, gate_tief),
                Some(w) => {
                    let n = note_von_hz(x.hz) as i64;
                    Durchlauf::scheibe_nr(frames, e, grenzen, n % 64, n >= 64, gate_tief, wahl_schritt(&w, sr))
                }
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
            let st = if self.lauf.fest > 0.0 { self.lauf.fest } else { schritt(x.hz, if self.lauf.zone { self.lauf.zgrund } else { e.grund }, sr) };
            let (l, r) = if self.lauf.lb > 0 {
                // zone loop: counts the samples since the gate fell, 10 s end the loop
                self.lauf.tief_n = if gate_tief { self.lauf.tief_n.saturating_add(1) } else { 0 };
                let ab = self.lauf.tief_n as f64 >= SCHLEIFE_NACH_S * sr as f64;
                self.lauf.lese_schleife(daten, st, ab)
            } else {
                self.lauf.lese(daten, e, st)
            };
            if self.lauf.zone {
                // a sample value that is not finite reads as 0 (packs are not scanned at load)
                (if l.is_finite() { l * self.lauf.zl } else { 0.0 }, if r.is_finite() { r * self.lauf.zr } else { 0.0 })
            } else {
                (l, r)
            }
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

/// One zone of the table, precomputed for the trigger.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Zone {
    a: usize,
    b: usize,
    /// root frequency in Hz
    grund_hz: f32,
    lo: u8,
    hi: u8,
    vlo: u8,
    vhi: u8,
    /// gain left and right: `gain * sqrt(2) * cos/sin` of the constant power pan law (pan 0 = as recorded)
    gl: f32,
    gr: f32,
    /// sustain loop in frames (`lb == 0`: none) and the cross-fade length in source frames
    la: usize,
    lb: usize,
    xb: usize,
    /// 0 = played by the key, 1 = release sample
    art: u8,
}

/// The zone table of a node (stage 2a), checked and precomputed at translation.
#[derive(Clone, Debug, PartialEq)]
pub struct ZonenTabelle {
    zonen: Box<[Zone]>,
}

/// A rule of the zone table that is violated: the zone (counted from 0; `None` for the table as a whole), the field name
/// and the reason.
#[derive(Clone, Debug, PartialEq)]
pub struct ZonenFehler {
    pub zone: Option<usize>,
    pub feld: &'static str,
    pub grund: String,
}

impl ZonenTabelle {
    /// `neu_mit` with the default cross-fade of 20 ms.
    pub fn neu(flach: &[f64], frames: Option<u64>) -> Result<ZonenTabelle, ZonenFehler> { Self::neu_mit(flach, frames, 20.0) }

    /// Check the flat table (`ZONE_BREITE` numbers per zone, see the spec) and precompute the trigger data. With `frames`
    /// (the frames of the pack) the zone bounds are checked against it. `blende_ms` is the loop cross-fade (`loop_blende`,
    /// 0..=500 ms at 48 kHz); the length of a zone's cross-fade is `min(blende, loop_a - a, loop_b - loop_a)` source frames.
    pub fn neu_mit(flach: &[f64], frames: Option<u64>, blende_ms: f64) -> Result<ZonenTabelle, ZonenFehler> {
        let tab = |grund: &str| ZonenFehler { zone: None, feld: "zonen", grund: grund.to_string() };
        if flach.is_empty() || flach.len() % ZONE_BREITE != 0 {
            return Err(tab(&format!("the table must hold a multiple of {ZONE_BREITE} numbers, got {}", flach.len())));
        }
        if flach.len() / ZONE_BREITE > MAX_ZONEN {
            return Err(tab(&format!("at most {MAX_ZONEN} zones, got {}", flach.len() / ZONE_BREITE)));
        }
        let mut zonen = Vec::with_capacity(flach.len() / ZONE_BREITE);
        for (i, z) in flach.chunks_exact(ZONE_BREITE).enumerate() {
            let f = |feld: &'static str, grund: String| ZonenFehler { zone: Some(i), feld, grund };
            let ganz = |v: f64| v.is_finite() && v.fract() == 0.0;
            let (a, b) = (z[0], z[1]);
            if !(ganz(a) && a >= 0.0) {
                return Err(f("a", "must be a whole number of frames >= 0".to_string()));
            }
            if !(ganz(b) && b >= a + 4.0) {
                return Err(f("b", "must be a whole number of frames with a + 4 <= b".to_string()));
            }
            if let Some(fr) = frames {
                if b > fr as f64 {
                    return Err(f("b", format!("{b} exceeds the {fr} frames of the pack")));
                }
            }
            if !(z[2].is_finite() && (0.0..=127.0).contains(&z[2])) {
                return Err(f("grund", "root note must be 0..127".to_string()));
            }
            for (k, feld, von, bis) in [(3, "lo", 0.0, 127.0), (4, "hi", 0.0, 127.0), (5, "vlo", 1.0, 127.0), (6, "vhi", 1.0, 127.0)] {
                if !(ganz(z[k]) && (von..=bis).contains(&z[k])) {
                    return Err(f(feld, format!("must be a whole number {von}..{bis}")));
                }
            }
            if z[3] > z[4] {
                return Err(f("lo", "lo must not exceed hi".to_string()));
            }
            if z[5] > z[6] {
                return Err(f("vlo", "vlo must not exceed vhi".to_string()));
            }
            if !(z[7].is_finite() && (0.0..=8.0).contains(&z[7])) {
                return Err(f("gain", "must be 0..8".to_string()));
            }
            if !(z[8].is_finite() && (-1.0..=1.0).contains(&z[8])) {
                return Err(f("pan", "must be -1..1".to_string()));
            }
            if !(z[11] == 0.0 || z[11] == 1.0) {
                return Err(f("art", "must be 0 (played by the key) or 1 (release sample)".to_string()));
            }
            let (la, lb) = (z[9], z[10]);
            if la != 0.0 || lb != 0.0 {
                if !(ganz(la) && la >= 0.0) {
                    return Err(f("loop_a", "must be a whole number of frames".to_string()));
                }
                if !(ganz(lb) && lb >= 0.0) {
                    return Err(f("loop_b", "must be a whole number of frames".to_string()));
                }
                if la == 0.0 {
                    return Err(f("loop_b", "loop_a and loop_b must be both 0 (no loop) or both set".to_string()));
                }
                if lb == 0.0 {
                    return Err(f("loop_a", "loop_a and loop_b must be both 0 (no loop) or both set".to_string()));
                }
                if z[11] == 1.0 {
                    return Err(f("loop_a", "a release zone (art 1) cannot have a loop".to_string()));
                }
                if la < a {
                    return Err(f("loop_a", format!("must not lie before the zone start a = {a}")));
                }
                if lb < la + 64.0 {
                    return Err(f("loop_b", "must be at least 64 frames after loop_a".to_string()));
                }
                if lb > b {
                    return Err(f("loop_b", format!("must not exceed the zone end b = {b}")));
                }
            }
            let xb = if lb > 0.0 { (blende_ms * 48.0).round().max(0.0).min(la - a).min(lb - la) as usize } else { 0 };
            let theta = (z[8] + 1.0) * std::f64::consts::FRAC_PI_4;
            let k = z[7] * std::f64::consts::SQRT_2;
            zonen.push(Zone {
                a: a as usize,
                b: b as usize,
                grund_hz: (440.0 * ((z[2] - 69.0) / 12.0).exp2()) as f32,
                lo: z[3] as u8,
                hi: z[4] as u8,
                vlo: z[5] as u8,
                vhi: z[6] as u8,
                gl: (k * theta.cos()) as f32,
                gr: (k * theta.sin()) as f32,
                la: la as usize,
                lb: lb as usize,
                xb,
                art: z[11] as u8,
            });
        }
        Ok(ZonenTabelle { zonen: zonen.into_boxed_slice() })
    }

    pub fn len(&self) -> usize { self.zonen.len() }

    pub fn is_empty(&self) -> bool { self.zonen.is_empty() }

    /// The MIDI note and the velocity (1..=127) of a trigger.
    fn note_vel(&self, hz: f32, vel: f32) -> (u8, u8) {
        let v = if vel.is_finite() { (vel as f64 * 127.0).round().clamp(1.0, 127.0) as u8 } else { 127 };
        (note_von_hz(hz), v)
    }

    /// The pass for a trigger: the candidates (art 0, key and velocity range contain the note and the velocity) in table
    /// order, one plays, with several `*rr % candidates`, and the counter advances. No candidate: an inactive pass, the counter
    /// stays. Does not allocate.
    fn waehle(&self, hz: f32, vel: f32, rr: &mut u64) -> Durchlauf {
        let (note, v) = self.note_vel(hz, vel);
        let passt = |z: &&Zone| z.art == 0 && (z.lo..=z.hi).contains(&note) && (z.vlo..=z.vhi).contains(&v);
        let n = self.zonen.iter().filter(passt).count();
        if n == 0 {
            return Durchlauf::default();
        }
        let z = self.zonen.iter().filter(passt).nth((*rr % n as u64) as usize).unwrap();
        *rr = rr.wrapping_add(1);
        Durchlauf { a: z.a, b: z.b, kopf: z.a as f64, aktiv: true, halt: true, zone: true, zgrund: z.grund_hz, zl: z.gl, zr: z.gr, la: z.la, lb: z.lb, xb: z.xb, ..Durchlauf::default() }
    }

    /// The release pass for the gate fall of a voice triggered with `note` and `v`: the candidates are the zones of art 1 that
    /// hold them, in table order, chosen by the second counter. The read rate is latched here from `hz`.
    fn waehle_frei(&self, note: u8, v: u8, hz: f32, rr: &mut u64, sr: f32) -> Durchlauf {
        let passt = |z: &&Zone| z.art == 1 && (z.lo..=z.hi).contains(&note) && (z.vlo..=z.vhi).contains(&v);
        let n = self.zonen.iter().filter(passt).count();
        if n == 0 {
            return Durchlauf::default();
        }
        let z = self.zonen.iter().filter(passt).nth((*rr % n as u64) as usize).unwrap();
        *rr = rr.wrapping_add(1);
        Durchlauf { a: z.a, b: z.b, kopf: z.a as f64, aktiv: true, halt: true, zone: true, zgrund: z.grund_hz, zl: z.gl, zr: z.gr, fest: schritt(hz, z.grund_hz, sr), ..Durchlauf::default() }
    }
}

/// Sample data of a node: read into memory (every ordinary path) or a read-only memory map of a pack (zone nodes).
pub enum Daten {
    Eigen(Box<[f32]>),
    Karte(Karte),
}

impl Deref for Daten {
    type Target = [f32];
    #[inline]
    fn deref(&self) -> &[f32] {
        match self {
            Daten::Eigen(b) => b,
            Daten::Karte(k) => k.als_slice(),
        }
    }
}

/// A pack mapped read-only (`PROT_READ`, `MAP_PRIVATE`), unmapped on drop. The size is a multiple of 8 bytes and at most
/// `MAX_PACK_FRAMEN` frames. Truncating the file while it is mapped can raise SIGBUS on a read: the page server never
/// rewrites a pack in place.
pub struct Karte {
    zeiger: *const f32,
    laenge: usize,
    bytes: usize,
}

// SAFETY: the map is read-only and never changes through this handle; the address stays valid until `drop`.
unsafe impl Send for Karte {}
unsafe impl Sync for Karte {}

impl Karte {
    /// Number of stereo frames in the pack.
    pub fn frames(&self) -> u64 { (self.laenge / 2) as u64 }

    #[inline]
    fn als_slice(&self) -> &[f32] {
        // SAFETY: `zeiger` points to `laenge` f32 values of a live read-only mapping (page aligned, so f32 aligned)
        unsafe { std::slice::from_raw_parts(self.zeiger, self.laenge) }
    }
}

impl Drop for Karte {
    fn drop(&mut self) {
        // SAFETY: address and length are exactly those of the successful `mmap`
        unsafe { libc::munmap(self.zeiger as *mut libc::c_void, self.bytes) };
    }
}

impl std::fmt::Debug for Karte {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { write!(f, "Karte({} frames)", self.laenge / 2) }
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

/// Open `wurzel/name` after the name rules; the target (links are followed) must be a regular file. Returns the open handle
/// and the size read from it.
fn oeffne_regulaer(wurzel: &Path, name: &str, knoten: &str) -> Result<(std::fs::File, u64), Fehler> {
    let fehler = |g: String| Fehler::Datei { knoten: knoten.to_string(), grund: format!("{name}: {g}") };
    name_pruefen(name).map_err(|g| fehler(g.to_string()))?;
    let pfad = wurzel.join(name);
    // `metadata` follows links: a fifo or device behind a link is refused before `open` could block on it
    let vorab = std::fs::metadata(&pfad).map_err(|e| fehler(format!("not readable: {e}")))?;
    if !vorab.is_file() {
        return Err(fehler("not a regular file".to_string()));
    }
    let f = std::fs::File::open(&pfad).map_err(|e| fehler(format!("not readable: {e}")))?;
    let meta = f.metadata().map_err(|e| fehler(format!("not readable: {e}")))?;
    if !meta.is_file() {
        return Err(fehler("not a regular file".to_string()));
    }
    Ok((f, meta.len()))
}

/// Map the pack `wurzel/name` read-only (zone nodes). No read, no scan of the content, not counted into `MAX_GRAPH_BYTES`.
/// Same name rules as `lade_datei`; the size must be a multiple of 8, 8..=`MAX_PACK_FRAMEN` frames.
pub fn karte_datei(wurzel: &Path, name: &str, knoten: &str) -> Result<Karte, Fehler> {
    use std::os::unix::io::AsRawFd;
    let fehler = |g: String| Fehler::Datei { knoten: knoten.to_string(), grund: format!("{name}: {g}") };
    let (f, laenge) = oeffne_regulaer(wurzel, name, knoten)?;
    if laenge == 0 || laenge % 8 != 0 {
        return Err(fehler(format!("size {laenge} bytes is not a multiple of 8 (stereo float32 frames)")));
    }
    let frames = laenge / 8;
    if frames < 8 {
        return Err(fehler(format!("{frames} frames, at least 8 required")));
    }
    if frames > MAX_PACK_FRAMEN as u64 {
        return Err(fehler(format!("{frames} frames, at most {MAX_PACK_FRAMEN} (2 GiB) allowed for a pack")));
    }
    let bytes = laenge as usize;
    // SAFETY: a fresh read-only private mapping of an open regular file; the result is checked before use
    let p = unsafe { libc::mmap(std::ptr::null_mut(), bytes, libc::PROT_READ, libc::MAP_PRIVATE, f.as_raw_fd(), 0) };
    if p == libc::MAP_FAILED {
        return Err(fehler(format!("cannot map: {}", std::io::Error::last_os_error())));
    }
    // read-ahead is a hint, its failure changes nothing
    unsafe { libc::madvise(p, bytes, libc::MADV_WILLNEED) };
    Ok(Karte { zeiger: p as *const f32, laenge: bytes / 4, bytes })
}

/// Read `wurzel/name` as raw stereo float32 frames. `summe` counts the bytes loaded so far for this graph (cap
/// `MAX_GRAPH_BYTES`) and is advanced on success. Symlinks are followed (the files are the owner's, C9); the target must be
/// a regular file. The file is opened once and its size is read from the open handle, so size and content come from the
/// same file.
pub fn lade_datei(wurzel: &Path, name: &str, knoten: &str, summe: &mut usize) -> Result<Box<[f32]>, Fehler> {
    let fehler = |g: String| Fehler::Datei { knoten: knoten.to_string(), grund: format!("{name}: {g}") };
    let (mut f, laenge) = oeffne_regulaer(wurzel, name, knoten)?;
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
