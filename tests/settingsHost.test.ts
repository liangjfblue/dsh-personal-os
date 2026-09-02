import { describe, expect, it, vi } from "vitest";

import { PERSONAL_OS_SETTINGS_NAMESPACE } from "../src/settingsContract.ts";
import {
  PERSONAL_OS_SETTINGS_DISCOVERY_SCHEMA,
  registerPersonalOsSettingsNamespace,
} from "../src/settingsHost.ts";

describe("Personal OS settings namespace", () => {
  it("registers the namespace used to dispatch the native settings card", () => {
    const register = vi.fn();

    registerPersonalOsSettingsNamespace({ register } as never);

    expect(register).toHaveBeenCalledOnce();
    expect(String(register.mock.calls[0]?.[0])).toBe(PERSONAL_OS_SETTINGS_NAMESPACE);
    expect(register.mock.calls[0]?.[1]).toBe(PERSONAL_OS_SETTINGS_DISCOVERY_SCHEMA);
  });
});
