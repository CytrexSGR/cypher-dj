// I08: Zuordnung, Freigabe und Latenz als reine Übergänge Konfig -> Konfig. F3 (Andreas 2026-10-22): externe Eingänge nur nach Einzelfreigabe durch Andreas.
import { profil } from './profile.ts';
import type { Erkennung } from './pwdump.ts';
import { GeraeteFehler, portName, type Konfig, type Latenz } from './speicher.ts';

export type Quelle = 'andreas' | 'cypher';
const ungueltig = (t: string): never => { throw new GeraeteFehler('argument_ungueltig', 400, t); };
const nurAndreas = (q: Quelle, grund = 'nur_andreas'): void => { if (q !== 'andreas') throw new GeraeteFehler(grund, 403, 'only Andreas changes devices and releases inputs for Cypher'); };

function ports(d: Record<string, unknown>): string[] | null {
  if (d.ports === undefined) return null;
  if (!Array.isArray(d.ports) || d.ports.length < 1 || d.ports.length > 2 || !d.ports.every(portName)) return ungueltig('ports: 1 or 2 port names (no tab, no line break)');
  return d.ports as string[];
}

export function setzeEingang(alt: Konfig, quelle: Quelle, d: Record<string, unknown>, erk: Erkennung): Konfig {
  if (!Number.isInteger(d.k) || (d.k as number) < 1 || (d.k as number) > 4) ungueltig('k: 1 to 4');
  const k = structuredClone(alt);
  const e = k.eingaenge[(d.k as number) - 1];
  if (d.name !== undefined) {
    if (typeof d.name !== 'string' || d.name.length < 1 || d.name.length > 40) ungueltig('name: 1 to 40 characters');
    nurAndreas(quelle);
    e.name = d.name as string;
  }
  if (d.ports !== undefined && (!('profil' in d) || d.profil === null)) ungueltig('ports: only together with a profile');
  if ('profil' in d) {
    nurAndreas(quelle);
    if (d.profil === null) {
      e.profil = null; e.audio = null; e.frei_fuer_cypher = false; e.latenz = null;
    } else {
      const p = profil(d.profil);
      if (!p) throw new GeraeteFehler('profil_unbekannt', 400, `profile ${String(d.profil)}`);
      if (!p.audio) throw new GeraeteFehler('profil_ohne_audio', 400, `${p.name} has no audio input`);
      const eigene = ports(d);
      const q = erk.audio.find((x) => p.audio!.passt(x) && x.ports.length > 0);   // ein Knoten ohne Ports lässt sich nicht verbinden
      if (!q && !eigene) throw new GeraeteFehler('geraet_nicht_da', 409, `${p.name} is not connected (or give ports explicitly)`);
      // Knoten und Ports stammen immer vom selben Gerät: ausdrückliche Ports bestimmen auch den Knoten
      const neu = eigene ? { knoten: eigene[0].split(':')[0], ports: eigene } : { knoten: q!.knoten, ports: q!.ports.slice(0, 2) };
      // eine Freigabe gilt für Eingang und Gerät: dieselben Ports am selben Knoten, sonst fällt sie zurück
      const gleich = e.profil === p.id && e.audio !== null && e.audio.knoten === neu.knoten
        && e.audio.ports.length === neu.ports.length && e.audio.ports.every((x, i) => x === neu.ports[i]);
      e.profil = p.id;
      e.audio = neu;
      if (!gleich) { e.frei_fuer_cypher = false; e.latenz = null; }   // Freigabe und Latenzprofil gehören zum Gerät (Spec 4.4)
    }
  }
  if (d.frei_fuer_cypher !== undefined) {
    nurAndreas(quelle, 'freigabe_nur_andreas');
    if (typeof d.frei_fuer_cypher !== 'boolean') ungueltig('frei_fuer_cypher: true or false');
    if (d.frei_fuer_cypher && !e.audio) throw new GeraeteFehler('eingang_leer', 409, 'there is no device on this input to release');
    e.frei_fuer_cypher = d.frei_fuer_cypher;
  }
  return k;
}

export function setzeMidi(alt: Konfig, quelle: Quelle, d: Record<string, unknown>, erk: Erkennung): Konfig {
  const k = structuredClone(alt);
  if (d.port !== undefined && (!('profil' in d) || d.profil === null)) ungueltig('port: only together with a profile');
  if (d.port !== undefined && !portName(d.port)) ungueltig('port: a port name (no tab, no line break)');
  if ('profil' in d) {
    nurAndreas(quelle);
    if (d.profil === null) { k.midi = { profil: null, port: null, frei_fuer_cypher: false }; return k; }
    const p = profil(d.profil);
    if (!p) throw new GeraeteFehler('profil_unbekannt', 400, `profile ${String(d.profil)}`);
    if (!p.midi) throw new GeraeteFehler('profil_ohne_midi', 400, `${p.name} has no MIDI input`);
    const q = erk.midi.find((x) => p.midi!.passt(x));
    const eigene = d.port === undefined ? null : d.port as string;
    if (!q && !eigene) throw new GeraeteFehler('geraet_nicht_da', 409, `${p.name} is not connected (or give port explicitly)`);
    const gleich = k.midi.profil === p.id && k.midi.port === (eigene ?? q!.port);
    k.midi = { profil: p.id, port: eigene ?? q!.port, frei_fuer_cypher: gleich ? k.midi.frei_fuer_cypher : false };
  }
  if (d.frei_fuer_cypher !== undefined) {
    nurAndreas(quelle, 'freigabe_nur_andreas');
    if (typeof d.frei_fuer_cypher !== 'boolean') ungueltig('frei_fuer_cypher: true or false');
    if (d.frei_fuer_cypher && !k.midi.port) throw new GeraeteFehler('eingang_leer', 409, 'there is no device on this input to release');
    k.midi.frei_fuer_cypher = d.frei_fuer_cypher;
  }
  return k;
}

// Task 12 benutzt es; hier steht die Form, damit alle Übergänge an einem Ort liegen.
export function setzeLatenz(alt: Konfig, quelle: Quelle, d: Record<string, unknown>, jetzt: () => string = () => new Date().toISOString()): Konfig {
  if (!Number.isInteger(d.k) || (d.k as number) < 1 || (d.k as number) > 4) ungueltig('k: 1 to 4');
  const art = d.art;
  if (art !== 'software' && art !== 'kabel') ungueltig('art: software or kabel');
  if (art === 'kabel') nurAndreas(quelle, 'latenz_nur_andreas');   // die Kabelschleife kann nur er stecken; ein Wert ohne sie wäre erfunden
  const zahl = (f: string, min: number, max: number, ganz = false): number => {
    const v = d[f];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || (ganz && !Number.isInteger(v))) return ungueltig(`${f}: ${min} to ${max}`);
    return v;
  };
  const l: Latenz = { samples: zahl('samples', 0, 48000), streuung: zahl('streuung', 0, 48000), min: zahl('min', 0, 96000), max: zahl('max', 0, 96000),
    laeufe: zahl('laeufe', 20, 10000, true), quantum: zahl('quantum', 16, 8192, true), rate: zahl('rate', 8000, 192000, true), art, gemessen_am: jetzt() };
  if (l.min > l.max) ungueltig('min: not above max');
  const k = structuredClone(alt);
  const e = k.eingaenge[(d.k as number) - 1];
  if (!e.audio) throw new GeraeteFehler('eingang_leer', 409, 'there is no device on this input');
  // Spec 1.8 Z. 226: Cypher legt kein Latenzprofil an, das Kabel braucht. Auch art software überschreibt keine Kabelmessung (Nachzug R2, M1)
  if (e.latenz?.art === 'kabel') nurAndreas(quelle, 'latenz_nur_andreas');
  e.latenz = l;
  return k;
}
