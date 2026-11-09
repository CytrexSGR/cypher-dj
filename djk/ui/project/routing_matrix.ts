// 1.10 slice 6 (plan D1, D2): the routing matrix as server data. One pure function over the project: every strip with its target cells, sends and
// insert stages. No cache, no clone per cell: the target cells repeat the three rules of `ziel_setzen`, the key cells ask `schluesselErlaubt`
// (routing_rules.ts); tests/project_routing_matrix.test.mjs proves that every cell equals what the commands do.
import { BefehlFehler } from './commands.ts';
import { alleInserts, type Insert, type InsertTraeger, type Projekt, type Send } from './model.ts';
import { schluesselErlaubt, type SchluesselFrage } from './routing_rules.ts';

export interface ZielZelle { ziel: string; aktiv: boolean; erlaubt: boolean; grund?: string; text?: string }
export interface Option { quelle: string; nr: number; punkt: 'pre' | 'post'; erlaubt: boolean; grund?: string; text?: string }
export interface Stufe {
  insert_id: string; art: 'komp' | 'eq' | 'saett' | 'lim'; slot: number; an: boolean;
  schluessel: null | { quelle: 'spur' | 'grp' | 'ret' | 'deck' | 'erz'; nr: number; punkt: 'pre' | 'post' }; optionen?: Option[];
}
export interface Strang {
  art: 'spur' | 'gruppe' | 'return' | 'pm'; id: string; nr: number; name: string; ausgang: string; ziel_zellen: ZielZelle[];
  sends: { return_id: string; db: number }[]; stufen: Stufe[];
}
export interface RoutingMatrix {
  rev: number; ziele: { wert: string; name: string }[]; returns: { id: string; nr: number; name: string; pre: boolean }[]; straenge: Strang[];
}

// the numbers a key can name besides the strips of the project: DJ decks 1..4 and the arrangement groups erz/1..4 (the rules answer each one)
const DJ_DECKS = 4;
const DJ_ERZ = 4;

const sends = (l: Send[] | undefined): Strang['sends'] => (l ?? []).map((x) => ({ return_id: x.id, db: x.db }));
const stufen = (st: InsertTraeger): Insert[] => (st.inserts ?? []).filter((i) => i.art !== 'bk');

function stufe(i: Insert): Stufe {
  const schluessel: Stufe['schluessel'] = i.key ? { quelle: i.key.quelle, nr: i.key.nr, punkt: i.key.punkt }
    : i.sc ? { quelle: 'spur', nr: i.sc, punkt: 'pre' } : null;   // the row key `sc` is the track pre key
  return { insert_id: i.id, art: i.art as Stufe['art'], slot: i.slot, an: i.an, schluessel };
}

// the key sources the page offers one stage: every strip of the project at both points, the DJ inputs (point `post`); never the master or pads
function optionenVon(p: Projekt, traegerId: string, insert: Insert): Option[] {
  const fragen: SchluesselFrage[] = [];
  for (const s of p.spuren) for (const punkt of ['pre', 'post'] as const) fragen.push({ quelle: 'spur', nr: s.nr, punkt });
  for (const g of p.gruppen ?? []) for (const punkt of ['pre', 'post'] as const) fragen.push({ quelle: 'grp', nr: g.nr, punkt });
  for (const r of p.returns ?? []) for (const punkt of ['pre', 'post'] as const) fragen.push({ quelle: 'ret', nr: r.nr, punkt });
  for (let n = 1; n <= DJ_DECKS; n++) fragen.push({ quelle: 'deck', nr: n, punkt: 'post' });
  for (let n = 1; n <= DJ_ERZ; n++) fragen.push({ quelle: 'erz', nr: n, punkt: 'post' });
  return fragen.map((f) => {
    const a = schluesselErlaubt(p, traegerId, f, insert);
    return { quelle: f.quelle, nr: f.nr, punkt: f.punkt, erlaubt: a === null, ...(a ? { grund: a.grund, text: a.text } : {}) };
  });
}

/** The matrix of the project. `optionenFuer` = the ID of a compressor stage whose key options are listed (none otherwise); an unknown ID or a stage of
 *  another kind is `argument_ungueltig`. */
export function routingMatrix(p: Projekt, optionenFuer?: string): RoutingMatrix {
  const gruppen = p.gruppen ?? [];
  const alle = alleInserts(p);
  let wahl: { strangId: string; insert: Insert } | undefined;
  if (optionenFuer !== undefined) {
    wahl = alle.find((x) => x.insert.id === optionenFuer);
    if (!wahl) throw new BefehlFehler('argument_ungueltig', `optionen: no stage ${optionenFuer}`);
    if (wahl.insert.art !== 'komp') throw new BefehlFehler('argument_ungueltig', `optionen: only a compressor stage has a key (${wahl.insert.art})`);
  }
  const mitStufen = (strangId: string, st: InsertTraeger): Stufe[] => stufen(st).map((i) => {
    const s = stufe(i);
    if (wahl && wahl.insert === i) s.optionen = optionenVon(p, strangId, i);
    return s;
  });
  const ziele = [{ wert: 'master', name: 'Master' }, ...gruppen.map((g) => ({ wert: g.id, name: g.name }))];
  const straenge: Strang[] = [];
  for (const s of p.spuren) {
    const aktiv = s.ausgang?.id ?? 'master';
    straenge.push({ art: 'spur', id: s.id, nr: s.nr, name: s.name, ausgang: aktiv,
      // a track may feed the master or any group (ziel_setzen: unknown target = ziel_unbekannt, which the list cannot contain)
      ziel_zellen: ziele.map((z) => ({ ziel: z.wert, aktiv: z.wert === aktiv, erlaubt: true })),
      sends: sends(s.sends), stufen: mitStufen(s.id, s) });
  }
  for (const g of gruppen) {
    straenge.push({ art: 'gruppe', id: g.id, nr: g.nr, name: g.name, ausgang: 'master',
      // a group may feed the master only: itself is routing_zyklus, another group routing_grenze (groups do not nest, depth 1)
      ziel_zellen: ziele.map((z): ZielZelle => {
        if (z.wert === 'master') return { ziel: z.wert, aktiv: true, erlaubt: true };
        return z.wert === g.id ? { ziel: z.wert, aktiv: false, erlaubt: false, grund: 'routing_zyklus', text: `group ${g.id} cannot feed itself` }
          : { ziel: z.wert, aktiv: false, erlaubt: false, grund: 'routing_grenze', text: 'groups do not nest (depth 1)' };
      }),
      sends: sends(g.sends), stufen: mitStufen(g.id, g) });
  }
  for (const r of p.returns ?? []) {
    straenge.push({ art: 'return', id: r.id, nr: r.nr, name: r.name, ausgang: 'master', ziel_zellen: [], sends: [], stufen: mitStufen(r.id, r) });
  }
  if (p.master) {
    straenge.push({ art: 'pm', id: 'master', nr: 0, name: 'Master', ausgang: 'master', ziel_zellen: [], sends: [], stufen: mitStufen('master', p.master) });
  }
  return { rev: p.rev, ziele, returns: (p.returns ?? []).map((r) => ({ id: r.id, nr: r.nr, name: r.name, pre: r.pre === true })), straenge };
}
