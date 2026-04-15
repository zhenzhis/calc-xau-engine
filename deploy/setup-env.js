const fs = require("fs");
const path = "/quant/calc/config/xau-state-discord.env";
const wh = "https://discord.com/api/webhooks/" + "1493676038608130109/" + "urO1glU3YH-KSiBg5Rtme9jM-N8Ileeq8wA3CLXQ77zfQ7o2CM_24kZzl_ZsrMCvZc_n";
const content = [
  "DISCORD_WEBHOOK_URL=" + wh,
  "PUBLISH_STATE_PATH=/quant/calc/data/xau-state-discord/last-publish.json",
  "PRICE_BUFFER_PATH=/quant/calc/data/xau-state-discord/price-buffer.json",
  "MARKET_TIMEZONE=America/New_York",
  "ENABLE_MARKET_HOURS_ONLY=true",
  "MAX_DATA_AGE_MS=900000",
  "LOG_LEVEL=info",
].join("\n") + "\n";
fs.mkdirSync("/quant/calc/config", { recursive: true });
fs.mkdirSync("/quant/calc/data/xau-state-discord", { recursive: true });
fs.writeFileSync(path, content);
console.log("OK — wrote " + path);
console.log(content);
