/**
 * Self-hosted LLM: API-KEY header, JSON body { model, messages }.
 * Response is normalized like openai.js when the server returns OpenAI-style JSON.
 */

export function getCustomConfig(env) {
  if (!env.url) throw new Error('CUSTOM_LLM_URL is required when LLM_PROVIDER=custom.');
  if (!env.apiKey) throw new Error('CUSTOM_LLM_API_KEY is required when LLM_PROVIDER=custom.');
  if (!env.model) throw new Error('Model name is required for custom LLM (UI or CUSTOM_LLM_MODEL).');
  return env;
}

export async function invokeWithTools(config, messages, tools) {
  const openAiMessages = messages.map(toPlainMessage);

  const body = {
    model: config.model,
    messages: openAiMessages
  };

  // Forward tools if your server supports OpenAI-style tool calling later.
  if (tools.length) {
    body.tools = tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: zodToJsonSchema(t.schema)
      }
    }));
    body.tool_choice = 'auto';
  }

  const response = await fetch(config.url, {
    method: 'POST',
    headers: {
      accept: 'application.json',
      'Content-Type': 'application/json',
      'API-KEY': config.apiKey
    },
    body: JSON.stringify(body)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data.error?.message ?? data.message ?? response.statusText;
    throw new Error(`Custom LLM error (${response.status}): ${detail}`);
  }

  return normalizeCustomResponse(data);
}

function toPlainMessage(message) {
  const role = message._getType?.() ?? message.role;
  if (role === 'system') return { role: 'system', content: String(message.content) };
  if (role === 'human' || role === 'user') return { role: 'user', content: String(message.content) };
  if (role === 'ai' || role === 'assistant') {
    const out = { role: 'assistant', content: message.content ?? '' };
    if (message.tool_calls?.length) {
      out.tool_calls = message.tool_calls.map(call => ({
        id: call.id,
        type: 'function',
        function: {
          name: call.name,
          arguments: typeof call.args === 'string' ? call.args : JSON.stringify(call.args ?? {})
        }
      }));
    }
    return out;
  }
  if (role === 'tool') {
    return {
      role: 'tool',
      tool_call_id: message.tool_call_id,
      content: typeof message.content === 'string' ? message.content : JSON.stringify(message.content)
    };
  }
  return { role: 'user', content: String(message.content) };
}

function normalizeCustomResponse(data) {
  const choice = data.choices?.[0]?.message ?? data.message ?? data;
  const rawToolCalls = choice.tool_calls ?? [];
  const toolCalls = rawToolCalls.map(call => ({
    id: call.id ?? crypto.randomUUID(),
    name: call.function?.name ?? call.name,
    arguments: parseArgs(call.function?.arguments ?? call.arguments)
  }));
  const content = choice.content ?? data.content ?? null;
  return {
    content: typeof content === 'string' ? content : null,
    toolCalls
  };
}

function parseArgs(value) {
  if (value == null) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

/** Minimal Zod → JSON Schema for tool definitions (objects only). */
function zodToJsonSchema(schema) {
  if (schema?._def?.typeName === 'ZodObject') {
    const shape = schema._def.shape();
    const properties = {};
    const required = [];
    for (const [key, field] of Object.entries(shape)) {
      properties[key] = { type: zodFieldType(field) };
      if (!field.isOptional?.() && !field.isNullable?.()) required.push(key);
    }
    return { type: 'object', properties, required, additionalProperties: false };
  }
  return { type: 'object', additionalProperties: true };
}

function zodFieldType(field) {
  const name = field._def?.typeName;
  if (name === 'ZodString') return 'string';
  if (name === 'ZodNumber') return 'number';
  if (name === 'ZodBoolean') return 'boolean';
  if (name === 'ZodEnum') return 'string';
  return 'string';
}
