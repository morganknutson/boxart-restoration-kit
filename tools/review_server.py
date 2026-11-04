"""The review server: serves the review page, stores the human's judgements, saves references, pushes live updates.

usage: python3 tools/review_server.py [--config kit.json]       then open http://127.0.0.1:<port>/

Everything lives in the project's work folder (paths.work in kit.json), so agents can read it:
  rereview.json   marks: {"<platform>|<game>[|<asset>|<image>]": {kind, platform, stem, face, image, note, regions, at,
                  resolved?}}. "regions" are boxes the human drew over what is wrong, as fractions of the image (0-1,
                  top-left origin): [{"x","y","w","h","note"}].
  approvals.json  the human's verdict per restored image: {"<platform>|<game>|<asset>|<image>": {verdict: approved|
                  rejected, mt, at}}. mt = the file's modification time when judged; a changed file is no longer judged.
  base-picks.json the scan the human wants a restoration to start from: {"<platform>|<game>|<asset>": {image, at}}.
API: GET/POST /api/rereview, /api/approval, /api/base   (POST {key, marked: true|false, ...fields})
     GET /api/refs        {"<platform>|<game>": [reference file names]} (served at /refs/<platform>/<game>/<file>)
     GET /api/fixqueue    the fix queue (tools/fix_queue.py)
     GET|POST /api/save-ref?platform=&stem=&url=[&name=]   download a reference image into references/<platform>/<game>/
                          and add its URL to sources.txt. For agents whose shell has no network (e.g. Codex's sandbox):
                          open the URL in their browser tool. Only from this machine; images only; never overwrites.
     GET /api/events      server-sent events: restored | rereview | approval | base | refs | site | fixqueue
A watcher checks every second for changed outputs, references, judgements and site files, rebuilds the page data
(tools/build_page_data.py) and the fix queue (tools/fix_queue.py build), and pushes an event; open pages update in
place. The server restarts itself when this file changes.
"""
import base64, json, os, re, subprocess, sys, threading, time, urllib.parse, urllib.request
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import kitconfig

KIT = kitconfig.load()
SITE = os.path.abspath(os.path.join(HERE, '..', 'site'))
STORES = {'rereview': 'rereview.json', 'base': 'base-picks.json', 'approval': 'approvals.json'}
FIELDS = {'rereview': ('kind', 'platform', 'stem', 'face', 'image', 'note', 'regions'),
          'base': ('platform', 'stem', 'face', 'image'),
          'approval': ('platform', 'stem', 'face', 'image', 'verdict', 'mt')}
LOCK = threading.Lock()
IMG_TYPES = {'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif'}
PY = [sys.executable, '-I']


def known_game(plat, stem):
    if plat not in KIT.platforms or not stem or '/' in stem or stem.startswith('.'):
        return False
    return any(g.get('platform') == plat and g.get('id') == stem for g in KIT.catalog_games()) or \
        os.path.isdir(os.path.join(KIT.restored, plat, stem)) or os.path.isdir(os.path.join(KIT.references, plat, stem))


def save_ref(req):
    plat, stem, url, name = req.get('platform'), req.get('stem'), (req.get('url') or '').strip(), req.get('name')
    if not known_game(plat, stem):
        return {'error': f'unknown game {plat!r} {stem!r} (use the exact game id from the catalog and a platform from kit.json)'}, 400
    if not url.startswith(('http://', 'https://')):
        return {'error': 'url must be the http(s) address of the image (it is recorded in sources.txt)'}, 400
    if req.get('data'):
        m = re.match(r'data:(image/[a-z]+);base64,(.*)$', req['data'], re.S)
        if not m or m.group(1) not in IMG_TYPES:
            return {'error': 'data must be a data:image/(jpeg|png|webp|gif);base64,... URL'}, 400
        ctype, body = m.group(1), base64.b64decode(m.group(2))
    else:
        try:
            r = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'boxart-restoration-kit reference saver'}), timeout=40)
            ctype, body = r.headers.get_content_type(), r.read((40 << 20) + 1)
        except Exception as e:
            return {'error': f'download failed: {e} — open the image in your browser and POST it as data instead'}, 502
    if ctype not in IMG_TYPES:
        return {'error': f'not an image ({ctype}): give the direct image URL, not the page'}, 400
    if len(body) > 40 << 20:
        return {'error': 'image over 40 MB'}, 400
    d = os.path.join(KIT.references, plat, stem)
    os.makedirs(d, exist_ok=True)
    base = re.sub(r'[^A-Za-z0-9._-]+', '-', name or os.path.basename(urllib.parse.urlparse(url).path) or 'reference').strip('-.')[:80] or 'reference'
    root, ext = os.path.splitext(base)
    ext = IMG_TYPES[ctype] if ext.lower() not in ('.jpg', '.jpeg', '.png', '.webp', '.gif') else ext
    fname, i = root + ext, 2
    while os.path.exists(os.path.join(d, fname)):
        fname, i = f'{root}-{i}{ext}', i + 1
    with open(os.path.join(d, fname), 'wb') as f:
        f.write(body)
    src = os.path.join(d, 'sources.txt')
    listed = open(src).read().split() if os.path.exists(src) else []
    if url not in listed:
        with open(src, 'a') as f:
            f.write(url + '\n')
    return {'ok': True, 'saved': os.path.join(d, fname), 'bytes': len(body)}, 200


# ── live updates ──
EVENTS, EV_COND, EV_SEQ = [], threading.Condition(), [0]


def broadcast(kind, data=None):
    with EV_COND:
        EV_SEQ[0] += 1
        EVENTS.append((EV_SEQ[0], kind, json.dumps(data or {})))
        del EVENTS[:-200]
        EV_COND.notify_all()


def snapshot():
    snap = {'restored': {}, 'refs': {}, 'site': {}}
    for root, key in ((KIT.restored, 'restored'), (KIT.references, 'refs')):
        for plat in os.listdir(root) if os.path.isdir(root) else []:
            pd = os.path.join(root, plat)
            for d in os.scandir(pd) if os.path.isdir(pd) else []:
                if d.is_dir():
                    for f in os.scandir(d.path):
                        snap[key][f'{plat}|{d.name}|{f.name}'] = f.stat().st_mtime
    for name, fn in STORES.items():
        p = os.path.join(KIT.work, fn)
        snap[name] = os.path.getmtime(p) if os.path.exists(p) else 0
    for extra in ('catalog.json', 'fix/claims.json'):
        p = os.path.join(KIT.work, extra)
        snap[extra] = os.path.getmtime(p) if os.path.exists(p) else 0
    for dp, _, fs in os.walk(SITE):
        for f in fs:
            snap['site'][os.path.join(dp, f)] = os.path.getmtime(os.path.join(dp, f))
    return snap


def changed_keys(a, b):
    return sorted({k.rsplit('|', 1)[0] + '|' + k.rsplit('|', 1)[1].split('.')[0] for k in set(a) | set(b) if a.get(k) != b.get(k)})


def run_tool(name, *args):
    try:
        subprocess.run(PY + [os.path.join(HERE, name), *args, '--config', KIT.path], capture_output=True, timeout=300)
    except Exception as e:
        print(f'{name} failed: {e}', flush=True)


def watcher():
    me, my_mtime = os.path.abspath(__file__), os.path.getmtime(os.path.abspath(__file__))
    prev, pending, since = snapshot(), set(), 0.0
    while True:
        time.sleep(1)
        if os.path.getmtime(me) != my_mtime:
            print('server code changed — restarting', flush=True)
            broadcast('restart'); time.sleep(0.5)
            os.execv(sys.executable, [sys.executable, '-I', me] + sys.argv[1:] + ['--config', KIT.path])
        try:
            cur = snapshot()
        except OSError:
            continue
        rs = changed_keys(prev['restored'], cur['restored'])
        if rs or cur['catalog.json'] != prev['catalog.json']:
            pending |= set(rs) or {'catalog'}; since = time.time()
        rebuilt = False
        if pending and time.time() - since >= 1.0:
            run_tool('build_page_data.py')
            broadcast('restored', {'games': sorted(g for g in pending if g != 'catalog')})
            pending, rebuilt = set(), True
        refs = changed_keys(prev['refs'], cur['refs'])
        if refs:
            broadcast('refs', {'games': refs})
        for name in STORES:
            if cur[name] != prev[name]:
                broadcast(name)
        if cur['site'] != prev['site']:
            broadcast('site')
        if rebuilt or any(cur[n] != prev[n] for n in list(STORES) + ['fix/claims.json']):
            run_tool('fix_queue.py', 'build')
            broadcast('fixqueue')
        prev = cur


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=SITE, **kw)

    def log_message(self, fmt, *args):
        if self.path.startswith('/api/') and not self.path.startswith('/api/events'):
            super().log_message(fmt, *args)

    def translate_path(self, path):
        """/art/… → the art folder, /out/… → outputs, /refs/… → references, /data/… → generated page data."""
        clean = urllib.parse.unquote(urllib.parse.urlsplit(path).path)
        for prefix, root in (('/art/', KIT.art), ('/out/', KIT.restored), ('/refs/', KIT.references), ('/data/', KIT.data)):
            if clean.startswith(prefix):
                full = os.path.abspath(os.path.join(root, clean[len(prefix):]))
                return full if full.startswith(os.path.abspath(root)) else os.path.join(root, '__denied__')
        return super().translate_path(path)

    def end_headers(self):
        if not self.path.startswith('/api/'):
            self.send_header('Cache-Control', 'no-cache')      # images are fixed in place: always revalidate
        super().end_headers()

    def send_json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def store_name(self):
        p = self.path.split('?')[0]
        return p[5:] if p.startswith('/api/') and p[5:] in STORES else None

    def do_OPTIONS(self):
        self.send_response(204)
        for k, v in (('Access-Control-Allow-Origin', '*'), ('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'),
                     ('Access-Control-Allow-Headers', 'Content-Type'), ('Access-Control-Allow-Private-Network', 'true')):
            self.send_header(k, v)
        self.end_headers()

    def save_ref_request(self, req):
        if self.client_address[0] not in ('127.0.0.1', '::1'):
            return self.send_json({'error': 'only from this machine'}, 403)
        with LOCK:
            out, code = save_ref(req)
        return self.send_json(out, code)

    def events(self):
        self.send_response(200)
        for k, v in (('Content-Type', 'text/event-stream'), ('Cache-Control', 'no-store'), ('Access-Control-Allow-Origin', '*')):
            self.send_header(k, v)
        self.end_headers()
        with EV_COND:
            seen = EV_SEQ[0]
        try:
            self.wfile.write(b'retry: 2000\n\n'); self.wfile.flush()
            while True:
                with EV_COND:
                    EV_COND.wait_for(lambda: EV_SEQ[0] > seen, timeout=15)
                    new = [e for e in EVENTS if e[0] > seen]
                    seen = EV_SEQ[0]
                out = ''.join(f'event: {k}\ndata: {d}\n\n' for _, k, d in new) or ': keep-alive\n\n'
                self.wfile.write(out.encode()); self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            return

    def do_GET(self):
        path = self.path.split('?')[0]
        if path == '/api/events':
            return self.events()
        if path == '/api/save-ref':
            q = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
            return self.save_ref_request({k: v[0] for k, v in q.items()})
        if path == '/api/fixqueue':
            return self.send_json(KIT.json('fix/queue.json', {'games': []}))
        if path == '/api/refs':
            refs = {}
            for plat in os.listdir(KIT.references) if os.path.isdir(KIT.references) else []:
                pd = os.path.join(KIT.references, plat)
                for stem in os.listdir(pd) if os.path.isdir(pd) else []:
                    d = os.path.join(pd, stem)
                    imgs = sorted(f for f in os.listdir(d) if f.lower().endswith(('.jpg', '.jpeg', '.png', '.webp', '.gif'))) if os.path.isdir(d) else []
                    if imgs:
                        refs[f'{plat}|{stem}'] = imgs
            return self.send_json(refs)
        name = self.store_name()
        if name:
            with LOCK:
                return self.send_json(KIT.json(STORES[name], {}))
        if path in ('/', '/index.html'):
            self.path = '/index.html' + self.path[len(path):]
        return super().do_GET()

    def do_POST(self):
        try:
            req = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))) or b'{}')
        except Exception:
            return self.send_json({'error': 'bad request'}, 400)
        if self.path.split('?')[0] == '/api/save-ref':
            return self.save_ref_request(req)
        name = self.store_name()
        if not name or 'key' not in req:
            return self.send_json({'error': 'not found' if not name else 'bad request'}, 404 if not name else 400)
        with LOCK:
            marks = KIT.json(STORES[name], {})
            if req.get('marked', True):
                marks[req['key']] = {k: req.get(k) for k in FIELDS[name]}   # a fresh mark/edit reopens it
                marks[req['key']]['at'] = time.strftime('%Y-%m-%d %H:%M:%S')
            else:
                marks.pop(req['key'], None)
            KIT.save_json(STORES[name], marks)
        return self.send_json({'ok': True, 'count': len(marks)})


if __name__ == '__main__':
    run_tool('build_page_data.py')
    run_tool('fix_queue.py', 'build')
    port = int(KIT.c.get('port') or 8790)
    servers = []
    for h in KIT.c.get('listen') or ['127.0.0.1']:
        srv = ThreadingHTTPServer((h, port), Handler)
        srv.daemon_threads = True
        servers.append(srv)
        print(f'Review page: http://{h}:{port}/', flush=True)
    for srv in servers[1:]:
        threading.Thread(target=srv.serve_forever, daemon=True).start()
    threading.Thread(target=watcher, daemon=True).start()
    servers[0].serve_forever()
