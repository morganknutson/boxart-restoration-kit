"""Hard checks for a restoration job. Writes provenance.json; reviewers may only hand back assets that pass.

usage (restorer, from its own agent session, after saving the outputs):
    python3 tools/restore_check.py <platform> "<game id>" [--ignore-url URL "why it wasn't used"]... [--white-edge-ok <asset>]
usage (reviewer, before `fix_queue.py done`):
    python3 tools/restore_check.py <platform> "<game id>" --verify

Per asset in <restored>/<platform>/<game>/<asset>.png (asset types from kit.json):
  - which model really made it: read from the calling agent's own transcript, never from what anyone says. Codex:
    CODEX_THREAD_ID → ~/.codex/sessions/**/rollout-*<id>.jsonl; Claude Code: CLAUDE_CODE_SESSION_ID →
    ~/.claude/projects/*/<id>.jsonl. Recorded; enforced only if kit.json sets "allowed_models".
  - references: every image URL the agent opened on this job (in its transcript, from when this game's output folder
    first appears) must be saved to <work>/references/<platform>/<game>/ and listed in sources.txt — or dismissed with
    --ignore-url URL "reason". URLs matching kit.json "foreign_url_pattern" are flagged for the edition rule.
  - output: a real PNG; minimum sizes from kit.json "assets"; same aspect ratio as the input scan (±1.5%, warning only
    for assets with "aspect_may_differ"); no blank white padding on an edge.
  - the human's open notes and drawn boxes for this game (<work>/rereview.json) are listed: they must be fixed.
provenance.json (next to the outputs) records per asset: sha256, size, input, model, transcript, sources, checks, result.
--verify re-hashes the outputs: a file changed after its check, or a failed/missing check, fails verification.
Exit code 0 = pass, 1 = fail.
"""
import argparse, glob, hashlib, json, os, re, struct, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import kitconfig
KIT = kitconfig.load()
ART = KIT.art
AUD = KIT.work
TRANSCRIPTS = {k: os.path.expanduser(v) for k, v in (KIT.c.get('transcripts') or {}).items()}
if os.environ.get('RESTORE_CHECK_SESSIONS'):                       # tests
    TRANSCRIPTS = {'codex': os.environ['RESTORE_CHECK_SESSIONS']}
SESSIONS = TRANSCRIPTS.get('codex', os.path.expanduser('~/.codex/sessions'))
ALLOWED_MODELS = KIT.c.get('allowed_models') or []                  # empty = any model
FACES = tuple(KIT.assets)
IMG_URL = re.compile(r'https?://[^\s"\'\\<>)\]]+?\.(?:jpe?g|png|webp|gif)(?:\?[^\s"\'\\<>)\]]*)?', re.I)
IMG_HOSTS = re.compile(r'https?://(?:i\.ebayimg\.com|i\.imgur\.com|images\.launchbox-app\.com|gamefaqs\.gamespot\.com/a/box)[^\s"\'\\<>)\]]*', re.I)
NON_US = re.compile(KIT.c.get('foreign_url_pattern') or r'(?!x)x', re.I)


def png_size(path):
    with open(path, 'rb') as f:
        head = f.read(24)
    if head[:8] != b'\x89PNG\r\n\x1a\n':
        return None
    return struct.unpack('>II', head[16:24])


def img_size(path):
    try:
        from PIL import Image
        with Image.open(path) as im:
            return im.size
    except Exception:
        return png_size(path) if path.lower().endswith('.png') else None


def white_edges(path):
    """Edges that are (almost) pure white — padding instead of artwork. Needs Pillow; skipped without it."""
    try:
        from PIL import Image
    except ImportError:
        return []
    with Image.open(path) as im:
        g = im.convert('L')
        w, h = g.size
        px = g.load()
        bad = []
        for name, pts in (('top', [(x, 1) for x in range(0, w, 4)]), ('bottom', [(x, h - 2) for x in range(0, w, 4)]),
                          ('left', [(1, y) for y in range(0, h, 4)]), ('right', [(w - 2, y) for y in range(0, h, 4)])):
            if sum(px[p] >= 250 for p in pts) / len(pts) > .97:
                bad.append(name)
        return bad


def sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def job_inputs(plat, stem):
    """The input scan per asset: the human's restore base if set, else the catalog's chosen candidate (or its first)."""
    out = {}
    for g in KIT.catalog_games():
        if g.get('platform') == plat and g.get('id') == stem:
            for asset, cands in (g.get('assets') or {}).items():
                pick = next((c for c in cands if c.get('use')), cands[0] if cands else None)
                if pick and asset in FACES:
                    out[asset] = os.path.join(ART, pick['path'])
    for k, v in KIT.json('base-picks.json', {}).items():
        if v.get('platform') == plat and v.get('stem') == stem and v.get('face') in FACES:
            out[v['face']] = os.path.join(ART, v['image'])
    return out


def find_sessions(outdir_rel):
    """Agent transcripts (Codex rollout-*.jsonl, Claude Code *.jsonl) that mention this game's output folder, newest first."""
    files = []
    for kind, root in TRANSCRIPTS.items():
        if not os.path.isdir(root):
            continue
        try:
            r = subprocess.run(['grep', '-rlF', '--include=' + ('rollout-*.jsonl' if kind == 'codex' else '*.jsonl'), outdir_rel, root],
                               capture_output=True, text=True, timeout=120)
            files += [f for f in r.stdout.splitlines() if f]
        except Exception:
            pass
    return sorted(files, key=os.path.getmtime, reverse=True)


def own_transcript():
    """The transcript of the agent that is running this check. Codex gives every command its session id
    (CODEX_THREAD_ID / CODEX_SESSION_ID) and names the transcript rollout-<time>-<id>.jsonl: exact, and works inside the
    sandbox. Otherwise walk up the process tree to an agent that holds its rollout file open (needs ps/lsof)."""
    sid = os.environ.get('CODEX_THREAD_ID') or os.environ.get('CODEX_SESSION_ID')
    if sid and re.fullmatch(r'[0-9a-fA-F-]{16,}', sid):
        hits = glob.glob(os.path.join(SESSIONS, '**', f'rollout-*{sid}.jsonl'), recursive=True)
        if hits:
            return max(hits, key=os.path.getmtime)
    sid = os.environ.get('CLAUDE_CODE_SESSION_ID')                     # Claude Code: <projects>/<project>/<id>.jsonl
    if sid and re.fullmatch(r'[0-9a-fA-F-]{16,}', sid) and TRANSCRIPTS.get('claude'):
        hits = glob.glob(os.path.join(TRANSCRIPTS['claude'], '*', f'{sid}.jsonl'))
        if hits:
            return max(hits, key=os.path.getmtime)
    pid = os.getpid()
    for _ in range(20):
        try:
            out = subprocess.run(['lsof', '-p', str(pid), '-Fn'], capture_output=True, text=True, timeout=10).stdout
        except Exception:
            out = ''
        for line in out.splitlines():
            if line.startswith('n') and os.path.basename(line).startswith('rollout-') and line.endswith('.jsonl') \
                    and os.path.abspath(line[1:]).startswith(os.path.abspath(SESSIONS)):
                return line[1:]
        try:
            ppid = int(subprocess.run(['ps', '-o', 'ppid=', '-p', str(pid)], capture_output=True, text=True, timeout=10).stdout.strip() or 0)
        except Exception:
            return None
        if ppid <= 1:
            return None
        pid = ppid
    return None


def transcript_model(text):
    """The model of the last turn, parsed from the transcript: Codex turn_context records (payload.model) or Claude Code
    assistant messages (message.model)."""
    model = None
    for line in text.splitlines():
        if '"turn_context"' not in line and '"assistant"' not in line:
            continue
        try:
            rec = json.loads(line)
        except ValueError:
            continue
        if rec.get('type') == 'turn_context':
            model = (rec.get('payload') or {}).get('model') or model
        elif rec.get('type') == 'assistant' and isinstance(rec.get('message'), dict):
            model = rec['message'].get('model') or model
    return model


def session_job(path, outdir_rel):
    """(model of the last turn, image URLs seen since this game's folder first appears in the transcript)."""
    try:
        r = subprocess.run(['grep', '-bF', '-m1', outdir_rel, path], capture_output=True, text=True, timeout=60)
        start = int(r.stdout.split(':', 1)[0]) if r.stdout else 0
    except Exception:
        start = 0
    with open(path, 'rb') as f:
        whole = f.read().decode('utf-8', 'ignore')
    model = transcript_model(whole)                                  # last turn's model, anywhere in the transcript
    text = whole[start:] if start else whole                         # URLs only from this game's job onwards
    urls = {u.rstrip('.,;') for u in IMG_URL.findall(text) + IMG_HOSTS.findall(text)}
    urls = {u for u in urls if '127.0.0.1' not in u and 'localhost' not in u}
    return model, sorted(urls)


def open_marks(plat, stem):
    try:
        marks = KIT.json('rereview.json', {})
    except Exception:
        return []
    g = f'{plat}|{stem}'
    return [dict(v, key=k) for k, v in marks.items() if (k == g or k.startswith(g + '|')) and not v.get('resolved')]


def check(plat, stem, ignore, white_ok=()):
    outdir = os.path.join(KIT.restored, plat, stem)
    outdir_rel = f'{os.path.basename(KIT.restored)}/{plat}/{stem}'
    refdir = os.path.join(KIT.references, plat, stem)
    fails, warns = [], []
    faces = [f for f in FACES if os.path.exists(os.path.join(outdir, f + '.png'))]
    if not faces:
        return None, [f'no restored faces in {outdir}'], []

    # 1. the model that really ran: the transcript that is running this check right now (it mentions this game's
    #    folder and this script, and was written in the last 10 minutes). Reviewer transcripts are older/idle.
    session = own_transcript()                                        # exact: the agent process running this check
    if session and subprocess.run(['grep', '-qF', outdir_rel, session]).returncode != 0:
        session = None                                                 # that agent never touched this game
    exact = session is not None
    if session is None:                                              # sandbox hides the process tree: best guess —
        now = time.time()                                            # the newest transcript that mentions this game and
        caller = [t for t in find_sessions(outdir_rel)               # this script, written in the last 2 minutes
                  if now - os.path.getmtime(t) < 120 and subprocess.run(['grep', '-qF', 'restore_check.py', t]).returncode == 0]
        session = caller[0] if caller else None
        if session:
            warns.append(f'model and URLs read from the most recent matching transcript ({os.path.basename(session)}), '
                         f'not one proven to be yours — if several agents ran checks at once, the reviewer should confirm '
                         f'the model and sources by hand')
    model, urls = session_job(session, outdir_rel) if session else (None, [])
    if not session:
        fails.append(f'could not find your own Codex transcript (or it never mentions {outdir_rel}) — run this from the '
                     f'restorer session that made the files, with your own shell, right after saving them')
    elif not model:
        fails.append(f'could not read the model from transcript {os.path.basename(session)}')
    elif ALLOWED_MODELS and model not in ALLOWED_MODELS:
        fails.append(f'this game was restored by {model}, not one of {", ".join(ALLOWED_MODELS)} '
                     f'(transcript {os.path.basename(session)}). Redo it on an allowed model.')

    # 2. references: everything looked at must be saved and listed
    listed = set()
    if os.path.exists(os.path.join(refdir, 'sources.txt')):
        listed = {l.split()[-1] for l in open(os.path.join(refdir, 'sources.txt')) if l.strip().startswith(('http', 'DEAD'))}
    ref_imgs = [f for f in os.listdir(refdir)] if os.path.isdir(refdir) else []
    ref_imgs = [f for f in ref_imgs if f.lower().endswith(('.jpg', '.jpeg', '.png', '.webp', '.gif'))]
    missing = [u for u in urls if u not in listed and u not in ignore]
    for u in missing:
        fails.append(f'opened {u} on this job but it is not in references/{plat}/{stem}/sources.txt — save it with the review '
                     f'server (browser tool: http://127.0.0.1:{KIT.c.get("port", 8790)}/api/save-ref?platform={plat}&stem=<stem>&url=<url>), '
                     f'or pass --ignore-url "{u}" "why it was not used"')
    if listed and not ref_imgs:
        fails.append(f'sources.txt lists URLs but references/{plat}/{stem}/ has no saved images')
    for u in sorted(listed | set(urls)):
        if NON_US.search(u) and u not in ignore:
            warns.append(f'non-US-looking source {u}: confirm it shows the US English edition (project rule)')

    job_fails = list(fails)     # model / references: these fail every face

    # 3. the faces themselves
    inputs = job_inputs(plat, stem)
    marks = open_marks(plat, stem)
    prov_faces = {}
    for face in faces:
        path = os.path.join(outdir, face + '.png')
        ff, fw = [], []
        size = png_size(path)
        if not size:
            ff.append('not a real PNG file')
            size = img_size(path) or (0, 0)
        w, h = size
        rule = KIT.asset_rule(face)
        if rule.get('min_long_side') and max(w, h) < rule['min_long_side']:
            ff.append(f'{w}x{h}: long side under {rule["min_long_side"]} px')
        if rule.get('min_height') and h < rule['min_height']:
            ff.append(f'{w}x{h}: under {rule["min_height"]} px tall')
        if rule.get('min_width') and w < rule['min_width']:
            ff.append(f'{w}x{h}: under {rule["min_width"]} px wide')
        src = inputs.get(face)
        if src and os.path.exists(src):
            iw_ih = img_size(src)
            if iw_ih and w and h:
                a_in, a_out = iw_ih[0] / iw_ih[1], w / h
                if abs(a_out / a_in - 1) > .015:
                    (fw if KIT.asset_rule(face).get('aspect_may_differ') else ff).append(f'aspect {a_out:.3f} differs from the input {a_in:.3f} '
                                                          f'({os.path.relpath(src, ART)})')
        else:
            fw.append('input scan not found in the queue/base picks — aspect ratio not checked')
        edges = white_edges(path) if w and face not in white_ok else []
        if edges:
            ff.append(f'blank white padding on the {", ".join(edges)} edge(s) — crop/extend the artwork to the edge; if the '
                      f'printed box really is white there, re-run with --white-edge-ok {face}')
        face_marks = [m for m in marks if m.get('face') == face]
        for m in face_marks:
            rg = m.get('regions') or []
            fw.append('user note to fix: ' + (m.get('note') or '(flagged for re-review)') +
                      ''.join(f' | box {i + 1} ({r["x"]:.2f},{r["y"]:.2f} {r["w"]:.2f}x{r["h"]:.2f}): {r.get("note") or "fix"}'
                              for i, r in enumerate(rg)))
        prov_faces[face] = {'sha256': sha(path), 'w': w, 'h': h,
                            'input': os.path.relpath(src, ART) if src else None,
                            'fails': ff, 'warnings': fw, 'result': 'fail' if (ff or job_fails) else 'pass'}
        fails += [f'{face}: {x}' for x in ff]
        warns += [f'{face}: {x}' for x in fw]

    prov = {'platform': plat, 'stem': stem, 'checked_at': time.strftime('%Y-%m-%d %H:%M:%S'),
            'model': model, 'session': os.path.basename(session) if session else None,
            'sources': sorted(listed), 'reference_files': sorted(ref_imgs),
            'ignored_urls': ignore, 'result': 'fail' if fails else 'pass',
            'job_fails': job_fails, 'white_edge_ok': list(white_ok),
            'fails': fails, 'warnings': warns, 'faces': prov_faces}
    with open(os.path.join(outdir, 'provenance.json'), 'w') as f:
        json.dump(prov, f, indent=1, ensure_ascii=False)
    return prov, fails, warns


def verify(plat, stem):
    outdir = os.path.join(KIT.restored, plat, stem)
    try:
        prov = json.load(open(os.path.join(outdir, 'provenance.json')))
    except Exception:
        return ['no provenance.json: the restorer never ran restore_check.py — send the job back']
    fails = list(prov.get('job_fails') or [])
    if ALLOWED_MODELS and prov.get('model') not in ALLOWED_MODELS and not any('Redo it on an allowed model' in f for f in fails):
        fails.append(f'made by {prov.get("model")}, not one of {", ".join(ALLOWED_MODELS)}')
    for face in FACES:
        path = os.path.join(outdir, face + '.png')
        if not os.path.exists(path):
            continue
        p = prov.get('faces', {}).get(face)
        if not p:
            fails.append(f'{face}: never checked')
        elif p['sha256'] != sha(path):
            fails.append(f'{face}: changed after its check — the restorer must re-run restore_check.py')
        elif p['fails']:
            fails.append(f'{face}: failed its check: ' + '; '.join(p['fails']))
    return fails


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('platform', choices=sorted(KIT.platforms))
    ap.add_argument('stem')
    ap.add_argument('--verify', action='store_true', help='reviewer: confirm the faces on disk are the ones that passed')
    ap.add_argument('--ignore-url', nargs=2, action='append', default=[], metavar=('URL', 'REASON'))
    ap.add_argument('--white-edge-ok', action='append', default=[], choices=FACES,
                    help='this face of the printed box really is white at the edge (reviewer will check)')
    a = ap.parse_args()
    if a.verify:
        fails = verify(a.platform, a.stem)
        print('VERIFY ' + ('FAIL' if fails else 'PASS') + f' — {a.platform} {a.stem}')
        for f in fails:
            print('  FAIL', f)
        sys.exit(1 if fails else 0)
    prov, fails, warns = check(a.platform, a.stem, {u: r for u, r in a.ignore_url}, a.white_edge_ok)
    print(('CHECK FAIL' if fails else 'CHECK PASS') + f' — {a.platform} {a.stem}' +
          (f' (model {prov["model"]}, {len(prov["faces"])} faces)' if prov else ''))
    for f in fails:
        print('  FAIL', f)
    for w in warns:
        print('  NOTE', w)
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
