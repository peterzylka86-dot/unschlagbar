# 34-0 — Bundesliga Draft Game

Recreate 38-0.app for the Bundesliga: draft your greatest XI by spinning a wheel of clubs, picking players, then simulate an unbeaten 34-match season.

## Scope

- Branded "34-0" (34 matchdays = 17 opponents × home/away).
- All ~56 clubs that have ever played in the Bundesliga on the wheel.
- AI-pre-generated player pool baked into a static JSON file (no runtime AI cost, instant gameplay).
- Same core feel as 38-0: dark theme, big bold numerals, green pitch, neon accents.

## Pages / Routes

```
src/routes/
  index.tsx        Landing: "34-0", tagline, Start New Run, stat cards (clubs / players / seasons)
  game.tsx         Setup screen: formation, difficulty, ratings on/off, draft mode, prime/career, Start Draft
  draft.tsx        The draft itself: wheel of clubs, player picker, pitch with filled slots
  season.tsx       34-match simulation, match-by-match with ratings vs opponent strength
  result.tsx       Victory (unbeaten) or defeat screen + share text
```

## Player Data Pipeline (one-time, build-side)

Use the bundled `ai-gateway` skill (Python script + LOVABLE_API_KEY) to pre-generate the dataset:

1. Hand-list the ~56 Bundesliga clubs (current 18 + historic: Kaiserslautern, 1860 Munich, Karlsruher SC, Uerdingen, Rot-Weiss Essen, Saarbrücken, Tasmania Berlin, Hansa Rostock, etc.).
2. For each club, prompt Gemini 3 Flash with a JSON schema to return ~15-25 iconic players. Each player gets: name, primary position (GK/CB/RB/LB/CM/CDM/CAM/RW/LW/ST), prime rating (75-97), 1-3 career-season snapshots (year, club, rating).
3. Save to `src/data/bundesliga-players.json` and `src/data/clubs.json`. The generator script lives in `scripts/generate-players.ts` and is run manually from the sandbox; the app only ever reads the JSON.
4. Light manual QA pass on obvious greats (Müller, Beckenbauer, Lewandowski, Kahn, Matthäus, Sammer, etc.) to make sure ratings feel right.

## Game Mechanics

**Formations:** 4-3-3, 4-4-2, 4-2-3-1, 4-5-1, 3-4-3, 3-5-2, 5-4-1 (same set as 38-0).

**Draft modes:**
- Squad First — spin the club wheel, pick any player from that club, choose their slot.
- Position First — pick an empty slot, then spin for a club to fill it.

**Difficulty:** Easy (3 rerolls), Normal (1 reroll), Hard (0 rerolls + ratings hidden).

**Ratings toggle:** show overalls or play blind. **Player ratings basis:** Career Seasons vs Prime Mode.

**Season simulation:**
- Compute squad average using best XI per formation.
- 34 matches against the 17 other clubs in the user's "league" (auto-generated bundle: a fixed slate of current Bundesliga rivals + a handful of historic giants to keep variety).
- For each match: opponent strength + home/away modifier + random variance vs squad strength → win/draw/loss, plus a fake scoreline.
- Lose or draw a single match → run ends with a defeat screen. Win all 34 → victory screen, "Invincible XI" share card.

## Visual Design (no design directions needed — cloning a defined style)

- Background: very dark green-black (`oklch` near `#0a1a0e`), subtle radial vignette.
- Accent: Bundesliga red (`#d20515`) instead of 38-0's emerald, but keep an emerald success color for "unbeaten".
- Display font: a bold condensed grotesk (Archivo Black or Bebek) for the "34-0" mark; body in Inter.
- Pitch: classic green with white markings, player chips are circular with position label.
- Wheel: SVG segmented wheel with club crests (use simple text/initials chip — no real crest assets to avoid licensing).
- All colors flow through `src/styles.css` semantic tokens.

## State / Persistence

- Run state held in a Zustand store (no backend needed). Persist last completed run to `localStorage` so a share link can reconstruct it.
- No Lovable Cloud / auth required for v1.

## Technical Notes

- Pure client-side React + TanStack Router; no server functions for gameplay.
- One server-side script (`scripts/generate-players.ts`) uses the AI gateway skill to seed `src/data/*.json`.
- Wheel spin animation via Framer Motion (`rotate` + spring) — no canvas needed.
- Match sim is synchronous JS with a small animated reveal per matchday.

## Out of Scope (v1)

- Real club crests / player photos (licensing).
- Multiplayer / leaderboards.
- Account system / saved runs across devices.
- Historical season-accurate league tables.

## Build Order

1. Seed data: clubs list + AI-generated player JSON.
2. Design tokens + landing page.
3. Setup screen (formation, options).
4. Draft screen with wheel + pitch.
5. Season simulation + result screens.
6. Polish: animations, share card, sound (optional).
