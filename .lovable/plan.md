## Goal

Make positions strict (RB only fills RB, CB only CB, LB only LB — and same for every other position) and expand the player database so every club has enough coverage that the draft never gets stuck.

## 1. Strict position matching

In `src/routes/draft.tsx`, simplify `isCompatible` to exact match only:

```ts
function isCompatible(slotPos: Position, playerPos: Position): boolean {
  return slotPos === playerPos;
}
```

This affects:
- Wheel filtering (`clubHasCompatible`, `spinClub`)
- Tier validation (`tierClubs`)
- Slot-targeting on assign

No other logic changes — the existing helpers already route through `isCompatible`.

## 2. Player database expansion

Today's gaps (every club must have ≥1 of each of: GK, CB, RB, LB, CDM, CM, CAM, RW, LW, ST):

- 55 of 56 clubs have at least one missing or thin (only 1) position
- Worst offenders: smaller/historic clubs (uerdingen, rotweissessen, saarbruecken, tasmania, hansa, dynamodresden, duisburg, meidericher, bremerhaven, offenbach, aachen, wattenscheid, ulm, paderborn, unterhaching, fürth, ingolstadt, sandhausen, homburg, blauweiß 90, stuttgarter kickers, wuppertaler, tennis borussia, viktoria, vfb leipzig, braunschweig, bielefeld) — most have 13–20 players and several missing positions
- Big clubs also have gaps split across eras (e.g. Frankfurt missing LB, Stuttgart missing RW)

### Expansion target

- **Big multi-era clubs** (bayern, dortmund, leverkusen, frankfurt, stuttgart, gladbach, werder, hamburg, schalke, köln, kaiserslautern, hertha, nürnberg, bochum, 1860, hannover): bring each up to ~20 per active era_tier, ensuring all 10 positions covered per era.
- **Single-era modern clubs** (leipzig, union, augsburg, mainz, hoffenheim, freiburg, wolfsburg, heidenheim, darmstadt, st pauli, paderborn, ingolstadt, fürth, sandhausen, cottbus, hansa, etc.): bring each to ~20 with all 10 positions.
- **Small historic clubs** (uerdingen, rotweissessen, saarbrücken, tasmania, duisburg, meidericher, bremerhaven, offenbach, aachen, wattenscheid, ulm, unterhaching, homburg, blauweiß 90, stuttgarter kickers, wuppertaler, tennis borussia, viktoria, vfb leipzig, braunschweig, bielefeld, dynamodresden): bring each to ~15–20 with all 10 positions covered (real historical squad members from their notable era).

All new entries use authentic players from the appropriate decade for that club's `era_tier`. Ratings stay in the existing 65–95 scale, consistent with current entries for that club tier.

### Safety net

Even with expansion, keep one defensive guard in `spinClub`: if after filtering by tier + position there are zero compatible clubs left, surface a clear "no compatible clubs remaining — reroll required" state instead of silently spinning forever. (Current code already filters; this just makes the empty case explicit so the bug from earlier turns can't reoccur if a niche position runs out late in a draft.)

## 3. Out of scope

- Tier names stay: current / 00s / 90s / 70s-80s
- No changes to UI, formation, or match logic

## Files touched

- `src/routes/draft.tsx` — strict `isCompatible`, explicit empty-pool guard
- `src/data/players.json` — large batch of additions (target ~+400–600 entries)
