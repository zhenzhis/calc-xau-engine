export function optionalEnv(name: string, fallback?: string): string | undefined {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  return value;
}

export function requireEnv(name: string): string {
  const value = optionalEnv(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function parseNumberEnv(
  name: string,
  fallback: number,
  options: { min?: number; max?: number } = {},
): number {
  const raw = optionalEnv(name);
  if (raw === undefined) {
    return fallback;
  }

  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`Environment variable ${name} must be a finite number`);
  }
  if (options.min !== undefined && value < options.min) {
    throw new Error(`Environment variable ${name} must be >= ${options.min}`);
  }
  if (options.max !== undefined && value > options.max) {
    throw new Error(`Environment variable ${name} must be <= ${options.max}`);
  }
  return value;
}

export function parseBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = optionalEnv(name);
  if (raw === undefined) {
    return fallback;
  }
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  throw new Error(`Environment variable ${name} must be a boolean`);
}

export const getEnv = optionalEnv;
export const getNumberEnv = parseNumberEnv;
export const getBooleanEnv = parseBooleanEnv;
