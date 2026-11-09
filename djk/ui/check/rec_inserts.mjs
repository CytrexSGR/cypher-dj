// 1.8 T1a: the `--inserts` option of the recording proof scripts (acceptance_rec2.mjs, acceptance_rec3.mjs, later acceptance_rec4.mjs).
//   --inserts eq,saett,lim   insert chain (names of the insert pool, in chain order, at most 4) put on ONE track after spur_neu
//   --inserts-spur <n>       1-based track the chain goes on; default: the first track that is NOT the armed one (made if there is none).
//                            The PDC aligns every track to the longest path, so the armed track gets a delay ring either way.
// Without --inserts the scripts build their project as before (no chain). The PDC effect itself is not checked here.
import { Fehl } from './w3a_target.mjs';

export const INSERT_POOL = ['komp', 'eq', 'saett', 'lim'];   // main:project/commands.ts INS_POOL
export const MAX_KETTE = 4;                                    // MAX_INSERTS_PRO_STRANG
export const INSERT_OPTIONEN = { inserts: { type: 'string' }, 'inserts-spur': { type: 'string' } };
export const INSERT_HILFE = '[--inserts eq,saett,lim [--inserts-spur <n>]]';

// Pure: the two option values -> null (no chain wanted) or { namen, spur }. Throws an Error with the reason on bad input (the script exits 2).
export function leseInserts(opt) {
  const roh = opt.inserts, spurRoh = opt['inserts-spur'];
  if (roh === undefined) {
    if (spurRoh !== undefined) throw new Error('--inserts-spur needs --inserts');
    return null;
  }
  const namen = roh.split(',').map((x) => x.trim());
  if (namen.some((n) => n === '')) throw new Error(`--inserts "${roh}": empty name in the list`);
  const unbekannt = namen.filter((n) => !INSERT_POOL.includes(n));
  if (unbekannt.length) throw new Error(`--inserts: unknown insert ${unbekannt.join(', ')} (pool: ${INSERT_POOL.join(', ')})`);
  if (namen.length > MAX_KETTE) throw new Error(`--inserts: at most ${MAX_KETTE} stages per track, got ${namen.length}`);
  let spur = null;
  if (spurRoh !== undefined) {
    if (!/^[1-9]\d*$/.test(spurRoh)) throw new Error(`--inserts-spur "${spurRoh}": a track number from 1 expected`);
    spur = Number(spurRoh);
  }
  return { namen, spur };
}

// Usage check for the top of a script: prints the reason and exits 2 before anything touches the instance.
export function inserts(skript, opt) {
  try { return leseInserts(opt); } catch (e) { process.stderr.write(`${skript}: ${e.message}\n`); return process.exit(2); }
}

// Pure: the chain of a track as the project shows it ("eq,saett,lim", "none" when empty).
export const kettenText = (spur) => ((spur?.inserts ?? []).map((i) => i.art).join(',') || 'none');

// Builds the chain on the open project (after neuesProjekt, spur_neu and the arming of `scharfId`), waits for the playback to be loaded, reads the
// project back (GET /proj/aktuell), prints the chain of every track and notes one check line: the target track holds exactly the wanted chain and
// the armed track holds none. Returns { spurId, kette } (kette = names read back). cfg null: nothing happens.
export async function baueInserts(z, cfg, scharfId, label) {
  if (!cfg) return null;
  let spuren = (await z.aktuell()).projekt.spuren;
  let ziel;
  if (cfg.spur !== null) {
    ziel = spuren[cfg.spur - 1];
    if (!ziel) throw new Fehl(`${label}: --inserts-spur ${cfg.spur}, but the project has ${spuren.length} track(s)`);
  } else {
    ziel = spuren.find((s) => s.id !== scharfId);
    if (!ziel) {
      await z.aendern(`${label} insert track`, [{ befehl: 'spur_neu', art: 'audio', name: 'Ins' }]);
      spuren = (await z.aktuell()).projekt.spuren;
      ziel = spuren.find((s) => s.id !== scharfId);
    }
    if (!ziel) throw new Fehl(`${label}: no track without arming to put the chain on`);
  }
  await z.aendern(`${label} inserts`, cfg.namen.map((art, pos) => ({ befehl: 'insert_setzen', strang_id: ziel.id, pos, art })));
  await z.geladen();
  spuren = (await z.aktuell()).projekt.spuren;
  const kette = kettenText(spuren.find((s) => s.id === ziel.id));
  const scharf = kettenText(spuren.find((s) => s.id === scharfId));
  z.info(`${label} inserts: ${spuren.map((s, i) => `track ${i + 1} "${s.name}"${s.id === scharfId ? ' (armed)' : ''}${s.id === ziel.id ? ' (target)' : ''}: ${kettenText(s)}`).join('; ')}`);
  const soll = cfg.namen.join(',');
  z.notiere(`${label} the chain ${soll} sits on the target track${ziel.id === scharfId ? '' : ' and the armed track has none'}`,
    kette === soll && (ziel.id === scharfId || scharf === 'none'), `target ${kette}, armed ${scharf}`);
  return { spurId: ziel.id, kette: kette === 'none' ? [] : kette.split(',') };
}
