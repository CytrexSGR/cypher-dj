//! Amiga sample voice (`paula`): a bank of 1..32 slots, each a stereo float32 sample with its own root frequency, stored rate,
//! loop, level and fine tune. At a rising edge of `trig` the voice picks a slot (`platz`, rounded and clamped), a start
//! position (`start`, 0..1 of the length, counted from the beginning of the playing direction) and the direction
//! (`rueckwaerts` above 0.5); a new trigger cuts the running sound at once, without a fade.
//!
//! Per sample the voice reads the frame at the head, then advances the head by `hz / grund * 2^(fein/96) * rate / fs` frames
//! (backwards when reversed). There is no interpolation: the read index lies on the grid of `g = min(quellrate, rate)`,
//! `floor(floor(pos * g / rate) * rate / g)`, so a value is held for as long as the chip would hold it and the hold follows the
//! pitch. The value is quantised to `bits`: `round(x * 2^(bits-1)) / 2^(bits-1)`, clamped to the signed range, then multiplied
//! by the level of the slot. With a loop the head wraps inside `[s_von, s_von + s_laenge)`; without one the voice stops at the
//! data end (forward) or the data start (reverse) and is silent afterwards. The gate does nothing here, the envelope outside does.
//!
//! The sample data are read at translation time (`uebersetzen`), never here. This code does not allocate and does no I/O.

/// Slots per bank.
pub const MAX_PLAETZE: usize = 32;

/// The fixed values of one slot, as written in the graph.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PlatzEinst {
    /// root frequency in Hz: `hz == grund` plays at the stored rate
    pub grund: f32,
    /// the rate of the stored frames in Hz
    pub rate: f32,
    pub schleife: bool,
    /// loop start and length in frames (used with `schleife`)
    pub s_von: u32,
    pub s_laenge: u32,
    /// level 0..1
    pub pegel: f32,
    /// fine tune in eighths of a semitone
    pub fein: i8,
}

/// One slot: its frames and the constants derived from its values.
#[derive(Debug)]
pub struct Platz {
    daten: Box<[f32]>,
    frames: usize,
    rate: f64,
    grund: f64,
    /// `2^(fein/96)`, computed once
    fein: f64,
    schleife: bool,
    s_von: f64,
    s_ende: f64,
    s_laenge: f64,
    pegel: f32,
}

impl Platz {
    /// `daten`: interleaved stereo frames, at least one.
    pub fn neu(daten: Box<[f32]>, e: &PlatzEinst) -> Platz {
        let frames = daten.len() / 2;
        Platz {
            daten,
            frames,
            rate: e.rate as f64,
            grund: e.grund as f64,
            fein: (e.fein as f64 / 96.0).exp2(),
            schleife: e.schleife,
            s_von: e.s_von as f64,
            s_ende: e.s_von as f64 + e.s_laenge as f64,
            s_laenge: e.s_laenge as f64,
            pegel: e.pegel,
        }
    }

    pub fn frames(&self) -> usize { self.frames }
}

/// The slots and the two values of the node.
#[derive(Debug)]
pub struct Bank {
    plaetze: Box<[Platz]>,
    quellrate: f64,
    /// `2^(bits-1)`
    skala: f32,
}

impl Bank {
    /// 1..=32 slots, `bits` 1..=24 (the node allows 4..16).
    pub fn neu(plaetze: Vec<Platz>, quellrate: f32, bits: u8) -> Bank {
        Bank { plaetze: plaetze.into_boxed_slice(), quellrate: quellrate as f64, skala: (1u32 << (bits - 1)) as f32 }
    }

    #[inline]
    fn quantisiere(&self, x: f32) -> f32 { (x * self.skala).round().clamp(-self.skala, self.skala - 1.0) / self.skala }
}

/// One voice.
#[derive(Clone, Copy, Debug, Default)]
pub struct Stimme {
    aktiv: bool,
    trig_hoch: bool,
    rueck: bool,
    platz: usize,
    /// head in frames, fractional
    pos: f64,
}

impl Stimme {
    /// One output sample `(l, r)`.
    #[inline]
    pub fn prozess(&mut self, b: &Bank, hz: f32, trig: f32, platz: f32, start: f32, rueck: f32, sr: f32) -> (f32, f32) {
        let hoch = trig >= 0.5;
        if hoch && !self.trig_hoch {
            let n = b.plaetze.len() as i64;
            self.platz = (platz.round() as i64).clamp(1, n) as usize - 1;
            let s = if start > 0.0 { start.min(1.0) as f64 } else { 0.0 };
            self.rueck = rueck > 0.5;
            let len = b.plaetze[self.platz].frames as f64;
            self.pos = if self.rueck { (len * (1.0 - s) - 1.0).max(0.0) } else { len * s };
            self.aktiv = true;
        }
        self.trig_hoch = hoch;
        if !self.aktiv {
            return (0.0, 0.0);
        }
        let p = &b.plaetze[self.platz];
        let g = b.quellrate.min(p.rate);
        let raster = if g >= p.rate { self.pos.floor() } else { ((self.pos * g / p.rate).floor() * p.rate / g).floor() };
        let i = (raster as usize).min(p.frames - 1);
        let l = b.quantisiere(p.daten[2 * i]) * p.pegel;
        let r = b.quantisiere(p.daten[2 * i + 1]) * p.pegel;

        let schritt = hz as f64 / p.grund * p.fein * p.rate / sr as f64;
        let schritt = if schritt.is_finite() && schritt > 0.0 { schritt } else { 0.0 };
        if self.rueck {
            self.pos -= schritt;
            if p.schleife {
                if self.pos < p.s_von {
                    self.pos = p.s_von + (self.pos - p.s_von).rem_euclid(p.s_laenge);
                }
            } else if self.pos < 0.0 {
                self.aktiv = false;
            }
        } else {
            self.pos += schritt;
            if p.schleife {
                if self.pos >= p.s_ende {
                    self.pos = p.s_von + (self.pos - p.s_von) % p.s_laenge;
                }
            } else if self.pos >= p.frames as f64 {
                self.aktiv = false;
            }
        }
        (l, r)
    }
}
