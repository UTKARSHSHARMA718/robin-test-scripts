import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const MCP_TIMEOUT_MS = 120_000;

function parseToolResult(response) {
  if (response.isError) {
    const text = response.content?.find(item => item.type === 'text')?.text ?? 'Tool failed.';
    throw new Error(text);
  }
  if (response.structuredContent) return response.structuredContent;
  const text = response.content?.[0]?.text;
  if (!text) return null;
  return JSON.parse(text);
}

export async function withMcpClient(config, fn) {
  const client = new Client({ name: 'pad-robin-agent', version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(new URL(config.mcpUrl), {
    requestInit: { headers: { Authorization: `Bearer ${config.mcpToken}` } }
  });
  await client.connect(transport, { timeout: MCP_TIMEOUT_MS });
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

export async function callMcpTool(client, name, args = {}) {
  const response = await client.callTool({ name, arguments: args }, { timeout: MCP_TIMEOUT_MS });
  return parseToolResult(response);
}

export async function loadPadContext(client, powerFx) {
  return callMcpTool(client, 'get_development_context', { power_fx: powerFx });
}

export async function listMcpTools(client) {
  const { tools } = await client.listTools();
  return tools;
}
