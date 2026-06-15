import { describe, it, expect } from "vitest";
import { pickConversation } from "./conversations";

describe("pickConversation", () => {
  it("is deterministic per (player, season)", () => {
    expect(pickConversation("c:A", 3).id).toBe(pickConversation("c:A", 3).id);
  });

  it("every scenario has one clearly-good and one clearly-bad answer", () => {
    // Sweep many keys to hit all scenarios.
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) seen.add(pickConversation(`c:P${i}`, 1).id);
    expect(seen.size).toBeGreaterThan(3); // variety
    for (let i = 0; i < 60; i++) {
      const c = pickConversation(`c:P${i}`, 2);
      expect(c.options.some((o) => o.delta >= 5)).toBe(true); // a good answer
      expect(c.options.some((o) => o.delta <= -5)).toBe(true); // a wrong answer
      // No unfilled placeholders in any reply.
      for (const o of c.options) expect(o.reply).not.toMatch(/\{\w+\}/);
    }
  });
});
