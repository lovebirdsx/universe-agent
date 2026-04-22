import { CommanderError } from 'commander';

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

  // 1. 使用 Commander 解析 CLI 参数
  const program = createProgram();
  program.exitOverride();
  program.configureOutput({
    writeOut: () => {},
    writeErr: () => {},
  });

  // 处理 --help 和 --version 输出
  try {
    program.parse(argv);
  } catch (err) {
    if (err instanceof CommanderError && err.code === 'commander.helpDisplayed') {
      console.log(program.helpInformation());
      process.exit(0);
    }
    if (err instanceof CommanderError && err.code === 'commander.version') {
      console.log(program.version());
      process.exit(0);
    }
    throw err;
  }

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

  // 2. 确定项目目录（CLI > cwd）
  const projectDir = opts.project;

  // 3. 加载配置文件
  const fileConfig = loadConfigFile({
    explicitPath: sources.configPath ?? opts.config,
    projectDir,
  });

  // 4. 将环境变量映射到配置形状
  const envVarConfig = stripUndefined({
    model: env.OPENAI_MODEL,
    apiKey: env.OPENAI_API_KEY,
    apiBaseUrl: env.OPENAI_API_BASEURL,
    tavilyApiKey: env.TAVILY_API_KEY,
  });

  // 5. 将 CLI 选项映射到配置形状（仅包括显式设置的值）
  const cliConfig = stripUndefined({
    model: opts.model,
    systemPrompt: opts.system,
    projectDir,
    memory: opts.memory,
    skills: opts.skills,
    verbose: opts.verbose,
  });

  // 6. 合并：defaults < file < envVars < cli
  const merged = {
    ...stripUndefined(fileConfig ?? {}),
    ...envVarConfig,
    ...cliConfig,
  };

  // 7. 使用 Zod 验证
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
