// Plan studio-taktart T4, golden run: the pure page helpers with their DEFAULT arguments (the 4/4 world).
// Used by the recorder (nimm_taktart_4_page.mjs, run once on the unchanged code) and by taktart_4_page.test.mjs.
import {
  laengeText, laengeAusSchritten, pxProBeat, sichtbarBeats, linealZellen, eigenLaengeText, eigenLaengen, eigenAusSchritten, LAENGEN_TAKTE,
} from '../../public/seq_field.js';
import { zelleBefehle, laengeBefehle, folgeEditierbar, zeileNeuBefehle } from '../../public/seq_logic.js';

const BEATS = [0.25, 0.5, 1, 2, 3, 4, 6, 8, 12, 16, 32, 48, 64];
const spur = { id: 's1', name: 'Bass', art: 'instrument', clips: [] };
const zeile = { id: 'noten', art: 'noten', teiler: 0.25 };
const clip = (laenge) => ({ id: 'c1', art: 'midi', start_beat: 0, laenge_beats: laenge, loop_beats: 16, noten: [] });

export function lauf() {
  return {
    laengeText: BEATS.map((b) => laengeText(b)),
    laengeAusSchritten: ['1', '16', '256', '257', '0', 'x', ''].map((t) => laengeAusSchritten(t)),
    laengeTakte: LAENGEN_TAKTE,
    pxProBeat: [['all', 16, 800], ['all', 64, 800], [1, 16, 800], [2, 16, 800], [4, 16, 800], ['all', 16, 0]].map((a) => pxProBeat(...a)),
    sichtbar: [['all', 16], ['all', 3], [1, 16], [2, 4], [4, 8]].map((a) => sichtbarBeats(...a)),
    lineal: linealZellen(16, 70),
    linealKurz: linealZellen(6, 6),
    eigen: [0.5, 1, 2, 3, 4, 8].map((b) => eigenLaengeText(b)),
    eigenLaengen: eigenLaengen(16),
    eigenSchritte: ['1', '64', '65', 'x'].map((t) => eigenAusSchritten(t, 16)),
    editierbar: [64, 48, 32].map((l) => folgeEditierbar({ ...spur, clips: [clip(l)] })).concat(folgeEditierbar(spur)),
    zelle: zelleBefehle(spur, null, zeile, 0, { an: true }),
    laenge: laengeBefehle(spur, null, 8),
    zeileNeu: (() => { try { return zeileNeuBefehle(spur, null, { art: 'noten', id: 'noten', teiler: 0.25 }, {}); } catch (e) { return String(e.message); } })(),
  };
}
