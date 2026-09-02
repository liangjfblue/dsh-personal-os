import { z } from "zod";

export const emptyRequestSchema = z.object({});

export const personalOsSettingsSchema = z.object({
  schemaVersion: z.literal(1),
  personalDataDirectory: z.string(),
  versionHistory: z.boolean(),
  curationLevel: z.enum(["off", "balanced", "proactive"]),
  historicalLearning: z.boolean(),
  crossWorkspaceLearning: z.boolean(),
  excludedWorkspaces: z.array(z.string()),
  excludedSessions: z.array(z.string()),
});

export const setPersonalDataDirectoryRequestSchema = z.object({
  path: z.string().min(1),
});

export const jsonRequestSchema = z.record(z.string(), z.unknown());

function normalizeJsonResult(value: unknown, ancestors = new Set<object>()): unknown {
  if (value === undefined || value === null) return value;
  if (["string", "boolean", "number"].includes(typeof value)) return value;
  if (typeof value !== "object") return value;
  if (ancestors.has(value)) throw new TypeError("cyclic result is not JSON-safe");

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) =>
        item === undefined ? null : normalizeJsonResult(item, ancestors));
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return value;

    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) result[key] = normalizeJsonResult(item, ancestors);
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

// DSH validates the business result as strict JSON after the Zod codec runs.
// Domain projections use optional `undefined` fields, so normalize those at
// the shared Remote boundary instead of leaking transport rules into domain code.
export const jsonResultSchema = z.unknown().transform((value) =>
  normalizeJsonResult(value));
