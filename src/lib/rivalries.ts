/**
 * Special rivalries — the derbies that crackle. When your fixture is one of
 * these, the match is flagged (a 🔥 badge, the rivalry's name in the live
 * ticker) and plays a little WILDER: form and the form-table go out the
 * window, so a derby is genuinely unpredictable regardless of who's favourite.
 *
 * Works across both modes — real-mode club slugs (fc-barcelona) and the
 * legends pool's ids (barcelona) map to the same canonical club. Pure.
 */

// Real-slug / legends-id → canonical club key.
const ALIAS: Record<string, string> = {
  "fc-barcelona": "BAR",
  barcelona: "BAR",
  "real-madrid": "RMA",
  realmadrid: "RMA",
  "atletico-madrid": "ATM",
  atletico: "ATM",
  "manchester-city": "MCI",
  manchestercity: "MCI",
  "manchester-united": "MUN",
  manchesterunited: "MUN",
  liverpool: "LIV",
  everton: "EVE",
  arsenal: "ARS",
  "tottenham-hotspur": "TOT",
  tottenham: "TOT",
  "fc-bayern-munchen": "BAY",
  bayern: "BAY",
  "borussia-dortmund": "BVB",
  dortmund: "BVB",
  "borussia-monchengladbach": "BMG",
  "fc-schalke-04": "S04",
  inter: "INT",
  "ac-milan": "MIL",
  milan: "MIL",
  juventus: "JUV",
  roma: "ROM",
  lazio: "LAZ",
  napoli: "NAP",
  "paris-saint-germain": "PSG",
  "olympique-de-marseille": "OM",
  marseille: "OM",
  "olympique-lyonnais": "OL",
  ajax: "AJA",
  feyenoord: "FEY",
  psv: "PSV",
  "fc-porto": "POR",
  "sl-benfica": "BEN",
  "sporting-cp": "SCP",
};

// Canonical rivalry pairs and their famous name.
const PAIRS: [string, string, string][] = [
  ["BAR", "RMA", "El Clásico"],
  ["RMA", "ATM", "Madrid Derby"],
  ["MCI", "MUN", "Manchester Derby"],
  ["LIV", "MUN", "Liverpool–United"],
  ["LIV", "EVE", "Merseyside Derby"],
  ["ARS", "TOT", "North London Derby"],
  ["BAY", "BVB", "Der Klassiker"],
  ["BVB", "S04", "Revierderby"],
  ["BMG", "BVB", "Borussia Derby"],
  ["INT", "MIL", "Derby della Madonnina"],
  ["ROM", "LAZ", "Derby della Capitale"],
  ["JUV", "INT", "Derby d'Italia"],
  ["NAP", "JUV", "Napoli–Juventus"],
  ["PSG", "OM", "Le Classique"],
  ["OL", "OM", "Olympico"],
  ["AJA", "FEY", "De Klassieker"],
  ["POR", "BEN", "O Clássico"],
  ["BEN", "SCP", "Derby de Lisboa"],
];

const PAIR_MAP = new Map<string, string>();
for (const [a, b, name] of PAIRS) {
  PAIR_MAP.set([a, b].sort().join("|"), name);
}

/** The rivalry name if these two clubs are fierce rivals, else null. Accepts
 *  either real slugs or legends ids for each side. */
export function rivalryFor(
  clubA: string | null | undefined,
  clubB: string | null | undefined,
): string | null {
  const a = ALIAS[clubA ?? ""];
  const b = ALIAS[clubB ?? ""];
  if (!a || !b || a === b) return null;
  return PAIR_MAP.get([a, b].sort().join("|")) ?? null;
}
