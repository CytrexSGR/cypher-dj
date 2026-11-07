// Register id of a preset, "<herkunft>:<geraet>/<slug>" (presets/ENTSCHEIDUNGEN.md P-R2), e.g. werk:komp/drum-bus.
// Its own file with no imports (package 1.16 rest, T1.0): projekt/modell.ts must stay free of file access and imports only this
// regex; presets/modell.ts imports vokabular.ts, which imports node:fs. Re-exported from presets/modell.ts and presets/register.ts.
export const PRESET_ID = /^(werk|nutzer):[a-z0-9-]+\/[a-z0-9][a-z0-9-]{0,47}$/;
