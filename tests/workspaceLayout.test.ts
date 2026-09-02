import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
  PERSONAL_OS_SIDEBAR_WIDTH_VAR,
  applySidebarLayout,
  releaseSidebarLayout,
  type SidebarLayoutStyle,
} from "../src/client/sidebarLayout.ts";
import {
  applyConversationInset,
  restoreConversationInset,
  type ConversationInsetHost,
} from "../src/client/conversationInset.ts";
import { isInspectorVisible } from "../src/client/viewState.ts";

function fakeStyle(): SidebarLayoutStyle {
  return { setProperty: vi.fn(), removeProperty: vi.fn() };
}

describe("sidebar layout variable", () => {
  it("publishes the live sidebar width for the workspace anchor", () => {
    const style = fakeStyle();
    applySidebarLayout(312, style);
    expect(style.setProperty).toHaveBeenCalledWith(PERSONAL_OS_SIDEBAR_WIDTH_VAR, "312px");
  });

  it("passes the collapsed rail width through unchanged", () => {
    const style = fakeStyle();
    applySidebarLayout(56, style);
    expect(style.setProperty).toHaveBeenCalledWith(PERSONAL_OS_SIDEBAR_WIDTH_VAR, "56px");
  });

  it("removes the variable when the sidebar unmounts", () => {
    const style = fakeStyle();
    releaseSidebarLayout(style);
    expect(style.removeProperty).toHaveBeenCalledWith(PERSONAL_OS_SIDEBAR_WIDTH_VAR);
  });

  it("is a no-op outside a document environment", () => {
    expect(() => { applySidebarLayout(280); }).not.toThrow();
    expect(() => { releaseSidebarLayout(); }).not.toThrow();
  });
});

describe("inspector visibility", () => {
  it("opens for a draft even without a selection", () => {
    expect(isInspectorVisible("create", false)).toBe(true);
  });

  it("opens for a resolved selection", () => {
    expect(isInspectorVisible("page", true)).toBe(true);
  });

  it("stays closed without a selection or draft", () => {
    expect(isInspectorVisible("page", false)).toBe(false);
    expect(isInspectorVisible("search", false)).toBe(false);
    expect(isInspectorVisible("graph", false)).toBe(false);
  });
});

describe("conversation inset", () => {
  function fakeInsetHost(initial: Record<string, string> = {}): ConversationInsetHost {
    const values = new Map(Object.entries(initial));
    return {
      style: {
        setProperty: (name, value) => { values.set(name, value); },
        removeProperty: (name) => { values.delete(name); },
        getPropertyValue: (name) => values.get(name) ?? "",
        getPropertyPriority: () => "",
      },
    };
  }

  it("pads the conversation host by the workspace width", () => {
    const host = fakeInsetHost();
    applyConversationInset(980, false, host);
    expect(host.style.getPropertyValue("padding-left")).toBe("980px");
  });

  it("releases the inset back to the original inline styles", () => {
    const host = fakeInsetHost({ "padding-left": "12px" });
    applyConversationInset(980, false, host);
    expect(host.style.getPropertyValue("padding-left")).toBe("980px");
    restoreConversationInset();
    expect(host.style.getPropertyValue("padding-left")).toBe("12px");
  });

  it("treats zero width as a restore", () => {
    const host = fakeInsetHost();
    applyConversationInset(980, false, host);
    applyConversationInset(0, false, host);
    expect(host.style.getPropertyValue("padding-left")).toBe("");
  });

  it("is a no-op without a host", () => {
    expect(() => { applyConversationInset(980, false, null); }).not.toThrow();
    expect(() => { restoreConversationInset(); }).not.toThrow();
  });
});

describe("workspace layout css", () => {
  const css = readFileSync(new URL("../src/client/styles.css", import.meta.url), "utf8");
  const surface = readFileSync(new URL("../src/client/TodaySurface.tsx", import.meta.url), "utf8");

  it("anchors the workspace to the sidebar width and the right edge", () => {
    expect(css).toContain("left: var(--personal-os-sidebar-width, 280px)");
    expect(css).toContain("right: 0");
  });

  it("no longer uses a fixed screen-anchored width", () => {
    expect(css).not.toContain("width: min(74vw");
    expect(css).not.toContain("min-width: 760px");
  });

  it("gives the inspector a readable detail column without collapsing the list", () => {
    const openRules = css.match(/\[data-surface="workspace"\]\[data-inspector="open"\]\s*\{[^}]*\}/g) ?? [];
    const openRule = openRules.find((rule) => rule.includes("grid-template-columns"));
    expect(openRule).toBeDefined();
    expect(openRule!).toContain("minmax(280px, .8fr) minmax(400px, 1.2fr)");
    const baseRule = css.match(/\[data-surface="workspace"\]\s*\{[^}]*\}/)![0];
    expect(baseRule).toContain("grid-template-columns: minmax(0, 1fr)");
  });

  it("keeps narrow windows single-column without a :has visibility hack", () => {
    expect(css).not.toContain(":has(");
    const narrow = css.slice(css.indexOf("@media (max-width: 980px)"));
    expect(narrow.slice(0, narrow.indexOf("}") + 1)).toContain("grid-template-columns: 1fr");
  });

  it("expands the workspace for inspector while preserving the conversation", () => {
    const wide = css.slice(css.indexOf("@media (min-width: 1200px)"));
    const block = wide.slice(0, wide.indexOf("[data-inspector=\"open\"]"));
    expect(block).toContain("right: auto");
    expect(block).toContain("width: min(30vw, 460px");
    const fourPaneStart = css.indexOf("@media (min-width: 1360px)");
    const fourPaneEnd = css.indexOf("@media (min-width: 1600px)", fourPaneStart);
    const fourPane = css.slice(fourPaneStart, fourPaneEnd);
    const openWide = fourPane.slice(fourPane.indexOf("[data-inspector=\"open\"]"));
    const openRule = openWide.slice(0, openWide.indexOf("}") + 1);
    expect(openRule).toContain("width: min(68vw, 820px");
    expect(openRule).toContain("minmax(280px, .65fr) minmax(500px, 1.35fr)");
    expect(fourPane).not.toContain(".workspaceMain { display: none; }");
  });

  it("guarantees the conversation a floor at desktop and wide desktop sizes", () => {
    expect(css).toContain("- 440px)");
    expect(css).toContain("- 360px)");
    expect(css).toContain("- 520px)");
  });

  it("projects one Task Outcome review into Today and the conversation dock", () => {
    expect(surface).toContain("function OutcomeReview");
    expect(surface).toContain("export function TaskOutcomeDock");
    expect(surface).toContain("face.listTaskOutcomes()");
    expect(surface).toContain("face.reviewTaskOutcome");
    expect(surface).toContain("等待我确认");
    expect(surface).toContain("存入收件箱");
    expect(surface).toContain("function ActiveTaskSection");
    expect(surface).toContain("为什么这样判断");
    expect(surface).toContain("face.correctTaskBoundary");
    expect(surface).toContain("face.openSession");
    expect(surface).toContain("face.getSessionTaskContext");
    expect(surface).toContain("已使用");
    expect(surface).toContain("将要更新");
  });

  it("keeps Outcome review keyboard-visible and announces editor save state", () => {
    expect(surface).toContain('role="status" aria-live="polite"');
    expect(surface).toContain('event.key === "Enter" || event.key === " "');
    expect(css).toContain(".outcomeCard");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
