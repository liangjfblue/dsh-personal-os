import type { InvocationDescriptor } from "@deepseek-ai/dsh-typert-protocol";
import { z } from "zod";

import {
  emptyRequestSchema,
  jsonRequestSchema,
  jsonResultSchema,
  personalOsSettingsSchema,
  setPersonalDataDirectoryRequestSchema,
} from "./schemas.ts";

export const PACKAGE_NAME = "dsh-personal-os";
export const REMOTE_NAMESPACE = "personalOs";

function codec(typeSymbol: string, schema: z.ZodType<unknown>) {
  return { mode: "strict" as const, typeSymbol, schema };
}

function jsonParameter(
  name: string,
  typeSymbol: string,
  schema: z.ZodType<unknown>,
): InvocationDescriptor["parameters"][number] {
  return {
    name,
    wire: name,
    source: "json",
    codec: codec(typeSymbol, schema),
  };
}

function invocation(
  method: string,
  request: z.ZodType<unknown>,
  result: z.ZodType<unknown>,
): InvocationDescriptor {
  return {
    id: `${PACKAGE_NAME}#${REMOTE_NAMESPACE}/${method}`,
    service: REMOTE_NAMESPACE,
    namespace: REMOTE_NAMESPACE,
    method,
    invocation: { kind: "direct" },
    parameters: [jsonParameter("request", `${PACKAGE_NAME}#${method}Request`, request)],
    cancellation: { parameter: "signal" },
    result: codec(`${PACKAGE_NAME}#${method}Result`, result),
    sourceLocation: { file: "src/service.ts", line: 1, column: 1 },
  };
}

export const PERSONAL_OS_INVOCATIONS: readonly InvocationDescriptor[] = [
  invocation("getSettings", emptyRequestSchema, personalOsSettingsSchema),
  invocation(
    "setPersonalDataDirectory",
    setPersonalDataDirectoryRequestSchema,
    personalOsSettingsSchema,
  ),
  invocation("updatePreferences", jsonRequestSchema, personalOsSettingsSchema),
  invocation("getSnapshot", emptyRequestSchema, jsonResultSchema),
  invocation("listDocuments", jsonRequestSchema, jsonResultSchema),
  invocation("getDocument", jsonRequestSchema, jsonResultSchema),
  invocation("getTemplateDraft", jsonRequestSchema, jsonResultSchema),
  invocation("createDocument", jsonRequestSchema, jsonResultSchema),
  invocation("updateDocument", jsonRequestSchema, jsonResultSchema),
  invocation("archiveDocument", jsonRequestSchema, jsonResultSchema),
  invocation("linkDocuments", jsonRequestSchema, jsonResultSchema),
  invocation("searchDocuments", jsonRequestSchema, jsonResultSchema),
  invocation("getToday", jsonRequestSchema, jsonResultSchema),
  invocation("getProjectContext", jsonRequestSchema, jsonResultSchema),
  invocation("getTimeline", jsonRequestSchema, jsonResultSchema),
  invocation("getCalendar", jsonRequestSchema, jsonResultSchema),
  invocation("getGraph", jsonRequestSchema, jsonResultSchema),
  invocation("refreshDomain", emptyRequestSchema, jsonResultSchema),
  invocation("processCapture", jsonRequestSchema, jsonResultSchema),
  invocation("getHistory", jsonRequestSchema, jsonResultSchema),
  invocation("revertHistory", jsonRequestSchema, jsonResultSchema),
  invocation("preflightImport", jsonRequestSchema, jsonResultSchema),
  invocation("runImport", jsonRequestSchema, jsonResultSchema),
  invocation("startImport", jsonRequestSchema, jsonResultSchema),
  invocation("getImportJob", jsonRequestSchema, jsonResultSchema),
  invocation("getLatestImportJob", emptyRequestSchema, jsonResultSchema),
  invocation("cancelImport", jsonRequestSchema, jsonResultSchema),
  invocation("runHistoricalCuration", jsonRequestSchema, jsonResultSchema),
  invocation("getCurationStatus", emptyRequestSchema, jsonResultSchema),
  invocation("cancelHistoricalCuration", emptyRequestSchema, jsonResultSchema),
  invocation("listTaskOutcomes", jsonRequestSchema, jsonResultSchema),
  invocation("getTaskOutcome", jsonRequestSchema, jsonResultSchema),
  invocation("reviewTaskOutcome", jsonRequestSchema, jsonResultSchema),
  invocation("listTaskSpans", emptyRequestSchema, jsonResultSchema),
  invocation("correctTaskBoundary", jsonRequestSchema, jsonResultSchema),
  invocation("getSessionTaskContext", jsonRequestSchema, jsonResultSchema),
];
