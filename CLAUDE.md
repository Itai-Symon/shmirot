# CLAUDE.md — working rules for this repo

Shmirot is an offline, provably fair guard-duty scheduler for platoons (PWA).

## Source of truth
- `ALGORITHM.md` is the contract. Read it before touching `src/solver`, `src/verifier` or `tests`.
- `src/solver/types.ts` is the code-level contract. Changing it is a contract change:
  update `ALGORITHM.md` in the same commit and say so in the commit message.
- `SESSIONS.md` lists the build plan. Each session has one goal and a definition of done.
  Read it to know what is in scope for the current session; do not do other sessions' work.

## Hard rules
- **Privacy (D6):** the only free-text input anywhere is soldier names. No text fields for
  posts, locations, unit names, roles or notes. Posts are numbered. Roles come from `ROLES`.
  No network calls, no analytics, no external fonts at runtime. All data stays in IndexedDB.
- **Independence:** `src/verifier/` and `tests/oracle/` must never import from `src/solver/`
  except `types.ts`.
- **Determinism:** the solver must not use `Math.random`, `Date.now`, or iteration order of
  objects/sets for decisions. Ties are broken exactly as in ALGORITHM.md §4.4.
- **The solver is pure:** no DOM, no React, no storage. Times are integer minutes.
  Wall-clock/DST handling lives only in the shift generator.

## Stack
Vite + React + TypeScript (strict) + vite-plugin-pwa, Dexie (IndexedDB), Vitest + fast-check.

## Conventions
- UI language: Hebrew, `dir="rtl"`. All UI strings in `src/i18n/`. Code, comments, commits: English.
- Folders: `src/solver`, `src/verifier`, `src/storage`, `src/ui`, `src/i18n`,
  `tests/properties`, `tests/oracle`, `tests/edge-cases`.
- Demo data and screenshots use invented names only.

## Definition of done for every session
1. `npm test` green, `npm run build` green.
2. Docs touched by the change updated (`ALGORITHM.md`, `SESSIONS.md` status).
3. One focused commit (or a few) with a clear message.
