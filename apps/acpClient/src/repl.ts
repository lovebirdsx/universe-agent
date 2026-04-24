import * as readline from 'node:readline';
import { fmt } from './format.js';
import { ACPClient } from './client.js';
import type { Renderer } from './renderer.js';

const HELP_TEXT = `
Available commands:
  /help                Show this help message
  /quit, /exit         Disconnect and exit
  /session new         Create a new session
  /session load <id>   Load an existing session
  /session info        Show current session info
  /mode <mode>         Switch mode (agent/plan/ask)
  /protocol            Toggle protocol inspector
  /verbose             Toggle verbose output
  /cancel              Cancel current prompt
  /clear               Clear terminal screen
`.trim();

export class Repl {
  private rl: readline.Interface;
  private client: ACPClient;
  private renderer: Renderer;
  private prompting = false;
  private closed = false;

  constructor(client: ACPClient, renderer: Renderer) {
    this.client = client;
    this.renderer = renderer;

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stderr,
      terminal: process.stdin.isTTY ?? false,
    });

    // 将 readline 共享给 client handler，用于权限确认提示
    this.client.getHandler().setReadline(this.rl);
  }

  async start(): Promise<void> {
    this.printBanner();
    this.promptLoop();

    // 等待连接关闭或 readline 关闭
    await new Promise<void>((resolve) => {
      this.rl.on('close', resolve);
      this.client.closed?.then(resolve);
    });
  }

  private printBanner(): void {
    const init = this.client.initResult;
    const agentName = init?.agentInfo?.name ?? 'unknown';
    const agentVersion = init?.agentInfo?.version ?? '';
    const sessionId = this.client.sessionId ?? 'none';

    process.stderr.write('\n');
    process.stderr.write(
      fmt.bold('ACP Client') + fmt.dim(` connected to ${agentName} ${agentVersion}`) + '\n',
    );
    process.stderr.write(fmt.dim(`Session: ${sessionId}\n`));
    process.stderr.write(fmt.dim('Type /help for available commands\n'));
    process.stderr.write('\n');
  }

  private promptLoop(): void {
    if (this.closed) return;
    this.rl.question(fmt.prompt(), async (input: string) => {
      const trimmed = input.trim();

      if (!trimmed) {
        this.promptLoop();
        return;
      }

      if (trimmed.startsWith('/')) {
        await this.handleSlashCommand(trimmed);
        this.promptLoop();
        return;
      }

      // 作为普通 prompt 发送
      this.prompting = true;
      try {
        const result = await this.client.prompt(trimmed);
        this.renderer.ensureNewline();
        process.stderr.write(fmt.dim(`[Stop reason: ${result.stopReason}]\n\n`));
      } catch (err) {
        this.renderer.ensureNewline();
        process.stderr.write(
          fmt.error(`Error: ${err instanceof Error ? err.message : String(err)}\n\n`),
        );
      } finally {
        this.prompting = false;
      }

      this.promptLoop();
    });
  }

  private async handleSlashCommand(input: string): Promise<void> {
    const parts = input.split(/\s+/);
    const cmd = parts[0]!.toLowerCase();

    switch (cmd) {
      case '/quit':
      case '/exit':
        this.closed = true;
        await this.client.disconnect();
        this.rl.close();
        break;

      case '/help':
        process.stderr.write(HELP_TEXT + '\n\n');
        break;

      case '/session':
        await this.handleSessionCommand(parts.slice(1));
        break;

      case '/mode': {
        const mode = parts[1];
        if (!mode) {
          process.stderr.write(fmt.error('Usage: /mode <agent|plan|ask>\n'));
          break;
        }
        try {
          await this.client.setMode(mode);
          process.stderr.write(fmt.info(`Mode set to: ${mode}\n`));
        } catch (err) {
          process.stderr.write(
            fmt.error(`Failed to set mode: ${err instanceof Error ? err.message : String(err)}\n`),
          );
        }
        break;
      }

      case '/protocol':
        this.renderer.protocol = !this.renderer.protocol;
        process.stderr.write(
          fmt.info(`Protocol inspector: ${this.renderer.protocol ? 'ON' : 'OFF'}\n`),
        );
        break;

      case '/verbose':
        this.renderer.verbose = !this.renderer.verbose;
        process.stderr.write(fmt.info(`Verbose mode: ${this.renderer.verbose ? 'ON' : 'OFF'}\n`));
        break;

      case '/cancel':
        if (this.prompting) {
          await this.client.cancel();
          process.stderr.write(fmt.info('Cancellation requested.\n'));
        } else {
          process.stderr.write(fmt.dim('No active prompt to cancel.\n'));
        }
        break;

      case '/clear':
        process.stderr.write('\x1B[2J\x1B[H');
        break;

      default:
        process.stderr.write(
          fmt.error(`Unknown command: ${cmd}. Type /help for available commands.\n`),
        );
    }
  }

  private async handleSessionCommand(args: string[]): Promise<void> {
    const subCmd = args[0]?.toLowerCase();

    switch (subCmd) {
      case 'new':
        try {
          const sessionId = await this.client.newSession();
          process.stderr.write(fmt.green(`New session created: ${sessionId}\n`));
        } catch (err) {
          process.stderr.write(
            fmt.error(
              `Failed to create session: ${err instanceof Error ? err.message : String(err)}\n`,
            ),
          );
        }
        break;

      case 'load': {
        const id = args[1];
        if (!id) {
          process.stderr.write(fmt.error('Usage: /session load <id>\n'));
          break;
        }
        try {
          const sessionId = await this.client.loadSession(id);
          process.stderr.write(fmt.green(`Session loaded: ${sessionId}\n`));
        } catch (err) {
          process.stderr.write(
            fmt.error(
              `Failed to load session: ${err instanceof Error ? err.message : String(err)}\n`,
            ),
          );
        }
        break;
      }

      case 'info':
        process.stderr.write(fmt.info(`Session ID: ${this.client.sessionId ?? 'none'}\n`));
        if (this.client.initResult) {
          const init = this.client.initResult;
          process.stderr.write(
            fmt.info(
              `Agent: ${init.agentInfo?.name ?? 'unknown'} ${init.agentInfo?.version ?? ''}\n`,
            ),
          );
        }
        break;

      default:
        process.stderr.write(fmt.error('Usage: /session <new|load <id>|info>\n'));
    }
  }
}
