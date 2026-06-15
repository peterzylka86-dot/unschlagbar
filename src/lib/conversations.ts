/**
 * Player conversations — the Anstoss man-management moment. Now and then an
 * unsettled player knocks on your door with a gripe; you pick a response.
 * Say the right thing and his mood lifts; fluff it and he sulks. The chosen
 * option's delta feeds a lingering mood offset that the morale system reads.
 *
 * Pure + deterministic: the scenario for a given (player, season) is fixed,
 * so it never reshuffles on re-render.
 */

export interface ConvoOption {
  text: string;
  /** Morale delta applied to the player if this answer is chosen. */
  delta: number;
  /** The player's reaction line. */
  reply: string;
}

export interface Conversation {
  id: string;
  /** Opening line — {name} is the player. */
  topic: string;
  options: ConvoOption[];
}

const CONVERSATIONS: Conversation[] = [
  {
    id: "gametime",
    topic: "{name} knocks on your door — he's frustrated with his lack of minutes.",
    options: [
      { text: "Promise him a run in the side", delta: 9, reply: "“That's all I needed to hear, boss.” He's reassured." },
      { text: "Tell him to earn it in training", delta: -2, reply: "He shrugs. “We'll see, then.”" },
      { text: "The squad comes first — deal with it", delta: -9, reply: "He storms out. That didn't land well." },
    ],
  },
  {
    id: "form",
    topic: "{name} has lost his confidence after a rough patch and wants a word.",
    options: [
      { text: "Back him publicly — he's your man", delta: 8, reply: "He stands taller. “I won't let you down.”" },
      { text: "Keep it light, share a joke", delta: 3, reply: "He cracks a smile. A little lighter." },
      { text: "Tell him to sort himself out", delta: -8, reply: "His face hardens. Not the response he wanted." },
    ],
  },
  {
    id: "rumour",
    topic: "{name} has seen the transfer rumours and asks where he stands.",
    options: [
      { text: "He's not for sale — he's vital", delta: 8, reply: "Visibly relieved. “Then I'm staying and fighting.”" },
      { text: "Stay non-committal", delta: -2, reply: "He frowns. “So that's how it is.”" },
      { text: "Everyone has a price", delta: -10, reply: "Stunned silence. He won't forget that." },
    ],
  },
  {
    id: "leader",
    topic: "{name} feels ready for more responsibility in the dressing room.",
    options: [
      { text: "Name him a senior voice", delta: 7, reply: "He puffs out his chest. “I won't let the lads down.”" },
      { text: "In time — prove it first", delta: 2, reply: "He accepts the challenge. “Watch me.”" },
      { text: "Dismiss the idea", delta: -7, reply: "Deflated. “Right. Forget I asked.”" },
    ],
  },
  {
    id: "respect",
    topic: "{name} feels underappreciated and hints he deserves more recognition.",
    options: [
      { text: "Tell him how much he means to the side", delta: 7, reply: "He nods, validated. “Cheers, boss.”" },
      { text: "Promise to revisit it later", delta: 0, reply: "Non-plussed. “I'll hold you to that.”" },
      { text: "Remind him he's lucky to be here", delta: -10, reply: "Furious. That stung." },
    ],
  },
  {
    id: "tactics",
    topic: "{name} thinks he's being played out of position and wants answers.",
    options: [
      { text: "Adapt the role to suit him", delta: 6, reply: "He's on board. “Now we're talking.”" },
      { text: "Explain the bigger plan", delta: 3, reply: "He listens. “Alright, I trust you.”" },
      { text: "Tell him to follow orders", delta: -6, reply: "Jaw clenched. “Yes, boss.” He's seething." },
    ],
  },
];

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The (deterministic) conversation a given player raises in a given season. */
export function pickConversation(playerKey: string, season: number): Conversation {
  return CONVERSATIONS[hash(`${playerKey}-${season}`) % CONVERSATIONS.length];
}
