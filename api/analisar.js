const Busboy = require('busboy');

const MAX_FILES = 4;
const MAX_FILE_SIZE = 4 * 1024 * 1024;

function parseNumber(value) {
  if (!value) return null;
  const n = Number(String(value).replace(',', '.').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const fields = {};
    const files = [];
    const bb = Busboy({
      headers: req.headers,
      limits: { files: MAX_FILES, fileSize: MAX_FILE_SIZE, fields: 20 }
    });

    bb.on('field', (name, value) => { fields[name] = value; });
    bb.on('file', (name, stream, info) => {
      if (name !== 'photos' || files.length >= MAX_FILES) {
        stream.resume();
        return;
      }
      const chunks = [];
      let truncated = false;
      stream.on('limit', () => { truncated = true; });
      stream.on('data', chunk => chunks.push(chunk));
      stream.on('end', () => {
        if (!truncated) {
          files.push({
            buffer: Buffer.concat(chunks),
            mimeType: info.mimeType || 'image/jpeg',
            filename: info.filename || 'foto.jpg'
          });
        }
      });
    });
    bb.on('error', reject);
    bb.on('finish', () => resolve({ fields, files }));
    req.pipe(bb);
  });
}

function getExperimentalPrice({ complexity, room, ceiling, width, height }) {
  const roomBase = {
    'Sala': [650, 1150],
    'Quarto': [500, 900],
    'Cozinha': [600, 1100],
    'Banheiro': [400, 750],
    'Área externa': [750, 1400],
    'Outro': [550, 1000]
  };
  const complexityFactor = { baixa: 0.9, media: 1.15, alta: 1.45 };
  let [min, max] = roomBase[room] || roomBase.Outro;
  const factor = complexityFactor[complexity] || 1.15;
  min *= factor;
  max *= factor;
  if (ceiling === 'sim') { min *= 1.2; max *= 1.25; }

  const w = parseNumber(width), h = parseNumber(height);
  if (w && h) {
    const area = w * h;
    const areaFactor = Math.max(0.75, Math.min(1.8, area / 10));
    min *= areaFactor;
    max *= areaFactor;
  }

  return {
    min: Math.max(250, Math.round(min / 10) * 10),
    max: Math.max(350, Math.round(max / 10) * 10)
  };
}

function safeJson(text) {
  const cleaned = String(text || '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  return JSON.parse(cleaned);
}

function cleanGeminiError(detail, status) {
  try {
    const parsed = JSON.parse(detail);
    const msg = parsed?.error?.message || '';
    const code = parsed?.error?.status || '';
    return `Gemini ${status}${code ? ` (${code})` : ''}: ${msg}`.slice(0, 500);
  } catch {
    return `Gemini ${status}: ${String(detail || 'erro desconhecido').slice(0, 350)}`;
  }
}

async function callGemini(model, apiKey, parts) {
  return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.2
      }
    })
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });
  if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: 'A variável GEMINI_API_KEY ainda não foi configurada na Vercel.' });

  try {
    const { fields, files } = await parseMultipart(req);
    if (!files.length) return res.status(400).json({ error: 'Envie pelo menos uma foto.' });

    const prompt = `Você é o módulo visual do Orça.AI, um sistema brasileiro de PRÉ-ANÁLISE de serviços de pintura. Analise as fotos sem fingir precisão que a imagem não permite. Não diagnostique problemas ocultos. Não invente metragem. Se algo não estiver visível, diga que não é possível confirmar.\n\nDados informados:\nCidade: ${fields.city || 'não informada'}\nBairro: ${fields.neighborhood || 'não informado'}\nAmbiente: ${fields.room || 'não informado'}\nIncluir teto: ${fields.ceiling || 'não informado'}\nLargura: ${fields.width || 'não informada'}\nAltura: ${fields.height || 'não informada'}\nObservações: ${fields.notes || 'nenhuma'}\n\nRetorne SOMENTE JSON válido com esta estrutura exata:\n{\n  "servico": "pintura interna|pintura externa|indefinido",\n  "ambiente": "texto curto",\n  "complexidade": "baixa|media|alta",\n  "estado_parede": "texto curto",\n  "materiais": ["item", "item"],\n  "pontos_atencao": ["item", "item"],\n  "resumo": "explicação objetiva em português, no máximo 3 frases",\n  "confianca_visual": "baixa|media|alta"\n}\n\nCritérios: baixa = superfície aparentemente íntegra e pouca preparação; média = correções, lixamento, pequenas áreas descascando ou mudança de cor que aumente trabalho; alta = descascamento relevante, muitas correções, sinais visíveis de umidade/mofo, difícil acesso ou condição visual muito ruim. Materiais devem ser apenas prováveis, nunca quantidades exatas sem metragem confiável.`;

    const parts = [{ text: prompt }];
    for (const file of files) {
      parts.push({ inlineData: { mimeType: file.mimeType, data: file.buffer.toString('base64') } });
    }

    const preferred = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
    const models = [...new Set([preferred, 'gemini-3.5-flash-lite', 'gemini-3.5-flash'])];
    let response;
    let lastDetail = '';

    for (const model of models) {
      response = await callGemini(model, process.env.GEMINI_API_KEY, parts);
      if (response.ok) break;
      const detail = await response.text();
      lastDetail = cleanGeminiError(detail, response.status);
      console.error(`Gemini error (${model}):`, detail);
      if (![404, 429, 500, 503].includes(response.status)) break;
    }

    if (!response || !response.ok) {
      return res.status(502).json({
        error: 'A IA não conseguiu analisar as imagens agora.',
        detalhe: lastDetail || 'Falha ao chamar a API do Gemini.'
      });
    }

    const raw = await response.json();
    const text = raw?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
    if (!text) return res.status(502).json({ error: 'O Gemini respondeu sem conteúdo analisável.' });

    const analysis = safeJson(text);
    const faixa_preco = getExperimentalPrice({
      complexity: analysis.complexidade,
      room: fields.room || 'Outro',
      ceiling: fields.ceiling,
      width: fields.width,
      height: fields.height
    });

    return res.status(200).json({
      ...analysis,
      ambiente: analysis.ambiente || fields.room || 'Ambiente não definido',
      faixa_preco,
      faixa_experimental: true
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Falha ao processar a análise. Tente novamente com fotos menores.' });
  }
};
