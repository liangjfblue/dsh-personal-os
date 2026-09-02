export const MY_NAVIGATION = [
  { id: "today", label: "今天", available: true },
  { id: "inbox", label: "收件箱", available: true },
  { id: "knowledge", label: "知识", available: true },
  { id: "todo", label: "待办", available: true },
  { id: "projects", label: "项目", available: true },
  { id: "timeline", label: "时间线", available: true },
  { id: "calendar", label: "日历", available: true },
] as const;

// Product shells such as dsh-oil-creator already shadow the native sidebar at
// -1. SlotCore renders the lowest priority, so Personal OS uses its own rank.
export const PERSONAL_OS_SIDEBAR_PRIORITY = -2;

const PERSONAL_OS_SIDEBAR_CHILDREN = {
  "sidebar.workspaces": { kind: "single", scope: "root" },
  "sidebar.settings": { kind: "single", scope: "root" },
  "sidebar.footer.action": { kind: "list", scope: "root" },
} as const;

export interface CompatibleSidebarSlots {
  register: (
    options: Record<string, unknown>,
    component: unknown,
  ) => () => void;
  spec?: (name: string) => unknown;
}

export function registerPersonalOsSidebar(
  slots: CompatibleSidebarSlots,
  component: unknown,
  inject: () => object,
): () => void {
  const missingChildren = Object.fromEntries(
    Object.entries(PERSONAL_OS_SIDEBAR_CHILDREN).filter(
      ([name]) => slots.spec?.(name) === undefined,
    ),
  );

  return slots.register({
    name: "sidebar",
    locale: "dsh.personal.os",
    priority: PERSONAL_OS_SIDEBAR_PRIORITY,
    ...(Object.keys(missingChildren).length > 0
      ? { children: missingChildren }
      : {}),
    inject,
  }, component);
}
