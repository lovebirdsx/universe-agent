#!/usr/bin/env node
import 'dotenv/config';

import { parseCliArgs, printHelp } from './cli.js';
import { loadConfig } from './config.js';
import { createCliAgent } from './agent.js';
import { startRepl } from './repl.js';
import { renderStream } from './renderer.js';
import { fmt } from './format.js';

async function main(): Promise<void> {
  const args = parseCliArgs();

  if (args.help) {
    printHelp();
    return;
  }

  if (args.version) {
    console.log('deepagent 0.0.0');
    return;
  }

  const config = loadConfig(args);
  const cliAgent = await createCliAgent(config);

  try {
    if (args.prompt) {
      // One-shot mode
      const stream = await cliAgent.agent.stream(
        { messages: [{ role: 'user', content: args.prompt }] },
        {
          streamMode: 'messages' as const,
          subgraphs: true,
          recursionLimit: 10000,
        },
      );
      await renderStream(stream, { verbose: config.verbose });
    } else {
      // Interactive REPL mode
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
