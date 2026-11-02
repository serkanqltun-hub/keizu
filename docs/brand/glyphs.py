import json, sys
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen
F = sys.argv[1]
fonts = {k: TTFont(f"{F}/{v}") for k, v in {
  'mincho': 'ShipporiMinchoB1-ExtraBold.ttf', 'kaku': 'ZenKakuGothicNew-Black.ttf', 'latin': 'PJS-800.ttf'}.items()}

def glyph(font, ch):
    gs = font.getGlyphSet(); name = font.getBestCmap()[ord(ch)]
    return gs, name, font['hmtx'][name][0], font['head'].unitsPerEm

def bounds(font, ch):
    gs, n, adv, upm = glyph(font, ch); bp = BoundsPen(gs); gs[n].draw(bp); return bp.bounds, adv, upm

def path(font, ch, size, x, base):
    gs, n, adv, upm = glyph(font, ch); s = size / upm
    sp = SVGPathPen(gs, ntos=lambda v: ('%.2f' % v).rstrip('0').rstrip('.'))
    gs[n].draw(TransformPen(sp, (s, 0, 0, -s, x, base)))
    return sp.getCommands(), adv * s

out = {}
# 系 mark, centred optically in the 64 box like the E2 mockup (size 37, centre x 31, baseline 45.5)
f = fonts['mincho']; (xmin, ymin, xmax, ymax), adv, upm = bounds(f, '系'); size = 37; s = size / upm
cx = 30; x = cx - (xmin + xmax) / 2 * s
cy = 30; base = cy + (ymin + ymax) / 2 * s
out['kei'], _ = path(f, '系', size, x, base)
out['kei_box'] = [x + xmin*s, base - ymax*s, x + xmax*s, base - ymin*s]
# wordmark "keizu", font size 40, baseline 40
f = fonts['latin']; x = 0; d = []
for ch in 'keizu':
    p, a = path(f, ch, 40, x, 40); d.append(p); x += a
out['word'] = ' '.join(d); out['word_w'] = x
# tag glyphs ケイズ, each centred in a 14 wide column; pitch 12.5, size 11
f = fonts['kaku']; d = []
for i, ch in enumerate('ケイズ'):
    (xmin, ymin, xmax, ymax), adv, upm = bounds(f, ch); s = 11 / upm
    cy = 9.5 + i * 12.5
    p, _ = path(f, ch, 11, 7 - (xmin + xmax) / 2 * s, cy + (ymin + ymax) / 2 * s); d.append(p)
out['tag'] = ' '.join(d); out['tag_h'] = 9.5 + 2 * 12.5 + 9.5
json.dump(out, open(sys.argv[2], 'w'))
print(out['kei_box'], out['word_w'], out['tag_h'], len(out['kei']), len(out['word']), len(out['tag']))
