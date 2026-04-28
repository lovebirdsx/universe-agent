import { spawn, type ChildProcess } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import fs from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';
import * as readline from 'node:readline';
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type Client,
  type Agent,
  type AnyMessage,
  type Stream,
  type SessionNotification,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type ReadTextFileRequest,
  type ReadTextFileResponse,
  type WriteTextFileRequest,
  type WriteTextFileResponse,
  type CreateTerminalRequest,
  type CreateTerminalResponse,
  type TerminalOutputRequest,
  type TerminalOutputResponse,
  type WaitForTerminalExitRequest,
  type WaitForTerminalExitResponse,
  type KillTerminalRequest,
  type KillTerminalResponse,
  type ReleaseTerminalRequest,
  type ReleaseTerminalResponse,
  type InitializeResponse,
  RequestError,
} from '@agentclientprotocol/sdk';
import { Renderer } from './renderer.js';
import { fmt } from './format.js';
import type { CliOptions } from './cli.js';

// --- 流拦截与观测 ---

export function instrumentStream(
  baseStream: Stream,
  onMessage: (direction: 'send' | 'recv', msg: AnyMessage) => void,
): Stream {
  // 监听可读流（agent -> client）
  const readTap = new TransformStream<AnyMessage, AnyMessage>({
    transform(msg, controller) {
      onMessage('recv', msg);
      controller.enqueue(msg);
    },
  });

  // 监听可写流（client -> agent）
  const writeTap = new TransformStream<AnyMessage, AnyMessage>({
    transform(msg, controller) {
      onMessage('send', msg);
      controller.enqueue(msg);
    },
  });

  baseStream.readable.pipeTo(readTap.writable).catch(() => {});
  writeTap.readable.pipeTo(baseStream.writable).catch(() => {});

  return {
    readable: readTap.readable,
    writable: writeTap.writable,
  };
}

// --- 终端管理 ---

interface ManagedTerminal {
  process: ChildProcess;
  output: string;
  exitCode: number | null;
  exitSignal: string | null;
  exited: boolean;
  exitPromise: Promise<void>;
}

// --- ACP Client Handler（Client 接口实现）---

export class ACPClientHandler implements Client {
  private renderer: Renderer;
  private options: CliOptions;
  private terminals = new Map<string, ManagedTerminal>();
  private nextTerminalId = 1;
  private rl: readline.Interface | null = null;

  constructor(renderer: Renderer, options: CliOptions) {
    this.renderer = renderer;
    this.options = options;
  }

  setReadline(rl: readline.Interface): void {
    this.rl = rl;
  }

  async sessionUpdate(params: SessionNotification): Promise<void> {
    this.renderer.renderSessionUpdate(params);
  }

  async requestPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    const { permission } = this.options;

    if (permission === 'auto-approve') {
      const allow = params.options.find((o) => o.kind.startsWith('allow'));
      return {
        outcome: {
          outcome: 'selected',
          optionId: allow?.optionId ?? params.options[0]!.optionId,
        },
      };
    }

    if (permission === 'deny-all') {
      const reject = params.options.find((o) => o.kind.startsWith('reject'));
      return {
        outcome: {
          outcome: 'selected',
          optionId: reject?.optionId ?? params.options[0]!.optionId,
        },
      };
    }

    // 交互确认模式
    return this.promptForPermission(params);
  }

  private promptForPermission(
    params: RequestPermissionRequest,
  ): Promise<RequestPermissionResponse> {
    return new Promise((resolve) => {
      const toolCall = params.toolCall;
      process.stderr.write('\n');
      process.stderr.write(
        fmt.permission(`[Permission Required] `) + (toolCall.title ?? toolCall.toolCallId) + '\n',
      );

      if (toolCall.rawInput) {
        process.stderr.write(fmt.dim(`  Input: ${JSON.stringify(toolCall.rawInput)}`) + '\n');
      }

      for (let i = 0; i < params.options.length; i++) {
        const opt = params.options[i]!;
        process.stderr.write(`  ${i + 1}) ${opt.name} (${opt.kind})\n`);
      }

      const askChoice = () => {
        if (this.rl) {
          this.rl.question(fmt.permission('Choice [1]: '), (answer: string) => {
            const idx = answer.trim() === '' ? 0 : parseInt(answer, 10) - 1;
            const selected = params.options[idx];
            if (!selected) {
              process.stderr.write(fmt.error('Invalid choice, try again.\n'));
              askChoice();
              return;
            }
            resolve({
              outcome: {
                outcome: 'selected',
                optionId: selected.optionId,
              },
            });
          });
        } else {
          // 兜底：如果没有 readline，则自动批准
          const allow = params.options.find((o) => o.kind.startsWith('allow'));
          resolve({
            outcome: {
              outcome: 'selected',
              optionId: allow?.optionId ?? params.options[0]!.optionId,
            },
          });
        }
      };

      askChoice();
    });
  }

  async readTextFile(params: ReadTextFileRequest): Promise<ReadTextFileResponse> {
    const filePath = resolveFilePath(params.path, this.options.workspace);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return { content };
    } catch {
      throw RequestError.resourceNotFound(params.path);
    }
  }

  async writeTextFile(params: WriteTextFileRequest): Promise<WriteTextFileResponse> {
    const filePath = resolveFilePath(params.path, this.options.workspace);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, params.content, 'utf-8');
    if (this.renderer.verbose) {
      process.stderr.write(
        fmt.dim(`[File written] ${filePath} (${params.content.length} bytes)\n`),
      );
    }
    return {};
  }

  async createTerminal(params: CreateTerminalRequest): Promise<CreateTerminalResponse> {
    const id = `term_${this.nextTerminalId++}`;
    const args = params.args ?? [];
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) env[k] = v;
    }
    if (params.env) {
      for (const envVar of params.env) {
        env[envVar.name] = envVar.value;
      }
    }
    const child = spawn(params.command, args, {
      cwd: params.cwd ?? this.options.workspace,
      env,
      shell: true,
    });

    let exitResolve: () => void;
    const exitPromise = new Promise<void>((r) => {
      exitResolve = r;
    });

    const terminal: ManagedTerminal = {
      process: child,
      output: '',
      exitCode: null,
      exitSignal: null,
      exited: false,
      exitPromise,
    };

    child.stdout?.on('data', (data: Buffer) => {
      terminal.output += data.toString();
    });
    child.stderr?.on('data', (data: Buffer) => {
      terminal.output += data.toString();
    });
    child.on('exit', (code, signal) => {
      terminal.exitCode = code;
      terminal.exitSignal = signal;
      terminal.exited = true;
      exitResolve!();
    });

    this.terminals.set(id, terminal);
    return { terminalId: id };
  }

  async terminalOutput(params: TerminalOutputRequest): Promise<TerminalOutputResponse> {
    const terminal = this.terminals.get(params.terminalId);
    if (!terminal) throw RequestError.resourceNotFound(params.terminalId);

    const result: TerminalOutputResponse = {
      output: terminal.output,
      truncated: false,
    };
    if (terminal.exited) {
      result.exitStatus = {
        exitCode: terminal.exitCode,
        signal: terminal.exitSignal,
      };
    }
    return result;
  }

  async waitForTerminalExit(
    params: WaitForTerminalExitRequest,
  ): Promise<WaitForTerminalExitResponse> {
    const terminal = this.terminals.get(params.terminalId);
    if (!terminal) throw RequestError.resourceNotFound(params.terminalId);

    await terminal.exitPromise;
    return {
      exitCode: terminal.exitCode,
      signal: terminal.exitSignal,
    };
  }

  async killTerminal(params: KillTerminalRequest): Promise<KillTerminalResponse> {
    const terminal = this.terminals.get(params.terminalId);
    if (!terminal) throw RequestError.resourceNotFound(params.terminalId);

    if (!terminal.exited) {
      terminal.process.kill();
    }
    return {};
  }

  async releaseTerminal(params: ReleaseTerminalRequest): Promise<ReleaseTerminalResponse> {
    const terminal = this.terminals.get(params.terminalId);
    if (!terminal) return {};

    if (!terminal.exited) {
      terminal.process.kill();
    }
    this.terminals.delete(params.terminalId);
    return {};
  }

  cleanup(): void {
    for (const [, terminal] of this.terminals) {
      if (!terminal.exited) {
        terminal.process.kill();
      }
    }
    this.terminals.clear();
  }
}

// --- ACP Client（高层编排器）---

export class ACPClient {
  private child: ChildProcess | null = null;
  private connection: ClientSideConnection | null = null;
  private handler: ACPClientHandler;
  private renderer: Renderer;
  private options: CliOptions;

  sessionId: string | null = null;
  initResult: InitializeResponse | null = null;

  constructor(renderer: Renderer, options: CliOptions) {
    this.renderer = renderer;
    this.options = options;
    this.handler = new ACPClientHandler(renderer, options);
  }

  getHandler(): ACPClientHandler {
    return this.handler;
  }

  async connect(): Promise<void> {
    const { command, args, workspace, model, apiKey, baseUrl } = this.options;

    // 解析命令为可执行程序与初始参数
    const parts = command.split(/\s+/);
    const program = parts[0]!;
    const cmdArgs = [...parts.slice(1), ...args];

    // 若未指定 workspace 参数则自动补充
    if (!cmdArgs.includes('--workspace') && !cmdArgs.includes('-w')) {
      cmdArgs.push('--workspace', workspace);
    }

    // 透传模型参数给 ACP 服务器（仅在未包含在 --command 或 --args 中时注入）
    if (model && !cmdArgs.includes('--model') && !cmdArgs.includes('-m')) {
      cmdArgs.push('--model', model);
    }
    if (apiKey && !cmdArgs.includes('--api-key')) {
      cmdArgs.push('--api-key', apiKey);
    }
    if (baseUrl && !cmdArgs.includes('--base-url')) {
      cmdArgs.push('--base-url', baseUrl);
    }

    // 推断 monorepo 根目录（apps/acp-client/src/../../../）
    const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
    const monorepoRoot = path.resolve(__dirname, '..', '..', '..');

    this.child = spawn(program, cmdArgs, {
      stdio: ['pipe', 'pipe', 'inherit'],
      shell: true,
      cwd: monorepoRoot,
    });

    this.child.on('error', (err) => {
      process.stderr.write(fmt.error(`Server process error: ${err.message}\n`));
    });

    this.child.on('exit', (code) => {
      if (code !== null && code !== 0) {
        process.stderr.write(fmt.error(`Server process exited with code ${code}\n`));
      }
    });

    // 基于子进程 stdio 构建传输流
    const input = Readable.toWeb(this.child.stdout!) as ReadableStream<Uint8Array>;
    const output = Writable.toWeb(this.child.stdin!) as WritableStream<Uint8Array>;

    let baseStream = ndJsonStream(output, input);

    // 注入流拦截以便协议观测
    baseStream = instrumentStream(baseStream, (direction, msg) => {
      this.renderer.renderProtocolMessage(direction, msg);
    });

    // 创建客户端连接
    this.connection = new ClientSideConnection((_agent: Agent) => this.handler, baseStream);
  }

  async initialize(): Promise<InitializeResponse> {
    if (!this.connection) throw new Error('Not connected');

    const result = await this.connection.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientInfo: {
        name: 'universe-agent-acp-client',
        version: '0.0.0',
      },
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true,
      },
    });

    this.initResult = result;
    return result;
  }

  async newSession(): Promise<string> {
    if (!this.connection) throw new Error('Not connected');

    const result = await this.connection.newSession({
      cwd: this.options.workspace,
      mcpServers: [],
    });

    this.sessionId = result.sessionId;
    return result.sessionId;
  }

  async loadSession(sessionId: string): Promise<string> {
    if (!this.connection) throw new Error('Not connected');

    const result = await this.connection.loadSession({
      sessionId,
      cwd: this.options.workspace,
      mcpServers: [],
    });

    this.sessionId = result.sessionId;
    return result.sessionId;
  }

  async prompt(text: string): Promise<{ stopReason: string }> {
    if (!this.connection || !this.sessionId) {
      throw new Error('No active session');
    }

    const result = await this.connection.prompt({
      sessionId: this.sessionId,
      prompt: [{ type: 'text', text }],
    });

    return { stopReason: result.stopReason };
  }

  async cancel(): Promise<void> {
    if (!this.connection || !this.sessionId) return;
    await this.connection.cancel({ sessionId: this.sessionId });
  }

  async setMode(mode: string): Promise<void> {
    if (!this.connection || !this.sessionId) {
      throw new Error('No active session');
    }

    await this.connection.setSessionMode({
      sessionId: this.sessionId,
      mode,
    });
  }

  async disconnect(): Promise<void> {
    this.handler.cleanup();
    if (this.child) {
      this.child.kill();
      this.child = null;
    }
    this.connection = null;
    this.sessionId = null;
  }

  get closed(): Promise<void> | undefined {
    return this.connection?.closed;
  }
}

// --- 工具函数 ---

function resolveFilePath(filePath: string, workspace: string): string {
  if (path.isAbsolute(filePath)) return filePath;
  // 处理 file:// URI
  if (filePath.startsWith('file://')) {
    return new URL(filePath).pathname;
  }
  return path.resolve(workspace, filePath);
}
