# createUniverseAgent 主函数

**文件**：`src/agent.ts`

`createUniverseAgent` 是整个框架的核心工厂函数，负责组装所有中间件、配置 Agent 运行时并返回一个 `UniverseAgent` 实例。

---

## 函数签名

```typescript
function createUniverseAgent<
  TResponse extends SupportedResponseFormat = SupportedResponseFormat,
  ContextSchema extends InteropZodObject = InteropZodObject,
  const TMiddleware extends readonly AgentMiddleware[] = readonly [],
  const TSubagents extends readonly AnySubAgent[] = readonly [],
  const TTools extends readonly (ClientTool | ServerTool)[] = readonly [],
>(
  params: CreateUniverseAgentParams<TResponse, ContextSchema, TMiddleware, TSubagents, TTools> = {}
): UniverseAgent<UniverseAgentTypeConfig<...>>
```

函数使用了 5 个泛型参数，全部有默认值，因此最简用法是：

```typescript
const agent = createUniverseAgent();
```

---

## 参数详解（CreateUniverseAgentParams）

| 参数             | 类型                                   | 默认值                          | 说明                              |
| ---------------- | -------------------------------------- | ------------------------------- | --------------------------------- |
| `model`          | `string \| BaseLanguageModel`          | `"anthropic:claude-sonnet-4-6"` | 使用的 LLM 模型                   |
| `tools`          | `StructuredTool[]`                     | `[]`                            | 自定义工具列表                    |
| `systemPrompt`   | `string \| SystemMessage`              | `undefined`                     | 自定义系统提示（与内置提示合并）  |
| `middleware`     | `AgentMiddleware[]`                    | `[]`                            | 自定义中间件（附加在内置之后）    |
| `subagents`      | `AnySubAgent[]`                        | `[]`                            | 子代理规范（同步、编译或异步）    |
| `responseFormat` | `SupportedResponseFormat`              | `undefined`                     | 结构化响应格式（Zod Schema 等）   |
| `contextSchema`  | `AnnotationRoot`                       | `undefined`                     | 上下文 Schema（不在调用间持久化） |
| `checkpointer`   | `BaseCheckpointSaver \| boolean`       | `undefined`                     | 状态持久化 checkpointer           |
| `store`          | `BaseStore`                            | `undefined`                     | 长期记忆 Store                    |
| `backend`        | `AnyBackendProtocol \| BackendFactory` | `StateBackend`                  | 文件操作后端                      |
| `interruptOn`    | `Record<string, InterruptOnConfig>`    | `undefined`                     | 人工审批中断配置                  |
| `name`           | `string`                               | `undefined`                     | Agent 名称                        |
| `memory`         | `string[]`                             | `undefined`                     | AGENTS.md 文件路径列表            |
| `skills`         | `string[]`                             | `undefined`                     | 技能目录路径列表                  |

---

## 内置系统提示（BASE_AGENT_PROMPT）

每个 UniverseAgent 都自动包含以下系统提示：

```
## Core Behavior
- 简洁直接，不添加不必要的开场白
- 不要说"我将要做X"，直接做
- 如果请求模糊，先问清楚再行动

## Professional Objectivity
- 准确性优先，不要只是验证用户信念
- 有礼貌地表示不同意见

## Doing Tasks
1. 先理解（读文件、检查现有模式）
2. 执行（实现方案）
3. 验证（检查是否完成了要求）

## Progress Updates
- 较长任务提供简要进度更新
```

如果用户传入 `systemPrompt`，会被**前置**合并到 `BASE_AGENT_PROMPT` 之前：

```typescript
new SystemMessage({
  contentBlocks: [
    { type: "text", text: userSystemPrompt },   // 用户提示在前
    { type: "text", text: BASE_AGENT_PROMPT },   // 内置提示在后
  ]
})
```

---

## 工具名冲突检测

函数在启动时检查用户传入的工具名是否与内置工具冲突：

```typescript
const BUILTIN_TOOL_NAMES = new Set([
  // 文件系统工具
  "ls", "read_file", "write_file", "edit_file", "glob", "grep", "execute",
  // 异步子代理工具
  "create_async_task", "check_async_task", "update_async_task", "cancel_async_task",
  // 其他内置工具
  "task",
  "write_todos",
]);
```

如果冲突，抛出 `ConfigurationError`：
```typescript
throw new ConfigurationError(
  `Tool name(s) [${collidingTools.join(", ")}] conflict with built-in tools.`,
  "TOOL_NAME_COLLISION"
);
```

---

## 子代理处理流程

### 步骤 1：分类子代理

```typescript
// 异步子代理：有 graphId 字段
const asyncSubAgents = allSubagents.filter(isAsyncSubAgent);

// 同步子代理：没有 graphId
const inlineSubagents = allSubagents.filter(!isAsyncSubAgent);
```

### 步骤 2：规范化同步子代理

每个 `SubAgent` 规范会被包装一套默认中间件：

```typescript
const normalizeSubagentSpec = (input: SubAgent): SubAgent => {
  const subagentMiddleware = [
    todoListMiddleware(),
    createFilesystemMiddleware({ backend }),
    createSummarizationMiddleware({ backend, model }),
    createPatchToolCallsMiddleware(),
    // 子代理自己的技能（如果有）
    ...(input.skills?.length ? [createSkillsMiddleware({ backend, sources: input.skills })] : []),
    // 子代理自定义中间件
    ...(input.middleware ?? []),
    // Anthropic 缓存（如适用）
    ...cacheMiddleware,
  ];
  return { ...input, middleware: subagentMiddleware };
};
```

### 步骤 3：添加通用子代理

如果用户没有提供 `general-purpose` 子代理，自动创建一个，并给它继承主 Agent 的工具和技能：

```typescript
if (!inlineSubagents.some(item => item.name === "general-purpose")) {
  const generalPurposeSpec = normalizeSubagentSpec({
    ...GENERAL_PURPOSE_SUBAGENT,
    model,
    skills,           // 继承主 Agent 的技能
    tools: tools,     // 继承主 Agent 的工具
  });
  inlineSubagents.unshift(generalPurposeSpec);  // 插入到最前
}
```

---

## 中间件组装顺序

```typescript
const middleware = [
  todoMiddleware,           // 1. TODO 列表（最先）
  ...skillsMiddleware,      // 2. 技能（在文件系统之前）
  fsMiddleware,             // 3. 文件系统工具
  subagentMiddleware,       // 4. 子代理 task 工具
  summarizationMiddleware,  // 5. 历史摘要
  patchToolCallsMiddleware, // 6. 工具调用修复
  ...(asyncSubAgents.length > 0
    ? [createAsyncSubAgentMiddleware({ asyncSubAgents })]
    : []),                  // 7. 异步子代理（可选）
  ...customMiddleware,      // 8. 用户自定义（最晚）
  ...cacheMiddleware,       // 9. Anthropic 缓存（自动）
  ...(memory?.length
    ? [createMemoryMiddleware({ backend, sources: memory, addCacheControl: anthropicModel })]
    : []),                  // 10. 记忆（可选）
  ...(interruptOn
    ? [humanInTheLoopMiddleware({ interruptOn })]
    : []),                  // 11. 人工审批（可选，最后）
];
```

---

## Anthropic 模型检测

```typescript
export function isAnthropicModel(model: BaseLanguageModel | string): boolean {
  if (typeof model === "string") {
    if (model.includes(":")) return model.split(":")[0] === "anthropic";
    return model.startsWith("claude");
  }
  if (model.getName() === "ConfigurableModel") {
    return (model as any)._defaultConfig?.modelProvider === "anthropic";
  }
  return model.getName() === "ChatAnthropic";
}
```

支持三种识别方式：
1. 字符串中含 `:` → 检查提供商前缀（`anthropic:claude-*`）
2. 字符串不含 `:` → 检查是否以 `claude` 开头
3. 对象 → 检查类名或配置中的 `modelProvider`

---

## 返回值类型

```typescript
return agent as unknown as UniverseAgent<
  UniverseAgentTypeConfig<
    InferStructuredResponse<TResponse>,  // 结构化响应类型
    undefined,                            // 状态（来自中间件）
    ContextSchema,                        // 上下文 Schema
    AllMiddleware,                        // 全部中间件（含子代理中间件）
    TTools,                               // 工具列表
    TSubagents                            // 子代理列表
  >
>;
```

`UniverseAgent` 扩展了 LangChain 的 `ReactAgent`，额外携带类型品牌 `"~universeAgentTypes"` 用于类型推断。

---

## 实际运行时配置

```typescript
const agent = createAgent({
  model,
  systemPrompt: finalSystemPrompt,
  tools: tools,
  middleware,
  responseFormat,
  contextSchema,
  checkpointer,
  store,
  name,
}).withConfig({
  recursionLimit: 10_000,   // 最大执行步数（默认 10000）
  metadata: {
    ls_integration: "universe-agent",
    lc_agent_name: name,
  },
});
```

递归限制设置为 10000 步，比 LangGraph 默认值高很多，适合长时间运行的复杂任务。

---

*[← 入口与公共API](./04-入口与公共API.md) | [类型系统 →](./06-类型系统.md)*
