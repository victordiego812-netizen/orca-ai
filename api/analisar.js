const Busboy = require('busboy');

const MIN_FILES = 2;
const MAX_FILES = 4;
const MAX_FILE_SIZE = 4 * 1024 * 1024;
const FASE1_CITY = 'Sorocaba';
const MATERIAL_STANDARD = 'tinta acrílica standard/intermediária e insumos equivalentes';

function parseNumber(value) {
  if (!value) return null;
  const normalized = String(value).replace(',', '.').replace(/[^0-9.]/g, '');
  const n = Number(normalized);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseIntSafe(value) {
  if (value === undefined || value === null || String(value).trim() === '') return 0;
  const n = Number(String(value).replace(/[^0-9]/g, ''));
  return Number.isInteger(n) && n >= 0 ? n : NaN;
}

function normalizeText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const fields = {};
    const files = [];
    let oversizedFiles = 0;
    let invalidFiles = 0;

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

      const mimeType = info.mimeType || '';
      if (!mimeType.startsWith('image/')) {
        invalidFiles += 1;
        stream.resume();
        return;
      }

      const chunks = [];
      let truncated = false;
      stream.on('limit', () => { truncated = true; });
      stream.on('data', chunk => chunks.push(chunk));
      stream.on('end', () => {
        if (truncated) {
          oversizedFiles += 1;
          return;
        }
        const buffer = Buffer.concat(chunks);
        if (!buffer.length) {
          invalidFiles += 1;
          return;
        }
        files.push({
          buffer,
          mimeType,
          filename: info.filename || 'foto.jpg'
        });
      });
    });

    bb.on('error', reject);
    bb.on('finish', () => resolve({ fields, files, oversizedFiles, invalidFiles }));
    req.pipe(bb);
  });
}

function validateFields(fields) {
  const scope = fields.scope === 'parede' ? 'parede' : 'comodo';
  const width = parseNumber(fields.width);
  const length = parseNumber(fields.length);
  const height = parseNumber(fields.height);
  const doors = parseIntSafe(fields.doors);
  const windows = parseIntSafe(fields.windows);

  if (Number.isNaN(doors) || doors > 20) return 'Informe uma quantidade válida de portas, entre 0 e 20.';
  if (Number.isNaN(windows) || windows > 20) return 'Informe uma quantidade válida de janelas, entre 0 e 20.';

  if (fields.width && (!width || width < 0.5 || width > 20)) {
    return 'A largura deve estar entre 0,5 m e 20 m.';
  }
  if (fields.height && (!height || height < 1.8 || height > 6)) {
    return 'A altura deve estar entre 1,8 m e 6 m.';
  }
  if (scope === 'comodo' && fields.length && (!length || length < 0.5 || length > 30)) {
    return 'O comprimento deve estar entre 0,5 m e 30 m.';
  }

  const anyMeasure = Boolean(fields.width || fields.height || (scope === 'comodo' && fields.length));
  if (anyMeasure) {
    if (!width || !height) return 'Para usar medidas no cálculo, informe largura e altura.';
    if (scope === 'comodo' && !length) return 'Para calcular um cômodo inteiro, informe também o comprimento.';
  }

  return null;
}

function estimateArea(fields) {
  const width = parseNumber(fields.width);
  const length = parseNumber(fields.length);
  const height = parseNumber(fields.height);
  const scope = fields.scope === 'parede' ? 'parede' : 'comodo';
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

  // Portas e janelas informadas devem pertencer ao escopo selecionado.
  const openingsDiscount = Math.min(wallArea * 0.55, (doors * 1.6) + (windows * 1.2));
  const paintArea = Math.max(1, wallArea - openingsDiscount + ceilingArea);
  return {
    wallArea: Number(wallArea.toFixed(1)),
    ceilingArea: Number(ceilingArea.toFixed(1)),
    openingsDiscount: Number(openingsDiscount.toFixed(1)),
    paintArea: Number(paintArea.toFixed(1))
  };
}

function round10(v) { return Math.round(v / 10) * 10; }

function getSorocabaPrice({ analysis, fields }) {
  const area = estimateArea(fields);
  const complexity = ['baixa', 'media', 'alta'].includes(analysis.complexidade) ? analysis.complexidade : 'media';

  const laborPerM2 = {
    baixa: [12, 20],
    media: [18, 30],
    alta: [28, 45]
  };
  const materialPerM2 = {
    baixa: [8, 12],
    media: [10, 16],
    alta: [14, 22]
  };

  if (area) {
    const [lMin, lMax] = laborPerM2[complexity];
    const [mMin, mMax] = materialPerM2[complexity];

    let laborMin = area.paintArea * lMin;
    let laborMax = area.paintArea * lMax;
    let materialMin = area.paintArea * mMin;
    let materialMax = area.paintArea * mMax;

    laborMin = Math.max(laborMin, 220);
    laborMax = Math.max(laborMax, 320);
    materialMin = Math.max(materialMin, 80);
    materialMax = Math.max(materialMax, 130);

    return {
      min: round10(laborMin + materialMin),
      max: round10(laborMax + materialMax),
      mao_obra: { min: round10(laborMin), max: round10(laborMax) },
      materiais: { min: round10(materialMin), max: round10(materialMax) },
      area_estimada_m2: area.paintArea,
      calculo_por_medidas: true,
      regiao_referencia: 'Sorocaba/SP',
      padrao_material: 'standard/intermediário',
      base_calculo: 'medidas informadas + complexidade visual + mão de obra regional + materiais standard/intermediários'
    };
  }

  const roomBase = {
    'Sala': [700, 1450],
    'Quarto': [550, 1150],
    'Cozinha': [650, 1300],
    'Banheiro': [450, 900],
    'Área externa': [850, 1700],
    'Outro': [600, 1250]
  };
  const factor = { baixa: 0.9, media: 1.1, alta: 1.45 }[complexity];
  let [min, max] = roomBase[fields.room] || roomBase.Outro;
  min *= factor;
  max *= factor;
  if (fields.ceiling === 'sim' && fields.scope !== 'parede') { min *= 1.12; max *= 1.2; }

  return {
    min: round10(min),
    max: round10(max),
    mao_obra: null,
    materiais: null,
    area_estimada_m2: null,
    calculo_por_medidas: false,
    regiao_referencia: 'Sorocaba/SP',
    padrao_material: 'standard/intermediário',
    base_calculo: 'triagem visual sem metragem confirmada; faixa regional ampla com materiais standard/intermediários'
  };
}

function safeJson(text) {
  const cleaned = String(text || '').replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
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
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.15 }
    })
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });
  if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: 'A variável GEMINI_API_KEY ainda não foi configurada na Vercel.' });

  try {
    const { fields, files, oversizedFiles, invalidFiles } = await parseMultipart(req);

    if (oversizedFiles) {
      return res.status(400).json({ error: 'Uma ou mais fotos ultrapassaram 4 MB após o envio. Tente novamente.' });
    }
    if (invalidFiles) {
      return res.status(400).json({ error: 'Envie somente arquivos de imagem válidos.' });
    }
    if (files.length < MIN_FILES) {
      return res.status(400).json({ error: `Envie pelo menos ${MIN_FILES} fotos do serviço.` });
    }

    const city = fields.city || FASE1_CITY;
    if (normalizeText(city) !== 'sorocaba') {
      return res.status(400).json({ error: 'Nesta fase, o Orça.AI está calibrado apenas para Sorocaba/SP.' });
    }
    fields.city = FASE1_CITY;
    fields.scope = fields.scope === 'parede' ? 'parede' : 'comodo';
    if (fields.scope === 'parede') fields.ceiling = 'nao';

    const validationError = validateFields(fields);
    if (validationError) return res.status(400).json({ error: validationError });

    const openingLabel = fields.scope === 'parede' ? 'na parede selecionada' : 'no ambiente';
    const prompt = `Você é o módulo visual do Orça.AI, um sistema brasileiro de PRÉ-ANÁLISE de serviços de pintura em Sorocaba/SP. Sua função é TRIAR o serviço antes da visita presencial. Analise somente o que é visualmente defensável. Não finja precisão, não diagnostique problemas ocultos, não invente metragem, não invente materiais específicos para efeitos decorativos e não trate hipótese como certeza. Se algo não estiver visível, diga que não é possível confirmar. Para a estimativa comercial da Fase 1, considere materiais de padrão standard/intermediário (${MATERIAL_STANDARD}), sem assumir linhas premium.\n\nDados informados:\nCidade: Sorocaba/SP\nBairro: ${fields.neighborhood || 'não informado'}\nAmbiente: ${fields.room || 'não informado'}\nEscopo: ${fields.scope === 'parede' ? 'uma parede' : 'cômodo inteiro'}\nIncluir teto: ${fields.scope === 'parede' ? 'não se aplica' : (fields.ceiling || 'não informado')}\nLargura: ${fields.width || 'não informada'}\nComprimento: ${fields.scope === 'parede' ? 'não se aplica' : (fields.length || 'não informado')}\nAltura: ${fields.height || 'não informada'}\nPortas ${openingLabel}: ${fields.doors || '0'}\nJanelas ${openingLabel}: ${fields.windows || '0'}\nObservações: ${fields.notes || 'nenhuma'}\n\nRetorne SOMENTE JSON válido com esta estrutura exata:\n{\n  "servico": "pintura interna|pintura externa|indefinido",\n  "ambiente": "texto curto",\n  "complexidade": "baixa|media|alta",\n  "estado_parede": "texto curto",\n  "materiais": ["item possivelmente necessário", "item possivelmente necessário"],\n  "pontos_atencao": ["item", "item"],\n  "informacoes_faltantes": ["informação que melhoraria o orçamento"],\n  "visita_recomendada": true,\n  "motivo_visita": "texto curto",\n  "resumo": "explicação objetiva em português, no máximo 3 frases",\n  "confianca_visual": "baixa|media|alta"\n}\n\nCritérios: baixa = superfície aparentemente íntegra e pouca preparação; média = correções, lixamento, pequenas áreas descascando ou mudança de cor que aumente trabalho; alta = descascamento relevante, muitas correções, sinais visíveis de umidade/mofo, difícil acesso ou condição visual muito ruim. Em materiais, prefira termos conservadores como 'massa para correções, se necessária'. Nunca recomende 'massa para efeito decorativo' só porque viu textura. A visita deve ser recomendada quando houver sinais de umidade, textura/revestimento especial, condição ruim, informação importante ausente ou baixa confiança visual.`;

    const parts = [{ text: prompt }];
    for (const file of files) parts.push({ inlineData: { mimeType: file.mimeType, data: file.buffer.toString('base64') } });

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
      return res.status(502).json({ error: 'A IA não conseguiu analisar as imagens agora.', detalhe: lastDetail || 'Falha ao chamar a API do Gemini.' });
    }

    const raw = await response.json();
    const text = raw?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
    if (!text) return res.status(502).json({ error: 'O Gemini respondeu sem conteúdo analisável.' });

    const analysis = safeJson(text);
    const faixa_preco = getSorocabaPrice({ analysis, fields });

    return res.status(200).json({
      ...analysis,
      ambiente: analysis.ambiente || fields.room || 'Ambiente não definido',
      faixa_preco,
      fase: 'Sorocaba/SP + materiais standard/intermediários',
      faixa_experimental: true
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Falha ao processar a análise. Tente novamente.' });
  }
};
