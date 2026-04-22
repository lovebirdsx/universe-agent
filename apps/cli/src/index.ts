#!/usr/bin/env node
import 'dotenv/config';

import { initConfig } from './config/index.js';
import { createCliAgent } from './agent.js';
import { startRepl } from './repl.js';
import { renderStream } from './renderer.js';
import { fmt } from './format.js';

async function main(): Promise<void> {
  const config = initConfig();
  const cliAgent = await createCliAgent(config);

  try {
    if (config.prompt) {
      // 一次性模式
      const stream = await cliAgent.agent.stream(
        { messages: [{ role: 'user', content: config.prompt }] },
        {
          streamMode: 'messages' as const,
          subgraphs: true,
          recursionLimit: 10000,
        },
      );
      await renderStream(stream, { verbose: config.verbose });
    } else {
      // 交互式 REPL 模式
      await startRepl(cliAgent, config);
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
