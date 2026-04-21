import { AIMessageChunk, ToolMessage } from 'langchain';

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
      // args may be incomplete
    }
  }

  if (toolName === 'read_file' || toolName === 'write_file' || toolName === 'edit_file') {
    try {
      const args = JSON.parse(argsJson) as { path?: string };
      if (args.path) {
        return `\n  ${fmt.toolName(toolName)}(${fmt.dim(JSON.stringify(args.path))})`;
      }
    } catch {
      // ignore
    }
  }

  if (toolName === 'execute') {
    try {
      const args = JSON.parse(argsJson) as { command?: string };
      if (args.command) {
        return `\n  ${fmt.toolName(toolName)}(${fmt.dim(JSON.stringify(args.command))})`;
      }
    } catch {
      // ignore
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

    // Tool call chunks (streaming tool invocations)
    if (AIMessageChunk.isInstance(message) && message.tool_call_chunks?.length) {
      for (const tc of message.tool_call_chunks) {
        if (tc.name) {
          // New tool call starting — flush previous if needed
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

    // Tool results
    if (ToolMessage.isInstance(message)) {
      // Print tool header if not yet printed
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

      // Reset tool state
      currentToolName = '';
      currentToolArgs = '';
      toolHeaderPrinted = false;

      if (!isSubagent) process.stdout.write('\n');
      continue;
    }

    // Regular AI text tokens
    if (AIMessageChunk.isInstance(message) && message.text) {
      // Flush pending tool header
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
