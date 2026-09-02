import type { ClientContext, ISessions, WorkspaceId } from "@deepseek-ai/dsh-client-runtime/client";
import type {} from "@deepseek-ai/dsh-client-locale/client";
import type {} from "@deepseek-ai/dsh-client-ui-layout/client";
import type {} from "@deepseek-ai/dsh-api-remotes/client";
import type {} from "@deepseek-ai/dsh-client-connection/client";
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings-plugins/client";

import { TYPERT_REMOTE } from "../remote.ts";
import type { PersonalOsSettings } from "../settingsStore.ts";
import { PERSONAL_OS_SETTINGS_NAMESPACE } from "../settingsContract.ts";
import type { SessionTaskContext, TaskOutcomeReviewRequest } from "../service.ts";
import type { TaskOutcomeProposal, TaskOutcomeStatus, TaskSpanView } from "../taskOutcome.ts";
import { choosePersonalDataDirectory } from "./directorySelection.ts";
import type { PersonalOsViewFace } from "./face.ts";
import { en, NS, type PersonalOsLocaleKey, zh } from "./locales.ts";
import { PersonalOsSettingsCard } from "./PersonalOsSettingsCard.tsx";
import { remountPluginCss, releasePluginCss } from "./pluginCss.ts";
import { registerPersonalOsSettingsCard } from "./settingsSlot.ts";
import { PersonalOsSidebarRoot } from "./sidebar/PersonalOsSidebarRoot.tsx";
import { registerPersonalOsSidebar } from "./sidebar/sidebarContract.ts";
import type { PersonalOsSidebarInjected, PersonalOsSidebarSlotProps } from "./sidebar/slots.ts";
import { PersonalOsOverlay, TaskOutcomeDock } from "./TodaySurface.tsx";
import {
  setSidebarTab,
  setPersonalOsSetupState,
  shouldShowPersonalOsOverlay,
  subscribeViewState,
} from "./viewState.ts";
import "./styles.css";

declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface LocaleNamespaceMap {
    "dsh.personal.os": PersonalOsLocaleKey;
  }
}

interface RemoteAnswer<T> {
  ok: boolean;
  value?: T;
  error?: { code: string; message: string };
}

interface PersonalOsRemote {
  getSettings: (request: Record<string, never>) => Promise<RemoteAnswer<PersonalOsSettings>>;
  setPersonalDataDirectory: (request: { path: string }) => Promise<RemoteAnswer<PersonalOsSettings>>;
  updatePreferences: (request: unknown) => Promise<RemoteAnswer<unknown>>;
  getSnapshot: (request: Record<string, never>) => Promise<RemoteAnswer<unknown>>;
  listDocuments: (request: unknown) => Promise<RemoteAnswer<unknown>>;
  getDocument: (request: unknown) => Promise<RemoteAnswer<unknown>>;
  getTemplateDraft: (request: unknown) => Promise<RemoteAnswer<unknown>>;
  createDocument: (request: unknown) => Promise<RemoteAnswer<unknown>>;
  updateDocument: (request: unknown) => Promise<RemoteAnswer<unknown>>;
  archiveDocument: (request: unknown) => Promise<RemoteAnswer<unknown>>;
  linkDocuments: (request: unknown) => Promise<RemoteAnswer<unknown>>;
  searchDocuments: (request: unknown) => Promise<RemoteAnswer<unknown>>;
  getToday: (request: unknown) => Promise<RemoteAnswer<unknown>>;
  getTimeline: (request: unknown) => Promise<RemoteAnswer<unknown>>;
  getCalendar: (request: unknown) => Promise<RemoteAnswer<unknown>>;
  getGraph: (request: unknown) => Promise<RemoteAnswer<unknown>>;
  refreshDomain: (request: Record<string, never>) => Promise<RemoteAnswer<unknown>>;
  getHistory: (request: unknown) => Promise<RemoteAnswer<unknown>>;
  revertHistory: (request: unknown) => Promise<RemoteAnswer<unknown>>;
  preflightImport: (request: unknown) => Promise<RemoteAnswer<unknown>>;
  runImport: (request: unknown) => Promise<RemoteAnswer<unknown>>;
  startImport: (request: unknown) => Promise<RemoteAnswer<unknown>>;
  getImportJob: (request: unknown) => Promise<RemoteAnswer<unknown>>;
  getLatestImportJob: (request: Record<string, never>) => Promise<RemoteAnswer<unknown>>;
  cancelImport: (request: unknown) => Promise<RemoteAnswer<unknown>>;
  runHistoricalCuration: (request: unknown) => Promise<RemoteAnswer<unknown>>;
  getCurationStatus: (request: Record<string, never>) => Promise<RemoteAnswer<unknown>>;
  cancelHistoricalCuration: (request: Record<string, never>) => Promise<RemoteAnswer<unknown>>;
  listTaskOutcomes: (request: { status?: TaskOutcomeStatus }) => Promise<RemoteAnswer<unknown>>;
  getTaskOutcome: (request: { id: string }) => Promise<RemoteAnswer<unknown>>;
  reviewTaskOutcome: (request: TaskOutcomeReviewRequest) => Promise<RemoteAnswer<unknown>>;
  listTaskSpans: (request: Record<string, never>) => Promise<RemoteAnswer<unknown>>;
  correctTaskBoundary: (request: { sessionId: string; action: "split-latest" | "merge-previous" }) => Promise<RemoteAnswer<unknown>>;
  getSessionTaskContext: (request: { sessionId: string }) => Promise<RemoteAnswer<unknown>>;
}

function unwrap<T>(answer: RemoteAnswer<T>, fallback: string): T {
  if (!answer.ok || answer.value === undefined) {
    throw new Error(answer.error?.message ?? fallback);
  }
  return answer.value;
}

export const inject = ["slots", "locale", "remote", "workspaces", "layout", "connection", "sessions", "conversation"];

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-personal-os: dictionaries");
  ctx.effect(() => {
    remountPluginCss();
    return releasePluginCss;
  }, "dsh-personal-os: styles");

  const remoteOf = (): PersonalOsRemote | undefined =>
    ctx.get("remote.personalOs") as PersonalOsRemote | undefined;

  const face = (): PersonalOsViewFace => ({
    ready: () => remoteOf() !== undefined,
    getSettings: async () => {
      const remote = remoteOf();
      if (remote === undefined) throw new Error("Personal OS service is not ready");
      return unwrap(await remote.getSettings({}), "Could not load Personal OS settings");
    },
    choosePersonalDataDirectory: () => choosePersonalDataDirectory({
      pickDirectory: () => ctx.workspaces.pickDirectory(),
      setPersonalDataDirectory: async (path) => {
        const remote = remoteOf();
        if (remote === undefined) throw new Error("Personal OS service is not ready");
        const settings = unwrap(
          await remote.setPersonalDataDirectory({ path }),
          "Could not save Personal Data Directory",
        );
        setPersonalOsSetupState(
          settings.personalDataDirectory === "" ? "needs-setup" : "configured",
        );
      },
    }),
    chooseImportDirectory: async () => {
      const chosen = await ctx.workspaces.pickDirectory();
      return chosen ?? undefined;
    },
    pickDirectory: async () => {
      const chosen = await ctx.workspaces.pickDirectory();
      return chosen ?? undefined;
    },
    listSessions: async () => {
      const sessions = ctx.sessions as unknown as ISessions;
      return Object.values(sessions.list.getSnapshot().byId).map((item) => ({ id: item.id, title: item.title ?? item.displayTitle, ...(item.cwd !== undefined ? { cwd: item.cwd } : {}) }));
    },
    openPersonalDataDirectory: (path) => ctx.workspaces.openPath(path),
    updatePreferences: async (patch) => unwrap(await remoteOf()!.updatePreferences(patch), "Could not update preferences") as never,
    getSnapshot: async () => unwrap(await remoteOf()!.getSnapshot({}), "Could not load Personal OS") as never,
    listDocuments: async (request) => unwrap(await remoteOf()!.listDocuments(request), "Could not list documents") as never,
    getDocument: async (id) => unwrap(await remoteOf()!.getDocument({ id }), "Could not load document") as never,
    getTemplateDraft: async (kind) => unwrap(await remoteOf()!.getTemplateDraft({ kind }), "Could not load template") as never,
    createDocument: async (input) => unwrap(await remoteOf()!.createDocument({ input, context: { actor: "user", source: "ui" } }), "Could not create document") as never,
    updateDocument: async (id, patch, expectedRevision) => unwrap(await remoteOf()!.updateDocument({ id, patch, expectedRevision, context: { actor: "user", source: "ui" } }), "Could not update document") as never,
    archiveDocument: async (id, restore) => unwrap(await remoteOf()!.archiveDocument({ id, restore, context: { actor: "user", source: "ui" } }), "Could not archive document") as never,
    linkDocuments: async (sourceId, relation, remove) => unwrap(await remoteOf()!.linkDocuments({ sourceId, relation, remove, context: { actor: "user", source: "ui" } }), "Could not update relation") as never,
    searchDocuments: async (query, filter) => unwrap(await remoteOf()!.searchDocuments({ query, filter }), "Could not search") as never,
    getToday: async (date) => unwrap(await remoteOf()!.getToday({ date }), "Could not load Today") as never,
    getTimeline: async () => unwrap(await remoteOf()!.getTimeline({}), "Could not load Timeline") as never,
    getCalendar: async (month) => unwrap(await remoteOf()!.getCalendar({ month }), "Could not load Calendar") as never,
    getGraph: async () => unwrap(await remoteOf()!.getGraph({}), "Could not load graph") as never,
    refreshDomain: async () => unwrap(await remoteOf()!.refreshDomain({}), "Could not refresh Personal OS") as never,
    getHistory: async () => unwrap(await remoteOf()!.getHistory({}), "Could not load history") as never,
    revertHistory: async (commit) => unwrap(await remoteOf()!.revertHistory({ commit }), "Could not restore checkpoint") as never,
    preflightImport: async (source, mode = "copy") => unwrap(await remoteOf()!.preflightImport({ source, mode }), "Could not inspect vault") as never,
    runImport: async (source, mode = "copy") => unwrap(await remoteOf()!.runImport({ source, mode }), "Could not import vault") as never,
    startImport: async (source, mode = "copy") => unwrap(await remoteOf()!.startImport({ source, mode }), "Could not start import") as never,
    getImportJob: async (id) => unwrap(await remoteOf()!.getImportJob({ id }), "Could not load import progress") as never,
    getLatestImportJob: async () => unwrap(await remoteOf()!.getLatestImportJob({}), "Could not load latest import") as never,
    cancelImport: async (id) => unwrap(await remoteOf()!.cancelImport({ id }), "Could not cancel import") as never,
    runHistoricalCuration: async () => unwrap(await remoteOf()!.runHistoricalCuration({}), "Could not initialize session learning") as never,
    getCurationStatus: async () => unwrap(await remoteOf()!.getCurationStatus({}), "Could not load curation status") as never,
    cancelHistoricalCuration: async () => unwrap(await remoteOf()!.cancelHistoricalCuration({}), "Could not cancel session learning") as never,
    listTaskOutcomes: async (status) => unwrap(await remoteOf()!.listTaskOutcomes(status ? { status } : {}), "Could not load Task Outcomes") as TaskOutcomeProposal[],
    getTaskOutcome: async (id) => unwrap(await remoteOf()!.getTaskOutcome({ id }), "Could not load Task Outcome") as TaskOutcomeProposal | null,
    reviewTaskOutcome: async (request) => unwrap(await remoteOf()!.reviewTaskOutcome(request), "Could not review Task Outcome") as TaskOutcomeProposal,
    listTaskSpans: async () => unwrap(await remoteOf()!.listTaskSpans({}), "Could not load active tasks") as TaskSpanView[],
    correctTaskBoundary: async (sessionId, action) => unwrap(await remoteOf()!.correctTaskBoundary({ sessionId, action }), "Could not correct task boundary") as TaskSpanView,
    getSessionTaskContext: async (sessionId) => unwrap(await remoteOf()!.getSessionTaskContext({ sessionId }), "Could not load session context") as SessionTaskContext,
    openSession: async (sessionId, instruction) => {
      const sessions = ctx.sessions as unknown as ISessions;
      const item = Object.values(sessions.list.getSnapshot().byId).find((entry) => String(entry.id) === sessionId);
      if (!item) throw new Error("找不到原始 DSH 会话");
      const binding = sessions.binding(item.id);
      if (instruction && binding) ctx.conversation.input.for(binding.ctx).setDraft(instruction);
      sessions.open(item.id);
      setSidebarTab("conversation");
    },
    prepareAgentInstruction: async (instruction) => {
      // The host session package also declaration-merges a `sessions` service.
      // This client entry always runs against the client runtime face.
      const sessions = ctx.sessions as unknown as ISessions;
      const current = sessions.list.getSnapshot().current;
      const binding = current ? sessions.binding(current) : undefined;
      if (!current || !binding) throw new Error("请先打开一个 DSH 会话");
      ctx.conversation.input.for(binding.ctx).setDraft(instruction);
      sessions.open(current);
      setSidebarTab("conversation");
    },
  });

  const viewFace = face();
  const injectSidebar = (): PersonalOsSidebarInjected => ({
    startSession: (workspaceId?: WorkspaceId) => { ctx.workspaces.startSession(workspaceId); },
    toggleSidebar: () => { ctx.layout.toggleSidebar(); },
  });

  function BoundSidebar(props: PersonalOsSidebarSlotProps) {
    return <PersonalOsSidebarRoot {...props} />;
  }

  ctx.slots.inject("sidebar", () =>
    registerPersonalOsSidebar(
      ctx.slots as never,
      BoundSidebar,
      injectSidebar,
    ));

  ctx.effect(async () => {
    const disposeRemote = await ctx.remote.$mount(TYPERT_REMOTE);
    if (ctx.fiber.state >= 5) {
      await disposeRemote();
      return () => {};
    }

    setPersonalOsSetupState("loading");

    const stopOverlay = ctx.slots.inject("shell.overlay", () => {
      let disposeOccupant: (() => void) | undefined;
      const release = (): void => {
        disposeOccupant?.();
        disposeOccupant = undefined;
      };
      const sync = (): void => {
        if (!shouldShowPersonalOsOverlay()) {
          release();
          return;
        }
        if (disposeOccupant !== undefined) return;
        disposeOccupant = ctx.slots.register({
          name: "shell.overlay",
          id: "personal-os-today",
          order: 20,
          locale: NS,
          inject: face,
        }, PersonalOsOverlay);
      };
      const stop = subscribeViewState(sync);
      sync();
      return () => {
        stop();
        release();
      };
    });

    const stopSettings = ctx.slots.inject("settings.plugin.item", () =>
      registerPersonalOsSettingsCard(
        ctx.slots as never,
        PersonalOsSettingsCard,
        {
          namespace: PERSONAL_OS_SETTINGS_NAMESPACE,
          legacyId: "dsh-personal-os",
          order: 30,
          locale: NS,
          inject: face,
        },
      ));

    const stopOutcomeDock = ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
      name: "conversation.input.dock",
      id: "personal-os-task-outcome",
      order: 8,
      inject: (sessionId) => ({ face: viewFace, outcomeSessionId: String(sessionId) }),
    }, TaskOutcomeDock));

    return async () => {
      stopOutcomeDock();
      stopSettings();
      stopOverlay();
      await disposeRemote();
    };
  }, "dsh-personal-os: remote-view");
}
