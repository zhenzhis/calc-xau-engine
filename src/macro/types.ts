import { SourceHealth } from "../data/types.js";

export interface MacroSnapshot {
  asOfMs: number;
  dxy?: number;
  us2y?: number;
  us10y?: number;
  realYield10y?: number;
  usdJpy?: number;
  eurUsd?: number;
  xagUsd?: number;
  vix?: number;
  sourceHealth: SourceHealth[];
}

export interface MacroDrivers {
  dollarPressure: number;
  ratesPressure: number;
  realYieldPressure: number;
  riskOffPressure: number;
  silverConfirmation: number;
  macroBias: "bullish-gold" | "bearish-gold" | "mixed" | "unknown";
}

export function emptyMacroDrivers(): MacroDrivers {
  return {
    dollarPressure: 0,
    ratesPressure: 0,
    realYieldPressure: 0,
    riskOffPressure: 0,
    silverConfirmation: 0,
    macroBias: "unknown"
  };
}
