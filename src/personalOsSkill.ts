interface SkillsContext {
  skills: { register: (skill: { name: string; description: string; source: "runtime"; content: string; invocation: { modelInvocable: boolean; userInvocable: boolean } }) => () => void };
}

export const PERSONAL_OS_SKILL = {
  name: "personal-os",
  description: "检索和维护用户拥有的本地 Personal Context：Knowledge、Todo、Project、Capture、Relation、Today 和 Version History。",
  source: "runtime" as const,
  invocation: { modelInvocable: true, userInvocable: true },
  content: `# Personal OS

Personal OS 是用户拥有的本地 Markdown Context，不是聊天记录仓库。

## 工作规则

- 先用 personal_search 检索，再按需用 personal_get 读取正文；不要把整个目录注入上下文。
- 用户明确说“记住、创建、修改、关联、归档、生成文档”时直接使用对应 Tool。DSH 权限模式是唯一权限来源；Full access 下不要增加二次确认。
- 一个任务可能跨越多轮澄清、批准、重试和提交；不要按单轮消息做总结。只有出现任务完成证据（例如实际工具操作结束且 Agent 明确报告完成，或用户明确说“完成并整理”）时，才形成一个 Task Outcome。
- 谨慎模式会在任务完成后生成一个可审阅的 Outcome，不直接改写 Markdown；主动模式只自动应用高置信度结果，仍保留可见的来源和撤回入口；关闭模式不自动观察，用户可显式触发整理。
- 任务结果优先更新已有 Project/Todo/Knowledge，并记录一条可追溯的 Activity；只有用户明确要求才新建 Todo/Knowledge。未解决内容留在 Outcome 中，只有用户调用 personal_review_task_outcome 的 capture-unresolved 操作时才写入 Inbox，不能按每轮对话自动生成 Capture。
- 使用 personal_review_task_outcome 审阅结果：accept/accept-all 应用候选，edit/retry 修订或重试，dismiss/dismiss-unresolved 忽略，capture-unresolved 明确保存待澄清内容，undo 撤回已应用结果。不要复制消息、reasoning、工具参数或文件内容。
- 不确定但可能有价值的内容用 personal_capture，不能把推测写成 Knowledge。
- Relation 只能显式记录，使用稳定 ID，不推断图谱边。
- 普通删除使用 Archive。永久删除只有在用户明确要求后才传 permanent=true。
- Session/Task Outcome 只保存 session ID、workspace、Task/Outcome ID 和 seq 范围；Activity/文档正文只写结构化结果，不复制消息、reasoning、工具参数、结果或文件内容。
- personal_history / personal_revert 仅在 Version History 启用时可用。revert 必须形成新的恢复 checkpoint，禁止 reset、push、pull、远端和分支操作。

## 推荐流程

检索 → 按需读取 → 执行最小变更 → 返回稳定 ID 和简短结果。复杂 UI 请求可以准备到原生 composer，由用户检查后发送。`,
};

export function registerPersonalOsSkill(ctx: SkillsContext): () => void {
  return ctx.skills.register(PERSONAL_OS_SKILL);
}
