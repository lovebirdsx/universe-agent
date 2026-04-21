import { createDeepAgent, LocalShellBackend, createSettings } from '@universe-agent/agent';
import { MemorySaver } from '@langchain/langgraph';

import type { CliConfig } from './config.js';

const CLI_SYSTEM_PROMPT = `You are DeepAgent, a helpful AI coding assistant running in a terminal CLI.
You have access to the user's project filesystem and can execute shell commands.

Guidelines:
- Be concise and direct in your responses
- When the user asks you to modify code, read the relevant files first
- Use the execute tool for running shell commands (build, test, git, etc.)
- Use edit_file for surgical changes, write_file for creating new files
- Explain what you're doing briefly before taking actions
- If a task is ambiguous, ask for clarification`;

export interface CliAgent {
  agent: ReturnType<typeof createDeepAgent>;
  backend: LocalShellBackend;
}

export async function createCliAgent(config: CliConfig): Promise<CliAgent> {
  const settings = createSettings({ startPath: config.projectDir });

  const backend = new LocalShellBackend({
    rootDir: config.projectDir,
    inheritEnv: true,
    timeout: 120,
  });

  const memory: string[] = [];
  if (config.memory) {
    const projectAgentMd = settings.getProjectAgentMdPath();
    if (projectAgentMd) memory.push(projectAgentMd);
    memory.push(settings.getUserAgentMdPath('cli'));
  }

  const skills: string[] = [];
  if (config.skills) {
    const projectSkillsDir = settings.getProjectSkillsDir();
    if (projectSkillsDir) skills.push(projectSkillsDir);
    skills.push(settings.getUserSkillsDir('cli'));
  }

  const agent = createDeepAgent({
    systemPrompt: config.systemPrompt ?? CLI_SYSTEM_PROMPT,
    backend,
    checkpointer: new MemorySaver(),
    ...(memory.length > 0 ? { memory } : {}),
    ...(skills.length > 0 ? { skills } : {}),
  });

  await backend.initialize();

  return { agent, backend };
}
