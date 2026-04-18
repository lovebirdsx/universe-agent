import 'dotenv/config';
import { z } from 'zod';
import { tool } from 'langchain';
import { TavilySearch } from '@langchain/tavily';
import { HumanMessage } from '@langchain/core/messages';
import { MemorySaver } from '@langchain/langgraph-checkpoint';
import { v4 as uuidv4 } from 'uuid';

import {
  createDeepAgent,
  CompositeBackend,
  JsonFileStore,
  StoreBackend,
  StateBackend,
} from '@universe-agent/agent';

const internetSearch = tool(
  async ({ query, maxResults = 5 }: { query: string; maxResults?: number }) => {
    const tavilySearch = new TavilySearch({
      maxResults,
      tavilyApiKey: process.env.TAVILY_API_KEY!,
    });
    // oxlint-disable-next-line @typescript-eslint/ban-ts-comment
    const tavilyResponse = await tavilySearch._call({ query } as never);
    return tavilyResponse;
  },
  {
    name: 'internet_search',
    description: 'Run a web search',
    schema: z.object({
      query: z.string().describe('The search query'),
      maxResults: z.number().optional().default(5).describe('Maximum number of results to return'),
    }),
  },
);

const systemPrompt = `You are a research assistant with both temporary and persistent storage.

## Storage Types

1. **Temporary files** (root directory): Stored in state, lost after conversation
   - Use for: scratch notes, intermediate work
   - Example: \`/research_notes.txt\`, \`/draft.md\`

2. **Persistent memory** (\`/memories/\` directory): Stored in database, kept forever
   - Use for: final reports, important findingss
   - Example: \`/memories/report_2025_ai_trends.md\`

## Workflow

1. Write your research question to \`/research_question.txt\` (temporary)
2. Gather information using the internet_search tool
3. Write your findings to \`/research_notes.txt\` (temporary) as you discover them
4. Once you have enough information, write a final summary to \`/summary.md\` (temporary)
5. **IMPORTANT**: Save the final report to \`/memories/report_TOPIC.md\` (persistent)

## Memory Guidelines

Always save completed reports to \`/memories/\` so they can be referenced in future conversations.
Use descriptive filenames like:
- \`/memories/report_ai_agents_2025.md\`
- \`/memories/findings_quantum_computing.md\`
- \`/memories/summary_market_analysis.md\``;

const store = new JsonFileStore({ filePath: './.data/store.json' });
store.start();

// 注意：claude-haiku-4.5在调用时，并不会优先去之前存储的内容，而是优先去进行网络搜索
// 由此可见，模型的理解力决定了它能否按照提示词的要求去执行指令
// 该示例中，claude-sonnet-4.6能够正确地优先使用之前存储的内容，故而此处显示地将模型设置为claude-sonnet-4.6
process.env.OPENAI_MODEL = 'claude-sonnet-4.6';

export const agent = createDeepAgent({
  tools: [internetSearch],
  systemPrompt,
  checkpointer: new MemorySaver(),
  store,
  backend: new CompositeBackend(new StateBackend(), {
    '/memories/': new StoreBackend(),
  }),
});

async function main() {
  const threadId = uuidv4();

  const result1 = await agent.invoke(
    {
      messages: [new HumanMessage('Research the latest trends in AI agents for 2025')],
    },
    {
      recursionLimit: 50,
      configurable: { thread_id: threadId },
    },
  );

  for (const message of result1.messages) {
    if (message instanceof HumanMessage) {
      console.log('Human:', message.text);
    } else {
      console.log('Agent:', message.text);
    }
  }

  const threadId2 = uuidv4();
  const result2 = await agent.invoke(
    {
      messages: [
        new HumanMessage('Do you have any info on the latest trends in AI agents for 2025?'),
      ],
    },
    {
      recursionLimit: 50,
      configurable: { thread_id: threadId2 },
    },
  );

  for (const message of result2.messages) {
    if (message instanceof HumanMessage) {
      console.log('Human:', message.text);
    } else {
      console.log('Agent:', message.text);
    }
  }
}

main();
