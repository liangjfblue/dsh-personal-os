import type { Context } from "@deepseek-ai/cordis";
import { SessionId } from "@deepseek-ai/dsh-session";

import { Config } from "./config.ts";
import { registerPersonalOsSkill } from "./personalOsSkill.ts";
import { PersonalOsService, type DshJobRegistryLike } from "./service.ts";
import { backfillHistoricalSessions, DshManagedCuratorAgent, registerTaskOutcomeCuration, sessionEventEvidence } from "./sessionIntegration.ts";
import { registerPersonalOsSettingsNamespace } from "./settingsHost.ts";
import { registerPersonalOsPrompt } from "./systemPrompt.ts";
import { registerPersonalOsTools } from "./tools.ts";

export const name = "dsh-personal-os";
export { Config };
export type { Config as ConfigType } from "./config.ts";

export function apply(ctx: Context, config: Config): void {
  const service = new PersonalOsService(ctx, config);
  let historicalBackfill: ((workspace?: string, fallbackSessionId?: string, options?: { signal?: AbortSignal; onProgress?: (completed: number, total: number, current: string) => void }) => Promise<unknown>) | undefined;
  ctx.effect(() => () => service.close(), "dsh-personal-os: domain-service");
  ctx.inject(["settings"], (settingsContext) => {
    registerPersonalOsSettingsNamespace(settingsContext.settings);
  });
  ctx.inject(["tools"], (toolsContext) => {
    registerPersonalOsTools(toolsContext as never, service);
  });
  ctx.inject(["skills"], (skillsContext) => {
    registerPersonalOsSkill(skillsContext as never);
  });
  ctx.inject(["systemPrompt"], (promptContext) => {
    registerPersonalOsPrompt(promptContext as never, service);
  });
  ctx.inject(["agents"], (agentContext) => registerTaskOutcomeCuration(agentContext, service));
  ctx.inject(["jobs"] as never, (jobsContext) => {
    const jobs = (jobsContext as unknown as { jobs: DshJobRegistryLike }).jobs;
    const detach = jobs.attachController("dsh-personal-os");
    service.setJobs(jobs);
    return async () => { await service.releaseJobs(); detach(); };
  });
  ctx.inject(["agents", "sessionQuery"] as never, (historyContext) => {
    type Query = {
      listSessions: () => Promise<Array<{ header: { id: string; cwd?: string | undefined; origin?: string | undefined } }>>;
      readSession: (id: string) => Promise<{ events: import("@deepseek-ai/dsh-session").SessionEvent[] }>;
    };
    const query = (historyContext as unknown as { sessionQuery: Query }).sessionQuery;
    let running: Promise<unknown> | undefined;
    historicalBackfill = (workspace, fallbackSessionId, options) => {
      if (running) return running;
      running = (async () => {
        const settings = await service.settings.load();
        if (!settings.historicalLearning || settings.personalDataDirectory === "") return { available: true, completed: 0, skipped: true };
        const liveParent = fallbackSessionId
          ? historyContext.agents.get(SessionId(fallbackSessionId))
          : historyContext.agents.roots().find((agent) => agent.session.header.origin !== "subagent");
        const parentSessionId = fallbackSessionId ?? liveParent?.id;
        const activeWorkspace = workspace ?? liveParent?.session.header.cwd;
        if (!parentSessionId) return { available: true, completed: 0, awaitingSession: true };
        if (!settings.crossWorkspaceLearning && !activeWorkspace) return { available: true, completed: 0, awaitingWorkspace: true };
        const curatorAgent = new DshManagedCuratorAgent(historyContext, String(parentSessionId));
        const curator = {
          curate: async (evidence: import("./curation.ts").SessionEvidence, _settings: import("./settingsStore.ts").PersonalOsSettings, currentWorkspace?: string) => {
            let observed: unknown = { changed: false };
            const ordered = [...evidence.events].sort((a, b) => a.seq - b.seq);
            const endings = ordered.filter((event) => event.type === "turn/end");
            for (const ending of endings) {
              options?.signal?.throwIfAborted();
              observed = await service.observeTaskOutcome({
                evidence: { ...evidence, events: ordered.filter((event) => event.seq <= ending.seq) },
                currentWorkspace,
                allowWhenOff: true,
              }, options?.signal ?? new AbortController().signal, curatorAgent);
            }
            return observed;
          },
        };
        return backfillHistoricalSessions({
          query: {
            listSessions: async () => (await query.listSessions()).map((record) => ({ id: record.header.id, ...(record.header.cwd !== undefined ? { cwd: record.header.cwd } : {}), ...(record.header.origin !== undefined ? { origin: record.header.origin } : {}) })),
            listEvents: async (id) => (await query.readSession(id)).events.map(sessionEventEvidence).filter((event): event is NonNullable<typeof event> => event !== undefined),
          },
          curator,
          settings,
          ...(options?.signal ? { signal: options.signal } : {}),
          ...(options?.onProgress ? { onProgress: options.onProgress } : {}),
          currentWorkspace: activeWorkspace,
        });
      })().finally(() => { running = undefined; });
      return running;
    };
    service.setHistoricalBackfill(historicalBackfill);
    return () => { historicalBackfill = undefined; service.setHistoricalBackfill(); };
  });
}
