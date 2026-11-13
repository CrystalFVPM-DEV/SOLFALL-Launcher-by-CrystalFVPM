#!/usr/bin/env python3
"""Mide PSS/RSS (suma del árbol) y CPU (% de 1 núcleo) de un proceso YA lanzado.
Uso: measure-pid.py <label> <root_pid> <window_s>. Solo lee /proc; no interactúa."""
import os, sys, time, json
label, root, win = sys.argv[1], int(sys.argv[2]), float(sys.argv[3])
HZ = os.sysconf('SC_CLK_TCK')
def tree(r):
    kids = {}
    for p in os.listdir('/proc'):
        if p.isdigit():
            try: pp = int(open(f'/proc/{p}/stat').read().rsplit(')',1)[1].split()[1]); kids.setdefault(pp, []).append(int(p))
            except Exception: pass
    out, st = [], [r]
    while st: x = st.pop(); out.append(x); st += kids.get(x, [])
    return out
def mem(pids):
    pss = rss = 0
    for p in pids:
        try:
            for l in open(f'/proc/{p}/smaps_rollup'):
                if l.startswith('Pss:'): pss += int(l.split()[1])
                elif l.startswith('Rss:'): rss += int(l.split()[1])
        except Exception: pass
    return pss/1024, rss/1024
def cpu(pids):
    t = 0.0
    for p in pids:
        try: f = open(f'/proc/{p}/stat').read().rsplit(')',1)[1].split(); t += (int(f[11]) + int(f[12])) / HZ
        except Exception: pass
    return t
pids = tree(root); c0 = cpu(pids); t0 = time.time(); s = []
while time.time() - t0 < win:
    time.sleep(win/10); pids = tree(root); s.append(mem(pids))
c1 = cpu(tree(root)); dt = time.time() - t0
names = sorted({open(f'/proc/{p}/comm').read().strip() for p in pids if os.path.exists(f'/proc/{p}/comm')})
print(json.dumps({"label": label, "procs": len(pids), "names": names, "pss_mb_avg": round(sum(x[0] for x in s)/len(s),1),
  "pss_mb_max": round(max(x[0] for x in s),1), "rss_mb_avg": round(sum(x[1] for x in s)/len(s),1),
  "cpu_pct_1core": round(100*(c1-c0)/dt,1), "window_s": win}))
