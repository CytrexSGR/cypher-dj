// Container core M7: the alias layer erz/<n>/<suffix> onto the strom track of stream n (table D1, F8, F10 R3/R4/R9). Pure: no I/O, no server state.
// `erz/<n>/...` was the channel strip of stream n; the streams now reach the console through the strom tracks of the strudel module, so the page server
// resolves the old paths onto the track rows (`spur/<nr>/...`), the stream rows (`strom/<n>/bk/<k>`) or the project inserts of the track.
import type { Projekt, Spur } from './project/model.ts';
import { platzVonGruppe, stromSpur, strudelGruppe } from './project/model.ts';
import { PULT_ALIAS_SUFFIXE } from '../contract/pult.ts';

export type AliasFehlerCode = 'kein_liveprojekt' | 'kein_strudel_modul' | 'keine_strom_spur' | 'kein_alias_ziel' | 'kein_modul_send' | 'keine_komp_stufe' | 'kein_graph';
export type AliasErgebnis =
  | { art: 'keiner' }                                             // not an erz/<n>/... path
  | { art: 'zeile'; pfad: string; strom: number; spur_id: string }   // core row to write
  | { art: 'insert'; strom: number; spur_id: string; insert: 'komp' | 'bk'; param: string }              // project insert row
  | { art: 'fehler'; code: AliasFehlerCode; text: string };

/** The suffix table of D1 as data: the generated list of pult.json (alias_suffixe), `bk/<k>` stands for the 64 graph knobs. */
export const ALIAS_SUFFIXE: readonly string[] = PULT_ALIAS_SUFFIXE;
/** The core has the rows spur/<nr>/pfl, trim and kill/* since K7, so the three suffixes resolve onto them (R4). */
export const ALIAS_ZEILEN_K = true;
/** The rows of a strom track that take direct writes and ramps (the carve-out of `ueber_projekt`, D-M1). Whether the track is a strom track is a project question: istStromZeile. */
export const STROM_LIVE_ZEILEN = /^spur\/([1-9][0-9]?)\/(fader|pan|mute|solo|filter|pfl|trim|eq\/(tief|mitte|hoch)|kill\/(tief|mitte|hoch)|send\/[1-8]|bk\/([1-9]|[1-5][0-9]|6[0-4]))$/;

const ALIAS = /^erz\/([1-9]|1[0-6])\/(.+)$/;
const BAND = /^(tief|mitte|hoch)$/;
const ZEILE_DIREKT = /^(fader|pan|mute|solo|filter|eq\/(tief|mitte|hoch))$/;
const KOMP = /^komp\/(an|schwelle|ratio|attack|release|makeup|mix|sc)$/;
const BK = /^bk\/(\d+)$/;
const fehler = (code: AliasFehlerCode, text: string): AliasErgebnis => ({ art: 'fehler', code, text });

function stromUnterModul(p: Projekt | null): AliasErgebnis | null {
  if (!p || !p.live) return fehler('kein_liveprojekt', 'no live project is open');
  const g = strudelGruppe(p);
  if (!g || platzVonGruppe(p, g.id) === null) return fehler('kein_strudel_modul', 'no strudel module is placed in a container');
  return null;
}

export function loeseAlias(p: Projekt | null, pfad: string, graphKind: (kanal: string) => 'instrument' | 'effekt' | null): AliasErgebnis {
  const m = ALIAS.exec(pfad);
  if (!m) return { art: 'keiner' };
  const n = Number(m[1]), suffix = m[2];
  const kein = stromUnterModul(p);
  if (kein) return kein;
  const projekt = p as Projekt;
  const spur = stromSpur(projekt, n);
  if (!spur) return fehler('keine_strom_spur', `stream ${n} has no strom track in the strudel module`);
  const zeile = (zielPfad: string): AliasErgebnis => ({ art: 'zeile', pfad: zielPfad, strom: n, spur_id: spur.id });
  if (ZEILE_DIREKT.test(suffix) || suffix === 'pfl' || suffix === 'trim' || /^kill\/(tief|mitte|hoch)$/.test(suffix)) return zeile(`spur/${spur.nr}/${suffix}`);
  const send = /^send\/([1-4])$/.exec(suffix);
  if (send) {
    if (send[1] === '3' || send[1] === '4') return fehler('kein_modul_send', `send ${send[1]} reached an effect return that a strom track cannot reach: a strom track sends into the hall and delay of its module only`);
    const art = send[1] === '1' ? 'hall' : 'delay';
    const ret = (projekt.returns ?? []).find((r) => r.strudel?.art === art);
    if (!ret) return fehler('kein_alias_ziel', `the strudel module has no ${art} return yet (strom_send creates it)`);
    return zeile(`spur/${spur.nr}/send/${ret.nr}`);
  }
  if (KOMP.test(suffix)) {
    if (!(spur.inserts ?? []).some((i) => i.art === 'komp')) return fehler('keine_komp_stufe', `the strom track of stream ${n} has no compressor insert`);
    return { art: 'insert', strom: n, spur_id: spur.id, insert: 'komp', param: suffix.slice(5) };
  }
  const bk = BK.exec(suffix);
  if (bk) {
    const k = Number(bk[1]);
    if (!(k >= 1 && k <= 64) || String(k) !== bk[1]) return fehler('kein_alias_ziel', `graph knob ${bk[1]} is outside 1..64`);
    const art = graphKind(`erz/${n}`);
    if (art === 'instrument') return zeile(`strom/${n}/bk/${k}`);
    if (art === 'effekt' && (spur.inserts ?? []).some((i) => i.art === 'bk')) return { art: 'insert', strom: n, spur_id: spur.id, insert: 'bk', param: `k${k}` };
    return fehler('kein_graph', `no graph is loaded on stream ${n}`);
  }
  return fehler('kein_alias_ziel', `erz/<n>/${suffix} has no equivalent on a strom track`);
}

const stromSpurNr = (p: Projekt, nr: number): Spur | undefined => p.spuren.find((s) => s.nr === nr && s.art === 'strom');

/** The alias of a core or project row of a strom track (`spur/<nr>/<suffix>`, `strom/<n>/bk/<k>`, `ins/komp|bk/<slot>/...`), null for any other row. */
export function rueckAlias(p: Projekt | null, pfad: string): string | null {
  if (!p || !p.live) return null;
  const sm = /^spur\/([1-9][0-9]?)\/(.+)$/.exec(pfad);
  if (sm) {
    const s = stromSpurNr(p, Number(sm[1]));
    if (!s || s.strom === undefined) return null;
    const rest = sm[2];
    if (ZEILE_DIREKT.test(rest)) return `erz/${s.strom}/${rest}`;
    const kill = /^kill\/(tief|mitte|hoch)$/.exec(rest);
    if (kill) return `erz/${s.strom}/kill/${kill[1]}`;
    if (rest === 'pfl' || rest === 'trim') return `erz/${s.strom}/${rest}`;
    const send = /^send\/([1-8])$/.exec(rest);
    if (send) {
      const ret = (p.returns ?? []).find((r) => r.nr === Number(send[1]));
      return ret?.strudel ? `erz/${s.strom}/send/${ret.strudel.art === 'hall' ? 1 : 2}` : null;
    }
    return null;
  }
  const bm = /^strom\/([1-9]|1[0-6])\/bk\/([1-9]|[1-5][0-9]|6[0-4])$/.exec(pfad);
  if (bm) return `erz/${bm[1]}/bk/${bm[2]}`;
  const im = /^ins\/(komp|bk)\/([1-9][0-9]?)\/(\w+)$/.exec(pfad);
  if (im) {
    const slot = Number(im[2]);
    const s = p.spuren.find((x) => x.art === 'strom' && (x.inserts ?? []).some((i) => i.art === im[1] && i.slot === slot));
    if (!s || s.strom === undefined) return null;
    if (im[1] === 'komp') return KOMP.test(`komp/${im[3]}`) ? `erz/${s.strom}/komp/${im[3]}` : null;
    const k = /^k([1-9]|[1-5][0-9]|6[0-4])$/.exec(im[3]);
    return k ? `erz/${s.strom}/bk/${k[1]}` : null;
  }
  return null;
}

/** The carve-out predicate of C1: the path is a row of a strom track (it takes direct writes and ramps and is followed into the project). */
export function istStromZeile(p: Projekt | null, pfad: string): boolean {
  if (!p) return false;
  const m = STROM_LIVE_ZEILEN.exec(pfad);
  return !!m && stromSpurNr(p, Number(m[1])) !== undefined;
}
