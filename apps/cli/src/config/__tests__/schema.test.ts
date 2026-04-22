import { describe, it, expect } from 'vitest';

import { CliConfigSchema, FileConfigSchema } from '../schema.js';

describe('FileConfigSchema', () => {
  it('accepts an empty object', () => {
    const result = FileConfigSchema.parse({});
    expect(result).toEqual({});
  });

  it('accepts partial config', () => {
    const result = FileConfigSchema.parse({ model: 'gpt-4o', verbose: true });
    expect(result.model).toBe('gpt-4o');
    expect(result.verbose).toBe(true);
  });

  it('rejects invalid types', () => {
    expect(() => FileConfigSchema.parse({ verbose: 'yes' })).toThrow();
  });
});

describe('CliConfigSchema', () => {
  it('applies defaults', () => {
    const result = CliConfigSchema.parse({ projectDir: '/tmp' });
    expect(result.model).toBe('anthropic:claude-sonnet-4-6');
    expect(result.memory).toBe(true);
    expect(result.skills).toBe(true);
    expect(result.verbose).toBe(false);
  });

  it('allows overriding defaults', () => {
    const result = CliConfigSchema.parse({
      projectDir: '/tmp',
      model: 'gpt-4o',
      memory: false,
      verbose: true,
    });
    expect(result.model).toBe('gpt-4o');
    expect(result.memory).toBe(false);
    expect(result.verbose).toBe(true);
  });

  it('requires projectDir', () => {
    expect(() => CliConfigSchema.parse({})).toThrow();
  });

  it('accepts optional fields', () => {
    const result = CliConfigSchema.parse({
      projectDir: '/tmp',
      apiKey: 'sk-test',
      apiBaseUrl: 'https://api.example.com',
      systemPrompt: 'You are helpful',
    });
    expect(result.apiKey).toBe('sk-test');
    expect(result.apiBaseUrl).toBe('https://api.example.com');
    expect(result.systemPrompt).toBe('You are helpful');
  });
});
