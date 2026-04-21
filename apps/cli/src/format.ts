import pc from 'picocolors';

export const fmt = {
  prompt: () => pc.green(pc.bold('> ')),
  toolName: (name: string) => pc.cyan(name),
  toolResult: (text: string) => pc.dim(text),
  error: (text: string) => pc.red(text),
  subagent: (name: string) => pc.magenta(`[${name}]`),
  dim: (text: string) => pc.dim(text),
  info: (text: string) => pc.blue(text),
  bold: (text: string) => pc.bold(text),
  green: (text: string) => pc.green(text),
};

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
