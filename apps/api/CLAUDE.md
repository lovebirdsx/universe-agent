## CLAUDE.md

Hono 后端 API 服务，默认端口 3001。

**核心结构：**

| 文件           | 说明                          |
| -------------- | ----------------------------- |
| `src/index.ts` | 入口，启动 @hono/node-server  |
| `src/app.ts`   | Hono 应用，定义路由           |

**注意：**

* 依赖 `@universe-agent/shared`
* `pnpm dev` 使用 tsx watch 启动
* 端口通过 `PORT` 环境变量配置，默认 3001
