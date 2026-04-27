import { appendFile, mkdir, rename, stat } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";

import { parseNumberEnv } from "./env.js";

export interface AppendJsonlOptions {
  maxBytes?: number;
}

const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;

export async function appendJsonl(
  filePath: string,
  object: unknown,
  options: AppendJsonlOptions = {},
): Promise<void> {
  const maxBytes = options.maxBytes ?? parseNumberEnv("JSONL_MAX_BYTES", DEFAULT_MAX_BYTES, { min: 0 });
  const line = `${JSON.stringify(object)}\n`;

  await mkdir(dirname(filePath), { recursive: true });
  await rotateIfNeeded(filePath, maxBytes, Buffer.byteLength(line, "utf8"));
  await appendFile(filePath, line, { encoding: "utf8", flag: "a" });
}

async function rotateIfNeeded(filePath: string, maxBytes: number, nextWriteBytes: number): Promise<void> {
  if (maxBytes <= 0) {
    return;
  }

  let size = 0;
  try {
    size = (await stat(filePath)).size;
  } catch (error) {
    if (isMissingFile(error)) {
      return;
    }
    throw error;
  }

  if (size + nextWriteBytes <= maxBytes) {
    return;
  }

  const archiveDir = join(dirname(filePath), "archive");
  await mkdir(archiveDir, { recursive: true });
  const rotatedPath = join(archiveDir, `${basename(filePath, extname(filePath))}-${timestampForFile()}${extname(filePath)}`);
  await rename(filePath, rotatedPath);
  console.warn(JSON.stringify({ event: "jsonl_rotated", filePath, rotatedPath, size, maxBytes }));
}

function timestampForFile(): string {
  const iso = new Date().toISOString();
  return `${iso.slice(0, 10).replace(/-/g, "")}-${iso.slice(11, 19).replace(/:/g, "")}`;
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
