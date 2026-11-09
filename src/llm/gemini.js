import { ChatGoogleGenerativeAI } from '@langchain/google-genai';

/**
 * Google Gemini chat API (tool calling via LangChain).
 * Same shape as openai.js so the agent can swap providers.
 */
export function createGeminiModel(env) {
  if (!env.apiKey) throw new Error('GEMINI_API_KEY is required when LLM_PROVIDER=gemini.');
  return new ChatGoogleGenerativeAI({
    apiKey: env.apiKey,
    model: env.model,
    temperature: 0.2,
    ...(env.baseUrl ? { baseUrl: env.baseUrl.replace(/\/$/, '') } : {})
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
  return { content: text || null, toolCalls };
}
