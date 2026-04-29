## CLAUDE.md

终端命令行工具，提供交互式 REPL 和一次性 prompt 执行。

**核心结构：**

| 文件/目录          | 说明                             |
| ------------------ | -------------------------------- |
| `src/index.ts`     | CLI 入口（shebang）              |
| `src/cli.ts`       | 参数解析（commander）            |
| `src/agent.ts`     | `createCliAgent()` 工厂函数      |
| `src/repl.ts`      | 交互式 REPL                      |
| `src/replay.ts`    | 录像回放                         |
| `src/renderer.ts`  | 流式输出渲染                     |
| `src/config/`      | JSONC 配置加载（Zod schema 校验）|

**关键概念：**

* 可执行文件：`universe-agent`
* 支持 `-m` 指定模型、`--record` 录制、`--replay` 回放
* 配置文件支持 JSONC 格式，通过 `-c` 指定路径
* 依赖 `@universe-agent/agent` 核心框架
