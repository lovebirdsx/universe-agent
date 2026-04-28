import { ChatOpenAI } from '@langchain/openai';
import type { BaseLanguageModel } from '@langchain/core/language_models/base';

export interface ModelResolverConfig {
  /** 模型名称，支持 "provider:model" 格式（如 "anthropic:claude-sonnet-4-6"）*/
  model: string;
  /** OpenAI-compatible API Key（覆盖环境变量 OPENAI_API_KEY）*/
  apiKey?: string;
  /** 自定义 API Base URL（覆盖环境变量 OPENAI_API_BASEURL）*/
  apiBaseUrl?: string;
}

/**
 * 根据配置解析最终的 LLM 实例或模型名字符串。
 *
 * 优先级（高→低）：
 *   配置参数 > 环境变量 > LangChain 内置默认行为
 *
 * 返回 string 时，由 LangChain initChatModel 进一步解析（支持 "provider:model" 格式）。
 * 返回 BaseLanguageModel 时，已完整构建好 ChatOpenAI 实例。
 */
export function resolveModelFromConfig(config: ModelResolverConfig): BaseLanguageModel | string {
  const { model } = config;
  const apiKey = config.apiKey ?? process.env['OPENAI_API_KEY'];
  const apiBaseUrl = config.apiBaseUrl ?? process.env['OPENAI_API_BASEURL'];

  // 有 baseUrl → 必须走 OpenAI-compatible 路径（initChatModel 不支持自定义 baseURL）
  if (apiBaseUrl) {
    return new ChatOpenAI({
      model,
      // 无 key 时用 'ollama' 占位，兼容不校验 key 的本地服务（Ollama、LM Studio 等）
      apiKey: apiKey ?? 'ollama',
      configuration: { baseURL: apiBaseUrl },
    });
  }

  // 有 apiKey 且看起来是 OpenAI 模型 → 走标准 OpenAI 端点
  if (apiKey && isOpenAIModel(model)) {
    return new ChatOpenAI({ model, apiKey });
  }

  // 其他情况返回 string，由 LangChain initChatModel 解析
  // anthropic:claude-* 格式会自动使用 ANTHROPIC_API_KEY 环境变量
  return model;
}

/** 简单启发式判断是否为 OpenAI 系列模型（用于无 baseUrl 时的自动路由） */
function isOpenAIModel(model: string): boolean {
  if (model.includes(':')) {
    return model.split(':')[0]!.toLowerCase() === 'openai';
  }
  const lower = model.toLowerCase();
  return (
    lower.startsWith('gpt-') ||
    lower.startsWith('o1') ||
    lower.startsWith('o3') ||
    lower.startsWith('o4') ||
    lower === 'chatgpt-4o-latest'
  );
}
