# Build plan

Each session starts cold. It reads `CLAUDE.md`, this file and `ALGORITHM.md`, does only its
own goal, and ends with green tests and a commit. Update the status column when done.

| # | Session | Depends on | Status |
|---|---|---|---|
| 0 | Contract: decisions, ALGORITHM.md, types.ts, repo skeleton | — | ✅ done |
| 1A | Solver | 0 | ✅ done |
| 1B | Verifier + oracle + property tests + edge cases | 0 | ✅ done |
| 1C | UI with fake solver | 0 | ✅ done |
| 2 | Integration (real solver in Web Worker, all tests green) | 1A, 1B, 1C | ✅ done |
| 2.5 | Custom post names and user-defined roles (D6 revised) | 2 | ✅ done |
| 2.6 | Per-soldier history (day/night guard, rest, home) per activity and in total | 2.5 | ✅ done |
| 3 | Fairness screen, sliders/presets, certificate, pre-flight warnings | 2 | ✅ done |
| 3.1 | Ledger per soldier carried into new boards, reset load, stats on platoon page (D7) | 3 | ✅ done |
| 3.2 | Board score (before / on board / after, gap) and "why him?" per shift | 3.1 | ✅ done |
| 3.3 | Post difficulty weight, weight-aware seats, free shift lengths | 3.2 | ✅ done |
| 3.5 | Backup: export / import a file (next version) | 3 | ⬜ |
| — | Pilot with a real platoon | 3 | ⬜ |
| 4 | Fixes from pilot | pilot | ⬜ |
| 5 | Launch: README + GIF, PROOF.md, live demo, CI | 4 | ⬜ |

1A, 1B and 1C can run in parallel.

---

## 1A — Solver
**Goal:** implement `solve()` in `src/solver/` exactly as ALGORITHM.md §4.
- Min-cost maximum bipartite matching (successive shortest paths) in its own module.
- Joint matching with lookahead slots (§4.4 c), fair share (§4.3), certificate (§6), warnings.
- Do **not** write the verifier or oracle; write only unit tests for the solver's own modules
  plus the worked example below.

Worked example that must pass: soldiers א ב ג ד (role `soldier`), one post, 1 per shift,
2 h shifts from 20:00, R = 4 h, nightWeight = 1 → assignments: א, ב, ג, ד, א.

**Done when:** unit tests green, worked example green, build green.

## 1B — Verifier, oracle, properties, edge cases
**Goal:** everything in ALGORITHM.md §8, written **only** from the document.
- Must not read or import `src/solver/*` other than `types.ts`.
- Includes a tiny shift generator helper for tests (uniform shifts) — or uses the real one if 1C
  already created `src/storage/shiftGenerator.ts`.
- Oracle baseline file `tests/oracle/baseline.json` is created in session 2 from the first real run.

**Done when:** all tests exist and fail only because `solve()` throws "not implemented".

**Notes from 1B (for session 2):**
- Every test that runs `solve()` goes through `tests/helpers/solve.ts → runAndVerify()`:
  runs twice (determinism), checks the input is not mutated, then `verify()` must return `[]`.
- Oracle baseline: once the solver is green, create it with
  `UPDATE_ORACLE_BASELINE=1 npx vitest run tests/oracle` and commit `tests/oracle/baseline.json`.
- `tsconfig.test.json` makes `npm run build` type-check `tests/` too.

**Gaps found after 1A/1B/1C and how they were resolved (merged to main):**
| Gap | Resolution |
|---|---|
| Oracle demanded global max coverage; solver loses coverage on misaligned posts (one soldier, long vs. short shifts) | Contract: global coverage proven only for **aligned** schedules; misaligned coverage gap is recorded in the baseline and may not grow (ALGORITHM.md Claim 3, §8 C). |
| Lookahead slots at cost 0 could steal a seat from the current group | Already fixed by 1A: lexicographic objective (total, then current group, then cost). Verifier checks it. |
| Claim 5 failed on misaligned posts and with R > 0 | Contract: Claim 5 conditions are aligned + R = 0 (busy soldiers and rest-first break the bound). Property test narrowed; R > 0 balance is measured by the oracle. |
| `NIGHT_TRAP` / `ROLE_BOTTLENECK` expected by tests, deferred by 1A | Defined in ALGORITHM.md §4.4 and implemented in `src/solver/warnings.ts`. Session 3 only displays them. |
| `provenOptimal` ambiguous when certificate is n/a | Defined as `false`; verifier is strict. |
| DST test waiting for the generator | Wired to `generateShifts` on the 2026 Israel transition days (23 h / 25 h, contiguous, real night minutes). |
| Re-plan passed past shifts with their original requirements | `buildSolverInput` sets requirements of started shifts to their locks (ALGORITHM.md §3), with a test. |

## 1C — UI with fake solver
**Goal:** the three screens, Hebrew RTL, installable PWA, on a phone.
1. **מחלקה** – paste names (one per line), tap to toggle roles per soldier.
2. **התחל פעילות** – start/end, shift length chips (1/2/3/4 h), rest chips, posts with +/−
   and a role composition per post; optional "split day/night" and "active only between".
   Includes `src/storage/shiftGenerator.ts` (wall clock → minutes, DST-safe, nightMinutes).
3. **לוח** – schedule by post and time, "copy to WhatsApp", tap a name → "went home" / "back"
   → re-plan from now (past shifts locked). Every shift that has already started is
   passed with its assignments as locks and with its requirements set to what was
   actually filled (ALGORITHM.md §3), so the solver never fills seats in the past.
- Dexie storage. A fake `solve()` that returns a fixed plausible schedule.
- Target: from opening the app to a list in the WhatsApp group in under 60 seconds.

**Done when:** full flow works in the browser on a phone-sized viewport; build green.

**Status (done):** screens in `src/ui/` (`PlatoonScreen`, `ActivityScreen`, `BoardScreen`), strings in
`src/i18n/he.ts`, Dexie in `src/storage/db.ts`, generator + tests in `src/storage/shiftGenerator.ts`
(gap times → transition instant, ambiguous times → earlier occurrence; tested on Israel DST days and
with a fast-check property). `src/ui/planner.ts` is the only place that calls the solver — session 2
swaps its `fakeSolve` import for the real `solve()` in a Worker. Re-plan locks every assignment of a
shift with `start < now`; "went home" adds an absence `[now, end)`, "back" cuts it at `now`.
Checked end-to-end in a 390×844 viewport: paste names → board → WhatsApp text, no network requests.

## 2 — Integration
Branches are already merged and all tests are green with the real solver. Remaining:
- swap `fakeSolve` in `src/ui/planner.ts` for the real `solve()` running in a Web Worker;
- create and commit `tests/oracle/baseline.json`
  (`UPDATE_ORACLE_BASELINE=1 npx vitest run tests/oracle`) and report the numbers;
- check the full flow on a phone-sized viewport with the real solver.

**Status (done):** `src/solver/worker.ts` + `src/ui/solverClient.ts` (falls back to the main
thread if workers are unavailable); the planner takes the solver as a parameter
(`SolveAsync`), tests pass the synchronous `solve()`. `fakeSolve` removed. Worker is in the
PWA precache. Oracle baseline committed (seed 3001, 100 instances, 74 aligned):
rest exact on 88% (mean gap 21 min, max 6 h), load spread exact on 82% (mean 20, max 285
weighted min), misaligned coverage exact on 92% (max gap 2 seats). The oracle optimises
rest and spread separately, so these gaps are upper bounds on how far the solver is from
the best schedule for that single metric. E2E in a 390×844 headless Chrome: paste 10 names
→ create → copy to WhatsApp in 3.5 s of scripted time; "went home" re-plans and removes the
soldier from future shifts; no external requests, no console errors.

## 2.5 — Custom post names and roles
**Status (done):** `Role` is now an opaque id; `SolverInput.roles` gives the role order
(`roleOrder()` in types.ts, used by solver, verifier and oracle). UI: roles editor on the
platoon screen (rename / add / remove; removing a role also removes it from soldiers and
post requirements), optional name per post, 16-char limit and privacy hint on every label
field. Names live in `src/ui/labels.ts` and storage only; `Plan.roles` snapshots roles at
creation. Tests: role-rename invariance property, roleOrder unit test, all-custom-roles
platoon, planner test that no post/role name reaches the solver.

## 2.6 — Per-soldier history
**Status (done):** display only, never fed back into the solver (decision with the user).
New tab "נתונים": per soldier day guard, night guard (00:00–06:00), rest (= time in the field
without guarding), home time and shift count — per activity or summed over all activities.
Counts only what actually happened up to now; a shift in progress counts its elapsed part.
Storage: Dexie v2 table `activities`. Creating a new activity archives the current one if
it started (`closedAtMinute`, name snapshot); if they overlap in time, the new one counts
from the replacement moment (`Plan.countFromMs`) so nothing is counted twice. Past
activities can be deleted from history. Logic in `src/ui/history.ts` with unit tests.
Session 3's fairness screen should build on this tab rather than add another one.

## 3 — Fairness and transparency
Fairness screen (hours, nights, deviation per soldier), presets (Balanced / Protect sleep /
Strict equality) and plain-language sliders, certificate ("proven optimal" badge), pre-flight
warnings (role bottleneck, night trap, rest impossible).


**Status (done):** night-weight presets (מאוזן ×1.5 / שמירה על שינה ×2 / שעה היא שעה ×1)
plus a ×1–×3 slider on the activity screen, saved in `ActivitySettings.nightWeight` and passed
to the solver. Rest stays on its own chips. Live pre-flight preview: the would-be plan is
solved in the worker (debounced 300 ms) and shown as plain-Hebrew notices — certificate
("proven optimal", or "best possible but below target", or "below the upper bound"), load
spread, shortages, ROLE_BOTTLENECK (with the role's name), REST_DEBT, NIGHT_TRAP — ordered
by cause. Board shows the certificate and warnings. "נתונים" tab has a second view,
"מתוכנן": weighted load, deviation from fair share, nights, min rest, shifts for the current
activity. Helpers in `src/ui/fairness.ts` (tested); `src/ui/FairnessPanel.tsx`.

## 3.1 — Ledger and carry-over (D7)
**Status (done):** contract change — `SolverInput.history` (`SoldierHistory`), solver seeds its
state from it, stats stay per-schedule, verifier checks `busyUntil` and first-rest debt against
history. Claim 5′ added. App: `src/ui/ledger.ts` (fold a replaced board into ledgers, running
shift folded whole and kept busy; fair share proportional to field time; `toHistory`;
`soldierNow` for display). Platoon page shows day / night / rest / home / load per soldier and
a "reset load" button (with confirm). The separate "נתונים" tab and multi-activity history were
removed (decision with the user); the Dexie `activities` table is left unused.
Tests: two-part solve = one solve, Claim 5′ bound, busy/rest from history, ledger unit tests.

## 3.2 — Board score and "why him?"
**Status (done):** `boardScore()` in `src/ui/fairness.ts`: per soldier distance from fair
share before the board (from `plan.history`), weighted hours on the board, expected distance
when it ends; gap (max − min) before → after. Shown on the board and in the live preview
(`BoardScore.tsx`). Every shift row has "למה?": `explain()` (ALGORITHM.md §4.6) replays the
exact solver input stored in `plan.input` and lists every soldier with status, rank, rest
and distance from fair share (`WhySheet.tsx`). Tests: explanation agrees with the schedule,
best-ranked are chosen, score arithmetic.

## 3.3 — Post weight and free shift lengths
**Status (done):** contract change — `Shift.weightFactor` (post difficulty) multiplies the shift
weight; seat cost `(rank + 1) × weightClass` gives heavier seats to the best-ranked soldiers;
Claim 5 extended to different weights in one group (proof in ALGORITHM.md). Verifier, oracle
and helpers use the factor. UI: per post "קלה / רגילה / קשה" plus a ×0.5–×2 slider; shift and
night-shift length as hour chips or free minutes (15-minute steps). Ledger and live stats
count weighted guard with the factor. Test: post-weight Claim 5 property (fails without
weight-aware seats), generator test for 90-minute shifts and weightFactor.

## 3.4 — Month-scale test
`tests/scale/month.test.ts`: 30 soldiers (4 commanders, 3 medics), 5 posts (one hard, one
easy, one night-only, one daytime medic), 4 h day / 2 h night, rest 4 h, home-leave rotation,
30 days, once as one board and once replaced on day 15 with history. Measured: all 1,476 seats
filled, ~0.1 s, min rest 2 h proven optimal (commander bottleneck), weighted gap within each
group of interchangeable soldiers ≤ one shift, the two-board run identical to one board.
Known weakness held as a ceiling: night-hours gap among plain soldiers 18 h.

## 3.5 — Backup (next version, requested)
Data lives only in the app's own storage on the phone. Deleting the home-screen icon or
moving to a new phone loses it. Add:
- **Export:** one JSON file with soldiers, roles, settings, current plan and history
  (`activities`), shared via the system share sheet (save to Files, send to self).
- **Import:** pick the file → preview (how many soldiers / activities) → replace or merge.
  Validate the format and version; never partially import a broken file.
- A gentle reminder on the stats tab if no backup was made in the last 14 days.
- Tests: export → import round-trip is lossless; old files still import after a version bump.

## 5 — Launch
README (Hebrew + English) with GIF, PROOF.md (Claims 4–5 + certificate, accessible language),
GitHub Pages deploy, GitHub Actions CI, oracle stats for the post. See `LAUNCH.md`.
