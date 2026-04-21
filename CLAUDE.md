# CLAUDE.md

## 项目简介

* 基于 LangChain/LangGraph 的 AI Agent 框架，提供中间件、subagent、工具调用等功能
* TypeScript monorepo，使用 Turborepo 管理任务依赖，pnpm workspace + catalog 统一版本

## 技术栈

| 层次     | 技术                                                                             |
| -------- | -------------------------------------------------------------------------------- |
| 包管理   | pnpm 10 + workspace catalog                                                      |
| 构建编排 | Turborepo 2                                                                      |
| 语言     | TypeScript 5.8（strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes） |
| API      | Hono 4 + @hono/node-server，tsx watch 开发                                       |
| 前端     | React 19 + Vite 7                                                                |
| 测试     | Vitest 3（API: node 环境；Web/UI: happy-dom）                                    |
| Lint     | ESLint 9 flat config + Prettier 3                                                |
| 发版     | Changesets                                                                       |
| CI       | GitHub Actions（ubuntu-latest, Node 22）                                         |

## 目录结构

```
apps/
  api/            # 后端 API 服务，使用 Hono
  web/            # 前端 React 应用，使用 Vite
  examples/       # 示例代码
packages/
  agent/          # DeepAgent 框架（见下文）
  shared/         # 纯工具函数
  ui/             # React 组件库
  configEslint/   # 共享 ESLint flat config
  configTs/       # 共享 tsconfig 预设
```

## 开发命令

```bash
pnpm install              # 安装依赖（首次或更新后）

# 全局（通过 Turborepo，自动处理依赖顺序）
pnpm dev                  # 启动所有 dev 服务（shared/ui 先 watch 构建）
pnpm test                 # 全量测试
pnpm check                # lint + typecheck + unit test + build
```

## 注意

* 回答请使用中文
* 换行采用 LF（Unix 风格）
* 修复代码后，使用 `pnpm check` 验证修复结果

## DeepAgent（packages/agent）

基于 LangChain/LangGraph 的 AI Agent 框架，入口为 `createDeepAgent()`。

**核心结构：**

| 目录/文件      | 说明                                                                  |
| -------------- | --------------------------------------------------------------------- |
| `agent.ts`     | `createDeepAgent()` 主函数，组装模型、中间件、subagent                |
| `types.ts`     | 类型定义（`CreateDeepAgentParams`、`DeepAgent` 等）                   |
| `recording.ts` | 录像模式：录制 LLM 输出 / fakeModel 回放                              |
| `middleware/`  | 内置中间件（filesystem、subagents、summarization、skills、memory 等） |
| `backends/`    | 后端抽象（State、Store、Filesystem、Sandbox、LocalShell）             |
| `skills/`      | Skills 加载器                                                         |
| `testing/`     | 测试工具（`assertAllDeepAgentQualities`、mock tools）                 |

**关键概念：**

* `createDeepAgent({ model, tools, middleware, subagents, recording, ... })` → 返回 `DeepAgent`（扩展自 LangChain `ReactAgent`）
* 中间件栈：todoList → skills → filesystem → subagents → summarization → patchToolCalls → async → custom → cache → memory → HITL
* Subagent 通过 `task` tool 委派，自动继承 `defaultModel`
* 录像模式（`recording`）：`record` 录制模型输出到 JSON，`replay` 用 `fakeModel()` 回放，`auto` 自动选择
* 测试分 unit（`*.test.ts`）和 integration（`*.int.test.ts`），集成测试需要 API key
