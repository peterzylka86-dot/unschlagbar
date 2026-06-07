## Scope (this round)

Polish + sharing bundle. New formats (CL / WC / Women's) deferred to a later round.

1. Remove the discard/skip-player button from the draft
2. Quick Draft mode (2-at-once)
3. Share team & result (text first, image card next)
4. Async "challenge a friend" link (no backend)

---

## 1. Remove discard button

`src/routes/draft.tsx` line ~619 still renders a "discard player" button in the `AssignPanel` footer. Remove the button and its handler wiring. Keep the internal `skipAssign()` function — it's still used for auto-skip when no compatible slot exists (lines 190–197) and as the `onCancel` for non-user-driven flows.

## 2. Quick Draft mode (2-at-once)

A speed variant of `draftMode`. Add `"quick"` to the `DraftMode` union in `src/lib/game-types.ts` (currently `"squad" | "position"`).

Behavior: each wheel spin lands on a club and the user picks **two** players from that club's tier-filtered list in one panel, assigning them to the two best-matching open slots automatically (GK→GK, defenders to back line, etc.). Falls back to one player if only one compatible remains.

UI: add the option to the draft-mode picker in `src/routes/game.tsx` with label "Quick" and sub "2 players per club — for the impatient". In `draft.tsx`, `AssignPanel` gets a `quickMode` branch that renders a 2-pick grid instead of single-select.

Reroll cost: 1 reroll covers both picks.

## 3. Share team & result

### 3a. Text recap (ships first)
New helper `src/lib/share.ts` exporting `buildShareText(league, slots, matches?)`:

```
38:0 INVENCIBLE — La Liga 🇪🇸
GK Casillas · CB Ramos · CB Puyol ...
Result: 36W 2D 0L · 112:14 · 1st place 🏆
Play: https://unschlagbar.lovable.app/?challenge=<seed>
```

Add a "Share" button on `season.tsx` and `result.tsx`. Uses `navigator.share` when available, falls back to `navigator.clipboard.writeText` + toast.

### 3b. Image card
Add a `<ShareCard />` component (hidden, rendered offscreen) showing brand mark, squad list on a pitch silhouette, league badge, and (on results) the W/D/L + GF:GA + table position. Use `html-to-image` (`bun add html-to-image`) to convert to PNG on demand. Button: "Save as image" — triggers download; on mobile, attaches to `navigator.share` as a file when supported.

## 4. Async challenge link

Encode the run config + simulation seed into a URL: `/?challenge=<base64({league, formation, difficulty, ratingMode, seed})>`.

- On `index.tsx`, detect `?challenge=` via `validateSearch`; if present, prefill `useGame.config`, store the seed, and route straight to `/game` with the picker pre-selected.
- Persist the seed in the store (new field `challengeSeed?: number`) and feed it into `simulateSeason` so both players get the same fixtures and opponent variance.
- On `result.tsx`, after a challenge run, show "Friend's record: —" placeholder + a "Copy result to send back" button that produces a text recap including the seed; pasting the friend's recap (later round) compares. v1: just round-trip the recap via copy/paste, no parsing.

No accounts, no backend. Just URL state + clipboard.

---

## Files touched

- `src/routes/draft.tsx` — remove discard button; quick-mode branch in `AssignPanel`
- `src/routes/game.tsx` — add Quick draft-mode option
- `src/routes/index.tsx` — `validateSearch` for `?challenge=`, prefill store, redirect
- `src/routes/season.tsx`, `src/routes/result.tsx` — Share button + ShareCard mount
- `src/lib/game-types.ts` — `DraftMode` adds `"quick"`; `RunConfig` adds `challengeSeed?`
- `src/lib/store.ts` — persist `challengeSeed`
- `src/lib/sim.ts` — accept explicit seed override (already takes `seedNum`, just thread through)
- new `src/lib/share.ts` — text builder + base64 challenge codec
- new `src/components/ShareCard.tsx` — printable card
- `bun add html-to-image`

## Out of scope (next rounds)

- Champions League / World Cup / Women's editions and their datasets
- Real-time multiplayer / Lovable Cloud / accounts
- Friend-recap parsing & head-to-head comparison view
