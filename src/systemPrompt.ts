interface PromptContext {
  systemPrompt: { section: (section: { name: string; order: number; text: string | (() => string) }) => () => void };
}

interface DynamicContextSource { dynamicContext(): string }

export const PERSONAL_OS_SYSTEM_PROMPT = "Personal OS is available through the personal-os Skill and personal_* tools. Retrieve durable context on demand; do not assume chat history is Personal Context or inject the full vault.";

export function registerPersonalOsPrompt(ctx: PromptContext, source?: DynamicContextSource): () => void {
  return ctx.systemPrompt.section({ name: "personal-os:capability", order: 125, text: source ? () => `${PERSONAL_OS_SYSTEM_PROMPT}\n${source.dynamicContext()}` : PERSONAL_OS_SYSTEM_PROMPT });
}
