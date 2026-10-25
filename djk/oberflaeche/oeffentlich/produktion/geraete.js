// I08: Geräte-Panel der PRODUCTION-Seite (Oberfläche englisch). Zeigt Eingang 1 bis 4: Profil, Status, Pegel, Latenz, Freigabe für Cypher.
// Ändern darf nur Andreas (die Seite schickt als er); Cypher sieht das Panel nicht, er liest geraete_lage.
export const pegelBreite = (db) => (typeof db === 'number' && Number.isFinite(db) && db > -60 ? Math.min(100, Math.round(((db + 60) / 60) * 100)) : 0);
// erkennung: das Feld der Server-Antwort ('ok' oder 'nicht_verfuegbar', wenn pw-dump ausfiel). Ohne Erkennung ist „nicht da“ nicht belegt.
export function statusText(e, erkennung = 'ok') {
  if (!e.audio) return 'no device';
  if (erkennung === 'nicht_verfuegbar') return 'detection unavailable';
  if (!e.da) return 'device not present';
  if (e.verbunden === null) return 'core not reporting';   // Kern still (kein /zustand/ein seit 2 s): unbekannt, nicht "nicht verbunden"
  return e.verbunden ? 'connected' : 'device found, not linked yet';
}
export const midiStatusText = (m, erkennung = 'ok') => (!m.port ? 'no device' : erkennung === 'nicht_verfuegbar' ? 'detection unavailable' : !m.da ? 'device not present' : m.verbunden === null ? 'core not reporting' : m.verbunden ? 'connected' : 'device found, not linked yet');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const latenzText = (l) => (l ? `${((l.samples / l.rate) * 1000).toFixed(1)} ms ±${((l.streuung / l.rate) * 1000).toFixed(2)} (${l.art === 'kabel' ? 'cable' : 'software'} loop, quantum ${l.quantum})` : '');
export function zeileHtml(e, profile, erkennung = 'ok') {
  const opt = ['<option value="">(none)</option>', ...profile.filter((p) => p.audio).map((p) => `<option value="${esc(p.id)}"${e.profil === p.id ? ' selected' : ''}>${esc(p.name)}</option>`)].join('');
  return `<div class="p-gzeile" data-k="${e.k}">
<span class="p-gname">${esc(e.name)}</span>
<select data-profil="${e.k}" aria-label="Device profile for input ${e.k}">${opt}</select>
<span class="p-gstatus" role="status">${statusText(e, erkennung)}</span>
<div class="meter waagrecht" data-kanal="ein/${e.k}" aria-label="Level of input ${e.k}"><i style="width:${pegelBreite(e.pegel_db)}%"></i></div>
<label><input type="checkbox" data-frei="${e.k}" aria-label="Let Cypher use input ${e.k}"${e.frei_fuer_cypher ? ' checked' : ''}${e.audio ? '' : ' disabled'}> Cypher may use</label>
<span class="p-glatenz">${esc(latenzText(e.latenz))}</span>
<span class="p-ghinweis">${esc(e.audio_hinweis ?? '')}</span>
</div>`;
}

export function midiZeileHtml(m, profile, erkennung = 'ok') {
  const opt = ['<option value="">(none)</option>', ...profile.filter((p) => p.midi).map((p) => `<option value="${esc(p.id)}"${m.profil === p.id ? ' selected' : ''}>${esc(p.name)}</option>`)].join('');
  const status = midiStatusText(m, erkennung);
  return `<div class="p-gzeile" data-midi="1"><span class="p-gname">MIDI input</span>
<select data-midi-profil="1" aria-label="Device profile for the MIDI input">${opt}</select>
<span class="p-gstatus" role="status">${status}</span>
<span></span>
<label><input type="checkbox" data-midi-frei="1" aria-label="Let Cypher use the MIDI input"${m.frei_fuer_cypher ? ' checked' : ''}${m.port ? '' : ' disabled'}> Cypher may use</label>
</div>`;
}

// Steuerelemente, deren Fokus ein Neuzeichnen übersteht: Attribut je dataset-Schlüssel.
const STEUER = { profil: 'data-profil', frei: 'data-frei', midiProfil: 'data-midi-profil', midiFrei: 'data-midi-frei' };
const fokusSelektor = (el) => { const k = el && el.dataset ? Object.keys(STEUER).find((n) => el.dataset[n] !== undefined) : undefined; return k ? `[${STEUER[k]}="${el.dataset[k]}"]` : null; };

export function bindeGeraete(ctx) {
  const { $ } = ctx;
  const liste = $('geraete-liste');
  let stand = null;
  let maske = 0;            // Verbindungsmaske des Kerns, wie der geladene Stand sie trägt; /zustand/ein wird dagegen verglichen
  let ausstehend = false;   // ein Neuzeichnen wurde zurückgestellt, weil ein Steuerelement den Fokus hielt
  // Ein Neuzeichnen unter laufender Bedienung (Fokus im Panel) wartet bis zum Fokusverlust, damit ein offenes Auswahlfeld nicht zugeht.
  // erzwinge (nach der eigenen Änderung): sofort neu, der Fokus geht auf dasselbe Steuerelement zurück.
  // Unter Fokus bleiben die Steuerelemente stehen, Status, Latenz, Hinweis und die Sperre der Freigabe werden nachgeführt (sonst bliebe
  // „not linked yet“ stehen, bis jemand woanders hinklickt).
  const auffrischen = () => {
    const erk = stand.erkennung ?? 'ok';
    const setze = (sel, f) => { const n = liste.querySelector(sel); if (n) f(n); };
    for (const e of stand.eingaenge) {
      setze(`[data-k="${e.k}"] .p-gstatus`, (n) => { n.textContent = statusText(e, erk); });
      setze(`[data-k="${e.k}"] .p-glatenz`, (n) => { n.textContent = latenzText(e.latenz); });
      setze(`[data-k="${e.k}"] .p-ghinweis`, (n) => { n.textContent = e.audio_hinweis ?? ''; });
      setze(`[data-frei="${e.k}"]`, (n) => { if (n !== document.activeElement) { n.disabled = !e.audio; n.checked = !!e.frei_fuer_cypher; } });
    }
    setze('[data-midi="1"] .p-gstatus', (n) => { n.textContent = midiStatusText(stand.midi, erk); });
    setze('[data-midi-frei="1"]', (n) => { if (n !== document.activeElement) { n.disabled = !stand.midi.port; n.checked = !!stand.midi.frei_fuer_cypher; } });
  };
  const zeichne = (erzwinge = false) => {
    if (!stand) return;
    const aktiv = document.activeElement;
    const drin = liste.contains(aktiv);
    if (drin && !erzwinge) { ausstehend = true; auffrischen(); return; }
    const sel = drin ? fokusSelektor(aktiv) : null;
    const erk = stand.erkennung ?? 'ok';
    liste.innerHTML = stand.eingaenge.map((e) => zeileHtml(e, stand.profile, erk)).join('') + midiZeileHtml(stand.midi, stand.profile, erk);
    ausstehend = false;
    if (sel) { const n = liste.querySelector(sel); if (n) n.focus(); }
  };
  async function lade(erzwinge = false) {
    const r = await ctx.holeGet('/geraete');
    if (r.status === 200) { stand = r.j; maske = stand.kern?.ein?.verbunden ?? 0; zeichne(erzwinge); } else ctx.melde(ctx.antwortText(r), true);
  }
  liste.addEventListener('change', async (ev) => {
    const t = ev.target;
    const midi = t.dataset.midiProfil !== undefined || t.dataset.midiFrei !== undefined;
    const body = t.dataset.profil ? { k: Number(t.dataset.profil), profil: t.value || null } : t.dataset.frei ? { k: Number(t.dataset.frei), frei_fuer_cypher: t.checked }
      : t.dataset.midiProfil !== undefined ? { profil: t.value || null } : t.dataset.midiFrei !== undefined ? { frei_fuer_cypher: t.checked } : null;
    if (!body) return;
    const r = await ctx.holeJson(midi ? '/geraete/midi' : '/geraete/eingang', body);
    if (r.status !== 200) ctx.melde(ctx.antwortText(r), true);
    await lade(true);   // der Server hat das letzte Wort, auch nach einer Ablehnung (das Auswahlfeld zeigt dann wieder seinen Stand)
  });
  liste.addEventListener('focusout', (ev) => { if (ausstehend && !(ev.relatedTarget && liste.contains(ev.relatedTarget))) zeichne(); });
  ctx.beimEreignis.push((a, f) => {
    if (a === '/pegel' && typeof f.kanal === 'string' && f.kanal.startsWith('ein/')) {
      const i = liste.querySelector(`.meter[data-kanal="${f.kanal}"] i`);
      if (i) i.style.width = `${pegelBreite(Number(f.spitze_db))}%`;
    }
  });
  // Abweichung vom Plan-Text (Task 11 Step 3): /zustand/ein trägt die Verbindungsmaske des Kerns; ändert sie sich gegenüber dem geladenen Stand,
  // wird der Stand neu geholt, sonst bliebe der Status nach dem Verbinden auf „not linked yet“ stehen (Step 5 verlangt den Wechsel auf „connected“).
  ctx.beimEreignis.push((a, f) => {
    if (a !== '/zustand/ein' || typeof f.verbunden !== 'number' || f.verbunden === maske) return;
    maske = f.verbunden;   // sofort merken: weitere Ereignisse mit demselben Wert holen nicht noch einmal; lade() setzt den Stand des Servers ein
    lade();
  });
  ctx.beimSichtwechsel.push((sichtbar) => { if (sichtbar) lade(); });
  lade();
}
