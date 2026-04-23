import { z } from 'zod';

const McpServerConfigSchema = z.discriminatedUnion('transport', [
  z.object({
    transport: z.literal('stdio'),
    command: z.string(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    prefixToolNames: z.boolean().optional(),
  }),
  z.object({
    transport: z.literal('sse'),
    url: z.string(),
    headers: z.record(z.string(), z.string()).optional(),
    prefixToolNames: z.boolean().optional(),
  }),
  z.object({
    transport: z.literal('streamable-http'),
    url: z.string(),
    headers: z.record(z.string(), z.string()).optional(),
    prefixToolNames: z.boolean().optional(),
  }),
]);

export const FileConfigSchema = z.object({
  model: z.string().optional(),
  apiKey: z.string().optional(),
  apiBaseUrl: z.string().optional(),
  tavilyApiKey: z.string().optional(),
  systemPrompt: z.string().optional(),
  memory: z.boolean().optional(),
  skills: z.boolean().optional(),
  verbose: z.boolean().optional(),
  record: z.boolean().optional(),
  mcpServers: z.record(z.string(), McpServerConfigSchema).optional(),
});

export type FileConfig = z.infer<typeof FileConfigSchema>;

export const CliConfigSchema = z.object({
  model: z.string().default('anthropic:claude-sonnet-4-6'),
  apiKey: z.string().optional(),
  apiBaseUrl: z.string().optional(),
  tavilyApiKey: z.string().optional(),
  projectDir: z.string(),
  systemPrompt: z.string().optional(),
  memory: z.boolean().default(true),
  skills: z.boolean().default(true),
  verbose: z.boolean().default(false),
  record: z.boolean().default(false),
  mcpServers: z.record(z.string(), McpServerConfigSchema).optional(),
});

export type CliConfig = z.infer<typeof CliConfigSchema>;

export const ReplayConfigSchema = z.object({
  projectDir: z.string(),
  recordingId: z.string().optional(),
  verbose: z.boolean().default(false),
});

export type ReplayConfig = z.infer<typeof ReplayConfigSchema>;
