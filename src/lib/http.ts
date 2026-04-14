export interface JsonRequestOptions {
  headers: Record<string, string>;
  timeoutMs: number;
  maxAttempts?: number;
  retryBaseDelayMs?: number;
}

class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    readonly statusText: string,
    readonly url: string,
    readonly body: string
  ) {
    super(`HTTP ${status} ${statusText} for ${url}: ${body}`);
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof HttpStatusError) {
    return isRetryableStatus(error.status);
  }
  return error instanceof Error && (error.name === "AbortError" || error instanceof TypeError);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getJson<T>(url: string, options: JsonRequestOptions): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 1);
  const retryBaseDelayMs = Math.max(50, options.retryBaseDelayMs ?? 250);
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: options.headers,
        signal: controller.signal
      });

      if (!response.ok) {
        const body = (await response.text().catch(() => "")).slice(0, 256);
        throw new HttpStatusError(response.status, response.statusText, url, body);
      }

      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isRetryableError(error)) {
        throw error;
      }

      const jitterMs = Math.floor(Math.random() * retryBaseDelayMs);
      const delayMs = retryBaseDelayMs * 2 ** (attempt - 1) + jitterMs;
      await sleep(delayMs);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Request failed for ${url}`);
}
