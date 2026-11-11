import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import dotenv from 'dotenv';
import multer from 'multer';
import { generateRobinScript } from './agent.js';
import { analyzeAaExport } from './aa-analyzer.js';
import { assertUploadSize, parseAaUpload } from './aa-bot.js';
import { parsePricingFromBody } from './usage.js';

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env') });

const app = express();
const port = Number(process.env.PORT ?? 3000);
const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

app.use(express.json({ limit: '2mb' }));
app.use(express.static(publicDir));

function mcpConfig() {
  const mcpToken = process.env.PAD_MCP_TOKEN;
  const mcpUrl = process.env.MCP_URL ?? 'http://localhost:8080/mcp';
  if (!mcpToken) throw new Error('PAD_MCP_TOKEN is not set in .env.');
  return {
    mcpUrl,
    mcpToken,
    maxSteps: Number(process.env.AGENT_MAX_STEPS ?? 20)
  };
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/analyze-aa', upload.single('file'), async (req, res) => {
  try {
    const model = String(req.body?.model ?? '').trim();
    if (!req.file) return res.status(400).json({ error: 'Upload a .zip or .json bot export.' });

    assertUploadSize(req.file.buffer);
    const { fileName, data } = parseAaUpload(req.file.buffer, req.file.originalname);
    const result = await analyzeAaExport({ data, fileName, model });

    res.json({
      understanding: result.understanding,
      mechanical: result.mechanical,
      truncated: result.truncated,
      model: model || undefined
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message ?? 'Analysis failed.' });
  }
});

app.post('/api/generate', async (req, res) => {
  try {
    const requirement = String(req.body?.requirement ?? '').trim();
    const mode = req.body?.mode;
    const model = String(req.body?.model ?? '').trim();

    if (!requirement) {
      return res.status(400).json({ error: 'Migration brief / requirement is required.' });
    }
    if (mode !== 'classic' && mode !== 'powerfx') {
      return res.status(400).json({ error: 'mode must be classic or powerfx.' });
    }

    const powerFx = mode === 'powerfx' ? 'enabled' : 'disabled';
    const result = await generateRobinScript({
      requirement,
      powerFx,
      model,
      pricing: parsePricingFromBody(req.body),
      config: mcpConfig()
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
