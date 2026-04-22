import { createProgram } from '../cli.js';
import { CliConfigSchema, type CliConfig } from './schema.js';
import { loadConfigFile } from './load-file.js';

export interface ConfigSources {
  argv?: string[];
  env?: Record<string, string | undefined>;
  configPath?: string;
}

export function createConfig(
  sources: ConfigSources = {},
): CliConfig & { prompt: string | undefined } {
  const env = sources.env ?? (process.env as Record<string, string | undefined>);
  const argv = sources.argv ?? process.argv;

  // 1. Parse CLI args via Commander
  const program = createProgram();
  program.exitOverride();
  program.configureOutput({
    writeOut: () => {},
    writeErr: () => {},
  });
  program.parse(argv);
  const opts = program.opts<{
    system?: string;
    project: string;
    memory: boolean;
    skills: boolean;
    verbose: boolean;
    model?: string;
    config?: string;
  }>();
  const promptArgs = program.args;

  // 2. Determine project dir (CLI > cwd)
  const projectDir = opts.project;

  // 3. Load config file
  const fileConfig = loadConfigFile({
    explicitPath: sources.configPath ?? opts.config,
    projectDir,
  });

  // 4. Map env vars to config shape
  const envVarConfig = stripUndefined({
    model: env.OPENAI_MODEL,
    apiKey: env.OPENAI_API_KEY,
    apiBaseUrl: env.OPENAI_API_BASEURL,
    tavilyApiKey: env.TAVILY_API_KEY,
  });

  // 5. Map CLI opts to config shape (only include explicitly set values)
  const cliConfig = stripUndefined({
    model: opts.model,
    systemPrompt: opts.system,
    projectDir,
    memory: opts.memory,
    skills: opts.skills,
    verbose: opts.verbose,
  });

  // 6. Merge: defaults < file < envVars < cli
  const merged = {
    ...stripUndefined(fileConfig ?? {}),
    ...envVarConfig,
    ...cliConfig,
  };

  // 7. Validate with Zod
  const config = CliConfigSchema.parse(merged);

  return {
    ...config,
    prompt: promptArgs.length > 0 ? promptArgs.join(' ') : undefined,
  };
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result as Partial<T>;
}
