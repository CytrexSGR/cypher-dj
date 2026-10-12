//! Cypher Hall als VST3. Klangarbeit in `hall_dsp` (Herleitung: hall_dsp/MATHE.md).

use hall_dsp::{Hall, HallEinstellung};
use nih_plug::prelude::*;
use std::sync::Arc;

#[derive(Enum, Debug, PartialEq, Clone, Copy)]
pub enum RahmenP {
    #[name = "512 (grainy)"]
    N512,
    #[name = "1024"]
    N1024,
    #[name = "2048"]
    N2048,
    #[name = "4096"]
    N4096,
    #[name = "8192 (smooth)"]
    N8192,
}

#[derive(Params)]
pub struct HallParams {
    #[id = "mix"]
    pub mix: FloatParam,
    #[id = "early"]
    pub frueh: FloatParam,
    #[id = "tail"]
    pub fahne_db: FloatParam,
    #[id = "pre"]
    pub pre_ms: FloatParam,
    #[id = "size"]
    pub groesse_ms: FloatParam,
    #[id = "decay"]
    pub decay_s: FloatParam,
    #[id = "lowx"]
    pub tief: FloatParam,
    #[id = "highx"]
    pub hoch: FloatParam,
    #[id = "lowcut"]
    pub lowcut: FloatParam,
    #[id = "highcut"]
    pub highcut: FloatParam,
    #[id = "diff"]
    pub diffusion: FloatParam,
    #[id = "width"]
    pub breite: FloatParam,
    #[id = "duck"]
    pub duck: FloatParam,
    #[id = "freeze"]
    pub freeze: BoolParam,
    #[id = "kill"]
    pub kill: BoolParam,
    #[id = "fft"]
    pub rahmen: EnumParam<RahmenP>,
}

fn prozent(name: &str, v: f32) -> FloatParam {
    FloatParam::new(name, v, FloatRange::Linear { min: 0.0, max: 1.0 })
        .with_unit(" %")
        .with_value_to_string(formatters::v2s_f32_percentage(0))
        .with_string_to_value(formatters::s2v_f32_percentage())
}

fn hz(name: &str, v: f32, min: f32, max: f32) -> FloatParam {
    FloatParam::new(name, v, FloatRange::Skewed { min, max, factor: FloatRange::skew_factor(-2.0) })
        .with_unit(" Hz")
        .with_value_to_string(formatters::v2s_f32_hz_then_khz(1))
        .with_string_to_value(formatters::s2v_f32_hz_then_khz())
}

impl Default for HallParams {
    fn default() -> Self {
        let d = HallEinstellung::default();
        HallParams {
            mix: prozent("Mix", d.mix as f32),
            frueh: prozent("Early", d.frueh as f32),
            fahne_db: FloatParam::new("Tail Level", 0.0, FloatRange::Linear { min: -24.0, max: 12.0 }).with_step_size(0.1).with_unit(" dB"),
            pre_ms: FloatParam::new("Pre-Delay", d.pre_ms as f32, FloatRange::Skewed { min: 0.0, max: 250.0, factor: FloatRange::skew_factor(-1.0) })
                .with_step_size(0.1)
                .with_unit(" ms"),
            groesse_ms: FloatParam::new("Size", d.groesse_ms as f32, FloatRange::Skewed { min: 5.0, max: 200.0, factor: FloatRange::skew_factor(-1.0) })
                .with_step_size(0.1)
                .with_unit(" ms"),
            decay_s: FloatParam::new("Decay", d.decay_s as f32, FloatRange::Skewed { min: 0.1, max: 30.0, factor: FloatRange::skew_factor(-2.0) })
                .with_step_size(0.01)
                .with_unit(" s"),
            tief: FloatParam::new("Low Decay", d.tief_faktor as f32, FloatRange::Skewed { min: 0.25, max: 4.0, factor: FloatRange::skew_factor(-1.0) })
                .with_step_size(0.01)
                .with_unit(" x"),
            hoch: FloatParam::new("High Decay", d.hoch_faktor as f32, FloatRange::Skewed { min: 0.1, max: 2.0, factor: FloatRange::skew_factor(-1.0) })
                .with_step_size(0.01)
                .with_unit(" x"),
            lowcut: hz("Low Cut", d.lowcut_hz as f32, 10.0, 1000.0),
            highcut: hz("High Cut", d.highcut_hz as f32, 1000.0, 22000.0),
            diffusion: prozent("Diffusion", d.diffusion as f32),
            breite: prozent("Width", d.breite as f32),
            duck: prozent("Spectral Duck", d.duck as f32),
            freeze: BoolParam::new("Freeze", false),
            kill: BoolParam::new("Kill", false),
            rahmen: EnumParam::new("FFT Size", RahmenP::N2048).non_automatable(),
        }
    }
}

impl HallParams {
    fn einstellung(&self) -> HallEinstellung {
        HallEinstellung {
            mix: self.mix.value() as f64,
            frueh: self.frueh.value() as f64,
            fahne_db: self.fahne_db.value() as f64,
            pre_ms: self.pre_ms.value() as f64,
            groesse_ms: self.groesse_ms.value() as f64,
            decay_s: self.decay_s.value() as f64,
            tief_faktor: self.tief.value() as f64,
            hoch_faktor: self.hoch.value() as f64,
            lowcut_hz: self.lowcut.value() as f64,
            highcut_hz: self.highcut.value() as f64,
            diffusion: self.diffusion.value() as f64,
            breite: self.breite.value() as f64,
            duck: self.duck.value() as f64,
            freeze: self.freeze.value(),
            rahmen: self.rahmen.value() as usize,
        }
    }
}

pub struct CypherHall {
    params: Arc<HallParams>,
    hall: Option<Hall>,
    kill_vorher: bool,
}

impl Default for CypherHall {
    fn default() -> Self {
        CypherHall { params: Arc::new(HallParams::default()), hall: None, kill_vorher: false }
    }
}

impl Plugin for CypherHall {
    const NAME: &'static str = "Cypher Hall";
    const VENDOR: &'static str = "Cypher";
    const URL: &'static str = "";
    const EMAIL: &'static str = "";
    const VERSION: &'static str = env!("CARGO_PKG_VERSION");

    const AUDIO_IO_LAYOUTS: &'static [AudioIOLayout] = &[
        AudioIOLayout {
            main_input_channels: NonZeroU32::new(2),
            main_output_channels: NonZeroU32::new(2),
            ..AudioIOLayout::const_default()
        },
        AudioIOLayout {
            main_input_channels: NonZeroU32::new(1),
            main_output_channels: NonZeroU32::new(1),
            ..AudioIOLayout::const_default()
        },
    ];
    const MIDI_INPUT: MidiConfig = MidiConfig::None;
    const SAMPLE_ACCURATE_AUTOMATION: bool = false;
    type SysExMessage = ();
    type BackgroundTask = ();

    fn params(&self) -> Arc<dyn Params> {
        self.params.clone()
    }

    fn initialize(&mut self, _l: &AudioIOLayout, cfg: &BufferConfig, _c: &mut impl InitContext<Self>) -> bool {
        let mut h = Hall::neu(cfg.sample_rate as f64);
        h.setze(self.params.einstellung());
        h.reset();
        self.hall = Some(h);
        true
    }

    fn reset(&mut self) {
        if let Some(h) = self.hall.as_mut() {
            h.reset();
        }
    }

    fn process(&mut self, buffer: &mut Buffer, _aux: &mut AuxiliaryBuffers, _c: &mut impl ProcessContext<Self>) -> ProcessStatus {
        let e = self.params.einstellung();
        let kill = self.params.kill.value();
        let Some(h) = self.hall.as_mut() else { return ProcessStatus::Normal };
        h.setze(e);
        if kill && !self.kill_vorher {
            h.kill();
        }
        self.kill_vorher = kill;
        match buffer.as_slice() {
            [l, r] => h.verarbeite_stereo(l, r),
            [m] => {
                // Mono: rechter Kanal als Kopie, Ausgang gemittelt
                for chunk in m.chunks_mut(256) {
                    let mut r = [0.0f32; 256];
                    let n = chunk.len();
                    r[..n].copy_from_slice(chunk);
                    h.verarbeite_stereo(chunk, &mut r[..n]);
                    for (a, b) in chunk.iter_mut().zip(r.iter()) {
                        *a = 0.5 * (*a + *b);
                    }
                }
            }
            _ => {}
        }
        ProcessStatus::Normal
    }
}

impl Vst3Plugin for CypherHall {
    const VST3_CLASS_ID: [u8; 16] = *b"CypherHallSpect1";
    const VST3_SUBCATEGORIES: &'static [Vst3SubCategory] = &[Vst3SubCategory::Fx, Vst3SubCategory::Reverb, Vst3SubCategory::Stereo];
}

nih_export_vst3!(CypherHall);
