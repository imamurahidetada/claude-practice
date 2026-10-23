#!/usr/bin/env python3
"""海馬内の Markdown リンク切れと孤立ノート(目録から辿れない)を調べる。0=良し。"""
import re, sys, pathlib
root = pathlib.Path(__file__).parent
link = re.compile(r'\[[^\]]*\]\(([^)#]+\.md)(?:#[^)]*)?\)')
bad, linked = [], set()
for f in root.rglob('*.md'):
    for m in link.finditer(f.read_text(encoding='utf-8')):
        t = (f.parent / m.group(1)).resolve()
        (linked.add(t) if t.exists() else bad.append(f"{f.relative_to(root)} -> {m.group(1)}"))
orphans = [str(f.relative_to(root)) for f in root.rglob('*.md')
           if f.name != '目録.md' and f.resolve() not in linked]
for b in bad: print("リンク切れ:", b)
for o in orphans: print("孤立:", o)
sys.exit(1 if bad or orphans else 0)
