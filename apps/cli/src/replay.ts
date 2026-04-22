import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

import type { ManifestData } from '@universe-agent/agent';

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
    const stream = await cliAgent.agent.stream(
      { messages: [{ role: 'user', content: '' }] },
      {
        streamMode: 'messages' as const,
        subgraphs: true,
        recursionLimit: 10000,
      },
    );
    await renderStream(stream, { verbose: replayConfig.verbose });
  } finally {
    await cliAgent.backend.close();
  }
}
