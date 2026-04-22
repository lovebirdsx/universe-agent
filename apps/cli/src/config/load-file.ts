import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parse } from 'jsonc-parser';

import { FileConfigSchema, type FileConfig } from './schema.js';

export interface LoadFileOptions {
  explicitPath?: string | undefined;
  projectDir: string;
}

export function loadConfigFile(options: LoadFileOptions): FileConfig | undefined {
  const candidates = buildCandidates(options);

  for (const filePath of candidates) {
    const content = readJsonFile(filePath);
    if (content !== undefined) {
      return FileConfigSchema.parse(content);
    }
  }

  return undefined;
}

function buildCandidates(options: LoadFileOptions): string[] {
  const candidates: string[] = [];

  if (options.explicitPath) {
    candidates.push(path.resolve(options.explicitPath));
    return candidates;
  }

  candidates.push(path.join(options.projectDir, '.universe-agent', 'config.json'));
  candidates.push(path.join(os.homedir(), '.universe-agent', 'config.json'));

  return candidates;
}

function readJsonFile(filePath: string): unknown | undefined {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return parse(raw) as unknown;
  } catch {
    return undefined;
  }
}
