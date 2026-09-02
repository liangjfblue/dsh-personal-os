import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  PersonalOsSettingsStore,
  emptyPersonalOsSettings,
} from "../src/settingsStore.ts";

const temporaryDirectories: string[] = [];

async function temporarySettingsDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "personal-os-settings-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

describe("Personal OS settings", () => {
  it("starts without choosing a Personal Data Directory", async () => {
    const dataDir = await temporarySettingsDirectory();
    const store = new PersonalOsSettingsStore(dataDir);

    await expect(store.load()).resolves.toEqual(emptyPersonalOsSettings());
  });

  it("creates and remembers the selected Personal Data Directory", async () => {
    const dataDir = await temporarySettingsDirectory();
    const personalDataDirectory = join(dataDir, "My Personal OS");
    const store = new PersonalOsSettingsStore(dataDir);

    const expected = { ...emptyPersonalOsSettings(), personalDataDirectory };
    await expect(store.setPersonalDataDirectory(personalDataDirectory)).resolves.toEqual(expected);
    await expect(new PersonalOsSettingsStore(dataDir).load()).resolves.toEqual(expected);
  });

  it("rejects an empty or relative directory without replacing the saved choice", async () => {
    const dataDir = await temporarySettingsDirectory();
    const personalDataDirectory = join(dataDir, "Personal OS");
    const store = new PersonalOsSettingsStore(dataDir);
    await store.setPersonalDataDirectory(personalDataDirectory);

    await expect(store.setPersonalDataDirectory("  ")).rejects.toThrow("absolute");
    await expect(store.setPersonalDataDirectory("notes/personal-os")).rejects.toThrow("absolute");
    await expect(store.load()).resolves.toEqual({ ...emptyPersonalOsSettings(), personalDataDirectory });
  });

  it("surfaces corrupt settings without replacing the saved file", async () => {
    const dataDir = await temporarySettingsDirectory();
    const settingsPath = join(dataDir, "settings.json");
    const source = "{ this is not valid JSON\n";
    await writeFile(settingsPath, source, "utf8");

    await expect(new PersonalOsSettingsStore(dataDir).load()).rejects.toThrow(
      "Could not read Personal OS settings",
    );
    await expect(readFile(settingsPath, "utf8")).resolves.toBe(source);
  });
});
