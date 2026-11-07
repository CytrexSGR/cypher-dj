//! Das übersetzte Programm: Schritte in fester Reihenfolge, je Ausgangsport ein Slot mit einem Wert je Stimme.
//! Jeder Schritt rechnet alle Stimmen eines Knotens nacheinander (Stimmen liegen nebeneinander im Slot, Spec E7).
//! Kanten mit Verzögerung lesen `vorher`, den Stand des vorigen Samples (Spec E1).
use crate::adsr::{Adsr, AdsrZeiten};
use crate::chorus::Chorus;
use crate::echo::Echo;
use crate::faltung::Faltung;
use crate::gate::Gate;
use crate::krume::Krume;
use crate::leitung::Leitung;
use crate::lfo::Lfo;
use crate::limiter::Limiter;
use crate::osz::{Osz, Rauschen, Sinus};
use crate::phaser::Phaser;
use crate::vocoder::Vocoder;
use crate::sampler::{Eingabe, Einstellung, Sampler};
use crate::roehre::{Roehre, RoehrenSatz};
use crate::svf::Svf;
use crate::wavetable::{Eingabe as WtEingabe, Einstellung as WtEinstellung, Stimme as WtStimme, Tabelle};
use crate::resonator::{Eingabe as RsEingabe, Einstellung as RsEinstellung, Satz, Stimme as RsStimme};
use crate::metall::{Einstellung as MtEinstellung, Stimme as MtStimme};
use crate::granular::{Eingabe as GrEingabe, Einstellung as GrEinstellung, Material as GrMaterial, Stimme as GrStimme};
use crate::saite::{Eingabe as SaEingabe, Einstellung as SaEinstellung, Stimme as SaStimme};
use rb_dsp::Ladder;
use saett_dsp::Adaa1;

/// Höchstzahl der Stimmen eines Graphen; `stimmen` im JSON darf 1..=MAX_STIMMEN sein.
pub const MAX_STIMMEN: usize = 16;
pub type Spur = [f32; MAX_STIMMEN];
/// Zahl der Regler („Knob 1..8“ im Plugin)
pub const REGLER: usize = 8;

/// Woher ein Eingang liest: aus einem Slot dieses Samples, aus einem Slot des vorigen Samples, oder fest 0.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Quelle {
    Slot(usize),
    Vorher(usize),
    Fest(f32),
}

pub enum Schritt {
    Note { hz: usize, gate: usize, vel: usize, trig: usize, erste: usize },
    Konst { aus: usize, wert: f32 },
    /// `nr` 0-basiert; Wert min..max linear oder (log) exponentiell über den Reglerweg 0..1
    Regler { aus: usize, nr: usize, min: f32, max: f32, log: bool },
    /// `hart`: the band-limited hard sync input, `Some` only with an edge (then `sync` has none); `hart_aus` its output slot
    Saege { hz: Quelle, sync: Quelle, aus: usize, zyklus: usize, osz: [Osz; MAX_STIMMEN], hart: Option<Quelle>, hart_aus: usize },
    Puls { hz: Quelle, pwm: Quelle, sync: Quelle, aus: usize, zyklus: usize, osz: [Osz; MAX_STIMMEN], hart: Option<Quelle>, hart_aus: usize },
    Dreieck { hz: Quelle, sync: Quelle, aus: usize, zyklus: usize, osz: [Osz; MAX_STIMMEN], hart: Option<Quelle>, hart_aus: usize },
    Sinus { hz: Quelle, fm: Quelle, sync: Quelle, aus: usize, zyklus: usize, osz: [Sinus; MAX_STIMMEN], hart_aus: usize },
    Rauschen { aus: usize, r: [Rauschen; MAX_STIMMEN] },
    /// `versatz` (beats) and `einmal` (ramp once, then hold) apply to the beat-synced mode (`takt` > 0) only (S21)
    Lfo { rate: Quelle, trig: Quelle, aus: usize, form: u8, neustart: bool, takt: f32, versatz: f64, einmal: bool, l: [Lfo; MAX_STIMMEN] },
    Transponiere { hz: Quelle, st: Quelle, cent: Quelle, aus: usize },
    Ladder { x: Quelle, cutoff: Quelle, reso: Quelle, aus: usize, f: [Ladder; MAX_STIMMEN], reso_glatt: Spur },
    Svf { x: Quelle, cutoff: Quelle, reso: Quelle, tp: usize, bp: usize, hp: usize, vier: bool, f: [Svf; MAX_STIMMEN] },
    /// tanh mit ADAA1 (saett_dsp::Adaa1, f64), `antrieb` in dB vor der Kennlinie
    Saett { x: Quelle, antrieb: Quelle, aus: usize, a: [Adaa1; MAX_STIMMEN] },
    Glatt { x: Quelle, setzen: Quelle, aus: usize, zeit: f32, z: Spur },
    /// je Stimme eine Leitung (Slice 4f); `x` kommt immer verzögert (Vorher), die Leitung verzögert um den Rest d − 1
    Leitung { x: Quelle, zeit: Quelle, hz: Quelle, aus: usize, l: Vec<Leitung> },
    /// Zeiten a, d, s, r als Eingänge; ohne Kante gelten die festen Werte des Knotens
    Adsr { gate: Quelle, trig: Quelle, zeiten: [Quelle; 4], aus: usize, e: [Adsr; MAX_STIMMEN] },
    Mul { a: Quelle, b: Quelle, aus: usize },
    Add { a: Quelle, b: Quelle, c: Quelle, d: Quelle, aus: usize },
    /// Summenpunkt (Slice 2b, D1): rechnet auf der Summe aller Stimmen, Ergebnis in Stimme 0, die übrigen Stimmen 0
    Chorus { x: Quelle, mix: Quelle, l: usize, r: usize, c: Chorus },
    /// Summenpunkt (Slice 4a): Cypher Hall auf Σ(x + l) links und Σ(x + r) rechts, Ergebnis in Stimme 0. Nur `mix` ändert
    /// sich im Lauf (D4); `setze` läuft nur bei geändertem Wert.
    Hall { x: Quelle, l: Quelle, r: Quelle, mix: Quelle, wl: usize, wr: usize, mix_alt: f32, mix_start: f32, h: Box<hall_dsp::Hall> },
    /// Summenpunkt (Slice 4b): Echo auf Σ(x + l) links und Σ(x + r) rechts, Ergebnis in Stimme 0. Zeit, fb und mix aus Stimme 0.
    Delay { x: Quelle, l: Quelle, r: Quelle, zeit: Quelle, fb: Quelle, mix: Quelle, takt: f32, wl: usize, wr: usize, d: Echo },
    /// Summenpunkt (Slice 4c): Limiter auf Σ(x + l) links und Σ(x + r) rechts, Ergebnis in Stimme 0, Latenz N − 1
    Limiter { x: Quelle, l: Quelle, r: Quelle, wl: usize, wr: usize, b: Limiter },
    /// Summenpunkt (Slice 4c): Gate auf Σ(x + l) links und Σ(x + r) rechts, Ergebnis in Stimme 0
    Gate { x: Quelle, l: Quelle, r: Quelle, kl: Quelle, kr: Quelle, key: bool, wl: usize, wr: usize, g: Gate },
    /// Summenpunkt (Slice 4c): komp_dsp::Komp je Sample auf Σ(x + l) links und Σ(x + r) rechts, Ergebnis in Stimme 0
    Komp { x: Quelle, l: Quelle, r: Quelle, kl: Quelle, kr: Quelle, key: bool, wl: usize, wr: usize, k: komp_dsp::Komp },
    /// Per voice (S7): bit-depth and sample-rate reduction; a non-finite `bits` or `rate` reads the node's own value (`bits0`, `rate0`)
    Krume { x: Quelle, bits: Quelle, rate: Quelle, aus: usize, bits0: f32, rate0: f32, k: [Krume; MAX_STIMMEN] },
    /// Sum point (S7): phaser on Σ(x + l) left and Σ(x + r) right, result in voice 0. `rate`, `tiefe`, `fb`, `mix` are read
    /// from voice 0; a non-finite value reads the node's own value (`voreinstellung`, same order).
    Phaser { x: Quelle, l: Quelle, r: Quelle, rate: Quelle, tiefe: Quelle, fb: Quelle, mix: Quelle, wl: usize, wr: usize, voreinstellung: [f32; 4], p: Phaser },
    /// Per voice (S8): triode stage, one or two in series (`zwei`; the second at 0 dB drive and the same bias). A non-finite
    /// `antrieb` or `bias` reads the node's own value (`antrieb0`, `bias0`). `satz` holds one table (bias not modulated) or eleven.
    Roehre { x: Quelle, antrieb: Quelle, bias: Quelle, aus: usize, antrieb0: f32, bias0: f32, zwei: bool, satz: Box<RoehrenSatz>, r1: [Roehre; MAX_STIMMEN], r2: [Roehre; MAX_STIMMEN] },
    /// Sum point (S11): vocoder with the carrier Σx and the modulator mean of Σl and Σr (each summed over the voices separately,
    /// C7), result in voice 0 on both sides. `zisch` and `mix` are read from voice 0; a non-finite value reads the node's own
    /// value (`voreinstellung`, same order).
    /// per voice; `d` is the node's sample data, shared read-only by all voices (S10, D5)
    Sampler { hz: Quelle, trig: Quelle, gate: Quelle, scheibe: Quelle, rueck: Quelle, wl: usize, wr: usize, e: Einstellung, d: Box<[f32]>, s: [Sampler; MAX_STIMMEN] },
    Vocoder { x: Quelle, l: Quelle, r: Quelle, zisch: Quelle, mix: Quelle, wl: usize, wr: usize, voreinstellung: [f32; 2], v: Vocoder },
    /// Sum point (S21): convolution on Σ(x + l) left and Σ(x + r) right, result in voice 0; mix from voice 0
    Faltung { x: Quelle, l: Quelle, r: Quelle, mix: Quelle, wl: usize, wr: usize, f: Box<Faltung> },
    /// Per voice: wavetable oscillator with up to 7 unison copies (wavetable.rs). `t` is the node's table, shared read-only by
    /// all voices; the voices are boxed so the step enum does not grow by their size. `aus` is the sum without pan.
    Wavetable { hz: Quelle, trig: Quelle, pos: Quelle, verstimmung: Quelle, breite: Quelle, wl: usize, wr: usize, aus: usize, e: WtEinstellung, t: Box<Tabelle>, w: Box<[WtStimme; MAX_STIMMEN]> },
    /// Per voice: modal resonator bank, up to 32 modes (resonator.rs). `satz` is the node's mode set, shared read-only by
    /// all voices; the voices are boxed so the step enum does not grow by their size. `ein` in the order of `RsEingabe`.
    Resonator { ein: [Quelle; 9], aus: usize, e: RsEinstellung, satz: Box<Satz>, v: Box<[RsStimme; MAX_STIMMEN]> },
    /// Per voice (type 33): metallic oscillator bank for hats and cymbals (metall.rs). Inputs in the order of `metall::EIN`;
    /// the voices are boxed so the step enum does not grow by their size.
    Metall { ein: [Quelle; 8], aus: usize, huelle: usize, e: MtEinstellung, m: Box<[MtStimme; MAX_STIMMEN]> },
    /// Per voice: six-operator FM (fm.rs); the voices are boxed so the step enum does not grow by their size
    Fm { hz: Quelle, gate: Quelle, trig: Quelle, vel: Quelle, index: Quelle, rueck: Quelle, zeit: Quelle, aus: usize, e: crate::fm::Einstellung, v: Box<[crate::fm::Stimme; MAX_STIMMEN]> },
    /// Per voice: granular engine with a fixed grain pool (granular.rs, type 36). `x` is recorded once per sample as the sum over
    /// the voices into the node's ring buffer (`m`, shared read-only by the voices); `frieren` is read from voice 0 for it.
    Granular { hz: Quelle, trig: Quelle, gate: Quelle, x: Quelle, groesse: Quelle, dichte: Quelle, pos: Quelle, pos_zufall: Quelle, tonhoehe: Quelle,
               ton_zufall: Quelle, breite: Quelle, fenster: Quelle, frieren: Quelle, wl: usize, wr: usize, e: GrEinstellung, m: Box<GrMaterial>,
               g: Box<[GrStimme; MAX_STIMMEN]> },
    /// Per voice: physical string model (saite.rs). Each voice owns its delay lines (allocated at translation); the voices
    /// are boxed so the step enum does not grow by their size.
    Saite { x: Quelle, hz: Quelle, trig: Quelle, vel: Quelle, ausklang: Quelle, daempfung: Quelle, hell: Quelle, lage: Quelle, koerper_mix: Quelle, aus: usize, e: SaEinstellung, s: Box<[SaStimme; MAX_STIMMEN]> },
    /// Host-Audio (S3c): nur Stimme 0, wie die Summenpunkte; der Ausgang summiert über alle Stimmen
    Eingang { wl: usize, wr: usize },
    /// links = x + l, rechts = x + r, je über alle Stimmen summiert
    Ausgang { x: Quelle, l: Quelle, r: Quelle },
}

pub struct Programm {
    pub name: String,
    pub stimmen: usize,
    sr: f32,
    /// Glättungsfaktor der Resonanz (einpolig, 5 ms; Spec E10)
    k_reso: f32,
    schritte: Vec<Schritt>,
    slots: Vec<Spur>,
    vorher: Vec<Spur>,
    /// Slots, die eine Kante mit Verzögerung liest: nur diese werden am Ende des Samples nach `vorher` kopiert
    verzoegert: Vec<usize>,
    note: [u8; MAX_STIMMEN],
    hz: Spur,
    gate: Spur,
    vel: Spur,
    trig: Spur,
    /// 1 im Sample der ersten Note einer Stimme seit Laden oder `zuruecksetzen` (für `glatt.setzen`: kein Glide aus 0 Hz)
    erste: Spur,
    gespielt: [bool; MAX_STIMMEN],
    /// in diesem Sample neu angeschlagen, während dieselbe Note schon hielt: ein Note-off desselben Samples gilt der alten
    /// Note und bleibt ohne Wirkung (Host schickt beim Akkordwechsel Note-on vor Note-off; Slice 2b, D5)
    wieder: [bool; MAX_STIMMEN],
    alter: [u64; MAX_STIMMEN],
    uhr: u64,
    /// Wie oft der Wächter ein nicht endliches Sample abgefangen und alle Zustände zurückgesetzt hat
    pub rettungen: u32,
    /// Latenz zum Ausgang in Samples (D4)
    latenz: usize,
    /// Host-Audio dieses Samples (S3c), geklemmt; gesetzt mit `setze_eingang`
    ein: (f32, f32),
    /// Der Graph hat einen Knoten `eingang` (Effekt-Graph)
    eingang: bool,
    /// Beat des aktuellen Samples und Beats je Sample (S3c, D7); Vorgabe 128 BPM ab Beat 0
    beat: f64,
    bps: f64,
    /// Reglerwege 0..1, gesetzt vom Plugin (`setze_regler`)
    regler: [f32; REGLER],
    /// (nr 1..8, Name) aus `regler_namen`, nur zur Anzeige
    pub regler_namen: Vec<(usize, String)>,
}

#[inline]
fn spur(q: Quelle, slots: &[Spur], vorher: &[Spur]) -> Spur {
    match q {
        Quelle::Slot(s) => slots[s],
        Quelle::Vorher(s) => vorher[s],
        Quelle::Fest(w) => [w; MAX_STIMMEN],
    }
}

/// Summenpunkt-Eingang: Σ(x + l) und Σ(x + r) über n Stimmen
#[inline]
fn summe_lr(x: &Spur, l: &Spur, r: &Spur, n: usize) -> (f32, f32) {
    let (mut a, mut b) = (0.0f32, 0.0f32);
    for v in 0..n {
        a += x[v] + l[v];
        b += x[v] + r[v];
    }
    (a, b)
}

/// Key level per side: Σ kl and Σ kr over n voices (S9, D3); the detector reads it, the audio never does
#[inline]
fn key_lr(kl: &Spur, kr: &Spur, n: usize) -> (f32, f32) {
    let (mut a, mut b) = (0.0f32, 0.0f32);
    for v in 0..n {
        a += kl[v];
        b += kr[v];
    }
    (a, b)
}

/// Summenpunkt-Ausgang: Ergebnis in Stimme 0, die übrigen Stimmen 0
#[inline]
fn in_stimme0(slots: &mut [Spur], wl: usize, wr: usize, (a, b): (f32, f32)) {
    let (mut ol, mut or) = ([0.0; MAX_STIMMEN], [0.0; MAX_STIMMEN]);
    ol[0] = a;
    or[0] = b;
    slots[wl] = ol;
    slots[wr] = or;
}

fn hz(note: u8) -> f32 { 440.0 * 2f32.powf((note as f32 - 69.0) / 12.0) }

impl Programm {
    /// Nur für `uebersetzen`: Schritte und Slot-Zahl kommen fertig geprüft.
    pub(crate) fn neu(name: String, stimmen: usize, sr: f32, schritte: Vec<Schritt>, n_slots: usize, verzoegert: Vec<usize>,
                      regler_namen: Vec<(usize, String)>, latenz: usize) -> Self {
        let eingang = schritte.iter().any(|s| matches!(s, Schritt::Eingang { .. }));
        Self {
            name,
            stimmen,
            sr,
            k_reso: 1.0 - (-1.0 / (0.005 * sr)).exp(),
            schritte,
            slots: vec![[0.0; MAX_STIMMEN]; n_slots],
            vorher: vec![[0.0; MAX_STIMMEN]; n_slots],
            verzoegert,
            note: [0; MAX_STIMMEN],
            hz: [0.0; MAX_STIMMEN],
            gate: [0.0; MAX_STIMMEN],
            vel: [0.0; MAX_STIMMEN],
            trig: [0.0; MAX_STIMMEN],
            erste: [0.0; MAX_STIMMEN],
            gespielt: [false; MAX_STIMMEN],
            wieder: [false; MAX_STIMMEN],
            alter: [0; MAX_STIMMEN],
            uhr: 0,
            rettungen: 0,
            latenz,
            ein: (0.0, 0.0),
            eingang,
            beat: 0.0,
            bps: 128.0 / 60.0 / sr as f64,
            regler: [0.5; REGLER],
            regler_namen,
        }
    }

    /// Reglerweg `wert` (0..1) für Regler `nr` (1..8); andere Nummern werden ignoriert. Allokiert nicht.
    pub fn setze_regler(&mut self, nr: usize, wert: f32) {
        if (1..=REGLER).contains(&nr) {
            self.regler[nr - 1] = wert.clamp(0.0, 1.0);
        }
    }

    /// Host-Audio für das nächste `sample_stereo` (S3c). Nicht endlich wird 0, sonst geklemmt auf ±8 (Muster Kern bk).
    #[inline]
    pub fn setze_eingang(&mut self, l: f32, r: f32) {
        let k = |x: f32| if x.is_finite() { x.clamp(-8.0, 8.0) } else { 0.0 };
        self.ein = (k(l), k(r));
    }

    /// Takt für die folgenden Samples (S3c): beat0 = Beat des nächsten Samples, bps = Beats je Sample (> 0). Ungültige
    /// Werte lassen den Takt, wie er ist.
    pub fn setze_takt(&mut self, beat0: f64, bps: f64) {
        if beat0.is_finite() && bps.is_finite() && bps > 0.0 {
            self.beat = beat0;
            self.bps = bps;
        }
    }

    /// Hat der Graph einen Knoten `eingang` (Effekt statt Instrument)?
    pub fn hat_eingang(&self) -> bool { self.eingang }

    /// Latenz in Samples bis zum Ausgang: die größte über alle Wege ohne verzögerte Kante (Limiter N − 1, Slice 4c, D4);
    /// ein Limiter hinter einer Rückkopplung oder `verzoegerung` zählt nicht mit
    pub fn latenz(&self) -> usize {
        self.latenz
    }

    pub fn abtastrate(&self) -> f32 { self.sr }

    /// Diagnose: Note und Gate der Stimme `v` (für Tests und Lage, nicht für den Klang).
    pub fn stimme(&self, v: usize) -> (u8, bool) { (self.note[v], self.gate[v] > 0.5) }

    /// Anschlag. Wahl der Stimme: dieselbe Note, die noch klingt (neu anschlagen); sonst die freie Stimme, die am
    /// längsten aus ist; sonst die am längsten gehaltene (Stimmenklau, Spec E8; die ADSR startet beim Ist-Wert).
    pub fn note_an(&mut self, note: u8, vel: f32) {
        let n = self.stimmen;
        self.uhr += 1;
        // dieselbe Note zuerst auf ihrer eigenen Stimme, auch im Release: sonst klingt der Ton doppelt und löscht sich
        // beim Akkordwechsel kurz selbst aus (Andreas 2026-10-28 „bei 4s stockt was“). Die Hüllkurve setzt beim Ist-Wert an.
        let haelt = (0..n).find(|&v| self.gate[v] > 0.5 && self.note[v] == note);
        let v = haelt
            .or_else(|| (0..n).filter(|&v| self.gespielt[v] && self.note[v] == note).max_by_key(|&v| self.alter[v]))
            .or_else(|| (0..n).filter(|&v| self.gate[v] <= 0.5).min_by_key(|&v| self.alter[v]))
            .unwrap_or_else(|| (0..n).min_by_key(|&v| self.alter[v]).unwrap_or(0));
        // Merker nur, wenn die gewählte Stimme die gehaltene gleiche Note ist; jede andere gewählte Stimme (Klau, freie
        // Stimme) löscht einen alten Merker, sonst hinge ihr Ton am Note-off desselben Samples fest
        self.wieder[v] = haelt.is_some();
        self.note[v] = note;
        self.hz[v] = hz(note);
        self.gate[v] = 1.0;
        self.vel[v] = vel;
        self.trig[v] = 1.0;
        if !self.gespielt[v] {
            self.gespielt[v] = true;
            self.erste[v] = 1.0;
        }
        self.alter[v] = self.uhr;
    }

    pub fn note_aus(&mut self, note: u8) {
        for v in 0..self.stimmen {
            if self.gate[v] > 0.5 && self.note[v] == note && !self.wieder[v] {
                self.uhr += 1;
                self.gate[v] = 0.0;
                self.alter[v] = self.uhr;
            }
        }
    }

    pub fn alle_aus(&mut self) {
        self.wieder = [false; MAX_STIMMEN];
        for v in 0..self.stimmen {
            if self.gate[v] > 0.5 {
                self.uhr += 1;
                self.gate[v] = 0.0;
                self.alter[v] = self.uhr;
            }
        }
    }

    /// Alle Zustände wie nach dem Laden (Plugin-reset, Wächter): Stimmen, Oszillatoren, Filter, Hüllkurven, Slots. Nur
    /// die Reglerwege bleiben, sie gehören dem Plugin.
    pub fn zuruecksetzen(&mut self) {
        for s in self.slots.iter_mut().chain(self.vorher.iter_mut()) {
            *s = [0.0; MAX_STIMMEN];
        }
        self.note = [0; MAX_STIMMEN];
        self.hz = [0.0; MAX_STIMMEN];
        self.gate = [0.0; MAX_STIMMEN];
        self.vel = [0.0; MAX_STIMMEN];
        self.trig = [0.0; MAX_STIMMEN];
        self.erste = [0.0; MAX_STIMMEN];
        self.gespielt = [false; MAX_STIMMEN];
        self.wieder = [false; MAX_STIMMEN];
        self.alter = [0; MAX_STIMMEN];
        self.uhr = 0;
        for s in self.schritte.iter_mut() {
            // ohne Platzhalterarm: eine neue Art mit Zustand muss hier stehen, sonst kompiliert es nicht (Slice 4a, D7)
            match s {
                Schritt::Saege { osz, .. } | Schritt::Puls { osz, .. } | Schritt::Dreieck { osz, .. } => *osz = [Osz::default(); MAX_STIMMEN],
                Schritt::Sinus { osz, .. } => *osz = [Sinus::default(); MAX_STIMMEN],
                Schritt::Rauschen { r, .. } => *r = std::array::from_fn(Rauschen::neu),
                Schritt::Lfo { l, .. } => *l = std::array::from_fn(Lfo::neu),
                Schritt::Svf { f, .. } => *f = [Svf::default(); MAX_STIMMEN],
                Schritt::Saett { a, .. } => *a = [Adaa1::default(); MAX_STIMMEN],
                Schritt::Glatt { z, .. } => *z = [0.0; MAX_STIMMEN],
                Schritt::Leitung { l, .. } => l.iter_mut().for_each(|v| v.zuruecksetzen()),
                Schritt::Ladder { f, reso_glatt, .. } => {
                    *f = [Ladder::default(); MAX_STIMMEN];
                    *reso_glatt = [0.0; MAX_STIMMEN];
                }
                Schritt::Adsr { e, .. } => *e = [Adsr::default(); MAX_STIMMEN],
                Schritt::Chorus { c, .. } => c.zuruecksetzen(),
                Schritt::Hall { h, mix_alt, mix_start, .. } => {
                    // the mix input moves the hall's setting while playing: back to the translated value, as after the load
                    // (S20 review: otherwise the smoother of a played instance starts at the last modulated mix, a fresh one at the static one)
                    *mix_alt = *mix_start;
                    h.setze(hall_dsp::HallEinstellung { mix: *mix_start as f64, ..h.einstellung() });
                    h.reset();
                }
                Schritt::Delay { d, .. } => d.zuruecksetzen(),
                Schritt::Limiter { b, .. } => b.zuruecksetzen(),
                Schritt::Gate { g, .. } => g.zuruecksetzen(),
                Schritt::Komp { k, .. } => k.leeren(),
                Schritt::Krume { k, .. } => *k = [Krume::default(); MAX_STIMMEN],
                Schritt::Phaser { p, .. } => p.zuruecksetzen(),
                Schritt::Vocoder { v, .. } => v.zuruecksetzen(),
                Schritt::Faltung { f, .. } => f.zuruecksetzen(),
                Schritt::Sampler { s, .. } => *s = [Sampler::default(); MAX_STIMMEN],
                Schritt::Wavetable { w, e, .. } => **w = std::array::from_fn(|i| WtStimme::neu(i, e)),
                Schritt::Resonator { v, e, .. } => **v = std::array::from_fn(|i| RsStimme::neu(i, e)),
                Schritt::Metall { m, e, .. } => **m = std::array::from_fn(|i| MtStimme::neu(i, e)),
                Schritt::Fm { v, .. } => **v = [crate::fm::Stimme::neu(); MAX_STIMMEN],
                Schritt::Granular { m, g, e, .. } => {
                    m.zuruecksetzen();
                    **g = std::array::from_fn(|i| GrStimme::neu(i, e));
                }
                Schritt::Saite { s, e, .. } => s.iter_mut().enumerate().for_each(|(i, v)| v.zuruecksetzen(i, e)),
                Schritt::Roehre { r1, r2, .. } => {
                    *r1 = [Roehre::default(); MAX_STIMMEN];
                    *r2 = [Roehre::default(); MAX_STIMMEN];
                }
                Schritt::Note { .. }
                | Schritt::Konst { .. }
                | Schritt::Regler { .. }
                | Schritt::Transponiere { .. }
                | Schritt::Mul { .. }
                | Schritt::Add { .. }
                | Schritt::Eingang { .. }
                | Schritt::Ausgang { .. } => {}
            }
        }
        self.ein = (0.0, 0.0);
    }

    /// Ein Sample als Mittel beider Seiten aus `sample_stereo` (dort stehen Summe und Wächter). Halbiert vor dem Addieren.
    #[inline]
    pub fn sample(&mut self) -> f32 {
        let (l, r) = self.sample_stereo();
        // halbiert vor dem Addieren: kann nicht überlaufen, bei l == r bitgleich mit l
        l * 0.5 + r * 0.5
    }

    /// Ein Sample (links, rechts): je Seite die Summe über alle Stimmen aller `ausgang`-Knoten. Wird eine Seite NaN oder
    /// unendlich (Rückkopplung läuft weg, NaN aus einem Baustein), setzt der Wächter alle Zustände zurück und liefert
    /// (0, 0), statt den Rest des Abends NaN zu spielen (Muster Kern F01). Ein Graph ohne `l`/`r` am Ausgang gibt auf
    /// beiden Seiten dasselbe, `sample` ist dann bitgleich mit Slice 2.
    #[inline]
    pub fn sample_stereo(&mut self) -> (f32, f32) {
        let n = self.stimmen;
        let sr = self.sr;
        let k_reso = self.k_reso;
        let (beat, bps) = (self.beat, self.bps);
        let Programm { schritte, slots, vorher, hz, gate, vel, trig, erste, regler, ein, .. } = self;
        let (mut links, mut rechts) = (0.0f32, 0.0f32);
        for s in schritte.iter_mut() {
            match s {
                Schritt::Note { hz: h, gate: g, vel: v, trig: t, erste: e } => {
                    slots[*h] = *hz;
                    slots[*g] = *gate;
                    slots[*v] = *vel;
                    slots[*t] = *trig;
                    slots[*e] = *erste;
                }
                Schritt::Konst { aus, wert } => slots[*aus] = [*wert; MAX_STIMMEN],
                Schritt::Regler { aus, nr, min, max, log } => {
                    let k = regler[*nr];
                    let w = if *log { *min * (*max / *min).powf(k) } else { *min + (*max - *min) * k };
                    slots[*aus] = [w; MAX_STIMMEN];
                }
                Schritt::Saege { hz: q, sync, aus, zyklus, osz, hart, hart_aus } => {
                    let (f, sy) = (spur(*q, slots, vorher), spur(*sync, slots, vorher));
                    let (mut o, mut z, mut v) = ([0.0; MAX_STIMMEN], [0.0; MAX_STIMMEN], [0.0; MAX_STIMMEN]);
                    match hart {
                        None => for i in 0..n {
                            (o[i], z[i]) = osz[i].saege((f[i] / sr).clamp(0.0, 0.5), sy[i]);
                            v[i] = osz[i].hart();
                        },
                        Some(h) => {
                            let h = spur(*h, slots, vorher);
                            for i in 0..n {
                                (o[i], z[i]) = osz[i].saege_hart((f[i] / sr).clamp(0.0, 0.5), h[i]);
                                v[i] = osz[i].hart();
                            }
                        }
                    }
                    slots[*aus] = o;
                    slots[*zyklus] = z;
                    slots[*hart_aus] = v;
                }
                Schritt::Puls { hz: q, pwm, sync, aus, zyklus, osz, hart, hart_aus } => {
                    let (f, w, sy) = (spur(*q, slots, vorher), spur(*pwm, slots, vorher), spur(*sync, slots, vorher));
                    let (mut o, mut z, mut v) = ([0.0; MAX_STIMMEN], [0.0; MAX_STIMMEN], [0.0; MAX_STIMMEN]);
                    match hart {
                        None => for i in 0..n {
                            (o[i], z[i]) = osz[i].puls((f[i] / sr).clamp(0.0, 0.5), 0.5 + 0.45 * w[i].clamp(-1.0, 1.0), sy[i]);
                            v[i] = osz[i].hart();
                        },
                        Some(h) => {
                            let h = spur(*h, slots, vorher);
                            for i in 0..n {
                                (o[i], z[i]) = osz[i].puls_hart((f[i] / sr).clamp(0.0, 0.5), 0.5 + 0.45 * w[i].clamp(-1.0, 1.0), h[i]);
                                v[i] = osz[i].hart();
                            }
                        }
                    }
                    slots[*aus] = o;
                    slots[*zyklus] = z;
                    slots[*hart_aus] = v;
                }
                Schritt::Dreieck { hz: q, sync, aus, zyklus, osz, hart, hart_aus } => {
                    let (f, sy) = (spur(*q, slots, vorher), spur(*sync, slots, vorher));
                    let (mut o, mut z, mut v) = ([0.0; MAX_STIMMEN], [0.0; MAX_STIMMEN], [0.0; MAX_STIMMEN]);
                    match hart {
                        None => for i in 0..n {
                            (o[i], z[i]) = osz[i].dreieck((f[i] / sr).clamp(0.0, 0.5), sy[i]);
                            v[i] = osz[i].hart();
                        },
                        Some(h) => {
                            let h = spur(*h, slots, vorher);
                            for i in 0..n {
                                (o[i], z[i]) = osz[i].dreieck_hart((f[i] / sr).clamp(0.0, 0.5), h[i]);
                                v[i] = osz[i].hart();
                            }
                        }
                    }
                    slots[*aus] = o;
                    slots[*zyklus] = z;
                    slots[*hart_aus] = v;
                }
                Schritt::Sinus { hz: q, fm, sync, aus, zyklus, osz, hart_aus } => {
                    let (f, m, sy) = (spur(*q, slots, vorher), spur(*fm, slots, vorher), spur(*sync, slots, vorher));
                    let (mut o, mut z, mut v) = ([0.0; MAX_STIMMEN], [0.0; MAX_STIMMEN], [0.0; MAX_STIMMEN]);
                    for i in 0..n {
                        (o[i], z[i]) = osz[i].sample(((f[i] + m[i]) / sr).clamp(-0.5, 0.5), sy[i]);
                        v[i] = osz[i].hart();
                    }
                    slots[*aus] = o;
                    slots[*zyklus] = z;
                    slots[*hart_aus] = v;
                }
                Schritt::Rauschen { aus, r } => {
                    let mut o = [0.0; MAX_STIMMEN];
                    for i in 0..n {
                        o[i] = r[i].sample();
                    }
                    slots[*aus] = o;
                }
                Schritt::Lfo { rate, trig: t, aus, form, neustart, takt, versatz, einmal, l } => {
                    let (r, t) = (spur(*rate, slots, vorher), spur(*t, slots, vorher));
                    let mut o = [0.0; MAX_STIMMEN];
                    if *takt > 0.0 {
                        // D8: Phase aus dem Host-Beat, alle Stimmen gleich; rate und neustart wirken nicht.
                        // S21: the phase origin sits at beat `versatz`; with `einmal` the phase is clamped to 0..1, so the
                        // wave holds its start value before the origin and its end value after one period. With the
                        // defaults (versatz 0, einmal off) this is the old arithmetic: beat - 0.0 == beat.
                        let rel = (beat - *versatz) / *takt as f64;
                        let ph = if *einmal { rel.clamp(0.0, 1.0) } else { rel.rem_euclid(1.0) } as f32;
                        for i in 0..n {
                            o[i] = l[i].bei_phase(ph, *form);
                        }
                    } else {
                        for i in 0..n {
                            o[i] = l[i].sample(r[i], *form, *neustart && t[i] > 0.5, sr);
                        }
                    }
                    slots[*aus] = o;
                }
                Schritt::Transponiere { hz: q, st, cent, aus } => {
                    let (f, s, c) = (spur(*q, slots, vorher), spur(*st, slots, vorher), spur(*cent, slots, vorher));
                    let mut o = [0.0; MAX_STIMMEN];
                    for i in 0..n {
                        o[i] = f[i] * ((s[i] + c[i] * 0.01) / 12.0).exp2();
                    }
                    slots[*aus] = o;
                }
                Schritt::Svf { x, cutoff, reso, tp, bp, hp, vier, f } => {
                    let (x, c, r) = (spur(*x, slots, vorher), spur(*cutoff, slots, vorher), spur(*reso, slots, vorher));
                    let (mut t, mut b, mut h) = ([0.0; MAX_STIMMEN], [0.0; MAX_STIMMEN], [0.0; MAX_STIMMEN]);
                    for i in 0..n {
                        (t[i], b[i], h[i]) = f[i].prozess(x[i], c[i], r[i], *vier, sr);
                    }
                    slots[*tp] = t;
                    slots[*bp] = b;
                    slots[*hp] = h;
                }
                Schritt::Saett { x, antrieb, aus, a } => {
                    let (x, g) = (spur(*x, slots, vorher), spur(*antrieb, slots, vorher));
                    let mut o = [0.0; MAX_STIMMEN];
                    for i in 0..n {
                        let v = a[i].verarbeite(x[i] as f64 * 10f64.powf(g[i].clamp(-40.0, 40.0) as f64 / 20.0));
                        o[i] = v as f32;
                    }
                    slots[*aus] = o;
                }
                Schritt::Glatt { x, setzen, aus, zeit, z } => {
                    let (x, s) = (spur(*x, slots, vorher), spur(*setzen, slots, vorher));
                    let k = if *zeit > 0.0 { 1.0 - (-1.0 / (*zeit * sr)).exp() } else { 1.0 };
                    for i in 0..n {
                        if s[i] >= 0.5 { z[i] = x[i] } else { z[i] += (x[i] - z[i]) * k }
                    }
                    slots[*aus] = *z;
                }
                Schritt::Leitung { x, zeit, hz, aus, l } => {
                    let (x, z, h) = (spur(*x, slots, vorher), spur(*zeit, slots, vorher), spur(*hz, slots, vorher));
                    let mut o = [0.0; MAX_STIMMEN];
                    for i in 0..n {
                        // Gesamtverzögerung d (D2); die Kante hat schon ein Sample beigetragen (D3)
                        let d = if h[i] > 0.0 { sr as f64 / h[i] as f64 } else { z[i] as f64 * sr as f64 / 1000.0 };
                        o[i] = l[i].prozess(x[i], d.max(1.0) - 1.0);
                    }
                    slots[*aus] = o;
                }
                Schritt::Ladder { x, cutoff, reso, aus, f, reso_glatt } => {
                    let (x, c, r) = (spur(*x, slots, vorher), spur(*cutoff, slots, vorher), spur(*reso, slots, vorher));
                    let mut o = [0.0; MAX_STIMMEN];
                    for i in 0..n {
                        reso_glatt[i] += (r[i].clamp(0.0, 1.0) - reso_glatt[i]) * k_reso;
                        o[i] = f[i].prozess(x[i], c[i], reso_glatt[i], sr);
                    }
                    slots[*aus] = o;
                }
                Schritt::Adsr { gate: g, trig: t, zeiten, aus, e } => {
                    let (g, t) = (spur(*g, slots, vorher), spur(*t, slots, vorher));
                    let z = zeiten.map(|q| spur(q, slots, vorher));
                    let mut o = [0.0; MAX_STIMMEN];
                    for i in 0..n {
                        let zi = AdsrZeiten { a: z[0][i], d: z[1][i], s: z[2][i], r: z[3][i] };
                        o[i] = e[i].prozess(g[i] > 0.5, t[i] > 0.5, &zi, sr);
                    }
                    slots[*aus] = o;
                }
                Schritt::Mul { a, b, aus } => {
                    let (a, b) = (spur(*a, slots, vorher), spur(*b, slots, vorher));
                    let mut o = [0.0; MAX_STIMMEN];
                    for i in 0..n {
                        o[i] = a[i] * b[i];
                    }
                    slots[*aus] = o;
                }
                Schritt::Add { a, b, c, d, aus } => {
                    let (a, b, c, d) = (spur(*a, slots, vorher), spur(*b, slots, vorher), spur(*c, slots, vorher), spur(*d, slots, vorher));
                    let mut o = [0.0; MAX_STIMMEN];
                    for i in 0..n {
                        o[i] = a[i] + b[i] + c[i] + d[i];
                    }
                    slots[*aus] = o;
                }
                Schritt::Chorus { x, mix, l, r, c } => {
                    let (x, m) = (spur(*x, slots, vorher), spur(*mix, slots, vorher));
                    let summe: f32 = x.iter().take(n).sum();
                    let (a, b) = c.prozess(summe, m[0]);
                    let (mut ol, mut or) = ([0.0; MAX_STIMMEN], [0.0; MAX_STIMMEN]);
                    ol[0] = a;
                    or[0] = b;
                    slots[*l] = ol;
                    slots[*r] = or;
                }
                Schritt::Hall { x, l, r, mix, wl, wr, mix_alt, mix_start: _, h } => {
                    let (x, l, r, m) = (spur(*x, slots, vorher), spur(*l, slots, vorher), spur(*r, slots, vorher), spur(*mix, slots, vorher)[0]);
                    let (mut sl, mut sr_) = ([0.0f32], [0.0f32]);
                    for v in 0..n {
                        sl[0] += x[v] + l[v];
                        sr_[0] += x[v] + r[v];
                    }
                    if m != *mix_alt {
                        *mix_alt = m;
                        h.setze(hall_dsp::HallEinstellung { mix: m as f64, ..h.einstellung() });
                    }
                    h.verarbeite_stereo(&mut sl, &mut sr_);
                    let (mut ol, mut or) = ([0.0; MAX_STIMMEN], [0.0; MAX_STIMMEN]);
                    ol[0] = sl[0];
                    or[0] = sr_[0];
                    slots[*wl] = ol;
                    slots[*wr] = or;
                }
                Schritt::Delay { x, l, r, zeit, fb, mix, takt, wl, wr, d } => {
                    let (x, l, r) = (spur(*x, slots, vorher), spur(*l, slots, vorher), spur(*r, slots, vorher));
                    let z = if *takt > 0.0 {
                        (*takt as f64 / bps / sr as f64 * 1000.0) as f32 // D9: Notenwert in ms beim aktuellen Tempo
                    } else {
                        spur(*zeit, slots, vorher)[0]
                    };
                    let (f, m) = (spur(*fb, slots, vorher)[0], spur(*mix, slots, vorher)[0]);
                    let (mut sl, mut sr_) = (0.0f32, 0.0f32);
                    for v in 0..n {
                        sl += x[v] + l[v];
                        sr_ += x[v] + r[v];
                    }
                    let (a, b) = d.prozess(sl, sr_, z, f, m);
                    let (mut ol, mut or) = ([0.0; MAX_STIMMEN], [0.0; MAX_STIMMEN]);
                    ol[0] = a;
                    or[0] = b;
                    slots[*wl] = ol;
                    slots[*wr] = or;
                }
                Schritt::Limiter { x, l, r, wl, wr, b } => {
                    let s = summe_lr(&spur(*x, slots, vorher), &spur(*l, slots, vorher), &spur(*r, slots, vorher), n);
                    in_stimme0(slots, *wl, *wr, b.prozess(s.0, s.1));
                }
                Schritt::Gate { x, l, r, kl, kr, key, wl, wr, g } => {
                    let s = summe_lr(&spur(*x, slots, vorher), &spur(*l, slots, vorher), &spur(*r, slots, vorher), n);
                    let o = if *key {
                        let k = key_lr(&spur(*kl, slots, vorher), &spur(*kr, slots, vorher), n);
                        g.prozess_key(s.0, s.1, k.0, k.1)
                    } else {
                        g.prozess(s.0, s.1)
                    };
                    in_stimme0(slots, *wl, *wr, o);
                }
                Schritt::Komp { x, l, r, kl, kr, key, wl, wr, k } => {
                    let (a, b) = summe_lr(&spur(*x, slots, vorher), &spur(*l, slots, vorher), &spur(*r, slots, vorher), n);
                    let (mut a, mut b) = ([a], [b]);
                    if *key {
                        let (ka, kb) = key_lr(&spur(*kl, slots, vorher), &spur(*kr, slots, vorher), n);
                        k.block(&mut a, &mut b, Some((&[ka], &[kb])));
                    } else {
                        k.block(&mut a, &mut b, None);
                    }
                    in_stimme0(slots, *wl, *wr, (a[0], b[0]));
                }
                Schritt::Krume { x, bits, rate, aus, bits0, rate0, k } => {
                    let (x, b, r) = (spur(*x, slots, vorher), spur(*bits, slots, vorher), spur(*rate, slots, vorher));
                    let mut o = [0.0; MAX_STIMMEN];
                    for i in 0..n {
                        let bi = if b[i].is_finite() { b[i] } else { *bits0 };
                        let ri = if r[i].is_finite() { r[i] } else { *rate0 };
                        o[i] = k[i].prozess(x[i], bi, ri, sr);
                    }
                    slots[*aus] = o;
                }
                Schritt::Phaser { x, l, r, rate, tiefe, fb, mix, wl, wr, voreinstellung, p } => {
                    let s = summe_lr(&spur(*x, slots, vorher), &spur(*l, slots, vorher), &spur(*r, slots, vorher), n);
                    let m = |q: &Quelle, i: usize| {
                        let v = spur(*q, slots, vorher)[0];
                        if v.is_finite() { v } else { voreinstellung[i] }
                    };
                    let (ra, ti, f, mi) = (m(rate, 0), m(tiefe, 1), m(fb, 2), m(mix, 3));
                    in_stimme0(slots, *wl, *wr, p.prozess(s.0, s.1, ra, ti, f, mi));
                }
                Schritt::Sampler { hz, trig, gate, scheibe, rueck, wl, wr, e, d, s } => {
                    let (h, t, g) = (spur(*hz, slots, vorher), spur(*trig, slots, vorher), spur(*gate, slots, vorher));
                    let (sc, ru) = (spur(*scheibe, slots, vorher), spur(*rueck, slots, vorher));
                    let (mut ol, mut or) = ([0.0; MAX_STIMMEN], [0.0; MAX_STIMMEN]);
                    for i in 0..n {
                        (ol[i], or[i]) = s[i].prozess(d, e, sr, Eingabe { hz: h[i], trig: t[i], gate: g[i], scheibe: sc[i], rueck: ru[i] });
                    }
                    slots[*wl] = ol;
                    slots[*wr] = or;
                }
                Schritt::Vocoder { x, l, r, zisch, mix, wl, wr, voreinstellung, v } => {
                    let (xs, ls, rs) = (spur(*x, slots, vorher), spur(*l, slots, vorher), spur(*r, slots, vorher));
                    let (mut c, mut ml, mut mr) = (0.0f32, 0.0f32, 0.0f32);
                    for i in 0..n {
                        c += xs[i];
                        ml += ls[i];
                        mr += rs[i];
                    }
                    let m = |q: &Quelle, i: usize| {
                        let w = spur(*q, slots, vorher)[0];
                        if w.is_finite() { w } else { voreinstellung[i] }
                    };
                    let (z, mi) = (m(zisch, 0), m(mix, 1));
                    let y = v.prozess(c, ml, mr, z, mi);
                    in_stimme0(slots, *wl, *wr, (y, y));
                }
                Schritt::Faltung { x, l, r, mix, wl, wr, f } => {
                    let s = summe_lr(&spur(*x, slots, vorher), &spur(*l, slots, vorher), &spur(*r, slots, vorher), n);
                    let m = spur(*mix, slots, vorher)[0];
                    in_stimme0(slots, *wl, *wr, f.prozess(s.0, s.1, m));
                }
                Schritt::Roehre { x, antrieb, bias, aus, antrieb0, bias0, zwei, satz, r1, r2 } => {
                    let (x, a, b) = (spur(*x, slots, vorher), spur(*antrieb, slots, vorher), spur(*bias, slots, vorher));
                    let mut o = [0.0; MAX_STIMMEN];
                    for i in 0..n {
                        let ai = if a[i].is_finite() { a[i] } else { *antrieb0 };
                        let bi = (if b[i].is_finite() { b[i] } else { *bias0 }) as f64;
                        let mut y = r1[i].prozess_satz(satz, bi, x[i], ai, sr);
                        if *zwei {
                            y = r2[i].prozess_satz(satz, bi, y, 0.0, sr);
                        }
                        o[i] = y;
                    }
                    slots[*aus] = o;
                }
                Schritt::Wavetable { hz, trig, pos, verstimmung, breite, wl, wr, aus, e, t, w } => {
                    let (h, tr, p) = (spur(*hz, slots, vorher), spur(*trig, slots, vorher), spur(*pos, slots, vorher));
                    let (d, b) = (spur(*verstimmung, slots, vorher), spur(*breite, slots, vorher));
                    let (mut ol, mut or, mut om) = ([0.0; MAX_STIMMEN], [0.0; MAX_STIMMEN], [0.0; MAX_STIMMEN]);
                    for i in 0..n {
                        (ol[i], or[i], om[i]) = w[i].prozess(t, e, sr, WtEingabe { hz: h[i], trig: tr[i], pos: p[i], verstimmung: d[i], breite: b[i] });
                    }
                    slots[*wl] = ol;
                    slots[*wr] = or;
                    slots[*aus] = om;
                }
                Schritt::Resonator { ein: q, aus, e, satz, v } => {
                    let s: [Spur; 9] = std::array::from_fn(|j| spur(q[j], slots, vorher));
                    let mut o = [0.0; MAX_STIMMEN];
                    for i in 0..n {
                        let x = RsEingabe { hz: s[0][i], trig: s[1][i], staerke: s[2][i], x: s[3][i], material: s[4][i], helligkeit: s[5][i], groesse: s[6][i], position: s[7][i], inharmonie: s[8][i] };
                        o[i] = v[i].prozess(satz, e, sr, x);
                    }
                    slots[*aus] = o;
                }
                Schritt::Metall { ein: q, aus, huelle, e, m } => {
                    let x: [Spur; 8] = std::array::from_fn(|j| spur(q[j], slots, vorher));
                    (slots[*aus], slots[*huelle]) = crate::metall::prozess_stimmen(m, e, sr, n, &x);
                }
                Schritt::Fm { hz, gate, trig, vel, index, rueck, zeit, aus, e, v } => {
                    let (h, g, t) = (spur(*hz, slots, vorher), spur(*gate, slots, vorher), spur(*trig, slots, vorher));
                    let (ve, ix, rk, z) = (spur(*vel, slots, vorher), spur(*index, slots, vorher), spur(*rueck, slots, vorher), spur(*zeit, slots, vorher));
                    let mut o = [0.0; MAX_STIMMEN];
                    for i in 0..n {
                        o[i] = v[i].prozess(e, sr, crate::fm::Eingabe { hz: h[i], gate: g[i], trig: t[i], vel: ve[i], index: ix[i], rueck: rk[i], zeit: z[i] });
                    }
                    slots[*aus] = o;
                }
                Schritt::Granular { hz, trig, gate, x, groesse, dichte, pos, pos_zufall, tonhoehe, ton_zufall, breite, fenster, frieren, wl, wr, e, m, g } => {
                    let (xs, fr) = (spur(*x, slots, vorher), spur(*frieren, slots, vorher));
                    m.schreibe(xs.iter().take(n).sum(), fr[0] > 0.5);
                    let (h, tr, ga, gr) = (spur(*hz, slots, vorher), spur(*trig, slots, vorher), spur(*gate, slots, vorher), spur(*groesse, slots, vorher));
                    let (di, po, pz) = (spur(*dichte, slots, vorher), spur(*pos, slots, vorher), spur(*pos_zufall, slots, vorher));
                    let (th, tz, br, fe) = (spur(*tonhoehe, slots, vorher), spur(*ton_zufall, slots, vorher), spur(*breite, slots, vorher), spur(*fenster, slots, vorher));
                    let (mut ol, mut or) = ([0.0; MAX_STIMMEN], [0.0; MAX_STIMMEN]);
                    for i in 0..n {
                        let ein = GrEingabe { hz: h[i], trig: tr[i], gate: ga[i], groesse: gr[i], dichte: di[i], pos: po[i], pos_zufall: pz[i], tonhoehe: th[i],
                                              ton_zufall: tz[i], breite: br[i], fenster: fe[i], frieren: fr[i] };
                        (ol[i], or[i]) = g[i].prozess(m, e, sr, ein);
                    }
                    slots[*wl] = ol;
                    slots[*wr] = or;
                }
                Schritt::Saite { x, hz, trig, vel, ausklang, daempfung, hell, lage, koerper_mix, aus, e, s } => {
                    let (xi, h, tr, ve) = (spur(*x, slots, vorher), spur(*hz, slots, vorher), spur(*trig, slots, vorher), spur(*vel, slots, vorher));
                    let (au, da, he) = (spur(*ausklang, slots, vorher), spur(*daempfung, slots, vorher), spur(*hell, slots, vorher));
                    let (la, km) = (spur(*lage, slots, vorher), spur(*koerper_mix, slots, vorher));
                    let mut o = [0.0; MAX_STIMMEN];
                    for i in 0..n {
                        o[i] = s[i].prozess(e, sr, SaEingabe { x: xi[i], hz: h[i], trig: tr[i], vel: ve[i], ausklang: au[i], daempfung: da[i], hell: he[i], lage: la[i], koerper_mix: km[i] });
                    }
                    slots[*aus] = o;
                }
                Schritt::Eingang { wl, wr } => in_stimme0(slots, *wl, *wr, *ein),
                Schritt::Ausgang { x, l, r } => {
                    let (x, l, r) = (spur(*x, slots, vorher), spur(*l, slots, vorher), spur(*r, slots, vorher));
                    for v in 0..n {
                        links += x[v] + l[v];
                        rechts += x[v] + r[v];
                    }
                }
            }
        }
        self.beat += self.bps;
        *trig = [0.0; MAX_STIMMEN];
        *erste = [0.0; MAX_STIMMEN];
        self.wieder = [false; MAX_STIMMEN];
        for &s in self.verzoegert.iter() {
            self.vorher[s] = self.slots[s];
        }
        if !(links.is_finite() && rechts.is_finite()) {
            self.rettungen = self.rettungen.saturating_add(1);
            self.zuruecksetzen();
            return (0.0, 0.0);
        }
        (links, rechts)
    }
}
