// I08: Geräte-Panel der PRODUCTION-Seite (Oberfläche englisch). Zeigt Eingang 1 bis 4: Profil, Status, Pegel, Latenz, Freigabe für Cypher.
// Ändern darf nur Andreas (die Seite schickt als er); Cypher sieht das Panel nicht, er liest geraete_lage.
export const pegelBreite = (db) => (typeof db === 'number' && Number.isFinite(db) && db > -60 ? Math.min(100, Math.round(((db + 60) / 60) * 100)) : 0);
// erkennung: das Feld der Server-Antwort ('ok' oder 'nicht_verfuegbar', wenn pw-dump ausfiel). Ohne Erkennung ist „nicht da“ nicht belegt.
export function statusText(e, erkennung = 'ok') {
  const t = statusBasis(e, erkennung);
  // T5a: a usb-audio assignment picks one of possibly several USB nodes (first one, or the one Cypher named): the status names it, so a wrong pick is visible
  return e.audio && e.profil === 'usb-audio' && e.audio.knoten ? `${t} · ${e.audio.knoten}` : t;
}
function statusBasis(e, erkennung) {
  if (!e.audio) return 'no device';
  if (erkennung === 'nicht_verfuegbar') return 'detection unavailable';
  if (!e.da) return 'device not present';
  if (e.verbunden === null) return 'core not reporting';   // Kern still (kein /zustand/ein seit 2 s): unbekannt, nicht "nicht verbunden"
  return e.verbunden ? 'connected' : 'device found, not linked yet';
}
export const midiStatusText = (m, erkennung = 'ok') => (!m.port ? 'no device' : erkennung === 'nicht_verfuegbar' ? 'detection unavailable' : !m.da ? 'device not present' : m.verbunden === null ? 'core not reporting' : m.verbunden ? 'connected' : 'device found, not linked yet');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// 1.8 S2b (AK14): a profile measured at another cycle size than the core runs now is outdated (quantum 0 = the core has not reported one yet: unknown, not outdated)
export const latenzVeraltet = (l, quantum = 0) => !!l && quantum > 0 && l.quantum !== quantum;
export const latenzText = (l, quantum = 0) => (l ? `${((l.samples / l.rate) * 1000).toFixed(1)} ms ±${((l.streuung / l.rate) * 1000).toFixed(2)} (${l.art === 'kabel' ? 'cable' : 'software'} loop, quantum ${l.quantum})${latenzVeraltet(l, quantum) ? ' · outdated' : ''}` : '');
export function zeileHtml(e, profile, erkennung = 'ok', quantum = 0) {
  const opt = ['<option value="">(none)</option>', ...profile.filter((p) => p.audio).map((p) => `<option value="${esc(p.id)}"${e.profil === p.id ? ' selected' : ''}>${esc(p.name)}</option>`)].join('');
  return `<div class="p-gzeile" data-k="${e.k}">
<span class="p-gname">${esc(e.name)}</span>
<select data-profil="${e.k}" aria-label="Device profile for input ${e.k}">${opt}</select>
<span class="p-gstatus" role="status">${statusText(e, erkennung)}</span>
<div class="meter waagrecht" data-kanal="ein/${e.k}" aria-label="Level of input ${e.k}"><i style="width:${pegelBreite(e.pegel_db)}%"></i></div>
<label><input type="checkbox" data-frei="${e.k}" aria-label="Let Cypher use input ${e.k}"${e.frei_fuer_cypher ? ' checked' : ''}${e.audio ? '' : ' disabled'}> Cypher may use</label>
<span class="p-glatenz">${esc(latenzText(e.latenz, quantum))}</span>
<span class="p-ghinweis">${esc(e.audio_hinweis ?? '')}</span>
</div>`;
}

// Mirrors areas/devices/profile.ts: istSoftwarePort (Bluetooth MIDI server bluez_midi.*, Midi Through) never counts as a device;
// 'midi-controller' fits every other source, 'xdj-xz' only the XDJ-XZ. Keep in sync with the predicates there.
export const midiQuelleName = (q) => String(q.alias || '').split(':')[0].trim() || q.port;
export function passendeMidiQuellen(profilId, quellen = []) {
  const software = (q) => /^bluez_midi\./.test(q.port) || /Midi Through/i.test(q.port) || /Midi Through/i.test(q.alias || '');
  const passt = profilId === 'midi-controller' ? () => true : profilId === 'xdj-xz' ? (q) => /XDJ-XZ/.test(`${q.port} ${q.alias || ''}`) : () => false;
  return quellen.filter((q) => !software(q) && passt(q));
}
// Two ports of one device share a name: label them with the port suffix of the alias ("LPD8: MIDI 1" -> "LPD8 (MIDI 1)"), else of the port name.
const portSuffix = (q) => (String(q.alias || '').includes(':') ? String(q.alias).split(':').slice(1).join(':') : String(q.port).split(':').pop()).trim();
export function midiPortOptionen(m, fit) {
  const namen = fit.map(midiQuelleName);
  const mehrfach = (i) => namen.filter((n) => n === namen[i]).length > 1;
  const opts = fit.map((q, i) => `<option value="${esc(q.port)}"${m.port === q.port ? ' selected' : ''}>${esc(mehrfach(i) && portSuffix(q) ? `${namen[i]} (${portSuffix(q)})` : namen[i])}</option>`);
  // the configured port is not in the list (unplugged): keep it visible instead of silently showing another one
  if (m.profil && m.port && !fit.some((q) => q.port === m.port)) {
    const name = String(m.port).split(':').pop() ?? m.port;
    opts.push(`<option value="${esc(m.port)}" selected>${esc(name)} (not connected)</option>`);
  }
  return opts;
}
function midiPortHtml(m, quellen) {
  const fit = passendeMidiQuellen(m.profil, quellen);
  const opts = midiPortOptionen(m, fit);
  if (opts.length > 1 || (opts.length === 1 && fit.length === 0)) {
    return `<select data-midi-port="1" aria-label="MIDI source for the MIDI input">${opts.join('')}</select>`;
  }
  return fit.length === 1 ? `<span class="p-gport">${esc(midiQuelleName(fit[0]))}</span>` : '';
}
export function midiZeileHtml(m, profile, erkennung = 'ok', quellen = []) {
  const opt = ['<option value="">(none)</option>', ...profile.filter((p) => p.midi).map((p) => `<option value="${esc(p.id)}"${m.profil === p.id ? ' selected' : ''}>${esc(p.name)}</option>`)].join('');
  const status = midiStatusText(m, erkennung);
  return `<div class="p-gzeile" data-midi="1"><span class="p-gname">MIDI input</span>
<select data-midi-profil="1" aria-label="Device profile for the MIDI input">${opt}</select>${midiPortHtml(m, quellen)}
<span class="p-gstatus" role="status">${status}</span>
<span></span>
<label><input type="checkbox" data-midi-frei="1" aria-label="Let Cypher use the MIDI input"${m.frei_fuer_cypher ? ' checked' : ''}${m.port ? '' : ' disabled'}> Cypher may use</label>
</div>`;
}

// Steuerelemente, deren Fokus ein Neuzeichnen übersteht: Attribut je dataset-Schlüssel.
const STEUER = { profil: 'data-profil', frei: 'data-frei', midiProfil: 'data-midi-profil', midiPort: 'data-midi-port', midiFrei: 'data-midi-frei' };
const fokusSelektor = (el) => { const k = el && el.dataset ? Object.keys(STEUER).find((n) => el.dataset[n] !== undefined) : undefined; return k ? `[${STEUER[k]}="${el.dataset[k]}"]` : null; };

export function bindeGeraete(ctx) {
  const { $ } = ctx;
  const liste = $('geraete-liste');
  let stand = null;
  let quantum = 0;          // cycle size of the core, from /zustand/rec (2 Hz idle); the outdated flag of a latency profile compares against it
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
      setze(`[data-k="${e.k}"] .p-glatenz`, (n) => { n.textContent = latenzText(e.latenz, quantum); });
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
    liste.innerHTML = stand.eingaenge.map((e) => zeileHtml(e, stand.profile, erk, quantum)).join('') + midiZeileHtml(stand.midi, stand.profile, erk, stand.quellen?.midi ?? []);
    ausstehend = false;
    if (sel) { const n = liste.querySelector(sel); if (n) n.focus(); }
  };
  async function lade(erzwinge = false) {
    const r = await ctx.holeGet('/geraete');
    if (r.status === 200) {
      stand = r.j; maske = stand.kern?.ein?.verbunden ?? 0; zeichne(erzwinge);
      if (ctx.st) ctx.st.geraete = stand;                       // the track heads list the external pairs that have a device
      for (const h of ctx.beiGeraete ?? []) h(stand);
    } else ctx.melde(ctx.antwortText(r), true);
  }
  liste.addEventListener('change', async (ev) => {
    const t = ev.target;
    const midi = t.dataset.midiProfil !== undefined || t.dataset.midiPort !== undefined || t.dataset.midiFrei !== undefined;
    const body = t.dataset.profil ? { k: Number(t.dataset.profil), profil: t.value || null } : t.dataset.frei ? { k: Number(t.dataset.frei), frei_fuer_cypher: t.checked }
      : t.dataset.midiProfil !== undefined ? { profil: t.value || null } : t.dataset.midiPort !== undefined ? { profil: stand.midi.profil, port: t.value } : t.dataset.midiFrei !== undefined ? { frei_fuer_cypher: t.checked } : null;
    if (!body) return;
    const r = await ctx.holeJson(midi ? '/geraete/midi' : '/geraete/eingang', body);
    if (r.status !== 200) ctx.melde(ctx.antwortText(r), true);
    await lade(true);   // der Server hat das letzte Wort, auch nach einer Ablehnung (das Auswahlfeld zeigt dann wieder seinen Stand)
  });
  liste.addEventListener('focusout', (ev) => { if (ausstehend && !(ev.relatedTarget && liste.contains(ev.relatedTarget))) zeichne(); });
  ctx.beimEreignis.push((a, f) => {
    if (a === '/zustand/rec' && typeof f.quantum === 'number' && f.quantum !== quantum) { quantum = f.quantum; if (stand) auffrischen(); }
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
