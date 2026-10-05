// OSC-Nachrichten nach Adresse bauen und lesen. Typ-Zeichenketten und Feldnamen kommen allein aus
// djk/vertrag/osc_adressen.ts (erzeugt von Scheibe 02 aus osc.json, SCHNITTSTELLEN §19.0); dieser Leitstand
// hält keine eigene Adresstabelle.
import { ADRESSEN as VERTRAG } from '../../vertrag/osc_adressen.ts';
import { kodiere, lies, type OscNachricht } from './osc.ts';

export interface Adresse { typen: string; felder: readonly string[] }

// typen ohne führendes Komma, wie osc.ts sie schreibt und liest
export const ADRESSEN: Record<string, Adresse> = Object.fromEntries(
  Object.entries(VERTRAG).map(([pfad, a]) => [pfad, { typen: a.typen.slice(1), felder: a.felder }]),
);

export type Felder = Record<string, number | string>;

export interface Dekodiert { adresse: string; felder: Felder }

// int64 → number; wirft, wenn der Wert nicht verlustfrei passt (mono_ns liegt bei 1,7e14, Luft bis 9e15).
function alsZahl(v: bigint, adresse: string, feld: string): number {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new Error(`${adresse}.${feld}: ${v} passt nicht verlustfrei in number`);
  return n;
}

export function dekodiere(n: OscNachricht): Dekodiert {
  const a = ADRESSEN[n.adresse];
  if (!a) throw new Error(`unbekannte Adresse ${n.adresse}`);
  if (a.typen !== n.typen) throw new Error(`${n.adresse}: Typen ,${n.typen} statt ,${a.typen}`);
  const felder: Felder = {};
  a.felder.forEach((f, i) => {
    const v = n.werte[i];
    felder[f] = typeof v === 'bigint' ? alsZahl(v, n.adresse, f) : v;
  });
  return { adresse: n.adresse, felder };
}

export function liesUndDekodiere(buf: Buffer): Dekodiert {
  return dekodiere(lies(buf));
}

export function baue(adresse: string, felder: Felder): Buffer {
  const a = ADRESSEN[adresse];
  if (!a) throw new Error(`unbekannte Adresse ${adresse}`);
  const werte = a.felder.map((f) => {
    if (!(f in felder)) throw new Error(`${adresse}: Feld ${f} fehlt`);
    return felder[f];
  });
  return kodiere(adresse, a.typen, werte);
}
