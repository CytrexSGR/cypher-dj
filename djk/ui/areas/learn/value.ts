// The value a learned Baukasten knob has right now (0..1), so a controller with motor faders or endless encoders can take it over (the Launch
// Control 3 picks up a CC sent back to an encoder, djk/hand_bruecke/lc3.py): after a sound preset, a program change or a mouse move the encoder
// continues from the real value instead of jumping.
// spur/<slot>/bk/<k>: the value of the project track on that slot (geraet.parameter.k<k>, BK_KNOPF_VORGABE when untouched). The core row is only a
// transient override that the write-back (areas/controller/zurueck.ts) stores in the project 400 ms after the last grip, so the project is the truth.
// <channel>/bk/<n> (a live channel): the last value the kern reported for the row (/e/regler), undefined before the first report.
import type { BereichKontext } from '../../http/router.ts';
import { BK_KNOPF_VORGABE } from '../../project/model.ts';
import { spurVonSlot } from './beschriftung.ts';

const SPUR_KNOPF = /^spur\/([1-9][0-9]*)\/bk\/([1-9][0-9]?)$/;
const KANAL_KNOPF = /^.+\/bk\/\d+$/;

export function wertVon(ctx: Pick<BereichKontext, 'projekt'>, pfad: string, gemeldet: ReadonlyMap<string, number>): number | undefined {
  const m = SPUR_KNOPF.exec(pfad);
  if (m) {
    const g = spurVonSlot(ctx, Number(m[1]))?.geraet as { art?: string; name?: string; parameter?: Record<string, unknown> } | undefined;
    if (!g || g.art !== 'intern' || g.name !== 'bk') return undefined;
    const w = g.parameter?.[`k${Number(m[2])}`];
    return typeof w === 'number' && Number.isFinite(w) ? Math.min(1, Math.max(0, w)) : BK_KNOPF_VORGABE;
  }
  if (!KANAL_KNOPF.test(pfad)) return undefined;
  const w = gemeldet.get(pfad);
  return w === undefined ? undefined : Math.min(1, Math.max(0, w));
}
