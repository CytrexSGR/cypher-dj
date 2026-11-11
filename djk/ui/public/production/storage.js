// PRODUCTION (D1 V1): Ziehen aus LIBRARY auf eine Audio-Spur (Spec 2.11, A2). Die Zeilen des vorhandenen Browsers
// (#libliste, app.js stoebernZeile) bekommen nur in PRODUCTION draggable, und nur, wenn nutzlast() sie annimmt; die
// DJ-Ansicht bleibt unverändert. Ablegen schickt clip_neu mit dem Katalog-sha (Pfad löst der Server).
import { ZIEH_TYP, nutzlast, ablageBefehl, ABLAGE_TEXT, GERAET_TYP, geraetAblage, effektBefehl } from './drag.js';
import { pluginSpurBefehl } from './devices_browser.js';
import { MAX_PLAETZE, straenge } from './inserts.js';
import { xZuBeat, rasterBeats } from './timeline.js';
import { spurIndexBeiTabelle } from './layout.js';
import { PRESET_TYP, presetZiel } from './preset_target.js';
import { wendePresetAn } from './preset_apply.js';   // 1.16 rest U7

export function bindeAblage(ctx) {
  const { st, $ } = ctx;
  const liste = document.querySelector('#libliste');
  const zeileZu = (tr) => ctx.stoebern()?.treffer?.[Number(tr?.dataset.i)];
  function markiere() {
    if (!liste) return;
    for (const tr of liste.rows) {
      if (st.sichtbar && nutzlast(zeileZu(tr))) { if (!tr.draggable) { tr.draggable = true; tr.dataset.prodZieh = '1'; } }
      else if (tr.dataset.prodZieh) { tr.draggable = false; delete tr.dataset.prodZieh; }
    }
  }
  if (liste) {
    new MutationObserver(markiere).observe(liste, { childList: true });
    liste.addEventListener('dragstart', (e) => {
      if (!st.sichtbar) return;
      const n = nutzlast(zeileZu(e.target.closest?.('tr')));
      if (n) { e.dataTransfer.setData(ZIEH_TYP, JSON.stringify(n)); e.dataTransfer.effectAllowed = 'copy'; }
    });
  }
  ctx.beimSichtwechsel.push(markiere);
  const ueber = $('ueber');
  ueber.addEventListener('dragover', (e) => {
    if (st.projekt && (e.dataTransfer.types.includes(GERAET_TYP) || e.dataTransfer.types.includes(PRESET_TYP))) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; return; }   // 1.16 rest: a device or a preset
    if (!st.projekt || !e.dataTransfer.types.includes(ZIEH_TYP)) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
    st.geist = { x: e.offsetX, spur: spurIndexBeiTabelle(ctx.zeilen(), e.offsetY) };
  });
  ueber.addEventListener('dragleave', () => { st.geist = null; });
  ueber.addEventListener('drop', (e) => {
    st.geist = null;
    if (st.projekt && e.dataTransfer.types.includes(GERAET_TYP)) { e.preventDefault(); legeGeraet(e); return; }
    if (st.projekt && e.dataTransfer.types.includes(PRESET_TYP)) { e.preventDefault(); legePreset(e, { spurIndex: spurIndexBeiTabelle(ctx.zeilen(), e.offsetY) }); return; }
    if (!st.projekt || !e.dataTransfer.types.includes(ZIEH_TYP)) return;
    e.preventDefault();
    let n = null; try { n = JSON.parse(e.dataTransfer.getData(ZIEH_TYP)); } catch { return; }
    const i = spurIndexBeiTabelle(ctx.zeilen(), e.offsetY), beat = xZuBeat(st.ansicht, e.offsetX), raster = rasterBeats(st.raster);
    const r = ablageBefehl(st.projekt, n, i, beat, raster);
    if (r.fehler) { ctx.melde(ABLAGE_TEXT[r.fehler], true); return; }
    // V2 Fix-Runde 2 H1 (Spec 6.34): die Spur, auf die die Person gezeigt hat, bleibt fest; die Länge in Beats folgt aus dem Tempo im Stand beim
    // Senden (ctx.aendereAus), nicht beim Ablegen: ein TEMPO davor, der noch unterwegs ist, zählt mit
    const spurId = r.befehl.spur_id;
    ctx.aendereAus((p) => {
      const x = ablageBefehl(p, n, p.spuren.findIndex((s) => s.id === spurId), beat, raster);
      return x.befehl ? { label: 'Add clip', befehle: [x.befehl] } : null;
    });
  });

  // 1.16 rest (U6, S3): a device from the DEVICES list. An instrument anywhere on the arrangement makes a new track; an effect on a track row
  // appends a stage to that track's chain. A refusal (inactive kind, full chain, no free compressor) only shows its text; nothing is sent.
  const lies = (e) => { try { return JSON.parse(e.dataTransfer.getData(GERAET_TYP)); } catch { return null; } };
  function legeGeraet(e) {
    const n = lies(e);
    if (!n) return;
    if (n.art === 'instrument') { const r = pluginSpurBefehl(n); ctx.aendere(r.label, [r.befehl]); return; }   // plan 1.11 task 17: anywhere on the arrangement
    if (n.art === 'host') { const i = spurIndexBeiTabelle(ctx.zeilen(), e.offsetY); legePlugin(st.projekt?.spuren?.[i]?.id, n); return; }
    const r = geraetAblage(st.projekt, n, spurIndexBeiTabelle(ctx.zeilen(), e.offsetY));
    if (r.fehler) { ctx.melde(r.text, true); return; }
    ctx.aendere(r.label, r.befehle);
  }
  // plan 1.11 task 11: a foreign effect plugin ({art: 'host', plugin_id}) becomes a stage at the end of the chain of a strip; the click in the PLUGINS list
  // uses the first selected strip. A full chain or no strip only shows its text; nothing is sent.
  function legePlugin(strangId, n) {
    const s = strangId ? straenge(st.projekt).find((x) => x.id === strangId) : null;
    if (!s) { ctx.melde('Drop the plugin on a track row, or select a strip first', true); return; }
    if (s.inserts.length >= MAX_PLAETZE) { ctx.melde(`All ${MAX_PLAETZE} stages of this strip are used`, true); return; }
    ctx.aendere(`Add ${n.titel ?? 'plugin'} to ${s.name}`, [{ befehl: 'insert_setzen', strang_id: strangId, art: 'host', plugin_id: n.plugin_id }]);
  }
  ctx.fuegePluginEin = (n) => legePlugin([...(st.spurWahl ?? [])][0], n);
  // 1.16 rest (U7, S4): a preset from the PRESETS list. presetZiel() picks the target (or the reason), the server computes the plan, one write follows.
  const liesPreset = (e) => { try { return JSON.parse(e.dataTransfer.getData(PRESET_TYP)); } catch { return null; } };
  function legePreset(e, wohin) {
    const n = liesPreset(e);
    if (!n) return;
    const r = presetZiel(st.projekt, wohin, n);
    if (r.fehler) { ctx.melde(r.text, true); return; }
    wendePresetAn(ctx, n, r.ziel);
  }
  // an effect dropped on a strip row of the INSERTS block (tracks, groups, returns, master)
  const kette = $('inserts-liste');
  const zeile = (e) => e.target?.closest?.('.p-kette[data-strang]') ?? null;
  const istPreset = (e) => e.dataTransfer.types.includes(PRESET_TYP);
  kette?.addEventListener('dragover', (e) => {
    if (!st.projekt || !(e.dataTransfer.types.includes(GERAET_TYP) || istPreset(e)) || !zeile(e)) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
  });
  kette?.addEventListener('drop', (e) => {
    const z = zeile(e);
    if (!st.projekt || !(e.dataTransfer.types.includes(GERAET_TYP) || istPreset(e)) || !z) return;
    e.preventDefault();
    if (istPreset(e)) {   // a stage takes the preset itself (kind must match); a strip row without a stage gets a new stage
      const stufe = e.target?.closest?.('.p-stufe[data-insert]');
      legePreset(e, stufe ? { stufe: stufe.dataset.insert } : { strang: z.dataset.strang });
      return;
    }
    const n = lies(e);
    if (!n) return;
    if (n.art === 'host') { legePlugin(z.dataset.strang, n); return; }
    if (n.ziel !== 'insert') { ctx.melde('Drop instruments on the arrangement', true); return; }
    const r = effektBefehl(st.projekt, z.dataset.strang, n);
    if (r.fehler) { ctx.melde(r.text, true); return; }
    ctx.aendere(r.label, [r.befehl]);
  });
}
