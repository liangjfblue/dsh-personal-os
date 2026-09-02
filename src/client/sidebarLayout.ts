export const PERSONAL_OS_SIDEBAR_WIDTH_VAR = "--personal-os-sidebar-width";

export interface SidebarLayoutStyle {
  setProperty(name: string, value: string): void;
  removeProperty(name: string): void;
}

function rootStyle(): SidebarLayoutStyle | undefined {
  if (typeof document === "undefined") return undefined;
  return document.documentElement.style;
}

// The sidebar slot's `width` prop is the live rendered column width in px and
// already reports the collapsed rail width while collapsed.
export function applySidebarLayout(width: number, style: SidebarLayoutStyle | undefined = rootStyle()): void {
  style?.setProperty(PERSONAL_OS_SIDEBAR_WIDTH_VAR, `${width}px`);
}

export function releaseSidebarLayout(style: SidebarLayoutStyle | undefined = rootStyle()): void {
  style?.removeProperty(PERSONAL_OS_SIDEBAR_WIDTH_VAR);
}
