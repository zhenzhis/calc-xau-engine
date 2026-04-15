import {
  GoldAnalysis,
  GoldPublishState,
  MarketRegime,
  TrendDirection,
  MomentumState,
  VolatilityRegime
} from "../analysis/types.js";
import { RuntimeConfig } from "../types.js";

// ---------------------------------------------------------------------------
// Formatting primitives
// ---------------------------------------------------------------------------

function fp(v: number): string { return `$${v.toFixed(2)}`; }
function fpInt(v: number): string { return `$${v.toFixed(0)}`; }
function fSigned(v: number): string { return `${v >= 0 ? "+" : ""}${v.toFixed(2)}`; }
function fPct(v: number): string { return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`; }
function fProb(v: number): string { return `${(v * 100).toFixed(0)}%`; }
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
  return m === "accelerating" ? "加速 ⚡" : m === "steady" ? "稳定" : "衰减";
}

function fVolRegime(v: VolatilityRegime): string {
  const m: Record<VolatilityRegime, string> = {
    low: "低波动", normal: "正常", high: "高波动 ⚠", extreme: "极端波动 🔥"
  };
  return m[v];
}

function embedColor(regime: MarketRegime, trend: TrendDirection): number {
  if (regime === "volatile") return 0xff4444;
  if (trend === "bullish") return 0x3fb950;
  if (trend === "bearish") return 0xff7b72;
  return 0xd29922;
}

function signalEmoji(dir: "LONG" | "SHORT" | "FLAT", confidence: number): string {
  if (confidence < 30) return "⬜";
  if (dir === "LONG") return "🟢";
  if (dir === "SHORT") return "🔴";
  return "🟡";
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

function vrTag(v: number | null): string {
  if (v === null) return "—";
  if (v > 1.15) return `${v.toFixed(2)} 持续`;
  if (v < 0.85) return `${v.toFixed(2)} 反转`;
  return `${v.toFixed(2)} 随机`;
}

function tfIcon(aligned: boolean, trend: TrendDirection): string {
  if (trend === "neutral") return "◽";
  return aligned ? (trend === "bullish" ? "🟩" : "🟥") : "🟧";
}

// ---------------------------------------------------------------------------
// Build Discord Embed — institutional-grade alert
// ---------------------------------------------------------------------------

export function buildDiscordPayload(
  a: GoldAnalysis,
  prev?: GoldPublishState | null,
  sessionLabel?: string,
  triggerReason?: string
): Record<string, unknown> {
  const sig = signalEmoji(a.signal.direction, a.confidence);

  // ── Title ──
  const title = `XAUUSD │ ${fp(a.price)} (${fPct(a.dailyChangePct)}) │ ${sig} ${a.signal.direction}`;

  // ── Description: signal + context ──
  const desc: string[] = [];

  desc.push(
    `${sig} **${fRegime(a.regime)} │ ${fTrend(a.trend)} │ 动能${fMomentum(a.momentum)}** (置信 ${a.confidence})`
  );

  if (sessionLabel) {
    desc.push(`**时段: ${sessionLabel}** │ 波动率: ${fVolRegime(a.volRegime)}`);
  }

  if (triggerReason) {
    desc.push(`> ⚡ **EVENT: ${triggerReason}**`);
  }

  if (a.currentZone) {
    const zt = a.currentZone.type === "supply" ? "供给区" : a.currentZone.type === "demand" ? "需求区" : "过渡区";
    desc.push(`📍 **所在区域: ${a.currentZone.label}** (${zt})`);
  }

  // Actionable signal block
  if (a.signal.direction !== "FLAT") {
    const dir = a.signal.direction === "LONG" ? "▲" : "▼";
    desc.push("");
    desc.push(`**${dir} 操作信号** (强度 ${a.signal.strength})`);
    desc.push(
      `入场 **${fp(a.signal.entry)}** │ 止损 **${fp(a.signal.stopLoss)}** │ R:R **${a.signal.riskReward.toFixed(1)}:1**`
    );
    if (a.signal.targets.length > 0) {
      const tgtStr = a.signal.targets.map((t, i) => `T${i + 1} **${fpInt(t)}**`).join(" │ ");
      desc.push(tgtStr);
    }
  }

  desc.push("");
  if (a.expectedMove > 0) {
    desc.push(`预期波动 **±${fp(a.expectedMove)}** │ 区间 **${fp(a.expectedRange.min)} — ${fp(a.expectedRange.max)}**`);
  } else {
    desc.push(`区间 **${fp(a.expectedRange.min)} — ${fp(a.expectedRange.max)}**`);
  }
  desc.push(fTsFull(a.asOf));

  // ── Field 1: Multi-Timeframe Alignment ──
  const tfLines: string[] = [
    "```",
    " TF    信号    RSI    EMA   动能",
    " ──── ────── ────── ──── ──────",
  ];

  // 15m
  tfLines.push(
    ` 15M   ${fTrend(a.tf.m15.trend).padEnd(5)}  ${(a.tf.m15.rsi?.toFixed(1) ?? "  —").padStart(5)}  ${a.tf.m15.emaAligned ? " ✓ " : " ✗ "}  ${a.tf.m15.momentum > 0 ? "+" : ""}${a.tf.m15.momentum.toFixed(1)}σ`
  );
  // 5m
  tfLines.push(
    ` 5M    ${fTrend(a.tf.m5.trend).padEnd(5)}  ${(a.tf.m5.rsi?.toFixed(1) ?? "  —").padStart(5)}  ${a.tf.m5.emaAligned ? " ✓ " : " ✗ "}  ${a.tf.m5.momentum > 0 ? "+" : ""}${a.tf.m5.momentum.toFixed(1)}σ`
  );

  const confLevel = Math.abs(a.tf.confluence);
  const confLabel = confLevel > 0.6 ? "强共振" : confLevel > 0.3 ? "弱共振" : "分歧";
  tfLines.push(` ──── ────── ────── ──── ──────`);
  tfLines.push(` 共振: ${a.tf.confluence > 0 ? "+" : ""}${a.tf.confluence.toFixed(2)} (${confLabel})`);
  tfLines.push("```");

  // ── Field 2: Key Levels Ladder ──
  const ladder: string[] = ["```"];

  // Resistances (top to bottom, max 3)
  const rLevels = a.resistanceLevels.slice(0, 3).reverse();
  for (let i = 0; i < rLevels.length; i++) {
    const lvl = rLevels[i];
    const level = findLevelInfo(lvl);
    const tag = level ? ` ${level.label.split("-")[0]}` : "";
    const magnetMark = a.magnetLevel && Math.abs(a.magnetLevel.price - lvl) < 1 ? " ★" : "";
    ladder.push(` R${rLevels.length - i}  $${lvl.toFixed(0).padStart(5)}${tag}${magnetMark}`);
  }

  ladder.push(` ─── $${a.price.toFixed(0).padStart(5)}  NOW ───`);

  // Supports (top to bottom, max 3)
  const sLevels = a.supportLevels.slice(0, 3);
  for (let i = 0; i < sLevels.length; i++) {
    const lvl = sLevels[i];
    const level = findLevelInfo(lvl);
    const tag = level ? ` ${level.label.split("-")[0]}` : "";
    const magnetMark = a.magnetLevel && Math.abs(a.magnetLevel.price - lvl) < 1 ? " ★" : "";
    ladder.push(` S${i + 1}  $${lvl.toFixed(0).padStart(5)}${tag}${magnetMark}`);
  }
  ladder.push("```");

  // ── Field 3: Quant Dashboard ──
  const qRows: [string, string, string, string][] = [
    ["RSI(14)", rsiTag(a.rsi14), "Hurst", hurstTag(a.hurst)],
    ["RVol", a.realizedVol !== null ? `${a.realizedVol.toFixed(2)}%` : "—", "VR(5)", vrTag(a.varianceRatio)],
    ["Z-Score", a.zScore !== null ? fSigned(a.zScore) : "—", "ACF(1)", a.autocorrelation !== null ? a.autocorrelation.toFixed(3) : "—"],
    ["ATR", a.atr !== null ? fp(a.atr) : "—", "KAMA", a.kamaPrice !== null ? fpInt(a.kamaPrice) : "—"],
    ["P(↑)", fProb(a.breakoutProbUp), "P(↓)", fProb(a.breakoutProbDown)],
    ["R:R多", `${a.rrLong.toFixed(1)}:1`, "R:R空", `${a.rrShort.toFixed(1)}:1`],
  ];

  const col1W = Math.max(...qRows.map(r => r[0].length));
  const col2W = Math.max(...qRows.map(r => r[1].length));
  const col3W = Math.max(...qRows.map(r => r[2].length));
  const col4W = Math.max(...qRows.map(r => r[3].length));

  const qTable = [
    "```",
    ...qRows.map(([a, b, c, d]) =>
      ` ${a.padEnd(col1W)}  ${b.padStart(col2W)}  │  ${c.padEnd(col3W)}  ${d.padStart(col4W)}`
    ),
    "```"
  ].join("\n");

  // ── Field 4: Delta vs Previous ──
  let deltaField: string | null = null;
  if (prev) {
    const priceShift = a.price - prev.price;
    const dLines: string[] = [
      "```",
      ` Price  ${fSigned(priceShift)} (${prev.price.toFixed(0)} → ${a.price.toFixed(0)})`,
      ` Trend  ${fTrend(prev.trend)} → ${fTrend(a.trend)}`,
      ` Regime ${fRegime(prev.regime)} → ${fRegime(a.regime)}`,
      ` Conf   ${prev.confidence} → ${a.confidence}`,
      "```"
    ];
    deltaField = dLines.join("\n");
  }

  // ── Assemble embed fields ──
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [];

  fields.push({ name: "📊 时间框架共振", value: tfLines.join("\n") });
  fields.push({ name: "📍 关键价位", value: ladder.join("\n") });
  fields.push({ name: "🔬 量化仪表盘", value: qTable });

  if (deltaField) {
    fields.push({ name: "Δ 上次播报", value: deltaField });
  }

  // BB squeeze warning
  if (a.bbWidth !== null && a.bbWidth < 0.3) {
    fields.push({
      name: "⚠ 布林挤压",
      value: `BB宽度 ${a.bbWidth.toFixed(3)}% — **潜在突破**\n%B: ${a.bbPercentB?.toFixed(2) ?? "—"}`
    });
  }

  // ── Footer — machine-readable diagnostic ──
  const footer = [
    `conf=${a.confidence}`,
    `regime=${a.regime}`,
    `vol=${a.volRegime}`,
    `rsi=${a.rsi14?.toFixed(0) ?? "-"}`,
    `atr=${a.atr?.toFixed(1) ?? "-"}`,
    `vr=${a.varianceRatio?.toFixed(2) ?? "-"}`,
    `hurst=${a.hurst?.toFixed(2) ?? "-"}`,
    `nmom=${a.normalizedMomentum?.toFixed(1) ?? "-"}`,
    `tf=${a.tf.confluence.toFixed(2)}`,
    `buf=${a.bufferSize}/${a.bufferDurationMin.toFixed(0)}m`,
  ].join(" │ ");

  return {
    embeds: [{
      title,
      description: desc.join("\n"),
      color: embedColor(a.regime, a.trend),
      fields,
      footer: { text: footer },
    }]
  };
}

// ---------------------------------------------------------------------------
// Helper — find level info by price
// ---------------------------------------------------------------------------

import { LEVELS } from "../levels/grid.js";

function findLevelInfo(price: number) {
  return LEVELS.find(l => Math.abs(l.price - price) < 1) ?? null;
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
