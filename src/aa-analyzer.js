import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { loadLlm } from './llm/index.js';
import { stringifyBotForLlm, summarizeAaBot } from './aa-bot.js';

const ANALYZER_SYSTEM = `You analyze Automation Anywhere (AA) bot exports to prepare migration to Microsoft Power Automate Desktop (PAD).

Produce a detailed, editable brief in Markdown with these sections:

## Purpose
What business process this bot performs.

## High-level flow
Numbered steps in execution order.

## Packages and dependencies
List packages, plugins, or libraries implied by the export (only what the JSON supports).

## Data and variables
Inputs, outputs, file paths, credentials placeholders, tables, and key variables.

## Control flow
Loops, conditions, try/catch or error handling, subtasks/bot invocations if present.

## Integrations and UI automation
Excel, email, browser, SAP, databases, desktop UI selectors, API calls—mark uncertain items.

Rules:
- Base conclusions on the supplied JSON and mechanical summary only.
- Say explicitly when something is unclear.
- Do not write Robin code; this brief feeds a separate PAD generator.`;

const COMBINE_SYSTEM = `You merge several per-workflow migration briefs from one Automation Anywhere package (multiple bots/workflows) into a single editable Markdown brief for migrating the whole package to Microsoft Power Automate Desktop (PAD).

Produce one coherent document that a developer can edit before PAD code generation. Include:

## Package overview
How many workflows, how they relate (parent/child, sequential hand-offs, shared data), and suggested migration order if inferable.

## Per-workflow detail
For each workflow, preserve the essential content from its individual brief (Purpose, high-level flow, dependencies, data, control flow, integrations). Use clear subheadings with the workflow/bot name.

## Shared resources
Packages, credentials, files, queues, or variables used across workflows.

Rules:
- Do not invent behavior not supported by the supplied per-workflow briefs.
- Flag gaps and uncertainties.
- Do not write Robin code.`;

export function analyzeAaExport({ data, fileName, model }) {
  const mechanical = summarizeAaBot(data, fileName);
  const { text: jsonText, truncated } = stringifyBotForLlm(data);

  const userPayload = [
    'Mechanical summary (automated):',
    '```json',
    JSON.stringify(mechanical, null, 2),
    '```',
    '',
    truncated ? 'Bot JSON (truncated):' : 'Bot JSON:',
    '```json',
    jsonText,
    '```'
  ].join('\n');

  return runAnalyzer(model, userPayload, ANALYZER_SYSTEM).then(understanding => ({
    understanding,
    mechanical,
    truncated
  }));
}

/**
 * Analyze one or more bot JSON definitions; multi-bot packages get per-bot LLM calls then one merge call.
 * @param {{ bots: { data: object, fileName: string }[], model: string }} params
 */
export async function analyzeAaPackage({ bots, model }) {
  if (!bots?.length) throw new Error('No bot definitions to analyze.');

  if (bots.length === 1) {
    const { data, fileName } = bots[0];
    const result = await analyzeAaExport({ data, fileName, model });
    return {
      understanding: result.understanding,
      mechanical: result.mechanical,
      truncated: result.truncated,
      packageKind: 'single',
      bots: [
        {
          fileName,
          mechanical: result.mechanical,
          truncated: result.truncated
        }
      ]
    };
  }

  const perBot = await Promise.all(
    bots.map(async ({ data, fileName }) => {
      const result = await analyzeAaExport({ data, fileName, model });
      return { fileName, ...result };
    })
  );

  const understanding = await combineUnderstandings(
    model,
    perBot.map(b => ({ fileName: b.fileName, understanding: b.understanding }))
  );

  return {
    understanding,
    mechanical: perBot.map(b => b.mechanical),
    truncated: perBot.some(b => b.truncated),
    packageKind: 'multi',
    bots: perBot.map(b => ({
      fileName: b.fileName,
      mechanical: b.mechanical,
      truncated: b.truncated
    }))
  };
}

async function combineUnderstandings(model, items) {
  const userPayload = [
    'Merge these per-workflow briefs into one package-level migration brief.',
    '',
    ...items.flatMap(({ fileName, understanding }, index) => [
      `--- Workflow ${index + 1}: ${fileName} ---`,
      understanding,
      ''
    ])
  ].join('\n');

  return runAnalyzer(model, userPayload, COMBINE_SYSTEM);
}

async function runAnalyzer(model, userPayload, systemPrompt) {
  const llm = loadLlm(model);
  const { content } = await llm.invoke(
    [
      new SystemMessage(systemPrompt),
      new HumanMessage(userPayload)
    ],
    []
  );
  if (!content?.trim()) throw new Error('Analyzer returned empty content.');
  return content.trim();
}
