#!/usr/bin/env node
import 'dotenv/config';
import { createProgram, parseOptions } from './cli.js';
import { ACPClient } from './client.js';
import { Renderer } from './renderer.js';
import { Repl } from './repl.js';
import { fmt, createSpinner } from './format.js';

async function main(): Promise<void> {
  const program = createProgram();
  program.parse();

  const { options, prompt } = parseOptions(program);

  const renderer = new Renderer({
    protocol: options.protocol,
    verbose: options.verbose,
  });

  const client = new ACPClient(renderer, options);

  // 优雅退出
  const cleanup = async () => {
    await client.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void cleanup());
  process.on('SIGTERM', () => void cleanup());

  // 连接服务端
  const spinner = createSpinner('Connecting to ACP server...');
  try {
    await client.connect();
    const initResult = await client.initialize();
    spinner.stop(
      fmt.green(
        `Connected to ${initResult.agentInfo?.name ?? 'agent'} ${initResult.agentInfo?.version ?? ''}`,
      ),
    );
  } catch (err) {
    spinner.stop();
    process.stderr.write(
      fmt.error(`Failed to connect: ${err instanceof Error ? err.message : String(err)}\n`),
    );
    process.exit(1);
  }

  // 创建或加载会话
  try {
    if (options.session) {
      await client.loadSession(options.session);
      process.stderr.write(fmt.dim(`Session loaded: ${client.sessionId}\n`));
    } else {
      await client.newSession();
      process.stderr.write(fmt.dim(`Session created: ${client.sessionId}\n`));
    }
  } catch (err) {
    process.stderr.write(
      fmt.error(`Failed to create session: ${err instanceof Error ? err.message : String(err)}\n`),
    );
    await client.disconnect();
    process.exit(1);
  }

  // 若指定了初始模式则进行设置
  if (options.mode) {
    try {
      await client.setMode(options.mode);
    } catch (err) {
      process.stderr.write(
        fmt.error(`Failed to set mode: ${err instanceof Error ? err.message : String(err)}\n`),
      );
    }
  }

  // 单次执行模式或 REPL 模式
  if (prompt) {
    try {
      const result = await client.prompt(prompt);
      renderer.ensureNewline();
      process.stderr.write(fmt.dim(`[Stop reason: ${result.stopReason}]\n`));
    } catch (err) {
      renderer.ensureNewline();
      process.stderr.write(
        fmt.error(`Error: ${err instanceof Error ? err.message : String(err)}\n`),
      );
    }
    await client.disconnect();
  } else {
    const repl = new Repl(client, renderer);
    await repl.start();
    await client.disconnect();
  }
}

main().catch((err) => {
  process.stderr.write(fmt.error(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`));
  process.exit(1);
});
