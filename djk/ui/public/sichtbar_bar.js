// A polling tick that stays quiet while the tab is hidden and fires once when it comes back (UI polish task 6, Nr. 32). The rate while visible is unchanged.
export function taktSichtbar(f, ms, { setze = (g, t) => setInterval(g, t), dok = document } = {}) {
  const handle = setze(() => { if (!dok.hidden) f(); }, ms);
  dok.addEventListener('visibilitychange', () => { if (!dok.hidden) f(); });
  return handle;
}
