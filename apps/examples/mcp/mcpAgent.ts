/**
 * MCP Example: Agent with MCP Tools
 *
 * Demonstrates how to connect a universe agent to an MCP server via stdio
 * transport. The agent spawns `mcpServer.ts` as a child process, discovers
 * its tools (`add`, `get_time`), and uses them to answer user queries.
 *
 * Usage:
 *   npx tsx examples/mcp/mcpAgent.ts
 *
 * What this validates:
 * - createUniverseAgentAsync with mcp config
 * - MCP tool discovery via MultiServerMCPClient
 * - End-to-end tool invocation through the MCP protocol
 * - Proper lifecycle cleanup (close MCP connections)
 */
import 'dotenv/config';
import { HumanMessage } from '@langchain/core/messages';
import { createUniverseAgentAsync } from '@universe-agent/agent';

async function main() {
  // Create agent with MCP server connected via stdio.
  // The server script exports two tools: `add` and `get_time`.
  const agent = await createUniverseAgentAsync({
    systemPrompt: `You are a helpful assistant with access to MCP tools.
When asked to add numbers, use the "add" tool.
When asked about the current time, use the "get_time" tool.
Always use the tools — do not compute answers yourself.`,
    mcp: {
      servers: {
        'example-tools': {
          transport: 'stdio',
          command: 'npx',
          args: ['tsx', 'apps/examples/mcp/mcpServer.ts'],
        },
      },
    },
    recording: {
      mode: 'auto',
    },
  });

  try {
    // --- Query 1: add two numbers ---
    console.log('--- Query 1: What is 17 + 25? ---');
    const result1 = await agent.invoke(
      {
        messages: [new HumanMessage('What is 17 + 25?')],
      },
      { recursionLimit: 10 },
    );

    const lastMsg1 = result1.messages[result1.messages.length - 1];
    console.log('Answer:', lastMsg1?.text ?? '(no response)');

    // --- Query 2: get current time ---
    console.log('\n--- Query 2: What time is it? ---');
    const result2 = await agent.invoke(
      {
        messages: [new HumanMessage('What is the current time?')],
      },
      { recursionLimit: 10 },
    );

    const lastMsg2 = result2.messages[result2.messages.length - 1];
    console.log('Answer:', lastMsg2?.text ?? '(no response)');
  } finally {
    // Clean up MCP connections
    await agent.close?.();
    console.log('\nMCP connections closed.');
  }
}

main().catch(console.error);
