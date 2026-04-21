# 入口与公共 API

**文件**：`src/index.ts`

该文件是整个库的唯一对外入口，将所有模块的公共接口集中导出。

---

## 导出分类

### 1. Agent 工厂函数

```typescript
export { createDeepAgent } from "./agent.js";
```

这是库的核心 API，用于创建一个配置好的 Deep Agent 实例。

---

### 2. 类型定义

```typescript
export type {
  // 子代理类型
  AnySubAgent,                    // SubAgent | CompiledSubAgent | AsyncSubAgent

  // Agent 创建参数
  CreateDeepAgentParams,

  // 状态类型
  MergedDeepAgentState,

  // DeepAgent 主类型及工具类型
  DeepAgent,
  DeepAgentTypeConfig,
  DefaultDeepAgentTypeConfig,
  ResolveDeepAgentTypeConfig,
  InferDeepAgentType,
  InferDeepAgentSubagents,
  InferSubagentByName,
  InferSubagentReactAgentType,

  // 子代理中间件提取类型
  ExtractSubAgentMiddleware,
  FlattenSubAgentMiddleware,
  InferSubAgentMiddlewareStates,

  // 响应格式类型
  SupportedResponseFormat,
  InferStructuredResponse,
} from "./types.js";
```

---

### 3. 配置工具

```typescript
export {
  createSettings,       // 创建 Settings 实例
  findProjectRoot,      // 查找项目根目录（.git 所在目录）
  type Settings,
  type SettingsOptions,
} from "./config.js";
```

---

### 4. 中间件工厂

```typescript
export {
  // 核心中间件
  createFilesystemMiddleware,
  createSubAgentMiddleware,
  createPatchToolCallsMiddleware,
  createSummarizationMiddleware,
  computeSummarizationDefaults,
  createMemoryMiddleware,
  createAsyncSubAgentMiddleware,
  isAsyncSubAgent,

  // 技能中间件
  createSkillsMiddleware,
  type SkillsMiddlewareOptions,
  type SkillMetadata,
  MAX_SKILL_FILE_SIZE,
  MAX_SKILL_NAME_LENGTH,
  MAX_SKILL_DESCRIPTION_LENGTH,

  // 子代理常量
  GENERAL_PURPOSE_SUBAGENT,
  DEFAULT_GENERAL_PURPOSE_DESCRIPTION,
  DEFAULT_SUBAGENT_PROMPT,
  TASK_SYSTEM_PROMPT,

  // 异步子代理回调
  createCompletionCallbackMiddleware,
  type CompletionCallbackOptions,

  // 中间件选项类型
  type FilesystemMiddlewareOptions,
  type SubAgentMiddlewareOptions,
  type MemoryMiddlewareOptions,
  type SubAgent,
  type CompiledSubAgent,
  type AsyncSubAgentMiddlewareOptions,
  type AsyncSubAgent,
  type AsyncTask,
  type AsyncTaskStatus,
} from "./middleware/index.js";
```

---

### 5. 共享状态值

```typescript
export { filesValue } from "./values.js";
```

`filesValue` 是 LangGraph 的 `ReducedValue` 实例，用于在自定义 LangGraph 图中直接使用 `files` 状态通道（当不通过 `createFilesystemMiddleware` 时使用）。

---

### 6. 代理记忆中间件（已弃用变体）

```typescript
export {
  createAgentMemoryMiddleware,
  type AgentMemoryMiddlewareOptions,
} from "./middleware/agent-memory.js";
```

---

### 7. 技能加载器（工具函数）

```typescript
export {
  listSkills,           // 列出目录中的所有技能
  parseSkillMetadata,   // 解析 SKILL.md 的 frontmatter 元数据
  type SkillMetadata as LoaderSkillMetadata,
  type ListSkillsOptions,
} from "./skills/index.js";
```

---

### 8. 后端系统

```typescript
export {
  // 后端实现类
  StateBackend,
  StoreBackend,
  FilesystemBackend,
  CompositeBackend,
  BaseSandbox,
  LangSmithSandbox,
  LocalShellBackend,

  // 工具函数
  isSandboxBackend,
  isSandboxProtocol,
  resolveBackend,
  adaptBackendProtocol,
  adaptSandboxProtocol,

  // 错误类
  SandboxError,

  // 后端协议类型
  type AnyBackendProtocol,
  type BackendProtocol,           // 已弃用，使用 BackendProtocolV2
  type BackendProtocolV1,         // 已弃用
  type BackendProtocolV2,         // 当前标准
  type BackendFactory,
  type BackendRuntime,

  // 操作结果类型
  type FileInfo,
  type GrepMatch,
  type GlobResult,
  type GrepResult,
  type LsResult,
  type ReadResult,
  type ReadRawResult,
  type WriteResult,
  type EditResult,
  type ExecuteResponse,

  // 文件数据类型
  type FileData,
  type FileOperationError,
  type FileDownloadResponse,
  type FileUploadResponse,

  // 沙箱协议类型
  type SandboxBackendProtocol,    // 已弃用
  type SandboxBackendProtocolV1,  // 已弃用
  type SandboxBackendProtocolV2,  // 当前标准

  // 沙箱管理类型
  type SandboxInfo,
  type SandboxListResponse,
  type SandboxListOptions,
  type SandboxGetOrCreateOptions,
  type SandboxDeleteOptions,
  type SandboxErrorCode,

  // 其他
  type StateAndStore,             // 已弃用
  type MaybePromise,
  type LangSmithSandboxOptions,
  type LocalShellBackendOptions,
  type StoreBackendContext,
  type StoreBackendNamespaceFactory,
  type StoreBackendOptions,
} from "./backends/index.js";
```

---

## 设计原则

1. **单一入口**：所有公共 API 从 `index.ts` 统一导出，用户只需 `import { ... } from "deepagents"`
2. **类型完整导出**：既导出运行时值（类、函数），也导出 TypeScript 类型，方便类型推断
3. **已弃用标注**：通过 `@deprecated` JSDoc 标注过时 API，保持向后兼容的同时引导用户升级
4. **模块隔离**：`index.ts` 只做 re-export，不含任何业务逻辑

---

*[← 依赖与构建](./03-依赖与构建.md) | [createDeepAgent 主函数 →](./05-createDeepAgent.md)*
