import { mkdir, readFile, appendFile } from "node:fs/promises";
import { dirname } from "node:path";

import { GoldAnalysis } from "../analysis/types.js";

export interface ResearchSnapshot {
  timestamp: number;
  price: number;
  source: string;
  symbol: string;
  session?: string;
  state: {
    trend: string;
    regime: string;
    setup: string;
    tradePermission: string;
  };
  drivers: GoldAnalysis["drivers"];
  confidence: number;
  scores: {
    breakoutScoreUp: number;
    breakoutScoreDown: number;
    tfConfluence: number;
  };
  eventRisk: GoldAnalysis["eventRisk"];
  levels: Array<{
    price: number;
    label: string;
    status: string;
  }>;
}

function setupLabel(analysis: GoldAnalysis): string {
  if (analysis.eventRisk.tradePermission === "blocked") return "NO-TRADE";
  if (analysis.eventRisk.tradePermission === "watch-only") return "WATCH";
  if (analysis.trend === "bullish" && analysis.signal.direction !== "FLAT") return "LONG-PULLBACK";
  if (analysis.trend === "bearish" && analysis.signal.direction !== "FLAT") return "SHORT-REJECTION";
  return "RANGE-WATCH";
}

export function toResearchSnapshot(analysis: GoldAnalysis, session?: string): ResearchSnapshot {
  return {
    timestamp: analysis.asOf * 1000,
    price: analysis.price,
    source: analysis.data.snapshot.primary.source,
    symbol: analysis.symbol,
    session,
    state: {
      trend: analysis.trend,
      regime: analysis.regime,
      setup: setupLabel(analysis),
      tradePermission: analysis.eventRisk.tradePermission
    },
    drivers: analysis.drivers,
    confidence: analysis.confidence,
    scores: {
      breakoutScoreUp: analysis.breakoutScoreUp,
      breakoutScoreDown: analysis.breakoutScoreDown,
      tfConfluence: analysis.tf.confluence
    },
    eventRisk: analysis.eventRisk,
    levels: analysis.levelStates.slice(0, 12).map((level) => ({
      price: level.price,
      label: level.label,
      status: level.status
    }))
  };
}

export class AnalysisSnapshotStore {
  constructor(private readonly path: string) {}

  async append(analysis: GoldAnalysis, session?: string): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const snapshot = toResearchSnapshot(analysis, session);
    await appendFile(this.path, `${JSON.stringify(snapshot)}\n`, "utf8");
  }

  async readAll(): Promise<ResearchSnapshot[]> {
    try {
      const raw = await readFile(this.path, "utf8");
      return raw
        .split(/\r?\n/)
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as ResearchSnapshot)
        .filter((snapshot) => Number.isFinite(snapshot.timestamp) && Number.isFinite(snapshot.price))
        .sort((a, b) => a.timestamp - b.timestamp);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
}
