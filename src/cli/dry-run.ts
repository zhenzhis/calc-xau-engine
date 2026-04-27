import { analyzeGold } from "../analysis/engine.js";
import { MarketDataHub } from "../data/market-data-hub.js";
import { buildDiscordPayload, publishToDiscord } from "../discord/webhook.js";
import { getEventRisk, loadEventCalendar } from "../events/event-calendar.js";
import { Logger } from "../lib/logger.js";
import { loadConfig } from "../config.js";
import { FredProvider } from "../macro/fred-provider.js";

async function main(): Promise<void> {
  const logger = new Logger("info");
  const config = loadConfig();
  const marketDataHub = new MarketDataHub(config, logger);
  const fredProvider = new FredProvider(config);

  logger.info("Fetching market data snapshot...");
  const snapshot = await marketDataHub.fetchSnapshot();
  logger.info("Snapshot received", {
    price: snapshot.primary.price,
    symbol: snapshot.primary.symbol,
    source: snapshot.primary.source,
    fallback: snapshot.primary.fallback,
    barCoverage: snapshot.barCoverage
  });

  const [events, macro] = await Promise.all([
    loadEventCalendar(config.eventCalendarPath),
    fredProvider.fetchSnapshot()
  ]);
  const eventRisk = getEventRisk(events, Date.now(), config.enableEventGate);

  logger.info("Running analysis...", { barCoverage: snapshot.barCoverage, eventRisk: eventRisk.mode });
  const analysis = analyzeGold(snapshot, {
    macro,
    macroDrivers: fredProvider.deriveDrivers(macro),
    eventRisk
  });

  const payload = buildDiscordPayload(analysis);

  const publishFlag = process.argv.includes("--publish");
  if (publishFlag) {
    logger.info("Publishing to Discord...");
    await publishToDiscord(config, payload);
    logger.info("Published successfully.");
  }

  console.log(JSON.stringify({ analysis, payload }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
