const Busboy = require('busboy');

const MAX_FILES = 4;
const MAX_FILE_SIZE = 4 * 1024 * 1024;

function parseNumber(value) {
  if (!value) return null;
  const n = Number(String(value).replace(',', '.').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseIntSafe(value) {
  const n = parseInt(String(value || '0').replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const fields = {};
    const files = [];
    const bb = Busboy({
      headers: req.headers,
      limits: { files: MAX_FILES, fileSize: MAX_FILE_SIZE, fields: 30 }
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

function estimateArea(fields) {
  const width = parseNumber(fields.width);
  const length = parseNumber(fields.length);
  const height = parseNumber(fields.height);
  const scope = fields.scope || 'comodo';
  const doors = parseIntSafe(fields.doors);
  const windows = parseIntSafe(fields.windows);

  if (!width || !height) return null;

  let wallArea;
  let ceilingArea = 0;

  if (scope === 'parede') {
    wallArea = width * height;
  } else {
    if (!length) return null;
    wallArea = 2 * (width + length) * height;
    if (fields.ceiling === 'sim') ceilingArea = width * length;
  }

  // Descontos médios deliberadamente conservadores. Servem só para pré-orçamento.
  const openingsDiscount = (doors * 1.6) + (windows * 1.2);
  const paintArea = Math.max(1, wallArea - openingsDiscount + ceilingArea);

  return {
    wallArea: Number(wallArea.toFixed(1)),
    ceilingArea: Number(ceilingArea.toFixed(1)),
    openingsDiscount: Number(openingsDiscount.toFixed(1)),
    paintArea: Number(paintArea.toFixed(1))
  };
}

function getExperimentalPrice({ analysis, fields }) {
  const area = estimateArea(fields);
  const complexity = analysis.complexidade || 'media';

  // Valores provisórios do MVP, até calibrarmos com preços reais do público-alvo.
  const laborPerM2 = {
    baixa: [16, 23],
    media: [22, 32],
    alta: [30, 45]
  };
  const materialPerM2 = {
    baixa: [7, 11],
    media: [10, 16],
    alta: [14, 23]
  };

  if (area) {
    const [laborMin, laborMax] = laborPerM2[complexity] || laborPerM2.media;
    const [matMin, matMax] = materialPerM2[complexity] || materialPerM2.media;
    let min = area.paintArea * (laborMin + matMin);
    let max = area.paintArea * (laborMax + matMax);

    // Piso mínimo de deslocamento/mobilização do profissional.
    min = Math.max(min, 300);
    max = Math.max(max, 450);

    return {
      min: Math.round(min / 10) * 10,
      max: Math.round(max / 10) * 10,
      area_estimada_m2: area.paintArea,
      calculo_por_medidas: true,
      base_calculo: 'medidas informadas + complexidade visual + faixas experimentais de mão de obra e materiais'
    };
  }

  // Sem medidas, usamos somente uma faixa ampla de triagem.
  const roomBase = {
    'Sala': [650, 1250],
    'Quarto': [500, 1000],
    'Cozinha': [600, 1200],
    'Banheiro': [400, 850],
    'Área externa': [800, 1550],
    'Outro': [550, 1100]
  };
  const factor = { baixa: 0.9, media: 1.15, alta: 1.5 }[complexity] || 1.15;
  let [min, max] = roomBase[fields.room] || roomBase.Outro;
  min *= factor;
  max *= factor;
  if (fields.ceiling === 'sim') { min *= 1.15; max *= 1.25; }

  return {
    min: Math.round(min / 10) * 10,
    max: Math.round(max / 10) * 10,
    area_estimada_m2: null,
    calculo_por_medidas: false,
    base_calculo: 'triagem visual sem metragem confirmada'
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
        temperature: 0.15
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

    const prompt = `Você é o módulo visual do Orça.AI, um sistema brasileiro de PRÉ-ANÁLISE de serviços de pintura. Sua função é TRIAR o serviço antes da visita presencial. Analise somente o que é visualmente defensável. Não finja precisão, não diagnostique problemas ocultos, não invente metragem, não invente materiais específicos para efeitos decorativos e não trate hipótese como certeza. Se algo não estiver visível, diga que não é possível confirmar.\n\nDados informados:\nCidade: ${fields.city || 'não informada'}\nBairro: ${fields.neighborhood || 'não informado'}\nAmbiente: ${fields.room || 'não informado'}\nEscopo: ${fields.scope === 'parede' ? 'uma parede' : 'cômodo inteiro'}\nIncluir teto: ${fields.ceiling || 'não informado'}\nLargura: ${fields.width || 'não informada'}\nComprimento: ${fields.length || 'não informado'}\nAltura: ${fields.height || 'não informada'}\nPortas: ${fields.doors || 'não informado'}\nJanelas: ${fields.windows || 'não informado'}\nObservações: ${fields.notes || 'nenhuma'}\n\nRetorne SOMENTE JSON válido com esta estrutura exata:\n{\n  "servico": "pintura interna|pintura externa|indefinido",\n  "ambiente": "texto curto",\n  "complexidade": "baixa|media|alta",\n  "estado_parede": "texto curto",\n  "materiais": ["item possivelmente necessário", "item possivelmente necessário"],\n  "pontos_atencao": ["item", "item"],\n  "informacoes_faltantes": ["informação que melhoraria o orçamento"],\n  "visita_recomendada": true,\n  "motivo_visita": "texto curto",\n  "resumo": "explicação objetiva em português, no máximo 3 frases",\n  "confianca_visual": "baixa|media|alta"\n}\n\nCritérios: baixa = superfície aparentemente íntegra e pouca preparação; média = correções, lixamento, pequenas áreas descascando ou mudança de cor que aumente trabalho; alta = descascamento relevante, muitas correções, sinais visíveis de umidade/mofo, difícil acesso ou condição visual muito ruim. Em materiais, prefira termos conservadores como 'massa para correções, se necessária'. Nunca recomende 'massa para efeito decorativo' só porque viu textura. A visita deve ser recomendada quando houver sinais de umidade, textura/revestimento especial, condição ruim, informação importante ausente ou baixa confiança visual.`;

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
    const faixa_preco = getExperimentalPrice({ analysis, fields });

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
