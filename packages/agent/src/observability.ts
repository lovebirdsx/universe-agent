import type { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import { CallbackHandler } from '@langfuse/langchain';
import type { LangfuseHandlerOptions } from './types.js';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { LangfuseSpanProcessor } from '@langfuse/otel';

let sdk: NodeSDK | undefined = undefined;
const callbackHandlerSet = new Set<BaseCallbackHandler>();
let exitHandlerRegistered = false;

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

function registerExitHandler() {
  if (exitHandlerRegistered) return;
  exitHandlerRegistered = true;

  process.on('beforeExit', async () => {
    if (callbackHandlerSet.size === 0) return;

    const handlers = [...callbackHandlerSet];
    for (const handler of handlers) {
      await removeCallbackHandler(handler);
    }
  });
}

function getUserId(): string {
  const user =
    process.env['LANGFUSE_USER'] ||
    process.env['USER'] ||
    process.env['USERNAME'] ||
    'unknown_user';
  return user;
}

function getTags(): string[] {
  const tagsEnv = process.env['LANGFUSE_TAGS'];
  if (!tagsEnv) {
    return ['universe-agent'];
  }
  return tagsEnv.split(',').map((tag) => tag.trim());
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
  registerExitHandler();
  const handler = new CallbackHandler(config);
  addCallbackHandler(handler);
  return handler;
}

/**
 * Automatically creates a Langfuse handler if LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY
 * environment variables are set. Returns undefined if not configured.
 *
 * This is a synchronous function suitable for use in createDeepAgent().
 */
export function autoCreateLangfuseHandler(): BaseCallbackHandler | undefined {
  if (!process.env['LANGFUSE_PUBLIC_KEY'] || !process.env['LANGFUSE_SECRET_KEY']) {
    return undefined;
  }

  initializeSdk();
  registerExitHandler();
  const handler = new CallbackHandler({ userId: getUserId(), tags: getTags() });
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
