//! Cypher EQ als VST3. Die ganze Klangarbeit liegt in `eq_dsp`; hier nur Parameter und Host-Anschluss.
//! Glättung macht der Kern selbst (Parameter je Block übergeben, Kern rampt intern).

use eq_dsp::{BandArt, BandEinstellung, Eq, Kanal, Steilheit, BAENDER};
use nih_plug::prelude::*;
use std::sync::Arc;

#[derive(Enum, Debug, PartialEq, Clone, Copy)]
pub enum ArtP {
    #[name = "Bell"]
    Glocke,
    #[name = "Low Shelf"]
    LowShelf,
    #[name = "High Shelf"]
    HighShelf,
    #[name = "Low Cut"]
    LowCut,
    #[name = "High Cut"]
    HighCut,
    #[name = "Notch"]
    Kerbe,
    #[name = "Band Pass"]
    Bandpass,
}

#[derive(Enum, Debug, PartialEq, Clone, Copy)]
pub enum SteilP {
    #[name = "12 dB/oct"]
    Db12,
    #[name = "24 dB/oct"]
    Db24,
    #[name = "36 dB/oct"]
    Db36,
    #[name = "48 dB/oct"]
    Db48,
}

#[derive(Enum, Debug, PartialEq, Clone, Copy)]
pub enum KanalP {
    Stereo,
    Mid,
    Side,
}

#[derive(Params)]
pub struct BandParams {
    #[id = "on"]
    pub an: BoolParam,
    #[id = "type"]
    pub art: EnumParam<ArtP>,
    #[id = "freq"]
    pub freq: FloatParam,
    #[id = "gain"]
    pub gain: FloatParam,
    #[id = "q"]
    pub q: FloatParam,
    #[id = "slope"]
    pub steil: EnumParam<SteilP>,
    #[id = "place"]
    pub kanal: EnumParam<KanalP>,
}

impl BandParams {
    fn neu(i: usize, art: ArtP, freq: f32) -> Self {
        let n = i + 1;
        BandParams {
            an: BoolParam::new(format!("Band {n} On"), false),
            art: EnumParam::new(format!("Band {n} Type"), art),
            freq: FloatParam::new(
                format!("Band {n} Freq"),
                freq,
                FloatRange::Skewed { min: 10.0, max: 22000.0, factor: FloatRange::skew_factor(-2.2) },
            )
            .with_unit(" Hz")
            .with_value_to_string(formatters::v2s_f32_hz_then_khz(2))
            .with_string_to_value(formatters::s2v_f32_hz_then_khz()),
            gain: FloatParam::new(format!("Band {n} Gain"), 0.0, FloatRange::Linear { min: -24.0, max: 24.0 })
                .with_step_size(0.01)
                .with_unit(" dB"),
            q: FloatParam::new(
                format!("Band {n} Q"),
                0.707,
                FloatRange::Skewed { min: 0.1, max: 18.0, factor: FloatRange::skew_factor(-2.0) },
            )
            .with_value_to_string(formatters::v2s_f32_rounded(3)),
            steil: EnumParam::new(format!("Band {n} Slope"), SteilP::Db12),
            kanal: EnumParam::new(format!("Band {n} Placement"), KanalP::Stereo),
        }
    }

    fn einstellung(&self) -> BandEinstellung {
        BandEinstellung {
            an: self.an.value(),
            art: match self.art.value() {
                ArtP::Glocke => BandArt::Glocke,
                ArtP::LowShelf => BandArt::LowShelf,
                ArtP::HighShelf => BandArt::HighShelf,
                ArtP::LowCut => BandArt::LowCut,
                ArtP::HighCut => BandArt::HighCut,
                ArtP::Kerbe => BandArt::Kerbe,
                ArtP::Bandpass => BandArt::Bandpass,
            },
            freq: self.freq.value() as f64,
            gain_db: self.gain.value() as f64,
            q: self.q.value() as f64,
            steilheit: match self.steil.value() {
                SteilP::Db12 => Steilheit::Db12,
                SteilP::Db24 => Steilheit::Db24,
                SteilP::Db36 => Steilheit::Db36,
                SteilP::Db48 => Steilheit::Db48,
            },
            kanal: match self.kanal.value() {
                KanalP::Stereo => Kanal::Stereo,
                KanalP::Mid => Kanal::Mid,
                KanalP::Side => Kanal::Side,
            },
        }
    }
}

#[derive(Params)]
pub struct EqParams {
    #[nested(array, group = "Band")]
    pub baender: [BandParams; BAENDER],
    #[id = "out"]
    pub ausgang: FloatParam,
    #[id = "propq"]
    pub prop_q: BoolParam,
}

impl Default for EqParams {
    fn default() -> Self {
        // Startaufstellung wie auf einem Pult: von unten nach oben, alle Bänder aus.
        let start = [
            (ArtP::LowCut, 30.0),
            (ArtP::LowShelf, 100.0),
            (ArtP::Glocke, 250.0),
            (ArtP::Glocke, 800.0),
            (ArtP::Glocke, 2500.0),
            (ArtP::Glocke, 6000.0),
            (ArtP::HighShelf, 10000.0),
            (ArtP::HighCut, 18000.0),
        ];
        EqParams {
            baender: std::array::from_fn(|i| BandParams::neu(i, start[i].0, start[i].1)),
            ausgang: FloatParam::new("Output", 0.0, FloatRange::Linear { min: -24.0, max: 24.0 })
                .with_step_size(0.01)
                .with_unit(" dB"),
            prop_q: BoolParam::new("Proportional Q", false),
        }
    }
}

pub struct CypherEq {
    params: Arc<EqParams>,
    eq: Option<Eq>,
}

impl Default for CypherEq {
    fn default() -> Self {
        CypherEq { params: Arc::new(EqParams::default()), eq: None }
    }
}

impl CypherEq {
    fn uebernehme(&mut self) {
        let p = self.params.clone();
        if let Some(eq) = self.eq.as_mut() {
            eq.setze_prop_q(p.prop_q.value());
            for (i, b) in p.baender.iter().enumerate() {
                eq.setze_band(i, b.einstellung());
            }
            eq.setze_ausgang_db(p.ausgang.value() as f64);
        }
    }
}

impl Plugin for CypherEq {
    const NAME: &'static str = "Cypher EQ";
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

    fn initialize(
        &mut self,
        _layout: &AudioIOLayout,
        buffer_config: &BufferConfig,
        context: &mut impl InitContext<Self>,
    ) -> bool {
        let eq = Eq::neu(buffer_config.sample_rate as f64);
        context.set_latency_samples(eq.latenz() as u32);
        self.eq = Some(eq);
        self.uebernehme();
        true
    }

    fn reset(&mut self) {
        self.uebernehme();
        if let Some(eq) = self.eq.as_mut() {
            eq.reset();
        }
    }

    fn process(
        &mut self,
        buffer: &mut Buffer,
        _aux: &mut AuxiliaryBuffers,
        _context: &mut impl ProcessContext<Self>,
    ) -> ProcessStatus {
        self.uebernehme();
        let Some(eq) = self.eq.as_mut() else { return ProcessStatus::Normal };
        match buffer.as_slice() {
            [l, r] => eq.verarbeite_stereo(l, r),
            [m] => eq.verarbeite_mono(m),
            _ => {}
        }
        ProcessStatus::Normal
    }
}

impl Vst3Plugin for CypherEq {
    const VST3_CLASS_ID: [u8; 16] = *b"CypherEqualizer1";
    const VST3_SUBCATEGORIES: &'static [Vst3SubCategory] =
        &[Vst3SubCategory::Fx, Vst3SubCategory::Eq, Vst3SubCategory::Stereo];
}

nih_export_vst3!(CypherEq);
