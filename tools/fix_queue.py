"""The fix queue: what the user wants fixed in the restored box art, in priority order, with claiming for reviewers.

usage (python3 -I is enough; crops and annotated images need Pillow: uv run -q --with pillow python -I ...):
  tools/fix_queue.py build                          rebuild <work>/fix/ (queue.json, crops, QUALITY.md)
  tools/fix_queue.py claim <you>                    claim the next game (whole game) and print its job — one per helper,
                                                    at most 2 at a time; reprint a held job with `show`
  tools/fix_queue.py show <platform> "<stem>"       print a game's job again
  tools/fix_queue.py done <you> <platform> "<stem>" the fix is in (restore_check --verify must pass): hands it back to
                                                    the user, resolves the marks it answered
  tools/fix_queue.py release <you> <platform> "<stem>" [--hold "reason"]   give a game back (or hold it: refused, no source)
  tools/fix_queue.py status                         counts, and who has what
  tools/fix_queue.py board                          orchestrator view: per reviewer what they hold, for how long,
                                                    when last seen, done/held counts; stale claims flagged

Where the work comes from — the user's own judgements on the review page (in the project's work folder):
  approvals.json   a restored face the user REJECTED                       (priority 1, 2 with boxes)
  rereview.json    open marks: drawn boxes / notes on a restored face        (priority 3)
                   a whole game marked for re-review, or a ⚑ on a restored face (priority 4)
                   marks on original scans are context (e.g. "restore this one")
  base-picks.json  a restore base chosen after the face was restored        (priority 5)
  provenance.json  a face that failed tools/restore_check.py                 (priority 6)
A face the user APPROVED (for its current file) is never queued. After `done`, the face waits for the user's verdict:
approve → it leaves the queue; reject again → it comes back with the new notes (round + 1).
Claims expire after 3 hours without `claim`/`show`/`done` from their owner, so a stuck reviewer can't block a game.
"""
import fcntl, json, os, sys, time
from contextlib import contextmanager

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import kitconfig
KIT = kitconfig.load()
AUD = KIT.work
FIX = KIT.fix
FACES = tuple(KIT.assets)
TOOL = f'python3 {os.path.join(HERE, "fix_queue.py")}'
CHECK = f'python3 {os.path.join(HERE, "restore_check.py")}'
RESTORED_PREFIX = KIT.restored_url('P', 'G', 'A').rsplit('P/G/A', 1)[0]   # page image ids of restored outputs
CLAIM_TTL = 3 * 3600
REASON = {1: 'rejected by the user, with boxes/notes', 2: 'rejected by the user', 3: 'user boxes/notes to fix',
          4: 'marked for re-review', 5: 'new restore base chosen after it was restored', 6: 'failed the restore check',
          7: 'the file changed after the user marked it — waiting for the user to look again'}


def load(name, default):
    try:
        with open(os.path.join(AUD, name)) as f:
            return json.load(f)
    except (FileNotFoundError, ValueError):
        return default


def save(name, obj):
    path = os.path.join(AUD, name)
    tmp = path + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(obj, f, indent=1, ensure_ascii=False)
    os.replace(tmp, path)


@contextmanager
def locked():
    os.makedirs(FIX, exist_ok=True)
    with open(os.path.join(FIX, '.lock'), 'w') as lf:
        fcntl.flock(lf, fcntl.LOCK_EX)
        yield


def ts(s):
    try:
        return time.mktime(time.strptime(s[:19], '%Y-%m-%d %H:%M:%S'))
    except Exception:
        return 0.0


def image_file(img, plat=None, stem=None):
    return KIT.image_file(img)


def restored_files(plat, stem):
    d = os.path.join(KIT.restored, plat, stem)
    return {f: os.path.join(d, f + '.png') for f in FACES if os.path.exists(os.path.join(d, f + '.png'))}


def scan_index():
    """Every candidate scan per game and face, from the review page data (<work>/site-data/sources.js)."""
    try:
        t = open(os.path.join(KIT.data, 'sources.js')).read()
        games = json.loads(t[t.index('['):t.rstrip().rstrip(';').rindex(']') + 1])
    except Exception:
        return {}
    return {(g['plat'], g['stem']): {face: [{'path': KIT.image_file(c['full']),
                                            'source': c.get('src'), 'region': c.get('region') or '?',
                                            'size': f"{c.get('w')}x{c.get('h')}", 'used': bool(c.get('new')),
                                            'watermark': bool(c.get('wm'))} for c in cs]
                                     for face, cs in g.get('faces', {}).items()} for g in games}


def build_queue():
    marks, approvals, bases = load('rereview.json', {}), load('approvals.json', {}), load('base-picks.json', {})
    scans = scan_index()
    claims = load('fix/claims.json', {})
    items = {}                                          # (plat, stem, face) -> item

    def item(plat, stem, face):
        k = (plat, stem, face)
        if k not in items:
            files = restored_files(plat, stem)
            items[k] = {'platform': plat, 'stem': stem, 'face': face, 'priority': 9, 'reasons': [], 'marks': [],
                        'restored': files[face] if face in files else None,
                        'restored_mt': int(os.path.getmtime(files[face])) if face in files else None}
        return items[k]

    def verdict_for(plat, stem, face):
        f = restored_files(plat, stem).get(face)
        if not f:
            return None
        v = approvals.get(f'{plat}|{stem}|{face}|{KIT.restored_url(plat, stem, face)}')
        if v and v.get('mt') == int(os.path.getmtime(f)):
            return v
        return None

    # 1–2: rejected by the user (for the file as it is now)
    for k, v in approvals.items():
        if v.get('verdict') != 'rejected':
            continue
        plat, stem, face = v['platform'], v['stem'], v['face']
        if verdict_for(plat, stem, face) is not v:
            continue
        it = item(plat, stem, face)
        it['priority'] = min(it['priority'], 2); it['reasons'].append('rejected'); it['rejected_at'] = v.get('at')

    # 3–4: open marks
    for k, m in marks.items():
        if m.get('resolved'):
            continue
        plat, stem = m.get('platform'), m.get('stem')
        if not plat or not stem:
            continue
        if m.get('kind') == 'game':
            for face in restored_files(plat, stem) or {'front': None}:
                it = item(plat, stem, face)
                it['priority'] = min(it['priority'], 4); it['reasons'].append('game marked for re-review')
                it['marks'].append({'key': k, 'kind': 'game', 'note': m.get('note'), 'at': m.get('at')})
            continue
        face, img = m.get('face'), m.get('image') or ''
        on_restored = img.startswith(RESTORED_PREFIX)
        if face not in FACES:                           # e.g. a mark on a reference: context for the game's front
            face = 'front'
        it = item(plat, stem, face)
        entry = {'key': k, 'image': img, 'on': 'restored' if on_restored else 'reference' if img.startswith('refs/')
                 else 'box now' if img.startswith('box:') else 'original scan', 'note': m.get('note'),
                 'regions': m.get('regions') or [], 'at': m.get('at')}
        it['marks'].append(entry)
        if on_restored and it['restored_mt'] and ts(m.get('at') or '') < it['restored_mt'] - 1:
            entry['older_than_file'] = True               # someone already replaced the file since: let the user look first
            it['priority'] = min(it['priority'], 7); it['reasons'].append('marks on an older version')
        elif on_restored and (entry['regions'] or entry['note']):
            it['priority'] = min(it['priority'], 3); it['reasons'].append('boxes/notes')
        elif on_restored:
            it['priority'] = min(it['priority'], 4); it['reasons'].append('flagged for re-review')
        else:
            it['priority'] = min(it['priority'], 4 if entry['note'] or entry['regions'] else 8)
            it['reasons'].append('note on a source image' if entry['note'] or entry['regions'] else 'flag on a source image')

    # 5: restore base chosen after the face was restored
    for k, b in bases.items():
        plat, stem, face = b.get('platform'), b.get('stem'), b.get('face')
        f = restored_files(plat, stem).get(face)
        if f and ts(b.get('at', '')) > os.path.getmtime(f):
            it = item(plat, stem, face)
            it['priority'] = min(it['priority'], 5); it['reasons'].append('new restore base'); it['base'] = os.path.join(KIT.art, b['image'])

    # 6: failed the restore check
    for plat in KIT.platforms:
        root = os.path.join(KIT.restored, plat)
        for stem in os.listdir(root) if os.path.isdir(root) else []:
            try:
                prov = json.load(open(os.path.join(root, stem, 'provenance.json')))
            except Exception:
                continue
            for face, p in prov.get('faces', {}).items():
                if p.get('fails'):
                    it = item(plat, stem, face)
                    it['priority'] = min(it['priority'], 6); it['reasons'].append('check failed: ' + '; '.join(p['fails']))

    # rejected + boxes → priority 1; approved faces never queue; flags only on scans with nothing else → keep low (8)
    out = []
    for (plat, stem, face), it in items.items():
        v = verdict_for(plat, stem, face)
        if v and v.get('verdict') == 'approved':
            continue
        if 'rejected' in it['reasons'] and any(m['regions'] or m['note'] for m in it['marks'] if m.get('on') == 'restored'):
            it['priority'] = 1
        b = bases.get(f'{plat}|{stem}|{face}')
        if b and 'base' not in it:
            it['base'] = os.path.join(KIT.art, b['image'])
        it['reasons'] = sorted(set(it['reasons']), key=it['reasons'].index)
        it['scans'] = scans.get((plat, stem), {}).get(face, [])      # every scan already on disk for this face
        it['reason'] = REASON.get(it['priority'], 'flag on a source image only')
        refs = os.path.join(KIT.references, plat, stem)
        it['references'] = sorted(os.path.join(refs, f) for f in os.listdir(refs)
                                  if f.lower().endswith(('.jpg', '.jpeg', '.png', '.webp', '.gif'))) if os.path.isdir(refs) else []
        out.append(it)

    # game state from the claims file
    now = time.time()
    games = {}
    for it in out:
        games.setdefault(f"{it['platform']}|{it['stem']}", []).append(it)
    queue = []
    for gk, faces in games.items():
        c = claims.get(gk, {})
        state = 'open' if min(f['priority'] for f in faces) != 7 else 'waiting for you'
        if c.get('state') == 'claimed' and now - c.get('seen', 0) < CLAIM_TTL:
            state = 'claimed'
        elif c.get('state') == 'held':
            state = 'held'
        elif c.get('state') == 'fixed':
            # handed back: waiting for the user unless they've judged/marked again since
            later = any(ts(f.get('rejected_at') or '') > c.get('at', 0) for f in faces) or \
                    any(ts(m.get('at') or '') > c.get('at', 0) for f in faces for m in f['marks'])
            state = 'open' if later else 'waiting for you'
        plat, stem = gk.split('|', 1)
        queue.append({'platform': plat, 'stem': stem, 'priority': min(f['priority'] for f in faces), 'state': state,
                      'reviewer': c.get('reviewer') if state in ('claimed', 'waiting for you', 'held') else None,
                      'round': c.get('round', 0) + (1 if state == 'open' and c.get('state') == 'fixed' else 0),
                      'hold_reason': c.get('reason') if state == 'held' else None,
                      'faces': sorted(faces, key=lambda f: (f['priority'], FACES.index(f['face']) if f['face'] in FACES else 9))})
    queue.sort(key=lambda g: (g['state'] != 'open', g['priority'], g['stem'].lower()))
    return queue


def make_crops(queue):
    """Crops of every box the user drew (with margin) and an annotated copy of each marked image."""
    try:
        from PIL import Image, ImageDraw
    except ImportError:
        Image = None                                     # without Pillow: reuse crops already on disk
    for g in queue:
        for f in g['faces']:
            for n, m in enumerate(f['marks']):
                src = image_file(m.get('image'), g['platform'], g['stem'])
                if not m.get('regions') or not src or not os.path.exists(src):
                    continue
                d = os.path.join(FIX, 'crops', g['platform'], g['stem'])
                os.makedirs(d, exist_ok=True)
                base = f"{f['face']}-{m['on'].replace(' ', '')}-{n}"
                ann = os.path.join(d, base + '-annotated.png')
                m['annotated'] = ann
                m['crops'] = []
                if os.path.exists(ann) and os.path.getmtime(ann) > os.path.getmtime(src) and \
                        os.path.getmtime(ann) > ts(m.get('at') or '') and all(
                        os.path.exists(os.path.join(d, f'{base}-box{i + 1}.png')) for i in range(len(m['regions']))):
                    m['crops'] = [os.path.join(d, f'{base}-box{i + 1}.png') for i in range(len(m['regions']))]
                    continue
                if Image is None:
                    m.pop('annotated', None)
                    continue
                with Image.open(src) as im:
                    im = im.convert('RGB')
                    W, H = im.size
                    for i, r in enumerate(m['regions']):
                        x0, y0, x1, y1 = r['x'] * W, r['y'] * H, (r['x'] + r['w']) * W, (r['y'] + r['h']) * H
                        pad = 0.15 * max(x1 - x0, y1 - y0)
                        box = (max(0, int(x0 - pad)), max(0, int(y0 - pad)), min(W, int(x1 + pad)), min(H, int(y1 + pad)))
                        crop = im.crop(box)
                        dr = ImageDraw.Draw(crop)
                        dr.rectangle((x0 - box[0], y0 - box[1], x1 - box[0], y1 - box[1]), outline=(255, 59, 71), width=max(2, W // 400))
                        p = os.path.join(d, f'{base}-box{i + 1}.png')
                        crop.save(p)
                        m['crops'].append(p)
                    a = im.copy()
                    dr = ImageDraw.Draw(a)
                    try:
                        from PIL import ImageFont
                        font = ImageFont.load_default(size=max(18, W // 45))
                    except Exception:
                        font = None
                    for i, r in enumerate(m['regions']):
                        x0, y0 = r['x'] * W, r['y'] * H
                        dr.rectangle((x0, y0, x0 + r['w'] * W, y0 + r['h'] * H), outline=(255, 59, 71), width=max(3, W // 300))
                        dr.rectangle((x0, y0, x0 + max(26, W // 32), y0 + max(26, W // 32)), fill=(255, 59, 71))
                        dr.text((x0 + 5, y0 + 2), str(i + 1), fill=(255, 255, 255), font=font)
                    a.save(ann)
    return True


def write_quality(queue):
    """QUALITY.md: the user's own verdicts as the definition of good and bad, newest first."""
    approvals, marks = load('approvals.json', {}), load('rereview.json', {})
    bad, good = [], []
    for k, v in sorted(approvals.items(), key=lambda kv: kv[1].get('at', ''), reverse=True):
        (good if v.get('verdict') == 'approved' else bad).append(v)
    lines = ['# What the user calls good and bad (generated from their verdicts — do not edit)', '',
             'Open every image listed here before your first job, and again when unsure. The user judged these on',
             'the review page. Match the approved ones; never hand back anything with the problems marked on the rejected ones.', '']
    lines += ['## Rejected by the user', '']
    for v in bad[:40]:
        notes = [m for m in marks.values() if m.get('platform') == v['platform'] and m.get('stem') == v['stem']
                 and m.get('face') == v['face'] and (m.get('note') or m.get('regions'))]
        ann = next((m.get('annotated') for g in queue if g['platform'] == v['platform'] and g['stem'] == v['stem']
                    for f in g['faces'] if f['face'] == v['face'] for m in f['marks'] if m.get('annotated')), None)
        lines.append(f"- **{v['stem']}** ({v['platform']}) {v['face']} — `{KIT.image_file(v['image'])}` (judged {v.get('at', '')})"
                     + (f"\n  - boxes drawn on it: `{ann}`" if ann else ''))
        for m in notes:
            if m.get('note'):
                lines.append(f"  - note: {m['note']}")
            for i, r in enumerate(m.get('regions') or []):
                lines.append(f"  - box {i + 1}: {r.get('note') or '(no note — look at the box)'}")
    if not bad:
        lines.append('_None yet._')
    lines += ['', '## Boxes and notes on restored art (not yet judged)', '']
    shown = 0
    for g in queue:
        for f in g['faces']:
            for m in f['marks']:
                if m.get('on') == 'restored' and (m.get('regions') or m.get('note')) and shown < 60 and 'rejected' not in f['reasons']:
                    shown += 1
                    lines.append(f"- **{g['stem']}** ({g['platform']}) {f['face']}" + (f" — annotated: `{m['annotated']}`" if m.get('annotated') else ''))
                    if m.get('note'):
                        lines.append(f"  - note: {m['note']}")
                    for i, r in enumerate(m.get('regions') or []):
                        lines.append(f"  - box {i + 1}: {r.get('note') or '(no note — look at the box)'}")
    if not shown:
        lines.append('_None yet._')
    lines += ['', '## Approved by the user (this is the bar)', '']
    lines += [f"- **{v['stem']}** ({v['platform']}) {v['face']} — `{KIT.image_file(v['image'])}`" for v in good[:40]] or ['_None yet._']
    with open(os.path.join(FIX, 'QUALITY.md'), 'w') as f:
        f.write('\n'.join(lines) + '\n')


def build():
    with locked():
        queue = build_queue()
        make_crops(queue)
        write_quality(queue)
        tmp = os.path.join(FIX, 'queue.json.tmp')
        with open(tmp, 'w') as f:
            claims = load('fix/claims.json', {})
            recent = sorted(({'platform': k.split('|', 1)[0], 'stem': k.split('|', 1)[1], 'state': c.get('state'),
                              'reviewer': (c.get('reviewer') or '').split('-')[0], 'at': c.get('at'), 'reason': c.get('reason'),
                              'round': c.get('round', 0)}
                             for k, c in claims.items() if c.get('state') in ('fixed', 'held', 'claimed')),
                            key=lambda r: r['at'] or 0, reverse=True)
            json.dump({'built': time.strftime('%Y-%m-%d %H:%M:%S'), 'games': queue, 'recent': recent[:200]},
                      f, indent=1, ensure_ascii=False)
        os.replace(tmp, os.path.join(FIX, 'queue.json'))
    return queue


def job_text(g):
    out = [f"JOB — {g['stem']} ({g['platform']})  priority {g['priority']}: {REASON.get(g['priority'], 'flag on a source image')}"
           + (f"  · round {g['round'] + 1}" if g.get('round') else ''),
           f"Output folder: {os.path.join(KIT.restored, g['platform'], g['stem'])}/   (overwrite only the assets listed)",
           "Edition: " + KIT.c["edition_rule"]]
    for f in g['faces']:
        out.append(f"\n  {f['face'].upper()}: {', '.join(f['reasons'])}")
        out.append(f"    current restored file: {f['restored'] or '(none yet)'}")
        if f.get('base'):
            out.append(f"    restore base chosen by the user: {f['base']}  ← start from this scan")
        for m in f['marks']:
            where = m.get('on', 'game')
            out.append(f"    user mark on the {where}{' ' + m['image'] if m.get('image') else ''}:")
            if m.get('note'):
                out.append(f"      note: \"{m['note']}\"")
            for i, r in enumerate(m.get('regions') or []):
                crop = (m.get('crops') or [None] * 99)[i]
                out.append(f"      box {i + 1} at x={r['x']:.3f} y={r['y']:.3f} w={r['w']:.3f} h={r['h']:.3f} (fractions): "
                           f"\"{r.get('note') or 'fix what is inside'}\"" + (f"  crop: {crop}" if crop else ''))
            if m.get('annotated'):
                out.append(f"      all boxes drawn on the image: {m['annotated']}")
        if f.get('scans'):
            out.append('    scans already on disk (check these before searching the web):')
            for c in f['scans']:
                out.append(f"      {'* used for the current restore  ' if c['used'] else '  '}{c['region']:>3} {c['source']:<13} {c['size']:>9}  "
                           f"{c['path']}{'  (watermarked)' if c['watermark'] else ''}")
        if f.get('references'):
            out.append('    saved references: ' + ', '.join(f['references']))
    out.append(f'\nWhen the fix is in and `{CHECK} {g["platform"]} "{g["stem"]}" --verify` passes: '
               f"{TOOL} done <you> {g['platform']} \"{g['stem']}\"")
    return '\n'.join(out)


def find(queue, plat, stem):
    return next((g for g in queue if g['platform'] == plat and g['stem'] == stem), None)


def set_claim(gk, **kw):
    claims = load('fix/claims.json', {})
    claims[gk] = dict(claims.get(gk, {}), **kw)
    os.makedirs(FIX, exist_ok=True)
    save('fix/claims.json', claims)


def main():
    a = sys.argv[1:]
    if not a or a[0] in ('-h', '--help'):
        print(__doc__); return
    cmd = a[0]
    if cmd == 'build':
        q = build()
        print(f"{len(q)} games, {sum(len(g['faces']) for g in q)} faces; open {sum(g['state'] == 'open' for g in q)}")
        return
    queue = build()
    if cmd == 'status':
        from collections import Counter
        print('games by state:', dict(Counter(g['state'] for g in queue)))
        print('open by priority:', dict(sorted(Counter(g['priority'] for g in queue if g['state'] == 'open').items())))
        for g in queue:
            if g['state'] in ('claimed', 'held'):
                print(f"  {g['state']:8} {g['reviewer'] or '':12} {g['platform']} {g['stem']}" + (f" — {g['hold_reason']}" if g['hold_reason'] else ''))
        return
    if cmd == 'board':
        claims, now = load('fix/claims.json', {}), time.time()
        owner = lambda n: (n or '?').split('-')[0]                # "S1-helper2" counts for S1
        claims = {k: c for k, c in claims.items() if c.get('reviewer')}          # released claims have no owner
        people = {}
        for gk, c in claims.items():
            p_ = people.setdefault(owner(c.get('reviewer')), {'holding': [], 'done': 0, 'held': 0})
            if c.get('state') == 'claimed':
                p_['holding'].append((gk, now - c.get('at', now), now - c.get('seen', now)))
            elif c.get('state') == 'fixed':
                p_['done'] += 1
            elif c.get('state') == 'held':
                p_['held'] += 1
        from collections import Counter
        st_ = Counter(g['state'] for g in queue)
        print(f"queue: {st_.get('open', 0)} open · {st_.get('claimed', 0)} being fixed · {st_.get('waiting for you', 0)} waiting for the user"
              f" · {st_.get('held', 0)} held   (open by priority: {dict(sorted(Counter(g['priority'] for g in queue if g['state'] == 'open').items()))})")
        for who, p_ in sorted(people.items()):
            print(f"\n{who}: done {p_['done']} · held {p_['held']} · holding {len(p_['holding'])}")
            for gk, age, quiet in p_['holding']:
                flag = '  ← STALE: no claim/show for 45+ min' if quiet > 2700 else ''
                print(f"   {gk.split('|', 1)[1]} ({gk.split('|')[0]}) — claimed {age / 60:.0f} min ago, last seen {quiet / 60:.0f} min ago{flag}")
        held = [g for g in queue if g['state'] == 'held']
        if held:
            print('\nheld:'); [print(f"   {g['stem']} — {g['hold_reason']} ({g['reviewer']})") for g in held]
        return
    if cmd == 'claim' and len(a) == 2:
        me = a[1]
        with locked():
            mine = [g for g in queue if g['state'] == 'claimed' and (g['reviewer'] or '').split('-')[0] == me]
            if len(mine) >= 2:
                print(f'You already hold {len(mine)} games (one per helper) — finish one first (`done` or `release`).')
                for g in mine:
                    print(f"  {g['platform']} \"{g['stem']}\"   (reprint: {TOOL} show {g['platform']} \"{g['stem']}\")")
                return
            g = next((g for g in queue if g['state'] == 'open'), None)
            if not g:
                print('Nothing to claim: the queue is empty (everything is fixed, waiting for the user, held or claimed).'); return
            set_claim(f"{g['platform']}|{g['stem']}", state='claimed', reviewer=me, seen=time.time(),
                      at=time.time(), round=g.get('round', 0))
        print((f'(you now hold {len(mine) + 1} games)\n' if mine else '') + job_text(g)); return
    if cmd == 'show' and len(a) == 3:
        g = find(queue, a[1], a[2])
        if not g:
            print('Not in the fix queue.'); return
        c = load('fix/claims.json', {}).get(f'{a[1]}|{a[2]}')
        if c and c.get('state') == 'claimed':
            set_claim(f'{a[1]}|{a[2]}', seen=time.time())
        print(job_text(g)); return
    if cmd == 'done' and len(a) == 4:
        me, plat, stem = a[1], a[2], a[3]
        sys.path.insert(0, HERE)
        import restore_check
        fails = restore_check.verify(plat, stem)
        if fails:
            print('NOT DONE — restore_check --verify fails:'); [print('  FAIL', f) for f in fails]; sys.exit(1)
        g = find(queue, plat, stem)
        with locked():
            set_claim(f'{plat}|{stem}', state='fixed', reviewer=me, at=time.time(), round=(g or {}).get('round', 0))
            marks = load('rereview.json', {})
            stamp = f"fixed by {me} {time.strftime('%Y-%m-%d %H:%M')} — waiting for the user's verdict"
            n = 0
            for k, m in marks.items():                   # the marks this fix answered: on restored faces / the whole game
                if m.get('platform') == plat and m.get('stem') == stem and not m.get('resolved') and \
                        (m.get('kind') == 'game' or (m.get('image') or '').startswith(RESTORED_PREFIX)):
                    m['resolved'] = stamp; n += 1
            save('rereview.json', marks)
        build()
        print(f'Done: {plat} {stem} handed back to the user ({n} marks resolved). Claim the next game.'); return
    if cmd == 'release' and len(a) >= 4:
        me, plat, stem = a[1], a[2], a[3]
        hold = a[a.index('--hold') + 1] if '--hold' in a else None
        with locked():
            set_claim(f'{plat}|{stem}', state='held' if hold else 'open', reviewer=me if hold else None,
                      reason=hold, at=time.time())
        build()
        print(f"{'Held' if hold else 'Released'}: {plat} {stem}"); return
    print(__doc__); sys.exit(2)


if __name__ == '__main__':
    main()
