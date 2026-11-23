# Shmirot — Algorithm Contract

This document is the single source of truth for the scheduling algorithm.
The solver (`src/solver/`), the independent verifier (`src/verifier/`) and all
tests (`tests/`) are written against **this document**, not against each other.
If code and this document disagree, the document wins until it is changed on purpose.

Status markers used below:
- **[PROVEN]** – full proof in this document.
- **[SKETCH]** – proof sketch; additionally enforced by oracle / property tests.
- **[TESTED]** – no proof claimed; behaviour is measured against a brute-force oracle.

---

## 1. Locked product decisions

| # | Decision | Choice |
|---|---|---|
| D1 | Fairness for a soldier who was away (home leave) | Measured **relative to presence**: a soldier only accrues a fair share while present (see §4.3). Returning soldiers do not "catch up" on hours they missed. |
| D2 | Night weight default | Hours inside **00:00–06:00** wall-clock count **×1.5** (adjustable, `nightWeight`). |
| D3 | Rest vs. hours balance | **Rest first.** A rested soldier is always preferred over a tired one, regardless of hours. Hours balance is the second criterion. |
| D4 | Avoid fixed pairs in a post | **Not in v1.** |
| D5 | Infeasibility | **There is always a schedule.** Rest is a target, not a hard rule. The only hard rules are physical: no one assigned while absent, no one in two places at once, roles only filled by qualified soldiers. Unfillable slots are reported as *shortages*. |
| D6 | Privacy | The only free text in the whole app is soldier names. Posts are numbered (`עמדה 1`, `עמדה 2` …). Roles come from a fixed list. No locations, unit names or notes. All data stays on the device. The solver itself never sees names, only ids. |

---

## 2. Glossary

- **Activity (פעילות)** – one deployment / rotation. Has a start, an end and a set of posts.
- **Post (עמדה)** – a numbered guard position with a staffing pattern.
- **Shift (משמרת)** – one concrete time interval at one post, with role requirements.
- **Slot** – one seat in a shift that needs one soldier of a given role.
- **Rest** – for two consecutive shifts of the same soldier: `start(next) − end(prev)`.
- **Weight** of a shift – `dayMinutes + nightWeight × nightMinutes`.

All times inside the solver are **integer minutes since activity start** (real elapsed
time). Converting wall-clock times (including DST transitions and midnight crossings)
into minutes is done **outside** the solver by the shift generator, which also
precomputes `nightMinutes` for each shift. The solver never touches dates.

Intervals are half-open: `[start, end)`.

---

## 3. Input / Output

The exact TypeScript types live in `src/solver/types.ts`. Conceptually:

### Input
1. **Soldiers** `s₁ … s_N`, each with:
   - `roles` – non-empty set of qualifications from the fixed list
     (`commander`, `soldier`, `medic`, `signaler`, `driver`).
   - `absences` – list of intervals when the soldier is not in the field.
2. **Shifts** `j₁ … j_M`, each with `start`, `end`, `postIndex`, `nightMinutes`
   and `requirements: role → count` (e.g. `{commander: 1, soldier: 1}`).
3. **Params**
   - `minRestMinutes` (R) – the rest target.
   - `nightWeight` (α) – default 1.5.
4. **Locked assignments** – (shift, soldier, role) triples of shifts that have
   **already started** at re-planning time ("from now"). A lock is a fact, not a
   choice: it is kept even if it violates rest, and even if it no longer satisfies a
   hard rule because the data changed afterwards (a role removed, an absence entered
   retroactively). The verifier reports such cases; the solver keeps them.
   The caller sets the requirements of an already-started shift to what was actually
   filled (i.e. to its locks), so the solver never fills seats in the past and does not
   re-report historical shortages. Manual pins of future shifts are out of scope for
   v1 (§9).

### Output
1. **Assignments** – for every shift, which soldier fills which role slot, and for
   each assignment the rest debt it caused (`max(0, R − rest)`).
2. **Shortages** – (shift, role, missing count) for slots that could not be filled.
3. **Per-soldier stats** – weighted load, fair share, deviation, shift count, night
   minutes, minimum rest, total rest debt.
4. **Certificate** – achieved minimum rest vs. a proven upper bound (§6).

The output must be **deterministic**: same input ⇒ byte-identical output.

---

## 4. The algorithm

### 4.1 Core idea in one sentence

Process shifts in time order; for each shift, fill its role slots with the
soldiers who are **rested**, and among those, who are **furthest below their fair
share** of the work — using a matching so that scarce roles are never wasted.

When everyone is present and there is a single role, this is exactly a round-robin
queue (§5, Claim 4).

### 4.2 State per soldier

| Field | Meaning | Initial |
|---|---|---|
| `load` | weighted minutes guarded so far | 0 |
| `fairShare` | weighted minutes this soldier *should* have guarded, given presence | 0 |
| `lastEnd` | end time of the soldier's last shift | −∞ |
| `busyUntil` | end of the shift currently being guarded | −∞ |

`deviation = load − fairShare` (negative = owes nothing, should guard next).

### 4.3 Fair share (decision D1)

When a shift `j` is assigned, let `present(j)` be the soldiers who are not absent at any
moment of `[start_j, end_j)`. Let `F_j` be the number of slots actually filled. Then for
every `s ∈ present(j)`:

```
fairShare[s] += weight(j) × F_j / |present(j)|
```

Absent soldiers accrue nothing, so on return they are compared fairly against
soldiers who were there. When nobody is ever absent, all fair shares are equal and
ordering by deviation is identical to ordering by load.

### 4.4 Steps

```
INPUT: soldiers, shifts, params (R, α), locked

1. Sort shifts by (start, postIndex, id).
2. Locked assignments are applied interleaved in time, not up front (a pin in the
   future must not move lastEnd/busyUntil into the future). They are kept even if
   they violate rest (their debt is reported). A shift may be partly locked: its open
   seats per role are `requirement − locked` and are filled by the matching below.
3. Group the shifts by identical start time. For each group G, in order:

   0. Commit the locked assignments of G's shifts (in shift order, then ROLES order,
      then soldier id), updating load, lastEnd, busyUntil exactly as in step e.

   a. AVAILABLE(s, j) ⇔ s not absent during [start_j, end_j)
                      ∧ busyUntil[s] ≤ start_j
                      ∧ s not already used in another shift of G
                      ∧ s has no locked assignment in a not-yet-processed shift
                        that is j itself or overlaps j.

   b. Candidate cost of soldier s for a slot of role r in shift j ∈ G
      (only if r ∈ roles(s) and AVAILABLE(s, j)):

        rest(s, j) = start_j − lastEnd[s]
        tier       = 0 if rest ≥ R else 1                    (D3: rest first)
        key        = tier 0: (deviation[s], −rest, nextAbsenceStart[s], id)
                     tier 1: (−rest, deviation[s], nextAbsenceStart[s], id)

      Candidates of G are ranked by (tier, key) lexicographically; the rank is
      the cost. Lower is better.

   c. JOINT MATCHING (prevents wasting scarce roles):
      Build a bipartite graph:
        left  = all role slots of G
              + all role slots of not-yet-assigned shifts that overlap any shift
                in G ("lookahead slots", cost 0, used only for feasibility),
        right = soldiers,
        edge  = soldier qualified for the slot's role and available for its shift.
      Each soldier takes at most one slot of the whole graph (a matching).
      Objective, lexicographic:
        1. maximise the number of filled slots (G + lookahead);
        2. among those, maximise the number of filled slots of G
           (never leave a seat of G empty to fill a lookahead seat);
        3. among those, minimise the total cost (rank sum) of G's slots.
      Implemented as MIN-COST MAXIMUM matching (successive shortest paths) with
      lookahead edges costing BIG = |G slots| · |candidates| + 1 instead of 0.
      By the transversal-matroid exchange property, (1) never reduces (2).

      TIE-BREAK among matchings that are optimal for 1–3: take the candidates in
      rank order; each takes the earliest slot of G (shifts in (postIndex, id) order,
      then roles in ROLES order) such that the optimum is still reachable with all
      choices made so far; if no slot qualifies, the soldier takes no slot of G.
      (Ids are compared by UTF-16 code units, never locale-dependent.)
      COMMIT only the slots of G.

   d. Slots of G left unfilled ⇒ report shortage (shift, role, missing).

   e. For each committed (s, j):
        restDebt = max(0, R − rest(s, j))   (0 if s had no previous shift)
        load[s]  += weight(j)
        lastEnd[s] = busyUntil[s] = end_j
      Then for each j ∈ G apply the fair-share update (§4.3).

4. Compute stats and the certificate (§6). Return.
```

`weight(j) = (end_j − start_j − nightMinutes_j) + α × nightMinutes_j`.

`nextAbsenceStart[s]` – start of the soldier's next absence after `start_j`
(∞ if none). Preferring soldiers who leave soon uses them before they go.

`F_j` in the fair-share update counts all filled seats of j, locked ones included.

**Warnings produced by the solver (v1).** `REST_DEBT` when at least one assignment
(locked or not) has `restDebt > 0`; details: `assignments` (count), `totalMinutes`,
`maxMinutes`.

`ROLE_BOTTLENECK` (per role r): the rest target R cannot be met for holders of r in **any**
schedule. Test (§6 restricted to one role): for some shift start t, the r-seats of all
shifts whose extended interval `[start, end + R)` contains t outnumber the soldiers who are
qualified for r and present for at least one of those shifts. Details: `qualified`,
`needed`, `at` (the worst t). Computed from the input only, so the UI can also show it
before generating.

`NIGHT_TRAP`: the produced schedule repeats every 24 h, i.e. the same soldiers guard the
same hours every day (e.g. always 02:00–04:00). Test: shift starts span ≥ 24 h, and every
assignment (s, j) with `start_j + 24 h ≤ last start` has s also assigned to a shift
starting exactly 24 h later. Details: `periodMinutes`, `nightSpreadMinutes`. Claim 4's
corollary says it is unavoidable when slack is zero; when slack exists, v1 still warns
(rotating to avoid it is future work, §9).

### 4.5 Why a matching and not "pick the K best"

Example: a shift needs `{commander: 1, soldier: 1}`. Available: Dani (commander,
soldier, low load) and Yossi (soldier). Greedy "lowest load first" may give Dani the
`soldier` slot and leave the `commander` slot empty. The matching fills both. The
lookahead slots extend the same protection across posts whose shifts overlap but start
at different times.

---

## 5. Correctness claims

Notation: N soldiers, K slots per shift, L shift length, R rest target,
r = ⌈R / L⌉ in the uniform setting.

**Uniform setting**: one role that every soldier has, every shift has length L,
shifts are back-to-back, every shift needs K soldiers, nobody is absent, no locks.

### Claim 1 — Always outputs a schedule. [PROVEN]
Every shift group is processed exactly once and no step can fail: unfilled slots
become shortages instead of errors. ∎

### Claim 2 — Every output is physically valid. [PROVEN]
No soldier is assigned while absent, no soldier is in two overlapping shifts, every
slot is filled by a soldier qualified for its role. Directly enforced by the edge
conditions in step 3a–3c. Independently re-checked by the verifier on every output. ∎

### Claim 3 — Shortages only when unavoidable. [SKETCH]
A slot of shift j is reported short only if, given the locked/committed past, there is
no way to fill all slots of the shifts active at `start_j` with the soldiers present.
*Sketch:* earlier groups committed a part of a maximum matching that already contained
j's slots as lookahead, so j's slots remained fillable at every step; at j's own step
the matching maximises filled slots again. By the max-flow / min-cut theorem (Hall's
condition) a maximum matching that leaves a slot empty certifies that no assignment
fills it. *Enforced by:* the verifier on every output.

**Global coverage — aligned schedules. [PROVEN]** Call a schedule *aligned* if any two
overlapping shifts are the identical interval (all posts change guard together). Then
groups never overlap, rest is soft (D5), so each group's coverage depends only on who is
present then. Each group is solved by a maximum matching, so total coverage is the global
maximum. *Enforced by:* oracle (Layer C) requires equality on aligned instances.

**Global coverage — misaligned schedules. [TESTED]** Not claimed. Processing shifts in
time order can commit a soldier to a long shift that blocks several shorter ones later
(one soldier, post A 60–300, post B 90–210 / 210–330 / …: taking A covers 1 seat where B
could have covered 2). Exact global coverage with overlapping intervals, roles and
absences is a hard combinatorial problem and no efficient exact method is claimed. The
gap to the oracle is recorded in the baseline and may not grow.

### Claim 4 — Optimal rest in the uniform setting. [PROVEN for round-robin; SKETCH that the solver equals round-robin]

(a) **Upper bound.** In any schedule, consider `g = ⌊N/K⌋ + 1` consecutive shifts.
They need `gK > N` assignments, so by pigeonhole some soldier guards twice inside
those g shifts, and therefore rests at most `(⌊N/K⌋ − 1) · L`.

(b) **Round-robin achieves it.** Put soldiers in a queue; shift t takes queue positions
`tK … tK+K−1 (mod N)`. A soldier's consecutive appearances are N positions apart, so
their shift indices differ by at least `⌊N/K⌋`, giving rest `≥ (⌊N/K⌋ − 1) · L`.

(c) **Balance.** In round-robin every prefix gives each soldier either ⌊a/N⌋ or
⌈a/N⌉ shifts (a = assignments so far): counts differ by at most 1.

(d) **Solver = round-robin.** In the uniform setting all fair shares are equal, so the
key is (tier, load, −rest, id). Inductively the K soldiers with lowest load and, among
equal loads, earliest `lastEnd`, are exactly the next K in queue order. *Enforced by:*
property test asserting achieved min rest equals `(⌊N/K⌋ − 1) · L` exactly.

**Corollary (feasibility).** With everyone present, the rest target R can be met
**iff** `N ≥ K · (r + 1)`. Otherwise the solver still schedules (D5) and the debt is the
minimum possible.

**Corollary (night trap).** If `N = K · (r + 1)` there is zero slack: every window of
r+1 shifts uses every soldier exactly once, so the schedule is periodic with period
`(r+1)·L`. If that period divides 24 h, **the same soldiers get the same night hours
every day, and no valid schedule avoids it.** The UI must warn about this case.

### Claim 5 — Hours balance. [PROVEN under conditions]
**Conditions:** the schedule is aligned (Claim 3), every soldier qualifies for every
required role, nobody is absent, and rest never excludes a candidate (R = 0).
*Why each condition is needed:* misaligned shifts make some soldiers busy when a group
starts, so the lowest-loaded may be unavailable; with R > 0, rest-first (D3) skips a
lowest-loaded soldier who is still resting. Both were observed to break the bound in
property tests. Aligned shifts at one start time share the same interval and therefore
the same weight, which the proof uses.
**Statement:** at all times, `max load − min load ≤ w_max`, where `w_max` is the largest
shift weight.
*Proof (induction).* Initially all loads are 0. Assume `max − min ≤ w_max` before a
shift of weight `w ≤ w_max` is assigned to the k lowest-loaded soldiers. Let `ℓ_k` be the
k-th lowest load. Each chosen soldier ends at `≤ ℓ_k + w`; every unchosen soldier has
load `≥ ℓ_k`; the minimum never decreases. If the new minimum is an unchosen soldier,
new max − new min ≤ `max(old max − old min, w) ≤ w_max`. If it is a chosen soldier
(old load m, now m + w), the new max is `≤ max(old max, ℓ_k + w)`, and
`ℓ_k + w − (m + w) = ℓ_k − m ≤ old max − old min ≤ w_max`. ∎

When conditions fail (scarce roles, absences, rest pressure) no closed-form bound is
claimed; behaviour is measured against the oracle (§8 Layer C).

---

## 6. Certificate of optimality (shown in the UI)

**Upper bound on achievable minimum rest.** For a candidate rest value X, extend every
shift to `[start, end + X)`. If two shifts of the same soldier both contain a point t
after extension, then the later one starts before the earlier one ends plus X —
i.e. rest < X. So in any schedule with minimum rest ≥ X, all slots of shifts whose
extended intervals share a point need **distinct** soldiers.

```
feasible(X) ⇔ for every point t, the slots of all shifts whose extended interval
              contains t can be filled by a matching of distinct qualified soldiers
              present for their shift (a locked (shift, soldier, role) also counts
              as allowed, so the produced schedule always witnesses
              feasible(achieved) and achieved ≤ UB holds even with locks that
              break a rule in hindsight).
UB = max X such that feasible(X)          (monotone ⇒ binary search over minutes)
```

`feasible` is a necessary condition, so **UB is a valid upper bound** for every possible
schedule [PROVEN]. The certificate reports `achieved` (min rest over all consecutive
shift pairs of all soldiers) and `UB`. If `achieved = UB`, the schedule is **proven
optimal** for minimum rest. The certificate is only computed when there are no
shortages; otherwise it reports `n/a`. `provenOptimal` is `false` whenever the
certificate is `n/a` or `achieved` is `null`.

In the uniform setting `UB = (⌊N/K⌋ − 1) · L`, matching Claim 4.

---

## 7. Complexity

| Part | Cost |
|---|---|
| Sort shifts | O(M log M) |
| Per group: ranking candidates | O(N log N) |
| Per group: min-cost matching (s slots incl. lookahead, N soldiers) | O(s² · N) with successive shortest paths; s ≤ ~12 in practice |
| **Total solver** | **O(M · (N log N + s² N))** |
| Certificate: binary search × sweep × matching | O(log(H) · M · s² N) |
| Memory | O(N + M) |

Practical scale: 30 soldiers, 7 days, 3 posts, 2 h shifts ⇒ 252 shifts ⇒ well under
10 ms on a phone. The solver runs in a Web Worker and is re-run on every settings change.

---

## 8. Test plan

### Layer A — Verifier (runs on every output in every test)
Independent code (does **not** import from `src/solver/`). Checks Claim 2, the shortage
condition of Claim 3 (with its own matching), determinism, and that reported stats
(loads, rests, debts) are recomputed correctly from the assignments.

### Layer B — Property-based tests (fast-check)
- Uniform setting ⇒ achieved min rest **equals** `(⌊N/K⌋ − 1) · L` and certificate says optimal.
- Uniform setting ⇒ shift counts differ by ≤ 1.
- Claim 5 conditions (aligned, all roles, no absences, R = 0) ⇒ `max load − min load ≤ w_max`.
- Certificate: `achieved ≤ UB` always.
- Permuting soldier order in the input does not change the multiset of per-soldier stats.

### Layer C — Brute-force oracle (the "optimality bar")
For small instances (≤ 6 soldiers, ≤ 10 shifts) enumerate all schedules and compute:
max coverage, best min rest, best load spread. Assert:
- coverage equals the oracle on every **aligned** instance (Claim 3);
- on misaligned instances the coverage gap is recorded;
- min-rest gap and load-spread gap are recorded on instances where the solver reaches the
  oracle's coverage (otherwise they are not comparable);
- the suite fails if any recorded gap distribution (coverage, rest, spread) gets worse
  than the committed baseline (`tests/oracle/baseline.json`). The algorithm can only improve.

### Layer D — Fixed edge cases (`tests/edge-cases/`)

| Case | Expected |
|---|---|
| `N = K(r+1)` exactly | min rest exactly R; night-trap warning if period divides 24 h |
| `N < K(r+1)` | schedule produced; debt spread evenly (spread ≤ one shift) |
| Night trap (period divides 24 h) | warning flag set |
| Single commander, post needs commander 24/7 | pre-flight warning; schedule still produced |
| Commander goes home mid-activity | precise shortage `commander`, no crash |
| Entire platoon absent | all shortages, no error |
| Shift crossing midnight | rest computed correctly |
| DST transition day | shift generator yields no missing / duplicate hour |
| Posts with misaligned shift boundaries | no double booking; Claim 3 holds |
| Soldier returns mid-shift | not assigned to a shift already started |
| Locked shifts violating rest | kept; debt reported |
| Zero soldiers / zero shifts / requirement 0 | empty output, no error |

---

## 9. Out of scope for v1
- Pair diversity (D4).
- Per-soldier time preferences ("not before 06:00") — next version, as soft cost.
- Multi-device sync (export/import file and QR only).
- Rotating the night trap away when slack exists (v1 only warns).
- Weight-aware seat choice: when shifts of different weights start together (misaligned
  posts), the matching cost ranks soldiers but ignores which seat is heavier.
- Manual pins of future shifts. The solver already applies locks interleaved in time
  and keeps a pinned soldier out of overlapping shifts (§4.4 step 2, 3a), but v1 has no
  UI for it and the contract only defines locks of already-started shifts (§3).
