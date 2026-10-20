// D1 S3, Auftrag 17 b (Rest der S2-Integration, Spec 6.37; Re-Review Fix8 Probe K): startet Andreas über Cyphers laufenden Transport, blieb
// transportQuelle bis zur Start-Quittung (mit quant 2 bis zum nächsten Takt) auf cypher; ein Stop Cypher in diesem Fenster stoppte seinen Lauf
// (kiStoppTransport, /k/arr/stopp). Am Stapel gemessen (Server mit Kern-Attrappe, ein Deck spielt → quant 2): das Fenster vom Absenden bis zur
// Quittung und wem der Transport darin gehört. Danach gilt ein angenommener Start von Andreas sofort als seiner. KK ohne Cyphers Lauf als
// Negativ-Kontrolle. Kein Ton.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stapel } from './hilfen/mediathek.mjs';
import { innen } from './hilfen/innen.mjs';
import { ruf, CYPHER, warte } from './hilfen/proj_stapel.mjs';

for (const vorherCypher of [true, false]) {
  const name = vorherCypher ? 'K' : 'KK';
  test(`Auftrag 17 b ${name}: Andreas startet${vorherCypher ? ' über Cyphers Lauf' : ' (ohne Cyphers Lauf, Negativ-Kontrolle)'} mit quant 2, Stop Cypher vor seinem Einsatz: sein Lauf spielt weiter`, async (t) => {
    const { o, url } = await stapel(t);
    const s = o.proj.sitzung, ctx = o.bereichKontext();
    assert.equal((await ruf(url, 'POST', '/proj/neu', { name: 'Fenster' })).code, 200);
    const status = async () => (await ruf(url, 'GET', '/proj/aktuell')).j.kern?.status;
    // ein Deck spielt (Kern-Meldung): der Server startet mit quant 2, der Kern wartet bis zur nächsten Takt-Eins
    innen(o).vomKern('/zustand/deck', { deck: 1, status: 2, material_id: 'x', basis_bpm: 128, fassung: 1, quell_beat: 0, beats_bis_ende: 64, faktor: 1, vorlauf_ms: 0 });
    if (vorherCypher) {
      const c = await ruf(url, 'POST', '/proj/transport', { aktion: 'start' }, CYPHER);
      assert.equal(c.code, 200, JSON.stringify(c.j));
      for (let i = 0; i < 100 && (await status()) !== 2; i++) await warte(50);
      assert.equal(await status(), 2, 'Cyphers Lauf spielt');
      assert.equal(s.transportQuelle, 'cypher');
    }
    const quelleVorher = s.transportQuelle;
    const t0 = Date.now();
    const lauf = ruf(url, 'POST', '/proj/transport', { aktion: 'start' });
    let antwortMs = null;
    lauf.then(() => { antwortMs = Date.now() - t0; });
    // 300 ms ins Fenster (gemessen: bis zur Quittung rund 1,8 s bei 128 BPM), dann Stop Cypher, solange die Antwort noch aussteht
    const fenster = [];
    for (let i = 0; i < 30 && antwortMs === null; i++) { fenster.push(s.transportQuelle); await warte(10); }
    const imFenster = antwortMs === null;
    await ctx.warteQuittung(ctx.sende('/k/ki/stopp', { quelle: 'andreas' }));
    const r = await lauf;
    assert.ok(imFenster, `Positiv-Kontrolle: Stop Cypher kam vor der Quittung (Antwort nach ${antwortMs} ms)`);
    await warte(1200);
    const ende = await status();
    t.diagnostic(`${name} ${JSON.stringify({ quelle_vorher: quelleVorher, antwort_ms: antwortMs, quant: r.j?.quant, fenster_quellen: [...new Set(fenster)], ki_im_fenster: imFenster, start: r.code, status_ende: ende, quelle_ende: s.transportQuelle })}`);
    await ctx.warteQuittung(ctx.sende('/k/ki/frei', { quelle: 'andreas' }));
    assert.equal(r.code, 200, JSON.stringify(r.j));
    assert.equal(r.j.quant, 2, 'mit spielendem Deck quant 2');
    assert.equal(ende, 2, 'Stop Cypher stoppt Andreas\' Lauf nicht');
    assert.equal(s.transportQuelle, 'andreas');
  });
}

// Gegenstück: lehnt der Kern Andreas' Start ab (oder antwortet nicht), gehört der Transport wieder dem, der ihn vorher hatte
import { sitzung, pruefKontext, arrNr } from './hilfen/proj_kontext.mjs';
test('Auftrag 17 b: abgelehnter oder unbeantworteter Start gibt den Transport dem vorigen zurück', async (t) => {
  for (const antwort of [{ status: 6, grund: 'nicht_geladen' }, null]) {
    const k = pruefKontext({ quittung: (adresse, f) => (adresse === '/k/arr/start' && f.quelle === 'andreas' ? antwort : { status: 3, grund: '' }) });
    const z = sitzung(t, { arrFristMs: 30 }, k);
    await z.s.neu('Eins', 'andreas');
    const nr = z.s.aktuell().j.projekt.wiedergabe_rev;
    await z.s.transport({ aktion: 'start' }, 'cypher');
    z.s.ereignis('/zustand/arr', { ...arrNr(nr), status: 2 });
    assert.equal(z.s.transportQuelle, 'cypher');
    const r = await z.s.transport({ aktion: 'start' }, 'andreas');
    assert.equal(r.j.ok, false, JSON.stringify(r.j));
    assert.equal(z.s.transportQuelle, 'cypher', `Kern ${JSON.stringify(antwort)}: Cyphers Lauf bleibt ihrer`);
  }
});
