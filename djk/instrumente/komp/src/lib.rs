//! Cypher Komp als VST3. Klangarbeit in `komp_dsp` (Giannoulis, Massberg, Reiss 2012).

use komp_dsp::{Einstellung, Komp};
use nih_plug::prelude::*;
use std::sync::atomic::Ordering;
use std::sync::Arc;

#[derive(Params)]
pub struct KompParams {
    #[id = "thresh"]
    pub schwelle: FloatParam,
    #[id = "ratio"]
    pub ratio: FloatParam,
    #[id = "knee"]
    pub knie: FloatParam,
    #[id = "attack"]
    pub attack: FloatParam,
    #[id = "release"]
    pub release: FloatParam,
    #[id = "makeup"]
    pub makeup: FloatParam,
    #[id = "mix"]
    pub mix: FloatParam,
    #[id = "extsc"]
    pub extern_sc: BoolParam,
    #[id = "schp"]
    pub sc_hp: FloatParam,
}

impl Default for KompParams {
    fn default() -> Self {
        let d = Einstellung::default();
        KompParams {
            schwelle: FloatParam::new("Threshold", d.schwelle_db as f32, FloatRange::Linear { min: -60.0, max: 0.0 })
                .with_step_size(0.1)
                .with_unit(" dB"),
            ratio: FloatParam::new("Ratio", d.ratio as f32, FloatRange::Skewed { min: 1.0, max: 20.0, factor: FloatRange::skew_factor(-1.5) })
                .with_step_size(0.01)
                .with_unit(":1"),
            knie: FloatParam::new("Knee", d.knie_db as f32, FloatRange::Linear { min: 0.0, max: 24.0 }).with_step_size(0.1).with_unit(" dB"),
            attack: FloatParam::new("Attack", d.attack_ms as f32, FloatRange::Skewed { min: 0.1, max: 100.0, factor: FloatRange::skew_factor(-2.0) })
                .with_step_size(0.01)
                .with_unit(" ms"),
            release: FloatParam::new("Release", d.release_ms as f32, FloatRange::Skewed { min: 10.0, max: 1000.0, factor: FloatRange::skew_factor(-1.5) })
                .with_step_size(0.1)
                .with_unit(" ms"),
            makeup: FloatParam::new("Makeup", d.makeup_db as f32, FloatRange::Linear { min: 0.0, max: 24.0 }).with_step_size(0.1).with_unit(" dB"),
            mix: FloatParam::new("Mix", d.mix as f32, FloatRange::Linear { min: 0.0, max: 1.0 })
                .with_unit(" %")
                .with_value_to_string(formatters::v2s_f32_percentage(0))
                .with_string_to_value(formatters::s2v_f32_percentage()),
            extern_sc: BoolParam::new("External SC", false),
            sc_hp: FloatParam::new("SC High-Pass", 0.0, FloatRange::Linear { min: 0.0, max: 300.0 })
                .with_step_size(1.0)
                .with_unit(" Hz")
                .with_value_to_string(Arc::new(|v| if v < 1.0 { "Off".into() } else { format!("{v:.0}") })),
        }
    }
}

impl KompParams {
    fn einstellung(&self) -> Einstellung {
        Einstellung {
            schwelle_db: self.schwelle.value() as f64,
            ratio: self.ratio.value() as f64,
            knie_db: self.knie.value() as f64,
            attack_ms: self.attack.value() as f64,
            release_ms: self.release.value() as f64,
            makeup_db: self.makeup.value() as f64,
            mix: self.mix.value() as f64,
            sc_hochpass_hz: self.sc_hp.value() as f64,
        }
    }
}

pub struct CypherKomp {
    params: Arc<KompParams>,
    komp: Option<Komp>,
    letzte: Option<Einstellung>,
    /// Absenkung in dB für eine spätere Anzeige (Editor); wird je Block geschrieben
    pub gr_db: Arc<AtomicF32>,
}

impl Default for CypherKomp {
    fn default() -> Self {
        CypherKomp { params: Arc::new(KompParams::default()), komp: None, letzte: None, gr_db: Arc::new(AtomicF32::new(0.0)) }
    }
}

impl Plugin for CypherKomp {
    const NAME: &'static str = "Cypher Komp";
    const VENDOR: &'static str = "Cypher";
    const URL: &'static str = "";
    const EMAIL: &'static str = "";
    const VERSION: &'static str = env!("CARGO_PKG_VERSION");

    // Stereo mit Sidechain-Eingang (Aux, stereo); wirkt nur mit „External SC“ an
    const AUDIO_IO_LAYOUTS: &'static [AudioIOLayout] = &[AudioIOLayout {
        main_input_channels: NonZeroU32::new(2),
        main_output_channels: NonZeroU32::new(2),
        aux_input_ports: &[new_nonzero_u32(2)],
        names: PortNames { aux_inputs: &["Sidechain"], ..PortNames::const_default() },
        ..AudioIOLayout::const_default()
    }];
    const MIDI_INPUT: MidiConfig = MidiConfig::None;
    const SAMPLE_ACCURATE_AUTOMATION: bool = false;
    type SysExMessage = ();
    type BackgroundTask = ();

    fn params(&self) -> Arc<dyn Params> {
        self.params.clone()
    }

    fn initialize(&mut self, _l: &AudioIOLayout, cfg: &BufferConfig, _c: &mut impl InitContext<Self>) -> bool {
        let mut k = Komp::neu(cfg.sample_rate as f64);
        let e = self.params.einstellung();
        k.setze(&e);
        self.letzte = Some(e);
        self.komp = Some(k);
        true
    }

    fn reset(&mut self) {
        if let Some(k) = self.komp.as_mut() {
            k.leeren();
        }
    }

    fn process(&mut self, buffer: &mut Buffer, aux: &mut AuxiliaryBuffers, _c: &mut impl ProcessContext<Self>) -> ProcessStatus {
        let e = self.params.einstellung();
        let Some(k) = self.komp.as_mut() else { return ProcessStatus::Normal };
        if self.letzte != Some(e) {
            k.setze(&e);
            self.letzte = Some(e);
        }
        let extern_sc = self.params.extern_sc.value();
        if let [l, r] = buffer.as_slice() {
            match aux.inputs.first_mut().map(|b| b.as_slice_immutable()) {
                Some([sl, sr]) if extern_sc => k.block(l, r, Some((sl, sr))),
                _ => k.block(l, r, None),
            }
        }
        self.gr_db.store(k.gr_db() as f32, Ordering::Relaxed);
        ProcessStatus::Normal
    }
}

impl Vst3Plugin for CypherKomp {
    const VST3_CLASS_ID: [u8; 16] = *b"CypherKompFFLog1";
    const VST3_SUBCATEGORIES: &'static [Vst3SubCategory] = &[Vst3SubCategory::Fx, Vst3SubCategory::Dynamics, Vst3SubCategory::Stereo];
}

nih_export_vst3!(CypherKomp);
