// Keys on a live channel (plan addendum N2): the one place that sends the live-key target to the core (/k/live/tasten, field `strom`; id and quelle
// are added by ctx.sende). A core that does not know the address refuses it; that is reported as `kern_alt` and `tasten` in GET /controller/fokus says so.
// sequences.ts calls sendeLiveTasten(ctx, kanal) whenever the live-key target should change and reads the answer.
import type { BereichKontext } from '../../http/router.ts';
import { STROM_KANAL, INSTRUMENT_STROEME } from '../../../contract/streams.ts';

/** Address of the N2 core command; null would switch the live keys off (then nothing is sent). */
export const LIVE_TASTEN_ADRESSE = '/k/live/tasten' as string | null;

/** The stream (strom) that receives the keys for a live channel such as erz/5, or null when the channel takes no keys. */
export function stromVonKanal(kanal: string): number | null {
  for (const n of INSTRUMENT_STROEME) if (STROM_KANAL[n] === kanal) return n;
  return null;
}

export type LiveAntwort = { ok: true } | { ok: false; grund: 'kern_alt' };

/** Sets the live-key target to the stream of `kanal` (null: no live channel, today's behaviour). */
export async function sendeLiveTasten(ctx: BereichKontext, kanal: string | null, adresse = LIVE_TASTEN_ADRESSE): Promise<LiveAntwort> {   // `adresse`: tests only
  if (adresse === null) return { ok: false, grund: 'kern_alt' };
  const strom = kanal === null ? 0 : stromVonKanal(kanal);
  if (strom === null) return { ok: false, grund: 'kern_alt' };
  const felder = { strom };
  const q = await ctx.warteQuittung(ctx.sende(adresse, felder));
  return q && q.status < 6 ? { ok: true } : { ok: false, grund: 'kern_alt' };   // a refusal (unknown address on an older core) means the core cannot do it
}
