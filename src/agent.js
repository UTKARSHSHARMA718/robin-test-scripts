import { z } from 'zod';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { loadLlmFromEnv } from './llm/index.js';
import {
  withMcpClient,
  callMcpTool,
  loadPadContext,
  listMcpTools
} from './mcp-client.js';

const TOOLS_USING_POWER_FX = new Set([
  'get_development_context',
  'search_patterns',
  'search_actions',
  'search_type_reference',
  'get_pattern'
]);

async function buildMcpLangChainTools(mcpClient) {
  const mcpTools = await listMcpTools(mcpClient);
  return mcpTools.map(def =>
    new DynamicStructuredTool({
      name: def.name,
      description: def.description ?? def.name,
      schema: z.object({}).passthrough(),
      func: async input => JSON.stringify(await callMcpTool(mcpClient, def.name, input))
    })
  );
}

function buildSystemPrompt(padContext, powerFx) {
  const modeLabel = powerFx === 'enabled' ? 'Power Fx enabled' : 'Classic PAD (Power Fx disabled)';
  const devPrompt = padContext.development_prompt ?? '';
  return [
    'You write Power Automate Desktop Robin scripts using pad-mcp tools.',
    `The user chose ${modeLabel}. Always pass power_fx "${powerFx}" on every catalog and pattern tool call.`,
    'Workflow: search_patterns when relevant, get_pattern for hits, search_actions then exact action_id, search_type_reference for types.',
    'Return pasteable Robin in a markdown code block and short notes outside it.',
    '',
    devPrompt
  ].join('\n');
}

function ensurePowerFx(toolName, args, powerFx) {
  if (!TOOLS_USING_POWER_FX.has(toolName)) return args;
  if (toolName === 'get_development_context' && args.power_fx) return args;
  return { ...args, power_fx: powerFx };
}

export async function generateRobinScript({ requirement, powerFx, config }) {
  const llm = loadLlmFromEnv();
  const maxSteps = config.maxSteps;

  return withMcpClient(config, async mcpClient => {
    const padContext = await loadPadContext(mcpClient, powerFx);
    const lcTools = await buildMcpLangChainTools(mcpClient);
    const messages = [
      new SystemMessage(buildSystemPrompt(padContext, powerFx)),
      new HumanMessage(requirement)
    ];

    for (let step = 0; step < maxSteps; step++) {
      const { content, toolCalls, assistantMessage } = await llm.invoke(messages, lcTools);

      if (!toolCalls.length) {
        return {
          output: content ?? 'No response from the model.',
          steps: step + 1,
          provider: llm.provider
        };
      }

      messages.push(assistantMessage ?? new AIMessage({
        content: content ?? '',
        tool_calls: toolCalls.map(call => ({
          id: call.id,
          name: call.name,
          args: call.arguments
        }))
      }));

      for (const call of toolCalls) {
        const args = ensurePowerFx(call.name, call.arguments, powerFx);
        let resultText;
        try {
          const data = await callMcpTool(mcpClient, call.name, args);
          resultText = JSON.stringify(data);
        } catch (error) {
          resultText = JSON.stringify({ error: error.message });
        }
        messages.push(new ToolMessage({
          content: resultText,
          tool_call_id: call.id,
          name: call.name
        }));
      }
    }

    return {
      output: 'Stopped after maximum tool steps. Try a shorter request or raise AGENT_MAX_STEPS.',
      steps: maxSteps,
      provider: llm.provider
    };
  });
}
