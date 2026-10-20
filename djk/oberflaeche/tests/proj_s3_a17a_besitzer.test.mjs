// D1 S3, Auftrag 17 a (Rest der S2-Integration, Spec 6.37; Re-Review Fix8, Proben L und LK, ~/messungen/2026-10-15-d1-s2-integration/rereview-fix8/):
// vollziehe prüfte bei einer wartenden Rückfahrt nur den Pfad, nicht wem die Spur gehört. Löscht Andreas während einer wartenden Rückfahrt Cyphers
// Spur und legt auf demselben Slot eine eigene an, landete sein Fader in this.rueckfahrt; ein neuer Stopp brach sie ab und setzte −200 nach, die
// Freigabe fuhr nur Cyphers Spuren zurück: seine Spur endete bei −200, ohne dass ein Stopp galt (Probe L: kern_ende −200). Nach 6.37 stehen in
// this.rueckfahrt nach jeder Änderung nur Fader von Cyphers Spuren des neuen Stands; wechselt der Besitzer eines Slots, wird die Rückfahrt
// abgebrochen und der Wert des neuen Stands auf den eigenen Weg gelegt (zielNachAusblende, Plan proj_ziel), den weder Stopp noch Freigabe anfassen.
// Probe L als Test, LK (ohne Rückfahrt) als Negativ-Kontrolle. Server mit Kern-Attrappe auf CYPHERDJ_TEST_INSTANZ, kein Ton.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stapel } from './hilfen/mediathek.mjs';
import { innen } from './hilfen/innen.mjs';
import { bis, ruf, CYPHER, warte } from './hilfen/proj_stapel.mjs';

for (const mitRueck of [true, false]) {
  const name = mitRueck ? 'L' : 'LK';
  test(`Auftrag 17 a ${name}: Andreas löscht Cyphers Spur 1 und legt eine eigene an${mitRueck ? ' während ihre Rückfahrt wartet' : ' (ohne Rückfahrt, Negativ-Kontrolle)'}; neuer Stopp, Freigabe: seine Spur endet auf 0 dB`, async (t) => {
    const { o, url } = await stapel(t);
    await ruf(url, 'POST', '/proj/neu', { name: 'Alpha' });
    let r = await ruf(url, 'POST', '/proj/aendern', { rev: 0, label: 'S', befehle: [{ befehl: 'spur_neu', art: 'instrument' }] }, CYPHER);
    assert.equal(r.code, 200);
    r = await ruf(url, 'POST', '/proj/aendern', { rev: r.j.rev, label: 'Fader', befehle: [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: -3 }] });
    assert.equal(r.code, 200);
    const wert = (pfad) => innen(o).stand.regler[pfad];
    assert.ok(await bis(() => wert('spur/1/fader') === -3));
    const bpm = (await ruf(url, 'GET', '/lage')).j.uhr.bpm;
    const ctx = o.bereichKontext();
    const s = o.proj.sitzung;
    if (mitRueck) {
      await ctx.warteQuittung(ctx.sende('/k/ki/stopp', { quelle: 'andreas' }));
      await warte(Math.round(60000 / bpm));
      await ctx.warteQuittung(ctx.sende('/k/ki/frei', { quelle: 'andreas' }));
      assert.ok(await bis(() => s.rueckfahrt.size > 0, 2000), 'Positiv-Kontrolle: die Rückfahrt ist gesendet und wartet');
    }
    const rev = (await ruf(url, 'GET', '/proj/aktuell?nur=rev')).j.rev;
    const del = await ruf(url, 'POST', '/proj/aendern', { rev, label: 'Del', befehle: [{ befehl: 'spur_loeschen', spur_id: 's1' }] });
    const neu = await ruf(url, 'POST', '/proj/aendern', { rev: del.j?.rev, label: 'Neu', befehle: [{ befehl: 'spur_neu', art: 'audio' }] });
    assert.deepEqual([del.code, neu.code], [200, 200], JSON.stringify([del.j, neu.j]));
    const p1 = (await ruf(url, 'GET', '/proj/aktuell')).j.projekt;
    assert.deepEqual(p1.spuren.map((x) => [x.nr, x.von]), [[1, 'andreas']], 'Slot 1 gehört jetzt Andreas');
    const inRueck = s.rueckfahrt.has('spur/1/fader');
    await ctx.warteQuittung(ctx.sende('/k/ki/stopp', { quelle: 'andreas' }));
    await warte(Math.round(9 * 60000 / bpm));
    const imStopp = wert('spur/1/fader');
    await ctx.warteQuittung(ctx.sende('/k/ki/frei', { quelle: 'andreas' }));
    await warte(Math.round(10 * 60000 / bpm));
    const lage = (await ruf(url, 'GET', '/lage')).j;
    const p = (await ruf(url, 'GET', '/proj/aktuell')).j.projekt;
    t.diagnostic(`${name} ${JSON.stringify({ del: del.j?.kern ?? null, neu: neu.j?.kern ?? null, im_stopp: imStopp, ki_ende: lage.ki?.gestoppt, in_rueckfahrt_nach_neu: inRueck, projekt: p.spuren.map((x) => [x.nr, x.von, x.fader_db]), kern_ende: wert('spur/1/fader') })}`);
    assert.equal(lage.ki?.gestoppt, false, 'kein Stopp gilt');
    assert.equal(p.spuren[0].fader_db, 0, 'im Projekt 0 dB');
    assert.equal(wert('spur/1/fader'), 0, 'Andreas\' Spur 1 endet im Kern auf ihrem Projektwert (0 dB), nicht stumm ohne Stopp');
    assert.equal(inRueck, false, 'Spec 6.37: in der Rückfahrt stehen nach der Änderung nur Fader von Cyphers Spuren des neuen Stands');
  });
}
