// ---------------------------------------------------------------------------
// XAUUSD Static Level Grid — Exact Chart Extraction
//
// Source: Manual chart analysis (TradingView XAUUSD, 2026-04-14)
// Every level corresponds to a drawn line on the reference chart.
//
// Level categories:
//   extreme     — Blue solid lines (structural highs/lows)
//   zone        — Purple/Magenta filled regions (institutional S/D)
//   transition  — Red dashed lines (regime boundary)
//   pivot       — Gray dashed lines (intraday S/R pivot)
//   indicator   — Green/Blue right-axis labels (MA cluster)
//   key-support — Red solid lines (institutional floor)
//   deep        — Red labels at chart bottom (swing low cluster)
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
  // ── Extreme Resistance (blue solid) ──
  { price: 5300,      category: "extreme",     type: "resistance", strength: 0.95, label: "极限阻力-5300" },

  // ── Supply Zone Edge Levels (purple zone) ──
  { price: 5260.836,  category: "zone-edge",   type: "resistance", strength: 0.90, label: "供给区顶-5261" },
  { price: 5250.547,  category: "zone-edge",   type: "resistance", strength: 0.90, label: "供给区上沿-5251" },
  { price: 5200,      category: "zone-edge",   type: "resistance", strength: 0.88, label: "供给区中轴-5200" },
  { price: 5150,      category: "zone-edge",   type: "resistance", strength: 0.85, label: "供给区下沿-5150" },

  // ── Transition Resistance (red dashed) ──
  { price: 5100,      category: "transition",  type: "resistance", strength: 0.78, label: "过渡阻力-5100" },
  { price: 5050,      category: "transition",  type: "resistance", strength: 0.82, label: "过渡阻力-5050" },

  // ── Mid-Range Pivots (gray dashed cluster) ──
  { price: 5000,      category: "pivot",       type: "pivot",      strength: 0.80, label: "整数关口-5000" },
  { price: 4950,      category: "pivot",       type: "pivot",      strength: 0.65, label: "枢轴-4950" },
  { price: 4900,      category: "pivot",       type: "pivot",      strength: 0.72, label: "枢轴-4900" },
  { price: 4850,      category: "pivot",       type: "pivot",      strength: 0.68, label: "枢轴-4850" },

  // ── Moving Average Cluster (indicator labels) ──
  { price: 4807.161,  category: "indicator",   type: "support",    strength: 0.75, label: "MA均线-4807" },
  { price: 4787.711,  category: "indicator",   type: "support",    strength: 0.72, label: "MA均线-4788" },
  { price: 4768.261,  category: "indicator",   type: "support",    strength: 0.70, label: "MA均线-4768" },

  // ── Key Support (red solid + gray dashed) ──
  { price: 4700,      category: "pivot",       type: "support",    strength: 0.75, label: "支撑-4700" },
  { price: 4650,      category: "key-support", type: "support",    strength: 0.88, label: "关键支撑-4650" },
  { price: 4630.457,  category: "key-support", type: "support",    strength: 0.90, label: "机构底线-4630" },

  // ── Secondary Support (gray dashed) ──
  { price: 4600,      category: "pivot",       type: "support",    strength: 0.68, label: "支撑-4600" },
  { price: 4550,      category: "pivot",       type: "support",    strength: 0.65, label: "支撑-4550" },
  { price: 4500,      category: "pivot",       type: "support",    strength: 0.78, label: "整数关口-4500" },
  { price: 4450,      category: "pivot",       type: "support",    strength: 0.62, label: "支撑-4450" },
  { price: 4400,      category: "pivot",       type: "support",    strength: 0.70, label: "支撑-4400" },

  // ── Deep Support Cluster (red labels at bottom) ──
  { price: 4266.281,  category: "deep",        type: "support",    strength: 0.92, label: "深度支撑-4266" },
  { price: 4257.600,  category: "deep",        type: "support",    strength: 0.92, label: "深度支撑-4258" },
  { price: 4245.574,  category: "deep",        type: "support",    strength: 0.92, label: "深度支撑-4246" },
];

// ---------------------------------------------------------------------------
// Key Zones
// ---------------------------------------------------------------------------

export const ZONES: PriceZone[] = [
  // Primary supply zone (purple/magenta band)
  { min: 5150, max: 5261, type: "supply",      strength: 0.92, label: "主要供给区" },

  // Transition zone (red dashed + gray dashed cluster)
  { min: 5000, max: 5100, type: "transition",   strength: 0.75, label: "过渡区" },

  // Institutional floor zone (red solid lines)
  { min: 4630, max: 4650, type: "demand",       strength: 0.90, label: "机构防守区" },

  // Deep structural demand (red label cluster)
  { min: 4245, max: 4267, type: "demand",       strength: 0.92, label: "结构底部" },
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

/** Price position within the full level grid as a ratio (0 = deep support, 1 = extreme resistance). */
export function gridPosition(price: number): number {
  const lo = LEVELS[LEVELS.length - 1].price;
  const hi = LEVELS[0].price;
  return hi === lo ? 0.5 : Math.max(0, Math.min(1, (price - lo) / (hi - lo)));
}

/** Distance to nearest zone boundary (positive = above, negative = below). */
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
