import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { loadConfigFile } from '../loadFile.js';

vi.mock('node:fs');

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('loadConfigFile', () => {
  it('returns undefined when no config file exists', () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('ENOENT');
    });

    const result = loadConfigFile({ projectDir: '/project' });
    expect(result).toBeUndefined();
  });

  it('loads config from explicit path', () => {
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ model: 'gpt-4o', verbose: true }));

    const result = loadConfigFile({
      explicitPath: '/custom/config.json',
      projectDir: '/project',
    });

    expect(result).toEqual({ model: 'gpt-4o', verbose: true });
    expect(fs.readFileSync).toHaveBeenCalledWith(path.resolve('/custom/config.json'), 'utf-8');
  });

  it('searches project dir then home dir', () => {
    const calls: string[] = [];
    vi.mocked(fs.readFileSync).mockImplementation((filePath) => {
      calls.push(filePath as string);
      if ((filePath as string).includes('.universe-agent')) {
        if ((filePath as string).includes('/project/')) {
          throw new Error('ENOENT');
        }
        return JSON.stringify({ verbose: true });
      }
      throw new Error('ENOENT');
    });

    const result = loadConfigFile({ projectDir: '/project' });

    expect(calls[0]).toBe(path.join('/project', '.universe-agent', 'config.json'));
    expect(result).toEqual({ verbose: true });
  });

  it('returns first found config file', () => {
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ model: 'project-model' }));

    const result = loadConfigFile({ projectDir: '/project' });

    expect(result).toEqual({ model: 'project-model' });
    // 应该用第一个候选路径调用（找到后即停止）
    expect(fs.readFileSync).toHaveBeenCalledWith(
      path.join('/project', '.universe-agent', 'config.json'),
      'utf-8',
    );
  });

  it('validates config against schema', () => {
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ verbose: 'not-a-boolean' }));

    expect(() =>
      loadConfigFile({ explicitPath: '/config.json', projectDir: '/project' }),
    ).toThrow();
  });

  it('handles malformed JSON gracefully', () => {
    vi.mocked(fs.readFileSync).mockReturnValue('# invalid json }');

    const result = loadConfigFile({ projectDir: '/project' });
    // readJsonFile 捕获解析错误并返回 undefined，因此它会继续
    expect(result).toBeUndefined();
  });

  it('handles JSONC with comments gracefully', () => {
    vi.mocked(fs.readFileSync).mockReturnValue(`{
      // This is a comment
      "model": "gpt-4o"
    }`);

    const result = loadConfigFile({ projectDir: '/project' });
    expect(result).toEqual({ model: 'gpt-4o' });
  });
});
