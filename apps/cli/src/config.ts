import type { CliArgs } from './cli.js';

export interface CliConfig {
  systemPrompt: string | undefined;
  projectDir: string;
  memory: boolean;
  skills: boolean;
  verbose: boolean;
}

export function loadConfig(args: CliArgs): CliConfig {
  const projectDir = args.project ?? process.cwd();

  return {
    systemPrompt: args.system,
    projectDir,
    memory: args.memory,
    skills: args.skills,
    verbose: args.verbose,
  };
}
