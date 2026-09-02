export const CONVERSATION_INSET_BREAKPOINT = "(min-width: 1200px)";

export interface ConversationInsetStyle {
  setProperty(name: string, value: string, priority?: string): void;
  removeProperty(name: string): void;
  getPropertyValue(name: string): string;
  getPropertyPriority(name: string): string;
}

export interface ConversationInsetHost {
  style: ConversationInsetStyle;
}

type HostFinder = () => ConversationInsetHost | null;

// The native conversation renders inside the parent of the scroll container;
// padding that host keeps the whole conversation usable to the right of the
// Personal OS workspace.
const liveHost: HostFinder = () => {
  if (typeof document === "undefined") return null;
  const scrollport = document.querySelector("[data-conversation-scroll]");
  const host = scrollport?.parentElement;
  return host instanceof HTMLElement ? (host as unknown as ConversationInsetHost) : null;
};

let insetHost: ConversationInsetHost | null = null;
let paddingLeft = "";
let paddingLeftPriority = "";
let transition = "";
let transitionPriority = "";

function capture(host: ConversationInsetHost): void {
  if (insetHost === host) return;
  restoreConversationInset();
  insetHost = host;
  paddingLeft = host.style.getPropertyValue("padding-left");
  paddingLeftPriority = host.style.getPropertyPriority("padding-left");
  transition = host.style.getPropertyValue("transition");
  transitionPriority = host.style.getPropertyPriority("transition");
}

export function restoreConversationInset(): void {
  if (insetHost === null) return;
  const host = insetHost;
  if (paddingLeft === "") host.style.removeProperty("padding-left");
  else host.style.setProperty("padding-left", paddingLeft, paddingLeftPriority);
  if (transition === "") host.style.removeProperty("transition");
  else host.style.setProperty("transition", transition, transitionPriority);
  insetHost = null;
}

export function applyConversationInset(
  width: number,
  animate = true,
  host: ConversationInsetHost | null = liveHost(),
): boolean {
  if (host === null) return false;
  if (width > 0 && host.style.getPropertyValue("padding-left") === `${width}px`) return true;
  capture(host);
  if (width <= 0) {
    restoreConversationInset();
    return true;
  }
  host.style.setProperty(
    "transition",
    animate ? "padding-left var(--ds-transition-duration-slow) var(--ds-ease-in-out)" : "none",
  );
  host.style.setProperty("padding-left", `${width}px`);
  return true;
}
