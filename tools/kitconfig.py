"""Loads kit.json: the one file that describes a restoration project (platforms, asset types, folders, rules).

Every tool finds it the same way: --config <path>, else $KIT_CONFIG, else ./kit.json (searching up from the current
folder). Paths inside kit.json are relative to the kit.json file. See README.md and examples/ for the format.
"""
import json, os, sys

DEFAULTS = {
    'project': 'Box art restoration',
    'paths': {'art': 'art', 'restored': 'art/restored', 'work': 'work'},
    'platforms': {},
    'assets': {
        'front': {'min_long_side': 1200},
        'back': {'min_long_side': 1200},
        'spine': {'min_height': 1400},
        'label': {'min_width': 1200, 'aspect_may_differ': True},
    },
    'regions': ['USA', 'Europe', 'Japan', 'Other'],
    'default_regions': ['USA'],
    'edition_rule': 'Use the edition the project targets. Check the scans already on disk before searching the web.',
    'foreign_url_pattern': r'ebay\.(?:de|co\.uk|fr|it|es|nl|com\.au)|[/_-](?:pal|eur|europe|jpn|japan|ger|fah|noe|ukv|esp|ita|fra)[/_.-]',
    'allowed_models': [],
    'transcripts': {'codex': '~/.codex/sessions', 'claude': '~/.claude/projects'},
    'reviewer_model': '',
    'listen': ['127.0.0.1'],
    'port': 8790,
    'public_url': '',
}


def _find(argv):
    if '--config' in argv:
        i = argv.index('--config')
        path = argv[i + 1]
        del argv[i:i + 2]
        return os.path.abspath(path)
    if os.environ.get('KIT_CONFIG'):
        return os.path.abspath(os.environ['KIT_CONFIG'])
    d = os.getcwd()
    while True:
        p = os.path.join(d, 'kit.json')
        if os.path.exists(p):
            return p
        if os.path.dirname(d) == d:
            sys.exit('kit.json not found: pass --config <path>, set KIT_CONFIG, or run from a folder containing kit.json')
        d = os.path.dirname(d)


class Kit:
    def __init__(self, path):
        self.path = path
        self.root = os.path.dirname(path)
        with open(path) as f:
            raw = json.load(f)
        c = json.loads(json.dumps(DEFAULTS))
        for k, v in raw.items():
            if isinstance(v, dict) and isinstance(c.get(k), dict) and k not in ('platforms', 'assets'):
                c[k].update(v)
            else:
                c[k] = v
        self.c = c
        p = c['paths']
        self.art = self._abs(p['art'])                     # source scans; the page serves it at /art/
        self.restored = self._abs(p['restored'])           # outputs: <restored>/<platform>/<game>/<asset>.png
        self.work = self._abs(p['work'])                   # queue, marks, verdicts, references, fix/, page data
        self.references = os.path.join(self.work, 'references')
        self.fix = os.path.join(self.work, 'fix')
        self.data = os.path.join(self.work, 'site-data')   # generated page data, served at /data/
        self.catalog = os.path.join(self.work, 'catalog.json')
        for d in (self.work, self.references, self.fix, self.data):
            os.makedirs(d, exist_ok=True)

    def _abs(self, p):
        return os.path.abspath(os.path.join(self.root, os.path.expanduser(p)))

    @property
    def platforms(self):
        return self.c['platforms']

    @property
    def assets(self):
        return list(self.c['assets'].keys())

    def asset_rule(self, asset):
        return self.c['assets'].get(asset, {})

    def restored_url(self, plat, game, asset):
        """The page's id for a restored file ('art/…' when outputs live under the art folder, else 'out/…')."""
        f = os.path.join(self.restored, plat, game, asset + '.png')
        rel = os.path.relpath(f, self.art)
        return 'art/' + rel if not rel.startswith('..') else 'out/' + os.path.relpath(f, self.restored)

    def image_file(self, img):
        """A page image id → the file on disk."""
        if not img:
            return None
        if img.startswith('art/'):
            return os.path.join(self.art, img[4:])
        if img.startswith('out/'):
            return os.path.join(self.restored, img[4:])
        if img.startswith('refs/'):
            return os.path.join(self.references, *img.split('/')[1:])
        return os.path.join(self.art, img)

    def json(self, name, default):
        try:
            with open(os.path.join(self.work, name)) as f:
                return json.load(f)
        except (FileNotFoundError, ValueError):
            return default

    def save_json(self, name, obj):
        path = os.path.join(self.work, name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + '.tmp'
        with open(tmp, 'w') as f:
            json.dump(obj, f, indent=1, ensure_ascii=False)
        os.replace(tmp, path)

    def catalog_games(self):
        try:
            with open(self.catalog) as f:
                return json.load(f).get('games', [])
        except (FileNotFoundError, ValueError):
            return []

    def page_config(self):
        """What the review page needs to know (served as data/config.js)."""
        return {'project': self.c['project'], 'platforms': self.c['platforms'], 'assets': self.assets,
                'regions': self.c['regions'], 'default_regions': self.c['default_regions'],
                'public_url': self.c.get('public_url') or ''}


def load(argv=None):
    path = _find(sys.argv if argv is None else argv)
    os.environ['KIT_CONFIG'] = path                  # tools imported later (e.g. restore_check by fix_queue) find it too
    return Kit(path)
