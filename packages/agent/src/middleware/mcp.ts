import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import { createMiddleware } from 'langchain';
import type { StructuredTool } from '@langchain/core/tools';
import type { AgentMiddleware } from 'langchain';

import { ConfigurationError } from '../errors.js';
import type { McpConfig, McpServerConfig } from '../types.js';
import { FILESYSTEM_TOOL_NAMES } from './fs.js';
import { ASYNC_TASK_TOOL_NAMES } from './async_subagents.js';

/**
 * Options for {@link createMcpMiddleware}.
 */
export interface McpMiddlewareOptions {
  config: McpConfig;
}

/**
 * MCP middleware with lifecycle management.
 * Call `close()` to disconnect from all MCP servers.
 */
export type McpMiddleware = AgentMiddleware & {
  /** Disconnect from all MCP servers */
  close: () => Promise<void>;
  /** Tools discovered from MCP servers */
  mcpTools: StructuredTool[];
};

type StdioServerConfig = {
  transport: 'stdio';
  command: string;
  args: string[];
  env?: Record<string, string>;
};

type HttpServerConfig = {
  transport: 'http' | 'sse';
  url: string;
  headers?: Record<string, string>;
};

type ClientServerConfig = StdioServerConfig | HttpServerConfig;

/**
 * Converts a universe-agent McpServerConfig into the format expected by
 * MultiServerMCPClient's `mcpServers` map.
 */
function toClientConfig(serverConfig: McpServerConfig): ClientServerConfig {
  switch (serverConfig.transport) {
    case 'stdio':
      return {
        transport: 'stdio',
        command: serverConfig.command,
        args: serverConfig.args ?? [],
        env: serverConfig.env,
      };
    case 'sse':
      return {
        transport: 'sse',
        url: serverConfig.url,
        headers: serverConfig.headers,
      };
    case 'streamable-http':
      return {
        transport: 'http',
        url: serverConfig.url,
        headers: serverConfig.headers,
      };
  }
}

/**
 * Creates an MCP middleware that connects to external MCP servers and exposes
 * their tools to the agent.
 *
 * This is an **async** factory because MCP server connection and tool discovery
 * are inherently asynchronous operations.
 *
 * @example
 * ```typescript
 * const mcpMiddleware = await createMcpMiddleware({
 *   config: {
 *     servers: {
 *       filesystem: {
 *         transport: 'stdio',
 *         command: 'npx',
 *         args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
 *       },
 *     },
 *   },
 * });
 *
 * const agent = createUniverseAgent({
 *   middleware: [mcpMiddleware],
 * });
 * ```
 */
export async function createMcpMiddleware(options: McpMiddlewareOptions): Promise<McpMiddleware> {
  const { config } = options;

  // Determine if any server needs tool name prefixing
  const anyPrefixed = Object.values(config.servers).some((s) => s.prefixToolNames === true);

  // Build mcpServers config for MultiServerMCPClient
  const mcpServers: Record<string, ClientServerConfig> = {};
  for (const [name, serverConfig] of Object.entries(config.servers)) {
    mcpServers[name] = toClientConfig(serverConfig);
  }

  const client = new MultiServerMCPClient({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mcpServers: mcpServers as any,
    prefixToolNameWithServerName: anyPrefixed,
    throwOnLoadError: config.onConnectionError !== 'ignore',
    onConnectionError: config.onConnectionError ?? 'throw',
  });

  // Connect and discover tools
  let tools: StructuredTool[];
  try {
    tools = (await client.getTools()) as StructuredTool[];
  } catch (error) {
    throw new ConfigurationError(
      `Failed to connect to MCP servers: ${error instanceof Error ? error.message : String(error)}`,
      'MCP_CONNECTION_ERROR',
      error instanceof Error ? error : undefined,
    );
  }

  // Check for tool name collisions with built-in tools
  const builtinNames = new Set<string>([
    ...FILESYSTEM_TOOL_NAMES,
    ...ASYNC_TASK_TOOL_NAMES,
    'task',
    'write_todos',
  ]);
  for (const tool of tools) {
    if (builtinNames.has(tool.name)) {
      throw new ConfigurationError(
        `MCP tool "${tool.name}" collides with built-in tool name. ` +
          `Enable \`prefixToolNames: true\` on the MCP server config to avoid this.`,
        'MCP_TOOL_NAME_COLLISION',
      );
    }
  }

  const middleware = createMiddleware({
    name: 'McpMiddleware',
    tools,
  });

  return Object.assign(middleware, {
    close: async () => {
      await client.close();
    },
    mcpTools: tools,
  });
}
