// PRODUCTION (package 1.16 rest U7, T7.3): the host the PRESETS panel (public/presets.js) gets while the page is in PRODUCTION. Rows are dragged (the
// drop is storage.js), there is no channel to APPLY to, and SAVE CURRENT reads the tracks and stages of the open project (POST /presets/von_ziel).
// app.js joins this host with the DJ host (hostWechsel) and gives bindeProduktion the two callbacks presetsZeigen (the mode was chosen: build/load the
// panel) and presetsNeu (the project or the view changed: draw again if the save targets changed).
import { speicherZiele } from './preset_target.js';

export function bindePresetHost(ctx) {
  ctx.presetHost = {
    ziehbar: () => true,
    ziele: (g) => speicherZiele(ctx.st.projekt, g),
    aktuell: () => null,
    kannAnwenden: () => false,
    anwenden: async () => ({ ok: false, text: 'Drag the preset onto a track or an insert stage' }),
    geaendert: () => ctx.presetMarkenNeu?.(),   // U7 review R1: the panel saved, renamed or deleted a preset: the origin marks are asked again
  };
  ctx.beimProjekt.push(() => ctx.presetsNeu?.());
  ctx.beimSichtwechsel.push(() => ctx.presetsNeu?.());
}
