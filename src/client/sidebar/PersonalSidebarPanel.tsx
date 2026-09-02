import {
  IconBranchOutline16,
  IconCheckOutline16,
  IconDataOutline16,
  IconGoalOutline16,
  IconLightOutline16,
  IconListPenOutline16,
  IconPlusOutline16,
  IconSearchOutline16,
  IconBrowseOutline16,
  Tooltip,
} from "@deepseek-ai/dsh-client-ui-primitives";
import type { ReactNode } from "react";

import type { PersonalOsLocaleKey } from "../locales.ts";
import {
  setPersonalOsMode,
  setPersonalOsPage,
  usePersonalOsViewState,
} from "../viewState.ts";
import { MY_NAVIGATION } from "./sidebarContract.ts";

const ICONS: Record<(typeof MY_NAVIGATION)[number]["id"], ReactNode> = {
  today: <IconLightOutline16 size={16} />,
  inbox: <IconBrowseOutline16 size={16} />,
  knowledge: <IconListPenOutline16 size={16} />,
  todo: <IconCheckOutline16 size={16} />,
  projects: <IconGoalOutline16 size={16} />,
  timeline: <IconDataOutline16 size={16} />,
  calendar: <IconDataOutline16 size={16} />,
};

const NAV_KEYS: Record<(typeof MY_NAVIGATION)[number]["id"], PersonalOsLocaleKey> = {
  today: "nav.today",
  inbox: "nav.inbox",
  knowledge: "nav.knowledge",
  todo: "nav.todo",
  projects: "nav.projects",
  timeline: "nav.timeline",
  calendar: "nav.calendar",
};

export function PersonalSidebarPanel({
  t,
}: {
  t: (key: PersonalOsLocaleKey) => string;
}) {
  const view = usePersonalOsViewState();
  const actions = [
    { label: "toolbar.search" as const, icon: <IconSearchOutline16 size={16} />, action: () => { setPersonalOsMode("search"); } },
    { label: "toolbar.new" as const, icon: <IconPlusOutline16 size={16} />, action: () => { setPersonalOsMode("create"); } },
  ];

  return (
    <div className="myPanel" data-surface="my-panel">
      <div className="myToolbar" aria-label={t("tab.my")}>
        {actions.map((action) => (
          <Tooltip key={action.label} label={t(action.label)} delayMs={500}>
            <button type="button" className="iconButton" aria-label={t(action.label)} onClick={action.action}>
              {action.icon}
            </button>
          </Tooltip>
        ))}
      </div>
      <nav className="myNavigation" aria-label={t("tab.my")}>
        {MY_NAVIGATION.map((item, index) => (
          <button
            key={item.id}
            type="button"
            className={`${view.mode === "page" && view.page === item.id ? "myNavItem active" : "myNavItem"}${index === 2 || index === 5 ? " sectionStart" : ""}`}
            aria-current={view.mode === "page" && view.page === item.id ? "page" : undefined}
            onClick={() => { setPersonalOsPage(item.id); }}
          >
            {ICONS[item.id]}
            <span>{t(NAV_KEYS[item.id])}</span>
          </button>
        ))}
      </nav>
      <button type="button" className={view.mode === "graph" ? "myUtility active" : "myUtility"} onClick={() => { setPersonalOsMode("graph"); }}>
        <IconBranchOutline16 size={16} />
        <span>{t("toolbar.graph")}</span>
      </button>
    </div>
  );
}
