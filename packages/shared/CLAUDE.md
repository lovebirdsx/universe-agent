## CLAUDE.md

纯工具函数库，被多个包共享引用。

**导出：**

| 函数                         | 说明                              |
| ---------------------------- | --------------------------------- |
| `formatMoney(amount, currency)` | 基于 Intl.NumberFormat 的货币格式化 |
| `cn(...classes)`             | className 拼接工具（过滤 falsy） |

**注意：**

* 私有包，不发布到 npm
* 新增工具函数应放在 `src/utils.ts`
