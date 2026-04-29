## CLAUDE.md

UniverseAgent 使用示例集合，用 `npx tsx <file>.ts` 单独运行。

**目录结构：**

| 目录              | 说明                                   |
| ----------------- | -------------------------------------- |
| `acp-server/`     | ACP 协议服务端示例（IDE 集成）         |
| `backends/`       | 后端实现示例（Filesystem、State 等）   |
| `hierarchical/`   | 多级分层 Agent 示例                    |
| `memory/`         | 持久化记忆 Agent 示例                  |
| `mcp/`            | MCP 协议工具集成示例                   |
| `replay/`         | 会话录制与回放示例                     |
| `research/`       | 带搜索和持久存储的研究 Agent           |
| `skills-memory/`  | Skills + Memory 组合示例               |
| `streaming/`      | 8 种流式输出模式示例                   |

**注意：**

* 无 build/test 脚本，仅有 typecheck 和 lint
* 集成测试需要 API key（通过 .env 配置）
