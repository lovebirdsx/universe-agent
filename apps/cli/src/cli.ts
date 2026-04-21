import { parseArgs } from 'node:util';

export interface CliArgs {
  system: string | undefined;
  project: string | undefined;
  memory: boolean;
  skills: boolean;
  verbose: boolean;
  help: boolean;
  version: boolean;
  prompt: string | undefined;
}

export function parseCliArgs(argv: string[] = process.argv.slice(2)): CliArgs {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      system: { type: 'string', short: 's' },
      project: { type: 'string', short: 'p' },
      memory: { type: 'boolean', default: true },
      'no-memory': { type: 'boolean' },
      skills: { type: 'boolean', default: true },
      'no-skills': { type: 'boolean' },
      verbose: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false, short: 'h' },
      version: { type: 'boolean', default: false, short: 'v' },
    },
    allowPositionals: true,
    strict: true,
  });

  return {
    system: values.system as string | undefined,
    project: values.project as string | undefined,
    memory: !values['no-memory'],
    skills: !values['no-skills'],
    verbose: values.verbose as boolean,
    help: values.help as boolean,
    version: values.version as boolean,
    prompt: positionals.length > 0 ? positionals.join(' ') : undefined,
  };
}

export function printHelp(): void {
  console.log(
    `
Usage: deepagent [options] [prompt]

Options:
  -s, --system <prompt>   自定义系统提示
  -p, --project <dir>     项目目录 (默认: 当前目录)
  --no-memory             禁用 AGENTS.md 记忆加载
  --no-skills             禁用 skills 加载
  --verbose               显示调试信息
  -h, --help              显示帮助
  -v, --version           显示版本

若提供 [prompt]，以 one-shot 模式运行；否则进入交互式 REPL。

REPL 命令:
  /quit, /exit            退出
  /clear                  新建会话
  /help                   显示帮助
  /model                  显示当前模型
`.trim(),
  );
}
