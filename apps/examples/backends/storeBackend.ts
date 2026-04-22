import 'dotenv/config';
import { z } from 'zod';
import { tool } from 'langchain';
import { TavilySearch } from '@langchain/tavily';
import { HumanMessage } from '@langchain/core/messages';
import { MemorySaver } from '@langchain/langgraph-checkpoint';
import * as fs from 'fs';

import { createUniverseAgent, StoreBackend, JsonFileStore } from '@universe-agent/agent';
import { v4 as uuidv4 } from 'uuid';

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

const systemPrompt = `You are a research assistant with persistent cross-conversation storage.

Your files persist across all conversations and threads using the store.

## Workflow

1. Write your research question to \`research_question.txt\`
2. Gather information using the internet_search tool
3. Write your findings to \`research_notes.txt\` as you discover them
4. Once you have enough information, write a final summary to \`summary.md\`

## Important

All files you create are shared across ALL conversations. This means you can reference
previous research in new conversations.`;

const storeFilePath = './.data/store.json';
if (fs.existsSync(storeFilePath)) {
  fs.rmSync(storeFilePath);
}
const store = new JsonFileStore({ filePath: './.data/store.json' });
store.start();

// 注意：claude-haiku-4.5在调用时，并不会优先去之前存储的内容，而是优先去进行网络搜索
// 由此可见，模型的理解力决定了它能否按照提示词的要求去执行指令
// 该示例中，claude-sonnet-4.6能够正确地优先使用之前存储的内容，故而此处显示地将模型设置为claude-sonnet-4.6
process.env.OPENAI_MODEL = 'claude-sonnet-4.6';

export const agent = createUniverseAgent({
  tools: [internetSearch],
  systemPrompt,
  checkpointer: new MemorySaver(),
  store,
  backend: new StoreBackend(),
  recording: {
    mode: 'auto',
  },
});

async function main() {
  const threadId = uuidv4();

  const message = new HumanMessage('Research the latest trends in AI agents for 2025');
  const result1 = await agent.invoke(
    { messages: [message] },
    { recursionLimit: 50, configurable: { thread_id: threadId } },
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
