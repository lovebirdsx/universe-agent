import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfigurationError } from '../../errors.js';
import { FILESYSTEM_TOOL_NAMES } from '../fs.js';
import { ASYNC_TASK_TOOL_NAMES } from '../async_subagents.js';

// ---------------------------------------------------------------------------
// Mock MultiServerMCPClient
// ---------------------------------------------------------------------------

const mockGetTools = vi.fn();
const mockClose = vi.fn();
const mockConstructor = vi.fn();

vi.mock('@langchain/mcp-adapters', () => {
  return {
    MultiServerMCPClient: class MockMultiServerMCPClient {
      getTools = mockGetTools;
      close = mockClose;
      constructor(config?: unknown) {
        mockConstructor(config);
      }
    },
  };
});

// Import after mock setup
const { createMcpMiddleware } = await import('../mcp.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFakeTool(name: string) {
  return { name, description: `Tool ${name}`, schema: {} };
}

function makeStdioConfig(overrides?: Record<string, unknown>) {
  return {
    servers: {
      myServer: {
        transport: 'stdio' as const,
        command: 'node',
        args: ['server.js'],
        env: { FOO: 'bar' },
        ...overrides,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createMcpMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTools.mockResolvedValue([makeFakeTool('custom_tool')]);
  });

  // -------------------------------------------------------------------------
  // Basic behavior
  // -------------------------------------------------------------------------

  describe('basic behavior', () => {
    it('returns a middleware with close and mcpTools', async () => {
      const mw = await createMcpMiddleware({ config: makeStdioConfig() });

      expect(mw).toBeDefined();
      expect(typeof mw.close).toBe('function');
      expect(mw.mcpTools).toEqual([makeFakeTool('custom_tool')]);
    });

    it('discovers tools from MCP servers', async () => {
      const tools = [makeFakeTool('tool_a'), makeFakeTool('tool_b')];
      mockGetTools.mockResolvedValue(tools);

      const mw = await createMcpMiddleware({ config: makeStdioConfig() });

      expect(mw.mcpTools).toHaveLength(2);
      expect(mw.mcpTools[0].name).toBe('tool_a');
      expect(mw.mcpTools[1].name).toBe('tool_b');
    });
  });

  // -------------------------------------------------------------------------
  // Transport config conversion
  // -------------------------------------------------------------------------

  describe('transport config conversion', () => {
    it('passes stdio config correctly', async () => {
      await createMcpMiddleware({ config: makeStdioConfig() });

      const config = mockConstructor.mock.calls[0][0];
      expect(config.mcpServers.myServer).toEqual({
        transport: 'stdio',
        command: 'node',
        args: ['server.js'],
        env: { FOO: 'bar' },
      });
    });

    it('passes stdio config with default empty args', async () => {
      await createMcpMiddleware({
        config: {
          servers: {
            s: { transport: 'stdio', command: 'npx' },
          },
        },
      });

      const config = mockConstructor.mock.calls[0][0];
      expect(config.mcpServers.s.args).toEqual([]);
    });

    it('passes SSE config correctly', async () => {
      await createMcpMiddleware({
        config: {
          servers: {
            remote: {
              transport: 'sse',
              url: 'http://localhost:3001/sse',
              headers: { Authorization: 'Bearer token' },
            },
          },
        },
      });

      const config = mockConstructor.mock.calls[0][0];
      expect(config.mcpServers.remote).toEqual({
        transport: 'sse',
        url: 'http://localhost:3001/sse',
        headers: { Authorization: 'Bearer token' },
      });
    });

    it('maps streamable-http to http transport', async () => {
      await createMcpMiddleware({
        config: {
          servers: {
            httpServer: {
              transport: 'streamable-http',
              url: 'http://localhost:8080/mcp',
              headers: { 'X-Custom': 'value' },
            },
          },
        },
      });

      const config = mockConstructor.mock.calls[0][0];
      expect(config.mcpServers.httpServer).toEqual({
        transport: 'http',
        url: 'http://localhost:8080/mcp',
        headers: { 'X-Custom': 'value' },
      });
    });
  });

  // -------------------------------------------------------------------------
  // prefixToolNames
  // -------------------------------------------------------------------------

  describe('prefixToolNames', () => {
    it('enables global prefix when any server has prefixToolNames: true', async () => {
      await createMcpMiddleware({
        config: {
          servers: {
            a: { transport: 'stdio', command: 'cmd1' },
            b: { transport: 'stdio', command: 'cmd2', prefixToolNames: true },
          },
        },
      });

      const config = mockConstructor.mock.calls[0][0];
      expect(config.prefixToolNameWithServerName).toBe(true);
    });

    it('disables global prefix when no server has prefixToolNames', async () => {
      await createMcpMiddleware({
        config: {
          servers: {
            a: { transport: 'stdio', command: 'cmd1' },
            b: { transport: 'stdio', command: 'cmd2' },
          },
        },
      });

      const config = mockConstructor.mock.calls[0][0];
      expect(config.prefixToolNameWithServerName).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Tool name collision detection
  // -------------------------------------------------------------------------

  describe('tool name collision detection', () => {
    it('throws ConfigurationError for filesystem tool name collision', async () => {
      const builtinName = FILESYSTEM_TOOL_NAMES[0]!;
      mockGetTools.mockResolvedValue([makeFakeTool(builtinName)]);

      await expect(createMcpMiddleware({ config: makeStdioConfig() })).rejects.toThrow(
        ConfigurationError,
      );

      try {
        await createMcpMiddleware({ config: makeStdioConfig() });
      } catch (error) {
        expect(ConfigurationError.isInstance(error)).toBe(true);
        expect((error as ConfigurationError).code).toBe('MCP_TOOL_NAME_COLLISION');
        expect((error as ConfigurationError).message).toContain(builtinName);
      }
    });

    it('throws ConfigurationError for async task tool name collision', async () => {
      const builtinName = ASYNC_TASK_TOOL_NAMES[0]!;
      mockGetTools.mockResolvedValue([makeFakeTool(builtinName)]);

      await expect(createMcpMiddleware({ config: makeStdioConfig() })).rejects.toThrow(
        ConfigurationError,
      );
    });

    it('throws ConfigurationError for "task" tool name collision', async () => {
      mockGetTools.mockResolvedValue([makeFakeTool('task')]);

      await expect(createMcpMiddleware({ config: makeStdioConfig() })).rejects.toThrow(
        ConfigurationError,
      );
    });

    it('throws ConfigurationError for "write_todos" tool name collision', async () => {
      mockGetTools.mockResolvedValue([makeFakeTool('write_todos')]);

      await expect(createMcpMiddleware({ config: makeStdioConfig() })).rejects.toThrow(
        ConfigurationError,
      );
    });

    it('does not throw when tool names do not collide', async () => {
      mockGetTools.mockResolvedValue([makeFakeTool('mcp_search'), makeFakeTool('mcp_analyze')]);

      const mw = await createMcpMiddleware({ config: makeStdioConfig() });
      expect(mw.mcpTools).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // Connection error handling
  // -------------------------------------------------------------------------

  describe('connection error handling', () => {
    it('throws ConfigurationError on connection failure', async () => {
      mockGetTools.mockRejectedValue(new Error('Connection refused'));

      await expect(createMcpMiddleware({ config: makeStdioConfig() })).rejects.toThrow(
        ConfigurationError,
      );

      try {
        mockGetTools.mockRejectedValue(new Error('Connection refused'));
        await createMcpMiddleware({ config: makeStdioConfig() });
      } catch (error) {
        expect(ConfigurationError.isInstance(error)).toBe(true);
        expect((error as ConfigurationError).code).toBe('MCP_CONNECTION_ERROR');
        expect((error as ConfigurationError).message).toContain('Connection refused');
        expect((error as ConfigurationError).cause).toBeInstanceOf(Error);
      }
    });

    it('wraps non-Error connection failures', async () => {
      mockGetTools.mockRejectedValue('string error');

      try {
        await createMcpMiddleware({ config: makeStdioConfig() });
      } catch (error) {
        expect(ConfigurationError.isInstance(error)).toBe(true);
        expect((error as ConfigurationError).code).toBe('MCP_CONNECTION_ERROR');
        expect((error as ConfigurationError).message).toContain('string error');
        expect((error as ConfigurationError).cause).toBeUndefined();
      }
    });

    it('passes onConnectionError: "ignore" to client', async () => {
      await createMcpMiddleware({
        config: { ...makeStdioConfig(), onConnectionError: 'ignore' },
      });

      const config = mockConstructor.mock.calls[0][0];
      expect(config.throwOnLoadError).toBe(false);
      expect(config.onConnectionError).toBe('ignore');
    });

    it('passes onConnectionError: "throw" (default) to client', async () => {
      await createMcpMiddleware({ config: makeStdioConfig() });

      const config = mockConstructor.mock.calls[0][0];
      expect(config.throwOnLoadError).toBe(true);
      expect(config.onConnectionError).toBe('throw');
    });
  });

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  describe('lifecycle', () => {
    it('close() delegates to the underlying client', async () => {
      const mw = await createMcpMiddleware({ config: makeStdioConfig() });

      await mw.close();

      expect(mockClose).toHaveBeenCalledOnce();
    });
  });
});
