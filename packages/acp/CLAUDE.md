## CLAUDE.md

ACP（Agent Client Protocol）服务端，将 UniverseAgent 接入 IDE（Zed、JetBrains 等），基于 stdio JSON-RPC 2.0 通信。

**核心结构：**

| 文件                       | 说明                                |
| -------------------------- | ----------------------------------- |
| `src/server.ts`            | `UniverseAgentServer` 主类          |
| `src/cli.ts`               | CLI 入口及参数解析                  |
| `src/adapter.ts`           | ACP ↔ LangChain 消息转换           |
| `src/acpFileSystemBackend.ts` | 通过 IDE 代理文件操作的后端      |
| `src/logger.ts`            | 日志工具                            |

**关键概念：**

* 入口函数：`startServer()` / `UniverseAgentServer`
* 支持模式：Agent（自主）、Plan（只读）、Ask（问答）
* 斜杠命令：`/plan`、`/agent`、`/ask`、`/clear`、`/status`
* Human-in-the-Loop：通过 `interruptOn` 配置敏感工具审批
* 构建工具：tsdown（非 tsc）
