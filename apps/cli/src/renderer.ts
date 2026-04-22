import { AIMessage, AIMessageChunk, ToolMessage } from 'langchain';

import { fmt } from './format.js';

export interface RenderOptions {
  verbose: boolean;
}

const MAX_TOOL_RESULT_LINES = 20;
const MAX_TOOL_RESULT_CHARS = 500;

function truncateResult(text: string): string {
  const lines = text.split('\n');
  let result: string;
  if (lines.length > MAX_TOOL_RESULT_LINES) {
    result =
      lines.slice(0, MAX_TOOL_RESULT_LINES).join('\n') +
      `\n... (${lines.length - MAX_TOOL_RESULT_LINES} lines truncated)`;
  } else {
    result = text;
  }
  if (result.length > MAX_TOOL_RESULT_CHARS) {
    result = result.slice(0, MAX_TOOL_RESULT_CHARS) + '...';
  }
  return result;
}

function formatToolHeader(toolName: string, argsJson: string): string {
  if (toolName === 'task') {
    try {
      const args = JSON.parse(argsJson) as { subagent_type?: string; description?: string };
      return `\n  ${fmt.toolName('task')} ${fmt.dim('\u2192')} ${fmt.subagent(args.subagent_type ?? 'unknown')}`;
    } catch {
      // 参数可能不完整
    }
  }

  if (toolName === 'read_file' || toolName === 'write_file' || toolName === 'edit_file') {
    try {
      const args = JSON.parse(argsJson) as { path?: string };
      if (args.path) {
        return `\n  ${fmt.toolName(toolName)}(${fmt.dim(JSON.stringify(args.path))})`;
      }
    } catch {
      // 忽略
    }
  }

  if (toolName === 'execute') {
    try {
      const args = JSON.parse(argsJson) as { command?: string };
      if (args.command) {
        return `\n  ${fmt.toolName(toolName)}(${fmt.dim(JSON.stringify(args.command))})`;
      }
    } catch {
      // 忽略
    }
  }

  return `\n  ${fmt.toolName(toolName)}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type StreamItem = [string[], any];

export async function renderStream(
  stream: AsyncIterable<StreamItem>,
  options: RenderOptions,
): Promise<void> {
  let currentToolName = '';
  let currentToolArgs = '';
  let toolHeaderPrinted = false;

  for await (const [namespace, chunk] of stream) {
    const [message] = chunk as [unknown];
    const isSubagent = namespace.some((s: string) => s.startsWith('tools:'));

    // 工具调用分块（流式工具调用）
    if (AIMessageChunk.isInstance(message) && message.tool_call_chunks?.length) {
      for (const tc of message.tool_call_chunks) {
        if (tc.name) {
          // 新的工具调用开始 — 必要时刷新前一个
          if (currentToolName && !toolHeaderPrinted) {
            process.stdout.write(formatToolHeader(currentToolName, currentToolArgs));
          }
          currentToolName = tc.name;
          currentToolArgs = tc.args ?? '';
          toolHeaderPrinted = false;
        } else if (tc.args) {
          currentToolArgs += tc.args;
        }
      }
      continue;
    }

    // 非流式 AIMessage 的工具调用（回放模式：fakeModel 产生 AIMessage 而非 AIMessageChunk）
    if (
      AIMessage.isInstance(message) &&
      !AIMessageChunk.isInstance(message) &&
      message.tool_calls?.length
    ) {
      for (const tc of message.tool_calls) {
        // 刷新前一个待打印的工具头部
        if (currentToolName && !toolHeaderPrinted) {
          process.stdout.write(formatToolHeader(currentToolName, currentToolArgs));
        }
        currentToolName = tc.name;
        currentToolArgs = JSON.stringify(tc.args);
        toolHeaderPrinted = false;
      }
      continue;
    }

    // 工具结果
    if (ToolMessage.isInstance(message)) {
      // 如果尚未打印工具头部则打印
      if (currentToolName && !toolHeaderPrinted) {
        process.stdout.write(formatToolHeader(currentToolName, currentToolArgs));
        toolHeaderPrinted = true;
      }

      const toolName = message.name ?? currentToolName;
      const text = typeof message.content === 'string' ? message.content : '';

      if (text && options.verbose) {
        const truncated = truncateResult(text);
        const indented = truncated
          .split('\n')
          .map((line) => `    ${line}`)
          .join('\n');
        process.stdout.write(`\n${fmt.toolResult(indented)}`);
      }

      if (toolName === 'write_file' && text) {
        const lineCount = text.split('\n').length;
        process.stdout.write(`\n    ${fmt.dim(`\u2713 wrote ${String(lineCount)} lines`)}`);
      }

      // 重置工具状态
      currentToolName = '';
      currentToolArgs = '';
      toolHeaderPrinted = false;

      if (!isSubagent) process.stdout.write('\n');
      continue;
    }

    // 常规 AI 文本令牌（流式 AIMessageChunk 或非流式 AIMessage）
    if (AIMessage.isInstance(message) && message.text) {
      // 刷新待处理的工具头部
      if (currentToolName && !toolHeaderPrinted) {
        process.stdout.write(formatToolHeader(currentToolName, currentToolArgs));
        toolHeaderPrinted = true;
        currentToolName = '';
        currentToolArgs = '';
        process.stdout.write('\n');
      }
      process.stdout.write(message.text);
    }
  }

  process.stdout.write('\n');
}
