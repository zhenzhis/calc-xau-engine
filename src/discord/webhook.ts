import { GoldAnalysis, GoldPublishState, MarketRegime, TrendDirection, MomentumState } from "../analysis/types.js";
import { RuntimeConfig } from "../types.js";

// ---------------------------------------------------------------------------
// Formatting — quantitative institution standard
// ---------------------------------------------------------------------------

function fp(v: number): string { return `$${v.toFixed(2)}`; }
function fpInt(v: number): string { return `$${v.toFixed(0)}`; }
function fSigned(v: number): string { return `${v >= 0 ? "+" : ""}${v.toFixed(2)}`; }
function fPct(v: number): string { return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`; }
function fProb(v: number): string { return `${(v * 100).toFixed(0)}%`; }
function fTs(sec: number): string { return `<t:${sec}:R>`; }
function fTsFull(sec: number): string { return `<t:${sec}:f>`; }

function fRegime(r: MarketRegime): string {
  const m: Record<MarketRegime, string> = {
    "trending-up": "TREND ↑", "trending-down": "TREND ↓",
    "ranging": "RANGE", "volatile": "VOL ⚡", "consolidation": "CONSOL"
  };
  return m[r];
}

function fTrend(t: TrendDirection): string {
  return t === "bullish" ? "LONG" : t === "bearish" ? "SHORT" : "FLAT";
}

function fMomentum(m: MomentumState): string {
  return m === "accelerating" ? "加速" : m === "steady" ? "稳定" : "衰减";
}

function embedColor(regime: MarketRegime, trend: TrendDirection): number {
  if (regime === "volatile") return 0xff4444;
  if (trend === "bullish") return 0x3fb950;
  if (trend === "bearish") return 0xff7b72;
  return 0xd29922;
}

function rsiTag(v: number | null): string {
  if (v === null) return "—";
  if (v > 70) return `${v.toFixed(1)} OB`;
  if (v < 30) return `${v.toFixed(1)} OS`;
  return v.toFixed(1);
}

function hurstTag(v: number | null): string {
  if (v === null) return "—";
  if (v > 0.6) return `${v.toFixed(2)} 趋势`;
  if (v < 0.4) return `${v.toFixed(2)} 回归`;
  return `${v.toFixed(2)} 随机`;
}

// ---------------------------------------------------------------------------
// Signal Direction
// ---------------------------------------------------------------------------

function signalEmoji(trend: TrendDirection, confidence: number): string {
  if (confidence < 40) return "⬜";
  if (trend === "bullish") return "🟢";
  if (trend === "bearish") return "🔴";
  return "🟡";
}

// ---------------------------------------------------------------------------
// Build Discord Embed
// ---------------------------------------------------------------------------

export function buildDiscordPayload(
  a: GoldAnalysis,
  prev?: GoldPublishState | null,
  sessionLabel?: string,
  triggerReason?: string
): Record<string, unknown> {
  const sig = signalEmoji(a.trend, a.confidence);
  const priceShift = prev ? a.price - prev.price : 0;

  // ── Header description ──
  const lines: string[] = [
    `${sig} **${fRegime(a.regime)} | ${fTrend(a.trend)} | 动能${fMomentum(a.momentum)}** (conf ${a.confidence})`,
  ];

  // Session label
  if (sessionLabel) {
    lines.push(`**时段: ${sessionLabel}**`);
  }

  // Event trigger alert
  if (triggerReason) {
    lines.push(`> **⚡ EVENT: ${triggerReason}**`);
  }

  if (a.currentZone) {
    const zoneType = a.currentZone.type === "supply" ? "供给区" : a.currentZone.type === "demand" ? "需求区" : "过渡区";
    lines.push(`**📍 所在区域: ${a.currentZone.label}** (${zoneType})`);
  }

  lines.push(
    "",
    `多头目标 **${fp(a.bullTarget)}** ｜ 空头目标 **${fp(a.bearTarget)}**`,
    `预期区间 **${fp(a.expectedRange.min)} — ${fp(a.expectedRange.max)}**`,
    "",
    fTsFull(a.asOf)
  );

  // ── Field 1: 关键价位 ──
  const priceRows: [string, string][] = [];

  if (a.magnetLevel) {
    priceRows.push(["Magnet", `${fp(a.magnetLevel.price)} (${a.magnetLevel.label})`]);
  }
  if (a.nearestResistance) {
    priceRows.push(["Resistance", `${fp(a.nearestResistance.price)} [${a.nearestResistance.category}]`]);
  }
  if (a.nearestSupport) {
    priceRows.push(["Support", `${fp(a.nearestSupport.price)} [${a.nearestSupport.category}]`]);
  }
  priceRows.push(
    ["Bull Target", fp(a.bullTarget)],
    ["Bear Target", fp(a.bearTarget)],
    ["Range", `${fp(a.expectedRange.min)} — ${fp(a.expectedRange.max)}`]
  );

  if (a.ema8 !== null) {
    priceRows.push(["EMA 8/21/55", `${fp(a.ema8)} / ${a.ema21 ? fp(a.ema21) : "—"} / ${a.ema55 ? fp(a.ema55) : "—"}`]);
  }

  const pLW = Math.max(...priceRows.map(([l]) => l.length));
  const pRW = Math.max(...priceRows.map(([, r]) => r.length));
  const pBorder = `+${"─".repeat(pLW + 2)}+${"─".repeat(pRW + 2)}+`;
  const priceTable = [
    "```",
    pBorder,
    ...priceRows.map(([l, r]) => `│ ${l.padEnd(pLW)} │ ${r.padEnd(pRW)} │`),
    pBorder,
    "```"
  ].join("\n");

  // ── Field 2: S/R levels ──
  const srLines: string[] = [];
  if (a.resistanceLevels.length > 0) {
    srLines.push(`**R:** ${a.resistanceLevels.slice(0, 4).map(fpInt).join(" → ")}`);
  }
  if (a.supportLevels.length > 0) {
    srLines.push(`**S:** ${a.supportLevels.slice(0, 4).map(fpInt).join(" → ")}`);
  }

  // ── Field 3: Quant metrics ──
  const quantRows: [string, string][] = [
    ["RSI(14)", rsiTag(a.rsi14)],
    ["ATR", a.atr !== null ? fp(a.atr) : "—"],
    ["Z-Score", a.zScore !== null ? fSigned(a.zScore) : "—"],
    ["Hurst", hurstTag(a.hurst)],
    ["P(Break ↑)", fProb(a.breakoutProbUp)],
    ["P(Break ↓)", fProb(a.breakoutProbDown)],
    ["R:R Long", `${a.rrLong.toFixed(1)}:1`],
    ["R:R Short", `${a.rrShort.toFixed(1)}:1`],
  ];

  const qLW = Math.max(...quantRows.map(([l]) => l.length));
  const qRW = Math.max(...quantRows.map(([, r]) => r.length));
  const qBorder = `+${"─".repeat(qLW + 2)}+${"─".repeat(qRW + 2)}+`;
  const quantTable = [
    "```",
    qBorder,
    ...quantRows.map(([l, r]) => `│ ${l.padEnd(qLW)} │ ${r.padEnd(qRW)} │`),
    qBorder,
    "```"
  ].join("\n");

  // ── Field 4: Delta vs Previous ──
  let deltaField: string | null = null;
  if (prev) {
    const dRows: [string, string][] = [
      ["Price Δ", `${fSigned(priceShift)} (${prev.price.toFixed(0)} → ${a.price.toFixed(0)})`],
      ["Trend", `${fTrend(prev.trend)} → ${fTrend(a.trend)}`],
      ["Regime", `${fRegime(prev.regime)} → ${fRegime(a.regime)}`],
      ["Conf", `${prev.confidence} → ${a.confidence}`],
    ];
    const dLW = Math.max(...dRows.map(([l]) => l.length));
    const dRW = Math.max(...dRows.map(([, r]) => r.length));
    const dBorder = `+${"-".repeat(dLW + 2)}+${"-".repeat(dRW + 2)}+`;
    deltaField = [
      "```",
      dBorder,
      ...dRows.map(([l, r]) => `| ${l.padEnd(dLW)} | ${r.padEnd(dRW)} |`),
      dBorder,
      "```"
    ].join("\n");
  }

  // ── Assemble fields ──
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [
    { name: "关键价位", value: priceTable },
  ];

  if (srLines.length > 0) {
    fields.push({ name: "支撑 / 阻力", value: srLines.join("\n") });
  }

  fields.push({ name: "量化指标", value: quantTable });

  if (deltaField) {
    fields.push({ name: "Δ 上次播报", value: deltaField });
  }

  // ── Footer — machine-readable diagnostic line ──
  const footer = [
    `conf=${a.confidence}`,
    `regime=${a.regime}`,
    `rsi=${a.rsi14?.toFixed(0) ?? "-"}`,
    `atr=${a.atr?.toFixed(1) ?? "-"}`,
    `z=${a.zScore?.toFixed(2) ?? "-"}`,
    `hurst=${a.hurst?.toFixed(2) ?? "-"}`,
    `ema_x=${a.drivers.emaCrossScore.toFixed(3)}`,
    `zone=${a.drivers.zoneInfluence.toFixed(2)}`,
    `buf=${a.bufferSize}/${a.bufferDurationMin.toFixed(0)}m`,
  ].join(" │ ");

  return {
    embeds: [{
      title: `XAUUSD │ ${fp(a.price)} (${fPct(a.dailyChangePct)}) │ ${fTrend(a.trend)}`,
      description: lines.join("\n"),
      color: embedColor(a.regime, a.trend),
      fields,
      footer: { text: footer },
    }]
  };
}

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------

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
