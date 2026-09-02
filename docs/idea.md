# dsh-personal-os 产品方案

## 1. 项目背景

DeepSeek Harness 提供了一个很有意思的基础：它不只是一个 Coding Agent，而是一个可以被插件深度扩展的 **Agent Runtime + Web Shell**。

通过 DSH 的插件机制，插件不仅可以增加 Tool、Skill 和服务能力，还可以直接扩展：

* Sidebar
* Inspector
* Settings
* Shell Overlay
* Remote API
* Agent Context
* Client UI

`dsh-oil-creator` 已经证明了一件事：**一个 DSH 插件完全可以把 Harness 变成一个垂直领域产品，而不需要重新做一套 Agent 应用。**

传统做法如果基于 Pi 自己开发桌面应用，还需要额外实现：

* Electron / Tauri
* 会话系统
* Agent Streaming
* Tool Call UI
* Workspace
* Model Selector
* Settings
* Agent Runtime 与前端通信
* 插件体系

而使用 DSH，我们可以直接复用这些基础设施，只关注 Personal OS 本身。

因此项目方向从最初的 `dsh-llm-wiki` 调整为：

# `dsh-personal-os`

> 一个运行在 DeepSeek Harness 之上的个人数字工作台。

它不只是知识库，也不只是 Todo App。

它希望管理一个人的：

**知识、任务、项目、灵感、收藏、时间线以及长期上下文。**

---

# 2. 核心创意

传统个人管理软件通常是分裂的：

```text
Notion       → 知识
Todoist      → 待办
Readwise     → 收藏
Obsidian     → 笔记
Calendar     → 时间
ChatGPT      → AI
```

而 `dsh-personal-os` 希望做的是：

```text
                   Personal OS

          ┌────────────┼────────────┐
          │            │            │
       Knowledge      Todo       Project
          │            │            │
          ├────────────┼────────────┤
          │            │            │
        Inbox       Timeline      Today
          │            │            │
          └────────────┼────────────┘
                       │
                Personal Context
                       │
              ┌────────┴────────┐
              │                 │
          Human UI           DSH Agent
```

最大的区别是：

> **同一份个人数据，同时服务于 Human UI 和 AI Agent。**

人在 UI 中管理任务、知识和项目。

Agent 则可以通过 Tools / Skills 读取和操作相同的数据。

例如用户可以直接说：

> 把刚才讨论的 Personal OS 方案保存成知识，并关联到 dsh-personal-os 项目。

Agent 可以执行：

```text
创建 Knowledge
        ↓
关联 Project
        ↓
提取 Todo
        ↓
记录 Timeline
```

UI 会立即同步变化。

---

# 3. 产品定位

## 一句话定位

> **Your personal context layer for DeepSeek Harness.**

中文可以理解为：

> **给 DeepSeek Harness 加一个属于自己的长期数字记忆和个人工作台。**

它不是另外一个 Notion。

也不是另外一个聊天机器人。

它更接近：

```text
Personal Data
      +
Agent Runtime
      +
Human Interface
```

最终目标是：

> 让 Agent 真正知道“我最近在做什么”。

例如：

> 继续昨天那个 Personal OS。

系统可以自动识别：

```text
Project
dsh-personal-os

最近知识
5 条

未完成 Todo
3 条

昨天 Timeline
8 条事件

最近 Decision
2 条
```

然后组合成为当前 Agent Context。

---

# 4. 产品设计原则

## 4.1 Inbox First

任何东西都可以先进入 Inbox：

```text
文字
URL
GitHub Repo
文件
截图
灵感
AI 对话
任务
文章
```

用户不用一开始决定：

> 这是 Knowledge 还是 Idea？

先收集。

Agent 后续负责：

```text
Capture
   ↓
Understand
   ↓
Classify
   ↓
Link
   ↓
Archive
```

核心理念：

> **人负责捕获，AI 负责整理。**

---

## 4.2 Today First

Today 是整个 Personal OS 的首页。

它回答的不是：

> 我的数据库里有什么？

而是：

> **我今天应该关心什么？**

Today 聚合：

* 今日 Todo
* 进行中的 Project
* 最近 Knowledge
* Inbox 待整理
* 今日 Timeline
* AI Brief
* Continue / 最近工作

---

## 4.3 Everything is an Entity

底层不把 Knowledge、Todo、Project 设计成完全独立的数据孤岛。

统一抽象：

```text
Entity

id
type
title
content
properties
relations
createdAt
updatedAt
source
```

第一阶段 Entity Type：

```text
Knowledge
Todo
Project
Inbox
```

未来自然扩展：

```text
Idea
Bookmark
Person
Goal
Habit
Decision
Book
Company
Stock
Trip
Subscription
```

无需推倒整个数据模型。

---

## 4.4 Relation First

Entity 之间可以建立关系：

```text
Knowledge
   │
   └─ belongs_to → Project


Todo
   │
   └─ belongs_to → Project


Todo
   │
   └─ derived_from → Knowledge


Knowledge
   │
   └─ related_to → Knowledge
```

最终形成属于个人的轻量 Knowledge Graph。

---

# 5. V0.1 功能范围

第一阶段不要追求“大而全”。

只完成一个真正可以每天使用的闭环。

## Today

个人首页。

展示：

```text
今日 Todo
进行中的 Project
Inbox 数量
最近 Knowledge
今日 Timeline
AI Brief
Continue
```

---

## Inbox

统一收件箱。

支持：

```text
快速记录
粘贴 URL
收藏 GitHub
保存 Prompt
保存文章
保存想法
对话生成 Inbox
```

后续支持：

```text
AI 自动分类
AI 推荐 Project
AI 提取 Todo
AI 生成 Knowledge
```

---

## Knowledge

个人知识管理。

包含：

```text
标题
正文
标签
来源
关联 Project
关联 Knowledge
创建时间
更新时间
```

Inspector 中提供：

```text
概览
关系
历史
属性
```

以及 AI Actions：

```text
总结
关联知识
生成 Todo
加入 Project
解释
继续研究
```

---

## Todo

支持：

```text
Inbox Todo
Today
Upcoming
完成
优先级
截止日期
Project
来源 Knowledge
```

Agent 可以直接：

> 把这个知识里的三个行动项变成待办。

---

## Project

Project 是 Knowledge 和 Todo 的上层组织结构。

例如：

```text
dsh-personal-os

Status
Active

Progress
42%

Todo
8 / 14

Knowledge
17

最近活动
...
```

Project Inspector 聚合：

```text
Overview
Todo
Knowledge
Timeline
Decisions
```

---

## Timeline

V0.1 不一定需要独立复杂页面。

先自动记录：

```text
创建 Knowledge
更新 Todo
完成 Todo
创建 Project
关联 Entity
Agent 修改内容
收藏网页
```

以后再升级为：

> 我的个人数字轨迹。

---

# 6. Agent 能力

Personal OS 不只是 UI。

同时提供 Agent Tools：

```text
personal_search

personal_get_entity

personal_create_knowledge

personal_update_knowledge

personal_create_todo

personal_complete_todo

personal_create_project

personal_link_entities

personal_get_today

personal_get_project_context
```

再配套一个：

```text
personal-os Skill
```

告诉 Agent：

* 什么时候创建 Knowledge
* 什么情况下放 Inbox
* 如何提取 Todo
* 如何关联 Project
* 如何维护 Timeline
* 如何避免重复知识

因此形成：

```text
                   Personal OS Core
                         │
          ┌──────────────┴──────────────┐
          │                             │
      Human UI                       Agent
          │                             │
 Sidebar / Inspector              Tool / Skill
          │                             │
          └──────────────┬──────────────┘
                         │
                     Same Data
```

---

# 7. UI 架构

参考 Oil Creator 的交互方式。

不是重新做一套独立 SPA。

而是直接利用 DSH Shell。

## 基础布局

```text
┌───────────────┬──────────────────────────┬─────────────────┐
│ Personal OS   │                          │                 │
│               │                          │                 │
│ 会话 │ 我的    │        Inspector         │    DSH Agent    │
│               │                          │                 │
│ Today         │                          │                 │
│ Inbox         │                          │                 │
│ Knowledge     │                          │                 │
│ Todo          │                          │                 │
│ Projects      │                          │                 │
│ Timeline      │                          │                 │
│               │                          │                 │
│ 最近          │                          │                 │
│               │                          │                 │
│ Settings      │                          │                 │
└───────────────┴──────────────────────────┴─────────────────┘
```

普通状态：

```text
Sidebar
+
DSH Agent
```

点击 Knowledge / Todo / Project 后：

```text
Sidebar
+
Inspector
+
DSH Agent
```

形成：

> **左边找东西，中间看东西，右边让 Agent 操作东西。**

---

# 8. UI 风格

Personal OS 不采用典型：

```text
紫色渐变
玻璃拟态
大量 Dashboard Card
AI SaaS
```

而采用：

# Technical Doodle OS

视觉来源：

```text
Engineering Diagram
×
Notebook
×
Modern Agent UI
```

设计原则：

```text
70% 现代极简 UI
30% Technical Doodle
```

视觉特征：

* 大面积白色 / 米白色
* 黑色为主要信息颜色
* Orange 作为核心强调色
* Blue 作为 AI / Relation 辅助色
* 极少红色用于危险或优先级
* 手绘 underline
* 手绘 arrow
* Technical diagram
* 极少量黑色小人物
* 大量留白
* 不大量使用 Card
* 不让所有组件都手绘化

核心原则：

> **手绘负责灵魂，现代 UI 负责秩序。**

---

# 9. Theme 系统

从 V0.1 架构上支持皮肤，但首发只做三套。

## Doodle

默认主题。

```text
Technical Doodle
黑白
橙色
少量蓝色
工程手绘
```

形成 Personal OS 品牌识别。

---

## Harness

接近 DeepSeek Harness / Oil Creator：

```text
现代
克制
低干扰
效率工具
```

适合喜欢原生 DSH 风格的用户。

---

## Paper

偏阅读和沉淀：

```text
米白纸张
Serif
极简线条
低对比度
阅读感
```

Theme 不复制页面代码。

统一使用：

```text
Design Tokens
+
Component Variants
+
Illustration Assets
```

例如：

```ts
Theme {
  colors
  typography
  radius
  border
  shadow
  spacing

  iconStyle
  cardStyle
  dividerStyle
  illustrationStyle
  illustrationDensity
}
```

额外提供：

```text
插画密度

○ 无
● 克制
○ 丰富
```

默认：

```text
subtle
```

避免界面过于花哨。

---

# 10. 技术架构

整体架构：

```text
                       DeepSeek Harness
                              │
            ┌─────────────────┼─────────────────┐
            │                 │                 │
         Client            Host              Agent
            │                 │                 │
       React UI         Domain Service       Skill
            │                 │               Tools
      DSH UI Slots          Remote API         │
            │                 │                 │
            └─────────────────┼─────────────────┘
                              │
                       Personal OS Core
                              │
                   ┌──────────┼──────────┐
                   │          │          │
                Entity     Relation    Timeline
                   │          │          │
                   └──────────┼──────────┘
                              │
                           Storage
```

---

# 11. DSH 集成方式

参考 `dsh-oil-creator`。

Client Plugin 使用：

```text
@deepseek-ai/dsh-client-runtime
@deepseek-ai/dsh-client-ui-layout
@deepseek-ai/dsh-client-ui-slots
@deepseek-ai/dsh-client-connection
@deepseek-ai/dsh-client-ui-settings-plugins
```

主要利用：

### Sidebar Slot

注册：

```text
PersonalSidebar
```

提供：

```text
会话
我的
Today
Inbox
Knowledge
Todo
Projects
Timeline
```

---

### Shell Overlay

点击 Entity 时加载：

```text
KnowledgeInspector
TodoInspector
ProjectInspector
```

---

### Settings Slot

在：

```text
设置
→ 插件
→ Personal OS
```

提供：

```text
数据目录
主题
插画密度
Agent 行为
AI 自动整理
数据备份
```

---

### Remote API

Client 不直接访问数据库。

统一：

```text
Client
   ↓
Remote API
   ↓
Personal OS Host
```

例如：

```text
listEntities()
getEntity()
createEntity()
updateEntity()
deleteEntity()

listRelations()
linkEntities()

getToday()
getTimeline()
search()
```

---

# 12. 技术选型

## Runtime

```text
DeepSeek Harness
Cordis
Node.js 24+
TypeScript
```

---

## Frontend

继续跟随 DSH 技术体系：

```text
React
TypeScript
DSH Client Runtime
DSH UI Slots
CSS / CSS Variables
```

第一阶段不引入大型 UI Framework。

原因：

> 需要与 DSH 原生视觉保持一致，并支持自定义 Theme。

---

## 数据层

V0.1 推荐：

```text
SQLite
```

原因：

* 单文件
* 本地优先
* 无服务依赖
* 查询方便
* Relation 好处理
* Timeline 好处理
* 后期迁移空间大

数据库：

```text
personal.db
```

核心表：

```text
entities

relations

events

attachments

settings
```

正文仍可以考虑：

```text
Markdown
```

形成：

```text
SQLite
→ metadata / relation / index

Markdown
→ long-form content
```

但 V0.1 也可以全部 SQLite，后期再抽象。

---

## 搜索

V0.1：

```text
SQLite FTS5
```

先完成：

```text
全文搜索
标题搜索
标签搜索
关系查询
```

V0.2 再增加：

```text
Embedding
Semantic Search
Hybrid Search
```

避免一开始就引入向量数据库。

---

# 13. 推荐目录结构

```text
dsh-personal-os/

├── src/
│
│   ├── host/
│   │   ├── index.ts
│   │   │
│   │   ├── domain/
│   │   │   ├── entity.ts
│   │   │   ├── relation.ts
│   │   │   ├── todo.ts
│   │   │   ├── project.ts
│   │   │   └── timeline.ts
│   │   │
│   │   ├── storage/
│   │   │   ├── sqlite.ts
│   │   │   ├── entityRepository.ts
│   │   │   └── relationRepository.ts
│   │   │
│   │   ├── remote/
│   │   │   └── personalRemote.ts
│   │   │
│   │   └── tools/
│   │       ├── knowledge.ts
│   │       ├── todo.ts
│   │       ├── project.ts
│   │       └── search.ts
│   │
│   ├── client/
│   │   ├── index.tsx
│   │   │
│   │   ├── sidebar/
│   │   │   ├── PersonalSidebar.tsx
│   │   │   ├── TodayNav.tsx
│   │   │   └── RecentList.tsx
│   │   │
│   │   ├── today/
│   │   │   └── TodayView.tsx
│   │   │
│   │   ├── knowledge/
│   │   │   ├── KnowledgeList.tsx
│   │   │   └── KnowledgeInspector.tsx
│   │   │
│   │   ├── todo/
│   │   │   └── TodoInspector.tsx
│   │   │
│   │   ├── project/
│   │   │   └── ProjectInspector.tsx
│   │   │
│   │   └── themes/
│   │       ├── harness/
│   │       ├── doodle/
│   │       └── paper/
│   │
│   └── shared/
│       ├── types.ts
│       └── remote.ts
│
├── skills/
│   └── personal-os/
│       └── SKILL.md
│
├── cordis.patch.yml
├── package.json
└── README.md
```

---

# 14. 效果图

当前视觉方向：

**Technical Doodle × DSH Agent UI**

![dsh-personal-os 效果图](sandbox:/mnt/data/a_clean_white_ui_mockup_screenshot_of_a_personal_p.png)

关键特征：

```text
左：Personal OS 导航
中：Today / Inspector
右：DSH Agent
```

在不破坏 Harness 原生交互效率的情况下，引入：

```text
手绘人物
技术图解
橙色 underline
少量手绘箭头
知识关系图
```

保持大面积留白。

---

# 15. V0.1 成功标准

V0.1 不以功能数量衡量。

只验证一个完整闭环：

### 用户操作

用户打开：

```text
dsh web
```

看到：

```text
Personal OS
```

进入：

```text
我的
```

可以：

```text
Today
Inbox
Knowledge
Todo
Projects
```

---

### UI → Agent

选中：

```text
DeepSeek Harness 插件机制
```

Inspector 打开。

告诉 Agent：

> 把这篇知识关联到 dsh-personal-os，并创建一个明天下午研究 DSH Slots 的 Todo。

执行后：

```text
Project Inspector
Knowledge
Todo
```

立即同步。

---

### Agent → UI

告诉 Agent：

> 最近 Personal OS 做到哪里了？

Agent 查询：

```text
Project
Todo
Knowledge
Timeline
```

生成真实状态总结。

这条链路跑通，就证明：

> **Personal OS 不只是一个 UI 插件，而是 DSH 的个人 Context Layer。**

---

# 16. 后续路线

## V0.1

```text
Today
Inbox
Knowledge
Todo
Project
Entity / Relation
Agent Tools
Personal OS Skill
Theme System
```

## V0.2

```text
Timeline
Daily Note
Web Capture
GitHub Capture
```

## V0.3

```text
Semantic Search
Related Knowledge
Knowledge Graph
```

## V0.4

```text
Personal Context Resolver
```

实现真正的：

> “继续昨天那个。”

## V0.5

```text
Goal
Habit
Decision
Person
Bookmark
```

## V0.6

```text
自动整理 Inbox
自动生成 Daily Brief
自动发现长期主题
自动回顾项目
```

最终 `dsh-personal-os` 不只是管理信息，而是逐渐形成：

> **一个知道你在做什么、学什么、计划什么，并能和你一起持续工作的个人 Agent OS。**
