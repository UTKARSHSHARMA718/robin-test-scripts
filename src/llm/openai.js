import { ChatOpenAI } from '@langchain/openai';
import { extractLangChainUsage } from '../usage.js';

/**
 * OpenAI-compatible chat API (tool calling via LangChain).
 * Same shape as custom.js so the agent can swap providers.
 */
export function createOpenAiModel(env) {
  if (!env.apiKey) throw new Error('OPENAI_API_KEY is required when LLM_PROVIDER=openai.');
  return new ChatOpenAI({
    apiKey: env.apiKey,
    model: env.model,
    configuration: { baseURL: env.baseUrl?.replace(/\/$/, '') },
    temperature: 0.2
  });
}

export async function invokeWithTools(model, messages, tools) {
  const bound = tools.length ? model.bindTools(tools) : model;
  const response = await bound.invoke(messages);
  return { ...normalizeLangChainResponse(response), assistantMessage: response };
}

function normalizeLangChainResponse(response) {
  const toolCalls = (response.tool_calls ?? []).map(call => ({
    id: call.id,
    name: call.name,
    arguments: call.args ?? {}
  }));
  const text = typeof response.content === 'string'
    ? response.content
    : Array.isArray(response.content)
      ? response.content.filter(part => part.type === 'text').map(part => part.text).join('')
      : '';
  return { content: text || null, toolCalls, usage: extractLangChainUsage(response) };
}
