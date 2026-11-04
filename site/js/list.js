// Box art sources — Sidebar (one line per game, face dots), filter chips, the game list and game cards.
function renderSidebar(filteredGames) {
  const keys = new Set(filteredGames.map(gkey));
  const matches = sidebarGames.filter(g => keys.has(gkey(g)));
  sidebarOrder = matches;
  const signature = JSON.stringify(matches.map(g => gkey(g) + faceDots(g)));
  if (signature !== sidebarSignature) {
    sidebarSignature = signature;
    const fragment = document.createDocumentFragment();
    sidebarButtons.clear();
    for (const g of matches) {
      const item = document.createElement('li'), button = document.createElement('button');
      button.type = 'button'; button.className = 'game-link'; button.dataset.gameKey = gkey(g);
      const dots = document.createElement('span'); dots.className = 'dots'; dots.innerHTML = faceDots(g);
      const title = document.createElement('span'); title.className = 'game-name'; title.textContent = g.stem; button.title = `${g.stem} — ${PLATS[g.plat]} · ${g.region}`;
      const platform = document.createElement('span'); platform.className = 'game-platform'; platform.textContent = g.plat.toUpperCase() + (g.region !== 'USA' ? ' · ' + g.region : '');
      button.append(dots, title, platform); item.append(button); fragment.append(item);
      sidebarButtons.set(gkey(g), button);
    }
    if (!matches.length) {
      const empty = document.createElement('li'); empty.className = 'sidebar-empty'; empty.textContent = 'No games match your search.'; fragment.append(empty);
    }
    const nav = document.getElementById('gameNav'), sameGames = renderSidebar.games === matches.map(gkey).join('\n'), top = nav.scrollTop;
    nav.replaceChildren(fragment);
    nav.scrollTop = sameGames ? top : 0;          // live updates only change dots: don't jump the list
    renderSidebar.games = matches.map(gkey).join('\n');
    document.getElementById('sidebarCount').textContent = matches.length === games.length ? `${games.length.toLocaleString()} games` : `${matches.length.toLocaleString()} of ${games.length.toLocaleString()} games`;
  }
  if (activeGameButton) activeGameButton.removeAttribute('aria-current');
  activeGameButton = sidebarButtons.get(st.selected);
  if (activeGameButton) {
    activeGameButton.setAttribute('aria-current', 'true');
    if (renderSidebar.shown !== st.selected) activeGameButton.scrollIntoView({block: 'nearest'});   // only when the game changes
  }
  renderSidebar.shown = st.selected;
}
const sidebarMedia = window.matchMedia('(max-width: 720px)');
function setSidebarOpen(open) {
  const wasOpen = document.body.classList.contains('sidebar-open'), isOpen = sidebarMedia.matches && open;
  document.body.classList.toggle('sidebar-open', isOpen);
  document.getElementById('gameSidebar').inert = sidebarMedia.matches && !isOpen;
  document.getElementById('workspace').inert = isOpen;
  document.getElementById('openSidebar').setAttribute('aria-expanded', String(isOpen));
  if (isOpen) document.getElementById('q').focus();
  else if (wasOpen && sidebarMedia.matches) document.getElementById('openSidebar').focus();
}
document.getElementById('openSidebar').onclick = () => setSidebarOpen(true);
document.getElementById('closeSidebar').onclick = document.getElementById('sidebarBackdrop').onclick = () => setSidebarOpen(false);
sidebarMedia.addEventListener('change', () => setSidebarOpen(false));
document.addEventListener('keydown', e => { if (e.key === 'Escape') setSidebarOpen(false); });
setSidebarOpen(false);
document.getElementById('gameNav').onclick = e => {
  const button = e.target.closest('[data-game-key]'); if (!button) return;
  st.selected = button.dataset.gameKey;
  render(); setSidebarOpen(false); window.scrollTo(0, 0);
};
document.getElementById('browseAll').onclick = () => { st.selected = null; render(); window.scrollTo(0, 0); };
document.getElementById('viewMode').onchange = e => { st.view = e.target.value; st.page = 0; render(); };
document.getElementById('updatedOnly').onchange = e => { st.updated = e.target.checked; st.page = 0; render(); window.scrollTo(0, 0); };
document.getElementById('dotKey').outerHTML = DOT_KEY;
document.getElementById('legendBtn').onclick = e => { const l = document.getElementById('legend'); l.hidden = !l.hidden; e.currentTarget.setAttribute('aria-expanded', String(!l.hidden)); };
document.getElementById('sub').textContent = `Every candidate image for all ${games.length} games, at the same height so shapes compare. Click any image to see it full size.`;

function chip(label, n, on, fn) {
  const b = document.createElement('button'); b.className = 'chip' + (on ? ' on' : '');
  b.innerHTML = `${label}<span class="n">${n}</span>`; b.onclick = fn; return b;
}
function toggle(set, v) { set.has(v) ? set.delete(v) : set.add(v); st.selected = null; st.page = 0; render(); }
function chips() {
  const f = document.getElementById('flagChips'); f.innerHTML = '';
  f.append(chip('Any status', games.length, st.flags.size === 0, () => { st.flags.clear(); st.selected = null; st.page = 0; render(); }));
  for (const [k, v] of Object.entries(FLAGS)) {
    const n = DYN[k] ? games.filter(DYN[k]).length : k === 'rereview' ? games.filter(isMarkedGame).length : k === 'hasbase' ? games.filter(g => Object.keys(BASES).some(x => x.startsWith(gkey(g) + '|'))).length : games.filter(g => g.flags.includes(k)).length; if (n || k === 'rereview' || k === 'hasbase' || DYN[k]) f.append(chip(v, n, st.flags.has(k), () => toggle(st.flags, k)));
  }
  const p = document.getElementById('platChips'); p.innerHTML = '';
  for (const [k, v] of Object.entries(PLATS)) p.append(chip(v, games.filter(g => g.plat === k).length, st.plats.has(k), () => toggle(st.plats, k)));
  const r = document.getElementById('regionChips'); r.innerHTML = '';
  for (const k of REGIONS) r.append(chip(k, games.filter(g => g.region === k).length, st.regions.has(k), () => toggle(st.regions, k)));
  const active = st.flags.size + st.plats.size + st.regions.size;
  document.getElementById('filterCount').textContent = active ? `${active} active` : '';
}
function list() {
  const q = st.q.toLowerCase();
  return games.filter(g => (st.flags.size === 0 || g.flags.some(f => st.flags.has(f)) || [...st.flags].some(f => DYN[f] && DYN[f](g)) || (st.flags.has('rereview') && isMarkedGame(g)) || (st.flags.has('hasbase') && Object.keys(BASES).some(k => k.startsWith(gkey(g) + '|')))) &&
    (st.plats.size === 0 || st.plats.has(g.plat)) && (st.regions.size === 0 || st.regions.has(g.region)) &&
    (!q || g.stem.toLowerCase().includes(q)) && (!st.updated || updatedFaces(g).length));
}
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
function flagBtn(g, face, img, canBase) {
  const k = akey(g, face, img), m = MARKS[k], on = !!m && !m.resolved, hasNote = !!(m && m.note && !m.resolved), b = canBase && isBase(g, face, img);
  const d = `data-k="${encodeURIComponent(k)}" data-face="${face}" data-img="${encodeURIComponent(img)}"`;
  const nR = on && m.regions ? m.regions.length : 0;
  return `<div class="imgbtns">` +
    `<button class="flagimg drawimg${nR ? ' on' : ''}" data-act="draw" ${d} title="${nR ? nR + ' boxed problem area' + (nR > 1 ? 's' : '') + ' — edit' : 'Draw boxes over what is wrong'}">▭</button>` +
    (canBase ? `<button class="flagimg baseimg${b ? ' on' : ''}" data-act="base" ${d} title="${b ? 'Clear restore base' : 'Use this scan as the restore base for the ' + face}">★</button>` : '') +
    `<button class="flagimg noteimg${hasNote ? ' on' : ''}" data-act="note" ${d} title="${hasNote ? 'Edit note: ' + esc(m.note) : 'Add a note on what to fix'}">✎</button>` +
    `<button class="flagimg${on ? ' on' : ''}" data-act="flag" ${d} title="${on ? 'Remove re-review mark' : 'Mark this image for re-review'}">⚑</button></div>`;
}
function imgNote(g, face, img) {
  const m = MARKS[akey(g, face, img)];
  const rg = (m && m.regions) || [];
  if (!m || !(m.note || m.resolved || rg.length)) return '';
  const rtxt = rg.map((r, i) => `${i + 1}. ${esc(r.note || '(no note)')}`).join('<br>');
  return m.resolved ? `<div class="imgnote" style="border-color:#5fd38d;color:#b9f0cf;background:#16281e">✓ Done (${esc(m.resolved)})${m.note ? ' — ' + esc(m.note) : ''}</div>`
                    : `<div class="imgnote">${m.note ? '✎ ' + esc(m.note) : ''}${m.note && rtxt ? '<br>' : ''}${rtxt}</div>`;
}
function cand(c) {
  const cls = [c.new && 'new', c.old && 'old', c.flat && 'flat'].filter(Boolean).join(' ');
  const badges = [c.new && `<span class="b new">${c.type === 'label' ? 'LABEL SOURCE' : 'NEW PICK'}</span>`, c.old && !c.new && '<span class="b old">OLD PICK</span>',
                  c.flat && '<span class="b flat">PLACEHOLDER</span>', c.wm && '<span class="b wm">WATERMARK</span>'].filter(Boolean).join('');
  return `<figure class="${cls}"><div class="badges">${badges}</div><img loading="lazy" src="${encodeURI(c.t)}" data-full="${encodeURI(c.full)}" alt="">
    <figcaption>${c.src}${c.region ? ' · ' + c.region : ''}<br>${c.w}×${c.h} · w/h <span class="ar">${c.ar.toFixed(2)}</span></figcaption></figure>`;
}
function gameHTML(g) {
  const markedG = !!MARKS[gkey(g)];
  const notes = Object.entries(MARKS).filter(([k]) => k === gkey(g) || k.startsWith(gkey(g) + '|')).map(([, v]) => v.note).filter(Boolean);
  const QUIET = new Set(['restored', 'label_restored', 'changed']);
  const fq = FIXQ[gkey(g)], FQ_LABEL = {open: 'In the fix queue', claimed: 'Being fixed', 'waiting for you': 'Fixed — waiting for your verdict', held: 'Fix on hold'};
  const fqChip = fq ? `<span class="flag fq fq-${fq.state.replace(/ /g, '-')}" title="${esc(fq.faces.map(f => f.face + ': ' + f.reasons.join(', ')).join(' · '))}">🔧 ${FQ_LABEL[fq.state] || fq.state}${fq.reviewer ? ' · ' + esc(fq.reviewer) : ''}${fq.hold_reason ? ' — ' + esc(fq.hold_reason) : ''} · ${fq.faces.map(f => f.face).join(', ')}</span>` : '';
  const flags = fqChip + (isMarkedGame(g) ? '<span class="flag mk">⚑ Marked for re-review</span>' : '') + g.flags.filter(f => !QUIET.has(f)).map(f => `<span class="flag">${FLAGS[f] || f}</span>`).join('');
  let rows = (st.updated ? updatedFaces(g).filter(k => (viewFaces[st.view] || []).includes(k)) : (viewFaces[st.view] || [])).map(k => {
    const box = g.box[k] ? `<div class="box"><figure class="${MARKS[akey(g, k, 'box:' + g.box[k].t)] ? 'marked' : ''}">${flagBtn(g, k, 'box:' + g.box[k].t)}<div class="badges">${g.box[k].real ? '' : '<span class="b gen">GENERATED</span>'}</div>
      <img loading="lazy" src="${encodeURI(g.box[k].t)}" alt=""><figcaption>On the box now</figcaption>${imgNote(g, k, 'box:' + g.box[k].t)}</figure></div>` : '';
    const cs = g.faces[k] || [];
    const rs = ((R[g.plat + '|' + g.stem] || {})[k] || []);
    const stCls = s => ({accepted:'acc', revising:'rev', sent:'pend', held:'hold'}[s] || 'pend');
    const stLab = s => ({accepted:'ACCEPTED', revising:'NEEDS FIXES', sent:'NOT REVIEWED', held:'HELD', skipped:'SKIPPED (clean)', upscaled:'FALLBACK UPSCALE', generated:'DRAFT', unlogged:'UNLOGGED'}[s] || s.toUpperCase());
    const rest = rs.length ? `<div class="rest">${rs.map(r => `<figure class="rs${MARKS[akey(g, k, r.full)] ? ' marked' : ''}">${flagBtn(g, k, r.full)}<div class="badges">${r.model ? `<span class="b mod">${esc(r.model.toUpperCase())}</span>` : ''}<span class="b ${stCls(r.status)}">${stLab(r.status)}</span>${r.check === 'pass' ? '<span class="b acc">CHECK ✓</span>' : r.check === 'fail' ? '<span class="b hold">CHECK FAILED</span>' : ''}${verdictBadge(r)}</div>
      <img loading="lazy" src="${vThumb(r)}" data-full="${vFull(r)}" alt=""><figcaption>Restored · ${r.reviewer} · ${r.w}×${r.h}${r.note ? '<br>' + esc(r.note).slice(0, 120) : ''}</figcaption>${imgNote(g, k, r.full)}</figure>`).join('')}</div>` : '';
    if (st.updated) return `<div class="face" data-face="${k}"><span class="lab"><a href="${assetURL(g, k)}" data-asset="${k}">${k}</a></span>${rest}</div>`;
    const keep = c => c.new || c.old || isBase(g, k, c.full) || MARKS[akey(g, k, c.full)];
    const candHTML = c => cand(c).replace('<figure class="', '<figure data-img="' + encodeURIComponent(c.full) + '" class="' + (MARKS[akey(g, k, c.full)] ? 'marked ' : '') + (isBase(g, k, c.full) ? 'base ' : '')).replace('<div class="badges">', flagBtn(g, k, c.full, true) + '<div class="badges">' + (isBase(g, k, c.full) ? '<span class="b base">RESTORE BASE</span>' : '')).replace('</figcaption></figure>', '</figcaption>' + imgNote(g, k, c.full) + '</figure>');
    const shown = cs.filter(keep), more = cs.filter(c => !keep(c));
    return `<div class="face" data-face="${k}"><span class="lab"><a href="${assetURL(g, k)}" data-asset="${k}">${k}</a></span>${box}${rest}${shown.map(candHTML).join('')}${more.length ? `<details class="more"><summary>${more.length} more scan${more.length > 1 ? 's' : ''}</summary>${more.map(candHTML).join('')}</details>` : ''}${!cs.length ? '<span class="none">No images</span>' : ''}</div>`;
  }).join('');
  const refs = REFS[gkey(g)] || [];
  if (refs.length && viewFaces[st.view]) {
    const u = f => ['refs', g.plat, g.stem, f].map(encodeURIComponent).join('/');
    rows += `<div class="face" data-face="refs"><span class="lab">refs</span>${refs.map(f => `<figure class="ref"><img loading="lazy" src="${u(f)}" data-full="${u(f)}" alt=""><figcaption>Reference · ${esc(f)}</figcaption></figure>`).join('')}</div>`;
  }
  const viewer = st.selected === gkey(g) && viewFaces[st.view] ? viewerHTML(g) : '';
  return `<div class="game" data-view="${st.view}" data-g="${encodeURIComponent(gkey(g))}"><div class="gt">${st.selected === gkey(g) ? '<button class="rr icon" data-back="1" title="Back to all matching games (Esc)">←</button>' : ''}<b><a class="glink" href="${gameURL(g)}" data-golink="1">${esc(g.stem)}</a></b><span class="gmeta">${g.plat.toUpperCase()} · ${g.region}</span>
    <span class="meta icons"><button class="rr icon${markedG ? ' on' : ''}" data-game="1" title="${markedG ? 'Game marked for re-review — click to clear' : 'Mark the whole game for re-review'}">⚑</button><button class="rr icon" data-copylink="1" title="Copy a link to this game">🔗</button></span></div>${viewer}
    ${notes.length ? `<div class="rrnote">Re-review notes: ${notes.map(esc).join(' · ')}</div>` : ''}
    ${flags ? `<div class="flags">${flags}</div>` : ''}<div class="asset-rows">${rows}</div></div>`;
}
