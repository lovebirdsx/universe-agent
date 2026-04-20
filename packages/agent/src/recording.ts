import * as fs from 'node:fs';
import * as path from 'node:path';

import type { BaseMessage } from '@langchain/core/messages';
import {
  mapChatMessagesToStoredMessages,
  mapStoredMessagesToChatMessages,
} from '@langchain/core/messages';
import type { StoredMessage } from '@langchain/core/messages';
import { fakeModel } from '@langchain/core/testing';
import type { BaseLanguageModel } from '@langchain/core/language_models/base';
import { createMiddleware, ToolMessage } from 'langchain';
import { isCommand } from '@langchain/langgraph';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RecordingConfig {
  mode: 'record' | 'replay' | 'auto';
  /** 录像目录基路径，默认 './.data/recordings' */
  path?: string;
  /** 录像 ID，默认为 process.argv[1] 相对于 cwd 的路径 */
  id?: string;
}

export interface SequenceEntry {
  /** 条目类型：model 为 LLM 响应，tool 为工具执行结果 */
  type?: 'model' | 'tool';
  /** agent 名称（"main" 或 subagent name） */
  agent: string;
  /** 在该 agent 的 responses/toolResults 数组中的索引 */
  index: number;
  /** tool 条目专用：tool call ID，用于回放时按 ID 匹配 */
  toolCallId?: string;
}

export interface ManifestData {
  id: string;
  createdAt: string;
  completedAt?: string;
  status: 'recording' | 'completed' | 'error';
  sequence: SequenceEntry[];
}

export interface AgentRecording {
  agent: string;
  responses: StoredMessage[];
  toolResults?: StoredMessage[];
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * 将 ID 中的路径分隔符和特殊字符替换为安全的文件名字符。
 */
function sanitizeId(id: string): string {
  return id.replace(/[/\\:*?"<>|]/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * 将 agent 名称转换为安全的文件名。
 */
function sanitizeAgentName(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '-').replace(/^-+|-+$/g, '') || 'main';
}

/**
 * 解析默认 recording ID：process.argv[1] 相对于 cwd 的路径（去掉扩展名）。
 */
export function resolveDefaultId(): string {
  const scriptPath = process.argv[1];
  if (!scriptPath) return 'default';
  const relative = path.relative(process.cwd(), scriptPath);
  // 去掉扩展名
  const parsed = path.parse(relative);
  return path.join(parsed.dir, parsed.name).replace(/\\/g, '/');
}

/**
 * 解析录像目录的完整路径。
 */
export function resolveRecordingDir(config: RecordingConfig & { id: string }): string {
  const basePath = config.path ?? './.data/recordings';
  return path.resolve(basePath, sanitizeId(config.id));
}

/**
 * 获取 manifest 文件路径。
 */
function manifestPath(dirPath: string): string {
  return path.join(dirPath, 'manifest.json');
}

/**
 * 获取 agent recording 文件路径。
 */
function agentRecordingPath(dirPath: string, agentName: string): string {
  return path.join(dirPath, `${sanitizeAgentName(agentName)}.recording.json`);
}

// ---------------------------------------------------------------------------
// Mode resolution
// ---------------------------------------------------------------------------

/**
 * 解析实际生效的模式。
 * auto: manifest 存在且 status 为 completed 或 error → replay，否则 record。
 */
export function resolveEffectiveMode(
  mode: RecordingConfig['mode'],
  dirPath: string,
): 'record' | 'replay' {
  if (mode === 'record') return 'record';
  if (mode === 'replay') return 'replay';

  // auto
  const mPath = manifestPath(dirPath);
  if (!fs.existsSync(mPath)) return 'record';

  try {
    const manifest = JSON.parse(fs.readFileSync(mPath, 'utf-8')) as ManifestData;
    if (manifest.status === 'completed' || manifest.status === 'error') {
      return 'replay';
    }
  } catch {
    // 解析失败视为无效录像
  }
  return 'record';
}

// ---------------------------------------------------------------------------
// File I/O (atomic writes)
// ---------------------------------------------------------------------------

/**
 * 原子写入 JSON 文件：先写 tmp 文件，再 rename。
 */
function writeJsonAtomic(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

export function loadManifest(dirPath: string): ManifestData {
  const content = fs.readFileSync(manifestPath(dirPath), 'utf-8');
  return JSON.parse(content) as ManifestData;
}

export function loadAgentRecording(dirPath: string, agentName: string): AgentRecording {
  const filePath = agentRecordingPath(dirPath, agentName);
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content) as AgentRecording;
}

// ---------------------------------------------------------------------------
// Recorder (data collector for record mode)
// ---------------------------------------------------------------------------

export class Recorder {
  readonly responses = new Map<string, StoredMessage[]>();
  readonly toolResults = new Map<string, StoredMessage[]>();
  readonly sequence: SequenceEntry[] = [];

  /**
   * 记录一条模型输出。
   */
  record(agentName: string, message: BaseMessage): void {
    const stored = mapChatMessagesToStoredMessages([message]);
    const first = stored[0];
    if (!first) return;

    let agentResponses = this.responses.get(agentName);
    if (!agentResponses) {
      agentResponses = [];
      this.responses.set(agentName, agentResponses);
    }

    const index = agentResponses.length;
    agentResponses.push(first);
    this.sequence.push({ type: 'model', agent: agentName, index });
  }

  /**
   * 记录一条工具执行结果。
   */
  recordToolResult(agentName: string, message: BaseMessage, toolCallId: string): void {
    const stored = mapChatMessagesToStoredMessages([message]);
    const first = stored[0];
    if (!first) return;

    let agentToolResults = this.toolResults.get(agentName);
    if (!agentToolResults) {
      agentToolResults = [];
      this.toolResults.set(agentName, agentToolResults);
    }

    const index = agentToolResults.length;
    agentToolResults.push(first);
    this.sequence.push({ type: 'tool', agent: agentName, index, toolCallId });
  }

  /**
   * 将收集的数据写入录像目录。
   */
  flush(dirPath: string, id: string, status: ManifestData['status']): void {
    const manifest: ManifestData = {
      id,
      createdAt: new Date().toISOString(),
      completedAt: status !== 'recording' ? new Date().toISOString() : undefined,
      status,
      sequence: this.sequence,
    };

    writeJsonAtomic(manifestPath(dirPath), manifest);

    // 收集所有出现过的 agent 名称（包括只有 toolResults 的 agent）
    const allAgentNames = new Set([...this.responses.keys(), ...this.toolResults.keys()]);

    for (const agentName of allAgentNames) {
      const storedMessages = this.responses.get(agentName) ?? [];
      const storedToolResults = this.toolResults.get(agentName) ?? [];
      const recording: AgentRecording = {
        agent: agentName,
        responses: storedMessages,
        ...(storedToolResults.length > 0 ? { toolResults: storedToolResults } : {}),
      };
      writeJsonAtomic(agentRecordingPath(dirPath, agentName), recording);
    }
  }
}

// ---------------------------------------------------------------------------
// Recording Model (Proxy-based wrapper for record mode)
// ---------------------------------------------------------------------------

/**
 * 用 Proxy 包装模型，拦截 invoke 调用以录制输出。
 *
 * 采用 Proxy 方式是因为 LangChain model 的 bind/bindTools/withConfig 会返回
 * RunnableBinding 等包装类型，继承方式难以统一处理。Proxy 可以透明地拦截所有
 * 调用链中的 invoke，同时共享同一个 Recorder 实例。
 */
export function createRecordingModel<T extends BaseLanguageModel>(
  model: T,
  recorder: Recorder,
  agentName: string = 'main',
): T {
  const handler: ProxyHandler<T> = {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      // 拦截 invoke：录制模型输出
      if (prop === 'invoke') {
        return async function recordingInvoke(this: unknown, ...args: unknown[]): Promise<unknown> {
          const result = await (value as (...a: unknown[]) => Promise<unknown>).apply(target, args);
          // result 是 BaseMessage（AIMessage）
          if (result && typeof result === 'object' && 'content' in result) {
            // 从 config 中尝试获取 agent name
            const config = args[1] as Record<string, unknown> | undefined;
            const name = resolveAgentName(config, agentName);
            recorder.record(name, result as BaseMessage);
          }
          return result;
        };
      }

      // 对 bind/bindTools/withConfig 返回的新模型也包装 Proxy
      if (
        (prop === 'bind' || prop === 'bindTools' || prop === 'withConfig') &&
        typeof value === 'function'
      ) {
        return function wrappedChain(this: unknown, ...args: unknown[]): unknown {
          const newModel = (value as (...a: unknown[]) => unknown).apply(target, args);
          if (newModel && typeof newModel === 'object') {
            return createRecordingModel(
              newModel as BaseLanguageModel,
              recorder,
              agentName,
            ) as unknown;
          }
          return newModel;
        };
      }

      return value;
    },
  };

  return new Proxy(model, handler);
}

/**
 * 从调用 config 中提取 agent name。
 */
function resolveAgentName(config: Record<string, unknown> | undefined, fallback: string): string {
  if (!config) return fallback;
  const metadata = config.metadata as Record<string, unknown> | undefined;
  if (metadata?.lc_agent_name && typeof metadata.lc_agent_name === 'string') {
    return metadata.lc_agent_name;
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Replay (build fakeModel from recording)
// ---------------------------------------------------------------------------

/**
 * 从录像目录构建 fakeModel，按全局 sequence 顺序填充响应队列。
 * 只处理 type === 'model'（或无 type 字段的旧录像）的条目。
 */
export function buildReplayModel(dirPath: string): BaseLanguageModel {
  const manifest = loadManifest(dirPath);

  // 按 agent 加载所有录像
  const agentNames = [...new Set(manifest.sequence.map((s) => s.agent))];
  const agentRecordings = new Map<string, BaseMessage[]>();

  for (const name of agentNames) {
    try {
      const recording = loadAgentRecording(dirPath, name);
      const messages = mapStoredMessagesToChatMessages(recording.responses);
      agentRecordings.set(name, messages);
    } catch {
      agentRecordings.set(name, []);
    }
  }

  // 按 sequence 顺序构建 fakeModel（只包含 model 条目）
  const model = fakeModel();
  for (const entry of manifest.sequence) {
    if (entry.type === 'tool') continue;
    const messages = agentRecordings.get(entry.agent);
    const message = messages?.[entry.index];
    if (message) {
      model.respond(message);
    }
  }

  // Fix: FakeBuiltModel.bindTools 每次创建新实例并**值拷贝** _callIndex，
  // 导致 agent 每步调用 bindTools 时计数器被重置为 0，回放永远返回第一条录像。
  // 直接覆写 bindTools，返回 model.withConfig({}) 创建的 RunnableBinding，
  // 这样所有 binding 共享同一个 model 实例和 _callIndex。
  const originalWithConfig = model.withConfig.bind(model);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (model as any).bindTools = () => originalWithConfig({});

  return model as unknown as BaseLanguageModel;
}

// ---------------------------------------------------------------------------
// Tool Result Loading (for replay mode)
// ---------------------------------------------------------------------------

/**
 * 从录像目录加载所有 tool results，返回按 toolCallId 索引的 Map。
 * 用于回放模式下跳过真实 tool 执行。
 */
export function loadToolResults(dirPath: string): Map<string, BaseMessage> {
  const manifest = loadManifest(dirPath);
  const result = new Map<string, BaseMessage>();

  const agentNames = [
    ...new Set(manifest.sequence.filter((s) => s.type === 'tool').map((s) => s.agent)),
  ];
  const agentToolResults = new Map<string, BaseMessage[]>();

  for (const name of agentNames) {
    try {
      const recording = loadAgentRecording(dirPath, name);
      if (recording.toolResults && recording.toolResults.length > 0) {
        const messages = mapStoredMessagesToChatMessages(recording.toolResults);
        agentToolResults.set(name, messages);
      }
    } catch {
      // Agent recording 不存在或无 toolResults
    }
  }

  for (const entry of manifest.sequence) {
    if (entry.type !== 'tool' || !entry.toolCallId) continue;
    const messages = agentToolResults.get(entry.agent);
    const message = messages?.[entry.index];
    if (message) {
      result.set(entry.toolCallId, message);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Tool Recording Middleware (record mode)
// ---------------------------------------------------------------------------

/**
 * 创建录制模式下的 tool 中间件。
 * 拦截所有 tool 调用，执行后将 ToolMessage 结果录制到 Recorder。
 */
export function createToolRecordingMiddleware({
  recorder,
  agentName = 'main',
}: {
  recorder: Recorder;
  agentName?: string;
}) {
  return createMiddleware({
    name: 'ToolRecordingMiddleware',
    wrapToolCall: async (request, handler) => {
      const result = await handler(request);
      const toolCallId = request.toolCall?.id;

      if (ToolMessage.isInstance(result) && toolCallId) {
        recorder.recordToolResult(agentName, result, toolCallId);
      } else if (isCommand(result) && toolCallId) {
        // Command may contain ToolMessage(s) in its update.messages
        const update = result.update as Record<string, unknown> | undefined;
        const updateMessages = Array.isArray(update?.messages) ? update.messages : [];
        for (const msg of updateMessages) {
          if (ToolMessage.isInstance(msg)) {
            recorder.recordToolResult(agentName, msg, toolCallId);
            break; // 每个 tool call 只录制一条
          }
        }
      }

      return result;
    },
  });
}

// ---------------------------------------------------------------------------
// Tool Replay Middleware (replay mode)
// ---------------------------------------------------------------------------

/**
 * 创建回放模式下的 tool 中间件。
 * 根据 toolCallId 匹配录制的 ToolMessage，跳过真实 tool 执行。
 * 如果找不到录制结果（旧格式录像），则抛出错误。
 */
export function createToolReplayMiddleware({
  toolResults,
}: {
  toolResults: Map<string, BaseMessage>;
}) {
  return createMiddleware({
    name: 'ToolReplayMiddleware',
    wrapToolCall: async (request) => {
      const toolCallId = request.toolCall?.id;
      if (toolCallId) {
        const recorded = toolResults.get(toolCallId);
        if (recorded) {
          return recorded as ToolMessage;
        }
      }

      // 回退：录像中无此 tool call 的结果，报错
      throw new Error(`No recorded tool result found for tool call ID: ${toolCallId}`);
    },
  });
}
