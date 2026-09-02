import { describe, expect, it } from "vitest";

import {
  PACKAGE_NAME,
  PERSONAL_OS_INVOCATIONS,
  REMOTE_NAMESPACE,
} from "../src/remote-contract.ts";
import { TYPERT } from "../src/typert.host.ts";

describe("Personal OS typed Remote", () => {
  it("publishes the settings methods through the host face", () => {
    expect(TYPERT.package).toBe(PACKAGE_NAME);
    expect(TYPERT.face).toBe("host");
    expect(TYPERT.invocations).toBe(PERSONAL_OS_INVOCATIONS);
    expect(PERSONAL_OS_INVOCATIONS.map((item) => item.method)).toEqual([
      "getSettings",
      "setPersonalDataDirectory",
      "updatePreferences",
      "getSnapshot",
      "listDocuments",
      "getDocument",
      "getTemplateDraft",
      "createDocument",
      "updateDocument",
      "archiveDocument",
      "linkDocuments",
      "searchDocuments",
      "getToday",
      "getProjectContext",
      "getTimeline",
      "getCalendar",
      "getGraph",
      "refreshDomain",
      "processCapture",
      "getHistory",
      "revertHistory",
      "preflightImport",
      "runImport",
      "startImport",
      "getImportJob",
      "getLatestImportJob",
      "cancelImport",
      "runHistoricalCuration",
      "getCurationStatus",
      "cancelHistoricalCuration",
      "listTaskOutcomes",
      "getTaskOutcome",
      "reviewTaskOutcome",
      "listTaskSpans",
      "correctTaskBoundary",
      "getSessionTaskContext",
    ]);
  });

  it("uses strict zod codecs on the Personal OS namespace", () => {
    for (const invocation of PERSONAL_OS_INVOCATIONS) {
      expect(invocation.service).toBe(REMOTE_NAMESPACE);
      expect(invocation.namespace).toBe(REMOTE_NAMESPACE);
      expect(invocation.result.mode).toBe("strict");
      if (invocation.result.mode === "strict") {
        expect(typeof invocation.result.schema.parse).toBe("function");
      }
    }
  });

  it("normalizes optional undefined fields before the Typert JSON boundary", () => {
    const invocation = PERSONAL_OS_INVOCATIONS.find((item) => item.method === "getToday");
    expect(invocation).toBeDefined();
    if (!invocation || invocation.result.mode !== "strict") return;

    expect(invocation.result.schema.parse({
      date: "2026-08-21",
      continue: undefined,
      todos: [{ id: "todo_1", due_date: undefined }],
    })).toStrictEqual({
      date: "2026-08-21",
      todos: [{ id: "todo_1" }],
    });
  });
});
