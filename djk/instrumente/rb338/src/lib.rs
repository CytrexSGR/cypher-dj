//! RB-338 (Kreativ-Werkstatt W1): eine 303-Stimme als VST3 für den Carla-Wirt. Die DSP lebt in rb_dsp.
use nih_plug::prelude::*;
use rb_dsp::noten::{plane, Aktion, Ereignis, Stapel};
use rb_dsp::{StimmParams, Stimme};

const MAX_EREIGNISSE: usize = 256;
use std::sync::Arc;

pub struct Rb338 {
    params: Arc<Rb338Params>,
    sr: f32,
    stimme: Stimme,
    stapel: Stapel,
    ereignisse: [Ereignis; MAX_EREIGNISSE],
    aktionen: [Aktion; MAX_EREIGNISSE],
    /// Ereignisse, die ein Block über MAX_EREIGNISSE hinaus brachte und verworfen wurden (kein Panic).
    pub verworfen: u32,
}

#[derive(Params)]
pub struct Rb338Params {
    #[id = "lautstaerke"]
    pub lautstaerke: FloatParam,
    #[id = "wellenform"]
    pub rechteck: BoolParam,
    #[id = "cutoff"]
    pub cutoff: FloatParam,
    #[id = "resonanz"]
    pub resonanz: FloatParam,
    #[id = "env_mod"]
    pub env_mod: FloatParam,
    #[id = "decay"]
    pub decay: FloatParam,
    #[id = "accent"]
    pub accent: FloatParam,
}

impl Default for Rb338Params {
    fn default() -> Self {
        Self {
            lautstaerke: FloatParam::new("Volume", util::db_to_gain(-12.0),
                FloatRange::Skewed { min: util::db_to_gain(-48.0), max: util::db_to_gain(0.0),
                                     factor: FloatRange::gain_skew_factor(-48.0, 0.0) })
                .with_smoother(SmoothingStyle::Logarithmic(20.0))
                .with_unit(" dB")
                .with_value_to_string(formatters::v2s_f32_gain_to_db(1))
                .with_string_to_value(formatters::s2v_f32_gain_to_db()),
            rechteck: BoolParam::new("Square", false),
            cutoff: FloatParam::new("Cutoff", 800.0, FloatRange::Skewed { min: 40.0, max: 5000.0, factor: FloatRange::skew_factor(-2.0) })
                .with_smoother(SmoothingStyle::Logarithmic(20.0)).with_unit(" Hz"),
            resonanz: FloatParam::new("Resonance", 0.3, FloatRange::Linear { min: 0.0, max: 1.0 })
                .with_smoother(SmoothingStyle::Linear(20.0)),
            env_mod: FloatParam::new("Env Mod", 0.4, FloatRange::Linear { min: 0.0, max: 1.0 })
                .with_smoother(SmoothingStyle::Linear(20.0)),
            decay: FloatParam::new("Decay", 0.6, FloatRange::Skewed { min: 0.2, max: 2.0, factor: FloatRange::skew_factor(-1.0) })
                .with_unit(" s"),
            accent: FloatParam::new("Accent", 0.6, FloatRange::Linear { min: 0.0, max: 1.0 }),
        }
    }
}

impl Default for Rb338 {
    fn default() -> Self {
        Self { params: Arc::new(Rb338Params::default()), sr: 48_000.0, stimme: Stimme::default(), stapel: Stapel::default(),
               ereignisse: [Ereignis::Aus { t: 0, note: 0 }; MAX_EREIGNISSE], aktionen: [Aktion::Nichts; MAX_EREIGNISSE], verworfen: 0 }
    }
}

impl Plugin for Rb338 {
    const NAME: &'static str = "RB-338";
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
        self.sr = b.sample_rate;
        true
    }

    fn reset(&mut self) {
        self.stimme = Stimme::default();
        self.stapel.leeren();
    }

    fn process(&mut self, buffer: &mut Buffer, _aux: &mut AuxiliaryBuffers, ctx: &mut impl ProcessContext<Self>) -> ProcessStatus {
        // Ereignisse des Blocks sammeln (festes Feld, keine Allokation), Notenlogik planen, sample-genau anwenden.
        let mut anzahl = 0usize;
        while let Some(ev) = ctx.next_event() {
            let e = match ev {
                NoteEvent::NoteOn { timing, note, velocity, .. } => Ereignis::An { t: timing, note, vel: velocity },
                NoteEvent::NoteOff { timing, note, .. } => Ereignis::Aus { t: timing, note },
                _ => continue,
            };
            if anzahl < MAX_EREIGNISSE { self.ereignisse[anzahl] = e; anzahl += 1; } else { self.verworfen += 1; }
        }
        let n_aktionen = plane(&self.ereignisse[..anzahl], &mut self.stapel, &mut self.aktionen);
        let mut naechste = 0usize;
        for (i, mut kanaele) in buffer.iter_samples().enumerate() {
            while naechste < n_aktionen {
                let (t, a) = match self.aktionen[naechste] {
                    Aktion::An { t, .. } => (t, self.aktionen[naechste]),
                    Aktion::Aus { t } => (t, self.aktionen[naechste]),
                    Aktion::Nichts => (0, Aktion::Nichts),
                };
                if t > i as u32 { break; }
                match a {
                    Aktion::An { note, vel, slide, .. } => self.stimme.an(note, vel, slide),
                    Aktion::Aus { .. } => self.stimme.aus(),
                    Aktion::Nichts => {}
                }
                naechste += 1;
            }
            let p = StimmParams {
                rechteck: self.params.rechteck.value(),
                cutoff: self.params.cutoff.smoothed.next(),
                resonanz: self.params.resonanz.smoothed.next(),
                env_mod: self.params.env_mod.smoothed.next(),
                decay_s: self.params.decay.value(),
                accent: self.params.accent.value(),
            };
            let s = self.stimme.prozess(&p, self.sr) * self.params.lautstaerke.smoothed.next();
            for smp in kanaele.iter_mut() { *smp = s; }
        }
        ProcessStatus::KeepAlive
    }
}

impl Vst3Plugin for Rb338 {
    const VST3_CLASS_ID: [u8; 16] = *b"CypherDjRb338W1_";
    const VST3_SUBCATEGORIES: &'static [Vst3SubCategory] = &[Vst3SubCategory::Instrument, Vst3SubCategory::Synth];
}

nih_export_vst3!(Rb338);
