import { analyzeGold } from "../analysis/engine.js";
import { GoldAnalysis, GoldPublishState } from "../analysis/types.js";
import { GoldPriceClient, PriceBuffer } from "../data/client.js";
import { buildDiscordPayload, publishToDiscord } from "../discord/webhook.js";
import { Logger } from "../lib/logger.js";
import { RuntimeConfig } from "../types.js";
import { getGoldSession } from "./market-hours.js";
import { PublishStateStore } from "./state-store.js";

export class BroadcastService {
  private latestAnalysis: GoldAnalysis | null = null;
  private lastPublishedAt = 0;
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
    const session = getGoldSession(new Date(), this.config.marketTimezone);
    if (this.config.enableMarketHoursOnly && !session.isOpen) {
      this.latestAnalysis = null;
      this.logger.debug("Skipping poll — gold market closed", {
        reason: session.reason,
        localDate: session.localDate,
        localTime: session.localTime
      });
      return;
    }

    const quote = await this.client.fetchQuote();

    // Push to rolling buffer
    this.buffer.push({
      price: quote.price,
      timestamp: quote.timestamp * 1000
    });

    // Run analysis
    this.latestAnalysis = analyzeGold(quote, this.buffer);

    this.logger.info("XAUUSD snapshot analyzed", {
      price: this.latestAnalysis.price,
      trend: this.latestAnalysis.trend,
      regime: this.latestAnalysis.regime,
      momentum: this.latestAnalysis.momentum,
      confidence: this.latestAnalysis.confidence,
      rsi: this.latestAnalysis.rsi14,
      bufferSize: this.buffer.length
    });
  }

  async maybePublish(): Promise<boolean> {
    if (!this.latestAnalysis) {
      this.logger.debug("Skipping publish — no analysis available");
      return false;
    }

    const session = getGoldSession(new Date(), this.config.marketTimezone);
    if (this.config.enableMarketHoursOnly && !session.isOpen) {
      return false;
    }

    const now = Date.now();
    const previous = await this.store.read();

    // Force publish on regime change
    const regimeChanged = previous !== null && previous.regime !== this.latestAnalysis.regime;
    if (regimeChanged) {
      this.logger.warn("Regime change detected — forcing immediate publish", {
        previousRegime: previous.regime,
        currentRegime: this.latestAnalysis.regime
      });
    }

    // Force publish on trend change
    const trendChanged = previous !== null && previous.trend !== this.latestAnalysis.trend;
    if (trendChanged) {
      this.logger.warn("Trend change detected — forcing immediate publish", {
        previousTrend: previous.trend,
        currentTrend: this.latestAnalysis.trend
      });
    }

    if (!regimeChanged && !trendChanged) {
      const effectiveLast = Math.max(
        this.lastPublishedAt,
        previous?.publishedAtMs ?? 0
      );
      if (now - effectiveLast < this.config.publishIntervalMs) {
        this.logger.debug("Skipping publish — interval not elapsed");
        return false;
      }
    }

    // Data freshness check
    const analysisAgeMs = now - this.latestAnalysis.asOf * 1_000;
    if (analysisAgeMs > this.config.maxDataAgeMs) {
      this.logger.warn("Skipping publish — stale data", {
        asOf: this.latestAnalysis.asOf,
        analysisAgeMs,
        maxDataAgeMs: this.config.maxDataAgeMs
      });
      return false;
    }

    // Build and publish
    const payload = buildDiscordPayload(this.latestAnalysis, previous);
    await publishToDiscord(this.config, payload);

    // Persist state
    this.lastPublishedAt = now;
    const nextState: GoldPublishState = {
      asOf: this.latestAnalysis.asOf,
      publishedAtMs: now,
      price: this.latestAnalysis.price,
      trend: this.latestAnalysis.trend,
      momentum: this.latestAnalysis.momentum,
      regime: this.latestAnalysis.regime,
      confidence: this.latestAnalysis.confidence,
      bullTarget: this.latestAnalysis.bullTarget,
      bearTarget: this.latestAnalysis.bearTarget,
      nearestResistance: this.latestAnalysis.nearestResistance?.price,
      nearestSupport: this.latestAnalysis.nearestSupport?.price
    };
    await this.store.write(nextState);

    // Persist buffer
    await this.buffer.persist();

    this.logger.info("Discord publish complete", {
      price: this.latestAnalysis.price,
      trend: this.latestAnalysis.trend,
      regime: this.latestAnalysis.regime,
      regimeChanged,
      trendChanged
    });

    return true;
  }

  async runLoop(): Promise<never> {
    // Restore price buffer from disk for warm restart
    await this.buffer.restore();
    this.logger.info("Price buffer restored from disk", {
      restoredPoints: this.buffer.length
    });

    // Seed buffer with Yahoo Finance intraday candles for immediate indicator coverage
    try {
      await this.client.seedBuffer(this.buffer);
    } catch (error) {
      this.logger.warn("Buffer seeding failed — indicators will warm up over time", error);
    }

    this.logger.info("Starting XAUUSD Quantitative Analysis Broadcaster", {
      pollIntervalMs: this.config.pollIntervalMs,
      publishIntervalMs: this.config.publishIntervalMs,
      publishStatePath: this.config.publishStatePath
    });

    let nextPollAt = Date.now();

    for (;;) {
      try {
        await this.pollOnce();
        await this.maybePublish();
      } catch (error) {
        this.logger.error("Broadcast loop iteration failed", error);
      }

      nextPollAt += this.config.pollIntervalMs;
      const lagMs = Date.now() - nextPollAt;
      if (lagMs > this.config.pollIntervalMs) {
        this.logger.warn("Loop fell behind schedule; resetting clock", { lagMs });
        nextPollAt = Date.now() + this.config.pollIntervalMs;
      }

      const sleepMs = Math.max(0, nextPollAt - Date.now());
      await new Promise((resolve) => setTimeout(resolve, sleepMs));
    }
  }
}
