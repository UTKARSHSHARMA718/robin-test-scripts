import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import dotenv from 'dotenv';
import { generateRobinScript } from './agent.js';

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env') });

const app = express();
const port = Number(process.env.PORT ?? 3000);
const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

app.use(express.json({ limit: '1mb' }));
app.use(express.static(publicDir));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/generate', async (req, res) => {
  try {
    const requirement = String(req.body?.requirement ?? '').trim();
    const mode = req.body?.mode;

    if (!requirement) {
      return res.status(400).json({ error: 'Requirement is required.' });
    }
    if (mode !== 'classic' && mode !== 'powerfx') {
      return res.status(400).json({ error: 'mode must be classic or powerfx.' });
    }

    const mcpToken = process.env.PAD_MCP_TOKEN;
    const mcpUrl = process.env.MCP_URL ?? 'http://localhost:8080/mcp';
    if (!mcpToken) {
      return res.status(500).json({ error: 'PAD_MCP_TOKEN is not set in .env.' });
    }

    const powerFx = mode === 'powerfx' ? 'enabled' : 'disabled';
    const result = await generateRobinScript({
      requirement,
      powerFx,
      config: {
        mcpUrl,
        mcpToken,
        maxSteps: Number(process.env.AGENT_MAX_STEPS ?? 20)
      }
    });

    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message ?? 'Generation failed.' });
  }
});

app.listen(port, () => {
  console.log(`Robin agent UI: http://localhost:${port}`);
  console.log(`LLM_PROVIDER=${process.env.LLM_PROVIDER ?? 'openai'}`);
});
