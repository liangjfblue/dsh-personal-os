import {
  IconBrowseOutline16,
  IconNewChatOutline16,
  IconPanelLeftOutline16,
  Tooltip,
} from "@deepseek-ai/dsh-client-ui-primitives";
import { useEffect } from "react";

import { applySidebarLayout, releaseSidebarLayout } from "../sidebarLayout.ts";
import { setSidebarTab, useSidebarTab } from "../viewState.ts";
import { PersonalOsBrand } from "./PersonalOsBrand.tsx";
import { PersonalSidebarPanel } from "./PersonalSidebarPanel.tsx";
import type { PersonalOsSidebarSlotProps } from "./slots.ts";

function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter((part): part is string => typeof part === "string" && part !== "").join(" ");
}

export function PersonalOsSidebarRoot({
  collapsed,
  width,
  startSession,
  toggleSidebar,
  renderSlot,
  t,
}: PersonalOsSidebarSlotProps) {
  const tab = useSidebarTab();
  const wide = !collapsed;
  const conversationVisible = !wide || tab === "conversation";

  useEffect(() => {
    applySidebarLayout(width);
    return () => { releaseSidebarLayout(); };
  }, [width]);

  return (
    <aside
      data-plugin="dsh-personal-os"
      data-surface="sidebar"
      className={cx(collapsed && "collapsed")}
      style={wide ? { width } : undefined}
    >
      <div className="logoRow">
        {wide && (
          <button
            type="button"
            className="brandButton"
            aria-label={t("session.new")}
            onClick={() => { startSession(); }}
          >
            <PersonalOsBrand />
          </button>
        )}
        <Tooltip label={collapsed ? t("sidebar.open") : t("sidebar.collapse")} delayMs={500}>
          <button
            type="button"
            className="iconButton toggle"
            aria-label={collapsed ? t("sidebar.open") : t("sidebar.collapse")}
            onClick={toggleSidebar}
          >
            {collapsed && <span className="railBrand"><PersonalOsBrand compact /></span>}
            <IconPanelLeftOutline16 className="panelIcon" size={wide ? 16 : 18} />
          </button>
        </Tooltip>
      </div>

      {!wide && (
        <Tooltip label={t("session.new")} delayMs={500}>
          <button
            type="button"
            className="newSession"
            aria-label={t("session.new")}
            onClick={() => { startSession(); }}
          >
            <IconNewChatOutline16 size={18} />
          </button>
        </Tooltip>
      )}

      {wide && (
        <div className="tabList" role="tablist" aria-label={t("brand")}>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "conversation"}
            className={cx("tabButton", tab === "conversation" && "active")}
            onClick={() => { setSidebarTab("conversation"); }}
          >
            <IconNewChatOutline16 size={14} />
            {t("tab.conversation")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "my"}
            className={cx("tabButton", tab === "my" && "active")}
            onClick={() => { setSidebarTab("my"); }}
          >
            <IconBrowseOutline16 size={14} />
            {t("tab.my")}
          </button>
        </div>
      )}

      <div className="regionArea">
        <div className={cx("regionPane", !conversationVisible && "hidden")}>
          {renderSlot("sidebar.workspaces", {
            wide,
            expandSidebar: () => { if (collapsed) toggleSidebar(); },
          })}
        </div>
        {wide && tab === "my" && (
          <div className="regionPane">
            <PersonalSidebarPanel t={t} />
          </div>
        )}
      </div>

      <div className="footArea">
        <div className="footerActions">
          {renderSlot("sidebar.footer.action", { wide })}
        </div>
        <div className="settingsArea">
          {renderSlot("sidebar.settings", { wide })}
        </div>
      </div>
    </aside>
  );
}
