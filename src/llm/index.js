import { createOpenAiModel, invokeWithTools as invokeOpenAi } from './openai.js';
import { createGeminiModel, invokeWithTools as invokeGemini } from './gemini.js';
import { getCustomConfig, invokeWithTools as invokeCustom } from './custom.js';

export function loadLlmFromEnv() {
  const provider = (process.env.LLM_PROVIDER ?? 'gemini').toLowerCase();
  if (provider === 'openai') {
    return {
      provider: 'openai',
      async invoke(messages, tools) {
        const model = createOpenAiModel({
          apiKey: process.env.OPENAI_API_KEY,
          baseUrl: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
          model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini'
        });
        return invokeOpenAi(model, messages, tools);
      }
    };
  }
  if (provider === 'gemini') {
    return {
      provider: 'gemini',
      async invoke(messages, tools) {
        const model = createGeminiModel({
          apiKey: process.env.GEMINI_API_KEY,
          baseUrl: process.env.GEMINI_BASE_URL,
          model: process.env.GEMINI_MODEL ?? 'gemini-2.0-flash'
        });
        return invokeGemini(model, messages, tools);
      }
    };
  }
  if (provider === 'custom') {
    const config = getCustomConfig({
      url: process.env.CUSTOM_LLM_URL,
      apiKey: process.env.CUSTOM_LLM_API_KEY,
      model: process.env.CUSTOM_LLM_MODEL
    });
    return {
      provider: 'custom',
      invoke: (messages, tools) => invokeCustom(config, messages, tools)
    };
  }
  throw new Error(`Unknown LLM_PROVIDER: ${provider}. Use openai, gemini, or custom.`);
}
