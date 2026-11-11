#!/usr/bin/env python3
"""Inline src/ into a single self-contained index.html."""
from pathlib import Path
src = Path(__file__).parent / 'src'
html = (src / 'shell.html').read_text()
for tag, f in [('/*ENGINE*/', 'engine.js'), ('/*DEMO*/', 'demo.js'), ('/*MAIN*/', 'main.js')]:
    html = html.replace(tag, (src / f).read_text())
(Path(__file__).parent / 'index.html').write_text(html)
print('built index.html')
