// D1 S2-Integration, Slice 0: was S2 von S1 und K1 voraussetzt, am laufenden Stapel (Seiten-Server + Kern-Attrappe) geprüft, bevor S2
// darauf baut. Scheitert hier etwas, liegt der Fehler in der Basis (S1 oder K1), nicht in S2: anhalten und melden.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stapel } from './hilfen/mediathek.mjs';
import { innen } from './hilfen/innen.mjs';
import { bis, anKern } from './hilfen/proj_stapel.mjs';

test('S1 Haken ereignis (Spec 2.10): ein Bereich hört jedes Kern-Ereignis, auch ungedrosselte und nicht durchgereichte, nach dem Stand der Oberfläche', async (t) => {
  const { o } = await stapel(t);
  const gehoert = [];
  o.meldeBereich({ name: 'hoerer', routen: () => [], ereignis: (adresse, felder) => gehoert.push([adresse, felder, innen(o).kiGestoppt]) });
  innen(o).vomKern('/zustand/kern', { generation: 1, ki_gestoppt: 0 });
  innen(o).vomKern('/e/ki', { gestoppt: 1, grund: 'hand', sample: 0 });
  for (let i = 0; i < 5; i++) innen(o).vomKern('/uhr', { sample: i, mono_ns: 0, beat: i, bpm: 128, bpm_pro_s: 0 });
  assert.deepEqual(gehoert.map(([a]) => a), ['/zustand/kern', '/e/ki', '/uhr', '/uhr', '/uhr', '/uhr', '/uhr'], 'alle, auch /zustand/kern, /uhr ungedrosselt');
  assert.equal(gehoert[1][2], true, 'der Haken sieht den schon nachgeführten KI-Stand');
  o.meldeBereich({ name: 'wirft', routen: () => [], ereignis: () => { throw new Error('kaputt'); } });
  assert.doesNotThrow(() => innen(o).vomKern('/uhr', { sample: 9, mono_ns: 0, beat: 9, bpm: 128, bpm_pro_s: 0 }), 'ein werfender Bereich hält vomKern nicht an');
});

test('K1 /k/arr/laden trägt nr (Spec 6.1), /zustand/arr meldet nr; Spur-Fader bis +6 dB (Spec 6.16)', async (t) => {
  const { o, log } = await stapel(t);
  const ctx = o.bereichKontext();
  const gehoert = [];
  o.meldeBereich({ name: 'arr', routen: () => [], ereignis: (a, f) => { if (a === '/zustand/arr') gehoert.push(f); } });
  const id = ctx.sende('/k/arr/laden', { quelle: 'andreas', nr: 5 });
  assert.deepEqual(await ctx.warteQuittung(id), { status: 3, grund: '' });
  assert.ok(await bis(() => gehoert.some((f) => f.nr === 5)), JSON.stringify(gehoert));
  assert.deepEqual(anKern(log, '/k/arr/laden').at(-1).felder, { id, quelle: 'andreas', nr: 5 });
  const teil = (nach) => ctx.sende('/k/teil', { quelle: 'andreas', plan: '', teil: 0, pfad: 'spur/1/fader', ab_beat: 0, dauer_beats: 0, nach, form: 0, politik: 1, gruppe: '', hoerschein: '' });
  assert.ok([3, 5].includes((await ctx.warteQuittung(teil(6))).status), '+6 dB angenommen');
  assert.deepEqual(await ctx.warteQuittung(teil(6.5)), { status: 6, grund: 'ausserhalb_bereich' });
});

test('K1 KI-Spur-Maske (Spec 6.15, 6.22): eine Liste spur/<ziffern> lässt die Kanal-Liste des Leitstands stehen, spur/0 leert nur die Spur-Maske; der KI-Stopp senkt beide', async (t) => {
  const { o } = await stapel(t);
  const ctx = o.bereichKontext();
  const regler = [];
  o.meldeBereich({ name: 'ki', routen: () => [], ereignis: (a, f) => { if (a === '/e/regler' && /\/fader$/.test(String(f.pfad))) regler.push(f); } });
  const q = async (adresse, felder) => ctx.warteQuittung(ctx.sende(adresse, felder));
  const ok = (x) => x !== null && ![4, 6, 7, 8].includes(x.status);
  assert.ok(ok(await q('/k/ki/spur', { quelle: 'leitstand', kanaele: 'erz/2' })));
  assert.ok(ok(await q('/k/ki/spur', { quelle: 'andreas', kanaele: 'spur/1' })), 'spur/<ziffern> angenommen (K1 ki.cpp:94-112)');
  for (const pfad of ['erz/2/fader', 'spur/1/fader']) {
    await q('/k/teil', { quelle: 'andreas', plan: '', teil: 0, pfad, ab_beat: 0, dauer_beats: 0, nach: -6, form: 0, politik: 1, gruppe: '', hoerschein: '' });
  }
  await q('/k/ki/stopp', { quelle: 'andreas' });
  assert.ok(await bis(() => ['erz/2/fader', 'spur/1/fader'].every((p) => regler.some((f) => f.pfad === p && f.wert === -200)), 8000),
    `beide gesenkt: ${JSON.stringify(regler.map((f) => [f.pfad, f.wert]))}`);
  assert.equal((await q('/k/ki/spur', { quelle: 'andreas', kanaele: 'spur/9' })).status, 6, 'Spur 9 gibt es nicht');
  // spur/0 = keine Spur: leert nur die Spur-Maske; die Kanal-Maske (erz/2) bleibt. Nach dem Frei und neuem Fader senkt ein Stopp nur erz/2.
  assert.ok(ok(await q('/k/ki/spur', { quelle: 'andreas', kanaele: 'spur/0' })), 'spur/0 angenommen');
  await q('/k/ki/frei', { quelle: 'andreas' });
  regler.length = 0;
  for (const pfad of ['erz/2/fader', 'spur/1/fader']) {
    await q('/k/teil', { quelle: 'andreas', plan: '', teil: 0, pfad, ab_beat: 0, dauer_beats: 0, nach: -6, form: 0, politik: 1, gruppe: '', hoerschein: '' });
  }
  await q('/k/ki/stopp', { quelle: 'andreas' });
  assert.ok(await bis(() => regler.some((f) => f.pfad === 'erz/2/fader' && f.wert === -200), 8000), 'Kanal-Maske blieb stehen');
  assert.ok(!regler.some((f) => f.pfad === 'spur/1/fader' && f.wert === -200), 'Spur-Maske war leer (Negativ-Kontrolle)');
});
