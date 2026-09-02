import { useEffect, useState } from "react";

export type SidebarTab = "conversation" | "my";
export type PersonalOsSetupState = "loading" | "needs-setup" | "configured" | "error";
export type PersonalOsPage = "today" | "inbox" | "knowledge" | "todo" | "projects" | "timeline" | "calendar";
export type PersonalOsMode = "page" | "search" | "graph" | "create";

export interface PersonalOsViewState {
  page: PersonalOsPage;
  mode: PersonalOsMode;
  selectedDocumentId?: string | undefined;
  refreshRevision: number;
}

type Listener = () => void;

const listeners = new Set<Listener>();
let sidebarTab: SidebarTab = loadSidebarTab();
let personalOsSetupState: PersonalOsSetupState = "loading";
let personalOsViewState: PersonalOsViewState = {
  page: "today",
  mode: "page",
  refreshRevision: 0,
};

function browserStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function loadSidebarTab(): SidebarTab {
  return browserStorage()?.getItem("dsh-personal-os/sidebar-tab") === "my"
    ? "my"
    : "conversation";
}

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribeViewState(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getSidebarTab(): SidebarTab {
  return sidebarTab;
}

export function setSidebarTab(tab: SidebarTab): void {
  if (sidebarTab === tab) return;
  sidebarTab = tab;
  browserStorage()?.setItem("dsh-personal-os/sidebar-tab", tab);
  emit();
}

export function useSidebarTab(): SidebarTab {
  const [tab, setTab] = useState(getSidebarTab);
  useEffect(() => subscribeViewState(() => { setTab(getSidebarTab()); }), []);
  return tab;
}

export function getPersonalOsViewState(): PersonalOsViewState {
  return personalOsViewState;
}

export function setPersonalOsPage(page: PersonalOsPage): void {
  personalOsViewState = { ...personalOsViewState, page, mode: "page", selectedDocumentId: undefined };
  emit();
}

export function setPersonalOsMode(mode: PersonalOsMode): void {
  personalOsViewState = { ...personalOsViewState, mode, selectedDocumentId: mode === "create" ? undefined : personalOsViewState.selectedDocumentId };
  emit();
}

export function selectPersonalOsDocument(id?: string): void {
  personalOsViewState = { ...personalOsViewState, selectedDocumentId: id };
  emit();
}

export function requestPersonalOsRefresh(): void {
  personalOsViewState = { ...personalOsViewState, refreshRevision: personalOsViewState.refreshRevision + 1 };
  emit();
}

export function usePersonalOsViewState(): PersonalOsViewState {
  const [state, setState] = useState(getPersonalOsViewState);
  useEffect(() => subscribeViewState(() => { setState(getPersonalOsViewState()); }), []);
  return state;
}

export function setPersonalOsSetupState(state: PersonalOsSetupState): void {
  if (personalOsSetupState === state) return;
  personalOsSetupState = state;
  emit();
}

export function getPersonalOsSetupState(): PersonalOsSetupState {
  return personalOsSetupState;
}

export function shouldShowPersonalOsOverlay(): boolean {
  return personalOsSetupState !== "configured" || getSidebarTab() === "my";
}

export function isInspectorVisible(mode: PersonalOsMode, hasDocument: boolean): boolean {
  return mode === "create" || hasDocument;
}
