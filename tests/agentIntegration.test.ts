import { describe, expect, it, vi } from "vitest";

import { PERSONAL_OS_SKILL, registerPersonalOsSkill } from "../src/personalOsSkill.ts";
import { PERSONAL_OS_SYSTEM_PROMPT, registerPersonalOsPrompt } from "../src/systemPrompt.ts";
import { registerPersonalOsTools } from "../src/tools.ts";
import { sessionKindFromOrigin } from "../src/sessionIntegration.ts";

describe("DSH-native Agent integration", () => {
  it("registers the complete explicit Personal OS tool contract", () => {
    const definitions: Array<{ name: string }> = [];
    registerPersonalOsTools({ tools: { register: (definition) => { definitions.push(definition); } } }, {} as never);
    expect(definitions.map((definition) => definition.name)).toEqual([
      "personal_search", "personal_get", "personal_get_today", "personal_get_project_context", "personal_capture", "personal_create",
      "personal_update", "personal_link", "personal_archive", "personal_curate_session", "personal_review_task_outcome", "personal_history", "personal_revert",
    ]);
  });

  it("keeps the base prompt compact and moves cautious workflow policy into the Skill", () => {
    const register = vi.fn(() => () => undefined); registerPersonalOsSkill({ skills: { register } });
    expect(register).toHaveBeenCalledWith(PERSONAL_OS_SKILL);
    expect(PERSONAL_OS_SKILL.content).toContain("先用 personal_search");
    expect(PERSONAL_OS_SKILL.content).toContain("DSH 权限模式是唯一权限来源");
    expect(PERSONAL_OS_SKILL.content).toContain("不复制消息");
    expect(PERSONAL_OS_SKILL.content).toContain("不能按每轮对话自动生成 Capture");
    const section = vi.fn(() => () => undefined); registerPersonalOsPrompt({ systemPrompt: { section } });
    expect(PERSONAL_OS_SYSTEM_PROMPT.length).toBeLessThan(240);
    expect(section).toHaveBeenCalledWith(expect.objectContaining({ name: "personal-os:capability", text: PERSONAL_OS_SYSTEM_PROMPT }));
    const dynamic = vi.fn(() => "2 due Todo, 1 pending Inbox");
    let dynamicRegistration: { name: string; order: number; text: string | (() => string) } | undefined;
    const dynamicSection = (registration: { name: string; order: number; text: string | (() => string) }) => { dynamicRegistration = registration; return () => undefined; };
    registerPersonalOsPrompt({ systemPrompt: { section: dynamicSection } }, { dynamicContext: dynamic });
    expect(typeof dynamicRegistration?.text).toBe("function");
    expect((dynamicRegistration!.text as () => string)()).toContain("2 due Todo");
  });

  it("does not treat automation or system sessions as user-authored main sessions", () => {
    expect(sessionKindFromOrigin(undefined)).toBe("main");
    expect(sessionKindFromOrigin("subagent")).toBe("subagent");
    expect(sessionKindFromOrigin("automation:daily")).toBe("automation");
    expect(sessionKindFromOrigin("system:maintenance")).toBe("system");
  });
});
