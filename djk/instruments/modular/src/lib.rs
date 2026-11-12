//! Cypher Modular: der Baukasten (baukasten_dsp) als VST3 für den Carla-Wirt. Den Graphen liest `initialize` (außerhalb
//! des Callbacks) aus $CYPHERDJ_BAUKASTEN_GRAPH; fehlt die Variable oder die Datei, spielt der eingebaute Graph
//! (modular_dsp/demos/saege-ladder.json). Ist die Datei fehlerhaft, spielt auch der eingebaute, und der Fehler
//! steht im Log des Wirts (Slice 1; sichtbar im Wirt-Status erst mit der Prüfung über djk-hand, Spec Slice 5).
//! Ein neuer Graph braucht in Slice 1 einen Neustart des Wirts (Spec E5 kommt in Slice 3). Die Kosten je Graph misst
//! Slice 1 offline (modular_dsp/tests/kosten_messung.rs); im Host liest sie erst die Kern-FFI (Slice 3).
//! Slice 2: Parameter „Knob 1“..„Knob 8“ (seit den Erweiterungen bis „Knob 64“) (0..1, 20 ms geglättet) gehen je Sample an die `regler`-Knoten
//! des Graphen. Der Wirt erreicht sie mit `{"befehl":"param","name":"Knob 1","wert":…}`; die Namen aus `regler_namen`
//! stehen im Log, die Parameter heißen fest, weil ein VST3 seine Parameterliste beim Laden festlegt.
//! Slice 2b: der Ausgang ist Stereo, Kanal 0 links und Kanal 1 rechts (`Programm::sample_stereo`); ein Graph ohne
//! `l`/`r` am Ausgang klingt auf beiden Kanälen gleich.
use baukasten_dsp::{uebersetze, Programm};

/// Knobs this plugin exposes as VST3 parameters: the engine limit (`baukasten_dsp::REGLER`, 64). Ids `knob1`..`knob8`
/// are the original ones (a host stores state by id), `knob9`..`knob32` came with the 32-knob widening and
/// `knob33`..`knob64` with the 64-knob widening; a state saved with fewer loads unchanged and leaves the new knobs untouched
/// (see `KNOPF_UNBERUEHRT`).
const REGLER: usize = baukasten_dsp::REGLER;
use nih_plug::prelude::*;
use std::sync::Arc;

/// Graph defaults until the host moves a knob (plan "synth build-out", Task 5; no callback, no persisted mask).
///
/// The static nih-plug default of every knob parameter is this sentinel instead of 0.5. It is exactly representable in f32
/// (0.5 - 2^-24, two ulps below 0.5) and survives every nih-plug path bit for bit: a linear 0..1 range maps plain <-> normalized
/// without rounding, the VST3 wrapper hands f64 normalized values that were f32 first, and the state file stores f32 plain
/// values through serde (tests `sentinel_ueberlebt_*`). Meaning: a parameter whose bits equal the sentinel is "untouched" and
/// `sample()` feeds the engine the graph's `vorgabe` (`Programm::regler_vorgaben()`); every other value, 0.5 included, is
/// explicit. Why not a callback: nih-plug does not call `with_callback` when a write repeats the current value
/// (`FloatParam::set_plain_value`), so a host writing exactly 0.5 would not count as a touch.
/// Consequences: a host state from before this change stores 0.5 and restores 0.5 (explicit, so the old sound); a host "reset to default"
/// writes the sentinel and the knob ramps back to the `vorgabe`; hosts show the default as 0.500 (rounded).
pub const KNOPF_UNBERUEHRT: f32 = 0.5 - 1.0 / 16_777_216.0;

#[derive(Clone, Copy, PartialEq, Debug)]
enum Stand {
    /// parameter holds the sentinel, the engine gets the `vorgabe`
    Unberuehrt,
    /// the host wrote a value: the engine follows the smoothed parameter
    Beruehrt,
    /// the host wrote the sentinel after a touch: ramping back to the `vorgabe`, then untouched again
    Zurueck,
}

/// Audio-thread state per knob (not persisted): untouched / touched and the graph defaults.
pub struct Knoepfe {
    stand: [Stand; REGLER],
    vorgabe: [f32; REGLER],
    sr: f32,
}

impl Knoepfe {
    pub fn neu(vorgabe: [f32; REGLER], sr: f32) -> Self { Self { stand: [Stand::Unberuehrt; REGLER], vorgabe, sr } }

    /// Value for the engine for knob index `i` (0-based) given the parameter's current plain value and its smoother.
    /// Untouched -> touched: the smoother restarts at the `vorgabe` (what was heard) and ramps to the value, exactly the ramp
    /// the plug-in always had for a graph whose `vorgabe` is 0.5 (bit-equal, test e); the first sample is one smoother step
    /// (1/960 of the way) away from the `vorgabe`. Touched -> sentinel: ramp to the `vorgabe`. Allocation free.
    #[inline]
    fn wert(&mut self, i: usize, param: f32, g: &Smoother<f32>) -> f32 {
        let unberuehrt = param.to_bits() == KNOPF_UNBERUEHRT.to_bits();
        let v = self.vorgabe[i];
        match (self.stand[i], unberuehrt) {
            (Stand::Unberuehrt, true) => v,
            (Stand::Unberuehrt, false) => {
                g.reset(v);
                g.set_target(self.sr, param);
                self.stand[i] = Stand::Beruehrt;
                g.next()
            }
            (Stand::Beruehrt, false) => g.next(),
            (Stand::Beruehrt, true) => {
                g.set_target(self.sr, v);
                self.stand[i] = Stand::Zurueck;
                g.next()
            }
            (Stand::Zurueck, true) => {
                let x = g.next();
                if !g.is_smoothing() {
                    self.stand[i] = Stand::Unberuehrt;
                }
                x
            }
            (Stand::Zurueck, false) => {
                self.stand[i] = Stand::Beruehrt;
                g.next()
            }
        }
    }
}

pub const EINGEBAUT: &str = include_str!("../../modular_dsp/demos/saege-ladder.json");

/// Woher der gespielte Graph kommt; `initialize` schreibt es ins Log.
#[derive(Debug, PartialEq)]
pub enum Herkunft {
    /// keine Variable gesetzt
    Eingebaut,
    /// Variable gesetzt, Datei gibt es (noch) nicht: kein Fehler, der Wirt-Start legt den Pfad fest, die Datei darf später kommen
    DateiFehlt(String),
    Datei(String),
    /// Datei unlesbar oder ungültig
    Verworfen(String),
}

/// Graph laden: das Programm und woher es kommt.
pub fn lade(pfad: Option<&str>, sr: f32) -> (Programm, Herkunft) {
    let eingebaut = || uebersetze(EINGEBAUT, sr).expect("eingebauter Graph ist gültig (tests/pruefung.rs)");
    let Some(pfad) = pfad else { return (eingebaut(), Herkunft::Eingebaut) };
    match std::fs::read_to_string(pfad) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => (eingebaut(), Herkunft::DateiFehlt(pfad.to_string())),
        Err(e) => (eingebaut(), Herkunft::Verworfen(format!("{pfad}: {e}"))),
        Ok(text) => match uebersetze(&text, sr) {
            Ok(p) => (p, Herkunft::Datei(pfad.to_string())),
            Err(e) => (eingebaut(), Herkunft::Verworfen(format!("{pfad}: {e}"))),
        },
    }
}

pub struct Modular {
    params: Arc<ModularParams>,
    programm: Option<Programm>,
    knoepfe: Knoepfe,
}

#[derive(Params)]
pub struct ModularParams {
    #[id = "lautstaerke"]
    pub lautstaerke: FloatParam,
    #[id = "knob1"]
    pub knob1: FloatParam,
    #[id = "knob2"]
    pub knob2: FloatParam,
    #[id = "knob3"]
    pub knob3: FloatParam,
    #[id = "knob4"]
    pub knob4: FloatParam,
    #[id = "knob5"]
    pub knob5: FloatParam,
    #[id = "knob6"]
    pub knob6: FloatParam,
    #[id = "knob7"]
    pub knob7: FloatParam,
    #[id = "knob8"]
    pub knob8: FloatParam,
    #[id = "knob9"]
    pub knob9: FloatParam,
    #[id = "knob10"]
    pub knob10: FloatParam,
    #[id = "knob11"]
    pub knob11: FloatParam,
    #[id = "knob12"]
    pub knob12: FloatParam,
    #[id = "knob13"]
    pub knob13: FloatParam,
    #[id = "knob14"]
    pub knob14: FloatParam,
    #[id = "knob15"]
    pub knob15: FloatParam,
    #[id = "knob16"]
    pub knob16: FloatParam,
    #[id = "knob17"]
    pub knob17: FloatParam,
    #[id = "knob18"]
    pub knob18: FloatParam,
    #[id = "knob19"]
    pub knob19: FloatParam,
    #[id = "knob20"]
    pub knob20: FloatParam,
    #[id = "knob21"]
    pub knob21: FloatParam,
    #[id = "knob22"]
    pub knob22: FloatParam,
    #[id = "knob23"]
    pub knob23: FloatParam,
    #[id = "knob24"]
    pub knob24: FloatParam,
    #[id = "knob25"]
    pub knob25: FloatParam,
    #[id = "knob26"]
    pub knob26: FloatParam,
    #[id = "knob27"]
    pub knob27: FloatParam,
    #[id = "knob28"]
    pub knob28: FloatParam,
    #[id = "knob29"]
    pub knob29: FloatParam,
    #[id = "knob30"]
    pub knob30: FloatParam,
    #[id = "knob31"]
    pub knob31: FloatParam,
    #[id = "knob32"]
    pub knob32: FloatParam,
    #[id = "knob33"]
    pub knob33: FloatParam,
    #[id = "knob34"]
    pub knob34: FloatParam,
    #[id = "knob35"]
    pub knob35: FloatParam,
    #[id = "knob36"]
    pub knob36: FloatParam,
    #[id = "knob37"]
    pub knob37: FloatParam,
    #[id = "knob38"]
    pub knob38: FloatParam,
    #[id = "knob39"]
    pub knob39: FloatParam,
    #[id = "knob40"]
    pub knob40: FloatParam,
    #[id = "knob41"]
    pub knob41: FloatParam,
    #[id = "knob42"]
    pub knob42: FloatParam,
    #[id = "knob43"]
    pub knob43: FloatParam,
    #[id = "knob44"]
    pub knob44: FloatParam,
    #[id = "knob45"]
    pub knob45: FloatParam,
    #[id = "knob46"]
    pub knob46: FloatParam,
    #[id = "knob47"]
    pub knob47: FloatParam,
    #[id = "knob48"]
    pub knob48: FloatParam,
    #[id = "knob49"]
    pub knob49: FloatParam,
    #[id = "knob50"]
    pub knob50: FloatParam,
    #[id = "knob51"]
    pub knob51: FloatParam,
    #[id = "knob52"]
    pub knob52: FloatParam,
    #[id = "knob53"]
    pub knob53: FloatParam,
    #[id = "knob54"]
    pub knob54: FloatParam,
    #[id = "knob55"]
    pub knob55: FloatParam,
    #[id = "knob56"]
    pub knob56: FloatParam,
    #[id = "knob57"]
    pub knob57: FloatParam,
    #[id = "knob58"]
    pub knob58: FloatParam,
    #[id = "knob59"]
    pub knob59: FloatParam,
    #[id = "knob60"]
    pub knob60: FloatParam,
    #[id = "knob61"]
    pub knob61: FloatParam,
    #[id = "knob62"]
    pub knob62: FloatParam,
    #[id = "knob63"]
    pub knob63: FloatParam,
    #[id = "knob64"]
    pub knob64: FloatParam,
}

fn knob(nr: usize) -> FloatParam {
    FloatParam::new(format!("Knob {nr}"), KNOPF_UNBERUEHRT, FloatRange::Linear { min: 0.0, max: 1.0 })
        .with_smoother(SmoothingStyle::Linear(20.0))
        .with_value_to_string(formatters::v2s_f32_rounded(3))
}

impl ModularParams {
    /// Knob 1..64 in Reihenfolge
    pub fn knobs(&self) -> [&FloatParam; REGLER] {
        [&self.knob1, &self.knob2, &self.knob3, &self.knob4, &self.knob5, &self.knob6, &self.knob7, &self.knob8,
         &self.knob9, &self.knob10, &self.knob11, &self.knob12, &self.knob13, &self.knob14, &self.knob15, &self.knob16, &self.knob17, &self.knob18, &self.knob19, &self.knob20, &self.knob21, &self.knob22, &self.knob23, &self.knob24, &self.knob25, &self.knob26, &self.knob27, &self.knob28, &self.knob29, &self.knob30, &self.knob31, &self.knob32,
         &self.knob33, &self.knob34, &self.knob35, &self.knob36, &self.knob37, &self.knob38, &self.knob39, &self.knob40, &self.knob41, &self.knob42, &self.knob43, &self.knob44, &self.knob45, &self.knob46, &self.knob47, &self.knob48, &self.knob49, &self.knob50, &self.knob51, &self.knob52, &self.knob53, &self.knob54, &self.knob55, &self.knob56, &self.knob57, &self.knob58, &self.knob59, &self.knob60, &self.knob61, &self.knob62, &self.knob63, &self.knob64]
    }
}

impl Default for ModularParams {
    fn default() -> Self {
        Self {
            lautstaerke: FloatParam::new("Volume", util::db_to_gain(-12.0),
                FloatRange::Skewed { min: util::db_to_gain(-48.0), max: util::db_to_gain(0.0),
                                     factor: FloatRange::gain_skew_factor(-48.0, 0.0) })
                .with_smoother(SmoothingStyle::Logarithmic(20.0))
                .with_unit(" dB")
                .with_value_to_string(formatters::v2s_f32_gain_to_db(1))
                .with_string_to_value(formatters::s2v_f32_gain_to_db()),
            knob1: knob(1),
            knob2: knob(2),
            knob3: knob(3),
            knob4: knob(4),
            knob5: knob(5),
            knob6: knob(6),
            knob7: knob(7),
            knob8: knob(8),
            knob9: knob(9),
            knob10: knob(10),
            knob11: knob(11),
            knob12: knob(12),
            knob13: knob(13),
            knob14: knob(14),
            knob15: knob(15),
            knob16: knob(16),
            knob17: knob(17),
            knob18: knob(18),
            knob19: knob(19),
            knob20: knob(20),
            knob21: knob(21),
            knob22: knob(22),
            knob23: knob(23),
            knob24: knob(24),
            knob25: knob(25),
            knob26: knob(26),
            knob27: knob(27),
            knob28: knob(28),
            knob29: knob(29),
            knob30: knob(30),
            knob31: knob(31),
            knob32: knob(32),
            knob33: knob(33),
            knob34: knob(34),
            knob35: knob(35),
            knob36: knob(36),
            knob37: knob(37),
            knob38: knob(38),
            knob39: knob(39),
            knob40: knob(40),
            knob41: knob(41),
            knob42: knob(42),
            knob43: knob(43),
            knob44: knob(44),
            knob45: knob(45),
            knob46: knob(46),
            knob47: knob(47),
            knob48: knob(48),
            knob49: knob(49),
            knob50: knob(50),
            knob51: knob(51),
            knob52: knob(52),
            knob53: knob(53),
            knob54: knob(54),
            knob55: knob(55),
            knob56: knob(56),
            knob57: knob(57),
            knob58: knob(58),
            knob59: knob(59),
            knob60: knob(60),
            knob61: knob(61),
            knob62: knob(62),
            knob63: knob(63),
            knob64: knob(64),
        }
    }
}

impl Default for Modular {
    fn default() -> Self { Self { params: Arc::new(ModularParams::default()), programm: None, knoepfe: Knoepfe::neu([0.5; REGLER], 48_000.0) } }
}

impl Plugin for Modular {
    const NAME: &'static str = "Cypher Modular";
    const VENDOR: &'static str = "cypher-dj";
    const URL: &'static str = "";
    const EMAIL: &'static str = "";
    const VERSION: &'static str = env!("CARGO_PKG_VERSION");
    const AUDIO_IO_LAYOUTS: &'static [AudioIOLayout] = &[AudioIOLayout {
        main_input_channels: None,
        main_output_channels: NonZeroU32::new(2),
        ..AudioIOLayout::const_default()
    }];
    const MIDI_INPUT: MidiConfig = MidiConfig::Basic;
    const SAMPLE_ACCURATE_AUTOMATION: bool = true;
    type SysExMessage = ();
    type BackgroundTask = ();

    fn params(&self) -> Arc<dyn Params> { self.params.clone() }

    fn initialize(&mut self, _l: &AudioIOLayout, b: &BufferConfig, _c: &mut impl InitContext<Self>) -> bool {
        let pfad = std::env::var("CYPHERDJ_BAUKASTEN_GRAPH").ok();
        let (p, herkunft) = lade(pfad.as_deref(), b.sample_rate);
        match &herkunft {
            Herkunft::Verworfen(f) => nih_log!("Cypher Modular: graph rejected, playing built-in: {f}"),
            Herkunft::DateiFehlt(f) => nih_log!("Cypher Modular: no graph file at {f}, playing built-in"),
            Herkunft::Datei(f) => nih_log!("Cypher Modular: graph file {f}"),
            Herkunft::Eingebaut => {}
        }
        nih_log!("Cypher Modular: graph '{}' with {} voices", p.name, p.stimmen);
        for (nr, name) in &p.regler_namen {
            nih_log!("Cypher Modular: Knob {nr} = {name}");
        }
        self.knoepfe = Knoepfe::neu(p.regler_vorgaben(), b.sample_rate);
        self.programm = Some(p);
        true
    }

    fn reset(&mut self) {
        if let Some(p) = self.programm.as_mut() {
            p.zuruecksetzen();
        }
    }

    fn process(&mut self, buffer: &mut Buffer, _aux: &mut AuxiliaryBuffers, ctx: &mut impl ProcessContext<Self>) -> ProcessStatus {
        let Some(p) = self.programm.as_mut() else { return ProcessStatus::Normal };
        let mut ev = ctx.next_event();
        for (i, mut kanaele) in buffer.iter_samples().enumerate() {
            while let Some(e) = ev {
                if e.timing() > i as u32 {
                    break;
                }
                match e {
                    NoteEvent::NoteOn { note, velocity, .. } => p.note_an(note, velocity),
                    NoteEvent::NoteOff { note, .. } => p.note_aus(note),
                    _ => {}
                }
                ev = ctx.next_event();
            }
            let (l, r) = sample(p, &self.params, &mut self.knoepfe);
            for (k, smp) in kanaele.iter_mut().enumerate() {
                *smp = kanal(k, l, r);
            }
        }
        ProcessStatus::KeepAlive
    }
}

/// Kanal 0 links, jeder weitere rechts (Slice 2b; das Layout hat genau zwei)
#[inline]
fn kanal(k: usize, l: f32, r: f32) -> f32 { if k == 0 { l } else { r } }

/// Ein Sample (links, rechts): Knobs (geglättet, unberührte mit der Vorgabe des Graphen) an die Regler des Graphen, dann der
/// Graph mal Lautstärke. Eigene Funktion, damit der Unit-Test den Weg Knob → Klang ohne Host prüfen kann.
#[inline]
fn sample(p: &mut Programm, params: &ModularParams, z: &mut Knoepfe) -> (f32, f32) {
    let knobs = params.knobs();
    sample_mit(p, params, z, |i| knobs[i].value())
}

/// Like `sample`, with the parameters' plain values given (the tests cannot write a nih-plug parameter from outside the crate;
/// they pass what the host wrote and set the smoother target as the wrapper does).
#[inline]
fn sample_mit(p: &mut Programm, params: &ModularParams, z: &mut Knoepfe, wert: impl Fn(usize) -> f32) -> (f32, f32) {
    let knobs = params.knobs();
    for (i, k) in knobs.into_iter().enumerate() {
        p.setze_regler(i + 1, z.wert(i, wert(i), &k.smoothed));
    }
    let (l, r) = p.sample_stereo();
    let v = params.lautstaerke.smoothed.next();
    (l * v, r * v)
}

impl Vst3Plugin for Modular {
    const VST3_CLASS_ID: [u8; 16] = *b"CypherDjModulrS1";
    const VST3_SUBCATEGORIES: &'static [Vst3SubCategory] = &[Vst3SubCategory::Instrument, Vst3SubCategory::Synth];
}

nih_export_vst3!(Modular);

#[cfg(test)]
mod tests {
    use super::*;

    use std::alloc::{GlobalAlloc, Layout, System};
    use std::cell::Cell;

    const SR: f32 = 48_000.0;

    thread_local! { static ANFORDERUNGEN: Cell<usize> = const { Cell::new(0) }; }
    struct Zaehlend;
    unsafe impl GlobalAlloc for Zaehlend {
        unsafe fn alloc(&self, l: Layout) -> *mut u8 { ANFORDERUNGEN.with(|c| c.set(c.get() + 1)); System.alloc(l) }
        unsafe fn dealloc(&self, p: *mut u8, l: Layout) { System.dealloc(p, l) }
        unsafe fn realloc(&self, p: *mut u8, l: Layout, n: usize) -> *mut u8 { ANFORDERUNGEN.with(|c| c.set(c.get() + 1)); System.realloc(p, l, n) }
    }
    #[global_allocator]
    static A: Zaehlend = Zaehlend;

    /// A knob `nr` straight into the output (DC = knob value), with an optional `vorgabe`.
    fn dc_graph(nr: usize, vorgabe: Option<f32>) -> String {
        let v = vorgabe.map(|v| format!(",\"vorgabe\":{v}")).unwrap_or_default();
        format!(r#"{{"format":"baukasten/2","name":"k","stimmen":1,"knoten":[{{"id":"r","art":"regler","nr":{nr},"min":0,"max":1{v}}},{{"id":"a","art":"ausgang"}}],"kanten":[{{"von":"r.aus","nach":"a.x"}}]}}"#)
    }

    /// What a host does to the plug-in, as far as it can be done from outside nih-plug: the wrapper stores the plain value in the
    /// parameter (here `werte`, read by `sample_mit`) and sets the smoother target. Untouched knobs hold the sentinel.
    struct Host { werte: [f32; REGLER] }
    impl Host {
        fn neu() -> Self { Self { werte: [KNOPF_UNBERUEHRT; REGLER] } }
        fn schreibe(&mut self, params: &ModularParams, nr: usize, v: f32) {
            self.werte[nr - 1] = v;
            params.knobs()[nr - 1].smoothed.set_target(SR, v);
        }
        fn sample(&self, p: &mut Programm, params: &ModularParams, z: &mut Knoepfe) -> f32 {
            sample_mit(p, params, z, |i| self.werte[i]).0
        }
        fn lauf(&self, p: &mut Programm, params: &ModularParams, z: &mut Knoepfe, n: usize) -> Vec<f32> {
            (0..n).map(|_| self.sample(p, params, z)).collect()
        }
    }

    fn aufbau(json: &str) -> (Programm, ModularParams, Knoepfe, Host) {
        let p = baukasten_dsp::uebersetze(json, SR).unwrap();
        let params = ModularParams::default();
        params.lautstaerke.smoothed.reset(1.0);
        let z = Knoepfe::neu(p.regler_vorgaben(), SR);
        (p, params, z, Host::neu())
    }

    #[test]
    fn knob_erreicht_den_klang() {
        // Knob 1 sets a DC: knob -> setze_regler -> regler -> ausgang, as process goes it
        let (mut p, params, mut z, mut h) = aufbau(&dc_graph(1, None));
        h.schreibe(&params, 1, 0.25);
        let x = h.lauf(&mut p, &params, &mut z, 1000);
        assert!((x[999] - 0.25).abs() < 1e-6, "{}", x[999]);
        h.schreibe(&params, 1, 0.75);
        let x = h.lauf(&mut p, &params, &mut z, 1000);
        assert!((x[999] - 0.75).abs() < 1e-6, "{}", x[999]);
    }

    #[test]
    fn knob_glaettet_20_ms() {
        // a jump 0 -> 1 arrives linearly over 20 ms (960 samples at 48 kHz), not in the first sample
        let (mut p, params, mut z, mut h) = aufbau(&dc_graph(1, Some(0.0)));
        h.schreibe(&params, 1, 1.0);
        let x = h.lauf(&mut p, &params, &mut z, 1000);
        assert!(x[0] < 0.01, "first sample {}", x[0]);
        assert!((x[479] - 0.5).abs() < 0.01, "after 10 ms {}", x[479]);
        assert!((x[999] - 1.0).abs() < 1e-6, "after 20 ms {}", x[999]);
    }

    #[test]
    fn vierundsechzig_knobs_mit_namen_und_vorgabe() {
        let p = ModularParams::default();
        let namen: Vec<String> = p.knobs().iter().map(|k| k.name().to_string()).collect();
        assert_eq!(namen, (1..=64).map(|n| format!("Knob {n}")).collect::<Vec<_>>());
        // the static default is the "untouched" sentinel; hosts show it as 0.500
        assert!(p.knobs().iter().all(|k| k.default_plain_value().to_bits() == KNOPF_UNBERUEHRT.to_bits()));
        assert!(p.knobs().iter().all(|k| k.value().to_bits() == KNOPF_UNBERUEHRT.to_bits()));
        assert_eq!(format!("{:.3}", KNOPF_UNBERUEHRT), "0.500");
        let ids: Vec<String> = p.param_map().into_iter().map(|(id, _, _)| id).collect();
        assert_eq!(ids.len(), 65, "{ids:?}");
        // ids and order of the original 33 stay (hosts store state by id), knob33..knob64 are appended
        let mut soll = vec!["lautstaerke".to_string()];
        soll.extend((1..=64).map(|n| format!("knob{n}")));
        assert_eq!(ids, soll);
    }

    #[test]
    fn knob_64_erreicht_den_klang() {
        // the top knob goes the same way as knob 1: parameter -> setze_regler(64) -> regler node nr 64
        let (mut p, params, mut z, mut h) = aufbau(&dc_graph(64, None));
        h.schreibe(&params, 64, 0.3);
        assert!((h.lauf(&mut p, &params, &mut z, 1000)[999] - 0.3).abs() < 1e-6);
        h.schreibe(&params, 64, 0.9);
        assert!((h.lauf(&mut p, &params, &mut z, 1000)[999] - 0.9).abs() < 1e-6);
        // knob 9 has no node here and leaves the level alone
        h.schreibe(&params, 9, 0.1);
        assert!((h.lauf(&mut p, &params, &mut z, 1000)[999] - 0.9).abs() < 1e-6);
    }

    #[test]
    fn host_state_nur_mit_knob1_bis_32_laesst_33_bis_64_unberuehrt() {
        // knobs 33..64 were never written: they feed the graph's vorgabe (0.5 without one), knob 1 holds the stored value
        let (mut p, params, mut z, mut h) = aufbau(&dc_graph(40, Some(0.3)));
        for nr in 1..=32 { h.schreibe(&params, nr, 0.9); }
        assert_eq!(h.sample(&mut p, &params, &mut z), 0.3);
        assert_eq!(p.regler_vorgaben()[39], 0.3);
        assert_eq!(p.regler_vorgaben()[32], 0.5);
    }

    // --- VST3 default: the graph's vorgabe until the host moves a knob (plan Task 5, tests a to h) ---

    const G5: fn() -> String = || dc_graph(5, Some(0.2));

    #[test]
    fn a_frisches_plugin_spielt_die_vorgabe_des_graphen() {
        let (mut p, params, mut z, h) = aufbau(&G5());
        let x = h.lauf(&mut p, &params, &mut z, 4800);
        // the engine render at its own start value
        let mut q = baukasten_dsp::uebersetze(&G5(), SR).unwrap();
        let y: Vec<f32> = (0..4800).map(|_| q.sample_stereo().0).collect();
        assert_eq!(x[0], 0.2);
        assert_eq!(x.iter().map(|v| v.to_bits()).collect::<Vec<_>>(), y.iter().map(|v| v.to_bits()).collect::<Vec<_>>());
    }

    #[test]
    fn b_host_bewegt_den_knopf_ohne_sprung() {
        let (mut p, params, mut z, mut h) = aufbau(&G5());
        h.lauf(&mut p, &params, &mut z, 100);
        h.schreibe(&params, 5, 0.9);
        let x = h.lauf(&mut p, &params, &mut z, 4800);
        // one smoother step (0.7 / 960 = 7.3e-4) away from the sound that was heard, not a jump (the plan's 1e-6 would need a
        // first sample without a step, which differs from the old plug-in's ramp and breaks test e)
        assert!((x[0] - 0.2).abs() < 1e-3 && x[0] > 0.2, "first sample after the write {}", x[0]);
        assert!(x.windows(2).all(|w| w[1] >= w[0]), "monotone rise");
        assert!(x.iter().all(|&v| v <= 0.9), "never above 0.9");
        assert!((x[4799] - 0.9).abs() < 1e-3, "after 100 ms {}", x[4799]);
    }

    #[test]
    fn c_dann_exakt_halb_rampt_zu_halb_und_bleibt_beruehrt() {
        let (mut p, params, mut z, mut h) = aufbau(&G5());
        h.schreibe(&params, 5, 0.9);
        h.lauf(&mut p, &params, &mut z, 4800);
        h.schreibe(&params, 5, 0.5);
        let x = h.lauf(&mut p, &params, &mut z, 4800);
        assert!(x.windows(2).all(|w| w[1] <= w[0]));
        assert!((x[4799] - 0.5).abs() < 1e-6, "{}", x[4799]);
        let y = h.lauf(&mut p, &params, &mut z, 4800);
        assert!(y.iter().all(|&v| (v - 0.5).abs() < 1e-6), "stays at 0.5, does not fall back to the vorgabe");
        assert_eq!(z.stand[4], Stand::Beruehrt);
    }

    #[test]
    fn d_state_mit_halb_bleibt_halb() {
        // a host state from before this change stores 0.5: restored as 0.5 it is not the sentinel, so it is explicit
        assert_ne!(0.5f32.to_bits(), KNOPF_UNBERUEHRT.to_bits());
        let (mut p, params, mut z, mut h) = aufbau(&G5());
        h.werte[4] = 0.5; // restored before the first sample (the wrapper also sets the smoother, here via reset to 0.5)
        params.knob5.smoothed.reset(0.5);
        let x = h.lauf(&mut p, &params, &mut z, 4800);
        assert!((x[4799] - 0.5).abs() < 1e-6 && x.iter().all(|&v| v >= 0.2), "{}", x[4799]);
        assert_eq!(z.stand[4], Stand::Beruehrt);
    }

    #[test]
    fn g_direkt_halb_auf_frischem_plugin_zaehlt_als_beruehrt() {
        // the host writes exactly 0.5 (the former static default) before the first sample: the graph's vorgabe 0.2 must not win
        let (mut p, params, mut z, mut h) = aufbau(&G5());
        h.schreibe(&params, 5, 0.5);
        let x = h.lauf(&mut p, &params, &mut z, 4800);
        assert!((x[4799] - 0.5).abs() < 1e-6, "{}", x[4799]);
        assert!(x.windows(2).all(|w| w[1] >= w[0]), "ramps from the sound that was heard (0.2) to 0.5, no fall back");
    }

    #[test]
    fn h_sentinel_nach_beruehrung_rampt_zur_vorgabe_zurueck() {
        let (mut p, params, mut z, mut h) = aufbau(&G5());
        h.schreibe(&params, 5, 0.9);
        h.lauf(&mut p, &params, &mut z, 4800);
        h.schreibe(&params, 5, KNOPF_UNBERUEHRT); // host "reset to default"
        let x = h.lauf(&mut p, &params, &mut z, 4800);
        assert!((x[0] - 0.9).abs() < 1e-3, "no jump: {}", x[0]);
        assert!(x.windows(2).all(|w| w[1] <= w[0]), "monotone fall");
        assert!((x[4799] - 0.2).abs() < 1e-6, "{}", x[4799]);
        assert_eq!(z.stand[4], Stand::Unberuehrt);
        // and untouched again: the vorgabe, a new touch starts from it
        h.schreibe(&params, 5, 0.6);
        let y = h.lauf(&mut p, &params, &mut z, 4800);
        assert!((y[0] - 0.2).abs() < 1e-3, "{}", y[0]);
        assert!((y[4799] - 0.6).abs() < 1e-6);
    }

    #[test]
    fn sentinel_ueberlebt_normalisierung_und_state() {
        // linear 0..1: plain -> normalized (f32) -> f64 (the VST3 wire) -> f32 -> plain gives the same bits
        let k = knob(1);
        let ptr = k.as_ptr();
        let n = unsafe { ptr.preview_normalized(KNOPF_UNBERUEHRT) };
        let ueber_draht = (n as f64) as f32;
        let zurueck = unsafe { ptr.preview_plain(ueber_draht) };
        assert_eq!(zurueck.to_bits(), KNOPF_UNBERUEHRT.to_bits());
        assert_eq!(unsafe { ptr.default_plain_value() }.to_bits(), KNOPF_UNBERUEHRT.to_bits());
        // the state file stores the plain f32 through serde_json
        let s = serde_json::to_string(&nih_plug::wrapper::state::ParamValue::F32(KNOPF_UNBERUEHRT)).unwrap();
        match serde_json::from_str::<nih_plug::wrapper::state::ParamValue>(&s).unwrap() {
            nih_plug::wrapper::state::ParamValue::F32(v) => assert_eq!(v.to_bits(), KNOPF_UNBERUEHRT.to_bits(), "{s}"),
            other => panic!("{other:?}"),
        }
        // both neighbours of 0.5 stay different values (nobody writes the sentinel by accident)
        assert_ne!(KNOPF_UNBERUEHRT, 0.5);
        assert_eq!(KNOPF_UNBERUEHRT, f32::from_bits(0.5f32.to_bits() - 2));
    }

    fn probe_wurzel() -> std::path::PathBuf {
        let w = std::env::temp_dir().join(format!("bk-vst3-t5-{}", std::process::id()));
        std::fs::create_dir_all(&w).unwrap();
        let sr = 48_000.0;
        std::fs::write(w.join("orchester-schlag.f32"), baukasten_dsp::proben::bytes(&baukasten_dsp::proben::orchester_schlag(sr))).unwrap();
        std::fs::write(w.join("orchester-schlag-schichten.f32"), baukasten_dsp::proben::bytes(&baukasten_dsp::proben::orchester_schlag_schichten(sr))).unwrap();
        std::fs::write(w.join("feder-ir.f32"), baukasten_dsp::proben::bytes(&baukasten_dsp::proben::feder_ir(sr))).unwrap();
        w
    }

    /// Reference: the plug-in as it was before the change (every knob smoothed from the static default 0.5 to the host value).
    fn alt(p: &mut Programm, params: &ModularParams) -> (f32, f32) {
        for (nr, k) in params.knobs().into_iter().enumerate() { p.setze_regler(nr + 1, k.smoothed.next()); }
        let (l, r) = p.sample_stereo();
        let v = params.lautstaerke.smoothed.next();
        (l * v, r * v)
    }

    #[test]
    fn e_beispiele_ohne_vorgabe_verhalten_sich_wie_bisher() {
        let wurzel = probe_wurzel();
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../modular_dsp/demos");
        let mut namen: Vec<_> = std::fs::read_dir(&dir).unwrap().map(|e| e.unwrap().path()).filter(|p| p.extension().is_some_and(|e| e == "json")).collect();
        namen.sort();
        assert!(namen.len() > 50, "found {} graphs", namen.len());
        let mut geprueft = 0;
        for pfad in namen {
            let json = std::fs::read_to_string(&pfad).unwrap();
            let name = pfad.file_name().unwrap().to_string_lossy().to_string();
            let neu = || baukasten_dsp::uebersetze_mit_wurzel(&json, SR, Some(&wurzel)).unwrap_or_else(|e| panic!("{name}: {e}"));
            if neu().regler_vorgaben().iter().any(|&v| v != 0.5) { continue; } // graphs with a vorgabe are Task 8's business
            for fall in 0..2 {
                // case 0: nothing touched (old: all knobs at 0.5). case 1: every knob gets a pseudo-random value
                let werte: Vec<f32> = (0..REGLER).map(|i| if fall == 0 { 0.5 } else { ((i * 7919 + 13) % 997) as f32 / 996.0 }).collect();
                let (mut pa, mut pn) = (neu(), neu());
                let (params_a, params_n) = (ModularParams::default(), ModularParams::default());
                for ps in [&params_a, &params_n] { ps.lautstaerke.smoothed.reset(0.5); }
                let mut z = Knoepfe::neu(pn.regler_vorgaben(), SR);
                let mut h = Host::neu();
                if fall == 1 {
                    for (i, w) in werte.iter().enumerate() {
                        params_a.knobs()[i].smoothed.reset(0.5);
                        params_a.knobs()[i].smoothed.set_target(SR, *w);
                        h.schreibe(&params_n, i + 1, *w);
                    }
                } else {
                    for k in params_a.knobs() { k.smoothed.reset(0.5); }
                }
                pa.note_an(57, 0.8); pn.note_an(57, 0.8);
                pa.note_an(64, 0.6); pn.note_an(64, 0.6);
                for i in 0..4800 {
                    let a = alt(&mut pa, &params_a);
                    let n = sample_mit(&mut pn, &params_n, &mut z, |k| h.werte[k]);
                    assert_eq!((a.0.to_bits(), a.1.to_bits()), (n.0.to_bits(), n.1.to_bits()), "{name} case {fall} sample {i}");
                }
            }
            geprueft += 1;
        }
        assert!(geprueft > 50, "only {geprueft} graphs compared");
    }

    #[test]
    fn f_kein_alloc_im_echtzeitpfad_mit_der_knopflogik() {
        let (mut p, params, mut z, mut h) = aufbau(&G5());
        p.note_an(60, 0.7);
        h.lauf(&mut p, &params, &mut z, 256); // warm-up
        let vor = ANFORDERUNGEN.with(|c| c.get());
        let mut lauf = |h: &Host, n: usize| for _ in 0..n { std::hint::black_box(h.sample(&mut p, &params, &mut z)); };
        h.schreibe(&params, 5, 0.9);
        lauf(&h, 2000);
        h.schreibe(&params, 5, KNOPF_UNBERUEHRT);
        lauf(&h, 2000);
        h.schreibe(&params, 40, 0.5);
        lauf(&h, 2000);
        assert_eq!(ANFORDERUNGEN.with(|c| c.get()), vor, "touch, return and plain playback allocate nothing");
    }


    #[inline(never)]
    fn knoepfe_setzen(p: &mut Programm, params: &ModularParams, z: &mut Knoepfe, werte: &[f32; REGLER]) {
        let kn = params.knobs();
        for (i, k) in kn.into_iter().enumerate() { p.setze_regler(i + 1, z.wert(i, werte[i], &k.smoothed)); }
    }

    /// Cost of the knob loop in `sample()` (plan Task 5, step 3). Ignored: needs a quiet machine and the real-time lock, see
    /// `~/messungen/2026-11-11-synth-ausbau/vst3-64-kosten.md`. Variants run round-robin block by block, so every variant sees
    /// the same load (the harness's `relativ` mode): A old loop with 32 smoothers, B old loop with 64, C new loop 64 knobs all
    /// untouched, D new loop 64 knobs all touched and settled. Each with the synth-poly engine (8 voices sounding) and as the
    /// knob loop alone (`setze_regler` only); every knob holds exactly 0.5 in all variants so the engine does the same work.
    #[test]
    #[ignore]
    fn kosten_knopfschleife() {
        use std::time::Instant;
        let pfad = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../modular_dsp/demos/synth-poly.json");
        let json = std::fs::read_to_string(&pfad).unwrap();
        let wurzel = probe_wurzel();
        let neu = || baukasten_dsp::uebersetze_mit_wurzel(&json, SR, Some(&wurzel)).unwrap();
        let params = ModularParams::default();
        params.lautstaerke.smoothed.reset(0.5);
        let mut pa = neu(); let mut pb = neu(); let mut pc = neu(); let mut pd = neu();
        for p in [&mut pa, &mut pb, &mut pc, &mut pd] { for n in 0..8 { p.note_an(40 + n, 0.8); } }
        let (zeiger_a, zeiger_b) = (ModularParams::default(), ModularParams::default());
        // same engine workload in every variant: all knobs exactly 0.5 (the untouched variant feeds the vorgabe 0.5 of this graph)
        for k in zeiger_a.knobs().into_iter().chain(zeiger_b.knobs()) { k.smoothed.reset(0.5); }
        assert!(pc.regler_vorgaben().iter().all(|&v| v == 0.5));
        let mut zc = Knoepfe::neu(pc.regler_vorgaben(), SR);
        let mut zd = Knoepfe::neu(pd.regler_vorgaben(), SR);
        let mut hd = Host::neu();
        let hc = Host::neu();
        for i in 1..=REGLER { hd.schreibe(&params, i, 0.5); }
        // settle the touched variant (ramps done)
        for _ in 0..4000 { hd.sample(&mut pd, &params, &mut zd); }
        let block = 256;
        let mut pe = neu(); for n in 0..8 { pe.note_an(40 + n, 0.8); }
        let mut zeiten = vec![vec![Vec::<f64>::new(); 7]; 2];
        let mut pg = neu(); for n in 0..8 { pg.note_an(40 + n, 0.8); } let mut zg = Knoepfe::neu(pg.regler_vorgaben(), SR);
        let mut pf = neu(); for n in 0..8 { pf.note_an(40 + n, 0.8); } let mut zf = Knoepfe::neu(pf.regler_vorgaben(), SR); // [mit_engine][variante]
        let mut senke = 0.0f32;
        for runde in 0..4200 {
            for mit_engine in [true, false] {
                for v in 0..7 {
                    let t = Instant::now();
                    for _ in 0..block {
                        match v {
                            0 => { for (nr, k) in zeiger_a.knobs().into_iter().take(32).enumerate() { pa.setze_regler(nr + 1, k.smoothed.next()); } if mit_engine { senke += pa.sample_stereo().0; } }
                            1 => { for (nr, k) in zeiger_b.knobs().into_iter().enumerate() { pb.setze_regler(nr + 1, k.smoothed.next()); } if mit_engine { senke += pb.sample_stereo().0; } }
                            2 => { if mit_engine { senke += sample_mit(&mut pc, &params, &mut zc, |i| hc.werte[i]).0; } else { let kn = params.knobs(); for (i, k) in kn.into_iter().enumerate() { pc.setze_regler(i + 1, zc.wert(i, hc.werte[i], &k.smoothed)); } } }
                            5 => { let kn = params.knobs(); for (i, k) in kn.into_iter().enumerate() { pf.setze_regler(i + 1, zf.wert(i, hc.werte[i], &k.smoothed)); } if mit_engine { let (l, r) = pf.sample_stereo(); senke += l + r; } }
                            6 => { knoepfe_setzen(&mut pg, &params, &mut zg, &hc.werte); if mit_engine { let (l, r) = pg.sample_stereo(); senke += l + r; } }
                            4 => { if mit_engine { senke += alt(&mut pe, &zeiger_b).0; } else { for (nr, k) in zeiger_b.knobs().into_iter().enumerate() { pe.setze_regler(nr + 1, k.smoothed.next()); } } }
                            _ => { if mit_engine { senke += sample_mit(&mut pd, &params, &mut zd, |i| hd.werte[i]).0; } else { let kn = params.knobs(); for (i, k) in kn.into_iter().enumerate() { pd.setze_regler(i + 1, zd.wert(i, hd.werte[i], &k.smoothed)); } } }
                        }
                    }
                    let us = t.elapsed().as_secs_f64() * 1e6;
                    if runde >= 200 { zeiten[if mit_engine { 0 } else { 1 }][v].push(us); }
                }
            }
        }
        let q = |v: &mut Vec<f64>, p: f64| { v.sort_by(|a, b| a.partial_cmp(b).unwrap()); v[((v.len() - 1) as f64 * p) as usize] };
        let namen = ["A old 32", "B old 64", "C new 64 untouched", "D new 64 touched", "E old 64 incl. volume (alt())", "F new loop inline, no volume", "G new loop not inlined"];
        for (m, bez) in [(0, "with synth-poly engine"), (1, "knob loop alone")] {
            for v in 0..7 {
                let (p50, p99) = (q(&mut zeiten[m][v], 0.5), q(&mut zeiten[m][v], 0.99));
                println!("KOSTEN {bez} | {} | p50 {:.2} us | p99 {:.2} us (block 256 = 5333 us)", namen[v], p50, p99);
            }
        }
        println!("senke {senke}");
    }

    #[test]
    fn ohne_pfad_spielt_eingebaut() {
        let (p, h) = lade(None, 48_000.0);
        assert_eq!(p.name, "saege-ladder");
        assert_eq!(h, Herkunft::Eingebaut);
    }

    #[test]
    fn fehlende_datei_ist_kein_fehler_und_spielt_eingebaut() {
        let (p, h) = lade(Some("/nonexistent/graph.json"), 48_000.0);
        assert_eq!(p.name, "saege-ladder");
        assert_eq!(h, Herkunft::DateiFehlt("/nonexistent/graph.json".into()));
    }

    #[test]
    fn unlesbarer_pfad_wird_verworfen() {
        // ein Verzeichnis statt einer Datei: lesen scheitert anders als NotFound
        let (p, h) = lade(Some("/"), 48_000.0);
        assert_eq!(p.name, "saege-ladder");
        assert!(matches!(h, Herkunft::Verworfen(f) if f.starts_with("/:")));
    }

    #[test]
    fn fehlerhafter_graph_meldet_und_spielt_eingebaut() {
        let d = std::env::temp_dir().join(format!("baukasten-test-{}.json", std::process::id()));
        std::fs::write(&d, EINGEBAUT.replace("\"ladder\"", "\"zauber\"")).unwrap();
        let (p, h) = lade(d.to_str(), 48_000.0);
        std::fs::remove_file(&d).unwrap();
        assert_eq!(p.name, "saege-ladder");
        assert!(matches!(h, Herkunft::Verworfen(f) if f.contains("UnbekannteArt")));
    }

    #[test]
    fn gueltige_datei_wird_gespielt() {
        let d = std::env::temp_dir().join(format!("baukasten-test-ok-{}.json", std::process::id()));
        std::fs::write(&d, EINGEBAUT.replace("\"name\": \"saege-ladder\"", "\"name\": \"eigen\"")).unwrap();
        let (p, h) = lade(d.to_str(), 48_000.0);
        std::fs::remove_file(&d).unwrap();
        assert_eq!(p.name, "eigen");
        assert!(matches!(h, Herkunft::Datei(_)));
    }

    #[test]
    fn links_und_rechts_kommen_getrennt_an() {
        // Kanal 0 links, Kanal 1 rechts: konst 0.25 auf l, 0.5 auf r
        let j = r#"{"format":"baukasten/2","name":"lr","stimmen":1,"knoten":[{"id":"a","art":"konst","wert":0.25},{"id":"b","art":"konst","wert":0.5},{"id":"o","art":"ausgang"}],"kanten":[{"von":"a.aus","nach":"o.l"},{"von":"b.aus","nach":"o.r"}]}"#;
        let mut p = baukasten_dsp::uebersetze(j, 48_000.0).unwrap();
        let params = ModularParams::default();
        let mut z = Knoepfe::neu(p.regler_vorgaben(), 48_000.0);
        // Lautstärke 0,5: muss auf beiden Seiten wirken
        params.lautstaerke.smoothed.reset(0.5);
        assert_eq!(sample(&mut p, &params, &mut z), (0.125, 0.25));
        assert_eq!((kanal(0, 0.25, 0.5), kanal(1, 0.25, 0.5)), (0.25, 0.5), "Kanal 0 links, Kanal 1 rechts");
    }
}
