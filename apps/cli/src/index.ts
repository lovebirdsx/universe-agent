#!/usr/bin/env node
import 'dotenv/config';

import crypto from 'node:crypto';
import path from 'node:path';

import type { RecordingConfig } from '@universe-agent/agent';

import { initConfig } from './config/index.js';
import { createCliAgent } from './agent.js';
import { startRepl } from './repl.js';
import { renderStream } from './renderer.js';
import { handleReplay } from './replay.js';
import { fmt } from './format.js';

async function main(): Promise<void> {
  const result = initConfig();

  // replay 子命令
  if (result.command === 'replay') {
    await handleReplay(result.replayConfig);
    return;
  }

  const config = result.config;

  // 录像配置
  let recording: RecordingConfig | undefined;
  const threadId = crypto.randomUUID();

  if (config.record) {
    recording = {
      mode: 'record',
      path: path.join(config.projectDir, '.universe-agent', 'recordings'),
      id: threadId,
    };
  }

  const cliAgent = await createCliAgent(config, recording);

  try {
    if (config.prompt) {
      // 一次性模式
      if (recording) {
        console.log(fmt.dim(`录制中: ${recording.id}`));
      }

      const stream = await cliAgent.agent.stream(
        { messages: [{ role: 'user', content: config.prompt }] },
        {
          streamMode: 'messages' as const,
          subgraphs: true,
          configurable: { thread_id: threadId },
          recursionLimit: 10000,
        },
      );
      await renderStream(stream, { verbose: config.verbose });

      if (recording) {
        console.log(fmt.dim(`\n录像已保存: ${recording.id}`));
      }
    } else {
      // 交互式 REPL 模式
      await startRepl(cliAgent, config, threadId);
    }
  } finally {
    await cliAgent.backend.close();
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(fmt.error(`Fatal: ${message}`));
  process.exit(1);
});
