import { analyzeGold } from "../analysis/engine.js";
import { GoldAnalysis, GoldPublishState } from "../analysis/types.js";
import { GoldPriceClient, PriceBuffer } from "../data/client.js";
import { activeZone } from "../levels/grid.js";
import { buildDiscordPayload, publishToDiscord } from "../discord/webhook.js";
import { Logger } from "../lib/logger.js";
import { RuntimeConfig } from "../types.js";
import { getGoldTradingSession, GoldSessionName } from "./market-hours.js";
import { PublishStateStore } from "./state-store.js";

// ---------------------------------------------------------------------------
// Event-driven trigger detection
// ---------------------------------------------------------------------------

interface PublishTrigger {
  forced: boolean;
  reason: string;
}

function detectTriggers(
  current: GoldAnalysis,
  previous: GoldPublishState | null
): PublishTrigger {
  if (!previous) return { forced: false, reason: "" };

  // 1. Regime change
  if (previous.regime !== current.regime) {
    return { forced: true, reason: `regime: ${previous.regime} → ${current.regime}` };
  }

  // 2. Trend reversal
  if (previous.trend !== current.trend) {
    return { forced: true, reason: `trend: ${previous.trend} → ${current.trend}` };
  }

  // 3. Zone breach — price entered or exited an institutional zone
  const prevZone = activeZone(previous.price);
  const currZone = activeZone(current.price);
  const prevZoneLabel = prevZone?.label ?? "none";
  const currZoneLabel = currZone?.label ?? "none";
  if (prevZoneLabel !== currZoneLabel) {
    return { forced: true, reason: `zone: ${prevZoneLabel} → ${currZoneLabel}` };
  }

  // 4. Key level breach — price crossed a key support or resistance
  if (previous.nearestResistance !== undefined && previous.nearestResistance !== current.nearestResistance?.price) {
    const prevR = previous.nearestResistance;
    if (current.price > prevR && previous.price < prevR) {
      return { forced: true, reason: `突破阻力 ${prevR.toFixed(0)}` };
    }
  }
  if (previous.nearestSupport !== undefined && previous.nearestSupport !== current.nearestSupport?.price) {
    const prevS = previous.nearestSupport;
    if (current.price < prevS && previous.price > prevS) {
      return { forced: true, reason: `跌破支撑 ${prevS.toFixed(0)}` };
    }
  }

  // 5. Volatility regime shift — e.g., normal → extreme
  if (previous.volRegime && current.volRegime !== previous.volRegime) {
    const severity = { low: 0, normal: 1, high: 2, extreme: 3 };
    const prevSev = severity[previous.volRegime] ?? 1;
    const currSev = severity[current.volRegime] ?? 1;
    // Only trigger on significant shifts (≥2 levels) or entry into extreme
    if (Math.abs(currSev - prevSev) >= 2 || current.volRegime === "extreme") {
      return { forced: true, reason: `波动率: ${previous.volRegime} → ${current.volRegime}` };
    }
  }

  return { forced: false, reason: "" };
}

// ---------------------------------------------------------------------------
// Broadcast Service — session-aware scheduling
// ---------------------------------------------------------------------------

export class BroadcastService {
  private latestAnalysis: GoldAnalysis | null = null;
  private lastPublishedAt = 0;
  private currentSession: GoldSessionName = "weekend";
  private readonly buffer: PriceBuffer;

  constructor(
    private readonly config: RuntimeConfig,
    private readonly logger: Logger,
    private readonly client: GoldPriceClient,
    private readonly store: PublishStateStore
  ) {
    this.buffer = new PriceBuffer(config.priceBufferPath);
  }

  async pollOnce(): Promise<void> {
    const session = getGoldTradingSession(new Date(), this.config.marketTimezone);
    this.currentSession = session.name;

    if (this.config.enableMarketHoursOnly && !session.isOpen) {
      this.latestAnalysis = null;
      this.logger.debug("Skipping poll — market closed", {
        session: session.label,
        localTime: session.localTime
      });
      return;
    }

    const quote = await this.client.fetchQuote();

    this.buffer.push({
      price: quote.price,
      timestamp: quote.timestamp * 1000
    });

    this.latestAnalysis = analyzeGold(quote, this.buffer);

    this.logger.info("Snapshot analyzed", {
      session: session.label,
      price: this.latestAnalysis.price,
      trend: this.latestAnalysis.trend,
      regime: this.latestAnalysis.regime,
      confidence: this.latestAnalysis.confidence,
      bufferSize: this.buffer.length
    });
  }

  async maybePublish(): Promise<boolean> {
    if (!this.latestAnalysis) return false;

    const session = getGoldTradingSession(new Date(), this.config.marketTimezone);
    if (this.config.enableMarketHoursOnly && !session.isOpen) return false;

    const now = Date.now();
    const previous = await this.store.read();

    // ── Event-driven triggers (immediate publish) ──
    const trigger = detectTriggers(this.latestAnalysis, previous);
    if (trigger.forced) {
      this.logger.warn(`Event trigger — ${trigger.reason}`);
    }

    // ── Session-based interval check ──
    if (!trigger.forced) {
      const publishInterval = session.publishIntervalMs;
      const effectiveLast = Math.max(this.lastPublishedAt, previous?.publishedAtMs ?? 0);
      if (now - effectiveLast < publishInterval) {
        this.logger.debug("Skipping publish — interval not elapsed", {
          session: session.name,
          intervalMs: publishInterval
        });
        return false;
      }
    }

    // ── Data freshness guard ──
    const analysisAgeMs = now - this.latestAnalysis.asOf * 1_000;
    if (analysisAgeMs > this.config.maxDataAgeMs) {
      this.logger.warn("Skipping publish — stale data", { analysisAgeMs });
      return false;
    }

    // ── Build and publish ──
    const payload = buildDiscordPayload(
      this.latestAnalysis,
      previous,
      session.label,
      trigger.forced ? trigger.reason : undefined
    );
    await publishToDiscord(this.config, payload);

    // ── Persist ──
    this.lastPublishedAt = now;
    const nextState: GoldPublishState = {
      asOf: this.latestAnalysis.asOf,
      publishedAtMs: now,
      price: this.latestAnalysis.price,
      trend: this.latestAnalysis.trend,
      momentum: this.latestAnalysis.momentum,
      regime: this.latestAnalysis.regime,
      volRegime: this.latestAnalysis.volRegime,
      confidence: this.latestAnalysis.confidence,
      bullTarget: this.latestAnalysis.bullTarget,
      bearTarget: this.latestAnalysis.bearTarget,
      nearestResistance: this.latestAnalysis.nearestResistance?.price,
      nearestSupport: this.latestAnalysis.nearestSupport?.price
    };
    await this.store.write(nextState);
    await this.buffer.persist();

    this.logger.info("Published", {
      session: session.label,
      price: this.latestAnalysis.price,
      trigger: trigger.forced ? trigger.reason : "scheduled"
    });

    return true;
  }

  async runLoop(): Promise<never> {
    await this.buffer.restore();
    this.logger.info("Buffer restored", { points: this.buffer.length });

    try {
      await this.client.seedBuffer(this.buffer);
    } catch (error) {
      this.logger.warn("Buffer seeding failed", error);
    }

    const session = getGoldTradingSession(new Date(), this.config.marketTimezone);
    this.logger.info("Starting XAU State Discord Broadcaster", {
      session: session.label,
      pollMs: session.pollIntervalMs,
      publishMs: session.publishIntervalMs
    });

    for (;;) {
      const loopStart = Date.now();

      try {
        await this.pollOnce();
        await this.maybePublish();
      } catch (error) {
        this.logger.error("Loop iteration failed", error);
      }

      // ── Session-adaptive sleep ──
      const currentSession = getGoldTradingSession(new Date(), this.config.marketTimezone);
      const sleepMs = currentSession.isOpen
        ? currentSession.pollIntervalMs
        : 60_000; // check once per minute when closed

      // Log session transitions
      if (currentSession.name !== this.currentSession) {
        this.logger.info("Session transition", {
          from: this.currentSession,
          to: currentSession.name,
          label: currentSession.label,
          pollMs: currentSession.pollIntervalMs,
          publishMs: currentSession.publishIntervalMs
        });
        this.currentSession = currentSession.name;
      }

      const elapsed = Date.now() - loopStart;
      const waitMs = Math.max(0, sleepMs - elapsed);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}
