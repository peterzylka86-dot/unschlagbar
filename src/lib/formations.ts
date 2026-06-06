import type { Formation, FormationKey, Slot, Position } from "./game-types";

function mk(pos: Position, x: number, y: number, idx: number): Slot {
  return { id: `${pos}-${idx}`, position: pos, x, y };
}

// y: 92 = our GK area (bottom), 8 = opponent goal
function build(layout: Array<{ pos: Position; positions: Array<[number, number]> }>): Slot[] {
  const slots: Slot[] = [];
  let i = 0;
  for (const row of layout) {
    for (const [x, y] of row.positions) slots.push(mk(row.pos, x, y, i++));
  }
  return slots;
}

export const FORMATIONS: Record<FormationKey, Formation> = {
  "4-3-3": {
    key: "4-3-3", label: "4-3-3",
    description: "Attacking with width. Three forwards create constant threat.",
    slots: build([
      { pos: "GK",  positions: [[50, 90]] },
      { pos: "LB",  positions: [[12, 72]] },
      { pos: "CB",  positions: [[35, 76]] },
      { pos: "CB",  positions: [[65, 76]] },
      { pos: "RB",  positions: [[88, 72]] },
      { pos: "CM",  positions: [[25, 52]] },
      { pos: "CM",  positions: [[50, 56]] },
      { pos: "CM",  positions: [[75, 52]] },
      { pos: "LW",  positions: [[15, 22]] },
      { pos: "ST",  positions: [[50, 16]] },
      { pos: "RW",  positions: [[85, 22]] },
    ]),
  },
  "4-4-2": {
    key: "4-4-2", label: "4-4-2",
    description: "Classic. Two strikers, two banks of four.",
    slots: build([
      { pos: "GK",  positions: [[50, 90]] },
      { pos: "LB",  positions: [[12, 72]] },
      { pos: "CB",  positions: [[35, 76]] },
      { pos: "CB",  positions: [[65, 76]] },
      { pos: "RB",  positions: [[88, 72]] },
      { pos: "LW",  positions: [[12, 46]] },
      { pos: "CM",  positions: [[36, 50]] },
      { pos: "CM",  positions: [[64, 50]] },
      { pos: "RW",  positions: [[88, 46]] },
      { pos: "ST",  positions: [[36, 18]] },
      { pos: "ST",  positions: [[64, 18]] },
    ]),
  },
  "4-2-3-1": {
    key: "4-2-3-1", label: "4-2-3-1",
    description: "Modern double pivot with a creative ten.",
    slots: build([
      { pos: "GK",  positions: [[50, 90]] },
      { pos: "LB",  positions: [[12, 72]] },
      { pos: "CB",  positions: [[35, 76]] },
      { pos: "CB",  positions: [[65, 76]] },
      { pos: "RB",  positions: [[88, 72]] },
      { pos: "CDM", positions: [[35, 55]] },
      { pos: "CDM", positions: [[65, 55]] },
      { pos: "LW",  positions: [[15, 30]] },
      { pos: "CAM", positions: [[50, 36]] },
      { pos: "RW",  positions: [[85, 30]] },
      { pos: "ST",  positions: [[50, 14]] },
    ]),
  },
  "4-5-1": {
    key: "4-5-1", label: "4-5-1",
    description: "Stacked midfield, one striker up top.",
    slots: build([
      { pos: "GK",  positions: [[50, 90]] },
      { pos: "LB",  positions: [[12, 72]] },
      { pos: "CB",  positions: [[35, 76]] },
      { pos: "CB",  positions: [[65, 76]] },
      { pos: "RB",  positions: [[88, 72]] },
      { pos: "LW",  positions: [[12, 46]] },
      { pos: "CM",  positions: [[30, 50]] },
      { pos: "CM",  positions: [[50, 52]] },
      { pos: "CM",  positions: [[70, 50]] },
      { pos: "RW",  positions: [[88, 46]] },
      { pos: "ST",  positions: [[50, 16]] },
    ]),
  },
  "3-4-3": {
    key: "3-4-3", label: "3-4-3",
    description: "Three at the back, wing-backs push high.",
    slots: build([
      { pos: "GK",  positions: [[50, 90]] },
      { pos: "CB",  positions: [[22, 76]] },
      { pos: "CB",  positions: [[50, 78]] },
      { pos: "CB",  positions: [[78, 76]] },
      { pos: "LB",  positions: [[10, 50]] },
      { pos: "CM",  positions: [[38, 52]] },
      { pos: "CM",  positions: [[62, 52]] },
      { pos: "RB",  positions: [[90, 50]] },
      { pos: "LW",  positions: [[18, 22]] },
      { pos: "ST",  positions: [[50, 16]] },
      { pos: "RW",  positions: [[82, 22]] },
    ]),
  },
  "3-5-2": {
    key: "3-5-2", label: "3-5-2",
    description: "Compact midfield, two strikers combine.",
    slots: build([
      { pos: "GK",  positions: [[50, 90]] },
      { pos: "CB",  positions: [[22, 76]] },
      { pos: "CB",  positions: [[50, 78]] },
      { pos: "CB",  positions: [[78, 76]] },
      { pos: "LB",  positions: [[10, 50]] },
      { pos: "CM",  positions: [[32, 52]] },
      { pos: "CDM", positions: [[50, 58]] },
      { pos: "CM",  positions: [[68, 52]] },
      { pos: "RB",  positions: [[90, 50]] },
      { pos: "ST",  positions: [[36, 18]] },
      { pos: "ST",  positions: [[64, 18]] },
    ]),
  },
  "5-4-1": {
    key: "5-4-1", label: "5-4-1",
    description: "Defensive lockdown, counter-attack lone striker.",
    slots: build([
      { pos: "GK",  positions: [[50, 90]] },
      { pos: "LB",  positions: [[10, 70]] },
      { pos: "CB",  positions: [[30, 76]] },
      { pos: "CB",  positions: [[50, 78]] },
      { pos: "CB",  positions: [[70, 76]] },
      { pos: "RB",  positions: [[90, 70]] },
      { pos: "LW",  positions: [[14, 46]] },
      { pos: "CM",  positions: [[38, 50]] },
      { pos: "CM",  positions: [[62, 50]] },
      { pos: "RW",  positions: [[86, 46]] },
      { pos: "ST",  positions: [[50, 16]] },
    ]),
  },
};

export const FORMATION_KEYS = Object.keys(FORMATIONS) as FormationKey[];
