//! C-ABI um baukasten_dsp für den djk-Kern (Baukasten S3a): ein Graph als Instrument eines Erzeuger-Stroms. Kopf:
//! djk/core/include/cypherdj/cypher_bk_ffi.h. In derselben Staticlib wie Hall, Komp und RB-338.
//!
//! `cypher_bk_neu` übersetzt und allokiert (Netz-Faden) und setzt danach zurück: das schreibt jeden Puffer einmal, die
//! Seiten liegen vor dem ersten Callback im Speicher. Alle anderen Aufrufe allokieren nicht. Noten kommen mit
//! Sample-Versatz relativ zum Anfang des nächsten `cypher_bk_block` in eine Warteschlange fester Größe; ein Versatz hinter
//! dem Block wandert in den Folgeblock. Am selben Sample: alle_aus vor aus vor regler_bei vor an, sonst in Meldereihenfolge. Ein Panic
//! im Block kommt nicht über die Grenze: Stille, Zurücksetzen, Warteschlange leer, `panik` zählt.
use baukasten_dsp::{uebersetze_mit_wurzel, Programm, REGLER};
use std::ffi::{c_char, CStr};
use std::os::unix::ffi::OsStrExt;
use std::panic::{catch_unwind, AssertUnwindSafe};

/// Ereignisse bis zum nächsten Block (wie RB_MAX_EREIGNISSE). Mehr meldet `-1` und zählt `verloren`.
pub const BK_MAX_EREIGNISSE: usize = 256;

#[derive(Clone, Copy)]
enum Ev {
    AlleAus { t: u32 },
    Aus { t: u32, ton: u8 },
    An { t: u32, ton: u8, vel: f32 },
    /// value of a latched knob at this sample (sampler A2), `nr` 0-based
    Regler { t: u32, nr: u8, wert: f32 },
    /// pitch bend of the instance to `st` semitones from this sample, gliding linearly in semitones over `gleit` samples (0 = jump)
    Bend { t: u32, st: f32, gleit: u32 },
    /// output level factor 0..1 from this sample, gliding linearly in the factor over `gleit` samples (0 = jump)
    Pegel { t: u32, faktor: f32, gleit: u32 },
}

impl Ev {
    fn t(&self) -> u32 {
        match *self {
            Ev::AlleAus { t } | Ev::Aus { t, .. } | Ev::An { t, .. } | Ev::Regler { t, .. } | Ev::Bend { t, .. } | Ev::Pegel { t, .. } => t,
        }
    }
    /// am selben Sample: alle_aus (0) vor aus (1) vor regler (2) vor an (3): a knob value runs before the note of its sample
    fn rang(&self) -> u8 {
        match self {
            Ev::AlleAus { .. } => 0,
            Ev::Aus { .. } => 1,
            Ev::Regler { .. } | Ev::Bend { .. } | Ev::Pegel { .. } => 2,
            Ev::An { .. } => 3,
        }
    }
    fn verschiebe(&mut self, n: u32) {
        match self {
            Ev::AlleAus { t } | Ev::Aus { t, .. } | Ev::An { t, .. } | Ev::Regler { t, .. } | Ev::Bend { t, .. } | Ev::Pegel { t, .. } => *t -= n,
        }
    }
}

pub struct CypherBk {
    p: Programm,
    warte: [Ev; BK_MAX_EREIGNISSE],
    n_warte: usize,
    verloren: u32,
    panik: u32,
    /// Reglerziele 0..1 (S5r), gesetzt von `cypher_bk_regler`
    ziel: [f32; REGLER],
    /// geglätteter Reglerstand, der am Programm liegt
    ist: [f32; REGLER],
    /// Einpol-Koeffizient für 20 ms: 1 - exp(-1 / (0,020 · fs))
    a: f32,
    /// latched knobs (`Programm::rastende`): no glide, settable at a sample
    rastet: u64,
    /// pitch bend now, in semitones. A glide runs from `bend_start` to `bend_ziel` over `bend_gleit` samples, `bend_rest` of them left;
    /// the value is computed from the position (start + (ziel - start) * k / gleit), never summed up, so it ends exactly on the target
    bend_st: f32,
    bend_start: f32,
    bend_ziel: f32,
    bend_gleit: u32,
    bend_rest: u32,
    /// output level factor now (1.0 = neutral); glide as for the bend, in the factor
    pegel: f32,
    pegel_start: f32,
    pegel_ziel: f32,
    pegel_gleit: u32,
    pegel_rest: u32,
}

/// Reglerzeit wie im Plugin (`modular/src/lib.rs`: „20 ms geglättet“)
const REGLER_GLATT_S: f64 = 0.020;
/// Näher als das am Ziel rastet `ist` auf `ziel` ein (S5r K4), ebenso wenn ein Schritt `ist` nicht mehr bewegt. Das
/// Einpol-Filter erreicht in float32 sein Ziel nie (a·d unterschreitet das halbe ulp schon bei d ≈ 3e-5 > 1e-5,
/// gemessen: stand bei 0,89997137 für Ziel 0,9), ohne Einrasten bliebe `ist` knapp daneben und `setze_regler`
/// liefe in jedem Sample weiter.
const REGLER_EINRASTEN: f32 = 1e-5;

impl CypherBk {
    /// Je Sample: `ist` zieht einpolig auf `ziel`, rastet unter `REGLER_EINRASTEN` ein (ein letztes `setze_regler`);
    /// steht `ist` bitgleich auf `ziel`, kostet der Regler nur den Vergleich.
    #[inline]
    fn regler_schritt(&mut self) {
        for i in 0..REGLER {
            if self.ist[i] == self.ziel[i] {
                continue;
            }
            let d = self.ziel[i] - self.ist[i];
            let schritt = self.ist[i] + self.a * d;
            self.ist[i] = if d.abs() < REGLER_EINRASTEN || schritt == self.ist[i] { self.ziel[i] } else { schritt };
            self.p.setze_regler(i + 1, self.ist[i]);
        }
    }

    /// Target and applied value of knob `i` (0-based) jump to `w` at once.
    #[inline]
    fn setze_sofort(&mut self, i: usize, w: f32) {
        self.ziel[i] = w;
        self.ist[i] = w;
        self.p.setze_regler(i + 1, w);
    }

    /// Bend and level back to neutral (0 semitones, factor 1), glides stopped.
    fn bend_pegel_neutral(&mut self) {
        self.bend_st = 0.0;
        self.bend_rest = 0;
        self.pegel = 1.0;
        self.pegel_rest = 0;
        self.p.setze_bend(1.0);
    }

    /// The bend factor `2^(st/12)` reaches the program; computed only when the bend changes, exactly 1.0 for 0 semitones.
    #[inline]
    fn bend_anwenden(&mut self) {
        self.p.setze_bend(if self.bend_st == 0.0 { 1.0 } else { (self.bend_st / 12.0).exp2() });
    }

    fn bend_setzen(&mut self, st: f32, gleit: u32) {
        if gleit == 0 {
            self.bend_st = st;
            self.bend_rest = 0;
            self.bend_anwenden();
        } else {
            self.bend_start = self.bend_st;
            self.bend_ziel = st;
            self.bend_gleit = gleit;
            self.bend_rest = gleit;
        }
    }

    fn pegel_setzen(&mut self, faktor: f32, gleit: u32) {
        if gleit == 0 {
            self.pegel = faktor;
            self.pegel_rest = 0;
        } else {
            self.pegel_start = self.pegel;
            self.pegel_ziel = faktor;
            self.pegel_gleit = gleit;
            self.pegel_rest = gleit;
        }
    }

    /// After a sample: one step of a running glide. The last step lands exactly on the target.
    #[inline]
    fn gleit_schritt(&mut self) {
        if self.bend_rest > 0 {
            self.bend_rest -= 1;
            self.bend_st = if self.bend_rest == 0 {
                self.bend_ziel
            } else {
                let k = (self.bend_gleit - self.bend_rest) as f32 / self.bend_gleit as f32;
                self.bend_start + (self.bend_ziel - self.bend_start) * k
            };
            self.bend_anwenden();
        }
        if self.pegel_rest > 0 {
            self.pegel_rest -= 1;
            self.pegel = if self.pegel_rest == 0 {
                self.pegel_ziel
            } else {
                let k = (self.pegel_gleit - self.pegel_rest) as f32 / self.pegel_gleit as f32;
                self.pegel_start + (self.pegel_ziel - self.pegel_start) * k
            };
        }
    }

    fn melde(&mut self, e: Ev) -> i32 {
        if self.n_warte >= BK_MAX_EREIGNISSE {
            self.verloren += 1;
            return -1;
        }
        self.warte[self.n_warte] = e;
        self.n_warte += 1;
        0
    }

    fn block(&mut self, ein: Option<(&[f32], &[f32])>, l: &mut [f32], r: &mut [f32]) {
        let n = l.len();
        // stabil nach (Versatz, Rang) sortieren, Einfügen ohne Allokation
        for i in 1..self.n_warte {
            let mut j = i;
            while j > 0 && (self.warte[j - 1].t(), self.warte[j - 1].rang()) > (self.warte[j].t(), self.warte[j].rang()) {
                self.warte.swap(j - 1, j);
                j -= 1;
            }
        }
        let mut k = 0;
        for i in 0..n {
            while k < self.n_warte && self.warte[k].t() as usize <= i {
                match self.warte[k] {
                    Ev::AlleAus { .. } => {
                        self.p.alle_aus();
                        self.bend_pegel_neutral();
                    }
                    Ev::Aus { ton, .. } => self.p.note_aus(ton),
                    Ev::An { ton, vel, .. } => self.p.note_an(ton, vel),
                    Ev::Regler { nr, wert, .. } => self.setze_sofort(nr as usize, wert),
                    Ev::Bend { st, gleit, .. } => self.bend_setzen(st, gleit),
                    Ev::Pegel { faktor, gleit, .. } => self.pegel_setzen(faktor, gleit),
                }
                k += 1;
            }
            self.regler_schritt();
            if let Some((el, er)) = ein {
                self.p.setze_eingang(el[i], er[i]);
            }
            let (mut a, mut b) = self.p.sample_stereo();
            if self.pegel != 1.0 {
                a *= self.pegel;
                b *= self.pegel;
            }
            l[i] = a;
            r[i] = b;
            self.gleit_schritt();
        }
        let mut w = 0;
        for j in k..self.n_warte {
            let mut e = self.warte[j];
            e.verschiebe(n as u32);
            self.warte[w] = e;
            w += 1;
        }
        self.n_warte = w;
    }
}

fn schreibe_fehler(ziel: *mut c_char, laenge: usize, text: &str) {
    if ziel.is_null() || laenge == 0 {
        return;
    }
    let b = text.as_bytes();
    let n = b.len().min(laenge - 1);
    // SAFETY: der Aufrufer garantiert `laenge` beschreibbare Bytes ab `ziel`
    unsafe {
        std::ptr::copy_nonoverlapping(b.as_ptr(), ziel as *mut u8, n);
        *ziel.add(n) = 0;
    }
}

/// Übersetzt den Graphen `json` (UTF-8, nullterminiert) für die Rate `fs`. Fehler: nullptr und Text in `fehler`
/// (höchstens `fehler_laenge` Bytes mit Null; `fehler` darf null sein). Allokiert: nur außerhalb des Callbacks.
/// Ohne Sample-Wurzel: ein Graph mit `sampler`-Knoten ist ein Fehler ("no sample root").
#[no_mangle]
pub extern "C" fn cypher_bk_neu(json: *const c_char, fs: f64, fehler: *mut c_char, fehler_laenge: usize) -> *mut CypherBk {
    cypher_bk_neu_wurzel(json, fs, std::ptr::null(), fehler, fehler_laenge)
}

/// Wie `cypher_bk_neu`, mit Sample-Wurzel für `sampler`-Knoten (S10): `wurzel` ist ein nullterminierter Ordnerpfad, die
/// Dateien `wurzel/<datei>` werden hier gelesen (Netz-Faden), nie im Callback. `wurzel` null: wie `cypher_bk_neu`.
#[no_mangle]
pub extern "C" fn cypher_bk_neu_wurzel(json: *const c_char, fs: f64, wurzel: *const c_char, fehler: *mut c_char, fehler_laenge: usize) -> *mut CypherBk {
    if json.is_null() || !(fs.is_finite() && fs > 0.0) {
        schreibe_fehler(fehler, fehler_laenge, "json null oder fs ungültig");
        return std::ptr::null_mut();
    }
    // SAFETY: json ist nullterminiert (Vertrag des Kopfes)
    let text = unsafe { CStr::from_ptr(json) };
    // SAFETY: wurzel ist null oder nullterminiert (Vertrag des Kopfes)
    let wurzel = (!wurzel.is_null()).then(|| unsafe { CStr::from_ptr(wurzel) });
    let r = catch_unwind(|| -> Result<Programm, String> {
        let s = text.to_str().map_err(|e| format!("kein UTF-8: {e}"))?;
        let w = wurzel.map(|c| std::path::Path::new(std::ffi::OsStr::from_bytes(c.to_bytes())));
        let mut p = uebersetze_mit_wurzel(s, fs as f32, w).map_err(|e| e.to_string())?;
        p.zuruecksetzen();
        Ok(p)
    });
    match r {
        Ok(Ok(p)) => Box::into_raw(Box::new(CypherBk {
            rastet: p.rastende(),
            // the knobs start at the graph's `vorgabe` (target and smoothed state alike: no 20 ms glide from 0.5)
            ziel: p.regler_vorgaben(),
            ist: p.regler_vorgaben(),
            p,
            warte: [Ev::AlleAus { t: 0 }; BK_MAX_EREIGNISSE],
            n_warte: 0,
            verloren: 0,
            panik: 0,
            a: (1.0 - (-1.0 / (REGLER_GLATT_S * fs)).exp()) as f32,
            bend_st: 0.0,
            bend_start: 0.0,
            bend_ziel: 0.0,
            bend_gleit: 0,
            bend_rest: 0,
            pegel: 1.0,
            pegel_start: 1.0,
            pegel_ziel: 1.0,
            pegel_gleit: 0,
            pegel_rest: 0,
        })),
        Ok(Err(e)) => {
            schreibe_fehler(fehler, fehler_laenge, &e);
            std::ptr::null_mut()
        }
        Err(_) => {
            schreibe_fehler(fehler, fehler_laenge, "Panic beim Übersetzen");
            std::ptr::null_mut()
        }
    }
}

#[no_mangle]
pub extern "C" fn cypher_bk_frei(h: *mut CypherBk) {
    if !h.is_null() {
        // SAFETY: h stammt aus cypher_bk_neu und wird genau einmal freigegeben
        drop(unsafe { Box::from_raw(h) });
    }
}

/// `vel` 0..1 (geklemmt, NaN wird 0). Rückgabe 0, -1 voll oder h null, -2 Ton über 127.
#[no_mangle]
pub extern "C" fn cypher_bk_note_an(h: *mut CypherBk, versatz: u32, ton: u8, vel: f32) -> i32 {
    // SAFETY: h aus cypher_bk_neu oder null, kein nebenläufiger Aufruf (Vertrag des Kopfes)
    let Some(bk) = (unsafe { h.as_mut() }) else { return -1 };
    if ton > 127 {
        return -2;
    }
    let vel = if vel.is_finite() { vel.clamp(0.0, 1.0) } else { 0.0 };
    bk.melde(Ev::An { t: versatz, ton, vel })
}

#[no_mangle]
pub extern "C" fn cypher_bk_note_aus(h: *mut CypherBk, versatz: u32, ton: u8) -> i32 {
    // SAFETY: wie cypher_bk_note_an
    let Some(bk) = (unsafe { h.as_mut() }) else { return -1 };
    if ton > 127 {
        return -2;
    }
    bk.melde(Ev::Aus { t: versatz, ton })
}

#[no_mangle]
pub extern "C" fn cypher_bk_alle_aus(h: *mut CypherBk, versatz: u32) -> i32 {
    // SAFETY: wie cypher_bk_note_an
    let Some(bk) = (unsafe { h.as_mut() }) else { return -1 };
    bk.melde(Ev::AlleAus { t: versatz })
}

/// Reglerziel `nr` (1..64, `baukasten_dsp::REGLER`) auf `wert` (0..1, geklemmt; NaN wird ignoriert). Der Graph folgt in 20 ms einpolig (Zeit aus
/// `fs`); ein einrastender Regler (`rastet` 1 im Graphen, `cypher_bk_rastende`) springt dagegen sofort, wie `cypher_bk_regler_sofort`.
/// Rückgabe 0, -1 bei h null oder nr außerhalb. Allokiert nicht; nicht nebenläufig mit block.
#[no_mangle]
pub extern "C" fn cypher_bk_regler(h: *mut CypherBk, nr: u32, wert: f32) -> i32 {
    // SAFETY: wie cypher_bk_note_an
    let Some(bk) = (unsafe { h.as_mut() }) else { return -1 };
    if !(1..=REGLER as u32).contains(&nr) {
        return -1;
    }
    if !wert.is_nan() {
        let i = nr as usize - 1;
        let w = wert.clamp(0.0, 1.0);
        if (bk.rastet >> i) & 1 == 1 {
            bk.setze_sofort(i, w);
        } else {
            bk.ziel[i] = w;
        }
    }
    0
}

/// Sampler A2: sets the latched knob `nr` (1..64) to `wert` (0..1, geklemmt; NaN wird ignoriert) at sample `versatz` of the next
/// `cypher_bk_block`, with no glide: target and applied value jump together. Same queue, same offset rule as the notes (an offset
/// behind the block moves into the following block); at the same sample after `alle_aus` and `aus`, before `an`, so a note
/// sees the value reported for its own sample whatever the order of reporting. Return 0; -1 for h null, nr outside 1..64 or a full
/// queue (counted in `verloren`); -2 when the knob is not latched (the glide of such a knob stays as it is). Allokiert nicht;
/// nicht nebenläufig mit block.
#[no_mangle]
pub extern "C" fn cypher_bk_regler_bei(h: *mut CypherBk, versatz: u32, nr: u32, wert: f32) -> i32 {
    // SAFETY: wie cypher_bk_note_an
    let Some(bk) = (unsafe { h.as_mut() }) else { return -1 };
    if !(1..=REGLER as u32).contains(&nr) {
        return -1;
    }
    if (bk.rastet >> (nr - 1)) & 1 == 0 {
        return -2;
    }
    if wert.is_nan() {
        return 0;
    }
    bk.melde(Ev::Regler { t: versatz, nr: (nr - 1) as u8, wert: wert.clamp(0.0, 1.0) })
}

/// Tracker effects: pitch bend of the instance to `st` semitones (clamped to -48..48, NaN ignored) at sample `versatz` of the next
/// `cypher_bk_block`. `gleit` is the glide length in samples: 0 jumps, otherwise the bend moves linearly in semitones from its value at
/// that sample and reaches `st` exactly `gleit` samples later. The factor `2^(st/12)` multiplies the hz the graph's `note` block
/// writes (what the oscillators read); no knob smoothing applies. Same queue and offset rule as the notes; at the same sample after
/// `alle_aus` and `aus`, before `an`. `alle_aus` and `cypher_bk_zuruecksetzen` return the bend to 0. Return 0; -1 for h null or a full
/// queue (counted in `verloren`). Allokiert nicht; nicht nebenläufig mit block.
#[no_mangle]
pub extern "C" fn cypher_bk_bend_bei(h: *mut CypherBk, versatz: u32, st: f32, gleit: u32) -> i32 {
    // SAFETY: wie cypher_bk_note_an
    let Some(bk) = (unsafe { h.as_mut() }) else { return -1 };
    if st.is_nan() {
        return 0;
    }
    bk.melde(Ev::Bend { t: versatz, st: st.clamp(-48.0, 48.0), gleit })
}

/// Tracker effects: output level factor of the instance (both channels, after the graph; clamped to 0..1, NaN ignored) at sample
/// `versatz` of the next `cypher_bk_block`, `gleit` samples of linear glide in the factor (0 = jump). Same queue, offsets and order
/// as `cypher_bk_bend_bei`; `alle_aus` and `cypher_bk_zuruecksetzen` return the level to 1. Return 0; -1 for h null or a full queue
/// (counted in `verloren`). Allokiert nicht; nicht nebenläufig mit block.
#[no_mangle]
pub extern "C" fn cypher_bk_pegel_bei(h: *mut CypherBk, versatz: u32, faktor: f32, gleit: u32) -> i32 {
    // SAFETY: wie cypher_bk_note_an
    let Some(bk) = (unsafe { h.as_mut() }) else { return -1 };
    if faktor.is_nan() {
        return 0;
    }
    bk.melde(Ev::Pegel { t: versatz, faktor: faktor.clamp(0.0, 1.0), gleit })
}

/// Sampler A2: the latched knobs of the graph, bit nr-1 set when the graph's `regler` nodes of knob nr say `rastet` 1; 0 for a graph
/// without and for h null. Does not allocate.
#[no_mangle]
pub extern "C" fn cypher_bk_rastende(h: *const CypherBk) -> u64 {
    // SAFETY: wie cypher_bk_latenz
    unsafe { h.as_ref() }.map_or(0, |b| b.rastet)
}

/// The graph's start position (`vorgabe`, 0..1) of knob `nr` (1..`baukasten_dsp::REGLER`); 0.5 for a knob the graph does not
/// define or gives no `vorgabe`. -1.0 for h null or nr outside. A fresh instance starts every knob there. Does not allocate.
#[no_mangle]
pub extern "C" fn cypher_bk_regler_vorgabe(h: *mut CypherBk, nr: u32) -> f32 {
    // SAFETY: wie cypher_bk_note_an
    let Some(bk) = (unsafe { h.as_ref() }) else { return -1.0 };
    if !(1..=REGLER as u32).contains(&nr) {
        return -1.0;
    }
    bk.p.regler_vorgaben()[nr as usize - 1]
}

/// S20: like `cypher_bk_regler`, but the smoothed state jumps to the target at once (no 20 ms ramp). The arrangement sink uses it when it
/// takes over a new instance and at transport start, so that live and the offline render begin from the same knob values whatever
/// the pre-roll (the offline render has only three blocks before the first note). Returns 0, -1 for h null or nr outside 1..64; NaN is
/// ignored. Does not allocate; not concurrent with block.
#[no_mangle]
pub extern "C" fn cypher_bk_regler_sofort(h: *mut CypherBk, nr: u32, wert: f32) -> i32 {
    // SAFETY: wie cypher_bk_note_an
    let Some(bk) = (unsafe { h.as_mut() }) else { return -1 };
    if !(1..=REGLER as u32).contains(&nr) {
        return -1;
    }
    if !wert.is_nan() {
        let i = nr as usize - 1;
        let w = wert.clamp(0.0, 1.0);
        bk.ziel[i] = w;
        bk.ist[i] = w;
        bk.p.setze_regler(nr as usize, w);
    }
    0
}

/// Pin matrix (`matrix` block, type 60): the target of the pin `[satz 0|1][zeile 0..15][spalte 0..15]` goes to `wert` (-1..1, clamped),
/// the program follows in about 5 ms (no click while a note sounds). A direct setter, not an event of the queue: it takes effect
/// at the next `cypher_bk_block`. Returns 0; -1 for h null, an index out of range or NaN; -2 when the graph has no matrix.
/// Does not allocate; not concurrent with block.
#[no_mangle]
pub extern "C" fn cypher_bk_stift(h: *mut CypherBk, satz: u32, zeile: u32, spalte: u32, wert: f32) -> i32 {
    stift_setzen(h, satz, zeile, spalte, wert, false)
}

/// Like `cypher_bk_stift`, the smoothed state jumps to the target at once (a take-over: no glide into the sound). Returns 0; -1 for
/// h null, an index out of range or NaN; -2 when the graph has no matrix. Does not allocate; not concurrent with block.
#[no_mangle]
pub extern "C" fn cypher_bk_stift_sofort(h: *mut CypherBk, satz: u32, zeile: u32, spalte: u32, wert: f32) -> i32 {
    stift_setzen(h, satz, zeile, spalte, wert, true)
}

fn stift_setzen(h: *mut CypherBk, satz: u32, zeile: u32, spalte: u32, wert: f32, sofort: bool) -> i32 {
    // SAFETY: wie cypher_bk_note_an
    let Some(bk) = (unsafe { h.as_mut() }) else { return -1 };
    if satz > 1 || zeile > 15 || spalte > 15 || wert.is_nan() {
        return -1;
    }
    let (s, z, c) = (satz as usize, zeile as usize, spalte as usize);
    let ok = if sofort { bk.p.stift_sofort(s, z, c, wert) } else { bk.p.stift_setzen(s, z, c, wert) };
    if ok { 0 } else { -2 }
}

/// All pins of the matrix back to the graph's own pins (`vorgabe` nonzero) or to 0 (`vorgabe` 0); `sofort` nonzero jumps the smoothed
/// state, 0 lets it glide. Returns 0; -1 for h null; -2 when the graph has no matrix. Does not allocate; not concurrent with block.
#[no_mangle]
pub extern "C" fn cypher_bk_stifte_grund(h: *mut CypherBk, vorgabe: u32, sofort: u32) -> i32 {
    // SAFETY: wie cypher_bk_note_an
    let Some(bk) = (unsafe { h.as_mut() }) else { return -1 };
    if bk.p.stifte_grund(vorgabe != 0, sofort != 0) { 0 } else { -2 }
}

/// 1 when the graph has a `matrix` block, 0 without it and for h null. No allocation.
#[no_mangle]
pub extern "C" fn cypher_bk_hat_matrix(h: *const CypherBk) -> u32 {
    // SAFETY: wie cypher_bk_hat_eingang
    unsafe { h.as_ref() }.map_or(0, |bk| bk.p.hat_matrix() as u32)
}

/// S20: resets the program as after `cypher_bk_neu` (voices, oscillators, filters, envelopes, slots, noise, delay and reverb
/// buffers) and empties the event queue. The knob targets and the smoothed knob state stay (as `Programm::zuruecksetzen`
/// keeps the knob paths). The arrangement sink calls this at transport start so that live and the offline render start
/// from the same state. h null: no effect. Does not allocate; not concurrent with block.
#[no_mangle]
pub extern "C" fn cypher_bk_zuruecksetzen(h: *mut CypherBk) {
    // SAFETY: wie cypher_bk_note_an
    let Some(bk) = (unsafe { h.as_mut() }) else { return };
    if catch_unwind(AssertUnwindSafe(|| bk.p.zuruecksetzen())).is_err() {
        bk.panik += 1;
    }
    bk.bend_pegel_neutral();
    bk.n_warte = 0;
}

/// Rechnet `n` Samples Stereo in `aus_l`/`aus_r` (überschreibt). h null: Stille, Rückgabe 0. Panic: Stille,
/// Zurücksetzen, Rückgabe -1.
#[no_mangle]
pub extern "C" fn cypher_bk_block(h: *mut CypherBk, aus_l: *mut f32, aus_r: *mut f32, n: usize) -> i32 {
    if aus_l.is_null() || aus_r.is_null() || n == 0 {
        return 0;
    }
    // SAFETY: n beschreibbare floats je Kanal (Vertrag des Kopfes), Kanäle überlappen nicht
    let (l, r) = unsafe { (std::slice::from_raw_parts_mut(aus_l, n), std::slice::from_raw_parts_mut(aus_r, n)) };
    // SAFETY: wie cypher_bk_note_an
    let Some(bk) = (unsafe { h.as_mut() }) else {
        l.fill(0.0);
        r.fill(0.0);
        return 0;
    };
    if catch_unwind(AssertUnwindSafe(|| bk.block(None, &mut *l, &mut *r))).is_ok() {
        return 0;
    }
    bk.p.zuruecksetzen();
    bk.bend_pegel_neutral();
    bk.n_warte = 0;
    bk.panik += 1;
    l.fill(0.0);
    r.fill(0.0);
    -1
}

/// Effekt-Block (S3c): ein_l/ein_r sind das Host-Audio, aus_l/aus_r werden überschrieben. Eingang und Ausgang dürfen
/// sich nicht überlappen. h null: Stille. Panic: wie cypher_bk_block.
#[no_mangle]
pub extern "C" fn cypher_bk_effekt(h: *mut CypherBk, ein_l: *const f32, ein_r: *const f32, aus_l: *mut f32,
                                   aus_r: *mut f32, n: usize) -> i32 {
    if ein_l.is_null() || ein_r.is_null() || aus_l.is_null() || aus_r.is_null() || n == 0 {
        return 0;
    }
    // SAFETY: n lesbare bzw. beschreibbare floats je Kanal (Vertrag des Kopfes), Ein- und Ausgang überlappen nicht
    let (el, er) = unsafe { (std::slice::from_raw_parts(ein_l, n), std::slice::from_raw_parts(ein_r, n)) };
    let (l, r) = unsafe { (std::slice::from_raw_parts_mut(aus_l, n), std::slice::from_raw_parts_mut(aus_r, n)) };
    // SAFETY: wie cypher_bk_note_an
    let Some(bk) = (unsafe { h.as_mut() }) else {
        l.fill(0.0);
        r.fill(0.0);
        return 0;
    };
    if catch_unwind(AssertUnwindSafe(|| bk.block(Some((el, er)), &mut *l, &mut *r))).is_ok() {
        return 0;
    }
    bk.p.zuruecksetzen();
    bk.bend_pegel_neutral();
    bk.n_warte = 0;
    bk.panik += 1;
    l.fill(0.0);
    r.fill(0.0);
    -1
}

/// Takt für die folgenden Blöcke (S3c): beat0 = Beat des ersten Samples des nächsten Blocks, bps = Beats je Sample.
/// h null oder ungültige Werte: ohne Wirkung. Allokiert nicht.
#[no_mangle]
pub extern "C" fn cypher_bk_takt(h: *mut CypherBk, beat0: f64, bps: f64) {
    // SAFETY: wie cypher_bk_note_an
    if let Some(bk) = unsafe { h.as_mut() } {
        bk.p.setze_takt(beat0, bps);
    }
}

/// 1, wenn der Graph einen Knoten `eingang` hat (Effekt), sonst 0; h null: 0
#[no_mangle]
pub extern "C" fn cypher_bk_hat_eingang(h: *const CypherBk) -> u32 {
    // SAFETY: wie cypher_bk_latenz
    unsafe { h.as_ref() }.map_or(0, |b| b.p.hat_eingang() as u32)
}

/// Latenz des Graphen in Samples (Programm::latenz), h null: 0
#[no_mangle]
pub extern "C" fn cypher_bk_latenz(h: *const CypherBk) -> u32 {
    // SAFETY: h aus cypher_bk_neu oder null
    unsafe { h.as_ref() }.map_or(0, |b| b.p.latenz() as u32)
}

/// Wächter-Eingriffe des Graphen (Programm::rettungen), h null: 0
#[no_mangle]
pub extern "C" fn cypher_bk_rettungen(h: *const CypherBk) -> u32 {
    // SAFETY: wie cypher_bk_latenz
    unsafe { h.as_ref() }.map_or(0, |b| b.p.rettungen)
}

#[no_mangle]
pub extern "C" fn cypher_bk_verloren(h: *const CypherBk) -> u32 {
    // SAFETY: wie cypher_bk_latenz
    unsafe { h.as_ref() }.map_or(0, |b| b.verloren)
}

#[no_mangle]
pub extern "C" fn cypher_bk_panik(h: *const CypherBk) -> u32 {
    // SAFETY: wie cypher_bk_latenz
    unsafe { h.as_ref() }.map_or(0, |b| b.panik)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The ranks at one sample: alle_aus 0, aus 1, regler 2, an 3 (a knob value runs before the note of its sample).
    #[test]
    fn ranks_at_one_sample() {
        let r = [Ev::AlleAus { t: 5 }, Ev::Aus { t: 5, ton: 1 }, Ev::Regler { t: 5, nr: 2, wert: 0.5 }, Ev::An { t: 5, ton: 1, vel: 1.0 }];
        assert_eq!(r.map(|e| e.rang()), [0, 1, 2, 3]);
        assert!(r.iter().all(|e| e.t() == 5));
        let mut e = r[2];
        e.verschiebe(3);
        assert_eq!(e.t(), 2);
    }

    /// The glide state itself: after 4799 samples of a 4800 sample glide the bend is still short of the target, after 4800 it is the
    /// target exactly; the level glide ends exactly on its factor too. A jump and a reset need no sample.
    #[test]
    fn glide_ends_exactly_at_its_last_sample() {
        let json = std::ffi::CString::new(
            r#"{"format":"baukasten/2","name":"t","stimmen":1,"knoten":[{"id":"n","art":"note"},{"id":"a","art":"ausgang"}],"kanten":[{"von":"n.hz","nach":"a.x"}]}"#,
        )
        .unwrap();
        let mut f = [0 as c_char; 64];
        let h = cypher_bk_neu(json.as_ptr(), 48_000.0, f.as_mut_ptr(), f.len());
        assert!(!h.is_null());
        let bk = unsafe { &mut *h };
        assert_eq!(cypher_bk_bend_bei(h, 0, 12.0, 4800), 0);
        assert_eq!(cypher_bk_pegel_bei(h, 0, 0.5, 4800), 0);
        let (mut l, mut r) = ([0f32; 4799], [0f32; 4799]);
        assert_eq!(cypher_bk_block(h, l.as_mut_ptr(), r.as_mut_ptr(), 4799), 0);
        assert!(bk.bend_st < 12.0 && bk.bend_st > 11.99 && bk.pegel > 0.5 && bk.bend_rest == 1);
        let (mut l, mut r) = ([0f32; 1], [0f32; 1]);
        assert_eq!(cypher_bk_block(h, l.as_mut_ptr(), r.as_mut_ptr(), 1), 0);
        assert!(bk.bend_st == 12.0 && bk.pegel == 0.5 && bk.bend_rest == 0 && bk.pegel_rest == 0);
        cypher_bk_zuruecksetzen(h);
        assert!(bk.bend_st == 0.0 && bk.pegel == 1.0);
        cypher_bk_frei(h);
    }

    #[test]
    fn bend_and_level_rank_with_the_knob() {
        let r = [Ev::Bend { t: 5, st: 1.0, gleit: 0 }, Ev::Pegel { t: 5, faktor: 0.5, gleit: 0 }];
        assert_eq!(r.map(|e| e.rang()), [2, 2]);
    }
}
