# 可观测性（Langfuse 集成）

**文件**：`src/observability.ts`

UniverseAgents 通过 [Langfuse](https://langfuse.com/) 实现生产级可观测性，自动追踪 LLM 调用、工具执行和 Agent 运行全流程。集成基于 LangChain 的 Callback 机制，**不是中间件**。

---

## 架构概览

```
createUniverseAgent()
    │
    ▼
autoCreateLangfuseHandler()  ←── 检测环境变量
    │
    ├─ LANGFUSE_PUBLIC_KEY + LANGFUSE_SECRET_KEY 存在？
    │   ├─ 是 → 创建 CallbackHandler + NodeSDK → 注入 agent
    │   └─ 否 → 返回 undefined，不启用
    │
    ▼
agent.withConfig({ callbacks: [langfuseHandler, ...userCallbacks] })
    │
    ▼
LangChain 自动通过 callback 追踪：
  ├─ LLM 调用（输入/输出/token 统计）
  ├─ 工具执行（名称、参数、结果）
  └─ Agent 完整运行周期
```

---

## 依赖

| 包                     | 用途                         |
| ---------------------- | ---------------------------- |
| `@langfuse/langchain`  | LangChain Callback 集成      |
| `@langfuse/otel`       | OpenTelemetry Span 处理器    |
| `@opentelemetry/sdk-node` | OpenTelemetry Node SDK    |

---

## 环境变量

| 变量                    | 必需   | 说明                                        |
| ----------------------- | ------ | ------------------------------------------- |
| `LANGFUSE_PUBLIC_KEY`   | **是** | Langfuse 项目公钥                           |
| `LANGFUSE_SECRET_KEY`   | **是** | Langfuse 项目私钥                           |
| `LANGFUSE_BASEURL`      | 否     | 自定义 Langfuse 服务地址（默认用官方 API）  |
| `LANGFUSE_USER`         | 否     | 用户标识，默认取 `USER` / `USERNAME` 环境变量 |
| `LANGFUSE_TAGS`         | 否     | 逗号分隔的标签，默认 `['universe-agent']`   |

---

## 使用方式

### 方式一：零代码自动启用（推荐）

只需设置环境变量，`createUniverseAgent()` 会自动检测并创建 handler：

```typescript
// 设置环境变量即可，无需任何代码修改
// LANGFUSE_PUBLIC_KEY=pk-...
// LANGFUSE_SECRET_KEY=sk-...

const agent = createUniverseAgent({
  model: 'anthropic:claude-sonnet-4-6',
  tools: [...],
});
// Langfuse 追踪自动生效
```

### 方式二：手动创建 handler

适用于需要自定义 session、metadata 等场景：

```typescript
import { createLangfuseHandler, flushLangfuseHandler } from 'universe-agent';

const handler = await createLangfuseHandler({
  sessionId: 'my-session-123',
  userId: 'user-456',
  tags: ['production', 'billing-flow'],
  metadata: { environment: 'staging' },
});

const agent = createUniverseAgent({
  callbacks: [handler],
  // ...
});

const result = await agent.invoke({ messages: [...] });

// 进程退出前务必 flush，确保数据不丢失
await flushLangfuseHandler(handler);
```

---

## 核心 API

### `createLangfuseHandler(config?)`

**异步**创建 Langfuse Callback Handler。

```typescript
async function createLangfuseHandler(
  config?: LangfuseHandlerOptions,
): Promise<BaseCallbackHandler>
```

**参数 `LangfuseHandlerOptions`**：

| 字段       | 类型                        | 说明                           |
| ---------- | --------------------------- | ------------------------------ |
| `sessionId` | `string`                   | 会话 ID，用于关联多次调用       |
| `userId`   | `string`                    | 用户标识                       |
| `tags`     | `string[]`                  | 分类标签                       |
| `version`  | `string`                    | 版本标记                       |
| `metadata` | `Record<string, unknown>`   | 任意附加元数据                 |

### `autoCreateLangfuseHandler(config?)`

**同步**函数，检测环境变量后自动创建。供 `createUniverseAgent()` 内部调用。

- 环境变量齐全 → 返回 `BaseCallbackHandler`
- 环境变量缺失 → 返回 `undefined`（静默跳过）

自动填充的默认值：
- `sessionId`：`session-YYYYMMDDHHmmss` 格式
- `userId`：从 `LANGFUSE_USER` → `USER` → `USERNAME` 依次取值
- `tags`：从 `LANGFUSE_TAGS` 解析，默认 `['universe-agent']`

### `flushLangfuseHandler(handler)`

刷新缓冲区并移除 handler。在手动模式下，进程退出前必须调用以确保数据完整发送。

```typescript
async function flushLangfuseHandler(handler: BaseCallbackHandler): Promise<void>
```

---

## 生命周期管理

```
首次创建 handler
    │
    ▼
initializeSdk()  ─── 创建 NodeSDK + LangfuseSpanProcessor
    │                  ↑ 全局单例，多 handler 共享
    ▼
addCallbackHandler()  ─── 加入全局 Set
    │
    ▼
registerExitHandler()  ─── 注册 process.beforeExit 钩子（仅一次）
    │
    ... Agent 运行中 ...
    │
    ▼
flushLangfuseHandler() / 进程退出
    │
    ▼
removeCallbackHandler()
    │
    ├─ Set 中还有其他 handler → 仅移除当前 handler
    └─ Set 为空 → sdk.shutdown()，释放 OTel 资源
```

**关键设计**：
- `NodeSDK` 是全局单例，首个 handler 创建时初始化，最后一个 handler 移除时关闭
- `callbackHandlerSet` 追踪所有活跃 handler，实现引用计数式的生命周期管理
- `process.beforeExit` 钩子确保非异常退出时自动清理

---

## 与录像模式的关系

**回放模式下自动禁用 Langfuse**：

```typescript
// agent.ts 中的逻辑
const autoLangfuseHandler =
  recording && effectiveMode === 'replay'
    ? undefined
    : autoCreateLangfuseHandler();
```

原因：回放模式使用 `fakeModel` 而非真实 LLM，发送虚假的 trace 数据没有意义。

---

## 追踪内容

Langfuse 通过 LangChain Callback 自动捕获：

| 追踪项         | 说明                                  |
| -------------- | ------------------------------------- |
| LLM 调用       | 模型名称、输入消息、输出、token 统计  |
| 工具执行       | 工具名称、参数、执行结果              |
| Agent 步骤     | 完整的推理-工具-推理循环              |
| OTel Spans     | 通过 `LangfuseSpanProcessor` 上报     |

所有 trace 自动附带 `ls_integration: 'universe-agent'` 和 `lc_agent_name` 元数据。
