import { createOpenAiModel, invokeWithTools as invokeOpenAi } from './openai.js';
import { createGeminiModel, invokeWithTools as invokeGemini } from './gemini.js';
import { getCustomConfig, invokeWithTools as invokeCustom } from './custom.js';

function defaultModel(provider) {
  if (provider === 'openai') return process.env.OPENAI_MODEL ?? '';
  if (provider === 'gemini') return process.env.GEMINI_MODEL ?? '';
  if (provider === 'custom') return process.env.CUSTOM_LLM_MODEL ?? '';
  return '';
}

/**
 * @param {string | undefined} modelName — from UI; falls back to env default if set
 */
export function loadLlm(modelName) {
  const provider = (process.env.LLM_PROVIDER ?? 'openai').toLowerCase();
  const model = String(modelName ?? '').trim() || defaultModel(provider);
  if (!model) {
    throw new Error('Model name is required (enter it in the UI or set a default in .env).');
  }

  if (provider === 'openai') {
    const baseModel = createOpenAiModel({
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
      model
    });
    return {
      provider: 'openai',
      model,
      invoke: (messages, tools) => invokeOpenAi(baseModel, messages, tools)
    };
  }

  if (provider === 'gemini') {
    const baseModel = createGeminiModel({
      apiKey: process.env.GEMINI_API_KEY,
      baseUrl: process.env.GEMINI_BASE_URL,
      model
    });
    return {
      provider: 'gemini',
      model,
      invoke: (messages, tools) => invokeGemini(baseModel, messages, tools)
    };
  }

  if (provider === 'custom') {
    const config = getCustomConfig({
      url: process.env.CUSTOM_LLM_URL,
      apiKey: process.env.CUSTOM_LLM_API_KEY,
      model
    });
    return {
      provider: 'custom',
      model,
      invoke: (messages, tools) => invokeCustom(config, messages, tools)
    };
  }

  throw new Error(`Unknown LLM_PROVIDER: ${provider}. Use openai, gemini, or custom.`);
}
