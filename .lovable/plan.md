## Goal

Add three new game modes alongside the existing domestic leagues:

1. **Champions League** — knockout-format continental competition, deep historic pool (think Rosenborg-in-Camp-Nou nights).
2. **World Cup** — 7-game national-team run (group stage + knockouts) to become world champ.
3. **Women's edition** — lean top-women's-clubs league, present-day focused.

## Scope decisions

- **Data depth**: CL & WC = deep (large pools, multiple eras). Women's = lean (~16 clubs, ~10 players each, current era only).
- **Format**: CL and WC introduce a **knockout** competition type. Women's reuses the existing league/round-robin format.
- **Share + challenge links**: continue to work for all new modes (seed-driven sim already abstracted).
- **Out of scope this round**: head-to-head auto-compare of challenge results, realtime multiplayer.

## What we'll build

### 1. Competition abstraction

Today everything is a `LeagueId` round-robin. Generalize:

- Rename mental model from "league" to "competition" without breaking existing routes. Add a `kind: "league" | "knockout" | "groupKO"` on each entry.
- `LeagueId` union extended with `"ucl" | "worldcup" | "womens"`.
- `LEAGUES` entries for the new three with their own brandMark, tagline, kickoff word, and labels:
  - UCL: `brandMark: "13:0"`, tagline `INVINCIBILE EUROPA`, knockout kind.
  - WC: `brandMark: "7:0"`, tagline `WELTMEISTER`, groupKO kind.
  - Women's: `brandMark: "30:0"`, tagline `UNBESIEGBAR`, league kind.

### 2. New data files

Add JSON under `src/data/`:

- `ucl/clubs.json` + `ucl/players.json` — deep pool spanning current top European clubs + historic euro-night clubs (Rosenborg, Steaua, Crvena Zvezda, Nottingham Forest, Ajax 95, Porto 04, etc.) and their iconic players across `current/00s/90s/70s-80s` tiers.
- `worldcup/clubs.json` + `worldcup/players.json` — "clubs" are national teams (Brazil, Germany, France, Argentina, Italy, Spain, Netherlands, England, Uruguay, Croatia, Portugal, Belgium, etc.), players are legendary internationals per nation × era.
- `womens/clubs.json` + `womens/players.json` — ~16 top women's clubs (Barça Femení, Lyon, Chelsea, Arsenal, Bayern, Wolfsburg, PSG, Real Madrid, NWSL stalwarts, etc.) with ~10 current-era players each.

Wire each into `src/lib/data.ts` like the existing leagues.

### 3. Knockout simulation

New helper in `src/lib/sim.ts` (or new `src/lib/knockout.ts`):

- `simulateKnockout(opponents, ourRating, seedNum, difficulty, format)` that returns an ordered `MatchResult[]` plus a `bracket` describing rounds (`R16 → QF → SF → F` for CL, `Group → R16 → QF → SF → F` for WC).
- Seeding: opponents picked by strength from the relevant pool, then progressively harder rounds.
- WC group stage = 3 matches; advancement assumed if avg-points ≥ 4 OR points ≥ 4 (else "eliminated in group" ending). On elimination, no further matches are simulated and the result screen reflects exit round.
- Uses the same xG/Poisson core as `simulateSeason` so seeds remain deterministic across challenge links.

### 4. Season/Bracket UI

`src/routes/season.tsx` currently assumes round-robin. Branch on `league.kind`:

- `league` kind: existing UI (used for Bundesliga/LaLiga/SerieA/Swiss/Women's).
- `knockout` / `groupKO`: render a **bracket strip** at the top showing rounds with revealed/upcoming slots; match cards group under each round header instead of one big grid. Reveal animation reused per match.
- Stats header swaps "MD x/y" for round name (e.g. "Quarter-Final · Leg 2") and shows aggregate score on two-legged ties (CL = 2 legs from QF onward, 1 leg at Final; or single-leg throughout for simplicity if we want a quicker run — final choice in implementation, see Open Questions).

### 5. Result screen

`src/routes/result.tsx` extended:

- League kind: unchanged.
- Knockout: "Champions of Europe" / "Eliminated in Semi-Final" headline, trophy-style mark, full bracket recap, opponents beaten.
- WC: "World Champions 🏆 7:0" or "Eliminated in [round]".

### 6. Setup screen (`game.tsx`)

- League grid expands from 4 to 7 tiles (two rows on mobile, three columns on desktop).
- Each tile shows the kind: "League · 34 matches", "Knockout · 13 matches", "Knockout · 7 matches".
- Difficulty and draft mode unchanged. Quick draft works in all modes (assigns 2 players per spin).
- Draft target count auto-adjusts: still 11 starting slots regardless of competition.

### 7. Sharing & challenge links

- `src/lib/share.ts` already accepts league + matches; extend the recap text to label rounds for knockout modes (e.g. `R16 W 2-1, QF W 3-2, SF L 1-2`) instead of W/D/L counts.
- Challenge link encoding already includes `league`, so picking `ucl`/`worldcup`/`womens` round-trips automatically; seed continues to determine opponents and outcomes.

## File changes

**New files:**
- `src/data/ucl/clubs.json`, `src/data/ucl/players.json`
- `src/data/worldcup/clubs.json`, `src/data/worldcup/players.json`
- `src/data/womens/clubs.json`, `src/data/womens/players.json`
- `src/lib/knockout.ts` (or extend `sim.ts`)
- `src/components/Bracket.tsx`

**Edited:**
- `src/lib/leagues.ts` — extend type + entries + `kind` field.
- `src/lib/data.ts` — register three new pools.
- `src/lib/sim.ts` — knockout helper.
- `src/lib/share.ts` — knockout recap formatting.
- `src/routes/game.tsx` — 7-tile league grid + kind labels.
- `src/routes/season.tsx` — branch on `kind`, render bracket vs grid.
- `src/routes/result.tsx` — knockout/WC headlines and recap.
- `src/routes/draft.tsx` — only opponent-pool reads change (data already abstracted via `getClubs`).

## Open questions

1. **CL ties**: single-leg every round (faster, simpler reveal) or two-legged from QF (more authentic but doubles match count)? Default: **single-leg, 4 rounds = 4 matches** unless you'd rather the longer arc.
2. **WC seeding**: random group draw via seed (more realistic chaos) or strength-balanced groups (fairer)? Default: **seeded chaos**.
3. **Women's depth**: confirmed lean — keep ~10 players per club; I'll prioritize Liga F / WSL / NWSL / Frauen-Bundesliga / Première Ligue.

I'll proceed with the defaults above unless you flag otherwise.
