## CLAUDE.md

ACP 协议命令行客户端，用于调试和测试 ACP 服务端。

**核心结构：**

| 文件              | 说明                        |
| ----------------- | --------------------------- |
| `src/index.ts`    | CLI 入口（shebang）         |
| `src/cli.ts`      | 参数解析                    |
| `src/client.ts`   | `ACPClient` 连接管理        |
| `src/mcp.ts`      | MCP 配置加载与格式转换      |
| `src/renderer.ts` | 协议消息渲染输出            |
| `src/repl.ts`     | 交互式 REPL                 |

**关键概念：**

* 可执行文件：`universe-agent-acp-client`
* `-P` 开启协议观察模式，查看原始 JSON-RPC 消息
* `--permission` 支持 interactive / auto-approve / deny-all 三种模式
* REPL 命令：`/session new`、`/mode`、`/protocol`、`/cancel` 等
* `--mcp-config <path>` 指定 MCP 服务器配置文件，在会话创建时传递给 ACP 服务端

**MCP 配置文件格式（JSON）：**

```json
{
  "mcpServers": {
    "my-stdio-server": {
      "transport": "stdio",
      "command": "npx",
      "args": ["tsx", "apps/examples/mcp/mcpServer.ts"]
    },
    "my-http-server": {
      "transport": "streamable-http",
      "url": "https://example.com/mcp",
      "headers": { "Authorization": "Bearer token" }
    },
    "my-sse-server": {
      "transport": "sse",
      "url": "https://example.com/mcp/sse"
    }
  }
}
```

**使用示例：**

```bash
# 携带 MCP 配置启动（交互式 REPL）
pnpm start:dev -- --mcp-config ./mcp.json

# 搭配协议观测模式
pnpm start:dev -- -P --mcp-config ./mcp.json
```
