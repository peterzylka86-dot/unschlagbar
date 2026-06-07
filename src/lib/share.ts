import type { RunConfig, Slot, MatchResult } from "./game-types";
import { LEAGUES } from "./leagues";

const BASE_URL =
  typeof window !== "undefined" ? window.location.origin : "https://unschlagbar.lovable.app";

export interface ChallengePayload {
  league: RunConfig["league"];
  formation: RunConfig["formation"];
  difficulty: RunConfig["difficulty"];
  ratingMode: RunConfig["ratingMode"];
  draftMode: RunConfig["draftMode"];
  showRatings: boolean;
  seed: number;
}

// URL-safe base64
function b64encode(s: string): string {
  if (typeof window !== "undefined") {
    return window
      .btoa(unescape(encodeURIComponent(s)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }
  return Buffer.from(s, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
function b64decode(s: string): string {
  const norm = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  if (typeof window !== "undefined") {
    return decodeURIComponent(escape(window.atob(norm)));
  }
  return Buffer.from(norm, "base64").toString("utf-8");
}

export function encodeChallenge(p: ChallengePayload): string {
  return b64encode(JSON.stringify(p));
}
export function decodeChallenge(s: string): ChallengePayload | null {
  try {
    const obj = JSON.parse(b64decode(s));
    if (typeof obj?.seed !== "number" || typeof obj?.league !== "string") return null;
    return obj as ChallengePayload;
  } catch {
    return null;
  }
}

export function challengeUrl(p: ChallengePayload): string {
  return `${BASE_URL}/?challenge=${encodeChallenge(p)}`;
}

export function buildShareText(
  config: RunConfig,
  slots: Slot[],
  matches: MatchResult[] | undefined,
  challengeSeed: number | undefined,
): string {
  const league = LEAGUES[config.league];
  const lines: string[] = [];
  lines.push(`${league.brandMark} ${league.tagline} — ${league.flag} ${league.name}`);
  lines.push("");
  for (const s of slots) {
    const p = s.player;
    lines.push(
      p
        ? `${s.position.padEnd(3, " ")} ${p.name}${p.career_years ? ` (${p.career_years.split("–")[0]?.trim() ?? ""})` : ""}`
        : `${s.position.padEnd(3, " ")} —`,
    );
  }
  if (matches && matches.length) {
    const w = matches.filter((m) => m.outcome === "W").length;
    const d = matches.filter((m) => m.outcome === "D").length;
    const l = matches.filter((m) => m.outcome === "L").length;
    const gf = matches.reduce((a, m) => a + m.ourScore, 0);
    const ga = matches.reduce((a, m) => a + m.theirScore, 0);
    const unbeaten = l === 0;
    lines.push("");
    if (league.kind !== "league") {
      // Knockout / groupKO recap: list each match with its round
      for (const m of matches) {
        const round = m.round ?? `M${m.matchday}`;
        lines.push(
          `${round.padEnd(14, " ")} ${m.outcome} ${m.ourScore}-${m.theirScore} ${m.home ? "vs" : "@"} ${m.opponent.short}`,
        );
      }
      lines.push("");
      const champ = matches.some((x) => x.round === "Final" && x.outcome === "W");
      lines.push(`${w}W ${d}D ${l}L · ${gf}:${ga}${champ ? " · 🏆 " + league.unbeatenLabel : ""}`);
    } else {
      lines.push(
        `${w}W ${d}D ${l}L · ${gf}:${ga}${unbeaten ? " · ★ " + league.unbeatenLabel + " ★" : ""}`,
      );
    }
  }
  const seed = challengeSeed ?? Math.floor(Math.random() * 1e9);
  const url = challengeUrl({
    league: config.league,
    formation: config.formation,
    difficulty: config.difficulty,
    ratingMode: config.ratingMode,
    draftMode: config.draftMode,
    showRatings: config.showRatings,
    seed,
  });
  lines.push("");
  lines.push(`Challenge: ${url}`);
  return lines.join("\n");
}

export async function shareOrCopy(
  text: string,
  title = "UNSCHLAGBAR",
): Promise<"shared" | "copied"> {
  if (
    typeof navigator !== "undefined" &&
    (navigator as Navigator & { share?: (d: ShareData) => Promise<void> }).share
  ) {
    try {
      await (navigator as Navigator & { share: (d: ShareData) => Promise<void> }).share({
        title,
        text,
      });
      return "shared";
    } catch {
      /* fall through to copy */
    }
  }
  await navigator.clipboard.writeText(text);
  return "copied";
}

/**
 * Native image share — opens the OS share sheet (WhatsApp / X / Messages /
 * Instagram) with the PNG attached. Falls back to download-as-file if the
 * device/browser doesn't support file-share (mostly older desktop).
 *
 * User: "I don't want to save it on my mobile but rather share the image
 * via whatsapp or X or something."
 *
 * @returns "shared"     — opened the share sheet successfully
 *          "downloaded" — fell back to file download
 *          "failed"     — both paths threw; show an error toast
 */
export async function shareImage(
  dataUrl: string,
  filename: string,
  text = "",
  title = "UNSCHLAGBAR",
): Promise<"shared" | "downloaded" | "failed"> {
  try {
    // Convert the data URL to a File so navigator.share can attach it.
    const blob = await (await fetch(dataUrl)).blob();
    const file = new File([blob], filename, { type: "image/png" });
    const nav = navigator as Navigator & {
      canShare?: (d: ShareData) => boolean;
      share?: (d: ShareData) => Promise<void>;
    };
    if (nav.share && nav.canShare && nav.canShare({ files: [file] })) {
      try {
        await nav.share({ files: [file], title, text });
        return "shared";
      } catch {
        // User cancelled — treat as silently shared (not a failure)
        return "shared";
      }
    }
  } catch {
    // Fall through to download
  }
  // Desktop / unsupported: fall back to download-as-file.
  try {
    const link = document.createElement("a");
    link.download = filename;
    link.href = dataUrl;
    link.click();
    return "downloaded";
  } catch {
    return "failed";
  }
}
