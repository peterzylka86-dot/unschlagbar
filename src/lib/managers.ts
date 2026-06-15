/**
 * AI rival-manager personas — the Anstoss touch. Each rival club gets a
 * gaffer with a name, an archetype trait, and a pre-match needle, assigned
 * deterministically by club id. Pure flavour, zero state.
 *
 * Used in Legends mode (your AI-drafted rivals); Real mode faces real clubs,
 * so it leaves their managers alone.
 */

export interface ManagerPersona {
  name: string;
  trait: string;
  quip: string;
}

const PERSONAS: ManagerPersona[] = [
  { name: "Reg Hawthorne", trait: "The Professor", quip: "We'll out-think them. We always do." },
  { name: "Big Don Maslin", trait: "The Tank", quip: "Get it forward and rattle their cages." },
  { name: "Vittorio Sacca", trait: "The Catenaccio", quip: "Score one, we'll bolt the door." },
  { name: "Henk de Vries", trait: "Total Football", quip: "We pass them dizzy or we lose. No bus." },
  { name: "Jock Ferguson", trait: "The Hairdryer", quip: "My lads fear me more than they fear you." },
  { name: "Luis Cordero", trait: "The Tinkerman", quip: "You'll never guess my XI. Nor will I." },
  { name: "Otto Brandt", trait: "The Sergeant", quip: "Discipline beats talent. Watch." },
  { name: "Marco Bellini", trait: "The Showman", quip: "We came to entertain — and to win." },
  { name: "Pat Doherty", trait: "The Motivator", quip: "Heart beats money in this league." },
  { name: "Sven Åkerlund", trait: "The Analyst", quip: "I've watched 40 hours of your tape." },
  { name: "Diego Salas", trait: "The Firebrand", quip: "We press from the first whistle to the last." },
  { name: "Wilf Bramble", trait: "The Pragmatist", quip: "Ugly wins still count, son." },
  { name: "Karel Novák", trait: "The Architect", quip: "We build from the back. Patiently." },
  { name: "Tunde Bakare", trait: "The Spark", quip: "Pace kills. We've got plenty." },
  { name: "Gianni Rossi", trait: "The Veteran", quip: "I've seen it all. You won't surprise me." },
  { name: "Émile Laurent", trait: "The Maverick", quip: "Tactics? My boys just play." },
];

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic persona for a rival club id. */
export function managerFor(rivalId: string): ManagerPersona {
  return PERSONAS[hash(rivalId) % PERSONAS.length];
}
