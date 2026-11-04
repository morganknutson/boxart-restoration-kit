"""Builds the review page's data from the catalog and the restored outputs.

usage: python3 tools/build_page_data.py [--config kit.json]          (needs Pillow: pip install pillow)

Reads   <work>/catalog.json                 every game and its candidate scans per asset (format: README.md)
        <restored>/<platform>/<game>/*.png   restored outputs (+ provenance.json from tools/restore_check.py)
Writes  <work>/site-data/sources.js   window.GAMES    (games, candidate scans, thumbnails)
        <work>/site-data/restored.js  window.RESTORED (restored images, thumbnails, model + check from provenance)
        <work>/site-data/config.js    window.KIT      (platforms, asset types, regions — from kit.json)
Only rewrites a file when its content changed (the review server watches them).
"""
import hashlib, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kitconfig
from PIL import Image

H = 170


def write_if_changed(path, text):
    try:
        if open(path).read() == text:
            return False
    except OSError:
        pass
    tmp = path + '.tmp'
    with open(tmp, 'w') as f:
        f.write(text)
    os.replace(tmp, path)
    return True


def thumb(kit, src, sub):
    name = hashlib.sha1(src.encode()).hexdigest()[:16] + '.jpg'
    dst = os.path.join(kit.data, sub, name)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    try:
        if not os.path.exists(dst) or os.path.getmtime(dst) < os.path.getmtime(src):
            im = Image.open(src).convert('RGB')
            im.resize((max(1, round(im.width * H / im.height)), H), Image.LANCZOS).save(dst, quality=82)
        w, h = Image.open(src).size
    except Exception:
        return None, 0, 0
    return f'data/{sub}/{name}', w, h


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def main():
    kit = kitconfig.load()
    games = []
    for g in kit.catalog_games():
        faces = {}
        for asset, cands in (g.get('assets') or {}).items():
            out = []
            for c in cands:
                src = os.path.join(kit.art, c['path'])
                t, w, h = thumb(kit, src, 'thumbs')
                if not t:
                    continue
                out.append({'src': c.get('source', '?'), 'region': c.get('region', ''), 'w': w, 'h': h, 'ar': w / h if h else 0,
                            't': t, 'full': 'art/' + c['path'], 'new': bool(c.get('use')), 'old': False,
                            'flat': bool(c.get('placeholder')), 'wm': bool(c.get('watermark')), 'type': asset})
            if out and not any(c['new'] for c in out):
                out[0]['new'] = True                      # no pick given: the first candidate is the source
            faces[asset] = out
        flags = [f for f, on in (('watermark', any(c['wm'] and c['new'] for cs in faces.values() for c in cs)),) if on]
        games.append({'plat': g['platform'], 'stem': g['id'], 'region': g.get('region', 'Other'), 'flags': flags,
                      'faces': faces, 'box': {}})

    restored = {}
    for plat in os.listdir(kit.restored) if os.path.isdir(kit.restored) else []:
        for game in os.listdir(os.path.join(kit.restored, plat)):
            d = os.path.join(kit.restored, plat, game)
            if not os.path.isdir(d):
                continue
            try:
                prov = json.load(open(os.path.join(d, 'provenance.json')))
            except Exception:
                prov = {}
            for fname in sorted(os.listdir(d)):
                asset = fname.split('.')[0]
                if not fname.endswith('.png') or asset not in kit.assets:
                    continue
                path = os.path.join(d, fname)
                t, w, h = thumb(kit, path, 'rv')
                if not t:
                    continue
                kind = fname[len(asset) + 1:-4] or 'restored'
                p = prov.get('faces', {}).get(asset) if kind == 'restored' else None
                checked = p if p and p.get('sha256') == sha256(path) else None
                full = kit.restored_url(plat, game, asset) if kind == 'restored' else \
                    kit.restored_url(plat, game, asset).rsplit('/', 1)[0] + '/' + fname
                restored.setdefault(f'{plat}|{game}', {}).setdefault(asset, []).append({
                    'key': f'{plat}|{game}', 'face': asset, 't': t, 'full': full, 'w': w, 'h': h, 'kind': kind,
                    'mt': int(os.path.getmtime(path)), 'status': kind, 'reviewer': prov.get('reviewer') or '—', 'note': '',
                    'model': (prov.get('model') or '') if checked else '', 'check': checked.get('result') if checked else None})
    # restored games missing from the catalog still appear (with no candidate scans)
    known = {(g['plat'], g['stem']) for g in games}
    for k in restored:
        plat, game = k.split('|', 1)
        if (plat, game) not in known:
            games.append({'plat': plat, 'stem': game, 'region': 'Other', 'flags': [], 'faces': {}, 'box': {}})

    a = write_if_changed(os.path.join(kit.data, 'sources.js'), 'window.GAMES = ' + json.dumps(games, separators=(',', ':')) + ';\n')
    b = write_if_changed(os.path.join(kit.data, 'restored.js'), 'window.RESTORED = ' + json.dumps(restored, separators=(',', ':')) + ';\n')
    c = write_if_changed(os.path.join(kit.data, 'config.js'), 'window.KIT = ' + json.dumps(kit.page_config()) + ';\n')
    print(f"{len(games)} games, {sum(len(v) for r in restored.values() for v in r.values())} restored images"
          + ('' if a or b or c else ' (unchanged)'))


if __name__ == '__main__':
    main()
