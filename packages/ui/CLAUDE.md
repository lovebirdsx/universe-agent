## CLAUDE.md

React 组件库，提供可复用 UI 组件。

**核心结构：**

| 文件              | 说明                                          |
| ----------------- | --------------------------------------------- |
| `src/index.ts`    | 统一导出                                      |
| `src/Button.tsx`  | Button 组件（variants: primary/secondary/ghost，sizes: sm/md/lg） |

**注意：**

* peer 依赖 React ≥19
* 样式使用 Tailwind CSS + `cn()` 工具函数（来自 shared）
* 测试环境使用 happy-dom
* 新增组件需同步导出到 `index.ts`
