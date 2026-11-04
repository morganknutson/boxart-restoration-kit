# compare.py <original> <restored> <out.png>: side by side at equal height, plus two 2x detail crops
import sys
from PIL import Image
o = Image.open(sys.argv[1]).convert('RGB'); n = Image.open(sys.argv[2]).convert('RGB')
H = 700
o2 = o.resize((round(o.width * H / o.height), H), Image.LANCZOS); n2 = n.resize((round(n.width * H / n.height), H), Image.LANCZOS)
s = Image.new('RGB', (o2.width + n2.width + 20, H), (30, 30, 30)); s.paste(o2, (0, 0)); s.paste(n2, (o2.width + 20, 0))
s.save(sys.argv[3])
# detail crops: given as fractions in argv[4:] (x0,y0,x1,y1)
for k, spec in enumerate(sys.argv[4:]):
    x0, y0, x1, y1 = map(float, spec.split(','))
    co = o.crop((int(x0 * o.width), int(y0 * o.height), int(x1 * o.width), int(y1 * o.height)))
    cn = n.crop((int(x0 * n.width), int(y0 * n.height), int(x1 * n.width), int(y1 * n.height)))
    h = 420
    co = co.resize((round(co.width * h / co.height), h), Image.LANCZOS); cn = cn.resize((round(cn.width * h / cn.height), h), Image.LANCZOS)
    d = Image.new('RGB', (co.width + cn.width + 20, h), (30, 30, 30)); d.paste(co, (0, 0)); d.paste(cn, (co.width + 20, 0))
    d.save(sys.argv[3].replace('.png', f'_d{k}.png'))
