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
  if (a.data.snapshot.activePrimaryHealth.qualityScore < 60) return 0xd29922;
  if (a.eventRisk.tradePermission === "blocked") return 0xff4444;
  if (a.trend === "bullish") return 0x3fb950;
  if (a.trend === "bearish") return 0xff7b72;
  return 0x8b949e;
}

function sourceLabel(a: GoldAnalysis): string {
  const primary = a.data.snapshot.primary;
  const broker = a.data.snapshot.xauBrokerTick;
  const health = a.data.snapshot.activePrimaryHealth;
  if (primary.instrumentKind === "broker_spot") {
    if (isTestData(a)) return "Synthetic test feed";
    if (health.feed === "ctrader_fix" && health.sessionVerified === true) return "Pepperstone cTrader FIX";
    return "Pepperstone JSONL (unverified)";
  }
  if (primary.source === "rithmic" && broker) return "Rithmic+Pepperstone";
  if (primary.source === "rithmic") return "Rithmic";
  if (primary.source === "yahoo") return "Yahoo fallback";
  return primary.source;
}

function isBrokerPrimary(a: GoldAnalysis): boolean {
  return a.data.snapshot.primary.instrumentKind === "broker_spot";
}

function isTestData(a: GoldAnalysis): boolean {
  return (
    a.data.snapshot.activePrimaryHealth.testData === true ||
    a.data.snapshot.activePrimaryHealth.feed === "synthetic_test" ||
    a.data.snapshot.xauBrokerTick?.testData === true ||
    a.data.snapshot.xauBrokerTick?.feed === "synthetic_test"
  );
}

function levelGridUnavailable(a: GoldAnalysis): boolean {
  return a.levelGridStatus === "out-of-range" || a.levelGridStatus === "invalid";
}

function brokerSpreadLabel(a: GoldAnalysis): string {
  const spread = brokerSpreadValue(a);
  return spread !== null ? fp(spread) : "unavailable";
}

function brokerSpreadValue(a: GoldAnalysis): number | null {
  const tick = a.data.snapshot.xauBrokerTick;
  if (tick?.bid !== undefined && tick.ask !== undefined && tick.ask > tick.bid) {
    return tick.ask - tick.bid;
  }
  return a.data.basis.brokerSpread ?? null;
}

function spreadWide(a: GoldAnalysis): boolean {
  const spread = brokerSpreadValue(a);
  const max = a.data.snapshot.qualityPolicy?.maxBrokerSpread ?? 5;
  return spread !== null && spread > max;
}

function dailyChangeLabel(a: GoldAnalysis): string {
  return a.data.snapshot.primary.dailyChangePct === undefined ? "n/a" : fPct(a.dailyChangePct);
}

function stateLabel(a: GoldAnalysis): "CONDITIONAL-LONG" | "CONDITIONAL-SHORT" | "LONG-WATCH" | "SHORT-WATCH" | "RANGE-WATCH" | "NO-TRADE" {
  if (a.recommendationLevel === "no-trade") return "NO-TRADE";
  if (a.recommendationLevel === "conditional-setup") {
    if (a.trend === "bullish" && a.signal.direction !== "FLAT") return "CONDITIONAL-LONG";
    if (a.trend === "bearish" && a.signal.direction !== "FLAT") return "CONDITIONAL-SHORT";
  }
  if (a.trend === "bullish") return "LONG-WATCH";
  if (a.trend === "bearish") return "SHORT-WATCH";
  return "RANGE-WATCH";
}

function preferredAction(a: GoldAnalysis): string {
  if (a.recommendationLevel === "no-trade") return "No trade";
  if (a.recommendationLevel === "watch-only") return "Watch only";
  const state = stateLabel(a);
  if (state === "CONDITIONAL-LONG") return "Conditional long setup";
  if (state === "CONDITIONAL-SHORT") return "Conditional short setup";
  if (state === "LONG-WATCH") return "Long watch";
  if (state === "SHORT-WATCH") return "Short watch";
  if (state === "RANGE-WATCH") return "Range watch";
  return "No trade";
}

function sourceHealthText(a: GoldAnalysis): string {
  const activeHealth = a.data.snapshot.activePrimaryHealth;
  const brokerHealth = a.data.snapshot.brokerHealth;
  const activeFeed = activeHealth.feed ? `/${activeHealth.feed}` : "";
  const brokerFeed = brokerHealth.feed ? `/${brokerHealth.feed}` : "";
  const activeWarning = activeHealth.warning ? `/warning=${activeHealth.warning}` : "";
  const brokerWarning = brokerHealth.warning ? `/warning=${brokerHealth.warning}` : "";
  const active = `active=${activeHealth.source}:${activeHealth.qualityScore}${activeHealth.stale ? "/stale" : ""}${activeHealth.testData ? "/test" : ""}${activeFeed}${activeWarning}`;
  const broker = `broker=${brokerHealth.source}:${brokerHealth.qualityScore}${brokerHealth.stale ? "/stale" : ""}${brokerHealth.testData ? "/test" : ""}${brokerFeed}${brokerWarning}`;
  const optional = a.data.snapshot.optionalSourceHealth
    .map((h) => `${h.source}:${h.qualityScore}${h.stale ? "/stale" : ""}`)
    .join(",");
  return optional ? `${active},${broker},optional=${optional}` : `${active},${broker}`;
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
  if (levelGridUnavailable(a)) {
    const distance = a.nearestLevelDistance !== null ? `nearest distance ${fp(a.nearestLevelDistance)}` : "no usable levels";
    return `Level grid out of range (${distance}).`;
  }

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
  const brokerPrimary = isBrokerPrimary(a);
  const gridUnavailable = levelGridUnavailable(a);
  const setupValid = a.recommendationLevel === "conditional-setup" && !gridUnavailable;
  const primaryOk = a.data.snapshot.activePrimaryHealth.qualityScore >= 60;
  const brokerOk = a.data.snapshot.xauBrokerTick !== null && a.data.snapshot.brokerHealth.qualityScore >= 60;
  const invalidation = gridUnavailable
    ? undefined
    : a.trend === "bullish" ? a.nearestSupport?.price
    : a.trend === "bearish" ? a.nearestResistance?.price
    : undefined;
  const futuresCondition =
    a.data.futuresFlowStatus === "unknown" ? "futures flow unavailable"
    : a.data.futuresFlowStatus === "proxy-only" ? "futures flow proxy-only"
    : "futures flow confirmed";
  const conditions = [
    a.eventRisk.tradePermission === "allowed" ? "event gate clear" : `event gate=${a.eventRisk.tradePermission}`,
    brokerPrimary
      ? (brokerOk ? "broker quote available" : "broker quote missing")
      : (primaryOk ? "primary source acceptable" : "improve primary source quality"),
    brokerPrimary
      ? futuresCondition
      : (brokerOk ? "broker quote available" : "broker quote missing"),
    isTestData(a) ? "test feed blocked" : null,
    gridUnavailable ? "manual level grid invalid for current price regime" : null,
    Math.abs(a.tf.confluence) >= 0.5 ? "multi-timeframe aligned" : "need timeframe confirmation"
  ].filter(Boolean);

  const lines = [
    `Preferred action: ${preferredAction(a)}`,
    `Conditions needed: ${conditions.join("; ")}`
  ];
  if (!setupValid) {
    lines.push("Reference only: no execution levels while recommendation is no-trade/watch-only");
  } else {
    lines.push(`Setup zone: ${fp(a.signal.entry)}`);
    lines.push(`Invalidation: ${invalidation !== undefined ? fp(invalidation) : "range break required"}`);
    if (a.signal.targets.length > 0) {
      lines.push(`Reference targets: ${a.signal.targets.slice(0, 2).map(fp).join(" / ")}`);
    }
    lines.push("Reference levels, not execution order");
  }
  if (a.patternWatch) {
    lines.push(`Pattern watch: H&S ${a.patternWatch.timeframe}, watch-only, unconfirmed by volume/backtest`);
  }
  return lines.join("\n");
}

function diagnostics(a: GoldAnalysis): string {
  const scoreNote = isBrokerPrimary(a) ? " (uncalibrated broker-price score)" : "";
  const sampleNote = a.bufferSize < 240 ? " (unstable sample)" : "";
  return [
    `RSI(14): ${a.rsi14?.toFixed(1) ?? "n/a"}`,
    `ATR(true): ${a.atr !== null ? fp(a.atr) : "n/a"}`,
    `Realized vol: ${a.realizedVol !== null ? `${a.realizedVol.toFixed(2)}%` : "n/a"}`,
    `VR(5): ${a.varianceRatio?.toFixed(2) ?? "n/a"}${sampleNote}`,
    `Hurst: ${a.hurst?.toFixed(2) ?? "n/a"}${sampleNote}`,
    `Breakout scores: up=${a.breakoutScoreUp.toFixed(2)} down=${a.breakoutScoreDown.toFixed(2)}${scoreNote}`
  ].join("\n");
}

export function buildDiscordPayload(
  a: GoldAnalysis,
  prev?: GoldPublishState | null,
  sessionLabel?: string,
  triggerReason?: string
): Record<string, unknown> {
  const primaryDegraded = a.data.snapshot.activePrimaryHealth.qualityScore < 60;
  const brokerMissing = a.data.snapshot.xauBrokerTick === null || a.data.snapshot.brokerHealth.stale;
  const fallback = a.data.snapshot.primary.fallback;
  const brokerPrimary = isBrokerPrimary(a);
  const state = stateLabel(a);
  const titleFlags = [
    isTestData(a) ? "TEST DATA" : null,
    brokerPrimary ? "BROKER PRIMARY" : null,
    brokerPrimary && a.data.futuresFlowStatus === "unknown" ? "FUTURES FLOW UNKNOWN" : null,
    spreadWide(a) ? "SPREAD WIDE" : null,
    primaryDegraded ? "PRIMARY DATA DEGRADED" : null,
    fallback ? "FALLBACK DATA" : null,
    brokerMissing ? "BROKER QUOTE MISSING" : null
  ].filter(Boolean).join(" | ");
  const titlePrefix = titleFlags ? `[${titleFlags}] ` : "";
  const title = `${titlePrefix}XAU State | ${fp(a.price)} | ${state} | Evidence ${a.confidence}`;

  const gcHealth = a.data.sourceHealth.find((h) => h.source === a.data.snapshot.primary.source);
  const gcProxyHealth = a.data.sourceHealth.find((h) => h.source === "yahoo");
  const brokerHealth = a.data.sourceHealth.find((h) => h.source === "pepperstone");
  const spread = brokerSpreadLabel(a);
  const basisLabel = a.data.basis.available && a.data.basis.futuresMinusBroker !== undefined
    ? `proxy_basis=${fSigned(a.data.basis.futuresMinusBroker)}`
    : "basis=unavailable";
  const gcProxyLabel =
    a.data.snapshot.gcTick?.source === "yahoo" ? "Yahoo GC=F reference"
    : a.data.snapshot.gcTick ? `${a.data.snapshot.gcTick.source} reference`
    : "unavailable";
  const dataLine = brokerPrimary
    ? `Data: source=${sourceLabel(a)} | gc_proxy=${gcProxyLabel} | gc_age=${ageLabel(gcProxyHealth?.ageMs ?? Number.POSITIVE_INFINITY)} | xau_age=${ageLabel(brokerHealth?.ageMs ?? Number.POSITIVE_INFINITY)} | spread=${spread} | ${basisLabel}`
    : `Data: source=${sourceLabel(a)} | gc_age=${ageLabel(gcHealth?.ageMs ?? Number.POSITIVE_INFINITY)} | xau_age=${ageLabel(brokerHealth?.ageMs ?? Number.POSITIVE_INFINITY)} | spread=${spread}`;
  const description = [
    `Bias: ${state} | trend=${trendLabel(a.trend)} | regime=${regimeLabel(a.regime)} | change=${dailyChangeLabel(a)}`,
    dataLine,
    eventLine(a),
    triggerReason ? `Trigger: ${triggerReason}` : null
  ].filter(Boolean).join("\n");

  const stateSummary = [
    `Macro regime: ${a.macroDrivers.macroBias}`,
    `Futures flow: ${a.data.futuresFlowStatus}${a.data.futuresFlowStatus === "confirmed" ? ` / tf=${a.tf.confluence.toFixed(2)}` : ""}`,
    `Recommendation: ${a.recommendationLevel}`,
    `Level grid: ${a.levelGridStatus}`,
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
    `mode=${brokerPrimary ? "broker-primary" : "standard"}`,
    `futuresFlow=${a.data.futuresFlowStatus}`,
    `recommendation=${a.recommendationLevel}`,
    `levelGrid=${a.levelGridStatus}`,
    "scores=uncalibrated",
    `sourceHealth=${sourceHealthText(a)}`,
    `optionalSourceHealth=${a.data.snapshot.optionalSourceHealth.map((h) => `${h.source}:${h.ok ? "ok" : "missing"}`).join(",") || "none"}`,
    `barCoverage=1m:${a.data.barCoverage.m1}/${a.data.barCoverage.m1CompleteRatio.toFixed(2)},5m:${a.data.barCoverage.m5}/${a.data.barCoverage.m5CompleteRatio.toFixed(2)},15m:${a.data.barCoverage.m15}/${a.data.barCoverage.m15CompleteRatio.toFixed(2)},1h:${a.data.barCoverage.h1}/${a.data.barCoverage.h1CompleteRatio.toFixed(2)}`,
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
