import pc from 'picocolors';

export const fmt = {
  // 基础格式化
  prompt: () => pc.green(pc.bold('> ')),
  toolName: (name: string) => pc.cyan(name),
  toolResult: (text: string) => pc.dim(text),
  error: (text: string) => pc.red(text),
  dim: (text: string) => pc.dim(text),
  info: (text: string) => pc.blue(text),
  bold: (text: string) => pc.bold(text),
  green: (text: string) => pc.green(text),
  yellow: (text: string) => pc.yellow(text),

  // 协议观测
  send: (text: string) => pc.green(text),
  recv: (text: string) => pc.blue(text),
  reqTag: () => pc.yellow('[REQ]'),
  resTag: () => pc.green('[RES]'),
  errTag: () => pc.red('[ERR]'),
  ntfTag: () => pc.cyan('[NTF]'),
  method: (m: string) => pc.white(pc.bold(m)),
  msgId: (id: string | number) => pc.dim(`#${id}`),
  timestamp: () => pc.dim(new Date().toISOString().slice(11, 23)),

  // 会话更新
  thought: (text: string) => pc.dim(text),

  // 工具状态图标
  toolStatus: {
    pending: pc.dim('\u25CB'),
    in_progress: pc.yellow('\u25CE'),
    completed: pc.green('\u2713'),
    failed: pc.red('\u2717'),
  } as Record<string, string>,

  // 计划状态图标
  plan: {
    pending: (text: string) => `  ${pc.dim('\u25CB')} ${text}`,
    in_progress: (text: string) => `  ${pc.yellow('\u25CE')} ${text}`,
    completed: (text: string) => `  ${pc.green('\u25CF')} ${text}`,
  } as Record<string, (text: string) => string>,

  // 权限提示
  permission: (text: string) => pc.yellow(pc.bold(text)),
};

// --- JSON 语法高亮 ---

/**
 * 将 JSON 字符串进行语法着色：
 *   key   → cyan
 *   string → green
 *   number/boolean/null → yellow
 */
export function colorizeJson(json: string): string {
  return json.replace(
    /("(?:\\.|[^"\\])*")\s*(:?)|(\b(?:true|false|null)\b)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (
      match,
      str: string | undefined,
      colon: string | undefined,
      literal: string | undefined,
      num: string | undefined,
    ) => {
      if (str) {
        return colon ? pc.cyan(str) + colon : pc.green(str);
      }
      if (literal) return pc.yellow(literal);
      if (num) return pc.yellow(num);
      return match;
    },
  );
}

const SPINNER_FRAMES = [
  '\u280B',
  '\u2819',
  '\u2839',
  '\u2838',
  '\u283C',
  '\u2834',
  '\u2826',
  '\u2827',
  '\u2807',
  '\u280F',
];

export function createSpinner(message: string) {
  let i = 0;
  const interval = setInterval(() => {
    const frame = SPINNER_FRAMES[i++ % SPINNER_FRAMES.length]!;
    process.stderr.write(`\r${pc.cyan(frame)} ${pc.dim(message)}`);
  }, 80);

  return {
    stop(finalMessage?: string) {
      clearInterval(interval);
      process.stderr.write(`\r${' '.repeat(message.length + 4)}\r`);
      if (finalMessage) {
        process.stderr.write(finalMessage + '\n');
      }
    },
  };
}
