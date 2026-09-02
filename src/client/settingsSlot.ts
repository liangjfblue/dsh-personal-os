export interface CompatibleSettingsSlots {
  register: (
    options: Record<string, unknown>,
    component: unknown,
  ) => () => void;
}

export function registerPersonalOsSettingsCard(
  slots: CompatibleSettingsSlots,
  component: unknown,
  options: {
    namespace: string;
    legacyId: string;
    order: number;
    locale: string;
    inject: () => object;
  },
): () => void {
  return slots.register({
    name: "settings.plugin.item",
    key: options.namespace,
    id: options.legacyId,
    order: options.order,
    locale: options.locale,
    inject: options.inject,
  }, component);
}
