/**
 * Simple MCP Server
 *
 * A minimal MCP server that provides two tools:
 * - `add`: Add two numbers
 * - `get_time`: Get the current time
 *
 * This server is designed to be spawned as a child process by the agent
 * via stdio transport. Run it directly to verify it starts correctly:
 *
 *   npx tsx examples/mcp/mcpServer.ts
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({
  name: 'example-tools',
  version: '1.0.0',
});

// Tool 1: simple arithmetic
server.registerTool(
  'add',
  {
    description: 'Add two numbers together',
    inputSchema: { a: z.number(), b: z.number() },
  },
  async ({ a, b }) => ({
    content: [{ type: 'text' as const, text: String(a + b) }],
  }),
);

// Tool 2: current time
server.registerTool(
  'get_time',
  {
    description: 'Get the current date and time',
    inputSchema: {},
  },
  async () => ({
    content: [{ type: 'text' as const, text: new Date().toISOString() }],
  }),
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main();
