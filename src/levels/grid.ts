// ---------------------------------------------------------------------------
// XAUUSD Static Level Grid — Exact Chart Extraction
//
// Source: Manual chart analysis (TradingView XAUUSD, 2026-04-15)
// Every level and zone corresponds to a drawn line on the reference chart.
//
// Level categories:
//   extreme     — Structural extremes (highest/lowest)
//   zone-edge   — Edges of institutional supply/demand zones
//   transition  — Regime boundary between supply & demand territory
//   pivot       — Intraday S/R pivot
//   key-support — Institutional floor / ceiling
//   deep        — Deep structural support
//
// Zones (user-drawn rectangles):
//   5225–5250, 5194–5218, 5135–5156           ← Supply
//   5027–5061, 4989–5027, 4944–4966, 4857–4882 ← Transition / Pivot
//   4745–4778, 4569–4581, 4485–4521           ← Demand
//
// ⚠ UPDATE when price establishes new structural levels.
// ---------------------------------------------------------------------------

export interface PriceLevel {
  price: number;
  category: "extreme" | "zone-edge" | "transition" | "pivot" | "indicator" | "key-support" | "deep";
  type: "resistance" | "support" | "pivot";
  strength: number; // 0–1
  label: string;
}

export interface PriceZone {
  min: number;
  max: number;
  type: "supply" | "demand" | "transition";
  strength: number;
  label: string;
}

// ---------------------------------------------------------------------------
// Key Levels — ordered from highest to lowest
// ---------------------------------------------------------------------------

export const LEVELS: PriceLevel[] = [
  // ── Extreme / Top ──
  { price: 5260,  category: "extreme",     type: "resistance", strength: 0.95, label: "极限阻力-5260" },
  { price: 5250,  category: "zone-edge",   type: "resistance", strength: 0.92, label: "供给区I顶-5250" },
  { price: 5225,  category: "zone-edge",   type: "resistance", strength: 0.88, label: "供给区I底-5225" },

  // ── Supply Zone II ──
  { price: 5218,  category: "zone-edge",   type: "resistance", strength: 0.88, label: "供给区II顶-5218" },
  { price: 5194,  category: "zone-edge",   type: "resistance", strength: 0.85, label: "供给区II底-5194" },

  // ── Supply Zone III ──
  { price: 5156,  category: "zone-edge",   type: "resistance", strength: 0.82, label: "供给区III顶-5156" },
  { price: 5135,  category: "zone-edge",   type: "resistance", strength: 0.80, label: "供给区III底-5135" },

  // ── Upper Transition ──
  { price: 5061,  category: "transition",  type: "resistance", strength: 0.78, label: "过渡区上顶-5061" },
  { price: 5027,  category: "transition",  type: "pivot",      strength: 0.82, label: "关键枢轴-5027" },
  { price: 4989,  category: "transition",  type: "pivot",      strength: 0.76, label: "过渡区下底-4989" },

  // ── Mid-Range Pivots ──
  { price: 4966,  category: "pivot",       type: "pivot",      strength: 0.72, label: "枢轴区顶-4966" },
  { price: 4944,  category: "pivot",       type: "pivot",      strength: 0.70, label: "枢轴区底-4944" },
  { price: 4882,  category: "pivot",       type: "resistance", strength: 0.75, label: "近端阻力-4882" },
  { price: 4857,  category: "pivot",       type: "support",    strength: 0.72, label: "近端支撑-4857" },

  // ── Support Territory ──
  { price: 4778,  category: "key-support", type: "support",    strength: 0.80, label: "支撑区顶-4778" },
  { price: 4745,  category: "key-support", type: "support",    strength: 0.82, label: "支撑区底-4745" },

  // ── Key Institutional Floor ──
  { price: 4630,  category: "key-support", type: "support",    strength: 0.92, label: "机构防守-4630" },

  // ── Demand Zones ──
  { price: 4581,  category: "key-support", type: "support",    strength: 0.78, label: "需求区I顶-4581" },
  { price: 4569,  category: "key-support", type: "support",    strength: 0.80, label: "需求区I底-4569" },
  { price: 4521,  category: "deep",        type: "support",    strength: 0.85, label: "需求区II顶-4521" },
  { price: 4485,  category: "deep",        type: "support",    strength: 0.88, label: "需求区II底-4485" },

  // ── Deep Support ──
  { price: 4400,  category: "deep",        type: "support",    strength: 0.92, label: "极限支撑-4400" },
];

// ---------------------------------------------------------------------------
// Key Zones — user-drawn rectangles
// ---------------------------------------------------------------------------

export const ZONES: PriceZone[] = [
  // ── Supply ──
  { min: 5225, max: 5250, type: "supply",      strength: 0.92, label: "供给区I" },
  { min: 5194, max: 5218, type: "supply",      strength: 0.88, label: "供给区II" },
  { min: 5135, max: 5156, type: "supply",      strength: 0.85, label: "供给区III" },

  // ── Transition ──
  { min: 5027, max: 5061, type: "transition",  strength: 0.78, label: "过渡区上" },
  { min: 4989, max: 5027, type: "transition",  strength: 0.76, label: "过渡区下" },
  { min: 4944, max: 4966, type: "transition",  strength: 0.70, label: "枢轴区" },
  { min: 4857, max: 4882, type: "transition",  strength: 0.72, label: "近端枢轴" },

  // ── Demand ──
  { min: 4745, max: 4778, type: "demand",      strength: 0.82, label: "支撑区" },
  { min: 4569, max: 4581, type: "demand",      strength: 0.80, label: "需求区I" },
  { min: 4485, max: 4521, type: "demand",      strength: 0.88, label: "需求区II" },
];

// ---------------------------------------------------------------------------
// Query Functions
// ---------------------------------------------------------------------------

export function resistancesAbove(price: number, limit = 4): PriceLevel[] {
  return LEVELS
    .filter((l) => l.price > price + 0.5 && (l.type === "resistance" || l.type === "pivot"))
    .sort((a, b) => a.price - b.price)
    .slice(0, limit);
}

export function supportsBelow(price: number, limit = 4): PriceLevel[] {
  return LEVELS
    .filter((l) => l.price < price - 0.5 && (l.type === "support" || l.type === "pivot"))
    .sort((a, b) => b.price - a.price)
    .slice(0, limit);
}

export function activeZone(price: number): PriceZone | null {
  for (const zone of ZONES) {
    if (price >= zone.min && price <= zone.max) return zone;
  }
  return null;
}

export function proximityWeight(price: number, level: number, sigma: number): number {
  return Math.exp(-((price - level) ** 2) / (2 * sigma ** 2));
}

export function strongestMagnet(price: number, sigma = 30): PriceLevel | null {
  let best: PriceLevel | null = null;
  let bestScore = 0;
  for (const level of LEVELS) {
    const prox = proximityWeight(price, level.price, sigma);
    const score = level.strength * prox;
    if (score > bestScore) { bestScore = score; best = level; }
  }
  return best;
}

/** Price position within the full level grid (0 = deep support, 1 = extreme resistance). */
export function gridPosition(price: number): number {
  const lo = LEVELS[LEVELS.length - 1].price;
  const hi = LEVELS[0].price;
  return hi === lo ? 0.5 : Math.max(0, Math.min(1, (price - lo) / (hi - lo)));
}

/** Distance to nearest zone boundary. */
export function distanceToNearestZone(price: number): { zone: PriceZone; distance: number; side: "above" | "below" | "inside" } | null {
  let best: ReturnType<typeof distanceToNearestZone> = null;
  for (const zone of ZONES) {
    if (price >= zone.min && price <= zone.max) {
      return { zone, distance: 0, side: "inside" };
    }
    const dUp = zone.min - price;
    const dDown = price - zone.max;
    const dist = dUp > 0 ? dUp : dDown;
    const side = dUp > 0 ? "below" as const : "above" as const;
    if (!best || Math.abs(dist) < Math.abs(best.distance)) {
      best = { zone, distance: dist, side };
    }
  }
  return best;
}
