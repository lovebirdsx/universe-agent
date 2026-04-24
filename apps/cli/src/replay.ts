import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

import {
  type ManifestData,
  loadManifest,
  loadAgentRecording,
  type ModelTurn,
} from '@universe-agent/agent';
import { mapStoredMessagesToChatMessages } from '@langchain/core/messages';

import type { ReplayConfig } from './config/index.js';
import { createCliAgent } from './agent.js';
import { renderStream } from './renderer.js';
import { fmt } from './format.js';

export interface RecordingEntry {
  id: string;
  dirPath: string;
  manifest: ManifestData;
}

/**
 * 获取录像基目录路径。
 */
export function getRecordingsDir(projectDir: string): string {
  return path.join(projectDir, '.universe-agent', 'recordings');
}

/**
 * 扫描录像目录，返回所有有效录像条目（按创建时间倒序）。
 */
export function scanRecordings(recordingsDir: string): RecordingEntry[] {
  if (!fs.existsSync(recordingsDir)) {
    return [];
  }

  const entries: RecordingEntry[] = [];

  let items: string[];
  try {
    items = fs.readdirSync(recordingsDir);
  } catch {
    return [];
  }

  for (const item of items) {
    const dirPath = path.join(recordingsDir, item);

    let stat: fs.Stats;
    try {
      stat = fs.statSync(dirPath);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    const manifestPath = path.join(dirPath, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;

    try {
      const content = fs.readFileSync(manifestPath, 'utf-8');
      const manifest = JSON.parse(content) as ManifestData;
      entries.push({ id: manifest.id, dirPath, manifest });
    } catch {
      // 跳过无法解析的 manifest
    }
  }

  // 按创建时间倒序排列（最新在前）
  entries.sort((a, b) => {
    if (a.manifest.createdAt > b.manifest.createdAt) return -1;
    if (a.manifest.createdAt < b.manifest.createdAt) return 1;
    return 0;
  });

  return entries;
}

/**
 * 格式化录像状态。
 */
function formatStatus(status: ManifestData['status']): string {
  switch (status) {
    case 'completed':
      return fmt.green('completed');
    case 'error':
      return fmt.error('error');
    case 'recording':
      return fmt.dim('recording');
  }
}

/**
 * 截断 ID 用于显示。
 */
function truncateId(id: string, maxLen = 20): string {
  if (id.length <= maxLen) return id;
  return id.slice(0, maxLen) + '…';
}

/**
 * 交互式选择录像。返回选中的录像条目，或 null 表示取消。
 */
export async function selectRecording(entries: RecordingEntry[]): Promise<RecordingEntry | null> {
  console.log(fmt.bold('\n可用录像:'));
  console.log();

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const num = String(i + 1).padStart(3);
    const id = truncateId(entry.id).padEnd(22);
    const date = entry.manifest.createdAt;
    const status = formatStatus(entry.manifest.status);
    const turns = entry.manifest.sequence.length;
    console.log(
      `  ${fmt.bold(num)}. ${id} ${fmt.dim(date)}  ${status}  ${fmt.dim(`${String(turns)} turns`)}`,
    );
  }

  console.log();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise<RecordingEntry | null>((resolve) => {
    rl.question(`请选择录像 (1-${String(entries.length)})，输入 q 退出: `, (answer) => {
      rl.close();

      const trimmed = answer.trim().toLowerCase();
      if (trimmed === 'q' || trimmed === 'quit' || trimmed === 'exit') {
        resolve(null);
        return;
      }

      const index = parseInt(trimmed, 10);
      if (isNaN(index) || index < 1 || index > entries.length) {
        console.log(fmt.error('无效选择'));
        resolve(null);
        return;
      }

      resolve(entries[index - 1]!);
    });
  });
}

/**
 * 删除指定录像。
 */
export function deleteRecording(recordingsDir: string, id: string): boolean {
  const entries = scanRecordings(recordingsDir);
  const entry = entries.find((e) => e.id === id);
  if (!entry) {
    console.log(fmt.error(`未找到录像: ${id}`));
    return false;
  }

  fs.rmSync(entry.dirPath, { recursive: true, force: true });
  console.log(fmt.info(`已删除录像: ${id}`));
  return true;
}

/**
 * 处理 replay 子命令。
 */
export async function handleReplay(replayConfig: ReplayConfig): Promise<void> {
  const recordingsDir = getRecordingsDir(replayConfig.projectDir);

  // 扫描可用录像
  const entries = scanRecordings(recordingsDir);

  if (entries.length === 0) {
    console.log(fmt.info('没有可用的录像。使用 --record 选项来录制会话。'));
    return;
  }

  // 确定要播放的录像
  let selected: RecordingEntry | null | undefined;

  if (replayConfig.recordingId) {
    // 直接指定 ID
    selected = entries.find((e) => e.id === replayConfig.recordingId);
    if (!selected) {
      console.log(fmt.error(`未找到录像: ${replayConfig.recordingId}`));
      console.log(fmt.info('可用录像 ID:'));
      for (const entry of entries) {
        console.log(`  ${entry.id}`);
      }
      return;
    }
  } else {
    // 交互式选择
    selected = await selectRecording(entries);
    if (!selected) return;
  }

  // 播放录像
  console.log();
  console.log(fmt.bold(`播放录像: ${selected.id}`));
  console.log(
    fmt.dim(`创建时间: ${selected.manifest.createdAt}  状态: ${selected.manifest.status}`),
  );
  console.log();

  // 从录像中提取每轮用户消息
  const recordingDirPath = selected.dirPath;
  const manifest = loadManifest(recordingDirPath);
  const mainAgentName = manifest.sequence[0]?.agent || 'main'; // 默认主 agent 名称为 'main'
  const mainRecording = loadAgentRecording(recordingDirPath, mainAgentName);
  const modelTurns = mainRecording.turns.filter((t): t is ModelTurn => t.type === 'model');

  // 从 sequence 中找出主 agent 的 model 条目，提取每轮用户输入
  const mainModelEntries = manifest.sequence.filter(
    (s) => s.agent === mainAgentName && s.type !== 'tool',
  );

  // 收集每轮的用户消息（从 request 增量中提取 HumanMessage）
  interface ReplayTurn {
    userContent: string;
    turnIndex: number;
  }
  const replayTurns: ReplayTurn[] = [];

  for (const entry of mainModelEntries) {
    const turn = modelTurns.find((t) => t.index === entry.index);
    if (!turn) continue;

    // 从请求增量中提取用户消息
    const requestMessages = mapStoredMessagesToChatMessages(turn.request);
    const humanMessages = requestMessages.filter((m) => m.getType() === 'human');
    // 取最后一条用户消息作为本轮提示词
    const lastHuman = humanMessages[humanMessages.length - 1];
    if (!lastHuman) continue;

    const content = typeof lastHuman.content === 'string' ? lastHuman.content : '';
    if (!content) continue;

    // 只记录包含新用户输入的轮次（跳过工具调用后的模型续答）
    // 判断依据：如果这个 turn 的 request 中有 human 消息，说明是新一轮对话
    replayTurns.push({ userContent: content, turnIndex: entry.index });
  }

  // 去重：同一用户消息可能对应多个 model turn（工具调用后续答），只保留首次出现
  const seenContent = new Set<string>();
  const uniqueTurns: ReplayTurn[] = [];
  for (const t of replayTurns) {
    const key = `${String(t.turnIndex)}:${t.userContent}`;
    if (!seenContent.has(key)) {
      seenContent.add(key);
      uniqueTurns.push(t);
    }
  }

  const cliAgent = await createCliAgent(
    {
      model: 'replay', // replay 模式不使用真实模型
      projectDir: replayConfig.projectDir,
      memory: false,
      skills: false,
      verbose: replayConfig.verbose,
      record: false,
    },
    {
      mode: 'replay',
      path: recordingsDir,
      id: selected.id,
    },
  );

  try {
    for (const turn of uniqueTurns) {
      // 显示用户提示词
      console.log(fmt.bold(`> ${turn.userContent}`));
      console.log();

      const stream = await cliAgent.agent.stream(
        { messages: [{ role: 'user', content: turn.userContent }] },
        {
          streamMode: 'messages' as const,
          subgraphs: true,
          configurable: { thread_id: selected.id },
          recursionLimit: 10000,
        },
      );
      await renderStream(stream, { verbose: replayConfig.verbose });
      console.log();
    }
  } finally {
    await cliAgent.backend.close();
  }
}
