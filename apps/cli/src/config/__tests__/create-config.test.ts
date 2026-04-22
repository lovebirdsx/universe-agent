import { describe, it, expect } from 'vitest';

import { createConfig } from '../create-config.js';

describe('createConfig', () => {
  const baseArgv = ['node', 'deepagent'];

  it('applies defaults when no args or env provided', () => {
    const config = createConfig({ argv: baseArgv, env: {} });

    expect(config.model).toBe('anthropic:claude-sonnet-4-6');
    expect(config.memory).toBe(true);
    expect(config.skills).toBe(true);
    expect(config.verbose).toBe(false);
    expect(config.prompt).toBeUndefined();
  });

  it('captures prompt from positional args', () => {
    const config = createConfig({
      argv: [...baseArgv, 'hello', 'world'],
      env: {},
    });

    expect(config.prompt).toBe('hello world');
  });

  it('reads model from env var', () => {
    const config = createConfig({
      argv: baseArgv,
      env: { OPENAI_MODEL: 'gpt-4o' },
    });

    expect(config.model).toBe('gpt-4o');
  });

  it('reads API config from env vars', () => {
    const config = createConfig({
      argv: baseArgv,
      env: {
        OPENAI_API_KEY: 'sk-test',
        OPENAI_API_BASEURL: 'https://api.example.com',
      },
    });

    expect(config.apiKey).toBe('sk-test');
    expect(config.apiBaseUrl).toBe('https://api.example.com');
  });

  it('CLI args override env vars', () => {
    const config = createConfig({
      argv: [...baseArgv, '--model', 'cli-model'],
      env: { OPENAI_MODEL: 'env-model' },
    });

    expect(config.model).toBe('cli-model');
  });

  it('handles --no-memory flag', () => {
    const config = createConfig({
      argv: [...baseArgv, '--no-memory'],
      env: {},
    });

    expect(config.memory).toBe(false);
  });

  it('handles --no-skills flag', () => {
    const config = createConfig({
      argv: [...baseArgv, '--no-skills'],
      env: {},
    });

    expect(config.skills).toBe(false);
  });

  it('handles --verbose flag', () => {
    const config = createConfig({
      argv: [...baseArgv, '--verbose'],
      env: {},
    });

    expect(config.verbose).toBe(true);
  });

  it('handles --system flag', () => {
    const config = createConfig({
      argv: [...baseArgv, '--system', 'Custom prompt'],
      env: {},
    });

    expect(config.systemPrompt).toBe('Custom prompt');
  });

  it('handles --project flag', () => {
    const config = createConfig({
      argv: [...baseArgv, '--project', '/custom/dir'],
      env: {},
    });

    expect(config.projectDir).toBe('/custom/dir');
  });

  it('env var for tavily key', () => {
    const config = createConfig({
      argv: baseArgv,
      env: { TAVILY_API_KEY: 'tvly-test' },
    });

    expect(config.tavilyApiKey).toBe('tvly-test');
  });
});

describe('createConfig merge priority', () => {
  const baseArgv = ['node', 'deepagent'];

  it('env vars override file defaults (via schema defaults)', () => {
    // Schema default for model is 'anthropic:claude-sonnet-4-6'
    // Env var should override it
    const config = createConfig({
      argv: baseArgv,
      env: { OPENAI_MODEL: 'env-override' },
    });

    expect(config.model).toBe('env-override');
  });

  it('CLI args have highest priority', () => {
    const config = createConfig({
      argv: [...baseArgv, '--model', 'cli-highest', '--verbose'],
      env: { OPENAI_MODEL: 'env-model' },
    });

    expect(config.model).toBe('cli-highest');
    expect(config.verbose).toBe(true);
  });
});
