// Box art sources — Data, saved choices (marks, restore bases, references, verdicts), shared helpers and page state.
const games = window.GAMES;
const R = window.RESTORED || {};
// restored files are overwritten in place when they're fixed: version their URLs by file time so browsers never show a stale copy
const vFull = r => encodeURI(r.full) + (r.mt ? '?v=' + r.mt : '');
const vThumb = r => encodeURI(r.t) + (r.mt ? '?v=' + r.mt : '');
let MARKS = {}, BASES = {}, REFS = {}, APPROVALS = {};
const gkey = g => g.plat + '|' + g.stem;
const akey = (g, face, img) => gkey(g) + '|' + face + '|' + img;
function toast(t) { const el = document.getElementById('toast'); el.textContent = t; el.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(() => el.style.display = 'none', 2200); }
async function loadMarks() {
  try {
    MARKS = await (await fetch('/api/rereview', {cache: 'no-store'})).json();
    try { REFS = await (await fetch('/api/refs', {cache: 'no-store'})).json(); } catch (e) {}
    try { APPROVALS = await (await fetch('/api/approval', {cache: 'no-store'})).json(); } catch (e) {}
    try { FIXQ = {}; FIXQ_DATA = await (await fetch('/api/fixqueue', {cache: 'no-store'})).json(); for (const q of FIXQ_DATA.games || []) FIXQ[q.platform + '|' + q.stem] = q; } catch (e) {}
    BASES = await (await fetch('/api/base', {cache: 'no-store'})).json();
  } catch (e) { toast('Could not load saved choices from the server'); }
}
async function setMark(key, marked, info) {
  const body = Object.assign({key, marked}, info);
  try {
    const r = await fetch('/api/rereview', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
    if (!r.ok) throw new Error(r.status);
    if (marked) MARKS[key] = Object.assign({}, info, {at: 'now'}); else delete MARKS[key];
    toast(marked ? 'Marked for re-review (saved)' : 'Re-review mark removed (saved)');
  } catch (e) { toast('Save failed — is the box audit server running?'); }
  render();
}
async function setBase(g, face, img, on) {
  const key = gkey(g) + '|' + face;
  try {
    const r = await fetch('/api/base', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({key, marked: on, platform: g.plat, stem: g.stem, face, image: img.replace(/^art\//, '')})});
    if (!r.ok) throw new Error(r.status);
    if (on) BASES[key] = {image: img.replace(/^art\//, '')}; else delete BASES[key];
    toast(on ? 'Set as the restore base for the ' + face + ' (saved)' : 'Restore base cleared (saved)');
  } catch (e) { toast('Save failed — is the box audit server running?'); }
  render();
}
const isBase = (g, face, img) => (BASES[gkey(g) + '|' + face] || {}).image === img.replace(/^art\//, '');
const isMarkedGame = g => Object.entries(MARKS).some(([k, v]) => !v.resolved && (k === gkey(g) || k.startsWith(gkey(g) + '|')));
for (const g of games) {
  const r = R[g.plat + '|' + g.stem]; if (!r) continue;
  g.flags.unshift('restored');
  if (r.label) g.flags.push('label_restored');
}
let FIXQ = {}, FIXQ_DATA = {games: [], recent: []};   // the fix queue (Tools/fix_queue.py): game key → {state, priority, reviewer, faces, ...}
const FLAGS = { fix_open: 'In the fix queue (waiting for a reviewer)', fix_claimed: 'Being fixed now', fix_waiting: 'Fixed — waiting for your verdict', fix_held: 'Fix on hold', untriaged: 'Restored art you haven\'t judged', you_rejected: 'You rejected', you_approved: 'You approved all its art', check_failed: 'Failed the restore check', rereview: 'Marked for re-review', hasbase: 'Has a chosen restore base', restored: 'Has restored art', changed: 'Pick changed', placeholder: 'Has a green placeholder', wide: 'Has a wide (true-shape) Advance scan',
                watermark: 'Uses a watermarked image', no_front: 'No usable front', no_back: 'No usable back', no_label: 'No Game Pak label', label_restored: 'Has a restored label' };
const KIT = window.KIT || {platforms: {}, assets: ['front', 'back', 'spine', 'label'], regions: ['USA', 'Europe', 'Japan', 'Other'], default_regions: ['USA']};
const PLATS = Object.fromEntries(Object.entries(KIT.platforms).map(([k, v]) => [k, v.name || k]));
const REGIONS = KIT.regions;
const st = { flags: new Set(), plats: new Set(), regions: new Set(), q: '', page: 0, per: 40, selected: null, view: 'assets', updated: false };
// "Updated only": just the restored art, for the faces the current view shows (texture/3D: any face)
const updatedFaces = g => { const r = R[gkey(g)] || {}; return (viewFaces[st.view] || ['front','back','spine','label']).filter(k => (r[k] || []).length); };
// views: every asset together, each asset alone, and front & back side by side when both exist
const viewFaces = Object.assign({assets: KIT.assets}, Object.fromEntries(KIT.assets.map(a => [a, [a]])),
  KIT.assets.includes('front') && KIT.assets.includes('back') ? {'front-back': ['front', 'back']} : {});
(() => {
  const sel = document.getElementById('viewMode'), name = a => a[0].toUpperCase() + a.slice(1);
  sel.innerHTML = Object.keys(viewFaces).map(v => `<option value="${v}">${v === 'assets' ? 'All assets' : v === 'front-back' ? 'Front & back' : name(v) + ' only'}</option>`).join('');
  if (KIT.project) { document.title = KIT.project; document.getElementById('projectTitle').textContent = KIT.project; }
})();
const gameIndex = new Map(games.map(g => [gkey(g), g]));
const sidebarGames = [...games].sort((a, b) => a.stem.localeCompare(b.stem, 'en', {numeric:true, sensitivity:'base'}) || a.plat.localeCompare(b.plat));
const sidebarButtons = new Map();
let sidebarSignature = null, activeGameButton = null, sidebarOrder = [];
// one dot per face (front, back, spine, label): green you approved · red you rejected · orange marked for re-review ·
// purple restored, waiting for you · hollow nothing restored
const FACE_ORDER = KIT.assets;
function faceState(g, face) {
  const rs = (R[gkey(g)] || {})[face] || [];
  if (!rs.length) return 'none';
  if (rs.some(r => { const m = MARKS[akey(g, face, r.full)]; return m && !m.resolved; })) return 'mark';
  const vs = rs.map(r => (typeof verdict === 'function' ? verdict(r) : null));
  if (vs.some(v => v && !v.stale && v.v === 'rejected')) return 'no';
  if (vs.every(v => v && !v.stale && v.v === 'approved')) return 'ok';
  return 'todo';
}
const DOT_TITLE = {ok: 'approved by you', no: 'rejected by you', mark: 'marked for re-review', todo: 'restored — not judged yet', none: 'not restored'};
const faceDots = g => FACE_ORDER.map(f => { const s_ = faceState(g, f); return `<i class="dot ${s_}" title="${f}: ${DOT_TITLE[s_]}"></i>`; }).join('');
// the same key, for the ? legend
const DOT_KEY = `<span>Sidebar dots — front · back · spine · label: ${['ok', 'no', 'mark', 'todo', 'none'].map(k => `<i class="dot ${k}" style="display:inline-block;vertical-align:0;margin:0 3px 0 8px"></i>${DOT_TITLE[k]}`).join('')}</span>`;
