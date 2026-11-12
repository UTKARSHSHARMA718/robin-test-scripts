import AdmZip from 'adm-zip';

const MAX_JSON_BYTES = 2 * 1024 * 1024;

const PACKAGE_KEYS = new Set([
  'package', 'packageName', 'package_name', 'plugin', 'pluginName', 'library',
  'commandPackage', 'applicationName'
]);
const COMMAND_KEYS = new Set([
  'command', 'commandName', 'command_name', 'action', 'actionName', 'nodeName', 'name'
]);
const TYPE_KEYS = new Set(['type', 'nodeType', 'kind', 'actionType', 'commandType']);

/** @typedef {{ fileName: string, data: object }} AaBotEntry */
/** @typedef {'single' | 'multi'} AaPackageKind */

/**
 * Parse one uploaded .json or .zip into one or more bot definitions.
 * @returns {{ bots: AaBotEntry[], packageKind: AaPackageKind }}
 */
export function parseAaUpload(buffer, originalName) {
  const bots = expandUploadToBots(buffer, originalName);
  return { bots, packageKind: packageKindFromCount(bots.length) };
}

/**
 * Parse multiple uploads (.json and/or .zip files) into a flat bot list.
 * @param {{ buffer: Buffer, originalname: string }[]} uploads
 */
export function parseAaUploadBatch(uploads) {
  if (!uploads?.length) {
    throw new Error('Upload at least one .json bot export or .zip containing .json file(s).');
  }
  const bots = [];
  for (const { buffer, originalname } of uploads) {
    assertUploadSize(buffer);
    bots.push(...expandUploadToBots(buffer, originalname));
  }
  return { bots, packageKind: packageKindFromCount(bots.length) };
}

/** Mechanical summary only — for UI before LLM analysis. */
export function inspectAaPackage(uploads) {
  const { bots, packageKind } = parseAaUploadBatch(uploads);
  return {
    packageKind,
    botCount: bots.length,
    bots: bots.map(({ fileName, data }) => ({
      fileName,
      mechanical: summarizeAaBot(data, fileName)
    }))
  };
}

function packageKindFromCount(count) {
  return count > 1 ? 'multi' : 'single';
}

function expandUploadToBots(buffer, originalName) {
  const lower = originalName.toLowerCase();
  if (lower.endsWith('.json')) {
    return [{ fileName: originalName, data: parseJsonBuffer(buffer) }];
  }
  if (lower.endsWith('.zip')) {
    return extractAllJsonFromZip(buffer, originalName);
  }
  throw new Error(`"${originalName}" is not a .json or .zip file.`);
}

function parseJsonBuffer(buffer) {
  const text = buffer.toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('File is not valid JSON.');
  }
}

function extractAllJsonFromZip(buffer, zipName) {
  const zip = new AdmZip(buffer);
  const jsonEntries = zip.getEntries().filter(entry =>
    !entry.isDirectory && entry.entryName.toLowerCase().endsWith('.json')
  );
  if (!jsonEntries.length) {
    throw new Error(`No .json file found inside ${zipName}.`);
  }
  const sorted = [...jsonEntries].sort((a, b) =>
    a.entryName.localeCompare(b.entryName, undefined, { sensitivity: 'base' })
  );
  return sorted.map(entry => ({
    fileName: `${zipName} → ${entry.entryName}`,
    data: parseJsonBuffer(entry.getData())
  }));
}

/** Best-effort structural summary to ground the LLM (format varies by AA version). */
export function summarizeAaBot(data, fileName) {
  const packages = new Set();
  const commands = new Set();
  const types = new Set();
  const variableNames = new Set();
  let nodeLikeCount = 0;

  walk(data, (key, value, parentKey) => {
    if (typeof value === 'string' && value.length < 200) {
      if (PACKAGE_KEYS.has(key)) packages.add(value);
      if (COMMAND_KEYS.has(key) && parentKey !== 'metadata') commands.add(value);
      if (TYPE_KEYS.has(key)) types.add(value);
    }
    if ((key === 'variable' || key === 'variableName' || key === 'name') && typeof value === 'string') {
      if (parentKey && /variable|input|output|argument/i.test(parentKey)) variableNames.add(value);
    }
    if (/node|step|command|action/i.test(key) && value && typeof value === 'object') nodeLikeCount++;
  });

  const topLevelKeys = data && typeof data === 'object' && !Array.isArray(data)
    ? Object.keys(data)
    : [];

  return {
    fileName,
    topLevelKeys,
    packages: [...packages].slice(0, 80),
    commands: [...commands].slice(0, 120),
    nodeTypes: [...types].slice(0, 80),
    variables: [...variableNames].slice(0, 80),
    nodeLikeCount,
    jsonSizeBytes: Buffer.byteLength(JSON.stringify(data), 'utf8')
  };
}

function walk(value, visit, depth = 0, parentKey = '') {
  if (depth > 40 || value == null) return;
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit, depth + 1, parentKey);
    return;
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      visit(key, child, parentKey);
      walk(child, visit, depth + 1, key);
    }
  }
}

export function stringifyBotForLlm(data, maxChars = 100_000) {
  let text = JSON.stringify(data, null, 2);
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }
  text = `${text.slice(0, maxChars)}\n… [truncated for LLM context]`;
  return { text, truncated: true };
}

export function assertUploadSize(buffer) {
  if (buffer.length > MAX_JSON_BYTES * 5) {
    throw new Error('File is too large (max ~10 MB).');
  }
}
