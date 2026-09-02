import { describe, expect, it, vi } from "vitest";

import { choosePersonalDataDirectory } from "../src/client/directorySelection.ts";

describe("Personal Data Directory selection", () => {
  it("does not save when the native picker is cancelled", async () => {
    const setPersonalDataDirectory = vi.fn();

    await expect(choosePersonalDataDirectory({
      pickDirectory: async () => null,
      setPersonalDataDirectory,
    })).resolves.toBe(false);
    expect(setPersonalDataDirectory).not.toHaveBeenCalled();
  });

  it("saves the directory returned by the native picker", async () => {
    const setPersonalDataDirectory = vi.fn(async () => undefined);

    await expect(choosePersonalDataDirectory({
      pickDirectory: async () => "/Users/example/Personal OS",
      setPersonalDataDirectory,
    })).resolves.toBe(true);
    expect(setPersonalDataDirectory).toHaveBeenCalledWith("/Users/example/Personal OS");
  });
});
