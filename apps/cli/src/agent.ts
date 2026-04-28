import {
  createUniverseAgent,
  createUniverseAgentAsync,
  LocalShellBackend,
  createSettings,
  resolveModelFromConfig,
} from '@universe-agent/agent';
import type { RecordingConfig } from '@universe-agent/agent';
import { MemorySaver } from '@langchain/langgraph';

import type { CliConfig } from './config/index.js';

const CLI_SYSTEM_PROMPT = `You are UniverseAgent, a helpful AI coding assistant running in a terminal CLI.
You have access to the user's project filesystem and can execute shell commands.

Guidelines:
- Be concise and direct in your responses
- When the user asks you to modify code, read the relevant files first
- Use the execute tool for running shell commands (build, test, git, etc.)
- Use edit_file for surgical changes, write_file for creating new files
- Explain what you're doing briefly before taking actions
- If a task is ambiguous, ask for clarification`;

export interface CliAgent {
  agent: ReturnType<typeof createUniverseAgent>;
  backend: LocalShellBackend;
  close?: (() => Promise<void>) | undefined;
}

export async function createCliAgent(
  config: CliConfig,
  recording?: RecordingConfig,
): Promise<CliAgent> {
  const settings = createSettings({ startPath: config.projectDir });

  const backend = new LocalShellBackend({
    rootDir: config.projectDir,
    inheritEnv: true,
    timeout: 120,
  });

  const memory: string[] = config.memory ? settings.getAllMemorySources() : [];

  const skills: string[] = [];
  if (config.skills) {
    const projectSkillsDir = settings.getProjectSkillsDir();
    if (projectSkillsDir) skills.push(projectSkillsDir);
    skills.push(settings.getUserSkillsDir('cli'));
  }

  const agentParams = {
    model: resolveModelFromConfig({
      model: config.model,
      ...(config.apiKey !== undefined ? { apiKey: config.apiKey } : {}),
      ...(config.apiBaseUrl !== undefined ? { apiBaseUrl: config.apiBaseUrl } : {}),
    }),
    systemPrompt: config.systemPrompt ?? CLI_SYSTEM_PROMPT,
    backend,
    checkpointer: new MemorySaver(),
    ...(memory.length > 0 ? { memory } : {}),
    ...(skills.length > 0 ? { skills } : {}),
    ...(recording ? { recording } : {}),
  } as const;

  let close: (() => Promise<void>) | undefined;

  const agent = config.mcpServers
    ? await (async () => {
        const result = await createUniverseAgentAsync({
          ...agentParams,
          mcp: { servers: config.mcpServers! },
        });
        close = result.close;
        return result;
      })()
    : createUniverseAgent(agentParams);

  await backend.initialize();

  return { agent, backend, close };
}
