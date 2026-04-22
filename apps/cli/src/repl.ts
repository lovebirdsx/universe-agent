import readline from 'node:readline';
import crypto from 'node:crypto';

import type { CliConfig } from './config/index.js';
import type { CliAgent } from './agent.js';
import { renderStream } from './renderer.js';
import { fmt, createSpinner } from './format.js';

function printReplHelp(): void {
  console.log(
    `
${fmt.bold('REPL 命令:')}
  /quit, /exit   退出
  /clear         新建会话（清除对话历史）
  /help          显示此帮助
  /model         显示当前模型
`.trim(),
  );
}

export async function startRepl({ agent }: CliAgent, config: CliConfig): Promise<void> {
  let threadId = crypto.randomUUID();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: fmt.prompt(),
  });

  console.log(fmt.bold('UniverseAgent CLI'));
  console.log(fmt.dim(`模型: ${config.model} | 项目: ${config.projectDir}`));
  console.log(fmt.dim('输入 /help 查看命令，Ctrl+D 退出'));
  console.log();

  rl.prompt();

  for await (const line of rl) {
    const input = line.trim();

    if (!input) {
      rl.prompt();
      continue;
    }

    // Built-in commands
    if (input === '/quit' || input === '/exit') {
      break;
    }

    if (input === '/clear') {
      threadId = crypto.randomUUID();
      console.log(fmt.info('会话已清除'));
      rl.prompt();
      continue;
    }

    if (input === '/help') {
      printReplHelp();
      rl.prompt();
      continue;
    }

    if (input === '/model') {
      console.log(fmt.info(`当前模型: ${config.model}`));
      rl.prompt();
      continue;
    }

    if (input.startsWith('/')) {
      console.log(fmt.error(`未知命令: ${input}。输入 /help 查看可用命令。`));
      rl.prompt();
      continue;
    }

    // Send to agent
    const spinner = createSpinner('思考中...');
    let spinnerStopped = false;

    try {
      const stream = await agent.stream(
        { messages: [{ role: 'user', content: input }] },
        {
          streamMode: 'messages' as const,
          subgraphs: true,
          configurable: { thread_id: threadId },
          recursionLimit: 10000,
        },
      );

      // Stop spinner on first output
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
  console.log(fmt.dim('\n再见!'));
}
