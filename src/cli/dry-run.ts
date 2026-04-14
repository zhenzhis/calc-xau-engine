import { analyzeGold } from "../analysis/engine.js";
import { GoldPriceClient, PriceBuffer } from "../data/client.js";
import { buildDiscordPayload, publishToDiscord } from "../discord/webhook.js";
import { Logger } from "../lib/logger.js";
import { loadConfig } from "../config.js";

async function main(): Promise<void> {
  const logger = new Logger("info");
  const config = loadConfig();
  const client = new GoldPriceClient(config, logger);

  logger.info("Fetching XAUUSD quote...");
  const quote = await client.fetchQuote();
  logger.info("Quote received", {
    price: quote.price,
    change: quote.change,
    changePct: quote.changePct,
    previousClose: quote.previousClose,
    timestamp: quote.timestamp
  });

  // Seed buffer with intraday candles for full indicator coverage
  const buffer = new PriceBuffer(config.priceBufferPath);
  await buffer.restore();
  await client.seedBuffer(buffer);
  buffer.push({ price: quote.price, timestamp: quote.timestamp * 1000 });

  logger.info("Running analysis...", { bufferSize: buffer.length });
  const analysis = analyzeGold(quote, buffer);

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
