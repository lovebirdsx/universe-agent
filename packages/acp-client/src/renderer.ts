import type { AnyMessage } from '@agentclientprotocol/sdk';
import type { SessionNotification } from '@agentclientprotocol/sdk';
import { fmt, colorizeJson } from './format.js';

export interface RendererOptions {
  protocol: boolean;
  verbose: boolean;
}

/** 协议消息中 JSON 内容的缩进前缀 */
const INDENT = '  ';

export class Renderer {
  protocol: boolean;
  verbose: boolean;

  constructor(options: RendererOptions) {
    this.protocol = options.protocol;
    this.verbose = options.verbose;
  }

  // --- 协议观测 ---

  renderProtocolMessage(direction: 'send' | 'recv', msg: AnyMessage): void {
    if (!this.protocol) return;

    const ts = fmt.timestamp();
    const arrow = direction === 'send' ? fmt.send('-->') : fmt.recv('<--');
    const type = classifyMessage(msg);

    switch (type) {
      case 'request': {
        const req = msg as { id: string | number; method: string; params?: unknown };
        const header = `${ts} ${arrow} ${fmt.reqTag()} ${fmt.msgId(req.id)} ${fmt.method(req.method)}`;
        process.stderr.write(header + '\n');
        if (req.params !== undefined) {
          writeJsonBlock(req.params, this.verbose);
        }
        break;
      }
      case 'response': {
        const res = msg as {
          id: string | number;
          result?: unknown;
          error?: { code: number; message: string; data?: unknown };
        };
        if ('error' in res && res.error) {
          const header = `${ts} ${arrow} ${fmt.errTag()} ${fmt.msgId(res.id)} ${fmt.error(`${res.error.code}: ${res.error.message}`)}`;
          process.stderr.write(header + '\n');
          if (res.error.data !== undefined) {
            writeJsonBlock(res.error.data, this.verbose);
          }
        } else {
          const header = `${ts} ${arrow} ${fmt.resTag()} ${fmt.msgId(res.id)}`;
          process.stderr.write(header + '\n');
          writeJsonBlock((res as { result: unknown }).result, this.verbose);
        }
        break;
      }
      case 'notification': {
        const ntf = msg as { method: string; params?: unknown };
        const header = `${ts} ${arrow} ${fmt.ntfTag()} ${fmt.method(ntf.method)}`;
        process.stderr.write(header + '\n');
        if (ntf.params !== undefined) {
          writeJsonBlock(ntf.params, this.verbose);
        }
        break;
      }
    }
  }

  // --- 会话更新渲染 ---

  renderSessionUpdate(notification: SessionNotification): void {
    const update = notification.update;

    switch (update.sessionUpdate) {
      case 'agent_message_chunk':
        this.renderContentChunk(update.content);
        break;

      case 'agent_thought_chunk':
        this.renderThought(update.content);
        break;

      case 'user_message_chunk':
        // 用户消息会被回显，CLI 中通常跳过
        break;

      case 'tool_call':
        this.renderToolCall(update);
        break;

      case 'tool_call_update':
        this.renderToolCallUpdate(update);
        break;

      case 'plan':
        this.renderPlan(update);
        break;

      case 'available_commands_update':
        this.renderCommandsUpdate(update);
        break;

      case 'current_mode_update':
        this.renderModeUpdate(update);
        break;

      case 'usage_update':
        this.renderUsageUpdate(update);
        break;

      default:
        if (this.verbose) {
          process.stderr.write(
            fmt.dim(`[Unknown update: ${(update as { sessionUpdate: string }).sessionUpdate}]\n`),
          );
        }
    }
  }

  private renderContentChunk(content: { type: string; text?: string }): void {
    if (content.type === 'text' && content.text) {
      process.stdout.write(content.text);
    }
  }

  private renderThought(content: { type: string; text?: string }): void {
    if (content.type === 'text' && content.text) {
      process.stderr.write(fmt.thought(`[Thinking] ${content.text}`));
    }
  }

  private renderToolCall(update: {
    toolCallId: string;
    title: string;
    kind?: string;
    status?: string;
    rawInput?: unknown;
  }): void {
    const status = update.status ? (fmt.toolStatus[update.status] ?? '') + ' ' : '';
    const kind = update.kind ? fmt.dim(`[${update.kind}]`) + ' ' : '';
    const title = fmt.toolName(update.title);
    const input =
      this.verbose && update.rawInput
        ? ' ' + fmt.dim(truncate(formatJson(update.rawInput), 200))
        : '';

    process.stderr.write(`${status}${kind}${title}${input}\n`);
  }

  private renderToolCallUpdate(update: {
    toolCallId: string;
    status?: string | null;
    rawOutput?: unknown;
    content?: unknown;
    title?: string | null;
  }): void {
    const statusIcon = update.status ? (fmt.toolStatus[update.status] ?? '') + ' ' : '';
    const title = update.title ? fmt.toolName(update.title) : update.toolCallId;

    let output = '';
    if (this.verbose && update.rawOutput) {
      output = ' ' + fmt.toolResult(truncate(formatJson(update.rawOutput), 300));
    }

    process.stderr.write(`${statusIcon}${title}${output}\n`);
  }

  private renderPlan(update: {
    entries: Array<{ content: string; status: string; priority: string }>;
  }): void {
    process.stderr.write(fmt.bold('Plan:\n'));
    for (const entry of update.entries) {
      const render = fmt.plan[entry.status] ?? fmt.plan['pending']!;
      const priority = entry.priority === 'high' ? fmt.yellow(' [!]') : '';
      process.stderr.write(render(entry.content + priority) + '\n');
    }
  }

  private renderCommandsUpdate(update: {
    availableCommands: Array<{ name: string; description?: string }>;
  }): void {
    if (!this.verbose) return;
    process.stderr.write(
      fmt.dim(
        `Available commands: ${update.availableCommands.map((c) => '/' + c.name).join(', ')}\n`,
      ),
    );
  }

  private renderModeUpdate(update: { currentModeId: string }): void {
    process.stderr.write(fmt.info(`Mode changed to: ${update.currentModeId}\n`));
  }

  private renderUsageUpdate(update: { size: number; used: number }): void {
    if (!this.verbose) return;
    process.stderr.write(fmt.dim(`Usage: ${update.used}/${update.size} tokens\n`));
  }

  ensureNewline(): void {
    process.stdout.write('\n');
  }
}

// --- 工具函数 ---

function classifyMessage(msg: AnyMessage): 'request' | 'response' | 'notification' {
  if ('method' in msg && 'id' in msg && msg.id !== null) return 'request';
  if ('id' in msg && !('method' in msg)) return 'response';
  return 'notification';
}

/**
 * 将 JSON 对象以缩进 + 语法高亮的形式写入 stderr。
 * verbose 时完整输出；否则折叠长字符串值和深层嵌套。
 */
function writeJsonBlock(value: unknown, verbose: boolean): void {
  if (value === undefined || value === null) return;
  try {
    const json = verbose ? JSON.stringify(value, null, 2) : JSON.stringify(value, shortener(), 2);
    const colored = colorizeJson(json);
    for (const line of colored.split('\n')) {
      process.stderr.write(INDENT + line + '\n');
    }
  } catch {
    process.stderr.write(INDENT + String(value) + '\n');
  }
}

/**
 * JSON.stringify replacer：截断过长的字符串值，方便非 verbose 模式快速浏览。
 */
function shortener(): (key: string, value: unknown) => unknown {
  return (_key: string, value: unknown) => {
    if (typeof value === 'string' && value.length > 80) {
      return value.slice(0, 77) + '...';
    }
    return value;
  };
}

function formatJson(value: unknown): string {
  if (value === undefined || value === null) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}
