# LAUNCH.md — read this before sharing

## ⚠️ Reminder to myself before posting

The idea can easily sound like **a bitter soldier who doesn't trust his friends** and wants
everything split to the minute. That is not the message.

- **Not distrust:** after two weeks in the field nobody remembers who did two nights and who
  covered an extra hour, and nobody should have to. The math remembers for everyone, so
  friends can just be friends. In a long deployment, let the math take care of equality.
- **Not a replacement for people who like scheduling:** if your platoon's scheduler enjoys
  doing it with pen and paper, great, keep going. This is for the soldiers who would rather
  spend that time resting, playing or sleeping.
- **There is always a schedule:** like real life, when there aren't enough people, someone
  gives a bit more time, and the app records it so it is returned later.

## Messages to land
1. Real problem, seen first-hand in reserve duty.
2. Under 60 seconds from opening the app to a list in the WhatsApp group.
3. Fully offline, nothing leaves the phone. Custom post and role names, with a built-in
   reminder to keep locations and unit details out. Demo with neutral names ("עמדה 1", "שומר").
4. **Provably fair:** short, readable proofs (PROOF.md) plus a "proven optimal" badge on
   the schedule itself. Fill in real numbers from the oracle run:
   "On X random cases the algorithm matched the true optimum in Y%, and the worst gap was Z."
   First baseline (session 2, 100 small random instances): minimum rest matched the
   brute-force optimum in 88% of comparable cases, load balance in 82%, and coverage in
   every aligned case (proven) and 92% of misaligned ones. Quote carefully: each figure
   compares to the best possible schedule for that one metric.
   Re-run 2026-11-24 on 1,000 instances (seeds 3001, 11, 12, 13): coverage 100% aligned,
   94.6% misaligned (worst gap 2 seats); min rest exact 88.4%, within 1 h 90.4%, worst 12 h;
   load spread exact 83.0%, within 1 h 89.9%, worst 12 h. Not covered: task difficulty and
   per-task rest (checked by their own property tests).
5. **Light:** 180 KB for the whole app (less than one photo), works in airplane mode, a week
   for 30 soldiers is scheduled in ~10 ms. Numbers and method in PERFORMANCE.md.
6. Open source, link to the repo and live demo.

## Draft openings (Hebrew)
- "במילואים האחרונים ראיתי מפקד יושב עם דף ועט ב-2 בלילה, מנסה לוודא שאף אחד לא מקבל שני לילות ברצף. בניתי לזה פתרון."
- "זה לא כי אנחנו לא סומכים אחד על השני. זה כי אחרי שבועיים בשטח אף אחד לא זוכר מי עשה מה, וגם לא צריך לזכור."
- "מי שאוהב לשבץ — שימשיך. זה בשביל מי שמעדיף לישון."

## Checklist
- [ ] Demo uses invented names only
- [ ] Live demo link works offline after first load
- [ ] PROOF.md reviewed
- [ ] Oracle numbers re-checked (first baseline filled in above)
- [ ] GIF in README
