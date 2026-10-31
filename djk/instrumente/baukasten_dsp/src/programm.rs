//! Das übersetzte Programm: Schritte in fester Reihenfolge, je Ausgangsport ein Slot mit einem Wert je Stimme.
//! Jeder Schritt rechnet alle Stimmen eines Knotens nacheinander (Stimmen liegen nebeneinander im Slot, Spec E7).
//! Kanten mit Verzögerung lesen `vorher`, den Stand des vorigen Samples (Spec E1).
use crate::adsr::{Adsr, AdsrZeiten};
use crate::chorus::Chorus;
use crate::echo::Echo;
use crate::gate::Gate;
use crate::leitung::Leitung;
use crate::lfo::Lfo;
use crate::limiter::Limiter;
use crate::osz::{Osz, Rauschen, Sinus};
use crate::svf::Svf;
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
    Saege { hz: Quelle, sync: Quelle, aus: usize, zyklus: usize, osz: [Osz; MAX_STIMMEN] },
    Puls { hz: Quelle, pwm: Quelle, sync: Quelle, aus: usize, zyklus: usize, osz: [Osz; MAX_STIMMEN] },
    Dreieck { hz: Quelle, sync: Quelle, aus: usize, zyklus: usize, osz: [Osz; MAX_STIMMEN] },
    Sinus { hz: Quelle, fm: Quelle, sync: Quelle, aus: usize, zyklus: usize, osz: [Sinus; MAX_STIMMEN] },
    Rauschen { aus: usize, r: [Rauschen; MAX_STIMMEN] },
    Lfo { rate: Quelle, trig: Quelle, aus: usize, form: u8, neustart: bool, takt: f32, l: [Lfo; MAX_STIMMEN] },
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
    Hall { x: Quelle, l: Quelle, r: Quelle, mix: Quelle, wl: usize, wr: usize, mix_alt: f32, h: Box<hall_dsp::Hall> },
    /// Summenpunkt (Slice 4b): Echo auf Σ(x + l) links und Σ(x + r) rechts, Ergebnis in Stimme 0. Zeit, fb und mix aus Stimme 0.
    Delay { x: Quelle, l: Quelle, r: Quelle, zeit: Quelle, fb: Quelle, mix: Quelle, takt: f32, wl: usize, wr: usize, d: Echo },
    /// Summenpunkt (Slice 4c): Limiter auf Σ(x + l) links und Σ(x + r) rechts, Ergebnis in Stimme 0, Latenz N − 1
    Limiter { x: Quelle, l: Quelle, r: Quelle, wl: usize, wr: usize, b: Limiter },
    /// Summenpunkt (Slice 4c): Gate auf Σ(x + l) links und Σ(x + r) rechts, Ergebnis in Stimme 0
    Gate { x: Quelle, l: Quelle, r: Quelle, wl: usize, wr: usize, g: Gate },
    /// Summenpunkt (Slice 4c): komp_dsp::Komp je Sample auf Σ(x + l) links und Σ(x + r) rechts, Ergebnis in Stimme 0
    Komp { x: Quelle, l: Quelle, r: Quelle, wl: usize, wr: usize, k: komp_dsp::Komp },
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
                Schritt::Hall { h, .. } => h.reset(),
                Schritt::Delay { d, .. } => d.zuruecksetzen(),
                Schritt::Limiter { b, .. } => b.zuruecksetzen(),
                Schritt::Gate { g, .. } => g.zuruecksetzen(),
                Schritt::Komp { k, .. } => k.leeren(),
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
                Schritt::Saege { hz: q, sync, aus, zyklus, osz } => {
                    let (f, sy) = (spur(*q, slots, vorher), spur(*sync, slots, vorher));
                    let (mut o, mut z) = ([0.0; MAX_STIMMEN], [0.0; MAX_STIMMEN]);
                    for i in 0..n {
                        (o[i], z[i]) = osz[i].saege((f[i] / sr).clamp(0.0, 0.5), sy[i]);
                    }
                    slots[*aus] = o;
                    slots[*zyklus] = z;
                }
                Schritt::Puls { hz: q, pwm, sync, aus, zyklus, osz } => {
                    let (f, w, sy) = (spur(*q, slots, vorher), spur(*pwm, slots, vorher), spur(*sync, slots, vorher));
                    let (mut o, mut z) = ([0.0; MAX_STIMMEN], [0.0; MAX_STIMMEN]);
                    for i in 0..n {
                        (o[i], z[i]) = osz[i].puls((f[i] / sr).clamp(0.0, 0.5), 0.5 + 0.45 * w[i].clamp(-1.0, 1.0), sy[i]);
                    }
                    slots[*aus] = o;
                    slots[*zyklus] = z;
                }
                Schritt::Dreieck { hz: q, sync, aus, zyklus, osz } => {
                    let (f, sy) = (spur(*q, slots, vorher), spur(*sync, slots, vorher));
                    let (mut o, mut z) = ([0.0; MAX_STIMMEN], [0.0; MAX_STIMMEN]);
                    for i in 0..n {
                        (o[i], z[i]) = osz[i].dreieck((f[i] / sr).clamp(0.0, 0.5), sy[i]);
                    }
                    slots[*aus] = o;
                    slots[*zyklus] = z;
                }
                Schritt::Sinus { hz: q, fm, sync, aus, zyklus, osz } => {
                    let (f, m, sy) = (spur(*q, slots, vorher), spur(*fm, slots, vorher), spur(*sync, slots, vorher));
                    let (mut o, mut z) = ([0.0; MAX_STIMMEN], [0.0; MAX_STIMMEN]);
                    for i in 0..n {
                        (o[i], z[i]) = osz[i].sample(((f[i] + m[i]) / sr).clamp(-0.5, 0.5), sy[i]);
                    }
                    slots[*aus] = o;
                    slots[*zyklus] = z;
                }
                Schritt::Rauschen { aus, r } => {
                    let mut o = [0.0; MAX_STIMMEN];
                    for i in 0..n {
                        o[i] = r[i].sample();
                    }
                    slots[*aus] = o;
                }
                Schritt::Lfo { rate, trig: t, aus, form, neustart, takt, l } => {
                    let (r, t) = (spur(*rate, slots, vorher), spur(*t, slots, vorher));
                    let mut o = [0.0; MAX_STIMMEN];
                    if *takt > 0.0 {
                        // D8: Phase aus dem Host-Beat, alle Stimmen gleich; rate und neustart wirken nicht
                        let ph = (beat / *takt as f64).rem_euclid(1.0) as f32;
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
                Schritt::Hall { x, l, r, mix, wl, wr, mix_alt, h } => {
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
                Schritt::Gate { x, l, r, wl, wr, g } => {
                    let s = summe_lr(&spur(*x, slots, vorher), &spur(*l, slots, vorher), &spur(*r, slots, vorher), n);
                    in_stimme0(slots, *wl, *wr, g.prozess(s.0, s.1));
                }
                Schritt::Komp { x, l, r, wl, wr, k } => {
                    let (a, b) = summe_lr(&spur(*x, slots, vorher), &spur(*l, slots, vorher), &spur(*r, slots, vorher), n);
                    let (mut a, mut b) = ([a], [b]);
                    k.block(&mut a, &mut b, None);
                    in_stimme0(slots, *wl, *wr, (a[0], b[0]));
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
