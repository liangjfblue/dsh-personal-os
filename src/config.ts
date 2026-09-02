import { homedir } from "node:os";
import { join } from "node:path";

import Schema from "@deepseek-ai/schemastery";

export interface Config {
  dataDir: string;
}

export function defaultPluginDataDir(): string {
  return join(homedir(), ".dsh-personal-os");
}

export function expandHomePath(path: string, home = homedir()): string {
  const trimmed = path.trim();
  if (trimmed === "~") return home;
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    const parts = trimmed.slice(2).replaceAll("\\", "/").split("/").filter(Boolean);
    return join(home, ...parts);
  }
  return trimmed;
}

export function resolvePluginDataDir(config: Config): string {
  return config.dataDir.trim() === ""
    ? defaultPluginDataDir()
    : expandHomePath(config.dataDir);
}

export const Config: Schema<Config> = Schema.object({
  dataDir: Schema.string().default(""),
});
