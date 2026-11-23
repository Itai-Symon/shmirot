# Build plan

Each session starts cold. It reads `CLAUDE.md`, this file and `ALGORITHM.md`, does only its
own goal, and ends with green tests and a commit. Update the status column when done.

| # | Session | Depends on | Status |
|---|---|---|---|
| 0 | Contract: decisions, ALGORITHM.md, types.ts, repo skeleton | — | ✅ done |
| 1A | Solver | 0 | ✅ done |
| 1B | Verifier + oracle + property tests + edge cases | 0 | ✅ done |
| 1C | UI with fake solver | 0 | ✅ done |
| 2 | Integration (real solver in Web Worker, all tests green) | 1A, 1B, 1C | ⬜ |
| 3 | Fairness screen, sliders/presets, certificate, pre-flight warnings | 2 | ⬜ |
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

## 3 — Fairness and transparency
Fairness screen (hours, nights, deviation per soldier), presets (Balanced / Protect sleep /
Strict equality) and plain-language sliders, certificate ("proven optimal" badge), pre-flight
warnings (role bottleneck, night trap, rest impossible).

## 5 — Launch
README (Hebrew + English) with GIF, PROOF.md (Claims 4–5 + certificate, accessible language),
GitHub Pages deploy, GitHub Actions CI, oracle stats for the post. See `LAUNCH.md`.
