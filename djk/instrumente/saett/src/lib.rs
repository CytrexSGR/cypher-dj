//! Cypher Saett als VST3. Klangarbeit in `saett_dsp` (tanh, ADAA1 nach Bilbao et al. 2017, doppelte Abtastrate).

use nih_plug::prelude::*;
use saett_dsp::{Einstellung, Saett};
use std::sync::Arc;

#[derive(Params)]
pub struct SaettParams {
    #[id = "drive"]
    pub drive: FloatParam,
    #[id = "out"]
    pub ausgang: FloatParam,
    #[id = "mix"]
    pub mix: FloatParam,
}

impl Default for SaettParams {
    fn default() -> Self {
        let d = Einstellung::default();
        SaettParams {
            drive: FloatParam::new("Drive", d.drive_db as f32, FloatRange::Linear { min: 0.0, max: 36.0 }).with_step_size(0.1).with_unit(" dB"),
            ausgang: FloatParam::new("Output", d.ausgang_db as f32, FloatRange::Linear { min: -24.0, max: 12.0 }).with_step_size(0.1).with_unit(" dB"),
            mix: FloatParam::new("Mix", d.mix as f32, FloatRange::Linear { min: 0.0, max: 1.0 })
                .with_unit(" %")
                .with_value_to_string(formatters::v2s_f32_percentage(0))
                .with_string_to_value(formatters::s2v_f32_percentage()),
        }
    }
}

impl SaettParams {
    fn einstellung(&self) -> Einstellung {
        Einstellung { drive_db: self.drive.value() as f64, ausgang_db: self.ausgang.value() as f64, mix: self.mix.value() as f64 }
    }
}

pub struct CypherSaett {
    params: Arc<SaettParams>,
    saett: Option<Saett>,
    letzte: Option<Einstellung>,
}

impl Default for CypherSaett {
    fn default() -> Self {
        CypherSaett { params: Arc::new(SaettParams::default()), saett: None, letzte: None }
    }
}

impl Plugin for CypherSaett {
    const NAME: &'static str = "Cypher Saett";
    const VENDOR: &'static str = "Cypher";
    const URL: &'static str = "";
    const EMAIL: &'static str = "";
    const VERSION: &'static str = env!("CARGO_PKG_VERSION");

    const AUDIO_IO_LAYOUTS: &'static [AudioIOLayout] = &[AudioIOLayout {
        main_input_channels: NonZeroU32::new(2),
        main_output_channels: NonZeroU32::new(2),
        ..AudioIOLayout::const_default()
    }];
    const MIDI_INPUT: MidiConfig = MidiConfig::None;
    const SAMPLE_ACCURATE_AUTOMATION: bool = false;
    type SysExMessage = ();
    type BackgroundTask = ();

    fn params(&self) -> Arc<dyn Params> {
        self.params.clone()
    }

    fn initialize(&mut self, _l: &AudioIOLayout, cfg: &BufferConfig, c: &mut impl InitContext<Self>) -> bool {
        let mut s = Saett::neu(cfg.sample_rate as f64);
        let e = self.params.einstellung();
        s.setze(&e);
        s.leeren();
        c.set_latency_samples(s.latenz() as u32);
        self.letzte = Some(e);
        self.saett = Some(s);
        true
    }

    fn reset(&mut self) {
        if let Some(s) = self.saett.as_mut() {
            s.leeren();
        }
    }

    fn process(&mut self, buffer: &mut Buffer, _aux: &mut AuxiliaryBuffers, _c: &mut impl ProcessContext<Self>) -> ProcessStatus {
        let e = self.params.einstellung();
        let Some(s) = self.saett.as_mut() else { return ProcessStatus::Normal };
        if self.letzte != Some(e) {
            s.setze(&e);
            self.letzte = Some(e);
        }
        if let [l, r] = buffer.as_slice() {
            s.block(l, r);
        }
        ProcessStatus::Normal
    }
}

impl Vst3Plugin for CypherSaett {
    const VST3_CLASS_ID: [u8; 16] = *b"CypherSaettADAA1";
    const VST3_SUBCATEGORIES: &'static [Vst3SubCategory] = &[Vst3SubCategory::Fx, Vst3SubCategory::Distortion, Vst3SubCategory::Stereo];
}

nih_export_vst3!(CypherSaett);
