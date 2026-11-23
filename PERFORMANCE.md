# How light is Shmirot?

Measured on 2026-11-23 at commit `main`. Every number here can be reproduced with the
commands in each section.

## Summary

| What | Result |
|---|---|
| Whole app, everything a phone ever downloads (code, icons, offline worker) | **180 KB** gzip (164 KB brotli) |
| Code only (JS + CSS + HTML) | **124 KB** gzip |
| Runtime dependencies | **3** (react, react-dom, dexie) |
| First open on a slow phone profile (Fast 3G, CPU 4× slower) | content on screen in **1.7 s**, first paint **1.4 s**, **117 KB** transferred |
| Open again in airplane mode | full board in **0.35 s**, zero network |
| Schedule a week: 30 soldiers, 3 posts, 4 h day / 2 h night shifts | **10 ms** (solver alone), **0.35 s** click → board on the slow CPU profile |
| Re-plan after "went home", mid-week | **7 ms** |
| Two weeks: 60 soldiers, 5 posts, 522 shifts | **94 ms** |
| A month: 30 soldiers, 5 posts, 994 shifts, 1,476 seats, home-leave rotation (`tests/scale`) | **~0.1 s** |
| Space used on the device (app files + data, 30 soldiers, a week planned) | **~540 KB** |
| Network requests while using it | **none** (all data stays on the device) |
| Server, account, backend | **none** |

## 1. Download / install size

```bash
npm run build && npm run size
```

| File | raw KB | gzip KB |
|---|---|---|
| app code `assets/index-*.js` (React, Dexie, UI, solver fallback) | 358.9 | 111.5 |
| solver worker `assets/worker-*.js` | 8.9 | 3.5 |
| styles `assets/index-*.css` | 8.3 | 2.4 |
| offline service worker (workbox + sw.js) | 16.6 | 6.0 |
| icons (PNG + SVG) | 57.8 | 55.7 |
| html + manifest | 1.6 | 0.9 |
| **total** | **452.1** | **180.0** |

The whole scheduling algorithm — matching, fairness, certificate, warnings — is **3.5 KB**
gzipped.

## 2. Solver speed

```bash
npm run bench
```

Real shift generator (Asia/Jerusalem), real solver, median of repeated runs in Node on the
build machine:

| Scenario | Shifts | Median | Max |
|---|---|---|---|
| 30 soldiers · 3 posts · 7 days · day/night split, 3 absent for 2 days | 149 | 10.4 ms | 21.4 ms |
| Re-plan from mid-week, first half locked | 149 | 7.1 ms | 9.5 ms |
| 60 soldiers · 5 posts · 14 days · day/night split | 522 | 94.4 ms | 134.0 ms |

On the phone the solver runs in a Web Worker, so the screen never freezes even while it works.

## 3. On a slow phone profile

Headless Chrome, 390×844 viewport, CPU throttled 4×, network "Fast 3G" (150 ms RTT,
~1.6 Mbps), served by `vite preview`:

- first visit: first contentful paint **1.36 s**, input box ready **1.69 s**, **117 KB**
  transferred (the rest of the 180 KB is precached in the background);
- creating a 7-day plan for 30 soldiers and 3 posts (252 shift rows on the board): **347 ms**
  from tap to rendered board;
- reload with the network switched off: full board in **0.35 s**;
- `navigator.storage.estimate()` after all that: **~543 KB**, including the cached app files.

Caveat: this is an emulated profile, not a real device. Real iPhones and mid-range Androids
are usually faster than a 4×-throttled desktop CPU, but network conditions in the field vary.

## Why it is this small
- No backend: nothing to call, nothing to wait for.
- Three runtime dependencies. No UI kit, no date library (the shift generator handles time
  zones and DST with the built-in `Intl` API), no analytics.
- The algorithm is plain TypeScript with no math library: a min-cost matching written for
  this problem (`src/solver/matching.ts`).
