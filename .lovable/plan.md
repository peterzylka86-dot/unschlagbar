# Fix bugs + polish 34-0

## 1. Auto-spin after each pick (draft bug)

Right now: pick a player → `setCurrentClub(null)` drops you back to the wheel panel and you have to press **Spin** again. With 11 picks that's 11 extra clicks.

Fix in `src/routes/draft.tsx`:
- After `commitToSlot` / `positionFirstPickPlayer`, if there are still empty slots, automatically call `spinClub()` once the assign UI closes.
- Brief 600 ms "Next club…" transition state so the wheel re-spin feels intentional, not jumpy.
- Keep manual **Spin** only for the very first pick and for rerolls.

## 2. Season doesn't stop at gameday 5 anymore

Right now `season.tsx` halts the reveal at the first non-win, so a loss on matchday 5 freezes the grid at 5/34 — that's what you saw.

Fix:
- Always reveal all 34 matchdays (faster cadence ~220 ms).
- Mark the first non-win as the **"streak broken"** card with a red flash + divider; matches after it render dimmer ("dead rubber") so it's clear the run ended but you still see the full season.
- Header tally keeps counting through all 34 matches.
- Result screen still uses `unbeaten = no losses && no draws` as before.

Also rebalance `sim.ts` slightly so a strong squad doesn't randomly drop a match on MD 5:
- Bump home advantage from +3 → +4.
- Reduce variance term on `ourXG` (×1.4 → ×1.0) and `theirXG` (×1.2 → ×0.9).
- Difficulty multiplier on variance: easy ×0.7, normal ×1.0, hard ×1.3 (currently unused).

## 3. Regroup the 56-club wheel

The single ALL-TIME wheel with 56 slices is too dense — slivers are unreadable and Uerdingen-tier teams feel random. Split into era tiers the user picks per spin.

Add an `era_tier` field to `src/data/clubs.json` (one-time script, no AI):
- `current` — today's Bundesliga 18
- `2000s` — Bundesliga staples 2000-2015 (Schalke pre-relegation, HSV, Hannover 96, Hertha, etc.)
- `90s` — golden 90s clubs (Kaiserslautern champions, Uerdingen, Karlsruher SC, 1860 München, Bochum, Cottbus, Rostock, etc.)
- `70s-80s` — Bundesliga old guard (Köln pre-2000s, Mönchengladbach Weisweiler era as historic entry, Eintracht Braunschweig, Fortuna Düsseldorf champion years, Saarbrücken, Offenbach Kickers, etc.)
- `legends` — pre-Bundesliga / DDR-Oberliga survivors (Dynamo Dresden, Magdeburg, Carl Zeiss Jena, Rot-Weiss Essen, etc.)

In the draft side panel, show 5 tier chips above the wheel. The wheel renders only the selected tier (≈10-15 slices each, very readable). User can switch tier between spins; default = `current`.

## 4. UI polish

Keep the Bundesliga-red / dark-green identity, no theme change. Tighten the feel:

**Draft screen**
- Wheel: thicker rim, conic-gradient backdrop glow that pulses faintly while idle, harder snap easing on landing (`[0.22, 1, 0.36, 1]`, 3.6 s) + a subtle "tick" scale bump on stop.
- Selected-club reveal: scale-in card with the crest color as gradient background, slides over the wheel instead of replacing it abruptly.
- Player list rows: hover lift + ring in club color, rating chip with subtle glow.
- Pitch slots: drop shadow on filled slots, name label uses a small backdrop blur instead of solid black.

**Season screen**
- Sticky header with the W/D/L/GF/GA counters that animate (count-up) as matches reveal.
- Match cards reveal with a tiny stagger and a left-edge color bar (green/yellow/red).
- When the streak breaks, full-width divider: *"Unbeaten run ended — Matchday X"*.

**Landing + result**
- Same font stack, just add subtle radial primary glow behind the big "34-0" wordmark.
- Result screen: confetti only on true unbeaten; otherwise a quiet "Try again" CTA.

## Files touched

- `src/data/clubs.json` — add `era_tier` to every club.
- `src/lib/game-types.ts` — add `era_tier` union type.
- `src/routes/draft.tsx` — tier selector, auto-spin chain, wheel polish.
- `src/routes/season.tsx` — reveal all 34, streak-broken divider, sticky animated header.
- `src/lib/sim.ts` — rebalance variance + home boost + difficulty hook.
- `src/styles.css` — small additions (glow utility, count-up keyframe).
- `src/routes/result.tsx`, `src/routes/index.tsx` — wordmark glow + result CTA tweak.

## Out of scope

- No new data generation / AI calls (era_tier assigned by hand in code).
- No backend, no auth, no real crests.
- Wheel stays SVG (no 3D).
