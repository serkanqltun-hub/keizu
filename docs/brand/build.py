import json, sys, os
g = json.load(open(sys.argv[1])); R = sys.argv[2]
T = {'light': dict(bg='#1f2a37', dot='#7389ff', ink='#1d232b', tag='#3446b8', tagink='#ffffff'),
     'dark':  dict(bg='#232c38', dot='#8197ff', ink='#e6e9ee', tag='#8197ff', tagink='#14181e')}
W = g['word_w']; TX = W + 8; WW = TX + 14
def mark_body(t): return (f'<rect width="64" height="64" rx="15" fill="{t["bg"]}"/>'
    f'<path fill="#fff" d="{g["kei"]}"/><circle cx="51" cy="50.5" r="3.8" fill="{t["dot"]}"/>')
def word_body(t): return (f'<path fill="{t["ink"]}" d="{g["word"]}"/>'
    f'<rect x="{TX:.2f}" y="4" width="14" height="{g["tag_h"]}" rx="3.5" fill="{t["tag"]}"/>'
    f'<path fill="{t["tagink"]}" transform="translate({TX:.2f} 4)" d="{g["tag"]}"/>')
def svg(vb, body, label): return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" role="img" aria-label="{label}">{body}</svg>\n'
os.makedirs(f'{R}/docs/brand', exist_ok=True)
for k, t in T.items():
    sfx = '' if k == 'light' else '-dark'
    open(f'{R}/docs/brand/keizu-mark{sfx}.svg', 'w').write(svg('0 0 64 64', mark_body(t), 'Keizu'))
    open(f'{R}/docs/brand/keizu-wordmark{sfx}.svg', 'w').write(svg(f'0 0 {WW:.2f} 52', word_body(t), 'keizu'))
    open(f'{R}/docs/brand/keizu-lockup{sfx}.svg', 'w').write(svg(f'0 0 {64+16+WW:.2f} 64',
        f'{mark_body(t)}<g transform="translate(80 6)">{word_body(t)}</g>', 'Keizu'))
open(f'{R}/public/icon.svg', 'w').write(svg('0 0 64 64', mark_body(T['light']), 'Keizu'))
# TS module for the app
open(f'{R}/src/ui/brandPaths.ts', 'w').write(
  '// Outlined logo glyphs, generated from Shippori Mincho B1 ExtraBold (系),\n'
  '// Plus Jakarta Sans 800 (keizu) and Zen Kaku Gothic New Black (ケイズ). All SIL OFL 1.1.\n'
  '// See docs/brand/README.md.\n'
  f'export const KEI_PATH = {json.dumps(g["kei"])};\n'
  f'export const WORD_PATH = {json.dumps(g["word"])};\n'
  f'export const TAG_PATH = {json.dumps(g["tag"])};\n'
  f'export const WORD_WIDTH = {W:.2f};\n'
  f'export const TAG_HEIGHT = {g["tag_h"]};\n')
print('ok', WW)
