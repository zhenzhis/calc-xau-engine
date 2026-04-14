import { loadConfig } from "./config.js";
import { GoldPriceClient } from "./data/client.js";
import { Logger } from "./lib/logger.js";
import { BroadcastService } from "./runtime/service.js";
import { PublishStateStore } from "./runtime/state-store.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = new Logger(config.logLevel);
  const client = new GoldPriceClient(config, logger);
  const store = new PublishStateStore(config.publishStatePath);
  const service = new BroadcastService(config, logger, client, store);

  logger.info("Starting XAUUSD Quantitative Analysis Bot", {
    pollIntervalMs: config.pollIntervalMs,
    publishIntervalMs: config.publishIntervalMs,
    publishStatePath: config.publishStatePath,
    priceBufferPath: config.priceBufferPath,
    enableMarketHoursOnly: config.enableMarketHoursOnly
  });

  await service.runLoop();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
