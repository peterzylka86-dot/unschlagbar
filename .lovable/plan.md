# Multi-League Expansion

Add three new leagues alongside Bundesliga, each with full historic player depth and a localized kickoff word.

## 1. League model

New file `src/lib/leagues.ts`:

```ts
export type LeagueId = "bundesliga" | "laliga" | "seriea" | "swiss";

export interface League {
  id: LeagueId;
  name: string;            // "La Liga"
  country: string;         // "Spain"
  matches: number;         // 34 / 38 / 38 / 36
  brandMark: string;       // "34:0" / "38:0" / "36:0"
  tagline: string;         // "UNSCHLAGBAR" / "INVENCIBLE" / "IMBATTIBILE" / "UNBESIEGT"
  kickoffWord: string;     // "Anpfiff" / "¡Vamos!" / "Forza!" / "Hopp Schwiiz!"
  clubsPerSeason: number;  // opponents drawn per run (e.g. 17 for 18-club leagues)
}
```

Values:
- Bundesliga — 34 games, "34:0", "UNSCHLAGBAR", "Anpfiff", 17 opponents (18 clubs)
- La Liga — 38 games, "38:0", "INVENCIBLE", "¡Vamos!", 19 opponents (20 clubs)
- Serie A — 38 games, "38:0", "IMBATTIBILE", "Forza!", 19 opponents
- Swiss Super League — 36 games, "36:0", "UNBESIEGT", "Hopp Schwiiz!", 11 opponents played 3× + 1× variation, but simplest: 12 clubs × ~3 rounds. We'll generate 36 fixtures from the 11 opponents (each played roughly 3 times, home/away mix), matching real Swiss format.

## 2. Data files

Split clubs/players per league for clarity:

```
src/data/
  bundesliga/clubs.json
  bundesliga/players.json
  laliga/clubs.json
  laliga/players.json
  seriea/clubs.json
  seriea/players.json
  swiss/clubs.json
  swiss/players.json
```

Move existing Bundesliga data into `bundesliga/`. Add a loader `src/lib/data.ts` that returns `{ clubs, players }` for a given `LeagueId`.

### Coverage targets per new league

Same shape as Bundesliga: every club covered across all 4 era tiers (current / 00s / 90s / 70s-80s), each era having all 10 positions, ~15–20 players per club per active era.

- **La Liga** — ~30 clubs across eras (Real Madrid, Barça, Atlético, Valencia, Sevilla, Bilbao, Real Sociedad, Villarreal, Betis, Deportivo, Zaragoza, Celta, Mallorca, Espanyol, Málaga, Getafe, Girona, Las Palmas, Rayo, Osasuna, Alavés, Valladolid, Granada, Levante, Cádiz, plus historic: Hércules, Burgos, Sporting Gijón, Salamanca, etc.). ~500–700 players.
- **Serie A** — ~30 clubs (Juventus, Milan, Inter, Roma, Lazio, Napoli, Fiorentina, Atalanta, Torino, Bologna, Sampdoria, Genoa, Udinese, Parma, Verona, Lecce, Cagliari, Sassuolo, Empoli, Monza, Como, Venezia, plus historic: Foggia, Padova, Vicenza, Brescia, Reggina, Chievo, Ascoli, Avellino, etc.). ~500–700 players.
- **Swiss Super League** — ~15 clubs (Basel, YB, Zürich, GC, Servette, Sion, Luzern, Lugano, St. Gallen, Lausanne, Winterthur, Yverdon, Thun, Aarau, NE Xamax). ~200–300 players.

All ratings use the existing 65–95 scale, authentic to each player's era.

## 3. Setup flow

Add a league picker as the first step in `src/routes/game.tsx`, above Formation:

```
League → Formation → Difficulty → Show Ratings → Draft Mode → Player Ratings → Start
```

Store `league: LeagueId` on `RunConfig` in `src/lib/store.ts`. Default to `"bundesliga"`.

When league changes:
- reset slots
- reset rerolls
- clear matches

## 4. Wiring through the app

- `src/routes/index.tsx` (landing) — keep "34:0" as default brand, but show all four league badges (34/38/38/36) as a teaser row.
- `src/routes/game.tsx` — brand mark dynamic per selected league (`league.brandMark` + `league.tagline`).
- `src/routes/draft.tsx` — uses `getLeagueData(league)` for clubs/players. The "Anpfiff" / "Start match" CTA copy uses `league.kickoffWord`. Same for the start-season button label.
- `src/routes/season.tsx` — title shows `league.brandMark`; uses `league.matches` for total fixtures; uses `league.tagline` everywhere the word "UNSCHLAGBAR" appears.
- `src/routes/result.tsx` — same: dynamic brand, tagline, match count; "unbeaten until you lose" rule unchanged.
- `src/lib/sim.ts` — `simulateSeason` already takes opponents; pass full opponent list and let length drive the fixture count. For Swiss, build a 36-fixture schedule (each opponent ~3×, balanced home/away). For La Liga / Serie A, double round-robin with 19 opponents = 38 games (already matches existing logic).
- `src/lib/store.ts` — add `league` to config; helper `getLeague(state.config.league)`.

## 5. Localized labels (per league)

| League | Brand | Tagline | Kickoff CTA | Season banner |
|---|---|---|---|---|
| Bundesliga | 34:0 | UNSCHLAGBAR | Anpfiff | "Unschlagbar" |
| La Liga | 38:0 | INVENCIBLE | ¡Vamos! | "Invencible" |
| Serie A | 38:0 | IMBATTIBILE | Forza! | "Imbattibile" |
| Swiss SL | 36:0 | UNBESIEGT | Hopp Schwiiz! | "Unbesiegt" |

All page `<head>` titles update to the active league's brand+tagline.

## 6. Out of scope

- No formation, draft, or match-engine logic changes
- No UI redesign — picker reuses existing `OptionCard` component
- Tier names stay: current / 00s / 90s / 70s-80s

## Files touched

- new: `src/lib/leagues.ts`, `src/lib/data.ts`
- new: `src/data/{laliga,seriea,swiss}/clubs.json`, `src/data/{laliga,seriea,swiss}/players.json`
- moved: `src/data/clubs.json`, `src/data/players.json` → `src/data/bundesliga/`
- edited: `src/lib/game-types.ts` (add `league` to `RunConfig`)
- edited: `src/lib/store.ts`, `src/lib/sim.ts`
- edited: `src/routes/{index,game,draft,season,result}.tsx`

## Build size note

Player JSON for three new leagues with full historic depth will roughly triple the data payload (~40–50k lines total). Generation happens in a single batch; first run will take longer than usual.
