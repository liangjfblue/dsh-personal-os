import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";

export interface PersonalOsSettings {
  schemaVersion: 1;
  personalDataDirectory: string;
  versionHistory: boolean;
  curationLevel: "off" | "balanced" | "proactive";
  historicalLearning: boolean;
  crossWorkspaceLearning: boolean;
  excludedWorkspaces: string[];
  excludedSessions: string[];
}

export function emptyPersonalOsSettings(): PersonalOsSettings {
  return {
    schemaVersion: 1,
    personalDataDirectory: "",
    versionHistory: false,
    curationLevel: "balanced",
    historicalLearning: false,
    crossWorkspaceLearning: false,
    excludedWorkspaces: [],
    excludedSessions: [],
  };
}

function decodePersonalOsSettings(value: unknown): PersonalOsSettings {
  if (typeof value !== "object" || value === null) {
    throw new Error("Settings must be a JSON object");
  }
  const record = value as Record<string, unknown>;
  const personalDataDirectory = record.personalDataDirectory;
  if (
    record.schemaVersion !== 1
    || typeof personalDataDirectory !== "string"
    || !isAbsolute(personalDataDirectory)
  ) {
    throw new Error("Settings do not match schema version 1");
  }
  const curationLevel = record.curationLevel;
  return {
    schemaVersion: 1,
    personalDataDirectory,
    versionHistory: record.versionHistory === true,
    curationLevel: curationLevel === "off" || curationLevel === "proactive" ? curationLevel : "balanced",
    historicalLearning: record.historicalLearning === true,
    crossWorkspaceLearning: record.crossWorkspaceLearning === true,
    excludedWorkspaces: Array.isArray(record.excludedWorkspaces) ? record.excludedWorkspaces.filter((item): item is string => typeof item === "string") : [],
    excludedSessions: Array.isArray(record.excludedSessions) ? record.excludedSessions.filter((item): item is string => typeof item === "string") : [],
  };
}

const writeTails = new Map<string, Promise<void>>();

async function serialize<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = writeTails.get(key) ?? Promise.resolve();
  const current = previous.then(work, work);
  writeTails.set(key, current.then(() => undefined, () => undefined));
  return current;
}

export class PersonalOsSettingsStore {
  readonly path: string;

  constructor(readonly dataDir: string) {
    this.path = join(dataDir, "settings.json");
  }

  async load(): Promise<PersonalOsSettings> {
    try {
      const source = await readFile(this.path, "utf8");
      return decodePersonalOsSettings(JSON.parse(source) as unknown);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return emptyPersonalOsSettings();
      }
      throw new Error("Could not read Personal OS settings", { cause: error });
    }
  }

  async setPersonalDataDirectory(path: string): Promise<PersonalOsSettings> {
    const personalDataDirectory = path.trim();
    if (!isAbsolute(personalDataDirectory)) {
      throw new Error("Personal Data Directory must be an absolute path");
    }
    await mkdir(personalDataDirectory, { recursive: true });
    return serialize(this.path, async () => {
      const current = await this.load();
      const settings: PersonalOsSettings = { ...current, personalDataDirectory };
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
      await rename(temporary, this.path);
      return settings;
    });
  }

  async update(patch: Partial<Omit<PersonalOsSettings, "schemaVersion" | "personalDataDirectory">>): Promise<PersonalOsSettings> {
    return serialize(this.path, async () => {
      const current = await this.load();
      const settings: PersonalOsSettings = { ...current, ...patch, schemaVersion: 1 };
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
      await rename(temporary, this.path);
      return settings;
    });
  }
}
