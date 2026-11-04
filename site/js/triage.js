// Box art sources — Your verdicts (approved / rejected) and the triage screen.
// ── Your verdicts (final gate) + triage ──
const vkey = (k, face, full) => `${k}|${face}|${full}`;
const verdict = r => { const a = APPROVALS[vkey(r.key, r.face, r.full)]; return a ? {v: a.verdict, stale: a.mt !== r.mt} : null; };
function verdictBadge(r) {
  const v = verdict(r); if (!v) return '';
  if (v.stale) return '<span class="b you-old" title="The file changed after you judged it">CHANGED SINCE YOU JUDGED</span>';
  return v.v === 'approved' ? '<span class="b you-ok">YOU ✓</span>' : '<span class="b you-no">YOU ✗</span>';
}
const allRest = g => Object.values(R[gkey(g)] || {}).flat();
const DYN = {
  untriaged: g => allRest(g).some(r => { const v = verdict(r); return !v || v.stale; }),
  you_rejected: g => allRest(g).some(r => { const v = verdict(r); return v && !v.stale && v.v === 'rejected'; }),
  fix_open: g => (FIXQ[gkey(g)] || {}).state === 'open',
  fix_claimed: g => (FIXQ[gkey(g)] || {}).state === 'claimed',
  fix_waiting: g => (FIXQ[gkey(g)] || {}).state === 'waiting for you',
  fix_held: g => (FIXQ[gkey(g)] || {}).state === 'held',
  you_approved: g => { const a = allRest(g); return a.length && a.every(r => { const v = verdict(r); return v && !v.stale && v.v === 'approved'; }); },
  check_failed: g => allRest(g).some(r => r.check === 'fail'),
};
async function setVerdict(g, r, v) {
  const key = vkey(r.key, r.face, r.full);
  const body = {key, marked: !!v, platform: g.plat, stem: g.stem, face: r.face, image: r.full, verdict: v, mt: r.mt};
  try {
    const res = await fetch('/api/approval', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
    if (!res.ok) throw new Error(res.status);
    if (v) APPROVALS[key] = body; else delete APPROVALS[key];
    return true;
  } catch (e) { toast('Save failed — is the box audit server running?'); return false; }
}
const TR = {q: [], i: 0, cmp: null, hist: [], showSrc: false};
const trEl = id => document.getElementById(id);
function srcFor(g, face) {
  const b = BASES[gkey(g) + '|' + face]; if (b) return {url: 'art/' + b.image, img: 'art/' + b.image, label: 'RESTORE BASE'};
  const c = (g.faces[face] || []).find(c => c.new); if (c) return {url: c.full, img: c.full, label: 'SOURCE SCAN (' + c.src + ')'};
  if (g.box[face]) return {url: g.box[face].t, img: 'box:' + g.box[face].t, label: 'ON THE BOX BEFORE'};
  return null;
}
function buildQueue() {
  const order = ['front', 'label', 'back', 'spine'], faces = viewFaces[st.view] || order;
  const q = [];
  for (const g of list()) for (const face of order.filter(f => faces.includes(f)))
    for (const r of ((R[gkey(g)] || {})[face] || [])) {
      const v = verdict(r);
      if (trEl('trJudged').checked || !v || v.stale) q.push({g, r});
    }
  if (trEl('trRandom').checked) for (let i = q.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [q[i], q[j]] = [q[j], q[i]]; }
  return q;
}
function trShow() {
  const it = TR.q[TR.i];
  const judged = Object.keys(APPROVALS).length;
  trEl('trProg').textContent = TR.q.length ? `${Math.min(TR.i + 1, TR.q.length)} of ${TR.q.length} in this queue · ${judged.toLocaleString()} judged in total` : '';
  if (!it) {
    trEl('trTitle').textContent = 'Nothing left to judge here'; trEl('trBadges').innerHTML = ''; trEl('trSide').innerHTML = ''; trEl('trMeta').textContent = '';
    trEl('trImg').removeAttribute('src'); trEl('trSrc').removeAttribute('src'); trEl('trRgn').innerHTML = '';
    trEl('trMeta').textContent = 'Change the view/filters, or tick “Include judged”.';
    return;
  }
  const {g, r} = it, src = srcFor(g, r.face);
  TR.cmp = src && {url: src.url, label: src.label, img: src.img};
  trEl('trTitle').textContent = `${g.stem} · ${r.face}`;
  trEl('trBadges').innerHTML = `${r.model ? `<span class="b mod">${esc(r.model.toUpperCase())}</span>` : ''}<span class="b">${esc(r.status.toUpperCase())}</span>${r.check === 'pass' ? '<span class="b acc">CHECK ✓</span>' : r.check === 'fail' ? '<span class="b hold">CHECK FAILED</span>' : '<span class="b pend">NOT CHECKED</span>'}${verdictBadge(r)}`;
  trEl('trImg').src = vFull(r); trEl('trSrc').src = src ? src.url : '';
  trEl('trMeta').textContent = `${PLATS[g.plat]} · ${g.region} · ${r.w}×${r.h} · reviewer ${r.reviewer}${r.note ? ' — ' + r.note : ''}`;
  const refs = REFS[gkey(g)] || [], u = f => ['refs', g.plat, g.stem, f].map(encodeURIComponent).join('/');
  const side = [];
  if (src) side.push(`<h3>${esc(src.label)}</h3><img data-cmp="${encodeURIComponent(src.url)}" data-label="${esc(src.label)}" class="cmp" src="${encodeURI(src.url)}" alt="">`);
  for (const c of (g.faces[r.face] || []).filter(c => !src || c.full !== src.url).slice(0, 4))
    side.push(`<h3>${esc(c.src)}${c.region ? ' · ' + esc(c.region) : ''}</h3><img data-cmp="${encodeURIComponent(c.full)}" data-label="${esc(c.src.toUpperCase())}" src="${encodeURI(c.t)}" alt="">`);
  if (refs.length) side.push('<h3>Saved references</h3>' + refs.map(f => `<img data-cmp="${u(f)}" data-label="REFERENCE ${esc(f)}" src="${u(f)}" alt="">`).join(''));
  else side.push('<h3>Saved references</h3><div class="tr-meta">None saved for this game.</div>');
  trEl('trSide').innerHTML = side.join('');
  trSwap(false); trPaintRegions(it);
}
function trPaintRegions({g, r}) {
  const m = MARKS[akey(g, r.face, r.full)], box = trEl('trRgn');
  box.innerHTML = m && !m.resolved && m.regions ? rgnHTML(m.regions) : '';
  const img = trEl('trImg'), place = () => {
    const st_ = trEl('trStage').getBoundingClientRect(), nw = img.naturalWidth, nh = img.naturalHeight; if (!nw) return;
    const k = Math.min(st_.width / nw, st_.height / nh), w = nw * k, h = nh * k;
    Object.assign(box.style, {left: (st_.width - w) / 2 + 'px', top: (st_.height - h) / 2 + 'px', width: w + 'px', height: h + 'px'});
  };
  if (img.complete && img.naturalWidth) place(); else img.onload = place;
}
function trSwap(on) {
  TR.showSrc = on && !!TR.cmp;
  trEl('trSrc').hidden = !TR.showSrc; trEl('trImg').style.visibility = TR.showSrc ? 'hidden' : 'visible';
  trEl('trRgn').style.visibility = TR.showSrc ? 'hidden' : 'visible';
  trEl('trStage').classList.toggle('src', TR.showSrc);
  trEl('trTag').textContent = TR.showSrc ? TR.cmp.label : 'RESTORED';
}
function openTriage() {
  TR.q = buildQueue(); TR.i = 0; TR.hist = [];
  trEl('triage').classList.add('on'); trShow();
}
function closeTriage() { trEl('triage').classList.remove('on'); render(); }
async function trJudge(v) {
  const it = TR.q[TR.i]; if (!it) return;
  if (!await setVerdict(it.g, it.r, v)) return;
  TR.hist.push(it); TR.i++; trShow();
  toast(v === 'approved' ? 'Approved' : 'Rejected');
}
function trDraw() {
  const it = TR.q[TR.i]; if (!it) return;
  const {g, r} = it;
  openDrawer(akey(g, r.face, r.full), {kind: 'art', platform: g.plat, stem: g.stem, face: r.face, image: r.full}, vFull(r), `${g.stem} · ${r.face}`, r);
  DW.after = marked => { if (marked) trJudge('rejected'); else trShow(); };
}
async function trUndo() {
  const it = TR.hist.pop(); if (!it) return toast('Nothing to undo');
  await setVerdict(it.g, it.r, null);
  TR.i = Math.max(0, TR.q.indexOf(it)); trShow(); toast('Undone');
}
trEl('triageBtn').onclick = openTriage;
trEl('trClose').onclick = closeTriage;
trEl('trA').onclick = () => trJudge('approved');
trEl('trR').onclick = () => trJudge('rejected');
trEl('trB').onclick = trDraw;
trEl('trU').onclick = trUndo;
trEl('trP').onclick = () => { TR.i = Math.max(0, TR.i - 1); trShow(); };
trEl('trN').onclick = () => { TR.i = Math.min(TR.q.length, TR.i + 1); trShow(); };
trEl('trF').onpointerdown = () => trSwap(true);
trEl('trF').onpointerup = trEl('trF').onpointerleave = () => trSwap(false);
trEl('trJudged').onchange = trEl('trRandom').onchange = openTriage;
trEl('trStage').onclick = () => {
  const it = TR.q[TR.i]; if (!it) return;
  if (!TR.showSrc) return trDraw();
  const {g, r} = it, c = TR.cmp, img = c && (c.img || (srcFor(g, r.face) || {}).img);
  if (!img && /^refs\//.test(c.url)) {
    const ref = decodeURIComponent(c.url.split('?')[0]);
    return openDrawer(akey(g, 'refs', ref), {kind: 'art', platform: g.plat, stem: g.stem, face: 'refs', image: ref}, trEl('trSrc').src, `${g.stem} · reference ${ref.split('/').pop()}`);
  }
  if (!img) return;
  openDrawer(akey(g, r.face, img), {kind: 'art', platform: g.plat, stem: g.stem, face: r.face, image: img}, trEl('trSrc').src, `${g.stem} · ${r.face} · ${c.label.toLowerCase()}`, null, {canBase: !/^(box:|art\/restored\/|out\/)/.test(img)});
};
trEl('trSide').onclick = e => {
  const im = e.target.closest('img[data-cmp]'); if (!im) return;
  const u_ = decodeURIComponent(im.dataset.cmp);
  TR.cmp = {url: u_, label: im.dataset.label, img: /^refs\//.test(u_) ? null : u_};
  trEl('trSrc').src = TR.cmp.url;
  trEl('trSide').querySelectorAll('img').forEach(x => x.classList.toggle('cmp', x === im));
  toast('Hold Space to compare with ' + im.dataset.label.toLowerCase());
};
document.addEventListener('keydown', e => {
  if (!trEl('triage').classList.contains('on') || trEl('drawer').classList.contains('on') || trEl('modal').classList.contains('on')) return;
  if (e.metaKey || e.ctrlKey || e.altKey || /INPUT|TEXTAREA/.test(document.activeElement.tagName) && document.activeElement.type !== 'checkbox') return;
  const k = e.key.toLowerCase();
  if (k === 'escape') closeTriage();
  else if (k === ' ' || k === 'f') { e.preventDefault(); if (!e.repeat) trSwap(true); }
  else if (k === 'a') trJudge('approved');
  else if (k === 'r') trJudge('rejected');
  else if (k === 'b') { e.preventDefault(); trDraw(); }
  else if (k === 'z') trUndo();
  else if (k === 'arrowleft') { TR.i = Math.max(0, TR.i - 1); trShow(); }
  else if (k === 'arrowright') { TR.i = Math.min(TR.q.length, TR.i + 1); trShow(); }
  else return;
  e.preventDefault();
});
document.addEventListener('keyup', e => { if ((e.key === ' ' || e.key.toLowerCase() === 'f') && trEl('triage').classList.contains('on')) trSwap(false); });
window.addEventListener('resize', () => { const it = TR.q[TR.i]; if (it && trEl('triage').classList.contains('on')) trPaintRegions(it); });
