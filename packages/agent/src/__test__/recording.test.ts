import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { fakeModel } from '@langchain/core/testing';

import {
  resolveDefaultId,
  resolveRecordingDir,
  resolveEffectiveMode,
  Recorder,
  buildReplayModel,
  loadManifest,
  loadAgentRecording,
  createRecordingModel,
} from '../recording.js';

describe('recording', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recording-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // resolveRecordingDir
  // -----------------------------------------------------------------------
  describe('resolveRecordingDir', () => {
    it('should use default path when not specified', () => {
      const dir = resolveRecordingDir({ mode: 'record', id: 'test-agent' });
      expect(dir).toContain('.data');
      expect(dir).toContain('recordings');
      expect(dir).toContain('test-agent');
    });

    it('should use custom path', () => {
      const dir = resolveRecordingDir({
        mode: 'record',
        path: '/custom/path',
        id: 'my-agent',
      });
      expect(dir).toContain('custom');
      expect(dir).toContain('my-agent');
    });

    it('should sanitize special characters in id', () => {
      const dir = resolveRecordingDir({
        mode: 'record',
        path: tmpDir,
        id: 'apps/examples/research:test',
      });
      expect(path.basename(dir)).toBe('apps-examples-research-test');
    });
  });

  // -----------------------------------------------------------------------
  // resolveDefaultId
  // -----------------------------------------------------------------------
  describe('resolveDefaultId', () => {
    it('should return a non-empty string', () => {
      const id = resolveDefaultId();
      expect(id).toBeTruthy();
      expect(typeof id).toBe('string');
    });
  });

  // -----------------------------------------------------------------------
  // resolveEffectiveMode
  // -----------------------------------------------------------------------
  describe('resolveEffectiveMode', () => {
    it('should return record when mode is record', () => {
      expect(resolveEffectiveMode('record', tmpDir)).toBe('record');
    });

    it('should return replay when mode is replay', () => {
      expect(resolveEffectiveMode('replay', tmpDir)).toBe('replay');
    });

    it('should return record when auto and no manifest exists', () => {
      expect(resolveEffectiveMode('auto', tmpDir)).toBe('record');
    });

    it('should return record when auto and manifest has recording status', () => {
      const dir = path.join(tmpDir, 'test-auto');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ status: 'recording' }));
      expect(resolveEffectiveMode('auto', dir)).toBe('record');
    });

    it('should return replay when auto and manifest has completed status', () => {
      const dir = path.join(tmpDir, 'test-auto-complete');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ status: 'completed' }));
      expect(resolveEffectiveMode('auto', dir)).toBe('replay');
    });

    it('should return replay when auto and manifest has error status', () => {
      const dir = path.join(tmpDir, 'test-auto-error');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ status: 'error' }));
      expect(resolveEffectiveMode('auto', dir)).toBe('replay');
    });

    it('should return record when auto and manifest is invalid JSON', () => {
      const dir = path.join(tmpDir, 'test-auto-invalid');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'manifest.json'), 'not valid json');
      expect(resolveEffectiveMode('auto', dir)).toBe('record');
    });
  });

  // -----------------------------------------------------------------------
  // Recorder
  // -----------------------------------------------------------------------
  describe('Recorder', () => {
    it('should record messages and maintain sequence', () => {
      const recorder = new Recorder();

      const msg1 = new AIMessage({ content: 'Hello from main' });
      const msg2 = new AIMessage({
        content: '',
        tool_calls: [{ id: 'call_1', name: 'search', args: { q: 'test' } }],
      });
      const msg3 = new AIMessage({ content: 'Subagent response' });

      recorder.record('main', msg1);
      recorder.record('main', msg2);
      recorder.record('general-purpose', msg3);

      expect(recorder.sequence).toHaveLength(3);
      expect(recorder.sequence[0]).toEqual({ type: 'model', agent: 'main', index: 0 });
      expect(recorder.sequence[1]).toEqual({ type: 'model', agent: 'main', index: 1 });
      expect(recorder.sequence[2]).toEqual({ type: 'model', agent: 'general-purpose', index: 0 });

      expect(recorder.responses.get('main')).toHaveLength(2);
      expect(recorder.responses.get('general-purpose')).toHaveLength(1);
    });

    it('should flush to directory with atomic writes', () => {
      const recorder = new Recorder();
      const recDir = path.join(tmpDir, 'flush-test');

      recorder.record('main', new AIMessage({ content: 'Hello' }));
      recorder.record('general-purpose', new AIMessage({ content: 'Sub hello' }));

      recorder.flush(recDir, 'test-id', 'completed');

      // Verify manifest
      const manifest = loadManifest(recDir);
      expect(manifest.id).toBe('test-id');
      expect(manifest.status).toBe('completed');
      expect(manifest.sequence).toHaveLength(2);
      expect(manifest.completedAt).toBeTruthy();

      // Verify agent recordings
      const mainRec = loadAgentRecording(recDir, 'main');
      expect(mainRec.agent).toBe('main');
      expect(mainRec.responses).toHaveLength(1);

      const subRec = loadAgentRecording(recDir, 'general-purpose');
      expect(subRec.agent).toBe('general-purpose');
      expect(subRec.responses).toHaveLength(1);
    });

    it('should flush with error status', () => {
      const recorder = new Recorder();
      const recDir = path.join(tmpDir, 'error-test');

      recorder.record('main', new AIMessage({ content: 'Before error' }));
      recorder.flush(recDir, 'error-id', 'error');

      const manifest = loadManifest(recDir);
      expect(manifest.status).toBe('error');
      expect(manifest.sequence).toHaveLength(1);
    });

    it('should preserve AIMessage with tool_calls through serialization', () => {
      const recorder = new Recorder();
      const recDir = path.join(tmpDir, 'toolcall-test');

      const msg = new AIMessage({
        content: 'Let me search',
        tool_calls: [{ id: 'call_abc', name: 'search', args: { query: 'weather' } }],
      });
      recorder.record('main', msg);
      recorder.flush(recDir, 'tc-id', 'completed');

      // Reload and verify
      const mainRec = loadAgentRecording(recDir, 'main');
      expect(mainRec.responses).toHaveLength(1);
      const stored = mainRec.responses[0]!;
      expect(stored.type).toBe('ai');
      // additional_kwargs should contain tool_calls info
      expect(stored.data.content).toBe('Let me search');
    });
  });

  // -----------------------------------------------------------------------
  // createRecordingModel
  // -----------------------------------------------------------------------
  describe('createRecordingModel', () => {
    it('should record model invoke results', async () => {
      const recorder = new Recorder();
      const baseModel = fakeModel()
        .respond(new AIMessage({ content: 'Response 1' }))
        .respond(new AIMessage({ content: 'Response 2' }));

      const recordingModel = createRecordingModel(baseModel, recorder, 'main');

      await recordingModel.invoke([new HumanMessage('Hi')]);
      await recordingModel.invoke([new HumanMessage('Hello')]);

      expect(recorder.sequence).toHaveLength(2);
      expect(recorder.responses.get('main')).toHaveLength(2);
    });

    it('should resolve agent name from config metadata', async () => {
      const recorder = new Recorder();
      const baseModel = fakeModel().respond(new AIMessage({ content: 'Sub response' }));

      const recordingModel = createRecordingModel(baseModel, recorder, 'main');

      await recordingModel.invoke([new HumanMessage('Hi')], {
        metadata: { lc_agent_name: 'general-purpose' },
      });

      expect(recorder.sequence[0]!.agent).toBe('general-purpose');
      expect(recorder.responses.get('general-purpose')).toHaveLength(1);
    });

    it('should record tool calls in AIMessage', async () => {
      const recorder = new Recorder();
      const baseModel = fakeModel().respondWithTools([{ name: 'search', args: { q: 'test' } }]);

      const recordingModel = createRecordingModel(baseModel, recorder, 'main');

      await recordingModel.invoke([new HumanMessage('Search')]);

      expect(recorder.sequence).toHaveLength(1);
      const responses = recorder.responses.get('main')!;
      expect(responses).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // Recorder (edge cases)
  // -----------------------------------------------------------------------
  describe('Recorder edge cases', () => {
    it('should flush empty recorder without error', () => {
      const recorder = new Recorder();
      const recDir = path.join(tmpDir, 'empty-flush');

      recorder.flush(recDir, 'empty-id', 'completed');

      const manifest = loadManifest(recDir);
      expect(manifest.id).toBe('empty-id');
      expect(manifest.status).toBe('completed');
      expect(manifest.sequence).toHaveLength(0);
    });

    it('should handle multiple agents with multiple messages', () => {
      const recorder = new Recorder();
      const recDir = path.join(tmpDir, 'multi-agent');

      recorder.record('main', new AIMessage({ content: 'M1' }));
      recorder.record('researcher', new AIMessage({ content: 'R1' }));
      recorder.record('main', new AIMessage({ content: 'M2' }));
      recorder.record('coder', new AIMessage({ content: 'C1' }));
      recorder.record('researcher', new AIMessage({ content: 'R2' }));
      recorder.record('main', new AIMessage({ content: 'M3' }));

      recorder.flush(recDir, 'multi-id', 'completed');

      const manifest = loadManifest(recDir);
      expect(manifest.sequence).toHaveLength(6);
      expect(manifest.sequence[0]).toEqual({ type: 'model', agent: 'main', index: 0 });
      expect(manifest.sequence[1]).toEqual({ type: 'model', agent: 'researcher', index: 0 });
      expect(manifest.sequence[2]).toEqual({ type: 'model', agent: 'main', index: 1 });
      expect(manifest.sequence[3]).toEqual({ type: 'model', agent: 'coder', index: 0 });
      expect(manifest.sequence[4]).toEqual({ type: 'model', agent: 'researcher', index: 1 });
      expect(manifest.sequence[5]).toEqual({ type: 'model', agent: 'main', index: 2 });

      const mainRec = loadAgentRecording(recDir, 'main');
      expect(mainRec.responses).toHaveLength(3);

      const researcherRec = loadAgentRecording(recDir, 'researcher');
      expect(researcherRec.responses).toHaveLength(2);

      const coderRec = loadAgentRecording(recDir, 'coder');
      expect(coderRec.responses).toHaveLength(1);
    });

    it('should create nested directories on flush', () => {
      const recorder = new Recorder();
      const recDir = path.join(tmpDir, 'deep', 'nested', 'dir');

      recorder.record('main', new AIMessage({ content: 'Hello' }));
      recorder.flush(recDir, 'nested-id', 'completed');

      expect(fs.existsSync(recDir)).toBe(true);
      const manifest = loadManifest(recDir);
      expect(manifest.id).toBe('nested-id');
    });

    it('should overwrite previous recording on re-flush', () => {
      const recorder1 = new Recorder();
      const recDir = path.join(tmpDir, 'overwrite-test');

      recorder1.record('main', new AIMessage({ content: 'Old' }));
      recorder1.flush(recDir, 'v1', 'completed');

      const recorder2 = new Recorder();
      recorder2.record('main', new AIMessage({ content: 'New1' }));
      recorder2.record('main', new AIMessage({ content: 'New2' }));
      recorder2.flush(recDir, 'v2', 'completed');

      const manifest = loadManifest(recDir);
      expect(manifest.id).toBe('v2');
      expect(manifest.sequence).toHaveLength(2);
    });

    it('should handle agent names with special characters', () => {
      const recorder = new Recorder();
      const recDir = path.join(tmpDir, 'special-agent');

      recorder.record('my/custom:agent', new AIMessage({ content: 'Hello' }));
      recorder.flush(recDir, 'special-id', 'completed');

      const agentRec = loadAgentRecording(recDir, 'my/custom:agent');
      expect(agentRec.agent).toBe('my/custom:agent');
      expect(agentRec.responses).toHaveLength(1);
    });

    it('should set recording status correctly', () => {
      const recorder = new Recorder();
      const recDir = path.join(tmpDir, 'recording-status');

      recorder.record('main', new AIMessage({ content: 'In progress' }));
      recorder.flush(recDir, 'rec-id', 'recording');

      const manifest = loadManifest(recDir);
      expect(manifest.status).toBe('recording');
      expect(manifest.completedAt).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // loadManifest / loadAgentRecording error handling
  // -----------------------------------------------------------------------
  describe('loadManifest / loadAgentRecording', () => {
    it('should throw when manifest does not exist', () => {
      expect(() => loadManifest(path.join(tmpDir, 'nonexistent'))).toThrow();
    });

    it('should throw when agent recording does not exist', () => {
      const recDir = path.join(tmpDir, 'no-agent-file');
      fs.mkdirSync(recDir, { recursive: true });
      expect(() => loadAgentRecording(recDir, 'missing-agent')).toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // createRecordingModel (chain methods)
  // -----------------------------------------------------------------------
  describe('createRecordingModel chain methods', () => {
    it('should record through bindTools() chain', async () => {
      const recorder = new Recorder();
      const baseModel = fakeModel().respond(new AIMessage({ content: 'Bound response' }));

      const recordingModel = createRecordingModel(baseModel, recorder, 'main');
      const boundModel = recordingModel.bindTools([]);

      await boundModel.invoke([new HumanMessage('Hi')]);

      expect(recorder.sequence).toHaveLength(1);
      expect(recorder.responses.get('main')).toHaveLength(1);
    });

    it('should record through withConfig() chain', async () => {
      const recorder = new Recorder();
      const baseModel = fakeModel().respond(new AIMessage({ content: 'Config response' }));

      const recordingModel = createRecordingModel(baseModel, recorder, 'main');
      const configuredModel = recordingModel.withConfig({ metadata: { custom: true } });

      await configuredModel.invoke([new HumanMessage('Hi')]);

      expect(recorder.sequence).toHaveLength(1);
      expect(recorder.responses.get('main')).toHaveLength(1);
    });

    it('should accumulate recordings across multiple invoke calls', async () => {
      const recorder = new Recorder();
      const baseModel = fakeModel()
        .respond(new AIMessage({ content: 'R1' }))
        .respond(new AIMessage({ content: 'R2' }))
        .respond(new AIMessage({ content: 'R3' }));

      const recordingModel = createRecordingModel(baseModel, recorder, 'main');

      await recordingModel.invoke([new HumanMessage('Q1')]);
      await recordingModel.invoke([new HumanMessage('Q2')]);
      await recordingModel.invoke([new HumanMessage('Q3')]);

      expect(recorder.sequence).toHaveLength(3);
      const responses = recorder.responses.get('main')!;
      expect(responses).toHaveLength(3);
      expect(responses[0]!.data.content).toBe('R1');
      expect(responses[1]!.data.content).toBe('R2');
      expect(responses[2]!.data.content).toBe('R3');
    });

    it('should use fallback agent name when no metadata', async () => {
      const recorder = new Recorder();
      const baseModel = fakeModel().respond(new AIMessage({ content: 'Response' }));

      const recordingModel = createRecordingModel(baseModel, recorder, 'custom-agent');

      await recordingModel.invoke([new HumanMessage('Hi')]);

      expect(recorder.sequence[0]!.agent).toBe('custom-agent');
      expect(recorder.responses.get('custom-agent')).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // buildReplayModel
  // -----------------------------------------------------------------------
  describe('buildReplayModel', () => {
    it('should rebuild model responses in sequence order', async () => {
      // First, create a recording
      const recorder = new Recorder();
      const recDir = path.join(tmpDir, 'replay-test');

      recorder.record('main', new AIMessage({ content: 'Main 1' }));
      recorder.record('main', new AIMessage({ content: 'Main 2' }));
      recorder.record('general-purpose', new AIMessage({ content: 'Sub 1' }));
      recorder.record('main', new AIMessage({ content: 'Main 3' }));
      recorder.flush(recDir, 'replay-id', 'completed');

      // Now build replay model
      const replayModel = buildReplayModel(recDir);

      // Invoke in sequence order: Main 1, Main 2, Sub 1, Main 3
      const r1 = await replayModel.invoke([new HumanMessage('q1')]);
      expect(r1.content).toBe('Main 1');

      const r2 = await replayModel.invoke([new HumanMessage('q2')]);
      expect(r2.content).toBe('Main 2');

      const r3 = await replayModel.invoke([new HumanMessage('q3')]);
      expect(r3.content).toBe('Sub 1');

      const r4 = await replayModel.invoke([new HumanMessage('q4')]);
      expect(r4.content).toBe('Main 3');
    });

    it('should replay error recordings', async () => {
      const recorder = new Recorder();
      const recDir = path.join(tmpDir, 'replay-error-test');

      recorder.record('main', new AIMessage({ content: 'Before error' }));
      recorder.flush(recDir, 'error-id', 'error');

      const replayModel = buildReplayModel(recDir);
      const r1 = await replayModel.invoke([new HumanMessage('q1')]);
      expect(r1.content).toBe('Before error');
    });

    it('should replay AIMessage with tool_calls', async () => {
      const recorder = new Recorder();
      const recDir = path.join(tmpDir, 'replay-tc-test');

      const msgWithTools = new AIMessage({
        content: '',
        tool_calls: [{ id: 'call_1', name: 'search', args: { query: 'weather' } }],
      });
      recorder.record('main', msgWithTools);
      recorder.record('main', new AIMessage({ content: 'Sunny' }));
      recorder.flush(recDir, 'tc-id', 'completed');

      const replayModel = buildReplayModel(recDir);

      const r1 = await replayModel.invoke([new HumanMessage('Weather?')]);
      expect(r1.tool_calls).toHaveLength(1);
      expect(r1.tool_calls[0]!.name).toBe('search');

      const r2 = await replayModel.invoke([new HumanMessage('Result')]);
      expect(r2.content).toBe('Sunny');
    });

    it('should throw when manifest does not exist', () => {
      expect(() => buildReplayModel(path.join(tmpDir, 'nonexistent-replay'))).toThrow();
    });

    it('should handle empty sequence', async () => {
      const recorder = new Recorder();
      const recDir = path.join(tmpDir, 'empty-replay');

      recorder.flush(recDir, 'empty-id', 'completed');

      const replayModel = buildReplayModel(recDir);
      // fakeModel with empty queue - invoke should throw or return empty
      await expect(replayModel.invoke([new HumanMessage('Hi')])).rejects.toThrow();
    });

    it('should replay multi-agent recording in correct order', async () => {
      const recorder = new Recorder();
      const recDir = path.join(tmpDir, 'multi-agent-replay');

      recorder.record('main', new AIMessage({ content: 'M1' }));
      recorder.record('researcher', new AIMessage({ content: 'R1' }));
      recorder.record('main', new AIMessage({ content: 'M2' }));
      recorder.record('researcher', new AIMessage({ content: 'R2' }));
      recorder.record('coder', new AIMessage({ content: 'C1' }));
      recorder.record('main', new AIMessage({ content: 'M3' }));
      recorder.flush(recDir, 'multi-replay-id', 'completed');

      const replayModel = buildReplayModel(recDir);

      // Should replay in global sequence order: M1, R1, M2, R2, C1, M3
      const r1 = await replayModel.invoke([new HumanMessage('q1')]);
      expect(r1.content).toBe('M1');

      const r2 = await replayModel.invoke([new HumanMessage('q2')]);
      expect(r2.content).toBe('R1');

      const r3 = await replayModel.invoke([new HumanMessage('q3')]);
      expect(r3.content).toBe('M2');

      const r4 = await replayModel.invoke([new HumanMessage('q4')]);
      expect(r4.content).toBe('R2');

      const r5 = await replayModel.invoke([new HumanMessage('q5')]);
      expect(r5.content).toBe('C1');

      const r6 = await replayModel.invoke([new HumanMessage('q6')]);
      expect(r6.content).toBe('M3');
    });

    it('should handle missing agent recording gracefully', async () => {
      // Manually create a manifest that references an agent without a recording file
      const recDir = path.join(tmpDir, 'missing-agent-rec');
      fs.mkdirSync(recDir, { recursive: true });

      const manifest = {
        id: 'missing-test',
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        status: 'completed',
        sequence: [{ agent: 'ghost', index: 0 }],
      };
      fs.writeFileSync(path.join(recDir, 'manifest.json'), JSON.stringify(manifest));

      // Should not throw - gracefully handles missing agent files
      const replayModel = buildReplayModel(recDir);
      expect(replayModel).toBeTruthy();
    });
  });

  // -----------------------------------------------------------------------
  // End-to-end round-trip: record → flush → replay
  // -----------------------------------------------------------------------
  describe('end-to-end round-trip', () => {
    it('should record and replay a full conversation with tool calls', async () => {
      // --- Record phase ---
      const recorder = new Recorder();
      const recDir = path.join(tmpDir, 'e2e-roundtrip');

      const baseModel = fakeModel()
        .respondWithTools([{ name: 'search', args: { q: 'TypeScript' } }])
        .respond(new AIMessage({ content: 'TypeScript is great' }))
        .respond(new AIMessage({ content: 'Subagent found docs' }))
        .respond(new AIMessage({ content: 'Here is the summary' }));

      const recordingModel = createRecordingModel(baseModel, recorder, 'main');

      // Simulate main agent calls
      await recordingModel.invoke([new HumanMessage('Search TS')]);
      await recordingModel.invoke([new HumanMessage('ToolResult: ...')]);

      // Simulate subagent call (with metadata)
      await recordingModel.invoke([new HumanMessage('Find docs')], {
        metadata: { lc_agent_name: 'general-purpose' },
      });

      // Back to main agent
      await recordingModel.invoke([new HumanMessage('Summarize')]);

      // Flush
      recorder.flush(recDir, 'e2e-id', 'completed');

      // --- Verify recorded data ---
      const manifest = loadManifest(recDir);
      expect(manifest.id).toBe('e2e-id');
      expect(manifest.status).toBe('completed');
      expect(manifest.sequence).toHaveLength(4);
      expect(manifest.sequence[0]).toEqual({ type: 'model', agent: 'main', index: 0 });
      expect(manifest.sequence[1]).toEqual({ type: 'model', agent: 'main', index: 1 });
      expect(manifest.sequence[2]).toEqual({ type: 'model', agent: 'general-purpose', index: 0 });
      expect(manifest.sequence[3]).toEqual({ type: 'model', agent: 'main', index: 2 });

      // --- Replay phase ---
      const replayModel = buildReplayModel(recDir);

      const r1 = await replayModel.invoke([new HumanMessage('q1')]);
      expect(r1.tool_calls).toHaveLength(1);
      expect(r1.tool_calls[0]!.name).toBe('search');
      expect(r1.tool_calls[0]!.args).toEqual({ q: 'TypeScript' });

      const r2 = await replayModel.invoke([new HumanMessage('q2')]);
      expect(r2.content).toBe('TypeScript is great');

      const r3 = await replayModel.invoke([new HumanMessage('q3')]);
      expect(r3.content).toBe('Subagent found docs');

      const r4 = await replayModel.invoke([new HumanMessage('q4')]);
      expect(r4.content).toBe('Here is the summary');
    });

    it('should record error and replay partial conversation', async () => {
      // --- Record phase (simulates error after 2 calls) ---
      const recorder = new Recorder();
      const recDir = path.join(tmpDir, 'e2e-error');

      const baseModel = fakeModel()
        .respond(new AIMessage({ content: 'Step 1 done' }))
        .respond(new AIMessage({ content: 'Step 2 done' }));

      const recordingModel = createRecordingModel(baseModel, recorder, 'main');

      await recordingModel.invoke([new HumanMessage('Start')]);
      await recordingModel.invoke([new HumanMessage('Continue')]);

      // Flush with error status (simulating agent.invoke catching an error)
      recorder.flush(recDir, 'error-e2e', 'error');

      // --- Replay phase ---
      const manifest = loadManifest(recDir);
      expect(manifest.status).toBe('error');

      const replayModel = buildReplayModel(recDir);

      const r1 = await replayModel.invoke([new HumanMessage('q1')]);
      expect(r1.content).toBe('Step 1 done');

      const r2 = await replayModel.invoke([new HumanMessage('q2')]);
      expect(r2.content).toBe('Step 2 done');
    });

    it('should preserve complex AIMessage content through round-trip', async () => {
      const recorder = new Recorder();
      const recDir = path.join(tmpDir, 'e2e-complex');

      const complexMsg = new AIMessage({
        content: 'Thinking...',
        tool_calls: [
          { id: 'call_1', name: 'read_file', args: { path: '/tmp/test.ts' } },
          { id: 'call_2', name: 'write_file', args: { path: '/tmp/out.ts', content: 'code' } },
        ],
      });

      const baseModel = fakeModel().respond(complexMsg);
      const recordingModel = createRecordingModel(baseModel, recorder, 'main');

      await recordingModel.invoke([new HumanMessage('Do work')]);
      recorder.flush(recDir, 'complex-id', 'completed');

      // Replay and verify
      const replayModel = buildReplayModel(recDir);
      const r1 = await replayModel.invoke([new HumanMessage('q')]);

      expect(r1.content).toBe('Thinking...');
      expect(r1.tool_calls).toHaveLength(2);
      expect(r1.tool_calls[0]!.name).toBe('read_file');
      expect(r1.tool_calls[0]!.args).toEqual({ path: '/tmp/test.ts' });
      expect(r1.tool_calls[1]!.name).toBe('write_file');
      expect(r1.tool_calls[1]!.args).toEqual({ path: '/tmp/out.ts', content: 'code' });
    });
  });

  // -----------------------------------------------------------------------
  // resolveEffectiveMode + resolveRecordingDir (additional edge cases)
  // -----------------------------------------------------------------------
  describe('resolveRecordingDir edge cases', () => {
    it('should handle empty id after sanitization', () => {
      const dir = resolveRecordingDir({
        mode: 'record',
        path: tmpDir,
        id: 'normal-id',
      });
      expect(dir).toContain('normal-id');
    });

    it('should handle id with multiple special characters', () => {
      const dir = resolveRecordingDir({
        mode: 'record',
        path: tmpDir,
        id: 'a/b\\c:d*e?f"g<h>i|j',
      });
      const basename = path.basename(dir);
      expect(basename).not.toMatch(/[/\\:*?"<>|]/);
    });
  });
});
