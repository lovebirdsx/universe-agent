import { describe, it, expect } from 'vitest';

import { createConfig } from '../createConfig.js';

/** 从 ConfigResult 中取出 default 模式下的 config */
function defaultConfig(argv: string[], env: Record<string, string | undefined> = {}) {
  const result = createConfig({ argv, env });
  expect(result.command).toBe('default');
  if (result.command !== 'default') throw new Error('unexpected');
  return result.config;
}

describe('createConfig', () => {
  const baseArgv = ['node', 'universe-agent'];

  it('applies defaults when no args or env provided', () => {
    const config = defaultConfig(baseArgv);

    expect(config.model).toBe('anthropic:claude-sonnet-4-6');
    expect(config.memory).toBe(true);
    expect(config.skills).toBe(true);
    expect(config.verbose).toBe(false);
    expect(config.record).toBe(false);
    expect(config.prompt).toBeUndefined();
  });

  it('captures prompt from positional args', () => {
    const config = defaultConfig([...baseArgv, 'hello', 'world']);

    expect(config.prompt).toBe('hello world');
  });

  it('reads model from env var', () => {
    const config = defaultConfig(baseArgv, { OPENAI_MODEL: 'gpt-4o' });

    expect(config.model).toBe('gpt-4o');
  });

  it('reads API config from env vars', () => {
    const config = defaultConfig(baseArgv, {
      OPENAI_API_KEY: 'sk-test',
      OPENAI_API_BASEURL: 'https://api.example.com',
    });

    expect(config.apiKey).toBe('sk-test');
    expect(config.apiBaseUrl).toBe('https://api.example.com');
  });

  it('CLI args override env vars', () => {
    const config = defaultConfig([...baseArgv, '--model', 'cli-model'], {
      OPENAI_MODEL: 'env-model',
    });

    expect(config.model).toBe('cli-model');
  });

  it('handles --no-memory flag', () => {
    const config = defaultConfig([...baseArgv, '--no-memory']);

    expect(config.memory).toBe(false);
  });

  it('handles --no-skills flag', () => {
    const config = defaultConfig([...baseArgv, '--no-skills']);

    expect(config.skills).toBe(false);
  });

  it('handles --verbose flag', () => {
    const config = defaultConfig([...baseArgv, '--verbose']);

    expect(config.verbose).toBe(true);
  });

  it('handles --system flag', () => {
    const config = defaultConfig([...baseArgv, '--system', 'Custom prompt']);

    expect(config.systemPrompt).toBe('Custom prompt');
  });

  it('handles --project flag', () => {
    const config = defaultConfig([...baseArgv, '--project', '/custom/dir']);

    expect(config.projectDir).toBe('/custom/dir');
  });

  it('env var for tavily key', () => {
    const config = defaultConfig(baseArgv, { TAVILY_API_KEY: 'tvly-test' });

    expect(config.tavilyApiKey).toBe('tvly-test');
  });

  it('handles --record flag', () => {
    const config = defaultConfig([...baseArgv, '--record']);

    expect(config.record).toBe(true);
  });
});

describe('createConfig merge priority', () => {
  const baseArgv = ['node', 'universe-agent'];

  it('env vars override file defaults (via schema defaults)', () => {
    const config = defaultConfig(baseArgv, { OPENAI_MODEL: 'env-override' });

    expect(config.model).toBe('env-override');
  });

  it('CLI args have highest priority', () => {
    const config = defaultConfig([...baseArgv, '--model', 'cli-highest', '--verbose'], {
      OPENAI_MODEL: 'env-model',
    });

    expect(config.model).toBe('cli-highest');
    expect(config.verbose).toBe(true);
  });
});

describe('createConfig --replay option', () => {
  const baseArgv = ['node', 'universe-agent'];

  it('parses --replay without id', () => {
    const result = createConfig({ argv: [...baseArgv, '--replay'], env: {} });

    expect(result.command).toBe('replay');
    if (result.command !== 'replay') throw new Error('unexpected');
    expect(result.replayConfig.recordingId).toBeUndefined();
    expect(result.replayConfig.verbose).toBe(false);
  });

  it('parses --replay with id', () => {
    const result = createConfig({
      argv: [...baseArgv, '--replay', 'test-id'],
      env: {},
    });

    expect(result.command).toBe('replay');
    if (result.command !== 'replay') throw new Error('unexpected');
    expect(result.replayConfig.recordingId).toBe('test-id');
  });

  it('parses --replay with --verbose', () => {
    const result = createConfig({
      argv: [...baseArgv, '--replay', '--verbose'],
      env: {},
    });

    expect(result.command).toBe('replay');
    if (result.command !== 'replay') throw new Error('unexpected');
    expect(result.replayConfig.verbose).toBe(true);
  });
});
