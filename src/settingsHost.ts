import Schema from "@deepseek-ai/schemastery";
import { settingsNamespace, type SettingsProvider } from "@deepseek-ai/dsh-settings";

import { PERSONAL_OS_SETTINGS_NAMESPACE } from "./settingsContract.ts";

export const PERSONAL_OS_SETTINGS_DISCOVERY_SCHEMA = Schema.object({});

export function registerPersonalOsSettingsNamespace(
  settings: Pick<SettingsProvider, "register">,
): void {
  settings.register(
    settingsNamespace(PERSONAL_OS_SETTINGS_NAMESPACE),
    PERSONAL_OS_SETTINGS_DISCOVERY_SCHEMA,
  );
}
