# LEARNINGS

A running log of mistakes I (Claude) have made while building this project,
why they happened, and the prevention rule I'll apply next time. Updated
when something breaks in production-y use, not when something is merely
ugly. Each entry is a debugging story future-me has to internalize.

---

## L-1 — Rules-of-Hooks: early-return BEFORE other hooks

**What happened.** `/career/draft` and `/career/season` both did this:

```tsx
function CareerDraft() {
  const career = useCareer();
  useEffect(() => { /* guard */ }, [...]);
  if (!career.foundingClubId) return null;  // ← early return
  const allClubs = useMemo(() => getClubs(leagueId), [leagueId]);  // ← hook AFTER return
  // …more useMemo / useState / useEffect
}
```

When `foundingClubId` flipped from null → set, React's hook counter saw
a different number of hooks rendered between the two renders and crashed
the component. The user saw "THIS PAGE DIDN'T LOAD" the moment they
clicked a founding club.

I then introduced the SAME bug in my "fix" commit for the Outlet issue
(career.tsx):

```tsx
function CareerHub() {
  const pathname = useRouterState(...);
  if (onChildRoute) return <Outlet />;  // ← early return
  const career = useCareer();           // ← hook AFTER return
  …
}
```

**Why it slipped through.** ESLint already had `react-hooks/rules-of-hooks`
configured at error level via `reactHooks.configs.recommended.rules`.
The rule fires correctly. **I just didn't run `npm run lint` before
shipping.** Tests passed (vitest doesn't run React components in
StrictMode). Dev server even returned HTTP 200 because Vite's
transpiler tolerates it; the crash happens at render-time in the browser.

**Prevention rule.**

1. **Before EVERY commit that touches a `.tsx` file, run `npm run lint`.**
   Add to my mental checklist. The signal was already in the toolchain;
   I just wasn't reading it.
2. **Pattern: all hooks at the top of the component, every conditional
   render at the bottom.** Treat React components like the standard
   layout:
   ```
   function Component() {
     // 1. ALL hooks (useCareer, useState, useMemo, useEffect, ...)
     // 2. DERIVED values from hook results
     // 3. EARLY RETURNS (loading / not-ready / redirect states)
     // 4. Normal render JSX
   }
   ```
3. Even safer: package the redirect-guard into a small `useGuard()` custom
   hook that ALWAYS runs and only the JSX branches. Future routes adopt
   the pattern.

**Files touched fixing L-1:** `src/routes/career.tsx`,
`src/routes/career.draft.tsx`, `src/routes/career.season.tsx`,
`package.json` (added `lint:hooks` script).

---

## L-2 — File-based routing nests via `.` (need an `<Outlet />`)

**What happened.** Created `src/routes/career.tsx` + sibling files
`career.found.tsx`, `career.draft.tsx`, `career.season.tsx`. TanStack
Router file-based routing treats the dot as nesting: `career.found.tsx`
becomes a CHILD of `career.tsx`. When the user clicked "Pick Your Club"
the URL changed to `/career/found` but the page stayed on the hub
because `CareerHub` didn't render an `<Outlet />` for the child.

**Why it slipped through.** I tested via `curl /career/found` and got
HTTP 200. The server-side renderer returned a page; I assumed the route
worked. But what was returned was just the parent hub's HTML — the
child component never mounted.

**Prevention rule.**

1. **Test routes by clicking links in a browser session, not just by
   curling URLs.** SSR can return 200 even when the actual user-visible
   navigation is broken.
2. **For TanStack Router with file-based routing: if `parent.tsx` has
   children (`parent.child.tsx`), parent.tsx MUST contain `<Outlet />`.**
   Either render it always (parent becomes a layout) or render
   conditionally based on `useRouterState({ select: s => s.location.pathname })`.
3. Alternative: use folder structure (`career/index.tsx`, `career/found.tsx`)
   to make the hierarchy explicit. Cleaner long-term for nested routes.

**Files touched fixing L-2:** `src/routes/career.tsx`.

---

## L-3 — Trusting my training data on real-football fact claims

**What happened.** Multiple times. The pattern:

- Removed Stéphane Henchoz from FC Basel ("never played there") — he
  played Servette + Xamax 1992-1995, not Basel. ✓ correct
- But then placed him at Sion when restoring — also wrong; should have
  been Servette + Xamax.
- Removed Yann Sommer from Grasshoppers ("Sommer was only ever at Basel")
  — wrong; Sommer was on loan at GCZ 2008-2010 from Basel youth.
- Asserted Andy Egli "never played for Grasshoppers" — German Wikipedia
  confirms he IS in their notable-player list. May still be wrong, but
  I overstated certainty.

Each error came from confident pattern-matching against incomplete
training data.

**Why it slipped through.** I treated my training-data memory of football
careers as authoritative. It is not — careers are noisy, loan spells
and brief stints are exactly the kind of details that drop out of
training distillation.

**Prevention rule.**

1. **For any specific-fact claim about a real player's career: cite a
   source, or mark it as low-confidence.** Don't assert "X never played
   for Y" without checking. Wikipedia category pages + the player's
   Wikipedia infobox are cheap to fetch.
2. **When in doubt, present rather than decide.** "I think these 12
   entries are wrong, here's the list — confirm before I delete" is
   what I did the SECOND time and it worked great. First time I just
   deleted and made the wrong call.
3. **Use Wikipedia/structured sources as the source of truth, not me.**
   I already proved this works (the swiss-squads German Wikipedia pass
   added 506 entries with no obvious errors). Default to that workflow
   for any historical-roster work.

**Files reflecting L-3:** `tools/cleanup_gcz.py`,
`tools/apply_swiss_wikipedia.py`, `src/data/swiss/players.json`.

---

## L-4 — WebFetch summarizer can hallucinate when content is missing

**What happened.** First attempt to extract 2026 WC squads via the
research agent. WebFetch returned plausible-looking data for the first
6 nations (Czech Republic, Mexico, etc.) but the same call on a different
URL silently truncated; the agent couldn't see "beyond Group B." Worse,
the agent noticed that individual nation pages 404'd — but the first
fetch had already produced specific clubs (Pavel Šulc at Lyon, etc.)
that LOOKED real but the agent couldn't verify weren't fabricated.

The agent — correctly — stopped before writing 1,200 hallucinated
players into the game database. I then went to Wikipedia's parse API
directly via curl + deterministic regex parsing of `{{nat fs g player}}`
templates, which is hallucination-immune.

**Why it almost slipped through.** WebFetch's LLM-summarizer step is
opaque. If a page is too long, content gets dropped; if a page is
missing, you sometimes get a confabulated summary. Either way the
returned text "looks plausible."

**Prevention rule.**

1. **For structured-data extraction at scale, bypass the summarizer.**
   Use the source's raw API or HTML directly, parse with a deterministic
   parser. Wikipedia has `action=parse&prop=wikitext` — use it.
2. **Praise the agent that refused.** A research agent saying "I cannot
   verify this is real, stopping" is HEROIC. I had this exact behaviour
   and rewarded it by switching to a more reliable extraction path. Keep
   that habit.

**Files reflecting L-4:** `tools/parse_wc2026_wikitext.py`,
`tools/build_wc2026.py`.

---

## L-5 — Heuristic baselines that flatten the data

**What happened.** First version of WC 2026 ratings used
`baseline = max(72, nation_strength - 6)`. Result: 11 nations had 100%
of their squad at OVR 72, including Manchester City CB Khusanov (rated
72 because his nationality Uzbekistan was low-strength). User flagged.

**Why it slipped through.** I chose nation-strength as the rating
signal because it was convenient — the nation was already in the data.
But it ignored the much stronger signal of WHICH CLUB the player
actually plays at.

**Prevention rule.**

1. **When picking a heuristic for missing values, ask "what's the
   strongest predictive signal available right now?"** For player
   ratings: current club > nationality. For player position: shirt
   number > nationality.
2. **Sanity-check distributions BEFORE shipping.** "Show me % of squad
   at the baseline rating per nation" would have caught this
   immediately. I now add a distribution dump to bulk-data scripts.

**Files reflecting L-5:** `tools/improve_wc2026_ratings.py`.

---

## L-6 — Removing too aggressively when fans flag data errors

**What happened.** User said two GCZ players never played for the club.
I went and removed 11 entries, of which several (Grichting, Sommer)
turned out to be real GCZ players I incorrectly judged "never played
there."

**Why it slipped through.** I generalized from "user flagged 2 wrong"
to "let me also remove these 10 that LOOK wrong by my training data."
Compounded with L-3.

**Prevention rule.**

1. **Match the scope of the user's claim, no broader.** If they say
   "these 2 are wrong," fix those 2. Surface a candidate list of MORE
   suspects if I want to — but don't unilaterally delete them.
2. **Restoration is easy when you keep the history.** I correctly used
   commits per-change so restoring Grichting was a 1-line edit. Keep
   doing small commits.

**Files reflecting L-6:** the multiple corrections under
`src/data/swiss/players.json` (commits visible in `git log`).

---

## Prevention checklist (running list)

Before any commit that touches `.tsx`:
- [ ] `npm run lint` — exit code 0
- [ ] `npm test` — all green

Before any commit that touches `.json` data files:
- [ ] `python3 tools/audit_data.py` — exit code 0
- [ ] Spot-check the top 5 entries by rating per affected league

Before deleting user-visible content (players / clubs / matches):
- [ ] Cite the authority (Wikipedia URL / FIFA edition / user message)
- [ ] If using training data alone, present-don't-decide

Before adding a new TanStack route file:
- [ ] If a parent.tsx exists, ensure parent has `<Outlet />`
- [ ] Test by clicking the link in a real browser, not just curl

When using WebFetch for structured data:
- [ ] If >100KB or sectioned, prefer raw HTTP via curl + deterministic parser
- [ ] If the summarizer truncates, STOP. Don't trust the content beyond
      the truncation point.
