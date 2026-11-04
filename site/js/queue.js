// Box art sources — the fix queue panel (Q): what the reviewers are doing and what they've handed back. Live.
const QP = {tab: 'recent'};
const qpEl = id => document.getElementById(id);
const ago = t => { if (!t) return ''; const m = Math.max(0, Math.round((Date.now() / 1000 - t) / 60));
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
function faceVerdicts(g) {                 // your verdict on each restored face, for its current file
  return allRest(g).map(r => { const v = verdict(r); const s = !v || v.stale ? 'todo' : v.v === 'approved' ? 'ok' : 'no';
    return `<i class="dot ${s}" title="${r.face}: ${s === 'todo' ? 'waiting for your verdict' : s === 'ok' ? 'you approved' : 'you rejected'}"></i>`; }).join('');
}
function qpRow(k, main, sub, extra = '') {
  const g = gameIndex.get(k);
  return `<button class="qp-row" type="button" data-qp="${encodeURIComponent(k)}"><span class="qp-main">${g ? `<span class="dots">${faceVerdicts(g)}</span>` : ''}<span class="qp-name">${esc(main)}</span></span><span class="qp-sub">${sub}</span>${extra}</button>`;
}
function renderQueuePanel() {
  const games = FIXQ_DATA.games || [], recent = FIXQ_DATA.recent || [];
  const by = s => games.filter(g => g.state === s);
  const open = by('open'), done = recent.filter(r => r.state === 'fixed'), held = recent.filter(r => r.state === 'held'),
        working = recent.filter(r => r.state === 'claimed');
  qpEl('queueCount').textContent = open.length;
  if (qpEl('queuePanel').hidden) return;
  qpEl('qpSummary').textContent = `${done.length} handed back · ${working.length} being fixed · ${open.length} up next · ${held.length} on hold`;
  const tabs = [['recent', `Handed back (${done.length})`], ['working', `Being fixed (${working.length})`], ['next', `Up next (${open.length})`], ['held', `On hold (${held.length})`]];
  qpEl('qpTabs').innerHTML = tabs.map(([k, l]) => `<button class="chip${QP.tab === k ? ' on' : ''}" type="button" data-qptab="${k}">${l}</button>`).join('');
  const key = r => r.platform + '|' + r.stem;
  let rows = [];
  if (QP.tab === 'recent') rows = done.map(r => qpRow(key(r), r.stem, `${esc(r.reviewer || '?')} · ${ago(r.at)}${r.round ? ` · round ${r.round + 1}` : ''}`));
  if (QP.tab === 'working') rows = working.map(r => qpRow(key(r), r.stem, `${esc(r.reviewer || '?')} · since ${ago(r.at)}`));
  if (QP.tab === 'next') rows = open.map(g => qpRow(key(g), g.stem, `priority ${g.priority} · ${g.faces.map(f => f.face).join(', ')} · ${esc(g.faces[0] ? g.faces[0].reasons.join(', ') : '')}`));
  if (QP.tab === 'held') rows = held.map(r => qpRow(key(r), r.stem, `${esc(r.reviewer || '?')} · ${ago(r.at)}`, `<span class="qp-reason">${esc(r.reason || '')}</span>`));
  qpEl('qpList').innerHTML = rows.join('') || '<p class="none" style="padding:12px">Nothing here.</p>';
}
function toggleQueuePanel(open) {
  const p = qpEl('queuePanel'); p.hidden = open === undefined ? !p.hidden : !open;
  renderQueuePanel();
}
qpEl('queueBtn').onclick = () => toggleQueuePanel();
qpEl('qpClose').onclick = () => toggleQueuePanel(false);
qpEl('qpTabs').onclick = e => { const b = e.target.closest('[data-qptab]'); if (b) { QP.tab = b.dataset.qptab; renderQueuePanel(); } };
qpEl('qpList').onclick = e => {
  const b = e.target.closest('[data-qp]'); if (!b) return;
  const k = decodeURIComponent(b.dataset.qp); if (!gameIndex.has(k)) return toast('That game is not in this list');
  st.selected = k; VW.want = null;
  if (!list().some(g => gkey(g) === k)) { st.flags.clear(); st.regions.clear(); st.plats.clear(); st.q = ''; document.getElementById('q').value = ''; }
  render(); window.scrollTo(0, 0);
};
document.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  if (['triage', 'drawer', 'modal'].some(id => qpEl(id).classList.contains('on'))) return;
  if (e.key.toLowerCase() === 'q') { e.preventDefault(); toggleQueuePanel(); }
  else if (e.key === 'Escape' && !qpEl('queuePanel').hidden) { e.stopImmediatePropagation(); toggleQueuePanel(false); }
}, true);
setInterval(renderQueuePanel, 60000);      // keep the "x min ago" times fresh
