/**
 * UniverseAgent ACP Server Example
 *
 * This example demonstrates how to start a UniverseAgent ACP server
 * that can be used with IDEs like Zed, JetBrains, and other ACP clients.
 *
 * Usage:
 *   npx tsx examples/acpServer/server.ts
 *
 * Then configure your IDE to use this agent. For Zed, add to settings.json:
 *
 * {
 *   "agent": {
 *     "profiles": {
 *       "universe-agent": {
 *         "name": "UniverseAgent",
 *         "command": "npx",
 *         "args": ["tsx", "examples/acpServer/server.ts"],
 *         "cwd": "/path/to/universe-agent"
 *       }
 *     }
 *   }
 * }
 */

import 'dotenv/config';
import { UniverseAgentServer } from '@universe-agent/acp';
import { FilesystemBackend } from '@universe-agent/agent';
import path from 'node:path';

// Get workspace root from environment or use current directory
const workspaceRoot = process.env.WORKSPACE_ROOT ?? process.cwd();

// Create the ACP server with a coding assistant agent
const server = new UniverseAgentServer({
  // Agent configuration
  agents: [
    {
      name: 'coding-assistant',
      description:
        'AI coding assistant powered by UniverseAgent with full filesystem access, ' +
        'code search, task management, and subagent delegation capabilities.',

      // Use filesystem backend rooted at the workspace
      backend: new FilesystemBackend({
        rootDir: workspaceRoot,
      }),

      // Load skills from the workspace if available
      skills: [
        path.join(workspaceRoot, '.deepagents', 'skills'),
        path.join(workspaceRoot, 'skills'),
      ],

      // Load memory/context from AGENTS.md files
      memory: [
        path.join(workspaceRoot, '.deepagents', 'AGENTS.md'),
        path.join(workspaceRoot, 'AGENTS.md'),
      ],

      // Custom system prompt (optional)
      systemPrompt: `You are an AI coding assistant integrated with an IDE through the Agent Client Protocol (ACP).

You have access to the workspace at: ${workspaceRoot}

When working on tasks:
1. First understand the codebase structure
2. Make a plan before making changes
3. Test your changes when possible
4. Explain your reasoning

Always be helpful, concise, and focused on the user's coding tasks.`,
    },
  ],

  // Server configuration
  serverName: 'universe-agent-acp-server',
  serverVersion: '0.0.1',
  workspaceRoot,

  // Enable debug logging (set to true to see debug output on stderr)
  debug: process.env.DEBUG === 'true',
});

// Start the server
console.error('[universe-agent] Starting ACP server...');
console.error(`[universe-agent] Workspace: ${workspaceRoot}`);

server.start().catch((error: unknown) => {
  console.error('[universe-agent] Server error:', error);
  process.exit(1);
});
