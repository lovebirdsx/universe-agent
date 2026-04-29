# Universe Agent

基于 LangChain/LangGraph 的 AI Agent 框架，提供中间件、subagent、工具调用等能力。

## 技术栈

TypeScript monorepo · pnpm workspace + catalog · Turborepo · Hono · React + Vite · Vitest · ESLint + Prettier · Changesets

## 项目结构

```
apps/
  api/            # 后端 API（Hono）
  web/            # 前端（React + Vite）
  examples/       # 示例代码
packages/
  agent/          # UniverseAgent 核心框架
  acp/            # ACP 服务器
  acp-client/     # ACP 客户端
  cli/            # 命令行工具
  shared/         # 工具函数
  ui/             # React 组件库
  config-eslint/  # ESLint 共享配置
  config-ts/      # TypeScript 共享配置
```

## 快速上手

```bash
pnpm install          # 安装依赖
pnpm dev              # 启动开发
pnpm check            # lint + typecheck + test + build
pnpm test             # 全量测试
```

## License

MIT
