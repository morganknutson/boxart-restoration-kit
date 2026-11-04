// Box art sources — URL state (shareable links) and render().
// ── Links: the page state lives in the URL (?game=gb/<stem>&view=front&updated=1&q=…&flags=…&plat=…&region=…&page=…)
const enc = v => encodeURIComponent(v).replace(/%2F/g, '/').replace(/%2C/g, ',').replace(/%7C/g, '|');
const gameURL = g => '?game=' + enc(g.plat + '/' + g.stem);
let urlSyncing = false;
function readURL() {
  const p = new URLSearchParams(location.search);
  const gm = p.get('game');
  if (gm) { const i = gm.indexOf('/'); const k = gm.slice(0, i) + '|' + gm.slice(i + 1); st.selected = gameIndex.has(k) ? k : null; } else st.selected = null;
  st.view = viewFaces[p.get('view')] ? p.get('view') : 'assets';
  st.updated = p.get('updated') === '1';
  VW.want = p.get('asset'); if (!VW.want) VW.i = 0;
  st.q = p.get('q') || '';
  st.page = Math.max(0, (+p.get('page') || 1) - 1);
  for (const [k, set] of [['flags', st.flags], ['plat', st.plats], ['region', st.regions]]) { set.clear(); (p.get(k) || '').split(',').filter(Boolean).forEach(v => set.add(v)); }
  if (!p.has('region')) (KIT.default_regions || []).forEach(r => st.regions.add(r)); else if (p.get('region') === 'all') st.regions.clear();
  document.getElementById('q').value = st.q;
  document.getElementById('updatedOnly').checked = st.updated;
}
function writeURL() {
  if (urlSyncing) return;
  const p = new URLSearchParams(location.search);
  const set = (k, v) => v ? p.set(k, v) : p.delete(k);
  const sel = gameIndex.get(st.selected);
  set('game', sel ? sel.plat + '/' + sel.stem : '');
  if (!sel || (p.get('game') !== new URLSearchParams(location.search).get('game'))) p.delete('asset');
  set('view', st.view !== 'assets' ? st.view : '');
  set('updated', st.updated ? '1' : '');
  set('q', st.q);
  set('page', !sel && st.page ? String(st.page + 1) : '');
  set('flags', [...st.flags].join(',')); set('plat', [...st.plats].join(',')); const dflt = [...(KIT.default_regions || [])].sort().join(','), cur = [...st.regions].sort().join(',');
  set('region', cur === dflt ? '' : st.regions.size ? [...st.regions].join(',') : 'all');
  const url = '?' + [...p].map(([k, v]) => k + '=' + enc(v)).join('&');
  if (url === location.search || (url === '?' && !location.search)) return;
  const prevGame = new URLSearchParams(location.search).get('game');
  (prevGame !== p.get('game') ? history.pushState : history.replaceState).call(history, null, '', url === '?' ? location.pathname : url);
}
window.addEventListener('popstate', () => { readURL(); urlSyncing = true; render(); urlSyncing = false; window.scrollTo(0, 0); });
document.getElementById('list').addEventListener('click', e => {
  if (e.target.closest('[data-back]')) { e.preventDefault(); document.getElementById('browseAll').click(); return; }
  const a = e.target.closest('[data-golink]');
  if (a && !e.metaKey && !e.ctrlKey && !e.shiftKey) { e.preventDefault(); st.selected = decodeURIComponent(a.closest('.game').dataset.g); render(); window.scrollTo(0, 0); return; }
  const c = e.target.closest('[data-copylink]'); if (!c) return;
  e.preventDefault(); e.stopPropagation();
  const g = gameIndex.get(decodeURIComponent(c.closest('.game').dataset.g));
  // copied links use kit.json public_url when set (the address other machines use), else this page's address
  const origin = (KIT.public_url || location.origin).replace(/\/$/, '');   // kit.json public_url: the address others use
  const it = st.selected === gkey(g) && VW.key === gkey(g) ? VW.seq[VW.i] : null;
  const url = origin + location.pathname + (it && VW.i ? assetURL(g, it.id) : gameURL(g));
  (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => toast('Link copied'), () => prompt('Copy this link:', url));
}, true);
function render() {
  chips();
  const l = list(), pages = Math.max(1, Math.ceil(l.length / st.per));
  renderSidebar(l);
  document.getElementById('viewMode').value = st.view;
  st.page = Math.min(st.page, pages - 1);
  const selected = gameIndex.get(st.selected);
  const slice = selected ? [selected] : l.slice(st.page * st.per, (st.page + 1) * st.per);
  document.getElementById('count').textContent = selected ? '' : `${l.length} games · page ${st.page + 1} of ${pages}`;
  document.getElementById('browseAll').hidden = !selected;
  document.querySelector('.count-row').hidden = !!selected;     // a game is open: its card header has the back button
  document.getElementById('pageSize').hidden = !!selected;
  document.getElementById('list').innerHTML = slice.length ? slice.map(gameHTML).join('') : '<p class="none">No games match your search or filters.</p>';
  paintRegions();
  fitViewerLayers();
  writeURL();
  syncAssetURL();
  const pg = document.getElementById('pager'); pg.innerHTML = '';
  pg.hidden = !!selected || !l.length;
  if (pg.hidden) return;
  const btn = (t, p, dis) => { const b = document.createElement('button'); b.className = 'chip'; b.textContent = t; b.disabled = dis;
    b.onclick = () => { st.page = p; render(); window.scrollTo(0, 0); }; return b; };
  pg.append(btn('← Previous', st.page - 1, st.page === 0), document.createTextNode(` ${st.page + 1} / ${pages} `), btn('Next →', st.page + 1, st.page >= pages - 1));
}
document.getElementById('q').oninput = e => { st.q = e.target.value.trim(); st.selected = null; st.page = 0; render(); };
document.getElementById('per').onchange = e => { st.per = +e.target.value; st.selected = null; st.page = 0; render(); };
document.getElementById('list').addEventListener('click', e => {
  const btn = e.target.closest('.flagimg, .rr[data-game]');
  if (!btn) return;
  e.stopPropagation(); e.preventDefault();
  const card = btn.closest('.game'), gk = decodeURIComponent(card.dataset.g);
  const g = games.find(x => gkey(x) === gk);
  const img = btn.dataset.img ? decodeURIComponent(btn.dataset.img) : null, face = btn.dataset.face || null;
  const prev = MARKS[btn.dataset.game ? gk : decodeURIComponent(btn.dataset.k || '')];
  const info = {kind: btn.dataset.game ? 'game' : 'art', platform: g.plat, stem: g.stem, face, image: img,
                regions: prev && !prev.resolved && prev.regions ? prev.regions : null};   // editing the note keeps drawn boxes
  if (btn.dataset.act === 'base') return setBase(g, face, img, !isBase(g, face, img));
  if (btn.dataset.act === 'draw') {
    const pic = btn.closest('figure').querySelector('img');
    return openDrawer(decodeURIComponent(btn.dataset.k), info, pic.dataset.full || pic.getAttribute('src'), `${g.stem} · ${face}`);
  }
  if (btn.dataset.act === 'note') {
    const key = decodeURIComponent(btn.dataset.k), cur = (MARKS[key] || {}).note || '';
    const note = prompt('What should be fixed on this image? (saved on the Mac; leave empty to remove the note)', cur);
    if (note === null) return;
    if (!note.trim() && !MARKS[key]) return;
    return setMark(key, true, Object.assign(info, {note: note.trim() || null}));
  }
  const key = btn.dataset.game ? gk : decodeURIComponent(btn.dataset.k);
  const marked = !MARKS[key];
  let note = marked ? ((MARKS[key] || {}).note || null) : null;
  if (marked && e.shiftKey) { note = prompt('Note for the re-review (optional):') || null; }
  setMark(key, marked, Object.assign(info, {note}));
}, true);
document.getElementById('list').onclick = e => {
  if (e.target.tagName !== 'IMG' || e.target.closest('.vw-strip')) return;
  if (!e.target.closest('.texture-map') && zoom(e.target)) return;      // the editor: same controls everywhere
  document.getElementById('modalImg').src = e.target.dataset.full || e.target.src; document.getElementById('modal').classList.add('on');
};
document.getElementById('list').addEventListener('error', e => {
  if (!e.target.matches('.texture-map img')) return;
  e.target.hidden = true; e.target.nextElementSibling.hidden = false;
  e.target.closest('figure').querySelector('figcaption').hidden = true;
}, true);
document.getElementById('modal').onclick = () => document.getElementById('modal').classList.remove('on');
document.addEventListener('keydown', e => { if (e.key === 'Escape') document.getElementById('modal').classList.remove('on'); });
