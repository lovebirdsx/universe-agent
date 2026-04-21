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
import type { FunctionDefinition } from '@langchain/core/language_models/base';
import { convertToOpenAIFunction } from '@langchain/core/utils/function_calling';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { createMiddleware, ToolMessage } from 'langchain';
import { isCommand } from '@langchain/langgraph';

// ---------------------------------------------------------------------------
// Version constants
// ---------------------------------------------------------------------------

/** 当前视图版本号 —— 格式变更但不影响回放时递增 */
export const CURRENT_VIEW_VERSION = 1;
/** 当前录像版本号 —— 不兼容变更时递增，版本不匹配的录像无法回放 */
export const CURRENT_RECORDING_VERSION = 1;

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
  /** 在该 agent 的 turns 数组中对应类型条目的索引 */
  index: number;
  /** tool 条目专用：tool call ID，用于回放时按 ID 匹配 */
  toolCallId?: string;
}

export interface ManifestData {
  /** 视图版本号 —— 格式变更但不影响回放 */
  viewVersion: number;
  /** 录像版本号 —— 版本不匹配的录像无法回放 */
  recordingVersion: number;
  id: string;
  createdAt: string;
  completedAt?: string;
  status: 'recording' | 'completed' | 'error';
  sequence: SequenceEntry[];
}

// ---------------------------------------------------------------------------
// Turn-based recording types (V2)
// ---------------------------------------------------------------------------

export interface ModelTurn {
  type: 'model';
  index: number;
  /** 增量请求消息：本次新增的消息（首次调用包含完整历史） */
  request: StoredMessage[];
  /** 完整输入的消息总数 */
  requestTotalLength: number;
  /** 模型响应 */
  response: StoredMessage;
}

export interface ToolTurn {
  type: 'tool';
  index: number;
  toolCallId: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  /** 工具执行结果 */
  result: StoredMessage;
}

export type Turn = ModelTurn | ToolTurn;

/** 序列化后的工具定义（OpenAI function calling 格式） */
export type SerializedToolDefinition = FunctionDefinition;

export interface AgentRecording {
  version: 2;
  agent: string;
  /** 该 agent 绑定的工具定义列表 */
  tools?: SerializedToolDefinition[];
  turns: Turn[];
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
      // 录像版本号不匹配时重新录制
      if (manifest.recordingVersion !== CURRENT_RECORDING_VERSION) return 'record';
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

/**
 * 原子写入文本文件。
 */
function writeTextAtomic(filePath: string, text: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, text, 'utf-8');
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

  /** 每个 agent 的请求增量数组（每次 model 调用的新增消息） */
  readonly requests = new Map<string, StoredMessage[][]>();
  /** 每次调用的完整输入长度 */
  readonly requestLengths = new Map<string, number[]>();
  /** 追踪上次输入长度（用于计算增量） */
  private readonly lastInputLength = new Map<string, number>();

  /** 工具名称，按 agent 和 index 索引 */
  readonly toolNames = new Map<string, (string | undefined)[]>();
  /** 工具参数，按 agent 和 index 索引 */
  readonly toolArgs = new Map<string, (Record<string, unknown> | undefined)[]>();

  /** 每个 agent 绑定的工具定义（序列化后） */
  readonly agentTools = new Map<string, SerializedToolDefinition[]>();

  /**
   * 注册 agent 的工具列表，序列化为 OpenAI function 格式用于录像。
   */
  registerTools(agentName: string, tools: StructuredToolInterface[]): void {
    const serialized = tools.map((t) => convertToOpenAIFunction(t));
    this.agentTools.set(agentName, serialized);
  }

  /**
   * 记录一条模型输出及其输入。
   */
  record(agentName: string, message: BaseMessage, inputMessages?: BaseMessage[]): void {
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

    // 记录请求增量
    if (inputMessages) {
      const rawLastLen = this.lastInputLength.get(agentName) ?? 0;
      // 当消息列表长度小于等于上次记录长度时（例如新 thread/会话），
      // 重置为 0 以记录完整输入，防止 slice 越界返回空数组。
      const lastLen = inputMessages.length <= rawLastLen ? 0 : rawLastLen;
      const delta = inputMessages.slice(lastLen);
      const storedDelta = mapChatMessagesToStoredMessages(delta);

      let agentRequests = this.requests.get(agentName);
      if (!agentRequests) {
        agentRequests = [];
        this.requests.set(agentName, agentRequests);
      }
      agentRequests.push(storedDelta);

      let agentLengths = this.requestLengths.get(agentName);
      if (!agentLengths) {
        agentLengths = [];
        this.requestLengths.set(agentName, agentLengths);
      }
      agentLengths.push(inputMessages.length);

      this.lastInputLength.set(agentName, inputMessages.length);
    } else {
      // 无输入消息时记录空增量
      let agentRequests = this.requests.get(agentName);
      if (!agentRequests) {
        agentRequests = [];
        this.requests.set(agentName, agentRequests);
      }
      agentRequests.push([]);

      let agentLengths = this.requestLengths.get(agentName);
      if (!agentLengths) {
        agentLengths = [];
        this.requestLengths.set(agentName, agentLengths);
      }
      agentLengths.push(0);
    }

    this.sequence.push({ type: 'model', agent: agentName, index });
  }

  /**
   * 记录一条工具执行结果。
   */
  recordToolResult(
    agentName: string,
    message: BaseMessage,
    toolCallId: string,
    toolName?: string,
    toolArgs?: Record<string, unknown>,
  ): void {
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

    // 记录工具元数据
    let names = this.toolNames.get(agentName);
    if (!names) {
      names = [];
      this.toolNames.set(agentName, names);
    }
    names.push(toolName);

    let args = this.toolArgs.get(agentName);
    if (!args) {
      args = [];
      this.toolArgs.set(agentName, args);
    }
    args.push(toolArgs);

    this.sequence.push({ type: 'tool', agent: agentName, index, toolCallId });
  }

  /**
   * 将收集的数据写入录像目录。
   */
  flush(dirPath: string, id: string, status: ManifestData['status']): void {
    const manifest: ManifestData = {
      viewVersion: CURRENT_VIEW_VERSION,
      recordingVersion: CURRENT_RECORDING_VERSION,
      id,
      createdAt: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
      completedAt:
        status !== 'recording'
          ? new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
          : undefined,
      status,
      sequence: this.sequence,
    };

    writeJsonAtomic(manifestPath(dirPath), manifest);

    // 收集所有出现过的 agent 名称
    const allAgentNames = new Set([...this.responses.keys(), ...this.toolResults.keys()]);

    // 按 agent 构建 turns 数组
    const agentTurns = new Map<string, Turn[]>();
    for (const agentName of allAgentNames) {
      agentTurns.set(agentName, []);
    }

    for (const entry of this.sequence) {
      const turns = agentTurns.get(entry.agent);
      if (!turns) continue;

      if (entry.type === 'tool') {
        const storedResult = this.toolResults.get(entry.agent)?.[entry.index];
        if (storedResult) {
          const toolName = this.toolNames.get(entry.agent)?.[entry.index];
          const toolArgsVal = this.toolArgs.get(entry.agent)?.[entry.index];
          const turn: ToolTurn = {
            type: 'tool',
            index: entry.index,
            toolCallId: entry.toolCallId ?? '',
            ...(toolName !== undefined ? { toolName } : {}),
            ...(toolArgsVal !== undefined ? { toolArgs: toolArgsVal } : {}),
            result: storedResult,
          };
          turns.push(turn);
        }
      } else {
        // model
        const storedResponse = this.responses.get(entry.agent)?.[entry.index];
        if (storedResponse) {
          const request = this.requests.get(entry.agent)?.[entry.index] ?? [];
          const requestTotalLength = this.requestLengths.get(entry.agent)?.[entry.index] ?? 0;
          const turn: ModelTurn = {
            type: 'model',
            index: entry.index,
            request,
            requestTotalLength,
            response: storedResponse,
          };
          turns.push(turn);
        }
      }
    }

    // 写入各 agent 的录像文件
    for (const agentName of allAgentNames) {
      const turns = agentTurns.get(agentName) ?? [];
      const tools = this.agentTools.get(agentName);
      const recording: AgentRecording = {
        version: 2,
        agent: agentName,
        ...(tools !== undefined && tools.length > 0 ? { tools } : {}),
        turns,
      };
      writeJsonAtomic(agentRecordingPath(dirPath, agentName), recording);
    }

    // 生成 transcript.md
    this.flushTranscript(dirPath, id, status, manifest, agentTurns);
  }

  /**
   * 生成可读的 Markdown 对话记录。
   */
  private flushTranscript(
    dirPath: string,
    id: string,
    status: string,
    manifest: ManifestData,
    agentTurns: Map<string, Turn[]>,
  ): void {
    writeTranscript(dirPath, id, status, manifest, this.sequence, agentTurns, this.agentTools);
  }
}

/**
 * 核心 transcript 写入逻辑，供 Recorder.flushTranscript 和 generateTranscript 复用。
 */
function writeTranscript(
  dirPath: string,
  id: string,
  status: string,
  manifest: ManifestData,
  sequence: SequenceEntry[],
  agentTurns: Map<string, Turn[]>,
  agentTools: Map<string, SerializedToolDefinition[]>,
): void {
  const lines: string[] = [];
  lines.push(`# Recording: ${id}`);
  lines.push(
    `Status: ${status} | ${manifest.createdAt} | viewVersion: ${manifest.viewVersion} | recordingVersion: ${manifest.recordingVersion}`,
  );
  lines.push('');

  // 输出各 agent 的工具声明
  for (const [agentName] of agentTurns) {
    const tools = agentTools.get(agentName);
    if (!tools || tools.length === 0) continue;

    lines.push(`## 🛠️ [${agentName}] Tools (${tools.length})`);
    lines.push('');
    for (const tool of tools) {
      lines.push(`### \`${tool.name}\``);
      lines.push('');
      if (tool.description) {
        lines.push('````markdown');
        lines.push(tool.description);
        lines.push('````');
        lines.push('');
      }
      if (tool.parameters) {
        lines.push('```json');
        lines.push(JSON.stringify(tool.parameters, null, 2));
        lines.push('```');
        lines.push('');
      }
    }
  }

  // 按全局 sequence 顺序输出
  const agentTurnIndex = new Map<string, number>();

  for (const entry of sequence) {
    const agentKey = entry.agent;
    const turnIdx = agentTurnIndex.get(agentKey) ?? 0;
    const turns = agentTurns.get(agentKey);
    const turn = turns?.[turnIdx];
    if (!turn) continue;
    agentTurnIndex.set(agentKey, turnIdx + 1);

    lines.push('---');
    lines.push('');

    if (turn.type === 'model') {
      lines.push(`## 🤖 [${agentKey}] Model #${turn.index}`);
      lines.push('');

      const requestMessages = mapStoredMessagesToChatMessages(turn.request);
      const newCount = requestMessages.length;
      const totalCount = turn.requestTotalLength;
      if (turn.index === 0) {
        lines.push(`### Input (${newCount} messages, total context: ${totalCount})`);
      } else {
        lines.push(`### Input (${newCount} new messages, total context: ${totalCount})`);
      }
      lines.push('');
      for (const msg of requestMessages) {
        const roleHeading = formatRoleHeading(msg._getType());
        lines.push(`#### ${roleHeading}`);
        lines.push('');
        lines.push(...formatMessageContent(msg.content));
        lines.push('');
      }

      lines.push('### Output');
      lines.push('');
      const responseMessages = mapStoredMessagesToChatMessages([turn.response]);
      const responseMsg = responseMessages[0];
      if (responseMsg) {
        lines.push('#### 🤖 AI');
        lines.push('');
        lines.push(...formatMessageContent(responseMsg.content));
        lines.push('');
        if (
          'tool_calls' in responseMsg &&
          Array.isArray(responseMsg.tool_calls) &&
          responseMsg.tool_calls.length > 0
        ) {
          lines.push('**Tool calls:**');
          lines.push('');
          for (const tc of responseMsg.tool_calls as Array<{ name: string; args: unknown }>) {
            lines.push(`- \`${tc.name}\``);
            lines.push('');
            lines.push('```json');
            lines.push(JSON.stringify(tc.args, null, 2));
            lines.push('```');
            lines.push('');
          }
        }
      }
    } else {
      // tool turn
      const toolLabel = turn.toolName ? turn.toolName : 'tool';
      lines.push(`## 🔧 [${agentKey}] ${toolLabel} #${turn.index}`);
      lines.push('');
      if (turn.toolArgs !== undefined) {
        lines.push('### Input');
        lines.push('');
        lines.push('```json');
        lines.push(JSON.stringify(turn.toolArgs, null, 2));
        lines.push('```');
        lines.push('');
      }

      const resultMessages = mapStoredMessagesToChatMessages([turn.result]);
      const resultMsg = resultMessages[0];
      if (resultMsg) {
        const content =
          typeof resultMsg.content === 'string'
            ? resultMsg.content
            : JSON.stringify(resultMsg.content, null, 2);
        lines.push('### Output');
        lines.push('');
        lines.push('```');
        lines.push(content);
        lines.push('```');
        lines.push('');
      }
    }
  }

  const transcriptPath = path.join(dirPath, 'transcript.md');
  writeTextAtomic(transcriptPath, lines.join('\n'));
}

/**
 * 将消息类型转换为带 emoji 的角色标题文本（不含 # 前缀）。
 */
function formatRoleHeading(type: string): string {
  switch (type) {
    case 'system':
      return '⚙️ System';
    case 'human':
      return '👤 User';
    case 'ai':
      return '🤖 AI';
    case 'tool':
      return '🔧 Tool';
    default:
      return type;
  }
}

/**
 * Content block 的可能类型。
 */
interface ContentBlock {
  type: string;
  text?: string;
  image_url?: { url: string };
  source?: { type: string; media_type?: string; data?: string };
  [key: string]: unknown;
}

/**
 * 将消息内容格式化为可读的 Markdown 行。
 * - string 内容用 markdown 代码块包裹，避免消息中的 markdown 污染整体格式。
 * - content block 数组按块编号输出（`#####` 层级），每块内容也用代码块包裹。
 */
function formatMessageContent(content: string | unknown[]): string[] {
  if (typeof content === 'string') {
    if (!content) return [];
    return ['````markdown', content, '````'];
  }

  if (!Array.isArray(content) || content.length === 0) {
    return [];
  }

  // 单个 text block 不编号，直接输出
  if (
    content.length === 1 &&
    typeof content[0] === 'object' &&
    content[0] !== null &&
    (content[0] as ContentBlock).type === 'text'
  ) {
    const text = (content[0] as ContentBlock).text ?? '';
    if (!text) return [];
    return ['````markdown', text, '````'];
  }

  // 多个 block，编号输出
  const lines: string[] = [];
  for (let i = 0; i < content.length; i++) {
    const block = content[i] as ContentBlock;
    if (typeof block !== 'object' || block === null) {
      lines.push(`##### ${i + 1}. \`${JSON.stringify(block)}\``);
      lines.push('');
      continue;
    }

    const blockType = block.type ?? 'unknown';

    if (blockType === 'text') {
      const text = block.text ?? '';
      lines.push(`##### ${i + 1}. text`);
      lines.push('');
      lines.push('````markdown');
      lines.push(text);
      lines.push('````');
      lines.push('');
    } else if (blockType === 'image_url') {
      lines.push(`##### ${i + 1}. image`);
      lines.push('');
      const url = block.image_url?.url ?? '[image data]';
      if (url.startsWith('data:')) {
        lines.push(`_[inline image, ${url.length} chars]_`);
      } else {
        lines.push(`![image](${url})`);
      }
      lines.push('');
    } else if (blockType === 'tool_use') {
      lines.push(`##### ${i + 1}. tool_use — \`${block.name ?? 'unknown'}\``);
      lines.push('');
      if (block.input !== undefined) {
        lines.push('```json');
        lines.push(JSON.stringify(block.input, null, 2));
        lines.push('```');
      }
      lines.push('');
    } else if (blockType === 'tool_result') {
      lines.push(`##### ${i + 1}. tool_result`);
      lines.push('');
      const resultContent = block.content;
      if (typeof resultContent === 'string') {
        lines.push('```');
        lines.push(resultContent);
        lines.push('```');
      } else {
        lines.push('```json');
        lines.push(JSON.stringify(resultContent, null, 2));
        lines.push('```');
      }
      lines.push('');
    } else {
      // thinking, redacted_thinking, 或其他未知类型
      lines.push(`##### ${i + 1}. ${blockType}`);
      lines.push('');
      if (block.text) {
        lines.push('```');
        lines.push(block.text);
        lines.push('```');
      } else {
        const { type: _type, ...rest } = block;
        const keys = Object.keys(rest);
        if (keys.length > 0) {
          lines.push('```json');
          lines.push(JSON.stringify(rest, null, 2));
          lines.push('```');
        }
      }
      lines.push('');
    }
  }

  return lines;
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
            // 捕获输入消息
            const inputMessages = Array.isArray(args[0]) ? (args[0] as BaseMessage[]) : undefined;
            recorder.record(name, result as BaseMessage, inputMessages);
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

  if (manifest.recordingVersion !== CURRENT_RECORDING_VERSION) {
    throw new Error(
      `录像版本号不匹配：录像文件为 ${String(manifest.recordingVersion ?? '<无>')}，当前为 ${String(CURRENT_RECORDING_VERSION)}。` +
        `请使用 record 模式重新录制。`,
    );
  }

  // 按 agent 加载所有录像
  const agentNames = [...new Set(manifest.sequence.map((s) => s.agent))];
  const agentModelTurns = new Map<string, ModelTurn[]>();

  for (const name of agentNames) {
    try {
      const recording = loadAgentRecording(dirPath, name);
      const modelTurns = recording.turns.filter((t): t is ModelTurn => t.type === 'model');
      agentModelTurns.set(name, modelTurns);
    } catch {
      agentModelTurns.set(name, []);
    }
  }

  // 按 sequence 顺序构建 fakeModel（只包含 model 条目）
  const model = fakeModel();
  for (const entry of manifest.sequence) {
    if (entry.type === 'tool') continue;
    const modelTurns = agentModelTurns.get(entry.agent);
    const turn = modelTurns?.find((t) => t.index === entry.index);
    if (turn) {
      const messages = mapStoredMessagesToChatMessages([turn.response]);
      const message = messages[0];
      if (message) {
        model.respond(message);
      }
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

  if (manifest.recordingVersion !== CURRENT_RECORDING_VERSION) {
    throw new Error(
      `录像版本号不匹配：录像文件为 ${String(manifest.recordingVersion ?? '<无>')}，当前为 ${String(CURRENT_RECORDING_VERSION)}。` +
        `请使用 record 模式重新录制。`,
    );
  }

  const result = new Map<string, BaseMessage>();

  const agentNames = [
    ...new Set(manifest.sequence.filter((s) => s.type === 'tool').map((s) => s.agent)),
  ];
  const agentToolTurns = new Map<string, ToolTurn[]>();

  for (const name of agentNames) {
    try {
      const recording = loadAgentRecording(dirPath, name);
      const toolTurns = recording.turns.filter((t): t is ToolTurn => t.type === 'tool');
      if (toolTurns.length > 0) {
        agentToolTurns.set(name, toolTurns);
      }
    } catch {
      // Agent recording 不存在或无 toolResults
    }
  }

  for (const entry of manifest.sequence) {
    if (entry.type !== 'tool' || !entry.toolCallId) continue;
    const toolTurns = agentToolTurns.get(entry.agent);
    const turn = toolTurns?.find((t) => t.index === entry.index);
    if (turn) {
      const messages = mapStoredMessagesToChatMessages([turn.result]);
      const message = messages[0];
      if (message) {
        result.set(entry.toolCallId, message);
      }
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
      const toolName = request.toolCall?.name;
      const toolArgs = request.toolCall?.args as Record<string, unknown> | undefined;

      if (ToolMessage.isInstance(result) && toolCallId) {
        recorder.recordToolResult(agentName, result, toolCallId, toolName, toolArgs);
      } else if (isCommand(result) && toolCallId) {
        // Command may contain ToolMessage(s) in its update.messages
        const update = result.update as Record<string, unknown> | undefined;
        const updateMessages = Array.isArray(update?.messages) ? update.messages : [];
        for (const msg of updateMessages) {
          if (ToolMessage.isInstance(msg)) {
            recorder.recordToolResult(agentName, msg, toolCallId, toolName, toolArgs);
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

// ---------------------------------------------------------------------------
// Standalone transcript generation (from on-disk recording)
// ---------------------------------------------------------------------------

/**
 * 从磁盘上已有的录像目录重新生成 transcript.md。
 *
 * 读取 manifest.json 和所有 *.recording.json，按全局 sequence 顺序
 * 生成可读的 Markdown 对话记录，写入 dirPath/transcript.md。
 */
export function generateTranscript(dirPath: string): void {
  const manifest = loadManifest(dirPath);

  // 收集所有 recording 文件
  const files = fs.readdirSync(dirPath).filter((f) => f.endsWith('.recording.json'));
  const agentRecordings = new Map<string, AgentRecording>();
  for (const file of files) {
    const filePath = path.join(dirPath, file);
    const rec = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as AgentRecording;
    agentRecordings.set(rec.agent, rec);
  }

  // 从 recording 数据构建 agentTurns（按 sequence 引用的顺序排列）
  const agentTurns = new Map<string, Turn[]>();
  for (const entry of manifest.sequence) {
    const rec = agentRecordings.get(entry.agent);
    if (!rec) continue;
    if (!agentTurns.has(entry.agent)) {
      agentTurns.set(entry.agent, []);
    }
    const turn = rec.turns.find(
      (t) => t.type === (entry.type ?? 'model') && t.index === entry.index,
    );
    if (turn) {
      agentTurns.get(entry.agent)!.push(turn);
    }
  }

  // 构建 agentTools 映射
  const agentTools = new Map<string, SerializedToolDefinition[]>();
  for (const [name, rec] of agentRecordings) {
    if (rec.tools && rec.tools.length > 0) {
      agentTools.set(name, rec.tools);
    }
  }

  writeTranscript(
    dirPath,
    manifest.id,
    manifest.status,
    manifest,
    manifest.sequence,
    agentTurns,
    agentTools,
  );
}
