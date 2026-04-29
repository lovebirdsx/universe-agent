## CLAUDE.md

基于 LangChain/LangGraph 的 AI Agent 框架，入口为 `createUniverseAgent()`。

**核心结构：**

| 目录/文件      | 说明                                                                  |
| -------------- | --------------------------------------------------------------------- |
| `agent.ts`     | `createUniverseAgent()` 主函数，组装模型、中间件、subagent                |
| `types.ts`     | 类型定义（`CreateUniverseAgentParams`、`UniverseAgent` 等）                   |
| `recording.ts` | 录像模式：录制 LLM 输出 / fakeModel 回放                              |
| `middleware/`  | 内置中间件（filesystem、subagents、summarization、skills、memory 等） |
| `backends/`    | 后端抽象（State、Store、Filesystem、Sandbox、LocalShell）             |
| `skills/`      | Skills 加载器                                                         |
| `testing/`     | 测试工具（`assertAllUniverseAgentQualities`、mock tools）                 |

**关键概念：**

* `createUniverseAgent({ model, tools, middleware, subagents, recording, ... })` → 返回 `UniverseAgent`（扩展自 LangChain `ReactAgent`）
* 中间件栈：todoList → skills → filesystem → subagents → summarization → patchToolCalls → async → custom → cache → memory → HITL
* Subagent 通过 `task` tool 委派，自动继承 `defaultModel`
* 录像模式（`recording`）：`record` 录制模型输出到 JSON，`replay` 用 `fakeModel()` 回放，`auto` 自动选择
* 测试分 unit（`*.test.ts`）和 integration（`*.int.test.ts`），集成测试需要 API key
