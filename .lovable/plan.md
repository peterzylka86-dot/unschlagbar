## 1. Localized CTA button (per league)

Landing page stays English ("Kick-off"). Once a league is picked, the action button in `src/routes/game.tsx` and `src/routes/draft.tsx` uses each league's native shout (already wired through `league.kickoffWord`).

Restore in `src/lib/leagues.ts`:

| League | kickoffWord |
|---|---|
| Bundesliga | Anpfiff |
| La Liga | ¡Vamos! |
| Serie A | Forza! |
| Swiss Super League | Hopp Schwiiz! |
| Champions League | Kick-off |
| World Cup | Kick-off! |
| Women's Elite | Kick-off! |

No component changes needed — the button already reads `league.kickoffWord`.

## 2. Group-stage elimination → no KO stage played

The simulator (`src/lib/sim.ts` → `simulateKnockout`, lines 154-165) already marks the final group match with `eliminates: true` and breaks the loop when the points threshold isn't met. Thresholds stay as-is:
- **Champions League** (6 group matches): ≥ 7 pts to advance
- **World Cup** (3 group matches): ≥ 4 pts to advance

### What I'll verify / harden

1. **Confirm the loop break actually prevents KO matches from being simulated** — re-read `simulateKnockout` end-to-end and make sure no KO opponents are appended to `results` after `eliminated = true`. (Looks correct, will double-check.)
2. **Season view stops at the eliminating match** — `src/routes/season.tsx` reveals `matches.length` results; since the sim returns a short array on elimination, the reveal naturally stops at the group stage. Verify no KO round headers render when those rounds were never played.
3. **Result screen shows "Eliminated · Group"** — already implemented in `src/routes/result.tsx` (lines 75-77). I'll just tighten the copy so it reads e.g. *"Eliminated in the group stage · 5 pts from 6 matches"* for CL, and *"Eliminated in the group stage · 2 pts from 3 matches"* for WC, so the reason is unambiguous.
4. **Bracket view** in `src/routes/season.tsx` — currently renders all rounds from `league.rounds`. When eliminated, the KO bracket slots should be visibly greyed-out / marked "—" rather than empty, so it's clear those matches were never played.

### Files touched

- `src/lib/leagues.ts` — restore native `kickoffWord`s only
- `src/routes/result.tsx` — clearer group-exit copy with pts tally
- `src/routes/season.tsx` — grey-out unplayed KO bracket slots after elimination
- `src/lib/sim.ts` — read-only verification; edit only if the early-exit isn't airtight

No data, no league-config schema changes.