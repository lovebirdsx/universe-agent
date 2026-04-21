/**
 * 录像功能测试
 *
 * 使用 FakeModel 构造与 hierarchicalAgent.ts 相同的三层 agent 树结构，
 * 以 record 模式运行，验证录像输出的数据结构和 transcript.md 是否正确。
 *
 * Agent 树结构：
 * ```
 * Main Agent (orchestrator)
 *   ├── Tool: get_weather
 *   └── Sub Agent: research-specialist (DeepAgent)
 *       ├── Tool: get_news
 *       ├── Tool: analyze_data
 *       └── Sub Agent: fact-checker (simple SubAgent)
 *           └── Tool: verify_claim
 * ```
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { tool } from 'langchain';
import { z } from 'zod';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { fakeModel } from '@langchain/core/testing';
import type { BaseLanguageModel } from '@langchain/core/language_models/base';

import { createDeepAgent, type CompiledSubAgent, type SubAgent } from '@universe-agent/agent';

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * 修复 fakeModel 的 bindTools 问题。
 * FakeBuiltModel.bindTools 每次创建新实例并值拷贝 _callIndex，
 * 导致 agent 每步调用 bindTools 时计数器被重置为 0。
 * 用 withConfig 替代，共享同一个 model 实例和 _callIndex。
 */
function patchFakeModelBindTools<T extends BaseLanguageModel>(model: T): T {
  const originalWithConfig = model.withConfig.bind(model);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (model as any).bindTools = () => originalWithConfig({});
  return model;
}

// ─── Tools ──────────────────────────────────────────────────────────────────

const getWeather = tool((input) => `The weather in ${input.location} is sunny and 72°F.`, {
  name: 'get_weather',
  description: 'Get the current weather for a location',
  schema: z.object({
    location: z.string().describe('The city or location to get weather for'),
  }),
});

const getNews = tool(
  (input) =>
    `Latest news for "${input.topic}":\n` +
    `1. Major breakthrough in ${input.topic} announced today\n` +
    `2. Experts weigh in on the future of ${input.topic}\n` +
    `3. New study reveals surprising findings about ${input.topic}`,
  {
    name: 'get_news',
    description: 'Search for the latest news articles on a topic',
    schema: z.object({
      topic: z.string().describe('The topic to search news for'),
    }),
  },
);

const analyzeData = tool(
  (input) =>
    `Analysis of "${input.data}":\n` +
    `- Primary finding: significant growth in the area\n` +
    `- Recommendation: further investigation warranted`,
  {
    name: 'analyze_data',
    description: 'Analyze provided data and return insights',
    schema: z.object({
      data: z.string().describe('The data or topic to analyze'),
    }),
  },
);

const verifyClaim = tool(
  (input) =>
    `Verification of "${input.claim}":\n` +
    `Status: Verified\n` +
    `Confidence: High\n` +
    `Sources: 3 independent sources confirmed`,
  {
    name: 'verify_claim',
    description: 'Verify a factual claim against known sources',
    schema: z.object({
      claim: z.string().describe('The claim to verify'),
    }),
  },
);

// ─── Recording path ─────────────────────────────────────────────────────────

const RECORDING_BASE = './.data/recordings';
const MAIN_RECORDING_ID = 'replay-test';
const RESEARCH_RECORDING_ID = 'research-agent';

// ─── FakeModel 构造 ─────────────────────────────────────────────────────────

// 注意：不使用 respondWithTools()，因为它内部调用 deriveContent(messages) 将所有输入
// 消息拼接成 AIMessage.content，导致录像中 tool_call 响应的 content 包含 system prompt
// 等垃圾数据。改用 respond(new AIMessage({...})) 手动构造 tool_calls 来避免此问题。

// Fact Checker: 调用 verify_claim → 回复总结
const factCheckerModel = patchFakeModelBindTools(
  fakeModel()
    .respond(
      new AIMessage({
        content: '',
        tool_calls: [
          { id: 'tc_1', name: 'verify_claim', args: { claim: 'renewable energy growth' } },
        ],
      }),
    )
    .respond(new AIMessage({ content: 'Claim verified with high confidence.' })),
);

// Research Specialist: get_news → analyze_data → 委派 fact-checker → 回复总结
const researchModel = patchFakeModelBindTools(
  fakeModel()
    .respond(
      new AIMessage({
        content: '',
        tool_calls: [{ id: 'tc_2', name: 'get_news', args: { topic: 'renewable energy' } }],
      }),
    )
    .respond(
      new AIMessage({
        content: '',
        tool_calls: [
          { id: 'tc_3', name: 'analyze_data', args: { data: 'renewable energy trends' } },
        ],
      }),
    )
    .respond(
      new AIMessage({
        content: '',
        tool_calls: [
          {
            id: 'tc_4',
            name: 'task',
            args: {
              description: 'Verify the claim about renewable energy growth',
              subagent_type: 'fact-checker',
            },
          },
        ],
      }),
    )
    .respond(
      new AIMessage({
        content: 'Research complete: renewable energy is advancing rapidly.',
      }),
    ),
);

// Main Agent: Query1 get_weather → 回复 | Query2 委派 research-specialist → 回复
const mainModel = patchFakeModelBindTools(
  fakeModel()
    // Query 1: 天气查询
    .respond(
      new AIMessage({
        content: '',
        tool_calls: [{ id: 'tc_5', name: 'get_weather', args: { location: 'San Francisco' } }],
      }),
    )
    .respond(
      new AIMessage({
        content: 'The weather in San Francisco is sunny and 72°F.',
      }),
    )
    // Query 2: 研究查询，委派给 research-specialist
    .respond(
      new AIMessage({
        content: '',
        tool_calls: [
          {
            id: 'tc_6',
            name: 'task',
            args: {
              description: 'Research the latest developments in renewable energy',
              subagent_type: 'research-specialist',
            },
          },
        ],
      }),
    )
    .respond(
      new AIMessage({
        content:
          'Based on the research, renewable energy is growing rapidly with significant breakthroughs.',
      }),
    ),
);

// ─── Level 2: Fact Checker (inline SubAgent) ────────────────────────────────

const factCheckerSubAgent: SubAgent = {
  name: 'fact-checker',
  description:
    'A fact-checking agent that can verify claims. ' +
    'Use this when you need to validate specific facts or statements.',
  systemPrompt:
    'You are a fact-checking specialist. Use the verify_claim tool to check ' +
    'the accuracy of any claims or statements you receive.',
  tools: [verifyClaim],
  model: factCheckerModel,
};

// ─── Level 1: Research Specialist (CompiledSubAgent = createDeepAgent) ──────

const researchDeepAgent = createDeepAgent({
  model: researchModel,
  systemPrompt:
    'You are a research specialist. Your role is to gather news, analyze data, ' +
    'and produce well-researched findings.',
  tools: [getNews, analyzeData],
  subagents: [factCheckerSubAgent],
  recording: {
    mode: 'record',
    id: RESEARCH_RECORDING_ID,
    path: path.join(RECORDING_BASE, MAIN_RECORDING_ID),
  },
});

// ─── Level 0: Main Agent ────────────────────────────────────────────────────

const mainAgent = createDeepAgent({
  model: mainModel,
  systemPrompt:
    'You are a helpful assistant that coordinates different capabilities.\n\n' +
    '- For weather queries, use the get_weather tool directly\n' +
    '- For research queries, delegate to the research-specialist sub-agent',
  tools: [getWeather],
  subagents: [
    {
      name: 'research-specialist',
      description:
        'A specialized research agent that can search for news, analyze data, and verify facts.',
      runnable: researchDeepAgent,
    } satisfies CompiledSubAgent,
  ],
  recording: {
    mode: 'record',
    path: RECORDING_BASE,
    id: MAIN_RECORDING_ID,
  },
});

// ─── Run ─────────────────────────────────────────────────────────────────────

console.log('=== Replay Recording Test ===\n');

// Query 1: 天气查询（直接 tool 调用）
console.log('--- Query 1: Direct tool use (weather) ---');
const result1 = await mainAgent.invoke(
  { messages: [new HumanMessage("What's the weather in San Francisco?")] },
  { recursionLimit: 50 },
);
const lastMsg1 = result1.messages[result1.messages.length - 1]!;
console.log(
  'Response:',
  typeof lastMsg1.content === 'string' ? lastMsg1.content : lastMsg1.content,
);

// Query 2: 研究查询（委派到 research-specialist → fact-checker）
console.log('\n--- Query 2: Delegate to research sub-agent ---');
const result2 = await mainAgent.invoke(
  {
    messages: [
      new HumanMessage(
        'Research the latest developments in renewable energy and provide an analysis.',
      ),
    ],
  },
  { recursionLimit: 50 },
);
const lastMsg2 = result2.messages[result2.messages.length - 1]!;
console.log(
  'Response:',
  typeof lastMsg2.content === 'string' ? lastMsg2.content : lastMsg2.content,
);

console.log('\n=== Recording Output Verification ===\n');

const mainRecDir = path.resolve(RECORDING_BASE, MAIN_RECORDING_ID);

// Main agent manifest
console.log('--- Main Agent manifest.json ---');
const mainManifest = JSON.parse(fs.readFileSync(path.join(mainRecDir, 'manifest.json'), 'utf-8'));
console.log(JSON.stringify(mainManifest, null, 2));

// Main agent recording
console.log('\n--- Main Agent main.recording.json ---');
const mainRecording = JSON.parse(
  fs.readFileSync(path.join(mainRecDir, 'main.recording.json'), 'utf-8'),
);
console.log(`Version: ${mainRecording.version}`);
console.log(`Agent: ${mainRecording.agent}`);
console.log(`Tools: ${mainRecording.tools?.map((t: { name: string }) => t.name).join(', ')}`);
console.log(`Turns: ${mainRecording.turns.length}`);
