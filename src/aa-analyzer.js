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

## Migration notes for PAD
For each major AA capability, suggest what PAD should search for (actions/modules), and call out gaps or manual steps.

Rules:
- Base conclusions on the supplied JSON and mechanical summary only.
- Say explicitly when something is unclear.
- Do not write Robin code; this brief feeds a separate PAD generator.`;

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

  return runAnalyzer(model, userPayload).then(understanding => ({
    understanding,
    mechanical,
    truncated
  }));
}

async function runAnalyzer(model, userPayload) {
  const llm = loadLlm(model);
  const { content } = await llm.invoke(
    [
      new SystemMessage(ANALYZER_SYSTEM),
      new HumanMessage(userPayload)
    ],
    []
  );
  if (!content?.trim()) throw new Error('Analyzer returned empty content.');
  return content.trim();
}
