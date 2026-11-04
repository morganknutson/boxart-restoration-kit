// Box art sources — Single-game viewer: big restored art / references with their comparison; asset links; J/K and arrow keys.
// ── Single-game viewer: the restored faces and the saved references, big, with what each should be compared to.
// ← / → step through them; J / K go to the next / previous game in the sidebar.
let VW = {key: null, i: 0, seq: [], want: null};
const assetURL = (g, id) => gameURL(g) + '&asset=' + enc(id);
function viewerSeq(g) {
  const seq = [], faces = (viewFaces[st.view] || FACE_ORDER);
  for (const face of FACE_ORDER.filter(f => faces.includes(f)))
    ((R[gkey(g)] || {})[face] || []).forEach((r, n) => seq.push({kind: 'restored', id: n ? face + '.' + (n + 1) : face, face, url: vFull(r), thumb: vThumb(r), r, label: 'Restored · ' + face}));
  const u = f => ['refs', g.plat, g.stem, f].map(encodeURIComponent).join('/');
  for (const f of (REFS[gkey(g)] || [])) seq.push({kind: 'ref', id: 'ref/' + f, url: u(f), thumb: u(f), label: 'Reference · ' + f});
  return seq;
}
function viewerHTML(g) {
  const seq = viewerSeq(g);
  if (VW.key !== gkey(g)) VW = {key: gkey(g), i: 0, seq, want: VW.want};
  if (VW.want != null) { const j = seq.findIndex(x => x.id === VW.want || x.face === VW.want); if (j >= 0) VW.i = j; VW.want = null; }
  VW.seq = seq; VW.i = Math.min(VW.i, Math.max(0, seq.length - 1));
  if (!seq.length) return '';
  const it = seq[VW.i];
  let cmp = null;
  if (it.kind === 'restored') { const s_ = srcFor(g, it.face); if (s_) cmp = {url: encodeURI(s_.url), label: s_.label.toLowerCase(), cls: 'src', face: it.face, img: s_.img}; }
  else { const last = [...seq.slice(0, VW.i)].reverse().find(x => x.kind === 'restored') || seq.find(x => x.kind === 'restored'); if (last) cmp = {url: last.url, label: last.label, cls: '', face: last.face, img: last.r.full}; }
  // clicking a big image opens the box editor on it (references just zoom); saved boxes are drawn on it
  const mk = (face, img, title) => img ? ` data-mk="${encodeURIComponent(akey(g, face, img))}" data-face="${face}" data-img="${encodeURIComponent(img)}" data-title="${esc(title)}" title="Click to draw boxes over what's wrong"` : '';
  const layer = (face, img) => { const m = img && MARKS[akey(g, face, img)]; return m && !m.resolved && m.regions ? `<div class="rgn-layer vw-layer">${rgnHTML(m.regions)}</div>` : ''; };
  const mainImg = it.kind === 'restored' ? it.r.full : null;
  const tag = it.kind === 'restored' ? `<a class="tag" href="${assetURL(g, it.id)}" data-asset="${esc(it.id)}" title="Link to this asset">${esc(it.label)}</a>${it.r.model ? `<span class="vw-model">${esc(it.r.model)}</span>` : ''}${verdictBadge(it.r)}${verdictButtons(it.r)}${markupButton(g, it)}` : `<a class="tag ref" href="${assetURL(g, it.id)}" data-asset="${esc(it.id)}" title="Link to this asset">${esc(it.label)}</a>${markupButton(g, it)}`;
  return `<div class="viewer"><div class="vw-pane"><div class="vw-cap">${tag}<span style="margin-left:auto">${VW.i + 1} / ${seq.length}</span></div><div class="vw-img"><img src="${it.url}" data-full="${it.url}"${mk(it.face, mainImg, g.stem + ' · ' + it.label)} alt="">${layer(it.face, mainImg)}</div></div>` +
    (cmp ? `<div class="vw-pane"><div class="vw-cap"><span class="tag ${cmp.cls}">${esc(cmp.label)}</span></div><div class="vw-img"><img src="${cmp.url}" data-full="${cmp.url}"${mk(cmp.face, cmp.img, g.stem + ' · ' + cmp.face + ' · ' + cmp.label)} alt="">${layer(cmp.face, cmp.img)}</div></div>` : '') + `</div>
    <div class="vw-strip">${seq.map((x, i) => `<img data-vw="${i}" class="${i === VW.i ? 'on' : ''}" src="${x.thumb}" title="${esc(x.label)}" alt="">`).join('')}</div>
    <div class="vw-help">A approve · R reject (again to undo) · B mark up · ← → step through art and references · J K next / previous game · Esc back to the list</div>`;
}
function fitViewerLayers() {
  for (const l of document.querySelectorAll('#list .vw-layer')) {
    const img = l.parentElement.querySelector('img');
    const place = () => {
      const nw = img.naturalWidth, nh = img.naturalHeight, bw = img.clientWidth, bh = img.clientHeight; if (!nw || !bw) return;
      const k = Math.min(bw / nw, bh / nh), w = nw * k, h = nh * k;
      Object.assign(l.style, {left: img.offsetLeft + (bw - w) / 2 + 'px', top: img.offsetTop + (bh - h) / 2 + 'px', width: w + 'px', height: h + 'px'});
    };
    if (img.complete && img.naturalWidth) place(); else img.addEventListener('load', place, {once: true});
  }
}
window.addEventListener('resize', fitViewerLayers);
document.getElementById('list').addEventListener('click', e => {
  const img = e.target.closest('.vw-pane img'); if (!img) return;
  e.preventDefault(); e.stopPropagation();
  zoom(img);
}, true);
// approve / reject the restored asset being viewed (A / R); the same verdicts as triage
function verdictButtons(r) {
  const v = verdict(r), cur = v && !v.stale ? v.v : null;
  return `<span class="vw-verdict"><button class="chip ok${cur === 'approved' ? ' on' : ''}" data-verdict="approved" title="Approve this asset (A)">✓ Approve</button>` +
         `<button class="chip no${cur === 'rejected' ? ' on' : ''}" data-verdict="rejected" title="Reject this asset (R)">✗ Reject</button></span>`;
}
async function viewerVerdict(v) {
  const g = gameIndex.get(st.selected), it = VW.seq[VW.i];
  if (!g || !it || it.kind !== 'restored') return toast('Pick a restored asset to approve or reject');
  const cur = verdict(it.r), undo = cur && !cur.stale && cur.v === v;
  if (!await setVerdict(g, it.r, undo ? null : v)) return;
  toast(undo ? 'Verdict cleared' : v === 'approved' ? `Approved ${it.face}` : `Rejected ${it.face}`);
  if (!undo) { const n = VW.seq.findIndex((x, j) => j > VW.i && x.kind === 'restored'); if (n >= 0) VW.i = n; }
  render();
  if (!undo) nextGameIfJudged(g);
}
// Every restored asset of the open game has your verdict (for its current file) → go to the next game that still
// has unjudged restored art.
const judged = r => { const v = verdict(r); return !!(v && !v.stale); };
function nextGameIfJudged(g) {
  if (!g || st.selected !== gkey(g)) return;
  const rs = allRest(g);
  if (!rs.length || !rs.every(judged)) return;
  const i = sidebarOrder.findIndex(x => gkey(x) === gkey(g));
  const next = sidebarOrder.slice(i + 1).find(x => { const a = allRest(x); return a.length && !a.every(judged); });
  if (!next) return toast('All restored art in this list is judged');
  setTimeout(() => {
    if (st.selected !== gkey(g) || document.getElementById('drawer').classList.contains('on')) return;
    toast(`All judged — next: ${next.stem}`);
    st.selected = gkey(next); VW.want = null; render(); window.scrollTo(0, 0);
  }, 700);
}
document.getElementById('list').addEventListener('click', e => {
  const b = e.target.closest('[data-verdict]'); if (!b) return;
  e.preventDefault(); e.stopPropagation(); viewerVerdict(b.dataset.verdict);
}, true);
// ▭ Mark up (B): boxes / note on the image being viewed — the same editor as clicking it
function markupButton(g, it) {
  const m = MARKS[akey(g, it.face || 'refs', it.kind === 'restored' ? it.r.full : decodeURIComponent(it.url.split('?')[0]))];
  const n = m && !m.resolved && m.regions ? m.regions.length : 0;
  return `<button class="chip vw-markup${n ? ' on' : ''}" data-markup="1" title="Draw boxes over what's wrong / add a note (B)">▭ Mark up${n ? ' · ' + n : ''}</button>`;
}
function viewerMarkup() { const img = document.querySelector('#list .viewer .vw-pane img'); if (img) zoom(img); }
document.getElementById('list').addEventListener('click', e => {
  if (!e.target.closest('[data-markup]')) return;
  e.preventDefault(); e.stopPropagation(); viewerMarkup();
}, true);
function viewerStep(d) {
  const g = gameIndex.get(st.selected); if (!g || !VW.seq.length) return;
  VW.i = (VW.i + d + VW.seq.length) % VW.seq.length;
  const card = document.querySelector('#list .game'); if (!card) return;
  const tmp = document.createElement('div'); tmp.innerHTML = viewerHTML(g);
  const old = card.querySelectorAll('.viewer, .vw-strip, .vw-help');
  old.forEach((n, j) => j ? n.remove() : n.replaceWith(...tmp.childNodes));
  fitViewerLayers();
  syncAssetURL();
}
function syncAssetURL() {
  if (urlSyncing) return;
  const g = gameIndex.get(st.selected), it = VW.seq[VW.i];
  if (!g || !it || VW.key !== gkey(g)) return;
  const p = new URLSearchParams(location.search);
  if (VW.i === 0) p.delete('asset'); else p.set('asset', it.id);
  const url = '?' + [...p].map(([k, v]) => k + '=' + enc(v)).join('&');
  if (url !== location.search) history.replaceState(null, '', url);
}
// clicking an asset link (caption tag or face label) shows it in the viewer instead of reloading
document.getElementById('list').addEventListener('click', e => {
  const a = e.target.closest('a[data-asset]'); if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault(); e.stopPropagation();
  const gk = decodeURIComponent(a.closest('.game').dataset.g);
  if (st.selected !== gk) { st.selected = gk; VW.want = a.dataset.asset; render(); }
  else { const j = VW.seq.findIndex(x => x.id === a.dataset.asset || x.face === a.dataset.asset); if (j >= 0) { VW.i = j; viewerStep(0); } else { VW.want = a.dataset.asset; render(); } }
  window.scrollTo(0, 0);
}, true);
document.getElementById('list').addEventListener('click', e => {
  const t = e.target.closest('[data-vw]'); if (!t) return;
  e.stopPropagation(); VW.i = +t.dataset.vw - 0; viewerStep(0);
}, true);
function gameStep(d) {
  if (!sidebarOrder.length) return;
  const i = sidebarOrder.findIndex(g => gkey(g) === st.selected);
  const n = i < 0 ? (d > 0 ? 0 : sidebarOrder.length - 1) : Math.min(sidebarOrder.length - 1, Math.max(0, i + d));
  st.selected = gkey(sidebarOrder[n]); render(); window.scrollTo(0, 0);
}
document.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  if (['triage', 'drawer', 'modal', 'b3d'].some(id => { const el = document.getElementById(id); return el && el.classList.contains('on'); })) return;
  const k = e.key.toLowerCase();
  if (k === 'j') gameStep(1);
  else if (k === 'k') gameStep(-1);
  else if (k === 'b' && st.selected) viewerMarkup();
  else if (k === 'escape' && st.selected) document.getElementById('browseAll').click();
  else if (k === 'a' && st.selected) viewerVerdict('approved');
  else if (k === 'r' && st.selected) viewerVerdict('rejected');
  else if (k === 'arrowright' && st.selected) viewerStep(1);
  else if (k === 'arrowleft' && st.selected) viewerStep(-1);
  else return;
  e.preventDefault();
});
