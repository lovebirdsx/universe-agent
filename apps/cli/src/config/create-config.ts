import { CommanderError } from 'commander';

import { createProgram } from '../cli.js';
import {
  CliConfigSchema,
  ReplayConfigSchema,
  type CliConfig,
  type ReplayConfig,
} from './schema.js';
import { loadConfigFile } from './loadFile.js';

export interface ConfigSources {
  argv?: string[];
  env?: Record<string, string | undefined>;
  configPath?: string;
}

export type ConfigResult =
  | { command: 'default'; config: CliConfig & { prompt: string | undefined } }
  | { command: 'replay'; replayConfig: ReplayConfig };

export function createConfig(sources: ConfigSources = {}): ConfigResult {
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
    record: boolean;
    replay?: string | true;
  }>();

  // 2. --replay 模式
  if (opts.replay !== undefined) {
    const replayConfig = ReplayConfigSchema.parse({
      projectDir: opts.project,
      recordingId: typeof opts.replay === 'string' ? opts.replay : undefined,
      verbose: opts.verbose,
    });
    return { command: 'replay', replayConfig };
  }

  const promptArgs = program.args;

  // 3. 确定项目目录（CLI > cwd）
  const projectDir = opts.project;

  // 4. 加载配置文件
  const fileConfig = loadConfigFile({
    explicitPath: sources.configPath ?? opts.config,
    projectDir,
  });

  // 5. 将环境变量映射到配置形状
  const envVarConfig = stripUndefined({
    model: env.OPENAI_MODEL,
    apiKey: env.OPENAI_API_KEY,
    apiBaseUrl: env.OPENAI_API_BASEURL,
    tavilyApiKey: env.TAVILY_API_KEY,
  });

  // 6. 将 CLI 选项映射到配置形状（仅包括用户显式设置的值，排除默认值）
  const explicit = (name: string) => program.getOptionValueSource(name) !== 'default';

  const cliConfig = stripUndefined({
    model: explicit('model') ? opts.model : undefined,
    systemPrompt: explicit('system') ? opts.system : undefined,
    projectDir,
    memory: explicit('memory') ? opts.memory : undefined,
    skills: explicit('skills') ? opts.skills : undefined,
    verbose: explicit('verbose') ? opts.verbose : undefined,
    record: explicit('record') ? opts.record : undefined,
  });

  // 7. 合并：defaults < file < envVars < cli
  const merged = {
    ...stripUndefined(fileConfig ?? {}),
    ...envVarConfig,
    ...cliConfig,
  };

  // 8. 使用 Zod 验证
  const config = CliConfigSchema.parse(merged);

  return {
    command: 'default',
    config: {
      ...config,
      prompt: promptArgs.length > 0 ? promptArgs.join(' ') : undefined,
    },
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
