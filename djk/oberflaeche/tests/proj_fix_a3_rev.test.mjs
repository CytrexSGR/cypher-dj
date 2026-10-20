// D1 S2-Integration, Fix-Runde A3 (Spec 6.30, Quality-Review R4): /proj/aendern prüft die rev nach jedem await noch einmal gegen den
// offenen Stand. S3 (Freeze, Export) schreibt über zugang.uebernimm synchron, also auch während eine Änderung in der Kette auf ihre
// Regler-Quittungen wartet. Die wartende Änderung wurde gegen die alte rev geprüft und darf den neuen Stand nicht überschreiben:
// 409 rev_veraltet, ihre schon gesetzten Regler gehen auf den offenen Stand zurück. Aufbau wie review-qual/probe_s2.test.mjs R4.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { projBereich } from '../bereiche/proj/bereich.ts';
import { aendere } from '../projekt/verlauf.ts';
import { pruefKontext } from './hilfen/proj_kontext.mjs';
import { tmpOrdner } from './hilfen/projekt.mjs';

const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));
const fehlerVon = async (p) => { try { return { r: await p }; } catch (e) { return { e }; } };

async function aufbau(t) {
  const k = pruefKontext();
  let verzoegern = false;
  const orig = k.warteQuittung.bind(k);
  k.warteQuittung = async (id) => { if (verzoegern) await schlaf(80); return orig(id); };
  const d = tmpOrdner(t, 'djk-fixa3-');
  const b = projBereich(k, { wurzel: path.join(d, 'p'), arbeitsordner: path.join(d, 'arr'), arrFristMs: 30 });
  t.after(() => b.sitzung.schliesse());
  await b.sitzung.neu('F', 'andreas');
  await b.sitzung.aendern({ rev: 0, label: 'Spuren', befehle: [{ befehl: 'spur_neu', art: 'instrument' }, { befehl: 'spur_neu', art: 'instrument' }] }, 'andreas');
  k.leere();
  return { k, s: b.sitzung, z: b.zugang, verzoegere: (x) => { verzoegern = x; } };
}
// S3-Schreibweg: lebender Stand aus offen(), aendere mit haken(), dann uebernimm (synchron gesetzt)
async function s3Schreibt(z) {
  const o = z.offen();
  const meta = { quelle: 'andreas', label: 'Freeze' };
  const w = aendere(o.verlauf, o.projekt, [{ befehl: 'spur_aendern', spur_id: 's2', name: 'Freeze' }], meta, z.haken());
  await z.uebernimm(w, meta);
  return w.projekt.rev;
}

test('A3 S3 schreibt, während /proj/aendern auf Regler-Quittungen wartet → 409 rev_veraltet, S3-Stand bleibt, Fader zurück', async (t) => {
  const { k, s, z, verzoegere } = await aufbau(t);
  verzoegere(true);
  const p = fehlerVon(s.aendern({ rev: 1, label: 'Fader s1', befehle: [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: -6 }] }, 'andreas'));
  await schlaf(20);
  const s3rev = await s3Schreibt(z);
  const { r, e } = await p;
  verzoegere(false);
  assert.equal(r, undefined, `erwartet 409, bekommen ${r?.code}`);
  assert.deepEqual([e.code, e.fehler, e.extra.rev], [409, 'rev_veraltet', 2]);
  const proj = s.aktuell().j.projekt;
  assert.equal(proj.rev, s3rev); assert.equal(proj.rev, 2);
  assert.equal(proj.spuren[0].fader_db, 0, 'Fader s1 nicht übernommen');
  assert.equal(proj.spuren[1].name, 'Freeze', 'S3-Änderung bleibt');
  assert.equal(z.offen().verlauf.liste().at(-1).label, 'Freeze', 'kein Verlaufseintrag der abgelehnten Änderung');
  assert.deepEqual(k.teile(/^spur\/1\/fader$/).map((x) => x.felder.nach), [-6, 0], 'gesetzter Fader geht auf den offenen Stand zurück');
});

test('A3 Negativ-Kontrolle: ohne S3-Schreiben dazwischen geht dieselbe Änderung mit Verzögerung durch (200, rev 2)', async (t) => {
  const { k, s, verzoegere } = await aufbau(t);
  verzoegere(true);
  const r = await s.aendern({ rev: 1, label: 'Fader s1', befehle: [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: -6 }] }, 'andreas');
  verzoegere(false);
  assert.equal(r.code, 200); assert.equal(r.j.rev, 2); assert.equal(s.aktuell().j.projekt.spuren[0].fader_db, -6);
  assert.deepEqual(k.teile(/^spur\/1\/fader$/).map((x) => x.felder.nach), [-6]);
});

test('A3 undo: S3 schreibt während der Regler-Quittungen eines Undo → 409 rev_veraltet, S3-Stand bleibt', async (t) => {
  const { s, z, verzoegere } = await aufbau(t);
  await s.aendern({ rev: 1, label: 'Fader s1', befehle: [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: -6 }] }, 'andreas');
  verzoegere(true);
  const p = fehlerVon(s.umkehr('undo', { rev: 2 }, 'andreas'));
  await schlaf(20);
  await s3Schreibt(z);
  const { r, e } = await p;
  verzoegere(false);
  assert.equal(r, undefined, `erwartet 409, bekommen ${r?.code}`);
  assert.deepEqual([e.code, e.fehler], [409, 'rev_veraltet']);
  const proj = s.aktuell().j.projekt;
  assert.equal(proj.rev, 3); assert.equal(proj.spuren[0].fader_db, -6); assert.equal(proj.spuren[1].name, 'Freeze');
});
