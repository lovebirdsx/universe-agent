/**
 * UniverseAgent Server - ACP Integration
 *
 * This package provides an Agent Client Protocol (ACP) server that wraps
 * UniverseAgent, enabling seamless integration with IDEs like Zed, JetBrains,
 * and other ACP-compatible clients.
 *
 * @packageDocumentation
 * @module @universe-agent/acp
 *
 * @example
 * ```typescript
 * import { UniverseAgentServer, startServer } from "@universe-agent/acp";
 *
 * // Quick start
 * await startServer({
 *   agents: {
 *     name: "coding-assistant",
 *     description: "AI coding assistant with filesystem access",
 *   },
 *   workspaceRoot: process.cwd(),
 * });
 *
 * // Or create a server instance manually
 * const server = new UniverseAgentServer({
 *   agents: [{
 *     name: "coding-assistant",
 *     description: "AI coding assistant",
 *     skills: ["./skills/"],
 *     memory: ["./AGENTS.md"],
 *   }],
 *   debug: true,
 * });
 *
 * await server.start();
 * ```
 */

// Main server export
export { UniverseAgentServer, startServer } from './server.js';
export { ACPFilesystemBackend } from './acpFileSystemBackend.js';

// Type exports
export type {
  UniverseAgentConfig,
  UniverseAgentServerOptions,
  SessionState,
  ToolCallInfo,
  PlanEntry,
  StopReason,
  ACPCapabilities,
  ACPAuthMethod,
  ACPAuthMethodAgent,
  ACPAuthMethodEnvVar,
  ACPAuthMethodTerminal,
  ACPAuthEnvVar,
  ServerEvents,
} from './types.js';

// Adapter utilities (for advanced use cases)
export {
  acpPromptToHumanMessage,
  langChainMessageToACP,
  langChainContentToACP,
  extractToolCalls,
  todosToPlanEntries,
  generateSessionId,
  generateToolCallId,
  getToolCallKind,
  formatToolCallTitle,
  extractToolCallLocations,
  fileUriToPath,
  pathToFileUri,
} from './adapter.js';

// Logger utilities
export { Logger, createLogger, nullLogger } from './logger.js';
export type { LogLevel, LoggerOptions } from './logger.js';
