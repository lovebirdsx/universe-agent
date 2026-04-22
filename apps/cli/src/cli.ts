import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import { Command } from 'commander';

function readVersion(): string {
  const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
  const pkgPath = path.resolve(__dirname, '..', 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { version: string };
  return pkg.version;
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name('universe-agent')
    .description('UniverseAgent CLI - AI编程助手')
    .version(readVersion())
    .argument('[prompt...]', '一次性提示（不提供则进入交互式 REPL）')
    .option('-s, --system <prompt>', '自定义系统提示')
    .option('-p, --project <dir>', '项目目录', process.cwd())
    .option('--no-memory', '禁用 AGENTS.md 记忆加载')
    .option('--no-skills', '禁用 skills 加载')
    .option('--verbose', '显示调试信息', false)
    .option('--model <model>', '模型名称')
    .option('--config <path>', '配置文件路径');

  return program;
}
