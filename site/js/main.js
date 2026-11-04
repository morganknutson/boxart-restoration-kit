// Box art sources — Start-up and live updates.
readURL();
loadMarks().then(() => { render(); renderQueuePanel(); });

// Live updates: the box audit server pushes an event whenever restored art, references, marks, restore bases,
// verdicts or the site itself change (GET /api/events). The page swaps in the new data without a reload and keeps
// your place: open game and asset, scroll, triage position. While the box editor is open, updates wait for it to close.
const LIVE = {kinds: new Set(), games: new Set(), timer: null};
const isOpen = id => document.getElementById(id).classList.contains('on');
function niceGame(k) {               // "<platform>|<game>|<asset>" → "<game> <asset>"
  const [, stem, face] = k.split('|');
  return stem + (face && face !== 'provenance' && !face.endsWith('restoration') ? ' ' + face : '');
}
async function applyLive() {
  LIVE.timer = null;
  if (isOpen('drawer')) { LIVE.timer = setTimeout(applyLive, 1000); return; }
  const kinds = new Set(LIVE.kinds), games = [...LIVE.games];
  LIVE.kinds.clear(); LIVE.games.clear();
  if (kinds.has('site')) {
    if (!isOpen('triage')) { location.reload(); return; }
    toast('The page was updated — reload when you finish triage');
  }
  try {
    if (kinds.has('restored')) {
      const t = await (await fetch('restored.js', {cache: 'no-store'})).text();
      (new Function(t))();
      for (const k of Object.keys(R)) delete R[k];
      Object.assign(R, window.RESTORED);
    }
    await loadMarks();
  } catch (e) { return; }
  if (isOpen('triage')) {             // keep the queue, point it at the fresh data
    const fresh = it => ((R[it.r.key] || {})[it.r.face] || []).find(x => x.full === it.r.full) || it.r;
    TR.q = TR.q.map(it => ({g: it.g, r: fresh(it)}));
    TR.hist = TR.hist.map(it => ({g: it.g, r: fresh(it)}));
    trShow();
  } else {
    render();
  }
  renderQueuePanel();
  const named = [...new Set(games.map(niceGame))];
  if (named.length) toast('Updated: ' + named.slice(0, 3).join(', ') + (named.length > 3 ? ` and ${named.length - 3} more` : ''));
}
function onLive(kind, data) {
  LIVE.kinds.add(kind);
  for (const g of (data && data.games) || []) LIVE.games.add(g);
  clearTimeout(LIVE.timer); LIVE.timer = setTimeout(applyLive, 300);
}
if (window.EventSource) {
  const es = new EventSource('/api/events');
  for (const k of ['restored', 'rereview', 'base', 'approval', 'refs', 'site', 'fixqueue'])
    es.addEventListener(k, e => { let d = {}; try { d = JSON.parse(e.data); } catch (_) {} onLive(k, d); });
}
