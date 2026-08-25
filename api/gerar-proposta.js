const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const SUPABASE_URL = 'https://sutietwbqbpnonlyqifa.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RgzowU0HaxIvSfpjpEX3NA_n0ydUtym';

function cleanText(value, max = 600) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[–—]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^\x20-\xFF]/g, '')
    .trim()
    .slice(0, max);
}
function money(v) {
  const n = Number(v || 0);
  return `R$ ${Math.round(n).toLocaleString('pt-BR')}`;
}
function isUuid(v) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v || ''));
}
async function supabaseFetch(path, token, options = {}) {
  return fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
}
async function getUser(token) {
  const r = await supabaseFetch('/auth/v1/user', token);
  return r.ok ? r.json() : null;
}
async function getProfile(token, userId) {
  const r = await supabaseFetch(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=plan,full_name,business_name,whatsapp,professional_city`, token);
  if (!r.ok) return null;
  return (await r.json())?.[0] || null;
}
async function getAnalysis(token, id) {
  const r = await supabaseFetch(`/rest/v1/analyses?id=eq.${encodeURIComponent(id)}&select=*`, token);
  if (!r.ok) return null;
  return (await r.json())?.[0] || null;
}
async function saveProposal(token, body) {
  const r = await supabaseFetch('/rest/v1/proposals', token, {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error('proposal_save_failed');
  return (await r.json())?.[0] || null;
}
function wrapText(text, font, size, maxWidth) {
  const words = cleanText(text, 3000).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) line = candidate;
    else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : ['-'];
}
async function buildPdf({ analysis, profile, clientName, validityDays, note, proposalId }) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const orange = rgb(0.976, 0.451, 0.086);
  const ink = rgb(0.063, 0.094, 0.157);
  const muted = rgb(0.40, 0.44, 0.52);
  const lineColor = rgb(0.88, 0.90, 0.93);
  const pale = rgb(0.98, 0.98, 0.99);
  const pageSize = [595.28, 841.89];
  const margin = 48;
  const maxWidth = pageSize[0] - margin * 2;
  let page = pdf.addPage(pageSize);
  let y = pageSize[1] - 52;

  const newPage = () => {
    page = pdf.addPage(pageSize);
    y = pageSize[1] - 52;
  };
  const ensure = (need = 60) => { if (y < margin + need) newPage(); };
  const text = (value, size = 10, opts = {}) => {
    const font = opts.bold ? bold : regular;
    const color = opts.color || ink;
    const lines = wrapText(value, font, size, opts.width || maxWidth);
    const lh = opts.lineHeight || size * 1.35;
    ensure(lines.length * lh + 8);
    for (const line of lines) {
      page.drawText(line, { x: opts.x || margin, y, size, font, color });
      y -= lh;
    }
    if (opts.after) y -= opts.after;
  };
  const section = title => {
    ensure(46);
    y -= 6;
    page.drawText(cleanText(title, 80), { x: margin, y, size: 12, font: bold, color: ink });
    y -= 9;
    page.drawLine({ start: { x: margin, y }, end: { x: pageSize[0] - margin, y }, thickness: 1, color: lineColor });
    y -= 18;
  };
  const bulletList = items => {
    const arr = Array.isArray(items) ? items.slice(0, 10) : [];
    if (!arr.length) return text('Nenhum item adicional.', 9, { color: muted, after: 4 });
    for (const item of arr) {
      ensure(30);
      const lines = wrapText(cleanText(item, 220), regular, 9, maxWidth - 16);
      page.drawText('-', { x: margin, y, size: 9, font: bold, color: orange });
      for (let i = 0; i < lines.length; i++) {
        page.drawText(lines[i], { x: margin + 14, y, size: 9, font: regular, color: ink });
        y -= 12;
      }
      y -= 2;
    }
  };

  page.drawText('ORCA.AI', { x: margin, y, size: 18, font: bold, color: ink });
  page.drawText('PROPOSTA DE PRE-ORCAMENTO', { x: margin, y: y - 26, size: 22, font: bold, color: orange });
  y -= 60;

  const business = cleanText(profile.business_name || profile.full_name || 'Profissional de pintura', 120);
  text(business, 14, { bold: true, after: 2 });
  if (profile.whatsapp) text(`WhatsApp: ${cleanText(profile.whatsapp, 40)}`, 9, { color: muted, after: 2 });
  text(`Sorocaba/SP | Proposta ${proposalId ? cleanText(proposalId, 12).toUpperCase() : ''}`, 9, { color: muted, after: 14 });

  if (clientName) {
    section('Cliente');
    text(cleanText(clientName, 120), 11, { bold: true, after: 4 });
  }

  section('Servico analisado');
  text(`${cleanText(analysis.room || 'Pintura', 60)} - ${analysis.scope === 'parede' ? 'uma parede' : 'comodo inteiro'}`, 11, { bold: true, after: 3 });
  text(`Local: ${cleanText(analysis.neighborhood || 'Bairro nao informado', 120)}, Sorocaba/SP`, 9, { color: muted });
  text(`Complexidade visual: ${cleanText(analysis.complexity || 'nao definida', 30)}`, 9, { color: muted });
  if (analysis.estimated_area_m2) text(`Area estimada de pintura: ${analysis.estimated_area_m2} m2`, 9, { color: muted, after: 8 });

  section('Faixa inicial sugerida');
  ensure(90);
  page.drawRectangle({ x: margin, y: y - 60, width: maxWidth, height: 72, color: pale, borderColor: lineColor, borderWidth: 1 });
  page.drawText(`${money(analysis.price_min)} a ${money(analysis.price_max)}`, { x: margin + 18, y: y - 18, size: 20, font: bold, color: ink });
  page.drawText('Faixa de pre-orcamento remoto', { x: margin + 18, y: y - 40, size: 9, font: regular, color: muted });
  y -= 84;
  if (analysis.labor_min != null) text(`Mao de obra estimada: ${money(analysis.labor_min)} a ${money(analysis.labor_max)}`, 10, { bold: true });
  if (analysis.materials_min != null) text(`Materiais estimados: ${money(analysis.materials_min)} a ${money(analysis.materials_max)}`, 10, { bold: true, after: 6 });

  section('Resumo da analise');
  text(cleanText(analysis.summary || 'Pre-analise gerada a partir das fotos e dados enviados.', 700), 10, { after: 8 });
  if (analysis.wall_state) {
    text('Estado aparente', 10, { bold: true, after: 2 });
    text(cleanText(analysis.wall_state, 400), 9, { color: muted, after: 8 });
  }

  section('Materiais possivelmente necessarios');
  bulletList(analysis.materials);
  section('Pontos de atencao');
  bulletList(analysis.attention_points);

  if (note) {
    section('Observacao do profissional');
    text(cleanText(note, 800), 9, { after: 8 });
  }

  section('Validade e condicoes');
  const created = new Date();
  const validUntil = new Date(created.getTime() + validityDays * 86400000);
  text(`Validade desta proposta: ${validityDays} dias, ate ${validUntil.toLocaleDateString('pt-BR')}.`, 9, { bold: true, after: 5 });
  text('Este documento e um pre-orcamento remoto baseado nas fotos, medidas e informacoes fornecidas. Problemas ocultos, condicoes reais do local, alteracoes de escopo e escolha final de materiais podem alterar o valor. O preco definitivo deve ser confirmado pelo profissional.', 8.5, { color: muted, after: 10 });

  ensure(40);
  y -= 8;
  page.drawLine({ start: { x: margin, y }, end: { x: pageSize[0] - margin, y }, thickness: 1, color: lineColor });
  y -= 18;
  text('Gerado pelo Orça.AI', 8, { color: muted });

  pdf.setTitle('Proposta de pre-orcamento Orça.AI');
  pdf.setAuthor(business);
  pdf.setSubject('Pre-orcamento de pintura residencial');
  return Buffer.from(await pdf.save());
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo nao permitido.' });
  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Entre na sua conta para gerar a proposta.' });

  try {
    const user = await getUser(token);
    if (!user?.id) return res.status(401).json({ error: 'Sua sessao expirou. Entre novamente.' });
    const profile = await getProfile(token, user.id);
    if (!profile) return res.status(404).json({ error: 'Perfil nao encontrado.' });
    if (profile.plan !== 'pro') return res.status(403).json({ error: 'A proposta em PDF e um recurso do plano Pro.' });

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const analysisId = String(body.analysis_id || '');
    if (!isUuid(analysisId)) return res.status(400).json({ error: 'Analise invalida.' });
    const clientName = cleanText(body.client_name, 120);
    const note = cleanText(body.note, 800);
    const validityDays = Math.min(60, Math.max(1, Number.parseInt(body.validity_days, 10) || 7));

    const analysis = await getAnalysis(token, analysisId);
    if (!analysis || analysis.user_id !== user.id) return res.status(404).json({ error: 'Analise nao encontrada.' });

    const proposal = await saveProposal(token, {
      user_id: user.id,
      analysis_id: analysisId,
      client_name: clientName || null,
      validity_days: validityDays,
      note: note || null
    });
    const pdf = await buildPdf({ analysis, profile, clientName, validityDays, note, proposalId: proposal?.id });
    const shortId = String(proposal?.id || analysisId).slice(0, 8);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="proposta-orca-ai-${shortId}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).send(pdf);
  } catch (error) {
    console.error('gerar-proposta:', error);
    return res.status(500).json({ error: 'Nao foi possivel gerar a proposta agora.' });
  }
};
