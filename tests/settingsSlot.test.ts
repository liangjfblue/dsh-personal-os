import { SlotCore } from "@deepseek-ai/dsh-client-ui-slots";
import { describe, expect, it } from "vitest";

import { PERSONAL_OS_SETTINGS_NAMESPACE } from "../src/settingsContract.ts";
import { registerPersonalOsSettingsCard } from "../src/client/settingsSlot.ts";

function registeredSettingsSlot(kind: "keyed" | "list") {
  const slots = new SlotCore();
  slots.register({
    name: "root",
    children: {
      "settings.plugin.item": { kind, scope: "root" },
    },
  } as never, (() => null) as never);

  registerPersonalOsSettingsCard(slots as never, () => null, {
    namespace: PERSONAL_OS_SETTINGS_NAMESPACE,
    legacyId: "dsh-personal-os",
    order: 30,
    locale: "dsh.personal.os",
    inject: () => ({}),
  });
  return slots.entries("settings.plugin.item")[0]?.options;
}

describe("native Personal OS settings card", () => {
  it("supports the keyed settings slot", () => {
    expect(registeredSettingsSlot("keyed")?.key).toBe(PERSONAL_OS_SETTINGS_NAMESPACE);
  });

  it("supports the legacy list settings slot", () => {
    expect(registeredSettingsSlot("list")?.id).toBe("dsh-personal-os");
  });
});
