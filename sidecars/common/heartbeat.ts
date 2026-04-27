import { safeJson } from "./redaction.js";

export interface HeartbeatStatus {
  [key: string]: string | number | boolean | null | undefined | Record<string, unknown>;
}

export function createHeartbeat(
  name: string,
  intervalMs = 30_000,
  getStatus: () => HeartbeatStatus = () => ({}),
): NodeJS.Timeout {
  const timer = setInterval(() => {
    const status = getStatus();
    console.log(
      safeJson({
        event: "heartbeat",
        sidecar: name,
        timestampMs: Date.now(),
        ...status,
      }),
    );
  }, intervalMs);
  timer.unref();
  return timer;
}

export const startHeartbeat = createHeartbeat;
