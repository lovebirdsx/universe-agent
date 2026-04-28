import { Command } from 'commander';

export interface CliOptions {
  command: string;
  args: string[];
  workspace: string;
  protocol: boolean;
  verbose: boolean;
  permission: 'interactive' | 'auto-approve' | 'deny-all';
  mode: string | undefined;
  session: string | undefined;
  model: string | undefined;
  apiKey: string | undefined;
  baseUrl: string | undefined;
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name('universe-agent-acp-client')
    .description('用于调试与学习的 ACP 协议客户端')
    .version('0.0.0', '-v, --version', '显示版本信息')
    .helpOption('-h, --help', '显示帮助信息')
    .argument('[prompt...]', '单次提示词（省略则进入交互式 REPL）')
    .option('--command <cmd>', '要启动的服务端命令', 'tsx packages/acp/src/cli.ts --record')
    .option('--args <args>', '服务端命令的额外参数（逗号分隔）', '')
    .option('-w, --workspace <dir>', '工作区目录', process.cwd())
    .option('-P, --protocol', '启用协议观测模式（显示所有 JSON-RPC 消息）', false)
    .option('-V, --verbose', '在会话更新中显示详细内容', false)
    .option('--permission <mode>', '权限模式：interactive、auto-approve、deny-all', 'interactive')
    .option('--mode <mode>', '初始会话模式：agent、plan、ask')
    .option('--session <id>', '按 ID 加载已有会话')
    .option('-m, --model <model>', 'LLM 模型，支持 "provider:model" 格式（透传给 ACP 服务器）')
    .option('--api-key <key>', 'OpenAI-compatible provider 的 API Key（透传给 ACP 服务器）')
    .option('--base-url <url>', '自定义 API Base URL（透传给 ACP 服务器）');

  return program;
}

export function parseOptions(program: Command): {
  options: CliOptions;
  prompt: string | undefined;
} {
  const opts = program.opts();
  const promptParts = program.args as string[];
  const prompt = promptParts.length > 0 ? promptParts.join(' ') : undefined;

  const extraArgs = (opts['args'] as string)
    .split(',')
    .map((a: string) => a.trim())
    .filter(Boolean);

  return {
    options: {
      command: opts['command'] as string,
      args: extraArgs,
      workspace: opts['workspace'] as string,
      protocol: opts['protocol'] as boolean,
      verbose: opts['verbose'] as boolean,
      permission: opts['permission'] as CliOptions['permission'],
      mode: opts['mode'] as string | undefined,
      session: opts['session'] as string | undefined,
      model: opts['model'] as string | undefined,
      apiKey: opts['apiKey'] as string | undefined,
      baseUrl: opts['baseUrl'] as string | undefined,
    },
    prompt,
  };
}
