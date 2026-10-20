//! C-ABI um rb_dsp für den djk-Kern (D1 K2a, Spec 2.4): die RB-338 als interne Instrument-Spur des Arrangements. Kopf:
//! djk/kern/include/cypherdj/cypher_rb_ffi.h. In derselben Staticlib wie Hall und Komp (zwei Rust-Staticlibs kollidieren).
//!
//! `cypher_rb_neu` allokiert (außerhalb des Callbacks); alle anderen allokieren nicht. Noten kommen mit Sample-Versatz
//! relativ zum Anfang des nächsten `cypher_rb_block` in eine Warteschlange fester Größe; der Block spielt sie sample-genau
//! mit derselben Notenlogik wie das Plugin (rb_dsp::noten::plane: Mono, Slide, Akzent). Ein Versatz hinter dem Block
//! wandert in den Folgeblock. Parameter über die IDs aus rb338, normiert 0..1, Abbildung und Glättung wie das Plugin
//! (rb_dsp::parameter), wirksam ab dem Anfang des nächsten Blocks. Panics werden nicht über die Grenze getragen: ein Panic
//! im Block liefert Stille und setzt zurück (wie `cypher_rb_zuruecksetzen`), damit kein halb verbrauchter Zustand bleibt.
//!
//! Am selben Sample (Spec 2.4): All-Off vor Note-Ein, bei mehreren Note-Ein gewinnt die zuletzt gemeldete. Velocity
//! `vel/127` (über 127 geklemmt), Akzent ab vel 120. Bis zum ersten Note-Ein nach `neu`/`zuruecksetzen` ruht die Stimme
//! (kein Oszillator, kein Filter): so ist eine Note bei Versatz k bitgleich die um k verschobene Note bei Versatz 0 (A3).

use rb_dsp::noten::{plane, Aktion, Ereignis, Stapel};
use rb_dsp::parameter::Parameter;
use rb_dsp::Stimme;
use std::ffi::{c_char, CStr};
use std::panic::{catch_unwind, AssertUnwindSafe};

/// Ereignisse bis zum nächsten Block (wie MAX_EREIGNISSE im Plugin). Mehr meldet `-1` statt zu wachsen.
pub const RB_MAX_EREIGNISSE: usize = 256;

#[derive(Clone, Copy)]
enum Wartend {
    Note(Ereignis),
    AlleAus { t: u32 },
}

impl Wartend {
    fn t(&self) -> u32 {
        match *self {
            Wartend::Note(Ereignis::An { t, .. } | Ereignis::Aus { t, .. }) | Wartend::AlleAus { t } => t,
        }
    }
    fn verschiebe(&mut self, n: u32) {
        match self {
            Wartend::Note(Ereignis::An { t, .. } | Ereignis::Aus { t, .. }) | Wartend::AlleAus { t } => *t -= n,
        }
    }
}

pub struct CypherRb {
    sr: f32,
    stimme: Stimme,
    stapel: Stapel,
    parameter: Parameter,
    warte: [Wartend; RB_MAX_EREIGNISSE],
    n_warte: usize,
    gruppe: [Ereignis; RB_MAX_EREIGNISSE],
    aktionen: [Aktion; RB_MAX_EREIGNISSE],
    /// seit `neu`/`zuruecksetzen` noch kein Note-Ein: die Stimme ruht (sonst lädt der stehende Oszillator das Filter auf)
    ruht: bool,
}

impl CypherRb {
    fn neu(sr: f32) -> Self {
        Self {
            sr,
            stimme: Stimme::default(),
            stapel: Stapel::default(),
            parameter: Parameter::neu(sr),
            warte: [Wartend::AlleAus { t: 0 }; RB_MAX_EREIGNISSE],
            n_warte: 0,
            gruppe: [Ereignis::Aus { t: 0, note: 0 }; RB_MAX_EREIGNISSE],
            aktionen: [Aktion::Nichts; RB_MAX_EREIGNISSE],
            ruht: true,
        }
    }

    fn melde(&mut self, w: Wartend) -> i32 {
        if self.n_warte == RB_MAX_EREIGNISSE {
            return -1;
        }
        self.warte[self.n_warte] = w;
        self.n_warte += 1;
        0
    }

    /// Phase, Filter, Hüllkurven, Gate und Glide auf null, Notenstapel und Warteschlange leer, Glätter eingerastet.
    fn zuruecksetzen(&mut self) {
        self.stimme = Stimme::default();
        self.stapel.leeren();
        self.n_warte = 0;
        self.parameter.einrasten();
        self.ruht = true;
    }

    /// Velocity des Kern-Aufrufs (MIDI 1..127, darüber geklemmt) als 0..1 wie Carla an das Plugin: `vel/127`.
    fn velocity(vel: u8) -> f32 { vel.min(127) as f32 / 127.0 }

    /// `f` rechnet den Block; ein Panic darin gibt Stille und setzt zurück (Warteschlange und Stimme wären sonst halb
    /// verbraucht und spielten im nächsten Block Ereignisse noch einmal). Rückgabe: ob `f` durchlief.
    fn block_oder_stille(&mut self, l: &mut [f32], r: &mut [f32], f: impl FnOnce(&mut Self, &mut [f32], &mut [f32])) -> bool {
        let ok = catch_unwind(AssertUnwindSafe(|| f(self, &mut *l, &mut *r))).is_ok();
        if !ok {
            self.zuruecksetzen();
            l.fill(0.0);
            r.fill(0.0);
        }
        ok
    }

    fn block(&mut self, l: &mut [f32], r: &mut [f32]) {
        let n = l.len();
        // stabil nach Versatz sortieren (Einfügen, ohne Allokation): gleiche Versätze behalten ihre Meldereihenfolge
        for i in 1..self.n_warte {
            let mut j = i;
            while j > 0 && self.warte[j - 1].t() > self.warte[j].t() {
                self.warte.swap(j - 1, j);
                j -= 1;
            }
        }
        let mut naechstes = 0usize;
        for i in 0..n {
            // alle Ereignisse mit Versatz i als eine Gruppe planen (plane() rechnet je Zeitstempel-Gruppe, wie im Plugin)
            while naechstes < self.n_warte && self.warte[naechstes].t() as usize <= i {
                let t = self.warte[naechstes].t();
                let (mut m, mut alle_aus) = (0usize, false);
                while naechstes < self.n_warte && self.warte[naechstes].t() == t {
                    match self.warte[naechstes] {
                        Wartend::Note(e) => {
                            self.gruppe[m] = e;
                            m += 1;
                        }
                        Wartend::AlleAus { .. } => alle_aus = true,
                    }
                    naechstes += 1;
                }
                if alle_aus {
                    // vor den Noten desselben Samples: „alle aus, dann neu“ schlägt frisch an statt zu gleiten
                    self.stapel.leeren();
                    self.stimme.aus();
                }
                let k = plane(&self.gruppe[..m], &mut self.stapel, &mut self.aktionen);
                for a in &self.aktionen[..k] {
                    match *a {
                        Aktion::An { note, vel, slide, .. } => {
                            self.stimme.an(note, vel, slide);
                            self.ruht = false;
                        }
                        Aktion::Aus { .. } => self.stimme.aus(),
                        Aktion::Nichts => {}
                    }
                }
            }
            let (p, lautstaerke) = self.parameter.naechste(); // die Glätter laufen auch, solange die Stimme ruht
            let s = if self.ruht { 0.0 } else { self.stimme.prozess(&p, self.sr) * lautstaerke };
            l[i] = s;
            r[i] = s;
        }
        // was hinter dem Block liegt, rückt um n nach vorn
        let rest = self.n_warte - naechstes;
        self.warte.copy_within(naechstes..self.n_warte, 0);
        for w in &mut self.warte[..rest] {
            w.verschiebe(n as u32);
        }
        self.n_warte = rest;
    }
}

/// Neue Instanz für die Abtastrate `fs` (Hz). `fs` ≤ 0 oder nicht endlich: null. Allokiert (nicht im Callback).
#[no_mangle]
pub extern "C" fn cypher_rb_neu(fs: f64) -> *mut CypherRb {
    if !(fs.is_finite() && fs > 0.0) {
        return std::ptr::null_mut();
    }
    match catch_unwind(|| Box::into_raw(Box::new(CypherRb::neu(fs as f32)))) {
        Ok(p) => p,
        Err(_) => std::ptr::null_mut(),
    }
}

/// # Safety
/// `h` aus `cypher_rb_neu`, danach nicht mehr benutzen.
#[no_mangle]
pub unsafe extern "C" fn cypher_rb_frei(h: *mut CypherRb) {
    if !h.is_null() {
        drop(Box::from_raw(h));
    }
}

/// Note-Ein mit Versatz in Samples ab dem Anfang des nächsten Blocks; Velocity 1..127 als `vel/127`, Akzent ab 120, über
/// 127 geklemmt (0 heißt Note-Aus, wie MIDI). Mehrere Note-Ein am selben Sample: die zuletzt gemeldete klingt.
/// Rückgabe 0, −1 Warteschlange voll oder `h` null, −2 Ton außerhalb 0..127.
/// # Safety
/// `h` gültig oder null, nicht nebenläufig mit `cypher_rb_block`.
#[no_mangle]
pub unsafe extern "C" fn cypher_rb_note_an(h: *mut CypherRb, versatz: u32, ton: u8, vel: u8) -> i32 {
    let Some(h) = h.as_mut() else { return -1 };
    if ton > 127 {
        return -2;
    }
    let e = if vel == 0 {
        Ereignis::Aus { t: versatz, note: ton }
    } else {
        Ereignis::An { t: versatz, note: ton, vel: CypherRb::velocity(vel) }
    };
    catch_unwind(AssertUnwindSafe(|| h.melde(Wartend::Note(e)))).unwrap_or(-1)
}

/// Note-Aus mit Versatz. Rückgabe wie `cypher_rb_note_an`.
/// # Safety
/// wie `cypher_rb_note_an`.
#[no_mangle]
pub unsafe extern "C" fn cypher_rb_note_aus(h: *mut CypherRb, versatz: u32, ton: u8) -> i32 {
    let Some(h) = h.as_mut() else { return -1 };
    if ton > 127 {
        return -2;
    }
    catch_unwind(AssertUnwindSafe(|| h.melde(Wartend::Note(Ereignis::Aus { t: versatz, note: ton })))).unwrap_or(-1)
}

/// Alle Noten aus am Versatz (Stapel leer, Gate schließt mit 8 ms); wirkt vor Noten-Ein desselben Samples, egal in welcher
/// Reihenfolge gemeldet (Loop-Wrap, Transport-Start: der Neuanschlag gleitet nicht). Rückgabe 0 oder −1.
/// # Safety
/// wie `cypher_rb_note_an`.
#[no_mangle]
pub unsafe extern "C" fn cypher_rb_alle_aus(h: *mut CypherRb, versatz: u32) -> i32 {
    let Some(h) = h.as_mut() else { return -1 };
    catch_unwind(AssertUnwindSafe(|| h.melde(Wartend::AlleAus { t: versatz }))).unwrap_or(-1)
}

/// Parameter per ID aus rb338 (`lautstaerke`, `wellenform`, `cutoff`, `resonanz`, `env_mod`, `decay`, `accent`), Wert
/// normiert 0..1 (außerhalb wird geklemmt). Wirkt ab dem nächsten Block, geglättet wie im Plugin. Rückgabe 0, −1 ID
/// unbekannt oder ein Zeiger null, −2 Wert keine Zahl.
/// # Safety
/// `h` gültig oder null; `id` null oder eine NUL-terminierte Zeichenkette; nicht nebenläufig mit `cypher_rb_block`.
#[no_mangle]
pub unsafe extern "C" fn cypher_rb_setze(h: *mut CypherRb, id: *const c_char, normiert: f32) -> i32 {
    let Some(h) = h.as_mut() else { return -1 };
    if id.is_null() {
        return -1;
    }
    let Some(nr) = Parameter::nummer(CStr::from_ptr(id).to_bytes()) else { return -1 };
    if normiert.is_nan() {
        return -2;
    }
    catch_unwind(AssertUnwindSafe(|| h.parameter.setze(nr, normiert))).map(|_| 0).unwrap_or(-1)
}

/// Alle Parameter auf die Vorgabe des Plugins (Lautstärke −12 dB usw.), wirksam ab dem nächsten Block wie `setze`. Für
/// den Transport-Start, wenn die Wiedergabe nur einen Teil der Parameter nennt: vorgaben, setze, zuruecksetzen; dann
/// klingt der Lauf wie in einer frischen Instanz (Render), egal was ein früherer Lauf gesetzt hat.
/// # Safety
/// `h` gültig oder null; nicht nebenläufig mit `cypher_rb_block`.
#[no_mangle]
pub unsafe extern "C" fn cypher_rb_vorgaben(h: *mut CypherRb) {
    if let Some(h) = h.as_mut() {
        let _ = catch_unwind(AssertUnwindSafe(|| h.parameter.vorgaben()));
    }
}

/// Transport-Start (live und Render): Phase, Filter, Hüllkurven und Glide zurück, Notenstapel und gemeldete Noten
/// verworfen, Glätter auf ihr Ziel. Parameter bleiben, wie sie gesetzt sind: erst `cypher_rb_vorgaben` und die Parameter
/// des Laufs setzen, dann zurücksetzen, dann die Noten melden.
/// # Safety
/// `h` gültig oder null; nicht nebenläufig mit `cypher_rb_block`.
#[no_mangle]
pub unsafe extern "C" fn cypher_rb_zuruecksetzen(h: *mut CypherRb) {
    if let Some(h) = h.as_mut() {
        let _ = catch_unwind(AssertUnwindSafe(|| h.zuruecksetzen()));
    }
}

/// `n` Samples, mono auf beide Kanäle. `aus_l` und `aus_r` dürfen nicht überlappen. Ein Ausgang null oder `n` 0: nichts.
/// `h` null: Stille. Ein Panic im Block: Stille und zurückgesetzt wie `cypher_rb_zuruecksetzen`.
/// # Safety
/// `h` gültig oder null; beide Zeiger null oder gültig für `n` f32; nicht nebenläufig mit den übrigen `cypher_rb_*`.
#[no_mangle]
pub unsafe extern "C" fn cypher_rb_block(h: *mut CypherRb, aus_l: *mut f32, aus_r: *mut f32, n: usize) {
    if aus_l.is_null() || aus_r.is_null() || n == 0 {
        return;
    }
    let (l, r) = (std::slice::from_raw_parts_mut(aus_l, n), std::slice::from_raw_parts_mut(aus_r, n));
    match h.as_mut() {
        Some(h) => {
            h.block_oder_stille(l, r, |h, l, r| h.block(l, r));
        }
        None => {
            l.fill(0.0);
            r.fill(0.0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn velocity_ueber_127_wird_geklemmt() {
        // am Ausgang nicht unterscheidbar (die Stimme nutzt die Velocity nur für die Akzent-Schwelle), deshalb hier an der
        // Warteschlange: was an plane() geht, liegt in 0..1
        let h = cypher_rb_neu(48000.0);
        for (vel, soll) in [(200u8, 1.0f32), (255, 1.0), (128, 1.0), (127, 1.0), (120, 120.0 / 127.0), (1, 1.0 / 127.0)] {
            unsafe { assert_eq!(cypher_rb_note_an(h, 0, 36, vel), 0) };
            let hr = unsafe { &mut *h };
            match hr.warte[hr.n_warte - 1] {
                Wartend::Note(Ereignis::An { vel: v, .. }) => assert_eq!(v.to_bits(), soll.to_bits(), "vel {vel}: {v}"),
                _ => panic!("vel {vel}: kein Note-Ein in der Warteschlange"),
            }
        }
        unsafe { cypher_rb_frei(h) };
    }

    #[test]
    fn panic_im_block_gibt_stille_und_setzt_zurueck() {
        let still = |h: &mut CypherRb| {
            let (mut l, mut r) = (vec![0f32; 256], vec![0f32; 256]);
            assert!(h.block_oder_stille(&mut l, &mut r, |h, l, r| h.block(l, r)));
            l.iter().all(|v| *v == 0.0)
        };
        let mut h = CypherRb::neu(48000.0);
        // eine Note klingt, eine zweite wartet hinter dem Block; dann bricht der Block mitten in der Arbeit ab
        h.melde(Wartend::Note(Ereignis::An { t: 0, note: 36, vel: 0.8 }));
        h.melde(Wartend::Note(Ereignis::An { t: 400, note: 48, vel: 0.8 }));
        let (mut l, mut r) = (vec![9f32; 256], vec![9f32; 256]);
        let ok = h.block_oder_stille(&mut l, &mut r, |h, l, r| {
            h.block(&mut l[..100], &mut r[..100]); // halb gerechnet: Warteschlange verschoben, Stimme an
            panic!("Probe-Panic");
        });
        assert!(!ok);
        assert!(l.iter().chain(r.iter()).all(|v| *v == 0.0), "der Block ist Stille");
        assert_eq!(h.n_warte, 0, "keine verbrauchten oder halb verschobenen Ereignisse übrig");
        assert!(still(&mut h) && still(&mut h), "danach still: weder die alte Note noch die wartende spielt");
        // Gegenprobe: derselbe Ablauf ohne Panic klingt in den Folgeblöcken
        let mut g = CypherRb::neu(48000.0);
        g.melde(Wartend::Note(Ereignis::An { t: 0, note: 36, vel: 0.8 }));
        g.melde(Wartend::Note(Ereignis::An { t: 400, note: 48, vel: 0.8 }));
        let (mut l, mut r) = (vec![9f32; 100], vec![9f32; 100]);
        g.block(&mut l, &mut r);
        assert!(!still(&mut g));
    }
}
