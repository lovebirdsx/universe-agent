import fs from 'node:fs/promises';
import path from 'node:path';
import type { McpServer } from '@agentclientprotocol/sdk';

type McpServerConfig =
  | { transport: 'stdio'; command: string; args?: string[]; env?: Record<string, string> }
  | { transport: 'sse'; url: string; headers?: Record<string, string> }
  | { transport: 'streamable-http'; url: string; headers?: Record<string, string> };

interface McpConfigFile {
  mcpServers?: Record<string, McpServerConfig>;
}

export function mcpConfigToAcpServers(mcpServers: Record<string, McpServerConfig>): McpServer[] {
  const result: McpServer[] = [];

  for (const [name, config] of Object.entries(mcpServers)) {
    if (config.transport === 'stdio') {
      result.push({
        name,
        command: config.command,
        args: config.args ?? [],
        env: Object.entries(config.env ?? {}).map(([k, v]) => ({ name: k, value: v })),
      });
    } else if (config.transport === 'streamable-http') {
      result.push({
        type: 'http' as const,
        name,
        url: config.url,
        headers: Object.entries(config.headers ?? {}).map(([k, v]) => ({ name: k, value: v })),
      });
    } else {
      result.push({
        type: 'sse' as const,
        name,
        url: config.url,
        headers: Object.entries(config.headers ?? {}).map(([k, v]) => ({ name: k, value: v })),
      });
    }
  }

  return result;
}

export async function loadMcpServers(configPath: string): Promise<McpServer[]> {
  const resolved = path.isAbsolute(configPath)
    ? configPath
    : path.resolve(process.cwd(), configPath);

  const raw = await fs.readFile(resolved, 'utf-8');
  const parsed = JSON.parse(raw) as McpConfigFile;

  if (!parsed.mcpServers || Object.keys(parsed.mcpServers).length === 0) {
    return [];
  }

  return mcpConfigToAcpServers(parsed.mcpServers);
}
