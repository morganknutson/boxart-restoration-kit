"""Generates a small demo project with made-up games and placeholder "scans" — no real box art — so you can try the
review page and the agent workflow end to end.

usage: python3 examples/demo/make_demo.py            (needs Pillow: pip install pillow)
then:  python3 tools/review_server.py --config examples/demo/kit.json   and open http://127.0.0.1:8795/

Creates examples/demo/art/ (scans: a clean "US" version and a worn "EU" version of each asset, plus a few "restored"
outputs) and examples/demo/work/catalog.json. Safe to re-run; it overwrites only what it made.
"""
import json, os, random
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ART = os.path.join(HERE, 'art')
WORK = os.path.join(HERE, 'work')
GAMES = [('handheld', 'Star Courier (USA)', '#2b5fd9'), ('handheld', 'Moss Garden Quest (USA, Europe)', '#3a9d4a'),
         ('handheld', 'Pixel Kart Rally (USA)', '#d9452b'), ('console', 'Orbital Drift (USA)', '#6b3fd1'),
         ('console', 'Harbor Lights (USA)', '#d19a2b'), ('console', 'Nightglass (Europe)', '#2bb5c8')]
SIZES = {'front': (700, 700), 'back': (700, 700), 'spine': (90, 700), 'label': (420, 360)}


def font(size):
    for f in ('/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'):
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


def screenshot(seed, w=160, h=144):
    """A tiny fake gameplay screen in 4 shades, as pixel art."""
    rnd = random.Random(seed)
    shades = [(15, 56, 15), (48, 98, 48), (139, 172, 15), (155, 188, 15)]
    im = Image.new('RGB', (w, h), shades[3])
    d = ImageDraw.Draw(im)
    for _ in range(18):
        x, y = rnd.randrange(w), rnd.randrange(h)
        d.rectangle((x, y, x + rnd.randrange(4, 24), y + rnd.randrange(4, 16)), fill=rnd.choice(shades[:3]))
    d.text((4, 2), f'SCORE {rnd.randrange(100000):06d}', fill=shades[0])
    return im


def asset(title, color, kind, worn):
    w, h = SIZES[kind]
    im = Image.new('RGB', (w, h), color)
    d = ImageDraw.Draw(im)
    if kind == 'front':
        d.rectangle((0, 0, 70, h), fill='#dddddd')
        d.text((20, h - 40), 'DEMO', fill='#222', font=font(18))
        d.text((90, 40), title.split(' (')[0].upper(), fill='white', font=font(34))
        d.ellipse((200, 200, 600, 600), outline='white', width=8)
    elif kind == 'back':
        d.text((30, 30), title.split(' (')[0], fill='white', font=font(30))
        for i in range(3):
            shot = screenshot(title + str(i)).resize((160 * 2, 144 * 2), Image.NEAREST)
            im.paste(shot.resize((200, 180), Image.NEAREST), (30 + i * 220, 120))
        d.multiline_text((30, 340), 'Explore strange places.\nCollect every gem.\nBeat the clock!', fill='white', font=font(22))
        d.rectangle((30, 560, 230, 660), fill='white')
        d.text((40, 600), '0 12345 67890 5', fill='black', font=font(18))
    elif kind == 'spine':
        t = Image.new('RGB', (h, w), color)
        ImageDraw.Draw(t).text((20, 25), title.split(' (')[0].upper(), fill='white', font=font(36))
        im = t.rotate(90, expand=True)
    else:
        d.rectangle((20, 20, w - 20, h - 20), outline='white', width=6)
        d.text((40, 40), title.split(' (')[0], fill='white', font=font(28))
    if worn:                                              # a "scan": blur, colour cast, noise, a crease
        im = im.filter(ImageFilter.GaussianBlur(1.6))
        im = Image.blend(im, Image.new('RGB', im.size, '#c8b27a'), 0.18)
        d = ImageDraw.Draw(im)
        rnd = random.Random(title + kind)
        for _ in range(400):
            x, y = rnd.randrange(im.width), rnd.randrange(im.height)
            d.point((x, y), fill=(rnd.randrange(255),) * 3)
        d.line((0, im.height * 0.3, im.width, im.height * 0.35), fill='#eeeeee', width=2)
    return im


def main():
    games = []
    for plat, title, color in GAMES:
        assets = {}
        for kind in SIZES:
            cands = []
            for src, region, worn in (('scanner-a', 'us', True), ('scanner-b', 'eu', True)):
                if region == 'eu' and '(USA)' in title and kind == 'label':
                    continue
                rel = f'scans/{src}/{plat}/{title}/{kind}.png'
                os.makedirs(os.path.dirname(os.path.join(ART, rel)), exist_ok=True)
                asset(title, color if region == 'us' else '#555555', kind, worn).save(os.path.join(ART, rel))
                cands.append({'path': rel, 'source': src, 'region': region, 'use': region == 'us'})
            assets[kind] = cands
        region = 'USA' if '(USA' in title else 'Europe'
        games.append({'platform': plat, 'id': title, 'region': region, 'assets': assets})
    # two games already "restored" (clean renders) so the page has something to judge
    for plat, title, color in GAMES[:2]:
        for kind in SIZES:
            out = os.path.join(ART, 'restored', plat, title, kind + '.png')
            os.makedirs(os.path.dirname(out), exist_ok=True)
            im = asset(title, color, kind, worn=False)
            im.resize((im.width * 2, im.height * 2), Image.NEAREST).save(out)
    os.makedirs(WORK, exist_ok=True)
    with open(os.path.join(WORK, 'catalog.json'), 'w') as f:
        json.dump({'games': games}, f, indent=1)
    print(f'demo: {len(games)} games, scans in {ART}, catalog in {WORK}/catalog.json')


if __name__ == '__main__':
    main()
