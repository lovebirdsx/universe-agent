import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createUniverseAgent, isAnthropicModel } from '../agent.js';
import { FakeListChatModel } from '@langchain/core/utils/testing';
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import { MemorySaver } from '@langchain/langgraph';
import { z } from 'zod/v4';
import { tool } from 'langchain';
import { createFileData } from '../backends/utils.js';
import { ConfigurationError } from '../errors.js';
import { Recorder, loadManifest, loadAgentRecording } from '../recording.js';

describe('isAnthropicModel', () => {
  it('should detect claude model strings', () => {
    expect(isAnthropicModel('claude-sonnet-4-5-20250929')).toBe(true);
    expect(isAnthropicModel('claude-3-opus')).toBe(true);
    expect(isAnthropicModel('claude-haiku')).toBe(true);
  });

  it('should detect anthropic: prefixed model strings', () => {
    expect(isAnthropicModel('anthropic:claude-3-opus')).toBe(true);
    expect(isAnthropicModel('anthropic:claude-sonnet')).toBe(true);
  });

  it('should reject non-Anthropic model strings', () => {
    expect(isAnthropicModel('gpt-4')).toBe(false);
    expect(isAnthropicModel('gemini-pro')).toBe(false);
    expect(isAnthropicModel('openai:gpt-4')).toBe(false);
    expect(isAnthropicModel('google:gemini-pro')).toBe(false);
  });

  it('should detect ChatAnthropic model objects', () => {
    const model = new FakeListChatModel({ responses: [] });
    vi.spyOn(model, 'getName').mockReturnValue('ChatAnthropic');
    expect(isAnthropicModel(model)).toBe(true);
  });

  it('should reject non-Anthropic model objects', () => {
    const model = new FakeListChatModel({ responses: [] });
    vi.spyOn(model, 'getName').mockReturnValue('ChatOpenAI');
    expect(isAnthropicModel(model)).toBe(false);
  });

  it('should detect ConfigurableModel wrapping an Anthropic provider', () => {
    const model = new FakeListChatModel({ responses: [] });
    vi.spyOn(model, 'getName').mockReturnValue('ConfigurableModel');
    (model as { _defaultConfig?: { modelProvider: string } })._defaultConfig = {
      modelProvider: 'anthropic',
    };
    expect(isAnthropicModel(model)).toBe(true);
  });

  it('should reject ConfigurableModel wrapping a non-Anthropic provider', () => {
    const model = new FakeListChatModel({ responses: [] });
    vi.spyOn(model, 'getName').mockReturnValue('ConfigurableModel');
    (model as { _defaultConfig?: { modelProvider: string } })._defaultConfig = {
      modelProvider: 'openai',
    };
    expect(isAnthropicModel(model)).toBe(false);
  });
});

describe('System prompt cache control breakpoints', () => {
  function getSystemMessageFromSpy(
    invokeSpy: ReturnType<typeof vi.spyOn>,
  ): BaseMessage | undefined {
    const lastCall = invokeSpy.mock.calls[invokeSpy.mock.calls.length - 1];
    const messages = lastCall?.[0] as BaseMessage[] | undefined;
    if (!messages) return undefined;
    return messages.find(SystemMessage.isInstance);
  }

  it('should have separate cache_control breakpoints for system prompt and memory', async () => {
    const invokeSpy = vi.spyOn(FakeListChatModel.prototype, 'invoke');
    const model = new FakeListChatModel({ responses: ['Done'] });
    // Mock getName so isAnthropicModel detects this as an Anthropic model
    vi.spyOn(model, 'getName').mockReturnValue('ChatAnthropic');
    const checkpointer = new MemorySaver();

    const agent = createUniverseAgent({
      model,
      systemPrompt: 'You are a helpful assistant.',
      memory: ['/AGENTS.md'],
      checkpointer,
    });

    await agent.invoke(
      {
        messages: [new HumanMessage('Hello')],
        files: {
          '/AGENTS.md': createFileData('# Memory\n\nRemember this.'),
        },
      },
      {
        configurable: { thread_id: `test-cache-both-${Date.now()}` },
        recursionLimit: 50,
      },
    );

    const systemMessage = getSystemMessageFromSpy(invokeSpy as ReturnType<typeof vi.spyOn>);
    expect(systemMessage).toBeDefined();
    const blocks = systemMessage!.contentBlocks;
    expect(Array.isArray(blocks)).toBe(true);

    // Should have at least 3 blocks: system prompt + static middleware blocks + memory
    expect(blocks.length).toBeGreaterThanOrEqual(3);

    // System prompt block (first) should NOT have cache_control — the breakpoint
    // is placed on the last static block by createCacheBreakpointMiddleware
    const systemBlock = blocks[0];
    expect(systemBlock.cache_control).toBeUndefined();
    expect(systemBlock.text).toContain('You are a helpful assistant.');

    // Second-to-last block is the last static block — has cache_control
    const lastStaticBlock = blocks[blocks.length - 2];
    expect(lastStaticBlock.cache_control).toEqual({ type: 'ephemeral' });

    // Memory block (last) should have its own cache_control (set by memory middleware)
    const memoryBlock = blocks[blocks.length - 1];
    expect(memoryBlock.cache_control).toEqual({ type: 'ephemeral' });
    expect(memoryBlock.text).toContain('<agent_memory>');
    expect(memoryBlock.text).toContain('Remember this.');
    invokeSpy.mockRestore();
  });
});

describe('Built-in tool name collision detection', () => {
  const model = new FakeListChatModel({ responses: ['Done'] });

  function makeTool(name: string) {
    return {
      name,
      description: `custom ${name}`,
      schema: {},
      invoke: async () => 'ok',
      batch: async () => ['ok'],
    };
  }

  it('should throw ConfigurationError when a user-provided tool collides with a filesystem tool', () => {
    expect(() => createUniverseAgent({ model, tools: [makeTool('write_file')] })).toThrow(
      ConfigurationError,
    );

    try {
      createUniverseAgent({ model, tools: [makeTool('write_file')] });
    } catch (e) {
      expect(ConfigurationError.isInstance(e)).toBe(true);
      expect((e as ConfigurationError).code).toBe('TOOL_NAME_COLLISION');
      expect((e as ConfigurationError).message).toMatch(/write_file/);
    }
  });

  it('should list all colliding names in the error', () => {
    expect(() => createUniverseAgent({ model, tools: [makeTool('ls'), makeTool('grep')] })).toThrow(
      ConfigurationError,
    );
  });

  it('should throw when colliding with subagent or todo tool names', () => {
    expect(() =>
      createUniverseAgent({
        model,
        tools: [makeTool('task'), makeTool('write_todos')],
      }),
    ).toThrow(ConfigurationError);
  });

  it('should not throw when tool names do not collide', () => {
    expect(() => createUniverseAgent({ model, tools: [makeTool('my_custom_tool')] })).not.toThrow();
  });
});

describe('createUniverseAgent recording integration', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-rec-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should record model outputs and flush manifest on successful invoke', async () => {
    const model = new FakeListChatModel({ responses: ['Done'] });
    const checkpointer = new MemorySaver();

    const agent = createUniverseAgent({
      model,
      recording: { mode: 'record', path: tmpDir, id: 'test-rec' },
      checkpointer,
    });

    await agent.invoke(
      { messages: [new HumanMessage('Hello')] },
      { configurable: { thread_id: `rec-test-${Date.now()}` }, recursionLimit: 50 },
    );

    const recDir = path.join(tmpDir, 'test-rec');
    const manifest = loadManifest(recDir);
    expect(manifest.status).toBe('completed');
    expect(manifest.id).toBe('test-rec');
    expect(manifest.sequence.length).toBeGreaterThan(0);
  });

  it('should flush manifest with error status when invoke fails', async () => {
    const model = new FakeListChatModel({ responses: [] });
    const checkpointer = new MemorySaver();

    const agent = createUniverseAgent({
      model,
      recording: { mode: 'record', path: tmpDir, id: 'error-rec' },
      checkpointer,
    });

    try {
      await agent.invoke(
        { messages: [new HumanMessage('Hello')] },
        { configurable: { thread_id: `err-test-${Date.now()}` }, recursionLimit: 50 },
      );
    } catch {
      // Expected to throw
    }

    const recDir = path.join(tmpDir, 'error-rec');
    const manifest = loadManifest(recDir);
    expect(manifest.status).toBe('error');
    expect(manifest.id).toBe('error-rec');
  });

  it('should replay from recording instead of calling real model', async () => {
    // Build a recording manually
    const recId = 'replay-test';
    const recDir = path.join(tmpDir, recId);
    const recorder = new Recorder();
    recorder.record('main', new AIMessage({ content: 'Replayed response' }));
    recorder.flush(recDir, recId, 'completed');

    // Create a spy model that should NOT be called
    const spyModel = new FakeListChatModel({ responses: ['Should not appear'] });
    const invokeSpy = vi.spyOn(spyModel, 'invoke');

    const checkpointer = new MemorySaver();
    const agent = createUniverseAgent({
      model: spyModel,
      recording: { mode: 'replay', path: tmpDir, id: recId },
      checkpointer,
    });

    const result = await agent.invoke(
      { messages: [new HumanMessage('Hi')] },
      { configurable: { thread_id: `replay-test-${Date.now()}` }, recursionLimit: 50 },
    );

    // The spy model should NOT have been called — replay uses fakeModel
    expect(invokeSpy).not.toHaveBeenCalled();

    // Result should contain the replayed content
    const aiMessages = result.messages.filter(AIMessage.isInstance);
    expect(aiMessages.some((m) => (m.content as string).includes('Replayed response'))).toBe(true);

    invokeSpy.mockRestore();
  });

  it('should record in auto mode when no recording exists', async () => {
    const model = new FakeListChatModel({ responses: ['Auto recorded'] });
    const checkpointer = new MemorySaver();

    const agent = createUniverseAgent({
      model,
      recording: { mode: 'auto', path: tmpDir, id: 'auto-test' },
      checkpointer,
    });

    await agent.invoke(
      { messages: [new HumanMessage('Hi')] },
      { configurable: { thread_id: `auto-test-${Date.now()}` }, recursionLimit: 50 },
    );

    const recDir = path.join(tmpDir, 'auto-test');
    const manifest = loadManifest(recDir);
    expect(manifest.status).toBe('completed');
    expect(manifest.id).toBe('auto-test');
  });

  it('should replay in auto mode when completed recording exists', async () => {
    // Build a completed recording manually
    const recId = 'auto-replay';
    const recDir = path.join(tmpDir, recId);
    const recorder = new Recorder();
    recorder.record('main', new AIMessage({ content: 'Auto replayed' }));
    recorder.flush(recDir, recId, 'completed');

    // Spy model should NOT be called
    const spyModel = new FakeListChatModel({ responses: ['Should not appear'] });
    const invokeSpy = vi.spyOn(spyModel, 'invoke');

    const checkpointer = new MemorySaver();
    const agent = createUniverseAgent({
      model: spyModel,
      recording: { mode: 'auto', path: tmpDir, id: recId },
      checkpointer,
    });

    const result = await agent.invoke(
      { messages: [new HumanMessage('Hi')] },
      { configurable: { thread_id: `auto-replay-${Date.now()}` }, recursionLimit: 50 },
    );

    expect(invokeSpy).not.toHaveBeenCalled();

    const aiMessages = result.messages.filter(AIMessage.isInstance);
    expect(aiMessages.some((m) => (m.content as string).includes('Auto replayed'))).toBe(true);

    invokeSpy.mockRestore();
  });

  it('should not crash when using string model name with record mode', () => {
    expect(() =>
      createUniverseAgent({
        recording: { mode: 'record', path: tmpDir, id: 'str-model' },
      }),
    ).not.toThrow();
  });

  it('should record and replay tool results', async () => {
    const recId = 'tool-rec';
    const recDir = path.join(tmpDir, recId);
    const checkpointer = new MemorySaver();

    // Create a custom tool with a spy to verify it's called/not called
    const toolSpy = vi.fn().mockResolvedValue('tool executed');
    const myTool = tool(toolSpy, {
      name: 'my_custom_tool',
      description: 'A test tool',
      schema: z.object({
        input: z.string().describe('Input string'),
      }),
    });

    // --- Build a recording manually with tool results ---
    const recorder = new Recorder();

    const toolCallId = 'test_tool_call_1';
    const aiMsgWithToolCall = new AIMessage({
      content: '',
      tool_calls: [{ id: toolCallId, name: 'my_custom_tool', args: { input: 'hello' } }],
    });
    recorder.record('main', aiMsgWithToolCall);

    const toolResultMsg = new ToolMessage({
      content: 'tool executed',
      tool_call_id: toolCallId,
      name: 'my_custom_tool',
    });
    recorder.recordToolResult('main', toolResultMsg, toolCallId);

    const finalAiMsg = new AIMessage({ content: 'Done with tool result' });
    recorder.record('main', finalAiMsg);

    recorder.flush(recDir, recId, 'completed');

    // Verify recording structure
    const manifest = loadManifest(recDir);
    expect(manifest.status).toBe('completed');
    expect(manifest.sequence).toHaveLength(3);
    expect(manifest.sequence[0]).toEqual({ type: 'model', agent: 'main', index: 0 });
    expect(manifest.sequence[1]).toEqual({
      type: 'tool',
      agent: 'main',
      index: 0,
      toolCallId,
    });
    expect(manifest.sequence[2]).toEqual({ type: 'model', agent: 'main', index: 1 });

    const mainRec = loadAgentRecording(recDir, 'main');
    const toolTurns = mainRec.turns.filter((t) => t.type === 'tool');
    expect(toolTurns).toHaveLength(1);

    // --- Replay phase ---
    const spyModel = new FakeListChatModel({ responses: ['Should not appear'] });
    const invokeSpy = vi.spyOn(spyModel, 'invoke');

    const replayAgent = createUniverseAgent({
      model: spyModel,
      tools: [myTool],
      recording: { mode: 'replay', path: tmpDir, id: recId },
      checkpointer,
    });

    const replayResult = await replayAgent.invoke(
      { messages: [new HumanMessage('Use the tool')] },
      { configurable: { thread_id: `tool-replay-${Date.now()}` }, recursionLimit: 50 },
    );

    // Spy model should NOT have been called — replay uses fakeModel
    expect(invokeSpy).not.toHaveBeenCalled();

    // Tool should NOT have been called during replay
    expect(toolSpy).not.toHaveBeenCalled();

    // Verify replay contains ToolMessage with the recorded result
    const toolMessages = replayResult.messages.filter(ToolMessage.isInstance);
    expect(toolMessages.length).toBeGreaterThan(0);
    expect(toolMessages.some((m) => m.content.toString().includes('tool executed'))).toBe(true);

    invokeSpy.mockRestore();
  });

  it('should replay write_file tool results without hitting backend', async () => {
    const recId = 'write-file-rec';
    const recDir = path.join(tmpDir, recId);
    const checkpointer = new MemorySaver();

    // --- Build a recording manually that simulates write_file ---
    const recorder = new Recorder();

    const toolCallId = 'write_call_1';
    const aiMsgWithToolCall = new AIMessage({
      content: '',
      tool_calls: [
        {
          id: toolCallId,
          name: 'write_file',
          args: { file_path: '/test_output.txt', content: 'hello world' },
        },
      ],
    });
    recorder.record('main', aiMsgWithToolCall);

    const toolResultMsg = new ToolMessage({
      content: "Successfully wrote to '/test_output.txt'",
      tool_call_id: toolCallId,
      name: 'write_file',
    });
    recorder.recordToolResult('main', toolResultMsg, toolCallId);

    const finalAiMsg = new AIMessage({ content: 'File written successfully' });
    recorder.record('main', finalAiMsg);

    recorder.flush(recDir, recId, 'completed');

    // --- Replay phase ---
    const spyModel = new FakeListChatModel({ responses: ['Should not appear'] });

    const replayAgent = createUniverseAgent({
      model: spyModel,
      recording: { mode: 'replay', path: tmpDir, id: recId },
      checkpointer,
    });

    // This should succeed — tool results are replayed, write_file is NOT actually executed
    const replayResult = await replayAgent.invoke(
      { messages: [new HumanMessage('Write a file')] },
      { configurable: { thread_id: `write-replay-${Date.now()}` }, recursionLimit: 50 },
    );

    // Verify replay contains ToolMessage with write confirmation (not re-executed)
    const toolMessages = replayResult.messages.filter(ToolMessage.isInstance);
    expect(toolMessages.length).toBeGreaterThan(0);
    expect(toolMessages.some((m) => m.content.toString().includes('Successfully wrote'))).toBe(
      true,
    );
  });

  it('should record model outputs and flush manifest on successful stream', async () => {
    const model = new FakeListChatModel({ responses: ['Streamed'] });
    const checkpointer = new MemorySaver();

    const agent = createUniverseAgent({
      model,
      recording: { mode: 'record', path: tmpDir, id: 'stream-rec' },
      checkpointer,
    });

    // Consume the stream fully
    for await (const _chunk of await agent.stream(
      { messages: [new HumanMessage('Hello')] },
      {
        streamMode: 'updates',
        configurable: { thread_id: `stream-rec-${Date.now()}` },
        recursionLimit: 50,
      },
    )) {
      // just consume
    }

    const recDir = path.join(tmpDir, 'stream-rec');
    const manifest = loadManifest(recDir);
    expect(manifest.status).toBe('completed');
    expect(manifest.id).toBe('stream-rec');
    expect(manifest.sequence.length).toBeGreaterThan(0);
  });

  it('should replay from stream-recorded data via stream', async () => {
    // --- Record phase via stream ---
    const recId = 'stream-replay';
    const model = new FakeListChatModel({ responses: ['Stream replayed'] });
    const checkpointer = new MemorySaver();

    const recordAgent = createUniverseAgent({
      model,
      recording: { mode: 'record', path: tmpDir, id: recId },
      checkpointer,
    });

    for await (const _chunk of await recordAgent.stream(
      { messages: [new HumanMessage('Hello')] },
      {
        streamMode: 'updates',
        configurable: { thread_id: `stream-rec-${Date.now()}` },
        recursionLimit: 50,
      },
    )) {
      // consume
    }

    // --- Replay phase via stream ---
    const spyModel = new FakeListChatModel({ responses: ['Should not appear'] });
    const invokeSpy = vi.spyOn(spyModel, 'invoke');

    const replayAgent = createUniverseAgent({
      model: spyModel,
      recording: { mode: 'replay', path: tmpDir, id: recId },
      checkpointer,
    });

    const chunks: unknown[] = [];
    for await (const chunk of await replayAgent.stream(
      { messages: [new HumanMessage('Hi')] },
      {
        streamMode: 'updates',
        configurable: { thread_id: `stream-replay-${Date.now()}` },
        recursionLimit: 50,
      },
    )) {
      chunks.push(chunk);
    }

    // Spy model should NOT have been called — replay uses fakeModel
    expect(invokeSpy).not.toHaveBeenCalled();
    // Should have received stream chunks
    expect(chunks.length).toBeGreaterThan(0);

    invokeSpy.mockRestore();
  });

  it('should replay stream-recorded data via invoke', async () => {
    // --- Record phase via stream ---
    const recId = 'stream-to-invoke';
    const model = new FakeListChatModel({ responses: ['Cross replay'] });
    const checkpointer = new MemorySaver();

    const recordAgent = createUniverseAgent({
      model,
      recording: { mode: 'record', path: tmpDir, id: recId },
      checkpointer,
    });

    for await (const _chunk of await recordAgent.stream(
      { messages: [new HumanMessage('Hello')] },
      {
        streamMode: 'updates',
        configurable: { thread_id: `cross-rec-${Date.now()}` },
        recursionLimit: 50,
      },
    )) {
      // consume
    }

    // --- Replay phase via invoke (cross-mode replay) ---
    const spyModel = new FakeListChatModel({ responses: ['Should not appear'] });
    const invokeSpy = vi.spyOn(spyModel, 'invoke');

    const replayAgent = createUniverseAgent({
      model: spyModel,
      recording: { mode: 'replay', path: tmpDir, id: recId },
      checkpointer,
    });

    const result = await replayAgent.invoke(
      { messages: [new HumanMessage('Hi')] },
      { configurable: { thread_id: `cross-replay-${Date.now()}` }, recursionLimit: 50 },
    );

    expect(invokeSpy).not.toHaveBeenCalled();
    const aiMessages = result.messages.filter(AIMessage.isInstance);
    expect(aiMessages.some((m) => (m.content as string).includes('Cross replay'))).toBe(true);

    invokeSpy.mockRestore();
  });
});
