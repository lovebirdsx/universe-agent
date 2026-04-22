import readline from 'node:readline';
import crypto from 'node:crypto';

import type { CliConfig } from './config/index.js';
import type { CliAgent } from './agent.js';
import { renderStream } from './renderer.js';
import { fmt, createSpinner } from './format.js';

function printReplHelp(isRecording: boolean): void {
  const recordLine = isRecording
    ? '  /record        显示录像状态'
    : '  /record        显示录像状态（使用 --record 启用）';

  console.log(
    `
${fmt.bold('REPL 命令:')}
  /quit, /exit   退出
  /clear         新建会话（清除对话历史）
  /help          显示此帮助
  /model         显示当前模型
  ${recordLine}
`.trim(),
  );
}

export async function startRepl(
  { agent }: CliAgent,
  config: CliConfig & { prompt: string | undefined },
  threadId?: string,
): Promise<void> {
  let currentThreadId = threadId ?? crypto.randomUUID();
  const isRecording = config.record;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: fmt.prompt(),
  });

  console.log(fmt.bold('UniverseAgent CLI'));
  console.log(fmt.dim(`模型: ${config.model} | 项目: ${config.projectDir}`));
  if (isRecording) {
    console.log(fmt.info(`录制中: ${currentThreadId}`));
  }
  console.log(fmt.dim('输入 /help 查看命令，Ctrl+D 退出'));
  console.log();

  rl.prompt();

  for await (const line of rl) {
    const input = line.trim();

    if (!input) {
      rl.prompt();
      continue;
    }

    // 内置命令
    if (input === '/quit' || input === '/exit') {
      break;
    }

    if (input === '/clear') {
      currentThreadId = crypto.randomUUID();
      console.log(fmt.info('会话已清除'));
      if (isRecording) {
        console.log(fmt.dim(`注意: 录像将继续在同一录像文件中记录`));
      }
      rl.prompt();
      continue;
    }

    if (input === '/help') {
      printReplHelp(isRecording);
      rl.prompt();
      continue;
    }

    if (input === '/model') {
      console.log(fmt.info(`当前模型: ${config.model}`));
      rl.prompt();
      continue;
    }

    if (input === '/record') {
      if (isRecording) {
        console.log(fmt.info(`录制中: ${currentThreadId}`));
      } else {
        console.log(fmt.info('录像未启用。使用 --record 选项启动 CLI 来启用录像。'));
      }
      rl.prompt();
      continue;
    }

    if (input.startsWith('/')) {
      console.log(fmt.error(`未知命令: ${input}。输入 /help 查看可用命令。`));
      rl.prompt();
      continue;
    }

    // 发送给 Agent
    const spinner = createSpinner('思考中...');
    let spinnerStopped = false;

    try {
      const stream = await agent.stream(
        { messages: [{ role: 'user', content: input }] },
        {
          streamMode: 'messages' as const,
          subgraphs: true,
          configurable: { thread_id: currentThreadId },
          recursionLimit: 10000,
        },
      );

      // 第一个输出时停止 spinner
      const wrappedStream = (async function* () {
        for await (const item of stream) {
          if (!spinnerStopped) {
            spinner.stop();
            spinnerStopped = true;
          }
          yield item;
        }
      })();

      await renderStream(wrappedStream, { verbose: config.verbose });
    } catch (err) {
      if (!spinnerStopped) spinner.stop();
      const message = err instanceof Error ? err.message : String(err);
      console.error(fmt.error(`错误: ${message}`));
    }

    console.log();
    rl.prompt();
  }

  rl.close();
  if (isRecording) {
    console.log(fmt.dim(`\n录像已保存: ${currentThreadId}`));
  }
  console.log(fmt.dim('\n再见!'));
}
