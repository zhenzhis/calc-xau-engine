import { RuntimeConfig } from "../types.js";

const priority = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
} as const;

type LogLevel = keyof typeof priority;

export class Logger {
  constructor(private readonly level: RuntimeConfig["logLevel"]) {}

  private canLog(level: LogLevel): boolean {
    return priority[level] >= priority[this.level];
  }

  private emit(level: LogLevel, message: string, meta?: unknown): void {
    if (!this.canLog(level)) return;
    const prefix = `[${new Date().toISOString()}] ${level.toUpperCase()}`;
    if (meta === undefined) {
      console.log(prefix, message);
      return;
    }
    console.log(prefix, message, meta);
  }

  debug(message: string, meta?: unknown): void { this.emit("debug", message, meta); }
  info(message: string, meta?: unknown): void { this.emit("info", message, meta); }
  warn(message: string, meta?: unknown): void { this.emit("warn", message, meta); }
  error(message: string, meta?: unknown): void { this.emit("error", message, meta); }
}
