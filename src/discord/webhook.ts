import {
  GoldAnalysis,
  GoldPublishState,
  MarketRegime,
  TrendDirection,
  VolatilityRegime
} from "../analysis/types.js";
import { RuntimeConfig } from "../types.js";

function fp(v: number): string { return `$${v.toFixed(2)}`; }
function fSigned(v: number): string { return `${v >= 0 ? "+" : ""}${v.toFixed(2)}`; }
function fPct(v: number): string { return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`; }

function ageLabel(ageMs: number): string {
  if (!Number.isFinite(ageMs)) return "unavailable";
  if (ageMs < 1_000) return `${ageMs.toFixed(0)}ms`;
  if (ageMs < 60_000) return `${(ageMs / 1_000).toFixed(0)}s`;
  return `${(ageMs / 60_000).toFixed(1)}m`;
}

function truncate(value: string, max = 1000): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function regimeLabel(regime: MarketRegime): string {
  const labels: Record<MarketRegime, string> = {
    "trending-up": "trend-up",
    "trending-down": "trend-down",
    ranging: "range",
    volatile: "volatile",
    consolidation: "consolidation"
  };
  return labels[regime];
}

function trendLabel(trend: TrendDirection): string {
  return trend === "bullish" ? "bullish" : trend === "bearish" ? "bearish" : "neutral";
}

function volLabel(vol: VolatilityRegime): string {
  const labels: Record<VolatilityRegime, string> = {
    low: "low",
    normal: "normal",
    high: "high",
    extreme: "extreme"
  };
  return labels[vol];
}

function embedColor(a: GoldAnalysis): number {
  if (a.data.sourceHealth.some((h) => h.qualityScore < 60)) return 0xd29922;
  if (a.eventRisk.tradePermission === "blocked") return 0xff4444;
  if (a.trend === "bullish") return 0x3fb950;
  if (a.trend === "bearish") return 0xff7b72;
  return 0x8b949e;
}

function sourceLabel(a: GoldAnalysis): string {
  const primary = a.data.snapshot.primary;
  const broker = a.data.snapshot.xauBrokerTick;
  if (primary.source === "rithmic" && broker) return "Rithmic+Pepperstone";
  if (primary.source === "rithmic") return "Rithmic";
  if (primary.source === "yahoo") return "Yahoo fallback";
  return primary.source;
}

function stateLabel(a: GoldAnalysis): "LONG-PULLBACK" | "SHORT-REJECTION" | "RANGE-WATCH" | "NO-TRADE" {
  if (a.eventRisk.tradePermission === "blocked") return "NO-TRADE";
  if (a.data.sourceHealth.some((h) => h.source === a.data.snapshot.primary.source && h.qualityScore < 25)) {
    return "NO-TRADE";
  }
  if (a.trend === "bullish" && a.signal.direction !== "FLAT") return "LONG-PULLBACK";
  if (a.trend === "bearish" && a.signal.direction !== "FLAT") return "SHORT-REJECTION";
  return "RANGE-WATCH";
}

function preferredAction(a: GoldAnalysis): string {
  if (a.eventRisk.tradePermission === "blocked") return "No trade";
  if (a.eventRisk.tradePermission === "watch-only") return "Watch only";
  const state = stateLabel(a);
  if (state === "LONG-PULLBACK") return "Long pullback watch";
  if (state === "SHORT-REJECTION") return "Short rejection watch";
  if (state === "RANGE-WATCH") return "Range watch";
  return "No trade";
}

function sourceHealthText(a: GoldAnalysis): string {
  return a.data.sourceHealth
    .map((h) => `${h.source}:${h.qualityScore}${h.stale ? "/stale" : ""}`)
    .join(",");
}

function eventLine(a: GoldAnalysis): string {
  if (a.eventRisk.mode === "normal") return "Event Risk: normal";
  const event = a.eventRisk.nearestEvent;
  const eventName = event ? `${event.name} <t:${Math.floor(event.scheduledTimeMs / 1000)}:R>` : "high-impact event";
  const mode =
    a.eventRisk.mode === "pre-event" ? "WATCH ONLY"
    : a.eventRisk.mode === "shock" ? "SHOCK MODE"
    : "confirmation required";
  return `Event Risk: ${eventName} -> ${mode}`;
}

function topDrivers(a: GoldAnalysis): string {
  const drivers: Array<{ weight: number; line: string }> = [];
  const macro = a.macroDrivers;
  if (macro.realYieldPressure !== 0) {
    drivers.push({
      weight: Math.abs(macro.realYieldPressure),
      line: `Real yield ${macro.realYieldPressure > 0 ? "down/soft: supports gold" : "up/firm: pressures gold"}`
    });
  }
  if (macro.ratesPressure !== 0) {
    drivers.push({
      weight: Math.abs(macro.ratesPressure),
      line: `Rates ${macro.ratesPressure > 0 ? "soft: supports gold" : "firm: pressures gold"}`
    });
  }
  drivers.push({
    weight: Math.abs(a.drivers.tfConfluence),
    line: `Timeframe confluence ${a.tf.confluence.toFixed(2)}: ${a.tf.confluence > 0 ? "supports upside" : a.tf.confluence < 0 ? "supports downside" : "mixed"}`
  });
  drivers.push({
    weight: Math.abs(a.drivers.vrBias),
    line: `Variance ratio ${a.varianceRatio?.toFixed(2) ?? "n/a"}: ${a.drivers.vrBias > 0 ? "trend persistence" : "mean-reversion pressure"}`
  });
  drivers.push({
    weight: Math.abs(a.drivers.zoneInfluence),
    line: `Level/zone influence: ${a.drivers.zoneInfluence > 0 ? "supports gold" : a.drivers.zoneInfluence < 0 ? "pressures gold" : "neutral"}`
  });
  drivers.push({
    weight: Math.abs(a.drivers.volatilityScore),
    line: `Volatility ${volLabel(a.volRegime)}: ${a.volRegime === "high" || a.volRegime === "extreme" ? "requires confirmation" : "normal conditions"}`
  });

  return drivers
    .sort((aDriver, bDriver) => bDriver.weight - aDriver.weight)
    .slice(0, 5)
    .map((driver) => `- ${driver.line}`)
    .join("\n");
}

function levelStatus(a: GoldAnalysis, price: number): string {
  const state = a.levelStates.find((level) => Math.abs(level.price - price) < 1);
  return state?.status ?? "stale";
}

function keyLevels(a: GoldAnalysis): string {
  const lines: string[] = ["```"];
  for (const price of a.resistanceLevels.slice(0, 3).reverse()) {
    lines.push(`R  ${price.toFixed(0).padStart(5)}  ${levelStatus(a, price)}`);
  }
  lines.push(`-- ${a.price.toFixed(0).padStart(5)}  now`);
  for (const price of a.supportLevels.slice(0, 3)) {
    lines.push(`S  ${price.toFixed(0).padStart(5)}  ${levelStatus(a, price)}`);
  }
  lines.push("```");
  return lines.join("\n");
}

function setupField(a: GoldAnalysis): string {
  const setupValid = a.eventRisk.tradePermission === "allowed" && stateLabel(a) !== "NO-TRADE";
  const invalidation =
    a.trend === "bullish" ? a.nearestSupport?.price
    : a.trend === "bearish" ? a.nearestResistance?.price
    : undefined;
  const conditions = [
    a.eventRisk.tradePermission === "allowed" ? "event gate clear" : `event gate=${a.eventRisk.tradePermission}`,
    a.data.sourceHealth.some((h) => h.qualityScore < 60) ? "improve source quality" : "source quality acceptable",
    Math.abs(a.tf.confluence) >= 0.5 ? "multi-timeframe aligned" : "need timeframe confirmation"
  ];

  const lines = [
    `Preferred action: ${preferredAction(a)}`,
    `Invalidation: ${invalidation !== undefined ? fp(invalidation) : "range break required"}`,
    `Conditions needed: ${conditions.join("; ")}`
  ];
  if (setupValid && a.signal.targets.length > 0) {
    lines.push(`Targets: ${a.signal.targets.slice(0, 2).map(fp).join(" / ")}`);
  }
  if (a.patternWatch) {
    lines.push(`Pattern watch: H&S ${a.patternWatch.timeframe}, watch-only, unconfirmed by volume/backtest`);
  }
  return lines.join("\n");
}

function diagnostics(a: GoldAnalysis): string {
  return [
    `RSI(14): ${a.rsi14?.toFixed(1) ?? "n/a"}`,
    `ATR(true): ${a.atr !== null ? fp(a.atr) : "n/a"}`,
    `Realized vol: ${a.realizedVol !== null ? `${a.realizedVol.toFixed(2)}%` : "n/a"}`,
    `VR(5): ${a.varianceRatio?.toFixed(2) ?? "n/a"}`,
    `Hurst: ${a.hurst?.toFixed(2) ?? "n/a"}`,
    `Breakout scores: up=${a.breakoutScoreUp.toFixed(2)} down=${a.breakoutScoreDown.toFixed(2)}`
  ].join("\n");
}

export function buildDiscordPayload(
  a: GoldAnalysis,
  prev?: GoldPublishState | null,
  sessionLabel?: string,
  triggerReason?: string
): Record<string, unknown> {
  const sourceDegraded = a.data.sourceHealth.some((h) => h.qualityScore < 60);
  const fallback = a.data.snapshot.primary.fallback;
  const state = stateLabel(a);
  const titleFlags = [
    sourceDegraded ? "DATA DEGRADED" : null,
    fallback ? "FALLBACK DATA" : null
  ].filter(Boolean).join(" | ");
  const titlePrefix = titleFlags ? `[${titleFlags}] ` : "";
  const title = `${titlePrefix}XAU State | ${fp(a.price)} | ${state} | Evidence ${a.confidence}`;

  const gcHealth = a.data.sourceHealth.find((h) => h.source === a.data.snapshot.primary.source);
  const brokerHealth = a.data.sourceHealth.find((h) => h.source === "pepperstone");
  const spread = a.data.basis.brokerSpread !== undefined ? fp(a.data.basis.brokerSpread) : "unavailable";
  const description = [
    `Bias: ${state} | trend=${trendLabel(a.trend)} | regime=${regimeLabel(a.regime)} | change=${fPct(a.dailyChangePct)}`,
    `Data: source=${sourceLabel(a)} | gc_age=${ageLabel(gcHealth?.ageMs ?? Number.POSITIVE_INFINITY)} | xau_age=${ageLabel(brokerHealth?.ageMs ?? Number.POSITIVE_INFINITY)} | spread=${spread}`,
    eventLine(a),
    triggerReason ? `Trigger: ${triggerReason}` : null
  ].filter(Boolean).join("\n");

  const stateSummary = [
    `Macro regime: ${a.macroDrivers.macroBias}`,
    `Futures flow: ${trendLabel(a.trend)} / tf=${a.tf.confluence.toFixed(2)}`,
    `Volatility: ${volLabel(a.volRegime)}`,
    `Session: ${sessionLabel ?? "n/a"}`,
    `Trade permission: ${a.eventRisk.tradePermission}`
  ].join("\n");

  let delta = "";
  if (prev) {
    delta = `\nPrevious: price ${fSigned(a.price - prev.price)}, trend ${prev.trend}->${a.trend}, evidence ${prev.confidence}->${a.confidence}`;
  }

  const footer = [
    "model=xau_state_v2",
    "scores=uncalibrated",
    `sourceHealth=${sourceHealthText(a)}`,
    `barCoverage=1m:${a.data.barCoverage.m1},5m:${a.data.barCoverage.m5},15m:${a.data.barCoverage.m15},1h:${a.data.barCoverage.h1}`,
    `eventGate=${a.eventRisk.mode}`
  ].join(" | ");

  return {
    embeds: [{
      title: truncate(title, 256),
      description: truncate(description, 1900),
      color: embedColor(a),
      fields: [
        { name: "State Summary", value: truncate(stateSummary + delta) },
        { name: "Driver Attribution", value: truncate(topDrivers(a)) },
        { name: "Key Levels", value: truncate(keyLevels(a)) },
        { name: "Setup", value: truncate(setupField(a)) },
        { name: "Quant Diagnostics", value: truncate(diagnostics(a)) }
      ],
      footer: { text: truncate(footer, 1900) }
    }]
  };
}

export async function publishToDiscord(
  config: RuntimeConfig,
  payload: Record<string, unknown>
): Promise<void> {
  const res = await fetch(config.discordWebhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Discord webhook ${res.status} ${res.statusText}: ${body}`);
  }
}
