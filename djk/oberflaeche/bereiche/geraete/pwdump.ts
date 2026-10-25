// I08: Erkennung der Quellen aus der Ausgabe von `pw-dump` (liesDump ist rein; pwDumpErkenne startet den Prozess, nur lesend).
// Namen der Ports in der Form, die der Kern findet: er läuft unter pipewire-jack, dort heißt der Client eines ALSA-Geräts node.description
// (ohne Beschreibung node.name), also "<node.description>:<port.name>", wie djk/start/ziel.py (Gesamtreview Teil A, B1). node.name bleibt die Kennung (knoten).
import { execFile } from 'node:child_process';

export interface AudioQuelle {
  knoten: string; beschreibung: string; zustand: string; kanaele: number; ports: string[];
  usb: { vendor: string; produkt: string } | null;
}
export interface MidiQuelle { port: string; alias: string }
export interface Erkennung { audio: AudioQuelle[]; midi: MidiQuelle[] }
export const LEER: Erkennung = { audio: [], midi: [] };

interface Obj { id?: number; type?: string; info?: { state?: string; props?: Record<string, unknown> } }
const istArt = (o: Obj, t: string): boolean => typeof o?.type === 'string' && o.type.endsWith(`:${t}`);
const prop = (o: Obj | undefined, k: string): unknown => o?.info?.props?.[k];
const text = (v: unknown): string => (typeof v === 'string' ? v : '');

export function liesDump(dump: unknown): Erkennung {
  const alle = (Array.isArray(dump) ? dump : []).filter((o): o is Obj => typeof o === 'object' && o !== null);
  const knoten = new Map<number, Obj>(), geraete = new Map<number, Obj>();
  for (const o of alle) {
    if (typeof o.id !== 'number') continue;
    if (istArt(o, 'Node')) knoten.set(o.id, o);
    else if (istArt(o, 'Device')) geraete.set(o.id, o);
  }
  const ports = alle.filter((o) => istArt(o, 'Port'));
  const audio: AudioQuelle[] = [];
  const clientName = (n: Obj): string => text(prop(n, 'node.description')) || text(prop(n, 'node.name'));
  const quellen = [...knoten.values()].filter((n) => prop(n, 'media.class') === 'Audio/Source' && text(prop(n, 'node.name')));
  const haeufigkeit = new Map<string, number>();
  for (const n of quellen) haeufigkeit.set(clientName(n), (haeufigkeit.get(clientName(n)) ?? 0) + 1);
  for (const [id, n] of knoten) {
    if (prop(n, 'media.class') !== 'Audio/Source') continue;
    const name = text(prop(n, 'node.name'));
    if (!name) continue;
    const meine = ports
      .filter((p) => prop(p, 'node.id') === id && prop(p, 'port.direction') === 'out' && text(prop(p, 'format.dsp')).includes('audio'))
      .sort((a, b) => Number(prop(a, 'port.id') ?? a.id ?? 0) - Number(prop(b, 'port.id') ?? b.id ?? 0));
    const client = clientName(n), eindeutig = haeufigkeit.get(client) === 1;   // zwei Quellen mit gleicher Beschreibung: nicht raten (ziel.py weist ab)
    const dev = typeof prop(n, 'device.id') === 'number' ? geraete.get(prop(n, 'device.id') as number) : undefined;
    const usb = dev && prop(dev, 'device.bus') === 'usb'
      ? { vendor: text(prop(dev, 'device.vendor.id')), produkt: text(prop(dev, 'device.product.id')) } : null;
    audio.push({ knoten: name, beschreibung: text(prop(n, 'node.description')) || name, zustand: n.info?.state ?? '',
      kanaele: Number(prop(n, 'audio.channels') ?? meine.length), ports: eindeutig ? meine.map((p) => `${client}:${text(prop(p, 'port.name'))}`) : [], usb });
  }
  const midi: MidiQuelle[] = [];
  for (const p of ports) {
    if (!text(prop(p, 'format.dsp')).toLowerCase().includes('midi') || prop(p, 'port.direction') !== 'out' || prop(p, 'port.physical') !== true) continue;
    const nn = text(prop(knoten.get(Number(prop(p, 'node.id'))), 'node.name'));
    if (!nn || nn.startsWith('cypherdj-')) continue;
    midi.push({ port: `${nn}:${text(prop(p, 'port.name'))}`, alias: text(prop(p, 'port.alias')) });
  }
  audio.sort((a, b) => a.knoten.localeCompare(b.knoten));
  midi.sort((a, b) => a.port.localeCompare(b.port));
  return { audio, midi };
}

// Startet `pw-dump` (nur lesend). Wirft, wenn es fehlt oder nicht antwortet; der Aufrufer meldet dann erkennung = nicht_verfuegbar.
export function pwDumpErkenne(): Promise<Erkennung> {
  return new Promise((ok, nein) => {
    execFile('pw-dump', [], { timeout: 4000, maxBuffer: 32 * 1024 * 1024 }, (e, out) => {
      if (e) { nein(e); return; }
      try { ok(liesDump(JSON.parse(out))); } catch (x) { nein(x as Error); }
    });
  });
}
