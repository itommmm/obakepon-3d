#!/usr/bin/env python3
"""配布物を作る: dist/obakepon.html（単体HTML）と dist/web/（ホーム画面追加用）"""
import os, re, shutil, sys
R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
rd = lambda p: open(os.path.join(R, p), encoding='utf-8').read()
html, game, three = rd('index.html'), rd('src/main.js'), rd('vendor/three.min.js').replace('</script', '<\\/script')
html = html.replace('<script src="vendor/three.min.js"></script>', '<script>' + three + '</script>')
html = html.replace('<script src="src/main.js"></script>', '<script>' + game + '</script>')
assert 'src="' not in html, 'インライン化できていない外部スクリプトがあります'
meta = '<meta name="theme-color" content="#0d0a24">\n<meta name="robots" content="noindex,nofollow">\n'
os.makedirs(os.path.join(R, 'dist/web'), exist_ok=True)
open(os.path.join(R, 'dist/obakepon.html'), 'w', encoding='utf-8').write(html.replace('<title>', meta + '<title>', 1))
pwa = html.replace('<title>', meta + '<link rel="manifest" href="manifest.webmanifest">\n<link rel="apple-touch-icon" href="icon-180.png">\n<meta name="apple-mobile-web-app-title" content="おばけポン">\n<title>', 1)
pwa = pwa.replace('</body>', "<script>if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) navigator.serviceWorker.register('sw.js').catch(() => {});</script>\n</body>")
open(os.path.join(R, 'dist/web/index.html'), 'w', encoding='utf-8').write(pwa)
for f in os.listdir(os.path.join(R, 'pwa')): shutil.copy(os.path.join(R, 'pwa', f), os.path.join(R, 'dist/web', f))
print('dist/obakepon.html', os.path.getsize(os.path.join(R, 'dist/obakepon.html')), 'bytes')
