## CLAUDE.md

共享 ESLint 9 flat config。

**导出：**

| 入口        | 说明                                            |
| ----------- | ----------------------------------------------- |
| `.`（默认） | 基础 TypeScript 规则（strict no-unused-vars、no-explicit-any） |
| `./react`   | 扩展基础 + react-hooks 规则（适用于 tsx/jsx）   |

**注意：**

* 集成 Prettier（eslint-config-prettier + eslint-plugin-prettier）
* 纯 JS 配置文件，无需构建
