import { SlotCore } from "@deepseek-ai/dsh-client-ui-slots";
import { describe, expect, it, vi } from "vitest";

import {
  MY_NAVIGATION,
  PERSONAL_OS_SIDEBAR_PRIORITY,
  registerPersonalOsSidebar,
} from "../src/client/sidebar/sidebarContract.ts";

describe("native Personal OS sidebar", () => {
  it("owns the sidebar while preserving native workspace and settings children", () => {
    const slots = new SlotCore();
    slots.register({
      name: "root",
      children: {
        sidebar: { kind: "single", scope: "root" },
      },
    } as never, (() => null) as never);

    expect(() => {
      registerPersonalOsSidebar(slots as never, () => null, () => ({}));
    }).not.toThrow();

    expect(slots.entries("sidebar")[0]?.options.priority).toBe(PERSONAL_OS_SIDEBAR_PRIORITY);

    const register = vi.fn(() => () => undefined);
    const inject = () => ({});
    registerPersonalOsSidebar({ register } as never, "sidebar", inject);

    expect(register).toHaveBeenCalledWith(expect.objectContaining({
      locale: "dsh.personal.os",
      priority: PERSONAL_OS_SIDEBAR_PRIORITY,
      children: {
        "sidebar.workspaces": { kind: "single", scope: "root" },
        "sidebar.settings": { kind: "single", scope: "root" },
        "sidebar.footer.action": { kind: "list", scope: "root" },
      },
      inject,
    }), "sidebar");
  });

  it("shadows the native sidebar when DSH already occupies priority -1", () => {
    const slots = new SlotCore();
    slots.register({
      name: "root",
      children: { sidebar: { kind: "single", scope: "root" } },
    } as never, (() => null) as never);
    slots.register({ name: "sidebar", priority: -1 } as never, (() => null) as never);

    expect(() => {
      registerPersonalOsSidebar(slots as never, () => null, () => ({}));
    }).not.toThrow();
    expect(slots.entries("sidebar")[0]?.options.priority).toBe(PERSONAL_OS_SIDEBAR_PRIORITY);
  });

  it("reuses child slots declared by an existing product sidebar", () => {
    const slots = new SlotCore();
    slots.register({
      name: "root",
      children: { sidebar: { kind: "single", scope: "root" } },
    } as never, (() => null) as never);
    slots.register({
      name: "sidebar",
      priority: -1,
      children: {
        "sidebar.workspaces": { kind: "single", scope: "root" },
        "sidebar.settings": { kind: "single", scope: "root" },
        "sidebar.footer.action": { kind: "list", scope: "root" },
      },
    } as never, (() => null) as never);

    expect(() => {
      registerPersonalOsSidebar(slots as never, () => null, () => ({}));
    }).not.toThrow();
    expect(slots.entries("sidebar")[0]?.options.priority).toBe(PERSONAL_OS_SIDEBAR_PRIORITY);
  });

  it("exposes the complete My navigation with Today available first", () => {
    expect(MY_NAVIGATION).toEqual([
      { id: "today", label: "今天", available: true },
      { id: "inbox", label: "收件箱", available: true },
      { id: "knowledge", label: "知识", available: true },
      { id: "todo", label: "待办", available: true },
      { id: "projects", label: "项目", available: true },
      { id: "timeline", label: "时间线", available: true },
      { id: "calendar", label: "日历", available: true },
    ]);
  });
});
