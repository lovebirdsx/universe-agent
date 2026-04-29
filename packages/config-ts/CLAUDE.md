## CLAUDE.md

共享 tsconfig 预设。

**导出：**

| 入口        | 说明                                                |
| ----------- | --------------------------------------------------- |
| `./base`    | 基础配置（ES2022、strict、noUncheckedIndexedAccess） |
| `./node`    | Node.js 项目（moduleResolution: NodeNext）          |
| `./react`   | React 项目（JSX: react-jsx、DOM libs）              |

**注意：**

* 纯 JSON 配置，无依赖、无需构建
* 所有包的 tsconfig.json 都 extends 这里的预设
