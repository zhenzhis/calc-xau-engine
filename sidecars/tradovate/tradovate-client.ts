import { safeJson } from "../common/redaction.js";
import WsWebSocket from "ws";

export interface TradovateClientConfig {
  envName: "demo" | "live";
  restUrl: string;
  mdWsUrl: string;
  username: string;
  password: string;
  appId: string;
  appVersion: string;
  cid: string;
  sec: string;
  contract: string;
}

export interface TradovateQuote {
  timestampMs: number;
  bid?: number;
  ask?: number;
  last?: number;
  volume?: number;
}

interface TokenState {
  accessToken: string;
  mdAccessToken?: string;
  expirationMs: number;
}

type WebSocketEvent = { data?: unknown; code?: number; message?: unknown };
type WebSocketListener = (event: WebSocketEvent) => void;
type WebSocketLike = {
  addEventListener(type: string, listener: WebSocketListener): void;
  send(data: string): void;
  close(): void;
};
type WebSocketConstructor = new (url: string) => WebSocketLike;
type QuoteHandler = (quote: TradovateQuote) => void | boolean | Promise<void | boolean>;

export interface TradovateQuoteSessionOptions {
  once?: boolean;
  onceTimeoutMs?: number;
}

export interface WebSocketFactoryOptions {
  nativeWebSocket?: WebSocketConstructor;
  fallbackWebSocket?: WebSocketConstructor;
}

const AUTH_REQUEST_ID = 1;
const SUBSCRIBE_QUOTE_REQUEST_ID = 2;
const TOKEN_RENEW_LEAD_MS = 15 * 60 * 1_000;
const DEFAULT_TOKEN_TTL_MS = 90 * 60 * 1_000;

export class TradovateClient {
  private tokenState: TokenState | null = null;

  constructor(private readonly config: TradovateClientConfig) {}

  async runQuoteSession(onQuote: QuoteHandler, options: TradovateQuoteSessionOptions = {}): Promise<void> {
    const token = await this.ensureToken();
    const authToken = token.mdAccessToken || token.accessToken;
    const ws = createWebSocket(this.config.mdWsUrl);
    const latest: Omit<TradovateQuote, "timestampMs"> = {};
    const reconnectBeforeExpiryMs = Math.max(1_000, token.expirationMs - Date.now() - TOKEN_RENEW_LEAD_MS);

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const onceTimeout = options.once
        ? setTimeout(() => fail(new Error(`No valid Tradovate quote within ${options.onceTimeoutMs ?? 30_000}ms`)), options.onceTimeoutMs ?? 30_000)
        : null;
      onceTimeout?.unref();
      const expiryTimer = setTimeout(() => {
        try {
          ws.close();
        } finally {
          reject(new Error("Tradovate token renewal window reached"));
        }
      }, reconnectBeforeExpiryMs);
      expiryTimer.unref();

      const fail = (error: Error): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (onceTimeout) {
          clearTimeout(onceTimeout);
        }
        clearTimeout(expiryTimer);
        try {
          ws.close();
        } catch {
          // Socket is already closing; original error remains the useful context.
        }
        reject(error);
      };
      const succeed = (): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (onceTimeout) {
          clearTimeout(onceTimeout);
        }
        clearTimeout(expiryTimer);
        ws.close();
        resolve();
      };

      ws.addEventListener("message", (event) => {
        void this
          .handleFrame(String(event.data ?? ""), ws, authToken, latest, onQuote, options)
          .then((shouldResolve) => {
            if (shouldResolve) {
              succeed();
            }
          })
          .catch((error) => fail(error instanceof Error ? error : new Error(String(error))));
      });
      ws.addEventListener("error", (event) => {
        fail(new Error(`Tradovate websocket error: ${String(event.message ?? "unknown error")}`));
      });
      ws.addEventListener("close", (event) => {
        fail(new Error(`Tradovate websocket closed: code=${String(event.code ?? "unknown")}`));
      });
    });
  }

  private async ensureToken(): Promise<TokenState> {
    if (this.tokenState && this.tokenState.expirationMs - Date.now() > TOKEN_RENEW_LEAD_MS) {
      return this.tokenState;
    }
    if (this.tokenState) {
      this.tokenState = await this.renewAccessToken(this.tokenState.accessToken);
      return this.tokenState;
    }
    this.tokenState = await this.requestAccessToken();
    return this.tokenState;
  }

  private async requestAccessToken(): Promise<TokenState> {
    const response = await this.fetchJson(`${this.config.restUrl}/auth/accesstokenrequest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: this.config.username,
        password: this.config.password,
        appId: this.config.appId,
        appVersion: this.config.appVersion,
        cid: this.config.cid,
        sec: this.config.sec,
      }),
    });
    return tokenFromResponse(response);
  }

  private async renewAccessToken(accessToken: string): Promise<TokenState> {
    const response = await this.fetchJson(`${this.config.restUrl}/auth/renewAccessToken`, {
      method: "GET",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    return tokenFromResponse(response);
  }

  private async handleFrame(
    frame: string,
    ws: WebSocketLike,
    authToken: string,
    latest: Omit<TradovateQuote, "timestampMs">,
    onQuote: QuoteHandler,
    options: TradovateQuoteSessionOptions,
  ): Promise<boolean> {
    if (frame === "o") {
      sendWsRequest(ws, "authorize", AUTH_REQUEST_ID, authToken);
      return false;
    }
    if (frame === "h") {
      ws.send("");
      return false;
    }
    if (!frame.startsWith("a")) {
      console.warn(safeJson({ event: "tradovate_unhandled_frame", frame: frame.slice(0, 120) }));
      return false;
    }

    const messages = JSON.parse(frame.slice(1)) as unknown[];
    for (const message of messages) {
      const record = asRecord(message);
      if (!record) {
        continue;
      }
      throwOnTradovateError(record);
      if (isResponseTo(record, AUTH_REQUEST_ID)) {
        sendWsRequest(ws, "md/subscribeQuote", SUBSCRIBE_QUOTE_REQUEST_ID, { symbol: this.config.contract });
        continue;
      }
      for (const quote of extractQuotes(record, latest)) {
        const accepted = await onQuote(quote);
        if (options.once && accepted === true) {
          return true;
        }
      }
    }
    return false;
  }

  private async fetchJson(url: string, init: RequestInit): Promise<Record<string, unknown>> {
    const response = await fetch(url, init);
    const bodyText = await response.text();
    if (!response.ok) {
      throw new Error(`Tradovate HTTP ${response.status}: ${String(safeJson({ body: bodyText.slice(0, 500) }))}`);
    }
    const parsed = JSON.parse(bodyText) as unknown;
    const record = asRecord(parsed);
    if (!record) {
      throw new Error(`Tradovate response was not a JSON object: ${url}`);
    }
    const errorText = record.errorText;
    if (typeof errorText === "string" && errorText.length > 0) {
      throw new Error(`Tradovate error: ${errorText}`);
    }
    return record;
  }
}

function extractQuotes(
  message: Record<string, unknown>,
  latest: Omit<TradovateQuote, "timestampMs">,
): TradovateQuote[] {
  if (message.e !== "md") {
    return [];
  }
  const data = asRecord(message.d);
  if (!data || !Array.isArray(data.quotes)) {
    return [];
  }

  return data.quotes.flatMap((rawQuote) => {
    const quote = asRecord(rawQuote);
    if (!quote) {
      return [];
    }
    const entries = asRecord(quote.entries);
    if (!entries) {
      return [];
    }
    const timestampMs = quoteTimestampMs(quote);
    const bid = entryPrice(entries.Bid);
    const ask = entryPrice(entries.Offer);
    const last = entryPrice(entries.Trade);
    const volume = entrySize(entries.TotalTradeVolume);

    if (bid !== undefined) {
      latest.bid = bid;
    }
    if (ask !== undefined) {
      latest.ask = ask;
    }
    if (last !== undefined) {
      latest.last = last;
    }
    if (volume !== undefined) {
      latest.volume = volume;
    }
    if (latest.bid === undefined && latest.ask === undefined && latest.last === undefined) {
      return [];
    }
    return [{ timestampMs, ...latest }];
  });
}

function tokenFromResponse(response: Record<string, unknown>): TokenState {
  const accessToken = response.accessToken;
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    throw new Error("Tradovate auth response did not include accessToken");
  }
  const mdAccessToken = typeof response.mdAccessToken === "string" ? response.mdAccessToken : undefined;
  const expirationMs = parseExpirationMs(response.expirationTime);
  return { accessToken, mdAccessToken, expirationMs };
}

function parseExpirationMs(value: unknown): number {
  if (typeof value !== "string") {
    return Date.now() + DEFAULT_TOKEN_TTL_MS;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now() + DEFAULT_TOKEN_TTL_MS;
}

function sendWsRequest(ws: WebSocketLike, endpoint: string, requestId: number, body: unknown): void {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  ws.send(`${endpoint}\n${requestId}\n\n${payload}`);
}

export function createWebSocket(url: string, options: WebSocketFactoryOptions = {}): WebSocketLike {
  const nativeCtor = Object.hasOwn(options, "nativeWebSocket")
    ? options.nativeWebSocket
    : (globalThis as unknown as { WebSocket?: WebSocketConstructor }).WebSocket;
  if (nativeCtor) {
    return new nativeCtor(url);
  }

  const fallbackCtor = options.fallbackWebSocket ?? (WsWebSocket as unknown as WebSocketConstructor | undefined);
  if (!fallbackCtor) {
    throw new Error("WebSocket is unavailable; install ws or run with Node.js native WebSocket support");
  }
  return new fallbackCtor(url);
}

function isResponseTo(record: Record<string, unknown>, requestId: number): boolean {
  return asFiniteNumber(record.i) === requestId;
}

function throwOnTradovateError(record: Record<string, unknown>): void {
  const status = asFiniteNumber(record.s);
  if (status !== undefined && status >= 400) {
    throw new Error(`Tradovate websocket request failed: ${safeJson(record)}`);
  }
}

function quoteTimestampMs(quote: Record<string, unknown>): number {
  const timestamp = quote.timestamp;
  if (typeof timestamp === "string") {
    const parsed = Date.parse(timestamp);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return Date.now();
}

function entryPrice(rawEntry: unknown): number | undefined {
  const entry = asRecord(rawEntry);
  return entry ? asFiniteNumber(entry.price) : undefined;
}

function entrySize(rawEntry: unknown): number | undefined {
  const entry = asRecord(rawEntry);
  return entry ? asFiniteNumber(entry.size) : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
