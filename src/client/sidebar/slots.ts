import type { WorkspaceId } from "@deepseek-ai/dsh-client-runtime/client";
import type {
  PropsLocale,
  PropsRenderSlots,
  PropsRuntime,
} from "@deepseek-ai/dsh-client-ui-slots";

declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface SlotMap {
    "sidebar.workspaces": { kind: "single"; scope: "root"; owner: SidebarSectionOwnerProps };
    "sidebar.settings": { kind: "single"; scope: "root"; owner: SidebarSettingsOwnerProps };
    "sidebar.footer.action": { kind: "list"; scope: "root"; owner: SidebarFooterOwnerProps };
  }
}

export interface SidebarSectionOwnerProps {
  wide: boolean;
  expandSidebar: () => void;
}

export interface SidebarSettingsOwnerProps {
  wide: boolean;
}

export interface SidebarFooterOwnerProps {
  wide: boolean;
}

export interface PersonalOsSidebarInjected {
  startSession: (workspaceId?: WorkspaceId) => void;
  toggleSidebar: () => void;
}

export type PersonalOsSidebarSlotProps =
  & PropsRuntime<"sidebar">
  & PropsRenderSlots<"sidebar.workspaces" | "sidebar.settings" | "sidebar.footer.action">
  & PersonalOsSidebarInjected
  & PropsLocale<"dsh.personal.os">;
