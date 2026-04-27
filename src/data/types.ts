export type DataSourceName =
  | "yahoo"
  | "pepperstone"
  | "rithmic"
  | "manual"
  | "fred"
  | "cftc";

export type InstrumentKind = "futures_proxy" | "futures" | "broker_spot" | "macro" | "manual";

export type Timeframe = "1m" | "5m" | "15m" | "1h" | "1d";

export type FuturesFlowStatus = "confirmed" | "proxy-only" | "unknown";

export interface SourceHealth {
  source: DataSourceName;
  ok: boolean;
  lastUpdateMs: number;
  ageMs: number;
  latencyMs: number;
  stale: boolean;
  error?: string;
  warning?: string;
  feed?: string;
  sidecar?: string;
  sessionVerified?: boolean;
  testData?: boolean;
  qualityScore: number;
}

export interface MarketTick {
  symbol: string;
  source: DataSourceName;
  instrumentKind: InstrumentKind;
  timestampMs: number;
  bid?: number;
  ask?: number;
  mid: number;
  last?: number;
  volume?: number;
  qualityScore?: number;
  feed?: string;
  sidecar?: string;
  sessionVerified?: boolean;
  testData?: boolean;
  exchange?: string;
  contract?: string;
  raw?: unknown;
}

export interface Candle {
  symbol: string;
  source: DataSourceName;
  instrumentKind: InstrumentKind;
  timeframe: Timeframe;
  startMs: number;
  endMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  tickCount: number;
  vwap?: number;
  complete: boolean;
  qualityScore: number;
  completenessRatio?: number;
}

export interface DataProvider {
  name: DataSourceName;
  fetchLatestTick?: (symbol?: string) => Promise<MarketTick | null>;
  fetchRecentCandles?: (symbol: string, timeframe: Timeframe, count: number) => Promise<Candle[]>;
  getHealth: () => SourceHealth;
}

export interface AnalysisPrice {
  symbol: string;
  source: DataSourceName;
  instrumentKind: InstrumentKind;
  timestampMs: number;
  price: number;
  previousClose?: number;
  dailyChange?: number;
  dailyChangePct?: number;
  fallback: boolean;
}

export interface BrokerBasis {
  available: boolean;
  futuresMinusBroker?: number;
  brokerSpread?: number;
}

export interface BarCoverage {
  m1: number;
  m5: number;
  m15: number;
  h1: number;
  m1CompleteRatio: number;
  m5CompleteRatio: number;
  m15CompleteRatio: number;
  h1CompleteRatio: number;
}

export interface DataQualityPolicy {
  minSourceQuality: number;
  maxBrokerSpread: number;
}

export interface DataSnapshot {
  asOfMs: number;
  primary: AnalysisPrice;
  gcTick: MarketTick | null;
  gcCandle: Candle | null;
  xauBrokerTick: MarketTick | null;
  basis: BrokerBasis;
  activePrimaryHealth: SourceHealth;
  brokerHealth: SourceHealth;
  optionalSourceHealth: SourceHealth[];
  sourceHealth: SourceHealth[];
  futuresFlowStatus: FuturesFlowStatus;
  qualityPolicy?: DataQualityPolicy;
  bars: {
    m1: Candle[];
    m5: Candle[];
    m15: Candle[];
    h1: Candle[];
  };
  barCoverage: BarCoverage;
}
