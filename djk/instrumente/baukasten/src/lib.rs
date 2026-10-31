//! Cypher Modular: der Baukasten (baukasten_dsp) als VST3 für den Carla-Wirt. Den Graphen liest `initialize` (außerhalb
//! des Callbacks) aus $CYPHERDJ_BAUKASTEN_GRAPH; fehlt die Variable oder die Datei, spielt der eingebaute Graph
//! (baukasten_dsp/beispiele/saege-ladder.json). Ist die Datei fehlerhaft, spielt auch der eingebaute, und der Fehler
//! steht im Log des Wirts (Slice 1; sichtbar im Wirt-Status erst mit der Prüfung über djk-hand, Spec Slice 5).
//! Ein neuer Graph braucht in Slice 1 einen Neustart des Wirts (Spec E5 kommt in Slice 3). Die Kosten je Graph misst
//! Slice 1 offline (baukasten_dsp/tests/kosten_messung.rs); im Host liest sie erst die Kern-FFI (Slice 3).
//! Slice 2: acht Parameter „Knob 1“..„Knob 8“ (0..1, Vorgabe 0,5, 20 ms geglättet) gehen je Sample an die `regler`-Knoten
//! des Graphen. Der Wirt erreicht sie mit `{"befehl":"param","name":"Knob 1","wert":…}`; die Namen aus `regler_namen`
//! stehen im Log, die Parameter heißen fest, weil ein VST3 seine Parameterliste beim Laden festlegt.
//! Slice 2b: der Ausgang ist Stereo, Kanal 0 links und Kanal 1 rechts (`Programm::sample_stereo`); ein Graph ohne
//! `l`/`r` am Ausgang klingt auf beiden Kanälen gleich.
use baukasten_dsp::{uebersetze, Programm, REGLER};
use nih_plug::prelude::*;
use std::sync::Arc;

pub const EINGEBAUT: &str = include_str!("../../baukasten_dsp/beispiele/saege-ladder.json");

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
}

fn knob(nr: usize) -> FloatParam {
    FloatParam::new(format!("Knob {nr}"), 0.5, FloatRange::Linear { min: 0.0, max: 1.0 })
        .with_smoother(SmoothingStyle::Linear(20.0))
        .with_value_to_string(formatters::v2s_f32_rounded(3))
}

impl ModularParams {
    /// Knob 1..8 in Reihenfolge
    pub fn knobs(&self) -> [&FloatParam; REGLER] {
        [&self.knob1, &self.knob2, &self.knob3, &self.knob4, &self.knob5, &self.knob6, &self.knob7, &self.knob8]
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
        }
    }
}

impl Default for Modular {
    fn default() -> Self { Self { params: Arc::new(ModularParams::default()), programm: None } }
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
            let (l, r) = sample(p, &self.params);
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

/// Ein Sample (links, rechts): Knobs (geglättet) an die Regler des Graphen, dann der Graph mal Lautstärke. Eigene
/// Funktion, damit der Unit-Test den Weg Knob → Klang ohne Host prüfen kann.
#[inline]
fn sample(p: &mut Programm, params: &ModularParams) -> (f32, f32) {
    for (nr, k) in params.knobs().into_iter().enumerate() {
        p.setze_regler(nr + 1, k.smoothed.next());
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

    #[test]
    fn knob_erreicht_den_klang() {
        // Knob 1 stellt einen Gleichanteil: der Weg Knob → setze_regler → regler → ausgang, so wie process ihn geht
        let j = r#"{"format":"baukasten/2","name":"k","stimmen":1,"knoten":[{"id":"r","art":"regler","nr":1,"min":0,"max":1},{"id":"a","art":"ausgang"}],"kanten":[{"von":"r.aus","nach":"a.x"}]}"#;
        let mut p = baukasten_dsp::uebersetze(j, 48_000.0).unwrap();
        let params = ModularParams::default();
        params.lautstaerke.smoothed.reset(1.0);
        params.knob1.smoothed.reset(0.25);
        assert!((sample(&mut p, &params).0 - 0.25).abs() < 1e-6);
        params.knob1.smoothed.reset(0.75);
        assert!((sample(&mut p, &params).0 - 0.75).abs() < 1e-6);
    }

    #[test]
    fn knob_glaettet_20_ms() {
        // D11: ein Sprung von 0 auf 1 kommt linear über 20 ms an (960 Samples bei 48 kHz), nicht im ersten Sample
        let j = r#"{"format":"baukasten/2","name":"k","stimmen":1,"knoten":[{"id":"r","art":"regler","nr":1,"min":0,"max":1},{"id":"a","art":"ausgang"}],"kanten":[{"von":"r.aus","nach":"a.x"}]}"#;
        let mut p = baukasten_dsp::uebersetze(j, 48_000.0).unwrap();
        let params = ModularParams::default();
        params.lautstaerke.smoothed.reset(1.0);
        params.knob1.smoothed.reset(0.0);
        params.knob1.smoothed.set_target(48_000.0, 1.0);
        let x: Vec<f32> = (0..1000).map(|_| sample(&mut p, &params).0).collect();
        assert!(x[0] < 0.01, "erstes Sample {}", x[0]);
        assert!((x[479] - 0.5).abs() < 0.01, "nach 10 ms {}", x[479]);
        assert!((x[999] - 1.0).abs() < 1e-6, "nach 20 ms {}", x[999]);
    }

    #[test]
    fn acht_knobs_mit_namen_und_vorgabe() {
        let p = ModularParams::default();
        let namen: Vec<String> = p.knobs().iter().map(|k| k.name().to_string()).collect();
        assert_eq!(namen, (1..=8).map(|n| format!("Knob {n}")).collect::<Vec<_>>());
        assert!(p.knobs().iter().all(|k| k.default_plain_value() == 0.5));
        let ids: Vec<String> = p.param_map().into_iter().map(|(id, _, _)| id).collect();
        assert_eq!(ids.len(), 9, "{ids:?}");
        assert!((1..=8).all(|n| ids.contains(&format!("knob{n}"))));
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
        // Lautstärke 0,5: muss auf beiden Seiten wirken
        params.lautstaerke.smoothed.reset(0.5);
        assert_eq!(sample(&mut p, &params), (0.125, 0.25));
        assert_eq!((kanal(0, 0.25, 0.5), kanal(1, 0.25, 0.5)), (0.25, 0.5), "Kanal 0 links, Kanal 1 rechts");
    }
}
