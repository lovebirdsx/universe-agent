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
  acp/            # 基于UniverseAgent的 ACP 服务器
  acp-client/     # ACP 客户端测试工具，基于 UniverseAgent
  agent/          # UniverseAgent 框架（见下文）
  cli/            # 命令行工具
  shared/         # 纯工具函数
  ui/             # React 组件库
  config-eslint/   # 共享 ESLint flat config
  config-ts/       # 共享 tsconfig 预设
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

* 换行采用 LF（Unix 风格）
* 修复代码后，使用 `pnpm check` 验证修复结果
* apps和packages的每个包都有自己独立的CLAUDE.md，你在完成功能后，若有需要，请务必更新对应的CLAUDE.md，保持文档与代码同步
* 表达"无值"统一使用 `undefined`，`null` 仅用于：外部 API 要求、JSON 序列化（`JSON.stringify(data, null, 2)`）、显式删除标记（`null` = 删除 vs `undefined` = 不更新）。ESLint `no-restricted-syntax` 规则会对 `null` 字面量发出警告，合法使用需加 `// eslint-disable-next-line no-restricted-syntax` 注释
