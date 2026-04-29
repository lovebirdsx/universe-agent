## CLAUDE.md

ACP 协议命令行客户端，用于调试和测试 ACP 服务端。

**核心结构：**

| 文件              | 说明                        |
| ----------------- | --------------------------- |
| `src/index.ts`    | CLI 入口（shebang）         |
| `src/cli.ts`      | 参数解析                    |
| `src/client.ts`   | `ACPClient` 连接管理        |
| `src/renderer.ts` | 协议消息渲染输出            |
| `src/repl.ts`     | 交互式 REPL                 |

**关键概念：**

* 可执行文件：`universe-agent-acp-client`
* `-P` 开启协议观察模式，查看原始 JSON-RPC 消息
* `--permission` 支持 interactive / auto-approve / deny-all 三种模式
* REPL 命令：`/session new`、`/mode`、`/protocol`、`/cancel` 等
