// D1 S2-Integration, Slice 0: was S2 von S1 und K1 voraussetzt, am laufenden Stapel (Seiten-Server + Kern-Attrappe) geprüft, bevor S2
// darauf baut. Scheitert hier etwas, liegt der Fehler in der Basis (S1 oder K1), nicht in S2: anhalten und melden.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stapel } from './hilfen/mediathek.mjs';
import { innen } from './hilfen/innen.mjs';
import { bis, anKern, warte } from './hilfen/proj_stapel.mjs';

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

test('K1 KI-Spur-Listen (Spec 6.15, 6.22; E-a): E3 P1: nur spur/0 angenommen, spur/1, spur/33 und spur/135 abgelehnt; der KI-Stopp senkt keinen Fader', async (t) => {
  const { o } = await stapel(t);
  const ctx = o.bereichKontext();
  const regler = [];
  o.meldeBereich({ name: 'ki', routen: () => [], ereignis: (a, f) => { if (a === '/e/regler' && /\/fader$/.test(String(f.pfad))) regler.push(f); } });
  const q = async (adresse, felder) => ctx.warteQuittung(ctx.sende(adresse, felder));
  const ok = (x) => x !== null && ![4, 6, 7, 8].includes(x.status);
  const fahre = async (nach) => {
    for (const pfad of ['erz/2/fader', 'spur/1/fader']) {
      await q('/k/teil', { quelle: 'andreas', plan: '', teil: 0, pfad, ab_beat: 0, dauer_beats: 0, nach, form: 0, politik: 1, gruppe: '', hoerschein: '' });
    }
    return bis(() => ['erz/2/fader', 'spur/1/fader'].every((p) => regler.some((f) => f.pfad === p && f.wert === nach)), 3000);
  };
  assert.ok(ok(await q('/k/ki/spur', { quelle: 'leitstand', kanaele: 'erz/2' })));
  assert.equal((await q('/k/ki/spur', { quelle: 'andreas', kanaele: 'spur/1' })).status, 6, 'E3 P1: spur/1 abgelehnt wie ein unbekannter Kanal');
  assert.ok(await fahre(-6), 'beide Fader stehen auf −6');
  regler.length = 0;
  await q('/k/ki/stopp', { quelle: 'andreas' });
  await warte(3000);                                    // länger als die frühere Ausblende (4 Beats bei 128 BPM: 1,9 s)
  assert.deepEqual(regler.map((f) => [f.pfad, f.wert]), [], 'E-a: kein Fader in einer KI-Spur bewegt sich (vorher beide auf −200)');
  assert.equal((await q('/k/ki/spur', { quelle: 'andreas', kanaele: 'spur/33' })).status, 6, 'Spur 33 gibt es nicht');
  assert.equal((await q('/k/ki/spur', { quelle: 'andreas', kanaele: 'spur/135' })).status, 6, 'E3 P1: keine Spur-Maske');
  assert.ok(ok(await q('/k/ki/spur', { quelle: 'andreas', kanaele: 'spur/0' })), 'spur/0 angenommen');
  // Negativ-Kontrolle: Andreas' Hand wirkt im Stopp weiter (die Freigabe ist nicht nötig, um einen Fader zu setzen)
  assert.ok(await fahre(-9), 'nach dem Stopp lässt sich jeder Fader von Andreas setzen');
});
