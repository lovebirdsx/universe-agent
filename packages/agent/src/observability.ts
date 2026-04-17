import type { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import { CallbackHandler } from '@langfuse/langchain';
import type { LangfuseHandlerOptions } from './types.js';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { LangfuseSpanProcessor } from '@langfuse/otel';

let sdk: NodeSDK | undefined = undefined;
const callbackHandlerSet = new Set<BaseCallbackHandler>();

function initializeSdk() {
  if (sdk) return;

  sdk = new NodeSDK({
    spanProcessors: [new LangfuseSpanProcessor()],
  });
  sdk.start();
}

function addCallbackHandler(handler: BaseCallbackHandler) {
  callbackHandlerSet.add(handler);
}

async function removeCallbackHandler(handler: BaseCallbackHandler) {
  callbackHandlerSet.delete(handler);

  if (callbackHandlerSet.size > 0) {
    return;
  }

  if (!sdk) return;

  await sdk.shutdown();

  sdk = undefined;
}

/**
 * Dynamically creates a Langfuse CallbackHandler for LangChain observability.
 * Uses dynamic import to avoid hard dependency on langfuse-langchain.
 *
 * When called with no arguments, uses environment variables:
 * - LANGFUSE_PUBLIC_KEY
 * - LANGFUSE_SECRET_KEY
 * - LANGFUSE_BASEURL
 *
 * @param config - Optional Langfuse configuration. When omitted, environment variables are used.
 * @returns A LangChain-compatible callback handler
 * @throws Error if langfuse-langchain is not installed
 *
 * @example
 * ```typescript
 * // Use environment variables
 * const handler = await createLangfuseHandler();
 *
 * // Provide config directly
 * const handler = await createLangfuseHandler({
 *   metadata: { key: 'value' },
 *   sessionId: 'session-id',
 *   userId: 'user-id',
 * });
 *
 * const agent = createDeepAgent({ callbacks: [handler] });
 * ```
 */
export async function createLangfuseHandler(
  config?: LangfuseHandlerOptions,
): Promise<BaseCallbackHandler> {
  initializeSdk();
  const handler = new CallbackHandler(config);
  addCallbackHandler(handler);
  return handler;
}

/**
 * Flushes buffered Langfuse events to ensure all data is sent before shutdown.
 * Call this before process exit to avoid losing trace data.
 *
 * @param handler - The callback handler returned by `createLangfuseHandler`
 *
 * @example
 * ```typescript
 * const handler = await createLangfuseHandler();
 * const agent = createDeepAgent({ callbacks: [handler] });
 * const result = await agent.invoke({ messages: [...] });
 * await flushLangfuseHandler(handler);
 * ```
 */
export async function flushLangfuseHandler(handler: BaseCallbackHandler): Promise<void> {
  await removeCallbackHandler(handler);
}
