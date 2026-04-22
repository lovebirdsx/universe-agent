import type {
  AgentMiddleware,
  InterruptOnConfig,
  ReactAgent,
  AgentTypeConfig,
  InferMiddlewareStates,
  ResponseFormat,
  SystemMessage,
  ResponseFormatUndefined,
  ToolStrategy,
  ProviderStrategy,
} from 'langchain';
import type { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import type { ClientTool, ServerTool, StructuredTool } from '@langchain/core/tools';
import type { BaseLanguageModel } from '@langchain/core/language_models/base';
import type { BaseCheckpointSaver, BaseStore } from '@langchain/langgraph-checkpoint';

import type { AnyBackendProtocol } from './backends/index.js';
import type { AsyncSubAgent, SubAgent } from './middleware/index.js';
import type { RecordingConfig } from './recording.js';
import type { InteropZodObject } from '@langchain/core/utils/types';
import type { AnnotationRoot } from '@langchain/langgraph';
import type { CompiledSubAgent } from './middleware/subagents.js';

// LangChain uses AnyAnnotationRoot internally but doesn't export it
// We use AnnotationRoot<any> as a compatible equivalent
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyAnnotationRoot = AnnotationRoot<any>;

/** Any subagent specification — sync, compiled, or async. */
export type AnySubAgent = SubAgent | CompiledSubAgent | AsyncSubAgent;

// TODO: import TypedToolStrategy from "langchain" once exported from the top-level entry point
// (currently only available via "langchain/dist/agents/responses.js")
interface TypedToolStrategy<T = unknown> extends Array<ToolStrategy<unknown>> {
  _schemaType?: T;
}

/**
 * Helper type to extract middleware from a SubAgent definition
 * Handles both mutable and readonly middleware arrays
 */
export type ExtractSubAgentMiddleware<T> = T extends { middleware?: infer M }
  ? M extends readonly AgentMiddleware[]
    ? M
    : M extends AgentMiddleware[]
      ? M
      : readonly []
  : readonly [];

/**
 * Helper type to flatten and merge middleware from all subagents
 */
export type FlattenSubAgentMiddleware<T extends readonly AnySubAgent[]> = T extends readonly []
  ? readonly []
  : T extends readonly [infer First, ...infer Rest]
    ? Rest extends readonly AnySubAgent[]
      ? readonly [...ExtractSubAgentMiddleware<First>, ...FlattenSubAgentMiddleware<Rest>]
      : ExtractSubAgentMiddleware<First>
    : readonly [];

/**
 * Helper type to merge states from subagent middleware
 */
export type InferSubAgentMiddlewareStates<T extends readonly AnySubAgent[]> = InferMiddlewareStates<
  FlattenSubAgentMiddleware<T>
>;

/**
 * Combined state type including custom middleware and subagent middleware states
 */
export type MergedUniverseAgentState<
  TMiddleware extends readonly AgentMiddleware[],
  TSubagents extends readonly AnySubAgent[],
> = InferMiddlewareStates<TMiddleware> & InferSubAgentMiddlewareStates<TSubagents>;

/**
 * Union of all response format types accepted by `createUniverseAgent`.
 *
 * Matches the formats supported by LangChain's `createAgent`:
 * - `ToolStrategy<T>` — from `ToolStrategy.fromSchema(schema)`
 * - `ProviderStrategy<T>` — from `providerStrategy(schema)`
 * - `TypedToolStrategy<T>` — from `toolStrategy(schema)`
 * - `ResponseFormat` — the base union of the above single-strategy types
 */
export type SupportedResponseFormat = ResponseFormat | TypedToolStrategy<unknown>;

/**
 * Utility type to extract the parsed response type from a ResponseFormat strategy.
 *
 * Maps `ToolStrategy<T>`, `ProviderStrategy<T>`, and `TypedToolStrategy<T>` to `T`
 * (the parsed output type), so that `structuredResponse` is correctly typed as the
 * schema's inferred type rather than the strategy wrapper.
 *
 * When no `responseFormat` is provided (i.e. `T` defaults to the full
 * `SupportedResponseFormat` union), this resolves to `ResponseFormatUndefined` so
 * that `structuredResponse` is excluded from the agent's output state.
 *
 * @example
 * ```typescript
 * type T1 = InferStructuredResponse<ToolStrategy<{ city: string }>>; // { city: string }
 * type T2 = InferStructuredResponse<ProviderStrategy<{ answer: string }>>; // { answer: string }
 * type T3 = InferStructuredResponse<TypedToolStrategy<{ city: string }>>; // { city: string }
 * type T4 = InferStructuredResponse<SupportedResponseFormat>; // ResponseFormatUndefined (default/unset)
 * ```
 */
export type InferStructuredResponse<T extends SupportedResponseFormat> =
  SupportedResponseFormat extends T
    ? ResponseFormatUndefined
    : T extends TypedToolStrategy<infer U>
      ? U
      : T extends ToolStrategy<infer U>
        ? U
        : T extends ProviderStrategy<infer U>
          ? U
          : ResponseFormatUndefined;

/**
 * Type bag that extends AgentTypeConfig with subagent type information.
 *
 * This interface bundles all the generic type parameters used throughout the universe agent system
 * including subagent types for type-safe streaming and delegation.
 *
 * @typeParam TResponse - The structured response type when using `responseFormat`.
 * @typeParam TState - The custom state schema type.
 * @typeParam TContext - The context schema type.
 * @typeParam TMiddleware - The middleware array type.
 * @typeParam TTools - The combined tools type.
 * @typeParam TSubagents - The subagents array type for type-safe streaming.
 *
 * @example
 * ```typescript
 * const agent = createUniverseAgent({
 *   middleware: [ResearchMiddleware],
 *   subagents: [
 *     { name: "researcher", description: "...", middleware: [CounterMiddleware] }
 *   ] as const,
 * });
 *
 * // Type inference for streaming
 * type Types = InferUniverseAgentType<typeof agent, "Subagents">;
 * ```
 */
export interface UniverseAgentTypeConfig<
  TResponse extends Record<string, unknown> | ResponseFormatUndefined =
    | Record<string, unknown>
    | ResponseFormatUndefined,
  TState extends AnyAnnotationRoot | InteropZodObject | undefined =
    | AnyAnnotationRoot
    | InteropZodObject
    | undefined,
  TContext extends AnyAnnotationRoot | InteropZodObject = AnyAnnotationRoot | InteropZodObject,
  TMiddleware extends readonly AgentMiddleware[] = readonly AgentMiddleware[],
  TTools extends readonly (ClientTool | ServerTool)[] = readonly (ClientTool | ServerTool)[],
  TSubagents extends readonly AnySubAgent[] = readonly AnySubAgent[],
> extends AgentTypeConfig<TResponse, TState, TContext, TMiddleware, TTools> {
  /** The subagents array type for type-safe streaming */
  Subagents: TSubagents;
}

/**
 * Default type configuration for universe agents.
 * Used when no explicit type parameters are provided.
 */
export interface DefaultUniverseAgentTypeConfig extends UniverseAgentTypeConfig {
  Response: Record<string, unknown>;
  State: undefined;
  Context: AnyAnnotationRoot;
  Middleware: readonly AgentMiddleware[];
  Tools: readonly (ClientTool | ServerTool)[];
  Subagents: readonly AnySubAgent[];
}

/**
 * UniverseAgent extends ReactAgent with additional subagent type information.
 *
 * This type wraps ReactAgent but includes the UniverseAgentTypeConfig which
 * contains subagent types for type-safe streaming and delegation.
 *
 * @typeParam TTypes - The UniverseAgentTypeConfig containing all type parameters
 *
 * @example
 * ```typescript
 * const agent: UniverseAgent<UniverseAgentTypeConfig<...>> = createUniverseAgent({ ... });
 *
 * // Access subagent types for streaming
 * type Subagents = InferUniverseAgentSubagents<typeof agent>;
 * ```
 */
export type UniverseAgent<TTypes extends UniverseAgentTypeConfig = UniverseAgentTypeConfig> =
  ReactAgent<TTypes> & {
    /** Type brand for UniverseAgent type inference */
    readonly '~universeAgentTypes': TTypes;
  };

/**
 * Helper type to resolve a UniverseAgentTypeConfig from either:
 * - A UniverseAgentTypeConfig directly
 * - A UniverseAgent instance (using `typeof agent`)
 *
 * @example
 * ```typescript
 * const agent = createUniverseAgent({ ... });
 * type Types = ResolveUniverseAgentTypeConfig<typeof agent>;
 * ```
 */
export type ResolveUniverseAgentTypeConfig<T> = T extends {
  '~universeAgentTypes': infer Types;
}
  ? Types extends UniverseAgentTypeConfig
    ? Types
    : never
  : T extends UniverseAgentTypeConfig
    ? T
    : never;

/**
 * Helper type to extract any property from a UniverseAgentTypeConfig or UniverseAgent.
 *
 * @typeParam T - The UniverseAgentTypeConfig or UniverseAgent to extract from
 * @typeParam K - The property key to extract
 *
 * @example
 * ```typescript
 * const agent = createUniverseAgent({ subagents: [...] });
 * type Subagents = InferUniverseAgentType<typeof agent, "Subagents">;
 * ```
 */
export type InferUniverseAgentType<
  T,
  K extends keyof UniverseAgentTypeConfig,
> = ResolveUniverseAgentTypeConfig<T>[K];

/**
 * Shorthand helper to extract the Subagents type from a UniverseAgentTypeConfig or UniverseAgent.
 *
 * @example
 * ```typescript
 * const agent = createUniverseAgent({ subagents: [subagent1, subagent2] });
 * type Subagents = InferUniverseAgentSubagents<typeof agent>;
 * ```
 */
export type InferUniverseAgentSubagents<T> = InferUniverseAgentType<T, 'Subagents'>;

/**
 * Helper type to extract CompiledSubAgent (subagents with `runnable`) from a UniverseAgent.
 * Uses Extract to filter for subagents that have a `runnable` property.
 *
 * @example
 * ```typescript
 * const agent = createUniverseAgent({ subagents: [subagent1, compiledSubagent] });
 * type CompiledSubagents = InferCompiledSubagents<typeof agent>;
 * // Result: the subagent type that has `runnable` property
 * ```
 */
export type InferCompiledSubagents<T> = Extract<
  InferUniverseAgentSubagents<T>[number],
  { runnable: unknown }
>;

/**
 * Helper type to extract SubAgent (subagents with `middleware`) from a UniverseAgent.
 * Uses Extract to filter for subagents that have a `middleware` property but no `runnable`.
 *
 * @example
 * ```typescript
 * const agent = createUniverseAgent({ subagents: [subagent1, compiledSubagent] });
 * type RegularSubagents = InferRegularSubagents<typeof agent>;
 * // Result: the subagent type that has `middleware` property
 * ```
 */
export type InferRegularSubagents<T> = Exclude<
  InferUniverseAgentSubagents<T>[number],
  { runnable: unknown }
>;

/**
 * Helper type to extract a subagent by name from a UniverseAgent.
 *
 * @typeParam T - The UniverseAgent to extract from
 * @typeParam TName - The name of the subagent to extract
 *
 * @example
 * ```typescript
 * const agent = createUniverseAgent({
 *   subagents: [
 *     { name: "researcher", description: "...", middleware: [ResearchMiddleware] }
 *   ] as const,
 * });
 *
 * type ResearcherAgent = InferSubagentByName<typeof agent, "researcher">;
 * ```
 */
export type InferSubagentByName<T, TName extends string> =
  InferUniverseAgentSubagents<T> extends readonly (infer SA)[]
    ? SA extends { name: TName }
      ? SA
      : never
    : never;

/**
 * Helper type to extract the ReactAgent type from a subagent definition.
 * This is useful for type-safe streaming of subagent events.
 *
 * @typeParam TSubagent - The subagent definition
 *
 * @example
 * ```typescript
 * type SubagentMiddleware = ExtractSubAgentMiddleware<typeof subagent>;
 * type SubagentState = InferMiddlewareStates<SubagentMiddleware>;
 * ```
 */
export type InferSubagentReactAgentType<TSubagent extends SubAgent | CompiledSubAgent> =
  TSubagent extends CompiledSubAgent
    ? TSubagent['runnable']
    : TSubagent extends SubAgent
      ? ReactAgent<
          AgentTypeConfig<
            ResponseFormatUndefined,
            undefined,
            AnyAnnotationRoot,
            ExtractSubAgentMiddleware<TSubagent>,
            readonly []
          >
        >
      : never;

export interface ObservabilityConfig {
  sessionId?: string;
  userId?: string;
  tags?: string[];
  version?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Configuration parameters for creating a Universe Agent
 * Matches Python's create_universe_agent parameters
 *
 * @typeParam TResponse - The structured response type when using responseFormat
 * @typeParam ContextSchema - The context schema type
 * @typeParam TMiddleware - The middleware array type for proper type inference
 * @typeParam TSubagents - The subagents array type for extracting subagent middleware states
 * @typeParam TTools - The tools array type
 */
export interface CreateUniverseAgentParams<
  TResponse extends SupportedResponseFormat = SupportedResponseFormat,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ContextSchema extends AnnotationRoot<any> | InteropZodObject = AnnotationRoot<any>,
  TMiddleware extends readonly AgentMiddleware[] = readonly AgentMiddleware[],
  TSubagents extends readonly AnySubAgent[] = readonly AnySubAgent[],
  TTools extends readonly (ClientTool | ServerTool)[] = readonly (ClientTool | ServerTool)[],
> {
  /** The model to use (model name string or LanguageModelLike instance). Defaults to claude-sonnet-4-5-20250929 */
  model?: BaseLanguageModel | string;
  /** Tools the agent should have access to */
  tools?: TTools | StructuredTool[];
  /** Custom system prompt for the agent. This will be combined with the base agent prompt */
  systemPrompt?: string | SystemMessage;
  /** Custom middleware to apply after standard middleware */
  middleware?: TMiddleware;
  /**
   * List of subagent specifications for task delegation.
   *
   * Supports sync SubAgents, CompiledSubAgents, and AsyncSubAgents in the same array.
   * AsyncSubAgents (identified by their `graphId` field) are automatically separated
   * at runtime and wired to the async SubAgent middleware.
   */
  subagents?: TSubagents;
  /** Structured output response format for the agent (Zod schema or other format) */
  responseFormat?: TResponse;
  /** Optional schema for context (not persisted between invocations) */
  contextSchema?: ContextSchema;
  /** Optional checkpointer for persisting agent state between runs */
  checkpointer?: BaseCheckpointSaver | boolean;
  /** Optional store for persisting longterm memories */
  store?: BaseStore;
  /**
   * Optional backend for filesystem operations.
   * Can be either a backend instance or a factory function that creates one.
   * The factory receives a config object with state and store.
   */
  backend?:
    | AnyBackendProtocol
    | ((config: { state: unknown; store?: BaseStore }) => AnyBackendProtocol);
  /** Optional interrupt configuration mapping tool names to interrupt configs */
  interruptOn?: Record<string, boolean | InterruptOnConfig>;
  /** The name of the agent */
  name?: string;
  /**
   * Optional list of memory file paths (AGENTS.md files) to load
   * (e.g., ["~/.universe-agent/AGENTS.md", "./.universe-agent/AGENTS.md"]).
   * Display names are automatically derived from paths.
   * Memory is loaded at agent startup and added into the system prompt.
   */
  memory?: string[];
  /**
   * Optional list of skill source paths (e.g., `["/skills/user/", "/skills/project/"]`).
   *
   * Paths use POSIX conventions (forward slashes) and are relative to the backend's root.
   * Later sources override earlier ones for skills with the same name (last one wins).
   *
   * @example
   * ```typescript
   * // With FilesystemBackend - skills loaded from disk
   * const agent = await createUniverseAgent({
   *   backend: new FilesystemBackend({ rootDir: "/home/user/.universe-agent" }),
   *   skills: ["/skills/"],
   * });
   *
   * // With StateBackend - skills provided in state
   * const agent = await createUniverseAgent({
   *   skills: ["/skills/"],
   * });
   * const result = await agent.invoke({
   *   messages: [...],
   *   files: {
   *     "/skills/my-skill/SKILL.md": {
   *       content: ["---", "name: my-skill", "description: ...", "---", "# My Skill"],
   *       created_at: new Date().toISOString(),
   *       modified_at: new Date().toISOString(),
   *     },
   *   },
   * });
   * ```
   */
  skills?: string[];
  /**
   * Optional LangChain callback handlers for observability integrations (e.g., Langfuse).
   * These are passed directly to the agent's `.withConfig({ callbacks })`.
   *
   * @example
   * ```typescript
   * import { createLangfuseHandler } from '@universe-agent/agent';
   *
   * const agent = createUniverseAgent({
   *   callbacks: [await createLangfuseHandler()],
   * });
   * ```
   */
  callbacks?: BaseCallbackHandler[];

  /**
   * 录像配置。
   * - `record`: 录制模型输出到本地文件
   * - `replay`: 从录像文件回放，使用 fakeModel 替代真实 LLM
   * - `auto`: 录像存在且完整则回放，否则录制
   */
  recording?: RecordingConfig;

  // Observability config (for internal use when creating Langfuse handlers)
  observabilityConfig?: ObservabilityConfig;
}

/**
 * Configuration for Langfuse observability integration.
 */
export interface LangfuseHandlerOptions {
  /** Session ID for grouping traces */
  sessionId?: string;
  /** User ID for attributing traces */
  userId?: string;
  /** Tags for categorizing traces */
  tags?: string[];
  /** Version for the traces */
  version?: string;
  /** Additional metadata to attach to all Langfuse traces */
  metadata?: Record<string, unknown>;
}
