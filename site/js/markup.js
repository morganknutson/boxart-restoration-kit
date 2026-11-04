// Box art sources — Box editor: draw boxes over what is wrong; saved with the image re-review mark.
// ── Problem-area boxes: drawn in the editor, saved with the image's re-review mark as fractions of the image ──
const rgnHTML = rs => rs.map((r, i) => `<div class="rgn" data-i="${i}" style="left:${r.x * 100}%;top:${r.y * 100}%;width:${r.w * 100}%;height:${r.h * 100}%"><span>${i + 1}</span></div>`).join('');
function placeLayer(img) {
  const layer = img.parentElement.querySelector(':scope > .rgn-layer'); if (!layer) return;
  const bw = (img.offsetWidth - img.clientWidth) / 2;
  Object.assign(layer.style, {left: img.offsetLeft + bw + 'px', top: img.offsetTop + bw + 'px', width: img.clientWidth + 'px', height: img.clientHeight + 'px'});
}
function paintRegions() {
  for (const b of document.querySelectorAll('#list .drawimg.on')) {
    const m = MARKS[decodeURIComponent(b.dataset.k)], fig = b.closest('figure'), img = fig.querySelector(':scope > img');
    if (!m || !m.regions || !img) continue;
    const layer = document.createElement('div'); layer.className = 'rgn-layer'; layer.innerHTML = rgnHTML(m.regions);
    fig.append(layer);
    if (img.complete && img.naturalWidth) placeLayer(img); else img.addEventListener('load', () => placeLayer(img), {once: true});
  }
}
// quick words under each text field: [word filled in, button label, tooltip extra]
const QUICK_WORDS = [['blurry', 'Blurry', ' (L)'], ['artifacts', 'Artifacts', '']];
const DW = {key: null, info: null, regions: [], sel: -1, drag: null};
const dwEl = id => document.getElementById(id);
function dwRender() {
  const wrap = dwEl('dwWrap');
  wrap.querySelectorAll('.rgn').forEach(n => n.remove());
  wrap.insertAdjacentHTML('beforeend', rgnHTML(DW.regions));
  wrap.querySelectorAll('.rgn').forEach(n => n.classList.toggle('sel', +n.dataset.i === DW.sel));
  const list = dwEl('dwList');
  list.innerHTML = DW.regions.length ? '' : '<div class="dw-empty">No boxes yet — drag on the image.</div>';
  DW.regions.forEach((r, i) => {
    const row = document.createElement('div'); row.className = 'dw-item' + (i === DW.sel ? ' sel' : '');
    row.innerHTML = `<b>${i + 1}</b><input type="text" placeholder="What's wrong here?"><button class="chip" type="button" title="Remove box">✕</button>`;
    const inp = row.querySelector('input'); inp.value = r.note || '';
    inp.oninput = () => { r.note = inp.value; };
    inp.onfocus = () => { if (DW.sel !== i) { DW.sel = i; wrap.querySelectorAll('.rgn').forEach(n => n.classList.toggle('sel', +n.dataset.i === i)); list.querySelectorAll('.dw-item').forEach((n, j) => n.classList.toggle('sel', j === i)); } };
    row.querySelector('button').onclick = () => { DW.regions.splice(i, 1); DW.sel = -1; dwRender(); };
    const quick = document.createElement('div'); quick.className = 'dw-quick';
    quick.innerHTML = QUICK_WORDS.map(([w, label, hint]) => `<button class="chip" type="button" data-q="${w}" data-box="${i}" title="Fill in “${w}”${hint}">${label}</button>`).join('');
    list.append(row, quick);
  });
}
function openDrawer(key, info, src, title, r = null, opts = {}) {
  const m = MARKS[key] || {};
  Object.assign(DW, {key, info, sel: -1, drag: null, after: null, fromViewer: false, regions: (m.resolved ? [] : (m.regions || [])).map(r => ({...r}))});
  dwEl('dwTitle').textContent = title;
  DW.r = r;                                   // a restored asset: it can be approved / rejected from here
  DW.canBase = !!opts.canBase;                // a candidate scan: it can be the restore base for its face
  DW.flag = !!(m && !m.resolved && (m.kind || m.at));
  dwTools();
  dwEl('dwNote').value = m.resolved ? '' : (m.note || '');
  dwEl('dwImg').src = src;
  // ← / → flip between this image and what it should be compared with (restored ↔ original), in place
  const cmp = compareFor(info, r);
  DW.views = [{src, label: viewLabel(info, r)}].concat(cmp ? [cmp] : []); DW.view = 0;
  dwShowView();
  dwEl('drawer').classList.add('on');
  dwRender();
}
function viewLabel(info, r) {
  const img = info.image || '';
  return r ? 'Restored' : img.startsWith('refs/') ? 'Reference' : img.startsWith('box:') ? 'On the box now' : 'Original scan';
}
function compareFor(info, r) {
  const g = gameIndex.get(info.platform + '|' + info.stem); if (!g) return null;
  if (r) { const s_ = srcFor(g, info.face); return s_ ? {src: encodeURI(s_.url), label: s_.label.toLowerCase().replace(/^./, c => c.toUpperCase())} : null; }
  const rs = (R[gkey(g)] || {})[info.face] || [];
  return rs.length && !(info.image || '').startsWith('refs/') ? {src: vFull(rs[0]), label: 'Restored'} : null;
}
function dwShowView() {
  const v = DW.views[DW.view], tag = dwEl('dwTag');
  dwEl('dwImg').src = v.src;
  tag.hidden = DW.views.length < 2;
  tag.textContent = v.label + (DW.views.length > 1 ? `  ·  ← → ${DW.views[1 - DW.view].label.toLowerCase()}` : '');
  tag.classList.toggle('alt', DW.view === 1);
}
const closeDrawer = () => { dwEl('drawer').classList.remove('on'); DW.drag = null; };
dwEl('dwCancel').onclick = () => { DW.after = null; closeDrawer(); };
dwEl('dwSave').onclick = () => {
  DW.drag = null;
  const regions = DW.regions.filter(r => r.w >= 0.01 && r.h >= 0.01).map(r => ({x: +r.x.toFixed(4), y: +r.y.toFixed(4), w: +r.w.toFixed(4), h: +r.h.toFixed(4), note: (r.note || '').trim() || null}));
  const note = dwEl('dwNote').value.trim() || null, had = MARKS[DW.key] && !MARKS[DW.key].resolved;
  closeDrawer();
  const keep = !!(regions.length || note || DW.flag);       // boxes, a note or the ⚑ flag keep the image marked
  if (!keep && !had) return;
  const prev = MARKS[DW.key];                               // nothing changed: don't re-save (it would look like a new mark)
  const same = had && keep && (prev.note || null) === note &&
    JSON.stringify((prev.regions || []).map(r => [r.x, r.y, r.w, r.h, r.note || null])) === JSON.stringify(regions.map(r => [r.x, r.y, r.w, r.h, r.note]));
  if (same) { DW.after = null; return; }
  const after = DW.after; DW.after = null;
  // new or changed boxes on restored art = the user doesn't accept it: reject it automatically (unless they just
  // chose a verdict themselves, or triage handles it)
  const newBoxes = regions.length && JSON.stringify((had && prev.regions || []).map(r => [r.x, r.y, r.w, r.h])) !== JSON.stringify(regions.map(r => [r.x, r.y, r.w, r.h]));
  const newNote = note && note !== ((had && prev.note) || null);
  const autoReject = DW.r && !DW.verdictChosen && !after && (newBoxes || newNote);   // a new complaint = rejected
  const r_ = DW.r, g_ = gameIndex.get(DW.info.platform + '|' + DW.info.stem);
  const advance = DW.fromViewer && !DW.verdictChosen;      // marked up from the big viewer: move on to the next asset
  setMark(DW.key, keep, Object.assign({}, DW.info, {note, regions: regions.length ? regions : null})).then(async () => {
    if (after) after(regions.length || note);
    if (advance && st.selected === gkey(g_) && VW.seq.length) {
      const n = VW.seq.findIndex((x, j) => j > VW.i && x.kind === 'restored');
      VW.i = n >= 0 ? n : Math.min(VW.i + 1, VW.seq.length - 1);
      render();
    }
    if (autoReject) {
      const cur = verdict(r_);
      if (!(cur && !cur.stale && cur.v === 'rejected') && await setVerdict(g_, r_, 'rejected')) {
        toast(`Rejected ${r_.face} (${regions.length} box${regions.length > 1 ? 'es' : ''})`); render(); nextGameIfJudged(g_);
      }
    }
  });
};
const dwPt = e => { const r = dwEl('dwImg').getBoundingClientRect();
  return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]; };
dwEl('dwWrap').addEventListener('pointerdown', e => {
  const hit = e.target.closest('.rgn');
  if (hit) { DW.sel = +hit.dataset.i; dwRender(); dwEl('dwList').querySelectorAll('input')[DW.sel].focus(); return; }
  e.preventDefault();
  const [x, y] = dwPt(e); DW.drag = {x0: x, y0: y, r: {x, y, w: 0, h: 0, note: ''}};
  DW.regions.push(DW.drag.r); DW.sel = DW.regions.length - 1;
  dwEl('dwWrap').setPointerCapture(e.pointerId); dwRender();
});
dwEl('dwWrap').addEventListener('pointermove', e => {
  if (!DW.drag) return;
  const [x, y] = dwPt(e), d = DW.drag;
  Object.assign(d.r, {x: Math.min(x, d.x0), y: Math.min(y, d.y0), w: Math.abs(x - d.x0), h: Math.abs(y - d.y0)});
  const n = dwEl('dwWrap').querySelector(`.rgn[data-i="${DW.sel}"]`);
  if (n) Object.assign(n.style, {left: d.r.x * 100 + '%', top: d.r.y * 100 + '%', width: d.r.w * 100 + '%', height: d.r.h * 100 + '%'});
});
const dwEnd = () => {
  if (!DW.drag) return;
  const r = DW.drag.r; DW.drag = null;
  if (r.w < 0.01 || r.h < 0.01) { DW.regions.splice(DW.regions.indexOf(r), 1); DW.sel = -1; dwRender(); return; }
  dwRender(); dwEl('dwList').querySelectorAll('input')[DW.sel].focus();
};
dwEl('dwWrap').addEventListener('pointerup', dwEnd);
dwEl('dwWrap').addEventListener('pointercancel', dwEnd);
document.addEventListener('keydown', e => {
  if (!dwEl('drawer').classList.contains('on')) return;
  if (e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); dwEl('dwSave').click(); }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && DW.sel >= 0 && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') { DW.regions.splice(DW.sel, 1); DW.sel = -1; dwRender(); }
  else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) dwEl('dwSave').click();
  else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && DW.views && DW.views.length > 1 && !e.shiftKey &&
           !(/INPUT|TEXTAREA/.test(document.activeElement.tagName) && document.activeElement.value)) {   // empty fields don't block it
    e.preventDefault(); e.stopImmediatePropagation(); DW.view = 1 - DW.view; dwShowView();     // compare only: no verdict, no save
  }
  else if (e.key.toLowerCase() === 'l' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); e.stopImmediatePropagation(); dwBlurry(); }
  else if (DW.r && /^[ar]$/i.test(e.key) && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); e.stopImmediatePropagation(); dwVerdict(e.key.toLowerCase() === 'a' ? 'approved' : 'rejected'); }
}, true);
window.addEventListener('resize', () => document.querySelectorAll('#list .rgn-layer').forEach(l => placeLayer(l.parentElement.querySelector(':scope > img'))));

// Approve / reject from the zoomed editor: saves any boxes first, then records your verdict (press again to undo).
async function dwVerdict(v) {
  const r = DW.r; if (!r) return;
  const g = gameIndex.get(DW.info.platform + '|' + DW.info.stem);
  const inTriage = document.getElementById('triage').classList.contains('on');
  const cur = verdict(r), undo = cur && !cur.stale && cur.v === v;
  DW.after = null; DW.verdictChosen = true;
  dwEl('dwSave').click();
  DW.verdictChosen = false;
  if (!await setVerdict(g, r, undo ? null : v)) return;
  toast(undo ? 'Verdict cleared' : (v === 'approved' ? 'Approved ' : 'Rejected ') + r.face);
  if (inTriage && !undo) { TR.hist.push(TR.q[TR.i]); TR.i++; trShow(); return; }
  if (!undo && g && st.selected === gkey(g) && VW.seq.length) {        // like A / R in the viewer: on to the next asset
    const at = VW.seq.findIndex(x => x.kind === 'restored' && x.r.full === r.full);
    const n = VW.seq.findIndex((x, j) => j > (at >= 0 ? at : VW.i) && x.kind === 'restored');
    if (n >= 0) VW.i = n;
  }
  render();
  if (!undo) nextGameIfJudged(g);
}
dwEl('dwVerdict').addEventListener('click', e => { const b = e.target.closest('[data-verdict]'); if (b) dwVerdict(b.dataset.verdict); });

// The same controls on every zoom: verdict (restored art only), restore base (candidate scans only), re-review flag.
function dwTools() {
  const g = DW.info && gameIndex.get(DW.info.platform + '|' + DW.info.stem);
  dwEl('dwVerdict').innerHTML = DW.r ? verdictButtons(DW.r)
    : '<button class="chip ok" disabled title="Only restored art gets your verdict">✓ Approve</button><button class="chip no" disabled title="Only restored art gets your verdict">✗ Reject</button>';
  const base = dwEl('dwBase'), on = DW.canBase && g && isBase(g, DW.info.face, DW.info.image);
  base.disabled = !DW.canBase; base.classList.toggle('on', !!on);
  base.title = DW.canBase ? (on ? 'Clear the restore base for the ' + DW.info.face : 'Use this scan as the restore base for the ' + DW.info.face) : 'Only original scans can be the restore base';
  const fl = dwEl('dwFlag'); fl.classList.toggle('on', DW.flag); fl.title = DW.flag ? 'Marked for re-review (saved when you close)' : 'Mark this image for re-review';
}
dwEl('dwFlag').onclick = () => { DW.flag = !DW.flag; dwTools(); };
dwEl('dwBase').onclick = async () => {
  const g = gameIndex.get(DW.info.platform + '|' + DW.info.stem); if (!g || !DW.canBase) return;
  await setBase(g, DW.info.face, DW.info.image, !isBase(g, DW.info.face, DW.info.image)); dwTools();
};
// What a clicked image is: its game, face, mark key, restored item (for verdicts) and whether it can be a restore base.
function zoomContext(img) {
  const card = img.closest('.game'); if (!card) return null;
  const g = gameIndex.get(decodeURIComponent(card.dataset.g)); if (!g) return null;
  const src = img.dataset.full || img.getAttribute('src');
  let face, image, canBase = false;
  const btn = img.closest('figure') && img.closest('figure').querySelector('[data-k]');
  if (img.dataset.mk) { face = img.dataset.face; image = decodeURIComponent(img.dataset.img); canBase = !/^(art\/restored\/|out\/|box:|refs\/)/.test(image); }
  else if (btn) { face = btn.dataset.face; image = decodeURIComponent(btn.dataset.img); canBase = !!img.closest('figure').querySelector('.baseimg'); }
  else if (/^refs\//.test(src)) { face = 'refs'; image = decodeURIComponent(src.split('?')[0]); }
  else return null;
  const r = ((R[gkey(g)] || {})[face] || []).find(x => x.full === image) || null;
  const label = r ? 'restored ' + face : face === 'refs' ? 'reference ' + image.split('/').pop() : image.startsWith('box:') ? face + ' on the box now' : face + ' scan';
  return {g, face, image, r, canBase, src, title: `${g.stem} · ${label}`};
}
function zoom(img) {
  const z = zoomContext(img); if (!z) return false;
  openDrawer(akey(z.g, z.face, z.image), {kind: 'art', platform: z.g.plat, stem: z.g.stem, face: z.face, image: z.image}, z.src, z.title, z.r, {canBase: z.canBase});
  DW.fromViewer = !!img.closest('.viewer');               // saving changes made from the big viewer advances to the next asset
  return true;
}

// ◌ Blurry (L) — the most common complaint, one click: names the selected box "blurry"; with no boxes drawn, notes the
// whole image as blurry and saves (which rejects restored art and moves on, like any markup).
function addWord(text, word) { text = (text || '').trim(); return new RegExp('\\b' + word + '\\b', 'i').test(text) ? text : (text ? text + ', ' : '') + word; }
// Quick words under each text field: they only fill the field in (nothing is saved until you close the editor).
function fillBox(i, word) { DW.regions[i].note = addWord(DW.regions[i].note, word); DW.sel = i; dwRender(); }
function fillNote(word) { const t = dwEl('dwNote'); t.value = addWord(t.value, word); }
function dwBlurry() {                       // L: the selected box (or the newest one), else the overall note
  if (DW.regions.length) fillBox(DW.sel >= 0 ? DW.sel : DW.regions.length - 1, 'blurry'); else fillNote('blurry');
}
dwEl('drawer').addEventListener('click', e => {
  const b = e.target.closest('[data-q]'); if (!b) return;
  if (b.dataset.target === 'note') fillNote(b.dataset.q); else fillBox(+b.dataset.box, b.dataset.q);
});
