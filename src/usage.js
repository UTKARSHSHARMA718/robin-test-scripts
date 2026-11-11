/** Normalize provider usage into a common shape for aggregation. */
export function normalizeUsage(raw) {
  if (!raw) return emptyUsage();
  const prompt =
    raw.prompt_tokens ?? raw.promptTokens ?? raw.input_tokens ?? raw.inputTokens ?? 0;
  const completion =
    raw.completion_tokens ?? raw.completionTokens ?? raw.output_tokens ?? raw.outputTokens ?? 0;
  const cached =
    raw.prompt_tokens_details?.cached_tokens ??
    raw.cached_tokens ??
    raw.cachedTokens ??
    0;
  const total = raw.total_tokens ?? raw.totalTokens ?? prompt + completion;
  return {
    promptTokens: Number(prompt) || 0,
    completionTokens: Number(completion) || 0,
    cachedTokens: Number(cached) || 0,
    totalTokens: Number(total) || 0
  };
}

export function emptyUsage() {
  return {
    promptTokens: 0,
    completionTokens: 0,
    cachedTokens: 0,
    totalTokens: 0
  };
}

export function addUsage(total, part) {
  return {
    promptTokens: total.promptTokens + part.promptTokens,
    completionTokens: total.completionTokens + part.completionTokens,
    cachedTokens: total.cachedTokens + part.cachedTokens,
    totalTokens: total.totalTokens + part.totalTokens
  };
}

export function extractLangChainUsage(message) {
  const meta = message?.response_metadata ?? message?.usage_metadata ?? {};
  if (message?.usage_metadata) {
    return normalizeUsage({
      input_tokens: message.usage_metadata.input_tokens,
      output_tokens: message.usage_metadata.output_tokens,
      total_tokens: message.usage_metadata.total_tokens
    });
  }
  if (meta.token_usage) return normalizeUsage(meta.token_usage);
  if (meta.usage) return normalizeUsage(meta.usage);
  return emptyUsage();
}

/**
 * Cost in USD. Returns null unless both input and output $/1M are set.
 * Cached tokens use cached $/1M when set, otherwise the input rate.
 */
export function computeCost(usage, pricing) {
  const inputPerMillion = parsePrice(pricing?.inputPerMillion);
  const outputPerMillion = parsePrice(pricing?.outputPerMillion);
  if (inputPerMillion == null || outputPerMillion == null) return null;

  const cachedPerMillion =
    parsePrice(pricing?.cachedPerMillion) ?? inputPerMillion;

  const cached = Math.min(usage.cachedTokens, usage.promptTokens);
  const uncachedPrompt = Math.max(0, usage.promptTokens - cached);

  const inputCost = (uncachedPrompt / 1_000_000) * inputPerMillion;
  const cachedCost = (cached / 1_000_000) * cachedPerMillion;
  const outputCost = (usage.completionTokens / 1_000_000) * outputPerMillion;

  return {
    currency: 'USD',
    input: roundUsd(inputCost),
    cached: roundUsd(cachedCost),
    output: roundUsd(outputCost),
    total: roundUsd(inputCost + cachedCost + outputCost)
  };
}

function parsePrice(value) {
  if (value === '' || value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function roundUsd(n) {
  return Math.round(n * 1_000_000) / 1_000_000;
}

export function parsePricingFromBody(body) {
  if (!body?.pricing || typeof body.pricing !== 'object') return null;
  return {
    inputPerMillion: body.pricing.inputPerMillion,
    outputPerMillion: body.pricing.outputPerMillion,
    cachedPerMillion: body.pricing.cachedPerMillion
  };
}
