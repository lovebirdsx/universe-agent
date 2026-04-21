import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import { fakeModel } from '@langchain/core/testing';
import { tool } from 'langchain';
import { z } from 'zod';

import {
  Recorder,
  buildReplayModel,
  loadManifest,
  loadAgentRecording,
  loadToolResults,
  createRecordingModel,
} from '../recording.js';
import { createDeepAgent, type CompiledSubAgent, type SubAgent } from '../index.js';
import type { BaseLanguageModel } from '@langchain/core/language_models/base';

// ─── Shared helpers ────────────────────────────────────────────────────────

/**
 * 修复 fakeModel 的 bindTools 问题。
 * 与 buildReplayModel 使用相同策略：将 bindTools 替换为 withConfig，
 * 避免每次 bindTools 调用都重置 _callIndex 导致响应队列回到起点。
 */
function patchFakeModelBindTools<T extends BaseLanguageModel>(model: T): T {
  const originalWithConfig = model.withConfig.bind(model);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (model as any).bindTools = () => originalWithConfig({});
  return model;
}
const getNews = tool((input: { topic: string }) => `News about "${input.topic}"`, {
  name: 'get_news',
  description: 'Get latest news',
  schema: z.object({ topic: z.string() }),
});

const verifyClaim = tool((input: { claim: string }) => `Verified: "${input.claim}"`, {
  name: 'verify_claim',
  description: 'Verify a factual claim',
  schema: z.object({ claim: z.string() }),
});

describe('subagent recording', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'subagent-rec-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // 1. 父 agent 录像中捕获子 agent 交互（task tool 的调用结果）
  // -----------------------------------------------------------------------
  describe('parent agent recording captures task tool interactions', () => {
    it('should record task tool invocation as ToolMessage in main agent recording', () => {
      const recorder = new Recorder();

      // 模拟父 agent 的 LLM 响应序列：
      // 1. 父 agent 决定调用 task tool
      // 2. 子 agent 的 LLM 响应（通过 lc_agent_name 标识）
      // 3. 父 agent 收到 task tool 结果后生成最终回复
      const taskToolCall = new AIMessage({
        content: '',
        tool_calls: [
          {
            id: 'call_task_1',
            name: 'task',
            args: { description: 'verify this claim', subagent_type: 'fact-checker' },
          },
        ],
      });

      const subagentResponse = new AIMessage({ content: 'Claim verified with high confidence' });
      const finalResponse = new AIMessage({ content: 'The fact-checker confirmed the claim.' });

      // 录制：main agent 发起 task tool 调用
      recorder.record('main', taskToolCall);
      // 录制：子 agent 的 LLM 响应
      recorder.record('fact-checker', subagentResponse);
      // 录制：task tool 的返回结果（ToolMessage）
      recorder.recordToolResult(
        'main',
        new ToolMessage({
          content: 'Claim verified with high confidence',
          tool_call_id: 'call_task_1',
          name: 'task',
        }),
        'call_task_1',
      );
      // 录制：main agent 的最终回复
      recorder.record('main', finalResponse);

      const recDir = path.join(tmpDir, 'task-tool-capture');
      recorder.flush(recDir, 'task-capture-id', 'completed');

      // 验证 manifest
      const manifest = loadManifest(recDir);
      expect(manifest.sequence).toHaveLength(4);
      expect(manifest.sequence[0]).toEqual({ type: 'model', agent: 'main', index: 0 });
      expect(manifest.sequence[1]).toEqual({ type: 'model', agent: 'fact-checker', index: 0 });
      expect(manifest.sequence[2]).toEqual({
        type: 'tool',
        agent: 'main',
        index: 0,
        toolCallId: 'call_task_1',
      });
      expect(manifest.sequence[3]).toEqual({ type: 'model', agent: 'main', index: 1 });

      // 验证各 agent 录像文件（v2 格式）
      const mainRec = loadAgentRecording(recDir, 'main');
      expect(mainRec.version).toBe(2);
      const mainModelTurns = mainRec.turns.filter((t) => t.type === 'model');
      const mainToolTurns = mainRec.turns.filter((t) => t.type === 'tool');
      expect(mainModelTurns).toHaveLength(2);
      expect(mainToolTurns).toHaveLength(1);

      const subRec = loadAgentRecording(recDir, 'fact-checker');
      expect(subRec.version).toBe(2);
      const subModelTurns = subRec.turns.filter((t) => t.type === 'model');
      expect(subModelTurns).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // 2. CompiledSubAgent 独立录像
  // -----------------------------------------------------------------------
  describe('CompiledSubAgent independent recording', () => {
    it('should create independent recording when CompiledSubAgent has its own recording config', async () => {
      const subRecDir = path.join(tmpDir, 'sub-agent-recording');

      // 创建子 DeepAgent，带独立录像配置
      // 使用 fakeModel 响应：子 agent 直接回复（不调用 tool）
      const subModel = fakeModel().respond(new AIMessage({ content: 'Research completed' }));

      const researchAgent = createDeepAgent({
        model: subModel,
        systemPrompt: 'You are a research specialist.',
        tools: [getNews],
        recording: {
          mode: 'record',
          path: subRecDir,
          id: 'sub-research',
        },
      });

      // 直接 invoke 子 agent（模拟 CompiledSubAgent 被调用的场景）
      await researchAgent.invoke({
        messages: [new HumanMessage('Research renewable energy')],
      });

      // 验证子 agent 独立录像存在
      const subDir = path.join(subRecDir, 'sub-research');
      expect(fs.existsSync(path.join(subDir, 'manifest.json'))).toBe(true);

      const manifest = loadManifest(subDir);
      expect(manifest.id).toBe('sub-research');
      expect(manifest.status).toBe('completed');
      expect(manifest.sequence.length).toBeGreaterThan(0);

      // 验证录像是 v2 格式
      const mainRec = loadAgentRecording(subDir, 'main');
      expect(mainRec.version).toBe(2);
      expect(mainRec.turns.length).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // 3. Recorder 多 agent 序列追踪
  // -----------------------------------------------------------------------
  describe('recorder multi-agent sequence tracking', () => {
    it('should correctly track main → subagent → main sequence with tool results', () => {
      const recorder = new Recorder();

      // 模拟真实场景：main 发起 task，subagent 执行 tool，subagent 回复，main 继续
      recorder.record(
        'main',
        new AIMessage({
          content: '',
          tool_calls: [
            {
              id: 'call_task',
              name: 'task',
              args: { description: 'research AI', subagent_type: 'researcher' },
            },
          ],
        }),
      );

      // 子 agent 内部：调用 get_news tool
      recorder.record(
        'researcher',
        new AIMessage({
          content: '',
          tool_calls: [{ id: 'call_news', name: 'get_news', args: { topic: 'AI' } }],
        }),
      );

      // 子 agent 内部：get_news tool 返回结果
      recorder.recordToolResult(
        'researcher',
        new ToolMessage({
          content: 'News about AI breakthroughs',
          tool_call_id: 'call_news',
          name: 'get_news',
        }),
        'call_news',
      );

      // 子 agent 最终回复
      recorder.record('researcher', new AIMessage({ content: 'AI research summary completed' }));

      // task tool 返回给 main
      recorder.recordToolResult(
        'main',
        new ToolMessage({
          content: 'AI research summary completed',
          tool_call_id: 'call_task',
          name: 'task',
        }),
        'call_task',
      );

      // main agent 最终回复
      recorder.record('main', new AIMessage({ content: 'Here is the research summary' }));

      const recDir = path.join(tmpDir, 'multi-agent-sequence');
      recorder.flush(recDir, 'seq-id', 'completed');

      const manifest = loadManifest(recDir);
      expect(manifest.sequence).toHaveLength(6);

      // 验证序列顺序
      expect(manifest.sequence[0]).toEqual({ type: 'model', agent: 'main', index: 0 });
      expect(manifest.sequence[1]).toEqual({ type: 'model', agent: 'researcher', index: 0 });
      expect(manifest.sequence[2]).toEqual({
        type: 'tool',
        agent: 'researcher',
        index: 0,
        toolCallId: 'call_news',
      });
      expect(manifest.sequence[3]).toEqual({ type: 'model', agent: 'researcher', index: 1 });
      expect(manifest.sequence[4]).toEqual({
        type: 'tool',
        agent: 'main',
        index: 0,
        toolCallId: 'call_task',
      });
      expect(manifest.sequence[5]).toEqual({ type: 'model', agent: 'main', index: 1 });

      // 验证各 agent 数据（v2 格式）
      const mainRec = loadAgentRecording(recDir, 'main');
      expect(mainRec.version).toBe(2);
      const mainModelTurns = mainRec.turns.filter((t) => t.type === 'model');
      const mainToolTurns = mainRec.turns.filter((t) => t.type === 'tool');
      expect(mainModelTurns).toHaveLength(2);
      expect(mainToolTurns).toHaveLength(1);

      const researcherRec = loadAgentRecording(recDir, 'researcher');
      expect(researcherRec.version).toBe(2);
      const researcherModelTurns = researcherRec.turns.filter((t) => t.type === 'model');
      const researcherToolTurns = researcherRec.turns.filter((t) => t.type === 'tool');
      expect(researcherModelTurns).toHaveLength(2);
      expect(researcherToolTurns).toHaveLength(1);
    });

    it('should handle parallel subagent recording correctly', () => {
      const recorder = new Recorder();

      // 模拟并行子 agent：main 同时调用两个子 agent
      recorder.record(
        'main',
        new AIMessage({
          content: '',
          tool_calls: [
            { id: 'call_t1', name: 'task', args: { subagent_type: 'agent-a' } },
            { id: 'call_t2', name: 'task', args: { subagent_type: 'agent-b' } },
          ],
        }),
      );

      // 两个子 agent 交替执行
      recorder.record('agent-a', new AIMessage({ content: 'A result' }));
      recorder.record('agent-b', new AIMessage({ content: 'B result' }));

      recorder.recordToolResult(
        'main',
        new ToolMessage({ content: 'A result', tool_call_id: 'call_t1', name: 'task' }),
        'call_t1',
      );
      recorder.recordToolResult(
        'main',
        new ToolMessage({ content: 'B result', tool_call_id: 'call_t2', name: 'task' }),
        'call_t2',
      );

      recorder.record('main', new AIMessage({ content: 'Both tasks done' }));

      const recDir = path.join(tmpDir, 'parallel-subagent');
      recorder.flush(recDir, 'parallel-id', 'completed');

      const manifest = loadManifest(recDir);
      expect(manifest.sequence).toHaveLength(6);

      // 验证三个 agent 的录像文件都存在（v2 格式）
      const mainRec = loadAgentRecording(recDir, 'main');
      expect(mainRec.turns.filter((t) => t.type === 'model')).toHaveLength(2);
      expect(mainRec.turns.filter((t) => t.type === 'tool')).toHaveLength(2);

      const agentARec = loadAgentRecording(recDir, 'agent-a');
      expect(agentARec.turns.filter((t) => t.type === 'model')).toHaveLength(1);

      const agentBRec = loadAgentRecording(recDir, 'agent-b');
      expect(agentBRec.turns.filter((t) => t.type === 'model')).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // 4. 录制-回放 round-trip（含子 agent）
  // -----------------------------------------------------------------------
  describe('round-trip recording with subagents', () => {
    it('should replay multi-agent recording with model responses in correct order', async () => {
      const recorder = new Recorder();
      const recDir = path.join(tmpDir, 'roundtrip-subagent');

      // --- 录制阶段 ---
      const mainModel = fakeModel()
        .respondWithTools([
          {
            name: 'task',
            args: { description: 'check facts', subagent_type: 'fact-checker' },
          },
        ])
        .respond(new AIMessage({ content: 'Facts have been verified' }));

      const recordingModel = createRecordingModel(mainModel, recorder, 'main');

      // main agent 第一次调用：决定使用 task tool
      await recordingModel.invoke([new HumanMessage('Check these facts')]);

      // 子 agent 的 LLM 调用（通过 metadata 标识 agent name）
      const subModel = fakeModel().respond(new AIMessage({ content: 'All facts verified' }));
      const subRecordingModel = createRecordingModel(subModel, recorder, 'fact-checker');
      await subRecordingModel.invoke([new HumanMessage('verify facts')]);

      // main agent 第二次调用：生成最终回复
      await recordingModel.invoke([
        new HumanMessage('Check these facts'),
        new ToolMessage({
          content: 'All facts verified',
          tool_call_id: 'call_1',
          name: 'task',
        }),
      ]);

      recorder.flush(recDir, 'roundtrip-id', 'completed');

      // --- 回放阶段 ---
      const replayModel = buildReplayModel(recDir);

      // 按全局序列顺序回放：main[0], fact-checker[0], main[1]
      const r1 = await replayModel.invoke([new HumanMessage('q1')]);
      expect(r1.tool_calls).toHaveLength(1);
      expect(r1.tool_calls[0]!.name).toBe('task');

      const r2 = await replayModel.invoke([new HumanMessage('q2')]);
      expect(r2.content).toBe('All facts verified');

      const r3 = await replayModel.invoke([new HumanMessage('q3')]);
      expect(r3.content).toBe('Facts have been verified');
    });

    it('should replay tool results by toolCallId', async () => {
      const recorder = new Recorder();
      const recDir = path.join(tmpDir, 'tool-replay');

      // 录制 tool 结果
      recorder.record(
        'main',
        new AIMessage({
          content: '',
          tool_calls: [
            { id: 'call_verify', name: 'verify_claim', args: { claim: 'Earth is round' } },
          ],
        }),
      );

      recorder.recordToolResult(
        'main',
        new ToolMessage({
          content: 'Verified: Earth is round',
          tool_call_id: 'call_verify',
          name: 'verify_claim',
        }),
        'call_verify',
      );

      recorder.record('main', new AIMessage({ content: 'The claim has been verified' }));

      recorder.flush(recDir, 'tool-replay-id', 'completed');

      // 加载 tool results
      const toolResults = loadToolResults(recDir);
      expect(toolResults.size).toBe(1);
      expect(toolResults.has('call_verify')).toBe(true);

      const toolMsg = toolResults.get('call_verify')!;
      expect(toolMsg.content).toBe('Verified: Earth is round');
    });
  });

  // -----------------------------------------------------------------------
  // 5. 子 agent tool 结果的录制与回放
  // -----------------------------------------------------------------------
  describe('subagent tool results recording and replay', () => {
    it('should record and load subagent tool results separately from main agent', () => {
      const recorder = new Recorder();
      const recDir = path.join(tmpDir, 'subagent-tool-results');

      // main agent 调用 task tool
      recorder.record(
        'main',
        new AIMessage({
          content: '',
          tool_calls: [{ id: 'call_task', name: 'task', args: { subagent_type: 'researcher' } }],
        }),
      );

      // researcher 子 agent 内部调用 get_news tool
      recorder.record(
        'researcher',
        new AIMessage({
          content: '',
          tool_calls: [{ id: 'call_news', name: 'get_news', args: { topic: 'AI' } }],
        }),
      );

      // researcher 的 get_news tool 结果
      recorder.recordToolResult(
        'researcher',
        new ToolMessage({
          content: 'Breaking: AI advances rapidly',
          tool_call_id: 'call_news',
          name: 'get_news',
        }),
        'call_news',
      );

      // researcher 最终回复
      recorder.record('researcher', new AIMessage({ content: 'Research complete' }));

      // task tool 结果返回给 main
      recorder.recordToolResult(
        'main',
        new ToolMessage({
          content: 'Research complete',
          tool_call_id: 'call_task',
          name: 'task',
        }),
        'call_task',
      );

      // main 最终回复
      recorder.record('main', new AIMessage({ content: 'Here are the findings' }));

      recorder.flush(recDir, 'sub-tool-id', 'completed');

      // 验证 tool results 按 toolCallId 正确加载
      const toolResults = loadToolResults(recDir);
      expect(toolResults.size).toBe(2);

      // researcher 的 tool result
      const newsResult = toolResults.get('call_news')!;
      expect(newsResult.content).toBe('Breaking: AI advances rapidly');

      // main 的 task tool result
      const taskResult = toolResults.get('call_task')!;
      expect(taskResult.content).toBe('Research complete');
    });

    it('should round-trip subagent tool results through record and replay', () => {
      const recorder = new Recorder();
      const recDir = path.join(tmpDir, 'subagent-tool-roundtrip');

      // 录制包含子 agent tool 调用的完整会话
      recorder.record(
        'main',
        new AIMessage({
          content: '',
          tool_calls: [{ id: 'call_t', name: 'task', args: { subagent_type: 'checker' } }],
        }),
      );

      recorder.record(
        'checker',
        new AIMessage({
          content: '',
          tool_calls: [{ id: 'call_v1', name: 'verify_claim', args: { claim: 'Water is H2O' } }],
        }),
      );

      recorder.recordToolResult(
        'checker',
        new ToolMessage({
          content: 'Verified: Water is H2O',
          tool_call_id: 'call_v1',
          name: 'verify_claim',
        }),
        'call_v1',
      );

      recorder.record('checker', new AIMessage({ content: 'Verification done' }));

      recorder.recordToolResult(
        'main',
        new ToolMessage({
          content: 'Verification done',
          tool_call_id: 'call_t',
          name: 'task',
        }),
        'call_t',
      );

      recorder.record('main', new AIMessage({ content: 'All verified' }));

      recorder.flush(recDir, 'rt-id', 'completed');

      // 回放：验证 model 响应顺序
      const replayModel = buildReplayModel(recDir);

      // 按全局 sequence 回放（跳过 tool 条目）：
      // main[0], checker[0], checker[1], main[1]
      const invoke = async () => replayModel.invoke([new HumanMessage('q')]);

      return Promise.all([invoke(), invoke(), invoke(), invoke()]).then(([r1, r2, r3, r4]) => {
        // main 的 task tool 调用
        expect(r1!.tool_calls).toHaveLength(1);
        expect(r1!.tool_calls[0]!.name).toBe('task');

        // checker 的 verify_claim tool 调用
        expect(r2!.tool_calls).toHaveLength(1);
        expect(r2!.tool_calls[0]!.name).toBe('verify_claim');

        // checker 的最终回复
        expect(r3!.content).toBe('Verification done');

        // main 的最终回复
        expect(r4!.content).toBe('All verified');
      });
    });
  });

  // -----------------------------------------------------------------------
  // 6. inline SubAgent 的 tool 结果录制到父 recorder
  // -----------------------------------------------------------------------
  describe('inline SubAgent tool results recorded to parent', () => {
    it('should record inline SubAgent tool results in parent recording via shared middleware', async () => {
      const recDir = path.join(tmpDir, 'inline-tool-rec');

      // inline SubAgent 的 fakeModel：先调用 verify_claim tool，再生成最终回复
      const subagentModel = patchFakeModelBindTools(
        fakeModel()
          .respondWithTools([{ name: 'verify_claim', args: { claim: 'The sky is blue' } }])
          .respond(new AIMessage({ content: 'Claim verified successfully' })),
      );

      // 父 agent 的 fakeModel：先调用 task tool 委派给 inline SubAgent，再生成最终回复
      const parentModel = patchFakeModelBindTools(
        fakeModel()
          .respondWithTools([
            {
              name: 'task',
              args: {
                description: 'Verify this claim',
                subagent_type: 'fact-checker',
              },
            },
          ])
          .respond(new AIMessage({ content: 'Verification complete.' })),
      );

      const parentAgent = createDeepAgent({
        model: parentModel,
        systemPrompt: 'You are a coordinator.',
        tools: [],
        subagents: [
          {
            name: 'fact-checker',
            description: 'Verifies factual claims.',
            systemPrompt: 'You are a fact checker. Use verify_claim tool.',
            tools: [verifyClaim],
            model: subagentModel,
          } satisfies SubAgent,
        ],
        recording: {
          mode: 'record',
          path: recDir,
          id: 'inline-tool-test',
        },
      });

      await parentAgent.invoke(
        { messages: [new HumanMessage('Verify that the sky is blue')] },
        { recursionLimit: 50 },
      );

      // 验证录像
      const dir = path.join(recDir, 'inline-tool-test');
      const manifest = loadManifest(dir);
      expect(manifest.status).toBe('completed');

      // manifest 中应包含 tool 条目（来自 inline SubAgent 的 verify_claim 调用）
      const toolEntries = manifest.sequence.filter((s) => s.type === 'tool');
      // 至少 2 个 tool 条目：verify_claim 结果 + task tool 结果
      expect(toolEntries.length).toBeGreaterThanOrEqual(2);

      // 验证 tool results 可加载
      const toolResults = loadToolResults(dir);
      // 至少包含 verify_claim 的 tool result
      const hasVerifyResult = [...toolResults.values()].some(
        (msg) => typeof msg.content === 'string' && msg.content.includes('Verified:'),
      );
      expect(hasVerifyResult).toBe(true);

      // 验证录像文件是 v2 格式
      const mainRec = loadAgentRecording(dir, 'main');
      expect(mainRec.version).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // 7. inline SubAgent 模型输出应归属到正确的 agent 名（非 "main"）
  // -----------------------------------------------------------------------
  describe('inline SubAgent model outputs attributed to correct agent name', () => {
    it('should record inline SubAgent model responses under subagent name, not "main"', async () => {
      const recDir = path.join(tmpDir, 'agent-name-attr');

      // inline SubAgent 的 fakeModel：先调用 verify_claim tool，再生成最终回复
      const subagentModel = patchFakeModelBindTools(
        fakeModel()
          .respondWithTools([{ name: 'verify_claim', args: { claim: 'Water is wet' } }])
          .respond(new AIMessage({ content: 'Claim verified: water is indeed wet' })),
      );

      // 父 agent 的 fakeModel：先调用 task tool 委派给 inline SubAgent，再生成最终回复
      const parentModel = patchFakeModelBindTools(
        fakeModel()
          .respondWithTools([
            {
              name: 'task',
              args: {
                description: 'Verify that water is wet',
                subagent_type: 'fact-checker',
              },
            },
          ])
          .respond(new AIMessage({ content: 'Done.' })),
      );

      const parentAgent = createDeepAgent({
        model: parentModel,
        systemPrompt: 'You are a coordinator.',
        tools: [],
        subagents: [
          {
            name: 'fact-checker',
            description: 'Verifies factual claims.',
            systemPrompt: 'You are a fact checker.',
            tools: [verifyClaim],
            model: subagentModel,
          } satisfies SubAgent,
        ],
        recording: {
          mode: 'record',
          path: recDir,
          id: 'agent-name-test',
        },
      });

      await parentAgent.invoke(
        { messages: [new HumanMessage('Verify that water is wet')] },
        { recursionLimit: 50 },
      );

      const dir = path.join(recDir, 'agent-name-test');
      const manifest = loadManifest(dir);
      expect(manifest.status).toBe('completed');

      // ── 核心断言：manifest.sequence 中的 model 条目应包含 agent="fact-checker" ──
      const modelEntries = manifest.sequence.filter((s) => s.type === 'model');
      const mainModelEntries = modelEntries.filter((s) => s.agent === 'main');
      const subagentModelEntries = modelEntries.filter((s) => s.agent === 'fact-checker');

      // 父 agent 有 2 个 model 条目（tool call + final response）
      expect(mainModelEntries.length).toBe(2);
      // 子 agent 有 2 个 model 条目（tool call + final response）
      expect(subagentModelEntries.length).toBe(2);

      // ── 确认没有子 agent 输出被错误归属到 "main" ──
      // 总共应有 4 个 model 条目（main 2 + fact-checker 2），全部已覆盖
      expect(modelEntries.length).toBe(4);

      // ── tool 条目也应归属到正确的 agent ──
      const toolEntries = manifest.sequence.filter((s) => s.type === 'tool');
      const subagentToolEntries = toolEntries.filter((s) => s.agent === 'fact-checker');
      // 子 agent 至少有 verify_claim 的 tool result
      expect(subagentToolEntries.length).toBeGreaterThanOrEqual(1);

      // ── 验证 fact-checker 的录像文件存在且包含正确的 turns ──
      const factCheckerRec = loadAgentRecording(dir, 'fact-checker');
      expect(factCheckerRec.version).toBe(2);
      expect(factCheckerRec.agent).toBe('fact-checker');
      expect(factCheckerRec.turns.length).toBeGreaterThanOrEqual(2);
    });
  });

  // -----------------------------------------------------------------------
  // 8. createDeepAgent 父子 agent 完整录制与回放
  // -----------------------------------------------------------------------
  describe('createDeepAgent hierarchical recording and replay', () => {
    it('should record both parent and child agent when both use createDeepAgent with recording', async () => {
      const parentRecDir = path.join(tmpDir, 'parent-rec');
      const childRecDir = path.join(tmpDir, 'child-rec');

      // 子 agent：fakeModel 直接回复文本（不调用 tool）
      const childModel = patchFakeModelBindTools(
        fakeModel().respond(
          new AIMessage({ content: 'Research findings: AI is advancing rapidly' }),
        ),
      );

      const childAgent = createDeepAgent({
        model: childModel,
        systemPrompt: 'You are a research specialist.',
        tools: [getNews],
        recording: {
          mode: 'record',
          path: childRecDir,
          id: 'child-research',
        },
      });

      // 父 agent：fakeModel 先发起 task tool 调用，再生成最终回复
      const parentModel = patchFakeModelBindTools(
        fakeModel()
          .respondWithTools([
            {
              name: 'task',
              args: {
                description: 'Research the latest developments in AI',
                subagent_type: 'research-specialist',
              },
            },
          ])
          .respond(
            new AIMessage({
              content: 'Based on the research: AI is making significant progress.',
            }),
          ),
      );

      const parentAgent = createDeepAgent({
        model: parentModel,
        systemPrompt: 'You are a coordinator.',
        tools: [],
        subagents: [
          {
            name: 'research-specialist',
            description: 'A specialized research agent.',
            runnable: childAgent,
          } satisfies CompiledSubAgent,
        ],
        recording: {
          mode: 'record',
          path: parentRecDir,
          id: 'parent-coordinator',
        },
      });

      const result = await parentAgent.invoke(
        { messages: [new HumanMessage('Research AI developments')] },
        { recursionLimit: 50 },
      );

      // 验证父 agent 返回了正确的最终回复
      const lastMsg = result.messages[result.messages.length - 1]!;
      expect(lastMsg.content).toContain('AI is making significant progress');

      // 验证父 agent 录像
      const parentDir = path.join(parentRecDir, 'parent-coordinator');
      expect(fs.existsSync(path.join(parentDir, 'manifest.json'))).toBe(true);
      const parentManifest = loadManifest(parentDir);
      expect(parentManifest.status).toBe('completed');
      // 至少有 2 个 model 条目（tool call + final response）
      const modelEntries = parentManifest.sequence.filter((s) => s.type === 'model');
      expect(modelEntries.length).toBeGreaterThanOrEqual(2);
      // 至少有 1 个 tool 条目（task tool result）
      const toolEntries = parentManifest.sequence.filter((s) => s.type === 'tool');
      expect(toolEntries.length).toBeGreaterThanOrEqual(1);

      // 验证父录像是 v2 格式
      const parentRec = loadAgentRecording(parentDir, 'main');
      expect(parentRec.version).toBe(2);

      // 验证子 agent 录像
      const childDir = path.join(childRecDir, 'child-research');
      expect(fs.existsSync(path.join(childDir, 'manifest.json'))).toBe(true);
      const childManifest = loadManifest(childDir);
      expect(childManifest.status).toBe('completed');
      // 子 agent 至少有 1 个 model 响应
      const childModelEntries = childManifest.sequence.filter((s) => s.type === 'model');
      expect(childModelEntries.length).toBeGreaterThanOrEqual(1);
    });

    it('should replay parent and child agent from recorded data', async () => {
      const parentRecDir = path.join(tmpDir, 'replay-parent-rec');
      const childRecDir = path.join(tmpDir, 'replay-child-rec');

      // --- 录制阶段 ---
      const childModel = patchFakeModelBindTools(
        fakeModel().respond(
          new AIMessage({ content: 'Child research result: quantum computing breakthroughs' }),
        ),
      );

      const childAgent = createDeepAgent({
        model: childModel,
        systemPrompt: 'You are a research specialist.',
        tools: [getNews],
        recording: {
          mode: 'record',
          path: childRecDir,
          id: 'replay-child',
        },
      });

      const parentModel = patchFakeModelBindTools(
        fakeModel()
          .respondWithTools([
            {
              name: 'task',
              args: {
                description: 'Research quantum computing',
                subagent_type: 'researcher',
              },
            },
          ])
          .respond(
            new AIMessage({
              content: 'Summary: quantum computing is progressing.',
            }),
          ),
      );

      const parentAgent = createDeepAgent({
        model: parentModel,
        systemPrompt: 'You are a coordinator.',
        tools: [],
        subagents: [
          {
            name: 'researcher',
            description: 'A research agent.',
            runnable: childAgent,
          } satisfies CompiledSubAgent,
        ],
        recording: {
          mode: 'record',
          path: parentRecDir,
          id: 'replay-parent',
        },
      });

      await parentAgent.invoke(
        { messages: [new HumanMessage('Research quantum computing')] },
        { recursionLimit: 50 },
      );

      // 确认录制成功
      const parentDir = path.join(parentRecDir, 'replay-parent');
      const childDir = path.join(childRecDir, 'replay-child');
      expect(loadManifest(parentDir).status).toBe('completed');
      expect(loadManifest(childDir).status).toBe('completed');

      // --- 回放阶段 ---
      // 子 agent 用 replay 模式
      const replayChildAgent = createDeepAgent({
        model: fakeModel(), // 会被 replay 模式覆盖
        systemPrompt: 'You are a research specialist.',
        tools: [getNews],
        recording: {
          mode: 'replay',
          path: childRecDir,
          id: 'replay-child',
        },
      });

      // 父 agent 用 replay 模式
      const replayParentAgent = createDeepAgent({
        model: fakeModel(), // 会被 replay 模式覆盖
        systemPrompt: 'You are a coordinator.',
        tools: [],
        subagents: [
          {
            name: 'researcher',
            description: 'A research agent.',
            runnable: replayChildAgent,
          } satisfies CompiledSubAgent,
        ],
        recording: {
          mode: 'replay',
          path: parentRecDir,
          id: 'replay-parent',
        },
      });

      const replayResult = await replayParentAgent.invoke(
        { messages: [new HumanMessage('Research quantum computing')] },
        { recursionLimit: 50 },
      );

      // 验证回放结果包含正确的最终回复
      const lastMsg = replayResult.messages[replayResult.messages.length - 1]!;
      expect(lastMsg.content).toContain('quantum computing is progressing');
    });
  });
});
