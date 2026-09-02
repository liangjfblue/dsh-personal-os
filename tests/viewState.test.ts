import { afterEach, describe, expect, it } from "vitest";

import {
  getPersonalOsSetupState,
  setPersonalOsSetupState,
  setSidebarTab,
  shouldShowPersonalOsOverlay,
} from "../src/client/viewState.ts";

afterEach(() => {
  setSidebarTab("conversation");
  setPersonalOsSetupState("loading");
});

describe("Personal OS setup view state", () => {
  it("keeps the mandatory setup overlay visible while loading or failed", () => {
    setSidebarTab("conversation");

    setPersonalOsSetupState("loading");
    expect(shouldShowPersonalOsOverlay()).toBe(true);

    setPersonalOsSetupState("error");
    expect(getPersonalOsSetupState()).toBe("error");
    expect(shouldShowPersonalOsOverlay()).toBe(true);

    setPersonalOsSetupState("configured");
    expect(shouldShowPersonalOsOverlay()).toBe(false);
  });
});
