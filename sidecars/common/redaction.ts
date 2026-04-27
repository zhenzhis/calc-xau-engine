const SENSITIVE_KEY_PATTERN = /(password|token|secret|sec|accessToken|mdAccessToken)/i;
const SENSITIVE_ASSIGNMENT_PATTERN =
  /(["']?)(password|token|secret|sec|accessToken|mdAccessToken)\1\s*[:=]\s*(["'].*?["']|[^\s,|}]+)/gi;

export function redactSecrets<T>(value: T): T | string {
  if (typeof value === "string") {
    return redactString(value);
  }
  return redactValue(value) as T;
}

export function safeJson(value: unknown): string {
  return JSON.stringify(redactSecrets(value));
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    redacted[key] = SENSITIVE_KEY_PATTERN.test(key) ? "[REDACTED]" : redactValue(nested);
  }
  return redacted;
}

function redactString(value: string): string {
  return value.replace(SENSITIVE_ASSIGNMENT_PATTERN, (_match, quote: string, key: string) => `${quote}${key}${quote}:[REDACTED]`);
}
