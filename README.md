# שמירות · Shmirot

**מחלק שמירות הוגן, שעובד בלי אינטרנט, עם הוכחה מתמטית.**
An offline, provably fair guard-duty scheduler for platoons.

> 🚧 Under construction. See [SESSIONS.md](SESSIONS.md) for progress.

## Why
In reserve duty, guard rosters are still made with pen and paper. It takes time, it is hard
to keep fair over weeks, and every change (someone goes home) means starting over.

## What it does
1. Enter your platoon once (names and roles only).
2. Start an activity: number of posts, who each post needs, shift length, rest target.
3. Get a fair schedule instantly, copy it to WhatsApp, re-plan from "now" when things change.

- **Offline & private:** runs on your phone, nothing leaves the device. Posts are numbered —
  no locations or unit details can be entered.
- **Always a schedule:** when there aren't enough people, rest is shortened as evenly as
  possible and recorded as debt to be paid back.
- **Provably fair:** see [ALGORITHM.md](ALGORITHM.md) for the algorithm, proofs and test plan.

## Develop
```bash
npm install
npm run dev     # local dev server
npm test        # unit, property and oracle tests
npm run build
```

## License
MIT
