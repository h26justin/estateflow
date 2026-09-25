#!/usr/bin/env python3
"""Split seed.sql into statement-aligned chunks small enough for the Supabase
MCP execute_sql tool. Usage: python3 split_seed.py <out_dir> [max_bytes]"""
import re, sys, os
out_dir = sys.argv[1]; max_bytes = int(sys.argv[2]) if len(sys.argv) > 2 else 140000
here = os.path.dirname(os.path.abspath(__file__))
s = open(os.path.join(here, 'seed.sql')).read()
stmts = [x for x in re.split(r';\n', s) if x.strip()]
chunks, cur = [], ''
for st in stmts:
    piece = st + ';\n'
    if len(cur) + len(piece) > max_bytes and cur:
        chunks.append(cur); cur = ''
    cur += piece
chunks.append(cur)
os.makedirs(out_dir, exist_ok=True)
for i, c in enumerate(chunks):
    path = os.path.join(out_dir, f'{i:02d}.sql')
    open(path, 'w').write(c)
    print(i, len(c), c.count('insert into'), path)
