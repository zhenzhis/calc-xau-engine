export interface HeartbeatStatus {
  [key: string]: string | number | boolean | null | undefined;
}

export function startHeartbeat(
  name: string,
  getStatus: () => HeartbeatStatus = () => ({}),
  intervalMs = 30_000,
): NodeJS.Timeout {
  const timer = setInterval(() => {
    const status = getStatus();
    console.log(
      JSON.stringify({
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
