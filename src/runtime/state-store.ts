import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { GoldPublishState } from "../analysis/types.js";

function isValidPublishState(value: unknown): value is GoldPublishState {
  if (!value || typeof value !== "object") return false;
  const c = value as Partial<GoldPublishState>;
  return (
    typeof c.asOf === "number" &&
    Number.isFinite(c.asOf) &&
    typeof c.price === "number" &&
    Number.isFinite(c.price) &&
    typeof c.confidence === "number" &&
    typeof c.trend === "string" &&
    typeof c.regime === "string"
  );
}

export class PublishStateStore {
  constructor(private readonly filePath = resolve(".runtime/last-publish.json")) {}

  async read(): Promise<GoldPublishState | null> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (!isValidPublishState(parsed)) {
        throw new Error(`Publish state file has invalid shape: ${this.filePath}`);
      }
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async write(state: GoldPublishState): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(state, null, 2), "utf8");
  }
}
