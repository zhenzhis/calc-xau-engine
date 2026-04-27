import { ResearchSnapshot } from "./snapshot-store.js";

export interface OutcomeLabels {
  forwardReturn15m?: number;
  forwardReturn1h?: number;
  forwardReturn4h?: number;
  maxAdverseExcursion1h?: number;
  maxFavorableExcursion1h?: number;
}

export interface LabeledResearchSnapshot extends ResearchSnapshot {
  outcomes: OutcomeLabels;
}

const HORIZONS = {
  m15: 15 * 60_000,
  h1: 60 * 60_000,
  h4: 4 * 60 * 60_000
};

function directionalSide(snapshot: ResearchSnapshot): "long" | "short" | null {
  if (snapshot.state.setup === "LONG-PULLBACK") return "long";
  if (snapshot.state.setup === "SHORT-REJECTION") return "short";
  return null;
}

function firstAtOrAfter(
  snapshots: ResearchSnapshot[],
  startIndex: number,
  timestamp: number
): ResearchSnapshot | undefined {
  for (let i = startIndex + 1; i < snapshots.length; i++) {
    if (snapshots[i].timestamp >= timestamp) return snapshots[i];
  }
  return undefined;
}

function forwardReturn(current: ResearchSnapshot, future?: ResearchSnapshot): number | undefined {
  if (!future || current.price <= 0) return undefined;
  return future.price / current.price - 1;
}

function excursion1h(
  snapshots: ResearchSnapshot[],
  index: number
): Pick<OutcomeLabels, "maxAdverseExcursion1h" | "maxFavorableExcursion1h"> {
  const current = snapshots[index];
  const side = directionalSide(current);
  const window = snapshots.filter(
    (snapshot) => snapshot.timestamp > current.timestamp && snapshot.timestamp <= current.timestamp + HORIZONS.h1
  );
  if (!side || window.length === 0 || current.price <= 0) return {};

  const returns = window.map((snapshot) => snapshot.price / current.price - 1);
  if (side === "long") {
    return {
      maxAdverseExcursion1h: Math.min(...returns),
      maxFavorableExcursion1h: Math.max(...returns)
    };
  }
  return {
    maxAdverseExcursion1h: -Math.max(...returns),
    maxFavorableExcursion1h: -Math.min(...returns)
  };
}

export function labelOutcomes(snapshots: ResearchSnapshot[]): LabeledResearchSnapshot[] {
  return snapshots.map((snapshot, index) => ({
    ...snapshot,
    outcomes: {
      forwardReturn15m: forwardReturn(snapshot, firstAtOrAfter(snapshots, index, snapshot.timestamp + HORIZONS.m15)),
      forwardReturn1h: forwardReturn(snapshot, firstAtOrAfter(snapshots, index, snapshot.timestamp + HORIZONS.h1)),
      forwardReturn4h: forwardReturn(snapshot, firstAtOrAfter(snapshots, index, snapshot.timestamp + HORIZONS.h4)),
      ...excursion1h(snapshots, index)
    }
  }));
}
