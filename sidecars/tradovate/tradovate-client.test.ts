import assert from "node:assert/strict";
import test from "node:test";

import { createWebSocket, TradovateClient, type TradovateClientConfig } from "./tradovate-client.js";

class FakeWebSocket {
  static constructedUrls: string[] = [];
  readonly listeners = new Map<string, Array<(event: { data?: unknown; code?: number; message?: unknown }) => void>>();
  readonly sent: string[] = [];

  constructor(readonly url: string) {
    FakeWebSocket.constructedUrls.push(url);
  }

  addEventListener(type: string, listener: (event: { data?: unknown; code?: number; message?: unknown }) => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.emit("close", { code: 1000 });
  }

  emit(type: string, event: { data?: unknown; code?: number; message?: unknown }): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

const config: TradovateClientConfig = {
  envName: "demo",
  restUrl: "https://demo.tradovateapi.com/v1",
  mdWsUrl: "wss://md.tradovateapi.com/v1/websocket",
  username: "user",
  password: "password",
  appId: "app",
  appVersion: "1.0",
  cid: "cid",
  sec: "sec",
  contract: "GCM6",
};

test("createWebSocket prefers native WebSocket when available", () => {
  FakeWebSocket.constructedUrls = [];
  const socket = createWebSocket("wss://native.example", {
    nativeWebSocket: FakeWebSocket,
    fallbackWebSocket: undefined,
  });

  assert.equal(socket instanceof FakeWebSocket, true);
  assert.deepEqual(FakeWebSocket.constructedUrls, ["wss://native.example"]);
});

test("createWebSocket uses ws-compatible fallback when native WebSocket is unavailable", () => {
  FakeWebSocket.constructedUrls = [];
  const socket = createWebSocket("wss://fallback.example", {
    nativeWebSocket: undefined,
    fallbackWebSocket: FakeWebSocket,
  });

  assert.equal(socket instanceof FakeWebSocket, true);
  assert.deepEqual(FakeWebSocket.constructedUrls, ["wss://fallback.example"]);
});

test("--once Tradovate session times out without a quote", async () => {
  const originalFetch = globalThis.fetch;
  const originalWebSocket = (globalThis as unknown as { WebSocket?: unknown }).WebSocket;
  (globalThis as unknown as { WebSocket?: unknown }).WebSocket = class TimeoutWebSocket extends FakeWebSocket {
    constructor(url: string) {
      super(url);
      setTimeout(() => this.emit("message", { data: "o" }), 0);
    }
  };
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        accessToken: "token",
        expirationTime: new Date(Date.now() + 90_000).toISOString(),
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  try {
    const client = new TradovateClient(config);
    await assert.rejects(
      client.runQuoteSession(() => false, { once: true, onceTimeoutMs: 10 }),
      /No valid Tradovate quote within 10ms/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    (globalThis as unknown as { WebSocket?: unknown }).WebSocket = originalWebSocket;
  }
});
