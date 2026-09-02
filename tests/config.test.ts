import { homedir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  defaultPluginDataDir,
  expandHomePath,
  resolvePluginDataDir,
} from "../src/config.ts";

describe("Personal OS host configuration", () => {
  it("keeps plugin metadata outside the user-owned Personal Data Directory", () => {
    expect(defaultPluginDataDir()).toBe(join(homedir(), ".dsh-personal-os"));
    expect(resolvePluginDataDir({ dataDir: "" })).toBe(defaultPluginDataDir());
  });

  it("expands home-relative advanced configuration", () => {
    expect(expandHomePath("~/personal-os-metadata")).toBe(
      join(homedir(), "personal-os-metadata"),
    );
  });
});
