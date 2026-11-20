// The + INSERT entries of a strip (pure) and the DOM part: the chip and its menu.
import { ARTEN, HOST_ART, MAX_ART, MAX_PLAETZE, anzahl, frei, straenge, neuerInsertBefehl, insertLabels } from '../production/inserts.js';
import { MAX_HOST } from '../production/limits.js';
import { pluginGrund } from '../production/devices_browser.js';
import { duckKicks, duckBefehl } from '../production/key_choice.js';
import { knopfEl } from './blocks.js';

const PLUS_ARTEN = [['komp', 'Compressor'], ['eq', 'EQ'], ['saett', 'Saturator'], ['lim', 'Limiter']];
export const PLUS_VOLL_TEXT = `The strip holds ${MAX_PLAETZE} stages`;
/**
 * The entries of the "+" menu: [{text, befehl | null, grund?, label?} | {gruppe: true, text}]; befehl is null (with the reason) when the strip is full, the
 * pool of that kind is empty or a plugin is blocked. `opt` (all optional, `{}` is the STUDIO list): util adds Utility after Limiter; zaehler appends
 * " used/max" to the kinds and plugins; plugins is the GET /plugins list (effects only); duck is the kick list of `duckKicks` (the caller checks that the
 * strip is a track with a free compressor).
 */
export function plusEintraege(p, strangId, graphen, opt = {}) {
  const strang = straenge(p).find((s) => s.id === strangId);
  const voll = !strang || strang.inserts.length >= MAX_PLAETZE;
  const mitZahl = (text, art) => (opt.zaehler ? `${text} ${anzahl(p, art)}/${art === 'host' ? MAX_HOST : MAX_ART[art]}` : text);
  const eintrag = (text, art, graph) => {
    const t = mitZahl(text, art);
    const b = voll ? null : neuerInsertBefehl(p, strangId, art);
    if (!b) return { text: t, befehl: null, grund: voll ? PLUS_VOLL_TEXT : ARTEN[art].voll };
    return { text: t, befehl: art === 'bk' ? { ...b, graph } : b };
  };
  const arten = opt.util ? [...PLUS_ARTEN, ['utility', 'Utility']] : PLUS_ARTEN;
  const aus = [
    ...arten.map(([art, text]) => eintrag(text, art)),
    ...(graphen ?? []).filter((g) => g?.art === 'effekt' && typeof g.name === 'string').map((g) => eintrag(g.name, 'bk', g.name)),
  ];
  const effekte = (opt.plugins ?? []).filter((e) => e?.art === 'effekt');
  if (effekte.length > 0) {
    aus.push({ gruppe: true, text: 'Plugins' });
    for (const e of effekte) {
      const text = mitZahl(e.name, 'host');
      const grund = voll ? PLUS_VOLL_TEXT : pluginGrund(e) || (anzahl(p, 'host') >= MAX_HOST ? HOST_ART.voll : '');
      aus.push(grund
        ? { text, befehl: null, grund }
        : { text, befehl: { befehl: 'insert_setzen', strang_id: strangId, pos: (strang.inserts ?? []).length, art: 'host', plugin_id: e.id }, label: `Add ${e.name} to ${strang.name}` });
    }
  }
  if ((opt.duck ?? []).length > 0 && strang) {
    aus.push({ gruppe: true, text: 'Duck by Kick' });
    for (const k of opt.duck) {
      const text = `Track ${k.nr} ${k.name}`;
      aus.push(voll ? { text, befehl: null, grund: PLUS_VOLL_TEXT } : { text, befehl: duckBefehl(strangId, k.id), label: `Duck ${strang.name} by ${k.name}` });
    }
  }
  return aus;
}

// ---- the DOM part: the "+ INSERT" chip and its menu (`werk` is the state of one mounted dock, see dock.js) ----------------------------------------------
export async function plusMenue(werk, id, anker) {
  const { host } = werk;
  const s = werk.strangVon(id);
  if (!s) return;
  const graphen = await werk.quelle.graphen(true);
  const o = host.plusOptionen ?? {};
  const opt = { util: !!o.util, zaehler: !!o.zaehler };
  if (o.plugins) {
    const r = await host.holeGet('/plugins');
    const liste = Array.isArray(r?.j) ? r.j : r?.j?.plugins;   // GET /plugins answers {plugins, scan}; a failed fetch leaves the group out
    if (r?.status === 200 && Array.isArray(liste)) opt.plugins = liste;
  }
  const p0 = host.projekt();
  if (o.duck && s.art === 'spur' && p0 && frei(p0, 'komp') > 0) opt.duck = duckKicks(p0, id);
  const vorher = new Set(s.inserts.map((i) => i.id)), name = s.name;
  const schreibe = async (label, befehl) => {
    if (!(await host.aendere(label, [befehl]))) return;
    const neu = werk.strangVon(id)?.inserts.find((i) => !vorher.has(i.id));
    if (neu) host.oeffneStufe?.(id, neu.id); else if (werk.returnVon(id)) host.oeffneStufe?.(id, 'hall');
  };
  const punkte = [
    ...(werk.returnVon(id)?.hall?.an === false ? [{ text: 'Hall', aktion: () => schreibe(`Hall on return ${werk.returnVon(id).name}`, { befehl: 'return_aendern', return_id: id, hall: { an: true } }) }] : []),
    ...plusEintraege(host.projekt(), id, graphen, opt).map((e) => (e.gruppe ? e : { text: e.text, aus: e.befehl === null, titel: e.grund,
      aktion: () => schreibe(e.label ?? (e.befehl.art === 'bk' ? `Add ${e.befehl.graph} to ${name}` : insertLabels(name, s.inserts.length + 1, e.befehl.art).neu), e.befehl) })),
  ];
  const q = anker.getBoundingClientRect();
  host.oeffneMenue(punkte, q.left, q.bottom);
}
export function plusKnopf(werk, strangId) {
  const b = knopfEl('w-chip-teil w-chip-plus', 'karte-plus', werk.T.plus, werk.T.plusTitel);
  if ((werk.strangVon(strangId)?.inserts.length ?? 0) >= MAX_PLAETZE) { b.disabled = true; b.title = PLUS_VOLL_TEXT; }
  b.addEventListener('click', (e) => { e.stopPropagation?.(); plusMenue(werk, strangId, b); });
  return b;
}
